/*
 * The families that start folded when a focus view opens (spec §5.6, §13.10, D248, D257). In a focus family a partner whose parents are cut
 * is a root, so the family of that couple stands beside the child, while the whole tree draws the couple far apart (D10, D11). On a
 * phone that spread pushes a sibling off the screen. The rule here folds such a family at the start, so its "+ N" sign takes the place of
 * the spread. It is pure (core and the far-rule numbers only, no DOM, no layout run) and sits in `view/` because it is a decision about
 * folds, not a layout stage. The facts of the whole tree cost one walk of the whole tree, so they are made lazily and once for each parse.
 */

import type { FamilyGraph } from '../core/derive';
import { foldFamilies, foldHidden, type FoldKey } from '../core/folds';
import { computeGenerations } from '../core/generations';
import { computeModelOrder } from '../core/order';
import type { Tree } from '../core/types';
import { DEFAULT_FAR_RULE } from '../layout/index';

/** What the rule needs of the whole tree: the rows, and the place of each person in the row of the whole-tree walk. */
export interface WholeFacts {
	gen: ReadonlyMap<string, number>;
	/** The number of cards before the person in his row, as the walk of the whole tree orders them (the far rule of D10 counts in cards). */
	slot: ReadonlyMap<string, number>;
}

/** One family that starts folded: its key and the number of people its "+ N" sign shows. */
export interface StartFold {
	key: FoldKey;
	count: number;
}

/** The facts of the whole tree `whole`: one walk. */
export function wholeFacts(whole: FamilyGraph): WholeFacts {
	const gen = computeGenerations(whole);
	const order = computeModelOrder(whole, gen, DEFAULT_FAR_RULE.maxGenerations);
	const seen = new Map<number, number>();
	const slot = new Map<string, number>();
	for (const it of order.items) {
		if (it.kind !== 'person') continue;
		const row = gen.get(it.id) ?? 0;
		slot.set(it.id, seen.get(row) ?? 0);
		seen.set(row, (seen.get(row) ?? 0) + 1);
	}
	return { gen, slot };
}

/** The facts by parsed tree. A parse is shared by the parse cache, so every render of the same text finds them; an evicted text works them out again. */
const factsByTree = new WeakMap<Tree, WholeFacts>();

/** `wholeFacts`, kept for the parsed `tree` (the graph is made again at each render, the tree is not). */
export function wholeFactsOf(tree: Tree, whole: FamilyGraph): WholeFacts {
	let facts = factsByTree.get(tree);
	if (!facts) {
		facts = wholeFacts(whole);
		factsByTree.set(tree, facts);
	}
	return facts;
}

/** A partner whose parents the focus graph `g` cut away (a root here) but the whole tree has. Married-in people with no parents anywhere are placed alike in both. */
function cutPartners(whole: FamilyGraph, g: FamilyGraph, parents: readonly string[]): string[] {
	return parents.filter((p) => !g.placementParents.get(p)?.length && (whole.placementParents.get(p)?.length ?? 0) > 0);
}

/**
 * The couple is far apart in the whole tree: more than `maxGenerations` rows between them, or at least `maxCardWidths` cards between their places in the walk.
 * The real rule counts card widths after the placement; the count of cards is its stand-in (the preview measured 90 % of the folds on far-couple tags and 95 % of those tags found).
 */
function farInWhole(facts: WholeFacts, [a, b]: readonly string[]): boolean {
	const rows = Math.abs((facts.gen.get(a) ?? 0) - (facts.gen.get(b) ?? 0));
	const apart = Math.abs((facts.slot.get(a) ?? 0) - (facts.slot.get(b) ?? 0));
	return rows > DEFAULT_FAR_RULE.maxGenerations || apart >= DEFAULT_FAR_RULE.maxCardWidths;
}

/**
 * The families of the focus graph `g` of `focus` that start folded. A family folds when it has two parents and neither is the focus person, exactly one parent is
 * a cut partner, the whole tree draws the couple far apart, and the fold does not hide the focus person (so the family of an ancestor never folds).
 * Two folds of one view never remove the same person: the larger fold comes first, and a fold whose people another one removes already is left out,
 * so the signs of one view add up to the people the folds remove. `getFacts` runs only when a candidate exists, so a view with no cut partner costs no walk of the
 * whole tree. The list is in the order of `foldFamilies`.
 */
export function startFolds(whole: FamilyGraph, getFacts: () => WholeFacts, g: FamilyGraph, focus: string): StartFold[] {
	const found: StartFold[] = [];
	for (const f of foldFamilies(g)) {
		if (f.parents.length !== 2 || f.parents.includes(focus) || !f.union) continue;
		if (cutPartners(whole, g, f.parents).length !== 1) continue;
		if (!farInWhole(getFacts(), f.parents)) continue;
		const hides = foldHidden(g, new Set([f.key]));
		if (!hides.has(focus)) found.push({ key: f.key, count: hides.size });
	}
	if (found.length < 2) return found;
	// The larger fold wins an overlap, so a small family inside a large one folds with the large one; the order of equal folds stays.
	const chosen = new Set<FoldKey>();
	let sum = 0;
	for (const c of [...found].sort((a, b) => b.count - a.count)) {
		const all = foldHidden(g, new Set([...chosen, c.key]));
		if (all.size !== sum + c.count || all.has(focus)) continue;
		chosen.add(c.key);
		sum += c.count;
	}
	return found.filter((c) => chosen.has(c.key));
}
