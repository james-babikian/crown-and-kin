/*
 * Reading the name lists of a `kin-calendar` block (spec §14 rule 13): the lists of a calendar and of the plain years as written, with the
 * problems of a list that cannot be used, and the marker places of a format that no list has. Tolerant: a bad shape is reported, never thrown.
 * Split from `calendar-block.ts` to keep the size rule; that file imports it.
 */

import { fold } from './date-text';
import { isUsableList, MAX_LISTS, MAX_NAMES, markerMap, markerValid, normalizeMarker, RESERVED_PLACES, type ListName, type NameList } from './name-lists';
import { isEmpty, isMap as isRawMap, str, type Raw } from './tolerate';

/** A whole number written as digits (plain YAML gives text under the failsafe schema): the number, NaN for any other text, undefined when nothing is written. */
export function whole(v: Raw): number | undefined {
	const t = str(v);
	if (t === undefined) return undefined;
	return /^[+-]?\d+$/.test(t) ? Number(t) : NaN;
}

/** The names of a list as written: texts, or maps with a name and an optional short form. Undefined when one is neither (the list is then unusable). */
function readNames(v: Raw): ListName[] | undefined {
	if (!Array.isArray(v)) return isEmpty(v) ? [] : undefined;
	const out: ListName[] = [];
	for (const e of v) {
		const name = isRawMap(e) ? str(e.name) : str(e);
		if (name === undefined) return undefined;
		const short = isRawMap(e) ? str(e.short) : undefined;
		out.push(short !== undefined ? { name, short } : { name });
	}
	return out;
}

/**
 * The marker as written. A marker typed with curly brackets and no quotes (`marker: {planet}`) is a YAML map with one key and no value:
 * it is read as that key. Curly brackets inside a text are taken out.
 */
function readMarker(v: Raw): string | undefined {
	if (isRawMap(v)) {
		const keys = Object.keys(v);
		return keys.length === 1 && v[keys[0]] === null ? normalizeMarker(keys[0]) : undefined;
	}
	const t = str(v)?.replace(/[{}]/g, '').trim();
	return t === '' ? undefined : t;
}

/** The marker-shaped places of the formats that no list of the calendar has as its marker (spec §14 rule 13): the reader never fills these groups, and the window refuses them. */
export function unknownMarkers(formats: readonly string[], lists: readonly NameList[]): string[] {
	const known = markerMap(lists);
	const out: string[] = [];
	for (const format of formats) {
		for (const m of format.matchAll(/\{([^{}]*)\}/g)) {
			const name = fold(m[1]);
			if (!RESERVED_PLACES.has(name) && markerValid(name) && !known.has(name) && !out.includes(name)) out.push(name);
		}
	}
	return out;
}

/**
 * Reads one name list as written. A list that cannot be used keeps its place (so the written place of every list stays its place in the
 * result), with no names or a known year that is not valid, and `bad` says why. A `show` that is missing or wrong is `short` (spec §14 rule 13).
 */
function readList(raw: Raw, plain: boolean, position: number, bad: (why: string) => void): NameList {
	const dead: NameList = { name: '', names: [], known: { year: NaN, index: NaN }, show: 'short' };
	if (!isRawMap(raw)) {
		bad('not-map');
		return dead;
	}
	const marker = plain ? undefined : readMarker(raw.marker);
	const shown = str(raw.show)?.toLowerCase();
	const base = { name: str(raw.name) ?? '', ...(marker !== undefined ? { marker: normalizeMarker(marker) } : {}) };
	const show: NameList['show'] = shown === 'full' || shown === 'none' ? shown : 'short';
	const names = readNames(raw.names);
	if (names === undefined || names.length === 0) {
		bad('names');
		return { ...base, names: [], known: dead.known, show };
	}
	const known = isRawMap(raw.known) ? raw.known : {};
	const list: NameList = { ...base, names, known: { year: whole(known.year) ?? NaN, index: whole(known.index) ?? NaN }, show };
	if (!isUsableList(list, 0)) bad(names.length > MAX_NAMES ? 'size' : 'known');
	else if (position >= MAX_LISTS) bad('size');
	return list;
}

/** The name lists of a calendar or of the plain years; `issue` gets the 1-based place of a list that cannot be used (0 for all of them). */
export function readLists(v: Raw, plain: boolean, issue: (index: number, why: string) => void): NameList[] {
	if (isEmpty(v)) return [];
	if (!Array.isArray(v)) {
		issue(0, 'lists');
		return [];
	}
	return v.map((raw: Raw, i: number) => readList(raw, plain, i, (why) => issue(i + 1, why)));
}
