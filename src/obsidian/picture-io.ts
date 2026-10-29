/*
 * The real browser side of the picture store: the vault read, the decode and the encode of a copy
 * (the part of `PictureIO` that needs a browser). It sits in its own file so that `picture-store.ts`
 * holds only the queue and the list of copies, and the unit checks replace this file with a fake.
 */

import type { App, TFile } from 'obsidian';
import { fitMeet, readPictureHeader, type SupportedFormat } from '../core/pictures';

/** A decoded picture: its size after the EXIF rotation, what a canvas can draw, and how to free it. */
export interface DecodedPicture {
	width: number;
	height: number;
	source: CanvasImageSource;
	close(): void;
}

/**
 * The test seam of `createPictureStore`: the vault read and the browser decode and
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

/** An SVG is drawn on a canvas at most this large on its longest side before its copy is made. */
const SVG_RASTER_MAX = 2048;

const MIME: Record<SupportedFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

/** An iPhone frees canvas memory only when the canvas is made empty. */
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

/** Loads an `Image` from a URL with no time limit of its own (`save-picture.ts` has a loader with a limit, so the two keep different names). */
function loadImageUnlimited(url: string): Promise<HTMLImageElement> {
	const img = new Image();
	const p = new Promise<HTMLImageElement>((resolve, reject) => {
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('the picture did not load'));
	});
	img.src = url;
	return p;
}

/** A link for a picture copy, or null when the device cannot make one. */
export function linkOf(blob: Blob): string | null {
	try {
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}

/**
 * The browser IO: `vault.readBinary`, `createImageBitmap` (it applies the EXIF rotation, checked on
 * an iPhone), an `Image` from a blob URL for SVG, and a canvas for each copy. WebP copies
 * only where the device encodes WebP (tested once, at the start; some iPhones do not).
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
				img = await loadImageUnlimited(url);
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
