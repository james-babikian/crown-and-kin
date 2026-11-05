import { describe, expect, it } from 'vitest';
import { FIT_MARGIN, centredOpening, clampTo, panLimits, treeBounds, type FreeArea, type Size, type View } from '../../src/render/view-math';

/*
 * 0.3 WP-A (D222): the pure rules of the small tree in the full-screen view. A phone is 390 x 844 with 47 px of top safe area and a bottom bar of 34 px
 * plus 60 px of buttons; a computer window is 900 x 700 with a toolbar of 52 px at the top.
 */

const PHONE: Size = { w: 390, h: 844 };
const PHONE_FREE = { top: 47, bottom: 98 };
const COMPUTER: Size = { w: 900, h: 700 };
const COMPUTER_FREE = { top: 52, bottom: 0 };

/** The drag clamp of the view: the centre inside `panLimits` (the pan code does `clampTo(view, panLimits(...))`). */
function clampPan(view: View, bounds: { x: number; y: number; w: number; h: number }, area?: { free: FreeArea; size: Size }): View {
	return clampTo(view, panLimits(bounds, view.scale, area?.size ?? { w: 0, h: 0 }, area?.free));
}

/** Where the bounds are on the screen for `view`: left, top, right, bottom in px. */
function onScreen(view: View, size: Size, b: { x: number; y: number; w: number; h: number }) {
	const left = size.w / 2 + (b.x - view.cx) * view.scale;
	const top = size.h / 2 + (b.y - view.cy) * view.scale;
	return { left, top, right: left + b.w * view.scale, bottom: top + b.h * view.scale };
}

describe('D222: the tree that fits opens centred (centredOpening)', () => {
	it('puts a one-person tree in the middle of the free area of a phone', () => {
		const bounds = treeBounds(160, 64);
		const v = centredOpening(bounds, PHONE, 0.875, PHONE_FREE, 16)!;
		expect(v).not.toBeNull();
		const s = onScreen(v, PHONE, bounds);
		expect((s.left + s.right) / 2).toBeCloseTo(PHONE.w / 2, 6);
		expect((s.top + s.bottom) / 2).toBeCloseTo((PHONE_FREE.top + PHONE.h - PHONE_FREE.bottom) / 2, 6);
		expect(v.scale).toBe(0.875);
	});

	it('does the same on a computer, where only the top bar is there', () => {
		const bounds = treeBounds(500, 300);
		const v = centredOpening(bounds, COMPUTER, 1, COMPUTER_FREE, 16)!;
		const s = onScreen(v, COMPUTER, bounds);
		expect((s.top + s.bottom) / 2).toBeCloseTo((52 + 700) / 2, 6);
		expect((s.left + s.right) / 2).toBeCloseTo(450, 6);
	});

	it('counts a tree that fits exactly (the fit scale) as fitting, at the same scale', () => {
		const bounds = treeBounds(1000, 400);
		const scale = Math.min(PHONE.w / bounds.w, (PHONE.h - 47 - 98) / bounds.h);
		expect(centredOpening(bounds, PHONE, scale, PHONE_FREE, 16)!.scale).toBe(scale);
	});
});

describe('D222: panLimits and clampPan with a free area', () => {
	const bounds = treeBounds(160, 64);
	const view = (cx: number, cy: number): View => ({ scale: 0.875, cx, cy });

	it('keeps the whole bounds inside the free area in both axes of a small tree, to the pixel', () => {
		const area = { free: PHONE_FREE, size: PHONE };
		const far = [view(-5000, -5000), view(5000, 5000), view(-5000, 5000), view(5000, -5000)];
		for (const f of far) {
			const s = onScreen(clampPan(f, bounds, area), PHONE, bounds);
			expect(s.left).toBeGreaterThanOrEqual(-1e-6);
			expect(s.right).toBeLessThanOrEqual(PHONE.w + 1e-6);
			expect(s.top).toBeGreaterThanOrEqual(PHONE_FREE.top - 1e-6);
			expect(s.bottom).toBeLessThanOrEqual(PHONE.h - PHONE_FREE.bottom + 1e-6);
		}
		// The four corners are reached: the bounds touch each edge of the free area.
		const topLeft = onScreen(clampPan(view(5000, 5000), bounds, area), PHONE, bounds);
		expect(topLeft.left).toBeCloseTo(0, 6);
		expect(topLeft.top).toBeCloseTo(PHONE_FREE.top, 6);
		const bottomRight = onScreen(clampPan(view(-5000, -5000), bounds, area), PHONE, bounds);
		expect(bottomRight.right).toBeCloseTo(PHONE.w, 6);
		expect(bottomRight.bottom).toBeCloseTo(PHONE.h - PHONE_FREE.bottom, 6);
	});

	it('stops the card the margin short of the edge: the bounds hold FIT_MARGIN layout px around the card', () => {
		// The card is the bounds without the margin; at the limit its edge is FIT_MARGIN x scale px from the free area.
		const area = { free: PHONE_FREE, size: PHONE };
		const v = clampPan(view(5000, 5000), bounds, area);
		const card = { x: bounds.x + FIT_MARGIN, y: bounds.y + FIT_MARGIN };
		const left = PHONE.w / 2 + (card.x - v.cx) * v.scale;
		const top = PHONE.h / 2 + (card.y - v.cy) * v.scale;
		expect(left).toBeCloseTo(FIT_MARGIN * 0.875, 6);
		expect(top - PHONE_FREE.top).toBeCloseTo(FIT_MARGIN * 0.875, 6);
	});

	it('uses the 0.2.8 limits in an axis where the tree is larger than the free area', () => {
		// Wide and short: the width does not fit (390 px), the height does.
		const wide = treeBounds(1200, 64);
		const l = panLimits(wide, 0.875, PHONE, PHONE_FREE);
		expect([l.x0, l.x1]).toEqual([wide.x, wide.x + wide.w]);
		// The height fits: the centre may move by the room that is left, (free height / scale) minus the height of the bounds.
		expect(l.y1 - l.y0).toBeCloseTo((PHONE.h - 47 - 98) / 0.875 - wide.h, 6);
		// Without a free area the whole 0.2.8 rule applies.
		expect(panLimits(wide, 0.875, PHONE)).toEqual({ x0: wide.x, x1: wide.x + wide.w, y0: wide.y, y1: wide.y + wide.h });
	});

	it('keeps clampPan of 0.2.8 when no area is given', () => {
		const b = { x: 0, y: 0, w: 200, h: 100 };
		expect(clampPan({ scale: 1, cx: -50, cy: 500 }, b)).toEqual({ scale: 1, cx: 0, cy: 100 });
	});

	it('clampTo gives the upper limit when a pair crosses by a rounding hair', () => {
		expect(clampTo({ scale: 1, cx: 5, cy: 5 }, { x0: 10, x1: 9.999999, y0: 0, y1: 10 })).toEqual({ scale: 1, cx: 9.999999, cy: 5 });
	});
});
