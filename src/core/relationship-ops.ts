/*
 * Relationship ops (spec §6.2–§6.7), on top of the patch-and-check machinery in `yaml-patch.ts`:
 * every op builds the expected data (old data plus exactly the intended change), patches the text
 * at the parse positions, and `finish` re-parses and compares. Nothing here re-stringifies a node.
 * `yaml-edit.ts` dispatches each `Op` to the matching function here through `relationshipOp`.
 */

import { isAlias, isMap, isScalar, isSeq, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import { deriveFamilies, type FamilyGraph } from './derive';
import type {
	AddParent, AddPerson, AddUnion, DeletePerson, EditResult, EditUnion, MoveSibling, ParentKind, PersonField, Placement, RemoveParent, RemoveUnion, SetParentType, UnionRef,
} from './edit';
import { descendantsOf, siblingGroup, writtenParents } from './family-query';
import { newIdIn } from './id-gen';
import { parseBody, readTree, textWithoutComments } from './parse';
import { dropHolderPatches, dropHolders, dropIdPatches, dropIds } from './title-ops';
import { isEmpty, isMap as isRawMap, list, str, unwrapCurly, type Raw, type RawMap } from './tolerate';
import { isParentType, isPlacementType, isUnionType, PARENT_LIMIT, parentKind, PLACEMENT_TYPES, type Tree } from './types';
import { dashOf, flowComment, insertItem, itemEnd, itemStart, removeFromSection, removeItems, section, type Where } from './yaml-list';
import {
	addPair, clone, commentsOf, doubleQuoted, findPair, finish, finishTogether, flowInsertAfter, insertAt, isBooleanField, isRefusal, layoutOf, PERSON_FIELDS, PERSON_ORDER, personNode, personValue,
	QUOTED_FIELDS, refuse, removePair, renderScalar, setPairValue, TEXT_FIELDS, topMap, type Parsed, type Patch, type Refusal, Source, type Step,
} from './yaml-patch';
import { REFUSAL_TEXT } from './refusal-text';

/** The parsed body, its family graph, and other state a relationship op needs to run. */
export interface OpContext {
	first: Parsed;
	data: RawMap;
	tree: Tree;
	g: FamilyGraph;
	/** Inside a batch: stale keys are left for `removeStaleKeys` on the batch's final data. */
	keepStale?: boolean;
}

export const UNION_ORDER = ['id', 'partners', 'type', 'start', 'end'];
const flowText = (v: string) => renderScalar(v, null, { flow: true, text: true, indent: '' });

function done(r: EditResult, effects: 'auto-union'[] = []): EditResult {
	return r.ok && effects.length ? { ...r, effects } : r;
}

function unionNode(p: Parsed, index: number): YAMLMap | Refusal {
	const s = section(p, 'unions');
	const item = s?.seq.items[index];
	if (isAlias(item)) return refuse('bad-value', 'This partnership is written as a YAML alias. Edit the note text.');
	if (!isMap(item)) return refuse('unknown-union');
	return item;
}

// ---------------------------------------------------------------------------------------------
// Reading what is written

/** A person or partner the op may write as a reference: in the tree, under the id written in the block. */
function refIndex(ctx: OpContext, id: unknown): number | undefined {
	if (typeof id !== 'string') return undefined;
	const person = ctx.g.byId.get(id);
	if (!person) return undefined;
	const raw = (ctx.data.people as Raw[])[person.index];
	return str((raw as RawMap | null)?.id) === id ? person.index : undefined;
}

/** A person the op acts on (an id-less person is found by its generated id). */
const personIndex = (ctx: OpContext, id: unknown): number | undefined => (typeof id === 'string' ? ctx.g.byId.get(id)?.index : undefined);

interface Entry {
	index: number;
	id: string | undefined;
	type: ParentKind;
	node: Node;
}

/** The parent entries of a person's item as written: a list, or a single id where a list was expected. */
function parentEntries(p: Parsed, item: YAMLMap): { pair?: Pair; seq?: YAMLSeq; entries: Entry[] } {
	const pair = findPair(item, 'parents');
	const v = pair?.value as Node | null | undefined;
	const read = (node: Node, index: number): Entry => {
		const n = isAlias(node) ? (node.resolve(p.src.doc) as Node | undefined) ?? node : node;
		// The id is read as `parse.ts` reads it, with a curly pair taken off (D103); the entry's text is never rewritten.
		if (isMap(n)) return { index, id: str(unwrapCurly(n.get('id'))), type: parentKind(str(n.get('type'))), node };
		return { index, id: isScalar(n) ? str(unwrapCurly(n.value)) : undefined, type: 'birth', node };
	};
	if (isSeq(v)) return { pair, seq: v, entries: v.items.map((it, i) => read(it as Node, i)) };
	if ((isScalar(v) && !isEmpty(v.value)) || isMap(v)) return { pair, entries: [read(v, 0)] };
	return { pair, entries: [] };
}

/** The raw parents of a person as a list (a single id becomes a one-item list). */
const rawParents = (person: RawMap): Raw[] => (Array.isArray(person.parents) ? [...person.parents] : isEmpty(person.parents) ? [] : [person.parents]);

/** A parent entry in the §4.2 write form. */
function entryText(id: string, type: ParentKind): string {
	return type === 'birth' ? flowText(id) : `{id: ${flowText(id)}, type: ${type}}`;
}
const entryRaw = (id: string, type: ParentKind): Raw => (type === 'birth' ? id : { id, type });

/** A listed union matching a `UnionRef`, or `unknown-union`. */
function resolveUnion(ctx: OpContext, ref: UnionRef | undefined): number | Refusal {
	if (!ref || typeof ref !== 'object' || !Number.isInteger(ref.index) || !Array.isArray(ref.partners) || ref.partners.length !== 2) return refuse('unknown-union');
	const u = ctx.tree.unions.find((x) => x.index === ref.index);
	if (!u || u.partners.length !== 2) return refuse('unknown-union');
	const [a, b] = ref.partners;
	const same = (u.partners[0] === a && u.partners[1] === b) || (u.partners[0] === b && u.partners[1] === a);
	// The text tells apart two unions of one couple when an old index now points at the other.
	const text = ref.text === undefined || (typeof ref.text === 'string' && (ref.text === u.text || textWithoutComments(ref.text) === u.text));
	return same && text ? u.index : refuse('unknown-union');
}

/** The union id `add-union` gives an existing union that needs one (§6.8, union namespace). */
function newUnionId(ctx: OpContext, partners: string[]): string {
	return newIdIn(ctx.data.unions, partners.join(' '));
}

// ---------------------------------------------------------------------------------------------
// Writing maps

type FieldChange = { key: string; write: string | null; text: boolean };

/** Patches for key changes on one map, in `order`. */
function mapPatches(src: Source, map: YAMLMap, changes: FieldChange[], order: string[]): Patch[] {
	const layout = layoutOf(src);
	const out: Patch[] = [];
	for (const c of changes) {
		const pair = findPair(map, c.key);
		if (c.write === null) {
			if (pair) out.push(removePair(src, map, pair));
			continue;
		}
		const nv = { scalar: c.write, old: pair?.value as Node | null, text: c.text };
		out.push(pair ? setPairValue(src, map, pair, nv, layout) : addPair(src, map, c.key, nv, order, layout));
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Ops

function addPerson(ctx: OpContext, op: AddPerson): EditResult {
	const { data, tree } = ctx;
	if (typeof op.id !== 'string' || str(op.id) !== op.id) return refuse('bad-value', REFUSAL_TEXT.newIdText);
	if (tree.people.some((p) => p.id === op.id)) return refuse('id-taken');
	if (!isEmpty(data.people) && !Array.isArray(data.people)) return refuse('bad-value', 'The people section is not a list.');

	const fields = op.fields ?? {};
	if (!Object.prototype.hasOwnProperty.call(fields, 'name')) return refuse('bad-value', REFUSAL_TEXT.personName);
	const values = new Map<string, string>();
	for (const field of PERSON_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
		const v = personValue(field, fields[field as PersonField] ?? null);
		if (isRefusal(v)) return v;
		if (v.write !== null) values.set(field, v.write);
	}

	const parents = Array.isArray(op.parents) ? op.parents : [];
	const seen = new Set<string>();
	for (const r of parents) {
		if (!r || refIndex(ctx, r.id) === undefined) return refuse('unknown-person', typeof r?.id === 'string' ? r.id : undefined);
		if (!isParentType(r.type)) return refuse('bad-value', REFUSAL_TEXT.unknownParentType);
		if (seen.has(`${r.id}\0${r.type}`)) return refuse('bad-value', 'The same parent is given twice.');
		seen.add(`${r.id}\0${r.type}`);
		if (parents.filter((x) => x.type === r.type).length > PARENT_LIMIT[r.type]) return refuse('limit');
	}

	const where = placement(ctx, op.at);
	if (isRefusal(where)) return where;

	const expected = clone(data) as RawMap;
	// A child for a union that is not the pair's last-listed one names it (§4.3; the decision notes).
	const chosen = op.at?.kind === 'after-siblings' ? op.at.union : undefined;
	// `placement` checked the ref against the union, so its partners are the union's partners.
	const named = chosen === undefined ? undefined : unionToName(ctx, chosen.index, chosen.partners);
	if (named) {
		if (named.addId) (expected.unions as RawMap[])[chosen!.index].id = named.id;
		values.set('union', named.id);
	}

	const person: RawMap = { id: op.id };
	const render = (key: string, v: string, flow: boolean) => (QUOTED_FIELDS.has(key) ? doubleQuoted(v) : renderScalar(v, null, { flow, text: TEXT_FIELDS.has(key) || isBooleanField(key), indent: '' }));
	const blockValue = (key: string, v: string) => render(key, v, false);
	const flowValue = (key: string, v: string) => render(key, v, true);
	const block: string[] = [`id: ${blockValue('id', op.id)}`];
	const flowParts: string[] = [`id: ${flowValue('id', op.id)}`];
	for (const key of PERSON_ORDER) {
		if (key === 'id') continue;
		if (key === 'parents') {
			if (!parents.length) continue;
			const text = `[${parents.map((r) => entryText(r.id, r.type)).join(', ')}]`;
			person.parents = parents.map((r) => entryRaw(r.id, r.type));
			block.push(`parents: ${text}`);
			flowParts.push(`parents: ${text}`);
			continue;
		}
		const v = values.get(key);
		if (v === undefined) continue;
		person[key] = v;
		block.push(`${key}: ${blockValue(key, v)}`);
		flowParts.push(`${key}: ${flowValue(key, v)}`);
	}

	const list = Array.isArray(expected.people) ? (expected.people as Raw[]) : [];
	const at = where === null ? list.length : 'after' in where ? where.after + 1 : where.before;
	list.splice(at, 0, person);
	expected.people = list;
	const step: Step = (p) => {
		const item = insertItem(p, 'people', where, block, `{${flowParts.join(', ')}}`);
		if (isRefusal(item) || !named?.addId) return item;
		const node = unionNode(p, chosen!.index);
		return isRefusal(node) ? node : [item, ...mapPatches(p.src, node, [{ key: 'id', write: named.id, text: true }], UNION_ORDER)];
	};
	return finish(ctx.first, [step], expected, [op.id]);
}

/** Where a new person goes (§6.2), as a position in `people`. */
function placement(ctx: OpContext, at: Placement | undefined): Where | Refusal {
	if (at === undefined || at === null) return null;
	const { g } = ctx;
	if (at.kind === 'before' || at.kind === 'after') {
		const i = personIndex(ctx, at.id);
		if (i === undefined) return refuse('unknown-person', typeof at.id === 'string' ? at.id : undefined);
		return at.kind === 'before' ? { before: i } : { after: i };
	}
	if (at.kind !== 'after-siblings') return refuse('bad-value', 'Unknown position.');
	const parents = Array.isArray(at.parents) ? at.parents : [];
	if (parents.length < 1 || parents.length > 2 || parents.some((id) => personIndex(ctx, id) === undefined)) return refuse('unknown-person');
	let unionKey: string | undefined;
	if (at.union !== undefined) {
		const u = resolveUnion(ctx, at.union);
		if (isRefusal(u)) return u;
		unionKey = `u${u}`;
	}
	const want = [...new Set(parents)].sort().join('\0');
	let last: number | undefined;
	for (const p of g.people) {
		const placed = g.placementParents.get(p.id) ?? [];
		if ([...placed].sort().join('\0') !== want) continue;
		if (unionKey !== undefined && placed.length === 2 && g.primaryUnion.get(p.id) !== unionKey) continue;
		last = p.index;
	}
	if (last === undefined) last = Math.max(...parents.map((id) => personIndex(ctx, id)!));
	return { after: last };
}

function addParent(ctx: OpContext, op: AddParent): EditResult {
	const { g, data } = ctx;
	const childIndex = personIndex(ctx, op.child);
	if (childIndex === undefined || refIndex(ctx, op.parent) === undefined) return refuse('unknown-person');
	if (!isParentType(op.type)) return refuse('bad-value', REFUSAL_TEXT.unknownParentType);
	if (op.parent === op.child || descendantsOf(g, op.child).has(op.parent)) return refuse('cycle');
	const current = writtenParents(g, op.child);
	const same = current.filter((r) => r.type === op.type);
	if (same.some((r) => r.id === op.parent)) return refuse('bad-value', REFUSAL_TEXT.alreadyParent);
	if (same.length >= PARENT_LIMIT[op.type]) return refuse('limit');
	const chosen = op.union === undefined ? undefined : resolveUnion(ctx, op.union);
	if (isRefusal(chosen)) return chosen;

	const expected = clone(data) as RawMap;
	const person = (expected.people as RawMap[])[childIndex];
	person.parents = [...rawParents(person), entryRaw(op.parent, op.type)];

	// §6.4: two birth or two adoptive parents with no union between them get a marriage.
	const other = same[0]?.id;
	const auto = op.autoUnion !== false && (op.type === 'birth' || op.type === 'adoptive') && other !== undefined && !g.unions.some((u) => !u.implicit && u.partners.includes(other) && u.partners.includes(op.parent));
	if (auto) expected.unions = [...(Array.isArray(expected.unions) ? expected.unions : []), { partners: [other, op.parent], type: 'marriage' }];
	// A new parent can change the placement parents, so `union:` may no longer name their union.
	let stale = staleKeys(ctx, expected, [childIndex]);

	// A chosen union that is not the pair's last-listed one is named on the child (§4.3).
	const named = chosen === undefined ? undefined : unionToName(ctx, chosen, placedFrom(person, parentsByType(person, op.child, (id): id is string => id !== undefined && g.byId.has(id))));
	if (named) {
		stale = stale.filter((s) => s.key !== 'union');
		person.union = named.id;
		if (named.addId) (expected.unions as RawMap[])[chosen!].id = named.id;
	}

	const step: Step = (p) => {
		const item = personNode(p, childIndex);
		if (isRefusal(item)) return item;
		const patch = appendParent(p, item, op.parent, op.type);
		if (isRefusal(patch)) return patch;
		const keys = staleKeyPatches(p, stale);
		if (isRefusal(keys)) return keys;
		const patches = [patch, ...keys];
		if (named) {
			patches.push(...mapPatches(p.src, item, [{ key: 'union', write: named.id, text: true }], PERSON_ORDER));
			if (named.addId) {
				const node = unionNode(p, chosen!);
				if (isRefusal(node)) return node;
				patches.push(...mapPatches(p.src, node, [{ key: 'id', write: named.id, text: true }], UNION_ORDER));
			}
		}
		if (!auto) return patches;
		const union = insertUnion(p, [other!, op.parent], 'marriage');
		return isRefusal(union) ? union : [...patches, union];
	};
	return done(finish(ctx.first, [step], expected, []), auto ? ['auto-union'] : []);
}

/**
 * The id to write as `union:` for a child placed under the listed union at `index`: only when the
 * placement parents are exactly its partners and it is not the pair's last-listed union (which
 * a child gets without a key). `addId`: the union has no id yet (§6.8 union namespace).
 */
function unionToName(ctx: OpContext, index: number, placed: string[]): { id: string; addId: boolean } | undefined {
	const fu = ctx.g.unionByKey.get(`u${index}`);
	if (!fu || fu.unionIndex === undefined || placed.length !== 2 || !placed.every((id) => fu.partners.includes(id))) return undefined;
	const listed = ctx.g.unions.filter((u) => !u.implicit && u.partners.includes(fu.partners[0]) && u.partners.includes(fu.partners[1]));
	if (listed[listed.length - 1] === fu) return undefined;
	return fu.id !== undefined ? { id: fu.id, addId: false } : { id: newUnionId(ctx, fu.partners), addId: true };
}

/** Adds one entry to a person's `parents`, keeping the list's style; a new list is a flow sequence (§4.2). */
function appendParent(p: Parsed, item: YAMLMap, id: string, type: ParentKind): Patch | Refusal {
	const src = p.src;
	const layout = layoutOf(src);
	const entry = entryText(id, type);
	const { pair, seq, entries } = parentEntries(p, item);
	if (seq) {
		if (seq.flow) {
			if (!seq.items.length) return insertAt(src.text.indexOf('[', seq.range![0]) + 1, entry);
			return flowInsertAfter(src, seq, seq.items.length - 1, [entry]);
		}
		const dashCol = src.column(dashOf(src, seq.items[0] as Node));
		return insertAt(itemEnd(src, seq, seq.items.length - 1), '\n' + ' '.repeat(dashCol) + '- ' + entry);
	}
	if (pair && entries.length) {
		// A single entry where a list was expected becomes a list.
		const old = flowEntryText(src, entries[0]);
		if (old === null) return refuse('bad-value', 'The parents of this person are written in a form the plugin cannot extend. Edit the note text.');
		return setPairValue(src, item, pair, { raw: `[${old}, ${entry}]` }, layout);
	}
	if (pair) return setPairValue(src, item, pair, { raw: `[${entry}]` }, layout);
	return addPair(src, item, 'parents', { raw: `[${entry}]` }, PERSON_ORDER, layout);
}

/** Appends a union item with keys in §4.1 order. */
function insertUnion(p: Parsed, partners: string[], type?: string, start?: string, end?: string): Patch | Refusal {
	const block = [`partners: [${partners.map(flowText).join(', ')}]`];
	if (type !== undefined) block.push(`type: ${type}`);
	const flow = [...block];
	for (const [k, v] of [['start', start], ['end', end]] as const) {
		if (v === undefined) continue;
		block.push(`${k}: ${renderScalar(v, null, { flow: false, text: true, indent: '' })}`);
		flow.push(`${k}: ${renderScalar(v, null, { flow: true, text: true, indent: '' })}`);
	}
	return insertItem(p, 'unions', null, block, `{${flow.join(', ')}}`);
}

function addUnion(ctx: OpContext, op: AddUnion): EditResult {
	const { g, data } = ctx;
	const partners = Array.isArray(op.partners) ? op.partners : [];
	if (partners.length !== 2 || partners.some((id) => refIndex(ctx, id) === undefined)) return refuse('unknown-person');
	const [a, b] = partners;
	if (a === b) return refuse('bad-value', 'A partnership needs two different people.');
	// No type given: none is written (marriage is the default, §4.1).
	const type = op.type;
	if (type !== undefined && !isUnionType(type)) return refuse('bad-value', REFUSAL_TEXT.unknownUnionType);
	const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
	if ((op.start !== undefined && typeof op.start !== 'string') || (op.end !== undefined && typeof op.end !== 'string')) return refuse('bad-value');
	const start = text(op.start);
	const end = text(op.end);

	const expected = clone(data) as RawMap;
	if (!isEmpty(expected.unions) && !Array.isArray(expected.unions)) return refuse('bad-value', 'The unions section is not a list.');
	const unions = Array.isArray(expected.unions) ? (expected.unions as RawMap[]) : [];

	// The decision notes "Second union for a couple": the children of the pair's last-listed union keep it.
	const listed = g.unions.filter((u) => !u.implicit && u.partners.includes(a) && u.partners.includes(b));
	const last = listed[listed.length - 1];
	let unionId: string | undefined;
	let addId = false;
	const keep: number[] = [];
	// A union with no children needs no id (the decision notes "Relationship-op details").
	if (last && last.unionIndex !== undefined && last.children.length) {
		unionId = last.id;
		if (unionId === undefined) {
			unionId = newUnionId(ctx, last.partners);
			addId = true;
			unions[last.unionIndex].id = unionId;
		}
		for (const child of last.children) {
			const person = g.byId.get(child)!;
			if (person.union === unionId) continue;
			keep.push(person.index);
			(expected.people as RawMap[])[person.index].union = unionId;
		}
	}
	const item: RawMap = { partners: [a, b] };
	if (type !== undefined) item.type = type;
	if (start !== undefined) item.start = start;
	if (end !== undefined) item.end = end;
	unions.push(item);
	expected.unions = unions;

	const step: Step = (p) => {
		const patches: Patch[] = [];
		if (last?.unionIndex !== undefined && addId) {
			const node = unionNode(p, last.unionIndex);
			if (isRefusal(node)) return node;
			patches.push(...mapPatches(p.src, node, [{ key: 'id', write: unionId!, text: true }], UNION_ORDER));
		}
		for (const index of keep) {
			const node = personNode(p, index);
			if (isRefusal(node)) return node;
			patches.push(...mapPatches(p.src, node, [{ key: 'union', write: unionId!, text: true }], PERSON_ORDER));
		}
		const union = insertUnion(p, [a, b], type, start, end);
		if (isRefusal(union)) return union;
		patches.push(union);
		return patches;
	};
	return finish(ctx.first, [step], expected, []);
}

function editUnion(ctx: OpContext, op: EditUnion): EditResult {
	const index = resolveUnion(ctx, op.union);
	if (isRefusal(index)) return index;
	const expected = clone(ctx.data) as RawMap;
	const union = (expected.unions as RawMap[])[index];
	const changes: FieldChange[] = [];
	const fields = op.fields ?? {};
	for (const key of ['type', 'start', 'end'] as const) {
		const v = fields[key];
		if (v === undefined) continue;
		if (v !== null && typeof v !== 'string') return refuse('bad-value');
		const write = v === null || v.trim() === '' ? null : v;
		if (key === 'type' && write !== null && !isUnionType(write)) return refuse('bad-value', REFUSAL_TEXT.unknownUnionType);
		if ((write === null && union[key] === undefined) || (write !== null && str(union[key]) === str(write))) continue;
		if (write === null) delete union[key];
		else union[key] = write;
		changes.push({ key, write, text: key !== 'type' });
	}
	if (!changes.length) return { ok: true, body: ctx.first.src.text, created: [] };
	const change = (c: FieldChange): Step => (p) => {
		const node = unionNode(p, index);
		return isRefusal(node) ? node : mapPatches(p.src, node, [c], UNION_ORDER);
	};
	return finishTogether(ctx.first, changes.map(change), expected, []);
}

/**
 * Removes, in the expected data, the `union:` keys that name a union about to be removed
 * (the decision notes "Relationship-op details"). Returns the people (by index) whose key goes.
 */
function dropUnionKeys(expected: RawMap, removed: Set<number>, skip?: number): number[] {
	const unions = Array.isArray(expected.unions) ? (expected.unions as Raw[]) : [];
	const ids = new Set<string>();
	for (const k of removed) {
		const id = str((unions[k] as RawMap | null)?.id);
		if (id !== undefined) ids.add(id);
	}
	// Another union with the same id keeps its children (duplicate union ids block editing anyway).
	unions.forEach((u, k) => {
		const id = str((u as RawMap | null)?.id);
		if (!removed.has(k) && id !== undefined) ids.delete(id);
	});
	const out: number[] = [];
	if (!ids.size) return out;
	(Array.isArray(expected.people) ? (expected.people as Raw[]) : []).forEach((raw, k) => {
		if (k === skip || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
		const u = str((raw as RawMap).union);
		if (u === undefined || !ids.has(u)) return;
		delete (raw as RawMap).union;
		out.push(k);
	});
	return out;
}

function unionKeyPatches(p: Parsed, people: number[]): Patch[] | Refusal {
	const out: Patch[] = [];
	for (const k of people) {
		const node = personNode(p, k);
		if (isRefusal(node)) return node;
		const pair = findPair(node, 'union');
		if (pair) out.push(removePair(p.src, node, pair));
	}
	return out;
}

type StaleKey = { index: number; key: 'placement' | 'union' };

/** A person's parents in raw data, by type (§4.3 reading): existing people only, each once. */
function parentsByType(raw: RawMap, self: string, exists: (id: string | undefined) => id is string): Map<string, string[]> {
	const byType = new Map<string, string[]>();
	for (const e of rawParents(raw)) {
		const isEntryMap = !!e && typeof e === 'object' && !Array.isArray(e);
		const id = str(isEntryMap ? (e as RawMap).id : e);
		if (!exists(id) || id === self) continue;
		const type = parentKind(isEntryMap ? str((e as RawMap).type) : undefined);
		const ids = byType.get(type) ?? [];
		if (!ids.includes(id)) ids.push(id);
		byType.set(type, ids);
	}
	return byType;
}

/** Placement parents from raw data (§4.3): the `placement` type if it has parents, else birth, adoptive, ward. */
function placedFrom(raw: RawMap, byType: Map<string, string[]>): string[] {
	const named = str(raw.placement);
	const type = (isPlacementType(named) && byType.has(named) ? named : undefined) ?? PLACEMENT_TYPES.find((t) => byType.has(t));
	return type ? byType.get(type)!.slice(0, 2) : [];
}

/**
 * Keys a change to parent links leaves stale (the decision notes "Relationship-op details"): `placement`
 * when the person no longer has a parent of that type, and `union` when it no longer names a union
 * of their placement parents. Only keys that were valid before the op go. `expected` is the data
 * after the op; the keys are removed from it here. `gone` is a person being deleted.
 */
function staleKeys(ctx: OpContext, expected: RawMap, people: Iterable<number>, gone?: string): StaleKey[] {
	const { g } = ctx;
	if (ctx.keepStale) return [];
	const exists = (id: string | undefined): id is string => id !== undefined && id !== gone && g.byId.has(id);
	const unions = (Array.isArray(expected.unions) ? (expected.unions as Raw[]) : []).filter((u): u is RawMap => !!u && typeof u === 'object' && !Array.isArray(u));
	const out: StaleKey[] = [];
	for (const index of people) {
		const person = ctx.tree.people.find((p) => p.index === index);
		const raw = (expected.people as Raw[] | undefined)?.[index] as RawMap | undefined;
		if (!person || !raw || g.byId.get(person.id) !== person) continue;
		const byType = parentsByType(raw, person.id, exists);
		const before = writtenParents(g, person.id);
		const placement = str(raw.placement);
		if (placement !== undefined && before.some((r) => r.type === placement) && !byType.has(placement)) {
			delete raw.placement;
			out.push({ index, key: 'placement' });
		}
		const unionId = str(raw.union);
		const primary = g.primaryUnion.get(person.id);
		if (unionId === undefined || primary === undefined || g.unionByKey.get(primary)?.id !== unionId) continue;
		const placed = placedFrom(raw, byType);
		const named = unions.some((u) => {
			const partners = list(u.partners).map(str);
			return str(u.id) === unionId && placed.length === 2 && partners.length === 2 && placed.every((id) => partners.includes(id));
		});
		if (!named) {
			delete raw.union;
			out.push({ index, key: 'union' });
		}
	}
	return out;
}

/** The `placement` and `union` values of a person that are valid in this graph. */
function validKeys(g: FamilyGraph, id: string): { placement?: string; union?: string } {
	const person = g.byId.get(id);
	const out: { placement?: string; union?: string } = {};
	if (!person) return out;
	if (person.placement !== undefined && writtenParents(g, id).some((r) => r.type === person.placement)) out.placement = person.placement;
	const key = g.primaryUnion.get(id);
	if (person.union !== undefined && key !== undefined && g.unionByKey.get(key)?.id === person.union) out.union = person.union;
	return out;
}

/**
 * The stale-key rule for a batch, judged once on its final data: a `placement` or `union` that
 * was valid before the batch, still has the same value, and is stale after it goes. A key the
 * batch set itself, or that ends up valid again, stays.
 */
export function removeStaleKeys(before: string, after: string): EditResult {
	const unchanged: EditResult = { ok: true, body: after, created: [] };
	const a = parseBody(before);
	const b = parseBody(after);
	if (!a.ok || !b.ok || !isRawMap(b.data)) return unchanged;
	const ga = deriveFamilies(readTree(a.doc, a.data, before));
	const gb = deriveFamilies(readTree(b.doc, b.data, after));
	const expected = clone(b.data) as RawMap;
	const stale: StaleKey[] = [];
	// People are matched by the id written in the block: a generated id (`~3`) follows the list
	// position, so it can name someone else after the batch added or removed a person above.
	const written = (data: Raw, p: { id: string; index: number } | undefined) =>
		!!p && str(((isRawMap(data) && Array.isArray(data.people) ? data.people : [])[p.index] as RawMap | null)?.id) === p.id;
	for (const person of gb.people) {
		if (!written(b.data, person) || !written(a.data, ga.byId.get(person.id))) continue;
		const was = validKeys(ga, person.id);
		if (was.placement === undefined && was.union === undefined) continue;
		const now = validKeys(gb, person.id);
		for (const key of ['placement', 'union'] as const) {
			if (was[key] === undefined || person[key] !== was[key] || now[key] !== undefined) continue;
			stale.push({ index: person.index, key });
			delete ((expected.people as RawMap[])[person.index] as RawMap)[key];
		}
	}
	if (!stale.length) return unchanged;
	const first: Parsed = { src: new Source(after, b.doc), data: b.data };
	return finish(first, [(p) => staleKeyPatches(p, stale)], expected, []);
}

function staleKeyPatches(p: Parsed, keys: StaleKey[]): Patch[] | Refusal {
	const out: Patch[] = [];
	for (const { index, key } of keys) {
		const node = personNode(p, index);
		if (isRefusal(node)) return node;
		const pair = findPair(node, key);
		if (pair) out.push(removePair(p.src, node, pair));
	}
	return out;
}

function removeUnion(ctx: OpContext, op: RemoveUnion): EditResult {
	const index = resolveUnion(ctx, op.union);
	if (isRefusal(index)) return index;
	const expected = clone(ctx.data) as RawMap;
	const unionKeys = dropUnionKeys(expected, new Set([index]));
	const unions = expected.unions as Raw[];
	unions.splice(index, 1);
	if (unions.length === 0) delete expected.unions;
	const step: Step = (p) => {
		const node = unionNode(p, index);
		if (isRefusal(node)) return node;
		const keys = unionKeyPatches(p, unionKeys);
		return isRefusal(keys) ? keys : [...removeFromSection(p, 'unions', new Set([index])), ...keys];
	};
	return finish(ctx.first, [step], expected, []);
}

/** The text of the id as typed in an entry. */
function idTextOf(src: Source, node: Node): string {
	const id = isMap(node) ? (node.get('id', true) as Node) : node;
	return src.text.slice(id.range![0], src.nodeEnd(id));
}

/** A map entry with only `id` and `type` and no comments, which the §4.2 forms can hold. */
function plainEntry(src: Source, node: Node): boolean {
	if (isScalar(node)) return true;
	if (!isMap(node)) return false;
	const keys = (node.items as Pair[]).every((pr) => ['id', 'type'].includes(str((pr.key as { value?: unknown })?.value) ?? ''));
	return keys && commentsOf(src.text.slice(node.range![0], src.nodeEnd(node))).length === 0;
}

/** An entry as one-line flow text: as typed if it is already flow, in the §4.2 form if it is a plain block map. */
function flowEntryText(src: Source, e: Entry): string | null {
	const node = e.node;
	if (isScalar(node) || (isMap(node) && node.flow)) return src.text.slice(node.range![0], src.nodeEnd(node));
	if (plainEntry(src, node)) return e.type === 'birth' ? idTextOf(src, node) : `{id: ${idTextOf(src, node)}, type: ${e.type}}`;
	return null;
}

function matchingEntries(p: Parsed, item: YAMLMap, parent: string, type: ParentKind) {
	const found = parentEntries(p, item);
	return { ...found, match: found.entries.filter((e) => e.id === parent && e.type === type) };
}

function setParentType(ctx: OpContext, op: SetParentType): EditResult {
	const childIndex = personIndex(ctx, op.child);
	if (childIndex === undefined || typeof op.parent !== 'string') return refuse('unknown-person');
	if (!isParentType(op.from) || !isParentType(op.to)) return refuse('bad-value', REFUSAL_TEXT.unknownParentType);
	const item = personNode(ctx.first, childIndex);
	if (isRefusal(item)) return item;
	const { match, seq, pair } = matchingEntries(ctx.first, item, op.parent, op.from);
	if (!match.length) return refuse('bad-value', `${op.parent} is not a ${op.from} parent.`);
	if (op.from === op.to) return { ok: true, body: ctx.first.src.text, created: [] };
	const current = writtenParents(ctx.g, op.child).filter((r) => r.type === op.to);
	if (current.some((r) => r.id === op.parent)) return refuse('bad-value', REFUSAL_TEXT.alreadyParent);
	if (current.length >= PARENT_LIMIT[op.to]) return refuse('limit');

	const src = ctx.first.src;
	const expected = clone(ctx.data) as RawMap;
	const person = (expected.people as RawMap[])[childIndex];
	const raw = rawParents(person);
	const patches: Patch[] = [];
	// A single entry where a list was expected stays single only when it keeps its form.
	let single = !seq;
	for (const e of match) {
		const node = e.node;
		if (isAlias(node)) return refuse('bad-value', 'This parent is written as a YAML alias. Edit the note text.');
		if (plainEntry(src, node)) {
			// Rewritten in the §4.2 form, keeping the id as it was typed.
			const idText = idTextOf(src, node);
			const text = op.to === 'birth' ? idText : `{id: ${idText}, type: ${op.to}}`;
			if (seq) patches.push({ start: node.range![0], end: src.nodeEnd(node), text });
			else patches.push(setPairValue(src, item, pair!, { raw: `[${text}]` }, layoutOf(src)));
			raw[e.index] = entryRaw(op.parent, op.to);
			single = false;
		} else if (isMap(node)) {
			// A map with other keys or comments keeps its form (§4.1: unknown keys survive), with the type written out.
			patches.push(...mapPatches(src, node, [{ key: 'type', write: op.to, text: false }], ['id', 'type']));
			raw[e.index] = { ...(raw[e.index] as RawMap), type: op.to };
		}
	}
	person.parents = single ? raw[0] : raw;
	const stale = staleKeys(ctx, expected, [childIndex]);
	const keys = staleKeyPatches(ctx.first, stale);
	if (isRefusal(keys)) return keys;
	return finish(ctx.first, [() => [...patches, ...keys]], expected, []);
}

function removeParent(ctx: OpContext, op: RemoveParent): EditResult {
	const childIndex = personIndex(ctx, op.child);
	if (childIndex === undefined || typeof op.parent !== 'string') return refuse('unknown-person');
	if (!isParentType(op.type)) return refuse('bad-value', REFUSAL_TEXT.unknownParentType);
	const item = personNode(ctx.first, childIndex);
	if (isRefusal(item)) return item;
	const { match } = matchingEntries(ctx.first, item, op.parent, op.type);
	if (!match.length) return refuse('bad-value', `${op.parent} is not a ${op.type} parent.`);

	const expected = clone(ctx.data) as RawMap;
	const person = (expected.people as RawMap[])[childIndex];
	const drop = new Set(match.map((e) => e.index));
	const raw = rawParents(person).filter((_, i) => !drop.has(i));
	if (raw.length) person.parents = raw;
	else delete person.parents;
	const stale = staleKeys(ctx, expected, [childIndex]);
	const step: Step = (p) => {
		const node = personNode(p, childIndex);
		if (isRefusal(node)) return node;
		const keys = staleKeyPatches(p, stale);
		return isRefusal(keys) ? keys : [...removeEntries(p, node, drop), ...keys];
	};
	return finish(ctx.first, [step], expected, []);
}

/** Removes parent entries by index; removing every entry removes the `parents` key (§6.7). */
function removeEntries(p: Parsed, item: YAMLMap, drop: Set<number>): Patch[] {
	const { pair, seq, entries } = parentEntries(p, item);
	if (!pair || drop.size === 0) return [];
	if (!seq || drop.size >= entries.length) return [removePair(p.src, item, pair)];
	return removeItems(p.src, seq, drop);
}

function moveSibling(ctx: OpContext, op: MoveSibling): EditResult {
	const { g } = ctx;
	const index = personIndex(ctx, op.id);
	if (index === undefined) return refuse('unknown-person');
	if (op.direction !== 'earlier' && op.direction !== 'later') return refuse('bad-value');
	const group = siblingGroup(g, op.id) ?? [op.id];
	const at = group.indexOf(op.id);
	const other = group[op.direction === 'earlier' ? at - 1 : at + 1];
	if (other === undefined) return refuse('no-sibling');
	const [i, j] = [index, g.byId.get(other)!.index].sort((x, y) => x - y);

	const expected = clone(ctx.data) as RawMap;
	const people = expected.people as Raw[];
	[people[i], people[j]] = [people[j], people[i]];
	const step: Step = (p) => {
		for (const k of [i, j]) {
			const node = personNode(p, k);
			if (isRefusal(node)) return node;
		}
		const s = section(p, 'people')!;
		const src = p.src;
		const [si, ei, sj, ej] = [itemStart(src, s.seq, i), itemEnd(src, s.seq, i), itemStart(src, s.seq, j), itemEnd(src, s.seq, j)];
		const patches: Patch[] = [
			{ start: si, end: ei, text: src.text.slice(sj, ej), reorder: true },
			{ start: sj, end: ej, text: src.text.slice(si, ei), reorder: true },
		];
		if (s.seq.flow) patches.push(...swapFlowComments(src, s.seq, i, j));
		return patches;
	};
	const r = finish(ctx.first, [step], expected, []);
	if (!r.ok) return r;
	// Every comment must keep its owner: the two items swap theirs, all others keep theirs.
	const before = ownedComments(ctx.first);
	const after = ownedComments(r.body);
	const owner = (k: number) => (k === i ? j : k === j ? i : k);
	const same = before && after && before.length === after.length && after.every((texts, k) => texts.join('\n') === before[owner(k)].join('\n'));
	return same ? r : refuse('bad-value', REFUSAL_TEXT.commentWouldChange);
}

/** In a flow list, the end-of-line comments of two items change places with them. */
function swapFlowComments(src: Source, seq: YAMLSeq, i: number, j: number): Patch[] {
	const ci = flowComment(src, seq, i);
	const cj = flowComment(src, seq, j);
	if (!ci && !cj) return [];
	const text = (c: { start: number; end: number }) => src.text.slice(c.start, c.end);
	if (ci && cj) {
		return [
			{ start: ci.start, end: ci.end, text: text(cj), reorder: true },
			{ start: cj.start, end: cj.end, text: text(ci), reorder: true },
		];
	}
	const [from, to] = ci ? [ci, j] : [cj!, i];
	const toEnd = src.nodeEnd(seq.items[to] as Node);
	return [
		{ start: from.gap, end: from.end, text: '', reorder: true },
		{ start: src.lineEnd(toEnd), end: src.lineEnd(toEnd), text: ' ' + text(from), reorder: true },
	];
}

/** The comment texts each person item owns, in list order; null if the body has no people list. */
function ownedComments(from: string | Parsed): string[][] | null {
	let p: Parsed;
	if (typeof from === 'string') {
		const parsed = parseBody(from);
		if (!parsed.ok) return null;
		p = { src: new Source(from, parsed.doc), data: parsed.data };
	} else p = from;
	const body = p.src.text;
	const s = section(p, 'people');
	if (!s) return null;
	const comments = commentsOf(body);
	return s.seq.items.map((_, k) => {
		const start = itemStart(p.src, s.seq, k);
		const end = s.seq.flow ? flowComment(p.src, s.seq, k)?.end ?? itemEnd(p.src, s.seq, k) : itemEnd(p.src, s.seq, k);
		return comments.filter((c) => c.offset >= start && c.offset < end).map((c) => c.text);
	});
}

function deletePerson(ctx: OpContext, op: DeletePerson): EditResult {
	const { data } = ctx;
	const index = personIndex(ctx, op.id);
	if (index === undefined) return refuse('unknown-person');
	const id = op.id;

	const expected = clone(data) as RawMap;
	const people = expected.people as Raw[];
	// Parent entries that name the person, per other person.
	const links = new Map<number, Set<number>>();
	people.forEach((raw, k) => {
		if (k === index || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
		const person = raw as RawMap;
		const entries = rawParents(person);
		const drop = new Set<number>();
		entries.forEach((e, n) => {
			const ref = e && typeof e === 'object' && !Array.isArray(e) ? str((e as RawMap).id) : str(e);
			if (ref === id) drop.add(n);
		});
		if (!drop.size) return;
		links.set(k, drop);
		const rest = entries.filter((_, n) => !drop.has(n));
		if (rest.length) person.parents = rest;
		else delete person.parents;
	});

	const unionItems = new Set<number>();
	(Array.isArray(expected.unions) ? (expected.unions as Raw[]) : []).forEach((u, k) => {
		if (u && typeof u === 'object' && !Array.isArray(u) && list((u as RawMap).partners).some((x) => str(x) === id)) unionItems.add(k);
	});
	const unionKeys = dropUnionKeys(expected, unionItems, index);
	if (unionItems.size) {
		const rest = (expected.unions as Raw[]).filter((_, k) => !unionItems.has(k));
		if (rest.length) expected.unions = rest;
		else delete expected.unions;
	}
	// Before the splice: people are found by their index in the old list.
	const stale = staleKeys(ctx, expected, links.keys(), id);
	people.splice(index, 1);
	if (people.length === 0) delete expected.people;

	const options = expected.options && typeof expected.options === 'object' && !Array.isArray(expected.options) ? (expected.options as RawMap) : undefined;
	const clear = (['start', 'focus', 'me'] as const).filter((k) => options && str(options[k]) === id);
	for (const k of clear) delete options![k];
	if (options && clear.length && Object.keys(options).length === 0) delete expected.options;
	// D57: the person's holder entries go in the same write; their titles stay.
	const holders = dropHolders(expected, id);
	// Contract 0.2.7 K.3: the person is no longer a named heir or an excluded person, in the same write.
	const named = dropIds(expected, id);

	const step: Step = (p) => {
		const patches: Patch[] = [];
		const item = personNode(p, index);
		if (isRefusal(item)) return item;
		patches.push(...removeFromSection(p, 'people', new Set([index])));
		for (const [k, drop] of links) {
			const node = personNode(p, k);
			if (isRefusal(node)) return node;
			patches.push(...removeEntries(p, node, drop));
		}
		patches.push(...removeFromSection(p, 'unions', unionItems));
		const keys = unionKeyPatches(p, unionKeys);
		if (isRefusal(keys)) return keys;
		patches.push(...keys);
		const staleOnes = staleKeyPatches(p, stale);
		if (isRefusal(staleOnes)) return staleOnes;
		patches.push(...staleOnes);
		const titles = dropHolderPatches(p, holders);
		if (isRefusal(titles)) return titles;
		patches.push(...titles);
		const ids = dropIdPatches(p, named);
		if (isRefusal(ids)) return ids;
		patches.push(...ids);
		if (clear.length) {
			const top = topMap(p) as YAMLMap;
			const optionsPair = findPair(top, 'options')!;
			const node = optionsPair.value;
			if (!isMap(node)) return refuse('bad-value', 'The options are written as a YAML alias. Edit the note text.');
			if (clear.length >= node.items.length) patches.push(removePair(p.src, top, optionsPair));
			else for (const k of clear) patches.push(removePair(p.src, node, findPair(node, k)!));
		}
		return patches;
	};
	return finish(ctx.first, [step], expected, []);
}

/** The ops this file implements: every `Op` except `batch` and the field, option, house and link-rewrite ops. */
export type RelationshipOp = AddPerson | AddParent | AddUnion | EditUnion | RemoveUnion | SetParentType | RemoveParent | MoveSibling | DeletePerson;

/** Runs one relationship op by dispatching on its `kind`. */
export function relationshipOp(ctx: OpContext, op: RelationshipOp): EditResult {
	switch (op.kind) {
		case 'add-person':
			return addPerson(ctx, op);
		case 'add-parent':
			return addParent(ctx, op);
		case 'add-union':
			return addUnion(ctx, op);
		case 'edit-union':
			return editUnion(ctx, op);
		case 'remove-union':
			return removeUnion(ctx, op);
		case 'set-parent-type':
			return setParentType(ctx, op);
		case 'remove-parent':
			return removeParent(ctx, op);
		case 'move-sibling':
			return moveSibling(ctx, op);
		case 'delete-person':
			return deletePerson(ctx, op);
	}
}
