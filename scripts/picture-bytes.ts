/*
 * Byte-level writers for the sample pictures of sample trees 14 and 07b (spec §13.0 item 12,
 * §13.6, §13.7): a baseline JPEG encoder (with an optional EXIF orientation), a valid PNG of any
 * size that stays a few kilobytes (for the picture of more than 40 million pixels), a HEIC-branded
 * file with `ispe` sizes, and a small PDF that is not a picture. Pure (no file access), so the tests
 * can build the same bytes in memory. `generate-pictures.ts` uses these to write the files.
 * Everything is deterministic: the same input gives the same bytes on every run.
 */

// ---------- Small helpers ----------

const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as PNG uses it. */
export function crc32(b: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** Writes a bit stream with the least significant bit first (deflate order). */
class LsbBits {
	private bytes: number[] = [];
	private acc = 0;
	private n = 0;

	bits(v: number, count: number): void {
		for (let i = 0; i < count; i++) {
			this.acc |= ((v >>> i) & 1) << this.n;
			if (++this.n === 8) {
				this.bytes.push(this.acc);
				this.acc = 0;
				this.n = 0;
			}
		}
	}

	/** A Huffman code: deflate stores it with its first bit first. */
	code(code: number, len: number): void {
		for (let i = len - 1; i >= 0; i--) this.bits((code >>> i) & 1, 1);
	}

	finish(): number[] {
		if (this.n > 0) this.bytes.push(this.acc);
		return this.bytes;
	}
}

function pngChunk(type: string, data: Uint8Array | number[]): Uint8Array {
	const body = concat([ascii(type), data]);
	return concat([be32(data.length), body, be32(crc32(body))]);
}

// ---------- A large PNG in a small file ----------

/**
 * A valid black PNG of `width` × `height` pixels, 1 bit per pixel, whose file is only a few
 * kilobytes: one deflate block with its own Huffman codes, in which a copy of 258 zero bytes costs
 * 2 bits. Used for the picture of more than 40 million pixels (spec §13.0 item 3): the plugin must
 * never decode it, but a program that does can.
 */
export function blackPng(width: number, height: number): Uint8Array {
	const rowBytes = 1 + Math.ceil(width / 8);
	const total = rowBytes * height;
	const w = new LsbBits();
	// Final block, dynamic Huffman codes.
	w.bits(1, 1);
	w.bits(2, 2);
	w.bits(286 - 257, 5); // HLIT: literal/length codes 0–285
	w.bits(1 - 1, 5); // HDIST: one distance code (distance 1)
	// Code length code lengths, in the deflate order, up to the entry of symbol 1.
	const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
	const clLen: Record<number, number> = { 18: 1, 1: 2, 2: 2 };
	const used = order.indexOf(1) + 1;
	w.bits(used - 4, 4);
	for (let i = 0; i < used; i++) w.bits(clLen[order[i]] ?? 0, 3);
	// Canonical codes of that alphabet: 18 → 0, 1 → 10, 2 → 11.
	const cl = { 18: [0b0, 1], 1: [0b10, 2], 2: [0b11, 2] } as const;
	const zeros = (n: number) => {
		while (n > 0) {
			const k = Math.min(138, n);
			w.code(cl[18][0], cl[18][1]);
			w.bits(k - 11, 7);
			n -= k;
		}
	};
	// Literal/length lengths: 0 → 2, 1–255 → 0, 256 → 2, 257–284 → 0, 285 → 1. Distance 0 → 1.
	w.code(cl[2][0], cl[2][1]);
	zeros(255);
	w.code(cl[2][0], cl[2][1]);
	zeros(28);
	w.code(cl[1][0], cl[1][1]);
	w.code(cl[1][0], cl[1][1]);
	// Canonical codes: 285 → 0, literal 0 → 10, end of block → 11; distance 1 → 0.
	w.code(0b10, 2);
	let left = total - 1;
	while (left >= 258) {
		w.code(0b0, 1);
		w.code(0b0, 1);
		left -= 258;
	}
	for (; left > 0; left--) w.code(0b10, 2);
	w.code(0b11, 2);
	const deflate = w.finish();
	// Adler-32 of `total` zero bytes: a stays 1, b grows by 1 per byte.
	const adler = ((total % 65521) * 65536 + 1) >>> 0;
	const zlib = concat([[0x78, 0x01], deflate, be32(adler)]);
	const ihdr = [...be32(width), ...be32(height), 1, 0, 0, 0, 0];
	return concat([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib), pngChunk('IEND', [])]);
}

// ---------- HEIC-branded file ----------

function box(type: string, ...children: (Uint8Array | number[])[]): Uint8Array {
	const body = concat(children);
	return concat([be32(8 + body.length), ascii(type), body]);
}

/**
 * An ISO base media file with the brand `heic` and an `ispe` box for each of `sizes` (a HEIC photo
 * stored as tiles has one per tile and one for the whole picture). It holds no picture data: it
 * is only for the format check (spec §13.0 item 3: HEIC gives `picture-not-image`).
 */
export function heicFile(sizes: readonly [number, number][]): Uint8Array {
	const ftyp = box('ftyp', ascii('heic'), be32(0), ascii('mif1'), ascii('heic'));
	const hdlr = box('hdlr', be32(0), be32(0), ascii('pict'), be32(0), be32(0), be32(0), [0]);
	const ispe = sizes.map(([w, h]) => box('ispe', be32(0), be32(w), be32(h)));
	const meta = box('meta', be32(0), hdlr, box('iprp', box('ipco', ...ispe)));
	return concat([ftyp, meta, box('mdat', new Array<number>(16).fill(0))]);
}

// ---------- A file that is not a picture ----------

/** A small, valid, empty PDF (spec §13.6: a file that is not a picture). */
export function smallPdf(): Uint8Array {
	const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'];
	let text = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((o, i) => {
		offsets.push(text.length);
		text += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = text.length;
	text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) text += `${String(o).padStart(10, '0')} 00000 n \n`;
	text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(ascii(text));
}

// ---------- Baseline JPEG ----------

/** The standard quantisation tables of JPEG Annex K.1, in natural (row) order. */
const LUMA_Q = [
	16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104,
	113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_Q = [
	17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];
/** Position in natural order of the k-th coefficient in zigzag order. */
const ZIGZAG = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58,
	59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

function scaledTable(base: number[], quality: number): number[] {
	const q = Math.min(100, Math.max(1, Math.round(quality)));
	const scale = q < 50 ? 5000 / q : 200 - 2 * q;
	return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

/** cos table for the 8-point DCT, with the normalisation of JPEG's forward DCT folded in. */
const DCT = (() => {
	const t = new Float64Array(64);
	for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) t[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
	return t;
})();

/** Forward DCT and quantisation of one 8 × 8 block (level-shifted samples) into zigzag order. */
function fdctQuant(block: Float64Array, q: number[], out: Int16Array, at: number): void {
	const tmp = new Float64Array(64);
	for (let y = 0; y < 8; y++) {
		for (let u = 0; u < 8; u++) {
			let s = 0;
			for (let x = 0; x < 8; x++) s += DCT[u * 8 + x] * block[y * 8 + x];
			tmp[y * 8 + u] = s;
		}
	}
	for (let k = 0; k < 64; k++) {
		const n = ZIGZAG[k];
		const v = n >> 3;
		const u = n & 7;
		let s = 0;
		for (let y = 0; y < 8; y++) s += DCT[v * 8 + y] * tmp[y * 8 + u];
		out[at + k] = Math.round(s / q[n]);
	}
}

const bitLength = (v: number) => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));

/** Code lengths and symbol order of an optimal JPEG Huffman table for these counts (JPEG Annex K.2). */
function optimalTable(counts: number[]): { bits: number[]; values: number[] } {
	const freq = [...counts, 1]; // symbol 256 is reserved, so no code is all ones
	const size = new Array<number>(257).fill(0);
	const others = new Array<number>(257).fill(-1);
	for (;;) {
		let c1 = -1;
		let v = Infinity;
		for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v) [v, c1] = [freq[i], i];
		let c2 = -1;
		v = Infinity;
		for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v && i !== c1) [v, c2] = [freq[i], i];
		if (c2 < 0) break;
		freq[c1] += freq[c2];
		freq[c2] = 0;
		size[c1]++;
		while (others[c1] >= 0) {
			c1 = others[c1];
			size[c1]++;
		}
		others[c1] = c2;
		size[c2]++;
		while (others[c2] >= 0) {
			c2 = others[c2];
			size[c2]++;
		}
	}
	const bits = new Array<number>(33).fill(0);
	for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
	for (let i = 32; i > 16; i--) {
		while (bits[i] > 0) {
			let j = i - 2;
			while (bits[j] === 0) j--;
			bits[i] -= 2;
			bits[i - 1]++;
			bits[j + 1] += 2;
			bits[j]--;
		}
	}
	let top = 16;
	while (bits[top] === 0) top--;
	bits[top]--;
	const values: number[] = [];
	for (let len = 1; len <= 32; len++) for (let s = 0; s < 256; s++) if (size[s] === len) values.push(s);
	return { bits: bits.slice(1, 17), values };
}

/** The canonical codes of a table (JPEG Annex C): symbol → [code, length]. */
function codesOf(t: { bits: number[]; values: number[] }): Map<number, [number, number]> {
	const out = new Map<number, [number, number]>();
	let code = 0;
	let k = 0;
	for (let len = 1; len <= 16; len++) {
		for (let i = 0; i < t.bits[len - 1]; i++) out.set(t.values[k++], [code++, len]);
		code <<= 1;
	}
	return out;
}

/** Writes JPEG entropy-coded bits, most significant bit first, with 0xFF stuffing. */
class MsbBits {
	readonly bytes: number[] = [];
	private acc = 0;
	private n = 0;

	bits(v: number, count: number): void {
		for (let i = count - 1; i >= 0; i--) {
			this.acc = (this.acc << 1) | ((v >>> i) & 1);
			if (++this.n === 8) this.flush();
		}
	}

	private flush(): void {
		this.bytes.push(this.acc);
		if (this.acc === 0xff) this.bytes.push(0);
		this.acc = 0;
		this.n = 0;
	}

	finish(): number[] {
		if (this.n > 0) this.bits(0x7f, 8 - this.n);
		return this.bytes;
	}
}

/** Options of `encodeJpeg`. */
export interface JpegOptions {
	/** 1–100, as in most encoders. Default 80. */
	quality?: number;
	/** Grey only (one component). Default false (YCbCr with 4:2:0 sampling, like a phone photo). */
	grey?: boolean;
	/** An EXIF orientation (1–8) to write in an APP1 block; else a JFIF APP0 block. */
	orientation?: number;
}

/**
 * A baseline JPEG of RGBA pixels (transparent parts are put on white), with optimal Huffman
 * tables so flat pictures stay small. The pixels are stored as given: with `orientation`, the
 * viewer is told to turn them (EXIF), as a phone does.
 */
export function encodeJpeg(rgba: ArrayLike<number>, width: number, height: number, opts: JpegOptions = {}): Uint8Array {
	const grey = !!opts.grey;
	const quality = opts.quality ?? 80;
	const qTables = [scaledTable(LUMA_Q, quality), scaledTable(CHROMA_Q, quality)];
	const mcu = grey ? 8 : 16;
	const mx = Math.ceil(width / mcu);
	const my = Math.ceil(height / mcu);
	// Colour planes, padded to whole MCUs by repeating the edge pixels.
	const pw = mx * mcu;
	const ph = my * mcu;
	const Y = new Float64Array(pw * ph);
	const Cb = grey ? null : new Float64Array(pw * ph);
	const Cr = grey ? null : new Float64Array(pw * ph);
	for (let y = 0; y < ph; y++) {
		const sy = Math.min(y, height - 1);
		for (let x = 0; x < pw; x++) {
			const i = (sy * width + Math.min(x, width - 1)) * 4;
			const a = rgba[i + 3] / 255;
			const r = rgba[i] * a + 255 * (1 - a);
			const g = rgba[i + 1] * a + 255 * (1 - a);
			const b = rgba[i + 2] * a + 255 * (1 - a);
			Y[y * pw + x] = 0.299 * r + 0.587 * g + 0.114 * b;
			if (Cb && Cr) {
				Cb[y * pw + x] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
				Cr[y * pw + x] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
			}
		}
	}
	// Blocks in scan order: per MCU, 4 Y blocks (or 1 when grey), then Cb and Cr at half size.
	const comps = grey ? [0] : [0, 0, 0, 0, 1, 2];
	const coef = new Int16Array(mx * my * comps.length * 64);
	const block = new Float64Array(64);
	let at = 0;
	for (let by = 0; by < my; by++) {
		for (let bx = 0; bx < mx; bx++) {
			comps.forEach((c, k) => {
				if (c === 0) {
					const ox = bx * mcu + (grey ? 0 : (k & 1) * 8);
					const oy = by * mcu + (grey ? 0 : (k >> 1) * 8);
					for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = Y[(oy + y) * pw + ox + x] - 128;
				} else {
					const plane = c === 1 ? Cb! : Cr!;
					for (let y = 0; y < 8; y++) {
						for (let x = 0; x < 8; x++) {
							const px = bx * 16 + 2 * x;
							const py = by * 16 + 2 * y;
							block[y * 8 + x] = (plane[py * pw + px] + plane[py * pw + px + 1] + plane[(py + 1) * pw + px] + plane[(py + 1) * pw + px + 1]) / 4 - 128;
						}
					}
				}
				fdctQuant(block, qTables[c === 0 ? 0 : 1], coef, at);
				at += 64;
			});
		}
	}
	// Pass 1: count the symbols of each table; pass 2: write them.
	const tableOf = (c: number) => (c === 0 ? 0 : 1);
	const counts = [0, 1].map(() => ({ dc: new Array<number>(256).fill(0), ac: new Array<number>(256).fill(0) }));
	const run = (emit: (t: number, dc: boolean, sym: number, extra: number, extraLen: number) => void) => {
		const pred = [0, 0, 0];
		let b = 0;
		for (let m = 0; m < mx * my; m++) {
			for (const c of comps) {
				const base = b++ * 64;
				const t = tableOf(c);
				const diff = coef[base] - pred[c];
				pred[c] = coef[base];
				const s = bitLength(diff);
				emit(t, true, s, diff < 0 ? diff + (1 << s) - 1 : diff, s);
				let zeros = 0;
				for (let k = 1; k < 64; k++) {
					const v = coef[base + k];
					if (v === 0) {
						zeros++;
						continue;
					}
					while (zeros > 15) {
						emit(t, false, 0xf0, 0, 0);
						zeros -= 16;
					}
					const n = bitLength(v);
					emit(t, false, (zeros << 4) | n, v < 0 ? v + (1 << n) - 1 : v, n);
					zeros = 0;
				}
				if (zeros > 0) emit(t, false, 0x00, 0, 0);
			}
		}
	};
	run((t, dc, sym) => void (dc ? counts[t].dc : counts[t].ac)[sym]++);
	const used = grey ? [0] : [0, 1];
	const tables = used.map((t) => ({ dc: optimalTable(counts[t].dc), ac: optimalTable(counts[t].ac) }));
	const codes = tables.map((t) => ({ dc: codesOf(t.dc), ac: codesOf(t.ac) }));
	const out = new MsbBits();
	run((t, dc, sym, extra, extraLen) => {
		const [code, len] = (dc ? codes[t].dc : codes[t].ac).get(sym)!;
		out.bits(code, len);
		if (extraLen) out.bits(extra, extraLen);
	});
	const data = out.finish();

	const seg = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
	const head: number[] = [0xff, 0xd8];
	if (opts.orientation !== undefined) {
		// Exif, big-endian TIFF header, IFD0 with one entry: Orientation (SHORT).
		const tiff = [...ascii('MM'), 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(opts.orientation), 0, 0, ...be32(0)];
		head.push(...seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff]));
	} else head.push(...seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
	used.forEach((t) => head.push(...seg(0xdb, [t, ...ZIGZAG.map((n) => qTables[t][n])])));
	const sof = grey ? [1, 1, 0x11, 0] : [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
	head.push(...seg(0xc0, [8, ...be16(height), ...be16(width), ...sof]));
	tables.forEach((t, k) => {
		head.push(...seg(0xc4, [0x00 | k, ...t.dc.bits, ...t.dc.values]));
		head.push(...seg(0xc4, [0x10 | k, ...t.ac.bits, ...t.ac.values]));
	});
	const sos = grey ? [1, 1, 0x00] : [3, 1, 0x00, 2, 0x11, 3, 0x11];
	head.push(...seg(0xda, [...sos, 0, 63, 0]));
	return concat([head, data, [0xff, 0xd9]]);
}

/**
 * RGBA pixels turned for storage with an EXIF orientation of 6: a viewer that obeys the tag turns
 * the stored picture 90° clockwise and shows the original `width` × `height` picture again.
 */
export function storeForOrientation6(rgba: ArrayLike<number>, width: number, height: number): { rgba: Uint8Array; width: number; height: number } {
	// Stored is `height` wide and `width` high; displayed(x, y) = stored(y, height − 1 − x).
	const sw = height;
	const sh = width;
	const out = new Uint8Array(sw * sh * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const sx = y;
			const sy = width - 1 - x;
			const from = (y * width + x) * 4;
			const to = (sy * sw + sx) * 4;
			for (let k = 0; k < 4; k++) out[to + k] = rgba[from + k];
		}
	}
	return { rgba: out, width: sw, height: sh };
}
