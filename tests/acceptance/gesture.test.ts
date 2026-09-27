import { describe, expect, it } from 'vitest';
import { DOUBLE_TAP_FACTOR, DOUBLE_TAP_MS, DOUBLE_TAP_PX, type DoubleTapView, type IsDoubleTap, type PinchView, type Point, type ResizeView, type ScaleLimits } from '../../src/render/gesture';
import { PAN_THRESHOLD, clampScale, isPan, type Size, type View } from '../../src/render/view-math';
import * as impl from '../../src/render/view-math';

// Spec §7.2 (gestures), §7.5 (resize/orientation), §7.6 (pan/zoom rendering) and the frozen
// contract `src/render/gesture.ts`. The expected numbers below are worked out by hand from the
// contract's own wording, not copied from `view-math.ts` (whose new functions do not exist yet:
// `pinchView`, `doubleTapView`, `isDoubleTap`, `resizeView` are WP4.2's job). Until then every
// `it` below that calls one of them fails with "... is not a function" — that is expected.

const pinchView: PinchView = impl.pinchView;
const doubleTapView: DoubleTapView = impl.doubleTapView;
const isDoubleTap: IsDoubleTap = impl.isDoubleTap;
const resizeView: ResizeView = impl.resizeView;

/*
 * Screen <-> tree conversion, derived from `transformFor` in view-math.ts (already frozen, used
 * by the existing renderer), so the test and the code agree on the convention:
 *
 *   transformFor(view, size) === `translate(tx ty) scale(s)` where
 *     tx = size.w/2 - view.cx*view.scale, ty = size.h/2 - view.cy*view.scale, s = view.scale.
 *
 * A tree point P is therefore drawn at screen point
 *     (P.x*s + tx, P.y*s + ty) = (size.w/2 + (P.x - view.cx)*s, size.h/2 + (P.y - view.cy)*s).
 *
 * `toScreen` is that formula; `toTree` is its inverse. Both match the `lx`/`ly` and return-value
 * computation already inside `zoomAt` in view-math.ts, which is the existing (non-gesture) pure
 * function closest to what pinch and double-tap need.
 */
function toScreen(view: View, size: Size, p: Point): Point {
	return { x: size.w / 2 + (p.x - view.cx) * view.scale, y: size.h / 2 + (p.y - view.cy) * view.scale };
}

function toTree(view: View, size: Size, p: Point): Point {
	return { x: view.cx + (p.x - size.w / 2) / view.scale, y: view.cy + (p.y - size.h / 2) / view.scale };
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

describe('screen <-> tree helper (self-check)', () => {
	it('toScreen and toTree are inverses, and agree with transformFor', () => {
		const view: View = { scale: 1.5, cx: 30, cy: -10 };
		const size: Size = { w: 400, h: 300 };
		const p: Point = { x: 120, y: 200 };
		expect(toTree(view, size, toScreen(view, size, p))).toEqual(p);
		// transformFor's own translate/scale, applied by hand to the same point.
		expect(toScreen(view, size, p)).toEqual({ x: 400 / 2 + (120 - 30) * 1.5, y: 300 / 2 + (200 - -10) * 1.5 });
	});
});

describe('pinchView (spec §7.2 pinch-to-zoom)', () => {
	const size: Size = { w: 200, h: 200 };
	const limits: ScaleLimits = { min: 0.1, max: 10 };

	it('keeps the tree point under the start midpoint under the current midpoint, in general', () => {
		// Midpoint moves (100,100) -> (120,120) and the fingers spread further apart, at once.
		const start: View = { scale: 1, cx: 50, cy: 20 };
		const from: [Point, Point] = [{ x: 70, y: 100 }, { x: 130, y: 100 }];
		const to: [Point, Point] = [{ x: 50, y: 90 }, { x: 190, y: 150 }];
		const result = pinchView(start, from, to, size, limits);
		const before = toTree(start, size, midpoint(...from));
		const after = toTree(result, size, midpoint(...to));
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
		// "the scale changes by the ratio of the finger distances"
		const ratio = dist(...to) / dist(...from);
		expect(result.scale).toBeCloseTo(clampScale(start.scale * ratio, limits));
	});

	it('pure spread (midpoint fixed, distance doubles) doubles the scale', () => {
		const start: View = { scale: 1, cx: 50, cy: 20 };
		const from: [Point, Point] = [{ x: 120, y: 60 }, { x: 160, y: 60 }]; // midpoint (140,60), distance 40
		const to: [Point, Point] = [{ x: 100, y: 60 }, { x: 180, y: 60 }]; // same midpoint, distance 80
		const result = pinchView(start, from, to, size, limits);
		// By hand: tree point under (140,60) at start = (50 + (140-100)/1, 20 + (60-100)/1) = (90, -20).
		// New scale = 1 * (80/40) = 2. New cx = 90 - (140-100)/2 = 70. New cy = -20 - (60-100)/2 = 0.
		expect(result).toEqual({ scale: 2, cx: 70, cy: 0 });
	});

	it('pure two-finger drag (distance unchanged) pans without zooming', () => {
		const start: View = { scale: 1, cx: 50, cy: 20 };
		const from: [Point, Point] = [{ x: 80, y: 100 }, { x: 120, y: 100 }]; // midpoint (100,100), distance 40
		const to: [Point, Point] = [{ x: 50, y: 100 }, { x: 90, y: 100 }]; // midpoint (70,100), distance 40
		const result = pinchView(start, from, to, size, limits);
		// By hand: tree point under (100,100) at start = (50, 20). Scale unchanged (ratio 1).
		// New cx = 50 - (70-100)/1 = 80. New cy = 20 - (100-100)/1 = 20.
		expect(result).toEqual({ scale: 1, cx: 80, cy: 20 });
		// Cross-check: this is exactly what the existing panFrom(start, dx, dy) gives for the
		// midpoint's screen-pixel movement (dx=-30, dy=0), since a pure drag has no zoom.
		expect(result).toEqual(impl.panFrom(start, -30, 0));
	});

	it('clamps to the scale limits, and the midpoint invariant still holds at the clamped scale', () => {
		const start: View = { scale: 2, cx: 10, cy: 5 };
		const tight: ScaleLimits = { min: 0.5, max: 3 };
		const from: [Point, Point] = [{ x: 120, y: 60 }, { x: 160, y: 60 }]; // midpoint (140,60), distance 40
		const to: [Point, Point] = [{ x: 60, y: 60 }, { x: 220, y: 60 }]; // same midpoint, distance 160 (ratio 4 -> raw target 8)
		const result = pinchView(start, from, to, size, tight);
		expect(result.scale).toBe(3); // clamp(2*4, {0.5,3}) = 3, not 8
		// By hand: tree point under (140,60) at start = (10 + 40/2, 5 - 40/2) = (30, -15).
		// New cx = 30 - 40/3 = 16.666..., new cy = -15 - (-40)/3 = -1.666...
		expect(result.cx).toBeCloseTo(30 - 40 / 3);
		expect(result.cy).toBeCloseTo(-15 + 40 / 3);
		// The invariant from the general test still holds even though the scale was clamped: the
		// clamp only changes which scale pinchView solves for, not whether it re-centres to keep
		// the point under the midpoint (the same construction zoomAt already uses).
		const before = toTree(start, size, midpoint(...from));
		const after = toTree(result, size, midpoint(...to));
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('never produces NaN or Infinity when the fingers start or stay at the same point', () => {
		const start: View = { scale: 1, cx: 0, cy: 0 };
		// Zero start distance (fingers land together, then spread): the naive ratio is Infinity/0.
		const spreadFromZero = pinchView(start, [{ x: 100, y: 100 }, { x: 100, y: 100 }], [{ x: 80, y: 100 }, { x: 120, y: 100 }], size, limits);
		expect(Number.isFinite(spreadFromZero.scale)).toBe(true);
		expect(Number.isFinite(spreadFromZero.cx)).toBe(true);
		expect(Number.isFinite(spreadFromZero.cy)).toBe(true);
		// Zero distance throughout (two fingers stuck together, or a slip that reports one point twice):
		// the naive ratio is 0/0 = NaN. The spec does not fix what scale this should give (open question
		// below); only that it must not be NaN or Infinity.
		const zeroThroughout = pinchView(start, [{ x: 100, y: 100 }, { x: 100, y: 100 }], [{ x: 90, y: 90 }, { x: 90, y: 90 }], size, limits);
		expect(Number.isFinite(zeroThroughout.scale)).toBe(true);
		expect(Number.isFinite(zeroThroughout.cx)).toBe(true);
		expect(Number.isFinite(zeroThroughout.cy)).toBe(true);
	});
});

describe('doubleTapView (spec §7.2 double-tap on empty background)', () => {
	const size: Size = { w: 200, h: 200 };
	const limits: ScaleLimits = { min: 0.1, max: 10 };

	it('zooms DOUBLE_TAP_FACTOR x so the tapped tree point stays under the tap', () => {
		const view: View = { scale: 1, cx: 50, cy: 20 };
		const at: Point = { x: 150, y: 50 };
		const result = doubleTapView(view, at, size, limits);
		// By hand: tree point under (150,50) at start = (50 + 50/1, 20 - 50/1) = (100, -30).
		// New scale = 1 * 2 = 2. New cx = 100 - 50/2 = 75. New cy = -30 - (-50)/2 = -5.
		expect(result).toEqual({ scale: 2, cx: 75, cy: -5 });
		expect(result.scale).toBe(view.scale * DOUBLE_TAP_FACTOR);
		const before = toTree(view, size, at);
		const after = toTree(result, size, at);
		expect(after).toEqual(before);
	});

	it('is a no-op when the view is already at the max scale', () => {
		// Scale cannot change (it is already clamp(scale*2, limits) = limits.max = view.scale), so
		// there is nothing to re-centre for: the whole view, not just the scale, is unchanged.
		const view: View = { scale: 10, cx: 5, cy: 5 };
		const limitsAtMax: ScaleLimits = { min: 1, max: 10 };
		expect(doubleTapView(view, { x: 150, y: 50 }, size, limitsAtMax)).toEqual(view);
		expect(doubleTapView(view, { x: 0, y: 0 }, size, limitsAtMax)).toEqual(view);
	});

	it('clamps at max between the current and doubled scale: the tapped point still does not move', () => {
		// Doubling would overshoot (6*2=12 > max 10): the achieved scale is 10, not 12.
		const view: View = { scale: 6, cx: 0, cy: 0 };
		const limitsBelowMax: ScaleLimits = { min: 0.5, max: 10 };
		const at: Point = { x: 150, y: 50 };
		const result = doubleTapView(view, at, size, limitsBelowMax);
		expect(result.scale).toBe(10);
		// Expectation and why: doubleTapView is defined ("... so that the tree point under `at`
		// stays under `at`; clamped") the same way as the existing zoomAt in view-math.ts, which
		// always re-solves cx/cy for whatever scale it ends up using -- clamping changes only the
		// target scale, never breaks the "point stays under the tap" promise, because for any
		// positive scale there is exactly one (cx, cy) that keeps a given tree point under a given
		// screen point. So even clamped, the point should NOT move here. If the implementation
		// instead keeps the pre-tap (cx, cy) and lets the point drift when clamped, this
		// expectation is wrong -- ask the supervisor to confirm before "fixing" this test.
		const before = toTree(view, size, at);
		const after = toTree(result, size, at);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});
});

describe('isDoubleTap (spec §7.2 "second tap within 300 ms and 24 px")', () => {
	it('is a double-tap at exactly 300 ms and 24 px', () => {
		expect(isDoubleTap(0, { x: 0, y: 0 }, DOUBLE_TAP_MS, { x: DOUBLE_TAP_PX, y: 0 })).toBe(true);
	});

	it('is not a double-tap one ms too late (301 ms)', () => {
		expect(isDoubleTap(0, { x: 0, y: 0 }, DOUBLE_TAP_MS + 1, { x: 0, y: 0 })).toBe(false);
	});

	it('is not a double-tap one px too far (25 px)', () => {
		expect(isDoubleTap(0, { x: 0, y: 0 }, DOUBLE_TAP_MS, { x: DOUBLE_TAP_PX + 1, y: 0 })).toBe(false);
	});

	it('measures the 24 px as a straight-line distance, not per axis', () => {
		// hypot(17, 17) ~= 24.04 px: just over 24 px away in a straight line, even though neither
		// axis alone moved 24 px.
		expect(isDoubleTap(0, { x: 0, y: 0 }, DOUBLE_TAP_MS, { x: 17, y: 17 })).toBe(false);
	});

	it('is never a double-tap when the second tap is timestamped before the first', () => {
		expect(isDoubleTap(DOUBLE_TAP_MS, { x: 0, y: 0 }, 0, { x: 0, y: 0 })).toBe(false);
	});
});

describe('resizeView (spec §7.5 "keep the same tree point at the centre" on resize/rotation)', () => {
	const portrait: Size = { w: 390, h: 844 };
	const landscape: Size = { w: 844, h: 390 };

	it('keeps cx, cy and scale across a portrait -> landscape rotation, when the scale is still in range', () => {
		const view: View = { scale: 1.5, cx: 50, cy: 20 };
		const limits: ScaleLimits = { min: 0.5, max: 5 };
		expect(resizeView(view, portrait, landscape, limits)).toEqual({ scale: 1.5, cx: 50, cy: 20 });
	});

	it('clamps the scale to the new limits when the old scale falls outside them', () => {
		const view: View = { scale: 1, cx: 50, cy: 20 };
		const narrowerLimits: ScaleLimits = { min: 2, max: 5 };
		expect(resizeView(view, portrait, landscape, narrowerLimits)).toEqual({ scale: 2, cx: 50, cy: 20 });
	});

	it('round trip (portrait -> landscape -> portrait) returns the original view, when neither leg clamps', () => {
		const view: View = { scale: 1.5, cx: 50, cy: 20 };
		const limits: ScaleLimits = { min: 0.5, max: 5 }; // 1.5 is in range on both sides
		const rotated = resizeView(view, portrait, landscape, limits);
		const back = resizeView(rotated, landscape, portrait, limits);
		expect(back).toEqual(view);
	});
});

describe('isPan / PAN_THRESHOLD (spec §7.2 "8 px movement threshold")', () => {
	it('is exactly 8 (spec wording)', () => {
		expect(PAN_THRESHOLD).toBe(8);
	});

	it('a movement of exactly 8 px is still a tap, not a pan', () => {
		// isPan uses a strict `>` against PAN_THRESHOLD in the existing code (see
		// tests/render-view-math.test.ts, "treats a movement of 8 px or less as a tap"), so 8 px
		// itself lands on the tap side of the boundary, and 8.1 px is the first value that pans.
		expect(isPan(PAN_THRESHOLD, 0)).toBe(false);
		expect(isPan(0, PAN_THRESHOLD)).toBe(false);
	});

	it('a movement of 8.1 px is a pan', () => {
		expect(isPan(8.1, 0)).toBe(true);
		expect(isPan(0, 8.1)).toBe(true);
	});
});
