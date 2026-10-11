/*
 * Changes the id of a house or a title and every reference to it in one write (spec §13.17 rule 5,
 * D109). A house id is used only by the `house` key of people, and a title id only by their
 * `card-title` key, so one routine serves both. `house-ops.ts` and `title-ops.ts` call it for the
 * ops `set-house-id` and `set-title-id`. Like the other ops it builds the expected data first,
 * patches only the changed values in the text, and lets `finish` prove that nothing else changed.
 */

import { isAlias, isMap, type Node, type YAMLMap } from 'yaml';
import type { EditRefusal, EditResult } from './edit';
import { checkNewId } from './id-gen';
import { isMap as isRawMap, str, type Raw, type RawMap } from './tolerate';
import { section } from './yaml-list';
import { clone, findPair, finish, layoutOf, refuse, setPairValue, type Parsed, type Patch, type Refusal, type Step } from './yaml-patch';
import { REFUSAL_TEXT } from './refusal-text';

/** Which kind of item an id change is for. */
export interface IdChange {
	/** The list that holds the items. */
	section: 'houses' | 'titles';
	/** The key of a person that holds the id. */
	refKey: 'house' | 'card-title';
	/** The refusal for an old id that no item has. */
	unknown: EditRefusal;
}

const ANCHOR = 'A value of this id is a YAML anchor or alias. Edit the note text.';

/**
 * Changes the id of the item with id `id` to `newId`, and the `refKey` of every written person
 * whose value is `id`. `newId` equal to `id` is a no-op, before every other check.
 */
export function changeItemId(first: Parsed, data: RawMap, change: IdChange, id: unknown, newId: unknown): EditResult {
	if (typeof newId !== 'string') return refuse('bad-value', REFUSAL_TEXT.idNotText);
	if (typeof id === 'string' && id === newId) return { ok: true, body: first.src.text, created: [] };
	if (checkNewId(newId, new Set()) !== null) return refuse('bad-value', REFUSAL_TEXT.idCharacters);
	if (typeof id !== 'string') return refuse(change.unknown);

	const items: Raw[] = Array.isArray(data[change.section]) ? (data[change.section] as Raw[]) : [];
	const named = (it: Raw, name: string) => isRawMap(it) && str(it.id) === name;
	const at = items.flatMap((it, i) => (named(it, id) ? [i] : []));
	if (at.length === 0) return refuse(change.unknown);
	if (at.length > 1) return refuse('bad-value', 'More than one item has this id.');
	const index = at[0];

	// A value of the key that no item has is a reference that would join the new item by accident.
	const people: Raw[] = Array.isArray(data.people) ? (data.people as Raw[]) : [];
	if (items.some((it) => named(it, newId)) || people.some((p) => isRawMap(p) && str(p[change.refKey]) === newId)) return refuse('id-taken');

	const expected = clone(data) as RawMap;
	((expected[change.section] as Raw[])[index] as RawMap).id = newId;
	const refs: number[] = [];
	(Array.isArray(expected.people) ? (expected.people as Raw[]) : []).forEach((p, k) => {
		if (!isRawMap(p) || str(p[change.refKey]) !== id) return;
		p[change.refKey] = newId;
		refs.push(k);
	});

	const step: Step = (p) => {
		const item = section(p, change.section)?.seq.items[index];
		if (isAlias(item)) return refuse('bad-value', ANCHOR);
		if (!isMap(item)) return refuse(change.unknown);
		if (item.anchor !== undefined) return refuse('bad-value', ANCHOR);
		const layout = layoutOf(p.src);
		const patches: Patch[] = [];
		const setIn = (map: YAMLMap, key: string): Refusal | null => {
			const pair = findPair(map, key);
			const value = pair?.value as Node | null | undefined;
			if (!pair || !value) return refuse('bad-value', REFUSAL_TEXT.notWritable);
			if (isAlias(value) || value.anchor !== undefined) return refuse('bad-value', ANCHOR);
			// `text: false`: the writer quotes a value that plain YAML would read as another type (`123`).
			patches.push(setPairValue(p.src, map, pair, { scalar: newId, old: value, text: false }, layout));
			return null;
		};
		const bad = setIn(item, 'id');
		if (bad) return bad;
		const list = section(p, 'people');
		const seen = new Set<unknown>();
		for (const k of refs) {
			// A person written as an alias shares the item it points to; that item changes once.
			const raw = list?.seq.items[k];
			const map = isAlias(raw) ? raw.resolve(p.src.doc) : raw;
			if (!isMap(map)) return refuse('bad-value', REFUSAL_TEXT.notWritable);
			if (seen.has(map)) continue;
			seen.add(map);
			const refused = setIn(map, change.refKey);
			if (refused) return refused;
		}
		return patches;
	};
	return finish(first, [step], expected, []);
}
