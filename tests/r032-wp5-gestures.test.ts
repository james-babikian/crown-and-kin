import { describe, expect, it } from 'vitest';
import {
	DOUBLE_TAP_ZOOM,
	REST,
	ZOOM_MAX,
	ZOOM_SNAP,
	clampScale,
	clampView,
	doubleTapView,
	fitSize,
	isDoubleTap,
	isTap,
	panLimit,
	panView,
	pinchView,
	settleView,
	sideSwipe,
	stepIndex,
	swipeCloses,
	zoomAbout,
} from '../src/render/dom/picture-gestures';
import { SWIPE_CLOSE_PX, SWIPE_CLOSE_SHARE, SWIPE_FLICK } from '../src/render/dom/sheet-swipe';

/*
 * WP-5 (D256): the maths of the picture viewer, with no DOM: how large the whole picture shows (a raster picture grows to twice its size at most, an SVG
 * fills the stage), the zoom limits 1x to 4x, how far the picture may move, the pinch, the double tap, the sideways swipe, and the D220 numbers of the swipe down.
 */

const STAGE = { w: 800, h: 600 };

describe('the size of the whole picture (D256 item 5)', () => {
	it('fits the stage, never cut, with its own proportions', () => {
		expect(fitSize({ w: 4000, h: 6000 }, STAGE, true)).toEqual({ w: 400, h: 600 });
		expect(fitSize({ w: 6000, h: 1000 }, STAGE, true)).toEqual({ w: 800, h: 133 });
	});

	it('a raster picture grows to 2x its own size at most, so it does not blur', () => {
		expect(fitSize({ w: 128, h: 192 }, STAGE, true)).toEqual({ w: 256, h: 384 });
	});

	it('an SVG has no limit and fills the stage', () => {
		expect(fitSize({ w: 128, h: 192 }, STAGE, false)).toEqual({ w: 400, h: 600 });
	});

	it('a stage or a picture with no size gives nothing', () => {
		expect(fitSize({ w: 0, h: 10 }, STAGE, true)).toEqual({ w: 0, h: 0 });
		expect(fitSize({ w: 10, h: 10 }, { w: 0, h: 600 }, true)).toEqual({ w: 0, h: 0 });
		expect(fitSize({ w: NaN, h: 10 }, STAGE, true)).toEqual({ w: 0, h: 0 });
	});
});

describe('the zoom limits and the move (1x to 4x)', () => {
	const shown = { w: 400, h: 600 };

	it('keeps the zoom between 1 and 4 and ignores a number that is no number', () => {
		expect(clampScale(0.2)).toBe(1);
		expect(clampScale(9)).toBe(ZOOM_MAX);
		expect(clampScale(NaN)).toBe(1);
		expect(ZOOM_MAX).toBe(4);
	});

	it('at rest the picture cannot move; zoomed it may move by half of what is wider than the stage', () => {
		expect(panLimit(shown, STAGE, 1)).toEqual({ x: 0, y: 0 });
		expect(panLimit(shown, STAGE, 4)).toEqual({ x: 400, y: 900 });
		expect(clampView({ scale: 1, x: 50, y: 50 }, shown, STAGE)).toEqual(REST);
		expect(clampView({ scale: 4, x: 5000, y: -5000 }, shown, STAGE)).toEqual({ scale: 4, x: 400, y: -900 });
	});

	it('one finger moves a zoomed picture, inside the limits, and does nothing at rest', () => {
		const zoomed = { scale: 2, x: 0, y: 0 };
		expect(panView(zoomed, 30, -20, shown, STAGE)).toEqual({ scale: 2, x: 0, y: -20 });
		expect(panView(zoomed, 1000, 0, shown, STAGE).x).toBe(panLimit(shown, STAGE, 2).x);
		expect(panView(REST, 30, 30, shown, STAGE)).toBe(REST);
	});

	it('a zoom about a point keeps the picture point under that point', () => {
		const at = { x: 100, y: 50 };
		const v = zoomAbout(REST, 2, at, { w: 700, h: 500 }, STAGE);
		expect(v.scale).toBe(2);
		// The point under `at` before: at / 1. After: (at - pan) / scale must be the same picture point.
		expect((at.x - v.x) / v.scale).toBeCloseTo(at.x, 6);
		expect((at.y - v.y) / v.scale).toBeCloseTo(at.y, 6);
	});

	it('a zoom never goes beyond 4x', () => {
		let v = REST;
		for (let i = 0; i < 10; i++) v = zoomAbout(v, 2, { x: 0, y: 0 }, shown, STAGE);
		expect(v.scale).toBe(4);
	});
});

describe('the pinch and the double tap', () => {
	const shown = { w: 400, h: 600 };

	it('a pinch zooms by the ratio of the distances about the first midpoint, then follows the midpoint', () => {
		const v = pinchView(REST, { mid: { x: 0, y: 0 }, dist: 100 }, { mid: { x: 10, y: 0 }, dist: 250 }, shown, STAGE);
		expect(v.scale).toBe(2.5);
		expect(v.x).toBe(10);
		expect(v.y).toBe(0);
	});

	it('a pinch from a view works from the start of the pinch, so it does not drift', () => {
		const start = { scale: 2, x: 20, y: 0 };
		const a = pinchView(start, { mid: { x: 0, y: 0 }, dist: 100 }, { mid: { x: 0, y: 0 }, dist: 150 }, shown, STAGE);
		const b = pinchView(start, { mid: { x: 0, y: 0 }, dist: 100 }, { mid: { x: 0, y: 0 }, dist: 150 }, shown, STAGE);
		expect(a).toEqual(b);
		expect(a.scale).toBe(3);
	});

	it('a pinch with two fingers on the same spot changes nothing', () => {
		const v = { scale: 2, x: 0, y: 0 };
		expect(pinchView(v, { mid: { x: 0, y: 0 }, dist: 0 }, { mid: { x: 0, y: 0 }, dist: 80 }, shown, STAGE)).toBe(v);
	});

	it('a pinch back to nearly 1x ends the zoom; a larger zoom stays', () => {
		expect(settleView({ scale: ZOOM_SNAP - 0.01, x: 5, y: 5 })).toBe(REST);
		const z = { scale: 1.5, x: 5, y: 5 };
		expect(settleView(z)).toBe(z);
	});

	it('a double tap zooms in about the tap; a double tap on a zoomed picture ends the zoom', () => {
		const zoomed = doubleTapView(REST, { x: 50, y: 50 }, shown, STAGE);
		expect(zoomed.scale).toBe(DOUBLE_TAP_ZOOM);
		expect(doubleTapView(zoomed, { x: 0, y: 0 }, shown, STAGE)).toEqual(REST);
	});

	it('two taps near each other in time and place are a double tap', () => {
		expect(isDoubleTap({ t: 1000, x: 10, y: 10 }, { t: 1200, x: 20, y: 15 })).toBe(true);
		expect(isDoubleTap({ t: 1000, x: 10, y: 10 }, { t: 1500, x: 10, y: 10 })).toBe(false);
		expect(isDoubleTap({ t: 1000, x: 10, y: 10 }, { t: 1100, x: 200, y: 10 })).toBe(false);
		expect(isDoubleTap(null, { t: 1000, x: 0, y: 0 })).toBe(false);
	});

	it('a finger that moves more than 10 px is not a tap', () => {
		expect(isTap(3, 4)).toBe(true);
		expect(isTap(20, 0)).toBe(false);
	});
});

describe('the sideways swipe and the keys', () => {
	it('a long sideways move changes the picture: left is the next, right is the one before', () => {
		expect(sideSwipe(-90, 10, 300)).toBe(1);
		expect(sideSwipe(90, -10, 300)).toBe(-1);
	});

	it('a short slow move, or a move that is more up or down than sideways, does nothing', () => {
		expect(sideSwipe(-30, 0, 600)).toBe(0);
		expect(sideSwipe(-90, 80, 300)).toBe(0);
		expect(sideSwipe(0, 120, 300)).toBe(0);
	});

	it('a short fast flick counts', () => {
		expect(sideSwipe(-40, 2, 60)).toBe(1);
		expect(sideSwipe(-10, 0, 10)).toBe(0);
	});

	it('the arrow keys move inside the list and do not wrap', () => {
		expect(stepIndex(0, 2, 1)).toBe(1);
		expect(stepIndex(1, 2, 1)).toBe(1);
		expect(stepIndex(0, 2, -1)).toBe(0);
		expect(stepIndex(0, 0, 1)).toBe(0);
	});
});

describe('the swipe down closes the viewer with the numbers of D220', () => {
	it('closes past 100 px, past 30 % of the height, or on a fast flick; else it moves back', () => {
		expect(swipeCloses(SWIPE_CLOSE_PX, 844, 0)).toBe(true);
		expect(swipeCloses(SWIPE_CLOSE_PX - 1, 844, 0)).toBe(false);
		expect(swipeCloses(SWIPE_CLOSE_SHARE * 300, 300, 0)).toBe(true);
		expect(swipeCloses(20, 844, SWIPE_FLICK + 0.01)).toBe(true);
		expect(swipeCloses(20, 844, SWIPE_FLICK)).toBe(false);
	});
});
