/*
 * The texts and the order of the legend: the label of each line style, the card sign, the two headings
 * and the row order. They have this one home so that the legend code (`legend.ts`), the line styles
 * (`styles.ts`) and the saved picture all read the same words. This file has no imports from the
 * rest of the render folder, because `styles.ts` reads it while `legend.ts` reads `styles.ts`.
 * Every string is plugin text: Simplified Technical English (ASD-STE100) and the project word list apply.
 */
import type { StrokeKind } from '../layout/model';

/** Legend labels for each line style; `STROKES[kind].label` in styles.ts reads them from here. */
export const LEGEND_LABELS: Record<StrokeKind, string> = {
	marriage: 'Marriage',
	betrothal: 'Betrothal',
	concubinage: 'Concubinage',
	affair: 'Affair',
	implicit: 'Parents with no recorded partnership',
	descent: 'Child',
	illegitimate: 'Illegitimate child',
	'birth-link': 'Birth parent of a child shown under other parents',
	adoptive: 'Adoptive parent',
	ward: 'Guardian of a ward',
	rumoured: 'Rumoured parent',
	begetter: 'Begetter: a parent by blood, not a parent in the family',
};

/** Legend label for the card sign (spec D14): illegitimacy that no dashed line shows. */
export const SIGN_LEGEND_LABEL = 'Illegitimate child (no dashed line)';

/** The legend row for a dead person with no death year: a sample of the date text and its words. */
export const LEGEND_DEAD_SAMPLE = 'b. 769 †';
/** The words of the legend row for a dead person with no death year. */
export const LEGEND_DEAD_LABEL = 'Dead: the year of death is not known';

/** The legend row for a person counted as dead whose text for the death is not clear. */
export const LEGEND_DEAD_DOUBT_SAMPLE = 'b. 769 †?';
/** The words of the legend row for a person counted as dead whose death text is not clear. */
export const LEGEND_DEAD_DOUBT_LABEL = 'Counted as dead: the Died text in the note is not clear';

/** Spec §13.6 "Legend", §13.8: the heading of the legend's houses part, on screen and in a saved picture. */
export const LEGEND_HOUSES_LABEL = 'Houses';

/** Spec §13.8, D74: the heading of the line styles part of a saved picture's legend. */
export const LEGEND_LINES_LABEL = 'Line styles';

/** D330 O-05: the heading of the first group of the legend window (the line styles and the card sign). The saved picture keeps `LEGEND_LINES_LABEL`. */
export const LEGEND_GROUP_LINES = 'Lines';

/** D330 O-05: the heading of the second group of the legend window (the two rows about death). */
export const LEGEND_GROUP_DEAD = 'Death labels';

/** Legend order: partnerships, then children, then other parents. */
export const LEGEND_ORDER: StrokeKind[] = [
	'marriage',
	'betrothal',
	'concubinage',
	'affair',
	'implicit',
	'descent',
	'illegitimate',
	'adoptive',
	'ward',
	'rumoured',
	'birth-link',
	'begetter',
];

/**
 * The line rows of a legend in order, with the card sign directly after "Illegitimate child" (D338 point 7), so the two rows about illegitimacy stand together.
 * A saved picture that draws no "Illegitimate child" row still puts the sign where that row would stand.
 */
export function legendLineOrder(kinds: readonly StrokeKind[], sign: boolean): (StrokeKind | 'sign')[] {
	if (!sign) return [...kinds];
	const after = LEGEND_ORDER.indexOf('illegitimate');
	const at = kinds.filter((k) => LEGEND_ORDER.indexOf(k) <= after).length;
	return [...kinds.slice(0, at), 'sign', ...kinds.slice(at)];
}
