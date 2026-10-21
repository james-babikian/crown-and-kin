/*
 * Pure helpers of the tree view for folds (spec §13.10): which folds count for a
 * draw, the people they hide and the layout settings that carry them, and the cut back of a fold's tap
 * area where it meets another tap area, and the automatic folds of a focus view (D257: `setFolds`, `autoFoldPatch`; the rule that chooses them is `start-folds.ts`).
 * No DOM here, so all of it runs under vitest. `tree-view.ts` calls these at each draw and at each settle.
 */

import { foldFamilies, foldHidden, unfoldFor, type FoldKey, type FoldSet } from '../core/folds';
import type { FamilyGraph } from '../core/derive';
import type { LayoutSettings, Rect } from '../layout/model';

/** What one draw of a tree needs of the folds (F1). */
export interface FoldPlan {
	/** The folds that apply: the block's folds, less those that hide the finder's line people while a result shows. */
	effective: FoldSet;
	/** The people that the effective folds hide in the drawn graph; empty where the view cannot fold. */
	hidden: ReadonlySet<string>;
	/** The same, sorted, for the layout settings. */
	hiddenList: string[];
	/** The effective folds whose family exists in the drawn graph, sorted, for the layout settings. */
	foldedList: FoldKey[];
}

const NONE: FoldPlan = { effective: new Set(), hidden: new Set(), hiddenList: [], foldedList: [] };

/**
 * The plan for the drawn graph `g` (F1 steps 2 and 3). `canFold` false (the static phone preview) gives
 * an empty plan: that view never applies a fold. `line` is the finder's line people while a result shows.
 */
export function planFolds(g: FamilyGraph, whole: FamilyGraph, folds: FoldSet, canFold: boolean, line: readonly string[] | null): FoldPlan {
	if (!canFold || !folds.size) return NONE;
	const effective = line && line.length ? unfoldFor(g, whole, folds, line) : folds;
	const families = new Set(foldFamilies(g).map((f) => f.key));
	const foldedList = [...effective].filter((k) => families.has(k)).sort();
	const hidden = foldHidden(g, effective);
	return { effective, hidden, hiddenList: [...hidden].sort(), foldedList };
}

/** `base` with the fold settings of `plan` (F1 step 4); `canFold` adds `foldControls`. Lists that are empty stay out, so a tree with no folds has the M9 key. */
export function withFolds(base: LayoutSettings, plan: FoldPlan, canFold: boolean): LayoutSettings {
	const out: LayoutSettings = { ...base };
	delete out.foldHidden;
	delete out.foldedFamilies;
	delete out.foldControls;
	if (plan.hiddenList.length) out.foldHidden = plan.hiddenList;
	if (plan.foldedList.length) out.foldedFamilies = plan.foldedList;
	if (canFold) out.foldControls = true;
	return out;
}

/** The block memory that `setFolds` changes. */
interface FoldMemory {
	folds: Set<FoldKey>;
	autoFolds?: Set<FoldKey>;
}

/** The keys of `auto` that are still in `folds` (D257: a key that is not folded any more is the owner's open family, not an automatic fold). `auto` itself when all are. */
export function stillAuto(folds: FoldSet, auto: ReadonlySet<FoldKey> | undefined): Set<FoldKey> | undefined {
	if (!auto || [...auto].every((k) => folds.has(k))) return auto as Set<FoldKey> | undefined;
	return new Set([...auto].filter((k) => folds.has(k)));
}

/**
 * Sets the folds of a block and keeps its automatic folds (D257) to the keys that are still folded. Every change of `folds` by a tap, the edit sheet or a focus
 * on a hidden person goes through here, so an automatic fold that the owner opened is a normal fold at once, and one that the owner folds again is the owner's own.
 */
export function setFolds(st: FoldMemory, next: FoldSet): void {
	st.folds = new Set(next);
	st.autoFolds = stillAuto(st.folds, st.autoFolds);
}

/** What a draw does with the automatic folds: nothing (a view that is only temporary or cannot fold), the end of a focus view, or the start of one. */
export type AutoFocus = { kind: 'keep' } | { kind: 'clear' } | { kind: 'enter'; key: string; startKeys: () => readonly FoldKey[] };

/** The changes to the block's folds that a draw makes for its automatic folds. A field that is absent means no change. */
export interface AutoFoldPatch {
	folds?: Set<FoldKey>;
	autoFolds?: Set<FoldKey>;
	autoFor?: string | null;
}

/**
 * D257: the changes for `step`. A focus that is new (its key differs from `autoFor`) takes the automatic folds of the old focus out and puts its own `startKeys`
 * in, except the families that are folded already (the owner's own). The same focus changes nothing, so a family the owner opened stays open. The end of a focus view
 * takes its automatic folds out and keeps the owner's. `startKeys` runs only when a focus is new.
 */
export function autoFoldPatch(folds: FoldSet, auto: ReadonlySet<FoldKey> | undefined, autoFor: string | null | undefined, step: AutoFocus): AutoFoldPatch {
	if (step.kind === 'keep' || (step.kind === 'enter' && autoFor === step.key)) return {};
	const mine = stillAuto(folds, auto);
	const base = mine?.size ? new Set([...folds].filter((k) => !mine.has(k))) : folds;
	if (step.kind === 'clear') return mine?.size || auto?.size || autoFor != null ? { folds: new Set(base), autoFolds: new Set(), autoFor: null } : {};
	const added = step.startKeys().filter((k) => !base.has(k));
	return { folds: new Set([...base, ...added]), autoFolds: new Set(added), autoFor: step.key };
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * F7: the tap area `box` of a fold control, cut back where it meets a tap area of `others` (a far-couple
 * tag, a `+` badge), so that those win. The cut is on the side of the overlap, with the least loss of area,
 * and never goes inside the `visible` mark. If no such cut exists, `box` stays: the visible control wins
 * over the loss of a tap area.
 */
export function cutBack(box: Rect, visible: Rect, others: readonly Rect[]): Rect {
	let r = box;
	for (const o of others) {
		if (!overlap(r, o)) continue;
		const cuts: Rect[] = [];
		// Keep the part left of, right of, above or below `o`; each is valid only if the visible mark stays whole inside it.
		if (o.x >= visible.x + visible.w) cuts.push({ x: r.x, y: r.y, w: o.x - r.x, h: r.h });
		if (o.x + o.w <= visible.x) cuts.push({ x: o.x + o.w, y: r.y, w: r.x + r.w - (o.x + o.w), h: r.h });
		if (o.y >= visible.y + visible.h) cuts.push({ x: r.x, y: r.y, w: r.w, h: o.y - r.y });
		if (o.y + o.h <= visible.y) cuts.push({ x: r.x, y: o.y + o.h, w: r.w, h: r.y + r.h - (o.y + o.h) });
		const best = cuts.filter((c) => c.w > 0 && c.h > 0).sort((a, b) => b.w * b.h - a.w * a.h)[0];
		if (best) r = best;
	}
	return r;
}
