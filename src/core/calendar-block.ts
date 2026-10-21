/*
 * The `kin-calendar` block of a calendar note (spec §14 rule 2): reading it into `Calendar` objects, and the edits of the Calendars
 * window (add, change and remove a calendar, add, change and remove an era). The block is YAML. Reading is tolerant and reports a
 * calendar it cannot use as an issue. Edits are written like the edits of a tree block (spec §6.1, §6.2): through the parsed `yaml`
 * Document, as text patches, so every untouched line keeps its comments, order, quoting and flow style, and unknown keys stay.
 * Every edit is checked by reading the new text back and comparing it with the old data plus exactly the intended change.
 * Pure: no `obsidian` import. An edit never throws; it returns a refusal.
 */

import { isAlias, isMap, isSeq, type Node, type YAMLMap, type YAMLSeq } from 'yaml';
import type { Calendar } from './dates';
import type { EditResult } from './edit';
import { codedIssue, type CodedIssue } from './messages';
import { parseBody } from './parse';
import { REFUSAL_TEXT } from './refusal-text';
import { isEmpty, isMap as isRawMap, str, type Raw, type RawMap } from './tolerate';
import { insertItem, itemEnd, removeItems, section } from './yaml-list';
import {
	addPair, appendItem, clone, finishTogether, findPair, insertAt, isRefusal, layoutOf, parse, refuse, removePair, renderScalar, setPairValue, type NewValue, type Parsed, type Patch, type Source, type Step,
} from './yaml-patch';

/** The write order of the keys of a calendar. */
export const CALENDAR_ORDER = ['name', 'kind', 'length', 'start', 'formats', 'eras'];
/** The write order of the keys of an era. */
export const ERA_ORDER = ['name', 'start', 'length'];

/** `<note path>#<block index>#<calendar index>`; the calendar index is the place in the written list, so an edit can find the calendar again. */
export const calendarId = (notePath: string, blockIndex: number, index: number): string => `${notePath}#${blockIndex}#${index}`;

// ---------------------------------------------------------------------------------------------
// Reading

/** A whole number written as digits (plain YAML gives text under the failsafe schema): the number, NaN for any other text, undefined when nothing is written. */
function whole(v: Raw): number | undefined {
	const t = str(v);
	if (t === undefined) return undefined;
	return /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
}

/** The eras of an era calendar as written; an era that is not a map with a name is left out, and `skipped` says so. */
function readEras(v: Raw): { eras: { name: string; start: number; length?: number }[]; skipped: boolean } {
	const eras: { name: string; start: number; length?: number }[] = [];
	let skipped = false;
	for (const e of Array.isArray(v) ? v : []) {
		const name = isRawMap(e) ? str(e.name) : undefined;
		if (!isRawMap(e) || name === undefined) {
			skipped = true;
			continue;
		}
		const length = whole(e.length);
		eras.push({ name, start: whole(e.start) ?? NaN, ...(length !== undefined ? { length } : {}) });
	}
	return { eras, skipped };
}

/** The formats of a calendar: the texts of the list; a single text is one format. */
function readFormats(v: Raw): string[] {
	return (Array.isArray(v) ? v : isEmpty(v) ? [] : [v]).flatMap((f) => {
		const t = typeof f === 'string' ? f : undefined;
		return t !== undefined && t.trim() !== '' ? [t] : [];
	});
}

/**
 * Reads the body of one `kin-calendar` block of the note `notePath` (the block is number `blockIndex` of its language in the note).
 * A calendar that cannot be used (not a map, no name, a kind that is not `cycles` or `eras`) is left out with an issue; a number that is not
 * a whole number becomes NaN, so the Calendars window can refuse it and the date reader ignores that calendar. Never throws.
 */
export function parseCalendarBlock(source: string, notePath: string, blockIndex: number): { calendars: Calendar[]; issues: CodedIssue[] } {
	const issues: CodedIssue[] = [];
	const invalid = () => ({ calendars: [] as Calendar[], issues: [codedIssue('calendar-block-invalid', 'warning', { note: notePath })] });
	const parsed = parseBody(typeof source === 'string' ? source : '');
	if (!parsed.ok) return invalid();
	const data = parsed.data;
	if (isEmpty(data) || (isRawMap(data) && Object.keys(data).length === 0)) return { calendars: [], issues };
	if (!isRawMap(data) || !Object.prototype.hasOwnProperty.call(data, 'calendars')) return invalid();
	if (isEmpty(data.calendars)) return { calendars: [], issues };
	if (!Array.isArray(data.calendars)) return invalid();
	const calendars: Calendar[] = [];
	data.calendars.forEach((raw: Raw, i: number) => {
		const bad = (why: string) => issues.push(codedIssue('calendar-entry-invalid', 'warning', { note: notePath, index: i + 1, why }));
		if (!isRawMap(raw)) return bad('not-map');
		const name = str(raw.name);
		if (name === undefined) return bad('no-name');
		const kind = str(raw.kind)?.toLowerCase();
		const base = { id: calendarId(notePath, blockIndex, i), name, note: notePath, formats: readFormats(raw.formats) };
		if (kind === 'cycles') {
			calendars.push({ ...base, kind: { type: 'cycles', length: whole(raw.length) ?? NaN, start: whole(raw.start) ?? 1 } });
		} else if (kind === 'eras') {
			const { eras, skipped } = readEras(raw.eras);
			if (skipped) bad('era');
			calendars.push({ ...base, kind: { type: 'eras', eras } });
		} else bad('kind');
	});
	return { calendars, issues };
}

// ---------------------------------------------------------------------------------------------
// Edits

/** An era as the Calendars window gives it. `length` is optional. */
export interface EraFields {
	name: string;
	start: number;
	length?: number;
}

/** A new calendar. A cycle calendar has `length` and `start`; an era calendar has `eras` (it may start with none). */
export interface NewCalendar {
	name: string;
	kind: 'cycles' | 'eras';
	formats: string[];
	length?: number;
	start?: number;
	eras?: EraFields[];
}

/** The edits of the Calendars window. `index` and `era` are places in the written lists. A value equal to the written one writes nothing. */
export type CalendarOp =
	| { kind: 'add-calendar'; calendar: NewCalendar }
	| { kind: 'edit-calendar'; index: number; fields: { name?: string; formats?: string[]; length?: number; start?: number } }
	| { kind: 'remove-calendar'; index: number }
	| { kind: 'add-era'; calendar: number; era: EraFields }
	/** `length: null` removes the length of the era. */
	| { kind: 'edit-era'; calendar: number; era: number; fields: { name?: string; start?: number; length?: number | null } }
	| { kind: 'remove-era'; calendar: number; era: number };

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const isName = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

/** The text of a scalar in a block map (`block`) or in a flow map or list. Names are text, so a plain `1066` stays plain. */
const scalarText = (v: string, flow: boolean, text = true): string => renderScalar(v, null, { flow, text, indent: '' });

/** The one-line form of a list of formats: always a flow list, because a format holds curly brackets. */
const formatsText = (formats: readonly string[]): string => `[${formats.map((f) => scalarText(f, true, false)).join(', ')}]`;

/** The one-line form of an era: `{name: Qinglong Emperor, start: 130, length: 11}`. */
const eraText = (e: EraFields): string => `{name: ${scalarText(e.name, true)}, start: ${e.start}${e.length !== undefined ? `, length: ${e.length}` : ''}}`;

/** The era as the data check expects to read it back. */
const eraRaw = (e: EraFields): RawMap => ({ name: e.name, start: String(e.start), ...(e.length !== undefined ? { length: String(e.length) } : {}) });

/** The refusal for a calendar that cannot be written, or null: a name, a kind, formats that are text, whole numbers, a length of 1 or more. */
function badCalendar(c: NewCalendar): string | null {
	if (!isRawMap(c) || !isName(c.name)) return REFUSAL_TEXT.calendarName;
	if (c.kind !== 'cycles' && c.kind !== 'eras') return REFUSAL_TEXT.calendarKind;
	if (!Array.isArray(c.formats) || c.formats.some((f) => typeof f !== 'string')) return REFUSAL_TEXT.calendarFormats;
	if (c.kind === 'cycles') {
		if (!isWhole(c.length) || c.length < 1) return REFUSAL_TEXT.calendarLength;
		if (c.start !== undefined && !isWhole(c.start)) return REFUSAL_TEXT.calendarNumber;
		return null;
	}
	return (c.eras ?? []).map(badEra).find((x) => x !== null) ?? null;
}

/** The refusal for an era that cannot be written, or null. */
function badEra(e: EraFields): string | null {
	if (!isRawMap(e) || !isName(e.name)) return REFUSAL_TEXT.eraName;
	if (!isWhole(e.start)) return REFUSAL_TEXT.calendarNumber;
	if (e.length !== undefined && (!isWhole(e.length) || e.length < 1)) return REFUSAL_TEXT.calendarLength;
	return null;
}

/** The lines (relative to the item's keys), the one-line form and the expected data of a new calendar. */
function calendarLines(c: NewCalendar, indent: string): { block: string[]; flow: string; raw: RawMap } {
	const block = [`name: ${scalarText(c.name, false)}`, `kind: ${c.kind}`];
	const flow = [`name: ${scalarText(c.name, true)}`, `kind: ${c.kind}`];
	const raw: RawMap = { name: c.name, kind: c.kind };
	const put = (key: string, value: string, data: Raw) => {
		block.push(`${key}: ${value}`);
		flow.push(`${key}: ${value}`);
		raw[key] = data;
	};
	if (c.kind === 'cycles') {
		put('length', String(c.length), String(c.length));
		put('start', String(c.start ?? 1), String(c.start ?? 1));
	}
	put('formats', formatsText(c.formats), [...c.formats]);
	if (c.kind === 'eras') {
		const eras = c.eras ?? [];
		block.push('eras:', ...eras.map((e) => `${indent}- ${eraText(e)}`));
		if (!eras.length) block[block.length - 1] = 'eras: []';
		flow.push(`eras: [${eras.map(eraText).join(', ')}]`);
		raw.eras = eras.map(eraRaw);
	}
	return { block, flow: `{${flow.join(', ')}}`, raw };
}

/** The calendar item at `index` in the parsed body, or a refusal. */
function calendarNode(p: Parsed, index: number): YAMLMap | ReturnType<typeof refuse> {
	const item = section(p, 'calendars')?.seq.items[index];
	if (isAlias(item)) return refuse('bad-value', REFUSAL_TEXT.calendarAlias);
	if (!isMap(item)) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	return item;
}

/** The eras list of a calendar item, or null when the calendar has none yet. */
function erasSeq(cal: YAMLMap): YAMLSeq | null {
	const v = findPair(cal, 'eras')?.value;
	return isSeq(v) ? v : null;
}

/** The raw calendars list of the expected data; a refusal when the block holds something else under `calendars`. */
function rawList(expected: RawMap): Raw[] | ReturnType<typeof refuse> {
	if (isEmpty(expected.calendars)) return [];
	return Array.isArray(expected.calendars) ? expected.calendars : refuse('bad-value', REFUSAL_TEXT.calendarsNotList);
}

/** A patch for one key of a map: set, add in order, or remove. `value` null removes the key. */
function keyPatch(src: Source, map: YAMLMap, key: string, value: NewValue | null, order: string[]): Patch | null {
	const pair = findPair(map, key);
	if (value === null) return pair ? removePair(src, map, pair) : null;
	return pair ? setPairValue(src, map, pair, value, layoutOf(src)) : addPair(src, map, key, value, order, layoutOf(src));
}

const scalarValue = (text: string, old?: Node | null): NewValue => ({ scalar: text, old: old ?? null, text: true });

/** Empties a list: `[]` in place of its items, comments of the items go with them. */
function emptyList(src: Source, seq: YAMLSeq, colonEnd: number): Patch[] {
	if (!seq.items.length) return [];
	if (seq.flow) {
		const span: [number, number] = [seq.range![0], src.nodeEnd(seq)];
		return [{ start: span[0], end: span[1], text: '[]', allow: span }];
	}
	return [insertAt(colonEnd, ' []'), ...removeItems(src, seq, new Set(seq.items.map((_, i) => i)), true)];
}

/** The common start of every edit: the parsed body, its data as a map and a copy of it for the expected result. */
function open(body: string): { p: Parsed; expected: RawMap; list: Raw[] } | ReturnType<typeof refuse> {
	const p = parse(body);
	if (isRefusal(p)) return p;
	const expected = clone(isRawMap(p.data) ? p.data : {}) as RawMap;
	const list = rawList(expected);
	return isRefusal(list) ? list : { p, expected, list };
}

function addCalendar(body: string, c: NewCalendar): EditResult {
	const bad = badCalendar(c);
	if (bad) return refuse('bad-value', bad);
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const layout = layoutOf(p.src);
	const lines = calendarLines(c, ' '.repeat(layout.seqIndent));
	expected.calendars = [...list, lines.raw];
	const step: Step = (q) => insertItem(q, 'calendars', null, lines.block, lines.flow);
	return finishTogether(p, [step], expected, []);
}

function editCalendar(body: string, index: number, fields: { name?: string; formats?: string[]; length?: number; start?: number }): EditResult {
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const raw = list[index];
	if (!isRawMap(raw)) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	const cycles = str(raw.kind)?.toLowerCase() === 'cycles';
	if (fields.name !== undefined && !isName(fields.name)) return refuse('bad-value', REFUSAL_TEXT.calendarName);
	if (fields.formats !== undefined && (!Array.isArray(fields.formats) || fields.formats.some((f) => typeof f !== 'string'))) return refuse('bad-value', REFUSAL_TEXT.calendarFormats);
	if (fields.length !== undefined && (!cycles || !isWhole(fields.length) || fields.length < 1)) return refuse('bad-value', REFUSAL_TEXT.calendarLength);
	if (fields.start !== undefined && (!cycles || !isWhole(fields.start))) return refuse('bad-value', REFUSAL_TEXT.calendarNumber);
	const steps: Step[] = [];
	const change = (key: string, data: Raw, value: (old: Node | null) => NewValue) => {
		if (JSON.stringify(raw[key]) === JSON.stringify(data)) return;
		raw[key] = data;
		steps.push((q) => {
			const map = calendarNode(q, index);
			if (isRefusal(map)) return map;
			return keyPatch(q.src, map, key, value((findPair(map, key)?.value as Node | null) ?? null), CALENDAR_ORDER);
		});
	};
	if (fields.name !== undefined) change('name', fields.name, (old) => scalarValue(fields.name!, old));
	if (fields.length !== undefined) change('length', String(fields.length), (old) => scalarValue(String(fields.length), old));
	if (fields.start !== undefined) change('start', String(fields.start), (old) => scalarValue(String(fields.start), old));
	if (fields.formats !== undefined) change('formats', [...fields.formats], () => ({ raw: formatsText(fields.formats!) }));
	return finishTogether(p, steps, expected, []);
}

function removeCalendar(body: string, index: number): EditResult {
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	if (!isRawMap(list[index])) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	expected.calendars = list.filter((_, i) => i !== index);
	const step: Step = (q) => {
		const s = section(q, 'calendars');
		if (!s) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
		// The last calendar leaves `calendars: []`, so the block stays a calendar block.
		if (s.seq.items.length === 1) return emptyList(q.src, s.seq, q.src.colonEnd(s.pair));
		return removeItems(q.src, s.seq, new Set([index]), true);
	};
	return finishTogether(p, [step], expected, []);
}

/** The era data of calendar `cal` in the expected data: a list, empty when there is none. */
function rawEras(raw: RawMap): Raw[] | ReturnType<typeof refuse> {
	if (str(raw.kind)?.toLowerCase() !== 'eras') return refuse('bad-value', REFUSAL_TEXT.notEraCalendar);
	if (isEmpty(raw.eras)) return [];
	return Array.isArray(raw.eras) ? raw.eras : refuse('bad-value', REFUSAL_TEXT.unknownEra);
}

function addEra(body: string, cal: number, era: EraFields): EditResult {
	const bad = badEra(era);
	if (bad) return refuse('bad-value', bad);
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const raw = list[cal];
	if (!isRawMap(raw)) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	const eras = rawEras(raw);
	if (isRefusal(eras)) return eras;
	raw.eras = [...eras, eraRaw(era)];
	const step: Step = (q) => {
		const map = calendarNode(q, cal);
		if (isRefusal(map)) return map;
		const seq = erasSeq(map);
		if (seq?.items.length) return appendItem(q.src, seq, [eraText(era)], eraText(era), seq.flow ? undefined : itemEnd(q.src, seq, seq.items.length - 1));
		const layout = layoutOf(q.src);
		const value: NewValue = { block: [`${' '.repeat(layout.seqIndent)}- ${eraText(era)}`], flow: `[${eraText(era)}]` };
		return keyPatch(q.src, map, 'eras', value, CALENDAR_ORDER);
	};
	return finishTogether(p, [step], expected, []);
}

function editEra(body: string, cal: number, era: number, fields: { name?: string; start?: number; length?: number | null }): EditResult {
	if (fields.name !== undefined && !isName(fields.name)) return refuse('bad-value', REFUSAL_TEXT.eraName);
	if (fields.start !== undefined && !isWhole(fields.start)) return refuse('bad-value', REFUSAL_TEXT.calendarNumber);
	if (fields.length !== undefined && fields.length !== null && (!isWhole(fields.length) || fields.length < 1)) return refuse('bad-value', REFUSAL_TEXT.calendarLength);
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const raw = list[cal];
	if (!isRawMap(raw)) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	const eras = rawEras(raw);
	if (isRefusal(eras)) return eras;
	const one = eras[era];
	if (!isRawMap(one)) return refuse('bad-value', REFUSAL_TEXT.unknownEra);
	const steps: Step[] = [];
	const change = (key: string, data: string | null, value: NewValue | null) => {
		if ((one[key] === undefined ? null : one[key]) === data) return;
		if (data === null) delete one[key];
		else one[key] = data;
		steps.push((q) => {
			const map = calendarNode(q, cal);
			if (isRefusal(map)) return map;
			const item = erasSeq(map)?.items[era];
			if (isAlias(item) || !isMap(item)) return refuse('bad-value', REFUSAL_TEXT.unknownEra);
			return keyPatch(q.src, item, key, value && 'scalar' in value ? { ...value, old: (findPair(item, key)?.value as Node | null) ?? null } : value, ERA_ORDER);
		});
	};
	if (fields.name !== undefined) change('name', fields.name, scalarValue(fields.name));
	if (fields.start !== undefined) change('start', String(fields.start), scalarValue(String(fields.start)));
	if (fields.length !== undefined) change('length', fields.length === null ? null : String(fields.length), fields.length === null ? null : scalarValue(String(fields.length)));
	return finishTogether(p, steps, expected, []);
}

function removeEra(body: string, cal: number, era: number): EditResult {
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const raw = list[cal];
	if (!isRawMap(raw)) return refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	const eras = rawEras(raw);
	if (isRefusal(eras)) return eras;
	if (!isRawMap(eras[era])) return refuse('bad-value', REFUSAL_TEXT.unknownEra);
	raw.eras = eras.filter((_, i) => i !== era);
	const step: Step = (q) => {
		const map = calendarNode(q, cal);
		if (isRefusal(map)) return map;
		const seq = erasSeq(map);
		const pair = findPair(map, 'eras');
		if (!seq || !pair) return refuse('bad-value', REFUSAL_TEXT.unknownEra);
		if (seq.items.length === 1) return emptyList(q.src, seq, q.src.colonEnd(pair));
		return removeItems(q.src, seq, new Set([era]), true);
	};
	return finishTogether(p, [step], expected, []);
}

/**
 * Applies one edit of the Calendars window to the body of a `kin-calendar` block and returns the new body, or a refusal (spec §8: never
 * throws). The refusal codes are those of `EditResult`; an index that names nothing and a value that cannot be written give `bad-value`
 * with a plain `detail`. Untouched lines, comments and unknown keys stay as written.
 */
export function editCalendarBlock(body: string, op: CalendarOp): EditResult {
	try {
		if (typeof body !== 'string' || !op || typeof op !== 'object') return refuse('bad-value', REFUSAL_TEXT.notWritable);
		switch (op.kind) {
			case 'add-calendar':
				return addCalendar(body, op.calendar);
			case 'edit-calendar':
				return editCalendar(body, op.index, op.fields ?? {});
			case 'remove-calendar':
				return removeCalendar(body, op.index);
			case 'add-era':
				return addEra(body, op.calendar, op.era);
			case 'edit-era':
				return editEra(body, op.calendar, op.era, op.fields ?? {});
			case 'remove-era':
				return removeEra(body, op.calendar, op.era);
			default:
				return refuse('bad-value', REFUSAL_TEXT.notWritable);
		}
	} catch {
		return refuse('bad-value', REFUSAL_TEXT.notWritable);
	}
}
