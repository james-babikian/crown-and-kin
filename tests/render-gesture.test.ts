import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, doubleTapView, isDoubleTap, pinchView, resizeView, type Size, type View } from '../src/render/view-math';

const size: Size = { w: 390, h: 844 };
const limits = { min: 0.1, max: 4 };
const start: View = { scale: 1, cx: 500, cy: 300 };

/** The tree point under screen point (x, y) in `view`. */
const under = (v: View, x: number, y: number, s: Size = size) => ({ x: v.cx + (x - s.w / 2) / v.scale, y: v.cy + (y - s.h / 2) / v.scale });

describe('pinchView (spec §7.2)', () => {
	it('scales by the ratio of the finger distances and keeps the tree point under the midpoint', () => {
		const v = pinchView(start, [{ x: 100, y: 400 }, { x: 200, y: 400 }], [{ x: 50, y: 400 }, { x: 250, y: 400 }], size, limits);
		expect(v.scale).toBeCloseTo(2);
		const p0 = under(start, 150, 400);
		const p1 = under(v, 150, 400);
		expect(p1.x).toBeCloseTo(p0.x);
		expect(p1.y).toBeCloseTo(p0.y);
	});

	it('follows a moving midpoint (two-finger pan)', () => {
		const v = pinchView(start, [{ x: 100, y: 400 }, { x: 200, y: 400 }], [{ x: 130, y: 450 }, { x: 230, y: 450 }], size, limits);
		expect(v.scale).toBeCloseTo(1);
		const p0 = under(start, 150, 400);
		const p1 = under(v, 180, 450);
		expect(p1.x).toBeCloseTo(p0.x);
		expect(p1.y).toBeCloseTo(p0.y);
	});

	it('clamps the scale and still keeps the point under the midpoint', () => {
		const v = pinchView(start, [{ x: 100, y: 400 }, { x: 110, y: 400 }], [{ x: 0, y: 400 }, { x: 210, y: 400 }], size, limits);
		expect(v.scale).toBe(4);
		const p0 = under(start, 105, 400);
		const p1 = under(v, 105, 400);
		expect(p1.x).toBeCloseTo(p0.x);
		const w = pinchView(start, [{ x: 0, y: 400 }, { x: 390, y: 400 }], [{ x: 190, y: 400 }, { x: 200, y: 400 }], size, limits);
		expect(w.scale).toBe(0.1);
	});

	it('only pans when the fingers start on one spot, and ignores bad input', () => {
		const v = pinchView(start, [{ x: 100, y: 100 }, { x: 100, y: 100 }], [{ x: 50, y: 100 }, { x: 150, y: 100 }], size, limits);
		expect(v.scale).toBe(1);
		expect(pinchView(start, [{ x: NaN, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], size, limits)).toEqual(start);
		expect(pinchView(start, [{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 2 }], { w: 0, h: 0 }, limits)).toEqual(start);
	});
});

describe('doubleTapView (spec §7.2)', () => {
	it('zooms 2× with the tapped tree point fixed', () => {
		const v = doubleTapView(start, { x: 300, y: 200 }, size, limits);
		expect(v.scale).toBeCloseTo(2);
		const p0 = under(start, 300, 200);
		const p1 = under(v, 300, 200);
		expect(p1.x).toBeCloseTo(p0.x);
		expect(p1.y).toBeCloseTo(p0.y);
	});

	it('clamps to the largest zoom', () => {
		expect(doubleTapView({ ...start, scale: 3 }, { x: 10, y: 10 }, size, limits).scale).toBe(4);
	});
});

describe('isDoubleTap', () => {
	it('accepts a second tap near the first, soon after it', () => {
		expect(isDoubleTap(1000, { x: 10, y: 10 }, 1000 + DOUBLE_TAP_MS, { x: 10 + DOUBLE_TAP_PX, y: 10 })).toBe(true);
		expect(isDoubleTap(1000, { x: 10, y: 10 }, 1100, { x: 12, y: 14 })).toBe(true);
	});

	it('refuses a late, far or earlier tap, and bad input', () => {
		expect(isDoubleTap(1000, { x: 10, y: 10 }, 1001 + DOUBLE_TAP_MS, { x: 10, y: 10 })).toBe(false);
		expect(isDoubleTap(1000, { x: 10, y: 10 }, 1100, { x: 10 + DOUBLE_TAP_PX + 1, y: 10 })).toBe(false);
		expect(isDoubleTap(1000, { x: 10, y: 10 }, 900, { x: 10, y: 10 })).toBe(false);
		expect(isDoubleTap(NaN, { x: 10, y: 10 }, 1000, { x: 10, y: 10 })).toBe(false);
	});
});

describe('resizeView (spec §7.5)', () => {
	it('keeps the tree point at the centre and the scale', () => {
		const v = resizeView(start, size, { w: 844, h: 390 }, limits);
		expect(v).toEqual(start);
	});

	it('applies the new scale limits', () => {
		expect(resizeView({ ...start, scale: 0.05 }, size, { w: 844, h: 390 }, limits).scale).toBe(0.1);
		expect(resizeView({ ...start, scale: 9 }, size, { w: 844, h: 390 }, limits)).toEqual({ scale: 4, cx: 500, cy: 300 });
	});
});
