// WP-K (0.3, K.2): `relationLookup` gives, for each person asked, exactly what `computeRelations` gives, in any order of asking, in
// batches, with a release between them, and each person is worked out once. Design: an internal study; the vet of the genealogy
// reviewer (the decision notes "Genealogy design vet of WP-K") fixes the orders and the trees below. The identity tests are a guard (they pass on
// any correct lookup); the call-count tests and the edge tests fail on a lookup that works a person out twice.
// Normal run about 30 s; deeper with R030_DEEP=1.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, relationCallStats, relationLookup, type Relation, type RelationOptions } from '../../src/core/relations';
import { chainModel, collapseModel, genModel, manyPartnersModel, oddText, rumouredModel, shuffled, toText, type GenModel, type GenSpec } from '../support/r028-gen';

const DEEP = process.env.R030_DEEP === '1';
const OPTIONS: RelationOptions[] = [{ oneParentUnknown: true }, { oneParentUnknown: false }];

function graphOf(text: string): FamilyGraph | null {
	const parsed = parseDynasty(text);
	return parsed.ok ? deriveFamilies(parsed.tree) : null;
}

/** What a test compares: every field of every name, and the line (which forces the lazy getter). */
function sig(r: readonly Relation[] | undefined): string {
	return r === undefined ? 'undefined' : JSON.stringify(r);
}

/** The kinds of name that the trees must contain, counted over a whole suite (a suite that has none proves nothing about them). */
const seen = { double: 0, rumoured: 0, maybe: 0, byMarriage: 0, stepSibling: 0, adoptive: 0, half: 0, none: 0 };

function count(ref: ReadonlyMap<string, readonly Relation[]>): void {
	for (const rels of ref.values())
		for (const r of rels) {
			if (r.lower.includes('double')) seen.double++;
			if (r.lower.includes('rumoured')) seen.rumoured++;
			if (r.maybe) seen.maybe++;
			if (r.kind === 'by-marriage') seen.byMarriage++;
			if (r.kind === 'step-sibling') seen.stepSibling++;
			if (r.lower.includes('adoptive')) seen.adoptive++;
			if (r.lower.includes('half')) seen.half++;
		}
}

/** The ids, hard names first: by marriage, then double, then rumoured or "maybe", then the rest (the order of the genealogy vet). */
function hardFirst(ids: readonly string[], ref: ReadonlyMap<string, readonly Relation[]>): string[] {
	const rank = (id: string) => {
		const rels = ref.get(id) ?? [];
		if (rels.some((r) => r.kind === 'by-marriage')) return 0;
		if (rels.some((r) => r.lower.includes('double'))) return 1;
		if (rels.some((r) => r.lower.includes('rumoured') || r.maybe)) return 2;
		return 3;
	};
	return ids.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id);
}

interface Run {
	g: FamilyGraph;
	me: string;
	options: RelationOptions;
	label: string;
	/** Also a fresh lookup for each single id. */
	each: boolean;
	seed: number;
}

/** Compares the lookup with the whole computation for one mark and one setting, over several orders of asking. */
function check({ g, me, options, label, each, seed }: Run): void {
	const ids = g.people.map((p) => p.id);
	const ref = computeRelations(g, me, options);
	count(ref);
	const want = new Map(ids.map((id) => [id, sig(ref.get(id))]));
	const orders: [string, string[]][] = [
		['forward', ids],
		['reverse', [...ids].reverse()],
		['shuffled 1', shuffled(ids, seed)],
		['shuffled 2', shuffled(ids, seed + 1)],
		['random 20', shuffled(ids, seed + 2).slice(0, 20)],
		['hard first', hardFirst(ids, ref)],
		['hard last', hardFirst(ids, ref).reverse()],
	];
	for (const [name, order] of orders) {
		const where = `${label} mark ${me} oneParentUnknown ${options.oneParentUnknown} order ${name}`;
		// One id at a time (each request ends in a release). The lines are read late, after every id is asked.
		const lookup = relationLookup(g, me, options);
		const got = order.map((id) => [id, lookup.get(id)] as const);
		for (const [id, rels] of got) expect(sig(rels), `${where} id ${id} (late line read)`).toBe(want.get(id));
		// The same lookup again: every answer is the kept one.
		for (const [id, rels] of got) expect(lookup.get(id), `${where} id ${id} (second ask)`).toBe(rels);
		// Batches of three, a release between them, lines read at once.
		const batched = relationLookup(g, me, options);
		const third = Math.ceil(order.length / 3);
		for (let b = 0; b < order.length; b += third) {
			const part = order.slice(b, b + third);
			const map = batched.getMany(part);
			for (const id of part) expect(sig(map.get(id)), `${where} id ${id} (batch)`).toBe(want.get(id));
		}
	}
	if (each) for (const id of ids) expect(sig(relationLookup(g, me, options).get(id)), `${label} mark ${me} fresh lookup id ${id}`).toBe(want.get(id));
	// An id that is not in the tree.
	expect(relationLookup(g, me, options).get('no-such-person')).toBeUndefined();
}

/** Several marks of one graph: all of them for a small tree, a seeded sample for a big one. */
function marks(g: FamilyGraph, seed: number, sample: number): string[] {
	const ids = g.people.map((p) => p.id);
	return ids.length <= 60 ? ids : shuffled(ids, seed).slice(0, sample);
}

function suite(g: FamilyGraph, label: string, seed: number, sample = 4): void {
	const small = g.people.length <= 60;
	for (const me of marks(g, seed, sample)) for (const options of OPTIONS) check({ g, me, options, label, each: small, seed });
}

describe('relationLookup is the same as computeRelations (WP-K K.2)', () => {
	it('every sample tree, every person as the mark for up to 60 people (4 seeded marks for more), both settings, 7 orders, batches, late line reads, a fresh lookup per id', { timeout: 300_000 }, () => {
		const files = readdirSync('fixtures').filter((f) => f.endsWith('.md'));
		expect(files.length).toBeGreaterThanOrEqual(16);
		let trees = 0;
		for (const f of files) {
			const block = /^```kin\r?\n([\s\S]*?)^```/m.exec(readFileSync(`fixtures/${f}`, 'utf8'));
			const g = block && graphOf(block[1]);
			if (!g) continue;
			trees++;
			// The big trees get fewer marks and orders because one whole computation of 400 people is the cost.
			suite(g, f, 7, g.people.length > 200 ? 2 : 4);
		}
		expect(trees).toBeGreaterThanOrEqual(15);
	});

	const SPECS: [string, GenSpec][] = [
		['plain', { n: 30, sex: 'mf' }],
		['mixed', { n: 30, sex: 'mixed', adoptive: 0.08, ward: 0.05, rumoured: 0.1, illegitimate: 0.1 }],
		['rumour-heavy', { n: 28, rumoured: 0.28, window: 12, adoptive: 0.05 }],
		['inbred', { n: 30, window: 6, unionP: 0.7, twoP: 0.9, rumoured: 0.1 }],
		['no sex', { n: 30, sex: 'none', rumoured: 0.1 }],
	];
	const SEEDS = DEEP ? 40 : 6;

	for (const [name, spec] of SPECS)
		it(`generated trees "${name}": ${SEEDS} seeds, 3 random marks each, both settings, all orders`, { timeout: 600_000 }, () => {
			for (let seed = 1; seed <= SEEDS; seed++) {
				const g = graphOf(toText(genModel(seed * 31 + name.length, spec)));
				expect(g).not.toBeNull();
				suite(g!, `${name} seed ${seed}`, seed, 3);
			}
		});

	it('dense small trees: relative marriages, 28 % rumoured links, sibship cross-marriages; double, rumoured, "maybe" and by-marriage names all occur', { timeout: 600_000 }, () => {
		const before = { ...seen };
		const dense: GenSpec = { n: 14, linkP: 0.95, twoP: 0.9, window: 6, unionP: 0.75, rumoured: 0.28, adoptive: 0.04 };
		const models: [string, GenModel][] = [];
		for (let seed = 1; seed <= (DEEP ? 60 : 12); seed++) models.push([`dense seed ${seed}`, genModel(seed * 977, { ...dense, n: 12 + (seed % 5) * 2 })]);
		for (let gens = 1; gens <= 5; gens++) models.push([`cross-marriages ${gens}`, collapseModel(gens)]);
		for (const [label, model] of models) {
			const g = graphOf(toText(model));
			expect(g, label).not.toBeNull();
			suite(g!, label, label.length, 3);
		}
		for (const key of ['double', 'rumoured', 'maybe', 'byMarriage'] as const) expect(seen[key] - before[key], `names of kind ${key} in the dense suite`).toBeGreaterThan(0);
	});

	it('special trees: collapse, rumoured parents, many partners, a long chain, all marks', { timeout: 600_000 }, () => {
		const models: [string, GenModel][] = [];
		for (let k = 1; k <= (DEEP ? 5 : 3); k++) models.push([`collapse ${k}`, collapseModel(k)]);
		for (let n = 3; n <= (DEEP ? 10 : 6); n++) models.push([`rumoured ${n}`, rumouredModel(n)]);
		for (let k = 2; k <= (DEEP ? 5 : 3); k++) models.push([`many partners ${k}`, manyPartnersModel(k)]);
		models.push(['chain', chainModel(30)]);
		for (const [label, model] of models) {
			const g = graphOf(toText(model));
			expect(g, label).not.toBeNull();
			suite(g!, label, 5, 8);
		}
	});

	it('the kinds of name in the whole suite: double, rumoured, "maybe", by marriage, step-sibling, adoptive, half all occur', () => {
		for (const key of ['double', 'rumoured', 'maybe', 'byMarriage', 'stepSibling', 'adoptive', 'half'] as const) expect(seen[key], key).toBeGreaterThan(0);
	});
});

describe('relationLookup: each person is worked out once, and edge cases (WP-K K.2)', () => {
	const g = graphOf(
		toText({
			...genModel(11, { n: 40, rumoured: 0.15, unionP: 0.5 }),
			options: { me: 'p20' },
		}),
	)!;
	const ids = g.people.map((p) => p.id);

	it('one relationsFor call per asked person across two overlapping batches with a release, none for a repeat, none for the mark or an unknown id', () => {
		const lookup = relationLookup(g, 'p20');
		const first = ids.slice(0, 20);
		const second = ids.slice(10, 35);
		const start = relationCallStats.calls;
		lookup.getMany(first);
		const afterFirst = relationCallStats.calls - start;
		expect(afterFirst).toBe(first.filter((id) => id !== 'p20').length);
		lookup.getMany(second);
		const distinct = new Set([...first, ...second].filter((id) => id !== 'p20'));
		expect(relationCallStats.calls - start).toBe(distinct.size);
		lookup.get('p20');
		lookup.get('no-such-person');
		for (const id of first) lookup.get(id);
		expect(relationCallStats.calls - start).toBe(distinct.size);
	});

	it('asking for 20 people of 40 calls relationsFor 20 times (or 19 with the mark in the list), not 40', () => {
		const lookup = relationLookup(g, 'p20');
		const start = relationCallStats.calls;
		const want = ids.slice(0, 20);
		lookup.getMany(want);
		expect(relationCallStats.calls - start).toBe(want.filter((id) => id !== 'p20').length);
		expect(relationCallStats.calls - start).toBeLessThan(ids.length);
	});

	it('the whole computation calls relationsFor once for each other person (the reference of the count)', () => {
		const start = relationCallStats.calls;
		computeRelations(g, 'p20');
		expect(relationCallStats.calls - start).toBe(ids.length - 1);
	});

	it('get twice gives the same frozen array; getMany gives a read-only map of the people with a relation only', () => {
		const lookup = relationLookup(g, 'p20');
		const withName = ids.find((id) => id !== 'p20' && computeRelations(g, 'p20').has(id))!;
		const a = lookup.get(withName);
		expect(a).toBeDefined();
		expect(lookup.get(withName)).toBe(a);
		expect(Object.isFrozen(a)).toBe(true);
		const map = lookup.getMany([withName, 'no-such-person']);
		expect([...map.keys()]).toEqual([withName]);
		expect(() => (map as Map<string, readonly Relation[]>).set('x', [])).toThrow(TypeError);
		expect(lookup.get('p20')?.map((r) => r.text)).toEqual(['You']);
	});

	it('a mark that is not a person: undefined for every id, an empty batch, no throw', () => {
		for (const me of ['', 'nobody', '__proto__']) {
			const lookup = relationLookup(g, me);
			expect(lookup.get('p1')).toBeUndefined();
			expect(lookup.get(me)).toBeUndefined();
			expect(lookup.getMany(ids).size).toBe(0);
			expect(computeRelations(g, me).size).toBe(0);
		}
	});

	it('a person with no relation gives undefined, not an empty list', () => {
		const lone = graphOf('people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a]}\n')!;
		const lookup = relationLookup(lone, 'a');
		expect(lookup.get('b')).toBeUndefined();
		expect(computeRelations(lone, 'a').get('b')).toBeUndefined();
		expect(lookup.get('c')?.[0].text).toBe('Child');
	});

	it('a tree with a parent cycle, a self-parent and missing parents (the odd tree) does not throw and matches', () => {
		const odd = graphOf(oddText())!;
		for (const me of odd.people.map((p) => p.id)) for (const options of OPTIONS) check({ g: odd, me, options, label: 'odd', each: true, seed: 3 });
	});

	it('a tree with cycles from the generator matches too', () => {
		const cyc = graphOf(toText(genModel(5, { n: 20, cycles: 3, selfParents: 2 })))!;
		suite(cyc, 'cycles', 2, 3);
	});

	it('a duplicate id in the text (the graph keeps the first person) matches', () => {
		const dup = graphOf('people:\n  - {id: a, name: A, sex: m}\n  - {id: a, name: A2}\n  - {id: b, name: B, parents: [a]}\n  - {id: c, name: C, parents: [a]}\n')!;
		suite(dup, 'duplicate text', 1, 3);
	});

	it('a graph whose list of people repeats an id: the last person that has a name wins, as in computeRelations', () => {
		const base = graphOf('people:\n  - {id: a, name: A, sex: m}\n  - {id: b, name: B, parents: [a]}\n  - {id: c, name: C, parents: [a]}\n  - {id: d, name: D}\n')!;
		const c = base.byId.get('c')!;
		const d = base.byId.get('d')!;
		// Hand-made: the list holds `c` again after `d`, and `d` again at the end (no relation), so the last index with a name is not the last index.
		const dup: FamilyGraph = { ...base, people: [...base.people, c, d] };
		for (const me of ['a', 'b', 'c', 'd']) for (const options of OPTIONS) check({ g: dup, me, options, label: 'repeated id', each: true, seed: 4 });
	});

	it('a rumoured mother who is also the father\'s wife keeps her two names (the by-marriage name a second call would lose)', () => {
		const lookup = relationLookup(
			graphOf(
				'people:\n  - {id: f, name: F, sex: m}\n  - {id: w, name: W, sex: f}\n  - {id: k, name: K, parents: [f, {id: w, type: rumoured}]}\n  - {id: s, name: S, parents: [f]}\n  - {id: n, name: N, parents: [k]}\nunions:\n  - {partners: [f, w]}\n',
			)!,
			'n',
		);
		const ref = computeRelations(graphOf('people:\n  - {id: f, name: F, sex: m}\n  - {id: w, name: W, sex: f}\n  - {id: k, name: K, parents: [f, {id: w, type: rumoured}]}\n  - {id: s, name: S, parents: [f]}\n  - {id: n, name: N, parents: [k]}\nunions:\n  - {partners: [f, w]}\n')!, 'n');
		for (const id of ['f', 'w', 'k', 's']) expect(sig(lookup.get(id)), id).toBe(sig(ref.get(id)));
	});
});
