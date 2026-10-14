/*
 * Title ops (spec §13.3–§13.5): add, rename and delete titles, and add, edit, remove and reorder
 * their holders. Same machinery as the other ops (`yaml-patch.ts`): the expected data is built
 * first, the text is patched at the parse positions, and `finish` re-parses and compares.
 * `yaml-edit.ts` dispatches the `TitleOp`s here and runs `cleanCardTitles` once per write;
 * `relationship-ops.ts` uses `dropHolders` for delete-person (D57).
 *
 * Written forms (§6.2, §13.0 item 6): a new holder is a one-line flow map with keys in the order
 * `person`, `name`, `as`, `number`, `from`, `to`; a block-map holder stays a block map; an edited
 * plain-string holder becomes a flow map; `holders: aldric` becomes a flow list before any change;
 * the last holder removed leaves `holders: []`; the last title removed removes `titles`.
 *
 * Rules of the M8 titles contract (rules 1–5 are in `titles.ts`):
 * 6. Writes: values are quoted only when plain YAML would not read them back as the same text.
 *    Title keys go in the order `id`, `name`, `male-name`, `female-name`, `plural`, `numbering`,
 *    `count-with`, `succession`, `inherit`, `inherit-through`, `inherit-illegitimate`, `inherit-adopted`,
 *    `heirs-of-body`, `year`, `heir`, `exclude`, `holders` (contract 0.2.7 A.3, K.4);
 *    `card-title` goes after `title`, else after `name`. A new `titles` section goes after `houses`,
 *    else before `people`, else at the end. Ops on a `holders` map are refused `bad-value`. Unknown
 *    keys stay. Title ops act on the first title with the id.
 * 7. `card-title` cleanup, once per write after all ops of a batch: a `card-title` goes if it was
 *    valid before the write, still has the same value, and names a title the person no longer holds.
 * 8. Batches: each op runs on the body the ops before it produced. The refs of a `set-holders` op
 *    are checked against the body before that op, which carries the whole final list of one title.
 */

import { isAlias, isMap, isScalar, isSeq, type Node, type Pair, type Scalar, type YAMLMap, type YAMLSeq } from 'yaml';
import type { FamilyGraph } from './derive';
import type { AddHolder, AddTitle, DeleteTitle, EditHolder, EditResult, EditTitle, HolderRef, NewTitleId, RemoveHolder, SetHolders, TitleOp } from './edit';
import { changeItemId } from './id-change';
import { uniqueTitleId } from './id-gen';
import { parseBody, textWithoutComments } from './parse';
import { sameList } from './same-list';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, readIllegitimate, readInherit, readRule, readThrough, SUCCESSION_RULES } from './succession-keys';
import { bool, isEmpty, isMap as isRawMap, list, str, unwrapCurly, type Raw, type RawMap } from './tolerate';
import type { Tree } from './types';
import { dashOf, itemEnd, itemStart, removeFromSection, removeItems, section } from './yaml-list';
import {
	addPair, addSection, appendItem, clone, commentsOf, findPair, finish, finishTogether, flowInsertAfter, insertAt, isRefusal, itemBlock, layoutOf, personNode, recall, refuse, removePair, renderScalar,
	setPairValue, Source, topMap, type Layout, type NewValue, type Parsed, type Patch, type Refusal, type Step,
} from './yaml-patch';
import { REFUSAL_TEXT } from './refusal-text';

/** §13.0 key order of a title and of a holder. */
export const TITLE_ORDER = ['id', 'name', 'male-name', 'female-name', 'plural', 'numbering', 'count-with', 'succession', 'inherit', 'inherit-through', 'inherit-illegitimate', 'inherit-adopted', 'heirs-of-body', 'year', 'heir', 'exclude', 'holders'];
export const HOLDER_ORDER = ['person', 'name', 'as', 'number', 'from', 'to', 'through-spouse'] as const;
type HolderKey = (typeof HOLDER_ORDER)[number];
type Changes = [HolderKey, string | null][];

/** Ids and free text are written plain when plain YAML reads them back as the same text (§6.2); names are quoted like person names. */
const TEXT_KEYS = new Set(['id', 'person', 'number', 'from', 'to', 'through-spouse', 'year', 'heir', 'exclude', 'inherit-adopted', 'heirs-of-body', 'inherit-illegitimate']);

const HOLDERS_MAP = 'The holders of this title are not a list. Edit the note text.';
const NOT_A_LIST = 'This value is not a list. Edit the note text.';

/** The refusal texts of the succession keys (STE; contract 0.2.7 A.3). */
const SUCCESSION_REFUSAL = {
	rule: 'The succession rule is not a rule that the plugin knows.',
	inherit: 'The rule for who can inherit is not a rule that the plugin knows.',
	through: 'The rule for who passes the right to inherit is not a rule that the plugin knows.',
	illegitimate: 'The value for children with the box “Illegitimate” ticked is not a value that the plugin knows.',
	switch: 'The switch must be true or false.',
	year: 'The year must be text.',
	ids: 'The people must be a list of IDs.',
} as const;

/** The parsed body and graph a title op needs. */
export interface TitleContext {
	first: Parsed;
	data: RawMap;
	tree: Tree;
	g: FamilyGraph;
}

// ---------------------------------------------------------------------------------------------
// Reading what is written

const rawTitles = (data: RawMap): Raw[] => (Array.isArray(data.titles) ? data.titles : []);

/** The index of the first title item with this id: the one the tree uses (§13.4). */
function titleIndex(data: RawMap, id: unknown): number | undefined {
	if (typeof id !== 'string') return undefined;
	const i = rawTitles(data).findIndex((t) => isRawMap(t) && str(t.id) === id);
	return i < 0 ? undefined : i;
}

/** A title's holder items as written (`holders: aldric` is one); null when `holders` is a map. */
function rawHolders(title: RawMap): Raw[] | null {
	const v = title.holders;
	if (Array.isArray(v)) return v;
	if (isEmpty(v)) return [];
	return isRawMap(v) ? null : [v];
}

/** Who a holder item names; null for an item that is not a holder (a list, or an empty item). */
function whoOf(raw: Raw): { person?: string; name?: string } | null {
	if (isRawMap(raw)) return { person: str(raw.person), name: str(raw.name) };
	if (Array.isArray(raw) || str(raw) === undefined) return null;
	return { person: str(raw) };
}

/** True if `id` is a person in the tree under the id written in the block. */
function inTree(ctx: TitleContext, id: string): boolean {
	const person = ctx.g.byId.get(id);
	if (!person) return false;
	const raw = (Array.isArray(ctx.data.people) ? ctx.data.people : [])[person.index];
	return isRawMap(raw) && str(raw.id) === id;
}

/** A `HolderRef` as a title index and holder index, or `unknown-title` / `unknown-holder`. */
function resolveHolder(ctx: TitleContext, ref: unknown): { title: number; index: number } | Refusal {
	if (!ref || typeof ref !== 'object') return refuse('unknown-holder');
	const r = ref as HolderRef;
	const t = titleIndex(ctx.data, r.title);
	if (t === undefined) return refuse('unknown-title');
	const holders = rawHolders(rawTitles(ctx.data)[t] as RawMap);
	if (holders === null) return refuse('bad-value', HOLDERS_MAP);
	if (!Number.isInteger(r.index) || r.index < 0 || r.index >= holders.length) return refuse('unknown-holder');
	const who = whoOf(holders[r.index]);
	if (!who) return refuse('unknown-holder');
	const same = r.person !== undefined ? who.person === r.person : who.person === undefined && who.name === r.name;
	if (!same) return refuse('unknown-holder');
	if (r.text !== undefined) {
		// The text tells apart two entries of one person when an old index now points at the other.
		const text = ctx.tree.titles?.find((x) => x.index === t)?.holders.find((h) => h.index === r.index)?.text;
		if (typeof r.text !== 'string' || (r.text !== text && textWithoutComments(r.text) !== text)) return refuse('unknown-holder');
	}
	return { title: t, index: r.index };
}

/** Checks the fields an op writes to a holder: text or null, and a `person` who is in the tree. */
function holderChanges(ctx: TitleContext, fields: unknown): Changes | Refusal {
	if (fields === undefined || fields === null) return [];
	if (typeof fields !== 'object' || Array.isArray(fields)) return refuse('bad-value');
	const out: Changes = [];
	for (const key of HOLDER_ORDER) {
		if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
		const v = (fields as Record<string, unknown>)[key];
		if (v === undefined) continue;
		if (v !== null && typeof v !== 'string') return refuse('bad-value', 'A holder value must be text.');
		const write = v === null || v.trim() === '' ? null : v;
		if (key === 'person' && write !== null && !inTree(ctx, write)) return refuse('unknown-person', write);
		out.push([key, write]);
	}
	return out;
}

/** True if a `through-spouse` value is on: anything written except nothing, `false` and `no`. */
const ticked = (v: Raw): boolean => {
	const s = str(v);
	return s !== undefined && !/^(false|no)$/i.test(s);
};

/** A holder item with the changes applied, and the changes that change something. A plain string becomes a map only when something changes. */
function withFields(raw: Raw, changes: Changes): { value: Raw; changed: Changes } | Refusal {
	const base: RawMap = isRawMap(raw) ? (clone(raw) as RawMap) : str(raw) !== undefined ? { person: typeof raw === 'string' ? raw : str(raw) } : {};
	const changed: Changes = [];
	for (const [key, write] of changes) {
		const has = Object.prototype.hasOwnProperty.call(base, key);
		if (write === null ? !has : str(base[key]) === str(write)) continue;
		// A box that is ticked already (`true`, `yes` or a person id written by hand) stays as it is when it is ticked again (D195).
		if (key === 'through-spouse' && write !== null && /^(true|yes)$/i.test(write.trim()) && ticked(base[key])) continue;
		if (write === null) delete base[key];
		else base[key] = write;
		changed.push([key, write]);
	}
	if (!changed.length) return { value: raw, changed };
	if (str(base.person) === undefined && str(base.name) === undefined) return refuse('bad-value', REFUSAL_TEXT.holderNeeds);
	return { value: base, changed };
}

// ---------------------------------------------------------------------------------------------
// Writing

const flowScalar = (key: string, v: string, old?: Node | null) => renderScalar(v, old, { flow: true, text: TEXT_KEYS.has(key), indent: '' });

/** A holder as a one-line flow map, keys in §13.0 order. `person` is the written text of a converted plain string. */
function flowHolder(value: RawMap, person?: string): string {
	const keys = [...HOLDER_ORDER.filter((k) => value[k] !== undefined && value[k] !== null), ...Object.keys(value).filter((k) => !(HOLDER_ORDER as readonly string[]).includes(k))];
	return `{${keys.map((k) => `${k}: ${k === 'person' && person !== undefined ? person : flowScalar(k, String(value[k]))}`).join(', ')}}`;
}

/** Patches for key changes on one map (block or flow), in `order`. */
function mapChanges(src: Source, map: YAMLMap, changes: [string, string | null][], order: string[]): Patch[] {
	const layout = layoutOf(src);
	const out: Patch[] = [];
	for (const [key, write] of changes) {
		const pair = findPair(map, key);
		if (write === null) {
			if (pair) out.push(removePair(src, map, pair));
			continue;
		}
		const nv: NewValue = { scalar: write, old: pair?.value as Node | null, text: TEXT_KEYS.has(key) };
		out.push(pair ? setPairValue(src, map, pair, nv, layout) : addPair(src, map, key, nv, order, layout));
	}
	return out;
}

function titleNode(p: Parsed, index: number): YAMLMap | Refusal {
	const item = section(p, 'titles')?.seq.items[index];
	if (isAlias(item)) return refuse('bad-value', 'This title is written as a YAML alias. Edit the note text.');
	if (!isMap(item)) return refuse('unknown-title');
	return item;
}

/** Where a title's holders are written: a list, one scalar (`holders: aldric`), or nothing yet. */
interface HoldersAt {
	title: YAMLMap;
	pair?: Pair;
	seq?: YAMLSeq;
	scalar?: Scalar;
}

function holdersAt(p: Parsed, index: number, key = 'holders'): HoldersAt | Refusal {
	const title = titleNode(p, index);
	if (isRefusal(title)) return title;
	const pair = findPair(title, key);
	const v = pair?.value;
	if (isAlias(v)) return refuse('bad-value', key === 'holders' ? 'The holders are written as a YAML alias. Edit the note text.' : 'This value is written as a YAML alias. Edit the note text.');
	if (isSeq(v)) return { title, pair, seq: v };
	if (isMap(v)) return refuse('bad-value', key === 'holders' ? HOLDERS_MAP : NOT_A_LIST);
	if (isScalar(v) && !isEmpty(v.value)) return { title, pair, scalar: v };
	return { title, pair };
}

/** A scalar as it can stand in a flow list or map: its own text if that reads back the same, else quoted. */
const scalarFlowText = (node: Scalar) => flowScalar('person', String(node.value), node);

/** A new holder list: a block list of one-line flow maps (or a flow list inside a flow map). */
function newList(src: Source, at: HoldersAt, flows: string[], layout: Layout, key = 'holders'): Patch {
	const value: NewValue = { block: flows.map((f) => `${' '.repeat(layout.seqIndent)}- ${f}`), flow: `[${flows.join(', ')}]` };
	if (!at.pair) return addPair(src, at.title, key, value, TITLE_ORDER, layout);
	const v = at.pair.value;
	// `holders: []` with a comment after it stays a flow list, so the comment keeps its line.
	if (isSeq(v) && v.flow && /\S/.test(src.text.slice(src.nodeEnd(v), src.lineEnd(src.nodeEnd(v))))) return insertAt(src.text.indexOf('[', v.range![0]) + 1, flows.join(', '));
	return setPairValue(src, at.title, at.pair, value, layout);
}

/** Removes every item of a holder list and leaves `holders: []` (§13.4: the title stays). */
function emptyList(src: Source, at: HoldersAt): Patch[] {
	const layout = layoutOf(src);
	if (at.scalar) return [setPairValue(src, at.title, at.pair!, { raw: '[]' }, layout)];
	const seq = at.seq!;
	if (!seq.items.length) return [];
	if (seq.flow) {
		// The whole list becomes `[]`: the holders go with their comments, and no trailing comma
		// or line layout can leave text that reads back differently.
		const span: [number, number] = [seq.range![0], src.nodeEnd(seq)];
		return [{ start: span[0], end: span[1], text: '[]', allow: span }];
	}
	return [insertAt(src.colonEnd(at.pair!), ' []'), ...removeItems(src, seq, new Set(seq.items.map((_, i) => i)), true)];
}

/** One item of a final holder list: a written item (by its index before the op) or a new one (its flow text). */
type Final = { from: number } | { flow: string };

/** One item of an op's final holder list: a written item with its changes, or a new holder. */
type FinalItem = { from: number; value: Raw; changed: Changes } | { value: RawMap };

/**
 * Patches that turn a title's holder list into `final`. Items keep their text, style and comments.
 * With no move, items are removed and added in place; a move rebuilds the list from the items'
 * texts (a block list keeps the gaps between items, a flow list becomes one line).
 */
function listPatches(p: Parsed, t: number, final: Final[], key = 'holders'): Patch[] | Refusal {
	const at = holdersAt(p, t, key);
	if (isRefusal(at)) return at;
	const src = p.src;
	const layout = layoutOf(src);
	const kept = final.flatMap((f) => ('from' in f ? [f.from] : []));
	if ((!at.seq || !at.seq.items.length) && !at.scalar) return final.length ? [newList(src, at, final.map((f) => ('flow' in f ? f.flow : '')), layout, key)] : [];
	if (!final.length) return emptyList(src, at);
	if (at.scalar) {
		// §13.0 item 6: `holders: aldric` first becomes a flow list.
		const pieces = final.map((f) => ('flow' in f ? f.flow : scalarFlowText(at.scalar!)));
		return [setPairValue(src, at.title, at.pair!, { raw: `[${pieces.join(', ')}]` }, layout)];
	}
	const seq = at.seq!;
	const n = seq.items.length;
	if (kept.some((k) => k >= n)) return refuse('unknown-holder');
	const moved = kept.some((k, i) => i > 0 && k <= kept[i - 1]);
	if (!moved && kept.length) return inPlace(src, seq, final, kept);
	return seq.flow ? [rebuildFlow(src, seq, final)] : [rebuildBlock(src, seq, final)];
}

/** Removes and adds items around the ones that stay, which keep their order. */
function inPlace(src: Source, seq: YAMLSeq, final: Final[], kept: number[]): Patch[] {
	const n = seq.items.length;
	const keep = new Set(kept);
	const removed = new Set([...Array(n).keys()].filter((i) => !keep.has(i)));
	const patches: Patch[] = removed.size ? removeItems(src, seq, removed, true) : [];
	const dashCol = seq.flow ? 0 : src.column(dashOf(src, seq.items[0] as Node));
	const line = (flow: string) => `${' '.repeat(dashCol)}- ${flow}`;
	let before: string[] = [];
	let last: number | undefined;
	const after = new Map<number, string[]>();
	for (const f of final) {
		if ('flow' in f) {
			if (last === undefined) before.push(f.flow);
			else after.set(last, [...(after.get(last) ?? []), f.flow]);
			continue;
		}
		if (last === undefined && before.length) {
			const node = seq.items[f.from] as Node;
			patches.push(seq.flow ? insertAt(node.range![0], before.map((x) => `${x}, `).join('')) : insertAt(itemStart(src, seq, f.from), before.map((x) => line(x) + '\n').join('')));
			before = [];
		}
		last = f.from;
	}
	for (const [k, flows] of after) {
		patches.push(seq.flow ? flowInsertAfter(src, seq, k, flows) : insertAt(itemEnd(src, seq, k), flows.map((x) => '\n' + line(x)).join('')));
	}
	return patches;
}

/** A flow list written again on one line, items as written. Comments inside it must all survive (the run check). */
function rebuildFlow(src: Source, seq: YAMLSeq, final: Final[]): Patch {
	const pieces = final.map((f) => {
		if ('flow' in f) return f.flow;
		const node = seq.items[f.from] as Node;
		return src.text.slice(node.range![0], src.nodeEnd(node));
	});
	return { start: seq.range![0], end: src.nodeEnd(seq), text: `[${pieces.join(', ')}]`, reorder: true };
}

/**
 * A block list written again: each item with the comment lines it owns (`yaml-list.ts`), the gaps
 * between items kept by position. Only the comments of removed items go.
 */
function rebuildBlock(src: Source, seq: YAMLSeq, final: Final[]): Patch {
	const n = seq.items.length;
	const starts = seq.items.map((_, i) => itemStart(src, seq, i));
	const ends = seq.items.map((_, i) => itemEnd(src, seq, i));
	const gaps = starts.slice(1).map((s, k) => [ends[k], s] as [number, number]);
	const dashCol = src.column(dashOf(src, seq.items[0] as Node));
	const used: [number, number][] = [];
	const pieces = final.map((f) => {
		if ('flow' in f) return `${' '.repeat(dashCol)}- ${f.flow}`;
		used.push([starts[f.from], ends[f.from]]);
		return src.text.slice(starts[f.from], ends[f.from]);
	});
	let text = pieces[0];
	for (let t = 1; t < pieces.length; t++) {
		const gap = gaps[t - 1];
		if (gap) used.push(gap);
		text += (gap ? src.text.slice(gap[0], gap[1]) : '\n') + pieces[t];
	}
	// Gaps left over by a shorter list keep their comments at the end.
	for (const gap of gaps.slice(Math.max(pieces.length - 1, 0))) {
		const g = src.text.slice(gap[0], gap[1]);
		if (g.trim() === '') continue;
		used.push(gap);
		text += g.replace(/\r?\n$/, '');
	}
	const region: [number, number] = [starts[0], ends[n - 1]];
	const writes = commentsOf(src.text)
		.filter((c) => used.some(([a, b]) => c.offset >= a && c.offset < b))
		.map((c) => c.text);
	return { start: region[0], end: region[1], text, allow: region, writes };
}

/** Start of a node with its tag and anchor (`!!str a`, `&x a`); its own start when it has neither. */
function propsStart(src: Source, node: Node): number {
	let start = node.range![0];
	if (node.tag === undefined && node.anchor === undefined) return start;
	for (;;) {
		let end = start;
		while (end > 0 && /\s/.test(src.text[end - 1])) end--;
		let at = end;
		while (at > 0 && !/[\s[\]{},]/.test(src.text[at - 1])) at--;
		if (at === end || (src.text[at] !== '!' && src.text[at] !== '&')) return start;
		start = at;
	}
}

/** Steps that write field changes to one holder item: key by key in a map, or the whole item for a plain string. */
function fieldSteps(t: number, index: number, raw: Raw, value: Raw, changed: Changes): Step[] {
	if (!changed.length) return [];
	const node = (p: Parsed): { at: HoldersAt; node: Node } | Refusal => {
		const at = holdersAt(p, t);
		if (isRefusal(at)) return at;
		const item = at.seq ? (at.seq.items[index] as Node | undefined) : index === 0 ? at.scalar : undefined;
		if (isAlias(item)) return refuse('bad-value', 'This holder is written as a YAML alias. Edit the note text.');
		if (!item) return refuse('unknown-holder');
		return { at, node: item };
	};
	if (isRawMap(raw)) {
		return changed.map((c): Step => (p) => {
			const found = node(p);
			if (isRefusal(found)) return found;
			return isMap(found.node) ? mapChanges(p.src, found.node, [c], [...HOLDER_ORDER]) : refuse('unknown-holder');
		});
	}
	// A plain string becomes a flow map with its id as written (§13.0 item 6).
	const person = whoOf(raw)?.person;
	return [
		(p) => {
			const found = node(p);
			if (isRefusal(found)) return found;
			const { at, node: item } = found;
			if (!isScalar(item)) return refuse('unknown-holder');
			const map = value as RawMap;
			const text = flowHolder(map, person !== undefined && str(map.person) === person ? scalarFlowText(item) : undefined);
			if (at.scalar) return setPairValue(p.src, at.title, at.pair!, { raw: `[${text}]` }, layoutOf(p.src));
			// A tag or anchor (`!!str a`) belongs to the string, not to the new map, so it goes too.
			return { start: propsStart(p.src, item), end: p.src.nodeEnd(item), text };
		},
	];
}

/**
 * The shared end of every holder op: the title's holders become `final` (field changes, then the
 * list), checked against the expected data. `created` passes through.
 */
function writeHolders(ctx: TitleContext, t: number, final: FinalItem[]): EditResult {
	const title = rawTitles(ctx.data)[t] as RawMap;
	const before = rawHolders(title);
	if (before === null) return refuse('bad-value', HOLDERS_MAP);
	const kept = final.flatMap((f) => ('from' in f ? [f.from] : []));
	const structure = final.length !== before.length || final.some((f, i) => !('from' in f) || f.from !== i);
	const fields = final.some((f) => 'from' in f && f.changed.length);
	if (!structure && !fields) return { ok: true, body: ctx.first.src.text, created: [] };
	if (new Set(kept).size !== kept.length) return refuse('bad-value', 'A holder is listed two times.');

	const expected = clone(ctx.data) as RawMap;
	(rawTitles(expected)[t] as RawMap).holders = final.map((f) => clone(f.value));
	const steps: Step[] = [];
	for (const f of final) if ('from' in f) steps.push(...fieldSteps(t, f.from, before[f.from], f.value, f.changed));
	if (structure) {
		const plan: Final[] = final.map((f) => ('from' in f ? { from: f.from } : { flow: flowHolder(f.value) }));
		steps.push((p) => listPatches(p, t, plan));
	}
	return finishTogether(ctx.first, steps, expected, []);
}

// ---------------------------------------------------------------------------------------------
// Ops

/** Picks an unused title id from a name (§6.8, own namespace); `taken` adds ids chosen earlier in the same batch. */
export const newTitleId: NewTitleId = (body, name, taken) => {
	const ids = new Set<string>(taken ?? []);
	try {
		const parsed = typeof body === 'string' ? parseBody(body) : null;
		if (parsed?.ok && isRawMap(parsed.data)) for (const t of rawTitles(parsed.data)) if (isRawMap(t) && str(t.id) !== undefined) ids.add(str(t.id)!);
	} catch {
		// An id from the name alone is still better than none.
	}
	return uniqueTitleId(typeof name === 'string' ? name : '', ids);
};

function addTitle(ctx: TitleContext, op: AddTitle): EditResult {
	const { data } = ctx;
	if (typeof op.id !== 'string' || str(op.id) !== op.id) return refuse('bad-value', REFUSAL_TEXT.newIdText);
	if (typeof op.name !== 'string' || op.name.trim() === '') return refuse('bad-value', REFUSAL_TEXT.titleName);
	if (op.maleName !== undefined && op.maleName !== null && typeof op.maleName !== 'string') return refuse('bad-value', REFUSAL_TEXT.maleNameText);
	if (op.femaleName !== undefined && op.femaleName !== null && typeof op.femaleName !== 'string') return refuse('bad-value', REFUSAL_TEXT.femaleNameText);
	if (op.plural !== undefined && op.plural !== null && typeof op.plural !== 'string') return refuse('bad-value', REFUSAL_TEXT.pluralText);
	if (!isEmpty(data.titles) && !Array.isArray(data.titles)) return refuse('bad-value', 'The titles section is not a list.');
	if (titleIndex(data, op.id) !== undefined) return refuse('id-taken');
	const maleName = typeof op.maleName === 'string' && op.maleName.trim() !== '' ? op.maleName : undefined;
	const femaleName = typeof op.femaleName === 'string' && op.femaleName.trim() !== '' ? op.femaleName : undefined;
	const plural = typeof op.plural === 'string' && op.plural.trim() !== '' ? op.plural : undefined;

	const entries: [string, string][] = [
		['id', op.id],
		['name', op.name],
	];
	if (maleName !== undefined) entries.push(['male-name', maleName]);
	if (femaleName !== undefined) entries.push(['female-name', femaleName]);
	if (plural !== undefined) entries.push(['plural', plural]);
	const expected = clone(data) as RawMap;
	expected.titles = [...rawTitles(expected), Object.fromEntries(entries)];

	const step: Step = (p) => {
		const top = topMap(p);
		if (isRefusal(top)) return top;
		const src = p.src;
		const layout = layoutOf(src);
		const block = entries.map(([k, v]) => `${k}: ${renderScalar(v, null, { flow: false, text: TEXT_KEYS.has(k), indent: '' })}`);
		const flow = `{${entries.map(([k, v]) => `${k}: ${flowScalar(k, v)}`).join(', ')}}`;
		const pair = top ? findPair(top, 'titles') : undefined;
		const node = pair?.value;
		// Like add-house, the new title goes after the comments the last title owns.
		if (isSeq(node) && (node.items.length || node.flow)) return appendItem(src, node, block, flow, node.flow ? undefined : itemEnd(src, node, node.items.length - 1));
		const value = { block: itemBlock(layout, block), flow: `[${flow}]` };
		if (pair && top) return setPairValue(src, top, pair, value, layout);
		return titlesSection(p, value);
	};
	return finish(ctx.first, [step], expected, [op.id]);
}

/**
 * §13.0: a new `titles` section goes directly after `houses`; with no `houses`, directly before
 * `people`; else at the end. It has one blank line on each side (supervisor ruling).
 */
function titlesSection(p: Parsed, value: Extract<NewValue, { block: string[] }>): Patch | Refusal {
	const top = topMap(p);
	if (isRefusal(top)) return top;
	if (!top) return addSection(p, 'titles', value);
	const src = p.src;
	const layout = layoutOf(src);
	const houses = findPair(top, 'houses');
	const people = houses ? undefined : findPair(top, 'people');
	const next = houses ?? people;
	if (top.flow || !next) return addPair(src, top, 'titles', value, ['titles'], layout);
	const keyStart = (next.key as Node).range![0];
	const keyCol = src.column(keyStart);
	const lines = `${' '.repeat(keyCol)}titles:${value.block.map((l) => '\n' + ' '.repeat(keyCol) + l).join('')}`;
	const blank = (at: number) => src.text.slice(src.lineStart(at), src.lineEnd(at)).trim() === '';
	if (houses) {
		const v = houses.value;
		let end = src.pairLineEnd(houses);
		if (isSeq(v) && !v.flow && v.items.length) end = Math.max(end, itemEnd(src, v, v.items.length - 1));
		const nl = src.text.indexOf('\n', end);
		const after = nl >= 0 && nl + 1 < src.text.length && !blank(nl + 1) ? '\n' : '';
		return insertAt(end, `\n\n${lines}${after}`);
	}
	// Before `people` and the comment lines above it.
	const i = (top.items as Pair[]).indexOf(next);
	const at = src.withCommentsAbove(src.lineStart(keyStart), i > 0 ? src.pairLineEnd(top.items[i - 1] as Pair) : -1);
	const before = at > 0 && !blank(at - 1) ? '\n' : '';
	return insertAt(at, `${before}${lines}\n\n`);
}

function editTitle(ctx: TitleContext, op: EditTitle): EditResult {
	const index = titleIndex(ctx.data, op.id);
	if (index === undefined) return refuse('unknown-title');
	if (op.name !== undefined && (typeof op.name !== 'string' || op.name.trim() === '')) return refuse('bad-value', REFUSAL_TEXT.titleName);
	if (op.maleName !== undefined && op.maleName !== null && typeof op.maleName !== 'string') return refuse('bad-value', REFUSAL_TEXT.maleNameText);
	if (op.femaleName !== undefined && op.femaleName !== null && typeof op.femaleName !== 'string') return refuse('bad-value', REFUSAL_TEXT.femaleNameText);
	if (op.plural !== undefined && op.plural !== null && typeof op.plural !== 'string') return refuse('bad-value', REFUSAL_TEXT.pluralText);
	if (op.year !== undefined && op.year !== null && typeof op.year !== 'string') return refuse('bad-value', SUCCESSION_REFUSAL.year);
	const expected = clone(ctx.data) as RawMap;
	const title = rawTitles(expected)[index] as RawMap;
	const changes: [string, string | null][] = [];
	const has = (key: string) => Object.prototype.hasOwnProperty.call(title, key);
	const remove = (key: string) => {
		if (!has(key)) return;
		delete title[key];
		changes.push([key, null]);
	};
	// Optional text keys: null or empty text removes the key.
	const optional = (key: string, v: string | null | undefined) => {
		if (v === undefined) return;
		const write = v === null || v.trim() === '' ? null : v;
		if (write === null) remove(key);
		else if (str(title[key]) !== str(write)) {
			title[key] = write;
			changes.push([key, write]);
		}
	};
	if (op.name !== undefined && str(title.name) !== str(op.name)) {
		title.name = op.name;
		changes.push(['name', op.name]);
	}
	optional('male-name', op.maleName);
	optional('female-name', op.femaleName);
	optional('plural', op.plural);

	// Contract 0.2.7 A.3, K.4: a rule is written as its canonical word; a written text that already reads as the same rule stays.
	const word = (key: string, v: string | null | undefined, canonical: readonly string[], read: (t: string | undefined) => string | undefined, message: string): Refusal | undefined => {
		if (v === undefined) return undefined;
		if (v === null || (typeof v === 'string' && v.trim() === '')) return void remove(key);
		if (typeof v !== 'string' || !canonical.includes(v)) return refuse('bad-value', message);
		if (read(str(title[key])) === v) return undefined;
		title[key] = v;
		changes.push([key, v]);
		return undefined;
	};
	const refusal =
		word('succession', op.succession, SUCCESSION_RULES, readRule, SUCCESSION_REFUSAL.rule) ??
		word('inherit', op.inherit, INHERIT_RULES, readInherit, SUCCESSION_REFUSAL.inherit) ??
		word('inherit-through', op.inheritThrough, INHERIT_THROUGH, readThrough, SUCCESSION_REFUSAL.through);
	if (refusal) return refusal;
	if (op.inheritIllegitimate !== undefined) {
		const v: unknown = op.inheritIllegitimate;
		if (typeof v !== 'string' || !(INHERIT_ILLEGITIMATE as readonly string[]).includes(v)) return refuse('bad-value', SUCCESSION_REFUSAL.illegitimate);
		if (v === 'no') remove('inherit-illegitimate');
		else if (readIllegitimate(str(title['inherit-illegitimate'])) !== v) {
			title['inherit-illegitimate'] = v;
			changes.push(['inherit-illegitimate', v]);
		}
	}
	if (op.inheritAdopted !== undefined) {
		const v: unknown = op.inheritAdopted;
		if (typeof v !== 'boolean') return refuse('bad-value', SUCCESSION_REFUSAL.switch);
		if (!v) remove('inherit-adopted');
		else if (!bool(title['inherit-adopted'])) {
			title['inherit-adopted'] = 'true';
			changes.push(['inherit-adopted', 'true']);
		}
	}
	if (op.heirsOfBody !== undefined) {
		const v: unknown = op.heirsOfBody;
		if (v !== null && typeof v !== 'boolean') return refuse('bad-value', SUCCESSION_REFUSAL.switch);
		if (!v) remove('heirs-of-body');
		else if (!bool(title['heirs-of-body'])) {
			title['heirs-of-body'] = 'true';
			changes.push(['heirs-of-body', 'true']);
		}
	}
	optional('year', op.year);

	// The named heirs and the excluded people: lists of person ids (K.3).
	const lists: Step[] = [];
	for (const [key, want] of [['heir', op.heirs], ['exclude', op.exclude]] as const) {
		const planned = idListEdit(ctx, index, title, key, want);
		if (isRefusal(planned)) return planned;
		if (planned) lists.push(planned);
	}
	if (!changes.length && !lists.length) return { ok: true, body: ctx.first.src.text, created: [] };
	const change = (c: [string, string | null]): Step => (p) => {
		const node = titleNode(p, index);
		return isRefusal(node) ? node : mapChanges(p.src, node, [c], TITLE_ORDER);
	};
	// `heir` and `exclude` come last among the keys, as in the key order, so keys added at one place come out in that order.
	return finishTogether(ctx.first, [...changes.map(change), ...lists], expected, []);
}

/** The ids that a `heir` or `exclude` value names as scalars, in written order. */
const writtenIds = (v: Raw): string[] => list(v).flatMap((x) => (isRawMap(x) || Array.isArray(x) ? [] : [str(x)].filter((y): y is string => y !== undefined)));

/**
 * K.3: the step that makes the ids of `heir` or `exclude` equal `want` (undefined: no change), and the expected data. A list
 * equal to the written ids is no change. Ids already written need no check; a new id must be a person (`unknown-person`).
 * One id is written as a scalar and several as a flow list. A written list that holds comments is changed item by item, so
 * its comments stay (it stays a list).
 */
function idListEdit(ctx: TitleContext, index: number, title: RawMap, key: 'heir' | 'exclude', want: string[] | null | undefined): Step | Refusal | undefined {
	if (want === undefined) return undefined;
	if (want !== null && (!Array.isArray(want) || want.some((x) => typeof x !== 'string' || str(x) !== x))) return refuse('bad-value', SUCCESSION_REFUSAL.ids);
	const ids = [...new Set(want ?? [])];
	const written = writtenIds(title[key]);
	const present = Object.prototype.hasOwnProperty.call(title, key);
	if (!ids.length) {
		if (!present) return undefined;
		delete title[key];
		return (p) => {
			const node = titleNode(p, index);
			if (isRefusal(node)) return node;
			const pair = findPair(node, key);
			return pair ? removePair(p.src, node, pair) : null;
		};
	}
	if (present && sameList(ids, written)) return undefined;
	for (const id of ids) if (!written.includes(id) && !inTree(ctx, id)) return refuse('unknown-person', id);

	// Is the written value a list with comments in it (or between the key and the list)?
	const parsedNode = titleNode(ctx.first, index);
	if (isRefusal(parsedNode)) return parsedNode;
	const pair = findPair(parsedNode, key);
	const old = pair?.value;
	const src = ctx.first.src;
	const commented = !!pair && isSeq(old) && old.items.length > 0 && commentsOf(src.text).some((c) => c.offset >= src.colonEnd(pair) && c.offset < src.nodeEnd(old));
	if (commented) {
		title[key] = ids;
		return (p) => {
			const at = holdersAt(p, index, key);
			if (isRefusal(at)) return at;
			if (!at.seq) return refuse('bad-value', NOT_A_LIST);
			const used = new Set<number>();
			const final: Final[] = ids.map((id) => {
				const from = at.seq!.items.findIndex((it, k) => !used.has(k) && isScalar(it) && str(unwrapCurly(it.value)) === id);
				if (from < 0) return { flow: flowScalar('person', id) };
				used.add(from);
				return { from };
			});
			return listPatches(p, index, final, key);
		};
	}
	title[key] = ids.length === 1 ? ids[0] : ids;
	return (p) => {
		const node = titleNode(p, index);
		if (isRefusal(node)) return node;
		const layout = layoutOf(p.src);
		const at = findPair(node, key);
		const current = at?.value;
		if (isAlias(current)) return refuse('bad-value', 'This value is written as a YAML alias. Edit the note text.');
		const value: NewValue =
			ids.length === 1
				? { scalar: ids[0], old: isScalar(current) ? current : null, text: true }
				: { raw: `[${ids.map((id) => idText(current, id)).join(', ')}]` };
		return at ? setPairValue(p.src, node, at, value, layout) : addPair(p.src, node, key, value, TITLE_ORDER, layout);
	};
}

/** An id as a flow list item: the text of the written item with this id if there is one, else the id written as a person id. */
function idText(old: Raw | Node | null | undefined, id: string): string {
	if (isSeq(old)) for (const it of old.items) if (isScalar(it) && str(unwrapCurly(it.value)) === id) return flowScalar('person', id, it);
	if (isScalar(old) && str(unwrapCurly(old.value)) === id) return flowScalar('person', id, old);
	return flowScalar('person', id);
}

function deleteTitle(ctx: TitleContext, op: DeleteTitle): EditResult {
	const index = titleIndex(ctx.data, op.id);
	if (index === undefined) return refuse('unknown-title');
	const expected = clone(ctx.data) as RawMap;
	const titles = expected.titles as Raw[];
	titles.splice(index, 1);
	if (titles.length === 0) delete expected.titles;
	// Supervisor ruling: every `card-title` with this value goes, valid or not (rule 7 adds nothing here).
	const people: number[] = [];
	(Array.isArray(expected.people) ? expected.people : []).forEach((raw, k) => {
		if (!isRawMap(raw) || str(raw['card-title']) !== op.id) return;
		delete raw['card-title'];
		people.push(k);
	});
	const step: Step = (p) => {
		const node = titleNode(p, index);
		if (isRefusal(node)) return node;
		const patches = removeFromSection(p, 'titles', new Set([index]));
		for (const k of people) {
			const person = personNode(p, k);
			if (isRefusal(person)) return person;
			const pair = findPair(person, 'card-title');
			if (pair) patches.push(removePair(p.src, person, pair));
		}
		return patches;
	};
	return finish(ctx.first, [step], expected, []);
}

/** The holders of a title before the op, each kept unchanged. */
function keepAll(before: Raw[]) {
	return before.map((value, from) => ({ from, value, changed: [] as Changes }));
}

function addHolder(ctx: TitleContext, op: AddHolder): EditResult {
	const t = titleIndex(ctx.data, op.title);
	if (t === undefined) return refuse('unknown-title');
	const before = rawHolders(rawTitles(ctx.data)[t] as RawMap);
	if (before === null) return refuse('bad-value', HOLDERS_MAP);
	const added = newHolder(ctx, op.fields);
	if (isRefusal(added)) return added;
	return writeHolders(ctx, t, [...keepAll(before), added]);
}

/** A new holder from its fields: needs a `person` in the tree or a `name`. */
function newHolder(ctx: TitleContext, fields: unknown): { value: RawMap } | Refusal {
	const changes = holderChanges(ctx, fields);
	if (isRefusal(changes)) return changes;
	const made = withFields({}, changes);
	if (isRefusal(made)) return made;
	if (!made.changed.length) return refuse('bad-value', REFUSAL_TEXT.holderNeeds);
	return { value: made.value as RawMap };
}

function editHolder(ctx: TitleContext, op: EditHolder): EditResult {
	const at = resolveHolder(ctx, op.holder);
	if (isRefusal(at)) return at;
	const changes = holderChanges(ctx, op.fields);
	if (isRefusal(changes)) return changes;
	const before = rawHolders(rawTitles(ctx.data)[at.title] as RawMap)!;
	const edited = withFields(before[at.index], changes);
	if (isRefusal(edited)) return edited;
	if (!edited.changed.length) return { ok: true, body: ctx.first.src.text, created: [] };
	const final = keepAll(before);
	final[at.index] = { from: at.index, ...edited };
	return writeHolders(ctx, at.title, final);
}

function removeHolder(ctx: TitleContext, op: RemoveHolder): EditResult {
	const at = resolveHolder(ctx, op.holder);
	if (isRefusal(at)) return at;
	const before = rawHolders(rawTitles(ctx.data)[at.title] as RawMap)!;
	return writeHolders(ctx, at.title, keepAll(before).filter((f) => f.from !== at.index));
}

function setHolders(ctx: TitleContext, op: SetHolders): EditResult {
	const t = titleIndex(ctx.data, op.title);
	if (t === undefined) return refuse('unknown-title');
	const before = rawHolders(rawTitles(ctx.data)[t] as RawMap);
	if (before === null) return refuse('bad-value', HOLDERS_MAP);
	if (!Array.isArray(op.items)) return refuse('bad-value');
	const final: FinalItem[] = [];
	for (const item of op.items as unknown[]) {
		if (!item || typeof item !== 'object') return refuse('bad-value');
		if ('add' in item) {
			const added = newHolder(ctx, (item as { add: unknown }).add);
			if (isRefusal(added)) return added;
			final.push(added);
			continue;
		}
		if (!('ref' in item)) return refuse('bad-value');
		const { ref, fields } = item as { ref: HolderRef; fields?: unknown };
		// Refs name items of this title, as the body was before this op (rule 8 above).
		if (!ref || typeof ref !== 'object' || ref.title !== op.title) return refuse('unknown-holder');
		const at = resolveHolder(ctx, ref);
		if (isRefusal(at)) return at;
		const changes = holderChanges(ctx, fields);
		if (isRefusal(changes)) return changes;
		const edited = withFields(before[at.index], changes);
		if (isRefusal(edited)) return edited;
		final.push({ from: at.index, ...edited });
	}
	return writeHolders(ctx, t, withHidden(ctx, t, before, final));
}

/**
 * Supervisor ruling: written items that the window does not show (dropped by validation, or not a
 * holder at all) are never removed by `set-holders`. Each stays after the listed item that
 * preceded it before the op, or first.
 */
function withHidden(ctx: TitleContext, t: number, before: Raw[], final: FinalItem[]): FinalItem[] {
	const shown = new Set(ctx.g.titles.find((x) => x.index === t)?.holders.map((h) => h.index) ?? []);
	const listed = new Set(final.flatMap((f) => ('from' in f ? [f.from] : [])));
	const hidden = before.map((_, i) => i).filter((i) => !shown.has(i) && !listed.has(i));
	if (!hidden.length) return final;
	const anchorOf = (j: number) => {
		let anchor: number | undefined;
		for (const i of listed) if (i < j && (anchor === undefined || i > anchor)) anchor = i;
		return anchor;
	};
	const anchored = (anchor: number | undefined): FinalItem[] => hidden.filter((j) => anchorOf(j) === anchor).map((j) => ({ from: j, value: before[j], changed: [] }));
	const out = anchored(undefined);
	for (const f of final) {
		out.push(f);
		if ('from' in f) out.push(...anchored(f.from));
	}
	return out;
}

/** Runs one title op by dispatching on its `kind`. */
export function titleOp(ctx: TitleContext, op: TitleOp): EditResult {
	switch (op.kind) {
		case 'add-title':
			return addTitle(ctx, op);
		case 'edit-title':
			return editTitle(ctx, op);
		case 'delete-title':
			return deleteTitle(ctx, op);
		case 'add-holder':
			return addHolder(ctx, op);
		case 'edit-holder':
			return editHolder(ctx, op);
		case 'remove-holder':
			return removeHolder(ctx, op);
		case 'set-holders':
			return setHolders(ctx, op);
		case 'set-title-id':
			return changeItemId(ctx.first, ctx.data, { section: 'titles', refKey: 'card-title', unknown: 'unknown-title' }, op.id, op.newId);
	}
}

// ---------------------------------------------------------------------------------------------
// Delete person (D57)

/**
 * D57: removes, in the expected data, every holder item that names `id`, in every title with an
 * id (also one that loses to a duplicate id). Returns the removed items per title index.
 */
export function dropHolders(expected: RawMap, id: string): Map<number, Set<number>> {
	const out = new Map<number, Set<number>>();
	rawTitles(expected).forEach((t, k) => {
		if (!isRawMap(t) || str(t.id) === undefined) return;
		const holders = rawHolders(t);
		if (!holders) return;
		const drop = new Set<number>();
		holders.forEach((h, i) => {
			if (whoOf(h)?.person === id) drop.add(i);
		});
		if (!drop.size) return;
		out.set(k, drop);
		t.holders = holders.filter((_, i) => !drop.has(i));
	});
	return out;
}

/** The patches for `dropHolders`, on a parse of the same body. */
export function dropHolderPatches(p: Parsed, removals: Map<number, Set<number>>): Patch[] | Refusal {
	const out: Patch[] = [];
	for (const [t, drop] of removals) {
		const at = holdersAt(p, t);
		if (isRefusal(at)) return at;
		const n = at.seq ? at.seq.items.length : at.scalar ? 1 : 0;
		if (drop.size >= n) out.push(...emptyList(p.src, at));
		else if (at.seq) out.push(...removeItems(p.src, at.seq, drop, true));
	}
	return out;
}

/** One removal of a person id from the `heir` or `exclude` of a title: the whole key, or some items of its list. */
export interface IdRemoval {
	title: number;
	key: 'heir' | 'exclude';
	/** The indices of the list items to remove; absent when the key goes whole. */
	items?: Set<number>;
}

/**
 * K.3: removes, in the expected data, `id` from the `heir` and `exclude` of every title with an id (also one that loses to
 * a duplicate id). A scalar that is the id removes the key; a list loses its items with the id and stays a list, also of
 * one; a list with no item left removes the key.
 */
export function dropIds(expected: RawMap, id: string): IdRemoval[] {
	const out: IdRemoval[] = [];
	rawTitles(expected).forEach((t, k) => {
		if (!isRawMap(t) || str(t.id) === undefined) return;
		for (const key of ['heir', 'exclude'] as const) {
			const v = t[key];
			if (Array.isArray(v)) {
				const drop = new Set<number>();
				v.forEach((x, i) => {
					if (!isRawMap(x) && !Array.isArray(x) && str(x) === id) drop.add(i);
				});
				if (!drop.size) continue;
				if (drop.size >= v.length) {
					delete t[key];
					out.push({ title: k, key });
				} else {
					t[key] = v.filter((_, i) => !drop.has(i));
					out.push({ title: k, key, items: drop });
				}
			} else if (!isRawMap(v) && str(v) === id) {
				delete t[key];
				out.push({ title: k, key });
			}
		}
	});
	return out;
}

/** The patches for `dropIds`, on a parse of the same body. */
export function dropIdPatches(p: Parsed, removals: IdRemoval[]): Patch[] | Refusal {
	const out: Patch[] = [];
	for (const r of removals) {
		const node = titleNode(p, r.title);
		if (isRefusal(node)) return node;
		const pair = findPair(node, r.key);
		if (!pair) return refuse('bad-value', REFUSAL_TEXT.otherValuesWouldChange);
		if (!r.items) out.push(removePair(p.src, node, pair));
		else if (isSeq(pair.value)) out.push(...removeItems(p.src, pair.value, r.items, true));
		else return refuse('bad-value', NOT_A_LIST);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// `card-title` cleanup (rule 7 above)

/** The raw data of a body, or undefined if it does not parse. */
function parsedData(body: string): Raw | undefined {
	const p = parseBody(body);
	return p.ok ? p.data : undefined;
}

/** True if the first title with id `title` in the raw data lists `person` as a holder. */
function holdsRaw(data: RawMap, person: string, title: string): boolean {
	const i = titleIndex(data, title);
	if (i === undefined) return false;
	return (rawHolders(rawTitles(data)[i] as RawMap) ?? []).some((h) => whoOf(h)?.person === person);
}

/** People by written id with a `card-title` they hold (a valid one, spec §13.3). */
function validCardTitles(data: Raw): Map<string, string> {
	const out = new Map<string, string>();
	if (!isRawMap(data) || !Array.isArray(data.people)) return out;
	for (const raw of data.people) {
		if (!isRawMap(raw)) continue;
		const id = str(raw.id);
		const title = str(raw['card-title']);
		if (id !== undefined && title !== undefined && !out.has(id) && holdsRaw(data, id, title)) out.set(id, title);
	}
	return out;
}

/**
 * Rule 7 above, once per write (after all ops of a batch): a `card-title` goes if it
 * was valid before the write, still has the same value, and names a title the person no longer
 * holds. `beforeData` is the parse of `before` when the caller has it. `renames` (old id to new
 * id) are the title ids that `set-title-id` ops of the batch changed: the people judged before the
 * write are matched under the new ids. A body with no
 * `card-title` costs no parse; otherwise the data of the bodies the write parsed anyway is used
 * (`recall`), and the new body is parsed again only to remove a key.
 */
export function cleanCardTitles(before: string, after: string, beforeData?: Raw, renames?: ReadonlyMap<string, string>): EditResult {
	const unchanged: EditResult = { ok: true, body: after, created: [] };
	if (before === after || !before.includes('card-title')) return unchanged;
	const data = beforeData ?? recall(before) ?? parsedData(before);
	if (data === undefined) return unchanged;
	const valid = validCardTitles(data);
	if (!valid.size) return unchanged;
	if (renames?.size) for (const [person, title] of valid) valid.set(person, renames.get(title) ?? title);
	const now = recall(after) ?? parsedData(after);
	if (!isRawMap(now) || !Array.isArray(now.people)) return unchanged;
	const expected = clone(now) as RawMap;
	const stale: number[] = [];
	const seen = new Set<string>();
	now.people.forEach((raw, k) => {
		if (!isRawMap(raw)) return;
		const id = str(raw.id);
		if (id === undefined || seen.has(id)) return;
		seen.add(id);
		const title = str(raw['card-title']);
		if (title === undefined || valid.get(id) !== title || holdsRaw(now, id, title)) return;
		stale.push(k);
		delete ((expected.people as RawMap[])[k] as RawMap)['card-title'];
	});
	if (!stale.length) return unchanged;
	const b = parseBody(after);
	if (!b.ok) return unchanged;
	const first: Parsed = { src: new Source(after, b.doc), data: b.data };
	const step: Step = (p) => {
		const out: Patch[] = [];
		for (const k of stale) {
			const node = personNode(p, k);
			if (isRefusal(node)) return node;
			const pair = findPair(node, 'card-title');
			if (pair) out.push(removePair(p.src, node, pair));
		}
		return out;
	};
	return finish(first, [step], expected, []);
}
