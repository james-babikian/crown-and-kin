/*
 * The formats of a calendar (spec section 14 rules 3 and 14): a format is a text with places in curly brackets, `{year}` and `{cycle}` or
 * `{era}`, and the marker of a name list. This file reads a format into parts, finds the optional group of each marker (the matcher tries a group
 * present first, then absent), gives the base form (every group absent) that two formats are compared by, and checks a format for the window.
 * Pure: it imports only the text helpers and the markers of `name-lists.ts`.
 */

import { fold, SPACE_CLASS } from './date-text';
import { markersByName, markerValid, RESERVED_PLACES } from './name-lists';

export type Place = 'year' | 'cycle' | 'era';
/** A marker place holds the position of its list in `Calendar.lists`. */
export type Seg = { lit: string } | { place: Place } | { marker: number };
/** Spec §14 rule 14: a marker and the literals that belong to it. The matcher tries a group present first, then absent. */
export type Item = Seg | { group: Seg[] };

/** The list position of a marker place that no list has: nothing is ever read there. */
export const NO_LIST = -1;

/**
 * The segments of a folded format, or the message key of its fault: a missing or doubled place, a word that is no place, or a marker twice.
 * With `lenient` (the reader), a marker-shaped word that no list has is a marker place of no list, which is always absent (spec §14 rule 13); the window refuses it.
 */
function scanFormat(kind: 'cycles' | 'eras', format: string, markers: ReadonlyMap<string, number> | undefined, lenient: boolean): { segs: Seg[] } | { key: string } {
	const fail = { key: kind === 'cycles' ? 'calendar-format-cycle' : 'calendar-format-era' };
	if (typeof format !== 'string') return fail;
	const own = kind === 'cycles' ? 'cycle' : 'era';
	const f = fold(format);
	const segs: Seg[] = [];
	const seen = new Set<string>();
	const used = new Set<number>();
	const unknown = new Set<string>();
	let at = 0;
	for (const m of f.matchAll(/\{([^{}]*)\}/g)) {
		const lit = f.slice(at, m.index);
		if (/[{}]/.test(lit)) return fail;
		if (lit !== '') segs.push({ lit });
		const name = m[1];
		at = m.index + m[0].length;
		if (name === 'year' || name === own) {
			if (seen.has(name)) return fail;
			seen.add(name);
			segs.push({ place: name as Place });
			continue;
		}
		const list = markers?.get(name);
		if (list !== undefined && !RESERVED_PLACES.has(name)) {
			if (used.has(list)) return { key: 'calendar-marker-twice' };
			used.add(list);
			segs.push({ marker: list });
			continue;
		}
		// A word that could be a marker is told apart from a place of the other kind of calendar, but only when the caller knows markers.
		if (!markers || RESERVED_PLACES.has(name) || !markerValid(name)) return fail;
		if (!lenient) return { key: 'calendar-marker-unknown' };
		if (unknown.has(name)) return { key: 'calendar-marker-twice' };
		unknown.add(name);
		segs.push({ marker: NO_LIST });
	}
	const rest = f.slice(at);
	if (/[{}]/.test(rest)) return fail;
	if (rest !== '') segs.push({ lit: rest });
	return seen.size === 2 ? { segs } : fail;
}

/** The fault of a format whose places touch (`{cycle}{year}`, or a marker beside any place), or null. */
function touchKey(kind: 'cycles' | 'eras', segs: readonly Seg[]): string | null {
	let marker = false;
	for (let i = 1; i < segs.length; i++) {
		const a = segs[i - 1];
		const b = segs[i];
		if ('lit' in a || 'lit' in b) continue;
		if ('marker' in a || 'marker' in b) marker = true;
		else if (kind === 'cycles') return 'calendar-format-touching';
	}
	return marker ? 'calendar-marker-touching' : null;
}

/** The segments of a format that the reader may use: it obeys rule 3 and no two places touch. */
export function readableFormat(kind: 'cycles' | 'eras', format: unknown, markers: ReadonlyMap<string, number>): Seg[] | null {
	const r = scanFormat(kind, format as string, markers, true);
	return 'segs' in r && touchKey(kind, r.segs) === null ? r.segs : null;
}

/** Spec §14 rules 3 and 14: null when the format is valid for the kind; else the message key (the text is in the message table). `markers` are the markers of the lists of the calendar. */
export function checkFormat(kind: 'cycles' | 'eras', format: string, markers?: readonly string[]): string | null {
	const r = scanFormat(kind, format, markers ? markersByName(markers) : undefined, false);
	return 'key' in r ? r.key : touchKey(kind, r.segs);
}

type PartKind = 'lit' | 'place' | 'marker';
interface Part {
	kind: PartKind;
	text: string;
}

const PUNCT = String.raw`[^\p{L}\p{N}\p{M}${SPACE_CLASS}]`;
const NOT_ALNUM = String.raw`[^\p{L}\p{N}\p{M}]`;
const SPACE = `[${SPACE_CLASS}]`;
/** The end of a literal that a marker takes: only the punctuation next to it (a first marker), or the punctuation and the white space (any other). */
const TAIL_FIRST = new RegExp(`${PUNCT}*$`, 'u');
const TAIL_OTHER = new RegExp(`${NOT_ALNUM}*$`, 'u');
/** The start of a literal that a marker takes: the punctuation next to it, and for a first marker the white space after that. */
const HEAD_FIRST = new RegExp(`^${PUNCT}*${SPACE}*`, 'u');
const HEAD_OTHER = new RegExp(`^${PUNCT}*`, 'u');
const HAS_ALNUM = /[\p{L}\p{N}\p{M}]/u;

/**
 * Spec §14 rule 14: how many characters at the start (`head`, taken by the marker before the literal) and at the end (`tail`, taken by the marker after it)
 * of each literal belong to a marker group. A group is the marker, the run of characters next to it that are no letter, digit or white space on
 * each side, and one run of white space. A marker that has something before it (a place or a word) takes the white space before its group; a
 * first marker (nothing but brackets and other markers before it) takes the white space after its group. So `{cycle}.{year}, {planet}` has the
 * group ", {planet}", `{cycle} ({planet}) {year}` has " ({planet})" and `{planet} Year {year}` has "{planet} ".
 */
function groupCuts(parts: readonly Part[]): { head: number; tail: number }[] {
	const cuts = parts.map(() => ({ head: 0, tail: 0 }));
	const first: boolean[] = [];
	let open = true;
	parts.forEach((part, i) => {
		if (part.kind === 'place' || (part.kind === 'lit' && HAS_ALNUM.test(part.text))) open = false;
		first[i] = open;
	});
	// The end of a literal is cut first, so what lies between two markers goes to the second one as its "before" and the first keeps the rest.
	parts.forEach((part, i) => {
		const before = parts[i - 1];
		if (part.kind === 'marker' && before?.kind === 'lit') cuts[i - 1].tail = (first[i] ? TAIL_FIRST : TAIL_OTHER).exec(before.text)![0].length;
	});
	parts.forEach((part, i) => {
		const after = parts[i + 1];
		if (part.kind !== 'marker' || after?.kind !== 'lit') return;
		cuts[i + 1].head = (first[i] ? HEAD_FIRST : HEAD_OTHER).exec(after.text.slice(0, after.text.length - cuts[i + 1].tail))![0].length;
	});
	return cuts;
}

const partOf = (seg: Seg): Part => ('lit' in seg ? { kind: 'lit', text: seg.lit } : { kind: 'place' in seg ? 'place' : 'marker', text: '' });

/** The items of a format (spec §14 rule 14) and its base form: the format with every group absent, white space at the outer ends trimmed. */
export function groupFormat(segs: readonly Seg[]): { items: Item[]; base: string } {
	const parts = segs.map(partOf);
	const cuts = groupCuts(parts);
	const items: Item[] = [];
	parts.forEach((part, i) => {
		const seg = segs[i];
		if (part.kind === 'lit') {
			const lit = part.text.slice(cuts[i].head, part.text.length - cuts[i].tail);
			if (lit !== '') items.push({ lit });
		} else if (part.kind === 'place') items.push(seg);
		else {
			const group: Seg[] = [];
			const before = parts[i - 1];
			const after = parts[i + 1];
			if (before?.kind === 'lit' && cuts[i - 1].tail > 0) group.push({ lit: before.text.slice(before.text.length - cuts[i - 1].tail) });
			group.push(seg);
			if (after?.kind === 'lit' && cuts[i + 1].head > 0) group.push({ lit: after.text.slice(0, cuts[i + 1].head) });
			items.push({ group });
		}
	});
	// White space at the outer ends of what remains is trimmed (only a literal can hold it; a group that is absent leaves it).
	const firstLit = items.findIndex((item) => !('group' in item));
	if (firstLit >= 0 && 'lit' in items[firstLit]) items[firstLit] = { lit: (items[firstLit] as { lit: string }).lit.trimStart() };
	let lastLit = items.length - 1;
	while (lastLit >= 0 && 'group' in items[lastLit]) lastLit--;
	if (lastLit >= 0 && 'lit' in items[lastLit]) items[lastLit] = { lit: (items[lastLit] as { lit: string }).lit.trimEnd() };
	const kept = items.filter((item) => !('lit' in item && item.lit === ''));
	const base = kept.filter((item) => !('group' in item)).map((item) => ('lit' in item ? item.lit : `{${(item as { place: Place }).place}}`)).join('');
	return { items: kept, base: base.trim() };
}

/** The base form of a format of a calendar, for the comparison of formats (spec §14 rule 14); a format that cannot be read is compared as folded text. */
export function baseFormOf(kind: 'cycles' | 'eras', format: unknown, markers: ReadonlyMap<string, number>): string {
	const segs = readableFormat(kind, format, markers);
	return segs ? groupFormat(segs).base : typeof format === 'string' ? fold(format) : '';
}

/** The format text with its marker groups taken out, as written (case kept): the base form for the example (spec §14 rule 16). Every place that is not year, cycle or era is a marker place. */
export function withoutGroups(format: string): string {
	const raw = format.trim();
	const parts: Part[] = [];
	let at = 0;
	for (const m of raw.matchAll(/\{([^{}]*)\}/g)) {
		if (m.index > at) parts.push({ kind: 'lit', text: raw.slice(at, m.index) });
		parts.push({ kind: RESERVED_PLACES.has(fold(m[1])) ? 'place' : 'marker', text: m[0] });
		at = m.index + m[0].length;
	}
	if (at < raw.length) parts.push({ kind: 'lit', text: raw.slice(at) });
	if (!parts.some((p) => p.kind === 'marker')) return format;
	const cuts = groupCuts(parts);
	return parts.map((p, i) => (p.kind === 'lit' ? p.text.slice(cuts[i].head, p.text.length - cuts[i].tail) : p.kind === 'place' ? p.text : '')).join('').trim();
}
