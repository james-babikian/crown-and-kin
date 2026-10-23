import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies } from '../../src/core/derive';
import type { EditResult, Op } from '../../src/core/edit';
import { issueText } from '../../src/core/messages';
import { readPictureHeader } from '../../src/core/pictures';
import { applyOp } from '../../src/core/yaml-edit';
import { topLevelBlocks, fixtureNote } from './load';
import { replaceOnce } from './golden';
import { TFile as VaultFile } from 'obsidian';
import { fakeDoc, resetDom } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { cropModule, graphOf, loadModule, treeOf } from './m10-support';
import { rng } from '../support/rng';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Spec §13.13 (D79, D90, D91), §13.0 items 1 and 10, §13.7 "Crop", and the M10 core contract rules
 * 19–27: reading, formatting, clamping and moving `portrait-crop`; the square the store cuts; the
 * warning `bad-portrait-crop`; the key order, the quotes and the D91 rule in the edit ops. Values
 * are worked out by hand from the spec (fractions of the picture after rotation; the tall portrait
 * of sample tree 14 is 400 × 600 px). These tests wait for WP 10.1.
 */

const B3 = topLevelBlocks(fixtureNote('14'))[2];

/** A small tree with one person, for the key-order cases. */
const tree = (person: string) => `houses:\n  - id: h\n    name: House H\n\npeople:\n${person}`;

/** Every op that `applyOp` accepts after WP 10.1 (`portrait-crop` in the person fields). */
type CropOp =
	| Op
	| { kind: 'set-person-fields'; id: string; fields: Record<string, string | boolean | null> }
	| { kind: 'add-person'; id: string; fields: Record<string, string | boolean | null>; parents?: { id: string; type: 'birth' | 'adoptive' | 'ward' | 'rumoured' }[] };
const apply = (body: string, op: CropOp): EditResult => applyOp(body, op as Op);
const bodyOf = (r: EditResult): string => {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const set = (body: string, id: string, fields: Record<string, string | boolean | null>) => apply(body, { kind: 'set-person-fields', id, fields });

describe('rules 19 and 20: reading the text of `portrait-crop`', () => {
	it('three numbers with single spaces are ok', async () => {
		const { readPortraitCrop } = await cropModule();
		expect(readPortraitCrop('0.12 0.05 0.6')).toEqual({ kind: 'ok', crop: { left: 0.12, top: 0.05, side: 0.6 } });
		expect(readPortraitCrop('0 0 1')).toEqual({ kind: 'ok', crop: { left: 0, top: 0, side: 1 } });
	});

	it('runs of white space (spaces and tabs) separate the numbers', async () => {
		const { readPortraitCrop } = await cropModule();
		expect(readPortraitCrop('0.1\t0.2   0.5')).toEqual({ kind: 'ok', crop: { left: 0.1, top: 0.2, side: 0.5 } });
	});

	it('the number forms: "-0.1", ".5" and "5." match; a leading zero is not needed', async () => {
		const { readPortraitCrop } = await cropModule();
		expect(readPortraitCrop('-0.1 .25 .5')).toEqual({ kind: 'ok', crop: { left: -0.1, top: 0.25, side: 0.5 } });
		expect(readPortraitCrop('0 0 1.')).toEqual({ kind: 'ok', crop: { left: 0, top: 0, side: 1 } });
	});

	it('no text is absent', async () => {
		const { readPortraitCrop } = await cropModule();
		expect(readPortraitCrop(undefined)).toEqual({ kind: 'absent' });
		expect(readPortraitCrop('')).toEqual({ kind: 'absent' });
	});

	it('a comma is not a separator: "0.1, 0.2, 0.5" is bad', async () => {
		const { readPortraitCrop } = await cropModule();
		expect(readPortraitCrop('0.1, 0.2, 0.5')).toEqual({ kind: 'bad' });
		expect(readPortraitCrop('0.1,0.2,0.5')).toEqual({ kind: 'bad' });
	});

	it('a number alone, two numbers and four numbers are bad', async () => {
		const { readPortraitCrop } = await cropModule();
		for (const text of ['0.5', '0.1 0.2', '0.1 0.2 0.3 0.4']) expect(readPortraitCrop(text), text).toEqual({ kind: 'bad' });
	});

	it('an exponent, a hex number, "Infinity", "NaN" and words are bad', async () => {
		const { readPortraitCrop } = await cropModule();
		for (const text of ['1e-1 0 0.5', '0x1 0 0.5', 'Infinity 0 0.5', '0 0 Infinity', 'NaN 0 0.5', 'a b c', '0.1 0.2 half', '--1 0 0.5', '1..5 0 0.5']) {
			expect(readPortraitCrop(text), text).toEqual({ kind: 'bad' });
		}
	});

	it('a side of 0 or less is bad', async () => {
		const { readPortraitCrop } = await cropModule();
		for (const text of ['0.2 0.2 0', '0.2 0.2 0.0', '0.2 0.2 -0.5']) expect(readPortraitCrop(text), text).toEqual({ kind: 'bad' });
	});

	it('a side above 0 and under 0.1 is not bad (spec §13.13: it is read as 0.1; the clamp makes it 0.1)', async () => {
		const { readPortraitCrop, clampCrop } = await cropModule();
		const r = readPortraitCrop('0.5 0.5 0.05');
		expect(r.kind).toBe('ok');
		if (r.kind !== 'ok') return;
		// Whether `read` or `clamp` makes the 0.1 is not fixed by rule 20 or 21; both must give 0.1 at the end.
		expect([0.05, 0.1]).toContain(r.crop.side);
		expect(clampCrop(r.crop, 400, 600).side).toBe(0.1);
	});

	it('never throws, for any text', async () => {
		const { readPortraitCrop } = await cropModule();
		const next = rng(10);
		const parts = ['0', '0.5', '1', '-1', '.5', '5.', 'x', '', ',', '1e3', '0x10', 'Infinity', ' ', '٣', '0.1,', '\n'];
		for (let i = 0; i < 400; i++) {
			const text = Array.from({ length: Math.floor(next() * 6) }, () => parts[Math.floor(next() * parts.length)]).join(next() < 0.7 ? ' ' : '');
			expect(() => readPortraitCrop(text), JSON.stringify(text)).not.toThrow();
		}
	});
});

describe('rule 22: writing (`formatPortraitCrop`)', () => {
	it('up to 4 decimals, no trailing zeros, single spaces', async () => {
		const { formatPortraitCrop } = await cropModule();
		expect(formatPortraitCrop({ left: 0.12, top: 0.05, side: 0.6 })).toBe('0.12 0.05 0.6');
		expect(formatPortraitCrop({ left: 0, top: 0, side: 1 })).toBe('0 0 1');
		expect(formatPortraitCrop({ left: 1 / 3, top: 2 / 3, side: 0.5 })).toBe('0.3333 0.6667 0.5');
		expect(formatPortraitCrop({ left: 0.123456, top: 0.5, side: 0.99999 })).toBe('0.1235 0.5 1');
	});

	it('a tiny number is written as 0, not "-0" or an exponent', async () => {
		const { formatPortraitCrop } = await cropModule();
		expect(formatPortraitCrop({ left: 0.00001, top: -0.00001, side: 0.5 })).toBe('0 0 0.5');
		expect(formatPortraitCrop({ left: 1e-9, top: 0, side: 0.5 })).toBe('0 0 0.5');
	});

	it('what it writes reads back as the same rounded numbers', async () => {
		const { formatPortraitCrop, readPortraitCrop } = await cropModule();
		const next = rng(22);
		for (let i = 0; i < 300; i++) {
			const crop = { left: next(), top: next(), side: 0.1 + next() * 0.9 };
			const back = readPortraitCrop(formatPortraitCrop(crop));
			expect(back.kind).toBe('ok');
			if (back.kind !== 'ok') continue;
			for (const k of ['left', 'top', 'side'] as const) expect(back.crop[k]).toBeCloseTo(crop[k], 4);
		}
	});
});

describe('rule 21: `clampCrop`', () => {
	it('a part inside the picture and within the zoom limits does not change (sample tree 14, Roderick)', async () => {
		const { clampCrop } = await cropModule();
		expect(clampCrop({ left: 0.1, top: 0.4, side: 0.5 }, 400, 600)).toEqual({ left: 0.1, top: 0.4, side: 0.5 });
	});

	it('a side above 1 is 1; a side under 0.1 is 0.1 (D79 "Zoom limits")', async () => {
		const { clampCrop } = await cropModule();
		expect(clampCrop({ left: 0, top: 0, side: 1.7 }, 400, 600).side).toBe(1);
		expect(clampCrop({ left: 0.5, top: 0.5, side: 0.05 }, 400, 600).side).toBe(0.1);
		expect(clampCrop({ left: 0.5, top: 0.5, side: 0.1 }, 400, 600).side).toBe(0.1);
	});

	it('a square that leaves the picture is moved (Odette: 0.9 0.9 0.8 on 400 × 600 becomes 0.2, 1 − 320 / 600, 0.8)', async () => {
		const { clampCrop } = await cropModule();
		const c = clampCrop({ left: 0.9, top: 0.9, side: 0.8 }, 400, 600);
		expect(c.side).toBe(0.8);
		expect(c.left).toBeCloseTo(0.2, 9);
		expect(c.top).toBeCloseTo(1 - 320 / 600, 9);
	});

	it('the side is a fraction of the shorter side: on a wide picture (600 × 400) the top is at most 0', async () => {
		const { clampCrop } = await cropModule();
		const c = clampCrop({ left: 0.9, top: 0.9, side: 1 }, 600, 400);
		expect(c.left).toBeCloseTo(1 - 400 / 600, 9);
		expect(c.top).toBe(0);
		expect(clampCrop({ left: 0.5, top: 0.5, side: 0.5 }, 600, 400)).toEqual({ left: 0.5, top: 0.5, side: 0.5 });
	});

	it('a negative left or top is moved to 0', async () => {
		const { clampCrop } = await cropModule();
		const c = clampCrop({ left: -0.3, top: -1, side: 0.5 }, 400, 600);
		expect(c.left).toBe(0);
		expect(c.top).toBe(0);
	});

	it('w or h that is 0, negative, NaN or infinite gives the automatic part { left: 0, top: 0, side: 1 }', async () => {
		const { clampCrop } = await cropModule();
		for (const [w, h] of [
			[0, 600],
			[400, 0],
			[-5, 600],
			[400, -1],
			[Number.NaN, 600],
			[400, Number.NaN],
			[Number.POSITIVE_INFINITY, 600],
			[400, Number.POSITIVE_INFINITY],
		] as const) {
			expect(clampCrop({ left: 0.3, top: 0.3, side: 0.4 }, w, h), `${w} × ${h}`).toEqual({ left: 0, top: 0, side: 1 });
		}
	});

	it('the result is inside the picture and clamping twice gives the same result (idempotent)', async () => {
		const { clampCrop } = await cropModule();
		const next = rng(21);
		for (let i = 0; i < 500; i++) {
			const w = 1 + Math.floor(next() * 5000);
			const h = 1 + Math.floor(next() * 5000);
			const crop = { left: next() * 3 - 1, top: next() * 3 - 1, side: next() * 3 - 0.5 };
			const once = clampCrop(crop, w, h);
			const px = once.side * Math.min(w, h);
			expect(once.side).toBeGreaterThanOrEqual(0.1);
			expect(once.side).toBeLessThanOrEqual(1);
			expect(once.left).toBeGreaterThanOrEqual(0);
			expect(once.top).toBeGreaterThanOrEqual(0);
			expect(once.left * w + px).toBeLessThanOrEqual(w + 1e-6);
			expect(once.top * h + px).toBeLessThanOrEqual(h + 1e-6);
			const twice = clampCrop(once, w, h);
			for (const k of ['left', 'top', 'side'] as const) expect(twice[k], `${k} of ${JSON.stringify(crop)} on ${w} × ${h}`).toBeCloseTo(once[k], 12);
		}
	});
});

describe('rule 23: the automatic part', () => {
	it('a tall picture: the full width from the top; a square picture: the whole picture', async () => {
		const { automaticCrop } = await cropModule();
		expect(automaticCrop(400, 600)).toEqual({ left: 0, top: 0, side: 1 });
		expect(automaticCrop(300, 300)).toEqual({ left: 0, top: 0, side: 1 });
	});

	it('a wide picture: the centre; the left edge is rounded down to whole px', async () => {
		const { automaticCrop } = await cropModule();
		const even = automaticCrop(600, 400);
		expect(even.side).toBe(1);
		expect(even.top).toBe(0);
		expect(even.left).toBeCloseTo(100 / 600, 12);
		// (601 − 400) / 2 = 100.5, rounded down to 100 px.
		expect(automaticCrop(601, 400).left).toBeCloseTo(100 / 601, 12);
	});

	it('w or h that is not finite or 0 or less gives { left: 0, top: 0, side: 1 }', async () => {
		const { automaticCrop } = await cropModule();
		for (const [w, h] of [
			[0, 400],
			[600, -2],
			[Number.NaN, 400],
			[600, Number.POSITIVE_INFINITY],
		] as const) {
			expect(automaticCrop(w, h)).toEqual({ left: 0, top: 0, side: 1 });
		}
	});

	it('isAutomaticCrop: true within 0.00005 of the automatic part, false beyond', async () => {
		const { isAutomaticCrop, automaticCrop, formatPortraitCrop, readPortraitCrop } = await cropModule();
		expect(isAutomaticCrop({ left: 0, top: 0, side: 1 }, 400, 600)).toBe(true);
		expect(isAutomaticCrop({ left: 0.00004, top: 0, side: 1 }, 400, 600)).toBe(true);
		expect(isAutomaticCrop({ left: 0.0001, top: 0, side: 1 }, 400, 600)).toBe(false);
		expect(isAutomaticCrop({ left: 0, top: 0, side: 0.9 }, 400, 600)).toBe(false);
		expect(isAutomaticCrop({ left: 0.17, top: 0, side: 1 }, 600, 400)).toBe(false);
		// The 4-decimal text of the automatic part still counts as automatic (600 × 400: left 1/6 = 0.16667, written 0.1667).
		const text = formatPortraitCrop(automaticCrop(600, 400));
		expect(text).toBe('0.1667 0 1');
		const back = readPortraitCrop(text);
		expect(back.kind === 'ok' && isAutomaticCrop(back.crop, 600, 400)).toBe(true);
	});
});

describe('rule 24: `cropSquare` and `portraitCropOf`', () => {
	it('no crop is the upper-centre square of spec §13.7', async () => {
		const { cropSquare } = await cropModule();
		expect(cropSquare(null, 400, 600)).toEqual({ sx: 0, sy: 0, size: 400 });
		expect(cropSquare(null, 600, 400)).toEqual({ sx: 100, sy: 0, size: 400 });
		expect(cropSquare(null, 300, 300)).toEqual({ sx: 0, sy: 0, size: 300 });
		expect(cropSquare(null, 601, 400)).toEqual({ sx: 100, sy: 0, size: 400 });
	});

	it('sample tree 14, block 3: the squares in the fixture comments on the 400 × 600 tall portrait', async () => {
		const { cropSquare, readPortraitCrop } = await cropModule();
		const bytes = new Uint8Array(readFileSync(new URL('../../fixtures/pictures/roderick-tall.jpg', import.meta.url)));
		const head = readPictureHeader(bytes);
		expect(head.width).toBe(400);
		expect(head.height).toBe(600);
		const t = treeOf(B3);
		const squareOf = (id: string) => {
			const text = (t.people.find((p) => p.id === id) as { portraitCrop?: string } | undefined)?.portraitCrop;
			const r = readPortraitCrop(text);
			if (r.kind !== 'ok') throw new Error(`${id}: ${r.kind}`);
			return cropSquare(r.crop, 400, 600);
		};
		expect(squareOf('roderick')).toEqual({ sx: 40, sy: 240, size: 200 });
		// The square that leaves the picture is moved and made smaller until it fits.
		expect(squareOf('odette')).toEqual({ sx: 80, sy: 280, size: 320 });
		// A side of 0.05 is 0.1 of the shorter side: 40 px.
		expect(squareOf('piers')).toEqual({ sx: 200, sy: 300, size: 40 });
	});

	it('the square has whole numbers, lies inside the picture and has a size of at least 1', async () => {
		const { cropSquare } = await cropModule();
		const next = rng(24);
		for (let i = 0; i < 500; i++) {
			const w = 1 + Math.floor(next() * 3000);
			const h = 1 + Math.floor(next() * 3000);
			const crop = next() < 0.2 ? null : { left: next() * 2 - 0.5, top: next() * 2 - 0.5, side: next() * 1.4 };
			const sq = cropSquare(crop, w, h);
			const label = `${JSON.stringify(crop)} on ${w} × ${h}: ${JSON.stringify(sq)}`;
			for (const v of [sq.sx, sq.sy, sq.size]) expect(Number.isInteger(v), label).toBe(true);
			expect(sq.size, label).toBeGreaterThanOrEqual(1);
			expect(sq.sx, label).toBeGreaterThanOrEqual(0);
			expect(sq.sy, label).toBeGreaterThanOrEqual(0);
			expect(sq.sx + sq.size, label).toBeLessThanOrEqual(w);
			expect(sq.sy + sq.size, label).toBeLessThanOrEqual(h);
		}
	});

	it('a tiny picture still gives a square of at least 1 px', async () => {
		const { cropSquare } = await cropModule();
		const sq = cropSquare({ left: 0, top: 0, side: 0.1 }, 5, 5);
		expect(sq.size).toBeGreaterThanOrEqual(1);
		expect(sq.sx + sq.size).toBeLessThanOrEqual(5);
	});

	it('portraitCropOf: null with no portrait, no crop or a bad crop; a crop with no portrait is ignored', async () => {
		const { portraitCropOf } = await cropModule();
		expect(portraitCropOf({ portrait: '[[a.jpg]]', portraitCrop: '0.1 0.4 0.5' })).toEqual({ left: 0.1, top: 0.4, side: 0.5 });
		expect(portraitCropOf({ portrait: '[[a.jpg]]' })).toBeNull();
		expect(portraitCropOf({ portrait: '[[a.jpg]]', portraitCrop: '0.1, 0.4, 0.5' })).toBeNull();
		expect(portraitCropOf({ portrait: '[[a.jpg]]', portraitCrop: '0.2 0.2 0' })).toBeNull();
		expect(portraitCropOf({ portraitCrop: '0.1 0.4 0.5' })).toBeNull();
		expect(portraitCropOf({})).toBeNull();
	});
});

describe('`moveCrop` and `zoomCrop` (crop tool, C4)', () => {
	it('move: dx and dy are picture px; the part moves by dx / w and dy / h (400 × 600)', async () => {
		const { moveCrop } = await cropModule();
		const c = moveCrop({ left: 0.1, top: 0.4, side: 0.5 }, 40, 60, 400, 600);
		expect(c.left).toBeCloseTo(0.2, 9);
		expect(c.top).toBeCloseTo(0.5, 9);
		expect(c.side).toBe(0.5);
		const back = moveCrop(c, -40, -60, 400, 600);
		expect(back.left).toBeCloseTo(0.1, 9);
		expect(back.top).toBeCloseTo(0.4, 9);
	});

	it('move: clamps at the edges of the picture', async () => {
		const { moveCrop } = await cropModule();
		const far = moveCrop({ left: 0.1, top: 0.4, side: 0.5 }, 10000, 10000, 400, 600);
		expect(far.left).toBeCloseTo(0.5, 9); // 1 − 200 / 400
		expect(far.top).toBeCloseTo(1 - 200 / 600, 9);
		const near = moveCrop({ left: 0.1, top: 0.4, side: 0.5 }, -10000, -10000, 400, 600);
		expect(near.left).toBe(0);
		expect(near.top).toBe(0);
	});

	it('zoom in about the centre of the frame keeps the picture point under the centre (400 × 600, part 80/120 px, 200 px)', async () => {
		const { zoomCrop } = await cropModule();
		// Centre point (180, 220) px; the new side is 0.25 (100 px), so the part starts at (130, 170) px.
		const c = zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 2, { x: 0.5, y: 0.5 }, 400, 600);
		expect(c.side).toBeCloseTo(0.25, 9);
		expect(c.left).toBeCloseTo(130 / 400, 9);
		expect(c.top).toBeCloseTo(170 / 600, 9);
	});

	it('zoom about a corner of the frame keeps that corner point', async () => {
		const { zoomCrop } = await cropModule();
		const topLeft = zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 2, { x: 0, y: 0 }, 400, 600);
		expect(topLeft.left).toBeCloseTo(0.2, 9);
		expect(topLeft.top).toBeCloseTo(0.2, 9);
		// Bottom right point (280, 320) px; the part starts at (180, 220) px.
		const bottomRight = zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 2, { x: 1, y: 1 }, 400, 600);
		expect(bottomRight.left).toBeCloseTo(180 / 400, 9);
		expect(bottomRight.top).toBeCloseTo(220 / 600, 9);
	});

	it('zoom out (a factor under 1) makes the part larger about the centre', async () => {
		const { zoomCrop } = await cropModule();
		// Factor 0.8: side 0.5 / 0.8 = 0.625 (250 px); centre (180, 220) px; the part starts at (55, 95) px.
		const c = zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 0.8, { x: 0.5, y: 0.5 }, 400, 600);
		expect(c.side).toBeCloseTo(0.625, 9);
		expect(c.left).toBeCloseTo(55 / 400, 9);
		expect(c.top).toBeCloseTo(95 / 600, 9);
	});

	it('zoom is clamped: never under 0.1 and never above 1, and the part stays inside the picture', async () => {
		const { zoomCrop } = await cropModule();
		expect(zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 1000, { x: 0.5, y: 0.5 }, 400, 600).side).toBeCloseTo(0.1, 12);
		const out = zoomCrop({ left: 0.2, top: 0.2, side: 0.5 }, 0.001, { x: 0.5, y: 0.5 }, 400, 600);
		expect(out.side).toBe(1);
		expect(out.left).toBe(0);
		expect(out.top).toBeGreaterThanOrEqual(0);
		expect(out.top).toBeLessThanOrEqual(1 - 400 / 600 + 1e-9);
	});
});

describe('rule 25: the warning `bad-portrait-crop` (validateTree)', () => {
	it('sample tree 14, block 3: one warning for each bad value with a portrait, and none for the crop without a portrait', () => {
		const g = graphOf(B3);
		expect(g.issues.map((i) => [i.code, i.level, i.ids])).toEqual([
			['bad-portrait-crop', 'warning', ['bertrand']],
			['bad-portrait-crop', 'warning', ['hilda']],
		]);
		expect(g.issues.map((i) => i.params.person)).toEqual(['Bertrand Valmont', 'Hilda Valmont']);
	});

	it('the text of spec §13.13', () => {
		const g = graphOf(B3);
		expect(issueText(g.issues[0])).toBe(
			'The plugin cannot read the selected part of the portrait of Bertrand Valmont, so the card shows the automatic part. Select the part again, or remove “portrait-crop”.',
		);
	});

	it('a good value, an absent value and a value outside the picture give no warning', () => {
		const good = tree('  - id: a\n    name: A\n    portrait: "[[a.jpg]]"\n    portrait-crop: "0.1 0.2 0.5"\n  - id: b\n    name: B\n    portrait: "[[b.jpg]]"\n  - id: c\n    name: C\n    portrait: "[[c.jpg]]"\n    portrait-crop: "0.9 0.9 0.9"\n');
		expect(deriveFamilies(treeOf(good)).issues).toEqual([]);
	});

	it('the other bad forms with a portrait: a number alone, a list, a map and an exponent', () => {
		const one = (value: string) => deriveFamilies(treeOf(tree(`  - id: a\n    name: A\n    portrait: "[[a.jpg]]"\n    portrait-crop: ${value}\n`))).issues.map((i) => i.code);
		for (const value of ['0.5', '"0.5"', '[0.1, 0.2, 0.5]', '{left: 0.1}', '"1e-1 0 0.5"', '"0.1 0.2"']) expect(one(value), value).toEqual(['bad-portrait-crop']);
		expect(one('""')).toEqual([]);
	});

	it('the samples of other milestones give no bad-portrait-crop issue', () => {
		expect(graphOf(topLevelBlocks(fixtureNote('14'))[0]).issues.map((i) => i.code)).not.toContain('bad-portrait-crop');
		expect(graphOf(topLevelBlocks(fixtureNote('14'))[1]).issues).toEqual([]);
	});
});

describe('rules 19 and 26: `Person.portraitCrop` (parse) and the key order', () => {
	it('sample tree 14, block 3: the text as written; absent when not written', () => {
		const t = treeOf(B3);
		const text = (id: string) => (t.people.find((p) => p.id === id) as { portraitCrop?: string } | undefined)?.portraitCrop;
		expect(text('roderick')).toBe('0.1 0.4 0.5');
		expect(text('bertrand')).toBe('0.1, 0.4, 0.5');
		expect(text('gunnar')).toBe('0.1 0.4 0.5');
		const blocks = topLevelBlocks(fixtureNote('14'));
		const first = treeOf(blocks[0]);
		expect('portraitCrop' in first.people[0]).toBe(false);
	});

	it('a list or a map is held as its JSON text; a number alone is held as text; an empty value is absent', () => {
		const one = (value: string) => (treeOf(tree(`  - id: a\n    name: A\n    portrait-crop: ${value}\n`)).people[0] as { portraitCrop?: string }).portraitCrop;
		expect(JSON.parse(one('[0.1, 0.2, 0.5]')!)).toEqual([0.1, 0.2, 0.5]);
		expect(JSON.parse(one('{left: 0.1}')!)).toEqual({ left: 0.1 });
		expect(one('0.5')).toBe('0.5');
		expect(one('""')).toBeUndefined();
		expect(one('')).toBeUndefined();
	});

	it('the fixed key order: "…, link, portrait, portrait-crop, notes" (a new key goes after the nearest earlier key)', () => {
		const withNotes = tree('  - id: a\n    name: A\n    portrait: "[[a.jpg]]"\n    notes: Some notes.\n');
		expect(bodyOf(set(withNotes, 'a', { 'portrait-crop': '0.1 0.2 0.5' }))).toBe(replaceOnce(withNotes, '    portrait: "[[a.jpg]]"\n', '    portrait: "[[a.jpg]]"\n    portrait-crop: "0.1 0.2 0.5"\n'));
		const noPortrait = tree('  - id: a\n    name: A\n    born: 1100\n    notes: Some notes.\n');
		expect(bodyOf(set(noPortrait, 'a', { 'portrait-crop': '0.1 0.2 0.5' }))).toBe(replaceOnce(noPortrait, '    born: 1100\n', '    born: 1100\n    portrait-crop: "0.1 0.2 0.5"\n'));
		const withLink = tree('  - id: a\n    name: A\n    link: "[[A]]"\n    notes: Some notes.\n');
		expect(bodyOf(set(withLink, 'a', { 'portrait-crop': '0.1 0.2 0.5' }))).toBe(replaceOnce(withLink, '    link: "[[A]]"\n', '    link: "[[A]]"\n    portrait-crop: "0.1 0.2 0.5"\n'));
	});

	it('a flow-map person gets the key in the same place, in double quotes', () => {
		const flow = tree('  - {id: a, name: A, portrait: "[[a.jpg]]", notes: x}\n');
		expect(bodyOf(set(flow, 'a', { 'portrait-crop': '0.1 0.2 0.5' }))).toBe(replaceOnce(flow, '"[[a.jpg]]", notes', '"[[a.jpg]]", portrait-crop: "0.1 0.2 0.5", notes'));
	});
});

describe('rule 27: `set-person-fields` and `add-person` with `portrait-crop`', () => {
	it('a changed part replaces only its value, in double quotes; a comment stays', () => {
		expect(bodyOf(set(B3, 'roderick', { 'portrait-crop': '0.2 0.3 0.4' }))).toBe(
			replaceOnce(B3, '    portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', '    portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.2 0.3 0.4"\n'),
		);
		const single = tree("  - id: a\n    name: A\n    portrait: \"[[a.jpg]]\"\n    portrait-crop: '0.1 0.2 0.5'   # kept comment\n");
		expect(bodyOf(set(single, 'a', { 'portrait-crop': '0.3 0.3 0.3' }))).toBe(replaceOnce(single, "'0.1 0.2 0.5'", '"0.3 0.3 0.3"'));
	});

	it('null removes the key and only its lines', () => {
		expect(bodyOf(set(B3, 'roderick', { 'portrait-crop': null }))).toBe(
			replaceOnce(B3, '    portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', '    portrait: "![[roderick-tall.jpg]]"\n'),
		);
		// Nothing to remove: nothing changes.
		const plain = tree('  - id: a\n    name: A\n');
		expect(bodyOf(set(plain, 'a', { 'portrait-crop': null }))).toBe(plain);
	});

	it('two values are the same (no write) when their rounded numbers are equal, also when the source text differs', () => {
		const typed = tree('  - id: a\n    name: A\n    portrait: "[[a.jpg]]"\n    portrait-crop: "0.10 0.400 0.5000"\n');
		expect(bodyOf(set(typed, 'a', { 'portrait-crop': '0.1 0.4 0.5' }))).toBe(typed);
		expect(bodyOf(set(B3, 'roderick', { 'portrait-crop': '0.1 0.4 0.5' }))).toBe(B3);
		// 0.10004 rounds to 0.1 at 4 decimals.
		expect(bodyOf(set(B3, 'roderick', { 'portrait-crop': '0.10004 0.4 0.5' }))).toBe(B3);
		// A value that differs after rounding does write (0.1001 is not 0.1).
		expect(bodyOf(set(B3, 'roderick', { 'portrait-crop': '0.1001 0.4 0.5' }))).toBe(replaceOnce(B3, '"0.1 0.4 0.5"\n  - id: odette', '"0.1001 0.4 0.5"\n  - id: odette'));
	});

	it('D91: a new portrait removes an existing portrait-crop in the same write', () => {
		expect(bodyOf(set(B3, 'roderick', { portrait: '[[new.jpg]]' }))).toBe(
			replaceOnce(B3, '    portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', '    portrait: "[[new.jpg]]"\n'),
		);
	});

	it('D91: removing the portrait (null) removes the portrait-crop too', () => {
		const p = tree('  - id: a\n    name: A\n    link: "[[A]]"\n    portrait: "[[a.jpg]]"\n    portrait-crop: "0.1 0.2 0.5"\n    notes: x\n');
		expect(bodyOf(set(p, 'a', { portrait: null }))).toBe(replaceOnce(p, '    portrait: "[[a.jpg]]"\n    portrait-crop: "0.1 0.2 0.5"\n', ''));
		// The same for the portrait of sample tree 14: both keys go, the other people stay.
		const out = bodyOf(set(B3, 'roderick', { portrait: null }));
		expect(out).not.toContain('portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"');
		expect(out).toContain('portrait-crop: "0.9 0.9 0.8"');
	});

	it('D91: an explicit portrait-crop in the same fields wins (a new picture with a new part in one save)', () => {
		expect(bodyOf(set(B3, 'roderick', { portrait: '[[new.jpg]]', 'portrait-crop': '0.3 0.3 0.3' }))).toBe(
			replaceOnce(B3, '    portrait: "![[roderick-tall.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', '    portrait: "[[new.jpg]]"\n    portrait-crop: "0.3 0.3 0.3"\n'),
		);
	});

	it('D91: a portrait equal to the read value writes nothing and keeps the crop', () => {
		expect(bodyOf(set(B3, 'roderick', { portrait: '![[roderick-tall.jpg]]' }))).toBe(B3);
		// A different picture with the same person does remove it (the rule above).
		expect(bodyOf(set(B3, 'roderick', { portrait: '[[other.jpg]]' }))).not.toContain('portrait-crop: "0.1 0.4 0.5"\n  - id: odette');
	});

	it('D91: a new portrait for a person with no crop writes only the portrait', () => {
		const p = tree('  - id: a\n    name: A\n    portrait: "[[a.jpg]]"\n    notes: x\n');
		expect(bodyOf(set(p, 'a', { portrait: '[[b.jpg]]' }))).toBe(replaceOnce(p, '[[a.jpg]]', '[[b.jpg]]'));
	});

	it('D91 does not remove another person\'s crop', () => {
		const out = bodyOf(set(B3, 'roderick', { portrait: '[[new.jpg]]' }));
		expect(out).not.toContain('portrait-crop: "0.1 0.4 0.5"\n  - id: odette');
		expect(out).toContain('portrait-crop: "0.9 0.9 0.8"');
		expect(out).toContain('portrait-crop: "0.5 0.5 0.05"');
	});

	it('add-person: a new person with a portrait and a part, keys in order', () => {
		const r = apply(B3, { kind: 'add-person', id: 'ysolde', fields: { name: 'Ysolde Valmont', portrait: '[[ysolde.png]]', 'portrait-crop': '0.1 0.2 0.5', house: 'valmont' } });
		expect(bodyOf(r)).toBe(`${B3}  - id: ysolde\n    name: Ysolde Valmont\n    house: valmont\n    portrait: "[[ysolde.png]]"\n    portrait-crop: "0.1 0.2 0.5"\n`);
	});

	it('rewrite-links (a renamed picture file) changes `portrait` and never touches `portrait-crop`', () => {
		const r = apply(B3, { kind: 'rewrite-links', map: { 'roderick-tall.jpg': 'roderick-2.jpg' } });
		const out = bodyOf(r);
		expect(out).toBe(B3.split('roderick-tall.jpg').join('roderick-2.jpg'));
		expect(out.match(/portrait-crop:.*/g)).toEqual(B3.match(/portrait-crop:.*/g));
	});
});

describe('spec §13.13 acceptance: the headless SVG shows the selected part', () => {
	// This was a skipped test that waited for a JPEG decoder. Resvg decodes the JPEG in a test, so the check now runs in
	// `m10-g5-saved.test.ts` ("the headless SVG shows the selected part"): the square (40, 240, 200) of `roderick-tall.jpg` is cut,
	// it is compared with the pixels of the picture, and `renderSvg` puts it into the card of Roderick.
	it('the fixture comment gives the square (40, 240, 200) for Roderick (the cut is checked in m10-g5-saved.test.ts)', () => {
		expect(B3).toContain('# crop: roderick | read=ok; square=40,240,200; warning=no');
	});
});

/* Adopted from the M10 review A (finding 2) and review C (crop tool focus). They wait for the fix round. */
describe('review A: a crop that the tool wrote still counts as the automatic part (spec §13.13, D91)', () => {
	it('the automatic crop written with 4 decimals and read back is automatic', async () => {
		const { automaticCrop, formatPortraitCrop, isAutomaticCrop, readPortraitCrop } = await cropModule();
		// Automatic left is 185/4000 = 0.04625 exactly; written at 4 decimals it is 0.0463 or 0.0462, 0.00005 away.
		const w = 4000;
		const h = 3629;
		const written = readPortraitCrop(formatPortraitCrop(automaticCrop(w, h)));
		expect(written.kind).toBe('ok');
		if (written.kind === 'ok') expect(isAutomaticCrop(written.crop, w, h)).toBe(true);
	});
});

describe('review C: the crop tool takes the keyboard focus (spec §13.13)', () => {
	useFakeDom({ window: true });
	beforeEach(() => {
		resetDom();
		resetObsidian();
	});
	afterEach(() => vi.restoreAllMocks());

	it('puts the keyboard focus on the picture area when it opens, so the arrow keys work at once', async () => {
		const { openCropTool } = await loadModule<{ openCropTool: (o: unknown) => Promise<unknown> }>('../../src/obsidian/crop-tool', 'src/obsidian/crop-tool.ts', 'WP 10.3a', ['openCropTool']);
		const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
		const store = { transient: async () => null };
		void openCropTool({ app: {}, file: new File('a.png', 'png'), store, personName: 'A', start: null });
		await new Promise<void>((r) => setTimeout(r, 0));
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: { querySelector(s: string): unknown } };
		expect(fakeDoc.activeElement).toBe(modal.contentEl.querySelector('.dynasty-crop-area'));
	});
});
