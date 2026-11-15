/*
 * The pair of two guardians of a ward as the walk and the layout set the cards (D354 1 B). `deriveFamilies` keeps such a pair out of
 * `unions` (guardianship is no partnership); the order walk and the layout still seat the two guardians side by side, with the ward
 * centred under them, exactly as when the pair was an implicit union. `withWardUnions` gives them a private union for that work only:
 * its type is `ward-pair`, so no line, sign or tag is drawn for it. The result never leaves the walk and the layout.
 */

import { pairKey, type FamilyGraph, type FamilyUnion } from './derive';

/** The `type` of the private union of a ward pair. */
export const WARD_PAIR_TYPE = 'ward-pair';

/** The key of the private union of two guardians: the key an implicit union of the pair would have. */
export const wardUnionKey = (a: string, b: string): string => `i:${pairKey(a, b)}`;

/** Whether a union is the private union of a ward pair. */
export const isWardUnion = (fu: FamilyUnion): boolean => fu.type === WARD_PAIR_TYPE;

/** A ward pair that has no shown ward: its guardians and the `Person.index` of its first ward (where its union stands). */
export interface BarePair {
	guardians: readonly [string, string];
	index: number;
}

/**
 * `g` with a private union for every pair in `g.wardPairs`, and no `wardPairs`; `g` itself when it has none, so the result is its own
 * fixed point. The unions stand where the implicit union of the pair stood, by the first child.
 */
export function withWardUnions(g: FamilyGraph, bare: readonly BarePair[] = []): FamilyGraph {
	if (!g.wardPairs.length && !bare.length) return g;
	const made = new Map<string, FamilyUnion>();
	const first = new Map<FamilyUnion, number>();
	for (const w of g.wardPairs) {
		const key = wardUnionKey(w.guardians[0], w.guardians[1]);
		const fu = made.get(key) ?? { key, partners: [w.guardians[0], w.guardians[1]] as [string, string], type: WARD_PAIR_TYPE, implicit: true, children: [] };
		fu.children.push(w.child);
		made.set(key, fu);
	}
	// A pair whose wards a fold hides keeps its union, empty, so its folded family has a place (as a union with hidden children does).
	for (const b of bare) {
		const key = wardUnionKey(b.guardians[0], b.guardians[1]);
		if (made.has(key)) continue;
		const fu: FamilyUnion = { key, partners: [b.guardians[0], b.guardians[1]], type: WARD_PAIR_TYPE, implicit: true, children: [] };
		made.set(key, fu);
		first.set(fu, b.index);
	}
	const at = (fu: FamilyUnion) => first.get(fu) ?? g.byId.get(fu.children[0])?.index ?? Number.MAX_SAFE_INTEGER;
	const listed = g.unions.filter((u) => !u.implicit);
	const implicit = [...g.unions.filter((u) => u.implicit), ...made.values()].sort((a, b) => at(a) - at(b));
	const unions = [...listed, ...implicit];
	const unionByKey = new Map(unions.map((u) => [u.key, u]));
	const unionsOf = new Map<string, string[]>();
	for (const u of unions) for (const p of u.partners) (unionsOf.get(p) ?? unionsOf.set(p, []).get(p)!).push(u.key);
	const primaryUnion = new Map(g.primaryUnion);
	for (const fu of made.values()) for (const c of fu.children) primaryUnion.set(c, fu.key);
	return { ...g, unions, unionByKey, unionsOf, primaryUnion, wardPairs: [] };
}
