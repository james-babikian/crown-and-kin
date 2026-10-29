/*
 * The `kin-calendar` block of a calendar note (spec §14 rule 2): reading it into `Calendar` objects, and the edits of the Calendars
 * window (add, change and remove a calendar, add, change and remove an era, add, change and remove a name list). The block is YAML.
 * Name lists (spec §14 rule 13) sit in a calendar under `lists`, and the plain years have `plain: {lists: [...]}`. Their reading is in `calendar-lists.ts`. Reading is tolerant and reports a
 * calendar it cannot use as an issue. Edits are written like the edits of a tree block (spec §6.1, §6.2): through the parsed `yaml`
 * Document, as text patches, so every untouched line keeps its comments, order, quoting and flow style, and unknown keys stay.
 * Every edit is checked by reading the new text back and comparing it with the old data plus exactly the intended change.
 * Pure: no `obsidian` import. An edit never throws; it returns a refusal.
 */

import { isAlias, isMap, isSeq, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import { readLists, unknownMarkers, whole } from './calendar-lists';
import { isWhole, type Calendar } from './dates';
import type { EditResult } from './edit';
import { codedIssue, type CodedIssue } from './messages';
import { inNames, MAX_LISTS, MAX_NAME_CHARS, MAX_NAMES, markerValid, normalizeMarker, type ListName, type NameList } from './name-lists';
import { parseBody } from './parse';
import { REFUSAL_TEXT } from './refusal-text';
import { isEmpty, isMap as isRawMap, isRawList, str, type Raw, type RawMap } from './tolerate';
import { emptyItems, insertItem, itemEnd, removeItems, section } from './yaml-list';
import {
	addPair, addSection, appendItem, clone, doubleQuoted, finishTogether, findPair, isRefusal, itemBlock, layoutOf, parse, refuse, removePair, renderScalar, setPairValue, topMap, type Layout, type NewValue, type Parsed, type Patch, type Source, type Step,
} from './yaml-patch';

/** The write order of the keys of a calendar. */
export const CALENDAR_ORDER = ['name', 'kind', 'length', 'start', 'formats', 'eras', 'lists'];
/** The write order of the keys of an era. */
export const ERA_ORDER = ['name', 'start', 'length'];
/** The write order of the keys of a name list. */
export const LIST_ORDER = ['name', 'marker', 'names', 'known', 'show'];

/** `<note path>#<block index>#<calendar index>`; the calendar index is the place in the written list, so an edit can find the calendar again. */
export const calendarId = (notePath: string, blockIndex: number, index: number): string => `${notePath}#${blockIndex}#${index}`;

// ---------------------------------------------------------------------------------------------
// Reading

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
 * a whole number becomes NaN, so the Calendars window can refuse it and the date reader ignores that calendar. The key `plain` (the name
 * lists of the plain years) is returned as `plain` when the block has it: a block with only `plain` is valid. Never throws.
 */
export function parseCalendarBlock(source: string, notePath: string, blockIndex: number): { calendars: Calendar[]; issues: CodedIssue[]; plain?: NameList[] } {
	const issues: CodedIssue[] = [];
	const invalid = () => ({ calendars: [] as Calendar[], issues: [codedIssue('calendar-block-invalid', 'warning', { note: notePath })] });
	const parsed = parseBody(typeof source === 'string' ? source : '');
	if (!parsed.ok) return invalid();
	const data = parsed.data;
	if (isEmpty(data) || (isRawMap(data) && Object.keys(data).length === 0)) return { calendars: [], issues };
	const has = (key: string) => isRawMap(data) && Object.prototype.hasOwnProperty.call(data, key);
	if (!isRawMap(data) || !(has('calendars') || has('plain'))) return invalid();
	if (!isEmpty(data.calendars) && !Array.isArray(data.calendars)) return invalid();
	let plain: NameList[] | undefined;
	if (has('plain')) {
		const listIssue = (index: number, why: string) => issues.push(codedIssue('calendar-list-invalid', 'warning', { note: notePath, index, why }));
		if (isEmpty(data.plain)) plain = [];
		else if (isRawMap(data.plain)) plain = readLists(data.plain.lists, true, listIssue);
		else {
			listIssue(0, 'lists');
			plain = [];
		}
	}
	const calendars: Calendar[] = [];
	(Array.isArray(data.calendars) ? data.calendars : []).forEach((raw: Raw, i: number) => {
		const bad = (why: string) => issues.push(codedIssue('calendar-entry-invalid', 'warning', { note: notePath, index: i + 1, why }));
		if (!isRawMap(raw)) return bad('not-map');
		const name = str(raw.name);
		if (name === undefined) return bad('no-name');
		const kind = str(raw.kind)?.toLowerCase();
		// The lists are read only for a calendar that is used, so a skipped calendar adds no second issue.
		const base = () => {
			const lists = readLists(raw.lists, false, (index, why) => issues.push(codedIssue('calendar-list-invalid', 'warning', { note: notePath, calendar: name, index, why })));
			const formats = readFormats(raw.formats);
			// A format with a marker place that no list has still reads as its base form (spec §14 rule 13), so the user is told in the window.
			for (const marker of unknownMarkers(formats, lists)) issues.push(codedIssue('calendar-list-invalid', 'warning', { note: notePath, calendar: name, index: 0, why: 'marker', marker }));
			return { id: calendarId(notePath, blockIndex, i), name, note: notePath, formats, ...(lists.length ? { lists } : {}) };
		};
		if (kind === 'cycles') {
			calendars.push({ ...base(), kind: { type: 'cycles', length: whole(raw.length) ?? NaN, start: whole(raw.start) ?? 1 } });
		} else if (kind === 'eras') {
			const { eras, skipped } = readEras(raw.eras);
			if (skipped) bad('era');
			calendars.push({ ...base(), kind: { type: 'eras', eras } });
		} else bad('kind');
	});
	return { calendars, issues, ...(plain ? { plain } : {}) };
}

// ---------------------------------------------------------------------------------------------
// Edits

/** An era as the Calendars window gives it. `length` is optional. */
export interface EraFields {
	name: string;
	start: number;
	length?: number;
}

/** A new calendar. A cycle calendar has `length` and `start`; an era calendar has `eras` (it may start with none). It may have name lists (spec §14 rule 13). */
export interface NewCalendar {
	name: string;
	kind: 'cycles' | 'eras';
	formats: string[];
	length?: number;
	start?: number;
	eras?: EraFields[];
	lists?: NameList[];
}

/** The owner of name lists: a calendar (its place in the written calendars) or the plain years. */
export type ListOwner = number | 'plain';

/** The edits of the Calendars window. `index` and `era` are places in the written lists. A value equal to the written one writes nothing. */
export type CalendarOp =
	| { kind: 'add-calendar'; calendar: NewCalendar }
	| { kind: 'edit-calendar'; index: number; fields: { name?: string; formats?: string[]; length?: number; start?: number } }
	| { kind: 'remove-calendar'; index: number }
	| { kind: 'add-era'; calendar: number; era: EraFields }
	/** `length: null` removes the length of the era. */
	| { kind: 'edit-era'; calendar: number; era: number; fields: { name?: string; start?: number; length?: number | null } }
	| { kind: 'remove-era'; calendar: number; era: number }
	/** Name lists (spec §14 rule 13); `list` is the place in the written lists. A value equal to the written one writes nothing; `marker: null` removes the marker. */
	| { kind: 'add-list'; calendar: ListOwner; list: NameList }
	| { kind: 'edit-list'; calendar: ListOwner; list: number; fields: ListFields }
	| { kind: 'remove-list'; calendar: ListOwner; list: number };

const isName = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

/** The text of a scalar in a block map (`block`) or in a flow map or list. Names are text, so a plain `1066` stays plain. */
const scalarText = (v: string, flow: boolean, text = true): string => renderScalar(v, null, { flow, text, indent: '' });

/** The one-line form of a list of formats: always a flow list, because a format holds curly brackets. */
const formatsText = (formats: readonly string[]): string => `[${formats.map((f) => scalarText(f, true, false)).join(', ')}]`;

/** The one-line form of an era: `{name: Qinglong Emperor, start: 130, length: 11}`. */
const eraText = (e: EraFields): string => `{name: ${scalarText(e.name, true)}, start: ${e.start}${e.length !== undefined ? `, length: ${e.length}` : ''}}`;

/** The era as the data check expects to read it back. */
const eraRaw = (e: EraFields): RawMap => ({ name: e.name, start: String(e.start), ...(e.length !== undefined ? { length: String(e.length) } : {}) });

// ---------------------------------------------------------------------------------------------
// Name lists as text

/** Words that another YAML reader (version 1.1, a property editor) reads as a yes/no value or as nothing. */
const YAML_WORD = /^(?:y|yes|n|no|on|off|true|false|null|~)$/i;

/** A text of a list: quoted where another reader would read a number or a yes/no word ("7", "Yes"), else as a scalar of the block is written. */
const listText = (v: string, flow: boolean): string => (YAML_WORD.test(v) || /^[+-]?[.\d]/.test(v) ? doubleQuoted(v) : renderScalar(v, null, { flow, text: false, indent: '' }));

/** The one-line form of a name: `{name: Saturn, short: Sa}`. */
const nameText = (n: ListName): string => `{name: ${listText(n.name, true)}${n.short !== undefined ? `, short: ${listText(n.short, true)}` : ''}}`;

/** The one-line form of the known year: `{year: 1273, index: 0}`. */
const knownText = (k: NameList['known']): string => `{year: ${k.year}, index: ${k.index}}`;

const namesFlow = (names: readonly ListName[]): string => `[${names.map(nameText).join(', ')}]`;

/** The names as the lines of a block list under `names:`, relative to that key. */
const namesBlock = (names: readonly ListName[], layout: Layout): string[] => names.map((n) => `${' '.repeat(layout.seqIndent)}- ${nameText(n)}`);

/** The lines of a name list (relative to the keys of its item) and its one-line form. */
function listLines(l: NameList, layout: Layout): { block: string[]; flow: string } {
	const block = [`name: ${listText(l.name, false)}`];
	const flow = [`name: ${listText(l.name, true)}`];
	if (l.marker !== undefined) {
		block.push(`marker: ${listText(l.marker, false)}`);
		flow.push(`marker: ${listText(l.marker, true)}`);
	}
	block.push('names:', ...namesBlock(l.names, layout), `known: ${knownText(l.known)}`, `show: ${l.show}`);
	flow.push(`names: ${namesFlow(l.names)}`, `known: ${knownText(l.known)}`, `show: ${l.show}`);
	return { block, flow: `{${flow.join(', ')}}` };
}

/** The name list as the data check expects to read it back (all values are text). */
function listRaw(l: NameList): RawMap {
	return {
		name: l.name,
		...(l.marker !== undefined ? { marker: l.marker } : {}),
		names: l.names.map((n) => ({ name: n.name, ...(n.short !== undefined ? { short: n.short } : {}) })),
		known: { year: String(l.known.year), index: String(l.known.index) },
		show: l.show,
	};
}

/** The names of a list as they will be written, trimmed, or the refusal text: 1 to 60 names of 1 to 40 characters; a short form of 0 to 40, with no comma (spec §14 rule 16). */
function cleanNames(names: unknown): { names: ListName[] } | { refusal: string } {
	if (!Array.isArray(names) || names.length < 1 || names.length > MAX_NAMES) return { refusal: REFUSAL_TEXT.listNames };
	const out: ListName[] = [];
	for (const n of names) {
		if (!isRawMap(n) || typeof n.name !== 'string' || (n.short !== undefined && typeof n.short !== 'string')) return { refusal: REFUSAL_TEXT.listNames };
		const name = n.name.trim();
		const short = typeof n.short === 'string' ? n.short.trim() : '';
		if (name === '' || [...name].length > MAX_NAME_CHARS || [...short].length > MAX_NAME_CHARS) return { refusal: REFUSAL_TEXT.listNames };
		if (short.includes(',')) return { refusal: REFUSAL_TEXT.nameShortComma };
		out.push(short === '' ? { name } : { name, short });
	}
	return { names: out };
}

/** A known year that can be written for a list of `count` names. */
const goodKnown = (k: unknown, count: number): k is NameList['known'] => isRawMap(k) && isWhole(k.year) && inNames(k.index, count);

/** The list as it will be written, or the refusal text. A list of the plain years has no marker. */
function cleanList(l: NameList, plain: boolean): { list: NameList } | { refusal: string } {
	if (!isRawMap(l) || typeof l.name !== 'string' || l.name.trim() === '') return { refusal: REFUSAL_TEXT.listName };
	const cleaned = cleanNames(l.names);
	if ('refusal' in cleaned) return cleaned;
	const names = cleaned.names;
	if (!goodKnown(l.known, names.length)) return { refusal: REFUSAL_TEXT.listKnown };
	if (l.show !== 'short' && l.show !== 'full' && l.show !== 'none') return { refusal: REFUSAL_TEXT.listShow };
	const marker = plain ? undefined : normalizeMarker(l.marker);
	if (marker !== undefined && !markerValid(marker)) return { refusal: REFUSAL_TEXT.listMarker };
	return { list: { name: l.name.trim(), ...(marker !== undefined ? { marker } : {}), names, known: { year: l.known.year, index: l.known.index }, show: l.show } };
}

/** The lists of a new calendar as they will be written, or the refusal text. */
function cleanLists(lists: unknown): { lists: NameList[] } | { refusal: string } {
	if (lists === undefined) return { lists: [] };
	if (!isRawList(lists)) return { refusal: REFUSAL_TEXT.listNames };
	if (lists.length > MAX_LISTS) return { refusal: REFUSAL_TEXT.listsTooMany };
	const out: NameList[] = [];
	for (const l of lists) {
		const c = cleanList(l as NameList, false);
		if ('refusal' in c) return c;
		out.push(c.list);
	}
	return { lists: out };
}

/** The refusal for a calendar that cannot be written, or null: a name, a kind, formats that are text, whole numbers, a length of 1 or more, usable name lists. */
function badCalendar(c: NewCalendar): string | null {
	if (!isRawMap(c) || !isName(c.name)) return REFUSAL_TEXT.calendarName;
	if (c.kind !== 'cycles' && c.kind !== 'eras') return REFUSAL_TEXT.calendarKind;
	if (!Array.isArray(c.formats) || c.formats.some((f) => typeof f !== 'string')) return REFUSAL_TEXT.calendarFormats;
	const lists = cleanLists(c.lists);
	if ('refusal' in lists) return lists.refusal;
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
function calendarLines(c: NewCalendar, layout: Layout): { block: string[]; flow: string; raw: RawMap } {
	const indent = ' '.repeat(layout.seqIndent);
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
	const lists = (cleanLists(c.lists) as { lists: NameList[] }).lists;
	if (lists.length) {
		const texts = lists.map((l) => listLines(l, layout));
		block.push('lists:', ...texts.flatMap((t) => itemBlock(layout, t.block)));
		flow.push(`lists: [${texts.map((t) => t.flow).join(', ')}]`);
		raw.lists = lists.map(listRaw);
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

/** The sequence under `key` of a map in the parsed body (the eras of a calendar, the lists of an owner), or null when there is none yet. */
function seqAt(map: YAMLMap, key: string): YAMLSeq | null {
	const v = findPair(map, key)?.value;
	return isSeq(v) ? v : null;
}

/** The array under `key` in the expected data: empty when there is none, the refusal `text` when the block holds something else. */
function rawArray(raw: RawMap, key: string, text: string): Raw[] | ReturnType<typeof refuse> {
	const v = raw[key];
	if (isEmpty(v)) return [];
	return Array.isArray(v) ? v : refuse('bad-value', text);
}

/** Cuts item `index` out of a sequence. The last item leaves `key: []`, so the block stays a calendar block and the calendar keeps its place. */
function dropItem(q: Parsed, seq: YAMLSeq, pair: Pair, index: number): Patch[] {
	if (seq.items.length === 1) return emptyItems(q.src, seq, q.src.colonEnd(pair));
	return removeItems(q.src, seq, new Set([index]), true);
}

/** The raw calendars list of the expected data; a refusal when the block holds something else under `calendars`. */
const rawList = (expected: RawMap) => rawArray(expected, 'calendars', REFUSAL_TEXT.calendarsNotList);

/** A patch for one key of a map: set, add in order, or remove. `value` null removes the key. */
function keyPatch(src: Source, map: YAMLMap, key: string, value: NewValue | null, order: string[]): Patch | null {
	const pair = findPair(map, key);
	if (value === null) return pair ? removePair(src, map, pair) : null;
	return pair ? setPairValue(src, map, pair, value, layoutOf(src)) : addPair(src, map, key, value, order, layoutOf(src));
}

const scalarValue = (text: string, old?: Node | null): NewValue => ({ scalar: text, old: old ?? null, text: true });

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
	const lines = calendarLines(c, layout);
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
		return s ? dropItem(q, s.seq, s.pair, index) : refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
	};
	return finishTogether(p, [step], expected, []);
}

/** The era data of calendar `cal` in the expected data: a list, empty when there is none. */
function rawEras(raw: RawMap): Raw[] | ReturnType<typeof refuse> {
	if (str(raw.kind)?.toLowerCase() !== 'eras') return refuse('bad-value', REFUSAL_TEXT.notEraCalendar);
	return rawArray(raw, 'eras', REFUSAL_TEXT.unknownEra);
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
		const seq = seqAt(map, 'eras');
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
			const item = seqAt(map, 'eras')?.items[era];
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
		const seq = seqAt(map, 'eras');
		const pair = findPair(map, 'eras');
		if (!seq || !pair) return refuse('bad-value', REFUSAL_TEXT.unknownEra);
		return dropItem(q, seq, pair, era);
	};
	return finishTogether(p, [step], expected, []);
}

// ---------------------------------------------------------------------------------------------
// Name lists: add, change, remove

/** A canonical text of a raw value (keys in sorted order), so two spellings of one value compare equal. */
function canon(v: Raw): string {
	if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
	if (isRawMap(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
	return JSON.stringify(v) ?? 'null';
}

/** The names as written, with the shorthand `- Saturn` read as `{name: Saturn}`, so a value equal to the written one writes nothing. */
const shorthand = (v: Raw): Raw => (Array.isArray(v) ? v.map((e) => (isRawMap(e) ? e : { name: e })) : v);

/** The data of the map that holds the lists of an owner: a calendar, or the value of `plain`; null when the plain years are not written. */
function ownerRaw(expected: RawMap, list: Raw[], owner: ListOwner): RawMap | null | ReturnType<typeof refuse> {
	if (owner === 'plain') {
		if (isEmpty(expected.plain)) return null;
		return isRawMap(expected.plain) ? expected.plain : refuse('bad-value', REFUSAL_TEXT.plainNotMap);
	}
	const raw = list[owner];
	return isRawMap(raw) ? raw : refuse('bad-value', REFUSAL_TEXT.unknownCalendar);
}

/** The map that holds the lists of an owner in the parsed body; null when the plain years are not written (or `plain:` has no value). */
function ownerNode(q: Parsed, owner: ListOwner): YAMLMap | null | ReturnType<typeof refuse> {
	if (owner !== 'plain') return calendarNode(q, owner);
	const top = topMap(q);
	if (isRefusal(top)) return top;
	const value = top ? findPair(top, 'plain')?.value : undefined;
	if (isAlias(value)) return refuse('bad-value', REFUSAL_TEXT.calendarAlias);
	return isMap(value) ? value : null;
}

/** The list item at `index`, or a refusal. */
function listNode(q: Parsed, owner: ListOwner, index: number): { node: YAMLMap; seq: YAMLSeq; pair: NonNullable<ReturnType<typeof findPair>> } | ReturnType<typeof refuse> {
	const node = ownerNode(q, owner);
	if (isRefusal(node)) return node;
	const seq = node ? seqAt(node, 'lists') : null;
	const pair = node ? findPair(node, 'lists') : undefined;
	const item = seq?.items[index];
	if (!seq || !pair || isAlias(item) || !isMap(item)) return refuse('bad-value', REFUSAL_TEXT.unknownList);
	return { node: item, seq, pair };
}

function addList(body: string, owner: ListOwner, input: NameList): EditResult {
	const clean = cleanList(input, owner === 'plain');
	if ('refusal' in clean) return refuse('bad-value', clean.refusal);
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	let holder = ownerRaw(expected, list, owner);
	if (isRefusal(holder)) return holder;
	if (holder === null) {
		holder = {};
		expected.plain = holder;
	}
	const lists = rawArray(holder, 'lists', REFUSAL_TEXT.unknownList);
	if (isRefusal(lists)) return lists;
	if (lists.length >= MAX_LISTS) return refuse('bad-value', REFUSAL_TEXT.listsTooMany);
	holder.lists = [...lists, listRaw(clean.list)];
	const layout = layoutOf(p.src);
	const text = listLines(clean.list, layout);
	const step: Step = (q) => {
		const node = ownerNode(q, owner);
		if (isRefusal(node)) return node;
		if (node === null) {
			// The plain years are not written yet: `plain:` is added with its first list.
			const pad = ' '.repeat(layout.mapIndent);
			const value = { block: [`${pad}lists:`, ...itemBlock(layout, text.block).map((l) => pad + l)], flow: `{lists: [${text.flow}]}` };
			const top = topMap(q);
			if (isRefusal(top)) return top;
			const pair = top ? findPair(top, 'plain') : undefined;
			return pair && top ? setPairValue(q.src, top, pair, value, layout) : addSection(q, 'plain', value);
		}
		const seq = seqAt(node, 'lists');
		if (seq?.items.length) return appendItem(q.src, seq, text.block, text.flow, seq.flow ? undefined : itemEnd(q.src, seq, seq.items.length - 1));
		const value: NewValue = { block: itemBlock(layout, text.block), flow: `[${text.flow}]` };
		return keyPatch(q.src, node, 'lists', value, owner === 'plain' ? ['lists'] : CALENDAR_ORDER);
	};
	return finishTogether(p, [step], expected, []);
}

/** The fields of `edit-list`. */
type ListFields = { name?: string; marker?: string | null; names?: ListName[]; known?: NameList['known']; show?: NameList['show'] };

/** The refusal text for the fields of an `edit-list` that cannot be written, or the cleaned names (undefined when the names are not edited). */
function checkListFields(fields: ListFields, plain: boolean): { refusal: string } | { names: ListName[] | undefined } {
	if (fields.name !== undefined && (typeof fields.name !== 'string' || fields.name.trim() === '')) return { refusal: REFUSAL_TEXT.listName };
	// The plain years have no marker, so none can be written or removed there.
	if (plain ? fields.marker !== undefined : fields.marker !== undefined && fields.marker !== null && !markerValid(normalizeMarker(fields.marker))) return { refusal: REFUSAL_TEXT.listMarker };
	const cleaned = fields.names === undefined ? undefined : cleanNames(fields.names);
	if (cleaned && 'refusal' in cleaned) return cleaned;
	const names = cleaned?.names;
	if (fields.show !== undefined && fields.show !== 'short' && fields.show !== 'full' && fields.show !== 'none') return { refusal: REFUSAL_TEXT.listShow };
	return { names };
}

/** The known year of an edit, checked against the names that will be there: the new known year, or the one written. */
function knownFits(fields: ListFields, names: ListName[] | undefined, one: RawMap): boolean {
	if (fields.known === undefined && !names) return true;
	const count = names ? names.length : Array.isArray(one.names) ? one.names.length : 0;
	const written = isRawMap(one.known) ? one.known : {};
	return goodKnown(fields.known ?? { year: whole(written.year), index: whole(written.index) }, count);
}

function editList(body: string, owner: ListOwner, index: number, fields: ListFields): EditResult {
	const checked = checkListFields(fields, owner === 'plain');
	if ('refusal' in checked) return refuse('bad-value', checked.refusal);
	const { names } = checked;
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const holder = ownerRaw(expected, list, owner);
	if (isRefusal(holder)) return holder;
	const lists = holder ? rawArray(holder, 'lists', REFUSAL_TEXT.unknownList) : [];
	if (isRefusal(lists)) return lists;
	const one = lists[index];
	if (!isRawMap(one)) return refuse('bad-value', REFUSAL_TEXT.unknownList);
	if (!knownFits(fields, names, one)) return refuse('bad-value', REFUSAL_TEXT.listKnown);
	const steps: Step[] = [];
	const change = (key: string, data: Raw, value: (item: YAMLMap) => NewValue | null) => {
		if (data === null ? one[key] === undefined : canon(key === 'names' ? shorthand(one[key]) : one[key]) === canon(data)) return;
		if (data === null) delete one[key];
		else one[key] = data;
		steps.push((q) => {
			const found = listNode(q, owner, index);
			if (isRefusal(found)) return found;
			return keyPatch(q.src, found.node, key, value(found.node), LIST_ORDER);
		});
	};
	if (fields.name !== undefined) change('name', fields.name.trim(), (item) => ({ raw: listText(fields.name!.trim(), !!item.flow) }));
	if (fields.marker !== undefined) {
		const marker = fields.marker === null ? null : normalizeMarker(fields.marker);
		change('marker', marker, (item) => (marker === null ? null : { raw: listText(marker, !!item.flow) }));
	}
	if (names) {
		const layout = layoutOf(p.src);
		change('names', names.map((n) => ({ name: n.name, ...(n.short !== undefined ? { short: n.short } : {}) })), () => ({ block: namesBlock(names, layout), flow: namesFlow(names) }));
	}
	if (fields.known !== undefined) change('known', { year: String(fields.known.year), index: String(fields.known.index) }, () => ({ raw: knownText(fields.known!) }));
	if (fields.show !== undefined) change('show', fields.show, () => ({ raw: fields.show! }));
	return finishTogether(p, steps, expected, []);
}

function removeList(body: string, owner: ListOwner, index: number): EditResult {
	const o = open(body);
	if (isRefusal(o)) return o;
	const { p, expected, list } = o;
	const holder = ownerRaw(expected, list, owner);
	if (isRefusal(holder)) return holder;
	const lists = holder ? rawArray(holder, 'lists', REFUSAL_TEXT.unknownList) : [];
	if (isRefusal(lists)) return lists;
	if (!holder || !isRawMap(lists[index])) return refuse('bad-value', REFUSAL_TEXT.unknownList);
	holder.lists = lists.filter((_, i) => i !== index);
	const step: Step = (q) => {
		const found = listNode(q, owner, index);
		if (isRefusal(found)) return found;
		return dropItem(q, found.seq, found.pair, index);
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
			case 'add-list':
				return addList(body, op.calendar, op.list);
			case 'edit-list':
				return editList(body, op.calendar, op.list, op.fields ?? {});
			case 'remove-list':
				return removeList(body, op.calendar, op.list);
			default:
				return refuse('bad-value', REFUSAL_TEXT.notWritable);
		}
	} catch {
		return refuse('bad-value', REFUSAL_TEXT.notWritable);
	}
}
