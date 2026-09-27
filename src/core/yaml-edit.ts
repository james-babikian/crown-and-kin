import { isMap, isSeq, type Node } from 'yaml';
import { deriveFamilies } from './derive';
import type { AddHouse, ApplyOp, EditResult, FieldValue, NewPersonId, Op, PersonField, SetOption, SetPersonFields } from './edit';
import { deleteHouse, editHouse } from './house-ops';
import { uniqueId } from './id-gen';
import { rewriteLinks } from './link-rewrite';
import { parseBody, readTree, referencedIds } from './parse';
import { relationshipOp, removeStaleKeys } from './relationship-ops';
import { isEmpty, isMap as isRawMap, str, type Raw, type RawMap } from './tolerate';
import {
	addPair, addSection, appendItem, clone, findPair, finish, isRefusal, layoutOf, OPTION_ORDER, OVERLAP, PERSON_FIELDS, PERSON_ORDER, personNode, personValue,
	refuse, removePair, renderScalar, sameValue, setPairValue, Source, TEXT_FIELDS, topMap, type NewValue, type Parsed, type Patch, type Step,
} from './yaml-patch';

function setPersonFields(first: Parsed, op: SetPersonFields, data: RawMap, index: number): EditResult {
	const expected = clone(data) as RawMap;
	const person = (expected.people as RawMap[])[index];
	const steps: Step[] = [];
	// §4.1 order, so new keys that land on the same spot come out in that order.
	for (const field of PERSON_ORDER.filter((f): f is PersonField => (PERSON_FIELDS as readonly string[]).includes(f))) {
		if (!op.fields || !Object.prototype.hasOwnProperty.call(op.fields, field)) continue;
		const v = personValue(field, op.fields[field] as FieldValue);
		if (isRefusal(v)) return v;
		if (sameValue(field, person[field], v.write)) continue;
		if (v.write === null) delete person[field];
		else person[field] = v.write;
		const write = v.write;
		steps.push((p) => {
			const item = personNode(p, index);
			if (isRefusal(item)) return item;
			const pair = findPair(item, field);
			const layout = layoutOf(p.src);
			if (write === null) return pair ? removePair(p.src, item, pair) : null;
			const nv: NewValue = { scalar: write, old: pair?.value as Node | null, text: TEXT_FIELDS.has(field) };
			if (field === 'illegitimate') return pair ? setPairValue(p.src, item, pair, { ...nv, old: null, text: true }, layout) : addPair(p.src, item, field, { ...nv, text: true }, PERSON_ORDER, layout);
			return pair ? setPairValue(p.src, item, pair, nv, layout) : addPair(p.src, item, field, nv, PERSON_ORDER, layout);
		});
	}
	if (steps.length < 2) return finish(first, steps, expected, []);
	// All fields from one parse; if two changes touch the same text, one field at a time.
	const together: Step = (p) => {
		const patches: Patch[] = [];
		for (const step of steps) {
			const r = step(p);
			if (isRefusal(r)) return r;
			if (r) patches.push(...(Array.isArray(r) ? r : [r]));
		}
		return patches;
	};
	const r = finish(first, [together], expected, []);
	return !r.ok && r.detail === OVERLAP ? finish(first, steps, expected, []) : r;
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
	// Ids are text and the two numbers are meant as numbers: all four are written plain when they can be.
	const text = true;
	const step: Step = (p) => {
		const top = topMap(p);
		if (isRefusal(top)) return top;
		const layout = layoutOf(p.src);
		const optionsPair = top ? findPair(top, 'options') : undefined;
		const node = optionsPair?.value;
		if (!optionsPair || !isMap(node)) {
			if (write === null) return null;
			const line = `${key}: ${renderScalar(write, null, { flow: false, text, indent: '' })}`;
			const value: NewValue = { block: [' '.repeat(layout.mapIndent) + line], flow: `{${key}: ${renderScalar(write, null, { flow: true, text, indent: '' })}}` };
			if (optionsPair && top) return setPairValue(p.src, top, optionsPair, value, layout);
			return addSection(p, 'options', value);
		}
		const pair = findPair(node, key);
		if (write === null) {
			if (!pair) return null;
			if (node.items.length === 1 && top) return removePair(p.src, top, optionsPair);
			return removePair(p.src, node, pair);
		}
		const nv: NewValue = { scalar: write, old: pair?.value as Node | null, text };
		return pair ? setPairValue(p.src, node, pair, nv, layout) : addPair(p.src, node, key, nv, OPTION_ORDER, layout);
	};
	return finish(first, [step], expected, []);
}

/** The id `add-house` would give a new house with this name in this body (§6.8, house namespace). */
export function newHouseId(data: Raw, name: string): string {
	const taken = new Set<string>();
	const houses = (data as RawMap | null)?.houses;
	if (Array.isArray(houses)) for (const h of houses) {
		const id = str((h as RawMap | null)?.id);
		if (id !== undefined) taken.add(id);
	}
	return uniqueId(name, taken);
}

function addHouse(first: Parsed, op: AddHouse, data: RawMap): EditResult {
	if (typeof op.name !== 'string' || op.name.trim() === '') return refuse('bad-value', 'A house must have a name.');
	if (op.color !== undefined && typeof op.color !== 'string') return refuse('bad-value', 'The colour must be text.');
	const expected = clone(data ?? {}) as RawMap;
	if (!isEmpty(expected.houses) && !Array.isArray(expected.houses)) return refuse('bad-value', 'The houses section is not a list.');
	const id = newHouseId(expected, op.name);
	const house: RawMap = { id, name: op.name };
	const color = op.color?.trim() ? op.color : undefined;
	if (color !== undefined) house.color = color;
	expected.houses = [...(Array.isArray(expected.houses) ? expected.houses : []), house];

	const entries: [string, string, boolean][] = [
		['id', id, true],
		['name', op.name, false],
	];
	if (color !== undefined) entries.push(['color', color, false]);
	const step: Step = (p) => {
		const top = topMap(p);
		if (isRefusal(top)) return top;
		const layout = layoutOf(p.src);
		const block = entries.map(([k, v, text]) => `${k}: ${renderScalar(v, null, { flow: false, text, indent: '' })}`);
		const flow = `{${entries.map(([k, v, text]) => `${k}: ${renderScalar(v, null, { flow: true, text, indent: '' })}`).join(', ')}}`;
		const housesPair = top ? findPair(top, 'houses') : undefined;
		const node = housesPair?.value;
		if (isSeq(node) && (node.items.length || node.flow)) return appendItem(p.src, node, block, flow);
		const pad = ' '.repeat(layout.seqIndent);
		const itemPad = ' '.repeat(layout.seqIndent + layout.itemIndent);
		const value: NewValue = { block: block.map((l, n) => (n === 0 ? `${pad}- ${l}` : itemPad + l)), flow: `[${flow}]` };
		if (housesPair && top) return setPairValue(p.src, top, housesPair, value, layout);
		return addSection(p, 'houses', value);
	};
	return finish(first, [step], expected, [id]);
}

/**
 * The id a new person with this name gets (§6.8, person namespace): unused by any person and by
 * any reference, so a dangling reference is never filled by accident.
 */
export const newPersonId: NewPersonId = (body, name) => {
	try {
		const parsed = typeof body === 'string' ? parseBody(body) : null;
		const taken = parsed?.ok && isRawMap(parsed.data) ? referencedIds(parsed.data) : new Set<string>();
		return uniqueId(typeof name === 'string' ? name : '', taken);
	} catch {
		return uniqueId('', new Set());
	}
};

/** `keepStale`: inside a batch, keys left stale are judged once, on the batch's final data. */
function applyOne(body: string, op: Op, keepStale = false): EditResult {
	if (op === null || typeof op !== 'object') return refuse('bad-value');
	if (op.kind === 'batch') {
		let current = body;
		const created: string[] = [];
		const effects: ('auto-union')[] = [];
		let changed: number | undefined;
		for (const inner of Array.isArray(op.ops) ? op.ops : []) {
			const r = applyOne(current, inner, true);
			if (!r.ok) return r;
			current = r.body;
			created.push(...r.created);
			for (const e of r.effects ?? []) if (!effects.includes(e)) effects.push(e);
			if (r.changed !== undefined) changed = (changed ?? 0) + r.changed;
		}
		if (!keepStale && current !== body) {
			const clean = removeStaleKeys(body, current);
			if (!clean.ok) return clean;
			current = clean.body;
		}
		const out: EditResult = { ok: true, body: current, created };
		if (changed !== undefined) out.changed = changed;
		if (effects.length) out.effects = effects;
		return out;
	}
	const parsed = parseBody(body);
	if (!parsed.ok) return refuse('invalid-yaml', parsed.error.detail ?? parsed.error.code);
	// §6.9: renames also update a tree that is blocked for editing; only `link` values change.
	if (op.kind === 'rewrite-links') return rewriteLinks({ src: new Source(body, parsed.doc), data: parsed.data }, (isEmpty(parsed.data) ? {} : parsed.data) as RawMap, op);
	const tree = readTree(parsed.doc, parsed.data, body);
	const g = deriveFamilies(tree);
	if (g.issues.some((i) => i.level === 'blocking')) return refuse('blocked');
	const data = (isEmpty(parsed.data) ? {} : parsed.data) as RawMap;
	const first: Parsed = { src: new Source(body, parsed.doc), data: parsed.data };
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
		default:
			return refuse('bad-value', 'Unknown edit.');
	}
}

export const applyOp: ApplyOp = (body, op) => {
	try {
		if (typeof body !== 'string') return refuse('invalid-yaml');
		return applyOne(body, op);
	} catch {
		// §8: nothing may throw out of a public function. The detail can reach the user, so it is
		// never the raw error text.
		return refuse('bad-value', 'The plugin cannot make this change. Edit the note text.');
	}
};