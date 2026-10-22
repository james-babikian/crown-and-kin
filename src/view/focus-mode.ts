/*
 * Which focus family a view draws, and its first view (spec §5.6, D18); also the direction of the
 * relation finder's small tree on an upright phone (D51) and the first view of the finder's line.
 * Pure, so the priority rules run under vitest; the tree view supplies the facts.
 */

import { foldMark } from '../layout/fold-spots';
import type { Orientation, Rect, TreeLayout } from '../layout/model';
import { COMPACT_NAME_EM } from '../render/dom/scene';
import type { PhoneDirection } from './settings';
import { around } from './tree-view-helpers';
import { FIT_MIN_NAME_PX, HIT_EM, MIN_HIT_PX, READABLE_NAME_PX, START_TOP_GAP, chooseLod, enlargeHit, fitScale, fitView, type Size, type View } from '../render/view-math';

/**
 * What the user chose for this block in this session (Focus, Focus here, a `+` badge, Clear focus).
 * `id: null` is the whole tree (Clear focus). Kept in the block's view state until the note closes.
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

/** The facts of a window that the phone tests read; a real `Window` fits. */
export interface PhoneWindow {
	innerWidth: number;
	innerHeight: number;
	screen?: { width: number; height: number } | null;
}

/**
 * Is this device a phone? The screen decides, not the window: an on-screen keyboard makes a tablet's window lower than 600 px, but not its screen.
 * The toolbar's look (`is-phone-side`) and its button set (`TreeView.barKind`) both ask this, so they cannot disagree.
 */
export function isPhoneDevice(coarse: boolean, win: PhoneWindow): boolean {
	return isPhoneWindow(coarse, win.screen?.width || win.innerWidth, win.screen?.height || win.innerHeight);
}

/**
 * D242: a phone held sideways. A phone device whose window is wider than high. A window exactly as wide as the screen's short side
 * is a phone held upright with its keyboard open (the keyboard makes the window lower, never wider; see `orientationFor`), so it is not sideways.
 * A window narrower than 600 px has the phone look on its own (`is-phone`), so this matters only for windows from 600 px up.
 */
export function isPhoneSideways(coarse: boolean, win: PhoneWindow): boolean {
	if (!isPhoneDevice(coarse, win) || win.innerWidth <= win.innerHeight) return false;
	const sw = win.screen?.width ?? 0;
	const sh = win.screen?.height ?? 0;
	if (sw <= 0 || sh <= 0) return true;
	const short = Math.min(sw, sh);
	return !(Math.abs(win.innerWidth - short) <= 1 && Math.max(sw, sh) > short + 1);
}

/**
 * D24 and D150: the tree is drawn sideways only on a phone held upright, and only if the setting
 * `direction` says Sideways. The window must be a phone window, and when the screen size is known the
 * screen must be a phone too: an iPad in a narrow Split View window is a tablet and stays top to
 * bottom. This is the same test as `TreeView.isPhone()`. A phone's keyboard makes the window lower but
 * never wider: a window exactly as wide as the screen's short side also counts as upright (on a small
 * phone the keyboard can leave less height than width, and the tree under an edit sheet must not
 * turn). Any other window follows height > width.
 */
export function orientationFor(coarse: boolean, innerWidth: number, innerHeight: number, screen?: { width: number; height: number } | null, direction: PhoneDirection = 'sideways'): Orientation {
	if (!isPhoneWindow(coarse, innerWidth, innerHeight)) return 'down';
	const known = !!screen && screen.width > 0 && screen.height > 0;
	if (known && !isPhoneWindow(coarse, screen.width, screen.height)) return 'down';
	if (direction === 'down') return 'down';
	if (innerHeight > innerWidth) return 'sideways';
	const short = known ? Math.min(screen.width, screen.height) : 0;
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
	/**
	 * F5: a draw of the whole tree stopped (spec §7.7) and this view is new. Then a session choice of the whole tree (Clear focus) is not taken
	 * over: the view opens on the family that the other rules give, and the stop bar shows again only when the user chooses Clear focus once more.
	 */
	stopped?: boolean;
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
 * Priority order: the session focus; the pin; on a phone, a large tree (D20: more than 100 people) opens as the focus family of the
 * start person; else the whole tree. Only the full-screen view asks on a phone: a tree in a note on a phone is a list (D144). A reference
 * to a person who is not in the tree counts as absent (the pin's missing reference is one of the tree's problems, spec §8).
 */
export function chooseFocus(f: FocusFacts): FocusChoice {
	let dropSession = false;
	if (f.session) {
		if (f.session.id === null && !f.stopped) return { id: null, from: 'session', dropSession, auto: f.auto };
		if (f.session.id !== null && f.has(f.session.id)) return { id: f.session.id, from: 'session', dropSession, auto: f.auto };
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
 * G3 F4: when no child can show whole at 14 px names, the names go smaller, not under 11 px, so that a child shows whole beside the couple (the focus card and the
 * near `partners`), else beside the focus card (see `smallerForChild`).
 */
export function focusView(bounds: Rect, size: Size, fontPx: number, focus: Rect | null, insetTop = 0, children: Rect[] = [], atTop = false, parents: Rect[] = [], partners: Rect[] = []): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const area = { w: size.w, h: size.h - top };
	const fit = fitScale(bounds, area);
	const f = fontPx > 0 ? fontPx : 16;
	let v: View;
	if (fit * f >= FIT_MIN_NAME_PX || !focus) v = { scale: fit, cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 };
	else {
		const readable = READABLE_NAME_PX / f;
		const lowAt = (k: number) => atTop || !familyFits(focus, parents, children, k, area.h);
		// G3 F4: when no child can show whole beside the focus card at 14 px names (a low area between two bars, children far apart), the names go smaller, but not under 11 px, as far
		// as a child needs to show whole. First with the couple (the focus person and the near partners) whole beside the child; else with the focus card only, as D18 does at 14 px.
		// If no child shows even then, the view is as before.
		let scale = readable;
		let core = focus;
		if (children.length && !childPlace(focus, children, area.w / readable, FOCUS_SIDE_PAD / readable).whole) {
			const couple = partners.length ? around([focus, ...partners], 0) : null;
			const withCouple = couple ? smallerForChild(couple, children, area, readable, FIT_MIN_NAME_PX / f, lowAt(readable)) : readable;
			if (couple && withCouple < readable) {
				scale = withCouple;
				core = couple;
			} else scale = smallerForChild(focus, children, area, readable, FIT_MIN_NAME_PX / f, lowAt(readable));
		}
		// The smaller scale was found for the view at 14 px (top or centred); if the view would change kind at that scale, the child it was found for may be
		// below the area, so the view is as before.
		if (scale < readable && lowAt(scale) !== lowAt(readable)) {
			scale = readable;
			core = focus;
		}
		const low = lowAt(scale);
		const cy = low ? focus.y - START_TOP_GAP + area.h / 2 / scale : focus.y + focus.h / 2;
		// At the smaller names only a child that also fits the height counts, so the move never goes to one that is below the area.
		const kids = scale < readable ? children.filter((c) => (low ? c.y + c.h - (focus.y - START_TOP_GAP) : (c.y + c.h - (focus.y + focus.h / 2)) * 2) * scale <= area.h + 1e-6) : children;
		v = { scale, cx: core.x + core.w / 2 + childShift(core, kids, area.w / scale, FOCUS_SIDE_PAD / scale), cy };
	}
	return top > 0 && v.scale > 0 ? { scale: v.scale, cx: v.cx, cy: v.cy - top / 2 / v.scale } : v;
}

/**
 * G3 F4: the scale for the focus view of a family whose children cannot show whole beside the focus card at `readable` (14 px names). The largest scale not under `floor`
 * (11 px names) at which one child shows whole next to the whole focus card, inside the area's height (`low`: the card near the top as in D13, else centred). `readable` when a child
 * already shows whole at that scale, or when none can at the floor either.
 */
function smallerForChild(focus: Rect, children: Rect[], area: Size, readable: number, floor: number, low: boolean): number {
	if (!children.length || !(floor > 0) || !(readable > floor) || childPlace(focus, children, area.w / readable, FOCUS_SIDE_PAD / readable).whole) return readable;
	let best = 0;
	for (const c of children) {
		const span = Math.max(focus.x + focus.w, c.x + c.w) - Math.min(focus.x, c.x);
		const down = low ? c.y + c.h - (focus.y - START_TOP_GAP) : (c.y + c.h - (focus.y + focus.h / 2)) * 2;
		if (!(span > 0) || !(down > 0)) continue;
		best = Math.max(best, Math.min((area.w - 2 * FOCUS_SIDE_PAD) / span, area.h / down));
	}
	// A hair under the exact fit, so that the rounding of the sums cannot lose the child.
	const scale = best * (1 - 1e-9);
	return scale >= floor && scale < readable ? scale : readable;
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
	return childPlace(focus, children, width, pad).shift;
}

/** `childShift` and whether a child shows whole beside the focus card at that move. */
function childPlace(focus: Rect, children: Rect[], width: number, pad: number): { shift: number; whole: boolean } {
	const own = focus.x + focus.w / 2;
	const w = width - 2 * pad;
	if (!children.length || !(w >= focus.w)) return { shift: 0, whole: false };
	// A child cut by no more than the side margin at the centre keeps the focus person exactly centred (D18).
	const slack = width / 2 + pad;
	if (children.some((c) => c.x >= own - slack - 1e-6 && c.x + c.w <= own + slack + 1e-6)) return { shift: 0, whole: true };
	let best: number | null = null;
	for (const c of children) {
		const left = Math.min(focus.x, c.x);
		const right = Math.max(focus.x + focus.w, c.x + c.w);
		if (right - left > w) continue;
		// The window's centre may lie anywhere that keeps both cards whole; take the one nearest the focus person.
		const cx = Math.min(left + w / 2, Math.max(right - w / 2, own));
		if (best === null || Math.abs(cx - own) < Math.abs(best)) best = cx - own;
	}
	if (best !== null) return { shift: best, whole: true };
	// No child fits whole beside the focus card: keep that card whole at the window's edge, towards
	// the nearest child, if part of the child then shows. Else stay centred: a move that shows no
	// child only takes the focus person away from the centre.
	const near = children.reduce((a, c) => (Math.abs(c.x + c.w / 2 - own) < Math.abs(a.x + a.w / 2 - own) ? c : a));
	const max = (w - focus.w) / 2;
	const right = near.x + near.w / 2 > own;
	const seen = right ? own + max + w / 2 - near.x : near.x + near.w - (own - max - w / 2);
	return { shift: seen > near.w / 4 ? (right ? max : -max) : 0, whole: false };
}

/** Screen px around the badge disc in which the badge wins a tap over its own card (spec §13.10, §7.5). */
export const BADGE_WIN_MARGIN_PX = 6;

/** The tap shape of one badge at one zoom, in layout px: its square, and the disc in which it wins over its own card. */
export interface BadgeTap {
	/** The square of the badge tap area, after the cap and the clip. */
	square: Rect;
	/** The disc around the badge centre in which the badge wins a tap over its own card. Nothing above `top` belongs to it. */
	disc: { cx: number; cy: number; r: number; top: number };
}

/** The half side of the tap square, before the clip. Low zoom: only the badge circle, so the cards keep the space. */
function badgeHalf(r: number, scale: number, fontPx: number, capPx: number): number {
	if (!(scale > 0) || scale * fontPx < FIT_MIN_NAME_PX) return r;
	// 0.2.8 (G.13): the square is at least 3 em, as the fold controls' tap area; the cap never takes it off the visible badge.
	return Math.min(Math.max(MIN_HIT_PX / (2 * scale), (HIT_EM * fontPx) / 2, r), Math.max(capPx, r));
}

/**
 * How far the square may reach above the card top. The tap area of another person's far-couple tag wins in the strip it
 * covers (spec §7.5), so the square stops at the lowest of those rects that lie above the card and meet its x range.
 */
function badgeReachUp(x0: number, x1: number, cardTop: number, half: number, avoid: readonly Rect[]): number {
	let nearest = -Infinity;
	for (const a of avoid) {
		if (a.x + a.w <= x0 || a.x >= x1 || !(a.y < cardTop)) continue;
		nearest = Math.max(nearest, a.y + a.h);
	}
	return nearest === -Infinity ? half : Math.min(half, Math.max(0, cardTop - nearest));
}

/**
 * The tap shape of a `+` badge in layout px at `scale` (spec §7.5, contract 4.2). `mark` is the visible circle: its centre is the
 * top right corner of the card (D117). The square is at least 44 screen px while names are at least 11 px, with its right edge
 * at the badge's right edge and centred on the badge vertically. Its half side is capped at `capPx` (the layout's `nodeGap` in
 * `sideways`, half the card height in `down`) so it never reaches a neighbour or more than half its own card. Above the card top
 * it stops at `avoid` (the tag tap areas of the other people). At a smaller zoom it is only the badge's circle.
 */
export function badgeTap(mark: Rect, scale: number, fontPx: number, capPx: number, avoid: readonly Rect[]): BadgeTap {
	const r = mark.w / 2;
	const cx = mark.x + r;
	const cy = mark.y + mark.h / 2;
	const half = badgeHalf(r, scale, fontPx, capPx);
	const x0 = cx + r - 2 * half;
	const up = badgeReachUp(x0, cx + r, cy, half, avoid);
	const grown = scale > 0 && scale * fontPx >= FIT_MIN_NAME_PX;
	return {
		square: { x: x0, y: cy - up, w: 2 * half, h: up + half },
		disc: { cx, cy, r: grown ? r + BADGE_WIN_MARGIN_PX / scale : r, top: cy - up },
	};
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

/** The cards the sideways first view places (D24). */
export interface SidewaysGroup {
	/** The focus person, or the start person of a whole tree. */
	me: Rect | null;
	partners: Rect[];
	/** The children drawn beside the person, each with their partners. `sign` is the right edge (layout px) of the "+ N" sign of a folded family of the child (D257). */
	children: { card: Rect; partners: Rect[]; sign?: number }[];
	/** Placement parents: the left column when the person has no children. */
	parents: Rect[];
}

/**
 * First view in `sideways` (D24): names at 14 px, never a fit; smaller, not under 11 px, only when the children's column is cut at the right edge at 14 px (V4). The person's column
 * sits at the left edge (8 screen px in) with the children's column beside it; with no children, the
 * parents' column goes at the left if the person still shows whole beside it. The group (the person,
 * partners, children and their partners; with no children, the parents) starts 24 layout px below
 * `top`, the top of the free area in screen px. A group taller than the free area (down to `bottom`)
 * starts at the person and their nearest child instead (`tall`), and the person always shows whole.
 */
export function sidewaysView(size: Size, fontPx: number, g: SidewaysGroup, top: number, bottom: number, fallback: Rect): { view: View; tall: boolean } {
	const f = fontPx > 0 ? fontPx : 16;
	const readable = READABLE_NAME_PX / f;
	let scale = readable;
	const me = g.me;
	let left = me ? me.x : 0;
	if (me && !g.children.length && g.parents.length) {
		const px = Math.min(...g.parents.map((p) => p.x));
		if ((me.x + me.w - px) * scale + 2 * FOCUS_SIDE_PAD <= size.w) left = px;
	}
	if (me && g.children.length) scale = columnScale(g.children, left, size.w, readable, f) ?? scale;
	const pad = FOCUS_SIDE_PAD / scale;
	const at = (x: number, freeTop: number): View => ({ scale, cx: x - pad + size.w / 2 / scale, cy: freeTop - top / scale + size.h / 2 / scale });
	if (!me) return { view: at(fallback.x, fallback.y - START_TOP_GAP), tall: false };
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
 * V4: on a narrow phone (360 px) the children's column reaches past the right edge at 14 px names. The names go smaller, not under 11 px, so that the
 * person's column and the nearest column of children show whole (a child a generation further right does not decide); a column that needs smaller
 * names than that keeps 14 px, as before. D257: the "+ N" sign of a folded family of a child counts as part of the column, so the sign is whole too; a sign that
 * needs names under 11 px does not count, and the cards alone decide. Null when the names keep their size.
 */
function columnScale(children: SidewaysGroup['children'], left: number, width: number, readable: number, fontPx: number): number | null {
	const near = Math.min(...children.map((c) => c.card.x));
	const column = children.filter((c) => c.card.x <= near + 1);
	const scaleFor = (rights: number[]): number | null => {
		const right = Math.max(...rights);
		const fits = right > left ? (width - 2 * FOCUS_SIDE_PAD) / (right - left) : readable;
		return fits < readable && fits * fontPx >= FIT_MIN_NAME_PX ? fits * (1 - 1e-9) : null;
	};
	return scaleFor(column.map((c) => Math.max(c.card.x + c.card.w, c.sign ?? -Infinity))) ?? scaleFor(column.map((c) => c.card.x + c.card.w));
}

/**
 * D257: for each person, the right edge (layout px) of the farthest "+ N" sign of a folded family that the person is a parent of: the sign belongs to the column
 * of the person's card. Only a folded family has a sign; an open family has a round button that is no wider than the card.
 */
export function signRights(folds: TreeLayout['folds'], fontPx: number): Map<string, number> {
	const out = new Map<string, number>();
	for (const c of folds ?? []) {
		if (!c.folded) continue;
		const m = foldMark(c, c.spot, fontPx, false, true);
		for (const p of c.parents) out.set(p, Math.max(out.get(p) ?? -Infinity, m.x2 + m.r));
	}
	return out;
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

/** The press area of a sideways far-couple tag at one zoom, in layout px: the whole area, and the strip of it that wins over its own card. */
export interface SideTagTap {
	/** The whole press area, at least 44 screen px each way. It lies below the cards, so a card wins over it except in `over`. */
	area: Rect;
	/** The part of `area` over the bottom of the tag's own card, where the tag wins (it lies above the cards); null when there is none. */
	over: Rect | null;
}

const nextTops = new WeakMap<TreeLayout, Map<string, number>>();

/**
 * 0.3.1 fix3: for each far-couple tag of a sideways `layout`, the top of the next card below its card in the same column (the next id of
 * its row, as the layout's own tag hit area is limited); Infinity when there is none. Kept for each layout, as it does not change with zoom.
 */
export function tagNextTops(layout: TreeLayout): Map<string, number> {
	let out = nextTops.get(layout);
	if (out) return out;
	out = new Map();
	const at = new Map<string, number>();
	for (const row of layout.rows) row.forEach((id, i) => at.set(id, i));
	for (const id of layout.farTags.keys()) {
		const box = layout.persons.get(id);
		const row = box ? layout.rows[box.gen] : undefined;
		const next = row && at.has(id) ? row[at.get(id)! + 1] : undefined;
		const below = next === undefined ? undefined : layout.persons.get(next);
		out.set(id, below ? below.y : Infinity);
	}
	nextTops.set(layout, out);
	return out;
}

/**
 * 0.3.1 fix3: a sideways far-couple tag's press area at `scale`. It hangs from its card's bottom edge as in `down` (D31) and reaches
 * down at most to `nextTop`, the top of the next card in the column (Infinity when there is none). When that gap holds less than
 * 44 screen px, the rest goes up over the bottom of the own card, and there the tag wins (`over`), as its pill already does where it
 * sits on that edge. While names are under 11 px (no first view goes there), or when the rest would take more than half the own card,
 * no strip wins: the card keeps its area, as before. `fontPx` is the layout's note font size.
 */
export function tagHitSide(hit: Rect, card: Rect | undefined, nextTop: number, scale: number, fontPx: number): SideTagTap {
	if (!card || !(scale > 0)) return { area: enlargeHit(hit, scale), over: null };
	const min = MIN_HIT_PX / scale;
	const w = Math.max(hit.w, min);
	const x = hit.x - (w - hit.w) / 2;
	const bottom = card.y + card.h;
	const h = Math.max(min, hit.y + hit.h - bottom);
	const y = Math.min(bottom, nextTop - h);
	const rest = bottom - y;
	const wins = rest > 0 && scale * fontPx >= FIT_MIN_NAME_PX - 1e-9 && rest <= card.h / 2;
	return { area: { x, y, w, h }, over: wins ? { x, y, w, h: rest } : null };
}

/**
 * D51: the name size, in screen px, that a fitted view of a tree of `bounds` shows in `area`, as the
 * level of detail draws it: Compact names count 1.5 times the Full size (spec §5.4), Overview none.
 */
export function fittedNamePx(bounds: Rect, area: Size, fontPx: number): number {
	const px = fitScale(bounds, area) * fontPx;
	const lod = chooseLod(null, px);
	return lod === 'full' ? px : lod === 'compact' ? COMPACT_NAME_EM * px : 0;
}

/**
 * What the finder's first view (`finderFirstView`) shows of a line fitted into `area`, for D51: 2 =
 * the whole line at Full level, 1 = the whole line at Compact level, 0 = not the whole line (its names
 * would be under 11 px, so the view zooms to 14 px names).
 */
export function finderLevel(bounds: Rect, area: Size, fontPx: number): 0 | 1 | 2 {
	if (fittedNamePx(bounds, area, fontPx) < FIT_MIN_NAME_PX) return 0;
	return chooseLod(null, fitScale(bounds, area) * fontPx) === 'full' ? 2 : 1;
}

/**
 * D51: the direction of the relation finder's small tree on an upright phone. The level counts
 * first (`finderLevel`: a direction that shows the whole line at Full level wins over one that needs
 * Compact), then the name size as drawn; `down` wins only when it is strictly better, so on a tie
 * the tree stays sideways (D24).
 */
export function finderOrientation(area: Size, sideways: { bounds: Rect; fontPx: number }, down: { bounds: Rect; fontPx: number }): Orientation {
	const facts = (t: { bounds: Rect; fontPx: number }) => ({ level: finderLevel(t.bounds, area, t.fontPx), px: fittedNamePx(t.bounds, area, t.fontPx) });
	const s = facts(sideways);
	const d = facts(down);
	return d.level > s.level || (d.level === s.level && d.px > s.px) ? 'down' : 'sideways';
}

/**
 * The first view of the relation finder's result, on every device: the whole line (`bounds`) fitted
 * into the free area below `insetTop` (the result bar) when its names are then at least 11 px as the
 * level of detail draws them (Compact names count 1.5 times, spec §5.4). Else the names are 14 px and
 * the view starts at the common ancestors, `oldest` (the line's cards of the oldest generation), so
 * the result bar never hides them: at the top of the free area in `down`, at the left in `sideways`.
 */
export function finderFirstView(bounds: Rect, size: Size, fontPx: number, insetTop: number, oldest: readonly Rect[], orientation: Orientation): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const area = { w: size.w, h: size.h - top };
	const f = fontPx > 0 ? fontPx : 16;
	if (!oldest.length || !(area.w > 0) || fittedNamePx(bounds, area, f) >= FIT_MIN_NAME_PX) return fitView(bounds, size, insetTop);
	const scale = READABLE_NAME_PX / f;
	const x0 = Math.min(...oldest.map((b) => b.x));
	const y0 = Math.min(...oldest.map((b) => b.y));
	const x1 = Math.max(...oldest.map((b) => b.x + b.w));
	const y1 = Math.max(...oldest.map((b) => b.y + b.h));
	const halfW = area.w / 2 / scale;
	const halfH = area.h / 2 / scale;
	const pad = START_TOP_GAP;
	// Across the generations the view starts at the ancestors; along a generation it shows as much of
	// the line as it can, but never loses the ancestors (if they do not fit, it centres on the first).
	const along = (lo: number, hi: number, firstLo: number, firstLen: number, bLo: number, bLen: number, half: number) => {
		if (hi - lo + 2 * pad > 2 * half) return firstLo + firstLen / 2;
		return Math.min(lo - pad + half, Math.max(hi + pad - half, bLo + bLen / 2));
	};
	const first = oldest[0];
	let cx: number;
	let cy: number;
	if (orientation === 'sideways') {
		cx = x0 - pad + halfW;
		cy = along(y0, y1, first.y, first.h, bounds.y, bounds.h, halfH);
	} else {
		cy = y0 - pad + halfH;
		cx = along(x0, x1, first.x, first.w, bounds.x, bounds.w, halfW);
	}
	return { scale, cx, cy: cy - top / 2 / scale };
}

/**
 * 0.2.8 (G.4): the readable first view of a note shows the start person with the row of their parents above. `view` is the view that
 * `defaultView` chose for the free area below `insetTop`; with the person's card at the top of the area the parents are cut off. The view moves up, just enough that the
 * top of the parents' row (with the tree's own margin) is at the top of the area, but only when the start card is still whole at the foot of the area then. Never
 * moves down, and never changes the zoom: a view that already shows the parents, or that has no room for both, stays as it is.
 */
export function parentsAbove(view: View, size: Size, insetTop: number, start: Rect, parents: readonly Rect[]): View {
	if (!parents.length || !(view.scale > 0)) return view;
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const s = view.scale;
	const areaTop = view.cy - size.h / 2 / s + top / s;
	const areaBottom = view.cy + size.h / 2 / s;
	const parentsTop = Math.min(...parents.map((p) => p.y));
	// The parents' row is whole in the area already.
	if (areaTop <= parentsTop) return view;
	const up = areaTop - (parentsTop - START_TOP_GAP);
	// The start card must stay whole at the foot of the area after the move.
	if (start.y + start.h > areaBottom - up) return view;
	return { scale: s, cx: view.cx, cy: view.cy - up };
}

/** Screen places of a layout box in `view` (px, from the top left of the box that the view is drawn in). */
function onScreen(view: View, size: Size, b: Rect): { left: number; right: number; top: number; bottom: number } {
	const left = size.w / 2 + (b.x - view.cx) * view.scale;
	const top = size.h / 2 + (b.y - view.cy) * view.scale;
	return { left, right: left + b.w * view.scale, top, bottom: top + b.h * view.scale };
}

/**
 * 0.2.8 (D212 `bars-in-flow`): every view that the plugin chooses keeps the top card whole. A card that the top edge of the drawing area, or the band over it
 * (the toolbar and the banner of the full-screen view, `insetTop`; 0 in a note), cuts in two is made whole: the view moves down until the card is under the band, or, when that would push a `keys` card (the ruler, the line, the start person)
 * out at the foot, up until the card is out from under the band entirely. A card that lies wholly under the band, or wholly below it, is not touched. The view never
 * zooms. A view that no move can improve stays as it is, and a result never has more cut cards than the view it was given (a move that only swaps one cut card for another is dropped).
 * After the first move down, a further move stops as soon as it would cut a card that is whole at the foot (a staircase of cut cards would push the whole tree down).
 * `bottom` is the foot of the free area (the box height, or the top of a bottom toolbar).
 * `marks` (the `+` badges, V3) are stricter: a badge on the screen may not meet the band at all, as it would stand in the safe area or under a bar; a raise takes it above the screen.
 */
export function keepTopCardWhole(view: View, size: Size, insetTop: number, bottom: number, boxes: Iterable<Rect>, keys: readonly Rect[], marks: Iterable<Rect> = []): View {
	if (!(insetTop >= 0) || !(view.scale > 0) || !(size.w > 0)) return view;
	const cards = [...boxes];
	const badges = [...marks];
	const all = [...cards, ...badges];
	// `rise` is how far a raise must move the box: a card until it is wholly under the band, a badge until it is above the screen.
	const cut = (v: View) => [
		...cards.map((b) => onScreen(v, size, b)).filter((s) => s.right > 0 && s.left < size.w && s.top < insetTop - 0.5 && s.bottom > insetTop + 0.5).map((s) => ({ ...s, rise: s.bottom - insetTop })),
		...badges.map((b) => onScreen(v, size, b)).filter((s) => s.right > 0 && s.left < size.w && s.top < insetTop - 0.5 && s.bottom > 0.5).map((s) => ({ ...s, rise: s.bottom })),
	];
	const before = cut(view).length;
	// A result with more cut cards than the given view is worse than no move.
	const settle = (v: View): View => (cut(v).length > before ? view : v);
	// A card that is whole between the band and the foot now, and is not any more after the move.
	const footLost = (from: View, to: View): boolean =>
		all.some((b) => {
			const a = onScreen(from, size, b);
			if (!(a.right > 0 && a.left < size.w) || a.top < insetTop - 0.5 || a.bottom > bottom + 0.5) return false;
			return onScreen(to, size, b).bottom > bottom + 0.5;
		});
	let v = view;
	// A move down can bring a card from above under the band, so it takes a few rounds, as `clearBand` does.
	for (let i = 0; i < 4; i++) {
		const cuts = cut(v);
		if (!cuts.length) return settle(v);
		const down = Math.max(...cuts.map((s) => insetTop - s.top));
		const moved: View = { scale: v.scale, cx: v.cx, cy: v.cy - down / v.scale };
		// A key card that is whole at the foot now must still be whole after the move; from the second move on, every card that is whole at the foot.
		const keepsFoot = keys.every((k) => onScreen(v, size, k).bottom > bottom || onScreen(moved, size, k).bottom <= bottom);
		if (i > 0 && footLost(v, moved)) return settle(v);
		if (keepsFoot) {
			v = moved;
			continue;
		}
		// Raise the view until the cut cards are out from under the band entirely; a card that the raise cuts in its turn goes the same way.
		let r = v;
		for (let j = 0; j < 4; j++) {
			const rc = cut(r);
			if (!rc.length) break;
			const up = Math.max(...rc.map((s) => s.rise));
			r = { scale: r.scale, cx: r.cx, cy: r.cy + up / r.scale };
		}
		// Every key card must stay whole at the top.
		const keepsTop = keys.every((k) => onScreen(v, size, k).top < insetTop || onScreen(r, size, k).top >= insetTop);
		return keepsTop ? settle(r) : view;
	}
	return settle(v);
}
