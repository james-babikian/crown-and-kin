/*
 * Pure helpers of the tree view for folds (spec §13.10): which folds count for a
 * draw, the people they hide and the layout settings that carry them, and the cut back of a fold's tap
 * area where it meets another tap area. No DOM here, so all of it runs under vitest. `tree-view.ts`
 * calls these at each draw and at each settle.
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
