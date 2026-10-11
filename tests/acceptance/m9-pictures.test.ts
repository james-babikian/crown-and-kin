import { describe, expect, it } from 'vitest';
import { issueText, type CodedIssue } from '../../src/core/messages';
import type { PictureHeader, PictureOwner } from '../../src/core/pictures';
import { blackPng, heicFile, smallPdf } from '../../scripts/picture-bytes';
import {
	armsCopy64,
	ascii,
	be16,
	be32,
	block14,
	bytes,
	comments14,
	exifSegment,
	fixtureBytes,
	isoBox,
	isoFile,
	jpegHead,
	le16,
	le32,
	pictureFiles,
	pictureProblems,
	picturesModule,
	pngHead,
	seg,
	text,
	treeOf,
} from './m9-support';

/*
 * Spec §13.0 item 3 and the M9 core contract (now in src/core/pictures.ts; rules 4–9 and 12,
 * amendments A1, A2, A4, A6): picture links and web addresses, formats, the header reader, the
 * 40 million pixel rule, the portrait crop, the arms fit and the picture warnings. Sample tree 14
 * lists each file's header and every picture warning in comments. These tests wait for WP 9.1
 * (`src/core/pictures.ts` and the texts in `messages.ts`).
 */

describe('pictureTarget: the link forms of `link`, each with an optional "!" (spec §13.0 item 3, rule 4)', () => {
	const vault = (path: string, ext: string) => ({ kind: 'vault', path, ext });
	const cases: [string, ReturnType<typeof vault>][] = [
		['[[valmont-arms.png]]', vault('valmont-arms.png', 'png')],
		['![[valmont-arms.png]]', vault('valmont-arms.png', 'png')],
		['[[Pictures/Arms/valmont.PNG|The arms]]', vault('Pictures/Arms/valmont.PNG', 'png')],
		['![[scan.pdf#page=2]]', vault('scan.pdf', 'pdf')],
		['[[aldric.jpg#^b1|Aldric]]', vault('aldric.jpg', 'jpg')],
		['[[ aldric.jpeg ]]', vault('aldric.jpeg', 'jpeg')],
		['[The arms](Pictures/Valmont%20arms.png)', vault('Pictures/Valmont arms.png', 'png')],
		['![The arms](Pictures/Valmont%20arms.png)', vault('Pictures/Valmont arms.png', 'png')],
		['[](Pictures/arms.svg#top)', vault('Pictures/arms.svg', 'svg')],
		['[The arms](<Pictures/Valmont arms.webp>)', vault('Pictures/Valmont arms.webp', 'webp')],
		// The angle form is not percent-decoded.
		['[x](<Pictures/100%25.png>)', vault('Pictures/100%25.png', 'png')],
		['Pictures/valmont.gif', vault('Pictures/valmont.gif', 'gif')],
		['valmont.bmp#x', vault('valmont.bmp', 'bmp')],
		// No extension in the last path segment.
		['[[folder.v2/arms]]', vault('folder.v2/arms', '')],
		['[[arms]]', vault('arms', '')],
		['[[archive.tar.GZ]]', vault('archive.tar.GZ', 'gz')],
	];
	for (const [value, want] of cases) {
		it(value, async () => {
			const m = await picturesModule();
			expect(m.pictureTarget(value)).toEqual(want);
		});
	}

	it('A2: balanced parentheses in a Markdown link, and the angle form up to the last ">" before ")"', async () => {
		const m = await picturesModule();
		expect(m.pictureTarget('[](Pictures/Arms%20(old).png)')).toEqual(vault('Pictures/Arms (old).png', 'png'));
		expect(m.pictureTarget('![Arms](Pictures/Arms (old) (2).png)')).toEqual(vault('Pictures/Arms (old) (2).png', 'png'));
		expect(m.pictureTarget('[Arms](<Pictures/Arms (old).png>)')).toEqual(vault('Pictures/Arms (old).png', 'png'));
		expect(m.pictureTarget('[a](<x>y.png>)')).toEqual(vault('x>y.png', 'png'));
	});

	it('null when the value names nothing: absent, empty, or an empty target', async () => {
		const m = await picturesModule();
		for (const v of [undefined, '', '   ', '[[]]', '![[ ]]', '[[#heading]]', '[[|alias]]', '[text]()', '[text](<>)', '#heading']) expect(m.pictureTarget(v), String(v)).toBeNull();
	});

	it('never throws on odd text', async () => {
		const m = await picturesModule();
		for (const v of ['[[', ']]', '[x](', '![', '(((', '[[a|b|c]]', '\u0000', 'x'.repeat(20000), '%E0%A4%A.png', '[a](b%ZZ.png)']) expect(() => m.pictureTarget(v)).not.toThrow();
	});
});

describe('web addresses give `picture-web` and are never loaded (spec §13.0 item 3, rule 5)', () => {
	const web = [
		'https://example.com/arms.png',
		'HTTP://EXAMPLE.COM/arms.png',
		'http:arms.png',
		'data:image/png;base64,iVBORw0KGgo=',
		'file:///C:/Pictures/arms.png',
		'ftp://example.com/a.jpg',
		'//cdn.example.com/arms.png',
		'www.example.com/arms.png',
		'WWW.Example.com/arms.png',
		'[[https://example.com/arms.png]]',
		'![Arms](https://example.com/arms.png)',
		'[Arms](<https://example.com/my arms.png>)',
		'obsidian://open?vault=x&file=arms.png',
	];
	for (const v of web) {
		it(v, async () => {
			const m = await picturesModule();
			expect(m.pictureTarget(v)).toEqual({ kind: 'web' });
		});
	}

	it('a drive letter, a folder named like a scheme and "www" inside a name are vault paths', async () => {
		const m = await picturesModule();
		expect(m.pictureTarget('C:/Pictures/arms.png')).toMatchObject({ kind: 'vault' });
		expect(m.pictureTarget('[[https/arms.png]]')).toEqual({ kind: 'vault', path: 'https/arms.png', ext: 'png' });
		expect(m.pictureTarget('[[Pictures/www.png]]')).toEqual({ kind: 'vault', path: 'Pictures/www.png', ext: 'png' });
		expect(m.pictureTarget('[[wwwarms.png]]')).toEqual({ kind: 'vault', path: 'wwwarms.png', ext: 'png' });
	});
});

describe('pictureFormat: the verdict of an extension, without case (spec §13.0 item 3, rule 6)', () => {
	const supported: [string, string][] = [
		['png', 'png'],
		['PNG', 'png'],
		['jpg', 'jpeg'],
		['JPEG', 'jpeg'],
		['jpeg', 'jpeg'],
		['webp', 'webp'],
		['gif', 'gif'],
		['bmp', 'bmp'],
		['svg', 'svg'],
		['SVG', 'svg'],
	];
	const known: [string, string][] = [
		['heic', 'HEIC'],
		['HEIF', 'HEIC'],
		['avif', 'AVIF'],
		['tif', 'TIFF'],
		['tiff', 'TIFF'],
		['jxl', 'JPEG XL'],
		['psd', 'PSD'],
		['ico', 'ICO'],
		['dng', 'RAW'],
		['cr2', 'RAW'],
		['nef', 'RAW'],
		['arw', 'RAW'],
		['raw', 'RAW'],
	];
	it('supported formats', async () => {
		const m = await picturesModule();
		for (const [ext, format] of supported) expect(m.pictureFormat(ext), ext).toEqual({ kind: 'supported', format });
	});
	it('known picture formats the plugin cannot show, with the name the text uses', async () => {
		const m = await picturesModule();
		for (const [ext, name] of known) expect(m.pictureFormat(ext), ext).toEqual({ kind: 'unsupported', name });
	});
	it('anything else is not a picture', async () => {
		const m = await picturesModule();
		for (const ext of ['md', 'pdf', 'txt', '', 'png2', 'jpgx', 'svgz', 'mp4']) expect(m.pictureFormat(ext), ext).toEqual({ kind: 'other' });
	});
});

describe('readPictureHeader: format and size from the first bytes; never throws (rule 7)', () => {
	const read = async (b: Uint8Array): Promise<PictureHeader> => (await picturesModule()).readPictureHeader(b);

	it('PNG: the IHDR size', async () => {
		expect(await read(pngHead(250, 300))).toMatchObject({ format: 'png', width: 250, height: 300 });
		expect(await read(pngHead(100_000, 70_000))).toMatchObject({ format: 'png', width: 100_000, height: 70_000 });
	});

	it('JPEG: the SOF size, skipping DHT (C4) and other segments; progressive SOF2 too', async () => {
		const dht = seg(0xc4, [0x00, ...new Array<number>(16).fill(0)]);
		const app0 = seg(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
		expect(await read(jpegHead(640, 480, [app0, dht]))).toMatchObject({ format: 'jpeg', width: 640, height: 480 });
		expect(await read(jpegHead(5712, 4284, [app0], 0xc2))).toMatchObject({ format: 'jpeg', width: 5712, height: 4284 });
	});

	it('JPEG: the EXIF orientation from APP1, in either byte order', async () => {
		for (const little of [true, false]) {
			const h = await read(jpegHead(5712, 4284, [exifSegment(6, little)]));
			expect(h, little ? 'II' : 'MM').toEqual({ format: 'jpeg', width: 5712, height: 4284, orientation: 6 });
		}
		expect((await read(jpegHead(10, 20, [exifSegment(8, true)]))).orientation).toBe(8);
	});

	it('JPEG: a small picture inside the EXIF block (the thumbnail) does not give the size', async () => {
		const thumb = [0xff, 0xd8, ...seg(0xc0, [8, ...be16(120), ...be16(160), 1, 1, 0x11, 0]), 0xff, 0xd9];
		const exif = exifSegment(1, false);
		// The thumbnail goes at the end of the APP1 block; its length grows by the thumbnail's size.
		const body = [...exif.slice(4), ...thumb];
		const app1 = seg(0xe1, body);
		expect(await read(jpegHead(4000, 3000, [app1]))).toMatchObject({ format: 'jpeg', width: 4000, height: 3000 });
	});

	it('JPEG: no orientation when there is no EXIF block', async () => {
		const h = await read(jpegHead(300, 200));
		expect(h).toMatchObject({ format: 'jpeg', width: 300, height: 200 });
		expect(h.orientation).toBeUndefined();
	});

	it('GIF: the logical screen size (87a and 89a)', async () => {
		for (const v of ['GIF87a', 'GIF89a']) expect(await read(bytes(ascii(v), le16(320), le16(200), [0, 0, 0]))).toMatchObject({ format: 'gif', width: 320, height: 200 });
	});

	it('WebP: VP8 (lossy), VP8L (lossless, +1) and VP8X (extended, +1)', async () => {
		const riff = (chunk: string, body: number[]) => bytes(ascii('RIFF'), le32(4 + 8 + body.length), ascii('WEBP'), ascii(chunk), le32(body.length), body);
		const vp8 = [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...le16(640), ...le16(480), 0, 0];
		expect(await read(riff('VP8 ', vp8))).toMatchObject({ format: 'webp', width: 640, height: 480 });
		const w = 1000;
		const h = 750;
		const bits = (w - 1) | ((h - 1) << 14);
		expect(await read(riff('VP8L', [0x2f, ...le32(bits), 0, 0, 0]))).toMatchObject({ format: 'webp', width: 1000, height: 750 });
		const le24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
		expect(await read(riff('VP8X', [0, 0, 0, 0, ...le24(4031), ...le24(3023)]))).toMatchObject({ format: 'webp', width: 4032, height: 3024 });
	});

	it('BMP: the 12-byte and the 40-byte headers; a top-down BMP (negative height) gives |height|', async () => {
		const file = (dib: number[]) => bytes(ascii('BM'), le32(0), le32(0), le32(54), dib);
		expect(await read(file([...le32(12), ...le16(64), ...le16(48), ...le16(1), ...le16(24)]))).toMatchObject({ format: 'bmp', width: 64, height: 48 });
		const info = (h: number) => [...le32(40), ...le32(800), ...le32(h >>> 0), ...le16(1), ...le16(24), ...new Array<number>(24).fill(0)];
		expect(await read(file(info(600)))).toMatchObject({ format: 'bmp', width: 800, height: 600 });
		expect(await read(file(info(-600)))).toMatchObject({ format: 'bmp', width: 800, height: 600 });
	});

	it('ISO files: heic and avif brands; the size is the largest ispe (a tiled photo)', async () => {
		expect(await read(isoFile('heic', ['mif1', 'heic'], [[512, 512], [4032, 3024]]))).toMatchObject({ format: 'heic', width: 4032, height: 3024 });
		expect(await read(isoFile('mif1', ['mif1', 'heic'], [[3024, 4032]]))).toMatchObject({ format: 'heic', width: 3024, height: 4032 });
		expect(await read(isoFile('avif', ['mif1', 'avif'], [[1920, 1080]]))).toMatchObject({ format: 'avif', width: 1920, height: 1080 });
		expect(await read(isoFile('mif1', ['mif1', 'avif'], [[800, 600]]))).toMatchObject({ format: 'avif' });
		// Another ISO file (a video) is not a picture.
		expect(await read(bytes(isoBox('ftyp', ascii('isom'), be32(0), ascii('isom'), ascii('mp41'))))).toMatchObject({ format: 'unknown' });
	});

	it('SVG: width and height when both are plain numbers or px; else the viewBox; else no size', async () => {
		const svg = (attrs: string) => text(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="1" height="1"/></svg>`);
		expect(await read(svg('width="500" height="600" viewBox="0 0 50 60"'))).toMatchObject({ format: 'svg', width: 500, height: 600 });
		expect(await read(svg('width="500px" height="600px"'))).toMatchObject({ format: 'svg', width: 500, height: 600 });
		expect(await read(svg('width="100%" height="100%" viewBox="0 0 250 300"'))).toMatchObject({ format: 'svg', width: 250, height: 300 });
		expect(await read(svg('width="10cm" height="12cm" viewBox="-10 -10 120 140"'))).toMatchObject({ format: 'svg', width: 120, height: 140 });
		expect(await read(svg('viewBox="0,0,64,48"'))).toMatchObject({ format: 'svg', width: 64, height: 48 });
		expect(await read(svg('width="500"'))).toMatchObject({ format: 'svg', width: null, height: null });
		expect(await read(svg(''))).toMatchObject({ format: 'svg', width: null, height: null });
	});

	it('A4: SVG found after an XML declaration, a long comment and a DOCTYPE (more than 1 KB, within 64 KB)', async () => {
		const prolog = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${'a long licence text. '.repeat(400)} -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n`;
		expect(prolog.length).toBeGreaterThan(8000);
		expect(await read(text(`${prolog}<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"/>`))).toMatchObject({ format: 'svg', width: 40, height: 30 });
		// With a byte-order mark too.
		expect(await read(text(`\ufeff${prolog}<svg width="40" height="30"></svg>`))).toMatchObject({ format: 'svg', width: 40, height: 30 });
		// "<svg" that starts only after 64 KB is not found.
		expect((await read(text(`<!-- ${'x'.repeat(70_000)} --><svg width="40" height="30"/>`))).format).toBe('unknown');
	});

	it('anything else is unknown, with no size', async () => {
		for (const b of [smallPdf(), text('# A note\n\nNo picture here.'), bytes([0, 0, 0, 0]), bytes([])]) {
			expect(await read(b)).toMatchObject({ format: 'unknown', width: null, height: null });
		}
	});

	it('truncated or damaged headers never throw', async () => {
		const m = await picturesModule();
		const samples = [pngHead(10, 10), jpegHead(10, 10, [exifSegment(6, true)]), isoFile('heic', ['heic'], [[10, 10]]), bytes(ascii('GIF89a'), le16(1), le16(1)), bytes(ascii('BM'), le32(0))];
		for (const s of samples) {
			for (let n = 0; n <= s.length; n++) expect(() => m.readPictureHeader(s.subarray(0, n))).not.toThrow();
		}
		// A JPEG segment length that points past the end, and a zero length.
		expect(() => m.readPictureHeader(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x00]))).not.toThrow();
		expect(() => m.readPictureHeader(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xe0, 0x00, 0x00]))).not.toThrow();
		// A PNG whose IHDR is missing: still a PNG, with no size.
		expect(m.readPictureHeader(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ format: 'png', width: null, height: null });
	});
});

describe('judgeHeader: whether a file may be decoded (rules 6 and 8)', () => {
	it('MAX_PICTURE_PIXELS is 40 million (spec §13.0 item 3)', async () => {
		expect((await picturesModule()).MAX_PICTURE_PIXELS).toBe(40_000_000);
	});

	it('a supported picture of at most 40 million pixels may be decoded, as the format of its bytes', async () => {
		const m = await picturesModule();
		expect(m.judgeHeader({ format: 'png', width: 250, height: 300 }, 'a.png')).toEqual({ ok: true, format: 'png' });
		expect(m.judgeHeader({ format: 'jpeg', width: 8000, height: 5000 }, 'a.jpg')).toEqual({ ok: true, format: 'jpeg' });
		expect(m.judgeHeader({ format: 'jpeg', width: 7296, height: 5472, orientation: 6 }, 'a.jpg')).toEqual({ ok: true, format: 'jpeg' });
		// The bytes decide: a JPEG named .png shows as a JPEG.
		expect(m.judgeHeader({ format: 'jpeg', width: 240, height: 240 }, 'lisette.png')).toEqual({ ok: true, format: 'jpeg' });
		for (const f of ['webp', 'gif', 'bmp', 'svg'] as const) expect(m.judgeHeader({ format: f, width: 10, height: 10 }, `a.${f}`)).toEqual({ ok: true, format: f });
	});

	it('more than 40 million pixels (width × height, before EXIF rotation) is too large; pixels in millions, rounded up', async () => {
		const m = await picturesModule();
		expect(m.judgeHeader({ format: 'png', width: 9000, height: 6000 }, 'huge.png')).toEqual({ ok: false, code: 'picture-too-large', file: 'huge.png', pixels: 54 });
		expect(m.judgeHeader({ format: 'jpeg', width: 8001, height: 5000, orientation: 6 }, 'b.jpg')).toEqual({ ok: false, code: 'picture-too-large', file: 'b.jpg', pixels: 41 });
		expect(m.judgeHeader({ format: 'png', width: 40_000_001, height: 1 }, 'c.png')).toEqual({ ok: false, code: 'picture-too-large', file: 'c.png', pixels: 41 });
		expect(m.judgeHeader({ format: 'png', width: 40_000_000, height: 1 }, 'd.png')).toEqual({ ok: true, format: 'png' });
		// A4: the rule applies to an SVG with a declared size too.
		expect(m.judgeHeader({ format: 'svg', width: 10_000, height: 10_000 }, 'e.svg')).toEqual({ ok: false, code: 'picture-too-large', file: 'e.svg', pixels: 100 });
	});

	it('HEIC and AVIF bytes are not a picture the plugin can show, named in the text (also with a .jpg name)', async () => {
		const m = await picturesModule();
		expect(m.judgeHeader({ format: 'heic', width: 4032, height: 3024 }, 'wren-photo.jpg')).toEqual({ ok: false, code: 'picture-not-image', file: 'wren-photo.jpg', format: 'HEIC' });
		expect(m.judgeHeader({ format: 'avif', width: 100, height: 100 }, 'x.avif')).toEqual({ ok: false, code: 'picture-not-image', file: 'x.avif', format: 'AVIF' });
	});

	it('unknown bytes, and a supported raster format with no size (a damaged file), are not a picture, with no format name', async () => {
		const m = await picturesModule();
		expect(m.judgeHeader({ format: 'unknown', width: null, height: null }, 'x.png')).toEqual({ ok: false, code: 'picture-not-image', file: 'x.png' });
		for (const f of ['png', 'jpeg', 'gif', 'webp', 'bmp'] as const) {
			expect(m.judgeHeader({ format: f, width: null, height: null }, `x.${f}`), f).toEqual({ ok: false, code: 'picture-not-image', file: `x.${f}` });
		}
	});

	it('an SVG with no size is decoded (drawn at the size of its small copy)', async () => {
		const m = await picturesModule();
		expect(m.judgeHeader({ format: 'svg', width: null, height: null }, 'x.svg')).toEqual({ ok: true, format: 'svg' });
	});
});

describe('portraitCrop: the upper-centre square (spec §13.7 "Crop", rule 9)', () => {
	it('a tall picture: its full width, from the top', async () => {
		const m = await picturesModule();
		expect(m.portraitCrop(400, 600)).toEqual({ sx: 0, sy: 0, size: 400 });
		expect(m.portraitCrop(4284, 5712)).toEqual({ sx: 0, sy: 0, size: 4284 });
	});
	it('a wide picture: the centre', async () => {
		const m = await picturesModule();
		expect(m.portraitCrop(600, 400)).toEqual({ sx: 100, sy: 0, size: 400 });
		expect(m.portraitCrop(5712, 4284)).toEqual({ sx: 714, sy: 0, size: 4284 });
	});
	it('a square picture: all of it', async () => {
		const m = await picturesModule();
		expect(m.portraitCrop(300, 300)).toEqual({ sx: 0, sy: 0, size: 300 });
	});
	it('fixture 14: the tall portrait (400 × 600) and the rotated photo (stored 450 × 300, shown 300 × 450 after EXIF 6)', async () => {
		const m = await picturesModule();
		const facts = comments14().pictures;
		const tall = facts.find((f) => f.file === 'roderick-tall.jpg')!;
		expect(m.portraitCrop(tall.width!, tall.height!)).toEqual({ sx: 0, sy: 0, size: 400 });
		const turned = facts.find((f) => f.file === 'edmund-rotated.jpg')!;
		expect(turned.orientation).toBe(6);
		// The crop uses the decoded, rotated size (the decision notes M9): a turned photo is tall again.
		expect(m.portraitCrop(turned.height!, turned.width!)).toEqual({ sx: 0, sy: 0, size: 300 });
	});
});

describe('fitMeet: the whole picture in its box, with its own proportions, centred, never cropped (D75, rule 9)', () => {
	const near = (r: { x: number; y: number; w: number; h: number }, want: typeof r) => {
		for (const k of ['x', 'y', 'w', 'h'] as const) expect(r[k], k).toBeCloseTo(want[k], 9);
	};
	it('a shield taller than the box is fitted by its height', async () => {
		const m = await picturesModule();
		// D78: the Full arms box at 16 px is 20 × 24 px.
		near(m.fitMeet(250, 300, 20, 24), { x: 0, y: 0, w: 20, h: 24 });
		near(m.fitMeet(500, 1000, 20, 24), { x: 4, y: 0, w: 12, h: 24 });
	});
	it('a wide picture is fitted by its width and centred vertically', async () => {
		const m = await picturesModule();
		near(m.fitMeet(400, 100, 64, 64), { x: 0, y: 24, w: 64, h: 16 });
	});
	it('a picture smaller than the box is scaled up to meet it', async () => {
		const m = await picturesModule();
		near(m.fitMeet(10, 10, 64, 32), { x: 16, y: 0, w: 32, h: 32 });
	});
	it('it never leaves the box and keeps the proportions', async () => {
		const m = await picturesModule();
		for (const [w, h, bw, bh] of [
			[250, 300, 24, 28.8],
			[1, 1000, 64, 64],
			[1000, 1, 64, 64],
			[333, 777, 18.333, 22],
		]) {
			const r = m.fitMeet(w, h, bw, bh);
			expect(r.x).toBeGreaterThanOrEqual(-1e-9);
			expect(r.y).toBeGreaterThanOrEqual(-1e-9);
			expect(r.x + r.w).toBeLessThanOrEqual(bw + 1e-9);
			expect(r.y + r.h).toBeLessThanOrEqual(bh + 1e-9);
			expect(r.w / r.h).toBeCloseTo(w / h, 6);
			expect(Math.abs(r.w - bw) < 1e-9 || Math.abs(r.h - bh) < 1e-9).toBe(true);
			expect(r.x).toBeCloseTo(bw - r.x - r.w, 9);
			expect(r.y).toBeCloseTo(bh - r.y - r.h, 9);
		}
	});
});

describe('pictureIssue: params, ids, level and texts (spec §13.6, §13.7 warnings; rule 12, A1, A6)', () => {
	const valmont: PictureOwner = { kind: 'arms', house: { id: 'valmont', name: 'House Valmont' } };
	const aldric: PictureOwner = { kind: 'portrait', person: { id: 'aldric', name: 'Aldric Valmont' } };

	it('params: owner, the house or person name, and the problem values; ids: the house or the person; level warning', async () => {
		const m = await picturesModule();
		expect(m.pictureIssue(valmont, { ok: false, code: 'missing-picture', file: 'x.png' })).toEqual({
			code: 'missing-picture',
			level: 'warning',
			params: { owner: 'arms', house: 'House Valmont', file: 'x.png' },
			ids: ['valmont'],
		});
		expect(m.pictureIssue(aldric, { ok: false, code: 'picture-web' })).toEqual({ code: 'picture-web', level: 'warning', params: { owner: 'portrait', person: 'Aldric Valmont' }, ids: ['aldric'] });
		expect(m.pictureIssue(valmont, { ok: false, code: 'picture-not-image', file: 'x.heic', format: 'HEIC' })).toEqual({
			code: 'picture-not-image',
			level: 'warning',
			params: { owner: 'arms', house: 'House Valmont', file: 'x.heic', format: 'HEIC' },
			ids: ['valmont'],
		});
		expect(m.pictureIssue(aldric, { ok: false, code: 'picture-too-large', file: 'x.png', pixels: 54 })).toEqual({
			code: 'picture-too-large',
			level: 'warning',
			params: { owner: 'portrait', person: 'Aldric Valmont', file: 'x.png', pixels: 54 },
			ids: ['aldric'],
		});
	});

	const text = async (owner: PictureOwner, problem: Parameters<Awaited<ReturnType<typeof picturesModule>>['pictureIssue']>[1]) => issueText((await picturesModule()).pictureIssue(owner, problem));

	it('arms texts, as spec §13.6 writes them', async () => {
		expect(await text(valmont, { ok: false, code: 'missing-picture', file: 'x.png' })).toBe(
			'The arms of House Valmont use the picture “x.png”, but the vault has no file with this name. Correct the link, or select other arms.',
		);
		expect(await text(valmont, { ok: false, code: 'picture-web' })).toBe('The arms of House Valmont are a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(await text(valmont, { ok: false, code: 'picture-not-image', file: 'x.heic', format: 'HEIC' })).toBe(
			'The arms of House Valmont use the picture “x.heic”. The plugin cannot show HEIC pictures. Save the picture as PNG or JPEG. Then select it again.',
		);
		expect(await text(valmont, { ok: false, code: 'picture-not-image', file: 'x.pdf' })).toBe(
			'The arms of House Valmont use the file “x.pdf”, which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
		);
		expect(await text(valmont, { ok: false, code: 'picture-too-large', file: 'x.png', pixels: 54 })).toBe(
			'The arms of House Valmont use the picture “x.png”, which is too large (54 million pixels). Use a picture with 40 million pixels or less.',
		);
	});

	it('A6: too large with no pixel count (a file too large to read) leaves the number out', async () => {
		const m = await picturesModule();
		const issue = m.pictureIssue(valmont, { ok: false, code: 'picture-too-large', file: 'x.png' } as never);
		expect(issue.params.pixels).toBeUndefined();
		expect(issueText(issue)).toBe('The arms of House Valmont use the picture “x.png”, which is too large. Use a picture with 40 million pixels or less.');
	});

	it('portrait texts: "The portrait of NAME" and "select another portrait" (spec §13.7)', async () => {
		expect(await text(aldric, { ok: false, code: 'missing-picture', file: 'aldric.jpg' })).toBe(
			'The portrait of Aldric Valmont uses the picture “aldric.jpg”, but the vault has no file with this name. Correct the link, or select another portrait.',
		);
		expect(await text(aldric, { ok: false, code: 'picture-web' })).toBe('The portrait of Aldric Valmont is a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.');
		expect(await text(aldric, { ok: false, code: 'picture-not-image', file: 'x.avif', format: 'AVIF' })).toBe(
			'The portrait of Aldric Valmont uses the picture “x.avif”. The plugin cannot show AVIF pictures. Save the picture as PNG or JPEG. Then select it again.',
		);
		expect(await text(aldric, { ok: false, code: 'picture-not-image', file: 'x.md' })).toBe(
			'The portrait of Aldric Valmont uses the file “x.md”, which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
		);
		expect(await text(aldric, { ok: false, code: 'picture-too-large', file: 'x.png', pixels: 41 })).toBe(
			'The portrait of Aldric Valmont uses the picture “x.png”, which is too large (41 million pixels). Use a picture with 40 million pixels or less.',
		);
	});

	it('no text shows "undefined", also with odd names and files', async () => {
		const m = await picturesModule();
		const odd: PictureOwner[] = [
			{ kind: 'arms', house: { id: 'x', name: '' } },
			{ kind: 'portrait', person: { id: '~3', name: '~3' } },
		];
		for (const owner of odd) {
			for (const problem of [
				{ ok: false, code: 'missing-picture', file: '' },
				{ ok: false, code: 'picture-web' },
				{ ok: false, code: 'picture-not-image', file: 'a "b".png', format: 'TIFF' },
				{ ok: false, code: 'picture-too-large', file: 'x', pixels: 1e6 },
			] as const) {
				const t = issueText(m.pictureIssue(owner, problem));
				expect(t).not.toMatch(/undefined|NaN|\[object|null/);
				expect(t).not.toBe('The tree has a problem.');
			}
		}
	});
});

describe('sample tree 14: the picture files (spec §13.0 item 12)', () => {
	it('every file named in a `# picture:` comment is in fixtures/pictures/, and the list covers every file there', () => {
		const facts = comments14().pictures.map((f) => `pictures/${f.file}`);
		const files = pictureFiles().filter((f) => !f.startsWith('pictures/07b/'));
		expect([...facts].sort()).toEqual(files);
	});

	it('file names are unique in fixtures/pictures/, 07b included (links find a file by its name)', () => {
		const names = pictureFiles().map((f) => f.slice(f.lastIndexOf('/') + 1).toLowerCase());
		expect(new Set(names).size).toBe(names.length);
	});

	it('the listed kinds are there: arms for 3 houses (PNG, SVG, transparent line-art PNG), a HEIC file, a PDF, a PNG of more than 40 million pixels, a 4000 × 4000 photo, a tall portrait', () => {
		const facts = new Map(comments14().pictures.map((f) => [f.file, f]));
		expect(facts.get('valmont-arms.png')?.format).toBe('png');
		expect(facts.get('orsini-arms.svg')?.format).toBe('svg');
		expect(facts.get('castellane-arms-lineart.png')?.format).toBe('png');
		expect(facts.get('veyle-arms.heic')?.format).toBe('heic');
		expect(facts.get('ashby-charter.pdf')?.format).toBe('unknown');
		const huge = facts.get('huge-banner.png')!;
		expect(huge.width! * huge.height!).toBeGreaterThan(40_000_000);
		expect(facts.get('photo-4000.jpg')).toMatchObject({ format: 'jpeg', width: 4000, height: 4000 });
		const tall = facts.get('roderick-tall.jpg')!;
		expect(tall.height!).toBeGreaterThan(tall.width!);
	});

	it('the line-art arms are transparent around black lines (spec §13.0 item 12)', async () => {
		const rgba = armsCopy64(fixtureBytes('pictures/castellane-arms-lineart.png'), 'image/png');
		let clear = 0;
		for (let i = 0; i < rgba.length; i += 4) {
			if (rgba[i + 3] === 0) clear++;
			else if (rgba[i + 3] > 200) expect(Math.max(rgba[i], rgba[i + 1], rgba[i + 2])).toBeLessThan(40);
		}
		expect(clear).toBeGreaterThan(64 * 64 * 0.5);
	});

	it('the generated byte-level files are what scripts/picture-bytes.ts makes (npm run fixtures)', () => {
		expect(fixtureBytes('pictures/huge-banner.png')).toEqual(blackPng(9000, 6000));
		expect(fixtureBytes('pictures/veyle-arms.heic')).toEqual(heicFile([[4032, 3024]]));
		expect(fixtureBytes('pictures/felicia.heic')).toEqual(heicFile([[512, 512], [3024, 4032]]));
		expect(fixtureBytes('pictures/wren-photo.jpg')).toEqual(heicFile([[4032, 3024]]));
		expect(fixtureBytes('pictures/ashby-charter.pdf')).toEqual(smallPdf());
	});

	it('the header reader finds what each `# picture:` comment says', async () => {
		const m = await picturesModule();
		for (const f of comments14().pictures) {
			const h = m.readPictureHeader(fixtureBytes(`pictures/${f.file}`));
			const want: PictureHeader = { format: f.format as PictureHeader['format'], width: f.width ?? null, height: f.height ?? null };
			if (f.orientation !== undefined) want.orientation = f.orientation;
			expect(h, f.file).toEqual(want);
		}
	});

	it('the picture of more than 40 million pixels is never decoded: the header check stops it (spec §13.6 acceptance)', async () => {
		const m = await picturesModule();
		const h = m.readPictureHeader(fixtureBytes('pictures/huge-banner.png'));
		expect(m.judgeHeader(h, 'huge-banner.png')).toEqual({ ok: false, code: 'picture-too-large', file: 'huge-banner.png', pixels: 54 });
	});
});

describe('sample tree 14: the listed picture warnings and no others (spec §13.6, §13.7 acceptance; contract O1, rule 12)', () => {
	const asWritten = (i: CodedIssue) => ({ code: i.code as string, params: i.params as Record<string, string | number>, ...(i.ids ? { ids: i.ids } : {}) });

	it('block 1: every house and person problem, houses first, each list in order', async () => {
		const m = await picturesModule();
		const issues = pictureProblems(m, treeOf(block14(0)));
		expect(issues.map(asWritten)).toEqual(comments14().warnings);
		for (const i of issues) expect(i.level).toBe('warning');
	});

	it('block 1: the core never makes picture warnings (validate.ts makes no picture checks; rule 12)', () => {
		const codes = ['missing-picture', 'picture-web', 'picture-not-image', 'picture-too-large'];
		const t = treeOf(block14(0));
		expect(t.issues.filter((i) => codes.includes(i.code))).toEqual([]);
	});

	it('block 1: each warning has its own sentence that names the house or the person and the file', async () => {
		const m = await picturesModule();
		const texts = pictureProblems(m, treeOf(block14(0))).map(issueText);
		expect(texts).toEqual([
			'The arms of House Harrow use the picture “harrow-arms.png”, but the vault has no file with this name. Correct the link, or select other arms.',
			'The arms of House Drakemoor are a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.',
			'The arms of House Veyle use the picture “veyle-arms.heic”. The plugin cannot show HEIC pictures. Save the picture as PNG or JPEG. Then select it again.',
			'The arms of House Ashby use the file “ashby-charter.pdf”, which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
			'The arms of House Greymane use the picture “huge-banner.png”, which is too large (54 million pixels). Use a picture with 40 million pixels or less.',
			'The portrait of Wren uses the picture “wren-photo.jpg”. The plugin cannot show HEIC pictures. Save the picture as PNG or JPEG. Then select it again.',
			'The portrait of Oswin Valmont uses the picture “oswin.jpg”, but the vault has no file with this name. Correct the link, or select another portrait.',
			'The portrait of Darian Drakemoor is a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.',
			'The portrait of Felicia Veyle uses the picture “felicia.heic”. The plugin cannot show HEIC pictures. Save the picture as PNG or JPEG. Then select it again.',
			'The portrait of Cedric Ashby uses the file “ashby-charter.pdf”, which is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.',
			'The portrait of Adela Greymane uses the picture “huge-banner.png”, which is too large (54 million pixels). Use a picture with 40 million pixels or less.',
		]);
	});

	it('block 2 (no mark): no picture warnings', async () => {
		const m = await picturesModule();
		expect(pictureProblems(m, treeOf(block14(1)))).toEqual([]);
	});
});
