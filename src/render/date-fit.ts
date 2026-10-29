/*
 * The cut of a card's date text with names (spec §14 rule 15, D273 6). A card first tries the date with the names of the years; if that does not fit,
 * the date with no names at all; only if that does not fit either is it cut with "…". The live scene and the saved picture each call these helpers with
 * their own measure, and the live scene calls them again at every refit. Pure but for `measure`.
 */
import { truncateClosed, withoutBidiControls } from './bidi-controls';
import { titleLines } from './name-lines';
import { fitRelationText } from './relation-fit';

/** The date text a card draws: `named` if it fits `maxW`, else `plain` cut by `cut` (the cut of the renderer). */
export function fitNamed(named: string, plain: string, maxW: number, measure: (s: string) => number, cut: (s: string) => string): string {
	return named !== plain && measure(named) <= maxW ? named : cut(plain);
}

/**
 * The text a live card line shows (the scene's `fitted`): a relation text tries its short forms (D268); a date text with names (`plain` given, spec §14 rule 15) keeps the
 * names only while the whole text fits; any other text is cut with "…".
 */
export function fitCardText(text: string, plain: string | undefined, maxW: number, measure: (s: string) => number, relation: boolean): string {
	if (relation) return fitRelationText(text, maxW, measure);
	return plain === undefined ? truncateClosed(text, maxW, measure) : fitNamed(text, plain, maxW, measure, (s) => truncateClosed(s, maxW, measure));
}

/** A text without its white space and its isolate controls, to tell a text that was kept whole from one that was cut or hyphenated. */
const bare = (s: string) => withoutBidiControls(s).replace(/\s/g, '');

/**
 * The reign a card's title text line uses: `named` (the reign with names) if the title and the reign still fit the one or two (`twoLines`) text lines
 * that the card has and nothing is cut, else `plain`. The decision about two text lines (`tallTitlesFor`) is made with `plain`, so a card
 * never grows because of a name.
 */
export function pickReign(title: string | undefined, named: string | undefined, plain: string | undefined, width: number, measure: (s: string) => number, twoLines: boolean): string | undefined {
	if (plain === undefined || named === undefined || named === plain) return plain;
	const lines = titleLines(title, named, width, measure);
	return lines.length <= (twoLines ? 2 : 1) && bare(lines.join('')) === bare([title, named].join('')) ? named : plain;
}
