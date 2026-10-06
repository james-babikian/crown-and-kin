/*
 * The search of the Titles window and the Houses window (spec §13.16 rule 5, D134). A query is split into words;
 * a row matches when every word is inside the text of the row. Both sides go through `foldForMatch` (D100: case,
 * accents, quote look-alikes). There is no fuzzy match and no ranking, so the list keeps the order of the tree
 * text and never jumps while the owner types. This file has no `obsidian` import, so tests run it alone.
 */

import { foldForMatch } from '../core/fold';

/** The words of a query, folded with `foldForMatch`; an empty list when the query has no word. */
export function queryWords(query: string): string[] {
	return foldForMatch(query).split(/\s+/).filter(Boolean);
}

/** True when every word is inside one of the texts of a row (words may match different texts); true for no words. */
export function matchesAll(words: readonly string[], texts: readonly string[]): boolean {
	if (!words.length) return true;
	// A word is looked for in each text on its own, so a word never matches across the end of one text and the start of the next.
	const folded = texts.map(foldForMatch);
	return words.every((w) => folded.some((t) => t.includes(w)));
}
