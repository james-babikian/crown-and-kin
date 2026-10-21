/*
 * Dates in the user's calendars (spec section 14, the architecture notes §5.7). This file reads a date text as an
 * internal year: first with the formats of the calendars that the tree uses (cycle calendars and era calendars), then, when no
 * format fits, with the plain-year reader of `succession-keys.ts`. It also builds the dates view of one tree (`TreeDates`) and
 * holds the checks of the Calendars window (formats, refusals, "same year as", the example). It is pure: it imports only
 * `succession-keys.ts`, `hash.ts` and types of `types.ts`, so the engine, the validator and the drawing code can all use it.
 * No regular expression here uses a lookbehind: iOS before 16.4 cannot parse one.
 */

import { hash } from './hash';
import { readPlain } from './succession-keys';
import type { Person, Title } from './types';

/** One calendar of a `kin-calendar` block. Both kinds are a list of named spans with a year count (spec section 14 rule 1). */
export interface Calendar {
	/** `<note path>#<block index>#<calendar index>`; technical, never shown. */
	id: string;
	name: string;
	/** Vault path of the calendar note. */
	note: string;
	formats: string[];
	kind: { type: 'cycles'; length: number; start: number } | { type: 'eras'; eras: { name: string; start: number; length?: number }[] };
}

/** Warnings of one date (spec section 14 rules 4, 5, 8). */
export type DateWarning = 'year-zero' | 'calendar-year-zero' | 'calendar-year-past-end' | 'fits-two-calendars';

/** What the reader found in one date text. */
export interface ReadDate {
	text: string;
	/** The internal year; undefined = no year. */
	year?: number;
	approx?: true;
	source: 'plain' | 'calendar' | 'none';
	/** Calendar matches: the name of the first calendar in the order given to `compileCalendars`. */
	calendar?: string;
	/** The span in it ("Cycle 3", or the era name) and the year in that span. */
	span?: string;
	count?: number;
	/** Names of other calendars that matched at the same place; same year: the year stays; different years: no year and `fits-two-calendars`. */
	also?: string[];
	/** Plain dual date (`1700/01`); the grey line shows the year that is read (spec section 14 rule 8). */
	dual?: true;
	/** Two matches at the same place with different years: no year; a state of the grey line, not a warning. */
	samePlace?: true;
	warnings: DateWarning[];
	// Reserved, never set in 0.3.2: month?, day?, qualifier?, yearTo?
}

/** A tree-level problem of the calendar set (spec section 14 rules 3 and 7). */
export interface CalendarProblem {
	key: 'calendar-note-missing' | 'calendar-duplicate';
	calendar?: string;
	note?: string;
	other?: string;
}

/** Reads date texts for one tree. */
export interface DateReader {
	/** False until the calendar index finished its first scan. */
	readonly ready: boolean;
	read(text: string | undefined): ReadDate | undefined;
	/** 'pending' while not ready; 'plain' when ready with no calendars and no problem; otherwise a hash of the sorted calendar content and the problems. */
	readonly key: string;
	readonly problems: CalendarProblem[];
}

/** The dates view of one graph (spec section 14 rule 9). O(1) to build; every part is lazy. */
export interface TreeDates {
	readonly reader: DateReader;
	readonly ready: boolean;
	/** Any date text, saved or draft: the reader's memo. */
	read(text: string | undefined): ReadDate | undefined;
	/** The latest year over `born`, `died` and holder `from`/`to` (not the title `year`); lazy, memoised. */
	latestYear(): number | undefined;
	/** Names of the calendars with S = 1 that a date of the tree uses, where the tree also has a plain year or a date of another calendar. Lazy. */
	unanchored(): string[];
}

// ---------- Folding and boundaries ----------

/** Rule 4: lower case, Unicode NFC (a name typed with a combining mark must match one typed without), every run of white space is one space, trimmed. */
function fold(s: string): string {
	if (typeof s !== 'string') return '';
	return s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
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

const leftOk = (t: string, s: number) => !alnumBefore(t, s);
const rightOk = (t: string, e: number) => e >= t.length || !alnumAt(t, e);

/**
 * Rule 4: `c.`, `ca.`, `about`, `circa` or `~` just before the match (after optional white space). The dotted prefixes count
 * only when a space or a digit follows them, so the era mark in "C.E. 200" is not "circa".
 */
function approxBefore(t: string, s: number): boolean {
	const head = t.slice(0, s).trimEnd();
	const gap = head.length < s || (t.charCodeAt(s) >= 48 && t.charCodeAt(s) <= 57);
	for (const prefix of ['c.', 'ca.']) if (gap && head.endsWith(prefix) && !alnumBefore(head, head.length - prefix.length)) return true;
	for (const prefix of ['about', 'circa']) if (head.endsWith(prefix) && !alnumBefore(head, head.length - prefix.length)) return true;
	return head.endsWith('~');
}

// ---------- Number places ----------

const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const ONES_ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const TENS_ORD = ['twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

/** Number words and ordinal words from 1 to 99 (rule 4; "zero" and "one hundred" are not values), longest first, by first letter. */
const WORDS: ReadonlyMap<string, readonly (readonly [string, number])[]> = (() => {
	const all: [string, number][] = [];
	ONES.forEach((w, i) => all.push([w, i + 1]));
	ONES_ORD.forEach((w, i) => all.push([w, i + 1]));
	TENS.forEach((w, i) => all.push([w, 20 + 10 * i]));
	TENS_ORD.forEach((w, i) => all.push([w, 20 + 10 * i]));
	TENS.forEach((tens, ti) => {
		for (let u = 1; u <= 9; u++) {
			for (const sep of ['-', ' ']) {
				all.push([`${tens}${sep}${ONES[u - 1]}`, 20 + 10 * ti + u]);
				all.push([`${tens}${sep}${ONES_ORD[u - 1]}`, 20 + 10 * ti + u]);
			}
		}
	});
	all.sort((a, b) => b[0].length - a[0].length);
	const byChar = new Map<string, [string, number][]>();
	for (const entry of all) {
		const list = byChar.get(entry[0][0]);
		if (list) list.push(entry);
		else byChar.set(entry[0][0], [entry]);
	}
	return byChar;
})();

// A Roman numeral from 1 (I) to 3999 (MMMCMXCIX), in lower case because the text is folded.
const ROMAN = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUE: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(s: string): number {
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		const v = ROMAN_VALUE[s[i]];
		total += i + 1 < s.length && v < ROMAN_VALUE[s[i + 1]] ? -v : v;
	}
	return total;
}

const ORDINAL_SUFFIX = ['st', 'nd', 'rd', 'th'];
/** A digit run longer than this is no value (it could not be a safe whole number in a sum). */
const MAX_DIGITS = 15;

interface Candidate {
	end: number;
	value: number;
}

/** Rule 4: every way a number place can read the text from `p`: digits, digits with an ordinal suffix, words, Roman numerals; longest first. */
function numberCandidates(t: string, p: number): Candidate[] {
	const out: Candidate[] = [];
	let q = p;
	while (q < t.length && t.charCodeAt(q) >= 48 && t.charCodeAt(q) <= 57) q++;
	if (q > p && q - p <= MAX_DIGITS) {
		if (ORDINAL_SUFFIX.includes(t.slice(q, q + 2))) out.push({ end: q + 2, value: Number(t.slice(p, q)) });
		for (let e = q; e > p; e--) out.push({ end: e, value: Number(t.slice(p, e)) });
	} else if (q === p) {
		const words = WORDS.get(t[p]);
		if (words) for (const [w, v] of words) if (t.startsWith(w, p)) out.push({ end: p + w.length, value: v });
		let r = p;
		while (r < t.length && 'ivxlcdm'.includes(t[r])) r++;
		for (let e = r; e > p; e--) {
			const s = t.slice(p, e);
			if (ROMAN.test(s)) out.push({ end: e, value: romanValue(s) });
		}
		out.sort((a, b) => b.end - a.end);
	}
	return out;
}

const RANGE_JOIN = /\s*[-–—]\s*|\s+(?:to|until|through|and)\s+(?:the\s+)?/y;

/** The ways to read the second number of a range ("3rd to 5th", "3-5", "3rd and 5th") that follows a first number which ends at `p`. */
function rangeEnds(t: string, p: number): Candidate[] {
	RANGE_JOIN.lastIndex = p;
	const join = RANGE_JOIN.exec(t);
	return join ? numberCandidates(t, p + join[0].length) : [];
}

// ---------- Formats ----------

type Place = 'year' | 'cycle' | 'era';
type Segment = { lit: string } | { place: Place };

/** The segments of a folded format, or null when it breaks rule 3 (every other place name, a missing place or a place twice). */
function parseFormat(kind: 'cycles' | 'eras', format: string): Segment[] | null {
	if (typeof format !== 'string') return null;
	const f = fold(format);
	const segs: Segment[] = [];
	const seen = new Set<string>();
	let at = 0;
	for (const m of f.matchAll(/\{([^{}]*)\}/g)) {
		const lit = f.slice(at, m.index);
		if (/[{}]/.test(lit)) return null;
		if (lit !== '') segs.push({ lit });
		const name = m[1];
		if (name !== 'year' && name !== (kind === 'cycles' ? 'cycle' : 'era')) return null;
		if (seen.has(name)) return null;
		seen.add(name);
		segs.push({ place: name });
		at = m.index + m[0].length;
	}
	const rest = f.slice(at);
	if (/[{}]/.test(rest)) return null;
	if (rest !== '') segs.push({ lit: rest });
	return seen.size === 2 ? segs : null;
}

/** True when two number places touch (`{cycle}{year}`): the reader could not tell where one ends and the next starts. */
function numbersTouch(kind: 'cycles' | 'eras', segs: Segment[]): boolean {
	return kind === 'cycles' && segs.some((seg, i) => i > 0 && 'place' in seg && 'place' in segs[i - 1]);
}

/** The segments of a format that the reader may use: it obeys rule 3 and no two number places touch. */
function readableFormat(kind: 'cycles' | 'eras', format: unknown): Segment[] | null {
	const segs = parseFormat(kind, format as string);
	return segs && !numbersTouch(kind, segs) ? segs : null;
}

/** Rule 3: null when the format is valid for the kind; else the message key (the text is in the message table). */
export function checkFormat(kind: 'cycles' | 'eras', format: string): string | null {
	const segs = parseFormat(kind, format);
	if (segs && numbersTouch(kind, segs)) return 'calendar-format-touching';
	if (segs) return null;
	return kind === 'cycles' ? 'calendar-format-cycle' : 'calendar-format-era';
}

// ---------- Compiled calendars ----------

interface CompiledEra {
	name: string;
	folded: string;
	start: number;
	length?: number;
}

interface Compiled {
	order: number;
	name: string;
	kind: 'cycles' | 'eras';
	formats: Segment[][];
	cycleLength: number;
	cycleStart: number;
	/** Eras by first character, longest name first (rule 4). */
	erasByChar: Map<string, CompiledEra[]>;
	/** S = 1: "no example" reads as 1 (spec section 14 rule 1). */
	unanchored: boolean;
}

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const validLength = (n: unknown): boolean => isWhole(n) && n >= 1;

/** The compiled form of a calendar, or null for one that cannot read anything (bad numbers). Never throws. */
function compileOne(c: Calendar, order: number): Compiled | null {
	const kind = c?.kind;
	if (!kind || typeof c.name !== 'string' || !Array.isArray(c.formats)) return null;
	const formats = c.formats.flatMap((f) => {
		const segs = readableFormat(kind.type, f);
		return segs ? [segs] : [];
	});
	const out: Compiled = { order, name: c.name, kind: kind.type, formats, cycleLength: 1, cycleStart: 1, erasByChar: new Map(), unanchored: false };
	if (kind.type === 'cycles') {
		if (!validLength(kind.length) || !isWhole(kind.start)) return null;
		out.cycleLength = kind.length;
		out.cycleStart = kind.start;
		out.unanchored = kind.start === 1;
		return out;
	}
	if (kind.type !== 'eras' || !Array.isArray(kind.eras)) return null;
	const eras: CompiledEra[] = [];
	for (const e of kind.eras) {
		if (!e || typeof e.name !== 'string' || !isWhole(e.start) || (e.length !== undefined && !validLength(e.length))) continue;
		const folded = fold(e.name);
		if (folded !== '') eras.push({ name: e.name, folded, start: e.start, length: e.length });
	}
	out.unanchored = eras.length > 0 && eras[0].start === 1;
	// Stable: eras of one length stay in the written order.
	eras.sort((a, b) => b.folded.length - a.folded.length);
	for (const e of eras) {
		const list = out.erasByChar.get(e.folded[0]);
		if (list) list.push(e);
		else out.erasByChar.set(e.folded[0], [e]);
	}
	return out;
}

interface Hit {
	cal: Compiled;
	year: number;
	span: string;
	count: number;
	warnings: DateWarning[];
}

/** Tries every format of `cal` at `s`; the first parse that works wins for each format. */
function matchAt(t: string, s: number, cal: Compiled, hits: Hit[]): void {
	for (const segs of cal.formats) {
		let value = 0;
		let cycle = 0;
		let era: CompiledEra | undefined;
		const go = (i: number, p: number): boolean => {
			if (i === segs.length) return rightOk(t, p);
			const seg = segs[i];
			if ('lit' in seg) return t.startsWith(seg.lit, p) && go(i + 1, p + seg.lit.length);
			if (seg.place === 'era') {
				for (const e of cal.erasByChar.get(t[p]) ?? []) {
					if (!t.startsWith(e.folded, p)) continue;
					era = e;
					if (go(i + 1, p + e.folded.length)) return true;
				}
				return false;
			}
			for (const c of numberCandidates(t, p)) {
				if (seg.place === 'year') value = c.value;
				else cycle = c.value;
				if (go(i + 1, c.end)) return true;
				// A range in a year-first format reads its first date: the second number is skipped (owner, 2026-10-19).
				if (i === 0) for (const d of rangeEnds(t, c.end)) if (go(i + 1, d.end)) return true;
			}
			return false;
		};
		if (!go(0, s)) continue;
		const warnings: DateWarning[] = [];
		let year: number;
		let span: string;
		if (cal.kind === 'cycles') {
			year = cal.cycleStart + (cycle - 1) * cal.cycleLength + (value - 1);
			span = `Cycle ${cycle}`;
			if (value > cal.cycleLength) warnings.push('calendar-year-past-end');
		} else {
			year = era!.start + (value - 1);
			span = era!.name;
			if (era!.length !== undefined && value > era!.length) warnings.push('calendar-year-past-end');
		}
		if (!Number.isSafeInteger(year)) continue;
		if (value === 0) warnings.unshift('calendar-year-zero');
		hits.push({ cal, year, span, count: value, warnings });
	}
}

/** Which compiled calendar gave the year of a read date; `TreeDates.unanchored` reads it. Not a part of the public shape of `ReadDate`. */
const WINNER = new WeakMap<ReadDate, Compiled>();

/** Rule 4: the first match in text order; two matches at the same place decide as the rule says. Undefined when no format fits. */
function readCalendar(text: string, calendars: readonly Compiled[]): ReadDate | undefined {
	const t = fold(text);
	for (let s = 0; s < t.length; s++) {
		if (!leftOk(t, s)) continue;
		const hits: Hit[] = [];
		for (const cal of calendars) matchAt(t, s, cal, hits);
		if (!hits.length) continue;
		const first = hits[0];
		const others: string[] = [];
		const seen = new Set<Compiled>([first.cal]);
		for (const h of hits) {
			if (seen.has(h.cal)) continue;
			seen.add(h.cal);
			others.push(h.cal.name);
		}
		const out: ReadDate = { text, source: 'calendar', calendar: first.cal.name, warnings: [] };
		if (others.length) out.also = others;
		if (hits.every((h) => h.year === first.year)) {
			out.year = first.year;
			out.span = first.span;
			out.count = first.count;
			out.warnings = unionWarnings(hits);
			if (approxBefore(t, s)) out.approx = true;
			WINNER.set(out, first.cal);
		} else if (others.length) out.warnings = ['fits-two-calendars'];
		else out.samePlace = true;
		return out;
	}
	return undefined;
}

const WARNING_ORDER: readonly DateWarning[] = ['year-zero', 'calendar-year-zero', 'calendar-year-past-end', 'fits-two-calendars'];

/** The warnings of all hits that agree on the year, once each, in a fixed order so that the order of the calendars does not matter. */
function unionWarnings(hits: readonly Hit[]): DateWarning[] {
	const all = new Set<DateWarning>();
	for (const h of hits) for (const w of h.warnings) all.add(w);
	return WARNING_ORDER.filter((w) => all.has(w));
}

/** A read of the plain reader as a `ReadDate`. */
function plainDate(text: string): ReadDate {
	const p = readPlain(text);
	const out: ReadDate = { text, source: p.year === undefined ? 'none' : 'plain', warnings: [] };
	if (p.year !== undefined) out.year = p.year;
	if (p.approx) out.approx = true;
	if (p.dual) out.dual = true;
	if (p.zero) out.warnings = ['year-zero'];
	return out;
}

/** The memo of a compiled reader is cleared when it holds this many texts. */
export const MEMO_CAP = 5000;

/** The key of a ready reader with calendars or problems: the hash of the sorted content, so scan order and note paths do not matter. */
function keyOf(calendars: readonly Calendar[], problems: readonly CalendarProblem[]): string {
	const cals = calendars.map((c) => JSON.stringify([c?.name, c?.formats, c?.kind]) ?? '').sort();
	const probs = problems.map((p) => JSON.stringify([p.key, p.calendar ?? '', p.note ?? '', p.other ?? ''])).sort();
	return `k${hash(`${cals.join('\n')}\n--\n${probs.join('\n')}`)}`;
}

/**
 * One compiled matcher for a calendar set, with a memo per text (capped). `ready` false reads plain years only, with
 * the key 'pending'. The order of `calendars` is the order of precedence in a tie ("the first calendar").
 */
export function compileCalendars(calendars: Calendar[], ready: boolean, problems: CalendarProblem[] = []): DateReader {
	const list = Array.isArray(calendars) ? calendars : [];
	const probs = Array.isArray(problems) ? problems.filter((p) => p && typeof p === 'object') : [];
	const compiled = ready ? list.flatMap((c, i) => {
		const one = compileOne(c, i);
		return one ? [one] : [];
	}) : [];
	const key = !ready ? 'pending' : list.length === 0 && probs.length === 0 ? 'plain' : keyOf(list, probs);
	const memo = new Map<string, ReadDate>();
	return {
		ready,
		key,
		problems: probs,
		read(text) {
			if (typeof text !== 'string') return undefined;
			const hit = memo.get(text);
			if (hit) return hit;
			const r = (compiled.length ? readCalendar(text, compiled) : undefined) ?? plainDate(text);
			if (memo.size >= MEMO_CAP) memo.clear();
			memo.set(text, r);
			return r;
		},
	};
}

/** Ready, key 'plain', no problems; reads with the plain reader only and keeps no memo. */
export const PLAIN_READER: DateReader = {
	ready: true,
	key: 'plain',
	problems: [],
	read: (text) => (typeof text === 'string' ? plainDate(text) : undefined),
};

// ---------- The dates view of a tree ----------

/** The dates view of one graph. O(1) to build: nothing is read until a method asks. */
export function buildTreeDates(reader: DateReader, people: readonly Person[], titles: readonly Title[]): TreeDates {
	let latest: number | undefined;
	let latestDone = false;
	let anchor: string[] | undefined;
	return {
		reader,
		ready: reader.ready,
		read: (text) => reader.read(text),
		latestYear() {
			if (!latestDone) {
				const see = (text: string | undefined) => {
					const y = reader.read(text)?.year;
					if (y !== undefined && (latest === undefined || y > latest)) latest = y;
				};
				for (const p of people) {
					see(p.born);
					see(p.died);
				}
				for (const t of titles) {
					for (const h of t.holders) {
						see(h.from);
						see(h.to);
					}
				}
				latestDone = true;
			}
			return latest;
		},
		unanchored() {
			if (anchor) return anchor;
			const used = new Set<Compiled>();
			let plain = false;
			const see = (text: string | undefined) => {
				const r = reader.read(text);
				if (!r || r.year === undefined) return;
				if (r.source === 'plain') plain = true;
				else {
					const c = WINNER.get(r);
					if (c) used.add(c);
				}
			};
			for (const p of people) {
				see(p.born);
				see(p.died);
			}
			for (const t of titles) {
				see(t.year);
				for (const h of t.holders) {
					see(h.from);
					see(h.to);
				}
			}
			const names: string[] = [];
			for (const c of [...used].sort((a, b) => a.order - b.order)) {
				if (c.unanchored && (plain || used.size > 1) && !names.includes(c.name)) names.push(c.name);
			}
			anchor = names;
			return names;
		},
	};
}

// ---------- Text and checks for the Calendars window ----------

/** "year 130", "year −1" with U+2212 (spec section 14 rule 6). */
export function formatInternalYear(y: number): string {
	return y < 0 ? `year −${-y}` : `year ${y}`;
}

/** The message keys of the refusals of rule 3, besides the keys of `checkFormat`. */
export interface CalendarRefusal {
	calendar: string;
	key: string;
	other?: string;
}

/** The text formats of a calendar, folded; a format that is not text or is empty is left out. */
const foldedFormats = (c: Calendar): string[] => (Array.isArray(c?.formats) ? c.formats.map(fold).filter((f) => f !== '') : []);

/** The eras of an era calendar that have a name; any other shape gives none. */
function erasOf(c: Calendar): { name: string; start: number; length?: number }[] {
	const kind = c?.kind;
	if (kind?.type !== 'eras' || !Array.isArray(kind.eras)) return [];
	return kind.eras.filter((e) => e && typeof e.name === 'string');
}

const foldedEras = (c: Calendar): string[] => erasOf(c).map((e) => fold(e.name)).filter((n) => n !== '');

/** True when two calendars of the same kind use the same cycle format or the same era name (rule 3, after folding). */
function clash(a: Calendar, b: Calendar): 'calendar-format-duplicate' | 'calendar-era-duplicate' | null {
	if (a?.kind?.type === 'cycles' && b?.kind?.type === 'cycles') {
		const mine = new Set(foldedFormats(a));
		return foldedFormats(b).some((f) => mine.has(f)) ? 'calendar-format-duplicate' : null;
	}
	if (a?.kind?.type === 'eras' && b?.kind?.type === 'eras') {
		const mine = new Set(foldedEras(a));
		return foldedEras(b).some((n) => mine.has(n)) ? 'calendar-era-duplicate' : null;
	}
	return null;
}

/** The lengths and the starts that a calendar states, as written (a length that is not stated is not listed). */
function numbersOf(c: Calendar): { lengths: unknown[]; starts: unknown[] } {
	const kind = c.kind;
	if (kind.type === 'cycles') return { lengths: [kind.length], starts: [kind.start] };
	const eras = erasOf(c);
	return { lengths: eras.flatMap((e) => (e.length === undefined ? [] : [e.length])), starts: eras.map((e) => e.start) };
}

/** The refusals of one calendar by itself: a bad format, a length below 1, a start or length that is not a whole number, a name twice. */
function ownRefusals(c: Calendar): CalendarRefusal[] {
	if (c?.kind?.type !== 'cycles' && c?.kind?.type !== 'eras') return [];
	const out: CalendarRefusal[] = [];
	for (const f of Array.isArray(c.formats) ? c.formats : []) {
		const bad = checkFormat(c.kind.type, f);
		if (bad) out.push({ calendar: c.name, key: bad });
	}
	const { lengths, starts } = numbersOf(c);
	if (lengths.some((l) => !validLength(l))) out.push({ calendar: c.name, key: 'calendar-length' });
	if (starts.some((n) => !isWhole(n))) out.push({ calendar: c.name, key: 'calendar-number' });
	const eras = foldedEras(c);
	if (new Set(eras).size < eras.length) out.push({ calendar: c.name, key: 'calendar-era-duplicate' });
	return out;
}

/** Refusals inside one note (rule 3): a bad format, a length below 1, a start that is not whole, the same cycle format or era name twice. [] when valid. */
export function checkCalendars(calendars: Calendar[]): CalendarRefusal[] {
	if (!Array.isArray(calendars)) return [];
	const out: CalendarRefusal[] = [];
	calendars.forEach((c, i) => {
		if (!c) return;
		out.push(...ownRefusals(c));
		for (let j = 0; j < i; j++) {
			const key = calendars[j] ? clash(calendars[j], c) : null;
			if (key) out.push({ calendar: c.name, key, other: calendars[j].name });
		}
	});
	return out;
}

/** The same cycle format or era name in another calendar note: a warning, not a refusal (spec section 14 rule 3). */
export function findCrossNoteDuplicates(calendars: Calendar[]): CalendarProblem[] {
	if (!Array.isArray(calendars)) return [];
	const out: CalendarProblem[] = [];
	calendars.forEach((c, i) => {
		if (!c) return;
		for (let j = 0; j < i; j++) {
			if (calendars[j] && calendars[j].note !== c.note && clash(calendars[j], c)) out.push({ key: 'calendar-duplicate', calendar: c.name, note: c.note, other: calendars[j].note });
		}
	});
	return out;
}

/** S from the entry form "same year as" (rule 1): cycles `other - (C-1)*L - (Y-1)`, eras `other - (Y-1)`. NaN when the input has no usable shape. */
export function startFromSameYear(example: { cycle?: number; year: number }, otherInternalYear: number, length?: number): number {
	if (!example || typeof example !== 'object') return NaN;
	if (example.cycle === undefined) return otherInternalYear - (example.year - 1);
	return otherInternalYear - (example.cycle - 1) * (length ?? 1) - (example.year - 1);
}

/** The year in its span and the span's own text (the cycle number, or the era name) for one internal year; null when no span holds it. */
function exampleParts(kind: Calendar['kind'], internalYear: number): { year: number; other: string } | null {
	if (kind.type === 'cycles') {
		const d = internalYear - kind.start;
		const cycle = Math.floor(d / kind.length) + 1;
		if (cycle < 0) return null;
		return { year: d - (cycle - 1) * kind.length + 1, other: String(cycle) };
	}
	const era = kind.eras.find((e) => internalYear >= e.start && (e.length === undefined || internalYear < e.start + e.length));
	return era ? { year: internalYear - era.start + 1, other: era.name } : null;
}

/** The compiled form of a calendar whose numbers are all usable (no length below 1, no start or length that is not whole), else null. */
function usable(calendar: Calendar): Compiled | null {
	const one = compileOne(calendar, 0);
	if (!one) return null;
	const { lengths, starts } = numbersOf(calendar);
	return lengths.every(validLength) && starts.every(isWhole) ? one : null;
}

/**
 * The example shown back: the internal year in the first format of this calendar that reads it back, in digits. Null when the
 * calendar or the year is not usable, or when no text of the calendar names that year (rule 1 "shows the example back").
 */
export function exampleText(calendar: Calendar, internalYear: number): string | null {
	const compiled = usable(calendar);
	if (!compiled || !Number.isSafeInteger(internalYear)) return null;
	const parts = exampleParts(calendar.kind, internalYear);
	if (!parts) return null;
	for (const format of calendar.formats) {
		if (!readableFormat(calendar.kind.type, format)) continue;
		const text = format.replace(/\{year\}/i, String(parts.year)).replace(/\{(?:cycle|era)\}/i, () => parts.other);
		if (readCalendar(text, [compiled])?.year === internalYear) return text;
	}
	return null;
}
