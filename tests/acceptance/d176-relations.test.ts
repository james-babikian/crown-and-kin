/*
 * D176 items (4) and (7) (spec §0 D176, §13.1 "Half", "Sure and maybe", §13.2): the second test with
 * choices of rumoured parents, the new `some` flag of `RelationMaybe` and its texts, and the finder
 * steps of the extra "Rumoured half-X" name. Written from the vetted rule and its case table
 * (rows 1-18), before the build; the tests of the new rows fail until the D176 core work is merged.
 * All names are made up. Notation in the comments: (M, ~X) = birth parent M, rumoured parent X.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type FinderResult, type Relation, type RelationMaybe, type RelationOptions } from '../../src/core/relations';
import { cardRelationText, relationSummary, spokenRelation } from '../../src/render/tree-info';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };
const SETTINGS: [string, RelationOptions][] = [
	['on', ON],
	['off', OFF],
];

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Compact lines "id sex parent[:type]…" ("-" for no sex); the name of a person is the id. */
function tree(people: string[], unions: string[] = []): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		const refs = parents.map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		out.push(`  - {id: ${id}, name: ${id}${sex === '-' ? '' : `, sex: ${sex}`}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`);
	}
	if (unions.length) out.push('unions:', ...unions.map((u) => `  - partners: [${u}]`));
	return graphOf(out.join('\n') + '\n');
}

const texts = (list: readonly Relation[]) => list.map((r) => r.text);

type SomeMaybe = RelationMaybe & { some?: boolean };

/** A `RelationMaybe` without the new flag. */
function maybe(effect: 'full' | 'half', text: string, cause: 'rumoured' | 'unlisted'): RelationMaybe {
	return { effect, text, lower: text.toLowerCase(), cause };
}

/** What a pair must show: the names (the first is the card), the maybe of the first and, for the new flag, `some`. */
interface Want {
	names: string[];
	maybe?: RelationMaybe;
	/** True: the maybe must have `some: true`. */
	some?: true;
}

/** What the finder must show: the lower-case relation list and, for each, the step words (null: not fixed by the table). */
interface FinderWant {
	relations: string[];
	steps: (string[] | null)[];
}

interface Case {
	row: string;
	g: FamilyGraph;
	a: string;
	b: string;
	on: Want;
	off?: Want;
	finder?: FinderWant;
	/** The same wants hold with the two people swapped (all words are sex-neutral in the sample). */
	symmetric?: boolean;
}

function checkNames(g: FamilyGraph, me: string, other: string, options: RelationOptions, want: Want) {
	const list = computeRelations(g, me, options).get(other) ?? [];
	const label = `${me} → ${other}`;
	expect(texts(list), label).toEqual(want.names);
	const m = list[0]?.maybe as SomeMaybe | undefined;
	if (want.maybe) {
		expect(m, label).toBeDefined();
		expect({ effect: m!.effect, text: m!.text, lower: m!.lower, cause: m!.cause }, label).toEqual(want.maybe);
		expect(m!.lower, label).toBe(m!.text.toLowerCase());
		if (want.some) expect(m!.some, `${label}: flag some`).toBe(true);
	} else {
		expect(m, label).toBeUndefined();
	}
	for (const r of list.slice(1)) expect(r.maybe, `${label}: ${r.text}`).toBeUndefined();
	// The card text agrees with the first name and the maybe.
	if (list[0]) {
		const card = cardRelationText(list[0]);
		expect(card, label).toBe(want.maybe ? `${want.names[0]}, maybe ${want.maybe.effect === 'full' ? 'full' : 'half'}` : want.names[0]);
	}
}

function checkFinder(g: FamilyGraph, me: string, other: string, options: RelationOptions, want: FinderWant) {
	const label = `${me} → ${other}`;
	const r: FinderResult = findRelation(g, me, other, options);
	if (r.kind !== 'named') throw new Error(`${label}: expected named, got ${r.kind}`);
	expect(
		r.relations.map((x) => x.relation.lower),
		label,
	).toEqual(want.relations);
	want.steps.forEach((s, i) => {
		if (s) expect(r.relations[i].steps.map((x) => x.word), `${label}: relation ${want.relations[i]}`).toEqual(s);
	});
	// A relation whose text says "rumoured" has a step that says it.
	for (const x of r.relations) {
		if (x.relation.lower.includes('rumoured')) expect(x.steps.some((s) => s.word.includes('rumoured')), `${label}: ${x.relation.text}`).toBe(true);
	}
}

function runCase(c: Case) {
	describe(c.row, () => {
		for (const [label, options] of SETTINGS) {
			const want = options === ON ? c.on : (c.off ?? c.on);
			it(`names, maybe and Also (setting ${label})`, () => {
				checkNames(c.g, c.a, c.b, options, want);
				if (c.symmetric) checkNames(c.g, c.b, c.a, options, want);
			});
			if (c.finder) {
				const f = c.finder;
				it(`finder (setting ${label})`, () => {
					checkFinder(c.g, c.a, c.b, options, f);
					if (c.symmetric) checkFinder(c.g, c.b, c.a, options, f);
				});
			}
		}
	});
}

const SISTER = 'If some of the rumoured links are true, this person is your sister.';
const FINDER_HALF_AND_RUMOURED: FinderWant = { relations: ['half-sister', 'rumoured sister'], steps: [['half-sister'], ['rumoured sister']] };
const FULL_MAYBE_RUMOURED = (text: string, also: string, name: string): Want => ({ names: [name, also], maybe: maybe('full', text, 'rumoured'), some: true });

// ---------------------------------------------------------------------------------------------
// Rows 1-8 and 15-17: a half pair with several rumoured parents (the rumoured link could make them full)

// Row 1 to 4: Ada (Mark, ~Xavier, ~Yves) against Bea, Cal, Dee, Clara.
const ADA_TREE = tree([
	'Mark m',
	'Xavier m',
	'Yves m',
	'Zane m',
	'Ada f Mark Xavier:rumoured Yves:rumoured',
	'Bea f Mark Xavier',
	'Cal f Mark Xavier:rumoured',
	'Dee f Mark Yves:rumoured Xavier:rumoured',
	'Clara f Mark Zane:rumoured',
	'Helen f Mark',
]);

describe('D176 case table, rows 1-5: Ada (Mark, ~Xavier, ~Yves)', () => {
	runCase({
		row: 'row 1: Ada vs Bea (Mark, Xavier): Half-sister, maybe full; Also Rumoured sister',
		g: ADA_TREE,
		a: 'Ada',
		b: 'Bea',
		on: FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'),
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
	runCase({
		row: 'row 2: Ada vs Cal (Mark, ~Xavier): as row 1',
		g: ADA_TREE,
		a: 'Ada',
		b: 'Cal',
		on: FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'),
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
	runCase({
		row: 'row 3: Ada vs Dee (Mark, ~Yves, ~Xavier): Half-sister, maybe full',
		g: ADA_TREE,
		a: 'Ada',
		b: 'Dee',
		on: FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'),
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
	runCase({
		row: 'row 4: Ada vs Clara (Mark, ~Zane): Half-sister, no maybe, no Also',
		g: ADA_TREE,
		a: 'Ada',
		b: 'Clara',
		on: { names: ['Half-sister'] },
		finder: { relations: ['half-sister'], steps: [['half-sister']] },
		symmetric: true,
	});
	runCase({
		row: 'row 5: Ada vs Helen (Mark only): on: Half-sister, maybe full (unlisted); off: Half-sister',
		g: ADA_TREE,
		a: 'Ada',
		b: 'Helen',
		on: { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted') },
		off: { names: ['Half-sister'] },
		finder: { relations: ['half-sister'], steps: [['half-sister']] },
		symmetric: true,
	});
});

describe('D176 case table, rows 6, 16: a person with one birth parent and three rumoured parents', () => {
	const g = tree([
		'Mark m',
		'X m',
		'Y m',
		'Z m',
		'W m',
		'Ada3 f Mark X:rumoured Y:rumoured Z:rumoured',
		'Bea f Mark Y',
		'Ada3b f Mark Y:rumoured Z:rumoured W:rumoured',
	]);
	runCase({
		row: 'row 6: Ada3 (Mark, ~X, ~Y, ~Z) vs Bea (Mark, Y): Half-sister, maybe full',
		g,
		a: 'Ada3',
		b: 'Bea',
		on: FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'),
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
	runCase({
		row: 'row 16: Ada3 vs Ada3b (Mark, ~Y, ~Z, ~W): Half-sister, maybe full',
		g,
		a: 'Ada3',
		b: 'Ada3b',
		on: FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'),
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
});

describe('D176 case table, row 7: no birth parent', () => {
	const g = tree(['X m', 'Y m', 'Z m', 'Pia f X:rumoured Y:rumoured Z:rumoured', 'Quin f X Y']);
	runCase({
		row: 'row 7: Pia (~X, ~Y, ~Z) vs Quin (X, Y): Rumoured sister, no maybe, no Also',
		g,
		a: 'Pia',
		b: 'Quin',
		on: { names: ['Rumoured sister'] },
		finder: { relations: ['rumoured sister'], steps: [['rumoured sister']] },
		symmetric: true,
	});
});

describe('D176 case table, row 8: three parents listed in a different order', () => {
	const g = tree(['Pa m', 'Qu m', 'Ro m', 'Kay f Pa Qu:rumoured Ro:rumoured', 'Lou f Qu Pa Ro:rumoured']);
	runCase({
		row: 'row 8: Kay (Pa, ~Qu, ~Ro) vs Lou (Qu, Pa, ~Ro): Half-sister, maybe full (the all-true set keeps it)',
		g,
		a: 'Kay',
		b: 'Lou',
		// Lou lists two birth parents, so only Kay's whole set matches Lou's: no rumoured parent is left out, so no `some` (supervisor ruling, the decision notes "0.2.6").
		on: { ...FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'), some: undefined },
		finder: FINDER_HALF_AND_RUMOURED,
		symmetric: true,
	});
});

describe('D176 case table, row 15: the children of the pair of row 1', () => {
	const g = tree([
		'Mark m',
		'Xavier m',
		'Yves m',
		'Ada f Mark Xavier:rumoured Yves:rumoured',
		'Bea f Mark Xavier',
		'Adad f Ada',
		'Bead f Bea',
	]);
	const want: Want = { names: ['Half first cousin', 'Rumoured first cousin'], maybe: maybe('full', 'First cousin', 'rumoured') };
	for (const [label, options] of SETTINGS) {
		it(`row 15: Half first cousin, maybe full; Also Rumoured first cousin; a step says rumoured (setting ${label})`, () => {
			checkNames(g, 'Adad', 'Bead', options, want);
			checkNames(g, 'Bead', 'Adad', options, want);
			for (const [a, b] of [
				['Adad', 'Bead'],
				['Bead', 'Adad'],
			]) {
				const r = findRelation(g, a, b, options);
				if (r.kind !== 'named') throw new Error('expected named');
				expect(r.relations.map((x) => x.relation.lower)).toEqual(['half first cousin', 'rumoured first cousin']);
				expect(r.relations[1].steps.some((s) => s.word.includes('rumoured')), `${a} → ${b}`).toBe(true);
			}
		});
	}
});

describe('D176 case table, row 17: adoptive links never give a maybe', () => {
	const g = tree(['Mark m', 'X m', 'Y m', 'Ad f Mark:adoptive X:rumoured Y:rumoured', 'Bd f Mark:adoptive X']);
	for (const [label, options] of SETTINGS) {
		it(`Ad vs Bd: Adoptive sister, no maybe, Also Rumoured half-sister (setting ${label})`, () => {
			for (const [a, b] of [
				['Ad', 'Bd'],
				['Bd', 'Ad'],
			]) {
				const list = computeRelations(g, a, options).get(b) ?? [];
				expect(texts(list), `${a} → ${b}`).toEqual(['Adoptive sister', 'Rumoured half-sister']);
				for (const r of list) expect(r.maybe, `${a} → ${b}`).toBeUndefined();
			}
		});
	}
});

// ---------------------------------------------------------------------------------------------
// Rows 9-14: a full pair where a rumoured parent could make them half

const GWEN_TREE = tree([
	'M m',
	'X f',
	'Y m',
	'Z m',
	'G f M X Y:rumoured Z:rumoured',
	'Bea f M X',
	'Gwen f M X X:rumoured',
]);

describe('D176 case table, rows 9, 10: Sister, maybe half', () => {
	runCase({
		row: 'row 9: G (M, X, ~Y, ~Z) vs Bea (M, X): Sister, maybe half; Also Rumoured half-sister',
		g: GWEN_TREE,
		a: 'G',
		b: 'Bea',
		on: { names: ['Sister', 'Rumoured half-sister'], maybe: maybe('half', 'Half-sister', 'rumoured') },
		finder: { relations: ['sister', 'rumoured half-sister'], steps: [['father', 'co-parent', 'daughter'], ['rumoured half-sister']] },
		symmetric: true,
	});
	runCase({
		row: 'row 10: Gwen (M, X, ~X) vs Bea (M, X): Sister, no maybe, no Also',
		g: GWEN_TREE,
		a: 'Gwen',
		b: 'Bea',
		on: { names: ['Sister'] },
		finder: { relations: ['sister'], steps: [['father', 'co-parent', 'daughter']] },
		symmetric: true,
	});
});

describe('D176 case table, rows 11-14: Eleanor (David, Mary, ~Yannick) and her daughter', () => {
	const g = tree(
		['Mary f', 'David m', 'Yannick m', 'Eleanor f David Mary Yannick:rumoured', 'Fiona f David Mary', 'Ella f Eleanor', 'Fay f Fiona'],
		['Mary, David'],
	);
	runCase({
		row: 'row 11: Eleanor vs Fiona: Sister, maybe half; Also Rumoured half-sister',
		g,
		a: 'Eleanor',
		b: 'Fiona',
		on: { names: ['Sister', 'Rumoured half-sister'], maybe: maybe('half', 'Half-sister', 'rumoured') },
		finder: { relations: ['sister', 'rumoured half-sister'], steps: [['father', 'wife', 'daughter'], ['rumoured half-sister']] },
		symmetric: true,
	});
	runCase({
		row: 'row 12: Eleanor\'s daughter vs Fiona\'s daughter: First cousin, maybe half; the second line goes through the rumoured half-sister',
		g,
		a: 'Ella',
		b: 'Fay',
		on: { names: ['First cousin', 'Rumoured half first cousin'], maybe: maybe('half', 'Half first cousin', 'rumoured') },
		finder: { relations: ['first cousin', 'rumoured half first cousin'], steps: [null, ['mother', 'rumoured half-sister', 'daughter']] },
	});
	runCase({
		row: 'row 13: Eleanor vs Fiona\'s daughter: Niece, maybe half',
		g,
		a: 'Eleanor',
		b: 'Fay',
		on: { names: ['Niece', 'Rumoured half-niece'], maybe: maybe('half', 'Half-niece', 'rumoured') },
		finder: { relations: ['niece', 'rumoured half-niece'], steps: [null, ['rumoured half-sister', 'daughter']] },
	});
	runCase({
		row: 'row 14: Eleanor\'s daughter vs Fiona: Aunt, maybe half',
		g,
		a: 'Ella',
		b: 'Fiona',
		on: { names: ['Aunt', 'Rumoured half-aunt'], maybe: maybe('half', 'Half-aunt', 'rumoured') },
		finder: { relations: ['aunt', 'rumoured half-aunt'], steps: [null, ['mother', 'rumoured half-sister']] },
	});
});

// ---------------------------------------------------------------------------------------------
// The texts of the new flag (rows 1-3, 6, 16; row 8 has no flag, see its case)

describe('D176 the flag `some` and its texts', () => {
	const g = ADA_TREE;
	const g3 = tree(['Mark m', 'X m', 'Y m', 'Z m', 'Ada3 f Mark X:rumoured Y:rumoured Z:rumoured', 'Bea f Mark Y']);
	const cases: [string, FamilyGraph, string, string][] = [
		['row 1', g, 'Ada', 'Bea'],
		['row 2', g, 'Ada', 'Cal'],
		['row 3', g, 'Ada', 'Dee'],
		['row 6', g3, 'Ada3', 'Bea'],
		['row 16', tree(['Mark m', 'X m', 'Y m', 'Z m', 'W m', 'Ada3 f Mark X:rumoured Y:rumoured Z:rumoured', 'Ada3b f Mark Y:rumoured Z:rumoured W:rumoured']), 'Ada3', 'Ada3b'],
	];
	for (const [row, graph, a, b] of cases) {
		for (const [label, options] of SETTINGS) {
			it(`${row}, ${a} → ${b} (setting ${label}): some is true; sheet, card and spoken text`, () => {
				for (const [me, other] of [
					[a, b],
					[b, a],
				]) {
					const list = computeRelations(graph, me, options).get(other)!;
					const m = list[0].maybe as SomeMaybe;
					expect(m.some, `${me} → ${other}`).toBe(true);
					expect(m.effect).toBe('full');
					expect(m.cause).toBe('rumoured');
					expect(relationSummary(list, false).maybe, `${me} → ${other}`).toBe(SISTER);
					expect(spokenRelation(list[0]), `${me} → ${other}`).toBe('half-sister, or sister if some rumoured links are true');
					expect(cardRelationText(list[0])).toBe('Half-sister, maybe full');
				}
			});
		}
	}

	it('a maybe whose matching set holds every rumoured parent keeps the old sheet text (Alice, Beatrix: both list the same Xavier)', () => {
		const h = tree(['Mary f', 'Xavier m', 'Alice f Mary Xavier:rumoured', 'Beatrix f Mary Xavier:rumoured']);
		const list = computeRelations(h, 'Alice', ON).get('Beatrix')!;
		expect(texts(list)).toEqual(['Half-sister', 'Rumoured sister']);
		expect((list[0].maybe as SomeMaybe).some).toBeFalsy();
		expect(relationSummary(list, false).maybe).toBe('If every rumoured link is true, this person is your sister.');
		expect(spokenRelation(list[0])).toBe('half-sister, or sister if the rumoured links are true');
	});
});

// ---------------------------------------------------------------------------------------------
// Row 18: the same rows with the people swapped (people and parent order reversed)

describe('D176 row 18: the same names and maybes with the people and parents in the other order', () => {
	const reversed = (rows: string[]) => [...rows].reverse().map((l) => {
		const [id, sex, ...parents] = l.split(' ');
		return [id, sex, ...parents.reverse()].join(' ');
	});
	const row1 = ['Mark m', 'Xavier m', 'Yves m', 'Ada f Mark Xavier:rumoured Yves:rumoured', 'Bea f Mark Xavier'];
	const row5 = ['Mark m', 'Xavier m', 'Yves m', 'Ada f Mark Xavier:rumoured Yves:rumoured', 'Helen f Mark'];
	const row11 = ['Mary f', 'David m', 'Yannick m', 'Eleanor f David Mary Yannick:rumoured', 'Fiona f David Mary'];
	const unions = ['Mary, David'];
	for (const [label, options] of SETTINGS) {
		it(`rows 1, 5, 11 (setting ${label})`, () => {
			const g1 = tree(reversed(row1));
			checkNames(g1, 'Bea', 'Ada', options, FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'));
			checkNames(g1, 'Ada', 'Bea', options, FULL_MAYBE_RUMOURED('Sister', 'Rumoured sister', 'Half-sister'));
			checkFinder(g1, 'Bea', 'Ada', options, FINDER_HALF_AND_RUMOURED);
			const g5 = tree(reversed(row5));
			const want5: Want = options === ON ? { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted') } : { names: ['Half-sister'] };
			checkNames(g5, 'Helen', 'Ada', options, want5);
			checkNames(g5, 'Ada', 'Helen', options, want5);
			const g11 = tree(reversed(row11), unions);
			const want11: Want = { names: ['Sister', 'Rumoured half-sister'], maybe: maybe('half', 'Half-sister', 'rumoured') };
			checkNames(g11, 'Fiona', 'Eleanor', options, want11);
			checkNames(g11, 'Eleanor', 'Fiona', options, want11);
			// The sure line passes the first listed parent (father or mother), as before D176; row 18 pins names and maybes, so only the rumoured step is checked.
			checkFinder(g11, 'Fiona', 'Eleanor', options, { relations: ['sister', 'rumoured half-sister'], steps: [null, ['rumoured half-sister']] });
		});
	}
});

// ---------------------------------------------------------------------------------------------
// The invariants as a small seeded fuzz (fixed seeds)

/** A small deterministic random generator (mulberry32). */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface RawPerson {
	id: string;
	sex: 'f' | 'm';
	parents: string[]; // "id" or "id:type"
}

function shuffle<T>(rand: () => number, list: readonly T[]): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Mode 'general': each person lists 0-4 distinct earlier people, mostly birth, some rumoured, few adoptive. */
function randomGeneral(rand: () => number): RawPerson[] {
	const n = 4 + Math.floor(rand() * 4);
	const people: RawPerson[] = [];
	for (let i = 0; i < n; i++) {
		const pool = shuffle(rand, people.map((p) => p.id));
		const count = Math.min(pool.length, Math.floor(rand() * 5));
		const parents = pool.slice(0, count).map((id) => {
			const x = rand();
			return x < 0.5 ? id : x < 0.9 ? `${id}:rumoured` : `${id}:adoptive`;
		});
		people.push({ id: `p${i}`, sex: rand() < 0.5 ? 'f' : 'm', parents });
	}
	return people;
}

/** Mode 'siblings': one common parent M, a few other possible fathers, each child lists M and some of them, birth or rumoured. */
function randomSiblings(rand: () => number): RawPerson[] {
	const people: RawPerson[] = [{ id: 'M', sex: 'f', parents: [] }];
	const others = ['X', 'Y', 'Z', 'W'];
	for (const o of others) people.push({ id: o, sex: 'm', parents: [] });
	const kids = 3 + Math.floor(rand() * 3);
	for (let i = 0; i < kids; i++) {
		const parents: string[] = rand() < 0.9 ? ['M'] : [];
		for (const o of others) if (rand() < 0.45) parents.push(rand() < 0.6 ? `${o}:rumoured` : o);
		people.push({ id: `k${i}`, sex: 'f', parents: shuffle(rand, parents) });
		if (rand() < 0.5) people.push({ id: `c${i}`, sex: rand() < 0.5 ? 'f' : 'm', parents: [`k${i}`] });
	}
	return people;
}

/** Mode 'double': the double first cousins of D174 invariant 4 with random rumoured parents added. */
function randomDouble(rand: () => number): RawPerson[] {
	const people: RawPerson[] = [
		{ id: 'g1', sex: 'm', parents: [] },
		{ id: 'g2', sex: 'f', parents: [] },
		{ id: 'g3', sex: 'f', parents: [] },
		{ id: 'g4', sex: 'm', parents: [] },
		{ id: 'Z', sex: 'm', parents: [] },
		{ id: 'V', sex: 'm', parents: [] },
		{ id: 'f1', sex: 'm', parents: ['g1', 'g2'] },
		{ id: 'f2', sex: 'm', parents: ['g1', 'g2'] },
		{ id: 'm1', sex: 'f', parents: ['g3', 'g4'] },
		{ id: 'm2', sex: 'f', parents: ['g3', 'g4'] },
		{ id: 'E', sex: 'm', parents: ['f1', 'm1'] },
		{ id: 'P', sex: 'm', parents: ['f2', 'm2'] },
	];
	for (const p of people) {
		if (p.id === 'E' || p.id === 'P' || p.id.startsWith('f') || p.id.startsWith('m')) {
			for (const extra of ['Z', 'V']) if (rand() < 0.35) p.parents.push(`${extra}:rumoured`);
			if (rand() < 0.15) p.parents = p.parents.filter((x) => !x.startsWith('g') || rand() < 0.5);
		}
	}
	return people;
}

const line = (p: RawPerson) => [p.id, p.sex, ...p.parents].join(' ');

/** Everything the card, the sheet and "Also" show for each ordered pair, keyed by ids. */
function signature(g: FamilyGraph, options: RelationOptions): Map<string, string> {
	const out = new Map<string, string>();
	for (const me of g.people.map((p) => p.id).sort()) {
		for (const [other, list] of computeRelations(g, me, options)) {
			const blood = list.filter((r) => r.kind === 'blood');
			if (!blood.length) continue;
			// Names of equal distance may come in either order, so the names are a sorted set; the maybes of the list likewise.
			const maybes = blood.flatMap((r) => (r.maybe ? [[r.text, r.maybe.effect, r.maybe.text, r.maybe.cause, Boolean((r.maybe as SomeMaybe).some)]] : [])).map((x) => JSON.stringify(x)).sort();
			out.set(`${me}>${other}`, JSON.stringify([blood.map((r) => r.text).sort(), maybes]));
		}
	}
	return out;
}

const MODES: [string, (r: () => number) => RawPerson[], number][] = [
	['general', randomGeneral, 101],
	['siblings', randomSiblings, 202],
	['double cousins with rumoured parents', randomDouble, 303],
];

describe('D176 fuzz (fixed seeds, 60 trees for each of 3 seeds)', () => {
	for (const [label, make, seed] of MODES) {
		it(`${label}: names and maybes do not depend on the order of the people or the parents (both settings)`, () => {
			const rand = rng(seed);
			for (let i = 0; i < 60; i++) {
				const raw = make(rand);
				const a = tree(raw.map(line));
				const b = tree(shuffle(rand, raw).map((p) => line({ ...p, parents: shuffle(rand, p.parents) })));
				for (const [, options] of SETTINGS) {
					const sa = signature(a, options);
					const sb = signature(b, options);
					const keys = new Set([...sa.keys(), ...sb.keys()]);
					const diff = [...keys].filter((k) => sa.get(k) !== sb.get(k)).sort().map((k) => `${k}: ${sa.get(k)} / ${sb.get(k)}`);
					expect(diff, `tree ${i}: ${raw.map(line).join(' | ')}`).toEqual([]);
				}
			}
		});

		it(`${label}: a finder relation with "rumoured" in its text has a step with "rumoured"; the finder agrees with the card`, () => {
			const rand = rng(seed + 1);
			for (let i = 0; i < 40; i++) {
				const raw = make(rand);
				const g = tree(raw.map(line));
				const ids = g.people.map((p) => p.id);
				for (const [, options] of SETTINGS) {
					for (const first of ids) {
						const all = computeRelations(g, first, options);
						for (const second of ids) {
							if (first === second) continue;
							const r = findRelation(g, first, second, options);
							const where = `tree ${i}, ${first} → ${second}: ${raw.map(line).join(' | ')}`;
							if (r.kind !== 'named') continue;
							for (const x of r.relations) {
								if (x.relation.text.toLowerCase().includes('rumoured')) {
									expect(x.steps.some((s) => s.word.includes('rumoured')), `${where}: ${x.relation.text}`).toBe(true);
								}
							}
							const want = all.get(second) ?? [];
							expect(r.relations.map((x) => x.relation.text), where).toEqual(texts(want));
							expect(
								r.relations.map((x) => (x.relation.maybe ? [x.relation.maybe.effect, x.relation.maybe.cause] : null)),
								where,
							).toEqual(want.map((x) => (x.maybe ? [x.maybe.effect, x.maybe.cause] : null)));
						}
					}
				}
			}
		});
	}
});
