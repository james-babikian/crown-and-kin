import { describe, it } from 'vitest';
import { parse as parseYaml, stringify } from 'yaml';
import { deriveFamilies } from '../src/core/derive';
import { focusSubgraph } from '../src/core/focus-subgraph';
import type { IssueCode } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { allFixtures } from './acceptance/load';

/*
 * Spec §8: nothing may throw or blank the note. Every sample tree is mutated a few hundred times
 * (fewer for the large ones, to keep the file near 3 s) and pushed through parse → derive →
 * layout (layout includes edge routing). A hard error is a fine outcome; a throw is not.
 *
 * Focus mode (spec §5.6, M5) runs the same mutated trees through focus subgraph → derive → layout
 * for a few focus ids and generation counts, including ids that name no person.
 *
 * Deterministic: each case has its own seed, printed on failure. To re-run one case on every
 * fixture: FUZZ_SEED=0x1234abcd npx vitest run tests/fuzz.test.ts
 */

const BASE_SEED = 0x5eed2026;
const SETTINGS: LayoutSettings = { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 } };
const BLOCKING: IssueCode[] = ['duplicate-person-id', 'duplicate-union-id'];
const HARD: string[] = ['yaml-invalid', 'not-a-map'];

// --- Deterministic randomness -------------------------------------------------------------

function hash32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

class Rng {
	private s: number;
	constructor(seed: number) {
		this.s = seed >>> 0;
	}
	/** mulberry32 */
	next(): number {
		let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	int(n: number): number {
		return Math.floor(this.next() * n);
	}
	chance(p: number): boolean {
		return this.next() < p;
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(xs.length)];
	}
}

// --- Structure helpers --------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map);

interface Slot {
	container: Obj | unknown[];
	key: string | number;
}

function slots(root: unknown): Slot[] {
	const out: Slot[] = [];
	const seen = new Set<unknown>();
	const walk = (v: unknown) => {
		if (typeof v !== 'object' || v === null || seen.has(v) || v instanceof Map) return;
		seen.add(v);
		if (Array.isArray(v)) {
			v.forEach((x, i) => {
				out.push({ container: v, key: i });
				walk(x);
			});
		} else {
			for (const k of Object.keys(v)) {
				out.push({ container: v as Obj, key: k });
				walk((v as Obj)[k]);
			}
		}
	};
	walk(root);
	return out;
}

const read = (s: Slot): unknown => (s.container as Record<string | number, unknown>)[s.key];
const write = (s: Slot, v: unknown) => {
	(s.container as Record<string | number, unknown>)[s.key] = v;
};
function remove(s: Slot) {
	if (Array.isArray(s.container)) s.container.splice(s.key as number, 1);
	else delete s.container[s.key as string];
}

const section = (root: unknown, name: string): Obj[] => {
	const v = isObj(root) ? root[name] : undefined;
	return Array.isArray(v) ? v.filter(isObj) : [];
};
const idsIn = (root: unknown): unknown[] => section(root, 'people').map((p) => p.id);

function nested(rng: Rng, depth: number): unknown {
	let v: unknown = rng.pick(['leaf', 1, null, 'aldric']);
	for (let i = 0; i < depth; i++) v = rng.chance(0.5) ? [v] : { [rng.pick(['id', 'people', 'parents', 'x'])]: v };
	return v;
}

const SPECIAL_IDS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype', '', ' ', '0', 'NaN', 'undefined', 'null', 'a|b', 'u0', 'i:a|b', '~1', '[[x]]'];

function weird(rng: Rng, root: unknown): unknown {
	const makers: (() => unknown)[] = [
		() => null,
		() => true,
		() => false,
		() => 0,
		() => -1,
		() => 3.5,
		() => 1e300,
		() => NaN,
		() => Infinity,
		() => '',
		() => ' ',
		() => 'x'.repeat(1 + rng.int(20000)),
		() => '[[Some Note]]',
		() => [['Some Note']],
		() => [['a', 'b'], ['c']],
		() => '#abc123',
		() => [],
		() => ({}),
		() => [[]],
		() => [null],
		() => ({ id: null }),
		() => ({ id: {} }),
		() => ({ id: [] }),
		() => [1, [2, [3]]],
		() => rng.pick(idsIn(root).length ? idsIn(root) : ['aldric']),
		() => `ghost-${rng.int(5)}`,
		() => 42,
		() => '1102-03-04',
		() => '\u0000‮😀 \ud800',
		() => 'a: b',
		() => '- x',
		() => rng.pick(SPECIAL_IDS),
		() => nested(rng, 1 + rng.int(60)),
	];
	return rng.pick(makers)();
}

// --- Mutations ----------------------------------------------------------------------------

type Mutation = (root: unknown, rng: Rng) => unknown;

const MUTATIONS: Record<string, Mutation> = {
	'drop-key': (root, rng) => {
		const s = slots(root).filter((x) => !Array.isArray(x.container));
		if (s.length) remove(rng.pick(s));
		return root;
	},
	'drop-item': (root, rng) => {
		const s = slots(root).filter((x) => Array.isArray(x.container));
		if (s.length) remove(rng.pick(s));
		return root;
	},
	'swap-type': (root, rng) => {
		const s = slots(root);
		if (s.length) write(rng.pick(s), weird(rng, root));
		return root;
	},
	'dangle-id': (root, rng) => {
		const ghost = rng.pick(['ghost', 'nobody', 99, '', null, rng.pick(SPECIAL_IDS)]);
		const people = section(root, 'people');
		const unions = section(root, 'unions');
		const which = rng.int(6);
		if (which === 0 && people.length) {
			const p = rng.pick(people);
			p.parents = Array.isArray(p.parents) ? [...p.parents, ghost] : ghost;
		} else if (which === 1 && unions.length) {
			const u = rng.pick(unions);
			u.partners = Array.isArray(u.partners) && u.partners.length ? [u.partners[0], ghost] : [ghost, ghost];
		} else if (which === 2 && people.length) rng.pick(people).house = ghost;
		else if (which === 3 && people.length) rng.pick(people).union = ghost;
		else if (isObj(root)) {
			const opts = isObj(root.options) ? root.options : (root.options = {});
			(opts as Obj)[rng.pick(['start', 'focus'])] = ghost;
		}
		return root;
	},
	cycle: (root, rng) => {
		const people = section(root, 'people');
		if (people.length < 2) return root;
		const n = Math.min(people.length, 1 + rng.int(4));
		const ring = Array.from({ length: n }, () => rng.pick(people));
		ring.forEach((p, i) => {
			const parent = ring[(i + 1) % n].id;
			const ref = rng.chance(0.5) ? parent : { id: parent, type: rng.pick(['birth', 'adoptive', 'ward', 'rumoured', 'godparent']) };
			p.parents = [...(Array.isArray(p.parents) ? p.parents : []), ref];
		});
		return root;
	},
	'many-parents': (root, rng) => {
		const people = section(root, 'people');
		if (!people.length) return root;
		const ids = idsIn(root);
		const p = rng.pick(people);
		p.parents = Array.from({ length: 3 + rng.int(5) }, () =>
			rng.chance(0.4) ? rng.pick(ids) : { id: rng.pick(ids), type: rng.pick(['birth', 'adoptive', 'ward', 'rumoured', 'x', 7, null]) },
		);
		if (rng.chance(0.5)) p.placement = rng.pick(['birth', 'adoptive', 'ward', 'rumoured', 'nope', 3, true, null]);
		return root;
	},
	'self-reference': (root, rng) => {
		const people = section(root, 'people');
		const unions = section(root, 'unions');
		if (people.length && rng.chance(0.5)) {
			const p = rng.pick(people);
			p.parents = [p.id, { id: p.id, type: 'adoptive' }];
		} else if (unions.length) {
			const u = rng.pick(unions);
			const a = Array.isArray(u.partners) ? u.partners[0] : 'x';
			u.partners = rng.pick([[a, a], [a], [], [a, a, a], [a, 'b', 'c', 'd']]);
		}
		return root;
	},
	'odd-scalars': (root, rng) => {
		const people = section(root, 'people');
		const unions = section(root, 'unions');
		const houses = section(root, 'houses');
		const v = () => rng.pick<unknown>(['', 'm', 'f', 'x', 'birth', 'ward', 'marriage', 'affair', 'weird', 0, 1, true, null, [], {}, 'yes', 'no']);
		if (people.length) {
			const p = rng.pick(people);
			p[rng.pick(['sex', 'placement', 'illegitimate', 'union', 'born', 'died', 'title', 'link', 'notes', 'name', 'house'])] = v();
		}
		if (unions.length) rng.pick(unions)[rng.pick(['type', 'start', 'end', 'id'])] = v();
		if (houses.length) rng.pick(houses)[rng.pick(['color', 'name', 'id'])] = v();
		if (isObj(root) && rng.chance(0.3)) root.options = { start: v(), focus: v(), generations: v(), height: v() };
		return root;
	},
	'special-ids': (root, rng) => {
		const people = section(root, 'people');
		if (people.length < 2) return root;
		const id = rng.pick(SPECIAL_IDS);
		rng.pick(people).id = id;
		rng.pick(people).parents = [id];
		const unions = section(root, 'unions');
		if (unions.length) rng.pick(unions).id = id;
		return root;
	},
	'string-extremes': (root, rng) => {
		const s = slots(root).filter((x) => typeof read(x) === 'string');
		if (s.length) write(rng.pick(s), rng.pick(['', ' ', '\n', 'x'.repeat(5000 + rng.int(50000)), '​', '"', "'", '#', '[[', ']]', '{{', '\\']));
		return root;
	},
	'list-map': (root, rng) => {
		const s = slots(root).filter((x) => typeof read(x) === 'object' && read(x) !== null && !(read(x) instanceof Map));
		if (!s.length) return root;
		const slot = rng.pick(s);
		const v = read(slot);
		if (Array.isArray(v)) write(slot, Object.fromEntries(v.map((x, i) => [rng.chance(0.5) ? String(i) : `k${i}`, x])));
		else write(slot, rng.chance(0.5) ? Object.values(v as Obj) : Object.entries(v as Obj));
		return root;
	},
	'root-shape': (root, rng) => {
		if (!isObj(root)) return root;
		const which = rng.int(4);
		if (which === 0) return Object.values(root);
		if (which === 1) return rng.pick([null, 'text', 7, [], [root]]);
		if (which === 2) return { people: root };
		return { ...root, people: isObj(root.people) ? root.people : { a: root.people } };
	},
	'delete-section': (root, rng) => {
		if (!isObj(root)) return root;
		const name = rng.pick(['people', 'houses', 'unions', 'options']);
		if (rng.chance(0.5)) delete root[name];
		else root[name] = rng.pick([null, [], {}, '', 0, 'people', [[]], [null, null]]);
		return root;
	},
	duplicate: (root, rng) => {
		const arrays = slots(root)
			.map(read)
			.filter((v): v is unknown[] => Array.isArray(v) && v.length > 0);
		if (isObj(root)) for (const n of ['people', 'unions', 'houses']) if (Array.isArray(root[n]) && (root[n] as unknown[]).length) arrays.push(root[n] as unknown[]);
		if (!arrays.length) return root;
		const arr = rng.pick(arrays);
		const item = rng.pick(arr);
		// Half the time the same object twice, which the serialiser writes as an anchor and alias.
		const copy = rng.chance(0.5) ? item : structuredClone(item);
		arr.splice(rng.int(arr.length + 1), 0, copy);
		if (rng.chance(0.3)) arr.push(...arr.slice(0, 1 + rng.int(arr.length)));
		return root;
	},
	'non-string-keys': (root, rng) => {
		const objs = slots(root)
			.map(read)
			.filter(isObj);
		if (isObj(root)) objs.push(root);
		if (!objs.length) return root;
		const target = rng.pick(objs);
		const m = new Map<unknown, unknown>(Object.entries(target));
		m.set(rng.pick<unknown>([[1, 2], { a: 1 }, 42, null, true, 3.5, ['people']]), rng.pick<unknown>(['x', [], { id: 'k' }]));
		if (target === root) return m;
		const holder = slots(root).find((s) => read(s) === target);
		if (holder) write(holder, m);
		return root;
	},
	'deep-nesting': (root, rng) => {
		const s = slots(root);
		if (s.length) write(rng.pick(s), nested(rng, 20 + rng.int(150)));
		return root;
	},
};

const SNIPPETS = [
	'? [a, b]\n: c',
	'1: numeric key',
	'null: null key',
	'true: bool key',
	'[x, y]: flow key',
	'{a: 1}: map key',
	'__proto__: {polluted: yes}',
	'constructor: {name: x}',
	'people: &loop [*loop]',
	'people:\n  - &p {id: loop, name: Loop, parents: [*p]}',
	'houses: *nowhere',
	'<<: {people: []}',
	'born: !!timestamp 2001-12-14',
	'people: !!set {a, b}',
	'people: !!binary aGVsbG8=',
	'options: !!omap [a: 1]',
	'people: !custom-tag x',
	'---\n- another document',
	'...',
	'%YAML 1.1\n---',
	'unions: |\n  not a list',
	'people: >\n  folded',
	'  - id: stray\n    name: Stray',
	'\t- tabbed',
	'"unterminated',
	"key: 'it''s'",
	'k: [[[[[[[[[[[[x]]]]]]]]]]]]',
	'a: &a [x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]',
	'people: [{id: a, name: A}, {id: a, name: A}]',
	'unions: [{partners: [a]}, {partners: {a: b}}]',
	'options: [start, focus]',
	'houses: {id: h}',
];

const TEXT_CHARS = [':', '-', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '%', '@', '`', '"', "'", '\t', ',', '?', '\n', ' ', ' ', '﻿'];

const TEXT_MUTATIONS: Record<string, (text: string, rng: Rng) => string> = {
	'delete-line': (t, rng) => {
		const lines = t.split('\n');
		lines.splice(rng.int(lines.length), 1 + rng.int(3));
		return lines.join('\n');
	},
	'duplicate-line': (t, rng) => {
		const lines = t.split('\n');
		const i = rng.int(lines.length);
		lines.splice(i, 0, ...lines.slice(i, i + 1 + rng.int(6)));
		return lines.join('\n');
	},
	'swap-lines': (t, rng) => {
		const lines = t.split('\n');
		const i = rng.int(lines.length);
		const j = rng.int(lines.length);
		[lines[i], lines[j]] = [lines[j], lines[i]];
		return lines.join('\n');
	},
	'insert-char': (t, rng) => {
		const i = rng.int(t.length + 1);
		return t.slice(0, i) + rng.pick(TEXT_CHARS) + t.slice(i);
	},
	'replace-char': (t, rng) => {
		const i = rng.int(t.length);
		return t.slice(0, i) + rng.pick(TEXT_CHARS) + t.slice(i + 1);
	},
	truncate: (t, rng) => t.slice(0, rng.int(t.length + 1)),
	reindent: (t, rng) => {
		const lines = t.split('\n');
		const i = rng.int(lines.length);
		lines[i] = rng.chance(0.5) ? ' '.repeat(1 + rng.int(3)) + lines[i] : lines[i].replace(/^ {1,2}/, '');
		return lines.join('\n');
	},
	inject: (t, rng) => {
		const lines = t.split('\n');
		const indent = rng.pick(['', '', '  ', '    ']);
		const snippet = rng
			.pick(SNIPPETS)
			.split('\n')
			.map((l) => indent + l);
		lines.splice(rng.int(lines.length + 1), 0, ...snippet);
		return lines.join('\n');
	},
	crlf: (t) => t.replace(/\n/g, '\r\n'),
};

// --- The check ----------------------------------------------------------------------------

function mutate(source: string, parsed: unknown, rng: Rng): { text: string; names: string[] } {
	const names: string[] = [];
	let text = source;
	const structural = rng.chance(0.75);
	if (structural) {
		let root: unknown = structuredClone(parsed);
		for (let k = 1 + rng.int(3); k > 0; k--) {
			const name = rng.pick(Object.keys(MUTATIONS));
			names.push(name);
			root = MUTATIONS[name](root, rng);
		}
		try {
			text = stringify(root, { aliasDuplicateObjects: true });
		} catch {
			names.push('(stringify failed: original text used)');
		}
	}
	if (!structural || rng.chance(0.4)) {
		for (let k = 1 + rng.int(3); k > 0; k--) {
			const name = rng.pick(Object.keys(TEXT_MUTATIONS));
			names.push(`text:${name}`);
			text = TEXT_MUTATIONS[name](text, rng);
		}
	}
	return { text, names };
}

function fail(msg: string): never {
	throw new Error(msg);
}

function runPipeline(text: string) {
	const r = parseDynasty(text);
	if (!r.ok) {
		if (!HARD.includes(r.error.code)) fail(`unknown hard error code ${String(r.error.code)}`);
		return;
	}
	const g = deriveFamilies(r.tree);
	for (const i of g.issues) {
		const want = BLOCKING.includes(i.code) ? 'blocking' : 'warning';
		if (i.level !== want) fail(`issue ${i.code} has level ${i.level}, expected ${want}`);
	}
	const { layout, edges } = layoutTree(g, geometryFor(16, 'normal'), SETTINGS, 'sans-serif');
	if (layout.persons.size !== g.people.length) fail(`${g.people.length} people but ${layout.persons.size} cards`);
	for (const b of layout.persons.values()) {
		if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) fail(`card ${b.id} has a non-finite position`);
	}
	if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) fail('layout size is not finite');
	for (const p of edges.paths) if (/NaN|Infinity|undefined/.test(p.d)) fail(`bad path ${p.kind}: ${p.d.slice(0, 200)}`);
}

const FOCUS_N = [0, 1, 3, -1, 2.5, Number.NaN, 1_000_000];

/** Focus mode on a mutated tree: focus subgraph → derive → layout, for a few focus ids (§5.6, §8). */
function runFocus(text: string, rng: Rng) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const ids = r.tree.people.map((p) => p.id);
	const focusIds = [r.tree.options.focus, r.tree.options.start, rng.pick(['ghost', '', rng.pick(SPECIAL_IDS)])];
	for (let k = 0; k < 3 && ids.length; k++) focusIds.push(rng.pick(ids));
	for (const id of focusIds) {
		if (id === undefined) continue;
		const n = rng.pick(FOCUS_N);
		const res = focusSubgraph(r.tree, id, n);
		const exists = ids.includes(id);
		if (!res) {
			if (exists) fail(`focusSubgraph returned null for existing person ${JSON.stringify(id)}`);
			continue;
		}
		if (!exists) fail(`focusSubgraph returned a family for unknown id ${JSON.stringify(id)}`);
		const g = deriveFamilies(res.tree);
		const { layout } = layoutTree(g, geometryFor(16, 'normal'), SETTINGS, 'sans-serif');
		if (layout.persons.size !== g.people.length) fail(`focus ${id}: ${g.people.length} people but ${layout.persons.size} cards`);
		for (const b of layout.persons.values()) {
			if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) fail(`focus ${id}: card ${b.id} has a non-finite position`);
		}
	}
}

function casesFor(sourceLength: number): number {
	if (sourceLength < 6000) return 200;
	if (sourceLength < 30000) return 50;
	return 10;
}

const onlySeed = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined;

describe('fuzz: parse → derive → layout never throws (spec §8)', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}`, () => {
			let parsed: unknown;
			try {
				parsed = parseYaml(f.source);
			} catch {
				parsed = {};
			}
			const n = onlySeed === undefined ? casesFor(f.source.length) : 1;
			for (let i = 0; i < n; i++) {
				const seed = onlySeed ?? hash32(`${BASE_SEED}:${f.id}:${i}`);
				const { text, names } = mutate(f.source, parsed, new Rng(seed));
				try {
					runPipeline(text);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 20000);
	}
});

describe('fuzz: focus subgraph → derive → layout never throws (spec §5.6, §8)', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}`, () => {
			let parsed: unknown;
			try {
				parsed = parseYaml(f.source);
			} catch {
				parsed = {};
			}
			const n = onlySeed === undefined ? Math.max(2, Math.floor(casesFor(f.source.length) / 4)) : 1;
			for (let i = 0; i < n; i++) {
				const seed = onlySeed ?? hash32(`${BASE_SEED}:focus:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runFocus(text, rng);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}
${e.stack ?? ''}` : String(e);
					throw new Error(
						`Focus fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})
` +
							`mutations: ${names.join(', ')}
${err}
--- mutated block (first 3000 chars) ---
${text.slice(0, 3000)}`,
					);
				}
			}
		}, 20000);
	}

	it('sample tree 5 (every kind of problem) as it is: every person, n = 0, 1 and 3', () => {
		const f = allFixtures().find((x) => x.id === '05');
		if (!f) fail('no sample tree 5');
		const r = parseDynasty(f.source);
		if (!r.ok) fail(`sample tree 5 has a hard error ${r.error.code}`);
		for (const p of r.tree.people) {
			for (const n of [0, 1, 3]) {
				const res = focusSubgraph(r.tree, p.id, n);
				if (!res) fail(`null for ${p.id}`);
				const g = deriveFamilies(res.tree);
				const { layout } = layoutTree(g, geometryFor(16, 'normal'), SETTINGS, 'sans-serif');
				if (layout.persons.size !== g.people.length) fail(`focus ${p.id}, n = ${n}: ${g.people.length} people but ${layout.persons.size} cards`);
			}
		}
	});
});
