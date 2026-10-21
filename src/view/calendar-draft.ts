/*
 * The draft of the Calendars window (spec §14 rules 1, 3 and 6, D251), with no DOM and no Obsidian. The window edits the calendars of one calendar
 * note: this file turns the calendars as read into a draft of text fields, works out the start of each calendar and era from the "Same year as" entry form,
 * checks the draft (refusals and warnings), makes the test line, and turns the changes into the edit operations of `core/calendar-block.ts`. A refusal
 * means the window does not save; a warning does not stop a save. Nothing here writes.
 */

import type { CalendarOp, EraFields, NewCalendar } from '../core/calendar-block';
import { PLAIN_READER, checkCalendars, exampleText, findCrossNoteDuplicates, startFromSameYear, type Calendar, type DateReader } from '../core/dates';
import { calendarRefusalText, codedIssue, issueText } from '../core/messages';
import { REFUSAL_TEXT } from '../core/refusal-text';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { dateReadout } from '../render/date-readout';
import { compileCapped } from './calendar-reader';

/** The entry form "Same year as" of one start (spec §14 rule 1): a date in another calendar or a plain year, and the example in this calendar. */
export interface StartDraft {
	/** The start that the note holds (the internal year; NaN when the note holds text that is not a whole number), or null for a calendar or era that the draft adds. */
	saved: number | null;
	/** The date text of "Same year as"; empty: no example, the start stays as it is (1 for a new one). */
	same: string;
	/** The example in this calendar, as typed: the cycle (cycle calendars) and the year. Empty reads as 1. */
	cycle: string;
	year: string;
}

/** One era in the draft. `at` is its place in the written list; null for an era that the draft adds. */
export interface EraDraft {
	key: number;
	at: number | null;
	name: string;
	start: StartDraft;
	/** The length in years as typed; empty for none. */
	length: string;
	/** The length that the note holds: NaN when it is not a whole number (the field is empty then and the note text stays); undefined for none or for an added era. */
	lengthWas?: number;
}

/** One calendar in the draft. `at` is its place in the note (block and place in the block); null for a calendar that the draft adds. */
export interface CalendarDraft {
	key: number;
	at: { block: number; index: number } | null;
	kind: 'cycles' | 'eras';
	name: string;
	/** One format on each text line, as typed. */
	formats: string;
	length: string;
	/** The length that the note holds: NaN when it is not a whole number (the field is empty then and the note text stays). */
	lengthWas?: number;
	start: StartDraft;
	eras: EraDraft[];
	/** The formats that the note holds, as written: a line of the field that still equals one of them is not trimmed. */
	formatsWas?: readonly string[];
	/** The fields as they were when the window opened; undefined for a calendar that the draft adds. A calendar with the same fields is untouched. */
	orig?: string;
}

/** A whole number from typed text: the number, undefined for empty text, null for text that is not a whole safe number. */
export function wholeOf(text: string): number | undefined | null {
	const t = text.trim();
	if (t === '') return undefined;
	if (!/^[+-]?\d+$/.test(t)) return null;
	const n = Number(t);
	return Number.isSafeInteger(n) ? n : null;
}

/**
 * The formats of the field: each text line that is not empty, trimmed. A line that equals a format as the note holds it (`was`) stays as it is, so a calendar
 * that the user did not touch is never rewritten (the reader keeps the spaces of a format as written).
 */
export const formatsOf = (text: string, was: readonly string[] = []): string[] =>
	text.split(/\r?\n/).map((f) => (was.includes(f) ? f : f.trim())).filter((f) => f.trim() !== '');

/** A length from its field: an empty field keeps a length that the note holds as text that is not a whole number (NaN), so the note text stays. */
function lengthOf(text: string, was: number | undefined): number | undefined | null {
	const n = wholeOf(text);
	return n === undefined && was !== undefined && Number.isNaN(was) ? Number.NaN : n;
}

/** True when two numbers are equal; NaN equals NaN (text that is not a number, as the note holds it). */
const sameNumber = (a: number | undefined, b: number | undefined): boolean => a === b || (a !== undefined && b !== undefined && Number.isNaN(a) && Number.isNaN(b));

/** The fields of a calendar as one text, to see whether the user changed it. */
const fieldsOf = (d: CalendarDraft): string =>
	JSON.stringify([d.name, d.formats, d.length, d.start.same, d.start.cycle, d.start.year, d.eras.map((e) => [e.at, e.name, e.length, e.start.same, e.start.cycle, e.start.year])]);

/** True when the user did not change this calendar since the window opened (an untouched calendar is never refused for a number that the note holds as text). */
const untouched = (d: CalendarDraft): boolean => d.orig !== undefined && d.orig === fieldsOf(d);

const blankStart = (saved: number | null): StartDraft => ({ saved, same: '', cycle: '', year: '' });

/** The place of a calendar in its note, from its id (`<note path>#<block>#<index>`). */
function placeOf(id: string): { block: number; index: number } | null {
	const m = /#(\d+)#(\d+)$/.exec(id);
	return m ? { block: Number(m[1]), index: Number(m[2]) } : null;
}

/** The draft of the calendars as read from a note; `key` numbers the draft items. */
export function draftOf(calendars: readonly Calendar[], key: () => number): CalendarDraft[] {
	return calendars.map((c) => {
		const d: CalendarDraft = {
			key: key(),
			at: placeOf(c.id),
			kind: c.kind.type,
			name: c.name,
			formats: c.formats.join('\n'),
			formatsWas: c.formats,
			length: c.kind.type === 'cycles' && Number.isFinite(c.kind.length) ? String(c.kind.length) : '',
			...(c.kind.type === 'cycles' ? { lengthWas: c.kind.length } : {}),
			// A start that the note holds as text stays NaN: the window cannot show it, and it never writes over it.
			start: blankStart(c.kind.type === 'cycles' ? c.kind.start : null),
			eras: c.kind.type === 'eras' ? c.kind.eras.map((e, i) => ({ key: key(), at: i, name: e.name, start: blankStart(e.start), length: e.length !== undefined && Number.isFinite(e.length) ? String(e.length) : '', lengthWas: e.length })) : [],
		};
		d.orig = fieldsOf(d);
		return d;
	});
}

/** A calendar that the draft adds (Add cycle calendar, Add era calendar). */
export function newCalendar(kind: 'cycles' | 'eras', key: () => number): CalendarDraft {
	return { key: key(), at: null, kind, name: '', formats: '', length: '', start: blankStart(null), eras: kind === 'eras' ? [newEra(key)] : [] };
}

/** An era that the draft adds. */
export function newEra(key: () => number): EraDraft {
	return { key: key(), at: null, name: '', start: blankStart(null), length: '' };
}

/** How one start comes out: the internal year, or why the entry form has no usable year. */
export type StartResult = { ok: true; value: number; /** The year comes from a "Same year as" example. */ example: boolean; /** The year that the example names in the other calendar. */ other?: number } | { ok: false; reason: 'date' | 'number' | 'length' | 'cycle' };

/** Reads the date text of "Same year as" through the reader of the other calendars; the internal year, or undefined. */
const yearOfSame = (same: string, others: DateReader): number | undefined => others.read(same)?.year;

/** The start of one calendar or era from its entry form. `length` is the cycle length (cycle calendars; undefined for an era). */
export function startOf(s: StartDraft, others: () => DateReader, cycles: boolean, length: number | undefined): StartResult {
	if (s.same.trim() === '') return { ok: true, value: s.saved ?? 1, example: false };
	const other = yearOfSame(s.same, others());
	if (other === undefined) return { ok: false, reason: 'date' };
	const year = wholeOf(s.year);
	const cycle = cycles ? wholeOf(s.cycle) : undefined;
	if (year === null || cycle === null) return { ok: false, reason: 'number' };
	if (cycles && (length === undefined || !(length >= 1))) return { ok: false, reason: 'length' };
	const value = startFromSameYear({ ...(cycles ? { cycle: cycle ?? 1 } : {}), year: year ?? 1 }, other, length);
	return Number.isSafeInteger(value) ? { ok: true, value, example: true, other } : { ok: false, reason: 'number' };
}

/** The draft as `Calendar` objects (the starts as they come out; one that does not come out keeps its saved value, else 1), for the checks and the readers. */
function asCalendars(drafts: readonly CalendarDraft[], note: string, results: ReadonlyMap<string, StartResult>): Calendar[] {
	return drafts.map((d, i) => calendarOf(d, i, note, results));
}

/** One draft item as a `Calendar`; `i` is its place in the draft (the id of an added calendar). */
function calendarOf(d: CalendarDraft, i: number, note: string, results: ReadonlyMap<string, StartResult>): Calendar {
	const value = (id: string, fallback: number | null) => {
		const r = results.get(id);
		return r?.ok ? r.value : (fallback ?? 1);
	};
	const base = { id: `${note}#${d.at?.block ?? 0}#${d.at?.index ?? i}`, name: d.name.trim(), note, formats: formatsOf(d.formats, d.formatsWas) };
	if (d.kind === 'cycles') return { ...base, kind: { type: 'cycles', length: lengthOf(d.length, d.lengthWas) ?? Number.NaN, start: value(`c${d.key}`, d.start.saved) } } as Calendar;
	return {
		...base,
		kind: {
			type: 'eras',
			eras: d.eras.map((e) => {
				const length = lengthOf(e.length, e.lengthWas);
				return { name: e.name.trim(), start: value(`e${e.key}`, e.start.saved), ...(typeof length === 'number' && (length || Number.isNaN(length)) ? { length } : {}) };
			}),
		},
	} as Calendar;
}

/** What the window shows about a draft: the calendars as they come out, the starts, the refusals and the warnings. */
export interface Checked {
	calendars: Calendar[];
	/** The same calendars by the key of their draft item. */
	byKey: ReadonlyMap<number, Calendar>;
	starts: ReadonlyMap<string, StartResult>;
	/**
	 * The refusals: the window does not save while there is one. `key` is the draft key of the calendar it belongs to (`null`: the whole note). `field` names the
	 * field in error (`name`, `formats`, `length`, `start`, or `era:<key>:name|length|start`), so the card shows the refusal next to it; none: it shows at the end of the card.
	 */
	refusals: { key: number | null; text: string; field?: string }[];
	/** The warnings: shown, and the save goes ahead. */
	warnings: { key: number | null; text: string }[];
	/** The reader of the whole set (the other notes, then this draft), for the test line. */
	reader: DateReader;
}

/** The start entry forms of one draft item, with the key of their result. */
function sameTexts(d: CalendarDraft): { id: string; start: StartDraft; cycles: boolean }[] {
	return d.kind === 'cycles' ? [{ id: `c${d.key}`, start: d.start, cycles: true }] : d.eras.map((e) => ({ id: `e${e.key}`, start: e.start, cycles: false }));
}

/**
 * Works out the start of every calendar and era (spec §14 rule 1). A "Same year as" date that names another calendar of this window reads the start that
 * calendar will have when it is saved, so the calendars are worked out in the order of these references: a calendar goes after the calendars that read its
 * dates. A cycle of references (two calendars that start from each other) has no answer: each calendar in the cycle is refused.
 */
function solveStarts(drafts: readonly CalendarDraft[], note: string, outside: readonly Calendar[]): Map<string, StartResult> {
	const results = new Map<string, StartResult>();
	const done = new Set<number>();
	drafts.forEach((d, i) => {
		if (sameTexts(d).some((t) => t.start.same.trim() !== '')) return;
		done.add(i);
		for (const t of sameTexts(d)) results.set(t.id, startOf(t.start, () => PLAIN_READER, t.cycles, undefined));
	});
	// The calendars as they come out so far: a calendar that waits has the start that its note holds (else 1).
	const current = asCalendars(drafts, note, results);
	let waiting = drafts.map((_, i) => i).filter((i) => !done.has(i));
	while (waiting.length) {
		const later: number[] = [];
		for (const i of waiting) {
			const d = drafts[i];
			const reader = compileCapped([...outside, ...current.filter((_, k) => k !== i)], true);
			// The calendars that read the dates of this one: it waits for those that are not worked out yet.
			const needs = sameTexts(d).flatMap((t) => {
				const r = t.start.same.trim() === '' ? undefined : reader.read(t.start.same);
				return r?.year === undefined ? [] : [r.calendar, ...(r.also ?? [])];
			});
			if (drafts.some((o, j) => j !== i && !done.has(j) && needs.includes(o.name.trim()))) {
				later.push(i);
				continue;
			}
			const length = d.kind === 'cycles' ? (lengthOf(d.length, d.lengthWas) ?? undefined) : undefined;
			for (const t of sameTexts(d)) results.set(t.id, startOf(t.start, () => reader, t.cycles, length));
			done.add(i);
			current[i] = calendarOf(d, i, note, results);
		}
		if (later.length === waiting.length) {
			for (const i of later) for (const t of sameTexts(drafts[i])) results.set(t.id, { ok: false, reason: 'cycle' });
			break;
		}
		waiting = later;
	}
	return results;
}

/** The refusals of one draft item by itself: the name, the lengths, the eras and the starts that do not come out, each with its field. */
function ownTexts(d: CalendarDraft, results: ReadonlyMap<string, StartResult>): { text: string; field: string }[] {
	const out: { text: string; field: string }[] = [];
	const add = (text: string, field: string) => out.push({ text, field });
	// A number that the note holds as text stays as written until the user changes this calendar (ruling 4.3 fix).
	const kept = untouched(d);
	const badLength = (n: number | undefined | null) => !kept && (n === null || (n !== undefined && n < 1));
	if (d.name.trim() === '') add(REFUSAL_TEXT.calendarName, 'name');
	if (d.kind === 'cycles') {
		const length = lengthOf(d.length, d.lengthWas);
		if (badLength(length) || (!kept && length === undefined)) add(REFUSAL_TEXT.calendarLength, 'length');
		const r = results.get(`c${d.key}`);
		if (r && !r.ok) add(startText(r.reason), 'start');
		return out;
	}
	if (!d.eras.length) add(T.noEras, 'eras');
	for (const e of d.eras) {
		if (e.name.trim() === '') add(REFUSAL_TEXT.eraName, `era:${e.key}:name`);
		if (badLength(lengthOf(e.length, e.lengthWas))) add(REFUSAL_TEXT.calendarLength, `era:${e.key}:length`);
		const r = results.get(`e${e.key}`);
		if (r && !r.ok) add(startText(r.reason), `era:${e.key}:start`);
	}
	return out;
}

/**
 * Works out the starts and checks the draft of one note. `outside` are the calendars of the other calendar notes that the tree uses: a date in "Same year as"
 * may name them, and the same cycle format or era name in them is a warning (spec §14 rule 3). A date in "Same year as" is read with the other calendars of
 * this window as they will be saved (see `solveStarts`).
 */
export function checkDraft(drafts: readonly CalendarDraft[], note: string, outside: readonly Calendar[]): Checked {
	const results = solveStarts(drafts, note, outside);
	const refusals: Checked['refusals'] = [];
	const warnings: Checked['warnings'] = [];
	for (const d of drafts) {
		for (const { text, field } of ownTexts(d, results)) refusals.push({ key: d.key, text, field });
		if (!formatsOf(d.formats, d.formatsWas).length) warnings.push({ key: d.key, text: T.noFormats });
	}
	const calendars = asCalendars(drafts, note, results);
	for (const f of checkCalendars(calendars)) {
		const at = drafts.findIndex((d) => d.name.trim() === f.calendar);
		if (at >= 0 && untouched(drafts[at]) && (f.key === 'calendar-length' || f.key === 'calendar-number')) continue;
		const field = f.key.startsWith('calendar-format-') ? 'formats' : at >= 0 && drafts[at].kind === 'cycles' ? { 'calendar-length': 'length', 'calendar-number': 'start' }[f.key] : undefined;
		refusals.push({ key: at < 0 ? null : drafts[at].key, text: calendarRefusalText(f), ...(field ? { field } : {}) });
	}
	for (const p of findCrossNoteDuplicates([...outside, ...calendars]).filter((x) => x.note === note)) {
		const at = drafts.findIndex((d) => d.name.trim() === p.calendar);
		warnings.push({ key: at < 0 ? null : drafts[at].key, text: issueText(codedIssue('calendar-duplicate', 'warning', { calendar: p.calendar ?? '', note: p.note ?? '', other: p.other ?? '' })) });
	}
	// A calendar with no example, beside another calendar: its Year 1 counts as plain year 1 (spec §14 rule 1).
	const used = outside.length + calendars.length > 1;
	drafts.forEach((d, i) => {
		const first = d.kind === 'cycles' ? results.get(`c${d.key}`) : results.get(`e${d.eras[0]?.key}`);
		if (used && first?.ok && !first.example && first.value === 1) warnings.push({ key: d.key, text: issueText(codedIssue('calendar-no-anchor', 'warning', { calendar: calendars[i].name || T.nameLabel })) });
	});
	// The same sentence can come from the draft and from `checkCalendars`.
	const once = <T extends { key: number | null; text: string }>(list: T[]) => list.filter((x, i) => list.findIndex((y) => y.key === x.key && y.text === x.text) === i);
	return { calendars, byKey: new Map(drafts.map((d, i) => [d.key, calendars[i]])), starts: results, refusals: once(refusals), warnings: once(warnings), reader: compileCapped([...outside, ...calendars], true) };
}

/** The sentence for a start that does not come out. */
function startText(reason: 'date' | 'number' | 'length' | 'cycle'): string {
	return reason === 'date' ? T.sameAsBad : reason === 'number' ? T.numberBad : reason === 'cycle' ? T.sameAsCycle : REFUSAL_TEXT.calendarLength;
}

/** The readback under a start (spec §14 rule 1): what the start is, and the example read back in the first format of the calendar. */
export function startReadback(r: StartResult | undefined, calendar: Calendar | undefined, kept: number | null): string {
	if (!r) return '';
	if (!r.ok) return startText(r.reason);
	if (!r.example) {
		if (kept === null) return T.startNone;
		if (Number.isNaN(kept)) return T.startUnreadable;
		// The note stores only the number: the example is worked out again from it, as the first year of the calendar reads in the formats (spec §14 rule 1).
		const first = calendar ? exampleText(calendar, kept) : null;
		return first === null ? T.startKept(kept) : `${T.startKept(kept)} ${T.exampleBack(first, kept)}`;
	}
	const back = calendar && r.other !== undefined ? exampleText(calendar, r.other) : null;
	return back !== null && r.other !== undefined ? `${T.startNow(r.value)} ${T.exampleBack(back, r.other)}` : T.startNow(r.value);
}

/** The test line below a calendar (spec §14 rule 6): how the plugin reads a date that the user writes here; '' for an empty field. */
export function testLine(reader: DateReader, text: string): string {
	return dateReadout(text, reader.read(text), reader.ready);
}

/** The new calendar for `add-calendar`, from a draft item with its starts worked out. */
function newOf(d: CalendarDraft, c: Calendar): NewCalendar {
	const formats = formatsOf(d.formats);
	if (c.kind.type === 'cycles') return { name: c.name, kind: 'cycles', formats, length: c.kind.length, start: c.kind.start };
	return { name: c.name, kind: 'eras', formats, eras: c.kind.eras.map((e): EraFields => ({ name: e.name, start: e.start, ...(e.length !== undefined ? { length: e.length } : {}) })) };
}

/**
 * The edit operations that turn the saved calendars into the draft, in one list for each block of the note: first the edits and the added eras (by their written
 * places), then the removed eras and calendars from the end, then the added calendars. `checked` is `checkDraft` of the same draft; call this only when it has no refusal.
 */
export function opsOf(saved: readonly Calendar[], drafts: readonly CalendarDraft[], checked: Checked): { block: number; ops: CalendarOp[] }[] {
	const blocks = new Map<number, { edits: CalendarOp[]; adds: CalendarOp[]; eraRemoves: CalendarOp[]; removes: CalendarOp[] }>();
	const at = (block: number) => {
		if (!blocks.has(block)) blocks.set(block, { edits: [], adds: [], eraRemoves: [], removes: [] });
		return blocks.get(block)!;
	};
	const newOnes: { d: CalendarDraft; c: Calendar }[] = [];
	drafts.forEach((d, i) => (d.at === null ? newOnes.push({ d, c: checked.calendars[i] }) : undefined));
	for (const was of saved) {
		const place = placeOf(was.id);
		if (!place) continue;
		const j = drafts.findIndex((d) => d.at?.block === place.block && d.at.index === place.index);
		const b = at(place.block);
		if (j < 0) {
			b.removes.push({ kind: 'remove-calendar', index: place.index });
			continue;
		}
		const now = checked.calendars[j];
		const fields: { name?: string; formats?: string[]; length?: number; start?: number } = {};
		if (now.name !== was.name) fields.name = now.name;
		if (JSON.stringify(now.formats) !== JSON.stringify(was.formats)) fields.formats = now.formats;
		if (now.kind.type === 'cycles' && was.kind.type === 'cycles') {
			if (!sameNumber(now.kind.length, was.kind.length)) fields.length = now.kind.length;
			if (!sameNumber(now.kind.start, was.kind.start)) fields.start = now.kind.start;
		}
		if (Object.keys(fields).length) b.edits.push({ kind: 'edit-calendar', index: place.index, fields });
		if (now.kind.type === 'eras' && was.kind.type === 'eras') eraOps(was.kind.eras, drafts[j], now.kind.eras, place.index, b);
	}
	// A calendar that the draft adds goes in the first block of the note.
	const first = at(0);
	for (const { d, c } of newOnes) first.adds.push({ kind: 'add-calendar', calendar: newOf(d, c) });
	return [...blocks.entries()]
		.sort(([a], [b]) => a - b)
		.map(([block, b]) => ({ block, ops: [...b.edits, ...b.adds.filter((o) => o.kind === 'add-era'), ...b.eraRemoves, ...b.removes.sort(byIndexDesc), ...b.adds.filter((o) => o.kind === 'add-calendar')] }))
		.filter((x) => x.ops.length);
}

const byIndexDesc = (a: CalendarOp, b: CalendarOp): number => ((b as { index: number }).index ?? 0) - ((a as { index: number }).index ?? 0);

/** The era operations of one calendar: edits of the eras that stay, the removed eras (from the end) and the added ones. */
function eraOps(was: readonly { name: string; start: number; length?: number }[], d: CalendarDraft, now: readonly { name: string; start: number; length?: number }[], calendar: number, b: { edits: CalendarOp[]; adds: CalendarOp[]; eraRemoves: CalendarOp[] }): void {
	const kept = new Set<number>();
	d.eras.forEach((e, k) => {
		if (e.at === null) {
			b.adds.push({ kind: 'add-era', calendar, era: now[k] });
			return;
		}
		kept.add(e.at);
		const old = was[e.at];
		const fields: { name?: string; start?: number; length?: number | null } = {};
		if (now[k].name !== old.name) fields.name = now[k].name;
		if (!sameNumber(now[k].start, old.start)) fields.start = now[k].start;
		if (!sameNumber(now[k].length, old.length)) fields.length = now[k].length ?? null;
		if (Object.keys(fields).length) b.edits.push({ kind: 'edit-era', calendar, era: e.at, fields });
	});
	for (let i = was.length - 1; i >= 0; i--) if (!kept.has(i)) b.eraRemoves.push({ kind: 'remove-era', calendar, era: i });
}

/** True when the draft differs from the calendars as saved (the window asks before it closes with changes). */
export function draftChanged(saved: readonly Calendar[], drafts: readonly CalendarDraft[], checked: Checked): boolean {
	if (drafts.some((d) => d.at === null)) return true;
	if (drafts.some((d) => d.start.same.trim() !== '' || d.eras.some((e) => e.start.same.trim() !== ''))) return true;
	return JSON.stringify(checked.calendars.map(shape)) !== JSON.stringify(saved.map(shape));
}

/** A calendar without its id and note, for the comparison of a draft with the saved calendars. */
const shape = (c: Calendar) => ({ name: c.name, formats: c.formats, kind: c.kind });
