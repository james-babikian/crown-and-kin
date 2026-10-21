/*
 * The maths of the picture viewer (spec §0 D256): how large the whole picture shows, how far it may move while it is zoomed, what a pinch or a double tap
 * does, and what a sideways swipe means. Pure functions on numbers, so a test needs no DOM. The touch code that feeds them is in `picture-touch.ts`.
 * All lengths are CSS px. A "view" is the zoom and the move of the picture from the centre of the stage.
 */

export { swipeCloses } from './sheet-swipe';

/** The zoom stays between these limits (D256 item 5). */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** A double tap on a picture at rest zooms to this factor. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** A pinch that ends below this factor goes back to 1, so the picture never rests a hair larger than the stage. */
export const ZOOM_SNAP = 1.08;
/** A raster picture shows at twice its own size at most; it never blurs (D256 item 5). */
export const RASTER_GROWTH = 2;
/** Two taps count as a double tap inside this time (ms) and this distance (px). */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 40;
/** A finger that moves farther than this is not a tap. */
export const TAP_SLOP_PX = 10;
/** A sideways swipe needs this distance (px), or a flick of this speed (px per ms) over at least `FLICK_MIN_PX`. */
export const SIDE_SWIPE_PX = 56;
export const SIDE_FLICK = 0.45;
export const FLICK_MIN_PX = 24;

export interface Size {
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

/** The zoom and the move of the picture; the move is from the centre of the stage. */
export interface View {
	scale: number;
	x: number;
	y: number;
}

export const REST: View = { scale: 1, x: 0, y: 0 };

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

/** A zoom factor inside the limits. */
export const clampScale = (s: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, finite(s, ZOOM_MIN)));

/**
 * The size of the whole picture on the stage: as large as the stage allows, never cut, with its own proportions. A raster picture grows to
 * `RASTER_GROWTH` times its own size at most; an SVG (`raster` false) has no such limit. A stage or a picture with no size gives 0 × 0.
 */
export function fitSize(pic: Size, stage: Size, raster: boolean): Size {
	if (!(pic.w > 0 && pic.h > 0 && stage.w > 0 && stage.h > 0)) return { w: 0, h: 0 };
	const s = Math.min(stage.w / pic.w, stage.h / pic.h, raster ? RASTER_GROWTH : Infinity);
	return { w: Math.round(pic.w * s), h: Math.round(pic.h * s) };
}

/** How far the picture may move from the centre at `scale`: half of what is wider than the stage, and never below 0. */
export function panLimit(shown: Size, stage: Size, scale: number): Point {
	return { x: Math.max(0, (shown.w * scale - stage.w) / 2), y: Math.max(0, (shown.h * scale - stage.h) / 2) };
}

/** The view with its scale inside the limits and its move inside `panLimit`; at rest the move is 0. */
export function clampView(v: View, shown: Size, stage: Size): View {
	const scale = clampScale(v.scale);
	if (scale <= ZOOM_MIN) return REST;
	const lim = panLimit(shown, stage, scale);
	return { scale, x: Math.min(lim.x, Math.max(-lim.x, finite(v.x, 0))), y: Math.min(lim.y, Math.max(-lim.y, finite(v.y, 0))) };
}

/**
 * The view after a zoom by `factor` about `at` (a point from the centre of the stage): the picture point under `at` stays under it, as far as
 * the limits allow.
 */
export function zoomAbout(v: View, factor: number, at: Point, shown: Size, stage: Size): View {
	const scale = clampScale(v.scale * finite(factor, 1));
	const k = scale / v.scale;
	return clampView({ scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, shown, stage);
}

/**
 * The view of a pinch. `start` is the view when the second finger came down, `from` the two fingers then and `to` the two fingers now. The
 * view follows the distance ratio about the first midpoint, then the move of the midpoint. Working from the start gives no drift.
 */
export function pinchView(start: View, from: { mid: Point; dist: number }, to: { mid: Point; dist: number }, shown: Size, stage: Size): View {
	if (!(from.dist > 0) || !(to.dist > 0)) return start;
	const zoomed = zoomAbout(start, to.dist / from.dist, from.mid, shown, stage);
	return clampView({ ...zoomed, x: zoomed.x + (to.mid.x - from.mid.x), y: zoomed.y + (to.mid.y - from.mid.y) }, shown, stage);
}

/** The view when a pinch ends: a scale close to 1 goes back to rest. */
export const settleView = (v: View): View => (v.scale < ZOOM_SNAP ? REST : v);

/** A double tap at rest zooms to `DOUBLE_TAP_ZOOM` about the tap; a double tap on a zoomed picture goes back to rest. */
export function doubleTapView(v: View, at: Point, shown: Size, stage: Size): View {
	return v.scale > ZOOM_MIN ? REST : zoomAbout(v, DOUBLE_TAP_ZOOM, at, shown, stage);
}

/** The view after one finger moved by (`dx`, `dy`) while the picture is zoomed. */
export const panView = (v: View, dx: number, dy: number, shown: Size, stage: Size): View => (v.scale > ZOOM_MIN ? clampView({ ...v, x: v.x + dx, y: v.y + dy }, shown, stage) : v);

/** True when a tap at `now` is the second of a double tap that began with `prev`. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }): boolean {
	return !!prev && now.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(now.x - prev.x, now.y - prev.y) <= DOUBLE_TAP_PX;
}

/** True when a finger that moved from (0, 0) to (`dx`, `dy`) still counts as a tap. */
export const isTap = (dx: number, dy: number): boolean => Math.hypot(dx, dy) <= TAP_SLOP_PX;

/**
 * What a sideways move of a finger means: 1 for a swipe to the left (the next picture), -1 for a swipe to the right (the one before), 0 for
 * none. The move must be more sideways than down or up, and long enough or fast enough.
 */
export function sideSwipe(dx: number, dy: number, ms: number): -1 | 0 | 1 {
	const ax = Math.abs(dx);
	if (ax <= Math.abs(dy) * 1.5) return 0;
	const fast = ms > 0 && ax >= FLICK_MIN_PX && ax / ms >= SIDE_FLICK;
	if (ax < SIDE_SWIPE_PX && !fast) return 0;
	return dx < 0 ? 1 : -1;
}

/** The index after a step, kept inside the list (no wrap: the first picture has nothing before it). */
export const stepIndex = (index: number, count: number, dir: number): number => Math.min(Math.max(0, count - 1), Math.max(0, index + dir));
