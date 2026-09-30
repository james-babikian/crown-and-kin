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
 *    `count-with`, `holders`;
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
import { slugify, uniqueId } from './id-gen';
import { parseBody, textWithoutComments } from './parse';
import { isEmpty, isMap as isRawMap, str, type Raw, type RawMap } from './tolerate';
import type { Tree } from './types';
import { dashOf, itemEnd, itemStart, removeFromSection, removeItems, section } from './yaml-list';
import {
	addPair, addSection, appendItem, clone, commentsOf, findPair, finish, finishTogether, insertAt, isRefusal, layoutOf, personNode, recall, refuse, removePair, renderScalar,
	setPairValue, Source, topMap, type Layout, type NewValue, type Parsed, type Patch, type Refusal, type Step,
} from './yaml-patch';

/** §13.0 key order of a title and of a holder. */
const TITLE_ORDER = ['id', 'name', 'male-name', 'female-name', 'plural', 'numbering', 'count-with', 'holders'];
const HOLDER_ORDER = ['person', 'name', 'as', 'number', 'from', 'to'] as const;
type HolderKey = (typeof HOLDER_ORDER)[number];
type Changes = [HolderKey, string | null][];

/** Ids and free text are written plain when plain YAML reads them back as the same text (§6.2); names are quoted like person names. */
const TEXT_KEYS = new Set(['id', 'person', 'number', 'from', 'to']);

const HOLDERS_MAP = 'The holders of this title are not a list. Edit the note text.';

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

/** A holder item with the changes applied, and the changes that change something. A plain string becomes a map only when something changes. */
function withFields(raw: Raw, changes: Changes): { value: Raw; changed: Changes } | Refusal {
	const base: RawMap = isRawMap(raw) ? (clone(raw) as RawMap) : str(raw) !== undefined ? { person: typeof raw === 'string' ? raw : str(raw) } : {};
	const changed: Changes = [];
	for (const [key, write] of changes) {
		const has = Object.prototype.hasOwnProperty.call(base, key);
		if (write === null ? !has : str(base[key]) === str(write)) continue;
		if (write === null) delete base[key];
		else base[key] = write;
		changed.push([key, write]);
	}
	if (!changed.length) return { value: raw, changed };
	if (str(base.person) === undefined && str(base.name) === undefined) return refuse('bad-value', 'A holder needs a person or a name.');
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

function holdersAt(p: Parsed, index: number): HoldersAt | Refusal {
	const title = titleNode(p, index);
	if (isRefusal(title)) return title;
	const pair = findPair(title, 'holders');
	const v = pair?.value;
	if (isAlias(v)) return refuse('bad-value', 'The holders are written as a YAML alias. Edit the note text.');
	if (isSeq(v)) return { title, pair, seq: v };
	if (isMap(v)) return refuse('bad-value', HOLDERS_MAP);
	if (isScalar(v) && !isEmpty(v.value)) return { title, pair, scalar: v };
	return { title, pair };
}

/** A scalar as it can stand in a flow list or map: its own text if that reads back the same, else quoted. */
const scalarFlowText = (node: Scalar) => flowScalar('person', String(node.value), node);

/** A new holder list: a block list of one-line flow maps (or a flow list inside a flow map). */
function newList(src: Source, at: HoldersAt, flows: string[], layout: Layout): Patch {
	const value: NewValue = { block: flows.map((f) => `${' '.repeat(layout.seqIndent)}- ${f}`), flow: `[${flows.join(', ')}]` };
	if (!at.pair) return addPair(src, at.title, 'holders', value, TITLE_ORDER, layout);
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
function listPatches(p: Parsed, t: number, final: Final[]): Patch[] | Refusal {
	const at = holdersAt(p, t);
	if (isRefusal(at)) return at;
	const src = p.src;
	const layout = layoutOf(src);
	const kept = final.flatMap((f) => ('from' in f ? [f.from] : []));
	if ((!at.seq || !at.seq.items.length) && !at.scalar) return final.length ? [newList(src, at, final.map((f) => ('flow' in f ? f.flow : '')), layout)] : [];
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
		patches.push(seq.flow ? insertAt(src.nodeEnd(seq.items[k] as Node), flows.map((x) => `, ${x}`).join('')) : insertAt(itemEnd(src, seq, k), flows.map((x) => '\n' + line(x)).join('')));
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
	const text = typeof name === 'string' ? name : '';
	// `slugify` falls back to "person"; a title with no usable letters is a "title".
	return uniqueId(slugify(text) === 'person' && !/person/i.test(text) ? 'title' : text, ids);
};

function addTitle(ctx: TitleContext, op: AddTitle): EditResult {
	const { data } = ctx;
	if (typeof op.id !== 'string' || str(op.id) !== op.id) return refuse('bad-value', 'The new id must be text without spaces at the ends.');
	if (typeof op.name !== 'string' || op.name.trim() === '') return refuse('bad-value', 'A title must have a name.');
	if (op.maleName !== undefined && op.maleName !== null && typeof op.maleName !== 'string') return refuse('bad-value', 'The name for a man must be text.');
	if (op.femaleName !== undefined && op.femaleName !== null && typeof op.femaleName !== 'string') return refuse('bad-value', 'The name for a woman must be text.');
	if (op.plural !== undefined && op.plural !== null && typeof op.plural !== 'string') return refuse('bad-value', 'The plural must be text.');
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
		const pad = ' '.repeat(layout.seqIndent);
		const itemPad = ' '.repeat(layout.seqIndent + layout.itemIndent);
		const value = { block: block.map((l, n) => (n === 0 ? `${pad}- ${l}` : itemPad + l)), flow: `[${flow}]` };
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
	if (op.name !== undefined && (typeof op.name !== 'string' || op.name.trim() === '')) return refuse('bad-value', 'A title must have a name.');
	if (op.maleName !== undefined && op.maleName !== null && typeof op.maleName !== 'string') return refuse('bad-value', 'The name for a man must be text.');
	if (op.femaleName !== undefined && op.femaleName !== null && typeof op.femaleName !== 'string') return refuse('bad-value', 'The name for a woman must be text.');
	if (op.plural !== undefined && op.plural !== null && typeof op.plural !== 'string') return refuse('bad-value', 'The plural must be text.');
	const expected = clone(ctx.data) as RawMap;
	const title = rawTitles(expected)[index] as RawMap;
	const changes: [string, string | null][] = [];
	if (op.name !== undefined && str(title.name) !== str(op.name)) {
		title.name = op.name;
		changes.push(['name', op.name]);
	}
	// Optional text keys: null or empty text removes the key.
	const optional = (key: string, v: string | null | undefined) => {
		if (v === undefined) return;
		const write = v === null || v.trim() === '' ? null : v;
		if (write === null && Object.prototype.hasOwnProperty.call(title, key)) {
			delete title[key];
			changes.push([key, null]);
		} else if (write !== null && str(title[key]) !== str(write)) {
			title[key] = write;
			changes.push([key, write]);
		}
	};
	optional('male-name', op.maleName);
	optional('female-name', op.femaleName);
	optional('plural', op.plural);
	if (!changes.length) return { ok: true, body: ctx.first.src.text, created: [] };
	const change = (c: [string, string | null]): Step => (p) => {
		const node = titleNode(p, index);
		return isRefusal(node) ? node : mapChanges(p.src, node, [c], TITLE_ORDER);
	};
	return finishTogether(ctx.first, changes.map(change), expected, []);
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
	if (!made.changed.length) return refuse('bad-value', 'A holder needs a person or a name.');
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
 * holds. `beforeData` is the parse of `before` when the caller has it. A body with no
 * `card-title` costs no parse; otherwise the data of the bodies the write parsed anyway is used
 * (`recall`), and the new body is parsed again only to remove a key.
 */
export function cleanCardTitles(before: string, after: string, beforeData?: Raw): EditResult {
	const unchanged: EditResult = { ok: true, body: after, created: [] };
	if (before === after || !before.includes('card-title')) return unchanged;
	const data = beforeData ?? recall(before) ?? parsedData(before);
	if (data === undefined) return unchanged;
	const valid = validCardTitles(data);
	if (!valid.size) return unchanged;
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
