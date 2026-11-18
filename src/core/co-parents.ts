/*
 * The pairs that the relation words call "Co-parent" without a written partnership (spec §13.1, D356 3 A and 5 A). A child with
 * exactly two birth parents, or exactly two adoptive parents, makes its two parents a pair; with three or more of one kind it makes
 * none, so no word depends on the order of a list. Where the child's card stands (`placement`) does not change this, and a guardian
 * never joins a pair. This set serves the relation words and the finder only: the drawing reads `FamilyGraph.unions`, which
 * hold no union for such a child unless two of its parents are a couple (`parent-groups.ts`).
 */

import { drawnParentMap, type FamilyGraph, type FamilyUnion, pairKey, partnerOf } from './derive';

const MEMO = new WeakMap<FamilyGraph, ReadonlyMap<string, readonly [string, string]>>();
const PARTNER_MEMO = new WeakMap<FamilyGraph, ReadonlyMap<string, readonly string[]>>();

/** The pairs of `g` (key `pairKey`) that share a child as its only two parents of one kind, birth or adoptive; memoised for each graph. */
export function coParentPairs(g: FamilyGraph): ReadonlyMap<string, readonly [string, string]> {
	let out = MEMO.get(g);
	if (out) return out;
	const found = new Map<string, readonly [string, string]>();
	for (const links of drawnParentMap(g).values()) {
		for (const type of ['birth', 'adoptive'] as const) {
			const ids = [...new Set(links.filter((l) => l.type === type).map((l) => l.id))];
			if (ids.length === 2 && !found.has(pairKey(ids[0], ids[1]))) found.set(pairKey(ids[0], ids[1]), [ids[0], ids[1]]);
		}
	}
	out = found;
	MEMO.set(g, out);
	return out;
}

/** The people each person is paired with by `coParentPairs`, in the order of the pairs; memoised for each graph so a lookup does not scan every pair. */
export function coParentPartners(g: FamilyGraph): ReadonlyMap<string, readonly string[]> {
	let out = PARTNER_MEMO.get(g);
	if (out) return out;
	const found = new Map<string, string[]>();
	const add = (a: string, b: string) => {
		const list = found.get(a);
		if (list) list.push(b);
		else found.set(a, [b]);
	};
	for (const [a, b] of coParentPairs(g).values()) {
		add(a, b);
		add(b, a);
	}
	out = found;
	PARTNER_MEMO.set(g, out);
	return out;
}

/**
 * The partnerships of `id` that the readers of family and succession see (D356): each listed union, each implicit union of a pair of
 * `coParentPairs`, then each pair that has no union in the graph (the birth parents of a ward-placed child; `fu` is absent). The implicit
 * union of the first two of three parents of one kind is left out, so no reader depends on the order of a list.
 */
export function partnershipsOf(g: FamilyGraph, id: string): { partner: string; fu?: FamilyUnion }[] {
	const pairs = coParentPairs(g);
	const out: { partner: string; fu?: FamilyUnion }[] = [];
	const unionPartners = new Set<string>();
	for (const key of g.unionsOf.get(id) ?? []) {
		const fu = g.unionByKey.get(key);
		if (!fu) continue;
		const partner = partnerOf(fu, id);
		unionPartners.add(partner);
		if (!fu.implicit || pairs.has(pairKey(id, partner))) out.push({ partner, fu });
	}
	for (const partner of coParentPartners(g).get(id) ?? []) if (!unionPartners.has(partner)) out.push({ partner });
	return out;
}
