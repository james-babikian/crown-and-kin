/*
 * Dispatches one `Op` (spec §6.2–§6.10, §13.4) to the code that carries it out: the relationship
 * ops in `relationship-ops.ts`, the house ops in `house-ops.ts`, the title ops in `title-ops.ts`,
 * the link rewrite in `link-rewrite.ts`, or the field and option writes below. After the op (or
 * after all ops of a batch) it removes the keys the write left stale: `placement` and `union`
 * (`removeStaleKeys`) and `card-title` (`cleanCardTitles`). `applyOp` is the plugin's single
 * entry point for editing a block body; `block-handle.ts` calls it for every write,
 * `rename-links.ts` calls it for link rewrites.
 */

import { isMap, isSeq, type Node } from 'yaml';
import { deriveFamilies, type FamilyGraph } from './derive';
import type { AddHouse, ApplyOp, Batch, EditResult, FieldValue, Op, PersonField, RewriteLinksOp, SetOption, SetPersonFields } from './edit';
import { deleteHouse, editHouse, setHouseId } from './house-ops';
import { newIdIn } from './id-gen';
import { rewriteLinks } from './link-rewrite';
import { parseBody, readTree, referencedIds } from './parse';
import { relationshipOp, removeStaleKeys } from './relationship-ops';
import { cleanCardTitles, titleOp } from './title-ops';
import { isEmpty, isRawList, str, type Raw, type RawMap } from './tolerate';
import type { Tree } from './types';
import { itemEnd } from './yaml-list';
import {
	addPair, addSection, appendItem, clone, doubleQuoted, findPair, finish, finishTogether, isBooleanField, isRefusal, itemBlock, layoutOf, OPTION_ORDER, PERSON_FIELDS, PERSON_ORDER, personNode,
	personValue, forgetRecall, QUOTED_FIELDS, refuse, remember, removePair, renderScalar, sameValue, setPairValue, Source, sourceText, TEXT_FIELDS, topMap, type NewValue, type Parsed,
	type Step,
} from './yaml-patch';
import { REFUSAL_TEXT } from './refusal-text';

function setPersonFields(first: Parsed, op: SetPersonFields, data: RawMap, index: number): EditResult {
	const expected = clone(data) as RawMap;
	const person = (expected.people as RawMap[])[index];
	const steps: Step[] = [];
	// `id`: a person with no written id gets one, so a later op of the batch can name them.
	const newId: unknown = op.fields && Object.prototype.hasOwnProperty.call(op.fields, 'id') ? op.fields.id : undefined;
	if (newId !== undefined) {
		if (typeof newId !== 'string' || newId.trim() === '' || newId !== newId.trim()) return refuse('bad-value', 'An id must be text.');
		if (str(person.id) !== undefined) return refuse('bad-value', 'The person has an id already.');
		if (referencedIds(data).has(newId)) return refuse('id-taken');
		person.id = newId;
		steps.push((p) => {
			const item = personNode(p, index);
			if (isRefusal(item)) return item;
			const pair = findPair(item, 'id');
			const layout = layoutOf(p.src);
			const nv: NewValue = { scalar: newId, old: pair?.value as Node | null, text: true };
			return pair ? setPairValue(p.src, item, pair, nv, layout) : addPair(p.src, item, 'id', nv, PERSON_ORDER, layout);
		});
	}
	// D91: a changed or removed `portrait` removes `portrait-crop` in the same write, unless the op sets a part itself.
	const fields: Partial<Record<PersonField, FieldValue>> = { ...op.fields };
	if (op.fields && Object.prototype.hasOwnProperty.call(op.fields, 'portrait') && !Object.prototype.hasOwnProperty.call(op.fields, 'portrait-crop')) {
		const v = personValue('portrait', op.fields.portrait as FieldValue);
		if (!isRefusal(v) && !sameValue('portrait', person.portrait, v.write, () => sourceText(first.src.doc, first.src.text, ['people', index, 'portrait']))) fields['portrait-crop'] = null;
	}
	// §4.1 order, so new keys that land on the same spot come out in that order.
	for (const field of PERSON_ORDER.filter((f): f is PersonField => (PERSON_FIELDS as readonly string[]).includes(f))) {
		if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
		const v = personValue(field, fields[field] as FieldValue);
		if (isRefusal(v)) return v;
		if (sameValue(field, person[field], v.write, () => sourceText(first.src.doc, first.src.text, ['people', index, field]))) continue;
		if (v.write === null) delete person[field];
		else person[field] = v.write;
		const write = v.write;
		steps.push((p) => {
			const item = personNode(p, index);
			if (isRefusal(item)) return item;
			const pair = findPair(item, field);
			const layout = layoutOf(p.src);
			if (write === null) return pair ? removePair(p.src, item, pair) : null;
			if (QUOTED_FIELDS.has(field)) {
				const quoted: NewValue = { raw: doubleQuoted(write) };
				return pair ? setPairValue(p.src, item, pair, quoted, layout) : addPair(p.src, item, field, quoted, PERSON_ORDER, layout);
			}
			const nv: NewValue = { scalar: write, old: pair?.value as Node | null, text: TEXT_FIELDS.has(field) };
			if (isBooleanField(field)) return pair ? setPairValue(p.src, item, pair, { ...nv, old: null, text: true }, layout) : addPair(p.src, item, field, { ...nv, text: true }, PERSON_ORDER, layout);
			return pair ? setPairValue(p.src, item, pair, nv, layout) : addPair(p.src, item, field, nv, PERSON_ORDER, layout);
		});
	}
	return finishTogether(first, steps, expected, []);
}

function setOption(first: Parsed, op: SetOption, data: RawMap): EditResult {
	if (!OPTION_ORDER.includes(op.key)) return refuse('bad-value', `Unknown option ${String(op.key)}.`);
	let write: string | null;
	if (op.value === null || op.value === undefined) write = null;
	else if (op.key === 'generations' || op.key === 'height') {
		const s = String(op.value).trim();
		if (!/^\d{1,9}$/.test(s)) return refuse('bad-value', `${op.key} must be a whole number.`);
		write = String(parseInt(s, 10));
	} else if (typeof op.value === 'string' || typeof op.value === 'number') {
		write = String(op.value).trim() === '' ? null : String(op.value);
	} else return refuse('bad-value');

	const expected = clone(data ?? {}) as RawMap;
	const options = isEmpty(expected.options) ? undefined : expected.options;
	if (options !== undefined && (typeof options !== 'object' || Array.isArray(options))) return refuse('bad-value', 'The options section is not a map.');
	const current = (options as RawMap | undefined)?.[op.key];
	if (write === null ? current === undefined : current === write) return { ok: true, body: first.src.text, created: [] };

	const opts: RawMap = { ...((options as RawMap | undefined) ?? {}) };
	if (write === null) delete opts[op.key];
	else opts[op.key] = write;
	if (Object.keys(opts).length === 0) delete expected.options;
	else expected.options = opts;

	const key = op.key;
	// Ids are text and the two numbers are meant as numbers: all four are written plain when they can be (`text: true`).
	const step: Step = (p) => {
		const top = topMap(p);
		if (isRefusal(top)) return top;
		const layout = layoutOf(p.src);
		const optionsPair = top ? findPair(top, 'options') : undefined;
		const node = optionsPair?.value;
		if (!optionsPair || !isMap(node)) {
			if (write === null) return null;
			const line = `${key}: ${renderScalar(write, null, { flow: false, text: true, indent: '' })}`;
			const value: NewValue = { block: [' '.repeat(layout.mapIndent) + line], flow: `{${key}: ${renderScalar(write, null, { flow: true, text: true, indent: '' })}}` };
			if (optionsPair && top) return setPairValue(p.src, top, optionsPair, value, layout);
			return addSection(p, 'options', value);
		}
		const pair = findPair(node, key);
		if (write === null) {
			if (!pair) return null;
			if (node.items.length === 1 && top) return removePair(p.src, top, optionsPair);
			return removePair(p.src, node, pair);
		}
		const nv: NewValue = { scalar: write, old: pair?.value as Node | null, text: true };
		return pair ? setPairValue(p.src, node, pair, nv, layout) : addPair(p.src, node, key, nv, OPTION_ORDER, layout);
	};
	return finish(first, [step], expected, []);
}

/** The id `add-house` would give a new house with this name in this body (§6.8, house namespace). */
export function newHouseId(data: Raw, name: string): string {
	return newIdIn((data as RawMap | null)?.houses, name);
}

function addHouse(first: Parsed, op: AddHouse, data: RawMap): EditResult {
	if (typeof op.name !== 'string' || op.name.trim() === '') return refuse('bad-value', REFUSAL_TEXT.houseName);
	if (op.color !== undefined && typeof op.color !== 'string') return refuse('bad-value', 'The colour must be text.');
	// Null is taken as "no arms", as an empty text is.
	if (op.arms !== undefined && op.arms !== null && typeof op.arms !== 'string') return refuse('bad-value', REFUSAL_TEXT.armsLink);
	const expected = clone(data ?? {}) as RawMap;
	if (!isEmpty(expected.houses) && !Array.isArray(expected.houses)) return refuse('bad-value', 'The houses section is not a list.');
	const id = newHouseId(expected, op.name);
	const house: RawMap = { id, name: op.name };
	const color = op.color?.trim() ? op.color : undefined;
	if (color !== undefined) house.color = color;
	const arms = typeof op.arms === 'string' && op.arms.trim() !== '' ? op.arms : undefined;
	if (arms !== undefined) house.arms = arms;
	expected.houses = [...(isRawList(expected.houses) ? expected.houses : []), house];

	const entries: [string, string, boolean][] = [
		['id', id, true],
		['name', op.name, false],
	];
	if (color !== undefined) entries.push(['color', color, false]);
	if (arms !== undefined) entries.push(['arms', arms, false]);
	const rendered = (k: string, v: string, text: boolean, flow: boolean) => (QUOTED_FIELDS.has(k) ? doubleQuoted(v) : renderScalar(v, null, { flow, text, indent: '' }));
	const step: Step = (p) => {
		const top = topMap(p);
		if (isRefusal(top)) return top;
		const layout = layoutOf(p.src);
		const block = entries.map(([k, v, text]) => `${k}: ${rendered(k, v, text, false)}`);
		const flow = `{${entries.map(([k, v, text]) => `${k}: ${rendered(k, v, text, true)}`).join(', ')}}`;
		const housesPair = top ? findPair(top, 'houses') : undefined;
		const node = housesPair?.value;
		// Like add-person, the new house goes after the comments the last house owns.
		if (isSeq(node) && (node.items.length || node.flow)) return appendItem(p.src, node, block, flow, node.flow ? undefined : itemEnd(p.src, node, node.items.length - 1));
		const value: NewValue = { block: itemBlock(layout, block), flow: `[${flow}]` };
		if (housesPair && top) return setPairValue(p.src, top, housesPair, value, layout);
		return addSection(p, 'houses', value);
	};
	return finish(first, [step], expected, [id]);
}

/**
 * `keepStale`: inside a batch, keys left stale are judged once, on the batch's final data.
 * `renames`: the title ids that `set-title-id` ops of the batch changed (old to new), so the
 * final `card-title` cleanup finds the people it judged before the write.
 */
function applyOne(body: string, op: Op, keepStale = false, renames?: Map<string, string>): EditResult {
	if (op === null || typeof op !== 'object') return refuse('bad-value');
	if (op.kind === 'batch') {
		let current = body;
		const created: string[] = [];
		const effects: ('auto-union')[] = [];
		let changed: number | undefined;
		const titleRenames = renames ?? new Map<string, string>();
		for (const inner of Array.isArray(op.ops) ? op.ops : []) {
			const r = applyOne(current, inner, true, titleRenames);
			if (!r.ok) return r;
			current = r.body;
			created.push(...r.created);
			for (const e of r.effects ?? []) if (!effects.includes(e)) effects.push(e);
			if (r.changed !== undefined) changed = (changed ?? 0) + r.changed;
		}
		if (!keepStale && current !== body) {
			const clean = removeStaleKeys(body, current);
			if (!clean.ok) return clean;
			const titles = cleanCardTitles(body, clean.body, undefined, titleRenames);
			if (!titles.ok) return titles;
			current = titles.body;
		}
		const out: EditResult = { ok: true, body: current, created };
		if (changed !== undefined) out.changed = changed;
		if (effects.length) out.effects = effects;
		return out;
	}
	const parsed = parseBody(body);
	if (!parsed.ok) return refuse('invalid-yaml', parsed.error.detail ?? parsed.error.code);
	remember(body, parsed.data);
	// §6.9: renames also update a tree that is blocked for editing; only `link` values change.
	if (op.kind === 'rewrite-links') return rewriteLinks({ src: new Source(body, parsed.doc), data: parsed.data }, (isEmpty(parsed.data) ? {} : parsed.data) as RawMap, op);
	const tree = readTree(parsed.doc, parsed.data, body);
	const g = deriveFamilies(tree);
	if (g.issues.some((i) => i.level === 'blocking')) return refuse('blocked');
	const data = (isEmpty(parsed.data) ? {} : parsed.data) as RawMap;
	const first: Parsed = { src: new Source(body, parsed.doc), data: parsed.data };
	let r: EditResult;
	try {
		r = dispatch(op, { first, data, tree, g }, keepStale);
	} catch (e) {
		// An alias that points to its own list makes the data loop; `clone` cannot copy it. Say so instead of the catch-all text.
		if (e instanceof TypeError && /circular/i.test(e.message)) return refuse('bad-value', 'The note text has a value that points to itself. Edit the note text.');
		throw e;
	}
	if (r.ok && r.body !== body && op.kind === 'set-title-id' && renames) {
		// A chain (a to b, then b to c) is one rename of a to c.
		let chained = false;
		for (const [from, to] of renames) {
			if (to !== op.id) continue;
			renames.set(from, op.newId);
			chained = true;
		}
		if (!chained) renames.set(op.id, op.newId);
	}
	if (keepStale || !r.ok || r.body === body) return r;
	// Rule 7 of the titles rules (`title-ops.ts` header): once per write, like the stale keys.
	const clean = cleanCardTitles(body, r.body, parsed.data);
	return clean.ok ? { ...r, body: clean.body } : clean;
}

/** Runs one op (not a batch or a link rewrite) on a body that may be edited. */
function dispatch(op: Exclude<Op, Batch | RewriteLinksOp>, ctx: { first: Parsed; data: RawMap; tree: Tree; g: FamilyGraph }, keepStale: boolean): EditResult {
	const { first, data, tree, g } = ctx;
	switch (op.kind) {
		case 'add-person':
		case 'add-parent':
		case 'add-union':
		case 'edit-union':
		case 'remove-union':
		case 'set-parent-type':
		case 'remove-parent':
		case 'move-sibling':
		case 'delete-person':
			return relationshipOp({ first, data, tree, g, keepStale }, op);
		case 'set-person-fields': {
			const person = typeof op.id === 'string' ? tree.people.find((p) => p.id === op.id) : undefined;
			if (!person) return refuse('unknown-person');
			return setPersonFields(first, op, data, person.index);
		}
		case 'set-option':
			return setOption(first, op, data);
		case 'add-house':
			return addHouse(first, op, data);
		case 'edit-house':
			return editHouse(first, data, op);
		case 'delete-house':
			return deleteHouse(first, data, op);
		case 'set-house-id':
			return setHouseId(first, data, op);
		case 'add-title':
		case 'edit-title':
		case 'delete-title':
		case 'add-holder':
		case 'edit-holder':
		case 'remove-holder':
		case 'set-holders':
		case 'set-title-id':
			return titleOp(ctx, op);
		default:
			return refuse('bad-value', 'Unknown edit.');
	}
}

/** Implements `ApplyOp`. */
export const applyOp: ApplyOp = (body, op) => {
	try {
		if (typeof body !== 'string') return refuse('invalid-yaml');
		return applyOne(body, op);
	} catch {
		// §8: nothing may throw out of a public function. The detail can reach the user, so it is
		// never the raw error text.
		return refuse('bad-value', 'The plugin cannot make this change. Edit the note text.');
	} finally {
		forgetRecall();
	}
};