/*
 * The sobriquet of a person (spec §4.1, D122): the text of the person key `sobriquet`, shown after
 * the name in curly double quote marks ("Aldric II “the Wise”"). This file holds the pure helpers
 * that read the text and put it behind a name. The parser (parse.ts) calls `normaliseSobriquet`;
 * the house page and the lists call `withSobriquet`. The screen-reader label never shows it (D127).
 */

import { quote } from './quote';
import { curlyParts } from './tolerate';

/** The double marks that `curlyParts` may open with; the single pair ‘…’ is refused (it is not a sobriquet mark). */
const DOUBLE_OPEN = new Set(['“', '„']);

/** A straight pair is taken off only when the inner text holds no other double mark. */
const INNER_DOUBLE = /["“”„]/;

/**
 * The text of a sobriquet as the model holds it, or undefined when nothing is left (contract 1.1).
 * Runs of white space become one space; one pair of double marks around the whole text is taken
 * off; marks inside the text stay as typed.
 */
export function normaliseSobriquet(raw: string | undefined): string | undefined {
	if (typeof raw !== 'string') return undefined;
	let t = raw.replace(/\s+/g, ' ').trim();
	const curly = curlyParts(t);
	if (curly && DOUBLE_OPEN.has(curly.open)) t = curly.inner.trim();
	else if (t.length >= 2 && t.startsWith('"') && t.endsWith('"') && !INNER_DOUBLE.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
	return t === '' ? undefined : t;
}

/** The sobriquet in curly double marks: `“the Wise”`. */
export function quotedSobriquet(s: string): string {
	return quote(s);
}

/** "Aldric II “the Wise”"; the name unchanged when there is no sobriquet. */
export function withSobriquet(name: string, sobriquet: string | undefined): string {
	return sobriquet === undefined ? name : `${name} ${quotedSobriquet(sobriquet)}`;
}
