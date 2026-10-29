/*
 * Fold a branch (spec §13.10, D83–D85): which families can fold, who a set of folds hides, the
 * "+ N" counts, the controls, the tags for hidden partners, and the pruned graph the layout
 * arranges. A fold is a session state kept by the view, never written in the tree text; it names a
 * family by the sorted ids of its parents. Every function reads the graph it is given (the drawn
 * graph, or the whole tree's graph where the name says so) and none of them throws.
 *
 * Rules that the types do not show (D83 to D85):
 * 1. Family. A fold belongs to one family: the children whose placement parents are exactly one set of
 *    parents. Two parents: every child of that pair, whichever union (listed or implicit) it is placed
 *    under; the children of two listed unions of the same pair fold together with one control. One
 *    parent: `g.soloChildren`. A pair and one of its two people alone are three different families. A
 *    family exists only with at least one child in the graph that is asked.
 * 2. Key. The ids sorted with the default string order, as a JSON array. It never uses the position
 *    of a union, so a fold stays after an edit that moves unions.
 * 3. Who is hidden (`foldHidden`). The least set H that obeys all of these: (a) every child of a folded
 *    family is in H; (b) a person with any placement parent in H is in H; (c) a person with no
 *    placement parents (married in), who has at least one union partner in H and none outside H, is in
 *    H. Rule c does not hide a parent of a folded family when only that fold causes it; a parent that
 *    another fold hides stays hidden (a nested fold). If H would contain every person, H is empty and
 *    the caller draws the tree unfolded. A key that names no family hides nothing. H is found with a
 *    work list, so the cost follows the hidden people and their partners, not the whole tree.
 * 4. Count. `foldCount` is the size of `foldHidden(g, {key})`. Only the "+ N" sign shows a count, so
 *    `foldControls` calls it for folded families only.
 * 5. Controls. A family has one control (the open button, or when folded the "+ N" sign) exactly when
 *    all of its parents are outside H and it has at least one child in `g`. It sits on `family.union`
 *    (the last listed union of the pair that has children in `g`, else the implicit union). A family
 *    with a hidden parent has no control. Order: the smallest `Person.index` of the parents, then key.
 * 6. Tag partners (`hiddenPartners`). For each shown person, the hidden union partners in `unionsOf`
 *    order; the layout adds them to the far-couple tag.
 * 7. Pruned graph (`pruneGraph`). The graph the layout arranges: the same shape with every key kept,
 *    and no hidden person as a key or in a list. Unions with a hidden partner are dropped; union
 *    children lose hidden people; `soloChildren` entries with no shown child are removed; secondary
 *    lines are kept only when the child and all parents are shown. `Person.index` does not change,
 *    so sibling order does not. With an empty `hidden` it returns `g` itself.
 * 8. `foldsHiding` gives the folded families whose opening shows a person, also for nested folds, a
 *    cousin marriage and a married-in partner with unions in two branches.
 * 9. `unfoldFor` opens the folds that hide the given people. It first uses the graph that is drawn
 *    after the action (`drawn`), then the whole tree's graph (`whole`), so no target stays hidden. It
 *    never adds a fold. Find, Focus, a far-couple tag, the problem list, the house page, the relation
 *    finder and the sheet write use it.
 * 10. `pruneFolds` drops the keys whose family does not exist in the whole tree's graph after a parse.
 *     A family that exists but is outside the drawn graph (focus mode) is kept.
 * 11. `personFolds`: for one person, `open` = the keys of families with a control that are not folded
 *     and have the person as a parent; `folded` = the keys of the folded ones. They drive "Hide
 *     descendants" and "Show descendants" in the sheet.
 */

import { pairKey, partnerOf, placedChildren, type FamilyGraph, type FamilyUnion } from './derive';

/** The key of a family: the sorted parent ids as JSON, `["a","b"]` or `["a"]`. */
export type FoldKey = string;

/** The folds of one block for the session. */
export type FoldSet = ReadonlySet<FoldKey>;

/** One family that can fold: the children of one set of parents. */
interface FoldFamily {
	key: FoldKey;
	/** One or two parent ids; a pair in the partner order of the family's union. */
	parents: readonly string[];
	/** The placement children in sibling order (D2). */
	children: readonly string[];
	/** The union the control sits on; absent for one parent. */
	union?: string;
}

/** A fold control that shows: the open button, or when `folded` the "+ N" sign. */
export interface FoldControl {
	key: FoldKey;
	parents: readonly string[];
	union?: string;
	folded: boolean;
	/** The people this fold hides; 0 for an open button. */
	count: number;
}

/** What the edit sheet offers for one person. */
export interface PersonFolds {
	open: FoldKey[];
	folded: FoldKey[];
}

/** The key for one parent or a pair. Ids that are not distinct give the distinct ones. */
export function foldKey(parents: readonly string[]): FoldKey {
	const ids = [...new Set(Array.isArray(parents) ? (parents as readonly string[]) : [])].sort();
	return ids.length === 2 ? pairKey(ids[0], ids[1]) : JSON.stringify(ids);
}

interface Index {
	families: readonly FoldFamily[];
	byKey: ReadonlyMap<FoldKey, FoldFamily>;
	ofParent: ReadonlyMap<string, readonly FoldFamily[]>;
}

const indexes = new WeakMap<FamilyGraph, Index>();

function build(g: FamilyGraph): Index {
	const at = (id: string) => g.byId.get(id)?.index ?? Number.MAX_SAFE_INTEGER;
	const bySibling = (a: string, b: string) => at(a) - at(b);
	const pairs = new Map<string, { parents: readonly string[]; children: string[]; union: FamilyUnion }>();
	for (const u of g.unions) {
		if (!u.children.length) continue;
		const key = pairKey(u.partners[0], u.partners[1]);
		const known = pairs.get(key);
		// Unions are in list order and the implicit ones last, so a listed union that comes later wins.
		if (known) {
			known.children.push(...u.children);
			if (!u.implicit || known.union.implicit) {
				known.union = u;
				known.parents = u.partners;
			}
		} else pairs.set(key, { parents: u.partners, children: [...u.children], union: u });
	}
	const families: FoldFamily[] = [];
	for (const [key, e] of pairs) families.push({ key, parents: [...e.parents], children: e.children.sort(bySibling), union: e.union.key });
	for (const [parent, kids] of g.soloChildren) {
		if (kids.length) families.push({ key: foldKey([parent]), parents: [parent], children: [...kids].sort(bySibling) });
	}
	const smallest = (f: FoldFamily) => Math.min(...f.parents.map(at));
	families.sort((a, b) => smallest(a) - smallest(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	const byKey = new Map(families.map((f) => [f.key, f]));
	const ofParent = new Map<string, FoldFamily[]>();
	for (const f of families) for (const p of f.parents) (ofParent.get(p) ?? ofParent.set(p, []).get(p)!).push(f);
	return { families, byKey, ofParent };
}

function indexOf(g: FamilyGraph): Index {
	let known = indexes.get(g);
	if (!known) {
		known = build(g);
		indexes.set(g, known);
	}
	return known;
}

/** Every family with at least one child in `g`, in the order of the smallest `Person.index` of its parents, then by key. */
export function foldFamilies(g: FamilyGraph): readonly FoldFamily[] {
	return indexOf(g).families;
}

/**
/**
 * The least set of people that `folds` hide (rule 3) when the married-in rule skips `exempt`. A work
 * list visits each person once, so the cost follows the hidden people and their partners.
 */
function spread(g: FamilyGraph, folds: Iterable<FoldKey>, exempt: ReadonlySet<string>): Set<string> {
	const hidden = new Set<string>();
	const { byKey } = indexOf(g);
	const queue: string[] = [];
	const add = (id: string) => {
		if (hidden.has(id) || !g.byId.has(id)) return;
		hidden.add(id);
		queue.push(id);
	};
	for (const key of folds) {
		const family = byKey.get(key);
		if (family) for (const c of family.children) add(c);
	}
	while (queue.length) {
		const x = queue.pop()!;
		for (const c of placedChildren(g, x)) add(c);
		for (const k of g.unionsOf.get(x) ?? []) {
			const union = g.unionByKey.get(k);
			if (!union) continue;
			const q = partnerOf(union, x);
			if (hidden.has(q) || exempt.has(q) || (g.placementParents.get(q)?.length ?? 0) > 0) continue;
			// A candidate is tested again each time one of its partners joins.
			if ((g.unionsOf.get(q) ?? []).every((qk) => hidden.has(partnerOf(g.unionByKey.get(qk)!, q)))) add(q);
		}
	}
	return hidden;
}

/**
 * The people that `folds` hide in `g` (rule 3): the children of every folded family, anyone with a
 * hidden placement parent, and a married-in person all of whose union partners are hidden. A parent
 * of a folded family stays shown when only that fold hides it through the married-in rule (a father
 * whose partner is his own child); a parent that another fold hides stays hidden (a nested fold).
 * If the result would hide every person, nothing is hidden and the caller draws the tree unfolded.
 */
export function foldHidden(g: FamilyGraph, folds: FoldSet): Set<string> {
	if (!folds || !folds.size) return new Set();
	const { byKey } = indexOf(g);
	const none: ReadonlySet<string> = new Set();
	let hidden = spread(g, folds, none);
	const exempt = new Set<string>();
	for (const key of folds) {
		const family = byKey.get(key);
		const inside = family?.parents.filter((p) => hidden.has(p)) ?? [];
		if (!family || !inside.length) continue;
		// The fold hid its own parent only if the other folds alone do not.
		const rest = spread(g, [...folds].filter((k) => k !== key), none);
		for (const p of inside) if (!rest.has(p)) exempt.add(p);
	}
	if (exempt.size) hidden = spread(g, folds, exempt);
	// A fold that empties the tree cannot be drawn.
	if (hidden.size >= g.byId.size) hidden.clear();
	return hidden;
}
/** The number of people that the fold `key` hides alone in `g`; 0 for a key with no family. */
export function foldCount(g: FamilyGraph, key: FoldKey): number {
	return foldHidden(g, new Set([key])).size;
}

/** The controls that show for `folds` and their hidden set `hidden` (rule 5). */
export function foldControls(g: FamilyGraph, folds: FoldSet, hidden: ReadonlySet<string>): FoldControl[] {
	const out: FoldControl[] = [];
	for (const f of foldFamilies(g)) {
		if (f.parents.some((p) => hidden.has(p))) continue;
		const folded = folds.has(f.key);
		out.push({ key: f.key, parents: f.parents, ...(f.union !== undefined ? { union: f.union } : {}), folded, count: folded ? foldCount(g, f.key) : 0 });
	}
	return out;
}

/** The folded families whose opening shows `id` (rule 8); [] when `id` is shown. */
export function foldsHiding(g: FamilyGraph, folds: FoldSet, id: string): FoldKey[] {
	const hidden = foldHidden(g, folds);
	if (!hidden.has(id)) return [];
	const { byKey } = indexOf(g);
	const out = new Set<FoldKey>();
	const seen = new Set([id]);
	const stack = [id];
	const visit = (x: string) => {
		if (hidden.has(x) && !seen.has(x)) {
			seen.add(x);
			stack.push(x);
		}
	};
	while (stack.length) {
		const x = stack.pop()!;
		const parents = g.placementParents.get(x) ?? [];
		if (parents.length) {
			const key = foldKey(parents);
			if (folds.has(key) && byKey.has(key)) out.add(key);
			parents.forEach(visit);
		} else {
			for (const k of g.unionsOf.get(x) ?? []) visit(partnerOf(g.unionByKey.get(k)!, x));
		}
	}
	return [...out];
}

/** `folds` without the folds that hide any of `ids`, in the drawn graph and then in the whole graph (rule 9). */
export function unfoldFor(drawn: FamilyGraph, whole: FamilyGraph, folds: FoldSet, ids: readonly string[]): Set<FoldKey> {
	const targets = Array.isArray(ids) ? (ids as readonly string[]) : [];
	const result = new Set<FoldKey>(folds);
	for (const id of targets) for (const k of foldsHiding(drawn, folds, id)) result.delete(k);
	// A safety net: the first step should leave no target hidden, but a target that is still hidden must not stay so.
	const still = foldHidden(drawn, result);
	for (const id of targets) {
		if (!still.has(id)) continue;
		for (const k of foldsHiding(whole, result, id)) result.delete(k);
		for (const k of foldsHiding(drawn, result, id)) result.delete(k);
	}
	return result;
}

/** `folds` without the keys whose family does not exist in `whole` (rule 10); the same set when nothing ends. */
export function pruneFolds(whole: FamilyGraph, folds: FoldSet): FoldSet {
	const { byKey } = indexOf(whole);
	const gone = [...folds].filter((k) => !byKey.has(k));
	return gone.length ? new Set([...folds].filter((k) => byKey.has(k))) : folds;
}

/** The keys of "Hide descendants" (`open`) and "Show descendants" (`folded`) for the person `id` (rule 11). */
export function personFolds(g: FamilyGraph, folds: FoldSet, hidden: ReadonlySet<string>, id: string): PersonFolds {
	const out: PersonFolds = { open: [], folded: [] };
	for (const f of indexOf(g).ofParent.get(id) ?? []) {
		if (f.parents.some((p) => hidden.has(p))) continue;
		(folds.has(f.key) ? out.folded : out.open).push(f.key);
	}
	return out;
}

/** For each shown person with hidden partners, those partners in `unionsOf` order (rule 6). */
export function hiddenPartners(g: FamilyGraph, hidden: ReadonlySet<string>): Map<string, string[]> {
	const out = new Map<string, string[]>();
	if (!hidden.size) return out;
	const shown = new Set<string>();
	for (const h of hidden) {
		for (const k of g.unionsOf.get(h) ?? []) {
			const q = partnerOf(g.unionByKey.get(k)!, h);
			if (!hidden.has(q)) shown.add(q);
		}
	}
	for (const p of shown) {
		const list: string[] = [];
		for (const k of g.unionsOf.get(p) ?? []) {
			const q = partnerOf(g.unionByKey.get(k)!, p);
			if (hidden.has(q) && !list.includes(q)) list.push(q);
		}
		out.set(p, list);
	}
	return out;
}

/** The graph the layout arranges (rule 7): `g` without the hidden people; `g` itself when nothing is hidden. */
export function pruneGraph(g: FamilyGraph, hidden: ReadonlySet<string>): FamilyGraph {
	if (!hidden.size) return g;
	const shown = (id: string) => !hidden.has(id);
	const people = g.people.filter((p) => shown(p.id));
	const byId = new Map(people.map((p) => [p.id, p]));

	const unions: FamilyUnion[] = [];
	const unionByKey = new Map<string, FamilyUnion>();
	for (const u of g.unions) {
		if (!u.partners.every(shown)) continue;
		const kept = u.children.every(shown) ? u : { ...u, children: u.children.filter(shown) };
		unions.push(kept);
		unionByKey.set(kept.key, kept);
	}

	const placementParents = new Map<string, string[]>();
	for (const [id, list] of g.placementParents) if (shown(id)) placementParents.set(id, list.every(shown) ? list : list.filter(shown));
	const placementType = new Map<string, string>();
	for (const [id, t] of g.placementType) if (shown(id)) placementType.set(id, t);
	const primaryUnion = new Map<string, string>();
	for (const [id, k] of g.primaryUnion) if (shown(id) && unionByKey.has(k)) primaryUnion.set(id, k);

	const unionsOf = new Map<string, string[]>();
	for (const [id, keys] of g.unionsOf) {
		if (!shown(id)) continue;
		const kept = keys.filter((k) => unionByKey.has(k));
		if (kept.length) unionsOf.set(id, kept);
	}
	const soloChildren = new Map<string, string[]>();
	for (const [id, kids] of g.soloChildren) {
		if (!shown(id)) continue;
		const kept = kids.filter(shown);
		if (kept.length) soloChildren.set(id, kept);
	}
	const secondary = g.secondary.filter((e) => shown(e.child) && e.parents.every(shown) && (e.unionKey === undefined || unionByKey.has(e.unionKey)));

	return { ...g, people, byId, placementParents, placementType, primaryUnion, unions, unionByKey, unionsOf, soloChildren, secondary };
}
