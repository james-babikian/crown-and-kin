/*
 * Builds the family graph a tree is drawn from: each person's placement parents, their primary
 * union, and every other parent link or partnership (spec §4.3); it also carries the titles
 * (§13.4). Calls `validateTree` first, then works out who is placed under whom. `generations.ts`,
 * `order.ts` and the layout code read the result; `family-query.ts` answers questions about one
 * person's family from it. `drawnParents` gives the cycle-broken parent links that focus mode and
 * relation names (`relations.ts`) follow.
 */

import { codedIssue, type CodedIssue } from './messages';
import { isPlacementType, parentKind, PLACEMENT_TYPES, type House, type ParentType, type Person, type Title, type Tree } from './types';
import { push, validateTree } from './validate';

/** One partnership as it is drawn: a union listed in the block, or one inferred from shared children. */
export interface FamilyUnion {
	/** `u<index>` for a union listed in the block, `i:` and the sorted pair as JSON (`i:["a","b"]`) for an implicit one. */
	key: string;
	partners: [string, string];
	type: string;
	implicit: boolean;
	/** Position in the `unions` list; undefined for implicit unions. */
	unionIndex?: number;
	id?: string;
	/** Listed unions only, for the edit sheet's spouse list (§6.3). */
	start?: string;
	end?: string;
	/** Listed unions only: the source text a `UnionRef` carries. */
	text?: string;
	/** Children whose primary union this is, in sibling order. */
	children: string[];
}

/** A parent link that is drawn but does not decide where the child sits. */
export interface SecondaryEdge {
	child: string;
	type: string;
	parents: string[];
	/** Set when the link comes from a couple with a listed union: drawn from its union dot. */
	unionKey?: string;
}

/** The derived shape of a whole tree: who is placed under whom, every partnership, and every issue found so far. */
export interface FamilyGraph {
	/** Unique people in document order. */
	people: Person[];
	byId: Map<string, Person>;
	houses: Map<string, House>;
	placementParents: Map<string, string[]>;
	placementType: Map<string, string>;
	primaryUnion: Map<string, string>;
	unions: FamilyUnion[];
	unionByKey: Map<string, FamilyUnion>;
	/** Person → union keys: listed unions in list order, then implicit ones. */
	unionsOf: Map<string, string[]>;
	/** Parent → children who have only that one placement parent. */
	soloChildren: Map<string, string[]>;
	secondary: SecondaryEdge[];
	/** Partners of every union item as written, drawable or not, in list order. */
	writtenUnions: string[][];
	/** Spec §13.4: the titles that can show (`Validated.titles`), in list order; `[]` with none. */
	titles: Title[];
	/**
	 * Every title with an id as written, duplicates included, with its holders as read (before
	 * validation dropped any): what a delete removes and its confirmation counts (D57).
	 */
	writtenTitles: Title[];
	/** Parse issues, then validation issues, then those found here (spec §8). */
	issues: CodedIssue[];
}

/** Order-free key for a couple. JSON keeps ids that contain "|" apart and cannot throw. */
export const pairKey = (a: string, b: string) => {
	const [x, y] = a < b ? [a, b] : [b, a];
	return JSON.stringify([x, y]);
};

/** Validates `tree`, then builds its `FamilyGraph`: placement parents, primary unions and side links (spec §4.3). */
export function deriveFamilies(tree: Tree): FamilyGraph {
	const v = validateTree(tree);
	const { people, byId, houses, refs } = v;
	const issues: CodedIssue[] = [...tree.issues, ...v.issues];

	// Listed unions that can be drawn.
	const unions: FamilyUnion[] = [];
	const unionByKey = new Map<string, FamilyUnion>();
	const listedByPair = new Map<string, FamilyUnion[]>();
	for (const u of v.unions) {
		const [a, b] = u.partners;
		const fu: FamilyUnion = { key: `u${u.index}`, partners: [a, b], type: u.type, implicit: false, unionIndex: u.index, id: u.id, children: [] };
		if (u.start !== undefined) fu.start = u.start;
		if (u.end !== undefined) fu.end = u.end;
		if (u.text !== undefined) fu.text = u.text;
		unions.push(fu);
		unionByKey.set(fu.key, fu);
		push(listedByPair, pairKey(a, b), fu);
	}

	// Placement parents, primary unions, secondary links.
	const placementParents = new Map<string, string[]>();
	const placementType = new Map<string, string>();
	const primaryUnion = new Map<string, string>();
	const soloChildren = new Map<string, string[]>();
	const secondary: SecondaryEdge[] = [];
	const implicitByPair = new Map<string, FamilyUnion>();

	for (const p of people) {
		const byType = new Map<string, string[]>();
		for (const r of refs.get(p.id)!) push(byType, r.type, r.id);

		let type = PLACEMENT_TYPES.find((t) => byType.has(t));
		if (p.placement !== undefined && isPlacementType(p.placement) && byType.has(p.placement)) type = p.placement;

		const placed = type ? byType.get(type)!.slice(0, 2) : [];
		placementParents.set(p.id, placed);
		if (type) placementType.set(p.id, type);

		let fu: FamilyUnion | undefined;
		if (placed.length === 2) {
			const key = pairKey(placed[0], placed[1]);
			const listed = listedByPair.get(key);
			if (listed) {
				fu = (p.union !== undefined && listed.find((u) => u.id === p.union)) || listed[listed.length - 1];
			} else {
				fu = implicitByPair.get(key);
				if (!fu) {
					fu = { key: `i:${key}`, partners: [placed[0], placed[1]], type: 'implicit', implicit: true, children: [] };
					implicitByPair.set(key, fu);
				}
			}
			primaryUnion.set(p.id, fu.key);
			fu.children.push(p.id);
		} else if (placed.length === 1) {
			push(soloChildren, placed[0], p.id);
		}
		// A `union` that names no union at all was reported by validation as missing.
		if (p.union !== undefined && v.unionIds.has(p.union) && fu?.id !== p.union) {
			issues.push(codedIssue('union-not-of-parents', 'warning', { person: p.name, ref: p.union }, [p.id]));
		}

		// Everything not used for placement is a side link, grouped per type.
		for (const [t, ids] of byType) {
			const rest = t === type ? ids.slice(2) : ids;
			if (!rest.length) continue;
			const listed = rest.length === 2 ? listedByPair.get(pairKey(rest[0], rest[1])) : undefined;
			if (listed) secondary.push({ child: p.id, type: t, parents: rest, unionKey: listed[listed.length - 1].key });
			else for (const parent of rest) secondary.push({ child: p.id, type: t, parents: [parent] });
		}
	}

	for (const fu of implicitByPair.values()) {
		unions.push(fu);
		unionByKey.set(fu.key, fu);
	}
	const unionsOf = new Map<string, string[]>();
	for (const fu of unions) for (const partner of fu.partners) push(unionsOf, partner, fu.key);

	const writtenUnions = tree.unions.map((u) => [...u.partners]);
	return { people, byId, houses, placementParents, placementType, primaryUnion, unions, unionByKey, unionsOf, soloChildren, secondary, writtenUnions, titles: v.titles, writtenTitles: tree.titles ?? [], issues };
}

/** One parent link the tree draws: the parent's id and the link type (unknown types read as birth). */
export interface DrawnParent {
	id: string;
	type: ParentType;
}

/**
 * Every person's drawn parent links, after validation and cycle breaking: placement links first,
 * then the side links in `g.secondary` order. People with no drawn parent are absent.
 */
export function drawnParentMap(g: FamilyGraph): Map<string, DrawnParent[]> {
	const out = new Map<string, DrawnParent[]>();
	for (const [child, placed] of g.placementParents) {
		const type = g.placementType.get(child);
		if (type) for (const q of placed) push(out, child, { id: q, type: parentKind(type) });
	}
	for (const e of g.secondary) for (const q of e.parents) push(out, e.child, { id: q, type: parentKind(e.type) });
	return out;
}

/** The parent links the tree draws for one person, in the order of `drawnParentMap`. */
export function drawnParents(g: FamilyGraph, id: string): DrawnParent[] {
	const out: DrawnParent[] = [];
	const type = g.placementType.get(id);
	if (type) for (const q of g.placementParents.get(id) ?? []) out.push({ id: q, type: parentKind(type) });
	for (const e of g.secondary) if (e.child === id) for (const q of e.parents) out.push({ id: q, type: parentKind(e.type) });
	return out;
}

/** The other partner in a union. */
export function partnerOf(fu: FamilyUnion, id: string): string {
	return fu.partners[0] === id ? fu.partners[1] : fu.partners[0];
}

/** Children placed under this person, via any of their unions or directly. */
export function placedChildren(g: FamilyGraph, id: string): string[] {
	const out: string[] = [];
	for (const key of g.unionsOf.get(id) ?? []) out.push(...g.unionByKey.get(key)!.children);
	out.push(...(g.soloChildren.get(id) ?? []));
	return out;
}
