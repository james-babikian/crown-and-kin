/*
 * The date side of the line of succession (spec §14 rules 5 and 7; the architecture notes §5.7). `succession.ts`
 * asks this file for the year Y of the line and the text that gives it, for the ruler (with the holder texts that have no year),
 * for who is alive at Y, and for the date warnings and the notes about a death date with no year. Every date text is read
 * through the reader of the tree (`TreeDates.read`), so a date in a calendar of the user counts like a plain year. Pure.
 */

import type { DateWarning, ReadDate, TreeDates } from './dates';
import { isDead } from './succession-keys';
import type { Holder, Person } from './types';

/** Reads one date text as an internal year. */
export type YearReader = (text: string | undefined) => number | undefined;

/** True for a date text that has a warning of its own for having no year, so a note about the missing year would say the same twice. */
export type TextTest = (text: string | undefined) => boolean;

/** The test of a dates view for a text that fits two calendars (`fits-two-calendars` is its warning; spec §14 rule 5). */
export const fitsTwoCalendars = (dates: TreeDates): TextTest => (text) => dates.read(text)?.warnings.includes('fits-two-calendars') === true;

/** A holder entry or a person whose date text has no year (`SuccessionResult.noYear`). */
export interface NoYearRow {
	id: string;
	what: 'born' | 'reign';
	/** The `index` of the holder entry. */
	entry?: number;
}

/** One date warning the line met (`SuccessionResult.dateWarnings`); `text` is the date as written, or the calendar name for `calendar-no-anchor`. */
export interface DateWarningRow {
	warning: DateWarning | 'calendar-no-anchor';
	id?: string;
	entry?: number;
	what: 'born' | 'died' | 'reign' | 'year';
	text: string;
}

/** A date text that the line read, with where it stands. */
export interface DateText {
	text: string;
	what: DateWarningRow['what'];
	id?: string;
	entry?: number;
}

type YearFrom = 'field' | 'reign-end' | 'now';

/** L.9: `to` texts that mean the reign is not over. */
const OPEN_END: readonly string[] = ['present', 'now', 'current', 'ongoing', 'living', 'alive', 'reigning'];

/**
 * B.2: the year Y of the line, where it comes from, and the text that gives it, as written (spec §14 rule 7: the sentences of the
 * line name this text; the internal year shows only in the grey line and the test line). The text is null for "now".
 */
export function lineYear(entries: readonly Holder[], fieldText: string | undefined, yr: YearReader): { Y: number | null; yearFrom: YearFrom; yearText: string | null } {
	const field = yr(fieldText);
	const lastText = entries.length ? entries[entries.length - 1].to : undefined;
	const last = yr(lastText);
	if (field !== undefined) return { Y: field, yearFrom: 'field', yearText: fieldText!.trim() };
	if (last !== undefined) return { Y: last, yearFrom: 'reign-end', yearText: lastText!.trim() };
	return { Y: null, yearFrom: 'now', yearText: null };
}

/** The ruler search and what it read: `rIdx` is the entry of R (-1 for none), `noYear` the holder texts with no year, `reads` every holder text that was read. */
export interface RulerFound {
	rIdx: number;
	noYear: NoYearRow[];
	reads: DateText[];
}

/**
 * B.3: the ruler. An entry has started at Y when Y is now, its `from` year is <= Y, or it has no `from` year and no earlier
 * entry ends after Y. L.9: a holder text with no year is reported only when it could change R: the entries the scan reads up to
 * R's entry, and the last entry when the year of the line comes from it. A `to` that means "still ruling" is an open end.
 */
export function findRuler(entries: readonly Holder[], Y: number | null, yearFrom: YearFrom, yr: YearReader, twoCalendars: TextTest = () => false): RulerFound {
	const noYear: NoYearRow[] = [];
	const reigned = new Set<number>();
	const reignText = (h: Holder, fromToo: boolean, toToo: boolean) => {
		if (reigned.has(h.index)) return;
		const unreadable = (text: string | undefined) => text !== undefined && yr(text) === undefined && !twoCalendars(text);
		if ((fromToo && unreadable(h.from)) || (toToo && unreadable(h.to) && !OPEN_END.includes(h.to!.trim().toLowerCase()))) {
			reigned.add(h.index);
			noYear.push({ id: h.person ?? h.name ?? '', what: 'reign', entry: h.index });
		}
	};
	const startedAt = (i: number, maxTo: number): boolean => {
		if (Y === null) return true;
		const from = yr(entries[i].from);
		return from !== undefined ? from <= Y : !(maxTo > Y);
	};
	let rIdx = -1;
	let stop = entries.length - 1;
	let maxTo = -Infinity;
	for (let i = 0; i < entries.length; i++) {
		if (!startedAt(i, maxTo)) {
			// The entry that did not start: a year in its `from` could have started it, so its `from` text is reported.
			reignText(entries[i], Y !== null, false);
			stop = i;
			break;
		}
		// With "now" every entry has started, so no `from` text can change R.
		reignText(entries[i], Y !== null, false);
		rIdx = i;
		const to = yr(entries[i].to);
		if (to !== undefined) maxTo = Math.max(maxTo, to);
	}
	// The `to` of an entry before R fed the start test of a later entry. R's own `to` feeds the test of the next entry only,
	// and it decides nothing when the title names the year. The `to` of the last entry gives the year of the line.
	for (let i = 0; i <= rIdx && Y !== null; i++) if (i < rIdx || (yearFrom !== 'field' && i < entries.length - 1)) reignText(entries[i], false, true);
	if (yearFrom !== 'field' && entries.length) reignText(entries[entries.length - 1], false, true);
	noYear.sort((p, q) => p.entry! - q.entry!);
	return { rIdx, noYear, reads: holderReads(entries, Y, yearFrom, rIdx, stop) };
}

/** Every holder text the ruler search read: `from` up to the entry that did not start (with a number Y), `to` up to R, and the last `to` when it gave Y. */
function holderReads(entries: readonly Holder[], Y: number | null, yearFrom: YearFrom, rIdx: number, stop: number): DateText[] {
	const out: DateText[] = [];
	const add = (h: Holder, text: string | undefined) => {
		if (text !== undefined && !out.some((r) => r.entry === h.index && r.text === text)) out.push({ text, what: 'reign', entry: h.index });
	};
	for (let i = 0; i <= stop && Y !== null; i++) add(entries[i], entries[i].from);
	for (let i = 0; i <= rIdx; i++) add(entries[i], entries[i].to);
	if (yearFrom === 'reign-end' && entries.length) add(entries[entries.length - 1], entries[entries.length - 1].to);
	return out;
}

/** J.2: the people among `shown` whose birth text has no year, except a text that fits two calendars. Nothing before the calendars are ready (rule 7). */
export function bornNoYear(shown: readonly Person[], dates: TreeDates): NoYearRow[] {
	if (!dates.ready) return [];
	const twoCalendars = fitsTwoCalendars(dates);
	return shown.filter((p) => p.born !== undefined && dates.read(p.born)?.year === undefined && !twoCalendars(p.born)).map((p) => ({ id: p.id, what: 'born' }));
}

/** The number of heirs with no birth year when the rule `born-in-reign` needs it (`on`); 0 otherwise. `on` is false before the calendars are ready (rule 7). */
export function missingBirthYears(on: boolean, heirs: readonly string[], bornYear: (id: string) => number | undefined): number {
	return on ? heirs.filter((id) => bornYear(id) === undefined).length : 0;
}

/**
 * Spec §14 rule 7: before the calendars are ready a date in a calendar has no year, which is not the fault of the user. So the notes that come
 * from a missing year stay hidden: the parent with no start year, the order that only the note gives (but not a tie of two equal years), and a
 * break of the order by a child with no year.
 */
export function yearNotes<N extends { kind: string; params: object }>(ready: boolean, notes: readonly N[]): N[] {
	if (ready) return [...notes];
	return notes.filter((n) => n.kind === 'order-from-note' ? (n.params as { reason?: string }).reason === 'same-year' : n.kind !== 'born-in-reign-no-from' && n.kind !== 'order-contradiction');
}

/** Who is alive at Y, as the line reads it, and the people whose death text has no year (spec §14 rule 5). */
export interface Life {
	/** B.4: alive at Y (or not dead, with "now"). The answer is kept for each person. */
	alive(p: Person): boolean;
	/** The birth year of a person, read once. */
	born(p: Person): number | undefined;
	/** True when the person is dead at Y only because the `died` text has text but no year. False with "now" and before the calendars are ready. */
	noDeathYear(p: Person): boolean;
	/** The walk reached the person, who is out of the line (the caller says: the person could stand in the line). Kept when `noDeathYear`. */
	reach(p: Person): void;
	/** The people `reach` kept, in the order of the walk. */
	reached(): string[];
	/** Every `born` and `died` text that this life read, for `calendar-no-anchor` (spec §14 rule 5). */
	texts(): DateText[];
}

/** Builds the `Life` of one line. `track` is true when notes about a death with no year can show (Y is a number and the calendars are ready). */
export function makeLife(people: readonly Person[], Y: number | null, yr: YearReader, track: boolean): Life {
	let size = 0;
	for (const p of people) if (p.index >= size) size = p.index + 1;
	const aliveMemo = new Int8Array(size);
	// The birth year of a person, read once (NaN for no year).
	const yearKnown = new Uint8Array(size);
	const yearValue = new Float64Array(size);
	const bornRead: Person[] = [];
	const diedRead = new Set<Person>();
	const born = (p: Person): number | undefined => {
		if (!yearKnown[p.index]) {
			bornRead.push(p);
			const y = yr(p.born);
			yearValue[p.index] = y === undefined ? NaN : y;
			yearKnown[p.index] = 1;
		}
		const v = yearValue[p.index];
		return Number.isNaN(v) ? undefined : v;
	};
	const alive = (p: Person): boolean => {
		let a = aliveMemo[p.index];
		if (a === 0) {
			let ok: boolean;
			if (Y === null) ok = !isDead(p);
			else {
				const by = born(p);
				if (by !== undefined && by > Y) ok = false;
				else if (!isDead(p)) ok = true;
				else {
					diedRead.add(p);
					const dy = yr(p.died);
					ok = dy !== undefined && dy > Y;
				}
			}
			a = ok ? 1 : 2;
			aliveMemo[p.index] = a;
		}
		return a === 1;
	};
	const noDeathYear = (p: Person): boolean => {
		if (!track) return false;
		const by = born(p);
		if (by !== undefined && by > Y!) return false;
		if (!isDead(p)) return false;
		diedRead.add(p);
		return yr(p.died) === undefined;
	};
	const kept = new Set<string>();
	return {
		alive,
		born,
		noDeathYear,
		reach: (p) => {
			if (noDeathYear(p)) kept.add(p.id);
		},
		reached: () => [...kept],
		texts: () => [...bornRead.flatMap((p) => (p.born !== undefined ? [{ text: p.born, what: 'born' as const, id: p.id }] : [])), ...[...diedRead].flatMap((p) => (p.died !== undefined ? [{ text: p.died, what: 'died' as const, id: p.id }] : []))],
	};
}

/**
 * The warnings of every date text the line read (spec §14 rule 5), and `calendar-no-anchor` when the dates mix a calendar that
 * starts at year 1 with plain years or another calendar. Nothing before the calendars are ready (rule 7). Each warning once for
 * a place. `also` are texts the line read without showing them: they count for `calendar-no-anchor` only.
 */
export function dateRows(dates: TreeDates, texts: readonly DateText[], also: readonly DateText[] = []): DateWarningRow[] {
	if (!dates.ready) return [];
	const rows: DateWarningRow[] = [];
	const seen = new Set<string>();
	const reads: ReadDate[] = [];
	for (const t of texts) {
		const r = dates.read(t.text);
		if (!r) continue;
		reads.push(r);
		for (const warning of r.warnings) {
			// A wrong written name changes no year, so it is no row of the line of succession (spec §14 rule 14).
			if (warning === 'calendar-name-mismatch') continue;
			const key = `${warning}|${t.what}|${t.id ?? ''}|${t.entry ?? ''}|${t.text}`;
			if (seen.has(key)) continue;
			seen.add(key);
			rows.push({ warning, ...(t.id !== undefined ? { id: t.id } : {}), ...(t.entry !== undefined ? { entry: t.entry } : {}), what: t.what, text: t.text });
		}
	}
	for (const t of also) {
		const r = dates.read(t.text);
		if (r) reads.push(r);
	}
	return [...rows, ...anchorRows(dates, reads)];
}

/** `calendar-no-anchor`: the calendars that start at year 1 among the dates read, when those dates also hold plain years or another calendar. */
function anchorRows(dates: TreeDates, reads: readonly ReadDate[]): DateWarningRow[] {
	const calendars = new Set<string>();
	let plain = false;
	for (const r of reads) {
		if (r.year === undefined) continue;
		if (r.source === 'plain') plain = true;
		else if (r.calendar !== undefined) calendars.add(r.calendar);
	}
	if (!calendars.size || (!plain && calendars.size < 2)) return [];
	const loose = dates.unanchored();
	return [...calendars].filter((c) => loose.includes(c)).map((c) => ({ warning: 'calendar-no-anchor', what: 'year', text: c }));
}

/** The date texts of a person that the line reads: `born` and `died`. */
export function personTexts(p: Person): DateText[] {
	return [...(p.born !== undefined ? [{ text: p.born, what: 'born' as const, id: p.id }] : []), ...(p.died !== undefined ? [{ text: p.died, what: 'died' as const, id: p.id }] : [])];
}

/** The note `died-no-year` (spec §14 rule 5), as `SuccessionNote` has it. */
export interface DeathNote {
	kind: 'died-no-year';
	params: { person: string; year: string };
}

/**
 * The notes `died-no-year`: for the people the walk reached who are out of the line only for this reason (at most `cap`), for the named heirs who are
 * not alive only for this reason, and for the open-branch rows that this death date causes; one note for each person. `yearText` is the text that gives Y.
 */
export function deathNotes(life: Life, person: (id: string) => Person, named: readonly { id: string; state: string }[], rows: readonly { id: string }[], cap: number, yearText: string | null): DeathNote[] {
	if (yearText === null) return [];
	const ids = new Set<string>(life.reached().slice(0, cap));
	for (const n of named) if (n.state === 'not-alive' && life.noDeathYear(person(n.id))) ids.add(n.id);
	for (const r of rows) if (life.noDeathYear(person(r.id))) ids.add(r.id);
	return [...ids].map((id) => ({ kind: 'died-no-year', params: { person: id, year: yearText } }));
}
