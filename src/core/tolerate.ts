/*
 * Readers for raw YAML values that accept the slips of hand-typing without a warning
 * (spec §8 "Tolerated silently"): numeric ids, an unquoted [[link]], an unquoted ![[embed]] in a
 * link key, a single value where a list was expected, and one pair of curly quote marks around a
 * colour, a link or a reference (D103). Nothing here reports issues; `parse.ts`
 * decides what deserves one, and `yaml-patch.ts` uses the same readers to compare a written value
 * with an edit's expected one.
 */

import { isScalar, isSeq, Scalar, visit, type Document } from 'yaml';

/** A YAML value read with the failsafe schema, before it is checked or shaped into a `Tree`. */
export type Raw = unknown;
/** A YAML mapping read with the failsafe schema, keyed by its written keys. */
export type RawMap = Record<string, Raw>;

/**
 * The failsafe schema reads every scalar as text, so `color: null` or `name: ~` would be the
 * words "null" and "~". Written plain, they mean "nothing written" in every YAML reader; quoted,
 * they stay text. Keys are left alone.
 */
export function blankPlainNulls(doc: Document): void {
	visit(doc, {
		Scalar(key, node) {
			if (key !== 'key' && node.type === Scalar.PLAIN && typeof node.value === 'string' && /^(~|null|Null|NULL|)$/.test(node.value)) node.value = null;
		},
	});
}

/** The keys whose value is a link: a person's `link` and `portrait`, a house's `arms` (spec §13.0 item 3). */
export const LINK_KEYS: ReadonlySet<string> = new Set(['link', 'portrait', 'arms']);

/**
 * Contract A3: a pasted embed written without quotes, `portrait: ![[x.png]]`. YAML reads the `!`
 * as a tag glued to the list after it, which is an error. In a link key the value is read like the
 * quoted text "![[x.png]]" instead: the node becomes that text and the error goes. The same
 * glued `!` anywhere else stays an error. Call it before looking at `doc.errors`.
 */
export function tolerateEmbeds(doc: Document, source: string): void {
	if (!doc.errors.length) return;
	const starts = new Set<number>();
	visit(doc, {
		Pair(_, pair) {
			const key = isScalar(pair.key) ? pair.key.value : undefined;
			const v = pair.value;
			if (typeof key !== 'string' || !LINK_KEYS.has(key) || !isSeq(v) || !v.flow || !v.range) return;
			const [start, end, nodeEnd] = v.range;
			// Exactly the tag `!` (the yaml package resolves it to the plain list tag), glued to `[[`.
			if (source[start - 1] !== '!' || !/^[\s:,[{]?$/.test(source.charAt(start - 2)) || !source.startsWith('[[', start)) return;
			starts.add(start);
			// The shape `link` accepts (one list holding one list); any other shape reads as a list, which is "absent".
			const text = linkValue(v.toJS(doc) as Raw, () => source.slice(start, end));
			if (text === undefined) return;
			const scalar = new Scalar(`!${text}`);
			scalar.range = [start - 1, end, nodeEnd];
			if (v.comment) scalar.comment = v.comment;
			pair.value = scalar;
		},
	});
	if (!starts.size) return;
	const kept = doc.errors.filter((e) => !(e.code === 'MISSING_CHAR' && starts.has(e.pos[0])));
	doc.errors.splice(0, doc.errors.length, ...kept);
}

/**
 * The curly quote pairs a phone keyboard makes from ' and " (spec §13.16 rule 11, D103): “…”,
 * ‘…’, „…“ and „…”. Written as code points so the file does not depend on its encoding.
 */
const CURLY_WRAPS: readonly (readonly [string, string])[] = [
	['“', '”'],
	['‘', '’'],
	['„', '“'],
	['„', '”'],
];
/** Any curly mark that opens a pair or closes a double pair. The apostrophe U+2019 may stay inside a value. */
const INNER_MARKS = /[‘“”„]/;

/**
 * Splits a text that is wrapped, as a whole, in one pair of curly quote marks. The text inside
 * holds no other pair mark, so one pair is taken off and the result is never wrapped again.
 */
export function curlyParts(s: string): { open: string; inner: string; close: string } | undefined {
	const t = s.trim();
	if (t.length < 2) return undefined;
	const open = t[0];
	const close = t[t.length - 1];
	if (!CURLY_WRAPS.some(([o, c]) => o === open && c === close)) return undefined;
	const inner = t.slice(1, -1);
	return INNER_MARKS.test(inner) ? undefined : { open, inner, close };
}

/** The text inside one pair of curly quote marks, trimmed, or the same value if it is not wrapped in one. */
export function unwrapCurly<T>(v: T): T | string {
	if (typeof v !== 'string') return v;
	const parts = curlyParts(v);
	return parts ? parts.inner.trim() : v;
}

/** Takes the curly pair off a string-valued key of a map; leaves every other value as it is. */
function unwrapKey(map: RawMap, key: string): void {
	const v = map[key];
	if (typeof v !== 'string') return;
	const u = unwrapCurly(v);
	if (u !== v) map[key] = u;
}

/** Takes the curly pair off a reference that is written as an id, a map with this key, or a list of those. */
function unwrapRefs(map: RawMap, key: string, inner: string | undefined): void {
	const v = map[key];
	if (typeof v === 'string') return unwrapKey(map, key);
	const items = Array.isArray(v) ? v : [v];
	items.forEach((item, i) => {
		if (typeof item === 'string') {
			if (Array.isArray(v)) v[i] = unwrapCurly(item);
		} else if (inner !== undefined && isMap(item)) unwrapKey(item, inner);
	});
}

/**
 * Reads the structural values of a parsed body as if the curly pair were not there (D103). These are
 * the colour, the links, and every reference to a person, a union or a house. Names, titles, dates
 * and notes are left as typed. It changes the data only; the note text is never touched.
 */
export function unwrapCurlyKeys(data: Raw): void {
	if (!isMap(data)) return;
	const each = (section: Raw, fn: (item: RawMap) => void) => {
		if (Array.isArray(section)) for (const item of section) if (isMap(item)) fn(item);
	};
	if (isMap(data.options)) for (const key of ['start', 'focus', 'me', 'calendar']) unwrapKey(data.options, key);
	each(data.houses, (h) => ['id', 'color', 'arms'].forEach((key) => unwrapKey(h, key)));
	each(data.people, (p) => {
		for (const key of ['id', 'house', 'placement', 'union', 'link', 'portrait', 'arms']) unwrapKey(p, key);
		unwrapRefs(p, 'parents', 'id');
	});
	each(data.unions, (u) => {
		unwrapKey(u, 'id');
		unwrapRefs(u, 'partners', undefined);
	});
	each(data.titles, (t) => {
		unwrapRefs(t, 'holders', 'person');
		// Contract 0.2.7 K.3: the ids of a named heir and of excluded people, one id or a list.
		unwrapRefs(t, 'heir', undefined);
		unwrapRefs(t, 'exclude', undefined);
	});
}

/** True if `v` is a YAML mapping (and not a list, a scalar, or a `Date`). */
export function isMap(v: Raw): v is RawMap {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Null, an empty string or an absent key: "nothing written". */
export function isEmpty(v: Raw): boolean {
	return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * A non-empty trimmed string, or undefined. The failsafe schema gives strings, but an explicit
 * tag (`!!int 42`, `!!timestamp …`) can still produce other scalars, and ids must stay usable.
 */
export function str(v: Raw): string | undefined {
	let s: string | undefined;
	if (typeof v === 'string') s = v;
	else if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') s = String(v);
	else if (v instanceof Date && !Number.isNaN(v.getTime())) s = v.toISOString().slice(0, 10);
	if (s === undefined) return undefined;
	const t = s.trim();
	return t === '' ? undefined : t;
}

/** True if `v` is `true` or a case-insensitive "true"/"yes"; everything else, including absent, is false. */
export function bool(v: Raw): boolean {
	if (typeof v === 'boolean') return v;
	return typeof v === 'string' && /^(true|yes)$/i.test(v.trim());
}

/** A whole number read from `v`, or undefined if it is not written as one. */
export function int(v: Raw): number | undefined {
	const s = str(v);
	if (s === undefined || !/^-?\d{1,15}$/.test(s)) return undefined;
	return parseInt(s, 10);
}

/** A list, or a single value where a list was expected. Nothing written gives an empty list. */
export function list(v: Raw): Raw[] {
	if (Array.isArray(v)) return v;
	if (isEmpty(v)) return [];
	return [v];
}

/**
 * `link: [[Foo]]` written without quotes parses as a nested list; flatten it back to "[[Foo]]".
 * A comma in the name splits it into items (`[[Smith, John]]`), so then the text as written
 * (`written`, the value's source text) is the link; without it the items are joined with ", ".
 */
export function linkValue(v: Raw, written?: () => string | undefined): string | undefined {
	if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length >= 1) {
		const items = (v[0] as Raw[]).map(str);
		if (items.length === 1) return items[0] === undefined ? undefined : `[[${items[0]}]]`;
		const text = written?.()?.trim();
		if (text !== undefined && /^\[\[[^\r\n]*\]\]$/.test(text)) return text;
		if (items.some((s) => s === undefined)) return undefined;
		return `[[${items.join(', ')}]]`;
	}
	return str(v);
}
