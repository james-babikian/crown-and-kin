/*
 * The text helpers of the date reader (spec section 14 rule 4): folding of a text (case, accents, white space), the boundaries of a match, the
 * approximate prefixes, and the test for a whole number. Pure, with no import: `dates.ts`, `date-formats.ts` and `name-lists.ts` all use it.
 * No regular expression here uses a lookbehind: iOS before 16.4 cannot parse one.
 */

/** The characters that count as white space in a date text: the white space of JavaScript and the invisible direction marks U+200E, U+200F and U+061C. */
export const SPACE_CLASS = '\\s\\u200e\\u200f\\u061c';
const SPACE_RUN = /[\s\u200e\u200f\u061c]+/g;

/** Rule 4: lower case, Unicode NFC (a name typed with a combining mark must match one typed without), every run of white space is one space, trimmed. */
export function fold(s: string): string {
	if (typeof s !== 'string') return '';
	return s.toLowerCase().normalize('NFC').replace(SPACE_RUN, ' ').trim();
}

const ALNUM = /^[\p{L}\p{N}\p{M}]$/u;

/** True when the character that starts at `i` is a letter, a digit or a mark (a code point may be two code units). */
function alnumAt(t: string, i: number): boolean {
	const c = t.charCodeAt(i);
	// The common case (ASCII) needs no property test.
	if (c < 128) return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
	const cp = t.codePointAt(i);
	return cp !== undefined && ALNUM.test(String.fromCodePoint(cp));
}

/** True when the character that ends just before `e` is a letter, a digit or a mark. */
function alnumBefore(t: string, e: number): boolean {
	if (e <= 0) return false;
	const low = t.charCodeAt(e - 1);
	const isPair = low >= 0xdc00 && low <= 0xdfff && e >= 2 && t.charCodeAt(e - 2) >= 0xd800 && t.charCodeAt(e - 2) <= 0xdbff;
	return alnumAt(t, isPair ? e - 2 : e - 1);
}

/** True if no letter or digit stands just before `s`, so a match that starts there is a whole word. */
export const leftOk = (t: string, s: number) => !alnumBefore(t, s);
/** True if no letter or digit stands at `e`, so a match that ends there is a whole word. */
export const rightOk = (t: string, e: number) => e >= t.length || !alnumAt(t, e);

/** The prefixes that make a date approximate (rule 4), as `approxBefore` reads them. */
export const APPROX_PREFIXES: readonly string[] = ['c.', 'ca.', 'about', 'circa', '~'];

/**
 * Rule 4: `c.`, `ca.`, `about`, `circa` or `~` just before the match (after optional white space). The dotted prefixes count
 * only when a space or a digit follows them, so the era mark in "C.E. 200" is not "circa".
 */
export function approxBefore(t: string, s: number): boolean {
	const head = t.slice(0, s).trimEnd();
	const gap = head.length < s || (t.charCodeAt(s) >= 48 && t.charCodeAt(s) <= 57);
	return APPROX_PREFIXES.some((p) => head.endsWith(p) && (p === '~' || !alnumBefore(head, head.length - p.length)) && (gap || !p.endsWith('.')));
}

/** True for a safe whole number. */
export const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
