/*
 * The eras of an era calendar as text lines (D342, spec §14 rule 16): one text box holds all eras, one era on each text line as the name, a comma and the
 * first year ("Reign of Aldric, 1100"), and for an end "to" and the last year ("Reign of Aldric, 1100 to 1139"). This file turns saved eras into text lines,
 * splits a text line into its name and its year parts, and makes the reading list under the box. It reads no year itself: the caller gives the reader (a plain
 * year, or a date in another calendar of the note, as "Same year as" reads it). It also pairs the typed text lines with the saved eras, so a Save changes only the eras
 * whose text lines changed. No DOM.
 */

import { eraEnds } from '../core/dates';
import { formatYear } from '../core/succession-keys';
import { MAX_DATE_TEXT } from './calendar-reader';

/** One era as the note holds it. */
export interface SavedEra {
	name: string;
	start: number;
	length?: number;
}

/** A plain year that the plain-year reader reads back as the same internal year: "1100", "225 BC" (spec §14 rule 8). A number the note holds as text shows as "?". */
const yearText = (n: number): string => (Number.isSafeInteger(n) ? formatYear(n) : '?');

/** The text line of a saved era (D342): "name, start", or "name, start to last" when the era has a length. */
export function eraLineText(e: SavedEra): string {
	const start = yearText(e.start);
	if (e.length === undefined) return `${e.name}, ${start}`;
	const last = Number.isSafeInteger(e.start) && Number.isSafeInteger(e.length) ? yearText(e.start + e.length - 1) : '?';
	return `${e.name}, ${start} to ${last}`;
}

/** The text of the box for the eras of a calendar: one text line for each era, in the written order. */
export const erasTextOf = (eras: readonly SavedEra[]): string => eras.map(eraLineText).join('\n');

/** A text line that is not empty, with its number in the box (1 for the first text line; empty text lines count, so the number is the one the user sees). */
export interface EraLine {
	line: number;
	text: string;
}

/** The text lines of the box that are not empty, trimmed. */
export function eraLinesOf(text: string): EraLine[] {
	return text.split(/\r?\n/).flatMap((t, i) => (t.trim() === '' ? [] : [{ line: i + 1, text: t.trim() }]));
}

/** What a text line holds: the name and the year texts, or why it holds no era. */
export type EraSplit = { ok: true; name: string; first: string; last?: string } | { ok: false; why: 'no-year' | 'last-bad' };

/** "to" with white space at each side, as the word between the first and the last year (any case). */
const TO = /\s+to\s+/gi;

/** The year parts after the comma: the first year, and the last year after "to". `reads` tells whether a text gives a year. Null when the first year does not read. */
function yearParts(rest: string, reads: (text: string) => boolean): { first: string; last?: string } | 'last-bad' | null {
	let lastBad = false;
	for (const m of rest.matchAll(TO)) {
		const first = rest.slice(0, m.index).trim();
		const last = rest.slice((m.index ?? 0) + m[0].length).trim();
		if (!first || !reads(first)) continue;
		if (reads(last)) return { first, last };
		lastBad = true;
	}
	if (lastBad) return 'last-bad';
	// "1100 to" with nothing after "to": the last year is missing, which is an error and not a year with no end.
	if (/\s+to$/i.test(rest) && reads(rest.replace(/\s+to$/i, ''))) return 'last-bad';
	return rest !== '' && reads(rest) ? { first: rest } : null;
}

/** The characters that count as the comma of a text line: the comma, the Arabic comma (U+060C) and the full-width comma (U+FF0C). */
const COMMAS: ReadonlySet<string> = new Set([',', '\u060C', '\uFF0C']);

/**
 * Splits one text line (D342): the name is everything before the last comma whose rest reads as a year part, so a name can hold commas ("Reign of Aldric, the
 * Elder, 1100"). A text line with no comma, or with no year after any comma, holds no era. The year part is a date text, and a date text is at most
 * `MAX_DATE_TEXT` characters (spec §14 rule 9): only the commas in the last `MAX_DATE_TEXT` + 1 characters are tried, so a very long text line costs
 * linear time and not one reading for each of its commas.
 */
export function splitEraLine(text: string, reads: (text: string) => boolean): EraSplit {
	const floor = Math.max(1, text.length - 1 - MAX_DATE_TEXT);
	for (let at = text.length - 1; at >= floor; at--) {
		if (!COMMAS.has(text[at])) continue;
		const name = text.slice(0, at).trim();
		if (name === '') continue;
		const parts = yearParts(text.slice(at + 1).trim(), reads);
		if (parts === 'last-bad') return { ok: false, why: 'last-bad' };
		if (parts) return { ok: true, name, ...parts };
	}
	return { ok: false, why: 'no-year' };
}

/** The name of a text line as the last comma ends it, with no year read: the key that pairs a changed text line with the saved era of the same name. */
export function roughEraName(text: string): string {
	for (let at = text.length - 1; at > 0; at--) if (COMMAS.has(text[at])) return text.slice(0, at).trim();
	return text.trim();
}

/** The most pairs of changed text lines that the pairing compares by content (saved times typed); a bigger change pairs them by place. */
const PAIR_CAP = 250_000;

/** The pairs (place in `a`, place in `b`) of a longest common subsequence of `a` and `b`, in order. Equal first and last items pair at once; the rest by a table. */
function commonPairs(a: readonly string[], b: readonly string[]): [number, number][] {
	const n = a.length;
	const m = b.length;
	let head = 0;
	while (head < n && head < m && a[head] === b[head]) head++;
	let tail = 0;
	while (tail < n - head && tail < m - head && a[n - 1 - tail] === b[m - 1 - tail]) tail++;
	const out: [number, number][] = [];
	for (let i = 0; i < head; i++) out.push([i, i]);
	const rows = n - head - tail;
	const cols = m - head - tail;
	if (rows > 0 && cols > 0 && rows * cols <= PAIR_CAP) {
		const w = cols + 1;
		const len = new Uint32Array((rows + 1) * w);
		for (let i = rows - 1; i >= 0; i--) {
			for (let j = cols - 1; j >= 0; j--) len[i * w + j] = a[head + i] === b[head + j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
		}
		for (let i = 0, j = 0; i < rows && j < cols; ) {
			if (a[head + i] === b[head + j]) out.push([head + i++, head + j++]);
			else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
			else j++;
		}
	}
	for (let k = tail; k > 0; k--) out.push([n - k, m - k]);
	return out;
}

/** Calls `gap` for each run of unpaired items between two pairs (and before the first and after the last): the ranges [from, to) in `a` and in `b`. */
function eachGap(pairs: readonly [number, number][], a: [number, number], b: [number, number], gap: (a: [number, number], b: [number, number]) => void): void {
	let i = a[0];
	let j = b[0];
	for (const [pi, pj] of [...pairs, [a[1], b[1]] as [number, number]]) {
		if (pi > i || pj > j) gap([i, pi], [j, pj]);
		i = pi + 1;
		j = pj + 1;
	}
}

/** One typed text line, paired: `saved` is the place of the saved era that it keeps or changes (null: a new era); `same` is true when its text is unchanged. */
export interface EraPair {
	saved: number | null;
	same: boolean;
}

/**
 * Pairs the typed text lines with the saved eras by content, so a Save rewrites only what changed and every other era keeps its bytes and its comments (D342;
 * an edit refuses any other difference). First the unchanged text lines pair with their eras (a longest common subsequence); between two of them, a changed text line pairs
 * with the saved era of the same name, and then the rest pair by place: a changed text line edits a saved era between the same neighbours, a text line left over is a
 * new era at its place, and a saved era left over is removed. The pairs keep the order of both lists, so the kept eras stay in the order of the text lines.
 */
export function pairEraLines(saved: readonly { text: string; name: string }[], typed: readonly { text: string; name: string }[]): EraPair[] {
	const out: EraPair[] = typed.map(() => ({ saved: null, same: false }));
	const same = commonPairs(saved.map((e) => e.text), typed.map((t) => t.text));
	for (const [i, j] of same) out[j] = { saved: i, same: true };
	eachGap(same, [0, saved.length], [0, typed.length], (sa, ta) => {
		const named = commonPairs(saved.slice(sa[0], sa[1]).map((e) => e.name), typed.slice(ta[0], ta[1]).map((t) => t.name)).map(([i, j]): [number, number] => [sa[0] + i, ta[0] + j]);
		for (const [i, j] of named) out[j].saved = i;
		eachGap(named, sa, ta, (s2, t2) => {
			for (let k = 0; s2[0] + k < s2[1] && t2[0] + k < t2[1]; k++) out[t2[0] + k].saved = s2[0] + k;
		});
	});
	return out;
}

/** One text line of the reading list: the era, its first year and its end (the written end, the year before the next era starts, or none). */
export interface EraReading {
	name: string;
	start: number;
	/** The last year; undefined: the era has no end. */
	end?: number;
}

/** The reading list under the box (D342): one entry for each era, in the order of the box. The end of an era with no length is the start of the next era minus 1 (D342). */
export function eraReadings(eras: readonly SavedEra[]): EraReading[] {
	const ends = eraEnds(eras);
	return eras.map((e, i) => ({ name: e.name, start: e.start, ...(ends[i] !== undefined ? { end: ends[i] } : {}) }));
}
