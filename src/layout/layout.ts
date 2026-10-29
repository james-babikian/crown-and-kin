/**
 * Small shared rules of the layout: the default settings and the far rules, the picture sets that callers put into the
 * settings, the arms rule, the far-couple rule of D10 and D11 (the one site, `isFarCouple`) and the tag hit area of a
 * sideways card. The arranging itself is `pipeline.ts` (walk, plan, place, route); `index.ts` is the entry point.
 */
import { armsCardIds } from '../core/arms-rule';
import type { FamilyGraph } from '../core/derive';
import type { FoldInput } from './fold-spots';
import { MIN_HIT, sideTagDepth, TIE } from './geometry';
import type { FarCoupleRule, Geometry, LayoutSettings, Rect } from './model';

/** Spec D11 defaults: far when more than 3 card widths apart, or more than one generation. Read-only: every caller shares it. */
export const DEFAULT_FAR_RULE: Readonly<FarCoupleRule> = { maxCardWidths: 3, maxGenerations: 1 };
/** Default layout settings: `down` orientation, 4 sweeps (then the compaction step of `compact.ts`), the D11 far-couple rule. Read-only: copy it to change it. */
export const DEFAULT_LAYOUT_SETTINGS: Readonly<LayoutSettings> = { sweeps: 4, far: DEFAULT_FAR_RULE };
/** Never far, so a couple is never split (the relation finder's small tree, D47). Read-only. */
export const NEVER_FAR_RULE: Readonly<FarCoupleRule> = { maxCardWidths: Infinity, maxGenerations: Infinity };

/**
 * Spec §13.6, §13.7: the picture sets that every caller puts into `LayoutSettings` (the tree
 * view, the saved picture, the spike and the tests). `arms`: the houses whose `arms` is written; `personalArms`:
 * the people whose own `arms` is written; `portraits`: the people whose `portrait` is written, or none with "Show portraits on cards" off.
 * Both sorted. "Written" is enough: a missing or failing picture still keeps its room, so loading
 * never changes a layout.
 */
export function pictureSets(g: FamilyGraph, showPortraits: boolean): { arms: string[]; portraits: string[]; personalArms?: string[] } {
	const arms = [...g.houses.values()].filter((h) => !!h.arms).map((h) => h.id);
	const portraits = showPortraits ? g.people.filter((p) => !!p.portrait).map((p) => p.id) : [];
	// The key is there only when a person has personal arms, so a tree without them gives the plain shape.
	const personal = [...new Set(g.people.filter((p) => !!p.arms).map((p) => p.id))].sort();
	return { arms: [...new Set(arms)].sort(), portraits: [...new Set(portraits)].sort(), ...(personal.length ? { personalArms: personal } : {}) };
}

/** Spec §13.6: the people whose card shows arms: their house is a house of `g` and in `arms`. */
export function armsCards(g: FamilyGraph, arms: readonly string[] | undefined): Set<string> {
	const out = new Set<string>();
	if (!arms?.length) return out;
	const wanted = new Set(arms.filter((id) => g.houses.has(id)));
	for (const p of g.people) if (p.house !== undefined && wanted.has(p.house)) out.add(p.id);
	return out;
}

/** What the far rule reads of a partner: where the card stands along the row, how wide it is, and its generation (a `PersonBox` has all three). */
export interface FarProbe {
	x: number;
	w: number;
	gen: number;
}

/**
 * D10 and D11, the one site of the far rule: partners in different blocks are far when they are more than `maxCardWidths` card widths
 * apart (card centre to card centre, compared with `TIE` so that round-off never decides) or more than `maxGenerations` generations
 * apart. Partners drawn side by side always keep their bar. `cardW` is the usual card width: a tall card (D29) must not change the distance.
 */
export function isFarCouple(a: FarProbe, b: FarProbe, sameBlock: boolean, adjacent: boolean, rule: FarCoupleRule, cardW = a.w): boolean {
	if (sameBlock || adjacent) return false;
	const apart = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
	return apart - rule.maxCardWidths * cardW > TIE || Math.abs(a.gen - b.gen) > rule.maxGenerations;
}

/**
 * D303, the third class of far couple ("far by structure", next to far by distance and far by generations): a couple on two rows whose
 * lower partner stands inside a unit (cards joined by bars on both sides, for example between two husbands) is far, whatever the distance.
 * The leg of its upper partner would need a passage beside that unit, at the edge of the tree, and its last sideways run would cross every
 * trunk between the passage and the dot. It reads only facts of the skeleton, so the couple never comes back to near, and it applies only
 * when the rule can make a couple far at all: with `NEVER_FAR_RULE` (the relation finder's small tree, the saved picture of a line, the
 * small-font sideways alternative) a couple is never far. `lowerInsideUnit` is the plan's own test (`unitEnd` on both sides of the lower partner).
 */
export function isFarByStructure(a: Pick<FarProbe, 'gen'>, b: Pick<FarProbe, 'gen'>, lowerInsideUnit: boolean, rule: FarCoupleRule): boolean {
	return a.gen !== b.gen && lowerInsideUnit && (Number.isFinite(rule.maxCardWidths) || Number.isFinite(rule.maxGenerations));
}

/**
 * The people whose card shows arms: with the "Arms on cards" setting (D206) the cards of `armsCardIds`, kept to the people who
 * have arms to show (a house in `settings.arms`, or their own arms in `settings.personalArms`); without it the plain rule (every person
 * of a house with arms, plus personal arms). With folds the rule reads the whole graph, so folding a family never gives arms to a
 * person whose parent is hidden.
 */
export function armsByRule(g: FamilyGraph, settings: LayoutSettings, fold?: FoldInput): Set<string> {
	const personal = settings.personalArms ?? [];
	if (settings.armsOnCards === undefined) {
		const out = armsCards(g, settings.arms);
		for (const id of personal) out.add(id);
		return out;
	}
	const wanted = new Set((settings.arms ?? []).filter((id) => g.houses.has(id)));
	const own = new Set(personal);
	const out = new Set<string>();
	for (const id of armsCardIds(fold?.full ?? g, settings.armsOnCards)) {
		const p = g.byId.get(id);
		if (p && (own.has(id) || (p.house !== undefined && wanted.has(p.house)))) out.add(id);
	}
	return out;
}

/**
 * D24 sideways: the hit area hangs from the card's bottom edge `y` into the gap that placement
 * left for it before the next card (`limit`, that card's top), `sideTagDepth` deep. `span` is the
 * part of the edge it may use, which the layout keeps at least that wide.
 */
export function sideTagHit(span: { x: number; w: number }, y: number, limit: number, geo: Geometry): Rect {
	const w = Math.max(MIN_HIT, span.w);
	return { x: span.x - w / 2, y, w, h: Math.min(sideTagDepth(geo), limit - y) };
}
