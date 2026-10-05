/**
 * The user's list of break places for long names (D118, spec §13.19 rule 2). The setting "Break places in long
 * names" holds one word on each text line with a hyphen at each place where the word can break ("Long-na-munda").
 * `parseBreakList` turns that text into a lookup; `render/name-lines.ts` reads it when a word does not fit on a text
 * line. Pure and in `render/` because only the drawing and the saved picture use it; `src/layout` never imports it.
 */

/** The break places of one listed word: indices over the NFC form of the word as typed (hyphen-less), and its NFC code-point length. */
export interface BreakEntry {
	places: readonly number[];
	length: number;
}

/** The parsed list. The key is the hyphen-less word in NFC and lower case (`listKey`). */
export type BreakList = ReadonlyMap<string, BreakEntry>;

/** The most entries one list keeps; later lines are ignored. */
export const BREAK_LIST_MAX_ENTRIES = 2000;

/** The key of a word in a `BreakList`: NFC, then lower case, so the match ignores case and the way an accent was typed. */
export const listKey = (word: string): string => word.normalize('NFC').toLowerCase();

const COMBINING = /\p{M}/u;

/** One text line token of the setting as an entry, or undefined when it is skipped (no hyphen, a hyphen at an end, a doubled hyphen). */
function entryOf(token: string): [string, BreakEntry] | undefined {
	if (!token.includes('-') || token.startsWith('-') || token.endsWith('-') || token.includes('--')) return undefined;
	const letters: string[] = [];
	const places: number[] = [];
	for (const ch of Array.from(token)) {
		if (ch === '-') places.push(letters.length);
		else letters.push(ch);
	}
	// A letter is never split from its combining mark: a place before a mark is dropped.
	// The places are counted in the NFC form of the word (an accent typed after a hyphen-free letter joins it there).
	const nfcLength = (k: number) => Array.from(letters.slice(0, k).join('').normalize('NFC')).length;
	const kept = places.filter((k) => !COMBINING.test(letters[k] ?? '')).map(nfcLength);
	const word = letters.join('').normalize('NFC');
	return [listKey(word), { places: kept, length: Array.from(word).length }];
}

let lastText: string | undefined;
let lastList: BreakList = new Map();

/**
 * Parses the setting text: split on new lines and on white space, each token is one entry. A token with no hyphen, a hyphen
 * at its start or end, or a doubled hyphen is skipped without a message. At most `BREAK_LIST_MAX_ENTRIES` entries; a word
 * that appears twice keeps its last entry. Memoised on the last text, so a redraw does not parse again.
 */
export function parseBreakList(text: string): BreakList {
	if (text === lastText) return lastList;
	const list = new Map<string, BreakEntry>();
	let count = 0;
	for (const token of text.split(/\s+/)) {
		if (!token) continue;
		const entry = entryOf(token);
		if (!entry) continue;
		if (!list.has(entry[0])) {
			if (count >= BREAK_LIST_MAX_ENTRIES) continue;
			count++;
		}
		list.set(entry[0], entry[1]);
	}
	lastText = text;
	lastList = list;
	return list;
}
