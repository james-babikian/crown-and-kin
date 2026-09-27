/*
 * Which focus family a view draws, and its first view (spec §5.6, D18). Pure, so the priority
 * rules run under vitest; the tree view supplies the facts.
 */

import type { Orientation, Rect } from '../layout/model';
import { FIT_MIN_NAME_PX, MIN_HIT_PX, READABLE_NAME_PX, START_TOP_GAP, fitScale, type Size, type View } from '../render/view-math';

/**
 * What the user chose for this block in this session (Focus, Focus here, a `+` badge, Show all
 * people). `id: null` is "show all people". Kept in the block's view state until the note closes.
 */
export interface SessionFocus {
	id: string | null;
}

/** A phone opens a tree with no pin as the start person's family only above this many people (D20). */
export const PHONE_FOCUS_MIN_PEOPLE = 100;

/** Below this width or height (the shorter side of the window), a touch-first device is a phone. */
export const PHONE_SHORT_SIDE = 600;

/** A phone: a coarse pointer and a window whose shorter side is under 600 px. Tablets are not phones. */
export function isPhoneWindow(coarse: boolean, innerWidth: number, innerHeight: number): boolean {
	return coarse && Math.min(innerWidth, innerHeight) < PHONE_SHORT_SIDE;
}

/**
 * D24: the tree is drawn sideways only on a phone in portrait: height greater than width. A phone's
 * keyboard makes the window lower but never wider: a window exactly as wide as the screen's short side
 * also counts as portrait (on a small phone the keyboard can leave less height than width, and the
 * tree under an edit sheet must not turn). Any other window, for example a landscape-shaped window
 * on a tablet, follows height > width.
 */
export function orientationFor(coarse: boolean, innerWidth: number, innerHeight: number, screen?: { width: number; height: number } | null): Orientation {
	if (!isPhoneWindow(coarse, innerWidth, innerHeight)) return 'down';
	if (innerHeight > innerWidth) return 'sideways';
	const short = screen && screen.width > 0 && screen.height > 0 ? Math.min(screen.width, screen.height) : 0;
	return short > 0 && Math.abs(innerWidth - short) <= 1 && Math.max(screen!.width, screen!.height) > short + 1 ? 'sideways' : 'down';
}

/** The facts `chooseFocus` needs about one block's tree, supplied by the tree view. */
export interface FocusFacts {
	session: SessionFocus | null;
	/** `options.focus` (the pin, D18). */
	pin: string | undefined;
	/** The phone rule applies (see isPhoneWindow). */
	phone: boolean;
	/** The focus the phone rule chose earlier for this block (kept so an edit does not move it). */
	auto: string | null;
	has(id: string): boolean;
	/** D20: the whole tree has more than PHONE_FOCUS_MIN_PEOPLE people (distinct ids). Called only on a phone. */
	large(): boolean;
	/** The start person of the whole tree (spec §5.5). Called only when the phone rule decides. */
	start(): string | null;
}

/** What `chooseFocus` decided, and what the caller should remember or forget. */
export interface FocusChoice {
	/** The focus person to draw, or null for the whole tree. */
	id: string | null;
	/** Where the choice came from. */
	from: 'session' | 'pin' | 'phone' | 'none';
	/** A session focus whose person is gone: the caller forgets it. */
	dropSession: boolean;
	/** The phone rule's choice to remember (unchanged when the rule did not run). */
	auto: string | null;
}

/**
 * Priority order: the session focus; the pin; on a phone, a large tree opens as the focus
 * family of the start person (D20: more than 100 people); else the whole tree. A reference to a person who is not in the tree
 * counts as absent (the pin's missing reference is one of the tree's problems, spec §8).
 */
export function chooseFocus(f: FocusFacts): FocusChoice {
	let dropSession = false;
	if (f.session) {
		if (f.session.id === null) return { id: null, from: 'session', dropSession, auto: f.auto };
		if (f.has(f.session.id)) return { id: f.session.id, from: 'session', dropSession, auto: f.auto };
		dropSession = true;
	}
	if (f.pin !== undefined && f.has(f.pin)) return { id: f.pin, from: 'pin', dropSession, auto: f.auto };
	if (!f.phone || !f.large()) return { id: null, from: 'none', dropSession, auto: f.auto };
	if (f.auto !== null && f.has(f.auto)) return { id: f.auto, from: 'phone', dropSession, auto: f.auto };
	const auto = f.start();
	return auto !== null && f.has(auto) ? { id: auto, from: 'phone', dropSession, auto } : { id: null, from: 'none', dropSession, auto: null };
}

/** Screen px kept free at each side of the cards that the focus view moves into sight. */
export const FOCUS_SIDE_PAD = 8;

/**
 * First view of a focus tree (D18, §5.6): the whole focus family fitted if its names are then at
 * least 11 px; else 14 px names with the focus person's card at the centre of the area below
 * `insetTop`, so the parents show above and the children below. Not clamped to the tree: the
 * focus person is centred even at the family's edge. Only when no child of the focus person would
 * show whole does the view move sideways, as little as it can, to show a whole child next to the
 * whole focus card (a person's children can sit far apart under their own families); if none
 * fits, it shows as much of the nearest child as it can. With `atTop` (the focus person has no
 * parent in the drawn family, D23) the card sits near the top of the area instead, as in D13, so
 * the view is not half empty. The same happens in a low box (a phone on its side, D30) when the
 * centred view cannot show the `parents`, the focus card and a child whole (see `familyFits`).
 */
export function focusView(bounds: Rect, size: Size, fontPx: number, focus: Rect | null, insetTop = 0, children: Rect[] = [], atTop = false, parents: Rect[] = []): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const area = { w: size.w, h: size.h - top };
	const fit = fitScale(bounds, area);
	const f = fontPx > 0 ? fontPx : 16;
	let v: View;
	if (fit * f >= FIT_MIN_NAME_PX || !focus) v = { scale: fit, cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 };
	else {
		const scale = READABLE_NAME_PX / f;
		const low = atTop || !familyFits(focus, parents, children, scale, area.h);
		const cy = low ? focus.y - START_TOP_GAP + area.h / 2 / scale : focus.y + focus.h / 2;
		v = { scale, cx: focus.x + focus.w / 2 + childShift(focus, children, area.w / scale, FOCUS_SIDE_PAD / scale), cy };
	}
	return top > 0 && v.scale > 0 ? { scale: v.scale, cx: v.cx, cy: v.cy - top / 2 / v.scale } : v;
}

/**
 * D18 in a low box: with the focus card centred in a free area `areaH` screen px high,
 * do all its parents show whole above it and a child whole below it? True with no parent or no child
 * (then the centred view loses nothing). If false, the first view uses the D13 rule of a person
 * without parents: the card near the top, the children below, and no card under the toolbar.
 */
export function familyFits(focus: Rect, parents: readonly Rect[], children: readonly Rect[], scale: number, areaH: number): boolean {
	if (!parents.length || !children.length || !(scale > 0)) return true;
	const mid = focus.y + focus.h / 2;
	const up = mid - Math.min(...parents.map((p) => p.y));
	const down = Math.min(...children.map((c) => c.y + c.h)) - mid;
	return Math.max(up, down) * scale <= areaH / 2 + 1e-6;
}

/** The sideways move (layout px) from the focus card's centre that brings a child into sight (see focusView). */
function childShift(focus: Rect, children: Rect[], width: number, pad: number): number {
	const own = focus.x + focus.w / 2;
	const w = width - 2 * pad;
	if (!children.length || !(w >= focus.w)) return 0;
	// A child cut by no more than the side margin at the centre keeps the focus person exactly centred (D18).
	const slack = width / 2 + pad;
	if (children.some((c) => c.x >= own - slack - 1e-6 && c.x + c.w <= own + slack + 1e-6)) return 0;
	let best: number | null = null;
	for (const c of children) {
		const left = Math.min(focus.x, c.x);
		const right = Math.max(focus.x + focus.w, c.x + c.w);
		if (right - left > w) continue;
		// The window's centre may lie anywhere that keeps both cards whole; take the one nearest the focus person.
		const cx = Math.min(left + w / 2, Math.max(right - w / 2, own));
		if (best === null || Math.abs(cx - own) < Math.abs(best)) best = cx - own;
	}
	if (best !== null) return best;
	// No child fits whole beside the focus card: keep that card whole at the window's edge, towards
	// the nearest child, if part of the child then shows. Else stay centred: a move that shows no
	// child only takes the focus person away from the centre.
	const near = children.reduce((a, c) => (Math.abs(c.x + c.w / 2 - own) < Math.abs(a.x + a.w / 2 - own) ? c : a));
	const max = (w - focus.w) / 2;
	const right = near.x + near.w / 2 > own;
	const seen = right ? own + max + w / 2 - near.x : near.x + near.w - (own - max - w / 2);
	return seen > near.w / 4 ? (right ? max : -max) : 0;
}

/**
 * The tap area of a `+` badge in layout px at `scale` (spec §7.5): at least 44 screen px square
 * while names are at least 11 px, with its right edge at the badge's right edge, so it reaches over
 * its own card's corner and not over the next card (1.25 em away). At a smaller zoom it is only the
 * badge's circle, so the cards keep the space.
 */
export function badgeHit(mark: Rect, scale: number, fontPx: number): Rect {
	if (!(scale > 0) || scale * fontPx < FIT_MIN_NAME_PX) return mark;
	const side = Math.max(MIN_HIT_PX / scale, mark.w, mark.h);
	return { x: mark.x + mark.w - side, y: mark.y + mark.h / 2 - side / 2, w: side, h: side };
}

/**
 * Moves `view` down (screen px) just enough that no box on screen lies under the toolbar `bar`
 * (a rectangle in viewport px), but never so far that `keep` (the focus card) leaves the area above
 * `bottom`. For the D18 first view: the centred family, with no card or badge starting under the toolbar.
 */
export function clearToolbar(view: View, size: Size, bar: { left: number; right: number; bottom: number }, boxes: Iterable<Rect>, keep: Rect | null, bottom: number): View {
	if (!(view.scale > 0) || !(bar.bottom > 0) || !(bar.right > bar.left)) return view;
	const list = [...boxes];
	let v = view;
	for (let i = 0; i < 4; i++) {
		let shift = 0;
		for (const b of list) {
			const left = size.w / 2 + (b.x - v.cx) * v.scale;
			const right = left + b.w * v.scale;
			const top = size.h / 2 + (b.y - v.cy) * v.scale;
			const low = top + b.h * v.scale;
			if (right <= bar.left || left >= bar.right || low <= 0 || top >= bar.bottom) continue;
			shift = Math.max(shift, bar.bottom - top);
		}
		if (keep) {
			const keepLow = size.h / 2 + (keep.y + keep.h - v.cy) * v.scale;
			shift = Math.min(shift, Math.max(0, bottom - keepLow));
		}
		if (shift <= 0.5) break;
		v = { scale: v.scale, cx: v.cx, cy: v.cy - shift / v.scale };
	}
	return v;
}

/**
 * The `+` badge's tap area in `sideways` (D24): the badge sits inside its card's top
 * right corner, off the lines in the column gaps, so the tap area is a square in that corner, at
 * least 44 screen px while names are at least 11 px (the card is then at least 44 px high), and
 * always over the whole visible badge (zoomed in, 44 px can be smaller than the badge). At a smaller
 * zoom it is only the badge's circle, so the card keeps the space.
 */
export function badgeHitInCard(mark: Rect, card: Rect, scale: number, fontPx: number): Rect {
	if (!(scale > 0) || scale * fontPx < FIT_MIN_NAME_PX) return mark;
	const reach = Math.max(card.x + card.w - mark.x, mark.y + mark.h - card.y);
	const side = Math.max(reach, Math.min(card.w, card.h, MIN_HIT_PX / scale));
	return { x: card.x + card.w - side, y: card.y, w: side, h: side };
}

/** The smallest gap between two sideways columns of narrow cards, in em. */
export const NARROW_GAP_EM = 3;
/** Narrow card widths the layout accepts, in em; matches `LayoutSettings.narrowCardW`. */
export const NARROW_MIN_EM = 8;
/** The widest narrow card width the layout accepts, in em; `narrowCardWidth` clamps to it. */
export const NARROW_MAX_EM = 10.25;
/**
 * Screen px kept free right of the children's column: a `+` badge's reach past its card corner at 14 px
 * names (0.9 em), so the column does not touch the box edge.
 */
const NARROW_RIGHT_ROOM = 0.9 * READABLE_NAME_PX;

/**
 * The narrow card width (layout px, to 0.5 px) at which the person's column (8 screen px from
 * the left) and the children's column fit whole side by side in a note preview `box` screen px wide,
 * at the first view's 14 px names: (box − 8 − badge room − 3 em gap) / 2. Clamped as the layout
 * clamps it; undefined while the box has no width.
 */
export function narrowCardWidth(box: number, fontPx: number): number | undefined {
	if (!(box > 0)) return undefined;
	const f = fontPx > 0 ? fontPx : 16;
	const scale = READABLE_NAME_PX / f;
	const w = ((box - FOCUS_SIDE_PAD - NARROW_RIGHT_ROOM) / scale - NARROW_GAP_EM * f) / 2;
	return Math.round(Math.min(NARROW_MAX_EM * f, Math.max(NARROW_MIN_EM * f, w)) * 2) / 2;
}

/** The cards the sideways first view places (D24). */
export interface SidewaysGroup {
	/** The focus person, or the start person of a whole tree. */
	me: Rect | null;
	partners: Rect[];
	/** The children drawn beside the person, each with their partners. */
	children: { card: Rect; partners: Rect[] }[];
	/** Placement parents: the left column when the person has no children. */
	parents: Rect[];
}

/**
 * First view in `sideways` (D24): names at 14 px, never a fit. The person's column
 * sits at the left edge (8 screen px in) with the children's column beside it; with no children, the
 * parents' column goes at the left if the person still shows whole beside it. The group (the person,
 * partners, children and their partners; with no children, the parents) starts 24 layout px below
 * `top`, the top of the free area in screen px. A group taller than the free area (down to `bottom`)
 * starts at the person and their nearest child instead (`tall`), and the person always shows whole.
 */
export function sidewaysView(size: Size, fontPx: number, g: SidewaysGroup, top: number, bottom: number, fallback: Rect): { view: View; tall: boolean } {
	const f = fontPx > 0 ? fontPx : 16;
	const scale = READABLE_NAME_PX / f;
	const pad = FOCUS_SIDE_PAD / scale;
	const at = (left: number, freeTop: number): View => ({ scale, cx: left - pad + size.w / 2 / scale, cy: freeTop - top / scale + size.h / 2 / scale });
	const me = g.me;
	if (!me) return { view: at(fallback.x, fallback.y - START_TOP_GAP), tall: false };
	let left = me.x;
	if (!g.children.length && g.parents.length) {
		const px = Math.min(...g.parents.map((p) => p.x));
		if ((me.x + me.w - px) * scale + 2 * FOCUS_SIDE_PAD <= size.w) left = px;
	}
	const kids = g.children.map((c) => [c.card, ...c.partners]);
	const group = [me, ...g.partners, ...(kids.length ? kids.flat() : g.parents)];
	const gTop = Math.min(...group.map((b) => b.y));
	const gBottom = Math.max(...group.map((b) => b.y + b.h));
	const free = Math.max(0, bottom - top) / scale;
	let t = gTop - START_TOP_GAP;
	const tall = gBottom - t > free;
	if (tall) {
		// Too tall: start at the person and the child nearest to them, with that child's partners
		// (sample tree 6). The person always shows whole.
		const near = (kids.length ? kids : g.parents.map((p) => [p])).reduce<Rect[]>((a, b) => (!a.length || Math.abs(b[0].y - me.y) < Math.abs(a[0].y - me.y) ? b : a), []);
		t = Math.min(me.y, ...near.map((b) => b.y)) - START_TOP_GAP;
		if (me.y + me.h > t + free) t = me.y + me.h - free;
	}
	return { view: at(left, t), tall };
}

/**
 * D28: how many of `cards` (the person's children) are not wholly inside the box between `top` and
 * `bottom` (screen px) at `view`: `up` if a card reaches above it, else `down` if it reaches below it.
 */
export function outsideBox(view: View, size: Size, cards: Iterable<Rect>, top: number, bottom: number): { up: number; down: number } {
	let up = 0;
	let down = 0;
	if (!(view.scale > 0)) return { up, down };
	for (const c of cards) {
		const y0 = size.h / 2 + (c.y - view.cy) * view.scale;
		const y1 = y0 + c.h * view.scale;
		if (y0 < top - 0.5) up++;
		else if (y1 > bottom + 0.5) down++;
	}
	return { up, down };
}

/**
 * D31: in `down`, a far-couple tag's tap area hangs from its card's bottom edge: at least 44 screen px
 * high and wide at `scale`, and never shorter than the layout's own area below the card. The card
 * keeps all of its own area (cards win where they meet). With no card, the area grows around
 * its centre as before.
 */
export function tagHitBelow(hit: Rect, card: Rect | undefined, scale: number): Rect {
	if (!(scale > 0)) return hit;
	const min = MIN_HIT_PX / scale;
	const w = Math.max(hit.w, min);
	const x = hit.x - (w - hit.w) / 2;
	if (!card) {
		const h = Math.max(hit.h, min);
		return { x, y: hit.y - (h - hit.h) / 2, w, h };
	}
	const top = card.y + card.h;
	return { x, y: top, w, h: Math.max(min, hit.y + hit.h - top) };
}
