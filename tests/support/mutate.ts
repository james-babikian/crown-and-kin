/*
 * The mutation machinery of the fuzz tests (spec §8): it takes the parsed document of a sample tree and changes
 * the structure (add, remove, swap, retype, nest, repeat; sections for titles, pictures, crops and folds) and
 * the text (stray characters and YAML snippets), from a seeded generator. `mutate` returns the new text and
 * the names of the mutations that made it, for the failure message. Used by `tests/layout/fuzz.test.ts` and
 * `tests/core/r112-review-a-fuzz-idops.test.ts` (which kept a copy of it until 0.4).
 */
import { stringify } from 'yaml';
import { Rng } from './rng';

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

export const section = (root: unknown, name: string): Obj[] => {
	const v = isObj(root) ? root[name] : undefined;
	return Array.isArray(v) ? v.filter(isObj) : [];
};
const idsIn = (root: unknown): unknown[] => section(root, 'people').map((p) => p.id);

function nested(rng: Rng, depth: number): unknown {
	let v: unknown = rng.pick(['leaf', 1, null, 'aldric']);
	for (let i = 0; i < depth; i++) v = rng.chance(0.5) ? [v] : { [rng.pick(['id', 'people', 'parents', 'x'])]: v };
	return v;
}

export const SPECIAL_IDS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype', '', ' ', '0', 'NaN', 'undefined', 'null', 'a|b', 'u0', 'i:a|b', '~1', '[[x]]'];

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

// --- Titles (M8) --------------------------------------------------------------------------

export const TITLE_IDS = ['duke-of-valmont', 'count-of-orsini', 'king-of-the-vale', 'duke', '1066', '__proto__', ''];

/** One holder entry in any of the written forms, good or bad (spec §13.4). */
function randomHolder(rng: Rng, root: unknown): unknown {
	const ids = idsIn(root);
	const someone = () => rng.pick<unknown>([...(ids.length ? [rng.pick(ids), rng.pick(ids)] : []), 'ghost', 42, rng.pick(SPECIAL_IDS)]);
	const text = () => rng.pick<unknown>(['1131', '1160', 'the Year of the Comet', '', ' ', null, 7, [], {}, 'x'.repeat(1 + rng.int(3000)), '|', '(r.', '–']);
	const h: Obj = {};
	const form = rng.int(6);
	if (form === 0) return someone();
	if (form === 1) return weird(rng, root);
	if (form !== 2) h.person = someone();
	if (form >= 3 && rng.chance(0.6)) h.name = rng.pick<unknown>(['Aldric', 'Orso the Old', 'Ser Gareth Orsini', '', null, 3, '|a|']);
	for (const k of ['as', 'number', 'from', 'to']) if (rng.chance(0.4)) h[k] = k === 'number' ? rng.pick<unknown>(['I', 'II', 'XIV', '2', '', null, []]) : text();
	if (rng.chance(0.1)) h.epithet = 'the Wise';
	return h;
}

/** One title in any of the written forms, good or bad (spec §13.4). */
function randomTitle(rng: Rng, root: unknown): unknown {
	if (rng.chance(0.1)) return weird(rng, root);
	const t: Obj = {};
	if (rng.chance(0.9)) t.id = rng.pick<unknown>([...TITLE_IDS, 42, null, []]);
	if (rng.chance(0.8)) t.name = rng.pick<unknown>(['Duke of Valmont', 'King of the Vale', '', null, 'x'.repeat(1 + rng.int(500))]);
	if (rng.chance(0.3)) t.plural = rng.pick<unknown>(['Dukes', '', null, []]);
	if (rng.chance(0.2)) t.numbering = rng.pick<unknown>(['auto', 'written', 'x', [], null]);
	if (rng.chance(0.2)) t['count-with'] = rng.pick<unknown>([['duke'], 'duke', { a: 1 }, null]);
	if (rng.chance(0.9)) t.holders = rng.chance(0.8) ? Array.from({ length: rng.int(6) }, () => randomHolder(rng, root)) : rng.pick<unknown>([null, 'aldric', { person: 'aldric' }, 7]);
	return t;
}

// --- Pictures (M9) ------------------------------------------------------------------------

/** Written picture values of every form, good and bad (spec §13.0 item 3, contract rules 4 and 5). */
export const PICTURE_TEXTS = [
	'[[valmont-arms.png]]',
	'![[aldric.jpg]]',
	'[[Pictures/Arms/valmont.PNG|The arms]]',
	'[[a.png#page=2]]',
	'[Arms](Pictures/Valmont%20arms%20(old).png)',
	'![](<Pictures/a>b.svg>)',
	'[x](<>)',
	'https://example.com/arms.png',
	'//cdn.example.com/x.png',
	'www.example.com/a.png',
	'data:image/png;base64,iVBORw0KGgo=',
	'C:/Pictures/a.png',
	'x.heic',
	'charter.pdf',
	'noextension',
	'[[]]',
	'[[#heading]]',
	'![[',
	'[x](',
	'%E0%A4%A.png',
	'[a](b%ZZ.png)',
	`${'long-name-'.repeat(300)}.png`,
];

/** One `arms` or `portrait` value: text of every form, the unquoted [[…]] shapes, or garbage. */
function randomPicture(rng: Rng, root: unknown): unknown {
	return rng.pick<() => unknown>([
		() => rng.pick(PICTURE_TEXTS),
		() => rng.pick(PICTURE_TEXTS),
		() => [['x.png']],
		() => [['Smith', ' John.png']],
		() => [[['deep.png']]],
		() => rng.pick<unknown>([[], {}, 42, null, true, '', ' ']),
		() => weird(rng, root),
	])();
}

/** Written `portrait-crop` values of every form, good and bad (spec §13.13, contract rules 19 and 20). */
export const CROP_TEXTS = [
	'0.12 0.05 0.6',
	'0 0 1',
	'0.1, 0.2, 0.5',
	'0.5',
	'0.1 0.2',
	'0.1 0.2 0.3 0.4',
	'0.2 0.2 0',
	'0.2 0.2 -1',
	'0.9 0.9 0.9',
	'-3 -3 0.5',
	'1e-1 0 0.5',
	'0x1 0 0.5',
	'Infinity 0 1',
	'NaN NaN NaN',
	'.5 .5 .5',
	'5. 5. 5.',
	'0.05 0.05 0.05',
	'99999999999999999999 0 1',
	'0.1\t0.2\t0.5',
	' ',
	'',
	'left top side',
];

/** One `portrait-crop` value: text of every form, a number, a list, a map, or garbage. */
function randomCrop(rng: Rng, root: unknown): unknown {
	return rng.pick<() => unknown>([
		() => rng.pick(CROP_TEXTS),
		() => rng.pick(CROP_TEXTS),
		() => `${rng.next().toFixed(rng.int(6))} ${rng.next().toFixed(rng.int(6))} ${(0.05 + rng.next()).toFixed(rng.int(6))}`,
		() => rng.pick<unknown>([0.5, 1, -1, 0, true, null, [], {}, [0.1, 0.2, 0.5], { left: 0.1, top: 0.2, side: 0.5 }]),
		() => weird(rng, root),
	])();
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
			(opts as Obj)[rng.pick(['start', 'focus', 'me'])] = ghost;
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
			p[rng.pick(['sex', 'placement', 'illegitimate', 'union', 'born', 'died', 'title', 'card-title', 'link', 'portrait', 'notes', 'name', 'house'])] = v();
		}
		if (unions.length) rng.pick(unions)[rng.pick(['type', 'start', 'end', 'id'])] = v();
		if (houses.length) rng.pick(houses)[rng.pick(['color', 'name', 'id', 'arms'])] = v();
		if (isObj(root) && rng.chance(0.3)) root.options = { start: v(), focus: v(), me: v(), generations: v(), height: v() };
		return root;
	},
	'me-option': (root, rng) => {
		if (!isObj(root)) return root;
		const opts = isObj(root.options) ? root.options : (root.options = {});
		const ids = idsIn(root);
		const someone = () => rng.pick(ids.length ? ids : ['aldric']);
		(opts as Obj).me = rng.pick<unknown>([someone(), someone(), someone(), 'ghost', 42, '', null, [], [someone()], [someone(), someone()], { id: someone() }, true, rng.pick(SPECIAL_IDS)]);
		return root;
	},
	// Spec §13.0 item 10: titles, holder entries and card-title (M8).
	titles: (root, rng) => {
		if (!isObj(root)) return root;
		const list = Array.isArray(root.titles) ? (root.titles as unknown[]) : [];
		for (let k = 1 + rng.int(4); k > 0; k--) list.splice(rng.int(list.length + 1), 0, randomTitle(rng, root));
		root.titles = rng.chance(0.9) ? list : rng.pick<unknown>([null, 'Duke of Valmont', { id: 'duke' }, [[]], 7]);
		return root;
	},
	'holder-entries': (root, rng) => {
		const titles = section(root, 'titles');
		if (!titles.length) return MUTATIONS.titles(root, rng);
		const t = rng.pick(titles);
		const holders = Array.isArray(t.holders) ? t.holders : [];
		for (let k = 1 + rng.int(4); k > 0; k--) holders.splice(rng.int(holders.length + 1), 0, randomHolder(rng, root));
		if (holders.length && rng.chance(0.3)) holders[rng.int(holders.length)] = weird(rng, root);
		t.holders = rng.chance(0.85) ? holders : rng.pick<unknown>([null, 'aldric', { person: 'aldric' }, [], [[]], 42]);
		if (rng.chance(0.2)) t[rng.pick(['id', 'name', 'plural', 'numbering', 'count-with'])] = weird(rng, root);
		return root;
	},
	'card-title': (root, rng) => {
		const people = section(root, 'people');
		if (!people.length) return root;
		const ids = section(root, 'titles').map((t) => t.id);
		for (let k = 1 + rng.int(3); k > 0; k--) {
			rng.pick(people)['card-title'] = rng.pick<unknown>([
				ids.length ? rng.pick(ids) : 'duke-of-valmont',
				ids.length ? rng.pick(ids) : 'king-of-the-vale',
				'ghost-title',
				1066,
				'',
				null,
				[],
				['duke-of-valmont'],
				{ id: 'duke-of-valmont' },
				rng.pick(SPECIAL_IDS),
			]);
		}
		return root;
	},
	// Spec §13.0 item 10: arms on houses and portraits on people (M9).
	arms: (root, rng) => {
		const houses = section(root, 'houses');
		if (!houses.length) {
			if (isObj(root)) root.houses = [{ id: 'valmont', name: 'House Valmont', arms: randomPicture(rng, root) }];
			return root;
		}
		for (let k = 1 + rng.int(3); k > 0; k--) rng.pick(houses).arms = randomPicture(rng, root);
		return root;
	},
	portrait: (root, rng) => {
		const people = section(root, 'people');
		if (!people.length) return root;
		for (let k = 1 + rng.int(4); k > 0; k--) rng.pick(people).portrait = randomPicture(rng, root);
		return root;
	},
	// Spec §13.0 item 10: `portrait-crop` on people (M10), with and without a `portrait`.
	'portrait-crop': (root, rng) => {
		const people = section(root, 'people');
		if (!people.length) return root;
		for (let k = 1 + rng.int(4); k > 0; k--) {
			const p = rng.pick(people);
			p['portrait-crop'] = randomCrop(rng, root);
			if (rng.chance(0.6)) p.portrait = randomPicture(rng, root);
		}
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
		const name = rng.pick(['people', 'houses', 'titles', 'unions', 'options']);
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
	'options: {me: [a, b]}',
	'options:\n  me: {id: x}',
	'houses: {id: h}',
	// Unquoted pasted embeds (contract amendment A3): read like the quoted form in these three keys.
	'portrait: ![[x.png]]',
	'arms: ![[a.png|b]]',
	'link: ![[Note]]',
	'  - id: p\n    name: P\n    portrait: ![[p.jpg]]',
	'portrait-crop: "0.1 0.2 0.5"',
	'  - id: p\n    name: P\n    portrait: "[[p.jpg]]"\n    portrait-crop: 0.5',
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

export function mutate(source: string, parsed: unknown, rng: Rng): { text: string; names: string[] } {
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

export function fail(msg: string): never {
	throw new Error(msg);
}
