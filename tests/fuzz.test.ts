import { describe, it } from 'vitest';
import { parse as parseYaml, stringify } from 'yaml';
import { deriveFamilies } from '../src/core/derive';
import { focusSubgraph } from '../src/core/focus-subgraph';
import type { HolderFields, HolderRef, Op, TitleOp } from '../src/core/edit';
import type { IssueCode } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { normaliseSobriquet } from '../src/core/sobriquet';
import { computeRelations, findRelation, lineSubgraph, relationsKey } from '../src/core/relations';
import type { CardLabels, CardTitleOp, DescribeDeleteTitle, HolderTable, PickerSuffix, ReignText, SearchNames } from '../src/core/titles';
import type { Title } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';
import { geometryFor } from '../src/layout/geometry';
import { layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { allFixtures } from './acceptance/load';
import { exifSegment, isoFile, jpegHead, pngHead, type PictureSets, type PicturesModule } from './acceptance/m9-support';
import type { CropModule, FoldsModule } from './acceptance/m10-support';
import { linkTargets } from '../src/core/link-rewrite';

/*
 * Spec §8: nothing may throw or blank the note. Every sample tree is mutated a few hundred times
 * (fewer for the large ones, to keep the file near 3 s) and pushed through parse → derive →
 * layout (layout includes edge routing). A hard error is a fine outcome; a throw is not.
 *
 * Focus mode (spec §5.6, M5) runs the same mutated trees through focus subgraph → derive → layout
 * for a few focus ids and generation counts, including ids that name no person.
 *
 * Relation names (spec §13.1, §13.2, M7) run the mutated trees through computeRelations for the
 * mark (`options.me`, which the mutations set to people, nobody, lists and maps) and a few other
 * people, findRelation for random pairs, and lineSubgraph → layout for some of the lines.
 *
 * Titles (spec §13.3–§13.5, M8; §13.0 item 10): the mutations add `titles` sections, holder entries
 * of every shape and `card-title` keys. The pipeline above must pass on them, and a later group also
 * runs card labels, the reign and name helpers, the table note and random title ops on the mutated trees
 * (`src/core/titles.ts`).
 *
 * Pictures (spec §13.0 items 3 and 10, M9): the mutations add `arms` to houses and `portrait` to
 * people in every written form (and unquoted `![[…]]` text, amendment A3). The pipeline above must pass
 * on them, and a later group also lays trees out with their picture sets (`pictureSets`), runs the pure
 * picture helpers (`src/core/pictures.ts`) on the values and on damaged headers, and applies random
 * picture ops.
 *
 * Portrait crop and folds (spec §13.0 item 10, §13.10, §13.13, M10): the mutations add `portrait-crop`
 * to people (three numbers, commas, exponents, lists, maps, empty and garbage), and the last group
 * runs the fold functions (families, hidden people, controls, tags, pruned graph, folds to open, folds
 * that end) on random sets of fold keys, valid and made up, and lays the folded trees out; it also runs
 * the crop helpers on random texts and sizes and applies random `portrait-crop` ops (`src/core/folds.ts`
 * and `src/core/portrait-crop.ts`).
 *
 * Deterministic: each case has its own seed, printed on failure. To re-run one case on every
 * fixture: FUZZ_SEED=0x1234abcd npx vitest run tests/fuzz.test.ts
 */

const BASE_SEED = 0x5eed2026;
const SETTINGS: LayoutSettings = { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 } };
/** The relation finder's small tree never splits a couple (relations.ts, `NEVER_FAR_RULE`). */
const NEVER_FAR: LayoutSettings = { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } };
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

// --- Titles (M8) --------------------------------------------------------------------------

const TITLE_IDS = ['duke-of-valmont', 'count-of-orsini', 'king-of-the-vale', 'duke', '1066', '__proto__', ''];

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
const PICTURE_TEXTS = [
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
const CROP_TEXTS = [
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
	const { layout, edges } = layoutTree(g, geometryFor(16), SETTINGS, 'sans-serif');
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
		const { layout } = layoutTree(g, geometryFor(16), SETTINGS, 'sans-serif');
		if (layout.persons.size !== g.people.length) fail(`focus ${id}: ${g.people.length} people but ${layout.persons.size} cards`);
		for (const b of layout.persons.values()) {
			if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) fail(`focus ${id}: card ${b.id} has a non-finite position`);
		}
	}
}

/** Relation names and the finder on a mutated tree (spec §13.1, §13.2, §8): they end and never throw. */
function runRelations(text: string, rng: Rng) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const g = deriveFamilies(r.tree);
	const ids = g.people.map((p) => p.id);
	const marks = [r.tree.options.me, rng.pick(['ghost', rng.pick(SPECIAL_IDS)])];
	if (ids.length) marks.push(rng.pick(ids));
	for (const me of marks) {
		if (me === undefined) continue;
		const rels = computeRelations(g, me);
		relationsKey(g, me);
		if (!ids.includes(me)) {
			if (rels.size) fail(`relations for ${JSON.stringify(me)}, who is not in the tree`);
			continue;
		}
		if (rels.get(me)?.[0]?.kind !== 'self') fail(`the marked person ${JSON.stringify(me)} is not "You"`);
		let drawn = 0;
		for (const [id, list] of rels) {
			if (!ids.includes(id)) fail(`a relation for ${JSON.stringify(id)}, who is not in the tree`);
			for (const rel of list) {
				if (!rel.lower || /undefined|NaN|null|\[object/.test(rel.lower)) fail(`bad name ${JSON.stringify(rel.lower)}`);
				if (rel.line.people.some((p) => !ids.includes(p))) fail(`a line through someone not in the tree: ${rel.line.people.join(', ')}`);
				if (new Set(rel.line.people).size !== rel.line.people.length) fail(`a line with repeats: ${rel.line.people.join(', ')}`);
			}
			if (list.length && drawn++ < 3) layoutTree(lineSubgraph(g, list[list.length - 1].line), geometryFor(16), NEVER_FAR, 'sans-serif');
		}
	}
	for (let k = 0; k < 3 && ids.length; k++) {
		const f = findRelation(g, rng.pick(ids), rng.pick(ids));
		if (f.kind === 'chain') layoutTree(lineSubgraph(g, f.line), geometryFor(16), NEVER_FAR, 'sans-serif');
		if (f.kind === 'named' && f.relations.length < 1) fail('a named finder result with no relation');
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
				const { layout } = layoutTree(g, geometryFor(16), SETTINGS, 'sans-serif');
				if (layout.persons.size !== g.people.length) fail(`focus ${p.id}, n = ${n}: ${g.people.length} people but ${layout.persons.size} cards`);
			}
		}
	});
});

describe('fuzz: relation names and the finder never throw (spec §13.1, §13.2, §8)', () => {
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
				const seed = onlySeed ?? hash32(`${BASE_SEED}:relations:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runRelations(text, rng);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Relations fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 20000);
	}
});

// --- Titles (M8) ---------------------------------------------------------

interface TitlesHelpers {
	cardLabels: CardLabels;
	reignText: ReignText;
	searchNames: SearchNames;
	pickerSuffix: PickerSuffix;
	cardTitleOp: CardTitleOp;
	describeDeleteTitle: DescribeDeleteTitle;
	holderTable: HolderTable;
}

// Variable paths keep the module types loose in this file; the modules exist and a missing one fails the file.
const TITLES_PATH = '../src/core/titles';
const titles = (await import(/* @vite-ignore */ TITLES_PATH)) as TitlesHelpers;

const BAD_TEXT = /undefined|NaN|\[object/;
const TITLE_KINDS = ['add-title', 'edit-title', 'delete-title', 'add-holder', 'edit-holder', 'remove-holder', 'set-holders'];
const CATCH_ALL = 'The plugin cannot make this change. Edit the note text.';

/** A random title op on the tree: refs read from the graph, or garbage (spec §13.4, contract rules 6–8). */
function randomTitleOp(rng: Rng, list: readonly Title[], ids: string[]): TitleOp | Op {
	const t = list.length ? rng.pick(list) : undefined;
	const titleId = rng.chance(0.85) && t ? t.id : rng.pick(TITLE_IDS);
	const h = t?.holders.length ? rng.pick(t.holders) : undefined;
	const ref: HolderRef = h && rng.chance(0.8) ? { title: titleId, index: h.index, person: h.person, name: h.person ? undefined : h.name, text: h.text } : { title: titleId, index: rng.int(5) - 1, person: rng.pick(['ghost', ...ids.slice(0, 3)]) };
	const val = () => rng.pick<string | null>(['1200', 'II', 'Ser Wat', 'a: b', '[x]', '', null, 'x'.repeat(1 + rng.int(200))]);
	const fields = (): HolderFields => ({ [rng.pick(['person', 'name', 'as', 'number', 'from', 'to'])]: rng.chance(0.3) && ids.length ? rng.pick(ids) : val() }) as HolderFields;
	switch (rng.int(9)) {
		case 0:
			return { kind: 'add-title', id: rng.pick([...TITLE_IDS, 'new-title']), name: rng.pick(['New Title', '', 'a: b']), plural: rng.chance(0.5) ? 'New Titles' : undefined };
		case 1:
			return { kind: 'edit-title', id: titleId, name: rng.chance(0.5) ? 'Renamed' : undefined, plural: rng.pick([undefined, null, 'Plural']) };
		case 2:
			return { kind: 'delete-title', id: titleId };
		case 3:
			return { kind: 'add-holder', title: titleId, fields: { person: rng.chance(0.6) && ids.length ? rng.pick(ids) : undefined, ...fields() } };
		case 4:
			return { kind: 'edit-holder', holder: ref, fields: fields() };
		case 5:
			return { kind: 'remove-holder', holder: ref };
		case 6: {
			const items = (t?.holders ?? []).filter(() => rng.chance(0.8)).map((x) => ({ ref: { title: titleId, index: x.index, person: x.person, name: x.person ? undefined : x.name, text: x.text }, fields: rng.chance(0.3) ? fields() : undefined }));
			if (rng.chance(0.3)) items.reverse();
			return { kind: 'set-holders', title: titleId, items: [...items, ...(rng.chance(0.4) ? [{ add: fields() }] : [])] };
		}
		case 7:
			return { kind: 'set-person-fields', id: ids.length ? rng.pick(ids) : 'ghost', fields: { 'card-title': rng.pick([titleId, null, 'ghost']) } } as unknown as Op;
		default:
			return { kind: 'delete-person', id: ids.length ? rng.pick(ids) : 'ghost' };
	}
}

/** Card labels, the helpers and title ops on a mutated tree: they end, never throw, and never show "undefined". */
function runTitles(text: string, rng: Rng, m: TitlesHelpers) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const g = deriveFamilies(r.tree);
	const list = ((g as unknown as { titles?: readonly Title[] }).titles ?? []) as readonly Title[];
	if (!Array.isArray(list)) fail('FamilyGraph.titles is not a list');
	const labels = m.cardLabels(g);
	for (const p of g.people) {
		const l = labels.get(p.id);
		if (!l) fail(`no card label for ${JSON.stringify(p.id)}`);
		for (const s of [l.name, l.title, l.reign]) if (s !== undefined && (typeof s !== 'string' || BAD_TEXT.test(s) && !BAD_TEXT.test(text))) fail(`bad card text ${JSON.stringify(s)}`);
		if (l.shown && !l.holdings.includes(l.shown)) fail(`the shown title of ${p.id} is not one of their titles`);
		if (l.selected && !l.shown) fail(`${p.id} is selected with no shown title`);
		for (const x of m.searchNames(l, p.name)) if (typeof x !== 'string') fail('a search name is not text');
		m.pickerSuffix(l, p.name);
		for (const h of l.holdings) m.reignText(h.entries);
		if (l.holdings.length) m.cardTitleOp(g, p.id, rng.pick(l.holdings).title.id);
	}
	for (const t of list) {
		const d = m.describeDeleteTitle(g, t.id);
		if (!Number.isInteger(d.holders) || !Number.isInteger(d.cards) || d.holders < 0 || d.cards < 0) fail(`bad delete summary ${JSON.stringify(d)}`);
		if (typeof m.holderTable(g, t) !== 'string') fail('the table note is not text');
	}
	const ids = g.people.map((p) => p.id);
	let body = text;
	for (let k = 0; k < 3; k++) {
		const op = randomTitleOp(rng, list, ids);
		const res = applyOp(body, op as Op);
		if (!res.ok) {
			if (res.detail === CATCH_ALL && TITLE_KINDS.includes(op.kind)) fail(`${op.kind} threw inside applyOp`);
			continue;
		}
		const again = parseDynasty(res.body);
		if (!again.ok) fail(`${op.kind} wrote a body that does not parse: ${again.error.code}`);
		body = res.body;
	}
}

describe('fuzz: titles, card labels and title ops never throw (spec §13.3–§13.5, §8)', () => {
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
				const seed = onlySeed ?? hash32(`${BASE_SEED}:titles:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runTitles(text, rng, titles);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Titles fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 60000);
	}
});

// --- Pictures (M9) -------------------------------------------

// Variable paths, like the titles group.
const PICTURES_PATH = '../src/core/pictures';
const LAYOUT_INDEX_PATH = '../src/layout/index';
const pictures = (await import(/* @vite-ignore */ PICTURES_PATH)) as PicturesModule;
const layoutIndex = (await import(/* @vite-ignore */ LAYOUT_INDEX_PATH)) as { pictureSets: PictureSets };
const pictureSets = layoutIndex.pictureSets;

const PICTURE_KINDS = ['set-person-fields', 'add-person', 'add-house', 'edit-house', 'rewrite-links'];
const HEADERS: Uint8Array[] = [
	pngHead(9000, 6000),
	pngHead(0, 0),
	jpegHead(5712, 4284, [exifSegment(6, true)]),
	jpegHead(640, 480, [exifSegment(3, false)], 0xc2),
	isoFile('heic', ['mif1', 'heic'], [
		[512, 512],
		[4032, 3024],
	]),
	isoFile('mif1', ['avif'], [[1, 1]]),
	new TextEncoder().encode('<?xml version="1.0"?><!-- c --><svg width="10px" height="20" viewBox="0 0 1 2"/>'),
	new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000'),
	new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8X'),
	new TextEncoder().encode('BM'),
];

/** A header with random damage: cut, bytes changed, bytes inserted, or random bytes. */
function randomBytes(rng: Rng): Uint8Array {
	const base = [...rng.pick(HEADERS)];
	switch (rng.int(5)) {
		case 0:
			return new Uint8Array(base.slice(0, rng.int(base.length + 1)));
		case 1:
			for (let k = 1 + rng.int(6); k > 0 && base.length; k--) base[rng.int(base.length)] = rng.int(256);
			return new Uint8Array(base);
		case 2:
			base.splice(rng.int(base.length + 1), 0, ...Array.from({ length: 1 + rng.int(40) }, () => rng.pick([0, 0xff, 0xd8, 0xe1, 0xc0, 0x49, 0x4d, rng.int(256)])));
			return new Uint8Array(base);
		case 3:
			return new Uint8Array(Array.from({ length: rng.int(300) }, () => rng.int(256)));
		default:
			return new Uint8Array(base);
	}
}

/** A random picture op on the tree: an arms or portrait edit, a new house or person, or a rename. */
function randomPictureOp(rng: Rng, body: string, ids: string[], houses: string[]): { kind: string } {
	const value = () => rng.pick<unknown>([...PICTURE_TEXTS, null, '', 42, {}, []]);
	switch (rng.int(5)) {
		case 0:
			return { kind: 'set-person-fields', id: ids.length ? rng.pick(ids) : 'ghost', fields: { portrait: value() } } as { kind: string };
		case 1:
			return { kind: 'add-person', id: `new-${rng.int(1000)}`, fields: { name: 'New Person', portrait: value() } } as { kind: string };
		case 2:
			return { kind: 'add-house', name: rng.pick(['House New', '', 'a: b']), arms: value() } as { kind: string };
		case 3:
			return { kind: 'edit-house', id: houses.length ? rng.pick(houses) : 'ghost', arms: value(), ...(rng.chance(0.3) ? { color: '#123456' } : {}) } as { kind: string };
		default: {
			const map: Record<string, string> = {};
			for (const t of linkTargets(body)) if (rng.chance(0.5)) map[t.toLowerCase()] = rng.pick(['new.png', 'Folder/new name.jpg', 'A (b) 100%.png', 'x|y.png', 'x]].png']);
			return { kind: 'rewrite-links', map } as { kind: string };
		}
	}
}

/** Picture reading, sets, layout, the pure picture helpers and picture ops on a mutated tree: they end and never throw. */
function runPictures(text: string, rng: Rng, m: PicturesModule, sets: PictureSets) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const g = deriveFamilies(r.tree);
	for (const show of [true, false]) {
		const s = sets(g, show);
		for (const list of [s.arms, s.portraits]) {
			if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) fail('a picture set is not a list of ids');
			if ([...list].sort().join('\n') !== list.join('\n')) fail('a picture set is not sorted');
		}
		if (!show && s.portraits.length) fail('portraits with the setting off');
		const { layout } = layoutTree(g, geometryFor(16), { ...SETTINGS, ...s } as LayoutSettings, 'sans-serif');
		if (layout.persons.size !== g.people.length) fail(`${g.people.length} people but ${layout.persons.size} cards with pictures`);
		for (const b of layout.persons.values()) {
			if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) fail(`card ${b.id} has a non-finite position with pictures`);
			const flags = b as { arms?: unknown; portrait?: unknown };
			if (flags.portrait !== undefined && !s.portraits.includes(b.id)) fail(`${b.id} has a portrait flag but no portrait`);
			if (flags.arms !== undefined && flags.arms !== true) fail(`${b.id} has an arms flag that is not true`);
		}
	}
	const owners: [string, unknown][] = [
		...(r.tree.houses as { id: string; arms?: unknown }[]).map((h): [string, unknown] => [h.id, h.arms]),
		...(r.tree.people as { id: string; portrait?: unknown }[]).map((p): [string, unknown] => [p.id, p.portrait]),
	];
	for (const [id, value] of owners) {
		if (value !== undefined && typeof value !== 'string') fail(`${id}: a picture value that is not text`);
		const t = m.pictureTarget(value as string | undefined);
		if (t && t.kind === 'vault') {
			if (typeof t.path !== 'string' || !t.path || t.ext !== t.ext.toLowerCase()) fail(`${id}: bad target ${JSON.stringify(t)}`);
			m.pictureFormat(t.ext);
		}
	}
	for (let k = 0; k < 4; k++) {
		const h = m.readPictureHeader(randomBytes(rng));
		for (const v of [h.width, h.height]) if (v !== null && (!Number.isFinite(v) || v < 0)) fail(`bad header size ${JSON.stringify(h)}`);
		const j = m.judgeHeader(h, 'x.png');
		if (!j.ok && j.code === 'picture-too-large' && !((j.pixels ?? 0) > 40)) fail(`too large with ${j.pixels} million pixels`);
		if (!j.ok) {
			const issue = m.pictureIssue(rng.chance(0.5) ? { kind: 'arms', house: { id: 'h', name: 'House H' } } : { kind: 'portrait', person: { id: 'p', name: 'P' } }, j);
			if (issue.level !== 'warning') fail('a picture issue that is not a warning');
		}
	}
	m.portraitCrop(rng.int(5000), rng.int(5000));
	m.fitMeet(rng.int(5000), rng.int(5000), rng.int(64), rng.int(64));
	const ids = g.people.map((p) => p.id);
	const houses = [...g.houses.keys()];
	let body = text;
	for (let k = 0; k < 3; k++) {
		const op = randomPictureOp(rng, body, ids, houses);
		const res = applyOp(body, op as Op);
		if (!res.ok) {
			if (res.detail === CATCH_ALL && PICTURE_KINDS.includes(op.kind)) fail(`${op.kind} threw inside applyOp`);
			continue;
		}
		const again = parseDynasty(res.body);
		if (!again.ok) fail(`${op.kind} wrote a body that does not parse: ${again.error.code}`);
		body = res.body;
	}
}

describe('fuzz: arms, portraits, picture helpers and picture ops never throw (spec §13.0 items 3 and 10, §8)', () => {
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
				const seed = onlySeed ?? hash32(`${BASE_SEED}:pictures:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runPictures(text, rng, pictures, pictureSets);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Pictures fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 60000);
	}
});

// --- Folds and the portrait crop (M10) -------------------------------------

const FOLDS_PATH = '../src/core/folds';
const CROP_PATH = '../src/core/portrait-crop';
const folds = (await import(/* @vite-ignore */ FOLDS_PATH)) as FoldsModule;
const crop = (await import(/* @vite-ignore */ CROP_PATH)) as CropModule;

/** Fold keys that name no family, or are not keys at all. */
function garbageKeys(ids: string[], rng: Rng): string[] {
	const id = () => (ids.length ? rng.pick(ids) : 'ghost');
	return [
		'',
		'garbage',
		'[]',
		'[[]]',
		'["ghost"]',
		'["ghost","ghost2"]',
		JSON.stringify([id()]),
		JSON.stringify([id(), id()]),
		JSON.stringify([id(), id()].reverse()),
		JSON.stringify([id(), id(), id()]),
		JSON.stringify([rng.pick(SPECIAL_IDS)]),
		`u${rng.int(9)}`,
		'null',
		'"x"',
	];
}

/** The fold functions on random sets of fold keys of a mutated tree: they end, never throw and keep their rules. */
function runFolds(text: string, rng: Rng, m: FoldsModule) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const g = deriveFamilies(r.tree);
	const ids = g.people.map((p) => p.id);
	const fams = m.foldFamilies(g);
	if (fams !== m.foldFamilies(g)) fail('foldFamilies is not memoised for one graph');
	const seenKeys = new Set<string>();
	for (const f of fams) {
		if (seenKeys.has(f.key)) fail(`two families with the key ${f.key}`);
		seenKeys.add(f.key);
		if (!f.children.length) fail(`family ${f.key} has no child`);
		if (f.key !== m.foldKey(f.parents)) fail(`family ${f.key} does not have the key of its parents`);
		if (f.parents.length < 1 || f.parents.length > 2) fail(`family ${f.key} has ${f.parents.length} parents`);
		for (const id of [...f.parents, ...f.children]) if (!g.byId.has(id)) fail(`family ${f.key} names ${id}, who is not in the tree`);
	}
	const focusId = ids.length ? rng.pick(ids) : undefined;
	const focus = focusId === undefined ? undefined : focusSubgraph(r.tree, focusId, rng.pick([0, 1, 2]));
	const drawnGraph = focus ? deriveFamilies(focus.tree) : g;
	for (let round = 0; round < 4; round++) {
		const set = new Set<string>([...fams.filter(() => rng.chance(0.25)).map((f) => f.key), ...garbageKeys(ids, rng).filter(() => rng.chance(0.2))]);
		const hidden = m.foldHidden(g, set);
		for (const id of hidden) if (!g.byId.has(id)) fail(`hidden person ${JSON.stringify(id)} is not in the tree`);
		if (!(m.foldHidden(g, new Set()).size === 0)) fail('an empty set of folds hides someone');
		// Rule 3a: every child of a folded family is hidden. The guard (rule 3) drops all folds when
		// they would hide every person, so an empty result is allowed then.
		const allGone = hidden.size === 0 && set.size > 0;
		for (const f of fams) if (!allGone && set.has(f.key)) for (const c of f.children) if (!hidden.has(c)) fail(`child ${c} of the folded family ${f.key} is shown`);
		// Rule 3b: a person with a hidden placement parent is hidden.
		for (const p of g.people) if ((g.placementParents.get(p.id) ?? []).some((x) => hidden.has(x)) && !hidden.has(p.id)) fail(`${p.id} has a hidden placement parent and is shown`);
		const controls = m.foldControls(g, set, hidden);
		const keys = new Set<string>();
		for (const c of controls) {
			if (keys.has(c.key)) fail(`two controls for ${c.key}`);
			keys.add(c.key);
			if (c.parents.some((x) => hidden.has(x))) fail(`control ${c.key} has a hidden parent`);
			if (c.folded !== set.has(c.key)) fail(`control ${c.key}: folded is ${c.folded}`);
			if (c.folded ? c.count !== m.foldCount(g, c.key) : c.count !== 0) fail(`control ${c.key}: count ${c.count}`);
			if (!seenKeys.has(c.key)) fail(`control ${c.key} is not a family`);
		}
		for (const f of fams) if (!keys.has(f.key) && f.parents.every((x) => !hidden.has(x))) fail(`family ${f.key} has shown parents and no control`);
		for (const [person, list] of m.hiddenPartners(g, hidden)) {
			if (hidden.has(person)) fail(`a tag on the hidden person ${person}`);
			if (!list.length || list.some((x) => !hidden.has(x))) fail(`bad tag partners of ${person}`);
		}
		const sample = ids.filter(() => rng.chance(0.1)).slice(0, 6);
		for (const id of ['ghost', ...sample]) {
			const why = m.foldsHiding(g, set, id);
			if (!hidden.has(id) && why.length) fail(`foldsHiding gives folds for the shown person ${id}`);
			if (hidden.has(id) && !why.length) fail(`foldsHiding gives nothing for the hidden person ${id}`);
			for (const k of why) if (!set.has(k)) fail(`foldsHiding names ${k}, which is not folded`);
		}
		for (const [drawn, name] of [
			[g, 'whole'],
			[drawnGraph, 'focus'],
		] as const) {
			const targets = sample.filter((id) => drawn.byId.has(id));
			const open = m.unfoldFor(drawn, g, set, targets);
			for (const k of open) if (!set.has(k)) fail(`unfoldFor (${name}) adds ${k}`);
			const still = m.foldHidden(drawn, open);
			for (const id of targets) if (still.has(id)) fail(`unfoldFor (${name}) leaves ${id} hidden`);
		}
		const kept = m.pruneFolds(g, set);
		for (const k of kept) if (!set.has(k) || !seenKeys.has(k)) fail(`pruneFolds keeps ${k}`);
		if (kept.size === set.size && kept !== set) fail('pruneFolds returns another set when nothing ends');
		for (const id of sample) {
			const pf = m.personFolds(g, set, hidden, id);
			for (const k of [...pf.open, ...pf.folded]) if (!keys.has(k)) fail(`personFolds names ${k}, which has no control`);
		}
		const pruned = m.pruneGraph(g, hidden);
		if (!hidden.size && pruned !== g) fail('pruneGraph with nothing hidden returns another graph');
		for (const p of pruned.people) if (hidden.has(p.id)) fail(`pruneGraph keeps the hidden person ${p.id}`);
		if (pruned.people.length !== g.people.length - [...hidden].filter((id) => g.byId.has(id)).length) fail('pruneGraph lost or kept the wrong number of people');
		for (const [id, list] of pruned.placementParents) if (!pruned.byId.has(id) || list.some((x) => !pruned.byId.has(x))) fail(`pruneGraph: dangling placement parent of ${id}`);
		for (const u of pruned.unions) if (u.partners.some((x) => !pruned.byId.has(x)) || u.children.some((x) => !pruned.byId.has(x))) fail(`pruneGraph: dangling union ${u.key}`);
		for (const [id, list] of pruned.unionsOf) if (!pruned.byId.has(id) || list.some((k) => !pruned.unionByKey.has(k))) fail(`pruneGraph: dangling unionsOf of ${id}`);
		for (const [id, list] of pruned.soloChildren) if (!pruned.byId.has(id) || !list.length || list.some((x) => !pruned.byId.has(x))) fail(`pruneGraph: dangling soloChildren of ${id}`);
		for (const e of pruned.secondary) if (!pruned.byId.has(e.child) || e.parents.some((x) => !pruned.byId.has(x))) fail('pruneGraph: dangling secondary edge');
		// The folded tree lays out with finite numbers, down and sideways, and hides the hidden people.
		for (const side of [false, true]) {
			const settings = { ...SETTINGS, ...(side ? { orientation: 'sideways' } : {}), foldHidden: [...hidden].sort(), foldedFamilies: [...set].sort(), foldControls: true } as LayoutSettings;
			const { layout, edges } = layoutTree(g, geometryFor(16), settings, 'sans-serif');
			for (const b of layout.persons.values()) if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) fail(`folded layout: card ${b.id} has a non-finite position`);
			if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height)) fail('folded layout: size is not finite');
			for (const p of edges.paths) if (/NaN|Infinity|undefined/.test(p.d)) fail(`folded layout: bad path ${p.kind}: ${p.d.slice(0, 200)}`);
			const placed = (layout as { folds?: { spot: { x: number; y: number } }[] }).folds;
			if (placed) {
				for (const c of placed) if (!Number.isFinite(c.spot.x) || !Number.isFinite(c.spot.y)) fail('folded layout: a spot is not finite');
				for (const id of hidden) if (layout.persons.has(id)) fail(`folded layout: the hidden person ${id} has a card`);
			}
		}
	}
}

/** The crop helpers on random texts and sizes, and random `portrait-crop` ops on a mutated tree. */
function runCrop(text: string, rng: Rng, m: CropModule) {
	for (let k = 0; k < 12; k++) {
		const t = rng.chance(0.7) ? rng.pick(CROP_TEXTS) : `${rng.pick(['0', '.5', '1', '-1', 'x', '1e2', '', '0.05'])} ${rng.pick(['0', '.5', '1', '-1', 'x'])} ${rng.pick(['0', '.5', '1', '-1', 'x', '0.05'])}`;
		const read = m.readPortraitCrop(t);
		const w = rng.pick([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1, 5, 400, 600, 4000, 1 + rng.int(9000)]);
		const h = rng.pick([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1, 5, 400, 600, 4000, 1 + rng.int(9000)]);
		const valid = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
		if (read.kind === 'ok') {
			for (const v of [read.crop.left, read.crop.top, read.crop.side]) if (!Number.isFinite(v)) fail(`readPortraitCrop(${JSON.stringify(t)}) gives ${v}`);
			if (!(read.crop.side > 0)) fail(`readPortraitCrop(${JSON.stringify(t)}) gives a side of ${read.crop.side}`);
			const back = m.readPortraitCrop(m.formatPortraitCrop(m.clampCrop(read.crop, 400, 600)));
			if (back.kind !== 'ok') fail(`a clamped crop is written as ${m.formatPortraitCrop(m.clampCrop(read.crop, 400, 600))} and reads as ${back.kind}`);
			const c = m.clampCrop(read.crop, w, h);
			for (const v of [c.left, c.top, c.side]) if (!Number.isFinite(v)) fail(`clampCrop gives ${JSON.stringify(c)} for ${w} × ${h}`);
			if (!valid && (c.left !== 0 || c.top !== 0 || c.side !== 1)) fail(`clampCrop for ${w} × ${h} is not the automatic part`);
			if (valid) {
				const again = m.clampCrop(c, w, h);
				for (const key of ['left', 'top', 'side'] as const) if (Math.abs(again[key] - c[key]) > 1e-9) fail(`clampCrop is not idempotent for ${JSON.stringify(read.crop)} on ${w} × ${h}`);
				if (c.side < 0.1 - 1e-12 || c.side > 1 + 1e-12) fail(`clampCrop side ${c.side}`);
				const sq = m.cropSquare(read.crop, w, h);
				if (![sq.sx, sq.sy, sq.size].every(Number.isInteger) || sq.size < 1 || sq.sx < 0 || sq.sy < 0) fail(`cropSquare ${JSON.stringify(sq)} for ${w} × ${h}`);
				if (w >= 1 && h >= 1 && (sq.sx + sq.size > w || sq.sy + sq.size > h)) fail(`cropSquare ${JSON.stringify(sq)} leaves the ${w} × ${h} picture`);
				const moved = m.moveCrop(c, rng.int(2000) - 1000, rng.int(2000) - 1000, w, h);
				const zoomed = m.zoomCrop(c, rng.pick([0.1, 0.8, 1, 1.25, 10, 1000]), { x: rng.next(), y: rng.next() }, w, h);
				for (const q of [moved, zoomed]) if (![q.left, q.top, q.side].every(Number.isFinite) || q.side < 0.1 - 1e-12 || q.side > 1 + 1e-12) fail(`move or zoom gives ${JSON.stringify(q)}`);
			}
		}
		m.isAutomaticCrop({ left: rng.next(), top: rng.next(), side: rng.next() }, w, h);
		m.automaticCrop(w, h);
		m.cropSquare(null, w, h);
	}
	m.portraitCropOf({ portrait: rng.chance(0.5) ? '[[a.jpg]]' : undefined, portraitCrop: rng.pick(CROP_TEXTS) });
	// Ops on the mutated tree: a crop, a portrait, both, or none.
	const r = parseDynasty(text);
	if (!r.ok) return;
	const ids = r.tree.people.map((p) => p.id);
	let body = text;
	for (let k = 0; k < 4; k++) {
		const fields: Record<string, unknown> = {};
		if (rng.chance(0.6)) fields['portrait-crop'] = rng.chance(0.2) ? null : rng.pick(CROP_TEXTS);
		if (rng.chance(0.5)) fields.portrait = rng.chance(0.2) ? null : rng.pick(PICTURE_TEXTS);
		const op = rng.chance(0.85) || !ids.length ? { kind: 'set-person-fields', id: ids.length ? rng.pick(ids) : 'ghost', fields } : { kind: 'add-person', id: `new-${rng.int(1000)}`, fields: { name: 'New Person', ...fields } };
		const now = parseDynasty(body);
		const beforePortrait = now.ok ? (now.tree.people.find((p) => p.id === (op as { id: string }).id) as { portrait?: string } | undefined)?.portrait : undefined;
		const res = applyOp(body, op as Op);
		if (!res.ok) {
			if (res.detail === CATCH_ALL) fail(`${op.kind} with ${JSON.stringify(fields)} threw inside applyOp`);
			continue;
		}
		const again = parseDynasty(res.body);
		if (!again.ok) fail(`${op.kind} with ${JSON.stringify(fields)} wrote a body that does not parse: ${again.error.code}`);
		const person = again.tree.people.find((p) => p.id === (op as { id: string }).id) as { portrait?: string; portraitCrop?: string } | undefined;
		// D91: a new portrait with no crop in the same fields leaves no crop behind.
		if (op.kind === 'set-person-fields' && person && 'portrait' in fields && !('portrait-crop' in fields)) {
			if (person.portrait !== beforePortrait && person.portraitCrop !== undefined) fail(`a changed portrait kept the crop ${person.portraitCrop}`);
		}
		body = res.body;
	}
}

describe('fuzz: fold sets, the pruned graph, the folded layout, the crop helpers and crop ops never throw (spec §13.0 item 10, §13.10, §13.13, §8)', () => {
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
				const seed = onlySeed ?? hash32(`${BASE_SEED}:folds:${f.id}:${i}`);
				const rng = new Rng(seed);
				const { text, names } = mutate(f.source, parsed, rng);
				try {
					runFolds(text, rng, folds);
					runCrop(text, rng, crop);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Folds and crop fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 120000);
	}
});

// --- Sobriquet (D122, 0.2.4) ---------------------------------------------------------

const SOBRIQUET_TEXTS = ['the Wise', '“the Wise”', '"the Wise"', '‘Fox’', '“the ‘Wise’ one”', '„der Weise“', 'the  Old\tOne', '#1', 'a: b', '[x]', '- x', '"', "it's", 'x'.repeat(400), '日本語', '', '   ', 'null', '1066', 'true'];
const SOBRIQUET_RAW: unknown[] = ['the Wise', '“the Wise”', 1066, true, [], ['x'], { a: 1 }, '', null, '  ', '"the Wise"', '‘Fox’', '“a” “b”', 'x'.repeat(2000)];

/** The model value the reader must give for typed text (contract 1.1), with the parser itself as the proof. */
function readBack(body: string, id: string): { found: boolean; sobriquet?: string } {
	const r = parseDynasty(body);
	if (!r.ok) return { found: false };
	const p = r.tree.people.find((x) => x.id === id);
	return p ? { found: true, sobriquet: p.sobriquet } : { found: false };
}

/** Sobriquet on a mutated tree: the reader and the labels hold, and a typed text reads back; add then remove restores the body. */
function runSobriquet(text: string, rng: Rng) {
	const r = parseDynasty(text);
	if (!r.ok) return;
	const labels = titles.cardLabels(deriveFamilies(r.tree));
	for (const p of r.tree.people) {
		const s = p.sobriquet;
		if (s !== undefined && (typeof s !== 'string' || s === '' || s !== s.trim() || /\s{2}|[\t\n]/.test(s))) fail(`bad sobriquet ${JSON.stringify(s)} on ${p.id}`);
		// A label is kept by id, so a duplicated id has one label for two people.
		if (r.tree.people.filter((x) => x.id === p.id).length > 1) continue;
		if ((labels.get(p.id) as { sobriquet?: string } | undefined)?.sobriquet !== s) fail(`the label of ${p.id} does not carry the sobriquet`);
	}
	const ids = r.tree.people.map((p) => p.id);
	if (!ids.length) return;
	const id = rng.pick(ids);
	const before = readBack(text, id);
	const typed = rng.pick(SOBRIQUET_TEXTS);
	const added = applyOp(text, { kind: 'set-person-fields', id, fields: { sobriquet: typed } } as Op);
	if (!added.ok) {
		if (added.detail === CATCH_ALL) fail(`set sobriquet ${JSON.stringify(typed)} threw inside applyOp`);
		return;
	}
	const mid = readBack(added.body, id);
	if (!mid.found) fail(`the body after setting ${JSON.stringify(typed)} does not parse or lost ${id}`);
	const want = normaliseSobriquet(typed) ?? (typed.trim() === '' ? before.sobriquet : undefined);
	// A blank text removes the key, so the old value goes.
	const expected = typed.trim() === '' ? undefined : want;
	if (mid.sobriquet !== expected) fail(`typed ${JSON.stringify(typed)} reads back as ${JSON.stringify(mid.sobriquet)}, expected ${JSON.stringify(expected)}`);
	const other = (body: string) => {
		const q = parseDynasty(body);
		return q.ok ? JSON.stringify(q.tree.people.filter((p) => p.id !== id)) + JSON.stringify(q.tree.unions) + JSON.stringify(q.tree.houses) : '';
	};
	if (other(added.body) !== other(text)) fail(`setting the sobriquet of ${id} changed other data`);
	// Only a body with no `sobriquet` key anywhere (a key with an empty value reads as none but is not added by the op).
	if (text.includes('sobriquet')) return;
	const removed = applyOp(added.body, { kind: 'set-person-fields', id, fields: { sobriquet: null } } as Op);
	if (!removed.ok) {
		if (removed.detail === CATCH_ALL) fail('removing the sobriquet threw inside applyOp');
		return;
	}
	if (removed.body !== text) fail(`add then remove did not restore the body:\n${JSON.stringify(text.slice(0, 600))}\n${JSON.stringify(removed.body.slice(0, 600))}`);
}

describe('fuzz: the sobriquet reads, shows on labels and round-trips through ops (D122, spec §8)', () => {
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
				const seed = onlySeed ?? hash32(`${BASE_SEED}:sobriquet:${f.id}:${i}`);
				const rng = new Rng(seed);
				// Put sobriquets of every shape on a few people, then mutate as the other groups do.
				const withKeys = structuredClone(parsed);
				for (const p of section(withKeys, 'people').filter(() => rng.chance(0.3))) p.sobriquet = rng.pick(SOBRIQUET_RAW);
				const { text, names } = mutate(f.source, withKeys, rng);
				try {
					runPipeline(text);
					runSobriquet(text, rng);
				} catch (e) {
					const err = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e);
					throw new Error(
						`Sobriquet fuzz failure on fixture ${f.id}, case ${i}, seed 0x${seed.toString(16)} (FUZZ_SEED=0x${seed.toString(16)})\n` +
							`mutations: ${names.join(', ')}\n${err}\n--- mutated block (first 3000 chars) ---\n${text.slice(0, 3000)}`,
					);
				}
			}
		}, 60000);
	}
});
