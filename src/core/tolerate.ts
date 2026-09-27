/*
 * Readers for raw YAML values that accept the slips of hand-typing without a warning
 * (spec §8 "Tolerated silently"): numeric ids, an unquoted [[link]], and a single value where a
 * list was expected. Nothing here reports issues; `parse.ts` decides what deserves one.
 */

import { Scalar, visit, type Document } from 'yaml';

export type Raw = unknown;

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
export type RawMap = Record<string, Raw>;

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

export function bool(v: Raw): boolean {
	if (typeof v === 'boolean') return v;
	return typeof v === 'string' && /^(true|yes)$/i.test(v.trim());
}

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

/** `link: [[Foo]]` written without quotes parses as a nested list; flatten it back to "[[Foo]]". */
export function linkValue(v: Raw): string | undefined {
	if (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1) {
		const inner = str(v[0][0]);
		return inner === undefined ? undefined : `[[${inner}]]`;
	}
	return str(v);
}
