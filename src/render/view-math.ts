/*
 * Pure viewport arithmetic for the DOM renderer: default view (spec §5.5), pan and zoom, level of
 * detail with hysteresis (§5.4), hit-area scaling (§7.5), text truncation and (M9) which picture
 * slots a view fills (`livePictureSlots`). Used by the tree view, the scene and pan-zoom, and
 * others; no DOM here, so all of it runs under vitest.
 */
import type { Rect } from '../layout/model';

/** The layout point shown at the centre of the viewport, and the zoom. */
export interface View {
	scale: number;
	cx: number;
	cy: number;
}

/** A width and height in px. */
export interface Size {
	w: number;
	h: number;
}

/** Level of detail a card is drawn at (spec §5.4): full text, compact, or an overview mark. */
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

/** The level of detail to draw at, given the current one (or null at the first draw) and the Full name size on screen. */
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

/** The smallest and largest zoom allowed: half of fit, up to `MAX_NAME_PX` of Full name text. */
export function scaleLimits(bounds: Rect, size: Size, fontPx: number): { min: number; max: number } {
	const f = fontPx > 0 ? fontPx : 16;
	const max = MAX_NAME_PX / f;
	const min = Math.min(fitScale(bounds, size) * 0.5, max);
	return { min: Math.max(min, 1e-3), max };
}

/** `scale`, kept inside `limits`; an invalid scale becomes the minimum. */
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

/**
 * The bars of the full-screen view (D222): screen px at the top and at the bottom of the viewport that a card may not go under. `left` and `right` are the side safe
 * areas of a phone held sideways (the notch, 0.3.1 V1): the views that the plugin chooses keep a card out of them; the drag limit (`panLimits`) does not look at them.
 */
export interface FreeArea {
	top: number;
	bottom: number;
	left?: number;
	right?: number;
}

/** A NaN inset (a bar the browser cannot measure) counts as no bar; `Math.max(0, NaN)` would be NaN. */
const finiteInset = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0);

/** The free area as far as `size` allows: both insets of an axis are kept apart by at least one px. */
function insetsIn(free: FreeArea, size: Size): Required<FreeArea> {
	const top = Math.max(0, Math.min(finiteInset(free.top), size.h - 1));
	const left = Math.max(0, Math.min(finiteInset(free.left), size.w - 1));
	return { top, bottom: Math.max(0, Math.min(finiteInset(free.bottom), size.h - 1 - top)), left, right: Math.max(0, Math.min(finiteInset(free.right), size.w - 1 - left)) };
}

/**
 * 0.3.1 (V1): a view that `make` chooses for the part of the viewport between the side safe areas, moved so that it shows there in the whole viewport.
 * The scale stays; with no side inset this is `make(size)`.
 */
export function betweenSides(size: Size, left: number, right: number, make: (area: Size) => View): View {
	const l = Math.max(0, Math.min(finiteInset(left), size.w - 1));
	const r = Math.max(0, Math.min(finiteInset(right), size.w - 1 - l));
	if (!l && !r) return make(size);
	const v = make({ w: size.w - l - r, h: size.h });
	return v.scale > 0 ? { scale: v.scale, cx: v.cx + (r - l) / 2 / v.scale, cy: v.cy } : v;
}

/**
 * 0.3.1 (F4): true when at least one of `boxes` meets the area that `view` shows in a viewport of `size` (with `free`, the viewport minus the bars). A saved view for
 * which this is false shows a blank screen: after a pinch, or after the window changed its size. A view that is not a real view shows nothing, so it is false too.
 */
export function cardShown(view: View, size: Size, boxes: Iterable<Rect>, free?: FreeArea): boolean {
	if (!(view.scale > 0) || !Number.isFinite(view.cx) || !Number.isFinite(view.cy) || !validSize(size)) return false;
	const { top, bottom } = free ? insetsIn(free, size) : { top: 0, bottom: 0 };
	const x0 = view.cx - size.w / 2 / view.scale;
	const x1 = view.cx + size.w / 2 / view.scale;
	const y0 = view.cy + (top - size.h / 2) / view.scale;
	const y1 = view.cy + (size.h / 2 - bottom) / view.scale;
	for (const b of boxes) if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) return true;
	return false;
}

/** A hair of room, so a tree that fits exactly (the fit scale) counts as fitting. */
const FIT_EPS = 1e-6;

/**
 * The limits for the centre of a pan, in layout px. Without `free`, and in an axis where the tree is larger than the screen, the centre stays over the
 * bounds. With `free` (D222), in an axis where the bounds at this scale are smaller than the free area, the bounds stay wholly inside the free area:
 * the bounds hold the 24 px margin, so a card stops that far short of the edge and never goes under a bar.
 */
export function panLimits(bounds: Rect, scale: number, size: Size, free?: FreeArea): { x0: number; x1: number; y0: number; y1: number } {
	let x0 = bounds.x;
	let x1 = bounds.x + bounds.w;
	let y0 = bounds.y;
	let y1 = bounds.y + bounds.h;
	if (free && validSize(size) && scale > 0) {
		const { top, bottom } = insetsIn(free, size);
		if (bounds.w * scale <= size.w + FIT_EPS) {
			x0 = bounds.x + bounds.w - size.w / 2 / scale;
			x1 = bounds.x + size.w / 2 / scale;
		}
		if (bounds.h * scale <= size.h - top - bottom + FIT_EPS) {
			y0 = bounds.y + bounds.h - (size.h / 2 - bottom) / scale;
			y1 = bounds.y + (size.h / 2 - top) / scale;
		}
	}
	return { x0, x1, y0, y1 };
}

/** `view` with its centre inside the limits. A pair that crosses (a rounding hair) gives the upper limit. */
export function clampTo(view: View, l: { x0: number; x1: number; y0: number; y1: number }): View {
	return { scale: view.scale, cx: Math.min(l.x1, Math.max(l.x0, view.cx)), cy: Math.min(l.y1, Math.max(l.y0, view.cy)) };
}

/** D246 (F3): the least space that a centred tree keeps between a card and the screen edge, in layout px (so `CENTRE_EDGE_MIN * scale` screen px). The rest of the 24 px margin may be cut. */
export const CENTRE_EDGE_MIN = 8;

/** D246 (F3): the smallest name size, in screen px, at which a tree that does not fit is made smaller to be centred. */
export const CENTRE_MIN_NAME_PX = 11;

/**
 * D246 (F3, option C): the opening view of a small tree in the full-screen view. First as D222: the tree fits at `scale`, so it is centred there. Else, if only its
 * empty margin would be cut (a card keeps at least CENTRE_EDGE_MIN px from each edge), it is centred at the same scale. Else it is made just small enough to fit
 * whole, if the names stay at CENTRE_MIN_NAME_PX or more. Otherwise null: the caller keeps its own view.
 */
export function centredOpening(bounds: Rect, size: Size, scale: number, free: FreeArea, fontPx: number): View | null {
	if (!validSize(size) || !(scale > 0) || !(bounds.w > 0) || !(bounds.h > 0)) return null;
	const { top, bottom, left, right } = insetsIn(free, size);
	const room = size.h - top - bottom;
	// V1: the side safe areas (a phone held sideways) are not free area either, so the tree is centred between them.
	const wide = size.w - left - right;
	const at = (k: number): View => ({ scale: k, cx: bounds.x + bounds.w / 2 + (right - left) / 2 / k, cy: bounds.y + bounds.h / 2 + (bottom - top) / 2 / k });
	// The margin is in layout px, so the part of it that may be cut is too: at a small scale (names 14 px on a large note font) it is fewer screen px (G2 S4).
	const cut = 2 * (FIT_MARGIN - CENTRE_EDGE_MIN) * scale;
	if (bounds.w * scale <= wide + cut + FIT_EPS && bounds.h * scale <= room + cut + FIT_EPS) return at(scale);
	const fit = Math.min(scale, wide / bounds.w, room / bounds.h);
	return fit > 0 && fit * fontPx >= CENTRE_MIN_NAME_PX - FIT_EPS ? at(fit) : null;
}

/** M11: true when `box` meets `view` grown by one view width left and right and one view height above and below (layout px). */
export function boxNearView(box: Rect, view: Rect): boolean {
	return box.x < view.x + 2 * view.w && box.x + box.w > view.x - view.w && box.y < view.y + 2 * view.h && box.y + box.h > view.y - view.h;
}

/**
 * 0.2.1: the box that holds an SVG path made of the absolute commands M, L, H, V, C, S, Q, T and Z, grown by `pad` on
 * every side. A curve lies inside the box of its control points, so the box never cuts a line short. Null when the path
 * has any other command (relative, arcs) or no point; the caller then treats the path as near every view.
 */
export function pathBox(d: string, pad = 0): Rect | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	// 0: no command yet; 72 H and 86 V take one number; 90 Z takes none; the others take pairs.
	let cmd = 0;
	let held = 0;
	let holding = false;
	const n = d.length;
	let i = 0;
	// A hand-written scan: the box of every line is computed when the scene is built, and a regular expression costs more here.
	while (i < n) {
		const c = d.charCodeAt(i);
		if (c <= 32 || c === 44) {
			i++;
			continue;
		}
		if (c === 77 || c === 76 || c === 72 || c === 86 || c === 67 || c === 83 || c === 81 || c === 84 || c === 90) {
			cmd = c;
			holding = false;
			i++;
			continue;
		}
		const start = i;
		if (c === 45) i++;
		while (i < n && ((d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) || d.charCodeAt(i) === 46)) i++;
		const e = d.charCodeAt(i);
		if (e === 101 || e === 69) {
			let k = i + 1;
			const sign = d.charCodeAt(k);
			if (sign === 43 || sign === 45) k++;
			if (d.charCodeAt(k) >= 48 && d.charCodeAt(k) <= 57) {
				while (d.charCodeAt(k) >= 48 && d.charCodeAt(k) <= 57) k++;
				i = k;
			}
		}
		if (i === start) return null;
		const v = Number(d.slice(start, i));
		if (v !== v) return null;
		if (cmd === 72) {
			if (minY === Infinity) return null;
			if (v < minX) minX = v;
			if (v > maxX) maxX = v;
		} else if (cmd === 86) {
			if (minX === Infinity) return null;
			if (v < minY) minY = v;
			if (v > maxY) maxY = v;
		} else if (cmd === 0 || cmd === 90) return null;
		else if (!holding) {
			held = v;
			holding = true;
		} else {
			if (held < minX) minX = held;
			if (held > maxX) maxX = held;
			if (v < minY) minY = v;
			if (v > maxY) maxY = v;
			holding = false;
		}
	}
	if (minX === Infinity) return null;
	return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** The SVG transform that shows `view` in a viewport of `size`. */
export function transformFor(view: View, size: Size): string {
	const tx = size.w / 2 - view.cx * view.scale;
	const ty = size.h / 2 - view.cy * view.scale;
	const r = (n: number) => Math.round(n * 1000) / 1000;
	// The scale keeps 9 significant digits: rounded to 3 decimals, a small scale (0.031 at Fit on a
	// phone) moved the tree by up to 8 px against the view the gesture wrapper computes from.
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

/** How much one wheel px zooms by, in `wheelFactor`'s `exp`. */
export const WHEEL_ZOOM_PER_PX = 0.002;

/** True once a press has moved further than `PAN_THRESHOLD`, so it counts as a pan, not a tap. */
export function isPan(dx: number, dy: number): boolean {
	return Math.hypot(dx, dy) > PAN_THRESHOLD;
}

/** 0.2.8 (G.13): the tap area of a fold control and of a `+` badge is at least this many em square. */
export const HIT_EM = 3;

/** Grows `hit` around its centre so that it is at least MIN_HIT_PX on screen at `scale`. */
export function enlargeHit(hit: Rect, scale: number, minScreen = MIN_HIT_PX): Rect {
	if (!(scale > 0)) return hit;
	const min = minScreen / scale;
	const w = Math.max(hit.w, min);
	const h = Math.max(hit.h, min);
	return { x: hit.x - (w - hit.w) / 2, y: hit.y - (h - hit.h) / 2, w, h };
}

/**
 * M10 (F7): the tap area of a fold control at zoom `scale`: at least 44 screen px each way (44 / scale layout px),
 * centred on the centre of the `visible` mark. A mark wider than that (a long "+ N" sign) keeps its own width.
 * Where it meets a card, a far-couple tag, a `+` badge or a D14 sign, the tree view cuts it back.
 * 0.2.8 (G.13): with `em` (the note font in px) the area is also at least 3 em each way, so it is large at the readable zoom and below it.
 */
export function foldHit(visible: Rect, scale: number, em = 0): Rect {
	const min = Math.max(scale > 0 ? MIN_HIT_PX / scale : MIN_HIT_PX, HIT_EM * em);
	const w = Math.max(visible.w, min);
	const h = Math.max(visible.h, min);
	const cx = visible.x + visible.w / 2;
	const cy = visible.y + visible.h / 2;
	return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** M10 (F10): moves `view` so that the layout point `to` shows where the layout point `from` showed; the scale stays. */
export function keepSpot(view: View, from: { x: number; y: number }, to: { x: number; y: number }): View {
	return { scale: view.scale, cx: view.cx + (to.x - from.x), cy: view.cy + (to.y - from.y) };
}

/** What the pan limits need to clamp a kept-place view: the new tree bounds, the viewport and (full-screen view) the bars. */
export interface KeepPlaceArea {
	bounds: Rect;
	size: Size;
	free?: FreeArea;
}

/**
 * 0.3.1 (D244): the view after an edit, so that the card of person `id` shows where it showed before. The scale stays. Null when no shift
 * applies: the person has no card before or after the edit (a delete, a card a fold hides). With `area` the shifted view is clamped like
 * a dragged view (D222), so the limits win over the exact place.
 */
export function keepPlaceShift(before: ReadonlyMap<string, Rect>, after: ReadonlyMap<string, Rect>, id: string, view: View, area?: KeepPlaceArea): View | null {
	const was = before.get(id);
	const now = after.get(id);
	if (!was || !now || !(view.scale > 0)) return null;
	const shifted = keepSpot(view, { x: was.x + was.w / 2, y: was.y + was.h / 2 }, { x: now.x + now.w / 2, y: now.y + now.h / 2 });
	if (![shifted.cx, shifted.cy].every(Number.isFinite)) return null;
	return area ? clampTo(shifted, panLimits(area.bounds, shifted.scale, area.size, area.free)) : shifted;
}

/**
 * 0.3.1 (D245): the smallest pan that brings `box` wholly into the free area of the viewport (the viewport minus the bars). The scale stays. An axis in which the card is
 * larger than the free area centres the card there. The view is returned as it is when the card is already wholly inside.
 */
export function bringInView(view: View, box: Rect, area: { size: Size; free?: FreeArea }): View {
	if (!(view.scale > 0) || !validSize(area.size)) return view;
	const { top, bottom, left, right } = area.free ? insetsIn(area.free, area.size) : { top: 0, bottom: 0, left: 0, right: 0 };
	const axis = (lo: number, hi: number, centre: number, from: number, to: number): number => {
		if (hi - lo > to - from) return centre + (lo + hi) / 2 - (from + to) / 2;
		if (lo < from) return centre + (lo - from);
		if (hi > to) return centre + (hi - to);
		return centre;
	};
	const cx = axis(box.x, box.x + box.w, view.cx, view.cx + (left - area.size.w / 2) / view.scale, view.cx + (area.size.w / 2 - right) / view.scale);
	const cy = axis(box.y, box.y + box.h, view.cy, view.cy + (top - area.size.h / 2) / view.scale, view.cy + (area.size.h / 2 - bottom) / view.scale);
	return { scale: view.scale, cx, cy };
}

/** The grapheme splitter; undefined until the first need, null when the engine has none (T-X2-01). One instance serves every cut. */
let splitter: Intl.Segmenter | null | undefined;

/**
 * The letters of `text` as a reader sees them (T-X2-01): a flag, a joined emoji, an emoji with a skin tone and a letter with marks are one piece each,
 * so a cut with "…" never falls inside one. Text whose code units are all below U+0300 has no such piece, so it takes the plain path with no segmenter.
 * An engine with no `Intl.Segmenter` falls back to code points.
 */
export function graphemes(text: string): string[] {
	let plain = true;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) >= 0x300) {
			plain = false;
			break;
		}
	}
	if (plain) return text.split('');
	if (splitter === undefined) splitter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
	if (!splitter) return Array.from(text);
	const out: string[] = [];
	for (const { segment } of splitter.segment(text)) {
		// A space that a mark follows (a stray joiner or variation selector) stays a space, so a name still breaks there; the mark goes on as a piece of its own.
		if (segment.length > 1 && segment.charCodeAt(0) === 32) out.push(' ', segment.slice(1));
		else out.push(segment);
	}
	return out;
}

/**
 * The longest start of `text` that fits `maxW` with an ellipsis, measured by `measure`.
 * Whole text if it fits; an empty string if not even the ellipsis fits. The cut falls between letters (`graphemes`).
 */
export function truncate(text: string, maxW: number, measure: (s: string) => number): string {
	if (!text) return '';
	if (measure(text) <= maxW) return text;
	const chars = graphemes(text);
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

/**
 * A window narrower than this lays out the plugin's windows and the full-screen view for a phone.
 * The tree's own phone rules (D20, D23, D30) use `isPhoneWindow` in focus-mode.ts instead.
 */
export const PHONE_MAX_WIDTH = 600;

// ---------- Touch gestures and viewport changes (spec §7.2, §7.5, §7.6) ----------

/** A screen point in viewport px from the top-left corner. */
export interface Point {
	x: number;
	y: number;
}

/** The smallest and largest zoom a gesture may reach; same shape as `scaleLimits`'s result. */
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

function finitePoint(p: Point): boolean {
	return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Two-finger pinch (spec §7.2): see `PinchView`. */
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

/** Double-tap on empty background (spec §7.2): see `DoubleTapView`. */
export const doubleTapView: DoubleTapView = (view, at, size, limits) => {
	if (!validSize(size) || !(view.scale > 0) || !finitePoint(at)) return view;
	return zoomAt(view, DOUBLE_TAP_FACTOR, at.x, at.y, size, limits);
};

/** See `IsDoubleTap`. */
export const isDoubleTap: IsDoubleTap = (t0, p0, t1, p1) => {
	const dt = t1 - t0;
	if (!Number.isFinite(dt) || !finitePoint(p0) || !finitePoint(p1)) return false;
	return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(p1.x - p0.x, p1.y - p0.y) <= DOUBLE_TAP_PX;
};

/** Resize or orientation change (spec §7.5): see `ResizeView`. */
export const resizeView: ResizeView = (view, _oldSize, _newSize, newLimits) => ({ scale: clampScale(view.scale, newLimits), cx: view.cx, cy: view.cy });

/** Spec §13.0 item 3: at most this many picture elements in each view (B18). */
export const MAX_LIVE_PICTURES = 150;

/**
 * S3 (spec §13.0 item 3 "Live pictures"): the indexes of the picture slots a view fills. Only the
 * slots of the shown level (Full: Full arms and portraits; Compact: Compact arms; Overview: none),
 * only those that meet `view` (the visible part, layout px) grown by half its size on each side,
 * nearest the view's centre first (ties in slot order), and at most `max`.
 */
export function livePictureSlots(slots: readonly { kind: 'arms' | 'portrait'; lod: 'full' | 'compact'; rect: Rect }[], view: Rect, lod: Lod, max = MAX_LIVE_PICTURES): number[] {
	if (lod === 'overview' || !(max > 0)) return [];
	const x0 = view.x - view.w / 2;
	const y0 = view.y - view.h / 2;
	const x1 = view.x + view.w * 1.5;
	const y1 = view.y + view.h * 1.5;
	const cx = view.x + view.w / 2;
	const cy = view.y + view.h / 2;
	const near: { i: number; d: number }[] = [];
	slots.forEach((s, i) => {
		if (s.lod !== lod) return;
		const r = s.rect;
		if (r.x >= x1 || r.x + r.w <= x0 || r.y >= y1 || r.y + r.h <= y0) return;
		const dx = r.x + r.w / 2 - cx;
		const dy = r.y + r.h / 2 - cy;
		near.push({ i, d: dx * dx + dy * dy });
	});
	// Array.prototype.sort is stable, so equal distances keep slot order.
	near.sort((a, b) => a.d - b.d);
	return near.slice(0, max).map((n) => n.i);
}

/** The tail that a cut card text with a maybe keeps (D176 5): the word is cut, the question mark stays. */
export const MAYBE_CUT_TAIL = ' ?';

/**
 * Cuts a card relation text that has a maybe suffix (D176 5). If `word + suffix` fits, it is whole. If not, the relation word is cut
 * and the text ends with "… ?", so a maybe never disappears. The word keeps its own "…" also when it fits alone, so the cut shows.
 */
export function truncateWithMaybe(word: string, suffix: string, maxW: number, measure: (s: string) => number): string {
	if (!suffix) return truncate(word, maxW, measure);
	const whole = word + suffix;
	if (measure(whole) <= maxW) return whole;
	const tail = '…' + MAYBE_CUT_TAIL;
	const chars = graphemes(word);
	let n = chars.length;
	while (n > 0 && measure(chars.slice(0, n).join('').trimEnd() + tail) > maxW) n--;
	// Not even one letter fits with the tail: fall back to the plain cut.
	return n > 0 ? chars.slice(0, n).join('').trimEnd() + tail : truncate(whole, maxW, measure);
}

/**
 * The path of a house ribbon (0.2.8, contract C, G.15): the strip along the top edge (`edge` 'top': a band `w` wide and `t` thick) or the left edge (`edge` 'left': a band
 * `t` wide and `h` high) of a card with corners of radius `r`. The two corners at the strip's ends follow the card's own corners, so no strip sticks out of
 * the rounded card. A strip thinner than the radius ends in the arc of the corner circle (no part of it lies outside the card); a thicker one has the arc and a straight foot.
 * The radius is read from the theme at run time in the live tree (`readCornerRadius`) and fixed in a saved picture.
 */
export function ribbonPath(x: number, y: number, w: number, h: number, t: number, r: number, edge: 'top' | 'left'): string {
	const n = (v: number) => Math.round(v * 100) / 100;
	// The long side of the strip sets the largest radius that still fits, the thin side does not (a strip may be thinner than the corner).
	const long = edge === 'top' ? w : h;
	const rr = Math.max(0, Math.min(r, long / 2));
	if (edge === 'top') {
		if (rr === 0) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + t)}H${n(x)}Z`;
		if (t >= rr) return `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)}V${n(y + t)}H${n(x)}V${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`;
		const dx = rr - Math.sqrt(rr * rr - (rr - t) * (rr - t));
		return `M${n(x + rr)} ${n(y)}H${n(x + w - rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - dx)} ${n(y + t)}H${n(x + dx)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}Z`;
	}
	if (rr === 0) return `M${n(x)} ${n(y)}H${n(x + t)}V${n(y + h)}H${n(x)}Z`;
	if (t >= rr) return `M${n(x)} ${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)}H${n(x + t)}V${n(y + h)}H${n(x + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}Z`;
	const dy = rr - Math.sqrt(rr * rr - (rr - t) * (rr - t));
	return `M${n(x)} ${n(y + rr)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x + t)} ${n(y + dy)}V${n(y + h - dy)}A${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)}Z`;
}
