/*
 * Name lists (spec section 14 rules 13 to 16): a list gives each year a name that repeats ("Saturn", "Jupiter", ...), with an optional
 * short form, one known year and a marker that a format can hold. This file has the types, the name of an internal year (rule 13), the markers (rule 14), the
 * compiled lists that `dates.ts` matches names with (rule 14), the test for a whole plain-year text (rule 14), the text field of names (rule 16) and the refusals of the
 * Calendars window for a list (rule 16). Pure: it imports only the text helpers and the refusal sentences, so `dates.ts`, `date-formats.ts` and
 * `calendar-block.ts` can all use it.
 */

import { fold, isWhole } from './date-text';
import { REFUSAL_TEXT } from './refusal-text';

/** One name of a name list. */
export interface ListName {
	name: string;
	short?: string;
}

/** A list of names that repeats, one name for each internal year (D264, D270). */
export interface NameList {
	name: string;
	/** The place name in a format, without braces; absent for a plain-year list. */
	marker?: string;
	names: ListName[];
	/** The internal year whose name is names[index]. */
	known: { year: number; index: number };
	show: 'short' | 'full' | 'none';
}

/** The name of a date's year in one list (spec §14 rule 13). */
export interface YearName {
	list: string;
	name: string;
	short?: string;
	show: NameList['show'];
	/** The entry written in the date for this list, right or wrong (spec §14 rule 14). */
	written?: { index: number; form: 'full' | 'short' };
}

/** The most name lists of one calendar (and of the plain years), the most names in one list, and the most characters in a name or a short form. */
export const MAX_LISTS = 4;
/** The most names in one list. */
export const MAX_NAMES = 60;
/** The most characters in a name or a short form. */
export const MAX_NAME_CHARS = 40;
/** The most characters in the name of a list (the name shows in a title, a summary line and a sentence). */
export const MAX_LIST_NAME_CHARS = 60;

// ---------- Markers (spec §14 rule 14) ----------

/** The place names of a format; a marker may not be one of them. */
export const RESERVED_PLACES: ReadonlySet<string> = new Set(['year', 'cycle', 'era']);
const MARKER_SHAPE = /^\p{L}[\p{L}\p{N}\p{M}-]*$/u;

/** Spec §14 rule 14: a marker as typed in the window (with or without braces) or as written in a format, without braces and trimmed. */
export function normalizeMarker(text: unknown): string {
	const t = typeof text === 'string' ? text.trim() : '';
	return t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1).trim() : t;
}

/** Spec §14 rule 14: true for a marker (without braces) of 1 to 24 characters: letters of any script, digits and `-`, starting with a letter, and not year, cycle or era. */
export function markerValid(marker: unknown): boolean {
	if (typeof marker !== 'string') return false;
	const size = [...marker].length;
	return size >= 1 && size <= 24 && MARKER_SHAPE.test(marker) && !RESERVED_PLACES.has(fold(marker));
}

/** The folded valid markers of lists (all lists, also those that cannot be used) with the position of the list; the first list of a marker keeps it. */
export function markerMap(lists: unknown): Map<string, number> {
	const out = new Map<string, number>();
	if (!Array.isArray(lists)) return out;
	lists.forEach((l: NameList | null | undefined, i) => {
		const m = l && typeof l === 'object' ? normalizeMarker(l.marker) : '';
		if (m === '' || !markerValid(m)) return;
		const key = fold(m);
		if (!out.has(key)) out.set(key, i);
	});
	return out;
}

/** The markers of `checkFormat`: texts, folded, in the order given; a marker that breaks spec §14 rule 14 does not count. */
export function markersByName(markers: readonly string[]): Map<string, number> {
	return markerMap(markers.map((marker) => ({ marker })));
}

// ---------- The name of a year (spec §14 rule 13) ----------

/** True for an index that is the place of one of `count` names. */
export const inNames = (index: unknown, count: number): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < count;

/** Spec §14 rule 13: the list has names and a known year inside them, at most `MAX_NAMES` names, and sits among the first `MAX_LISTS` lists of its owner. Never throws. */
export function isUsableList(list: unknown, position = 0): list is NameList {
	const l = list as NameList | null | undefined;
	if (position >= MAX_LISTS || !l || typeof l !== 'object' || typeof l.name !== 'string' || l.name.trim() === '' || !Array.isArray(l.names)) return false;
	const k = l.names.length;
	if (k < 1 || k > MAX_NAMES) return false;
	if (!l.names.every((n) => n && typeof n === 'object' && typeof n.name === 'string' && (n.short === undefined || typeof n.short === 'string'))) return false;
	const known = l.known;
	return !!known && isWhole(known.year) && inNames(known.index, k);
}

const showOf = (l: NameList): NameList['show'] => (l.show === 'full' || l.show === 'none' ? l.show : 'short');

/** A value reduced to 0 up to `k` - 1; `%` alone can be negative. */
const mod = (n: number, k: number): number => ((n % k) + k) % k;

/**
 * Spec §14 rule 13: the name of an internal year. Each term is reduced first, so a year near the limit of safe whole numbers adds no
 * rounding; the names run on across cycles, eras, Cycle 0, Year 0 and negative years. The list must be usable (`isUsableList`).
 */
export function yearName(list: NameList, internalYear: number): { entry: ListName; index: number } {
	const k = list.names.length;
	const index = mod(mod(list.known.index, k) + mod(internalYear, k) - mod(list.known.year, k), k);
	return { entry: list.names[index], index };
}

// ---------- Compiled lists ----------

interface CompiledEntry {
	folded: string;
	index: number;
	form: 'full' | 'short';
}

/** A written name read in a date: the index of the entry and whether the full or the short form stood there. */
export interface Written {
	index: number;
	form: 'full' | 'short';
}

/** A list ready for matching: its usable names and short forms, folded. */
export interface CompiledList {
	/** The position of its owner in the written lists. */
	pos: number;
	list: NameList;
	/** The folded name of the list: lists of one folded name are used once (spec §14 rule 13). */
	key: string;
	/** Names and short forms, folded, longest first (spec §14 rule 14); empty for a list that cannot be used. */
	entries: CompiledEntry[];
	usable: boolean;
}

/** The compiled lists of an owner, one for each written list, so the position of a list stays its place in the written lists. */
export function compileLists(lists: unknown): CompiledList[] {
	if (!Array.isArray(lists)) return [];
	return lists.map((l: unknown, pos) => {
		const usable = isUsableList(l, pos);
		const entries: CompiledEntry[] = [];
		if (usable) {
			l.names.forEach((n, index) => {
				const full = fold(n.name);
				if (full !== '') entries.push({ folded: full, index, form: 'full' });
				const short = n.short === undefined ? '' : fold(n.short);
				// A short form equal to its own full name is the full name.
				if (short !== '' && short !== full) entries.push({ folded: short, index, form: 'short' });
			});
			// Stable: of two entries of one length the first written stays first.
			entries.sort((a, b) => b.folded.length - a.folded.length);
		}
		return { pos, list: l as NameList, key: usable ? fold(l.name) : '', entries, usable };
	});
}

/** The wrong written name of a date (spec §14 rule 14): the list, the name the year has and the name that is written, as full names. */
export interface NameMismatch {
	list: string;
	expected: string;
	written: string;
}

/** The name of a year in one list, and the mismatch when a written name is not the name of the year. `foreign` is the full name of a written name that the list does not have. */
export function describeName(cl: CompiledList, year: number, written: Written | undefined, foreign?: string): { name: YearName; mismatch?: NameMismatch } {
	const { entry, index } = yearName(cl.list, year);
	const name: YearName = {
		list: cl.list.name,
		name: entry.name,
		...(entry.short !== undefined && entry.short.trim() !== '' ? { short: entry.short } : {}),
		show: showOf(cl.list),
		...(written ? { written: { index: written.index, form: written.form } } : {}),
	};
	if (written && (foreign !== undefined || written.index !== index)) return { name, mismatch: { list: cl.list.name, expected: entry.name, written: foreign ?? cl.list.names[written.index].name } };
	return { name };
}

/** The mismatches of the dates that `compileCalendars` read; not a part of the public shape of `ReadDate`. */
export const MISMATCH = new WeakMap<object, NameMismatch[]>();

/** Spec §14 rule 14: the wrong written names of a date that has the warning `calendar-name-mismatch`; empty for any other date. */
export function nameMismatches(date: object | undefined): readonly NameMismatch[] {
	return (date && MISMATCH.get(date)) || [];
}

// ---------- Plain years with names (spec §14 rule 14) ----------

const APPROX_PREFIX = /^(?:(?:c|ca)\.(?=[\s\d])|~|(?:about|circa)(?![a-z]))\s*/;
/** A bare plain year (spec §14 rule 14): an optional minus, one to four digits of any script, and one era mark (AD or CE before or after, BC or BCE after). */
const BARE_YEAR = /^(?:(?:ad|ce)\s?[-−]?\p{Nd}{1,4}|[-−]?\p{Nd}{1,4}(?:\s?(?:ad|ce|bc|bce))?)$/u;

/** The result of `plainWhole`: whether the text is whole, and the names written at its end (the position of the list, the entry and the form). */
export interface PlainWhole {
	whole: boolean;
	written: { list: number; index: number; form: 'full' | 'short' }[];
}

/** Spec §14 rule 14 for compiled lists: the names that end the text and whether what is left is a bare plain year. */
export function plainWholeIn(text: string, lists: readonly CompiledList[]): PlainWhole {
	// The folded text has no white space at the ends, so an approximate prefix and the names are cut from clean ends.
	let t = fold(text);
	const prefix = APPROX_PREFIX.exec(t);
	if (prefix) t = t.slice(prefix[0].length);
	const written: PlainWhole['written'] = [];
	const taken = new Set<number>();
	for (;;) {
		let found: { list: number; entry: CompiledEntry } | undefined;
		for (const cl of lists) {
			if (taken.has(cl.pos)) continue;
			for (const e of cl.entries) {
				const at = t.length - e.folded.length;
				if (at <= 0 || !t.endsWith(e.folded) || !/\s/.test(t[at - 1])) continue;
				if (!found || e.folded.length > found.entry.folded.length) found = { list: cl.pos, entry: e };
				// The entries of a list are longest first, so the first fit is the longest of this list.
				break;
			}
		}
		if (!found) break;
		taken.add(found.list);
		written.push({ list: found.list, index: found.entry.index, form: found.entry.form });
		t = t.slice(0, t.length - found.entry.folded.length).trimEnd();
	}
	return BARE_YEAR.test(t) ? { whole: true, written } : { whole: false, written: [] };
}

/**
 * Spec §14 rule 14: whether a plain-year text is whole (a bare plain year, an approximate prefix, and names of the plain-year lists at the end,
 * one for each list) and the names written in it. `list` is the position of the list in `plainLists`. Never throws.
 */
export function plainWhole(text: string, plainLists: readonly NameList[]): PlainWhole {
	if (typeof text !== 'string') return { whole: false, written: [] };
	return plainWholeIn(text, compileLists(plainLists).filter((l) => l.usable));
}

// ---------- The text field of names (spec §14 rule 16) ----------

/**
 * Spec §14 rule 16: the names of a list from the text of the window, one name for each line. The short form follows the last comma of a line;
 * a line that ends with a comma has no short form (so a name can hold a comma). Empty lines are ignored. A refusal text says what is
 * wrong; `names` then holds what could be read (at most `MAX_NAMES`). Never throws.
 */
export function parseNameLines(text: string): { names: ListName[]; refusal?: string } {
	const names: ListName[] = [];
	let refusal: string | undefined;
	const lines = (typeof text === 'string' ? text : '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '');
	if (lines.length > MAX_NAMES) refusal = REFUSAL_TEXT.nameLinesTooMany;
	for (const line of lines.slice(0, MAX_NAMES)) {
		const comma = line.lastIndexOf(',');
		const name = comma < 0 ? line : line.slice(0, comma).trim();
		const short = comma < 0 ? '' : line.slice(comma + 1).trim();
		if (name === '') {
			refusal = refusal ?? REFUSAL_TEXT.nameLineEmpty;
			continue;
		}
		if ([...name].length > MAX_NAME_CHARS || [...short].length > MAX_NAME_CHARS) refusal = refusal ?? REFUSAL_TEXT.nameTooLong;
		names.push(short === '' ? { name } : { name, short });
	}
	return refusal === undefined ? { names } : { names, refusal };
}

/** A line break inside a name would split the name into two text lines in the field; the field shows a space there. */
export const oneLine = (text: string): string => text.replace(/\r\n|[\r\n]/g, ' ');

/**
 * Spec §14 rule 16: the names as the text field shows them. A name that holds a comma and has no short form gets a comma at the end, so `parseNameLines` reads it back.
 * A line break inside a name (only a hand-written note can have one) shows as a space; the window keeps the name as written until the user changes the field.
 */
export function nameLinesText(names: readonly ListName[]): string {
	return (Array.isArray(names) ? (names as readonly ListName[]) : [])
		.map((n) => {
			if (!n || typeof n.name !== 'string') return '';
			const name = oneLine(n.name);
			const short = typeof n.short === 'string' ? oneLine(n.short).trim() : '';
			if (short !== '') return `${name}, ${short}`;
			return name.includes(',') ? `${name},` : name;
		})
		.join('\n');
}

// ---------- The refusals of the Calendars window for a list (spec §14 rule 16) ----------

/** The message keys of the refusals of rule 3, besides the keys of `checkFormat`. The name-list refusals (rule 16) add the fields below. */
export interface CalendarRefusal {
	calendar: string;
	key: string;
	other?: string;
	/** A name-list refusal: the position of the list in the written lists of its owner (absent when the refusal is about all lists). */
	list?: number;
	/** The refusal is about the plain-year lists (`calendar` is then empty). */
	plain?: true;
	/** The name of the list, as written. */
	listName?: string;
	/** The text that the refusal names: a format, a marker or a name. */
	detail?: string;
	/** `calendar-marker-unknown`: the marker that no list has, as written in the format (without curly brackets). */
	marker?: string;
}

/** A fault of one list: the message key, and the text that the sentence names. */
type Fault = [key: string, detail?: string];

/** The faults of the names of a list: too many, the same name or short form twice, a comma in a short form (the text field could not read it back, spec §14 rule 16), and a name of 0 or more than 40 characters. */
function nameFaults(names: readonly ListName[]): Fault[] {
	const out: Fault[] = names.length > MAX_NAMES ? [['names-too-many']] : [];
	const seen = new Set<string>();
	let length = false;
	for (const n of names) {
		if (!n || typeof n !== 'object') continue;
		const full = typeof n.name === 'string' ? n.name.trim() : '';
		const short = typeof n.short === 'string' ? n.short.trim() : '';
		if (full === '' || [...full].length > MAX_NAME_CHARS || [...short].length > MAX_NAME_CHARS) length = true;
		if (short.includes(',')) out.push(['name-short-comma', short]);
		// A short form equal to its own full name is allowed; one equal to the name or short form of another entry is not.
		const own = [fold(full), ...(short !== '' && fold(short) !== fold(full) ? [fold(short)] : [])].filter((x) => x !== '');
		const twice = own.find((x) => seen.has(x));
		if (twice !== undefined) out.push(['name-twice', twice === fold(full) ? full : short]);
		own.forEach((x) => seen.add(x));
	}
	return length ? [...out, ['name-length']] : out;
}

/** The fault of the marker of a calendar list: not valid, or the same as the marker of an earlier list (`used` holds the folded markers so far). */
function markerFault(marker: unknown, used: Set<string>): Fault[] {
	const m = normalizeMarker(marker);
	if (!markerValid(m)) return [['marker-invalid', m]];
	if (used.has(fold(m))) return [['marker-twice', m]];
	used.add(fold(m));
	return [];
}

/** The fault of a known year: no year, or an index that is no name of the list. */
function knownFault(known: unknown, count: number): Fault[] {
	const k = known as NameList['known'] | undefined;
	if (!k || typeof k !== 'object' || !isWhole(k.year)) return [['known-no-year']];
	return inNames(k.index, count) ? [] : [['known-no-name']];
}

/** Spec §14 rule 16: the refusals of the name lists of one owner (a calendar, or the plain years when `plain`). */
export function listRefusals(calendar: string, lists: unknown, plain: boolean): CalendarRefusal[] {
	if (!Array.isArray(lists)) return [];
	const out: CalendarRefusal[] = [];
	const at = (key: string, list?: number, detail?: string): void => {
		const l = list === undefined ? undefined : (lists[list] as NameList | null | undefined);
		out.push({ calendar, key, ...(list !== undefined ? { list, listName: typeof l?.name === 'string' ? l.name : '' } : {}), ...(plain ? { plain: true as const } : {}), ...(detail !== undefined ? { detail } : {}) });
	};
	if (lists.length > MAX_LISTS) at('lists-too-many');
	const markers = new Set<string>();
	const listNames = new Set<string>();
	lists.forEach((l: NameList | null | undefined, i) => {
		if (!l || typeof l !== 'object') return;
		const names = Array.isArray(l.names) ? l.names : [];
		const faults: Fault[] = [
			...(typeof l.name !== 'string' || l.name.trim() === '' ? [['list-name-empty'] as Fault] : []),
			...(names.length === 0 ? [['list-no-names'] as Fault] : []),
			...nameFaults(names),
			...(plain ? [] : markerFault(l.marker, markers)),
			...knownFault(l.known, names.length),
		];
		for (const [key, detail] of faults) at(key, i, detail);
		// A list name may repeat across calendars, not inside one owner: the name is how the list is told apart (spec §14 rule 16).
		if (typeof l.name === 'string' && [...l.name.trim()].length > MAX_LIST_NAME_CHARS) at('list-name-length', i, l.name.trim());
		const folded = typeof l.name === 'string' ? fold(l.name) : '';
		if (folded !== '') {
			if (listNames.has(folded)) at('list-name-twice', i, l.name.trim());
			listNames.add(folded);
		}
	});
	return out;
}
