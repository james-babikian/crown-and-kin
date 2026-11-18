/*
 * Where a side link ends on the child's top edge (spec §5.3, D365 (4)). A curve ends on the side of the child's main line that it comes from, so
 * it never crosses that line at its end. A Roundel card keeps the end clear of the "You" or ordinal tab, which stands left of the axis.
 * `drawSideLinks` (draw.ts) calls it once for each source of a link.
 */
import type { FamilyGraph } from '../core/derive';
import { ORDINAL_EM, TIE, type LineMetrics } from './geometry';
import type { PersonBox, StrokeKind } from './model';
import { portX, type SideLink } from './plan-model';

/** em: how far right of the Roundel axis a dotted side link lands, and the nearest a left landing may stand to the axis. */
export const ROUNDEL_LAND_EM = 3.4;
/** px: how far from the card middle a side link lands on a text card. */
export const PLAIN_LAND_PX = 14;
/** em: room left between the tab's outer edge and the end of the curve. */
const TAB_CLEAR_EM = 0.3;
/**
 * The ordinal text is not known to the layout (only which cards have a tab), so the tab is taken at its width for 4 characters ("10th"): "You" and "1st" are
 * narrower and stand clear, and the tab of the finder's test (`ordinal-tab-layout-key.test.ts`) is 4 characters. A tab of 5 or more characters is wider: with a
 * portrait or arms the end then meets its outer corner (the one measured limit, an internal test).
 */
export const TAB_CHARS = 4;

/** em, left of the axis (a positive number): where a curve from the left lands on a Roundel card. */
export function roundelLeftLandingEm(tabbed: boolean, picture: 'portrait' | 'arms' | 'none', chars: number, limitEm: number): number {
	if (!tabbed) return Math.min(ROUNDEL_LAND_EM, limitEm);
	const E = ORDINAL_EM;
	const right = picture === 'portrait' ? E.rightPortrait : picture === 'arms' ? E.rightArms : E.rightNone;
	const width = chars <= 3 ? E.width3 : E.width4 + (chars - 4) * E.widthMore;
	return Math.min(Math.max(ROUNDEL_LAND_EM, right + width + TAB_CLEAR_EM), limitEm);
}

/** What `sideLanding` needs to know of one drawing. */
export interface LandingInput {
	roundel: boolean;
	sideways: boolean;
	fontPx: number;
	/** Half the card width of a Roundel card (`roundelAxis`). */
	axis: number;
	m: LineMetrics;
	tabbed?: ReadonlySet<string>;
	youTab?: string;
}

/**
 * The x where the curve of a source at `srcX` ends on child `cb`. `drop` is the child's drop x (its main line). A source left of it lands left of the middle,
 * any other right of it; every end stays between the tag insets.
 */
export function sideLanding(cb: PersonBox, srcX: number, drop: number | undefined, input: LandingInput): number {
	const { roundel, sideways, fontPx, axis, m } = input;
	const centre = cb.x + cb.w / 2;
	const c = drop ?? centre;
	const lo = cb.x + m.tagInset;
	const hi = cb.x + cb.w - m.tagInset;
	const clamp = (x: number) => Math.min(hi, Math.max(lo, x));
	const left = srcX < c - TIE;
	if (roundel) {
		const x0 = cb.x + axis;
		if (!left) return clamp(x0 + ROUNDEL_LAND_EM * fontPx);
		const tabbed = !!input.tabbed?.has(cb.id) || cb.id === input.youTab;
		const picture = cb.portrait ? 'portrait' : cb.arms ? 'arms' : 'none';
		return clamp(x0 - roundelLeftLandingEm(tabbed, picture, TAB_CHARS, (cb.w / 2 - m.tagInset) / fontPx) * fontPx);
	}
	const shift = sideways ? Math.min(PLAIN_LAND_PX, cb.w / 2 - m.tagInset) : PLAIN_LAND_PX;
	return clamp(left ? Math.min(c, centre) - shift : centre + shift);
}

/** px: how far each of two guardians' ward lines ends from the ward's own line (D354 1 B): `em` of the font, at most the landing shift; a Roundel card takes the landing itself. */
export function wardPairApart(cb: PersonBox, input: LandingInput, em: number): number {
	if (input.roundel) return ROUNDEL_LAND_EM * input.fontPx;
	return Math.min(em * input.fontPx, input.sideways ? Math.min(PLAIN_LAND_PX, cb.w / 2 - input.m.tagInset) : PLAIN_LAND_PX);
}

/** em: where the first line of a group ends from the child's main line (plain card), and the step to the next one on the same side (D365 (3)). */
const GROUP_BASE_EM = 1.5;
const GROUP_STEP_EM = 1.5;
/** px: the least room beside the child's main line for an end of a group line; a smaller room sends the end to the other side. */
const GROUP_MIN_ROOM_PX = 4;
/** px: the least distance between two ends of a group on a card, and between an end and the hub's line (D365 (3)). */
const GROUP_APART_PX = 8;
/** px: how far past the card's edge an end may land to keep `GROUP_APART_PX` (a hair); a wider step stops at the edge and the ends stand closer. */
const GROUP_EDGE_SLACK_PX = 0.5;

/**
 * The stroke of a side link that is one parent's own line of a group (a child with three or more parents of one kind and no couple among them, D365 (2)),
 * or undefined for any other side link. Adoptive parents draw the adoptive line; birth parents the child's own line, solid, or dashed when the child is marked illegitimate.
 */
export function groupLinkKind(g: FamilyGraph, s: { child: string; type: string; parents: readonly string[]; union?: string }): StrokeKind | undefined {
	if (s.union !== undefined || s.parents.length !== 1) return undefined;
	const grp = g.parentGroups.find((x) => x.child === s.child);
	if (!grp || s.type !== grp.kind || !grp.parents.includes(s.parents[0])) return undefined;
	if (grp.kind === 'adoptive') return 'adoptive';
	return g.byId.get(s.child)?.illegitimate ? 'illegitimate' : 'descent';
}

/**
 * The end x of every group line of the plan: on each side of the child's drop the sources are ranked by distance from it (nearest first, then by id) and the k-th ends
 * `base + (k - 1) * step` from it, so the ends of one child stand a step apart (D365 (3)). The step shrinks so that the last end stays inside the card.
 */
export function groupLandings(links: readonly SideLink[], g: FamilyGraph, persons: ReadonlyMap<string, PersonBox>, dropX: ReadonlyMap<string, number> | undefined, input: LandingInput): Map<SideLink, number> {
	const byChild = new Map<string, { s: SideLink; x: number }[]>();
	for (const s of links) if (groupLinkKind(g, s) !== undefined && s.ports.length === 1) (byChild.get(s.child) ?? byChild.set(s.child, []).get(s.child)!).push({ s, x: portX(s.ports[0]) });
	const out = new Map<SideLink, number>();
	const { roundel, sideways, fontPx, axis, m } = input;
	for (const [child, list] of byChild) {
		const cb = persons.get(child)!;
		const c = dropX?.get(child) ?? cb.x + cb.w / 2;
		const lo = cb.x + m.tagInset;
		const hi = cb.x + cb.w - m.tagInset;
		const byDistance = (a: { x: number; s: SideLink }, b: { x: number; s: SideLink }) => Math.abs(a.x - c) - Math.abs(b.x - c) || (a.s.parents[0] < b.s.parents[0] ? -1 : a.s.parents[0] > b.s.parents[0] ? 1 : 0);
		// A drop at the edge of the card leaves no room on that side: the ends of that side then take the other side after its own, so no end lies on the hub's line.
		const cramped = roundel ? undefined : c - lo < GROUP_MIN_ROOM_PX ? true : hi - c < GROUP_MIN_ROOM_PX ? false : undefined;
		for (const left of [true, false]) {
			if (cramped === left) continue;
			const own = list.filter((e) => (e.x < c - TIE) === left).sort(byDistance);
			const side = cramped === undefined ? own : [...own, ...list.filter((e) => (e.x < c - TIE) === cramped).sort(byDistance)];
			if (!side.length) continue;
			// The reference of the first end: a Roundel card counts from its axis (left: clear of the tab), another card from the drop.
			const ref = roundel ? cb.x + axis : c;
			const first = roundel ? (left ? roundelLeftLandingEm(!!input.tabbed?.has(child) || child === input.youTab, cb.portrait ? 'portrait' : cb.arms ? 'arms' : 'none', TAB_CHARS, (cb.w / 2 - m.tagInset) / fontPx) : ROUNDEL_LAND_EM) * fontPx : sideways ? Math.min(GROUP_BASE_EM * fontPx, cb.w / 2 - m.tagInset) : GROUP_BASE_EM * fontPx;
			const room = left ? ref - lo : hi - ref;
			const room0 = Math.max(0, room);
			// A Roundel end keeps its first place (clear of the tab) and the step shrinks; a narrower edge (a sideways card) shares its room among the ends on the side.
			const step = side.length < 2 ? 0 : roundel ? Math.min(GROUP_STEP_EM * fontPx, Math.max(0, room0 - Math.min(first, room0)) / (side.length - 1)) : Math.min(GROUP_STEP_EM * fontPx, room0 / side.length);
			const base = roundel ? Math.min(first, room0) : Math.min(first, room0 - (side.length - 1) * step);
			// A card too narrow for the steps (a sideways card, a drop pushed to one edge) would put two ends a few px apart: each end then keeps `GROUP_APART_PX` from the
			// one before it and from the hub's line, and may go as far as the card's edge. An end never changes sides, so no end crosses the hub's line.
			let far = 0;
			side.forEach((e, k) => {
				const x = ref + (left ? -1 : 1) * (base + k * step);
				const wide = Math.max(Math.abs(x - c), far + GROUP_APART_PX);
				const edge = left ? c - cb.x : cb.x + cb.w - c;
				const dist = roundel || wide === Math.abs(x - c) ? undefined : Math.min(wide, edge + GROUP_EDGE_SLACK_PX);
				out.set(e.s, dist === undefined ? x : c + (left ? -1 : 1) * dist);
				far = dist ?? Math.abs(x - c);
			});
		}
	}
	return out;
}
