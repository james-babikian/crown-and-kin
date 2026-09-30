/*
 * Finds which cards need two or three text lines for their name (D29, D37, D81) or two for their title text line with
 * a reign (D61) instead of one truncated line. `tree-view.ts` calls `tallCardsFor` and
 * `tallTitlesFor` before layout, and passes their answers in as `settings.tallCards` and
 * `settings.tallTitles` so the layout makes exactly these cards taller; `sameTall` lets it skip a
 * re-layout when an answer has not changed.
 */

import type { FamilyGraph } from '../../core/derive';
import type { CardLabel } from '../../core/titles';
import { armsPlace, cardText } from '../../layout/geometry';
import type { Geometry } from '../../layout/model';
import { nameLines, titleLines } from '../name-lines';
import { BADGE_TEXT_CUT_EM, type Measure, type SceneFonts } from './scene';

/** D29, D81: the people whose name needs two or three text lines (`tall`) and the ones that need three (`long`, a subset of `tall`), both sorted. */
export interface TallNames {
	tall: string[];
	long: string[];
}

/**
 * D29, D37, D81: the people whose name needs two or three text lines on their card (`tall`) and those
 * that need three (`long`; a name that needs more is cut with "…" on the third), in every layout.
 * `geo` is the geometry the cards are drawn with (`drawnGeometry`); the width is the one `buildScene`
 * gives the name: the card's text width, less the D14 sign, less the badge room of a sideways `+` badge
 * (`hidden`), measured in the note font's bold name font. With `labels` (M8), the name measured is the
 * card's name text line (`CardLabel.name`, "Roderick II", D58). With `arms` (M9, the people of
 * `armsCards`), those names are measured with the width left beside the arms (D78: 1.55 em less on
 * normal cards). People in `skip` (hidden by folds) are left out. The layout then makes exactly these
 * cards taller. Both lists are sorted, so equal sets compare equal. Pure but for `measure`.
 *
 * The D14 sign comes from the lines (`illegitimateSigns`). Without `signed`, the answer is
 * `undefined` when the sign changes the number of text lines of someone (an illegitimate person whose
 * name needs fewer text lines without the sign); the caller then lays the tree out once with no tall
 * cards and asks again with that layout's signs. Most trees need no layout for this.
 */
export function tallCardsFor(
	g: FamilyGraph,
	geo: Geometry,
	sideways: boolean,
	fonts: SceneFonts,
	measure: Measure,
	hidden?: ReadonlyMap<string, number>,
	signed?: ReadonlySet<string>,
	labels?: ReadonlyMap<string, CardLabel>,
	arms?: ReadonlySet<string>,
	skip?: ReadonlySet<string>,
): TallNames | undefined {
	const t = cardText(geo);
	// The Full arms shift does not depend on the card's height or a badge.
	const armsShift = arms?.size ? armsPlace(geo, t, geo.cardH, 0).shift : 0;
	const font = `${fonts.bold} ${t.nameSize}px ${fonts.text}`;
	const cut = sideways ? BADGE_TEXT_CUT_EM * geo.fontPx : 0;
	const count = (name: string, w: number) => nameLines(name, w, (s) => measure(s, font)).length;
	const tall: string[] = [];
	const long: string[] = [];
	for (const p of g.people) {
		if (skip?.has(p.id)) continue;
		const name = labels?.get(p.id)?.name ?? p.name;
		if (!name) continue;
		const less = (hidden?.get(p.id) ? cut : 0) + (arms?.has(p.id) ? armsShift : 0);
		let n = count(name, t.textW - less);
		if (p.illegitimate) {
			const withSign = count(name, t.nameWithSignW - less);
			if (withSign !== n) {
				if (!signed) return undefined;
				if (signed.has(p.id)) n = withSign;
			}
		}
		if (n > 1) tall.push(p.id);
		if (n > 2) long.push(p.id);
	}
	return { tall: tall.sort(), long: long.sort() };
}

/** Same people, same order (both lists from `tallCardsFor`, or none). */
export const sameTall = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === b![i]);

/**
 * D61 (spec §13.3): the people whose title text line (`titleLines`) takes two text lines, sorted.
 * `geo` is the drawn geometry (`drawnGeometry`); the width is the card's text width, as `buildScene`
 * gives the title. `measure` measures in the small card font (`titleMeasure`). With `showDates`
 * off the reign is left out, so no card needs two text lines for its title. Pure but for `measure`.
 */
export function tallTitlesFor(g: FamilyGraph, labels: ReadonlyMap<string, CardLabel>, geo: Geometry, showDates: boolean, measure: (s: string) => number): string[] {
	if (!showDates) return [];
	const w = cardText(geo).textW;
	const out: string[] = [];
	for (const p of g.people) {
		const label = labels.get(p.id);
		if (label?.reign && titleLines(label.title, label.reign, w, measure).length > 1) out.push(p.id);
	}
	return out.sort();
}

/** The `measure` for `tallTitlesFor`: text width in the small card font (0.85 em, regular) that `buildScene` draws the title with. */
export function titleMeasure(geo: Geometry, fonts: SceneFonts, measure: Measure): (s: string) => number {
	const font = `400 ${cardText(geo).smallSize}px ${fonts.text}`;
	return (s) => measure(s, font);
}
