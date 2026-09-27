import type { Rect } from '../layout/model';
import { DOUBLE_TAP_FACTOR, DOUBLE_TAP_MS, DOUBLE_TAP_PX, type DoubleTapView, type IsDoubleTap, type PinchView, type Point, type ResizeView } from './gesture';

/*
 * Pure viewport arithmetic for the DOM renderer: default view (spec §5.5), pan and zoom, level of
 * detail with hysteresis (§5.4), hit-area scaling (§7.5) and text truncation. No DOM here, so all
 * of it runs under vitest.
 */

/** The layout point shown at the centre of the viewport, and the zoom. */
export interface View {
	scale: number;
	cx: number;
	cy: number;
}

export interface Size {
	w: number;
	h: number;
}

export type Lod = 'full' | 'compact' | 'overview';

/** Name text on screen, in px, where the default view switches from fit to a readable zoom (§5.5). */
export const FIT_MIN_NAME_PX = 11;
/** Name text on screen, in px, for the readable zoom (§5.5). */
export const READABLE_NAME_PX = 14;
/** A small tree is not blown up past its natural size by "fit". */
export const MAX_FIT_SCALE = 1;
/** Empty space around the tree in a fitted view, in layout px. */
export const FIT_MARGIN = 24;
/** Largest zoom: name text at this many px on screen. */
export const MAX_NAME_PX = 64;
/** Movement in screen px before a press counts as a pan, not a tap or click (§7.2). */
export const PAN_THRESHOLD = 8;
/** Smallest tappable size in screen px (§7.5). */
export const MIN_HIT_PX = 44;

/**
 * Level-of-detail bands by the on-screen size of the Full name text. Each boundary has a band of
 * hysteresis around it, so a zoom that ends near a boundary does not flip back and forth.
 */
export const LOD_BANDS = {
	/** Full below this size switches to Compact; Compact above `fullEnter` switches to Full. */
	fullLeave: 8,
	fullEnter: 10,
	compactLeave: 3.5,
	compactEnter: 4.5,
} as const;

export function chooseLod(current: Lod | null, namePx: number): Lod {
	const b = LOD_BANDS;
	if (!Number.isFinite(namePx)) return current ?? 'full';
	if (current === null) {
		// No previous level: split each band in the middle.
		if (namePx >= (b.fullLeave + b.fullEnter) / 2) return 'full';
		if (namePx >= (b.compactLeave + b.compactEnter) / 2) return 'compact';
		return 'overview';
	}
	if (current === 'full') {
		if (namePx >= b.fullLeave) return 'full';
		return namePx >= b.compactLeave ? 'compact' : 'overview';
	}
	if (current === 'compact') {
		if (namePx >= b.fullEnter) return 'full';
		return namePx >= b.compactLeave ? 'compact' : 'overview';
	}
	if (namePx >= b.fullEnter) return 'full';
	return namePx >= b.compactEnter ? 'compact' : 'overview';
}

/** The whole tree with a margin, in layout px. */
export function treeBounds(width: number, height: number, margin = FIT_MARGIN): Rect {
	const w = Number.isFinite(width) && width > 0 ? width : 0;
	const h = Number.isFinite(height) && height > 0 ? height : 0;
	return { x: -margin, y: -margin, w: w + 2 * margin, h: h + 2 * margin };
}

function validSize(size: Size): boolean {
	return Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0;
}

/** The scale at which `bounds` just fits `size`, not larger than MAX_FIT_SCALE. */
export function fitScale(bounds: Rect, size: Size): number {
	if (!validSize(size) || bounds.w <= 0 || bounds.h <= 0) return MAX_FIT_SCALE;
	return Math.min(MAX_FIT_SCALE, size.w / bounds.w, size.h / bounds.h);
}

export function scaleLimits(bounds: Rect, size: Size, fontPx: number): { min: number; max: number } {
	const f = fontPx > 0 ? fontPx : 16;
	const max = MAX_NAME_PX / f;
	const min = Math.min(fitScale(bounds, size) * 0.5, max);
	return { min: Math.max(min, 1e-3), max };
}

export function clampScale(scale: number, limits: { min: number; max: number }): number {
	if (!Number.isFinite(scale)) return limits.min;
	return Math.min(limits.max, Math.max(limits.min, scale));
}

/**
 * Keeps the tree in view: where the tree is wider than the viewport, the viewport may not go past
 * its edges; where it is narrower, the tree stays centred.
 */
export function clampCentre(view: View, bounds: Rect, size: Size): View {
	const axis = (c: number, lo: number, len: number, screen: number) => {
		const half = screen / 2 / view.scale;
		if (len <= 2 * half) return lo + len / 2;
		return Math.min(lo + len - half, Math.max(lo + half, c));
	};
	if (!validSize(size) || !(view.scale > 0)) return view;
	return { scale: view.scale, cx: axis(view.cx, bounds.x, bounds.w, size.w), cy: axis(view.cy, bounds.y, bounds.h, size.h) };
}

/**
 * The part of the viewport below a band of `insetTop` px (the toolbar), so a view chosen by the
 * plugin never puts a card under the toolbar. Views are computed for that area, then shifted so
 * the area's centre, not the viewport's, shows the chosen point.
 */
function inArea(size: Size, insetTop: number, make: (area: Size) => View): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const v = make({ w: size.w, h: size.h - top });
	return top > 0 && v.scale > 0 ? { scale: v.scale, cx: v.cx, cy: v.cy - top / 2 / v.scale } : v;
}

/** The whole tree, centred, in the area below `insetTop` (the Fit button). */
export function fitView(bounds: Rect, size: Size, insetTop = 0): View {
	return inArea(size, insetTop, (area) => ({ scale: fitScale(bounds, area), cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 }));
}

/** The cards of the start person's partners and children, which the readable default view tries to show (D13). */
export interface Family {
	partners: Rect[];
	children: Rect[];
}

/** Space above the start person's card in the readable default view, in layout px: the tree's own margin. */
export const START_TOP_GAP = FIT_MARGIN;
/** Screen px kept free at each side of a family card that the readable default view shows. */
export const FAMILY_SIDE_PAD = 8;

/**
 * Spec §5.5: fit if the name text is then at least 11 px. Else 14 px name text, with the start
 * person's card at the top of the area and as many of their children, then partners, as fit (D13).
 */
export function defaultView(bounds: Rect, size: Size, fontPx: number, start: Rect | null, insetTop = 0, family: Family | null = null): View {
	return inArea(size, insetTop, (area) => {
		const fit = fitScale(bounds, area);
		const fitted: View = { scale: fit, cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 };
		if (fit * fontPx >= FIT_MIN_NAME_PX || !start) return fitted;
		return readableView(bounds, area, READABLE_NAME_PX / fontPx, start, family);
	});
}

function readableView(bounds: Rect, area: Size, scale: number, start: Rect, family: Family | null): View {
	const halfH = area.h / 2 / scale;
	// Vertically the view stays over the tree, but a tree shorter than the area sits at the top, not in the middle.
	const cy = bounds.h <= 2 * halfH ? bounds.y + halfH : Math.min(bounds.y + bounds.h - halfH, Math.max(bounds.y + halfH, start.y - START_TOP_GAP + halfH));
	const inRows = (c: Rect) => c.y >= cy - halfH && c.y + c.h <= cy + halfH;
	const children = (family?.children ?? []).filter(inRows);
	const partners = (family?.partners ?? []).filter(inRows);
	const cx = familyCentre(start, children, partners, area.w / scale, FAMILY_SIDE_PAD / scale);
	return { scale, cx: clampCentre({ scale, cx, cy }, bounds, area).cx, cy };
}

/**
 * Horizontal centre for a window `width` wide that shows the whole start card and the most
 * children (if none fits whole, as much of one as fits), then the most partners. Children come first: D13 wants them below the start person,
 * and in a wide tree they often sit far apart under their own descendants, so the start person's
 * centre alone can show none. Among equal choices, the one nearest the start person wins; the
 * cards shown are then centred as a group. If no child fits whole, the view shows as much of a
 * child's card as it can at the edge, so the reader sees where the children are.
 */
function familyCentre(start: Rect, children: Rect[], partners: Rect[], width: number, pad: number): number {
	const w = width - 2 * pad;
	const own = start.x + start.w / 2;
	if (!(w >= start.w)) return own;
	const eps = 1e-6;
	const lo = start.x + start.w - w;
	const hi = start.x;
	// Window left edges where a card enters, becomes whole, starts to leave or has left: the best choice is at one of them.
	const edges = [...children, ...partners].flatMap((c) => [c.x - w, c.x + c.w - w, c.x, c.x + c.w]);
	const lefts = [lo, hi, ...edges].filter((l) => l >= lo - eps && l <= hi + eps);
	let best = { kids: -1, mates: -1, part: -1, dist: Infinity, centre: own };
	for (const l of lefts) {
		const shown = (c: Rect) => c.x >= l - eps && c.x + c.w <= l + w + eps;
		const kids = children.filter(shown);
		const mates = partners.filter(shown);
		const part = kids.length ? 0 : Math.max(0, ...children.map((c) => Math.min(c.x + c.w, l + w) - Math.max(c.x, l)));
		const group = [start, ...kids, ...mates];
		const left = Math.min(...group.map((c) => c.x));
		const right = Math.max(...group.map((c) => c.x + c.w));
		const centre = part > eps ? l + w / 2 : (left + right) / 2;
		const dist = Math.abs(centre - own);
		// With no child whole, part of a child beats a partner: D13 is about the children below.
		const better =
			kids.length !== best.kids ? kids.length > best.kids
			: Math.abs(part - best.part) > eps ? part > best.part
			: mates.length !== best.mates ? mates.length > best.mates
			: dist < best.dist - eps;
		if (better) best = { kids: kids.length, mates: mates.length, part, dist, centre };
	}
	return best.centre;
}

/**
 * Centres `target` and makes its name readable: a zoom where the name is under 11 px becomes the
 * 14 px readable zoom; a larger zoom is kept. Not clamped to the tree: explicit navigation (a
 * far-couple tag, the problem list, keyboard focus) must put the person in the middle even at the
 * edge of the tree (spec §5.3).
 */
export function centreOn(view: View, target: Rect, fontPx: number): View {
	const scale = view.scale * fontPx >= FIT_MIN_NAME_PX ? view.scale : READABLE_NAME_PX / fontPx;
	return { scale, cx: target.x + target.w / 2, cy: target.y + target.h / 2 };
}

/**
 * Screen px the view must move down so that no card on screen overlaps the band [0, insetTop)
 * at the top of the viewport (the toolbar). 0 when no card does.
 */
export function bandShift(view: View, size: Size, insetTop: number, boxes: Iterable<Rect>): number {
	let shift = 0;
	if (!(insetTop > 0) || !(view.scale > 0)) return 0;
	for (const b of boxes) {
		const left = size.w / 2 + (b.x - view.cx) * view.scale;
		const right = left + b.w * view.scale;
		const top = size.h / 2 + (b.y - view.cy) * view.scale;
		const bottom = top + b.h * view.scale;
		if (right <= 0 || left >= size.w || bottom <= 0 || top >= insetTop) continue;
		shift = Math.max(shift, insetTop - top);
	}
	return shift;
}

/** Moves the view down just enough that no card on screen is under the band (a few rounds, as cards from above can come in). */
export function clearBand(view: View, size: Size, insetTop: number, boxes: Rect[]): View {
	let v = view;
	for (let i = 0; i < 4; i++) {
		const s = bandShift(v, size, insetTop, boxes);
		if (s <= 0) break;
		v = { scale: v.scale, cx: v.cx, cy: v.cy - s / v.scale };
	}
	return v;
}

/** Zoom by `factor` so that the layout point under the screen point (px, py) stays under it. */
export function zoomAt(view: View, factor: number, px: number, py: number, size: Size, limits: { min: number; max: number }): View {
	const scale = clampScale(view.scale * factor, limits);
	// Layout point under the pointer before the zoom.
	const lx = view.cx + (px - size.w / 2) / view.scale;
	const ly = view.cy + (py - size.h / 2) / view.scale;
	return { scale, cx: lx - (px - size.w / 2) / scale, cy: ly - (py - size.h / 2) / scale };
}

/** Pan by a screen-pixel distance from a view taken at the start of the drag. */
export function panFrom(start: View, dx: number, dy: number): View {
	return { scale: start.scale, cx: start.cx - dx / start.scale, cy: start.cy - dy / start.scale };
}

/** Pans stop when the tree would leave the viewport entirely; the centre stays over the tree. */
export function clampPan(view: View, bounds: Rect): View {
	return {
		scale: view.scale,
		cx: Math.min(bounds.x + bounds.w, Math.max(bounds.x, view.cx)),
		cy: Math.min(bounds.y + bounds.h, Math.max(bounds.y, view.cy)),
	};
}

/** The SVG transform that shows `view` in a viewport of `size`. */
export function transformFor(view: View, size: Size): string {
	const tx = size.w / 2 - view.cx * view.scale;
	const ty = size.h / 2 - view.cy * view.scale;
	const r = (n: number) => Math.round(n * 1000) / 1000;
	// The scale keeps 9 significant digits: rounded to 3 decimals, a small scale (0.031 at Fit on a
	// phone) moved the tree by up to 8 px against the view the gesture wrapper computes from (WP5.3).
	return `translate(${r(tx)} ${r(ty)}) scale(${Number(view.scale.toPrecision(9))})`;
}

/**
 * Zoom factor for one wheel event, smooth in the wheel distance: one mouse notch (about 100 px)
 * zooms by about 1.2, and a trackpad pinch (many small Ctrl+wheel events) zooms evenly.
 */
export function wheelFactor(deltaY: number, deltaMode: number): number {
	if (!Number.isFinite(deltaY)) return 1;
	const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
	const d = Math.max(-100, Math.min(100, px));
	return Math.exp(-d * WHEEL_ZOOM_PER_PX);
}

export const WHEEL_ZOOM_PER_PX = 0.002;

export function isPan(dx: number, dy: number): boolean {
	return Math.hypot(dx, dy) > PAN_THRESHOLD;
}

/** Grows `hit` around its centre so that it is at least MIN_HIT_PX on screen at `scale`. */
export function enlargeHit(hit: Rect, scale: number, minScreen = MIN_HIT_PX): Rect {
	if (!(scale > 0)) return hit;
	const min = minScreen / scale;
	const w = Math.max(hit.w, min);
	const h = Math.max(hit.h, min);
	return { x: hit.x - (w - hit.w) / 2, y: hit.y - (h - hit.h) / 2, w, h };
}

/**
 * The longest start of `text` that fits `maxW` with an ellipsis, measured by `measure`.
 * Whole text if it fits; an empty string if not even the ellipsis fits.
 */
export function truncate(text: string, maxW: number, measure: (s: string) => number): string {
	if (!text) return '';
	if (measure(text) <= maxW) return text;
	const chars = Array.from(text);
	const ell = '…';
	if (measure(ell) > maxW) return '';
	// Binary search on the number of characters kept.
	let lo = 0;
	let hi = chars.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(chars.slice(0, mid).join('').trimEnd() + ell) <= maxW) lo = mid;
		else hi = mid - 1;
	}
	return chars.slice(0, lo).join('').trimEnd() + ell;
}

/** Embedded height as a CSS length (spec §7.5). `options.height` counts only outside the phone layout. */
export function embedHeight(optionsHeight: number | undefined, phoneLayout: boolean, defaults: { desktop: string; phone: string }): string {
	if (phoneLayout) return defaults.phone;
	if (typeof optionsHeight === 'number' && Number.isFinite(optionsHeight) && optionsHeight >= 100 && optionsHeight <= 5000) {
		return `${Math.round(optionsHeight)}px`;
	}
	return defaults.desktop;
}

/** Viewport narrower than this uses the phone layout (spec §7). */
export const PHONE_MAX_WIDTH = 600;

// ---------- Touch gestures and viewport changes (M4 contract, src/render/gesture.ts) ----------

function finitePoint(p: Point): boolean {
	return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Two-finger pinch (spec §7.2): see `PinchView` in gesture.ts. */
export const pinchView: PinchView = (start, from, to, size, limits) => {
	if (!validSize(size) || !(start.scale > 0) || ![...from, ...to].every(finitePoint)) return start;
	const d0 = Math.hypot(from[0].x - from[1].x, from[0].y - from[1].y);
	const d1 = Math.hypot(to[0].x - to[1].x, to[0].y - to[1].y);
	// Fingers that start on one spot give no ratio: the pinch then only pans.
	const ratio = d0 > 1e-6 && d1 > 1e-6 ? d1 / d0 : 1;
	const scale = clampScale(start.scale * ratio, limits);
	const m0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
	const m1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
	const lx = start.cx + (m0.x - size.w / 2) / start.scale;
	const ly = start.cy + (m0.y - size.h / 2) / start.scale;
	return { scale, cx: lx - (m1.x - size.w / 2) / scale, cy: ly - (m1.y - size.h / 2) / scale };
};

/** Double-tap on empty background (spec §7.2): see `DoubleTapView` in gesture.ts. */
export const doubleTapView: DoubleTapView = (view, at, size, limits) => {
	if (!validSize(size) || !(view.scale > 0) || !finitePoint(at)) return view;
	return zoomAt(view, DOUBLE_TAP_FACTOR, at.x, at.y, size, limits);
};

/** See `IsDoubleTap` in gesture.ts. */
export const isDoubleTap: IsDoubleTap = (t0, p0, t1, p1) => {
	const dt = t1 - t0;
	if (!Number.isFinite(dt) || !finitePoint(p0) || !finitePoint(p1)) return false;
	return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(p1.x - p0.x, p1.y - p0.y) <= DOUBLE_TAP_PX;
};

/** Resize or orientation change (spec §7.5): see `ResizeView` in gesture.ts. */
export const resizeView: ResizeView = (view, _oldSize, _newSize, newLimits) => ({ scale: clampScale(view.scale, newLimits), cx: view.cx, cy: view.cy });
