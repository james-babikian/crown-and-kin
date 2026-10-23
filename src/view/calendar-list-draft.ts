/*
 * The name lists in the draft of the Calendars window (spec §14 rules 13 and 16), with no DOM and no Obsidian. A list in the window is text fields: the
 * name, the marker as typed (with or without braces), the names as text lines, the known year as a date text and a name, and the choice for the cards. This file turns
 * the lists as read into those fields, builds the `NameList` objects back from them, works out the known year with the draft calendar (spec §14 rule 16), and makes the edit
 * operations of `core/calendar-block.ts`. `calendar-draft.ts` calls it for each calendar and for the plain years.
 */

import type { CalendarOp, ListOwner } from '../core/calendar-block';
import { fold } from '../core/date-text';
import { PLAIN_READER, exampleText, formatInternalYear, inNames, isUsableList, nameLinesText, normalizeMarker, oneLine, parseNameLines, type Calendar, type ListName, type NameList } from '../core/dates';
import { REFUSAL_TEXT } from '../core/refusal-text';
import { compileCapped } from './calendar-reader';

/** The key of the plain years in `Checked.refusals` and in the host of a card (a draft calendar has a key of 0 or more). */
export const PLAIN_KEY = -1;

/** One name list in the draft. `at` is its place in the written lists of its owner; null for a list that the draft adds. */
export interface ListDraft {
	key: number;
	at: number | null;
	name: string;
	/** As typed, with or without curly brackets; empty for the plain years. */
	marker: string;
	/** One name on each text line (spec §14 rule 16). */
	names: string;
	/** The date text of the known year (spec §14 rule 16): the draft keeps the text, and a save reads it with the draft calendar. */
	knownDate: string;
	/** The name of the known year, as typed: a name of the list, full or short. */
	knownName: string;
	show: NameList['show'];
	/** The list as the note holds it; undefined for a list that the draft adds. */
	saved?: NameList;
	/** The text of the names when the window opened: while the field still equals it, the names stay as the note holds them (a name with a line break shows as a space). */
	namesWas?: string;
	/**
	 * The known date as the window made it from the saved year, when the text is a plain form and not a format of the calendar (`knownDateMade`): while the field still
	 * equals it, the saved year stays, whatever a reader makes of the text.
	 */
	pin?: { text: string; year: number };
	/** The fields as they were when the window opened. A list with the same fields is untouched: it stays as written, also when it cannot be used. */
	orig?: string;
}

/** The plain years in the window: the lists, the lists as saved and the block of the note that holds them. */
export interface PlainDraft {
	block: number;
	saved: readonly NameList[];
	lists: ListDraft[];
}

/** An empty set of plain-year lists (a calendar note that has none). */
export const emptyPlain = (): PlainDraft => ({ block: 0, saved: [], lists: [] });

/** What the window knows about the known year of one list: the plugin year that the date gives, the place of the name (-1: no name of the list), the number of names. */
export interface KnownInfo {
	year?: number;
	index: number;
	count: number;
	/** The full name at that place, when there is one. */
	name?: string;
}

const fieldsOf = (l: ListDraft): string => JSON.stringify([l.name, l.marker, l.names, l.knownDate, l.knownName, l.show]);

/** True when the user did not change this list since the window opened. */
export const listUntouched = (l: ListDraft): boolean => l.saved !== undefined && l.orig === fieldsOf(l);

/** The place of a name in a list by its full name or its short form, folded; -1 when none. */
export function nameIndex(names: readonly ListName[], text: string): number {
	const t = fold(text);
	if (t === '') return -1;
	return names.findIndex((n) => fold(n.name) === t || (n.short !== undefined && fold(n.short) === t));
}

/**
 * A year as a plain-year text that the plain reader reads back to the same internal year: the number, or "N BC" for year 0 and below (a plain "5 BC" is internal
 * year -4), so a negative year never turns into its positive twin. Null when no such text exists.
 */
function plainYearText(year: number): string | null {
	if (!Number.isSafeInteger(year) || !Number.isSafeInteger(1 - year)) return null;
	const text = year >= 1 ? String(year) : `${1 - year} BC`;
	return PLAIN_READER.read(text)?.year === year ? text : null;
}

/**
 * The text of a known year for its field (spec §14 rule 16) and whether it is a plain form. The year is shown as the first format of the calendar writes it, with the markers
 * dropped; a year that no format shows (and every year of the plain years) is shown as a plain year, "1273" or "1273 BC". Only when even this does not read back,
 * the text is "year N" (a plain form too, so the window keeps the saved year).
 */
export function knownDateMade(calendar: Calendar | undefined, year: number): { text: string; pinned: boolean } {
	if (!Number.isSafeInteger(year)) return { text: '', pinned: false };
	if (calendar) {
		const shown = exampleText(calendar, year);
		if (shown !== null) return { text: shown, pinned: false };
	}
	const plain = plainYearText(year);
	if (plain !== null && (!calendar || calendarYearReader(calendar)(plain) === year)) return { text: plain, pinned: calendar !== undefined };
	return { text: formatInternalYear(year), pinned: true };
}

/** The draft of the lists as read; `calendar` is the calendar that owns them (undefined for the plain years). */
export function listDraftsOf(lists: readonly NameList[] | undefined, calendar: Calendar | undefined, key: () => number): ListDraft[] {
	return (lists ?? []).map((l, i) => {
		const known = l.known;
		const hasKnown = Number.isSafeInteger(known.year) && inNames(known.index, l.names.length);
		const made = Number.isSafeInteger(known.year) ? knownDateMade(calendar, known.year) : { text: '', pinned: false };
		const d: ListDraft = {
			key: key(),
			at: i,
			name: l.name,
			marker: calendar && l.marker ? `{${l.marker}}` : '',
			names: nameLinesText(l.names),
			knownDate: made.text,
			knownName: hasKnown ? oneLine(l.names[known.index].name) : '',
			show: l.show,
			saved: l,
			...(made.pinned ? { pin: { text: made.text, year: known.year } } : {}),
		};
		d.namesWas = d.names;
		d.orig = fieldsOf(d);
		return d;
	});
}

/** A list that the draft adds: every field is empty, and the cards show the short form. */
export function newListDraft(key: () => number): ListDraft {
	return { key: key(), at: null, name: '', marker: '', names: '', knownDate: '', knownName: '', show: 'short' };
}

/** The lists of the draft with only what the formats need (the markers), so a known date can be read before the lists are built. */
export function markerLists(lists: readonly ListDraft[]): NameList[] {
	return lists.map((l) => ({ name: l.name.trim(), marker: normalizeMarker(l.marker), names: [], known: { year: 0, index: 0 }, show: l.show }));
}

/** The refusals of the text field of names that the core cannot see, because it drops the lines that it cannot read (spec §14 rule 16): too many lines, a line with no name. */
export function nameLinesRefusal(l: ListDraft): string | null {
	const r = parseNameLines(l.names).refusal;
	return r === REFUSAL_TEXT.nameLinesTooMany || r === REFUSAL_TEXT.nameLineEmpty ? r : null;
}

/**
 * The list as the draft means it, with the known year (spec §14 rule 16). The known date is read by `readYear`: for a calendar the draft calendar alone, for the plain years the
 * plain reader; so a change of Start, length or eras keeps the name on the date that the user wrote. A list that the user did not change and that cannot be used stays as
 * the note holds it. A date with no year gives a known year that is not a number (the list that the user did not change keeps its saved year), and a name that is not in the
 * list gives the place -1; the core refuses both.
 */
export function builtList(l: ListDraft, readYear: (text: string) => number | undefined, plain: boolean): { list: NameList; known: KnownInfo } {
	const kept = listUntouched(l) ? l.saved : undefined;
	// The type `boolean` stops the guard `isUsableList` from narrowing `kept` to nothing in the branch below.
	const usable: boolean = isUsableList(kept, l.at ?? 0);
	if (kept && !usable) {
		const k = kept.known;
		const index = inNames(k.index, kept.names.length) ? k.index : -1;
		return { list: kept, known: { ...(Number.isSafeInteger(k.year) ? { year: k.year } : {}), index, count: kept.names.length, ...(index >= 0 ? { name: kept.names[index].name } : {}) } };
	}
	// The names stay as the note holds them while the field is as the window showed it (a name with a line break, a name with spaces at the edges).
	const names = l.saved && l.names === l.namesWas && Array.isArray(l.saved.names) ? l.saved.names : parseNameLines(l.names).names;
	let year = l.knownDate.trim() === '' ? undefined : readYear(l.knownDate);
	// The date as the window made it from the saved year stays that year; a date that the plugin cannot read back stays as the note holds it.
	if (l.pin && l.knownDate === l.pin.text) year = l.pin.year;
	else if (year === undefined && kept && l.knownDate.trim() !== '' && Number.isSafeInteger(kept.known.year)) year = kept.known.year;
	const index = nameIndex(names, l.knownName);
	const marker = normalizeMarker(l.marker);
	const list: NameList = { name: l.name.trim(), ...(plain ? {} : { marker }), names, known: { year: year ?? Number.NaN, index }, show: l.show };
	return { list, known: { ...(year !== undefined ? { year } : {}), index, count: names.length, ...(index >= 0 ? { name: names[index].name } : {}) } };
}

/** A function that reads a date text with one calendar only (the draft calendar of a list, spec §14 rule 16). */
export const calendarYearReader = (calendar: Calendar): ((text: string) => number | undefined) => {
	const reader = compileCapped([calendar], true);
	return (text) => reader.read(text)?.year;
};

/** The plain reader as a function of a text (the known year of a plain-year list). */
export const plainYearReader = (text: string): number | undefined => PLAIN_READER.read(text)?.year;

type ListFields = Extract<CalendarOp, { kind: 'edit-list' }>['fields'];

const namesOf = (names: readonly ListName[]): string => JSON.stringify(names.map((n) => [n.name, n.short ?? null]));

/** The fields of an `edit-list` that differ from the saved list; empty when nothing changed. */
function listFields(was: NameList, now: NameList, plain: boolean, untouched: boolean): ListFields {
	const fields: ListFields = {};
	if (now.known.year !== was.known.year || now.known.index !== was.known.index) fields.known = now.known;
	// A list that the user did not change keeps its other fields as written, so the note text of an untouched list never moves; only its known year can change (spec §14 rule 16).
	if (untouched) return fields;
	if (now.name !== was.name) fields.name = now.name;
	if (!plain && (now.marker ?? '') !== (was.marker ?? '')) fields.marker = now.marker ?? null;
	if (namesOf(now.names) !== namesOf(was.names)) fields.names = now.names;
	if (now.show !== was.show) fields.show = now.show;
	return fields;
}

/**
 * The operations that turn the saved lists of one owner into the draft lists: the edits of the lists that stay (by their written places), then the removed lists from the
 * end, then the added lists, so a calendar that has four lists can swap one. `built` are the lists as `builtList` gives them, in the order of the draft.
 */
export function listOps(owner: ListOwner, saved: readonly NameList[], drafts: readonly ListDraft[], built: readonly NameList[]): { edits: CalendarOp[]; removes: CalendarOp[]; adds: CalendarOp[] } {
	const edits: CalendarOp[] = [];
	const adds: CalendarOp[] = [];
	const kept = new Set<number>();
	drafts.forEach((d, i) => {
		if (d.at === null) {
			adds.push({ kind: 'add-list', calendar: owner, list: built[i] });
			return;
		}
		kept.add(d.at);
		// A list that cannot be used and was not changed stays as written (`builtList` gives it back as it is).
		if (built[i] === saved[d.at]) return;
		const fields = listFields(saved[d.at], built[i], owner === 'plain', listUntouched(d));
		if (Object.keys(fields).length) edits.push({ kind: 'edit-list', calendar: owner, list: d.at, fields });
	});
	const removes: CalendarOp[] = [];
	for (let i = saved.length - 1; i >= 0; i--) if (!kept.has(i)) removes.push({ kind: 'remove-list', calendar: owner, list: i });
	return { edits, removes, adds };
}

/** The lists as one comparable text: a draft equals the saved lists when this text is the same. */
export const listsShape = (lists: readonly NameList[] | undefined): string =>
	JSON.stringify((lists ?? []).map((l) => [l.name, l.marker ?? null, l.names.map((n) => [n.name, n.short ?? null]), l.known.year, l.known.index, l.show]));
