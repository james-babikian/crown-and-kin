/*
 * Finds which cards need two text lines for their name instead of one truncated line (D29, D37).
 * `tree-view.ts` calls `tallCardsFor` before layout, and passes its answer in as `settings.tallCards`
 * so the layout makes exactly these cards taller; `sameTall` lets it skip a re-layout when the
 * answer has not changed.
 */

import type { FamilyGraph } from '../../core/derive';
import { cardText } from '../../layout/geometry';
import type { Geometry } from '../../layout/model';
import { nameLines } from '../name-lines';
import { BADGE_TEXT_CUT_EM, type Measure, type SceneFonts } from './scene';

/**
 * D29, D37: the people whose name needs two text lines on their card,
 * in every layout. `geo` is the geometry the cards are drawn with (`drawnGeometry`); the width is the
 * one `buildScene` gives the name: the card's text width, less the D14 sign, less the badge room of a
 * sideways `+` badge (`hidden`), measured in the note font's bold name font. The layout then makes
 * exactly these cards taller. Sorted, so equal sets compare equal. Pure but for `measure`.
 *
 * The D14 sign comes from the lines (`illegitimateSigns`). Without `signed`, the answer is
 * `undefined` when the sign decides it for someone (an illegitimate person whose name fits on one
 * text line only without the sign); the caller then lays the tree out once with no tall cards and
 * asks again with that layout's signs. Most trees need no layout for this.
 */
export function tallCardsFor(g: FamilyGraph, geo: Geometry, sideways: boolean, fonts: SceneFonts, measure: Measure, hidden?: ReadonlyMap<string, number>, signed?: ReadonlySet<string>): string[] | undefined {
	const t = cardText(geo);
	const font = `${fonts.bold} ${t.nameSize}px ${fonts.text}`;
	const cut = sideways ? BADGE_TEXT_CUT_EM * geo.fontPx : 0;
	const two = (name: string, w: number) => nameLines(name, w, (s) => measure(s, font)).length > 1;
	const out: string[] = [];
	for (const p of g.people) {
		if (!p.name) continue;
		const less = hidden?.get(p.id) ? cut : 0;
		if (two(p.name, t.textW - less)) out.push(p.id);
		else if (p.illegitimate && two(p.name, t.nameWithSignW - less)) {
			if (!signed) return undefined;
			if (signed.has(p.id)) out.push(p.id);
		}
	}
	return out.sort();
}

/** Same people, same order (both lists from `tallCardsFor`, or none). */
export const sameTall = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === b![i]);
