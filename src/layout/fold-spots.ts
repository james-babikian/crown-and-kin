/**
 * Where the fold controls of a tree go (spec §13.10): the spot of each control
 * (`foldSpots`), the room a control needs in the drawing (`foldExtent`) and the bundle of fold facts
 * that `layoutTree` gives to `layoutFamilies` and to the line planner (`FoldInput`, `LineExtras`).
 * `layout.ts` works in the `down` frame (a sideways tree is arranged turned), so the spot rules are
 * written for `down` and the caller turns the result. Layout only: no DOM, no colours.
 *
 * How folds work in the layout (spec §13.10; the fold rules of the graph are in `core/folds.ts`):
 * - `layoutTree` takes the generations from the whole graph, then arranges `pruneGraph(g, hidden)` with
 *   them. It removes the rows that have no shown person and renumbers the generations of the shown
 *   people in the same order, so no row is empty and no shown person changes its place relative to the
 *   others. Hidden people are in no result list.
 * - A shown person with hidden partners gets a far-couple tag, also when the two were a near couple
 *   before the fold; the hidden partners take part in the tag zone and the room like a far partner.
 *   A union with a hidden partner draws no line.
 * - A folded family whose parents are shown keeps its couple line and gets one stem (an `EdgePath` of
 *   kind `descent`) from the union sign to the spot of its "+ N" sign; it has no drop and no bar. The
 *   planner plans it as a family with one child at the spot.
 * - `TreeLayout.width` and `height` include, for every control, its largest mark and its hit area at
 *   scale 1, so the fit, the view and the saved picture never cut a sign. If a mark or hit area lies
 *   left of or above 0, the layout moves everything by the same amount.
 * - The layout is the same at every level of detail; the levels differ only in a class on the `<svg>`.
 */
import type { FamilyGraph } from '../core/derive';
import type { FoldControl } from '../core/folds';
import type { FoldSpot, PersonBox, PlacedFoldControl, Rect, UnionPoint } from './model';

/**
 * The fold control sizes in em of the note font (F6). `render/dom/folds.ts` exports the same numbers
 * under the same names; the layout needs them to place a control and to reserve its room.
 */
export const FOLD_EM = {
	button: 1.2,
	minusHalf: 0.45,
	minusStroke: 0.2,
	signHeight: 1.25,
	signPad: 0.9,
	signText: 0.8,
	signHeightOverview: 2,
	signTextOverview: 1.5,
	below: 1,
	right: 1,
	afterMarker: 1.2,
	shortStem: 2,
} as const;

/** The smallest hit area of a control, in screen px (spec §7.5). */
export const FOLD_HIT_PX = 44;

/** What the line planner needs to know about folds (F3, F4). */
export interface LineExtras {
	/** People whose card has a tag only because of a hidden partner (`hiddenPartners`). */
	tagged?: ReadonlySet<string>;
	/** The folded families with shown parents and no shown child: each keeps its dot or exit and gets a stem. */
	folded?: readonly FoldControl[];
	/** Every control of the view: the planner places them once to see which ones the rules move down, and reserves room for those. */
	controls?: readonly FoldControl[];
}

/** What `layoutFamilies` needs to know about folds (F2, F3, F5). */
export interface FoldInput {
	/** The graph before pruning: names of hidden partners and the union order of a tag come from it. */
	full: FamilyGraph;
	/** For each shown person with hidden partners, those partners in `unionsOf` order (rule 6). */
	partners: ReadonlyMap<string, string[]>;
	/** The controls to place; absent when the view cannot fold (no `TreeLayout.folds`). */
	controls?: readonly FoldControl[];
	lines: LineExtras;
}

/** What the spot rules may know beyond the cards (V2, V4). Every rect is in the frame of `persons`. */
export interface SpotHints {
	/** The tap areas of the far-couple tags, by person (`down` frame only): no control's tap area may meet one. */
	tags?: ReadonlyMap<string, Rect>;
	/** Where a single parent's trunk leaves the card; a single parent's control sits there, not at the middle, which a tag or another line may hold. */
	soloX?: ReadonlyMap<string, number>;
	/** The frame is a sideways layout turned: a control's mark and tap area are wider along y than along x. */
	turned?: boolean;
}

/** A placed control, and whether the rules moved it down from its first spot. */
export interface SpotResult {
	control: PlacedFoldControl;
	pushed: boolean;
}

const meets = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

/**
 * F5: the spot of every control, in the `down` frame. From the union point of `control.union` (a bar:
 * 1 em below the lowest parent card; else 1.2 em below the dot), or, for one parent or no union point, 1 em
 * below the card at its middle. If the stem to the next row is shorter than 2 em, the spot is its middle.
 * A control whose parents are not both in `persons` is left out.
 *
 * V2, V4, L1: a single parent's control sits at the trunk's x, not at the middle of the card. Then a control moves down its own stem, in the order
 * of `controls`, until its tap area meets no tag and no tap area of an earlier control.
 */
export function foldSpots(
	controls: readonly FoldControl[],
	persons: ReadonlyMap<string, PersonBox>,
	unions: ReadonlyMap<string, UnionPoint>,
	rowGaps: readonly { top: number; bottom: number }[],
	em: number,
	hints: SpotHints = {},
): PlacedFoldControl[] {
	return placeFoldSpots(controls, persons, unions, rowGaps, em, hints).map((r) => r.control);
}

/** `foldSpots` with the fact whether a control was moved down (the line planner reserves room for those). */
export function placeFoldSpots(
	controls: readonly FoldControl[],
	persons: ReadonlyMap<string, PersonBox>,
	unions: ReadonlyMap<string, UnionPoint>,
	rowGaps: readonly { top: number; bottom: number }[],
	em: number,
	hints: SpotHints = {},
): SpotResult[] {
	const out: SpotResult[] = [];
	// The tap area as the caller's frame sees it: the sideways sign is long along the layout's x, which is y here.
	const areaOf = (c: FoldControl, spot: FoldSpot): Rect => {
		if (!hints.turned) return foldExtent(c, spot, em);
		const r = foldExtent(c, { x: spot.y, y: spot.x }, em);
		return { x: r.y, y: r.x, w: r.h, h: r.w };
	};
	const tags = [...(hints.tags?.values() ?? [])];
	for (const c of controls) {
		const boxes = c.parents.map((id) => persons.get(id));
		if (!boxes.length || boxes.some((b) => !b)) continue;
		const cards = boxes as PersonBox[];
		const gen = Math.max(...cards.map((b) => b.gen));
		const u = c.union === undefined ? undefined : unions.get(c.union);
		let x: number;
		let y: number;
		let from: number;
		if (u) {
			x = u.x;
			from = u.y;
			y = u.bar ? Math.max(...cards.map((b) => b.y + b.h)) + FOLD_EM.below * em : u.y + FOLD_EM.afterMarker * em;
		} else {
			const b = cards[0];
			// The trunk leaves at the exit the planner chose, which is the middle only when nothing else runs there.
			x = hints.soloX?.get(b.id) ?? b.x + b.w / 2;
			from = b.y + b.h;
			y = from + FOLD_EM.below * em;
		}
		const next = rowGaps[gen]?.bottom;
		if (next !== undefined && next - from < FOLD_EM.shortStem * em) y = from + (next - from) / 2;
		const first = y;
		// Each move clears one obstacle for good, so the loop ends.
		for (let again = true; again; ) {
			again = false;
			const area = areaOf(c, { x, y });
			const lift = y - area.y;
			for (const t of tags) {
				if (meets(area, t)) {
					y = t.y + t.h + lift;
					again = true;
					break;
				}
			}
			if (again) continue;
			for (const o of out) {
				const other = areaOf(o.control, o.control.spot);
				if (meets(area, other)) {
					y = other.y + other.h + lift;
					again = true;
					break;
				}
			}
		}
		out.push({ control: { ...c, spot: { x, y } }, pushed: y > first + 1e-6 });
	}
	return out;
}

/** The turned copy of `spots` (x and y swapped), for a sideways layout. */
export const turnSpots = (spots: readonly PlacedFoldControl[]): PlacedFoldControl[] => spots.map((c) => ({ ...c, spot: { x: c.spot.y, y: c.spot.x } }));

/**
 * F5b: the rectangle a control needs, in layout px: its largest mark (the Overview sign, anchored on the left and as
 * wide as the longest "+ N" text can be, or the open button) and its hit area at scale 1.
 */
export function foldExtent(control: FoldControl, spot: FoldSpot, em: number): Rect {
	const half = FOLD_HIT_PX / 2;
	let x0 = spot.x - half;
	let x1 = spot.x + half;
	let y0 = spot.y - half;
	let y1 = spot.y + half;
	if (control.folded) {
		const h = FOLD_EM.signHeightOverview * em;
		const digits = String(Math.max(0, Math.trunc(control.count))).length;
		const w = (FOLD_EM.signPad + (2 + digits) * FOLD_EM.signTextOverview) * em;
		const left = spot.x - h / 2;
		// The hit area of the Full sign is centred on that pill and the Overview one on the larger pill.
		const centre = left + w / 2;
		x0 = Math.min(x0, left);
		x1 = Math.max(x1, left + w, centre + half);
		y0 = Math.min(y0, spot.y - h / 2);
		y1 = Math.max(y1, spot.y + h / 2);
	}
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
