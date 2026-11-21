/*
 * The graph the layout arranges when a child has three or more parents of one kind and no couple among them (a group, D365 (2); contract "Three own lines"
 * §1.5). It wraps `ward-graph.ts`: the ward step and the group step touch different children. `withGroupSeats` (core) gives the child to its hub and
 * every other parent a side link of its own; for a group that is seated it also adds a private union hub to each other parent, so the three cards stand side by
 * side with the hub between and the child under the hub. `runStages` (pipeline.ts) tries up to `GROUP_TRIALS` hubs, measures on the finished layout whether the
 * three really stand side by side, and hangs a group that cannot be seated from the parent nearest the middle. Layout only: nothing here leaves `src/layout`.
 */

import type { FamilyGraph, ParentGroup } from '../core/derive';
import { GROUP_SEAT_MAX, GROUP_TRIALS, withGroupSeats } from '../core/group-seats';
import type { FoldControl } from '../core/folds';
import { GROUP_MIN, groupHubOrder, groupKey } from '../core/parent-groups';
import { foldExtent, type FoldInput } from './fold-spots';
import { TIE } from './geometry';
import type { GroupLayout, PlacedFoldControl, Rect, TreeLayout } from './model';
import { layoutFold, layoutGraph } from './ward-graph';

/** What a trial has settled for one group: the hub, whether the group is seated (private unions) or hung, and how many hubs were tried. */
export interface GroupState {
	hub: string;
	seated: boolean;
	trials: number;
}

/** The group of each child of `g` as `g` shows it: the parents that are in `g`; none for a child that is not shown or has no shown parent. */
export function shownGroups(g: FamilyGraph): ParentGroup[] {
	const out: ParentGroup[] = [];
	for (const grp of g.parentGroups) {
		if (!g.byId.has(grp.child)) continue;
		const parents = grp.parents.filter((q) => g.byId.has(q));
		if (parents.length) out.push({ ...grp, parents });
	}
	return out;
}

/**
 * The first hub of every group, seated when it has three parents who stand in one row of the walk (`gens`). A group of other size, or whose parents differ in
 * generation (a parent of another parent cannot stand beside it, and a seat pair of such people breaks the plan), is hung from the start.
 */
export function initialGroupStates(g: FamilyGraph, groups: readonly ParentGroup[], gens: ReadonlyMap<string, number>): Map<string, GroupState> {
	return new Map(groups.map((grp) => {
		const row = (id: string) => gens.get(id) ?? 0;
		const same = new Set(grp.parents.map(row)).size === 1;
		// The child is one row below its lowest parent, so a hub in a higher row would give a line of more than one row: the first hub is the first of the lowest row.
		const lowest = Math.max(...grp.parents.map(row));
		const hub = groupHubOrder(g, grp).find((id) => row(id) === lowest)!;
		return [grp.child, { hub, seated: grp.parents.length === GROUP_SEAT_MAX && same, trials: 1 }] as const;
	}));
}

const seatedOf = (states: ReadonlyMap<string, GroupState>) => new Set([...states].filter(([, s]) => s.seated).map(([c]) => c));
const hubsOf = (states: ReadonlyMap<string, GroupState>) => new Map([...states].map(([c, s]) => [c, s.hub] as const));

/** `g` as the layout arranges it: the ward pairs of `ward-graph.ts`, then the groups seated or hung as `states` say. */
export function layoutGraphAll(g: FamilyGraph, hung: ReadonlySet<string>, states: ReadonlyMap<string, GroupState>, full?: FamilyGraph, gens?: ReadonlyMap<string, number>): FamilyGraph {
	return withGroupSeats(layoutGraph(g, hung, full, gens), hubsOf(states), seatedOf(states));
}

/**
 * The fold facts over the same graph as `layoutGraphAll`. The control of a group (the 3-key of its parents, no union) stands on the one-parent family of
 * the hub: only the hub has a family for a shown child, so an open control cannot stand elsewhere. A folded group (its child is hidden) takes the hub when the
 * hub has no control of its own, else the next parent in hub order without one, else the hub again; `separateGroupControls` then moves a control that
 * stands on another one. The hub of a hidden child is the first in hub order, never a choice read from the order of the child's list.
 */
export function layoutFoldAll(fold: FoldInput, hung: ReadonlySet<string>, states: ReadonlyMap<string, GroupState>, gens?: ReadonlyMap<string, number>): FoldInput {
	const f = layoutFold(fold, hung, gens);
	const full = withGroupSeats(f.full, hubsOf(states), seatedOf(states));
	if (!fold.full.parentGroups.length) return { ...f, full };
	const byKey = new Map(fold.full.parentGroups.map((grp) => [groupKey(grp.parents), grp]));
	const all = [...(f.controls ?? []), ...(f.folded ?? [])];
	const ownControl = (id: string) => all.some((o) => o.union === undefined && o.parents.length === 1 && o.parents[0] === id);
	const taken = new Set<string>();
	const memo = new Map<string, FoldControl>();
	const map = (c: FoldControl): FoldControl => {
		const grp = c.union === undefined && c.parents.length >= GROUP_MIN ? byKey.get(groupKey(c.parents)) : undefined;
		if (!grp) return c;
		const known = memo.get(c.key);
		if (known) return known;
		const order = groupHubOrder(fold.full, grp);
		const hub = states.get(grp.child)?.hub ?? order[0];
		let at = hub;
		if (c.folded) {
			at = [hub, ...order.filter((id) => id !== hub)].find((id) => !taken.has(id) && !ownControl(id)) ?? hub;
			taken.add(at);
		}
		const out = { ...c, parents: [at] };
		memo.set(c.key, out);
		return out;
	};
	const list = (cs: readonly FoldControl[] | undefined) => cs?.map(map);
	const controls = list(f.controls);
	const folded = list(f.folded);
	return { ...f, full, ...(controls ? { controls } : {}), ...(folded ? { folded } : {}) };
}

/**
 * Moves each control of a group along the row, past any control it stands on, so that no two tap areas meet (spec §7.5: each is tappable). Only a group
 * control moves, so a tree without a group draws as before. `sideways`: the frame is the real one, the row runs down.
 */
export function separateGroupControls(folds: readonly PlacedFoldControl[], em: number, sideways: boolean): PlacedFoldControl[] {
	const isGroup = (c: PlacedFoldControl) => c.union === undefined && c.parents.length >= GROUP_MIN;
	// The controls that are not a group's stay where they are, whatever their place in the list, so a group control never stops one of them.
	const areas: Rect[] = folds.filter((c) => !isGroup(c)).map((c) => foldExtent(c, c.spot, em, sideways));
	return folds.map((c) => {
		let spot = c.spot;
		if (isGroup(c)) {
			for (let again = true, n = 0; again && n < folds.length; n++) {
				again = false;
				const r = foldExtent(c, spot, em, sideways);
				const hit = areas.find((o) => r.x < o.x + o.w - TIE && o.x < r.x + r.w - TIE && r.y < o.y + o.h - TIE && o.y < r.y + r.h - TIE);
				if (hit) {
					spot = sideways ? { x: spot.x, y: hit.y + hit.h + (spot.y - r.y) } : { x: hit.x + hit.w + (spot.x - r.x), y: spot.y };
					again = true;
				}
			}
		}
		if (isGroup(c)) areas.push(foldExtent(c, spot, em, sideways));
		return spot === c.spot ? c : { ...c, spot };
	});
}

/** The place of a card along its row (x; sideways, where the rows are columns, y). */
const along = (layout: TreeLayout, id: string): number => {
	const b = layout.persons.get(id)!;
	return layout.orientation === 'sideways' ? b.y + b.h / 2 : b.x + b.w / 2;
};

/**
 * Whether the three parents of `grp` stand side by side on the finished layout: in one row, no other card between them, the hub in the middle, and the child
 * (when it is shown) under the hub. A measurement, never a state: the seating asks for it and a layout can still miss it. A child that siblings push off the
 * hub makes the trial go on to the next hub, and a group that no hub seats hangs from the parent nearest the middle.
 */
export function seatedOn(layout: TreeLayout, grp: ParentGroup, hub: string): boolean {
	if (grp.parents.length !== GROUP_SEAT_MAX) return false;
	const boxes = grp.parents.map((id) => layout.persons.get(id));
	if (boxes.some((b) => !b) || new Set(boxes.map((b) => b!.gen)).size !== 1) return false;
	const row = layout.rows[boxes[0]!.gen];
	const at = grp.parents.map((id) => row.indexOf(id)).sort((a, b) => a - b);
	if (!(at[0] >= 0 && at[1] === at[0] + 1 && at[2] === at[1] + 1 && row[at[1]] === hub)) return false;
	return !layout.persons.has(grp.child) || Math.abs(along(layout, grp.child) - along(layout, hub)) <= TIE;
}

/**
 * The hub of a group that hangs (contract §1.5): among the parents in the lowest row the one whose card centre is nearest the median of all the parents'
 * centres (a group of even size: the mean of the two middle ones); an equal distance goes to the left card, then to the smaller id. Read from the layout of the last trial.
 */
export function hubByRule(layout: TreeLayout, grp: ParentGroup): string {
	const at = new Map(grp.parents.map((id) => [id, along(layout, id)] as const));
	const sorted = [...at.values()].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const low = Math.max(...grp.parents.map((id) => layout.persons.get(id)!.gen));
	const near = grp.parents.filter((id) => layout.persons.get(id)!.gen === low);
	return near.sort((a, b) => {
		const da = Math.abs(at.get(a)! - median);
		const db = Math.abs(at.get(b)! - median);
		if (Math.abs(da - db) > TIE) return da - db;
		const left = at.get(a)! - at.get(b)!;
		return Math.abs(left) > TIE ? left : a < b ? -1 : a > b ? 1 : 0;
	})[0];
}

/**
 * The trials of contract §1.5. `first` is the layout with every group at its first hub; each trial seats the next hub of every group that did not stand side by
 * side, all at once (`rerun` lays the tree out again with the states). After `GROUP_TRIALS` hubs a group is hung, and every hung group takes the hub of the
 * rule of `hubByRule`, read from the last trial. Returns the final layout (one more run when a hub changed after the last trial).
 */
export function settleGroups<S extends { layout: TreeLayout }>(g: FamilyGraph, groups: readonly ParentGroup[], states: Map<string, GroupState>, first: S, rerun: () => S): S {
	let stages = first;
	const open = () => groups.filter((grp) => states.get(grp.child)!.seated && !seatedOn(stages.layout, grp, states.get(grp.child)!.hub));
	for (let r = 1; r < GROUP_TRIALS; r++) {
		const unseated = open();
		if (!unseated.length) break;
		for (const grp of unseated) {
			const st = states.get(grp.child)!;
			const order = groupHubOrder(g, grp);
			if (r < order.length) {
				st.hub = order[r];
				st.trials++;
			} else st.seated = false;
		}
		stages = rerun();
	}
	let changed = false;
	for (const grp of open()) {
		states.get(grp.child)!.seated = false;
		changed = true;
	}
	for (const grp of groups) {
		const st = states.get(grp.child)!;
		if (st.seated) continue;
		const hub = hubByRule(stages.layout, grp);
		if (hub !== st.hub) {
			st.hub = hub;
			changed = true;
		}
	}
	return changed ? rerun() : stages;
}

/** `Layout.groups` of a finished layout: the hub, whether the three stand side by side on it (measured, not the state), and the trials. */
export function groupLayouts(layout: TreeLayout, groups: readonly ParentGroup[], states: ReadonlyMap<string, GroupState>): Map<string, GroupLayout> {
	return new Map(groups.map((grp) => {
		const st = states.get(grp.child)!;
		return [grp.child, { hub: st.hub, seated: st.seated && seatedOn(layout, grp, st.hub), trials: st.trials }] as const;
	}));
}
