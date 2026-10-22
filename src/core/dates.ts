/*
 * Dates in the user's calendars (spec section 14, the architecture notes §5.7). This file reads a date text as an
 * internal year: first with the formats of the calendars that the tree uses (cycle calendars and era calendars), then, when no
 * format fits, with the plain-year reader of `succession-keys.ts`. It also builds the dates view of one tree (`TreeDates`) and
 * holds the checks of the Calendars window (formats, refusals, "same year as", the example). It is pure: it imports only the
 * other files of the date reader (`date-text.ts`, `date-numbers.ts`, `date-formats.ts`, `name-lists.ts`), `succession-keys.ts`, `hash.ts` and types of
 * `types.ts`, so the engine, the validator and the drawing code can all use it.
 * Since 0.3.3 a calendar and the plain years can also have name lists (`name-lists.ts`): the name of a year (a planet, an animal) that repeats,
 * shown after a short date. A format can hold the marker of a list as an optional group (spec §14 rules 13 and 14).
 * No regular expression here uses a lookbehind: iOS before 16.4 cannot parse one.
 */

import { baseFormOf, checkFormat, groupFormat, readableFormat, withoutGroups, type Item, type Seg } from './date-formats';
import { numberCandidates, rangeEnds } from './date-numbers';
import { APPROX_PREFIXES, approxBefore, fold, isWhole, leftOk, rightOk } from './date-text';
import { hash } from './hash';
import {
	compileLists, describeName, listRefusals, markerMap, markerValid, MISMATCH, plainWholeIn, RESERVED_PLACES, type CalendarRefusal, type CompiledList, type NameList, type NameMismatch, type Written, type YearName,
} from './name-lists';
import { readPlain } from './succession-keys';
import type { Person, Title } from './types';

// The types and checks that live in the files of the date reader are also exported here, the place the other files import them from.
export { checkFormat } from './date-formats';
export { isWhole } from './date-text';
export {
	inNames, isUsableList, MAX_LIST_NAME_CHARS, MAX_LISTS, MAX_NAME_CHARS, MAX_NAMES, markerValid, nameLinesText, nameMismatches, normalizeMarker, oneLine, parseNameLines, plainWhole, yearName,
	type CalendarRefusal, type ListName, type NameList, type NameMismatch, type PlainWhole, type YearName,
} from './name-lists';

/** One calendar of a `kin-calendar` block. Both kinds are a list of named spans with a year count (spec section 14 rule 1). */
export interface Calendar {
	/** `<note path>#<block index>#<calendar index>`; technical, never shown. */
	id: string;
	name: string;
	/** Vault path of the calendar note. */
	note: string;
	formats: string[];
	kind: { type: 'cycles'; length: number; start: number } | { type: 'eras'; eras: { name: string; start: number; length?: number }[] };
	/** Name lists of this calendar, in the written order; a list that cannot be used stays in its place with no names. */
	lists?: NameList[];
}

/** Warnings of one date (spec section 14 rules 4, 5, 8; `calendar-name-mismatch` is rule 14). */
export type DateWarning = 'year-zero' | 'calendar-year-zero' | 'calendar-year-past-end' | 'fits-two-calendars' | 'calendar-name-mismatch';

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
	/** One entry for each usable list of the calendars that matched with this year, or of the plain years (spec §14 rule 13). Absent without a list. */
	names?: YearName[];
	/** The text is only the date (and an approximate prefix, and for a plain year the names): a name can follow it (spec §14 rule 14). Set with `names`. */
	whole?: true;
	warnings: DateWarning[];
	// Reserved, never set in 0.3.2: month?, day?, qualifier?, yearTo?
}

/** A tree-level problem of the calendar set (spec section 14 rules 3 and 7). */
export interface CalendarProblem {
	key: 'calendar-note-missing' | 'calendar-duplicate';
	calendar?: string;
	note?: string;
	other?: string;
	/** `calendar-duplicate` for two name lists of plain years with one name: the name of the list (`calendar` is then empty). */
	list?: string;
}

/** Reads date texts for one tree. */
export interface DateReader {
	/** False until the calendar index finished its first scan. */
	readonly ready: boolean;
	read(text: string | undefined): ReadDate | undefined;
	/** 'pending' while not ready; 'plain' when ready with no calendars and no problem; otherwise a hash of the sorted calendar content and the problems. */
	readonly key: string;
	readonly problems: CalendarProblem[];
	/** True when a calendar or the plain years have at least one usable list (spec §14 rules 14 and 15); false while not ready. */
	readonly hasLists: boolean;
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
	formats: Item[][];
	/** Per format: whether it has a marker group (a format without one needs no group walk, spec §14 rule 14). */
	grouped: boolean[];
	cycleLength: number;
	cycleStart: number;
	/** Eras by first character, longest name first (rule 4). */
	erasByChar: Map<string, CompiledEra[]>;
	/** S = 1: "no example" reads as 1 (spec section 14 rule 1). */
	unanchored: boolean;
	/** One for each written list; a marker place holds the position of its list. */
	lists: CompiledList[];
}

const validLength = (n: unknown): boolean => isWhole(n) && n >= 1;

/** The compiled form of a calendar, or null for one that cannot read anything (bad numbers). Never throws. */
function compileOne(c: Calendar, order: number): Compiled | null {
	const kind = c?.kind;
	if (!kind || typeof c.name !== 'string' || !Array.isArray(c.formats)) return null;
	const markers = markerMap(c.lists);
	const formats = c.formats.flatMap((f) => {
		const segs = readableFormat(kind.type, f, markers);
		return segs ? [groupFormat(segs).items] : [];
	});
	const grouped = formats.map((items) => items.some((item) => 'group' in item));
	const out: Compiled = { order, name: c.name, kind: kind.type, formats, grouped, cycleLength: 1, cycleStart: 1, erasByChar: new Map(), unanchored: false, lists: compileLists(c.lists) };
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
	/** Where the match ends in the folded text. */
	end: number;
	/** The second number of a year-first range was skipped (never a whole date). */
	range: boolean;
	/** The names written in the match, by position of the list. */
	written: (Written | undefined)[];
}

/** The written names of a format without a group: none, and never changed. */
const NO_WRITTEN: (Written | undefined)[] = [];

/**
 * The walk over the parts of a group that is present: literals, and a name of the list at the marker place (full or short, longest first, ending at a boundary).
 * `next` continues the match after the group. The names that stand in the match go into `written`, by position of the list.
 */
function groupWalker(t: string, cal: Compiled, written: (Written | undefined)[]): (segs: readonly Seg[], k: number, p: number, next: (q: number) => boolean) => boolean {
	const walk = (segs: readonly Seg[], k: number, p: number, next: (q: number) => boolean): boolean => {
		if (k === segs.length) return next(p);
		const seg = segs[k];
		if ('lit' in seg) return t.startsWith(seg.lit, p) && walk(segs, k + 1, p + seg.lit.length, next);
		if (!('marker' in seg)) return false;
		for (const e of cal.lists[seg.marker]?.entries ?? []) {
			if (!t.startsWith(e.folded, p) || !rightOk(t, p + e.folded.length)) continue;
			written[seg.marker] = { index: e.index, form: e.form };
			if (walk(segs, k + 1, p + e.folded.length, next)) return true;
		}
		if (seg.marker >= 0) written[seg.marker] = undefined;
		return false;
	};
	return walk;
}

/** The year, span and warnings (rule 5) of a match with the values that its places read; null when the year is no safe whole number. */
function yearOfMatch(cal: Compiled, value: number, cycle: number, era: CompiledEra | undefined): Pick<Hit, 'year' | 'span' | 'count' | 'warnings'> | null {
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
	if (!Number.isSafeInteger(year)) return null;
	if (value === 0) warnings.unshift('calendar-year-zero');
	return { year, span, count: value, warnings };
}

/** Tries every format of `cal` at `s`; the first parse that works wins for each format (a group is tried present, then absent). */
function matchAt(t: string, s: number, cal: Compiled, hits: Hit[]): void {
	for (let f = 0; f < cal.formats.length; f++) {
		const items = cal.formats[f];
		const grouped = cal.grouped[f];
		let value = 0;
		let cycle = 0;
		let era: CompiledEra | undefined;
		let endAt = 0;
		let ranged = false;
		const written: (Written | undefined)[] = grouped ? [] : NO_WRITTEN;
		// A format without a group never needs the walk, so its closure is not made (the hot path of 0.3.2 is not slower).
		const walk = grouped ? groupWalker(t, cal, written) : undefined;
		const go = (i: number, p: number): boolean => {
			if (i === items.length) {
				if (!rightOk(t, p)) return false;
				endAt = p;
				return true;
			}
			const item = items[i];
			if ('group' in item) return walk!(item.group, 0, p, (q) => go(i + 1, q)) || go(i + 1, p);
			if ('lit' in item) return t.startsWith(item.lit, p) && go(i + 1, p + item.lit.length);
			if (!('place' in item)) return false;
			if (item.place === 'era') {
				for (const e of cal.erasByChar.get(t[p]) ?? []) {
					if (!t.startsWith(e.folded, p)) continue;
					era = e;
					if (go(i + 1, p + e.folded.length)) return true;
				}
				return false;
			}
			for (const c of numberCandidates(t, p)) {
				if (item.place === 'year') value = c.value;
				else cycle = c.value;
				if (go(i + 1, c.end)) return true;
				// A range in a year-first format reads its first date: the second number is skipped (owner, 2026-10-19).
				if (p !== s) continue;
				for (const d of rangeEnds(t, c.end)) {
					ranged = true;
					if (go(i + 1, d.end)) return true;
					ranged = false;
				}
			}
			return false;
		};
		if (!go(0, s)) continue;
		const got = yearOfMatch(cal, value, cycle, era);
		if (got) hits.push({ cal, ...got, end: endAt, range: ranged, written: grouped ? written.slice() : NO_WRITTEN });
	}
}

/** Of the hits of one calendar with the same year, the one with the greatest end (the most groups present); the first on a tie. The order of the first hits stays. */
function bestHits(raw: Hit[]): Hit[] {
	if (raw.length < 2) return raw;
	const out: Hit[] = [];
	const at = new Map<string, number>();
	for (const h of raw) {
		const key = `${h.cal.order}|${h.year}`;
		const seen = at.get(key);
		if (seen === undefined) {
			at.set(key, out.length);
			out.push(h);
		} else if (h.end > out[seen].end) out[seen] = h;
	}
	return out;
}

/** Which compiled calendar gave the year of a read date; `TreeDates.unanchored` reads it. Not a part of the public shape of `ReadDate`. */
const WINNER = new WeakMap<ReadDate, Compiled>();

/**
 * The name written for a list in the hits of the calendars that matched (spec §14 rule 13): the first written name of any calendar that has a list of this
 * folded name, so no name is appended twice. A name written through the list of another calendar is found in the first list by its text; one
 * that the first list does not have is a wrong name.
 */
function writtenFor(hits: readonly Hit[], first: CompiledList): { written?: Written; foreign?: string } {
	for (const h of hits) {
		for (const cl of h.cal.lists) {
			const w = cl.usable && cl.key === first.key ? h.written[cl.pos] : undefined;
			if (!w) continue;
			if (cl === first) return { written: w };
			const text = cl.entries.find((e) => e.index === w.index && e.form === w.form)?.folded;
			const same = first.entries.find((e) => e.folded === text);
			if (same) return { written: { index: same.index, form: same.form } };
			return { written: { index: Math.min(w.index, first.list.names.length - 1), form: w.form }, foreign: cl.list.names[w.index].name };
		}
	}
	return {};
}

/** Spec §14 rule 13: the names of the lists of every calendar that matched with this year; a list of a folded name already used is skipped. */
function calendarNames(hits: readonly Hit[], year: number): { names: YearName[]; wrong: NameMismatch[] } | undefined {
	const seen = new Set<string>();
	const names: YearName[] = [];
	const wrong: NameMismatch[] = [];
	for (const h of hits) {
		for (const cl of h.cal.lists) {
			if (!cl.usable || seen.has(cl.key)) continue;
			seen.add(cl.key);
			const { written, foreign } = writtenFor(hits, cl);
			const d = describeName(cl, year, written, foreign);
			names.push(d.name);
			if (d.mismatch) wrong.push(d.mismatch);
		}
	}
	return names.length ? { names, wrong } : undefined;
}

/** Rule 4: the first match in text order; two matches at the same place decide as the rule says. Undefined when no format fits. */
function readCalendar(text: string, calendars: readonly Compiled[]): ReadDate | undefined {
	const t = fold(text);
	for (let s = 0; s < t.length; s++) {
		if (!leftOk(t, s)) continue;
		const all: Hit[] = [];
		for (const cal of calendars) matchAt(t, s, cal, all);
		if (!all.length) continue;
		const hits = bestHits(all);
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
			out.warnings = unionWarnings(all);
			if (approxBefore(t, s)) out.approx = true;
			WINNER.set(out, first.cal);
			const named = calendarNames(hits, first.year);
			if (named) {
				out.names = named.names;
				if (hits.some((h) => !h.range && h.end === t.length) && (s === 0 || (approxBefore(t, s) && APPROX_PREFIXES.includes(t.slice(0, s).trim())))) out.whole = true;
				if (named.wrong.length) {
					out.warnings = WARNING_ORDER.filter((w) => w === 'calendar-name-mismatch' || out.warnings.includes(w));
					MISMATCH.set(out, named.wrong);
				}
			}
		} else if (others.length) out.warnings = ['fits-two-calendars'];
		else out.samePlace = true;
		return out;
	}
	return undefined;
}

const WARNING_ORDER: readonly DateWarning[] = ['year-zero', 'calendar-year-zero', 'calendar-year-past-end', 'fits-two-calendars', 'calendar-name-mismatch'];

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

/** The memo of a compiled reader is cleared when it holds this many texts (spec §14 rule 15: the cut and the born dates read more texts for each render). */
export const MEMO_CAP = 20000;

/**
 * The key of a ready reader with calendars, plain-year lists or problems: the hash of the sorted content, so scan order and note paths do not
 * matter. Every field of every list is in it (spec §14 rule 15); a calendar with no list hashes as in 0.3.2.
 */
function keyOf(calendars: readonly Calendar[], problems: readonly CalendarProblem[], plainLists: readonly NameList[]): string {
	const cals = calendars.map((c) => JSON.stringify([c?.name, c?.formats, c?.kind, ...(Array.isArray(c?.lists) && c.lists.length ? [c.lists] : [])]) ?? '').sort();
	const probs = problems.map((p) => JSON.stringify([p.key, p.calendar ?? '', p.note ?? '', p.other ?? ''])).sort();
	return `k${hash(`${cals.join('\n')}\n--\n${probs.join('\n')}${plainLists.length ? `\n--\n${JSON.stringify(plainLists) ?? ''}` : ''}`)}`;
}

/** Gives a plain-year read its names (spec §14 rules 13 and 14): only a whole text has them. */
function addPlainNames(r: ReadDate, text: string, lists: readonly CompiledList[]): void {
	if (r.year === undefined) return;
	const { whole, written } = plainWholeIn(text, lists);
	if (!whole) return;
	const names: YearName[] = [];
	const wrong: NameMismatch[] = [];
	for (const cl of lists) {
		const d = describeName(cl, r.year, written.find((x) => x.list === cl.pos));
		names.push(d.name);
		if (d.mismatch) wrong.push(d.mismatch);
	}
	r.names = names;
	r.whole = true;
	if (wrong.length) {
		r.warnings = [...r.warnings, 'calendar-name-mismatch'];
		MISMATCH.set(r, wrong);
	}
}

/**
 * One compiled matcher for a calendar set, with a memo per text (capped). `ready` false reads plain years only, with
 * the key 'pending', and uses no list. The order of `calendars` is the order of precedence in a tie ("the first calendar").
 * `plainLists` are the name lists of the plain years (spec §14 rule 14).
 */
export function compileCalendars(calendars: Calendar[], ready: boolean, problems: CalendarProblem[] = [], plainLists: NameList[] = []): DateReader {
	const list = Array.isArray(calendars) ? calendars : [];
	const probs = Array.isArray(problems) ? problems.filter((p) => p && typeof p === 'object') : [];
	const plain = Array.isArray(plainLists) ? plainLists : [];
	const compiled = ready ? list.flatMap((c, i) => {
		const one = compileOne(c, i);
		return one ? [one] : [];
	}) : [];
	const plainUsable = ready ? compileLists(plain).filter((l) => l.usable) : [];
	const hasLists = compiled.some((c) => c.lists.some((l) => l.usable)) || plainUsable.length > 0;
	const key = !ready ? 'pending' : list.length === 0 && probs.length === 0 && plain.length === 0 ? 'plain' : keyOf(list, probs, plain);
	const memo = new Map<string, ReadDate>();
	return {
		ready,
		key,
		problems: probs,
		hasLists,
		read(text) {
			if (typeof text !== 'string') return undefined;
			const hit = memo.get(text);
			if (hit) return hit;
			const r = (compiled.length ? readCalendar(text, compiled) : undefined) ?? plainDate(text);
			if (plainUsable.length && r.source === 'plain') addPlainNames(r, text, plainUsable);
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
	hasLists: false,
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

/** The base forms of the formats of a calendar (spec §14 rule 14), folded; a format that is not text or is empty is left out. */
const baseForms = (c: Calendar): string[] => {
	const markers = markerMap(c?.lists);
	return (Array.isArray(c?.formats) ? c.formats : []).map((f) => baseFormOf(c.kind.type, f, markers)).filter((f) => f !== '');
};

/** The eras of an era calendar that have a name; any other shape gives none. */
function erasOf(c: Calendar): { name: string; start: number; length?: number }[] {
	const kind = c?.kind;
	if (kind?.type !== 'eras' || !Array.isArray(kind.eras)) return [];
	return kind.eras.filter((e) => e && typeof e.name === 'string');
}

const foldedEras = (c: Calendar): string[] => erasOf(c).map((e) => fold(e.name)).filter((n) => n !== '');

/** True when two calendars of the same kind use the same cycle format (compared by base form, rule 14) or the same era name (rule 3, after folding). */
function clash(a: Calendar, b: Calendar): 'calendar-format-duplicate' | 'calendar-era-duplicate' | null {
	if (a?.kind?.type === 'cycles' && b?.kind?.type === 'cycles') {
		const mine = new Set(baseForms(a));
		return baseForms(b).some((f) => mine.has(f)) ? 'calendar-format-duplicate' : null;
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

/** The marker of a format that no list has, as written (without curly brackets); the first one. */
function unknownMarkerIn(format: string, markers: ReadonlyMap<string, number>): string {
	for (const m of String(format).matchAll(/\{([^{}]*)\}/g)) {
		const name = fold(m[1]);
		if (!RESERVED_PLACES.has(name) && markerValid(name) && !markers.has(name)) return m[1].trim();
	}
	return '';
}

/** The refusals of one calendar by itself: a bad format, a length below 1, a start or length that is not a whole number, a name twice, a bad name list. */
function ownRefusals(c: Calendar): CalendarRefusal[] {
	if (c?.kind?.type !== 'cycles' && c?.kind?.type !== 'eras') return [];
	const out: CalendarRefusal[] = [];
	const markers = markerMap(c.lists);
	for (const f of Array.isArray(c.formats) ? c.formats : []) {
		const bad = checkFormat(c.kind.type, f, [...markers.keys()]);
		if (bad) out.push({ calendar: c.name, key: bad, ...(bad.startsWith('calendar-marker-') ? { detail: f } : {}), ...(bad === 'calendar-marker-unknown' ? { marker: unknownMarkerIn(f, markers) } : {}) });
	}
	const bases = baseForms(c);
	if (new Set(bases).size < bases.length) out.push({ calendar: c.name, key: 'calendar-format-duplicate' });
	const { lengths, starts } = numbersOf(c);
	if (lengths.some((l) => !validLength(l))) out.push({ calendar: c.name, key: 'calendar-length' });
	if (starts.some((n) => !isWhole(n))) out.push({ calendar: c.name, key: 'calendar-number' });
	const eras = foldedEras(c);
	if (new Set(eras).size < eras.length) out.push({ calendar: c.name, key: 'calendar-era-duplicate' });
	out.push(...listRefusals(c.name, c.lists, false));
	return out;
}

/**
 * The refusals inside one note, each with the place of its calendar in `calendars` (`at`; -1 for the plain years), so a window with two calendars of one
 * name can tell the calendars apart. A refusal about a pair belongs to the later calendar.
 */
export function checkCalendarsAt(calendars: Calendar[], plainLists: NameList[] = []): { refusal: CalendarRefusal; at: number }[] {
	const out: { refusal: CalendarRefusal; at: number }[] = [];
	if (Array.isArray(calendars)) {
		calendars.forEach((c, i) => {
			if (!c) return;
			for (const refusal of ownRefusals(c)) out.push({ refusal, at: i });
			for (let j = 0; j < i; j++) {
				const key = calendars[j] ? clash(calendars[j], c) : null;
				if (key) out.push({ refusal: { calendar: c.name, key, other: calendars[j].name }, at: i });
			}
			// The name tells the calendars apart in a date read (`calendar`) and in a sentence; an empty name has its own refusal.
			const folded = typeof c.name === 'string' ? fold(c.name) : '';
			const first = folded === '' ? -1 : calendars.findIndex((o) => o && typeof o.name === 'string' && fold(o.name) === folded);
			if (first >= 0 && first < i) out.push({ refusal: { calendar: c.name, key: 'calendar-name-twice', other: calendars[first].name }, at: i });
		});
	}
	for (const refusal of listRefusals('', plainLists, true)) out.push({ refusal, at: -1 });
	return out;
}

/** Refusals inside one note (rules 3 and 16): a bad format, a length below 1, a start that is not whole, the same cycle format (base form) or era name twice, the same calendar name twice, a bad name list. [] when valid. */
export function checkCalendars(calendars: Calendar[], plainLists: NameList[] = []): CalendarRefusal[] {
	return checkCalendarsAt(calendars, plainLists).map((x) => x.refusal);
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
 * The example shown back: the internal year in the first format of this calendar that reads it back, in digits (markers dropped, spec §14 rule 16). Null when the
 * calendar or the year is not usable, or when no text of the calendar names that year (rule 1 "shows the example back").
 */
export function exampleText(calendar: Calendar, internalYear: number): string | null {
	const compiled = usable(calendar);
	if (!compiled || !Number.isSafeInteger(internalYear)) return null;
	const parts = exampleParts(calendar.kind, internalYear);
	if (!parts) return null;
	const markers = markerMap(calendar.lists);
	for (const format of calendar.formats) {
		if (!readableFormat(calendar.kind.type, format, markers)) continue;
		// The example is the base form (spec §14 rule 16): a format with a marker is shown without it.
		const text = withoutGroups(format).replace(/\{year\}/i, String(parts.year)).replace(/\{(?:cycle|era)\}/i, () => parts.other);
		if (readCalendar(text, [compiled])?.year === internalYear) return text;
	}
	return null;
}
