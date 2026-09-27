/**
 * Milestone 4 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Pure view calculations for touch gestures and viewport changes (spec §7.2, §7.5, §7.6).
 * `view-math.ts` implements them (WP4.2). A `View` is the tree point at the viewport centre
 * (`cx`, `cy`, in layout px) and the zoom (`scale`); screen points are viewport px from the
 * top-left corner.
 */
import type { Size, View } from './view-math';

export interface Point {
	x: number;
	y: number;
}

export interface ScaleLimits {
	min: number;
	max: number;
}

/** Double-tap on empty background zooms 2× at that point (§7.2). */
export const DOUBLE_TAP_FACTOR = 2;
/** Two taps count as a double-tap when the second starts within this time of the first… */
export const DOUBLE_TAP_MS = 300;
/** …and within this distance (screen px) of it. */
export const DOUBLE_TAP_PX = 24;

/**
 * Two-finger pinch (§7.2): the tree point under the fingers' midpoint at the start stays under
 * the midpoint now, and the scale changes by the ratio of the finger distances. Clamped to
 * `limits`. `start` is the view when the second finger went down.
 */
export type PinchView = (start: View, from: [Point, Point], to: [Point, Point], size: Size, limits: ScaleLimits) => View;

/** Zoom `DOUBLE_TAP_FACTOR`× so that the tree point under `at` stays under `at`; clamped. */
export type DoubleTapView = (view: View, at: Point, size: Size, limits: ScaleLimits) => View;

/** True if a tap at (`t1`, `p1`) completes a double-tap with the tap at (`t0`, `p0`). Times in ms. */
export type IsDoubleTap = (t0: number, p0: Point, t1: number, p1: Point) => boolean;

/**
 * Resize or orientation change (§7.5): keep the same tree point at the viewport centre and the
 * same scale; only the viewport size changes. (The view's centre is already a tree point, so this
 * is the identity on `cx`/`cy`; the function exists so every caller goes through one rule, and it
 * re-applies the scale limits for the new size.)
 */
export type ResizeView = (view: View, oldSize: Size, newSize: Size, newLimits: ScaleLimits) => View;
