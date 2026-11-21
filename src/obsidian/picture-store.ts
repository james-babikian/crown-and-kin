/*
 * The plugin's picture store (spec §13.0 item 3, §13.6, §13.7, §13.8). One store serves every tree. It finds the file of an `arms` or `portrait` link, checks
 * the file's first bytes (format and size) before any decode, decodes pictures one or two at a time,
 * makes one small copy at the size it shows, closes the full-size picture at once and keeps only the
 * encoded copies, in a least-recently-used list of 24 MB, shown through blob URLs. It also makes the
 * copies for a saved picture (one full-size picture at a time) and the 64 × 64 pixels for "Colours
 * from the arms". Nothing here throws: a picture that fails gives a picture problem, or null.
 *
 * The queue serves first what the user waits for in a window (the edit sheet, the picker, the
 * colours, a saved picture), then the live pictures of the trees, then the background file check.
 * `alone` runs the saved PNG's canvas step with no decode beside it.
 * The picture picker's row previews use this store too: a preview is a small copy through `acquire`,
 * so it may share a cached copy with the cards, and the picker releases every copy when it closes.
 *
 * Rules the code does not show at once:
 * - A copy is the box in CSS px × the settled zoom step (1, 2 or 4) × min(max(dpr, 1), 3). Its key
 *   is the path, the file's mtime and size, the pixel size and the fit, so a changed file never
 *   shows an old copy.
 * - A copy in use is never evicted. `invalidate` raises the path's number, so a decode that was
 *   asked for before it returns null and keeps nothing.
 * - A picture over 40 million pixels (by its header), or a file over 256 MB on disk (64 MB on a
 *   touch device, with no read), is never decoded.
 * - Each step of a job has an 8 s limit. Every canvas is set to 0 × 0 after use, because iOS keeps
 *   the memory of a canvas until then.
 * - Header results are kept across sessions (at most 2000, oldest dropped); decode failures only
 *   until the plugin unloads.
 *
 * The browser work (the vault read, the decode and the encode) goes through `PictureIO`, so the unit
 * checks can count what happens. `defaultIO` (in `picture-io.ts`) is the real one.
 *
 * This file holds the public face (`PictureStore`) and makes the copies. The parts: `picture-headers.ts` (the header results), `picture-pipeline.ts` (the
 * queue and the steps of a job), `picture-entries.ts` (the list of copies).
 *
 * D318: a copy that a caller asks for with `onDevice` is also kept on the device between starts (`picture-copies.ts`). A request
 * looks in the memory list first, then in those copies, which takes no job slot, and only then makes the copy in the queue.
 */

import type { App, TFile } from 'obsidian';
import { copyPixels, pictureFormat, pictureTarget, type CopyPx, type PictureProblem, type SupportedFormat } from '../core/pictures';
import { formatPortraitCrop, type CropFraction } from '../core/portrait-crop';
import type { ArmsOutline } from '../layout/arms-outline';
import { defaultIO, type DecodedPicture, type PictureIO } from './picture-io';
import { NO_COPIES, deviceTicket, type CopyId, type DeviceTicket, type PictureCopies } from './picture-copies';
import { PictureEntries, entryOf, own, type Entry, type PictureCopy } from './picture-entries';
import { PictureHeaders, isProblem, notImage, sigOf } from './picture-headers';
import { PRIORITY_LIVE, PRIORITY_NOW, PicturePipeline, outlineKey, type CopyFit, type Task } from './picture-pipeline';
import { guarded } from './start-guard';

export type { DecodedPicture, PictureIO };

// ---------- Types ----------

/** The box a copy is made for, in CSS px at scale 1; the caller multiplies it by the zoom step. `portrait`: the round upper-centre square. */
export interface CopyBox {
	w: number;
	h: number;
	fit: 'meet' | 'portrait';
	/** Spec §13.13: the selected part, used only with `fit: 'portrait'`; absent = the automatic part. */
	crop?: CropFraction;
	/**
	 * The picture viewer (D256): a raster copy is never larger than the picture itself, so a small picture does not turn into a large blurred copy. An SVG has no
	 * pixels of its own and fills the box. The key does not hold this flag, so use it only with `transient`, which keeps no copy in the list.
	 */
	noEnlarge?: boolean;
	/** D318: keep the drawn copy on the device between starts. Only the pictures that a tree shows set it; a picker list would fill the limited room. Not in the key. */
	onDevice?: boolean;
}

/** A resolved picture link: the file and the format its name says, or the problem. */
export type ResolvedPicture = { ok: true; file: TFile; format: SupportedFormat } | PictureProblem;

/** The numbers of the memory checks (spec §13.6–§13.8 acceptance). */
interface PictureStats {
	/** Encoded bytes of the copies the store holds. */
	bytes: number;
	/** Copies in the least-recently-used list. */
	entries: number;
	/** Copies with at least one holder. */
	inUse: number;
	/** Full-size pictures decoded now. */
	openBitmaps: number;
	/** The most full-size pictures that were decoded at one time. */
	maxOpenBitmaps: number;
}

/** The plugin's picture store. Never throws. */
export interface PictureStore {
	/** O1: web address, missing file or file extension; synchronous. */
	resolve(link: string, sourcePath: string): ResolvedPicture;
	/** O1: the check of the file's first bytes (not a picture, too large); cached; null = fine. */
	check(file: TFile): Promise<PictureProblem | null>;
	/** A small copy, from the list or decoded in the queue; null when `signal` aborted it or the file changed. */
	acquire(file: TFile, box: CopyBox, signal?: AbortSignal): Promise<PictureCopy | PictureProblem | null>;
	/** A copy that the list does not keep (the edit sheet, the picker preview); `release` frees it. */
	transient(file: TFile, box: CopyBox, signal?: AbortSignal): Promise<PictureCopy | PictureProblem | null>;
	/**
	 * B15: a copy the list has now, with no decode. It does not hold the copy (its `release` does
	 * nothing): a caller that keeps the URL calls `acquire`, which finds the same copy at once.
	 */
	peek(file: TFile, box: CopyBox): PictureCopy | null;
	/**
	 * D219: the outline of the arms picture of `file` (the shape of its non-transparent pixels), read once while a copy of the file was made; null while it
	 * is not known, or when the picture shows nothing. The gap round the arms on a card follows it. Optional so that a stand-in store without arms (a test) needs no outline.
	 */
	outlineOf?(file: TFile): ArmsOutline | null;
	/** O7: the 64 × 64 RGBA pixels of arms (fitted, transparent around), or null when the plugin cannot read them. */
	pixels(file: TFile): Promise<Uint8ClampedArray | null>;
	/** O4, P3: a PNG data URI at `w` × `h` picture px; the full-size picture is freed before it returns. */
	exportCopy(file: TFile, box: { w: number; h: number; fit: CopyBox['fit']; crop?: CropFraction }): Promise<string | PictureProblem>;
	/** O8, O9: forget every copy and check result of the path. A copy in use stays until its release. */
	invalidate(path: string): void;
	/** O9: tells the listeners that these picture files changed (main.ts calls it after its 250 ms wait). */
	changed(paths: readonly string[]): void;
	/** O9: `fn` hears each `changed`; the result stops it. */
	onChange(fn: (paths: readonly string[]) => void): () => void;
	/**
	 * B13: runs `fn` with the queue held alone: it starts after the running decodes end, and no decode
	 * starts before it ends (the saved PNG's canvas). Its result or error is the promise's.
	 */
	alone<T>(fn: () => Promise<T>): Promise<T>;
	/** Plugin unload: revoke every URL and stop the queue. */
	clear(): void;
	readonly stats: PictureStats;
}

// ---------- Limits and shared helpers (the parts moved to their own files) ----------

export { HEADER_STORE_KEY, isProblem } from './picture-headers';
export { ARMS_PIXELS, NO_READ_BYTES, NO_READ_BYTES_COARSE } from './picture-pipeline';
export { STORE_BYTES, type PictureCopy } from './picture-entries';

/** What a job makes: a new copy, or the problem of the file, or null (aborted, the file changed). */
type CopyResult = Entry | PictureProblem | null;
/** What a caller gets: the copy already held for it (O4: before any eviction can see it). */
type Given = PictureCopy | PictureProblem | null;

interface Waiter {
	resolve(v: Given): void;
	signal?: AbortSignal;
	gone: boolean;
}

/** A copy job under way: the callers that wait for it. */
interface Job {
	waiters: Set<Waiter>;
}

/** What one copy job needs to run and to end. */
interface CopyJob {
	file: TFile;
	key: string;
	/** The number of the path when the job was asked for; a later number makes the job stale. */
	g: number;
	px: CopyPx;
	fit: CopyFit;
	part: CropFraction | undefined;
	keep: boolean;
	onDevice: DeviceTicket | null;
	wanted: () => boolean;
	finish: (r: CopyResult) => void;
}

/** D318: what names the copy on the device. The file's mtime and size are in `sig`, so a changed file never meets an old copy. */
function deviceIdOf(box: CopyBox, file: TFile, px: CopyPx, fit: CopyFit, part: CropFraction | undefined, dpr: number): CopyId | null {
	// A file with no mtime and size cannot tell a changed file from an old one: its copy is not kept.
	if (box?.onDevice !== true || !file.stat) return null;
	return { path: file.path, sig: sigOf(file), kind: fit === 'portrait' ? 'portrait' : 'arms', w: px.w, h: px.h, dpr, part: part ? formatPortraitCrop(part) : '' };
}

/** A second request for a copy that is being made waits for the same job. */
function join(job: Job, signal?: AbortSignal): Promise<Given> {
	return new Promise<Given>((resolve) => {
		const w: Waiter = { resolve, signal, gone: false };
		job.waiters.add(w);
		signal?.addEventListener(
			'abort',
			() => {
				if (w.gone) return;
				w.gone = true;
				job.waiters.delete(w);
				resolve(null);
			},
			{ once: true },
		);
	});
}

/** The part is in the key only for a portrait with a crop, so every other key stays as it was. */
const keyOf = (file: TFile, px: CopyPx, fit: CopyFit, crop?: CropFraction) =>
	`${file.path}\u0000${sigOf(file)}\u0000${px.w}x${px.h}\u0000${fit}${fit === 'portrait' && crop ? `\u0000${formatPortraitCrop(crop)}` : ''}`;

/** O1: web address, missing file or file extension; synchronous. */
function resolvePicture(app: App, link: string, sourcePath: string): ResolvedPicture {
	try {
		const t = pictureTarget(link);
		if (!t) return { ok: false, code: 'missing-picture', file: typeof link === 'string' ? link.trim() : '' };
		if (t.kind === 'web') return { ok: false, code: 'picture-web' };
		let file: TFile | null = null;
		try {
			file = app.metadataCache.getFirstLinkpathDest(t.path, sourcePath);
		} catch {
			file = null;
		}
		if (!file) return { ok: false, code: 'missing-picture', file: t.path };
		const v = pictureFormat(file.extension);
		if (v.kind === 'unsupported') return { ok: false, code: 'picture-not-image', file: file.name, format: v.name };
		if (v.kind === 'other') return { ok: false, code: 'picture-not-image', file: file.name };
		return { ok: true, file, format: v.format };
	} catch (e) {
		console.error('Crown and Kin: cannot find the picture', e);
		return { ok: false, code: 'missing-picture', file: String(link ?? '') };
	}
}

// ---------- The copies ----------

/** Makes the small copies: from the list, from the device, or in the queue; a second request for a copy under way joins its job. */
class PictureCopier {
	private readonly jobs = new Map<string, Job>();

	constructor(
		private readonly io: PictureIO,
		private readonly headers: PictureHeaders,
		private readonly pipeline: PicturePipeline,
		private readonly entries: PictureEntries,
		private readonly copies: PictureCopies,
		private readonly isClosed: () => boolean,
	) {}

	/** The copy's pixels: box CSS px × min(max(dpr, 1), 3). `noEnlarge` counts only for a transient copy: the key of a kept copy lacks it. */
	private copyPx(box: CopyBox, still = false): CopyPx {
		return copyPixels(still ? box : { ...box, noEnlarge: false }, this.io.dpr());
	}

	/** B15: a copy the list has now, with no decode and no holder. */
	peek(file: TFile, box: CopyBox): PictureCopy | null {
		try {
			const fit: CopyFit = box?.fit === 'portrait' ? 'portrait' : 'meet';
			return this.entries.peek(keyOf(file, this.copyPx(box), fit, box?.crop));
		} catch {
			return null;
		}
	}

	copy(file: TFile, box: CopyBox, signal: AbortSignal | undefined, keep: boolean): Promise<PictureCopy | PictureProblem | null> {
		try {
			if (this.isClosed() || signal?.aborted) return Promise.resolve(null);
			const fit: CopyFit = box?.fit === 'portrait' ? 'portrait' : 'meet';
			const px = this.copyPx(box, !keep);
			const part = fit === 'portrait' ? box?.crop : undefined;
			const key = keyOf(file, px, fit, part);
			if (keep) {
				const held = this.entries.held(key);
				if (held) return Promise.resolve(held);
			}
			const cached = this.headers.of(file);
			const known = cached ?? this.pipeline.sizeProblem(file);
			if (known && !known.ok) {
				if (!cached) this.headers.remember(file, known, true);
				return Promise.resolve(known);
			}
			const job = keep ? this.jobs.get(key) : undefined;
			const onDevice = deviceTicket(this.copies, keep, deviceIdOf(box, file, px, fit, part, this.io.dpr()));
			return job ? join(job, signal) : this.startCopy(file, px, fit, key, signal, keep, part, onDevice);
		} catch (e) {
			console.error('Crown and Kin: cannot make a copy of the picture', e);
			return Promise.resolve(notImage(file));
		}
	}

	private startCopy(file: TFile, px: CopyPx, fit: CopyFit, key: string, signal: AbortSignal | undefined, keep: boolean, part: CropFraction | undefined, onDevice: DeviceTicket | null): Promise<Given> {
		const job: Job = { waiters: new Set<Waiter>() };
		if (keep) this.jobs.set(key, job);
		const result = join(job, signal);
		const g = this.pipeline.gen(file.path);
		const wanted = () => !this.isClosed() && job.waiters.size > 0;
		const c: CopyJob = { file, key, g, px, fit, part, keep, onDevice, wanted, finish: (r) => this.finish(job, c, r) };
		const task: Task = {
			priority: keep ? PRIORITY_LIVE : PRIORITY_NOW,
			exclusive: false,
			unwanted: () => !wanted() || this.pipeline.gen(file.path) !== g,
			drop: () => c.finish(null),
			run: () => this.run(c),
		};
		// A copy kept on the device needs no job slot; any other answer goes on to the queue.
		void (onDevice
			? onDevice.start(
					() => wanted() && this.pipeline.gen(file.path) === g,
					(o) => this.pipeline.rememberOutline(outlineKey(file), o),
					(d) => c.finish(entryOf(file, key, d)),
					() => this.pipeline.enqueue(task),
				)
			: this.pipeline.enqueue(task));
		return result;
	}

	private async run(c: CopyJob): Promise<void> {
		const { file, g } = c;
		const d = await this.pipeline.decodeFile(file, g, c.wanted);
		if (d === null || isProblem(d)) {
			c.finish(d);
			return;
		}
		const outlining = c.keep && c.fit === 'meet' ? this.pipeline.startOutline(file, d.picture) : null;
		const out = await this.pipeline.encodeCopy(file, d, c.px, c.fit, false, c.part);
		await outlining;
		if (isProblem(out)) {
			c.finish(out);
			return;
		}
		if (!c.wanted() || this.pipeline.gen(file.path) !== g) {
			c.finish(null);
			return;
		}
		c.onDevice?.keep(out, this.pipeline.outlineAt(outlineKey(file)));
		c.finish(entryOf(file, c.key, out));
	}

	/** Ends a job: each waiting caller gets the new copy (held before the list can evict it), the problem, or null. */
	private finish(job: Job, c: CopyJob, result: CopyResult): void {
		const { file, key, g, keep } = c;
		let r = result;
		if (this.jobs.get(key) === job) this.jobs.delete(key);
		const ws = [...job.waiters];
		job.waiters.clear();
		const live = ws.filter((w) => !w.gone && !w.signal?.aborted);
		let entry: Entry | null = null;
		if (r && !isProblem(r)) {
			// B11: nobody waits any more, or the file changed: the copy is not kept.
			if (!live.length || this.pipeline.gen(file.path) !== g || this.isClosed()) {
				URL.revokeObjectURL(r.url);
				r = null;
			} else entry = r;
		}
		if (entry && keep) this.entries.add(entry);
		for (const w of ws) {
			w.gone = true;
			if (!live.includes(w)) w.resolve(null);
			// O4: each caller holds the new copy before the list can evict it.
			else if (entry) w.resolve(keep ? this.entries.hold(entry) : own(entry));
			else w.resolve(isProblem(r) ? r : null);
		}
		if (entry && keep) this.entries.evict();
	}
}

// ---------- The store ----------

/** Makes the plugin's picture store. `io` replaces the browser parts (unit checks). */
export function createPictureStore(app: App, io: PictureIO = defaultIO(app), copies: PictureCopies = NO_COPIES): PictureStore {
	let closed = false;
	const isClosed = () => closed;
	const headers = new PictureHeaders(app, isClosed);
	const pipeline = new PicturePipeline(io, headers, isClosed);
	const entries = new PictureEntries((fileKey) => pipeline.forgetOutline(fileKey));
	const maker = new PictureCopier(io, headers, pipeline, entries, copies, isClosed);
	const listeners = new Set<(paths: readonly string[]) => void>();
	return {
		resolve: (link, sourcePath) => resolvePicture(app, link, sourcePath),
		check(file) {
			try {
				return closed ? Promise.resolve(null) : pipeline.check(file);
			} catch (e) {
				console.error('Crown and Kin: cannot check the picture', e);
				return Promise.resolve(null);
			}
		},
		acquire: (file, box, signal) => maker.copy(file, box, signal, true),
		transient: (file, box, signal) => maker.copy(file, box, signal, false),
		peek: (file, box) => maker.peek(file, box),
		outlineOf: (file) => pipeline.outlineOf(file),
		pixels: (file) => pipeline.pixels(file),
		exportCopy: (file, box) => pipeline.exportCopy(file, box),
		alone: (fn) => pipeline.alone(fn),
		invalidate(path) {
			guarded('cannot forget the picture', () => {
				pipeline.bump(path);
				headers.forget(path);
				copies.forget(path);
				pipeline.forgetOutlinesOf(path);
				entries.invalidate(path);
			});
		},
		changed(paths) {
			for (const fn of [...listeners]) guarded('cannot show the changed pictures', () => fn(paths));
		},
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		clear() {
			closed = true;
			void copies.flush();
			pipeline.dropQueue();
			entries.clear();
			listeners.clear();
			headers.flush();
		},
		get stats(): PictureStats {
			return { bytes: entries.bytes, entries: entries.size, inUse: entries.inUse(), openBitmaps: pipeline.openBitmaps, maxOpenBitmaps: pipeline.maxOpenBitmaps };
		},
	};
}

/** True when the extension is one of a picture the plugin knows (shown or not): vault events for it refresh the pictures. */
export function isPictureExtension(ext: string): boolean {
	return pictureFormat(ext).kind !== 'other';
}

/** True when the plugin can show a file with this extension (the picker list, renames). */
export function isShownPictureExtension(ext: string): boolean {
	return pictureFormat(ext).kind === 'supported';
}
