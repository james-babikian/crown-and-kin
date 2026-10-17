// Test round of 0.2.8, target X1 (an internal note section 3): generated trees through parse, derive, layout, edges, renderSvg and relation names.
// The expected answers come from the spec: §8 (nothing throws), §4.3 and §5.1 (sibling order D2, cycles), §5.3 (no line behind a card), §13.1 (names).
// Seeds are fixed and printed on failure. R028_DEEP=1 runs more seeds and bigger trees. Known faults (ITEMS I09, I10, I11, I16) are counted, never asserted.
import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { foldFamilies, foldHidden, pruneGraph } from '../src/core/folds';
import { issueText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, type Relation } from '../src/core/relations';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { EdgeDrawing, LayoutSettings, TreeLayout } from '../src/layout/model';
import { savedLegend } from '../src/render/saved-picture';
import { DEFAULT_DARK, DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { chainModel, collapseModel, genModel, hashText, manyPartnersModel, oddText, rng, rumouredModel, shuffled, toText, type GenModel, type GenSpec } from './r028-gen';
import { byMarriageCases, layered, oracle } from './r028-adv-oracle';
import { lineProblems } from './random-trees';

const DEEP = process.env.R028_DEEP === '1';
/** Seeds per case: normal and deep. */
const K = DEEP ? 5 : 1;
/**
 * The timeout of every test in this file. The tests check what is drawn, not how fast (the speed test of X1 is a
 * ratio, below). It only stops a hang: "every drawing option together" takes 2 s alone and took 126 s in a full
 * parallel test run on a busy machine, over the old 30 s, so the timeout is 300 s.
 */
const NO_HANG_MS = 300_000;

const DOWN = cardForm(geometryFor(16), 'down');
const SIDEWAYS = cardForm(geometryFor(16), 'sideways');
const SIDEWAYS_SETTINGS: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' };
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };

interface Drawn {
	g: FamilyGraph;
	layout: TreeLayout;
	edges: EdgeDrawing;
	svg: string;
}

/** The whole pipeline on tree text. Throws when a stage throws; a hard error of the YAML is returned as undefined. */
function draw(text: string, sideways = false, me?: string): Drawn | undefined {
	const parsed = parseDynasty(text);
	if (!parsed.ok) return undefined;
	const g = deriveFamilies(parsed.tree);
	clearLayoutCache();
	const { layout, edges } = sideways ? layoutTree(g, SIDEWAYS, SIDEWAYS_SETTINGS, 'sans-serif') : layoutTree(g, DOWN, DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
	const start = me ?? g.people[0]?.id;
	const rel = start ? computeRelations(g, start) : undefined;
	const relations = rel ? new Map([...rel].map(([id, rs]) => [id, { text: rs[0].text, lower: rs[0].lower }])) : undefined;
	const svg = renderSvg(g, layout, edges, { measure: approxMeasure, fonts: FONTS, ...(start && relations ? { me: start, relations } : {}) });
	return { g, layout, edges, svg };
}

function finite(n: number): boolean {
	return Number.isFinite(n);
}

/** Problems with the sanity of one drawing: one card for each person, finite numbers (spec §8, §5.1). */
function sanity(d: Drawn): string[] {
	const bad: string[] = [];
	for (const p of d.g.people) if (!d.layout.persons.has(p.id)) bad.push(`no card for ${p.id}`);
	if (d.layout.persons.size !== d.g.people.length) bad.push(`${d.layout.persons.size} cards for ${d.g.people.length} people`);
	for (const b of d.layout.persons.values()) if (![b.x, b.y, b.w, b.h].every(finite) || b.w <= 0 || b.h <= 0) bad.push(`bad box of ${b.id}: ${b.x} ${b.y} ${b.w} ${b.h}`);
	for (const u of d.layout.unions.values()) if (!finite(u.x) || !finite(u.y)) bad.push(`bad union point ${u.key}`);
	// §5.1 step 4: minimum-gap constraints, so two cards of one row never overlap (a row of the sideways layout is a column).
	for (const row of d.layout.rows) {
		const boxes = row.map((id) => d.layout.persons.get(id)).filter((b): b is NonNullable<typeof b> => !!b);
		const side = d.layout.orientation === 'sideways';
		boxes.sort((a, b) => (side ? a.y - b.y : a.x - b.x));
		for (let i = 0; i + 1 < boxes.length; i++) {
			const [a, b] = [boxes[i], boxes[i + 1]];
			if (side ? a.y + a.h > b.y + 0.01 : a.x + a.w > b.x + 0.01) bad.push(`cards ${a.id} and ${b.id} overlap in a row`);
		}
	}
	if (!finite(d.layout.width) || !finite(d.layout.height)) bad.push(`bad size ${d.layout.width} x ${d.layout.height}`);
	for (const p of d.edges.paths) if (/NaN|Infinity|undefined/.test(p.d)) bad.push(`bad path ${p.kind} [${p.people}]: ${p.d.slice(0, 60)}`);
	if (/NaN|Infinity|undefined/.test(d.svg)) bad.push(`NaN, Infinity or undefined in the SVG: ${d.svg.match(/.{0,40}(NaN|Infinity|undefined).{0,20}/)?.[0]}`);
	// One card element for each person: the strip rectangle of the card, in the live drawing format.
	let cards = 0;
	for (const b of d.layout.persons.values()) if (d.svg.includes(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"`)) cards++;
	if (cards !== d.layout.persons.size) bad.push(`${cards} card rectangles in the SVG for ${d.layout.persons.size} cards`);
	for (const i of d.g.issues) {
		const text = issueText(i);
		if (!text.trim() || /undefined|NaN|\[object/.test(text)) bad.push(`bad issue text for ${i.code}: ${text}`);
	}
	return bad;
}

/** A hash of everything the layout decided. */
function layoutHash(d: Drawn): string {
	const L = d.layout;
	const parts = [
		[...L.persons.values()].map((b) => [b.id, b.x, b.y, b.w, b.h, b.gen]),
		[...L.unions.values()].map((u) => [u.key, u.x, u.y, u.bar, u.far]),
		L.rows,
		[...L.farTags.values()].map((t) => [t.person, t.spouses, t.x, t.y]),
		L.width,
		L.height,
		d.edges.paths.map((p) => [p.kind, p.people, p.d]),
		d.edges.markers,
	];
	return hashText(JSON.stringify(parts)) + ':' + hashText(d.svg);
}

/** Problems with the written order of siblings (spec §4.3 sibling order D2, §5.1 step 3): along a row, the children of one family stand in the order of the `people` list. */
function siblingOrderProblems(d: Drawn, sideways: boolean): { bad: string[]; compared: number } {
	const groups = new Map<string, string[]>();
	for (const p of d.g.people) {
		const union = d.g.primaryUnion.get(p.id);
		const placed = d.g.placementParents.get(p.id) ?? [];
		const key = union ? `union ${union}` : placed.length === 1 ? `solo ${placed[0]}` : undefined;
		if (key) groups.set(key, [...(groups.get(key) ?? []), p.id]);
	}
	const bad: string[] = [];
	let compared = 0;
	for (const [key, ids] of groups) {
		for (let i = 0; i + 1 < ids.length; i++) {
			const a = d.layout.persons.get(ids[i]);
			const b = d.layout.persons.get(ids[i + 1]);
			if (!a || !b || a.gen !== b.gen) continue;
			compared++;
			const [pa, pb] = sideways ? [a.y, b.y] : [a.x, b.x];
			if (!(pa < pb)) bad.push(`${key}: ${ids[i]} (written first) stands at ${pa}, ${ids[i + 1]} at ${pb}`);
		}
	}
	return { bad, compared };
}

function fail(label: string, seed: number, problems: string[]): string[] {
	return problems.length ? [`${label} seed ${seed}: ${problems.slice(0, 3).join(' | ')}${problems.length > 3 ? ` (+${problems.length - 3})` : ''}`] : [];
}

const HOSTILE: Omit<GenSpec, 'n'> = { adoptive: 0.12, ward: 0.06, rumoured: 0.12, illegitimate: 0.12, unionP: 0.45, sex: 'mixed', houses: 4, dates: true };

/** The named cases of the target: sizes, shapes and odd families. Each has a text maker for a seed. */
const CASES: { name: string; make: (seed: number) => string; seeds: number }[] = [
	{ name: 'size 1', make: (s) => toText(genModel(s, { n: 1 })), seeds: 3 },
	{ name: 'size 2', make: (s) => toText(genModel(s, { n: 2, linkP: 1, unionP: 1 })), seeds: 3 },
	{ name: 'size 50 plain', make: (s) => toText(genModel(s, { n: 50 })), seeds: 8 },
	{ name: 'size 50 hostile', make: (s) => toText(genModel(s, { n: 50, ...HOSTILE })), seeds: 12 },
	{ name: 'size 400 plain', make: (s) => toText(genModel(s, { n: 400 })), seeds: 2 },
	{ name: 'size 400 hostile', make: (s) => toText(genModel(s, { n: 400, ...HOSTILE })), seeds: 2 },
	{ name: 'size 1000 hostile', make: (s) => toText(genModel(s, { n: 1000, ...HOSTILE, window: 60 })), seeds: 1 },
	{ name: 'no sex', make: (s) => toText(genModel(s, { n: 40, sex: 'none', unionP: 0.5 })), seeds: 4 },
	{ name: 'mixed sex values', make: (s) => toText(genModel(s, { n: 40, sex: 'mixed', unionP: 0.5 })), seeds: 4 },
	{ name: 'same-sex couples', make: (s) => toText(genModel(s, { n: 60, sex: 'same', unionP: 0.7 })), seeds: 6 },
	{ name: 'all four parent types', make: (s) => toText(genModel(s, { n: 60, adoptive: 0.25, ward: 0.2, rumoured: 0.2, unionP: 0.4 })), seeds: 6 },
	{ name: 'illegitimate', make: (s) => toText(genModel(s, { n: 60, illegitimate: 0.5 })), seeds: 4 },
	{ name: 'cycles and self-parents', make: (s) => toText(genModel(s, { n: 60, cycles: 5, selfParents: 3, unionP: 0.4 })), seeds: 8 },
	{ name: 'chain 100', make: () => toText(chainModel(100)), seeds: 1 },
	{ name: 'chain 300', make: () => toText(chainModel(300)), seeds: 1 },
	{ name: 'cousin marriages for 12 generations', make: () => toText(collapseModel(12)), seeds: 1 },
	{ name: '8 partners on one person', make: () => toText(manyPartnersModel(8)), seeds: 1 },
	{ name: '3 rumoured parents', make: () => toText(rumouredModel(3)), seeds: 1 },
	{ name: '12 rumoured parents', make: () => toText(rumouredModel(12)), seeds: 1 },
	{ name: 'odd text', make: () => oddText(), seeds: 1 },
];

describe('X1 (1, 2): the pipeline never throws, one card for each person, no NaN or Infinity (spec §8, §5.1)', () => {
	for (const c of CASES) {
		it(`${c.name}, top to bottom and sideways`, () => {
			const problems: string[] = [];
			for (let k = 0; k < c.seeds * K; k++) {
				const seed = 1000 + k;
				const text = c.make(seed);
				for (const sideways of [false, true]) {
					let d: Drawn | undefined;
					try {
						d = draw(text, sideways);
					} catch (e) {
						problems.push(`${c.name} seed ${seed} ${sideways ? 'sideways' : 'down'}: THROW ${(e as Error).message}`);
						continue;
					}
					if (!d) {
						problems.push(`${c.name} seed ${seed}: hard error on text the generator made`);
						continue;
					}
					problems.push(...fail(`${c.name} ${sideways ? 'sideways' : 'down'}`, seed, sanity(d)));
				}
			}
			expect(problems).toEqual([]);
		}, NO_HANG_MS);
	}
});

describe('X1 (3): the same text twice gives the same layout (spec §5.1 step 6, determinism)', () => {
	it('layout, lines and SVG have the same hash on two runs, with the cache cleared between', () => {
		const problems: string[] = [];
		for (const c of CASES.filter((x) => !x.name.startsWith('size 1000') && !x.name.startsWith('chain 300'))) {
			for (let k = 0; k < Math.min(c.seeds, 2) * K; k++) {
				const seed = 2000 + k;
				const text = c.make(seed);
				const a = draw(text);
				const b = draw(text);
				if (a && b && layoutHash(a) !== layoutHash(b)) problems.push(`${c.name} seed ${seed}: two runs differ`);
			}
		}
		expect(problems).toEqual([]);
	}, NO_HANG_MS);

	it('the layout cache gives the same result as a fresh layout', () => {
		const problems: string[] = [];
		for (let seed = 1; seed <= 6 * K; seed++) {
			const parsed = parseDynasty(toText(genModel(seed, { n: 60, ...HOSTILE })));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			clearLayoutCache();
			const first = layoutTree(g, DOWN, DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
			const again = layoutTree(g, DOWN, DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
			const h = (x: typeof first) => hashText(JSON.stringify([[...x.layout.persons.values()], x.edges.paths]));
			if (h(first) !== h(again)) problems.push(`seed ${seed}: cached layout differs`);
		}
		expect(problems).toEqual([]);
	});
});

describe('X1 (4): the written order of siblings survives (spec §4.3 D2, §5.1 step 3)', () => {
	it('children of one family stand left to right in the written order, in every row (top to bottom and sideways)', () => {
		const problems: string[] = [];
		let compared = 0;
		const specs: [string, GenSpec][] = [
			['plain', { n: 80 }],
			['hostile', { n: 80, ...HOSTILE }],
			['deep window', { n: 80, window: 10, unionP: 0.5 }],
			['cycles', { n: 60, cycles: 4, selfParents: 2 }],
		];
		for (const [label, spec] of specs) {
			for (let seed = 1; seed <= 6 * K; seed++) {
				const text = toText(genModel(seed, spec));
				for (const sideways of [false, true]) {
					const d = draw(text, sideways);
					if (!d) continue;
					const r = siblingOrderProblems(d, sideways);
					compared += r.compared;
					problems.push(...fail(`${label} ${sideways ? 'sideways' : 'down'}`, seed, r.bad));
				}
			}
		}
		for (const c of [chainModel(60), collapseModel(10), manyPartnersModel(8), rumouredModel(6)]) {
			const d = draw(toText(c));
			if (d) {
				const r = siblingOrderProblems(d, false);
				compared += r.compared;
				problems.push(...r.bad);
			}
		}
		// A guard against a check that compares nothing.
		expect(compared).toBeGreaterThan(200);
		expect(problems).toEqual([]);
	}, NO_HANG_MS);

	it('the order follows a reordered text: the same family written in another order keeps that order', () => {
		const problems: string[] = [];
		for (let seed = 1; seed <= 12 * K; seed++) {
			const m = genModel(seed, { n: 50, unionP: 0.4 });
			const order = shuffled(m.people.map((_, i) => i), seed);
			const d = draw(toText(m, order));
			if (d) problems.push(...fail('reordered', seed, siblingOrderProblems(d, false).bad));
		}
		expect(problems).toEqual([]);
	});
});

describe('X1 (5): relation names do not change when people move in the text (spec §13.1, D2)', () => {
	/** Every person's names to `me`: the card word (first) and the sorted set of all names. */
	function names(text: string, me: string, oneParentUnknown: boolean): { first: Map<string, string>; set: Map<string, string>; rel: ReadonlyMap<string, readonly Relation[]> } {
		const parsed = parseDynasty(text);
		if (!parsed.ok) throw new Error('hard error');
		const g = deriveFamilies(parsed.tree);
		const rel = computeRelations(g, me, { oneParentUnknown });
		const label = (r: Relation) => r.text + (r.maybe ? `, maybe ${r.maybe.text}` : '');
		const first = new Map<string, string>();
		const set = new Map<string, string>();
		for (const [id, rs] of rel) {
			first.set(id, label(rs[0]));
			set.set(id, rs.map(label).sort().join(' / '));
		}
		return { first, set, rel };
	}
	const diff = (a: Map<string, string>, b: Map<string, string>): string[] => {
		const out: string[] = [];
		for (const id of new Set([...a.keys(), ...b.keys()])) if (a.get(id) !== b.get(id)) out.push(`${id}: "${a.get(id)}" against "${b.get(id)}"`);
		return out;
	};

	const FAMILIES: [string, GenSpec][] = [
		['no unions', { n: 30, birthOnly: true, unionP: 0 }],
		['sparse', { n: 30, birthOnly: true, unionP: 0.25, window: 12 }],
		['dense', { n: 30, birthOnly: true, unionP: 0.5 }],
	];

	it('the set of names of each person is the same after any reorder of the people (birth links only)', () => {
		const problems: string[] = [];
		for (const [label, spec] of FAMILIES) {
			for (let seed = 1; seed <= 18 * K; seed++) {
				const m = genModel(seed, spec);
				const me = m.people[m.people.length - 1].id;
				const order = shuffled(m.people.map((_, i) => i), seed * 7);
				for (const one of [true, false]) {
					problems.push(...fail(`${label} setting ${one}`, seed, diff(names(toText(m), me, one).set, names(toText(m, order), me, one).set)));
				}
			}
		}
		expect(problems).toEqual([]);
	});

	it('moving people who have no relation to the marked person changes no name and no order of names (exact)', () => {
		const problems: string[] = [];
		let moved = 0;
		for (const [label, spec] of FAMILIES) {
			for (let seed = 1; seed <= 40 * K; seed++) {
				const m = genModel(seed, spec);
				const me = m.people[m.people.length - 1].id;
				const base = names(toText(m), me, true);
				// People that the marked person has no name for.
				const loose = m.people.map((p, i) => ({ p, i })).filter(({ p }) => !base.rel.has(p.id));
				if (!loose.length) continue;
				moved++;
				// Take them out of the list and put them back at the end in the reverse order.
				const keep = m.people.map((_, i) => i).filter((i) => !loose.some((l) => l.i === i));
				const order = [...keep, ...loose.map((l) => l.i).reverse()];
				const after = names(toText(m, order), me, true);
				const same = (x: ReadonlyMap<string, readonly Relation[]>, y: ReadonlyMap<string, readonly Relation[]>) =>
					[...x].every(([id, rs]) => y.get(id)?.map((r) => r.text).join('/') === rs.map((r) => r.text).join('/')) && x.size === y.size;
				if (!same(base.rel, after.rel)) problems.push(`${label} seed ${seed}: names (with their order) changed after moving ${loose.length} unrelated people`);
			}
		}
		expect(moved).toBeGreaterThan(20);
		expect(problems).toEqual([]);
	});

	it('the card word does not flip with the people order, except between names of equal rank (counted: T-X1-01 and ITEMS I10)', () => {
		const problems: string[] = [];
		const tied: string[] = [];
		let checked = 0;
		for (const [label, spec] of FAMILIES) {
			for (let seed = 1; seed <= 40 * K; seed++) {
				const m = genModel(seed, spec);
				const me = m.people[m.people.length - 1].id;
				const order = shuffled(m.people.map((_, i) => i), seed * 7);
				const a = names(toText(m), me, true);
				const b = names(toText(m, order), me, true);
				checked++;
				for (const id of a.first.keys()) {
					if (a.first.get(id) === b.first.get(id)) continue;
					// The rule "which name wins" (§13.1) ends in a tie when the distance and the kind are equal: the spec does not choose then.
					const x = a.rel.get(id)![0];
					const y = b.rel.get(id)![0];
					const equalRank = x.distance === y.distance && x.kind === y.kind;
					(equalRank ? tied : problems).push(`${label} seed ${seed}: ${id} "${a.first.get(id)}" against "${b.first.get(id)}"`);
				}
			}
		}
		console.log(`X1 (5): ${checked} trees, ${tied.length} card words flip between names of equal distance and kind, e.g. ${tied[0] ?? 'none'}`);
		expect(problems).toEqual([]);
	});

	it('the card word of every person is the name that a small derivation from the spec table gives (layered trees, birth links, no unions; both values of "Assume an unknown second parent")', () => {
		const problems: string[] = [];
		let checked = 0;
		let skipped = 0;
		const seeds = 30 * K;
		for (let seed = 1; seed <= seeds; seed++) {
			const unknown = seed % 3 === 0;
			const { model, gen } = layered(seed, 5 + (seed % 4), 5 + (seed % 3), seed % 2 ? 'mf' : 'mixed', [0.2, 0.5, 0.8, 1][seed % 4]);
			const parsed = parseDynasty(toText(model));
			if (!parsed.ok) throw new Error('parse');
			const g = deriveFamilies(parsed.tree);
			for (const me of model.people.map((p) => p.id).filter((_, i) => i % 5 === seed % 5)) {
				const rel = computeRelations(g, me, { oneParentUnknown: unknown });
				for (const p of model.people) {
					if (p.id === me) continue;
					const want = oracle(model, gen, me, p.id, unknown);
					const got = rel.get(p.id)?.[0];
					if (!want) {
						if (got) problems.push(`seed ${seed} ${me} -> ${p.id}: no relation expected, the card says "${got.text}"`);
						continue;
					}
					if ('skip' in want) {
						skipped++;
						continue;
					}
					checked++;
					if ('kind' in want) {
						if (got?.text !== 'Co-parent') problems.push(`seed ${seed} ${me} -> ${p.id}: "Co-parent" expected, the card says "${got?.text}"`);
						continue;
					}
					// Where the word "half" stands in "Half-great-uncle" is not fixed by the spec text; compare the name without it, and the half apart.
					const norm = (t: string) => [t.replace(/half[- ]/gi, '').toLowerCase(), /half/i.test(t)].join('|');
					if (got?.kind !== 'blood' || norm(got.text) !== norm(want.text)) problems.push(`seed ${seed} (setting ${unknown}) ${me} -> ${p.id}: "${want.text}" expected, the card says "${got?.text}"`);
				}
			}
		}
		console.log(`X1 (5): the derivation checked ${checked} pairs and left ${skipped} (ties, double names, several children of one ancestor) out`);
		expect(checked).toBeGreaterThan(2000);
		expect(problems.slice(0, 5)).toEqual([]);
	}, NO_HANG_MS);

	it('the names by marriage of the six plain cases (sibling-in-law, parent-in-law, child-in-law, step-parent, stepchild) are among the names of each person (spec §13.1 rules 1 and 2)', () => {
		const problems: string[] = [];
		let checked = 0;
		for (let seed = 1; seed <= 14 * K; seed++) {
			const { model, expected } = byMarriageCases(seed);
			const parsed = parseDynasty(toText(model));
			if (!parsed.ok) throw new Error('parse');
			const g = deriveFamilies(parsed.tree);
			for (const [me, mine] of expected) {
				if (!mine.size) continue;
				const rel = computeRelations(g, me);
				for (const [p, words] of mine) {
					for (const word of words) {
						checked++;
						const names = (rel.get(p) ?? []).map((r) => r.text);
						if (!names.includes(word)) problems.push(`seed ${seed} ${me} -> ${p}: "${word}" expected, the names are ${JSON.stringify(names)}`);
					}
				}
			}
		}
		expect(checked).toBeGreaterThan(100);
		expect(problems.slice(0, 5)).toEqual([]);
	}, NO_HANG_MS);

	it('a partner is named by the type of the last-listed partnership of the pair and by the sex of the partner; an implicit partnership is a "Co-parent" (spec §13.1 table "Partner", same-sex pairs too)', () => {
		const WORD: Record<string, [string, string, string]> = {
			marriage: ['Husband', 'Wife', 'Spouse'],
			betrothal: ['Betrothed', 'Betrothed', 'Betrothed'],
			concubinage: ['Partner in concubinage', 'Partner in concubinage', 'Partner in concubinage'],
			affair: ['Lover', 'Lover', 'Lover'],
		};
		const specs: GenSpec[] = [
			{ n: 30, unionP: 0.7, sex: 'mixed', window: 10 },
			{ n: 30, unionP: 0.7, sex: 'same', window: 10 },
			{ n: 30, unionP: 0.6, sex: 'mf', adoptive: 0.1, rumoured: 0.1, ward: 0.1 },
			{ n: 30, unionP: 0.6, sex: 'none', birthOnly: true },
		];
		const problems: string[] = [];
		let checked = 0;
		for (const [s, spec] of specs.entries()) {
			for (let seed = 1; seed <= 12 * K; seed++) {
				const m = genModel(seed, spec);
				// Every fourth partnership is listed again later with another type: the last one counts (§4.3).
				const types = ['betrothal', 'affair', 'concubinage', 'marriage'];
				m.unions.push(...m.unions.filter((_, i) => i % 4 === 0).map((u) => ({ a: u.b, b: u.a, type: types[seed % 4] })));
				const parsed = parseDynasty(toText(m));
				if (!parsed.ok) continue;
				const g = deriveFamilies(parsed.tree);
				const sexOf = new Map(m.people.map((q) => [q.id, q.sex]));
				for (const me of m.people.slice(0, 8).map((q) => q.id)) {
					const rel = computeRelations(g, me);
					for (const q of m.people) {
						const listed = m.unions.filter((u) => (u.a === me && u.b === q.id) || (u.b === me && u.a === q.id));
						if (q.id === me || !listed.length) continue;
						const row = WORD[listed[listed.length - 1].type ?? 'marriage'] ?? WORD.marriage;
						const want = row[sexOf.get(q.id) === 'm' ? 0 : sexOf.get(q.id) === 'f' ? 1 : 2];
						checked++;
						const got = rel.get(q.id)?.[0]?.text;
						if (got !== want) problems.push(`spec ${s} seed ${seed} ${me} -> ${q.id}: "${want}" expected, the card says "${got}"`);
					}
				}
			}
		}
		expect(checked).toBeGreaterThan(300);
		expect(problems.slice(0, 5)).toEqual([]);
	}, NO_HANG_MS);

	it('the finder agrees with the card for every person (spec §13.2, same names from one function)', () => {
		const problems: string[] = [];
		for (let seed = 1; seed <= 10 * K; seed++) {
			const m = genModel(seed, { n: 25, birthOnly: true, unionP: 0.3 });
			const parsed = parseDynasty(toText(m));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const me = m.people[m.people.length - 1].id;
			const rel = computeRelations(g, me);
			for (const [id, rs] of rel) {
				if (id === me) continue;
				const found = findRelation(g, me, id);
				if (found.kind !== 'named') {
					problems.push(`seed ${seed}: ${id} has a card name "${rs[0].text}" but the finder says ${found.kind}`);
					continue;
				}
				const texts = found.relations.map((r) => r.relation.text);
				if (!texts.includes(rs[0].text)) problems.push(`seed ${seed}: ${id} card "${rs[0].text}" is not among the finder names ${texts.join(', ')}`);
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});
});

describe('X1 (6): no straight line behind a card (spec §5.3)', () => {
	it('a line that runs behind a card is found in no tree', () => {
		const problems: string[] = [];
		const specs: [string, GenSpec][] = [
			['plain', { n: 30 }],
			['hostile', { n: 40, ...HOSTILE }],
			['marriages', { n: 40, unionP: 0.7, adoptive: 0.1, rumoured: 0.1 }],
			['same-sex', { n: 40, sex: 'same', unionP: 0.7 }],
			['cycles', { n: 40, cycles: 4, selfParents: 2, unionP: 0.4 }],
		];
		for (const [label, spec] of specs) {
			for (let seed = 1; seed <= 12 * K; seed++) {
				const d = draw(toText(genModel(seed, spec)));
				if (!d) continue;
				const behind = lineProblems(d.g, d.layout, d.edges).filter((p) => p.includes(' behind '));
				problems.push(...fail(label, seed, behind));
			}
		}
		for (const c of [chainModel(80), collapseModel(12), manyPartnersModel(8), rumouredModel(8)]) {
			const d = draw(toText(c));
			if (d) problems.push(...lineProblems(d.g, d.layout, d.edges).filter((p) => p.includes(' behind ')));
		}
		expect(problems).toEqual([]);
	}, NO_HANG_MS);
});

describe('X1 (7): a cycle gives a warning and still a drawing (spec §8)', () => {
	it('a back link, a self-parent, a missing parent and a partner twice each give a warning, and every person has a card', () => {
		const d = draw(oddText())!;
		const codes = d.g.issues.map((i) => i.code);
		expect(codes).toContain('cycle');
		expect(codes).toContain('self-parent');
		expect(codes).toContain('missing-parent');
		expect(d.layout.persons.size).toBe(6);
		expect(sanity(d)).toEqual([]);
	});

	it('every generated cycle is named in a warning, and the drawing has all people', () => {
		const problems: string[] = [];
		let withCycle = 0;
		for (let seed = 1; seed <= 25 * K; seed++) {
			const m = genModel(seed, { n: 40, cycles: 3, selfParents: 2 });
			const d = draw(toText(m));
			if (!d) continue;
			const codes = new Set(d.g.issues.map((i) => i.code));
			// A self-parent link always makes the warning.
			const selfs = m.people.filter((p) => p.parents.some((x) => x.id === p.id));
			if (selfs.length && !codes.has('self-parent')) problems.push(`seed ${seed}: ${selfs.length} self-parents, no warning`);
			// Whether a back link makes a cycle depends on the other links; when the graph has a cycle, there must be a warning. Check with an independent search.
			const parentsOf = new Map(m.people.map((p) => [p.id, p.parents.map((x) => x.id).filter((x) => x !== p.id)]));
			const state = new Map<string, number>();
			let cyc = false;
			const visit = (id: string): void => {
				if (cyc) return;
				state.set(id, 1);
				for (const p of parentsOf.get(id) ?? []) {
					if (state.get(p) === 1) cyc = true;
					else if (!state.has(p)) visit(p);
				}
				state.set(id, 2);
			};
			for (const p of m.people) if (!state.has(p.id)) visit(p.id);
			if (cyc) {
				withCycle++;
				if (!codes.has('cycle')) problems.push(`seed ${seed}: the parent links have a cycle but no 'cycle' warning`);
			}
			problems.push(...fail('cycle', seed, sanity(d)));
		}
		expect(withCycle).toBeGreaterThan(5);
		expect(problems).toEqual([]);
	}, NO_HANG_MS);
});

describe('X1 (8): a measure, not an assertion: time, lines and "maybe" texts with 2, 4, 8 and 12 rumoured parents', () => {
	it('prints the cost of a person with k rumoured parents (ITEMS I11: studied already, see FINDINGS "I11 cost study")', () => {
		const rows: string[] = [];
		for (const k of [2, 4, 8, 12]) {
			const text = toText(rumouredModel(k));
			const t0 = performance.now();
			const d = draw(text, false, 'sib')!;
			const ms = Math.round(performance.now() - t0);
			const rel = computeRelations(d.g, 'sib');
			const kid = rel.get('k')?.[0];
			rows.push(`k=${k}: ${ms} ms, ${d.edges.paths.length} lines, kid is "${kid?.text}" ${kid?.maybe ? `(maybe ${kid.maybe.text}${kid.maybe.some ? ', some' : ''})` : ''}`);
			expect(sanity(d)).toEqual([]);
		}
		console.log(`X1 (8):\n  ${rows.join('\n  ')}`);
	});
});

describe('X1 (1): text that is damaged in odd ways still gives a drawing or an error box, never a throw (spec §8)', () => {
	/** One damage to the text of one person or union line. */
	const DAMAGE: ((line: string) => string)[] = [
		(l) => l.replace(/id: (\w+)/, 'id: 007'),
		(l) => l.replace(/parents: \[([^\]]*)\]/, 'parents: $1'),
		(l) => l.replace(/parents: \[([^\]]*)\]/, 'parents: {a: b}'),
		(l) => l.replace(/parents: \[([^\]]*)\]/, 'parents: ~'),
		(l) => l.replace(/parents: \[([^\]]*)\]/, 'parents: [[$1]]'),
		(l) => l.replace(/parents: \[([^\]]*)\]/, 'parents: [{type: birth}, {id: }, 5, ~, {id: [x]}]'),
		(l) => l.replace(/name: (\w+)/, 'name: ~'),
		(l) => l.replace(/name: (\w+)/, 'name: [a, b]'),
		(l) => l.replace(/sex: (\w+)/, 'sex: {x: 1}'),
		(l) => l.replace(/\}$/, ', born: [1, 2], died: {a: 1}}'),
		(l) => l.replace(/\}$/, ', illegitimate: maybe, placement: sideways, union: nope}'),
		(l) => l.replace(/\}$/, ', house: [h0], link: [[a|b]], portrait: 5, notes: x}'),
		(l) => `${l}\n${l}`,
		() => '',
		(l) => l.replace('partners: [', 'partners: [x, y, '),
		(l) => l.replace(/partners: \[[^\]]*\]/, 'partners: [p1]'),
		(l) => l.replace(/partners: \[([^,]*),[^\]]*\]/, 'partners: [$1, $1]'),
		(l) => l.replace(/\{id: (\w+)/, '{id: $1, parents: [$1, {id: $1, type: rumoured}]'),
	];

	it('18 kinds of damage, 1 to 5 of them in each of 100 trees: parse, derive, layout, SVG, relations', () => {
		const problems: string[] = [];
		let hard = 0;
		for (let seed = 1; seed <= 100 * K; seed++) {
			const rand = rng(seed);
			const lines = toText(genModel(seed, { n: 30, adoptive: 0.1, rumoured: 0.1, unionP: 0.5, sex: 'mixed', houses: 3, cycles: 2 })).split('\n');
			for (let i = 0, n = 1 + Math.floor(rand() * 5); i < n; i++) {
				const j = Math.floor(rand() * lines.length);
				if (/^ {2}- \{/.test(lines[j])) lines[j] = DAMAGE[Math.floor(rand() * DAMAGE.length)](lines[j]);
			}
			try {
				const d = draw(lines.join('\n'));
				if (!d) hard++;
				else problems.push(...fail('damaged', seed, sanity(d)));
			} catch (e) {
				problems.push(`damaged seed ${seed}: THROW ${(e as Error).message}`);
			}
		}
		// A guard: most damaged texts are still trees.
		expect(hard).toBeLessThan(100 * K);
		expect(problems).toEqual([]);
	}, NO_HANG_MS);
});

describe('X1 (1): every drawing option together: finder line, "You" tab, ordinal tabs, heirs, folds, pictures, dark palette, saved picture (spec §8, §13.8)', () => {
	it('draws, and the SVG is valid XML that a renderer accepts (checked with resvg on the first cases)', () => {
		const rand = rng(77);
		const problems: string[] = [];
		let rendered = 0;
		for (let seed = 1; seed <= 8 * K; seed++) {
			const parsed = parseDynasty(toText(genModel(seed, { n: 40, adoptive: 0.1, rumoured: 0.1, ward: 0.05, illegitimate: 0.15, unionP: 0.5, sex: 'mixed', houses: 3, dates: true, cycles: seed % 4 === 0 ? 3 : 0 })));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const ids = g.people.map((p) => p.id);
			for (const sideways of [false, true]) {
				try {
					const me = ids[Math.floor(rand() * ids.length)];
					const rel = computeRelations(g, me);
					const relations = new Map([...rel].map(([id, rs]) => [id, { text: rs[0].text, lower: rs[0].lower }]));
					const found = findRelation(g, me, ids[Math.floor(rand() * ids.length)]);
					const line =
						found.kind === 'named'
							? { people: new Set(found.relations[0].relation.line.people), unions: new Set(found.relations[0].relation.line.unions), links: new Set(found.relations[0].relation.line.links.map((l) => `${l.parent}\0${l.child}`)), fade: rand() < 0.5 }
							: undefined;
					const set = new Set(foldFamilies(g).filter(() => rand() < 0.2).map((f) => f.key));
					const hidden = foldHidden(g, set);
					const ordinals = ids.filter(() => rand() < 0.1).slice(0, 5);
					clearLayoutCache();
					const settings = { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), relationLine: true, youTab: me, ordinalCards: ordinals, foldHidden: [...hidden].sort(), foldedFamilies: [...set].sort(), foldControls: true as const, ...pictureSets(g, true) };
					const laid = layoutTree(g, cardForm(geometryFor(16), sideways ? 'sideways' : 'down'), settings, 'sans-serif');
					for (const dark of [false, true]) {
						const svg = renderSvg(g, laid.layout, laid.edges, {
							palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT,
							dark,
							measure: approxMeasure,
							fonts: FONTS,
							me,
							relations,
							...(line ? { line } : {}),
							heirs: ordinals.slice(0, 2),
							ordinals: new Map(ordinals.map((id, i) => [id, `${i + 1}st`])),
							folds: { buttons: true },
							barSentence: 'Line of succession: T, 1210',
							showDates: rand() < 0.5,
						});
						if (/NaN|Infinity|undefined/.test(svg)) problems.push(`seed ${seed}: NaN, Infinity or undefined in the SVG`);
						if (rendered < 4) {
							new Resvg(svg).render();
							rendered++;
						}
					}
					const saved = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts: FONTS, me, relations, saved: { heading: 'Tree <&> "x"', legend: savedLegend(g, laid), pictures: new Map(), scale: 1.5 } });
					if (rendered < 6) {
						new Resvg(saved).render();
						rendered++;
					}
					if (/NaN|Infinity|undefined/.test(saved)) problems.push(`seed ${seed}: NaN, Infinity or undefined in the saved picture`);
				} catch (e) {
					problems.push(`seed ${seed} ${sideways ? 'sideways' : 'down'}: THROW ${(e as Error).message}`);
				}
			}
		}
		expect(rendered).toBeGreaterThanOrEqual(6);
		expect(problems).toEqual([]);
	}, NO_HANG_MS);
});

describe('X1 (6, 2): folds on generated trees (spec §13.10 rule 3) and lines behind cards in a sideways tree', () => {
	it('a fold hides the children of the folded family and everyone below them, and only people who follow from that; a hidden person has no card', () => {
		const problems: string[] = [];
		let folded = 0;
		const rand = rng(31);
		for (let seed = 1; seed <= 25 * K; seed++) {
			const parsed = parseDynasty(toText(genModel(seed, { n: 40, adoptive: 0.1, rumoured: 0.1, unionP: 0.5, sex: 'mixed', cycles: seed % 5 === 0 ? 3 : 0 })));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const families = foldFamilies(g);
			const set = new Set(families.filter(() => rand() < 0.25).map((f) => f.key));
			const hidden = foldHidden(g, set);
			if (hidden.size) folded++;
			// Rule 3 (a) and (b), written again here: the children of a folded family, then everyone with a placement parent already hidden.
			const must = new Set<string>();
			for (const f of families) if (set.has(f.key)) f.children.forEach((c) => must.add(c));
			for (let changed = true; changed; ) {
				changed = false;
				for (const p of g.people) if (!must.has(p.id) && (g.placementParents.get(p.id) ?? []).some((x) => must.has(x))) changed = !!must.add(p.id);
			}
			// Rule 3 (c) loosely: nobody is hidden unless the rule can reach them: a child of a hidden person, or a married-in person with a hidden partner.
			const reach = new Set(must);
			for (let changed = true; changed; ) {
				changed = false;
				for (const p of g.people) {
					if (reach.has(p.id)) continue;
					const parents = g.placementParents.get(p.id) ?? [];
					const viaParent = parents.some((x) => reach.has(x));
					const viaPartner = !parents.length && (g.unionsOf.get(p.id) ?? []).some((k) => g.unionByKey.get(k)!.partners.some((x) => x !== p.id && reach.has(x)));
					if (viaParent || viaPartner) changed = !!reach.add(p.id);
				}
			}
			// A fold that would hide every person hides nobody (rule 3); if even the loose reach is not everyone, the real set is not either, and (a) and (b) must hold.
			if (reach.size < g.people.length) for (const id of must) if (!hidden.has(id)) problems.push(`seed ${seed}: ${id} must be hidden by rule 3 (a) or (b) but is not`);
			for (const id of hidden) if (!reach.has(id)) problems.push(`seed ${seed}: ${id} is hidden but no fold reaches ${id}`);
			clearLayoutCache();
			const settings = { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...hidden].sort(), foldedFamilies: [...set].sort(), foldControls: true as const };
			const { layout, edges } = layoutTree(g, DOWN, settings, 'sans-serif');
			for (const p of g.people) if (hidden.has(p.id) === layout.persons.has(p.id)) problems.push(`seed ${seed}: ${p.id} is ${hidden.has(p.id) ? 'hidden' : 'shown'} but ${layout.persons.has(p.id) ? 'has' : 'has no'} card`);
			const behind = lineProblems(pruneGraph(g, hidden), layout, edges).filter((x) => x.includes(' behind '));
			problems.push(...fail('folded', seed, behind));
		}
		expect(folded).toBeGreaterThan(10);
		expect(problems).toEqual([]);
	}, NO_HANG_MS);

	it('no straight line behind a card in a sideways tree', () => {
		const problems: string[] = [];
		for (let seed = 1; seed <= 25 * K; seed++) {
			const parsed = parseDynasty(toText(genModel(seed, { n: 40, adoptive: 0.1, rumoured: 0.1, unionP: 0.5, sex: 'mixed', cycles: seed % 5 === 0 ? 3 : 0 })));
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			clearLayoutCache();
			const { layout, edges } = layoutTree(g, SIDEWAYS, SIDEWAYS_SETTINGS, 'sans-serif');
			problems.push(...fail('sideways', seed, lineProblems(g, layout, edges).filter((x) => x.includes(' behind '))));
		}
		expect(problems).toEqual([]);
	}, NO_HANG_MS);
});

describe('X1: the time of the layout grows with the size of the tree (a ratio in one process; the limit is 10 times the linear growth)', () => {
	it('the layout of 1 000 people takes less than 40 times the layout of 250', () => {
		const best = (f: () => void, runs = 3) => {
			let b = Infinity;
			for (let i = 0; i < runs; i++) {
				const t0 = performance.now();
				f();
				b = Math.min(b, performance.now() - t0);
			}
			return b;
		};
		const graphOf = (n: number) => {
			const parsed = parseDynasty(toText(genModel(5, { n, window: 40, unionP: 0.3 })));
			if (!parsed.ok) throw new Error('parse');
			return deriveFamilies(parsed.tree);
		};
		const run = (g: FamilyGraph) => () => {
			clearLayoutCache();
			layoutTree(g, DOWN, DEFAULT_LAYOUT_SETTINGS, 'sans-serif');
		};
		const a = best(run(graphOf(250)));
		const b = best(run(graphOf(1000)));
		console.log(`X1 speed: layout 250 people ${a.toFixed(1)} ms, 1000 people ${b.toFixed(1)} ms, ratio ${(b / a).toFixed(1)}`);
		expect(b / Math.max(a, 0.5)).toBeLessThan(40);
	});
});

describe('X1: generator guards (a test of the test: the cases are not empty)', () => {
	it('the cases have the sizes they name', () => {
		const sizes = (text: string) => (parseDynasty(text).ok ? (text.split('people:')[1].split('unions:')[0].match(/^ {2}- \{id:/gm) ?? []).length : -1);
		expect(sizes(CASES[0].make(1))).toBe(1);
		expect(sizes(CASES[1].make(1))).toBe(2);
		expect(sizes(CASES.find((c) => c.name === 'size 400 plain')!.make(1))).toBe(400);
		expect(sizes(CASES.find((c) => c.name === 'size 1000 hostile')!.make(1))).toBe(1000);
		const mixed = (m: GenModel) => new Set(m.people.map((p) => p.sex)).size;
		expect(mixed(genModel(1, { n: 80, sex: 'mixed' }))).toBeGreaterThan(3);
		const types = new Set(genModel(1, { n: 80, adoptive: 0.25, ward: 0.2, rumoured: 0.2 }).people.flatMap((p) => p.parents.map((x) => x.type)));
		expect([...types].sort()).toEqual(['adoptive', 'birth', 'rumoured', 'ward']);
		const rand = rng(5);
		expect(rand()).toBeGreaterThanOrEqual(0);
	});
});
