/*
 * Builds the family graph a tree is drawn from: each person's placement parents, their primary
 * union, and every other parent link or partnership (spec §4.3); it also carries the titles
 * (§13.4). Calls `validateTree` first, then works out who is placed under whom. `generations.ts`,
 * `order.ts` and the layout code read the result; `family-query.ts` answers questions about one
 * person's family from it. `drawnParents` gives the cycle-broken parent links that focus mode and
 * relation names (`relations.ts`) follow.
 *
 * Only a child placed by birth or adoption makes an implicit union (D15, D354 1 B). A ward placed under
 * two guardians who share no union joins no union at all: guardianship is no partnership, so the pair
 * reaches no relation name, partner list or spouse choice. `wardPairs` keeps the pair for the code that
 * sets the cards, so the guardians can still stand side by side. The unions are for the drawing; the "Co-parent" pairs of the relation words
 * come from `co-parents.ts` (D356), so a child with three or more parents of one kind makes no pair there and, with no couple among them, no union here.
 */

import { buildTreeDates, PLAIN_READER, type TreeDates } from './dates';
import { codedIssue, type CodedIssue } from './messages';
import { coParentKeys, coParentPairs, GROUP_MIN, pairKey, parentVerdict, partnerIndex, type ParentVerdict } from './parent-verdict';
import { isPlacementType, parentKind, PLACEMENT_TYPES, type House, type ParentRef, type ParentType, type Person, type Title, type Tree } from './types';
import { anchorIssues, push, validateTree, type ValidateOptions } from './validate';

export { pairKey };

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
	/** D306: the raw trimmed text of `ended-by`; listed unions only. */
	endedBy?: string;
	/** Listed unions only: the source text a `UnionRef` carries. */
	text?: string;
	/** Children whose primary union this is, in sibling order. */
	children: string[];
}

/**
 * A ward placed under two guardians who share no union (D354 1 B). The guardians are no couple, so this is a hint for the layout,
 * drawing, fold and focus code only, never a partnership.
 */
export interface WardPair {
	child: string;
	/** The child's placement parents, as in `placementParents`. */
	guardians: [string, string];
}

/**
 * A child with three or more parents of one kind (birth or adoptive) and no couple among them (contract "Three own lines" §1.1, §1.3).
 * The child is in no union and is no ward: each parent has its own line to it. Two parents appear only in a part of a tree (the finder's small
 * tree, a focus) whose whole tree gave a group verdict.
 */
export interface ParentGroup {
	child: string;
	kind: 'birth' | 'adoptive';
	/** The parents of that kind in note order. */
	parents: readonly string[];
}

/** What `deriveFamilies` can be given besides the validation options. */
export interface DeriveOptions extends ValidateOptions {
	/** The verdicts of the whole tree (`parentVerdicts`): a part of a tree reads them instead of testing its own parents (contract §3.6). */
	verdicts?: ReadonlyMap<string, ParentVerdict>;
	/**
	 * The placement kind of the whole tree for each child that has three or more parents of one kind and is no case (placed under guardians, or by
	 * the other kind): a part of a tree places that child by that kind only, so it never draws a couple that the whole tree does not have.
	 */
	placements?: ReadonlyMap<string, string>;
}

/** A parent link that is drawn but does not decide where the child sits. */
interface SecondaryEdge {
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
	/** Wards placed under two guardians with no shared union, in document order; such a child is in no union (D354 1 B). */
	wardPairs: WardPair[];
	/** The children with three or more parents of one kind and no couple, in document order; `[]` when none. Every copy of a graph carries it. */
	parentGroups: ParentGroup[];
	/**
	 * For a child that is a case (a group, or one under the couple of three or more parents), its drawn links in the order the code drew before groups existed (the
	 * first two of the placement kind, then the rest by link type), so `drawnParentMap` reads the same in every tree. Other children are absent.
	 */
	drawnOrder: Map<string, DrawnParent[]>;
	/** Partners of every union item as written, drawable or not, in list order. */
	writtenUnions: string[][];
	/** Spec §13.4: the titles that can show (`Validated.titles`), in list order; `[]` with none. */
	titles: Title[];
	/**
	 * Every title with an id as written, duplicates included, with its holders as read (before
	 * validation dropped any): what a delete removes and its confirmation counts (D57).
	 */
	writtenTitles: Title[];
	/** Spec §14 rule 9: the dates view of this tree; `PLAIN_READER` reads it when no reader is given. A graph built from another one copies it. */
	dates: TreeDates;
	/** Parse issues, then validation issues, then those found here (spec §8). */
	issues: CodedIssue[];
}

/** Each person's parent ids by link type, the ids of the placement type in note order, and the placement type (spec §4.3). */
function placementOf(people: readonly Person[], refs: Map<string, ParentRef[]>, placements?: ReadonlyMap<string, string>) {
	const byTypeOf = new Map<string, Map<string, string[]>>();
	const kindIds = new Map<string, string[]>();
	const placementType = new Map<string, string>();
	for (const p of people) {
		const byType = new Map<string, string[]>();
		for (const r of refs.get(p.id)!) push(byType, r.type, r.id);
		byTypeOf.set(p.id, byType);

		let type = PLACEMENT_TYPES.find((t) => byType.has(t));
		if (p.placement !== undefined && isPlacementType(p.placement) && byType.has(p.placement)) type = p.placement;
		// A part of a tree keeps the placement kind of the whole tree; without parents of that kind here the child stands under nobody.
		const whole = placements?.get(p.id);
		if (whole !== undefined) type = byType.has(whole) && isPlacementType(whole) ? whole : undefined;

		kindIds.set(p.id, type ? byType.get(type)! : []);
		if (type) placementType.set(p.id, type);
	}
	return { byTypeOf, kindIds, placementType };
}

/** A child that is a case: all its parents of the placement kind in note order, and the couple among them if it stands under one. */
interface CaseOf {
	ids: string[];
	pair?: [string, string];
}

/**
 * The children that are a case (contract "Three own lines" §1.1 to §1.3): three or more parents of one kind that is birth or adoptive, tested for
 * a couple (a listed union, or a pair that another child's two parents prove). With `verdicts` (a part of a tree) the whole tree's verdict decides
 * for every child that has two or more such parents here, and a child that the whole tree did not call a case is no case.
 */
function resolveCases(people: readonly Person[], kindIds: Map<string, string[]>, placementType: Map<string, string>, listedByPair: Map<string, FamilyUnion[]>, verdicts?: ReadonlyMap<string, ParentVerdict>): Map<string, CaseOf> {
	const out = new Map<string, CaseOf>();
	const items = verdicts ? [] : people.flatMap((p) => {
		const kind = placementType.get(p.id) as 'birth' | 'adoptive' | 'ward' | undefined;
		return kind ? [{ kind, ids: kindIds.get(p.id)! }] : [];
	});
	const coKeys = coParentKeys(items);
	const partnersOf = partnerIndex([...coParentPairs(items), ...[...listedByPair.values()].map((list) => list[0].partners)]);
	const isCouple = (a: string, b: string) => listedByPair.has(pairKey(a, b)) || coKeys.has(pairKey(a, b));
	for (const p of people) {
		const kind = placementType.get(p.id);
		if (kind !== 'birth' && kind !== 'adoptive') continue;
		const ids = kindIds.get(p.id)!;
		const given = verdicts?.get(p.id);
		if (verdicts) {
			if (!given || given.parentKind !== kind || ids.length < 2) continue;
			const pair = given.verdict === 'couple' && given.pair.every((q) => ids.includes(q)) ? ids.filter((q) => given.pair.includes(q)) : undefined;
			if (pair && ids.length === 2) continue;
			out.set(p.id, pair ? { ids, pair: [pair[0], pair[1]] } : { ids });
		} else if (ids.length >= GROUP_MIN) {
			const union = p.union;
			const v = parentVerdict(kind, ids, isCouple, union === undefined ? undefined : { namesPair: (a, b) => listedByPair.get(pairKey(a, b))?.some((u) => u.id === union) ?? false }, partnersOf);
			out.set(p.id, v.verdict === 'couple' ? { ids, pair: [v.pair[0], v.pair[1]] } : { ids });
		}
	}
	return out;
}

/**
 * The implicit unions of the tree, in the order of the first child who makes each (spec §4.3, D15): the two placement parents of a child
 * placed by birth or adoption who share no listed union. They are all found before any ward is placed, so a ward listed first never
 * decides one (D354 1 B). A group makes none. A child under a couple makes the union only when nothing else did (a part of a tree whose
 * other child is not shown); in a whole tree its pair is always listed or made by another child.
 */
function implicitUnions(people: readonly Person[], placementParents: Map<string, string[]>, placementType: Map<string, string>, listedByPair: Map<string, FamilyUnion[]>, cases: Map<string, CaseOf>): Map<string, FamilyUnion> {
	const out = new Map<string, FamilyUnion>();
	const add = (a: string, b: string) => {
		const key = pairKey(a, b);
		if (!listedByPair.has(key) && !out.has(key)) out.set(key, { key: `i:${key}`, partners: [a, b], type: 'implicit', implicit: true, children: [] });
	};
	for (const p of people) {
		const placed = placementParents.get(p.id)!;
		if (placed.length === 2 && placementType.get(p.id) !== 'ward' && !cases.has(p.id)) add(placed[0], placed[1]);
	}
	for (const c of cases.values()) if (c.pair) add(c.pair[0], c.pair[1]);
	return out;
}

/**
 * Everything not used for placement is a side link, grouped per type. A begetter link is a side link of its own and never comes from a union
 * dot, also for two begetters with a union (spec §0 D332). `placedAsCase` holds the two placement parents of a child under a couple; the rest of its
 * kind keeps the reading of a child with two parents (one link for each parent, a listed pair from its union dot).
 */
function sideLinks(child: string, byType: Map<string, string[]>, type: string | undefined, placedAsCase: string[] | undefined, listedByPair: Map<string, FamilyUnion[]>, secondary: SecondaryEdge[]): void {
	for (const [t, ids] of byType) {
		const rest = t === type ? (placedAsCase ? (placedAsCase.length >= ids.length ? [] : ids.filter((q) => !placedAsCase.includes(q))) : ids.slice(2)) : ids;
		if (!rest.length) continue;
		const listed = rest.length === 2 && t !== 'begetter' ? listedByPair.get(pairKey(rest[0], rest[1])) : undefined;
		if (listed) secondary.push({ child, type: t, parents: rest, unionKey: listed[listed.length - 1].key });
		else for (const parent of rest) secondary.push({ child, type: t, parents: [parent] });
	}
}

/** Validates `tree`, then builds its `FamilyGraph`: placement parents, primary unions and side links (spec §4.3). */
export function deriveFamilies(tree: Tree, options: DeriveOptions = {}): FamilyGraph {
	const v = validateTree(tree, options);
	const { people, byId, houses, refs } = v;
	const issues: CodedIssue[] = [...tree.issues, ...v.issues];

	// Listed unions that can be drawn.
	const unions: FamilyUnion[] = [];
	const unionByKey = new Map<string, FamilyUnion>();
	const listedByPair = new Map<string, FamilyUnion[]>();
	for (const u of v.unions) {
		const [a, b] = u.partners;
		const fu: FamilyUnion = { key: `u${u.index}`, partners: [a, b], type: u.type, implicit: false, unionIndex: u.index, id: u.id, children: [], ...(u.endedBy !== undefined ? { endedBy: u.endedBy } : {}) };
		if (u.start !== undefined) fu.start = u.start;
		if (u.end !== undefined) fu.end = u.end;
		if (u.text !== undefined) fu.text = u.text;
		unions.push(fu);
		unionByKey.set(fu.key, fu);
		push(listedByPair, pairKey(a, b), fu);
	}

	// Placement parents, primary unions, secondary links.
	const { byTypeOf, kindIds, placementType } = placementOf(people, refs, options.placements);
	const cases = resolveCases(people, kindIds, placementType, listedByPair, options.verdicts);
	const placementParents = new Map<string, string[]>();
	for (const p of people) {
		const c = cases.get(p.id);
		placementParents.set(p.id, c ? (c.pair ?? c.ids) : kindIds.get(p.id)!.slice(0, 2));
	}
	const primaryUnion = new Map<string, string>();
	const soloChildren = new Map<string, string[]>();
	const secondary: SecondaryEdge[] = [];
	const wardPairs: WardPair[] = [];
	const parentGroups: ParentGroup[] = [];
	const drawnOrder = new Map<string, DrawnParent[]>();
	const implicitByPair = implicitUnions(people, placementParents, placementType, listedByPair, cases);

	for (const p of people) {
		const byType = byTypeOf.get(p.id)!;
		const type = placementType.get(p.id);
		const placed = placementParents.get(p.id)!;
		const c = cases.get(p.id);

		let fu: FamilyUnion | undefined;
		if (c && !c.pair) {
			parentGroups.push({ child: p.id, kind: type as 'birth' | 'adoptive', parents: c.ids });
		} else if (placed.length === 2) {
			const key = pairKey(placed[0], placed[1]);
			const listed = listedByPair.get(key);
			// A ward joins a union of its guardians only when they already have one (D354 1 B); it never makes one.
			fu = listed ? (p.union !== undefined && listed.find((u) => u.id === p.union)) || listed[listed.length - 1] : implicitByPair.get(key);
			if (fu) {
				primaryUnion.set(p.id, fu.key);
				fu.children.push(p.id);
			} else {
				wardPairs.push({ child: p.id, guardians: [placed[0], placed[1]] });
			}
		} else if (placed.length === 1) {
			push(soloChildren, placed[0], p.id);
		}
		// A `union` that names no union at all was reported by validation as missing.
		if (p.union !== undefined && v.unionIds.has(p.union) && fu?.id !== p.union) {
			issues.push(codedIssue('union-not-of-parents', 'warning', { person: p.name, ref: p.union }, [p.id]));
		}

		sideLinks(p.id, byType, type, c ? placed : undefined, listedByPair, secondary);
		if (c && c.ids.length >= GROUP_MIN) drawnOrder.set(p.id, drawnOrderOf(type!, byType));
	}

	for (const fu of implicitByPair.values()) {
		unions.push(fu);
		unionByKey.set(fu.key, fu);
	}
	const unionsOf = new Map<string, string[]>();
	for (const fu of unions) for (const partner of fu.partners) push(unionsOf, partner, fu.key);

	const writtenUnions = tree.unions.map((u) => [...u.partners]);
	const dates = buildTreeDates(options.dates ?? PLAIN_READER, people, v.titles);
	return { people, byId, houses, placementParents, placementType, primaryUnion, unions, unionByKey, unionsOf, soloChildren, secondary, wardPairs, parentGroups, drawnOrder, writtenUnions, titles: v.titles, writtenTitles: tree.titles ?? [], dates, issues: [...issues, ...anchorIssues(v.titles, dates)] };
}

/** The drawn links of a child that is a case, in the order of a child that has no case: the first two of the placement kind, then every link type in the order of its first entry. */
function drawnOrderOf(type: string, byType: Map<string, string[]>): DrawnParent[] {
	const out: DrawnParent[] = [];
	for (const [t, ids] of byType) {
		for (const id of t === type ? ids.slice(2) : ids) out.push({ id, type: parentKind(t) });
	}
	const first = byType.get(type)!.slice(0, 2).map((id): DrawnParent => ({ id, type: parentKind(type) }));
	return [...first, ...out];
}

const linkKey = (q: DrawnParent): string => JSON.stringify([q.id, q.type]);

/** The links of one child in the order of `order` (the order of `drawnOrderOf`); a link that `order` lacks keeps its place at the end. */
function inOrder(list: DrawnParent[], order: DrawnParent[] | undefined): DrawnParent[] {
	if (!order || (order.length === list.length && list.every((q, i) => q.id === order[i].id && q.type === order[i].type))) return list;
	const at = new Map(order.map((q, i) => [linkKey(q), i] as const));
	return list.map((q, i) => [q, at.get(linkKey(q)) ?? order.length + i] as const).sort((a, b) => a[1] - b[1]).map(([q]) => q);
}

/** One parent link the tree draws: the parent's id and the link type (unknown types read as birth). */
export interface DrawnParent {
	id: string;
	type: ParentType;
}

/** Spec §13.21 rule 13: true for a link type that the climb of the succession never follows: ward, rumoured and begetter (D332: a begetter carries no claim). */
export const noClimb = (type: string): boolean => type === 'ward' || type === 'rumoured' || type === 'begetter';

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
	for (const [child, order] of g.drawnOrder) {
		const list = out.get(child);
		if (list) out.set(child, inOrder(list, order));
	}
	return out;
}

/** The parent links the tree draws for one person, in the order of `drawnParentMap`. */
export function drawnParents(g: FamilyGraph, id: string): DrawnParent[] {
	const out: DrawnParent[] = [];
	const type = g.placementType.get(id);
	if (type) for (const q of g.placementParents.get(id) ?? []) out.push({ id: q, type: parentKind(type) });
	for (const e of g.secondary) if (e.child === id) for (const q of e.parents) out.push({ id: q, type: parentKind(e.type) });
	return inOrder(out, g.drawnOrder.get(id));
}

/** The other partner in a union. */
export function partnerOf(fu: FamilyUnion, id: string): string {
	return fu.partners[0] === id ? fu.partners[1] : fu.partners[0];
}

/** Children placed under this person: through any of their unions, directly, as a ward of two guardians (`wardPairs`), or as a child of a group that holds this person (`parentGroups`). */
export function placedChildren(g: FamilyGraph, id: string): string[] {
	const out: string[] = [];
	for (const key of g.unionsOf.get(id) ?? []) out.push(...g.unionByKey.get(key)!.children);
	out.push(...(g.soloChildren.get(id) ?? []));
	for (const w of g.wardPairs) if (w.guardians[0] === id || w.guardians[1] === id) out.push(w.child);
	// A seated group (`withGroupSeats`) has its child in the hub's one-parent family already.
	for (const child of groupChildrenOf(g).get(id) ?? []) if (!out.includes(child)) out.push(child);
	return out;
}

const GROUPS_OF_PARENT = new WeakMap<FamilyGraph, Map<string, string[]>>();

/** The children of the groups that hold each person as a parent, memoised for each graph so a list of very many parents is read once. */
function groupChildrenOf(g: FamilyGraph): Map<string, string[]> {
	let out = GROUPS_OF_PARENT.get(g);
	if (!out) {
		out = new Map();
		for (const grp of g.parentGroups) for (const q of grp.parents) push(out, q, grp.child);
		GROUPS_OF_PARENT.set(g, out);
	}
	return out;
}
