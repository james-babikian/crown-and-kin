/*
 * Read-only questions about one person's family (spec §6.3, §6.4, §6.6, §6.7), answered from the
 * derived graph. Parent links are read as written, not as drawn: a link that validation dropped to
 * break a cycle still counts, because the ops and the pickers work on what is written.
 */

import { partnerOf, type FamilyGraph } from './derive';
import type { ParentKind, UnionKind, UnionRef } from './edit';
import { PARENT_LIMIT, PARENT_TYPES, PLACEMENT_TYPES } from './types';
import { cleanParents, push } from './validate';

/** One parent entry, as `familyOf` reports it for a person. */
export interface ParentLink {
	id: string;
	type: ParentKind;
}

/** One partnership a person is in, as `familyOf` reports it. */
export interface PartnerLink {
	partner: string;
	/** Null for an implicit union (co-parents with no union recorded). */
	union: UnionRef | null;
	type: UnionKind | (string & {}) | null;
	start?: string;
	end?: string;
}

/** Where a person sits among their siblings, for the sibling-order controls (§6.5). */
export interface SiblingPosition {
	/** Siblings in the same group (same primary union, or same single parent), in `people` order, including the person. */
	group: string[];
	index: number;
	canMoveEarlier: boolean;
	canMoveLater: boolean;
}

/** What the edit sheet shows about one person's family. */
export interface FamilyView {
	/** Every parent entry as written, in order (valid references only). */
	parents: ParentLink[];
	/** Listed unions in `unions` order, then implicit co-parents. */
	partners: PartnerLink[];
	/** Null when the person has no siblings in their group. */
	siblings: SiblingPosition | null;
	/** Placement-eligible parent types the person has (for "Shown under", §6.3). */
	placementTypes: ParentKind[];
	/** Parent types already at their limit, `PARENT_LIMIT`: 2 birth, adoptive or ward parents, 8 rumoured ones (disabled in Add parent, §6.4; contract B.3). */
	fullTypes: ParentKind[];
	/** Choices for "other parent" in Add child: partners in union order, then implicit co-parents (§6.4). "No other parent" is added by the UI. */
	otherParentChoices: string[];
}

/** Builds the `FamilyView` for one person, or null if no such person exists. */
export type FamilyOf = (g: FamilyGraph, id: string) => FamilyView | null;

/** The kinds of person picker the plugin shows (§6.6). */
export type PickerAction = 'add-parent' | 'add-child' | 'add-spouse' | 'focus' | 'find';

/**
 * People the picker must not offer (§6.6): add-parent → the person, all their descendants
 * through any parent type, and people already their parent of `parentType`; add-child → the
 * person and all their ancestors through any parent type; add-spouse → the person; focus and
 * find → nobody.
 */
export type PickerExclusions = (g: FamilyGraph, id: string, action: PickerAction, parentType?: ParentKind) => Set<string>;

/** What "Delete person" changes, for the confirmation (§6.7). */
export interface DeleteSummary {
	/** Listed unions the person is a partner in. */
	unions: number;
	/** People who list the person as a parent (any type). */
	childLinks: number;
	clearsStart: boolean;
	clearsFocus: boolean;
	/** Spec §13.1: the person has the "This is me" mark. Set only when `options` has a `me`. */
	clearsMe?: boolean;
	/**
	 * D57: the written holder items that name the person (`entries`) and the titles they are in
	 * (`titles`; a title with a duplicate id counts on its own). Set only when the tree has titles.
	 */
	holders?: { titles: number; entries: number };
	/** Contract 0.2.7 K.3: the titles that name the person as an heir. Absent when 0. */
	heirs?: number;
	/** The titles that list the person as an excluded person. Absent when 0. */
	excluded?: number;
}

/** Builds the `DeleteSummary` for deleting one person. */
export type DescribeDelete = (g: FamilyGraph, id: string, options: { start?: string; focus?: string; me?: string }) => DeleteSummary;

/** Parent entries that name someone else in the tree, in written order, once per id and type. */
export function writtenParents(g: FamilyGraph, id: string): ParentLink[] {
	const person = g.byId.get(id);
	return person ? cleanParents(id, person.parents, (q) => g.byId.has(q)) : [];
}

/** Everyone reachable from `id` through parent links of any type, in one direction. */
function reach(g: FamilyGraph, id: string, down: boolean): Set<string> {
	const next = new Map<string, string[]>();
	for (const p of g.people) {
		for (const r of writtenParents(g, p.id)) {
			const [from, to] = down ? [r.id, p.id] : [p.id, r.id];
			push(next, from, to);
		}
	}
	const found = new Set<string>();
	const stack = [id];
	while (stack.length) {
		for (const n of next.get(stack.pop()!) ?? []) {
			if (found.has(n)) continue;
			found.add(n);
			stack.push(n);
		}
	}
	return found;
}

/** Everyone reachable from `id` by following parent links downward (children, grandchildren, and so on). */
export const descendantsOf = (g: FamilyGraph, id: string) => reach(g, id, true);
/** Everyone reachable from `id` by following parent links upward (parents, grandparents, and so on). */
export const ancestorsOf = (g: FamilyGraph, id: string) => reach(g, id, false);

/** The person's sibling group (§4.3, §6.5): the children of their primary union, or of their one placement parent. */
export function siblingGroup(g: FamilyGraph, id: string): string[] | null {
	const key = g.primaryUnion.get(id);
	if (key !== undefined) return g.unionByKey.get(key)?.children ?? null;
	const placed = g.placementParents.get(id) ?? [];
	if (placed.length === 1) return g.soloChildren.get(placed[0]) ?? null;
	return null;
}

/** Implements `FamilyOf`. */
export const familyOf: FamilyOf = (g, id) => {
	if (!g.byId.has(id)) return null;
	const parents = writtenParents(g, id);

	const partners: PartnerLink[] = [];
	const choices: string[] = [];
	for (const key of g.unionsOf.get(id) ?? []) {
		const fu = g.unionByKey.get(key);
		if (!fu) continue;
		const partner = partnerOf(fu, id);
		if (!choices.includes(partner)) choices.push(partner);
		if (fu.implicit || fu.unionIndex === undefined) {
			partners.push({ partner, union: null, type: null });
			continue;
		}
		const union: UnionRef = { index: fu.unionIndex, partners: [fu.partners[0], fu.partners[1]] };
		if (fu.text !== undefined) union.text = fu.text;
		const link: PartnerLink = { partner, union, type: fu.type };
		if (fu.start !== undefined) link.start = fu.start;
		if (fu.end !== undefined) link.end = fu.end;
		partners.push(link);
	}

	const group = siblingGroup(g, id);
	let siblings: FamilyView['siblings'] = null;
	if (group && group.length > 1) {
		const index = group.indexOf(id);
		siblings = { group: [...group], index, canMoveEarlier: index > 0, canMoveLater: index < group.length - 1 };
	}

	const count = (t: ParentKind) => parents.filter((r) => r.type === t).length;
	return {
		parents,
		partners,
		siblings,
		placementTypes: PLACEMENT_TYPES.filter((t) => count(t) > 0),
		fullTypes: PARENT_TYPES.filter((t) => count(t) >= PARENT_LIMIT[t]),
		otherParentChoices: choices,
	};
};

/** Implements `PickerExclusions`. */
export const pickerExclusions: PickerExclusions = (g, id, action, parentType) => {
	switch (action) {
		case 'add-parent': {
			const type = parentType ?? 'birth';
			const out = descendantsOf(g, id);
			out.add(id);
			for (const r of writtenParents(g, id)) if (r.type === type) out.add(r.id);
			return out;
		}
		case 'add-child': {
			const out = ancestorsOf(g, id);
			out.add(id);
			return out;
		}
		case 'add-spouse':
			return new Set([id]);
		default:
			return new Set();
	}
};

/** Implements `DescribeDelete`. */
export const describeDelete: DescribeDelete = (g, id, options) => {
	const summary: DeleteSummary = {
		// Every union item that lists the person, as the delete removes them, not only drawable ones.
		unions: g.writtenUnions.filter((partners) => partners.includes(id)).length,
		childLinks: g.people.filter((p) => p.id !== id && p.parents.some((r) => r.id === id)).length,
		clearsStart: options?.start === id,
		clearsFocus: options?.focus === id,
	};
	if (options?.me !== undefined) summary.clearsMe = options.me === id;
	let titles = 0;
	let entries = 0;
	for (const t of g.writtenTitles ?? []) {
		const n = t.holders.filter((h) => h.person === id).length;
		if (n) titles++;
		entries += n;
	}
	if (g.writtenTitles?.length) summary.holders = { titles, entries };
	const heirs = (g.writtenTitles ?? []).filter((t) => t.heirs?.includes(id)).length;
	const excluded = (g.writtenTitles ?? []).filter((t) => t.exclude?.includes(id)).length;
	if (heirs) summary.heirs = heirs;
	if (excluded) summary.excluded = excluded;
	return summary;
};
