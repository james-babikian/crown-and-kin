/*
 * The seats of a group of three or more parents of one kind as the walk and the layout set the cards (D365 (2); contract "Three own
 * lines" §1.5, §4.1). `deriveFamilies` keeps a group out of every union; the walk and the layout still try to stand the three side by side,
 * the hub in the middle, with the child under the hub. `withGroupSeats` gives the child to the hub as a one-parent family, the other parents
 * a side link of their own, and (for a seated group) a private union hub to each other parent. Its type is `group-seat`, so no line, sign or tag is
 * drawn for it. Like `ward-unions.ts`, the result never leaves the walk and the layout.
 */

import { pairKey, type FamilyGraph, type FamilyUnion, type ParentGroup } from './derive';
import { defaultHubs, groupChildren, groupHubOrder, parentGroupOf } from './parent-groups';

/** The `type` of the private union of a seat pair of a group. */
export const GROUP_SEAT_TYPE = 'group-seat';

/** How many trial seatings a group gets before it is called hung (contract §1.5). */
export const GROUP_TRIALS = 3;

/** The most parents that a group is seated for; a larger group is always hung. */
export const GROUP_SEAT_MAX = 3;

/** The key of the private union of a seat pair. */
export const groupSeatKey = (a: string, b: string): string => `g:${pairKey(a, b)}`;

/** Whether a union is the private union of a seat pair. */
export const isGroupSeat = (fu: FamilyUnion): boolean => fu.type === GROUP_SEAT_TYPE;

/** The parts of `g` without any seating: placement parents, one-parent families, side links and unions as `deriveFamilies` made them. */
function unseated(g: FamilyGraph, kids: ReadonlySet<string>) {
	const placementParents = new Map(g.placementParents);
	const primaryUnion = new Map(g.primaryUnion);
	for (const c of kids) primaryUnion.delete(c);
	const soloChildren = new Map<string, string[]>();
	for (const [k, list] of g.soloChildren) {
		const kept = list.filter((c) => !kids.has(c));
		if (kept.length) soloChildren.set(k, kept);
	}
	const secondary = g.secondary.filter((e) => {
		const grp = parentGroupOf(g, e.child);
		return !(grp && e.type === grp.kind && e.parents.length === 1 && grp.parents.includes(e.parents[0]));
	});
	// Where each union stands: the place of its first child, so a seat union can be put among the implicit ones.
	const first = new Map(g.unions.map((u) => [u.key, g.byId.get(u.children[0])?.index ?? Number.MAX_SAFE_INTEGER]));
	const list = new Map<string, FamilyUnion>();
	for (const u of g.unions) if (!isGroupSeat(u)) list.set(u.key, u.children.some((c) => kids.has(c)) ? { ...u, children: u.children.filter((c) => !kids.has(c)) } : u);
	return { placementParents, primaryUnion, soloChildren, secondary, list, first };
}

/** The listed unions, then the implicit ones with the seat unions put in where their child stands; the unions that were there keep their order. */
function withSeatUnions(list: ReadonlyMap<string, FamilyUnion>, added: readonly { fu: FamilyUnion; at: number }[], first: ReadonlyMap<string, number>): FamilyUnion[] {
	const all = [...list.values()];
	const firstImplicit = all.findIndex((u) => u.implicit);
	const listed = firstImplicit < 0 ? all : all.slice(0, firstImplicit);
	const implicit = firstImplicit < 0 ? [] : all.slice(firstImplicit);
	for (const { fu, at } of added) {
		const next = implicit.findIndex((u) => (first.get(u.key) ?? Number.MAX_SAFE_INTEGER) > at);
		if (next < 0) implicit.push(fu);
		else implicit.splice(next, 0, fu);
	}
	return [...listed, ...implicit];
}

/** The union of the hub with each other parent, made when no union of the pair exists; returns the first of them (the one a pair of two parents is seated in). */
function seatPairs(hub: string, others: readonly string[], byPair: Map<string, FamilyUnion>, owned: Set<FamilyUnion>, added: { fu: FamilyUnion; at: number }[], at: number): FamilyUnion | undefined {
	let host: FamilyUnion | undefined;
	for (const x of others) {
		const key = pairKey(hub, x);
		let fu = byPair.get(key);
		if (!fu) {
			fu = { key: groupSeatKey(hub, x), partners: [hub, x], type: GROUP_SEAT_TYPE, implicit: true, children: [] };
			byPair.set(key, fu);
			owned.add(fu);
			added.push({ fu, at });
		}
		host ??= fu;
	}
	return host;
}

/** The group as far as `g` shows it (a graph with people left out, as a fold makes): the parents that are in `g`; undefined when the child or every parent is missing. */
function shownPart(g: FamilyGraph, grp: ParentGroup): ParentGroup | undefined {
	if (!g.byId.has(grp.child)) return undefined;
	const parents = grp.parents.every((q) => g.byId.has(q)) ? grp.parents : grp.parents.filter((q) => g.byId.has(q));
	return parents.length ? { ...grp, parents } : undefined;
}

/**
 * `g` with each group child given to its hub: placement parents `[hub, ...the others in hub order]`, the child in the hub's one-parent
 * family, one side link for each other parent, no primary union. For a child in `seated`, a private union hub to each other parent (a union of
 * the pair that exists is used as it is). A pair of two parents (only in a part of a tree) that is seated holds the child as the child of its
 * union. The result is a function of `g`'s groups and the two arguments, so it can be applied again to its own result. `g` itself when it has no group.
 */
export function withGroupSeats(g: FamilyGraph, hubs: ReadonlyMap<string, string>, seated: ReadonlySet<string>): FamilyGraph {
	if (!g.parentGroups.length) return g;
	const kids = groupChildren(g);
	const index = (id: string) => g.byId.get(id)?.index ?? Number.MAX_SAFE_INTEGER;

	// Start from the unseated graph: take out what an earlier seating put in.
	const { placementParents, primaryUnion, soloChildren, secondary, list, first } = unseated(g, kids);
	const byPair = new Map<string, FamilyUnion>();
	for (const u of list.values()) if (!byPair.has(pairKey(u.partners[0], u.partners[1]))) byPair.set(pairKey(u.partners[0], u.partners[1]), u);
	const owned = new Set<FamilyUnion>();
	const added: { fu: FamilyUnion; at: number }[] = [];

	for (const whole of g.parentGroups) {
		const grp = shownPart(g, whole);
		if (!grp) continue;
		const order = groupHubOrder(g, grp);
		const asked = hubs.get(grp.child);
		const hub = asked !== undefined && order.includes(asked) ? asked : order[0];
		const others = order.filter((x) => x !== hub);
		placementParents.set(grp.child, [hub, ...others]);
		for (const x of others) secondary.push({ child: grp.child, type: grp.kind, parents: [x] });
		const host = seated.has(grp.child) && grp.parents.length <= GROUP_SEAT_MAX ? seatPairs(hub, others, byPair, owned, added, index(grp.child)) : undefined;
		if (host && grp.parents.length === 2) {
			// The two seat each other: the child is the child of the pair, as a ward of two guardians is (centred under both).
			const next = owned.has(host) ? host : { ...host, children: [...host.children] };
			next.children = [...next.children, grp.child].sort((a, b) => index(a) - index(b));
			if (next !== host) {
				owned.add(next);
				byPair.set(pairKey(host.partners[0], host.partners[1]), next);
				if (list.has(host.key)) list.set(host.key, next);
			}
			primaryUnion.set(grp.child, next.key);
		} else {
			soloChildren.set(hub, [...(soloChildren.get(hub) ?? []), grp.child].sort((a, b) => index(a) - index(b)));
		}
	}

	const unions = withSeatUnions(list, added, first);
	const unionByKey = new Map(unions.map((u) => [u.key, u]));
	const unionsOf = new Map<string, string[]>();
	for (const u of unions) for (const p of u.partners) (unionsOf.get(p) ?? unionsOf.set(p, []).get(p)!).push(u.key);
	return { ...g, placementParents, primaryUnion, soloChildren, secondary, unions, unionByKey, unionsOf };
}

/**
 * `g` ready for the walk and the rows: with every group of at most three parents seated at its first hub, unless `g` has been seated already (a layout graph that
 * `withGroupSeats` made), which stays as it is, so the walk never undoes a trial.
 */
export function withDefaultGroupSeats(g: FamilyGraph): FamilyGraph {
	if (!g.parentGroups.length) return g;
	const placed = (grp: ParentGroup) => shownPart(g, grp) === undefined || g.primaryUnion.has(grp.child) || (g.soloChildren.get(g.placementParents.get(grp.child)?.[0] ?? '')?.includes(grp.child) ?? false);
	if (g.parentGroups.every(placed)) return g;
	return withGroupSeats(g, defaultHubs(g), new Set(g.parentGroups.filter((grp) => (shownPart(g, grp)?.parents.length ?? Infinity) <= GROUP_SEAT_MAX).map((grp) => grp.child)));
}
