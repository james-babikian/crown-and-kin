/*
 * House ops for the Houses window (spec §6.10, D32; arms §13.6). Same machinery as the other ops:
 * the expected data is built first, the text is patched at the parse positions, and `finish`
 * re-parses and compares.
 */

import { isAlias, isMap, type Node, type Pair, type YAMLMap } from 'yaml';
import type { DeleteHouse, EditHouse, EditResult } from './edit';
import { linkValue, str, type Raw, type RawMap } from './tolerate';
import { removeFromSection, section } from './yaml-list';
import {
	addPair, clone, doubleQuoted, findPair, finish, finishTogether, isRefusal, layoutOf, refuse, removePair, setPairValue, sourceText, type Parsed, type Patch, type Refusal, type Source, type Step,
} from './yaml-patch';

/** §4.1 and §13.0 item 1 order of a house's keys. */
const HOUSE_ORDER = ['id', 'name', 'color', 'arms'];
const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The index of the first house item with this id: the one the tree uses (§4.1). */
function houseIndex(data: RawMap, id: unknown): number | undefined {
	if (typeof id !== 'string' || !Array.isArray(data.houses)) return undefined;
	const i = (data.houses as Raw[]).findIndex((h) => !!h && typeof h === 'object' && !Array.isArray(h) && str((h as RawMap).id) === id);
	return i < 0 ? undefined : i;
}

function houseNode(p: Parsed, index: number): YAMLMap | Refusal {
	const item = section(p, 'houses')?.seq.items[index];
	if (isAlias(item)) return refuse('bad-value', 'This house is written as a YAML alias. Edit the note text.');
	if (!isMap(item)) return refuse('unknown-house');
	return item;
}

/**
 * `color: #8b1e3f` without quotes: YAML reads an empty value and a comment (§8). The new colour
 * takes the old one's place; the rest of that comment stays a comment.
 */
function replaceCommentedColour(src: Source, pair: Pair, text: string): Patch | null {
	const at = src.colonEnd(pair);
	const m = /^([ \t]*)(#[0-9a-fA-F]{3,8})(?=\s|$)([^\r\n]*)/.exec(src.text.slice(at));
	if (!m) return null;
	const start = at + m[1].length;
	const end = start + m[2].length + m[3].length;
	const rest = m[3].trim();
	const kept = rest === '' ? '' : rest.startsWith('#') ? m[3] : ` # ${rest}`;
	const comment = kept.trim();
	return { start, end, text: text + kept, allow: [start, start + 1], writes: comment ? [comment] : undefined };
}

/** Renames, recolours and/or changes the arms of a house (§6.10, §13.6). */
export function editHouse(first: Parsed, data: RawMap, op: EditHouse): EditResult {
	const index = houseIndex(data, op.id);
	if (index === undefined) return refuse('unknown-house');
	if (op.name !== undefined && (typeof op.name !== 'string' || op.name.trim() === '')) return refuse('bad-value', 'A house must have a name.');
	// An empty colour removes the key, as an empty optional person field does (`personValue`).
	const wanted = typeof op.color === 'string' && op.color.trim() === '' ? null : op.color;
	if (wanted !== undefined && wanted !== null && (typeof wanted !== 'string' || !COLOUR.test(wanted))) return refuse('bad-value', 'A colour must be written as #rrggbb.');
	if (op.arms !== undefined && op.arms !== null && typeof op.arms !== 'string') return refuse('bad-value', 'The arms must be a link.');
	const wantedArms = typeof op.arms === 'string' && op.arms.trim() === '' ? null : op.arms;

	const expected = clone(data) as RawMap;
	const house = (expected.houses as RawMap[])[index];
	const name = op.name !== undefined && str(house.name) !== str(op.name) ? op.name : undefined;
	const color = wanted === undefined ? undefined : wanted === null ? (Object.prototype.hasOwnProperty.call(house, 'color') ? null : undefined) : house.color !== wanted ? wanted : undefined;
	// Compared as `parse.ts` reads it (`linkValue` with the source text), so an unquoted [[x.png]]
	// equals "[[x.png]]" and an unquoted [[x,y.png]] equals "[[x,y.png]]".
	let arms: string | null | undefined;
	const readArms = () => linkValue(house.arms, () => sourceText(first.src.doc, first.src.text, ['houses', index, 'arms']));
	if (wantedArms === null) arms = Object.prototype.hasOwnProperty.call(house, 'arms') ? null : undefined;
	else if (wantedArms !== undefined && readArms() !== str(wantedArms)) arms = wantedArms;
	if (name === undefined && color === undefined && arms === undefined) return { ok: true, body: first.src.text, created: [] };
	if (name !== undefined) house.name = name;
	if (color === null) delete house.color;
	else if (color !== undefined) house.color = color;
	if (arms === null) delete house.arms;
	else if (arms !== undefined) house.arms = arms;

	const change = (which: 'name' | 'color' | 'arms'): Step => (p) => {
		const node = houseNode(p, index);
		if (isRefusal(node)) return node;
		const src = p.src;
		const layout = layoutOf(src);
		const pair = findPair(node, which);
		if (which === 'name') {
			const nv = { scalar: name!, old: pair?.value as Node | null, text: false };
			return pair ? setPairValue(src, node, pair, nv, layout) : addPair(src, node, 'name', nv, HOUSE_ORDER, layout);
		}
		if (which === 'arms') {
			if (arms === null) return removePair(src, node, pair!);
			// §13.0 item 3: a picture link is always double-quoted.
			const raw = { raw: doubleQuoted(arms!) };
			return pair ? setPairValue(src, node, pair, raw, layout) : addPair(src, node, 'arms', raw, HOUSE_ORDER, layout);
		}
		if (color === null) return removePair(src, node, pair!);
		// §6.10: a colour is always double-quoted; plain, YAML would read it as a comment.
		const raw = { raw: doubleQuoted(color!) };
		if (!pair) return addPair(src, node, 'color', raw, HOUSE_ORDER, layout);
		return (!src.hasValue(pair) && replaceCommentedColour(src, pair, raw.raw)) || setPairValue(src, node, pair, raw, layout);
	};
	const steps = [...(name !== undefined ? [change('name')] : []), ...(color !== undefined ? [change('color')] : []), ...(arms !== undefined ? [change('arms')] : [])];
	return finishTogether(first, steps, expected, []);
}

/** Deletes a house item, clearing or keeping `house:` on its people as `op.people` says (§6.10). */
export function deleteHouse(first: Parsed, data: RawMap, op: DeleteHouse): EditResult {
	const index = houseIndex(data, op.id);
	if (index === undefined) return refuse('unknown-house');
	if (op.people !== 'clear' && op.people !== 'keep') return refuse('bad-value', 'Say what happens to the people of the house.');
	const id = op.id;

	const expected = clone(data) as RawMap;
	const houses = expected.houses as Raw[];
	houses.splice(index, 1);
	if (houses.length === 0) delete expected.houses;
	// With a second house of the same id, the people still have a house: nothing to clear.
	const clear = op.people === 'clear' && houseIndex(expected, id) === undefined;
	const people: number[] = [];
	if (clear) {
		(Array.isArray(expected.people) ? (expected.people as Raw[]) : []).forEach((raw, k) => {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw) || str((raw as RawMap).house) !== id) return;
			delete (raw as RawMap).house;
			people.push(k);
		});
	}

	const step: Step = (p) => {
		const node = houseNode(p, index);
		if (isRefusal(node)) return node;
		const patches = removeFromSection(p, 'houses', new Set([index]));
		const s = section(p, 'people');
		const seen = new Set<Node>();
		for (const k of people) {
			const item = s?.seq.items[k];
			// A person written as an alias shares the item it points to; that item is cleared once.
			const map = isAlias(item) ? item.resolve(p.src.doc) : item;
			if (!isMap(map) || seen.has(map)) continue;
			seen.add(map);
			const pair = findPair(map, 'house');
			if (pair) patches.push(removePair(p.src, map, pair));
		}
		return patches;
	};
	return finish(first, [step], expected, []);
}
