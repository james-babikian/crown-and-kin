/*
 * The work line of the picture store (spec §13.6 to §13.8): the queue with its limits, and the steps of a job: read a file once, decode it,
 * draw and encode a small copy, read the outline of arms, and the three other jobs that wait in the same queue (the file check, the 64 × 64 pixels,
 * the saved picture's copy). Two decodes run at a time (one on a touch device); a saved picture runs alone. Each step has an 8 s limit, and every
 * full-size picture is closed as soon as its copy is drawn. `picture-store.ts` decides which copies to make; this file does the work.
 */

import type { TFile } from 'obsidian';
import { fitMeet, limitBox, type CopyPx, type PictureProblem } from '../core/pictures';
import { cropSquare, type CropFraction } from '../core/portrait-crop';
import { outlineGrid, traceOutline, type ArmsOutline } from '../layout/arms-outline';
import { isProblem, notImage, sigOf, type PictureHeaders } from './picture-headers';
import type { DecodedPicture, PictureIO } from './picture-io';

/** B12: each step of a job (read, decode, encode) has this limit, in ms. */
export const STEP_LIMIT_MS = 8000;
/** A6: a file larger than this on disk is too large without a read (64 MB when the pointer is coarse). */
export const NO_READ_BYTES = 256 * 1024 * 1024;
/** The same limit when the pointer is coarse (a phone). */
export const NO_READ_BYTES_COARSE = 64 * 1024 * 1024;
/** O7: the size of the copy that "Colours from the arms" reads. */
export const ARMS_PIXELS = 64;
/**
 * The queue's order (lower first; the same priority in the order of the requests). A copy that the
 * owner waits for in a window (the edit sheet, the picker, "Colours from the arms") and a saved
 * picture go before the live pictures of the trees, and those before the background file check.
 */
export const PRIORITY_NOW = 0;
/** The priority of the live pictures of the trees. */
export const PRIORITY_LIVE = 1;
/** The priority of the background file check. */
export const PRIORITY_CHECK = 2;
/**
 * D219: the outlines kept at most (about 2 KB each); the one least recently read leaves first. An outline also leaves with the last copy of its file,
 * so this cap is a safety net: it is above the number of small copies that the byte limit of the list can hold.
 */
const OUTLINE_KEPT = 2000;

/** How a copy fits its box: the whole picture, or the round upper-centre square. */
export type CopyFit = 'meet' | 'portrait';

/** The box of a copy for a saved picture, in picture px. */
export interface ExportBox {
	w: number;
	h: number;
	fit: CopyFit;
	crop?: CropFraction;
}

/** A job in the queue. */
export interface Task {
	/** `PRIORITY_NOW`, `PRIORITY_LIVE` or `PRIORITY_CHECK` (O2: the background check is last). */
	priority: number;
	/** O4, B13: a saved picture's copy runs alone. */
	exclusive: boolean;
	/** True when nobody waits for the result any more: the task is dropped before it starts. */
	unwanted(): boolean;
	run(): Promise<void>;
	/** The task was dropped before it started. */
	drop(): void;
}

/** A decoded picture with the call that closes it. */
export interface OpenPicture {
	picture: DecodedPicture;
	close: () => void;
}

/** The key of the outline of a file as it is now. */
export const outlineKey = (file: TFile) => `${file.path}\u0000${sigOf(file)}`;

class StepTimeout extends Error {}

/** `p`, or a `StepTimeout` after `ms`; a result that comes after the limit goes to `late` (to close it). */
export function limited<T>(p: Promise<T>, ms: number, late?: (v: T) => void): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let done = false;
		const timer = window.setTimeout(() => {
			if (done) return;
			done = true;
			reject(new StepTimeout());
		}, ms);
		p.then(
			(v) => {
				if (done) {
					try {
						late?.(v);
					} catch {
						// Only a clean-up.
					}
					return;
				}
				done = true;
				window.clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				if (done) return;
				done = true;
				window.clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});
}

/** Base64 of bytes, in pieces, so a large picture does not overflow the call stack. */
function base64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

const isTainted = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'SecurityError';

/** The queue and the steps of the picture store. The state is in the fields; `isClosed` tells that the plugin unloads. */
export class PicturePipeline {
	private readonly queue: Task[] = [];
	private running = 0;
	/** B13: an exclusive task holds the queue. */
	private solo = false;
	private open = 0;
	private maxOpen = 0;
	private readonly gens = new Map<string, number>();
	private readonly reads = new Map<string, Promise<ArrayBuffer>>();
	private readonly checks = new Map<string, Promise<PictureProblem | null>>();
	/** D219: the outline of each arms file as it is now (null = the picture shows nothing or can never be read), by path and signature. */
	private readonly outlines = new Map<string, ArmsOutline | null>();

	constructor(
		private readonly io: PictureIO,
		private readonly headers: PictureHeaders,
		private readonly isClosed: () => boolean,
	) {}

	// ---------- the numbers of the files ----------

	/** The number of the path: a job asked for before `bump` is stale after it. */
	gen(path: string): number {
		return this.gens.get(path) ?? 0;
	}

	/** O8, O9: raises the number of the path, so a decode asked for before returns null and keeps nothing. */
	bump(path: string): void {
		this.gens.set(path, this.gen(path) + 1);
	}

	/** Full-size pictures decoded now. */
	get openBitmaps(): number {
		return this.open;
	}

	/** The most full-size pictures that were decoded at one time. */
	get maxOpenBitmaps(): number {
		return this.maxOpen;
	}

	/** A6: a file this large is too large without a read. */
	sizeProblem(file: TFile): PictureProblem | null {
		const size = file.stat?.size ?? 0;
		return size > (this.io.coarse() ? NO_READ_BYTES_COARSE : NO_READ_BYTES) ? { ok: false, code: 'picture-too-large', file: file.name } : null;
	}

	// ---------- the queue ----------

	/** Puts a job in the queue: lower priority numbers first, the same priority in the order of the requests. */
	enqueue(t: Task): void {
		let i = this.queue.length;
		while (i > 0 && this.queue[i - 1].priority > t.priority) i--;
		this.queue.splice(i, 0, t);
		this.pump();
	}

	private pump(): void {
		while (this.queue.length && !this.solo) {
			const t = this.queue[0];
			if (t.unwanted()) {
				this.queue.shift();
				t.drop();
				continue;
			}
			if (t.exclusive) {
				// B13: a saved picture waits for the running decodes, then holds the queue alone.
				if (this.running > 0) return;
				this.solo = true;
			} else if (this.running >= (this.io.coarse() ? 1 : 2)) return;
			this.queue.shift();
			this.running++;
			const exclusive = t.exclusive;
			void t
				.run()
				.catch((e) => console.error('Crown and Kin: a picture job failed', e))
				.finally(() => {
					this.running--;
					if (exclusive) this.solo = false;
					this.pump();
				});
		}
	}

	/** Plugin unload: every job that has not started is dropped. */
	dropQueue(): void {
		for (const t of this.queue.splice(0)) t.drop();
	}

	// ---------- the steps of a job ----------

	/** B14: one read of a file at a time; a second reader waits for the first. */
	read(file: TFile): Promise<ArrayBuffer> {
		const key = `${file.path}\u0000${this.gen(file.path)}`;
		let p = this.reads.get(key);
		if (!p) {
			p = limited(this.io.read(file), STEP_LIMIT_MS);
			this.reads.set(key, p);
			const done = () => {
				if (this.reads.get(key) === p) this.reads.delete(key);
			};
			p.then(done, done);
		}
		return p;
	}

	private opened(d: DecodedPicture): () => void {
		this.open++;
		this.maxOpen = Math.max(this.maxOpen, this.open);
		let shut = false;
		return () => {
			if (shut) return;
			shut = true;
			this.open--;
			try {
				d.close();
			} catch {
				// Freed anyway.
			}
		};
	}

	/**
	 * A failed step: `picture-not-image`. Only a real decode fault (`fault`: the engine could not decode the bytes) is remembered for the
	 * file as it is; a read error (a file that a sync has not finished), a timeout or a canvas error is not, so the next draw tries again.
	 */
	failed(file: TFile, e: unknown, fault = false): PictureProblem {
		const p = notImage(file);
		if (fault) this.headers.remember(file, p, false);
		if (!(e instanceof StepTimeout)) console.warn('Crown and Kin: cannot read the picture', file.path, e);
		return p;
	}

	/** Decodes the file (header first, from the cache or the bytes), or gives its problem. */
	async decodeFile(file: TFile, g: number, stillWanted: () => boolean): Promise<OpenPicture | PictureProblem | null> {
		const known = this.headers.of(file);
		if (known && !known.ok) return known;
		if (!stillWanted() || this.gen(file.path) !== g) return null;
		let bytes: ArrayBuffer;
		try {
			bytes = await this.read(file);
		} catch (e) {
			return this.failed(file, e);
		}
		if (!stillWanted() || this.gen(file.path) !== g) return null;
		const verdict = known ?? this.headers.judge(file, bytes);
		if (!verdict.ok) return verdict;
		let picture: DecodedPicture;
		try {
			picture = await limited(this.io.decode(bytes, verdict.format), STEP_LIMIT_MS, (late) => {
				try {
					late.close();
				} catch {
					// Only a clean-up.
				}
			});
		} catch (e) {
			return this.failed(file, e, !(e instanceof StepTimeout));
		}
		const close = this.opened(picture);
		if (!stillWanted() || this.gen(file.path) !== g || !(picture.width > 0 && picture.height > 0)) {
			close();
			return stillWanted() && this.gen(file.path) === g ? notImage(file) : null;
		}
		return { picture, close };
	}

	/** Draws the copy of a decoded picture and encodes it; the full-size picture is freed right after the draw. */
	async encodeCopy(file: TFile, d: OpenPicture, px: CopyPx, fit: CopyFit, png: boolean, part?: CropFraction): Promise<{ blob: Blob; w: number; h: number } | PictureProblem> {
		const { picture } = d;
		let crop: { sx: number; sy: number; sw: number; sh: number };
		let out: { w: number; h: number };
		if (fit === 'portrait') {
			const c = cropSquare(part ?? null, picture.width, picture.height);
			crop = { sx: c.sx, sy: c.sy, sw: c.size, sh: c.size };
			out = { w: px.w, h: px.h };
		} else {
			const f = fitMeet(picture.width, picture.height, ...limitBox(picture, px, file.extension));
			crop = { sx: 0, sy: 0, sw: picture.width, sh: picture.height };
			out = { w: Math.max(1, Math.round(f.w)), h: Math.max(1, Math.round(f.h)) };
		}
		let p: Promise<Blob>;
		try {
			p = this.io.encode(picture.source, crop, out, fit === 'portrait', png);
		} catch (e) {
			d.close();
			return this.failed(file, e);
		}
		// The draw happened inside the call: the full-size picture goes now (spec §13.0 item 3).
		d.close();
		try {
			const blob = await limited(p, STEP_LIMIT_MS);
			return { blob, w: out.w, h: out.h };
		} catch (e) {
			return this.failed(file, e);
		}
	}

	// ---------- outlines (D219) ----------

	/** Keeps the outline of a file as it is now; the one least recently read leaves when there are too many. */
	rememberOutline(key: string, o: ArmsOutline | null): void {
		this.outlines.delete(key);
		this.outlines.set(key, o);
		while (this.outlines.size > OUTLINE_KEPT) this.outlines.delete(this.outlines.keys().next().value!);
	}

	/** The outline kept for the key, with no change of its place (undefined = not known). */
	outlineAt(key: string): ArmsOutline | null | undefined {
		return this.outlines.get(key);
	}

	/** The outline of the file, or null while it is not known; a read counts as use, so the outline of a picture on show is the last to leave. */
	outlineOf(file: TFile): ArmsOutline | null {
		const key = outlineKey(file);
		const o = this.outlines.get(key);
		if (o === undefined) return null;
		this.outlines.delete(key);
		this.outlines.set(key, o);
		return o;
	}

	/** Forgets the outline of one file as it is now. */
	forgetOutline(fileKey: string): void {
		this.outlines.delete(fileKey);
	}

	/** O8: forgets every outline of the path. */
	forgetOutlinesOf(path: string): void {
		for (const k of [...this.outlines.keys()]) if (k.startsWith(`${path}\u0000`)) this.outlines.delete(k);
	}

	/**
	 * Reads the shape of an arms picture while its full-size picture is still open (the same decode as the copy, so the outline costs one draw on a
	 * 128-pixel canvas and no second decode). Gives null when the outline is known already.
	 */
	startOutline(file: TFile, picture: DecodedPicture): Promise<void> | null {
		const key = outlineKey(file);
		if (this.outlines.has(key)) return null;
		const keepOutline = (o: ArmsOutline | null) => this.rememberOutline(key, o);
		const grid = outlineGrid(picture.width, picture.height);
		let pixels: Promise<Uint8ClampedArray>;
		try {
			// The draw happens inside the call, before the caller closes the picture.
			pixels = this.io.rgba(picture.source, grid.w, grid.h);
		} catch (e) {
			if (isTainted(e)) keepOutline(null);
			return null;
		}
		return limited(pixels, STEP_LIMIT_MS).then(
			(px) => {
				// A throw in the trace gives "no gap" and must never fail the copy job.
				let o: ArmsOutline | null;
				try {
					o = traceOutline(px, grid.w, grid.h);
				} catch {
					return;
				}
				keepOutline(o);
			},
			// Only a tainted canvas (an SVG with outside content) is a lasting "no outline". After a timeout or another error the entry stays absent, so the next copy tries again.
			(e) => {
				if (isTainted(e)) keepOutline(null);
			},
		);
	}

	// ---------- the other jobs of the queue ----------

	/** O1: the check of the file's first bytes, at the lowest priority; null = fine. A second ask for the same file gets the same promise. */
	check(file: TFile): Promise<PictureProblem | null> {
		const known = this.headers.of(file);
		if (known) return Promise.resolve(known.ok ? null : known);
		const big = this.sizeProblem(file);
		if (big) {
			this.headers.remember(file, big, true);
			return Promise.resolve(big);
		}
		const key = `${file.path}\u0000${sigOf(file)}\u0000${this.gen(file.path)}`;
		const pending = this.checks.get(key);
		if (pending) return pending;
		const g = this.gen(file.path);
		const p = new Promise<PictureProblem | null>((resolve) => {
			const run = async () => {
				try {
					// B14: a read already under way (for a copy) is shared.
					const bytes = await this.read(file);
					if (this.gen(file.path) !== g) return resolve(null);
					const r = this.headers.of(file) ?? this.headers.judge(file, bytes);
					resolve(r.ok ? null : r);
				} catch (e) {
					resolve(this.failed(file, e));
				}
			};
			if (this.reads.has(`${file.path}\u0000${g}`)) {
				void run();
				return;
			}
			// O2: the background check waits behind every copy.
			this.enqueue({ priority: PRIORITY_CHECK, exclusive: false, unwanted: () => this.isClosed(), drop: () => resolve(null), run });
		});
		this.checks.set(key, p);
		const done = () => {
			if (this.checks.get(key) === p) this.checks.delete(key);
		};
		p.then(done, done);
		return p;
	}

	/** The 64 × 64 pixels of the file for "Colours from the arms", or null. The user waits for it in the Houses window. */
	pixels(file: TFile): Promise<Uint8ClampedArray | null> {
		return new Promise<Uint8ClampedArray | null>((resolve) => {
			try {
				if (this.isClosed()) return resolve(null);
				const known = this.headers.of(file) ?? this.sizeProblem(file);
				if (known && !known.ok) return resolve(null);
				const g = this.gen(file.path);
				let settled = false;
				const give = (v: Uint8ClampedArray | null) => {
					if (settled) return;
					settled = true;
					resolve(v);
				};
				this.enqueue({
					priority: PRIORITY_NOW,
					exclusive: false,
					unwanted: () => this.isClosed(),
					drop: () => give(null),
					run: () => this.readPixels(file, g, give),
				});
			} catch {
				resolve(null);
			}
		});
	}

	private async readPixels(file: TFile, g: number, give: (v: Uint8ClampedArray | null) => void): Promise<void> {
		const d = await this.decodeFile(file, g, () => !this.isClosed());
		if (d === null || isProblem(d)) return give(null);
		let p: Promise<Uint8ClampedArray>;
		try {
			p = this.io.rgba(d.picture.source, ARMS_PIXELS, ARMS_PIXELS);
		} catch {
			d.close();
			return give(null);
		}
		d.close();
		try {
			give(await limited(p, STEP_LIMIT_MS));
		} catch {
			give(null);
		}
	}

	/** O4, P3: a PNG data URI of the file at `box`, made while the queue is held alone; the full-size picture is freed before it returns. */
	exportCopy(file: TFile, box: ExportBox): Promise<string | PictureProblem> {
		return new Promise<string | PictureProblem>((resolve) => {
			try {
				if (this.isClosed()) return resolve(notImage(file));
				const known = this.headers.of(file) ?? this.sizeProblem(file);
				if (known && !known.ok) return resolve(known);
				const g = this.gen(file.path);
				this.enqueue({
					priority: PRIORITY_NOW,
					exclusive: true,
					unwanted: () => this.isClosed(),
					drop: () => resolve(notImage(file)),
					run: async () => resolve(await this.exported(file, g, box)),
				});
			} catch (e) {
				console.error('Crown and Kin: cannot make the picture for the saved file', e);
				resolve(notImage(file));
			}
		});
	}

	private async exported(file: TFile, g: number, box: ExportBox): Promise<string | PictureProblem> {
		const d = await this.decodeFile(file, g, () => !this.isClosed());
		if (d === null) return notImage(file);
		if (isProblem(d)) return d;
		const px = { w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
		const outlining = box.fit === 'meet' ? this.startOutline(file, d.picture) : null;
		const out = await this.encodeCopy(file, d, px, box.fit === 'portrait' ? 'portrait' : 'meet', true, box.fit === 'portrait' ? box.crop : undefined);
		await outlining;
		if (isProblem(out)) return out;
		try {
			const bytes = new Uint8Array(await limited(out.blob.arrayBuffer(), STEP_LIMIT_MS));
			return `data:image/png;base64,${base64(bytes)}`;
		} catch (e) {
			return this.failed(file, e);
		}
	}

	/** B13: runs `fn` with the queue held alone: it starts after the running decodes end, and no decode starts before it ends. */
	alone<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const run = async () => {
				try {
					resolve(await fn());
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			};
			try {
				if (this.isClosed()) {
					// The plugin unloads: no decode runs any more, so `fn` is alone already.
					void run();
					return;
				}
				this.enqueue({ priority: PRIORITY_NOW, exclusive: true, unwanted: () => false, drop: () => void run(), run });
			} catch (e) {
				reject(e instanceof Error ? e : new Error(String(e)));
			}
		});
	}
}
