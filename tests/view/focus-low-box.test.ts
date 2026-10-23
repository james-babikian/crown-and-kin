import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/layout/model';
import { familyFits, focusView } from '../../src/view/focus-mode';
import { START_TOP_GAP } from '../../src/render/view-math';

/*
 * G5 fix round (the decision notes "M6 G5 … and the G5 fix round"): the D18 first view in a low box. On a
 * phone on its side the note box is 60 % of 390 px (D30), 234 px. If the parents, the focus person
 * and a child cannot all show below the toolbar band, the first view uses the D13 rule of a person
 * without parents: the person near the top below the band, the children below.
 */

const card = (x: number, y: number): Rect => ({ x, y, w: 180, h: 64 });
const BOUNDS = { x: 0, y: 0, w: 4000, h: 1200 };
// Rows 164 layout px apart (a 64 px card and a 100 px gap), as in sample tree 7 at 16 px names.
const parent = card(2000, 404);
const focus = card(2000, 568);
const child = card(2000, 732);
const LOW = { w: 844, h: 234 };
const BAND = 48;

const on = (v: { scale: number; cx: number; cy: number }, size: { w: number; h: number }) => ({
	x: (x: number) => size.w / 2 + (x - v.cx) * v.scale,
	y: (y: number) => size.h / 2 + (y - v.cy) * v.scale,
});

describe('familyFits', () => {
	it('fits: the centred card has room for the parent above and the child below', () => {
		// At 14 px names (scale 0.875) each side needs (164 + 32) × 0.875 = 171.5 px.
		expect(familyFits(focus, [parent], [child], 0.875, 343)).toBe(true);
		expect(familyFits(focus, [parent], [child], 0.875, 342)).toBe(false);
	});

	it('the parent row that reaches highest and the nearest child count', () => {
		const high = card(1700, 240);
		const far = card(2400, 896);
		expect(familyFits(focus, [parent, high], [child], 0.875, 343)).toBe(false);
		expect(familyFits(focus, [parent], [far, child], 0.875, 343)).toBe(true);
	});

	it('no parent or no child: the centred view loses nothing', () => {
		expect(familyFits(focus, [], [child], 0.875, 10)).toBe(true);
		expect(familyFits(focus, [parent], [], 0.875, 10)).toBe(true);
	});
});

describe('focusView in a low box (D18, D30, phone on its side)', () => {
	it('844 × 234 below a 48 px toolbar band: the card near the top of the free area, the child below it, the parent not in the free area', () => {
		const v = focusView(BOUNDS, LOW, 16, focus, BAND, [child], false, [parent]);
		expect(v.scale * 16).toBeCloseTo(14, 6);
		const s = on(v, LOW);
		expect(s.y(focus.y)).toBeCloseTo(BAND + START_TOP_GAP * v.scale, 6);
		expect(s.x(focus.x + focus.w / 2)).toBeCloseTo(LOW.w / 2, 6);
		expect(s.y(child.y)).toBeGreaterThanOrEqual(s.y(focus.y + focus.h));
		expect(s.y(child.y)).toBeLessThan(LOW.h);
		// No card starts under the toolbar band.
		expect(s.y(parent.y + parent.h)).toBeLessThanOrEqual(0);
	});

	it('the same family in a tall box keeps the D18 centred view', () => {
		const size = { w: 844, h: 600 };
		const v = focusView(BOUNDS, size, 16, focus, BAND, [child], false, [parent]);
		const s = on(v, size);
		expect(s.y(focus.y + focus.h / 2)).toBeCloseTo(BAND + (size.h - BAND) / 2, 6);
		expect(s.y(parent.y)).toBeGreaterThanOrEqual(BAND);
		expect(s.y(child.y + child.h)).toBeLessThanOrEqual(size.h);
	});

	it('without the parents given, the view is as before (centred)', () => {
		const v = focusView(BOUNDS, LOW, 16, focus, BAND, [child]);
		const s = on(v, LOW);
		expect(s.y(focus.y + focus.h / 2)).toBeCloseTo(BAND + (LOW.h - BAND) / 2, 6);
	});
});
