/*
 * The graph the layout arranges when two guardians of a ward share no union (D354 1 B). The cards stand as they did when the pair was an
 * implicit union: the two guardians side by side, the ward centred under them. Each guardian then gets its own dotted ward line to the ward
 * (a side link) and nothing joins the two guardians. When the two stand far apart the ward hangs from one guardian (on different rows the lower one, D356 1 A; else the one written first) and the
 * second guardian has a ward line to it, no tag (the look of option A). `runStages` (pipeline.ts) lays out once as a pair, finds the pairs
 * that turned far, and lays out again with those hung. Layout only: nothing here leaves `src/layout`.
 */

import type { FamilyGraph } from '../core/derive';
import type { FoldControl } from '../core/folds';
import { isWardUnion, withWardUnions, wardUnionKey } from '../core/ward-unions';
import type { FoldInput } from './fold-spots';

/** The keys of the private unions of the ward pairs of `g` (as `withWardUnions` names them). */
export function wardKeysOf(g: FamilyGraph, full: FamilyGraph = g): string[] {
	const shown = (w: { guardians: readonly string[] }) => w.guardians.every((q) => g.byId.has(q));
	return [...g.wardPairs, ...full.wardPairs.filter(shown)].map((w) => wardUnionKey(w.guardians[0], w.guardians[1])).filter((k, i, all) => all.indexOf(k) === i);
}

/** Whether this graph or its whole graph has a ward pair: the cheap test that keeps every other tree on its old path. */
export const hasWardPairs = (g: FamilyGraph, fold?: FoldInput): boolean => g.wardPairs.length > 0 || (fold?.full.wardPairs.length ?? 0) > 0;

/**
 * The guardian a far ward hangs from: the one written first, but when the two stand on different rows the lower one, so the ward's line
 * is never longer than the one row it must cross (a line from the upper guardian would run behind the cards of the rows between).
 */
function hangFrom(guardians: readonly [string, string], gens: ReadonlyMap<string, number> | undefined): [string, string] {
	const [a, b] = guardians;
	return gens && (gens.get(b) ?? 0) > (gens.get(a) ?? 0) ? [b, a] : [a, b];
}

/**
 * `g` as the layout arranges it: a private union per ward pair, each ward with a ward side link to each of its two guardians; the pairs in
 * `hung` instead hang the ward from the guardian written first (a one-parent family) and link the second guardian by a side link.
 */
export function layoutGraph(g: FamilyGraph, hung: ReadonlySet<string>, full: FamilyGraph = g, gens?: ReadonlyMap<string, number>): FamilyGraph {
	// A fold that hides the wards of a pair leaves the pair shown: its union stays (empty) for the folded family.
	const bare = full === g ? [] : full.wardPairs.filter((w) => !g.byId.has(w.child) && w.guardians.every((q) => g.byId.has(q))).map((w) => ({ guardians: w.guardians, index: full.byId.get(w.child)!.index }));
	const pairs = withWardUnions(g, bare);
	if (pairs === g) return g;
	const people = new Map(g.people.map((p) => [p.id, p.index]));
	const drop = new Set<string>();
	const placementParents = new Map(pairs.placementParents);
	const primaryUnion = new Map(pairs.primaryUnion);
	const soloChildren = new Map([...pairs.soloChildren].map(([k, v]) => [k, [...v]]));
	const secondary = [...pairs.secondary];
	for (const fu of pairs.unions) {
		if (!isWardUnion(fu)) continue;
		for (const child of fu.children) {
			if (!hung.has(fu.key)) {
				secondary.push({ child, type: 'ward', parents: [fu.partners[0], fu.partners[1]] });
				continue;
			}
			const [first, second] = hangFrom([g.placementParents.get(child)![0], g.placementParents.get(child)![1]], gens);
			placementParents.set(child, [first]);
			primaryUnion.delete(child);
			const solo = [...(soloChildren.get(first) ?? []), child].sort((a, b) => people.get(a)! - people.get(b)!);
			soloChildren.set(first, solo);
			secondary.push({ child, type: 'ward', parents: [second] });
		}
		if (hung.has(fu.key)) drop.add(fu.key);
	}
	if (!drop.size) return { ...pairs, secondary };
	const unions = pairs.unions.filter((u) => !drop.has(u.key));
	const unionByKey = new Map(unions.map((u) => [u.key, u]));
	const unionsOf = new Map<string, string[]>();
	for (const [id, keys] of pairs.unionsOf) {
		const kept = keys.filter((k) => !drop.has(k));
		if (kept.length) unionsOf.set(id, kept);
	}
	return { ...pairs, unions, unionByKey, unionsOf, placementParents, primaryUnion, soloChildren, secondary };
}

/**
 * The fold facts as the layout reads them over `layoutGraph(.., hung)`. The control of a ward pair names the private union of the pair while
 * its ward is shown. A folded pair has no ward to hang from, so its control stands on the one-parent family of a guardian: the stem starts at
 * a card, never in the empty gap between the two (D354 1 B). That is the guardian written first, or the other when the first already has a
 * family and a control of its own (two controls would stand on one family); only when both have, a not-hung pair keeps the union (a stem from
 * the gap) and a hung one cannot be reached. An open control of a hung pair stays on the first guardian's family, or is dropped if that
 * family has a control already. `layout.folds` keeps the pair key either way (`runStages` restores the control).
 */
export function layoutFold(fold: FoldInput, hung: ReadonlySet<string>, gens?: ReadonlyMap<string, number>): FoldInput {
	const own = (id: string) => (fold.full.soloChildren.get(id)?.length ?? 0) > 0 || [...(fold.controls ?? []), ...(fold.folded ?? [])].some((o) => o.union === undefined && o.parents.length === 1 && o.parents[0] === id);
	const taken = new Set<string>();
	const memo = new Map<string, FoldControl | null>();
	const map = (c: FoldControl): FoldControl | null => {
		if (c.union !== undefined || c.parents.length !== 2) return c;
		const known = memo.get(c.key);
		if (known !== undefined) return known;
		const key = wardUnionKey(c.parents[0], c.parents[1]);
		const w = fold.full.wardPairs.find((x) => wardUnionKey(x.guardians[0], x.guardians[1]) === key);
		let out: FoldControl | null = c;
		if (w) {
			const isHung = hung.has(key);
			const first = isHung ? hangFrom(w.guardians, gens) : w.guardians;
			const candidates = c.folded ? [...first] : isHung ? [first[0]] : [];
			const at = candidates.find((id) => !own(id) && !taken.has(id));
			if (at !== undefined) {
				taken.add(at);
				out = { ...c, parents: [at] };
			} else out = c.folded && !isHung ? { ...c, union: key } : c.folded || isHung ? null : { ...c, union: key };
		}
		memo.set(c.key, out);
		return out;
	};
	const list = (cs: readonly FoldControl[] | undefined) => cs?.flatMap((c) => map(c) ?? []);
	const controls = list(fold.controls);
	const folded = list(fold.folded);
	return { ...fold, full: layoutGraph(fold.full, hung, undefined, gens), ...(controls ? { controls } : {}), ...(folded ? { folded } : {}) };
}
