import { describe, expect, it } from 'vitest';
import { issueText } from '../../src/core/messages';
import { fitMeet, judgeHeader, MAX_PICTURE_PIXELS, pictureFormat, pictureIssue, pictureTarget, portraitCrop, readPictureHeader, type PictureProblem } from '../../src/core/pictures';

// Unit tests for the pure picture helpers of `src/core/pictures.ts` (spec §13.0 item 3, §13.6,
// §13.7; M9 core contract rules 4–9 and 12): the edge cases the acceptance tests do not reach.

const text = (s: string) => new TextEncoder().encode(s);
const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const seg = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
const sof = (w: number, h: number) => seg(0xc0, [8, ...be16(h), ...be16(w), 1, 1, 0x11, 0]);

describe('pictureTarget', () => {
	it('is null for a value that is not text', () => {
		for (const v of [null, 42, {}, [], true]) expect(pictureTarget(v as unknown as string)).toBeNull();
	});

	it('takes the extension from the last path segment, also after a backslash', () => {
		expect(pictureTarget('Pictures\\Arms\\valmont.PNG')).toEqual({ kind: 'vault', path: 'Pictures\\Arms\\valmont.PNG', ext: 'png' });
		expect(pictureTarget('[[Pictures.old/arms.]]')).toEqual({ kind: 'vault', path: 'Pictures.old/arms.', ext: '' });
	});

	it('a Markdown destination with a `)` that closes nothing is not a Markdown link; it is judged as a bare value', () => {
		expect(pictureTarget('[a](b)c.png)')).toEqual({ kind: 'vault', path: '[a](b)c.png)', ext: 'png)' });
		// Balanced, it is a Markdown link (contract A2).
		expect(pictureTarget('[a](b(c).png)')).toEqual({ kind: 'vault', path: 'b(c).png', ext: 'png' });
	});

	it('a web address inside an embed or a Markdown link is still a web address', () => {
		expect(pictureTarget('![[www.example.com/a.png|A]]')).toEqual({ kind: 'web' });
		expect(pictureTarget('[a](//cdn.example.com/a.png)')).toEqual({ kind: 'web' });
	});
});

describe('pictureFormat', () => {
	it('is `other` for a value that is not text and for a name of the Object prototype', () => {
		expect(pictureFormat(undefined as unknown as string)).toEqual({ kind: 'other' });
		for (const e of ['constructor', 'toString', '__proto__']) expect(pictureFormat(e)).toEqual({ kind: 'other' });
	});
});

describe('readPictureHeader', () => {
	it('never throws on a value that is not bytes', () => {
		for (const v of [undefined, null, 'x', [1, 2, 3]]) expect(readPictureHeader(v as unknown as Uint8Array)).toEqual({ format: 'unknown', width: null, height: null });
	});

	it('JPEG: an orientation outside 1–8 is left out', () => {
		const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 9, 0, 0, 0, 0, 0, 0];
		const app1 = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
		expect(readPictureHeader(new Uint8Array([0xff, 0xd8, ...app1, ...sof(30, 20)]))).toEqual({ format: 'jpeg', width: 30, height: 20 });
	});

	it('JPEG: a cut start-of-frame gives no size', () => {
		expect(readPictureHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0]))).toEqual({ format: 'jpeg', width: null, height: null });
	});

	it('BMP: an unknown header size gives no size', () => {
		const b = new Uint8Array(40);
		b.set([0x42, 0x4d]);
		b[14] = 20;
		expect(readPictureHeader(b)).toEqual({ format: 'bmp', width: null, height: null });
	});

	it('SVG: `<svg` only inside a comment, a longer tag name, or after other content is not an SVG', () => {
		expect(readPictureHeader(text('<!-- <svg width="1" height="1"> --><html></html>')).format).toBe('unknown');
		expect(readPictureHeader(text('<svgx width="1" height="1"/>')).format).toBe('unknown');
		expect(readPictureHeader(text('# A note\n<svg width="1" height="1"/>')).format).toBe('unknown');
		expect(readPictureHeader(text('<!-- not closed <svg width="1" height="1"/>')).format).toBe('unknown');
	});

	it('SVG: a DOCTYPE with an internal subset, attributes in any order, and `stroke-width` is not `width`', () => {
		const doctype = '<!DOCTYPE svg [ <!ENTITY a "x>y"> ]>';
		expect(readPictureHeader(text(`${doctype}\n<svg stroke-width="3" height='20' width="10.5px">`))).toEqual({ format: 'svg', width: 10.5, height: 20 });
		expect(readPictureHeader(text('<svg\n  viewBox="0 0 0 10">'))).toEqual({ format: 'svg', width: null, height: null });
		expect(readPictureHeader(text('<svg width="0" height="10" viewBox="0 0 30 40"/>'))).toEqual({ format: 'svg', width: 30, height: 40 });
		// A `>` inside a quoted attribute does not end the tag.
		expect(readPictureHeader(text('<svg data-x="a>b" width="7" height="8">'))).toEqual({ format: 'svg', width: 7, height: 8 });
	});
});

describe('judgeHeader', () => {
	it('a raster picture with a zero or broken size is a damaged file', () => {
		expect(judgeHeader({ format: 'png', width: 0, height: 10 }, 'a.png')).toEqual({ ok: false, code: 'picture-not-image', file: 'a.png' });
		expect(judgeHeader({ format: 'gif', width: Number.NaN, height: 10 }, 'a.gif')).toEqual({ ok: false, code: 'picture-not-image', file: 'a.gif' });
	});

	it('exactly MAX_PICTURE_PIXELS may be decoded; one more is too large', () => {
		expect(judgeHeader({ format: 'bmp', width: 8000, height: MAX_PICTURE_PIXELS / 8000 }, 'a.bmp')).toEqual({ ok: true, format: 'bmp' });
		expect(judgeHeader({ format: 'bmp', width: 8000, height: MAX_PICTURE_PIXELS / 8000 + 1 }, 'a.bmp')).toMatchObject({ code: 'picture-too-large', pixels: 41 });
	});

	it('never throws on odd input', () => {
		expect(judgeHeader(undefined as never, 'x')).toEqual({ ok: false, code: 'picture-not-image', file: 'x' });
		expect(judgeHeader({ format: 'png', width: 1, height: 1 }, 42 as never)).toEqual({ ok: true, format: 'png' });
	});
});

describe('portraitCrop and fitMeet', () => {
	it('portraitCrop starts a wide crop on a whole pixel, and gives an empty square for no picture', () => {
		expect(portraitCrop(601, 400)).toEqual({ sx: 100, sy: 0, size: 400 });
		for (const [w, h] of [
			[0, 10],
			[10, -1],
			[Number.NaN, 5],
		]) expect(portraitCrop(w, h)).toEqual({ sx: 0, sy: 0, size: 0 });
	});

	it('fitMeet gives an empty rect in the centre of the box for no picture or no box', () => {
		expect(fitMeet(0, 10, 20, 24)).toEqual({ x: 10, y: 12, w: 0, h: 0 });
		expect(fitMeet(10, 10, 0, 24)).toEqual({ x: 0, y: 12, w: 0, h: 0 });
		expect(fitMeet(10, 10, Number.NaN, -5)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
	});
});

describe('pictureIssue', () => {
	const arms = { kind: 'arms', house: { id: 'valmont', name: 'House Valmont' } } as const;

	it('leaves out empty or missing values; the problem code stays', () => {
		expect(pictureIssue(arms, { ok: false, code: 'picture-not-image', file: 'x.pdf', format: '' })).toEqual({
			code: 'picture-not-image',
			level: 'warning',
			params: { owner: 'arms', house: 'House Valmont', file: 'x.pdf' },
			ids: ['valmont'],
		});
		expect(pictureIssue(arms, { ok: false, code: 'picture-too-large', file: 'x.png', pixels: Number.NaN }).params).toEqual({ owner: 'arms', house: 'House Valmont', file: 'x.png' });
	});

	it('never throws on odd input, and its text always reads', () => {
		const odd = [undefined, null, {}, { ok: false, code: 'no-such-code' }] as unknown as PictureProblem[];
		for (const problem of odd) {
			const issue = pictureIssue(arms, problem);
			expect(issue.code).toBe('picture-not-image');
			expect(issueText(issue)).not.toMatch(/undefined|null/);
		}
		expect(pictureIssue(undefined as never, { ok: false, code: 'picture-web' })).toEqual({ code: 'picture-web', level: 'warning', params: { owner: 'arms', house: '' }, ids: [''] });
	});
});
