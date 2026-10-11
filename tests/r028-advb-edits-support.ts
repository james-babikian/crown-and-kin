/*
 * Helpers of the 0.2.8 adversarial edit tests (agent beta, target X4). Not a test file.
 *
 * - `FORMS`: ways a note can carry a tree block (fences with ``` and ~~~, longer fences, decoys, callouts, list items,
 *   front matter, a BOM, CRLF, two blocks, no closing fence).
 * - `baseBody`: a tree body full of comments and unknown keys, so that an edit can be checked for damage.
 * - `project` and `refApply`: a small reference of the edit rules of spec §6, written from the spec: the model after an
 *   edit is the model before it with the intended change and nothing else.
 * - `genOp`: a random edit that fits the model, with the outcome the spec gives.
 */

import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import type { Tree } from '../src/core/types';
import { pick, rng } from './r028-advb-gen';

// ---------------------------------------------------------------------------------------------------------
// Forms of a note

export interface Form {
	name: string;
	/** The note text that holds `body` as block number `ordinal`. `body` uses `\n`. */
	wrap(body: string, other: string): { text: string; ordinal: number };
}

const lines = (s: string) => s.split('\n');
const prefixed = (body: string, prefix: string) => lines(body).map((l) => (l === '' ? prefix.trimEnd() : prefix + l)).join('\n');
const PARA = '# A note\n\nSome text with `inline code` and a [[link]].\n\n';
const TAIL = '\nText after the tree.\n';

export const FORMS: Form[] = [
	{ name: 'plain', wrap: (b) => ({ text: `${PARA}\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'tilde fence', wrap: (b) => ({ text: `${PARA}~~~dynasty\n${b}\n~~~\n${TAIL}`, ordinal: 0 }) },
	{ name: 'longer fence', wrap: (b) => ({ text: `${PARA}\`\`\`\`\`dynasty\n${b}\n\`\`\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'front matter, tabs of text after', wrap: (b) => ({ text: `---\ntitle: Tree\ntags: [a, b]\n---\n${PARA}\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'BOM and front matter', wrap: (b) => ({ text: `﻿---\ntitle: Tree\n---\n${PARA}\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'a dynasty example inside a longer fence, then the tree', wrap: (b, o) => ({ text: `${PARA}\`\`\`\`markdown\n\`\`\`dynasty\n${o}\`\`\`\n\`\`\`\`\n\n\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'a dynasty example inside a tilde fence, then the tree', wrap: (b, o) => ({ text: `${PARA}~~~~text\n\`\`\`dynasty\n${o}\`\`\`\n~~~~\n\n\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'two trees, the first', wrap: (b, o) => ({ text: `${PARA}\`\`\`dynasty\n${b}\n\`\`\`\n\nBetween.\n\n\`\`\`dynasty\n${o}\`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'two trees, the second', wrap: (b, o) => ({ text: `${PARA}\`\`\`dynasty\n${o}\`\`\`\n\nBetween.\n\n\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`, ordinal: 1 }) },
	{ name: 'callout', wrap: (b) => ({ text: `${PARA}> [!note] The tree\n> \`\`\`dynasty\n${prefixed(b, '> ')}\n> \`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'nested callout', wrap: (b) => ({ text: `${PARA}> [!note] Outer\n> > [!tip] Inner\n> > \`\`\`dynasty\n${prefixed(b, '> > ')}\n> > \`\`\`\n${TAIL}`, ordinal: 0 }) },
	{ name: 'list item', wrap: (b) => ({ text: `${PARA}- an item\n  \`\`\`dynasty\n${prefixed(b, '  ')}\n  \`\`\`\n- next item\n${TAIL}`, ordinal: 0 }) },
	{ name: 'callout in a list item', wrap: (b) => ({ text: `${PARA}- an item\n  > [!note]\n  > \`\`\`dynasty\n${prefixed(b, '  > ')}\n  > \`\`\`\n- next item\n${TAIL}`, ordinal: 0 }) },
	{ name: 'numbered list item with four spaces', wrap: (b) => ({ text: `${PARA}1. an item\n   \`\`\`dynasty\n${prefixed(b, '   ')}\n   \`\`\`\n2. next\n${TAIL}`, ordinal: 0 }) },
	{ name: 'no closing fence, end of the note', wrap: (b) => ({ text: `${PARA}\`\`\`dynasty\n${b}\n`, ordinal: 0 }) },
	{ name: 'CRLF', wrap: (b) => ({ text: `${PARA}\`\`\`dynasty\n${b}\n\`\`\`\n${TAIL}`.replace(/\n/g, '\r\n'), ordinal: 0 }) },
	{ name: 'CRLF in a callout, two trees', wrap: (b, o) => ({ text: `${PARA}\`\`\`dynasty\n${o}\`\`\`\n\n> [!note]\n> \`\`\`dynasty\n${prefixed(b, '> ')}\n> \`\`\`\n${TAIL}`.replace(/\n/g, '\r\n'), ordinal: 1 }) },
];

// ---------------------------------------------------------------------------------------------------------
// A body full of things that an edit must not damage

export interface Base {
	body: string;
	ids: string[];
	houses: string[];
	titles: string[];
}

export function baseBody(rand: () => number): Base {
	const n = 7 + Math.floor(rand() * 8);
	const out: string[] = ['# top-comment', 'x-top: keep # c-top'];
	const ids: string[] = [];
	const houses = ['h0', 'h1'];
	if (rand() < 0.7) out.push('options:', '  start: p0 # c-opt', '  x-opt: keep');
	out.push('houses:');
	houses.forEach((h, i) => out.push(`  # --- ${h} ---`, `  - id: ${h} # c-${h}`, `    name: House ${i}`, `    color: "#${i ? 'aa' : '00'}${i ? '00' : 'aa'}${i ? 'cc' : '00'}"`, `    x-${h}: keep`));
	out.push('people:');
	for (let i = 0; i < n; i++) {
		const id = `p${i}`;
		ids.push(id);
		const parents: string[] = [];
		if (i > 1 && rand() < 0.75) {
			const k = rand() < 0.6 ? 2 : 1;
			while (parents.length < k) {
				const c = `p${Math.floor(rand() * i)}`;
				if (!parents.includes(c)) parents.push(c);
			}
		}
		const sex = pick(rand, ['m', 'f']);
		const house = rand() < 0.5 ? pick(rand, houses) : undefined;
		out.push(`  # --- ${id} ---`);
		const style = pick(rand, ['block', 'block', 'flow', 'block-list']);
		if (style === 'flow') {
			out.push(`  - {id: ${id}, name: Person ${i}, sex: ${sex}${house ? `, house: ${house}` : ''}, born: ${1000 + i * 12}, x-${id}: keep${parents.length ? `, parents: [${parents.join(', ')}]` : ''}} # c-${id}`);
		} else {
			out.push(`  - id: ${id} # c-${id}`, `    name: Person ${i}`, `    sex: ${sex}`);
			if (house) out.push(`    house: ${house}`);
			out.push(`    born: ${1000 + i * 12}`, `    x-${id}: keep`);
			if (parents.length) {
				if (style === 'block-list') {
					out.push('    parents:');
					for (const p of parents) out.push(`      - ${p}`);
				} else out.push(`    parents: [${parents.join(', ')}] # the parents`);
			}
		}
	}
	const pairs: string[] = [];
	for (let i = 0; i < n; i += 3) if (i + 1 < n) pairs.push(`p${i}, p${i + 1}`);
	if (pairs.length) {
		out.push('unions:');
		pairs.forEach((pr, i) => out.push(`  # --- u${i} ---`, `  - partners: [${pr}] # c-u${i}`, '    type: marriage', `    x-u${i}: keep`));
	}
	const titles = ['t0'];
	out.push('titles:', '  # --- t0 ---', '  - id: t0 # c-t0', '    name: Throne', '    x-t0: keep', '    holders:', `      - {person: p0, from: 1100, to: 1130} # c-hold`, `      - {person: p1, from: 1130}`);
	out.push('# end-comment');
	return { body: out.join('\n'), ids, houses, titles };
}

/** The markers that must survive while the node they sit on survives. */
export function tagsOf(base: Base): { id: string; kind: 'person' | 'house' | 'title'; marks: string[] }[] {
	const all = [
		...base.ids.map((id) => ({ id, kind: 'person' as const, marks: [`# --- ${id} ---`, `# c-${id}`, `x-${id}: keep`] })),
		...base.houses.map((id) => ({ id, kind: 'house' as const, marks: [`# --- ${id} ---`, `# c-${id}`, `x-${id}: keep`] })),
		...base.titles.map((id) => ({ id, kind: 'title' as const, marks: [`# --- ${id} ---`, `# c-${id}`, `x-${id}: keep`] })),
	];
	return all;
}

export const TOP_MARKS = ['# top-comment', 'x-top: keep # c-top', '# end-comment'];

// ---------------------------------------------------------------------------------------------------------
// The model

export interface MPerson {
	id: string;
	name: string;
	sobriquet?: string;
	born?: string;
	died?: string;
	sex?: string;
	illegitimate: boolean;
	childless: boolean;
	hasLink: boolean;
	hasPortrait: boolean;
	house?: string;
	title?: string;
	parents: { id: string; type: string }[];
}
export interface MUnion {
	partners: [string, string];
	type: string;
	start?: string;
	end?: string;
}
export interface MHolder {
	person?: string;
	name?: string;
	from?: string;
	to?: string;
}
export interface Model {
	people: MPerson[];
	unions: MUnion[];
	options: { start?: string; focus?: string; me?: string; generations?: number; height?: number };
	houses: { id: string; name: string; color?: string }[];
	titles: { id: string; name: string; holders: MHolder[] }[];
}

export function project(tree: Tree): Model {
	return {
		people: tree.people.map((p) => ({
			id: p.id,
			name: p.name,
			...(p.sobriquet !== undefined ? { sobriquet: p.sobriquet } : {}),
			...(p.born !== undefined ? { born: p.born } : {}),
			...(p.died !== undefined ? { died: p.died } : {}),
			...(p.sex !== undefined ? { sex: p.sex } : {}),
			illegitimate: p.illegitimate,
			childless: p.childless === true,
			hasLink: p.link !== undefined,
			hasPortrait: p.portrait !== undefined,
			...(p.house !== undefined ? { house: p.house } : {}),
			...(p.title !== undefined ? { title: p.title } : {}),
			parents: p.parents.map((r) => ({ id: r.id, type: r.type })),
		})),
		unions: tree.unions.map((u) => ({ partners: [u.partners[0], u.partners[1]] as [string, string], type: u.type, ...(u.start !== undefined ? { start: u.start } : {}), ...(u.end !== undefined ? { end: u.end } : {}) })),
		options: { ...tree.options },
		houses: tree.houses.map((h) => ({ id: h.id, name: h.name, ...(h.color !== undefined ? { color: h.color } : {}) })),
		titles: (tree.titles ?? []).map((t) => ({
			id: t.id,
			name: t.name,
			holders: t.holders.map((h) => ({ ...(h.person !== undefined ? { person: h.person } : {}), ...(h.name !== undefined ? { name: h.name } : {}), ...(h.from !== undefined ? { from: h.from } : {}), ...(h.to !== undefined ? { to: h.to } : {}) })),
		})),
	};
}

export function modelOf(body: string): { model: Model; tree: Tree } {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error(`the body does not parse: ${r.error.code} ${r.error.detail ?? ''}\n${body}`);
	return { model: project(r.tree), tree: r.tree };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The outcome the spec gives: a refusal with a code, or the new model. `order` says how strictly the order of people is checked. */
export type Outcome = { ok: false; code: string } | { ok: true; model: Model; order: 'exact' | 'subsequence' };

export interface Gen {
	op: Op;
	kind: string;
	/** True when applying the same op twice must give the same body as applying it once (minimal diff). */
	idempotent: boolean;
	ref(m: Model): Outcome;
	/** Ids that this edit removes (their tags may go). */
	removes?: string[];
}

const TYPES = ['birth', 'adoptive', 'ward', 'rumoured'] as const;

function descendants(m: Model, id: string): Set<string> {
	const out = new Set<string>();
	const stack = [id];
	while (stack.length) {
		const x = stack.pop()!;
		for (const p of m.people) {
			if (!p.parents.some((r) => r.id === x) || out.has(p.id)) continue;
			out.add(p.id);
			stack.push(p.id);
		}
	}
	return out;
}

/** Texts for fields; none has white space at its ends (the reader trims, and that is not the point here). */
const NAMES = ['Ada', 'Bo Chen', 'Ælfric', '李小龍', 'محمد', '😀 Zed', 'Ann: B', '- dash', '#hash', '"quoted"', "O'Neil", '[[Link]]', '{x}', '* star', '! bang', '%', '@at', '& amp', '| bar', '> gt', 'yes', 'null', '~', '1e3', '0x10', 'a #b', 'a: b # c', '```', '~~~ x', '---', '...', 'x'.repeat(300), 'tab\there', 'two\nlines', 'a b'];
const DATES = ['1200', 'c. 1200', '12 May 1203', '-200', '200 BC', '?', 'yes', 'unknown', '1,250', '12000', '1203-05-12', 'alive'];
const LINKS = ['[[Note]]', '[[Folder/Note|Alias]]', '[[Smith, John]]', '[Alias](Note.md)', 'Note', '[[A#Heading]]'];

export function genOp(rand: () => number, m: Model, counter: { n: number }): Gen {
	for (let tries = 0; tries < 50; tries++) {
		const g = tryOp(rand, m, counter);
		if (g) return g;
	}
	return setName(rand, m);
}

function setName(rand: () => number, m: Model): Gen {
	const p = pick(rand, m.people);
	const name = pick(rand, NAMES);
	return {
		kind: 'set-name',
		idempotent: true,
		op: { kind: 'set-person-fields', id: p.id, fields: { name } },
		ref: (x) => {
			const y = clone(x);
			y.people.find((q) => q.id === p.id)!.name = name.trim();
			return { ok: true, model: y, order: 'exact' };
		},
	};
}

function tryOp(rand: () => number, m: Model, counter: { n: number }): Gen | null {
	const kinds = ['fields', 'fields', 'fields', 'fields', 'add-person', 'add-person', 'add-parent', 'add-parent', 'remove-parent', 'set-parent-type', 'add-union', 'edit-union', 'remove-union', 'move-sibling', 'move-sibling', 'delete-person', 'set-option', 'edit-house', 'add-house', 'set-house-id', 'delete-house', 'add-title', 'edit-title', 'add-holder', 'remove-holder', 'edit-holder', 'set-title-id', 'delete-title', 'dup-id', 'unknown-person', 'limit', 'cycle'];
	const k = pick(rand, kinds);
	const people = m.people;
	if (!people.length && k !== 'add-person') return null;
	const P = () => pick(rand, people);

	if (k === 'fields') {
		const p = P();
		const fields: Record<string, string | boolean | null> = {};
		const pickFields = ['name', 'sobriquet', 'born', 'died', 'sex', 'illegitimate', 'childless', 'link', 'portrait', 'house', 'title'];
		const n = 1 + Math.floor(rand() * 3);
		for (let i = 0; i < n; i++) {
			const f = pick(rand, pickFields);
			if (f === 'name') fields.name = pick(rand, NAMES);
			else if (f === 'sobriquet') fields.sobriquet = rand() < 0.3 ? null : pick(rand, ['the Bold', 'the Wise', 'x y', 'Lackland']);
			else if (f === 'born' || f === 'died') fields[f] = rand() < 0.25 ? null : pick(rand, DATES);
			else if (f === 'sex') fields.sex = rand() < 0.25 ? null : pick(rand, ['m', 'f', 'x']);
			else if (f === 'illegitimate' || f === 'childless') fields[f] = rand() < 0.5;
			else if (f === 'link' || f === 'portrait') fields[f] = rand() < 0.3 ? null : pick(rand, LINKS);
			else if (f === 'house') fields.house = rand() < 0.3 || !m.houses.length ? null : pick(rand, m.houses).id;
			else fields.title = rand() < 0.3 ? null : pick(rand, ['Duke', 'Queen of Nowhere', 'Count: of X']);
		}
		return {
			kind: 'fields',
			idempotent: true,
			op: { kind: 'set-person-fields', id: p.id, fields },
			ref: (x) => {
				const y = clone(x);
				const q = y.people.find((z) => z.id === p.id)!;
				for (const [f, v] of Object.entries(fields)) {
					if (f === 'name') q.name = (v as string).trim();
					else if (f === 'sobriquet') {
						if (v === null) delete q.sobriquet;
						else q.sobriquet = (v as string).trim().replace(/\s+/g, ' ');
					} else if (f === 'born' || f === 'died' || f === 'sex' || f === 'house' || f === 'title') {
						if (v === null) delete q[f];
						else q[f] = (v as string).trim();
					} else if (f === 'illegitimate' || f === 'childless') q[f] = v === true;
					else if (f === 'link') q.hasLink = v !== null;
					else if (f === 'portrait') q.hasPortrait = v !== null;
				}
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'add-person') {
		const id = `n${counter.n++}`;
		const name = pick(rand, NAMES);
		const parents: { id: string; type: (typeof TYPES)[number] }[] = [];
		if (people.length && rand() < 0.6) {
			const kk = 1 + Math.floor(rand() * 2);
			const t = pick(rand, TYPES);
			while (parents.length < kk && parents.length < people.length) {
				const c = P().id;
				if (!parents.some((r) => r.id === c)) parents.push({ id: c, type: t });
			}
		}
		const where = rand();
		const target = people.length ? P().id : '';
		const at = where < 0.4 || !people.length ? undefined : where < 0.6 ? ({ kind: 'after', id: target } as const) : where < 0.8 ? ({ kind: 'before', id: target } as const) : (parents.length ? ({ kind: 'after-siblings', parents: parents.map((r) => r.id) } as const) : undefined);
		const sex = rand() < 0.5 ? 'm' : 'f';
		return {
			kind: 'add-person',
			idempotent: false,
			op: { kind: 'add-person', id, fields: { name, sex }, ...(parents.length ? { parents } : {}), ...(at ? { at } : {}) },
			ref: (x) => {
				const y = clone(x);
				const q: MPerson = { id, name: name.trim(), sex, illegitimate: false, childless: false, hasLink: false, hasPortrait: false, parents: parents.map((r) => ({ id: r.id, type: r.type })) };
				if (at && (at.kind === 'after' || at.kind === 'before')) {
					const i = y.people.findIndex((z) => z.id === at.id);
					y.people.splice(at.kind === 'after' ? i + 1 : i, 0, q);
					return { ok: true, model: y, order: 'exact' };
				}
				y.people.push(q);
				return { ok: true, model: y, order: at ? 'subsequence' : 'exact' };
			},
		};
	}

	if (k === 'add-parent') {
		const child = P();
		const parent = P();
		if (child.id === parent.id || child.parents.some((r) => r.id === parent.id)) return null;
		const type = pick(rand, TYPES);
		return {
			kind: 'add-parent',
			idempotent: false,
			op: { kind: 'add-parent', child: child.id, parent: parent.id, type },
			ref: (x) => {
				const c = x.people.find((z) => z.id === child.id)!;
				// The spec names both refusals and not their order: when both apply, either code is right.
				const full = c.parents.filter((r) => r.type === type).length >= 2;
				const loop = descendants(x, child.id).has(parent.id);
				if (full || loop) return { ok: false, code: full && loop ? 'limit|cycle' : full ? 'limit' : 'cycle' };
				const y = clone(x);
				const cc = y.people.find((z) => z.id === child.id)!;
				const others = cc.parents.filter((r) => r.type === type);
				cc.parents.push({ id: parent.id, type });
				// Two birth or two adoptive parents with no union between them get a marriage (spec §6.4).
				if ((type === 'birth' || type === 'adoptive') && others.length === 1 && !y.unions.some((u) => u.partners.includes(others[0].id) && u.partners.includes(parent.id))) y.unions.push({ partners: [others[0].id, parent.id], type: 'marriage' });
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'remove-parent') {
		const child = people.find((p) => p.parents.length);
		if (!child) return null;
		const c = pick(rand, people.filter((p) => p.parents.length));
		const r = pick(rand, c.parents);
		return {
			kind: 'remove-parent',
			idempotent: false,
			op: { kind: 'remove-parent', child: c.id, parent: r.id, type: r.type as (typeof TYPES)[number] },
			ref: (x) => {
				const y = clone(x);
				const cc = y.people.find((z) => z.id === c.id)!;
				cc.parents = cc.parents.filter((z) => !(z.id === r.id && z.type === r.type));
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'set-parent-type') {
		const c = pick(rand, people.filter((p) => p.parents.length).concat(people.slice(0, 0)));
		if (!c) return null;
		const r = pick(rand, c.parents);
		const to = pick(rand, TYPES);
		return {
			kind: 'set-parent-type',
			idempotent: false,
			op: { kind: 'set-parent-type', child: c.id, parent: r.id, from: r.type as (typeof TYPES)[number], to },
			ref: (x) => {
				if (to !== r.type && x.people.find((z) => z.id === c.id)!.parents.filter((z) => z.type === to).length >= 2) return { ok: false, code: 'limit' };
				const y = clone(x);
				const cc = y.people.find((z) => z.id === c.id)!;
				cc.parents.find((z) => z.id === r.id && z.type === r.type)!.type = to;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'add-union') {
		const a = P();
		const b = P();
		if (a.id === b.id) return null;
		const type = pick(rand, ['marriage', 'betrothal', 'concubinage', 'affair'] as const);
		const start = rand() < 0.5 ? pick(rand, ['1200', 'c. 1200']) : undefined;
		return {
			kind: 'add-union',
			idempotent: false,
			op: { kind: 'add-union', partners: [a.id, b.id], type, ...(start ? { start } : {}) },
			ref: (x) => {
				const y = clone(x);
				y.unions.push({ partners: [a.id, b.id], type, ...(start ? { start } : {}) });
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'edit-union' || k === 'remove-union') {
		if (!m.unions.length) return null;
		const i = Math.floor(rand() * m.unions.length);
		const u = m.unions[i];
		const ref = { index: i, partners: u.partners };
		if (k === 'remove-union')
			return {
				kind: 'remove-union',
				idempotent: false,
				op: { kind: 'remove-union', union: ref },
				ref: (x) => {
					const y = clone(x);
					y.unions.splice(i, 1);
					return { ok: true, model: y, order: 'exact' };
				},
			};
		const type = pick(rand, ['marriage', 'betrothal', 'affair']);
		const end = rand() < 0.5 ? null : pick(rand, ['1250', 'c. 1250']);
		return {
			kind: 'edit-union',
			idempotent: true,
			op: { kind: 'edit-union', union: ref, fields: { type, end } },
			ref: (x) => {
				const y = clone(x);
				y.unions[i].type = type;
				if (end === null) delete y.unions[i].end;
				else y.unions[i].end = end;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'move-sibling') {
		const p = P();
		const dir = pick(rand, ['earlier', 'later'] as const);
		// The group: people with the same placement parents (spec §4.3: birth, else adoptive, else ward; at most two).
		const place = (q: MPerson): string[] => {
			for (const t of ['birth', 'adoptive', 'ward']) {
				const ps = q.parents.filter((r) => r.type === t).map((r) => r.id);
				if (ps.length) return ps.slice(0, 2);
			}
			return [];
		};
		const key = (q: MPerson) => place(q).slice().sort().join(',');
		return {
			kind: 'move-sibling',
			idempotent: false,
			op: { kind: 'move-sibling', id: p.id, direction: dir },
			ref: (x) => {
				const me = x.people.find((z) => z.id === p.id)!;
				const group = x.people.filter((z) => place(z).length > 0 && key(z) === key(me));
				const gi = group.findIndex((z) => z.id === p.id);
				const other = dir === 'earlier' ? group[gi - 1] : group[gi + 1];
				if (!me.parents.length || !other) return { ok: false, code: 'no-sibling' };
				const y = clone(x);
				const i = y.people.findIndex((z) => z.id === p.id);
				const j = y.people.findIndex((z) => z.id === other.id);
				[y.people[i], y.people[j]] = [y.people[j], y.people[i]];
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'delete-person') {
		if (people.length < 3) return null;
		const p = P();
		return {
			kind: 'delete-person',
			idempotent: false,
			op: { kind: 'delete-person', id: p.id },
			removes: [p.id],
			ref: (x) => {
				const y = clone(x);
				y.people = y.people.filter((z) => z.id !== p.id);
				for (const z of y.people) z.parents = z.parents.filter((r) => r.id !== p.id);
				y.unions = y.unions.filter((u) => !u.partners.includes(p.id));
				for (const key of ['start', 'focus', 'me'] as const) if (y.options[key] === p.id) delete y.options[key];
				for (const t of y.titles) t.holders = t.holders.filter((h) => h.person !== p.id);
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'set-option') {
		const key = pick(rand, ['start', 'focus', 'me'] as const);
		const value = rand() < 0.25 ? null : P().id;
		return {
			kind: 'set-option',
			idempotent: true,
			op: { kind: 'set-option', key, value },
			ref: (x) => {
				const y = clone(x);
				if (value === null) delete y.options[key];
				else y.options[key] = value;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'add-house') {
		const name = pick(rand, ['House Orsini', 'Haus Löwe', 'Ünal', 'House of the Rising Sun']);
		const color = rand() < 0.5 ? pick(rand, ['#112233', '#abcdef']) : undefined;
		return {
			kind: 'add-house',
			idempotent: false,
			op: { kind: 'add-house', name, ...(color ? { color } : {}) },
			ref: (x) => {
				const y = clone(x);
				y.houses.push({ id: '?', name, ...(color ? { color } : {}) });
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'edit-house') {
		if (!m.houses.length) return null;
		const h = pick(rand, m.houses);
		const name = pick(rand, ['Renamed', 'Neu: Haus', '"Q"']);
		const color = rand() < 0.3 ? null : pick(rand, ['#445566', '#ff00ff']);
		return {
			kind: 'edit-house',
			idempotent: true,
			op: { kind: 'edit-house', id: h.id, name, color },
			ref: (x) => {
				const y = clone(x);
				const hh = y.houses.find((z) => z.id === h.id)!;
				hh.name = name.trim();
				if (color === null) delete hh.color;
				else hh.color = color;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'delete-house') {
		if (!m.houses.length) return null;
		const h = pick(rand, m.houses);
		const clear = rand() < 0.5;
		return {
			kind: 'delete-house',
			idempotent: false,
			op: { kind: 'delete-house', id: h.id, people: clear ? 'clear' : 'keep' },
			removes: [h.id],
			ref: (x) => {
				const y = clone(x);
				y.houses = y.houses.filter((z) => z.id !== h.id);
				if (clear) for (const z of y.people) if (z.house === h.id) delete z.house;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'set-house-id') {
		if (!m.houses.length) return null;
		const h = pick(rand, m.houses);
		const newId = pick(rand, ['house-x', 'ab', 'h1', 'h0', 'x_y', 'A', '', '-', '1']);
		return {
			kind: 'set-house-id',
			idempotent: false,
			op: { kind: 'set-house-id', id: h.id, newId },
			ref: (x) => {
				if (newId === h.id) return { ok: true, model: clone(x), order: 'exact' };
				// §13.17 rule 5: a-z, 0-9 and hyphen, with a letter or a digit; an id in use is refused.
				if (!/^[a-z0-9-]+$/.test(newId) || !/[a-z0-9]/.test(newId)) return { ok: false, code: 'bad-value' };
				if (x.houses.some((z) => z.id === newId) || x.people.some((z) => z.house === newId)) return { ok: false, code: 'id-taken' };
				const y = clone(x);
				y.houses.find((z) => z.id === h.id)!.id = newId;
				for (const z of y.people) if (z.house === h.id) z.house = newId;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'add-title') {
		const id = `tt${counter.n++}`;
		return {
			kind: 'add-title',
			idempotent: false,
			op: { kind: 'add-title', id, name: 'Duchy of Nowhere' },
			ref: (x) => {
				const y = clone(x);
				y.titles.push({ id, name: 'Duchy of Nowhere', holders: [] });
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	if (k === 'edit-title' || k === 'set-title-id' || k === 'delete-title' || k === 'add-holder' || k === 'remove-holder' || k === 'edit-holder') {
		if (!m.titles.length) return null;
		const t = pick(rand, m.titles);
		if (k === 'edit-title') {
			const name = pick(rand, ['Crown', 'Kingdom: North', 'Throne of "X"']);
			return {
				kind: k,
				idempotent: true,
				op: { kind: 'edit-title', id: t.id, name },
				ref: (x) => {
					const y = clone(x);
					y.titles.find((z) => z.id === t.id)!.name = name.trim();
					return { ok: true, model: y, order: 'exact' };
				},
			};
		}
		if (k === 'delete-title')
			return {
				kind: k,
				idempotent: false,
				op: { kind: 'delete-title', id: t.id },
				removes: [t.id],
				ref: (x) => {
					const y = clone(x);
					y.titles = y.titles.filter((z) => z.id !== t.id);
					return { ok: true, model: y, order: 'exact' };
				},
			};
		if (k === 'set-title-id') {
			const newId = pick(rand, ['crown', 'ab-1', 't0', 'Q', '']);
			return {
				kind: k,
				idempotent: false,
				op: { kind: 'set-title-id', id: t.id, newId },
				ref: (x) => {
					if (newId === t.id) return { ok: true, model: clone(x), order: 'exact' };
					if (!/^[a-z0-9-]+$/.test(newId) || !/[a-z0-9]/.test(newId)) return { ok: false, code: 'bad-value' };
					if (x.titles.some((z) => z.id === newId)) return { ok: false, code: 'id-taken' };
					const y = clone(x);
					y.titles.find((z) => z.id === t.id)!.id = newId;
					return { ok: true, model: y, order: 'exact' };
				},
			};
		}
		if (k === 'add-holder') {
			const person = P().id;
			const from = pick(rand, ['1100', 'c. 1100', '?']);
			return {
				kind: k,
				idempotent: false,
				op: { kind: 'add-holder', title: t.id, fields: { person, from } },
				ref: (x) => {
					const y = clone(x);
					y.titles.find((z) => z.id === t.id)!.holders.push({ person, from });
					return { ok: true, model: y, order: 'exact' };
				},
			};
		}
		const hs = t.holders;
		if (!hs.length) return null;
		const hi = Math.floor(rand() * hs.length);
		// The ref needs the written index (`Holder.index`), which equals the position here: the generator writes only holders.
		const h = hs[hi];
		const href = { title: t.id, index: hi, ...(h.person !== undefined ? { person: h.person } : { name: h.name }) };
		if (k === 'remove-holder')
			return {
				kind: k,
				idempotent: false,
				op: { kind: 'remove-holder', holder: href },
				ref: (x) => {
					const y = clone(x);
					y.titles.find((z) => z.id === t.id)!.holders.splice(hi, 1);
					return { ok: true, model: y, order: 'exact' };
				},
			};
		const to = rand() < 0.4 ? null : pick(rand, ['1200', 'present', 'c. 1250']);
		return {
			kind: 'edit-holder',
			idempotent: true,
			op: { kind: 'edit-holder', holder: href, fields: { to } },
			ref: (x) => {
				const y = clone(x);
				const hh = y.titles.find((z) => z.id === t.id)!.holders[hi];
				if (to === null) delete hh.to;
				else hh.to = to;
				return { ok: true, model: y, order: 'exact' };
			},
		};
	}

	// Refusals the spec names: the model stays as it was.
	if (k === 'dup-id') {
		const p = P();
		return { kind: k, idempotent: true, op: { kind: 'add-person', id: p.id, fields: { name: 'Twin' } }, ref: () => ({ ok: false, code: 'id-taken' }) };
	}
	if (k === 'unknown-person')
		return { kind: k, idempotent: true, op: { kind: 'set-person-fields', id: 'nobody-here', fields: { name: 'X' } }, ref: () => ({ ok: false, code: 'unknown-person' }) };
	if (k === 'limit') {
		const c = people.find((p) => p.parents.filter((r) => r.type === 'birth').length >= 2);
		if (!c) return null;
		const other = people.find((p) => p.id !== c.id && !c.parents.some((r) => r.id === p.id) && !descendants(m, c.id).has(p.id));
		if (!other) return null;
		return { kind: k, idempotent: true, op: { kind: 'add-parent', child: c.id, parent: other.id, type: 'birth' }, ref: () => ({ ok: false, code: 'limit' }) };
	}
	if (k === 'cycle') {
		const c = people.find((p) => descendants(m, p.id).size > 0 && p.parents.filter((r) => r.type === 'adoptive').length < 2);
		if (!c) return null;
		const d = pick(rand, [...descendants(m, c.id)]);
		return { kind: k, idempotent: true, op: { kind: 'add-parent', child: c.id, parent: d, type: 'adoptive' }, ref: () => ({ ok: false, code: 'cycle' }) };
	}
	return null;
}

export { rng };
