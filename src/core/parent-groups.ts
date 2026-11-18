/*
 * What the graph knows about a child with three or more parents of one kind (spec §0 D365 (2); contract "Three own lines" §1, §4.1): the
 * verdict of each such child (a couple, or a group), the group of a child, and the order of its parents as hubs. The couple test itself is in
 * `parent-verdict.ts` (a leaf that `derive.ts` uses); this file reads a built `FamilyGraph` and re-exports that test. `group-seats.ts` seats a
 * group for the walk and the layout.
 */

import { drawnParentMap, type DeriveOptions, type FamilyGraph, type FamilyUnion, type ParentGroup } from './derive';
import { GROUP_MIN, type ParentVerdict } from './parent-verdict';

export { coParentKeys, GROUP_MIN, groupKey, parentVerdict, type ParentVerdict } from './parent-verdict';

const VERDICTS = new WeakMap<FamilyGraph, ReadonlyMap<string, ParentVerdict>>();
const GROUPS = new WeakMap<FamilyGraph, ReadonlyMap<string, ParentGroup>>();
const GROUP_CHILDREN = new WeakMap<FamilyGraph, ReadonlySet<string>>();

/**
 * The verdict of every child that is a case (three or more parents of one kind), memoised for each graph: a group for each entry of
 * `parentGroups`, and a couple for each child that stands under two of its parents with more parents of the same kind as side links.
 */
export function parentVerdicts(g: FamilyGraph): ReadonlyMap<string, ParentVerdict> {
	let out = VERDICTS.get(g);
	if (out) return out;
	const found = new Map<string, ParentVerdict>();
	for (const grp of g.parentGroups) found.set(grp.child, { verdict: 'group', parentKind: grp.kind });
	for (const e of g.secondary) {
		const kind = g.placementType.get(e.child);
		const placed = g.placementParents.get(e.child);
		// Side links of the placement kind exist only beside two placement parents that are the couple (a group holds all its parents of that kind).
		if ((kind !== 'birth' && kind !== 'adoptive') || e.type !== kind || placed?.length !== 2 || found.has(e.child)) continue;
		found.set(e.child, { verdict: 'couple', parentKind: kind, pair: [placed[0], placed[1]] });
	}
	out = found;
	VERDICTS.set(g, out);
	return out;
}

/** The group of one child, or undefined when it is no group; memoised for each graph. */
export function parentGroupOf(g: FamilyGraph, child: string): ParentGroup | undefined {
	let by = GROUPS.get(g);
	if (!by) {
		by = new Map(g.parentGroups.map((grp) => [grp.child, grp]));
		GROUPS.set(g, by);
	}
	return by.get(child);
}

/** The children of all groups of `g`, memoised for each graph. */
export function groupChildren(g: FamilyGraph): ReadonlySet<string> {
	let out = GROUP_CHILDREN.get(g);
	if (!out) {
		out = new Set(g.parentGroups.map((grp) => grp.child));
		GROUP_CHILDREN.set(g, out);
	}
	return out;
}

/**
 * How many places hold a person: own placement parents, listed unions, and children placed under them. A child of a group is left out and so
 * is a seat union, so the number is the same before and after `withGroupSeats` (a seat union is implicit and holds no other child) and no hub depends on a seating.
 */
function attachments(g: FamilyGraph, id: string): number {
	const kids = groupChildren(g);
	let n = g.placementParents.get(id)?.length ?? 0;
	for (const key of g.unionsOf.get(id) ?? []) {
		const fu: FamilyUnion = g.unionByKey.get(key)!;
		if (!fu.implicit) n++;
		n += fu.children.filter((c) => !kids.has(c)).length;
	}
	n += (g.soloChildren.get(id) ?? []).filter((c) => !kids.has(c)).length;
	for (const w of g.wardPairs) if (w.guardians[0] === id || w.guardians[1] === id) n++;
	return n;
}

/**
 * The parents of a group in hub order (contract §1.5): the fewest attachments first, then the person's place in the note. A total order from the
 * graph, so it never reads the order of the child's own list.
 */
export function groupHubOrder(g: FamilyGraph, group: ParentGroup): string[] {
	const index = (id: string) => g.byId.get(id)?.index ?? Number.MAX_SAFE_INTEGER;
	const count = new Map(group.parents.map((id) => [id, attachments(g, id)]));
	return [...group.parents].sort((a, b) => count.get(a)! - count.get(b)! || index(a) - index(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The first hub of every group child: the hub that the walk and the rows use before any trial seating. */
export function defaultHubs(g: FamilyGraph): ReadonlyMap<string, string> {
	return new Map(g.parentGroups.map((grp) => [grp.child, groupHubOrder(g, grp)[0]]));
}

const PLACEMENTS = new WeakMap<FamilyGraph, ReadonlyMap<string, string>>();

/**
 * The placement kind of every child that has three or more drawn parents of one kind and is no case (guardians place it, or the other kind): the
 * part of a tree that is derived again takes it, so a child that stands under a guardian never gets a union of its birth parents. Memoised for each graph.
 */
export function wholePlacements(g: FamilyGraph): ReadonlyMap<string, string> {
	let out = PLACEMENTS.get(g);
	if (out) return out;
	const found = new Map<string, string>();
	const verdicts = parentVerdicts(g);
	for (const [child, links] of drawnParentMap(g)) {
		const kind = g.placementType.get(child);
		if (!kind || verdicts.has(child) || links.length < GROUP_MIN) continue;
		const count = new Map<string, number>();
		for (const l of links) count.set(l.type, (count.get(l.type) ?? 0) + 1);
		if ([...count.values()].some((n) => n >= GROUP_MIN)) found.set(child, kind);
	}
	out = found;
	PLACEMENTS.set(g, out);
	return out;
}

/** What `deriveFamilies` needs to read a part of the tree `whole` as `whole` reads it: the verdicts and the placements of children with three or more parents of one kind. */
export const partOptions = (whole: FamilyGraph): Pick<DeriveOptions, 'verdicts' | 'placements'> => ({ verdicts: parentVerdicts(whole), placements: wholePlacements(whole) });
