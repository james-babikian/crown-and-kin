/*
 * The pure picture helpers of coats of arms and portraits (spec §13.0 item 3, §13.6, §13.7): what a
 * written `arms` or `portrait` link points to, which file formats the plugin can show, the format
 * and size read from a file's first bytes, the 40 million pixel rule, the portrait crop, the arms
 * fit, and the four picture warnings. Nothing here reads the vault or decodes a picture: the
 * Obsidian side (`picture-store.ts`) does that and asks these functions what to do. The rule
 * numbers in the comments are those of the M9 core contract (rules 4–9 and 12, amendments A1, A2,
 * A4, A6), which was folded into this file and its neighbours when M9 ended.
 *
 * Rules the code here does not show:
 * - The bytes decide in the end: a JPEG named .png shows; a HEIC named .jpg is not a picture.
 * - `validate.ts` never gives the four picture warnings. The tree view finds them (a link is
 *   resolved at render, the file's first bytes are checked later in the background) and builds
 *   each with `pictureIssue`, so their texts agree everywhere. They are always warnings, so the tree
 *   still draws, and they follow the core issues: houses first, then people, each in list order.
 */

import { parsePictureLink } from './link-rewrite';
import { codedIssue, type CodedIssue, type IssueParams } from './messages';
import type { House, Person } from './types';

// ---------- Links (rules 4, 5) ----------

/** A picture link read from `arms` or `portrait`: a web address, or a path in the vault. */
export type PictureTarget =
	| { kind: 'web' }
	| {
			kind: 'vault';
			/** The link path to give `metadataCache.getFirstLinkpathDest`, for example "Pictures/x.png". */
			path: string;
			/** Lower-case extension of the last path segment; '' when there is none. */
			ext: string;
	  };

/** Rule 5: a scheme of two or more letters and ":", "//" or "www." at the start. One letter is a drive ("C:/"). */
const WEB = /^(?:[a-z]{2,}:|\/\/|www\.)/i;

/**
 * Reads a written `arms` or `portrait` value (rule 4): `[[p]]`, `[[p|text]]`, `[[p#sub]]`,
 * `[text](p)`, `[text](<p>)` or a bare `p`, each with an optional "!". Null when it names nothing.
 * It uses `parsePictureLink`, the parser of the link rewrite, so a rename and the picture agree.
 */
export function pictureTarget(value: string | undefined): PictureTarget | null {
	try {
		if (typeof value !== 'string' || value.trim() === '') return null;
		const parts = parsePictureLink(value);
		if (!parts) return null;
		// A text that is no link form is judged on its whole text after a leading "!" (rule 5).
		if (WEB.test(parts.kind === 'bare' ? value.slice(parts.head.length).trim() : parts.target)) return { kind: 'web' };
		const path = parts.target;
		const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
		const dot = name.lastIndexOf('.');
		return { kind: 'vault', path, ext: dot < 0 ? '' : name.slice(dot + 1).toLowerCase() };
	} catch {
		return null;
	}
}

// ---------- Formats (rule 6) ----------

/** The picture formats the plugin can show (spec §13.0 item 3). */
export type SupportedFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'svg';

/** What an extension says about a file (rule 6). `name` is the format's name in the warning text. */
export type FormatVerdict = { kind: 'supported'; format: SupportedFormat } | { kind: 'unsupported'; name: string } | { kind: 'other' };

const SUPPORTED: Record<string, SupportedFormat> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', gif: 'gif', bmp: 'bmp', svg: 'svg' };

/** Known picture formats the plugin cannot show, with the name the warning text uses. */
const UNSUPPORTED: Record<string, string> = {
	heic: 'HEIC',
	heif: 'HEIC',
	avif: 'AVIF',
	tif: 'TIFF',
	tiff: 'TIFF',
	jxl: 'JPEG XL',
	psd: 'PSD',
	ico: 'ICO',
	dng: 'RAW',
	cr2: 'RAW',
	nef: 'RAW',
	arw: 'RAW',
	raw: 'RAW',
};

/** The verdict for a file extension, without case (rule 6). The bytes decide in the end (`judgeHeader`). */
export function pictureFormat(ext: string): FormatVerdict {
	const e = typeof ext === 'string' ? ext.toLowerCase() : '';
	if (Object.prototype.hasOwnProperty.call(SUPPORTED, e)) return { kind: 'supported', format: SUPPORTED[e] };
	if (Object.prototype.hasOwnProperty.call(UNSUPPORTED, e)) return { kind: 'unsupported', name: UNSUPPORTED[e] };
	return { kind: 'other' };
}

// ---------- Headers (rule 7, A4) ----------

/** What the first bytes of a file say (rule 7). */
export interface PictureHeader {
	format: SupportedFormat | 'heic' | 'avif' | 'unknown';
	width: number | null;
	height: number | null;
	/** JPEG EXIF orientation 1–8, when written. */
	orientation?: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b: Uint8Array, i: number) => u24le(b, i) + b[i + 3] * 0x1000000;
const i32le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

/** `n` bytes from `i` as Latin-1 text; '' when they run past the end. */
function ascii(b: Uint8Array, i: number, n: number): string {
	if (i < 0 || i + n > b.length) return '';
	let s = '';
	for (let k = 0; k < n; k++) s += String.fromCharCode(b[i + k]);
	return s;
}

type Format = PictureHeader['format'];
const sized = (format: Format, width: number | null, height: number | null): PictureHeader => ({ format, width, height });
const NO_SIZE = { width: null, height: null };
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
/** A4: an SVG's root element must start within this many bytes. */
const SVG_SCAN = 64 * 1024;

/**
 * Reads the format and the size in pixels from a file's bytes (rule 7). Never throws: a damaged
 * or cut header gives its format with no size, or `unknown`.
 */
export function readPictureHeader(bytes: Uint8Array): PictureHeader {
	try {
		const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
		if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
			return b.length >= 24 && ascii(b, 12, 4) === 'IHDR' ? sized('png', u32be(b, 16), u32be(b, 20)) : { format: 'png', ...NO_SIZE };
		}
		if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegHeader(b);
		if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return sized('gif', u16le(b, 6), u16le(b, 8));
		if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return webpHeader(b);
		if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return bmpHeader(b);
		if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return isoHeader(b);
		const svg = svgHeader(b);
		if (svg) return svg;
	} catch {
		// A header this reader cannot follow reads as unknown.
	}
	return { format: 'unknown', ...NO_SIZE };
}

/** JPEG: the first start-of-frame segment, and the EXIF orientation from APP1 before it. */
function jpegHeader(b: Uint8Array): PictureHeader {
	let i = 2;
	let orientation: number | undefined;
	const out = (width: number | null, height: number | null): PictureHeader => (orientation === undefined ? sized('jpeg', width, height) : { ...sized('jpeg', width, height), orientation });
	while (i + 3 < b.length) {
		if (b[i] !== 0xff) return out(null, null);
		const m = b[i + 1];
		// Fill bytes, and markers with no length.
		if (m === 0xff) {
			i++;
			continue;
		}
		if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
			i += 2;
			continue;
		}
		if (m === 0xd9 || m === 0xda) break;
		const len = u16be(b, i + 2);
		// The jump over the whole APP1 block also skips the small JPEG (the thumbnail) inside it.
		if (m === 0xe1 && orientation === undefined) orientation = exifOrientation(b, i + 4, Math.min(b.length, i + 2 + len));
		// SOF0–SOF15, but C4 (DHT), C8 (JPG) and CC (DAC) are other segments.
		if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
			if (i + 8 >= b.length) break;
			return out(u16be(b, i + 7), u16be(b, i + 5));
		}
		i += 2 + len;
	}
	return out(null, null);
}

/** The EXIF Orientation (tag 0x0112) of IFD0, in either byte order; only 1–8 count. */
function exifOrientation(b: Uint8Array, start: number, end: number): number | undefined {
	if (ascii(b, start, 6) !== 'Exif\u0000\u0000') return undefined;
	const t = start + 6;
	if (t + 8 > end) return undefined;
	const le = b[t] === 0x49;
	const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o));
	const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o));
	const ifd = t + r32(t + 4);
	if (ifd + 2 > end) return undefined;
	const n = r16(ifd);
	for (let k = 0; k < n; k++) {
		const e = ifd + 2 + 12 * k;
		if (e + 12 > end) break;
		if (r16(e) === 0x0112) {
			const v = r16(e + 8);
			return v >= 1 && v <= 8 ? v : undefined;
		}
	}
	return undefined;
}

/** WebP: VP8 (lossy), VP8L (lossless, size − 1) and VP8X (extended, size − 1). */
function webpHeader(b: Uint8Array): PictureHeader {
	const chunk = ascii(b, 12, 4);
	if (chunk === 'VP8 ' && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return sized('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
		const bits = u32le(b, 21);
		return sized('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (chunk === 'VP8X' && b.length >= 30) return sized('webp', u24le(b, 24) + 1, u24le(b, 27) + 1);
	return { format: 'webp', ...NO_SIZE };
}

/** BMP: the 12-byte core header and the 40-byte (or longer) info headers; a top-down picture has a negative height. */
function bmpHeader(b: Uint8Array): PictureHeader {
	const dib = u32le(b, 14);
	if (dib === 12) return sized('bmp', u16le(b, 18), u16le(b, 20));
	if (dib >= 40 && b.length >= 26) return sized('bmp', Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)));
	return { format: 'bmp', ...NO_SIZE };
}

/** HEIC and AVIF (ISO base media files): the brands say which; the largest `ispe` box gives the size. */
function isoHeader(b: Uint8Array): PictureHeader {
	const boxEnd = Math.min(b.length, u32be(b, 0));
	const major = ascii(b, 8, 4);
	const brands = [major];
	for (let i = 16; i + 4 <= boxEnd; i += 4) brands.push(ascii(b, i, 4));
	let format: Format;
	if (AVIF_BRANDS.has(major)) format = 'avif';
	else if (HEIC_BRANDS.has(major)) format = 'heic';
	else if (brands.some((x) => AVIF_BRANDS.has(x))) format = 'avif';
	else if (brands.some((x) => HEIC_BRANDS.has(x)) || major === 'mif1' || major === 'msf1') format = 'heic';
	else return { format: 'unknown', ...NO_SIZE };
	// A HEIC photo is often a grid of tiles: each tile and the whole grid have an `ispe`; the largest is the whole picture.
	let width: number | null = null;
	let height: number | null = null;
	for (let i = 4; i + 16 <= b.length; i++) {
		if (b[i] !== 0x69 || ascii(b, i, 4) !== 'ispe') continue;
		const w = u32be(b, i + 8);
		const h = u32be(b, i + 12);
		if (width === null || height === null || w * h > width * height) {
			width = w;
			height = h;
		}
	}
	return sized(format, width, height);
}

/** A length in an SVG `width` or `height`: a plain number or px; else null (%, cm, em, …). */
function svgLength(v: string | undefined): number | null {
	const m = v === undefined ? null : /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i.exec(v);
	const n = m ? Number(m[1]) : NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * SVG (A4): the root `<svg` must come first, after an optional byte-order mark, XML declaration,
 * processing instructions, comments, a DOCTYPE and white space, and start within 64 KB. The size
 * is `width` and `height` when both are plain numbers or px, else the `viewBox` size, else none.
 */
function svgHeader(b: Uint8Array): PictureHeader | null {
	const text = ascii(b, 0, Math.min(b.length, SVG_SCAN));
	let i = text.startsWith('\u00ef\u00bb\u00bf') ? 3 : 0;
	for (;;) {
		while (i < text.length && /\s/.test(text[i])) i++;
		if (text.startsWith('<?', i)) i = after(text, '?>', i + 2);
		else if (text.startsWith('<!--', i)) i = after(text, '-->', i + 4);
		else if (/^<!doctype/i.test(text.slice(i, i + 9))) i = doctypeEnd(text, i + 9);
		else break;
		if (i < 0) return null;
	}
	if (!/^<svg[\s/>]/i.test(text.slice(i, i + 5))) return null;
	const tag = startTag(text, i + 4);
	const attrs = attributes(tag);
	const w = svgLength(attrs.get('width'));
	const h = svgLength(attrs.get('height'));
	if (w !== null && h !== null) return sized('svg', w, h);
	const box = (attrs.get('viewBox') ?? '')
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return sized('svg', box[2], box[3]);
	return { format: 'svg', ...NO_SIZE };
}

/**
 * The quoted attributes of a start tag (the first of a repeated name wins). It reads the same as
 * the regular expression `([^\s=/>]+)\s*=\s*("…"|'…')` but in one pass: that expression is
 * quadratic on a long token or an unclosed quote, and the tag may be 64 KB of any bytes.
 */
function attributes(tag: string): Map<string, string> {
	const attrs = new Map<string, string>();
	const isName = (c: string) => !/[\s=/>]/.test(c);
	// Once a quote has no closing mark, no later quote of that kind has one.
	const noClose = new Set<string>();
	let i = 0;
	while (i < tag.length) {
		if (!isName(tag[i])) {
			i++;
			continue;
		}
		let r = i;
		while (r < tag.length && isName(tag[r])) r++;
		// A shorter name from a later start in the same run fails the same way, so the run is skipped whole.
		let k = r;
		while (k < tag.length && /\s/.test(tag[k])) k++;
		if (tag[k] !== '=') {
			i = r;
			continue;
		}
		k++;
		while (k < tag.length && /\s/.test(tag[k])) k++;
		const q = tag[k];
		const close = q === '"' || q === "'" ? (noClose.has(q) ? -1 : tag.indexOf(q, k + 1)) : -1;
		if (close < 0) {
			if (q === '"' || q === "'") noClose.add(q);
			i = r;
			continue;
		}
		const name = tag.slice(i, r);
		if (!attrs.has(name)) attrs.set(name, tag.slice(k + 1, close));
		i = close + 1;
	}
	return attrs;
}

/** The position after the next `end` from `from`, or -1. */
function after(text: string, end: string, from: number): number {
	const at = text.indexOf(end, from);
	return at < 0 ? -1 : at + end.length;
}

/** The position after a DOCTYPE's closing `>`, skipping an internal subset in `[…]` and quoted text; -1 if it does not end. */
function doctypeEnd(text: string, from: number): number {
	let quote = '';
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") quote = c;
		else if (c === '[') depth++;
		else if (c === ']') depth--;
		else if (c === '>' && depth <= 0) return i + 1;
	}
	return -1;
}

/** The attribute text of a start tag: from `from` to its first `>` outside quotes. */
function startTag(text: string, from: number): string {
	let quote = '';
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") quote = c;
		else if (c === '>') return text.slice(from, i);
	}
	return text.slice(from);
}

// ---------- The size rule (rule 8, A6) ----------

/** Spec §13.0 item 3: a picture with more pixels than this is never decoded (rule 8). */
export const MAX_PICTURE_PIXELS = 40_000_000;

/**
 * One picture problem, with the text params beyond the owner (rule 12). `file` is the path as
 * written for `missing-picture`, else the file name. `pixels` (millions, rounded up) is absent
 * when the file was too large to read at all (A6).
 */
export type PictureProblem =
	| { ok: false; code: 'picture-web' }
	| { ok: false; code: 'missing-picture'; file: string }
	| { ok: false; code: 'picture-not-image'; file: string; format?: string }
	| { ok: false; code: 'picture-too-large'; file: string; pixels?: number };

const ISO_NAMES: Partial<Record<Format, string>> = { heic: 'HEIC', avif: 'AVIF' };

/**
 * Decides from a header whether a file may be decoded, and as which format (rules 6, 8): the
 * bytes decide, whatever the extension says. A raster picture with no size is a damaged file; an
 * SVG with no size is decoded (it is drawn at the size of its small copy). The pixel count is
 * width × height before any EXIF rotation.
 */
export function judgeHeader(h: PictureHeader, file: string): { ok: true; format: SupportedFormat } | PictureProblem {
	const name = typeof file === 'string' ? file : '';
	const format = h?.format;
	const known = format === undefined ? undefined : ISO_NAMES[format];
	if (known) return { ok: false, code: 'picture-not-image', file: name, format: known };
	if (format === undefined || format === 'unknown' || format === 'heic' || format === 'avif') return { ok: false, code: 'picture-not-image', file: name };
	const size = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
	const w = size(h.width);
	const hh = size(h.height);
	if (w === null || hh === null) return format === 'svg' ? { ok: true, format } : { ok: false, code: 'picture-not-image', file: name };
	const pixels = w * hh;
	if (pixels > MAX_PICTURE_PIXELS) return { ok: false, code: 'picture-too-large', file: name, pixels: Math.ceil(pixels / 1_000_000) };
	return { ok: true, format };
}

// ---------- Crop and fit (rule 9) ----------

/**
 * The upper-centre square of a `w` × `h` picture (spec §13.7 "Crop", D76): a tall picture's full
 * width from its top, a wide picture's centre. Give it the decoded size, after EXIF rotation.
 */
export function portraitCrop(w: number, h: number): { sx: number; sy: number; size: number } {
	if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)) return { sx: 0, sy: 0, size: 0 };
	const size = Math.min(w, h);
	return { sx: Math.floor((w - size) / 2), sy: 0, size };
}

/**
 * Where a `w` × `h` picture goes in a `boxW` × `boxH` box (D75): the whole picture with its own
 * proportions, as large as fits, centred, never cropped (`preserveAspectRatio` "xMidYMid meet").
 */
export function fitMeet(w: number, h: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
	const bw = Number.isFinite(boxW) && boxW > 0 ? boxW : 0;
	const bh = Number.isFinite(boxH) && boxH > 0 ? boxH : 0;
	if (!(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) || bw === 0 || bh === 0) return { x: bw / 2, y: bh / 2, w: 0, h: 0 };
	// The side that meets the box is set exactly, so rounding never takes the picture past it.
	if (w * bh >= h * bw) {
		const fh = (bw * h) / w;
		return { x: 0, y: (bh - fh) / 2, w: bw, h: fh };
	}
	const fw = (bh * w) / h;
	return { x: (bw - fw) / 2, y: 0, w: fw, h: bh };
}

// ---------- Warnings (rule 12, A1) ----------

/** The four picture warning codes (spec §13.6, §13.7). */
export const PICTURE_CODES = ['missing-picture', 'picture-web', 'picture-not-image', 'picture-too-large'] as const;

/**
 * Whose picture a problem is about. `arms: true` on a portrait owner means the personal arms of that person (0.2.8 contract
 * A.1); it is a flag, not a third kind, so callers that tell a house from a person keep compiling until they adopt it.
 */
export type PictureOwner = { kind: 'arms'; house: Pick<House, 'id' | 'name'> } | { kind: 'portrait'; person: Pick<Person, 'id' | 'name'>; arms?: true };

/**
 * The warning for a picture problem (rule 12, A1): always `level: 'warning'`, so the tree still
 * draws. params: `owner` ('arms' | 'portrait' | 'person-arms'), `house` or `person` (the name), and the problem's
 * `file`, `format` and `pixels` when it has them. ids: [house id] or [person id]. Every caller
 * builds picture warnings with this, so the params and ids agree everywhere.
 */
export function pictureIssue(owner: PictureOwner, problem: PictureProblem): CodedIssue {
	const params: IssueParams = {};
	let id = '';
	if (owner?.kind === 'portrait') {
		params.owner = owner.arms ? 'person-arms' : 'portrait';
		params.person = String(owner.person?.name ?? '');
		id = String(owner.person?.id ?? '');
	} else {
		params.owner = 'arms';
		params.house = String(owner?.house?.name ?? '');
		id = String(owner?.house?.id ?? '');
	}
	const p = (problem ?? {}) as { code?: unknown; file?: unknown; format?: unknown; pixels?: unknown };
	if (typeof p.file === 'string') params.file = p.file;
	if (typeof p.format === 'string' && p.format !== '') params.format = p.format;
	if (typeof p.pixels === 'number' && Number.isFinite(p.pixels)) params.pixels = p.pixels;
	const code = PICTURE_CODES.find((c) => c === p.code) ?? 'picture-not-image';
	return codedIssue(code, 'warning', params, [id]);
}
