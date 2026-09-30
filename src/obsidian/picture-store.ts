/*
 * The plugin's picture store (spec §13.0 item 3, §13.6, §13.7, §13.8; M9 contract O1, O3, O4 and
 * B10–B15). One store serves every tree. It finds the file of an `arms` or `portrait` link, checks
 * the file's first bytes (format and size) before any decode, decodes pictures one or two at a time,
 * makes one small copy at the size it shows, closes the full-size picture at once and keeps only the
 * encoded copies, in a least-recently-used list of 24 MB, shown through blob URLs. It also makes the
 * copies for a saved picture (one full-size picture at a time) and the 64 × 64 pixels for "Colours
 * from the arms". Nothing here throws: a picture that fails gives a picture problem, or null.
 *
 * The queue serves first what the owner waits for in a window (the edit sheet, the picker, the
 * colours, a saved picture), then the live pictures of the trees, then the background file check.
 * `alone` runs the saved PNG's canvas step with no decode beside it.
 * The picture picker's row previews (M11) use this store too: a preview is a small copy through `acquire`,
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
 * checks can count what happens. `defaultIO` is the real one.
 */

import type { App, TFile } from 'obsidian';
import { fitMeet, judgeHeader, pictureFormat, pictureTarget, readPictureHeader, type PictureProblem, type SupportedFormat } from '../core/pictures';
import { cropSquare, formatPortraitCrop, type CropFraction } from '../core/portrait-crop';

// ---------- Types (M9 contract O1, O3, B15, C14) ----------

/** The box a copy is made for, in CSS px at scale 1 (O3); the caller multiplies it by the zoom step (B10). `portrait`: the round upper-centre square. */
export interface CopyBox {
	w: number;
	h: number;
	fit: 'meet' | 'portrait';
	/** Spec §13.13: the selected part, used only with `fit: 'portrait'`; absent = the automatic part. */
	crop?: CropFraction;
}

/** A small copy in use; `release` lets the store forget it (it acts once). */
export interface PictureCopy {
	url: string;
	w: number;
	h: number;
	release(): void;
}

/** A resolved picture link (O1): the file and the format its name says, or the problem. */
export type ResolvedPicture = { ok: true; file: TFile; format: SupportedFormat } | PictureProblem;

/** A decoded picture: its size after the EXIF rotation, what a canvas can draw, and how to free it. */
export interface DecodedPicture {
	width: number;
	height: number;
	source: CanvasImageSource;
	close(): void;
}

/**
 * The test seam of `createPictureStore` (O3, O4, C14): the vault read and the browser decode and
 * encode. `encode` and `rgba` must draw `source` before they return their promise, because the store
 * closes the full-size picture right after the call. `png` asks for PNG (a saved picture); otherwise
 * the IO may give WebP where the device can encode it.
 */
export interface PictureIO {
	read(file: TFile): Promise<ArrayBuffer>;
	decode(bytes: ArrayBuffer, format: SupportedFormat): Promise<DecodedPicture>;
	encode(source: CanvasImageSource, crop: { sx: number; sy: number; sw: number; sh: number }, out: { w: number; h: number }, round: boolean, png?: boolean): Promise<Blob>;
	/** The pixels of `source` fitted into `w` × `h` (transparent around it), RGBA. */
	rgba(source: CanvasImageSource, w: number, h: number): Promise<Uint8ClampedArray>;
	/** True on a touch-first device (`pointer: coarse`): one decode at a time. */
	coarse(): boolean;
	dpr(): number;
}

/** The numbers of the memory checks (spec §13.6–§13.8 acceptance). */
export interface PictureStats {
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

/** The plugin's picture store (O1, O3, O4, B11–B15). Never throws. */
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

// ---------- Limits ----------

/** O3: the encoded copies of all trees, in bytes (spec §13.0 item 3: 24 MB). */
export const STORE_BYTES = 24_000_000;
/** B12: each step of a job (read, decode, encode) has this limit, in ms. */
export const STEP_LIMIT_MS = 8000;
/** A6: a file larger than this on disk is too large without a read (64 MB when the pointer is coarse). */
export const NO_READ_BYTES = 256 * 1024 * 1024;
export const NO_READ_BYTES_COARSE = 64 * 1024 * 1024;
/** B14: the header results kept across sessions, in the plugin's local storage. */
export const HEADER_STORE_KEY = 'dynasty-tree-picture-headers';
export const HEADER_STORE_MAX = 2000;
/** O7: the size of the copy that "Colours from the arms" reads. */
export const ARMS_PIXELS = 64;
/**
 * The queue's order (lower first; the same priority in the order of the requests). A copy that the
 * owner waits for in a window (the edit sheet, the picker, "Colours from the arms") and a saved
 * picture go before the live pictures of the trees, and those before the background file check.
 */
const PRIORITY_NOW = 0;
const PRIORITY_LIVE = 1;
const PRIORITY_CHECK = 2;
/** An SVG is drawn on a canvas at most this large on its longest side before its copy is made. */
const SVG_RASTER_MAX = 2048;

// ---------- Small helpers ----------

type HeaderResult = { ok: true; format: SupportedFormat } | PictureProblem;

const sigOf = (f: TFile) => `${f.stat?.mtime ?? 0}:${f.stat?.size ?? 0}`;
const notImage = (f: TFile): PictureProblem => ({ ok: false, code: 'picture-not-image', file: f.name });
const isProblem = (x: unknown): x is PictureProblem => !!x && typeof x === 'object' && (x as { ok?: unknown }).ok === false;

class StepTimeout extends Error {}

/** `p`, or a `StepTimeout` after `ms`; a result that comes after the limit goes to `late` (to close it). */
function limited<T>(p: Promise<T>, ms: number, late?: (v: T) => void): Promise<T> {
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

// ---------- The real browser IO ----------

const MIME: Record<SupportedFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

/** An iPhone frees canvas memory only when the canvas is made empty (B13, M9 iPhone check). */
function emptyCanvas(c: HTMLCanvasElement): void {
	c.width = 0;
	c.height = 0;
}

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const c = createEl('canvas');
	c.width = Math.max(1, Math.round(w));
	c.height = Math.max(1, Math.round(h));
	const ctx = c.getContext('2d');
	if (!ctx) {
		emptyCanvas(c);
		throw new Error('no canvas');
	}
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	return { c, ctx };
}

function blobOf(c: HTMLCanvasElement, type: string): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		try {
			c.toBlob((b) => (b ? resolve(b) : reject(new Error('the canvas gave no picture'))), type);
		} catch (e) {
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

/** The drawn size of a canvas source. */
function sourceSize(s: CanvasImageSource): { w: number; h: number } {
	const x = s as { naturalWidth?: number; naturalHeight?: number; width?: unknown; height?: unknown };
	const side = (natural: number | undefined, plain: unknown) => (typeof natural === 'number' && natural > 0 ? natural : typeof plain === 'number' ? plain : 0);
	return { w: side(x.naturalWidth, x.width), h: side(x.naturalHeight, x.height) };
}

/** Loads an `Image` from a URL, within the step limit. */
function loadImage(url: string): Promise<HTMLImageElement> {
	const img = new Image();
	const p = new Promise<HTMLImageElement>((resolve, reject) => {
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('the picture did not load'));
	});
	img.src = url;
	return p;
}

/**
 * The browser IO: `vault.readBinary`, `createImageBitmap` (it applies the EXIF rotation, proven on
 * the owner's iPhone), an `Image` from a blob URL for SVG, and a canvas for each copy. WebP copies
 * only where the device encodes WebP (tested once, at the start; the owner's iPhone does not).
 */
export function defaultIO(app: App): PictureIO {
	let webp = false;
	let probed = false;
	// Once, at the first copy; until its answer, copies are PNG.
	const probe = () => {
		if (probed) return;
		probed = true;
		try {
			const { c } = canvasOf(2, 2);
			void blobOf(c, 'image/webp')
				.then((b) => (webp = b.type === 'image/webp'))
				.catch(() => undefined)
				.finally(() => emptyCanvas(c));
		} catch {
			// No canvas: every copy fails later with its own problem.
		}
	};
	return {
		read: (file) => app.vault.readBinary(file),
		async decode(bytes, format) {
			if (format !== 'svg') {
				const bmp = await createImageBitmap(new Blob([bytes], { type: MIME[format] }));
				return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close() };
			}
			// An SVG is drawn once on a canvas of a known size, so the crop and the fit work in its pixels.
			const url = URL.createObjectURL(new Blob([bytes], { type: MIME.svg }));
			let img: HTMLImageElement;
			try {
				img = await loadImage(url);
			} catch (e) {
				URL.revokeObjectURL(url);
				throw e;
			}
			try {
				const head = readPictureHeader(new Uint8Array(bytes));
				const nat = sourceSize(img);
				let w = head.width ?? nat.w;
				let h = head.height ?? nat.h;
				if (!(w > 0 && h > 0)) {
					w = 512;
					h = 512;
				}
				const k = Math.min(1, SVG_RASTER_MAX / Math.max(w, h));
				const { c, ctx } = canvasOf(w * k, h * k);
				try {
					ctx.drawImage(img, 0, 0, c.width, c.height);
				} catch (e) {
					emptyCanvas(c);
					throw e;
				}
				return { width: c.width, height: c.height, source: c, close: () => emptyCanvas(c) };
			} finally {
				URL.revokeObjectURL(url);
				img.src = '';
			}
		},
		encode(source, crop, out, round, png) {
			probe();
			let c: HTMLCanvasElement;
			try {
				const made = canvasOf(out.w, out.h);
				c = made.c;
				const ctx = made.ctx;
				if (round) {
					ctx.beginPath();
					ctx.arc(c.width / 2, c.height / 2, Math.min(c.width, c.height) / 2, 0, Math.PI * 2);
					ctx.closePath();
					ctx.clip();
				}
				ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
			} catch (e) {
				return Promise.reject(e instanceof Error ? e : new Error(String(e)));
			}
			const canvas = c;
			return blobOf(canvas, !png && webp ? 'image/webp' : 'image/png').finally(() => emptyCanvas(canvas));
		},
		rgba(source, w, h) {
			try {
				const { c, ctx } = canvasOf(w, h);
				try {
					const s = sourceSize(source);
					const f = fitMeet(s.w, s.h, w, h);
					ctx.drawImage(source, f.x, f.y, f.w, f.h);
					// An SVG with outside content can taint the canvas: then this throws and the colours are unknown.
					return Promise.resolve(ctx.getImageData(0, 0, w, h).data);
				} finally {
					emptyCanvas(c);
				}
			} catch (e) {
				return Promise.reject(e instanceof Error ? e : new Error(String(e)));
			}
		},
		coarse: () => {
			try {
				return window.matchMedia('(pointer: coarse)').matches;
			} catch {
				return false;
			}
		},
		dpr: () => {
			try {
				return typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
			} catch {
				return 1;
			}
		},
	};
}

// ---------- The store ----------

interface Entry {
	key: string;
	path: string;
	url: string;
	bytes: number;
	w: number;
	h: number;
	refs: number;
	/** The file changed while the copy was in use: it leaves at its last release. */
	stale: boolean;
}

interface Task {
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

/** What a job makes: a new copy, or the problem of the file, or null (aborted, the file changed). */
type CopyResult = Entry | PictureProblem | null;
/** What a caller gets: the copy already held for it (O4: before any eviction can see it). */
type Given = PictureCopy | PictureProblem | null;

interface Waiter {
	resolve(v: Given): void;
	signal?: AbortSignal;
	gone: boolean;
}

/** Makes the plugin's picture store. `io` replaces the browser parts (unit checks). */
export function createPictureStore(app: App, io: PictureIO = defaultIO(app)): PictureStore {
	const lru = new Map<string, Entry>();
	/** Copies whose file changed while they were in use (B11). */
	const staleInUse = new Set<Entry>();
	const headers = new Map<string, { sig: string; result: HeaderResult }>();
	const gens = new Map<string, number>();
	const reads = new Map<string, Promise<ArrayBuffer>>();
	const checks = new Map<string, Promise<PictureProblem | null>>();
	const jobs = new Map<string, { waiters: Set<Waiter> }>();
	const listeners = new Set<(paths: readonly string[]) => void>();
	const queue: Task[] = [];
	let running = 0;
	/** B13: an exclusive task holds the queue. */
	let solo = false;
	let total = 0;
	let open = 0;
	let maxOpen = 0;
	let closed = false;
	let saved: Map<string, { sig: string; result: HeaderResult }> | null = null;
	let saveTimer: number | null = null;

	const gen = (path: string) => gens.get(path) ?? 0;

	// ---------- the header results kept across sessions (B14) ----------

	function savedHeaders(): Map<string, { sig: string; result: HeaderResult }> {
		if (saved) return saved;
		saved = new Map();
		try {
			const load = (app as { loadLocalStorage?: (k: string) => unknown }).loadLocalStorage;
			const raw = typeof load === 'function' ? load.call(app, HEADER_STORE_KEY) : null;
			const list = raw && typeof raw === 'object' && Array.isArray((raw as { e?: unknown }).e) ? (raw as { e: unknown[] }).e : [];
			for (const x of list) {
				if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'string' || !x[2] || typeof x[2] !== 'object') continue;
				saved.set(x[0], { sig: x[1], result: x[2] as HeaderResult });
			}
		} catch {
			// A damaged entry: the store checks the files again.
		}
		return saved;
	}

	function storeHeaders(): void {
		saveTimer = null;
		try {
			const put = (app as { saveLocalStorage?: (k: string, v: unknown) => void }).saveLocalStorage;
			if (typeof put !== 'function' || !saved) return;
			put.call(app, HEADER_STORE_KEY, { v: 1, e: [...saved].map(([p, x]) => [p, x.sig, x.result]) });
		} catch (e) {
			console.error('Dynasty Tree: cannot keep the picture checks', e);
		}
	}

	function remember(file: TFile, result: HeaderResult, keep: boolean): void {
		const sig = sigOf(file);
		headers.set(file.path, { sig, result });
		if (!keep) return;
		const s = savedHeaders();
		s.delete(file.path);
		s.set(file.path, { sig, result });
		// The oldest entries go first (a Map keeps its order of insertion).
		while (s.size > HEADER_STORE_MAX) s.delete(s.keys().next().value!);
		if (saveTimer === null && !closed) saveTimer = window.setTimeout(storeHeaders, 1000);
	}

	/** The header result of the file as it is now (memory first, then the kept results), or null. */
	function headerOf(file: TFile): HeaderResult | null {
		const sig = sigOf(file);
		const m = headers.get(file.path);
		if (m && m.sig === sig) return m.result;
		const s = savedHeaders().get(file.path);
		if (s && s.sig === sig) {
			headers.set(file.path, s);
			return s.result;
		}
		return null;
	}

	/** A6: a file this large is too large without a read. */
	function sizeProblem(file: TFile): PictureProblem | null {
		const size = file.stat?.size ?? 0;
		return size > (io.coarse() ? NO_READ_BYTES_COARSE : NO_READ_BYTES) ? { ok: false, code: 'picture-too-large', file: file.name } : null;
	}

	/** B14: one read of a file at a time; a second reader waits for the first. */
	function read(file: TFile): Promise<ArrayBuffer> {
		const key = `${file.path}\u0000${gen(file.path)}`;
		let p = reads.get(key);
		if (!p) {
			p = limited(io.read(file), STEP_LIMIT_MS);
			reads.set(key, p);
			const done = () => {
				if (reads.get(key) === p) reads.delete(key);
			};
			p.then(done, done);
		}
		return p;
	}

	/** The header verdict from bytes, remembered for the next check (B14). */
	function judge(file: TFile, bytes: ArrayBuffer): HeaderResult {
		const result = judgeHeader(readPictureHeader(new Uint8Array(bytes)), file.name);
		remember(file, result, true);
		return result;
	}

	// ---------- the queue (O4) ----------

	function enqueue(t: Task): void {
		// Lower priority numbers first; the same priority in the order of the requests.
		let i = queue.length;
		while (i > 0 && queue[i - 1].priority > t.priority) i--;
		queue.splice(i, 0, t);
		pump();
	}

	function pump(): void {
		while (queue.length && !solo) {
			const t = queue[0];
			if (t.unwanted()) {
				queue.shift();
				t.drop();
				continue;
			}
			if (t.exclusive) {
				// B13: a saved picture waits for the running decodes, then holds the queue alone.
				if (running > 0) return;
				solo = true;
			} else if (running >= (io.coarse() ? 1 : 2)) return;
			queue.shift();
			running++;
			const exclusive = t.exclusive;
			void t
				.run()
				.catch((e) => console.error('Dynasty Tree: a picture job failed', e))
				.finally(() => {
					running--;
					if (exclusive) solo = false;
					pump();
				});
		}
	}

	function opened(d: DecodedPicture): () => void {
		open++;
		maxOpen = Math.max(maxOpen, open);
		let shut = false;
		return () => {
			if (shut) return;
			shut = true;
			open--;
			try {
				d.close();
			} catch {
				// Freed anyway.
			}
		};
	}

	/** Decodes the file (header first, from the cache or the bytes), or gives its problem. */
	async function decodeFile(file: TFile, g: number, stillWanted: () => boolean): Promise<{ picture: DecodedPicture; close: () => void } | PictureProblem | null> {
		const known = headerOf(file);
		if (known && !known.ok) return known;
		if (!stillWanted() || gen(file.path) !== g) return null;
		let bytes: ArrayBuffer;
		try {
			bytes = await read(file);
		} catch (e) {
			return failed(file, e);
		}
		if (!stillWanted() || gen(file.path) !== g) return null;
		const verdict = known ?? judge(file, bytes);
		if (!verdict.ok) return verdict;
		let picture: DecodedPicture;
		try {
			picture = await limited(io.decode(bytes, verdict.format), STEP_LIMIT_MS, (late) => {
				try {
					late.close();
				} catch {
					// Only a clean-up.
				}
			});
		} catch (e) {
			return failed(file, e);
		}
		const close = opened(picture);
		if (!stillWanted() || gen(file.path) !== g || !(picture.width > 0 && picture.height > 0)) {
			close();
			return stillWanted() && gen(file.path) === g ? notImage(file) : null;
		}
		return { picture, close };
	}

	/** A failed step: `picture-not-image`; a timeout is not kept across sessions (B12). */
	function failed(file: TFile, e: unknown): PictureProblem {
		const p = notImage(file);
		remember(file, p, false);
		if (!(e instanceof StepTimeout)) console.warn('Dynasty Tree: cannot read the picture', file.path, e);
		return p;
	}

	/** The copy's pixels (O3, B10): box CSS px × min(max(dpr, 1), 3). */
	function copyPx(box: CopyBox): { w: number; h: number } {
		const d = io.dpr();
		const k = Math.min(Math.max(Number.isFinite(d) ? d : 1, 1), 3);
		const size = (v: number) => Math.max(1, Math.round((Number.isFinite(v) && v > 0 ? v : 1) * k));
		return { w: size(box.w), h: size(box.h) };
	}

	/** The part is in the key only for a portrait with a crop, so every other key stays as it was. */
	const keyOf = (file: TFile, px: { w: number; h: number }, fit: CopyBox['fit'], crop?: CropFraction) =>
		`${file.path}\u0000${sigOf(file)}\u0000${px.w}x${px.h}\u0000${fit}${fit === 'portrait' && crop ? `\u0000${formatPortraitCrop(crop)}` : ''}`;

	/** Draws the copy of a decoded picture and encodes it; the full-size picture is freed right after the draw. */
	async function encodeCopy(file: TFile, d: { picture: DecodedPicture; close: () => void }, px: { w: number; h: number }, fit: CopyBox['fit'], png: boolean, part?: CropFraction): Promise<{ blob: Blob; w: number; h: number } | PictureProblem> {
		const { picture } = d;
		let crop: { sx: number; sy: number; sw: number; sh: number };
		let out: { w: number; h: number };
		if (fit === 'portrait') {
			const c = cropSquare(part ?? null, picture.width, picture.height);
			crop = { sx: c.sx, sy: c.sy, sw: c.size, sh: c.size };
			out = px;
		} else {
			const f = fitMeet(picture.width, picture.height, px.w, px.h);
			crop = { sx: 0, sy: 0, sw: picture.width, sh: picture.height };
			out = { w: Math.max(1, Math.round(f.w)), h: Math.max(1, Math.round(f.h)) };
		}
		let p: Promise<Blob>;
		try {
			p = io.encode(picture.source, crop, out, fit === 'portrait', png);
		} catch (e) {
			d.close();
			return failed(file, e);
		}
		// The draw happened inside the call: the full-size picture goes now (spec §13.0 item 3).
		d.close();
		try {
			const blob = await limited(p, STEP_LIMIT_MS);
			return { blob, w: out.w, h: out.h };
		} catch (e) {
			return failed(file, e);
		}
	}

	// ---------- copies (O3) ----------

	function hold(e: Entry): PictureCopy {
		e.refs++;
		let done = false;
		return {
			url: e.url,
			w: e.w,
			h: e.h,
			release() {
				if (done) return;
				done = true;
				e.refs = Math.max(0, e.refs - 1);
				if (e.refs > 0) return;
				if (e.stale) drop(e);
				else evict();
			},
		};
	}

	function drop(e: Entry): void {
		if (lru.get(e.key) === e) lru.delete(e.key);
		staleInUse.delete(e);
		// `bytes` goes to 0, so a second drop of the same copy counts nothing.
		total -= e.bytes;
		e.bytes = 0;
		try {
			URL.revokeObjectURL(e.url);
		} catch {
			// Nothing to free.
		}
	}

	/** O3: the least recently used copies leave until the list fits; a copy in use never leaves. */
	function evict(): void {
		if (total <= STORE_BYTES) return;
		for (const e of [...lru.values()]) {
			if (total <= STORE_BYTES) break;
			if (e.refs === 0) drop(e);
		}
	}

	function touch(e: Entry): void {
		lru.delete(e.key);
		lru.set(e.key, e);
	}

	function copy(file: TFile, box: CopyBox, signal: AbortSignal | undefined, keep: boolean): Promise<PictureCopy | PictureProblem | null> {
		try {
			if (closed || signal?.aborted) return Promise.resolve(null);
			const fit: CopyBox['fit'] = box?.fit === 'portrait' ? 'portrait' : 'meet';
			const px = copyPx(box);
			const part = fit === 'portrait' ? box?.crop : undefined;
				const key = keyOf(file, px, fit, part);
			if (keep) {
				const e = lru.get(key);
				if (e) {
					touch(e);
					return Promise.resolve(hold(e));
				}
			}
			const cached = headerOf(file);
			const known = cached ?? sizeProblem(file);
			if (known && !known.ok) {
				if (!cached) remember(file, known, true);
				return Promise.resolve(known);
			}
			const job = keep ? jobs.get(key) : undefined;
			return job ? join(job, signal) : startCopy(file, px, fit, key, signal, keep, part);
		} catch (e) {
			console.error('Dynasty Tree: cannot make a copy of the picture', e);
			return Promise.resolve(notImage(file));
		}
	}

	/** A second request for a copy that is being made waits for the same job. */
	function join(job: { waiters: Set<Waiter> }, signal?: AbortSignal): Promise<Given> {
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

	/** A transient copy belongs to its one caller: its release revokes the URL. */
	function own(e: Entry): PictureCopy {
		let done = false;
		return {
			url: e.url,
			w: e.w,
			h: e.h,
			release() {
				if (done) return;
				done = true;
				URL.revokeObjectURL(e.url);
			},
		};
	}

	function startCopy(file: TFile, px: { w: number; h: number }, fit: CopyBox['fit'], key: string, signal: AbortSignal | undefined, keep: boolean, part?: CropFraction): Promise<Given> {
		const job = { waiters: new Set<Waiter>() };
		if (keep) jobs.set(key, job);
		const result = join(job, signal);
		const g = gen(file.path);
		const wanted = () => !closed && job.waiters.size > 0;
		const finish = (r: CopyResult) => {
			if (jobs.get(key) === job) jobs.delete(key);
			const ws = [...job.waiters];
			job.waiters.clear();
			const live = ws.filter((w) => !w.gone && !w.signal?.aborted);
			let entry: Entry | null = null;
			if (r && !isProblem(r)) {
				// B11: nobody waits any more, or the file changed: the copy is not kept.
				if (!live.length || gen(file.path) !== g || closed) {
					URL.revokeObjectURL(r.url);
					r = null;
				} else entry = r;
			}
			if (entry && keep) {
				lru.set(entry.key, entry);
				total += entry.bytes;
			}
			for (const w of ws) {
				w.gone = true;
				if (!live.includes(w)) w.resolve(null);
				// O4: each caller holds the new copy before the list can evict it.
				else if (entry) w.resolve(keep ? hold(entry) : own(entry));
				else w.resolve(isProblem(r) ? r : null);
			}
			if (entry && keep) evict();
		};
		enqueue({
			priority: keep ? PRIORITY_LIVE : PRIORITY_NOW,
			exclusive: false,
			unwanted: () => !wanted() || gen(file.path) !== g,
			drop: () => finish(null),
			run: async () => {
				const d = await decodeFile(file, g, wanted);
				if (d === null || isProblem(d)) {
					finish(d);
					return;
				}
				const out = await encodeCopy(file, d, px, fit, false, part);
				if (isProblem(out)) {
					finish(out);
					return;
				}
				if (!wanted() || gen(file.path) !== g) {
					finish(null);
					return;
				}
				finish({ key, path: file.path, url: URL.createObjectURL(out.blob), bytes: out.blob.size, w: out.w, h: out.h, refs: 0, stale: false });
			},
		});
		return result;
	}

	// ---------- the store ----------

	const store: PictureStore = {
		resolve(link, sourcePath) {
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
				console.error('Dynasty Tree: cannot find the picture', e);
				return { ok: false, code: 'missing-picture', file: String(link ?? '') };
			}
		},

		check(file) {
			try {
				if (closed) return Promise.resolve(null);
				const known = headerOf(file);
				if (known) return Promise.resolve(known.ok ? null : known);
				const big = sizeProblem(file);
				if (big) {
					remember(file, big, true);
					return Promise.resolve(big);
				}
				const key = `${file.path}\u0000${sigOf(file)}\u0000${gen(file.path)}`;
				const pending = checks.get(key);
				if (pending) return pending;
				const g = gen(file.path);
				const p = new Promise<PictureProblem | null>((resolve) => {
					const run = async () => {
						try {
							// B14: a read already under way (for a copy) is shared.
							const bytes = await read(file);
							if (gen(file.path) !== g) return resolve(null);
							const r = headerOf(file) ?? judge(file, bytes);
							resolve(r.ok ? null : r);
						} catch (e) {
							resolve(failed(file, e));
						}
					};
					if (reads.has(`${file.path}\u0000${g}`)) {
						void run();
						return;
					}
					// O2: the background check waits behind every copy.
					enqueue({ priority: PRIORITY_CHECK, exclusive: false, unwanted: () => closed, drop: () => resolve(null), run });
				});
				checks.set(key, p);
				const done = () => {
					if (checks.get(key) === p) checks.delete(key);
				};
				p.then(done, done);
				return p;
			} catch (e) {
				console.error('Dynasty Tree: cannot check the picture', e);
				return Promise.resolve(null);
			}
		},

		acquire: (file, box, signal) => copy(file, box, signal, true),
		transient: (file, box, signal) => copy(file, box, signal, false),

		peek(file, box) {
			try {
				const fit: CopyBox['fit'] = box?.fit === 'portrait' ? 'portrait' : 'meet';
				const e = lru.get(keyOf(file, copyPx(box), fit, box?.crop));
				if (!e) return null;
				touch(e);
				return { url: e.url, w: e.w, h: e.h, release() {} };
			} catch {
				return null;
			}
		},

		pixels(file) {
			return new Promise<Uint8ClampedArray | null>((resolve) => {
				try {
					if (closed) return resolve(null);
					const known = headerOf(file) ?? sizeProblem(file);
					if (known && !known.ok) return resolve(null);
					const g = gen(file.path);
					let settled = false;
					const give = (v: Uint8ClampedArray | null) => {
						if (settled) return;
						settled = true;
						resolve(v);
					};
					// The owner waits for "Colours from the arms" in the Houses window.
					enqueue({
						priority: PRIORITY_NOW,
						exclusive: false,
						unwanted: () => closed,
						drop: () => give(null),
						run: async () => {
							const d = await decodeFile(file, g, () => !closed);
							if (d === null || isProblem(d)) return give(null);
							let p: Promise<Uint8ClampedArray>;
							try {
								p = io.rgba(d.picture.source, ARMS_PIXELS, ARMS_PIXELS);
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
						},
					});
				} catch {
					resolve(null);
				}
			});
		},

		exportCopy(file, box) {
			return new Promise<string | PictureProblem>((resolve) => {
				try {
					if (closed) return resolve(notImage(file));
					const known = headerOf(file) ?? sizeProblem(file);
					if (known && !known.ok) return resolve(known);
					const g = gen(file.path);
					enqueue({
						priority: PRIORITY_NOW,
						exclusive: true,
						unwanted: () => closed,
						drop: () => resolve(notImage(file)),
						run: async () => {
							const d = await decodeFile(file, g, () => !closed);
							if (d === null) return resolve(notImage(file));
							if (isProblem(d)) return resolve(d);
							const px = { w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
							const out = await encodeCopy(file, d, px, box.fit === 'portrait' ? 'portrait' : 'meet', true, box.fit === 'portrait' ? box.crop : undefined);
							if (isProblem(out)) return resolve(out);
							try {
								const bytes = new Uint8Array(await limited(out.blob.arrayBuffer(), STEP_LIMIT_MS));
								resolve(`data:image/png;base64,${base64(bytes)}`);
							} catch (e) {
								resolve(failed(file, e));
							}
						},
					});
				} catch (e) {
					console.error('Dynasty Tree: cannot make the picture for the saved file', e);
					resolve(notImage(file));
				}
			});
		},

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
					if (closed) {
						// The plugin unloads: no decode runs any more, so `fn` is alone already.
						void run();
						return;
					}
					enqueue({ priority: PRIORITY_NOW, exclusive: true, unwanted: () => false, drop: () => void run(), run });
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			});
		},

		invalidate(path) {
			try {
				gens.set(path, gen(path) + 1);
				headers.delete(path);
				for (const e of [...lru.values()]) {
					if (e.path !== path) continue;
					if (e.refs === 0) drop(e);
					else {
						// B15: the view fetches the new copy before it lets the old one go.
						lru.delete(e.key);
						e.stale = true;
						staleInUse.add(e);
					}
				}
			} catch (e) {
				console.error('Dynasty Tree: cannot forget the picture', e);
			}
		},

		changed(paths) {
			for (const fn of [...listeners]) {
				try {
					fn(paths);
				} catch (e) {
					console.error('Dynasty Tree: cannot show the changed pictures', e);
				}
			}
		},

		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		clear() {
			closed = true;
			for (const t of queue.splice(0)) t.drop();
			for (const e of [...lru.values(), ...staleInUse]) drop(e);
			lru.clear();
			staleInUse.clear();
			listeners.clear();
			if (saveTimer !== null) {
				window.clearTimeout(saveTimer);
				storeHeaders();
			}
		},

		get stats(): PictureStats {
			let inUse = 0;
			for (const e of lru.values()) if (e.refs > 0) inUse++;
			for (const e of staleInUse) if (e.refs > 0) inUse++;
			return { bytes: total, entries: lru.size, inUse, openBitmaps: open, maxOpenBitmaps: maxOpen };
		},
	};
	return store;
}

/** True when the extension is one of a picture the plugin knows (shown or not): vault events for it refresh the pictures (O9). */
export function isPictureExtension(ext: string): boolean {
	return pictureFormat(ext).kind !== 'other';
}

/** True when the plugin can show a file with this extension (the picker list, renames; O6, O8). */
export function isShownPictureExtension(ext: string): boolean {
	return pictureFormat(ext).kind === 'supported';
}
