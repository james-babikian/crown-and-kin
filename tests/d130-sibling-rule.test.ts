/*
 * D174 (spec §0 D174, §13.1 "Half" and "Sure and maybe"): the sibling rule with the setting
 * "Assume an unknown second parent" (`RelationOptions.oneParentUnknown`, default on) and the
 * "maybe" texts. Written from the spec and the supervisor's case table, before the build; these
 * tests fail until the D174 core work is merged. All names are made up.
 *
 * The sample tree is the one of the case table: Mary (p1) and David (p7) are partners; Eleanor lists
 * them and a rumoured Yannick; Fiona and Gracie list Mary and David; Helen and Ingrid list only Mary;
 * Alice and Beatrix list Mary and a rumoured Xavier; Clara lists Mary and a rumoured Zander.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import {
	computeRelations,
	DEFAULT_RELATION_OPTIONS,
	findRelation,
	relationsKey,
	type FinderResult,
	type Relation,
	type RelationMaybe,
	type RelationOptions,
} from '../src/core/relations';
import { cardRelationText, relationSummary, spokenRelation } from '../src/render/tree-info';
import { build, fixture } from './helpers';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };
const SETTINGS: [string, RelationOptions][] = [
	['on', ON],
	['off', OFF],
];

const SAMPLE_PEOPLE = [
	'  - {id: p1, name: Mary, sex: f}',
	'  - {id: p7, name: David, sex: m}',
	'  - {id: p10, name: Yannick, sex: m}',
	'  - {id: p8, name: Eleanor, sex: f, parents: [p7, p1, {id: p10, type: rumoured}]}',
	'  - {id: p9, name: Fiona, sex: f, parents: [p7, p1]}',
	'  - {id: p11, name: Gracie, sex: f, parents: [p1, p7]}',
	'  - {id: p12, name: Helen, sex: f, parents: [p1]}',
	'  - {id: p13, name: Ingrid, sex: f, parents: [p1]}',
	'  - {id: p2, name: Alice, sex: f, parents: [p1, {id: p5, type: rumoured}]}',
	'  - {id: p3, name: Beatrix, sex: f, parents: [p1, {id: p5, type: rumoured}]}',
	'  - {id: p4, name: Clara, sex: f, parents: [p1, {id: p6, type: rumoured}]}',
	'  - {id: p5, name: Xavier, sex: m}',
	'  - {id: p6, name: Zander, sex: m}',
];
const SAMPLE_UNIONS = ['  - partners: [p1, p7]'];

/** The sample tree, with extra people and unions after the sample's own. */
function sample(extraPeople: string[] = [], extraUnions: string[] = []): FamilyGraph {
	return graphOf(['people:', ...SAMPLE_PEOPLE, ...extraPeople, 'unions:', ...SAMPLE_UNIONS, ...extraUnions].join('\n') + '\n');
}

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Compact lines "id sex parent[:type]…" ("-" for no sex). */
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

/** The id of the person with this name. */
function idOf(g: FamilyGraph, name: string): string {
	const p = g.people.find((x) => x.name === name);
	if (!p) throw new Error(`no person ${name}`);
	return p.id;
}

/** `other`'s relations to `me` (names, not ids), best first. */
function rels(g: FamilyGraph, me: string, other: string, options?: RelationOptions): readonly Relation[] {
	return computeRelations(g, idOf(g, me), options).get(idOf(g, other)) ?? [];
}

const texts = (list: readonly Relation[]) => list.map((r) => r.text);

/** A `RelationMaybe` with `lower` made from `text`. 0.2.8 (F-KIN-08): an 'unlisted' cause names its sentence form. */
function maybe(effect: 'full' | 'half', text: string, cause: 'rumoured' | 'unlisted', unlistedForm?: 'same-person' | 'other-parent'): RelationMaybe {
	return { effect, text, lower: text.toLowerCase(), cause, ...(unlistedForm ? { unlistedForm } : {}) };
}

const named = (r: FinderResult) => {
	if (r.kind !== 'named') throw new Error(`expected named, got ${r.kind}`);
	return r;
};

/** What a pair must show: every name (the first is the card, the rest is "Also") and the maybe of the first. */
interface Want {
	names: string[];
	maybe?: RelationMaybe;
}

/** Checks one pair in both directions; all people of the sample have sex f, so the words are the same. */
function checkPair(g: FamilyGraph, a: string, b: string, options: RelationOptions | undefined, want: Want) {
	for (const [me, other] of [
		[a, b],
		[b, a],
	]) {
		const list = rels(g, me, other, options);
		const label = `${me} → ${other}`;
		expect(texts(list), label).toEqual(want.names);
		expect(list[0]?.maybe, label).toEqual(want.maybe);
		// Only the first relation (the card) carries the maybe of the pair.
		for (const r of list.slice(1)) expect(r.maybe, `${label}: ${r.text}`).toBeUndefined();
		// The maybe name is the "other" relation word in lower case.
		if (list[0]?.maybe) expect(list[0].maybe.lower).toBe(list[0].maybe.text.toLowerCase());
	}
}

// ---------------------------------------------------------------------------------------------
// The case table (spec §13.1 "Half", "Sure and maybe"; case table of 2026-10-06, corrected)

interface Row {
	title: string;
	pairs: [string, string][];
	on: Want;
	off: Want;
}

const ROWS: Row[] = [
	{
		// Both lists are {Mary}; both have a rumoured parent, so both are incomplete in the sure test (half).
		// The second test gives {Mary, Xavier} for both: equal, with a rumoured parent in them.
		title: 'Alice and Beatrix: Half-sister, maybe full (rumoured); Also "Rumoured sister"',
		pairs: [['Alice', 'Beatrix']],
		on: { names: ['Half-sister', 'Rumoured sister'], maybe: maybe('full', 'Sister', 'rumoured') },
		off: { names: ['Half-sister', 'Rumoured sister'], maybe: maybe('full', 'Sister', 'rumoured') },
	},
	{
		// Two different rumoured fathers: the second test gives {Mary, Xavier} and {Mary, Zander}; three people.
		title: 'Alice and Clara, Beatrix and Clara: Half-sister, the rumour changes nothing',
		pairs: [
			['Alice', 'Clara'],
			['Beatrix', 'Clara'],
		],
		on: { names: ['Half-sister'] },
		off: { names: ['Half-sister'] },
	},
	{
		// Sure sets {David, Mary} for both (full); the second test adds Yannick to Eleanor's set only.
		title: 'Eleanor and Fiona, Eleanor and Gracie: Sister, maybe half; Also "Rumoured half-sister"',
		pairs: [
			['Eleanor', 'Fiona'],
			['Eleanor', 'Gracie'],
		],
		on: { names: ['Sister', 'Rumoured half-sister'], maybe: maybe('half', 'Half-sister', 'rumoured') },
		off: { names: ['Sister', 'Rumoured half-sister'], maybe: maybe('half', 'Half-sister', 'rumoured') },
	},
	{
		title: 'Fiona and Gracie: Sister (the order of the parents does not matter)',
		pairs: [['Fiona', 'Gracie']],
		on: { names: ['Sister'] },
		off: { names: ['Sister'] },
	},
	{
		// On: Helen is incomplete; {David, Mary} and {Mary} together are two people: maybe full, no rumour.
		title: 'Fiona and Helen, Gracie and Helen, Fiona and Ingrid: on: Half-sister, maybe full (unlisted); off: Half-sister',
		pairs: [
			['Fiona', 'Helen'],
			['Gracie', 'Helen'],
			['Fiona', 'Ingrid'],
		],
		on: { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted', 'other-parent') },
		off: { names: ['Half-sister'] },
	},
	{
		title: 'Helen and Ingrid: on: Half-sister, maybe full (unlisted); off: Sister',
		pairs: [['Helen', 'Ingrid']],
		on: { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted', 'same-person') },
		off: { names: ['Sister'] },
	},
	{
		// On: {Mary} and {Mary, Xavier} together are two people (maybe full), but the sets differ, so the
		// cause is "unlisted" and "Also" gets no rumoured name (spec fix of 2026-10-06).
		title: 'Helen and Alice, Helen and Beatrix, Helen and Clara, Ingrid and Alice: on: Half-sister, maybe full (unlisted); off: Half-sister',
		pairs: [
			['Helen', 'Alice'],
			['Helen', 'Beatrix'],
			['Helen', 'Clara'],
			['Ingrid', 'Alice'],
		],
		on: { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted', 'other-parent') },
		off: { names: ['Half-sister'] },
	},
	{
		// {David, Mary, Yannick} and {Mary}: three people. Since the 0.2.8 fix round (D205 item 2) the sure parents {David, Mary} count as an outcome
		// too, so an unlisted parent of Helen could make them full: the same shape as Sue (Carl, Anna, rumoured Dirk) and Tom (Anna).
		title: 'Eleanor and Helen: on: Half-sister, maybe full (unlisted); off: Half-sister',
		pairs: [['Eleanor', 'Helen']],
		on: { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted', 'other-parent') },
		off: { names: ['Half-sister'] },
	},
	{
		title: 'Eleanor and Alice, Eleanor and Clara, Fiona and Alice: Half-sister',
		pairs: [
			['Eleanor', 'Alice'],
			['Eleanor', 'Clara'],
			['Fiona', 'Alice'],
		],
		on: { names: ['Half-sister'] },
		off: { names: ['Half-sister'] },
	},
];

describe('D174 case table: names, maybe and "Also" for both settings', () => {
	const g = sample();
	for (const row of ROWS) {
		describe(row.title, () => {
			it('setting on', () => {
				for (const [a, b] of row.pairs) checkPair(g, a, b, ON, row.on);
			});
			it('setting off', () => {
				for (const [a, b] of row.pairs) checkPair(g, a, b, OFF, row.off);
			});
			it('no options = setting on (the default)', () => {
				for (const [a, b] of row.pairs) checkPair(g, a, b, undefined, row.on);
			});
		});
	}

	it('the default options are the strict rule (on)', () => {
		expect(DEFAULT_RELATION_OPTIONS.oneParentUnknown).toBe(true);
	});

	it('the extra "Rumoured …" name comes only with cause "rumoured" (every pair, both settings)', () => {
		const ids = g.people.map((p) => p.id);
		let seen = 0;
		for (const [, options] of SETTINGS) {
			for (const me of ids) {
				const all = computeRelations(g, me, options);
				for (const [id, list] of all) {
					const m = list[0]?.maybe;
					if (!m) continue;
					seen++;
					const extra = `Rumoured ${m.lower}`;
					if (m.cause === 'rumoured') expect(texts(list), `${me} → ${id}`).toContain(extra);
					else expect(texts(list), `${me} → ${id}`).not.toContain(extra);
				}
			}
		}
		expect(seen).toBeGreaterThan(10);
	});
});

// ---------------------------------------------------------------------------------------------
// The finder (spec §13.2, the decision notes 0.2.5 ruling 8)

describe('D174 finder: the sentence and the step line agree', () => {
	const g = sample();
	for (const [label, options] of SETTINGS) {
		it(`Alice → Clara (setting ${label}): relation "half-sister" and one sibling step "half-sister"`, () => {
			const r = named(findRelation(g, 'p2', 'p4', options));
			expect(r.relations.map((x) => x.relation.lower)).toEqual(['half-sister']);
			expect(r.relations[0].relation.text).toBe('Half-sister');
			expect(r.relations[0].relation.maybe).toBeUndefined();
			expect(r.relations[0].steps).toEqual([{ person: 'p4', of: 'p2', word: 'half-sister' }]);
			expect(r.relations[0].steps[0].word).toBe(r.relations[0].relation.lower);
		});

		it(`Clara → Alice (setting ${label}): the same in the other direction`, () => {
			const r = named(findRelation(g, 'p4', 'p2', options));
			expect(r.relations.map((x) => x.relation.lower)).toEqual(['half-sister']);
			expect(r.relations[0].steps).toEqual([{ person: 'p2', of: 'p4', word: 'half-sister' }]);
		});

		it(`Alice → Beatrix (setting ${label}): "half-sister" then the rumoured line "rumoured sister"`, () => {
			const r = named(findRelation(g, 'p2', 'p3', options));
			expect(r.relations.map((x) => x.relation.lower)).toEqual(['half-sister', 'rumoured sister']);
			expect(r.relations.map((x) => x.steps.map((s) => s.word))).toEqual([['half-sister'], ['rumoured sister']]);
		});

		it(`every ordered pair (setting ${label}): the finder gives the names, kinds, distances and maybe of computeRelations`, () => {
			const ids = g.people.map((p) => p.id);
			for (const first of ids) {
				const all = computeRelations(g, first, options);
				for (const second of ids) {
					if (first === second) continue;
					const found = findRelation(g, first, second, options);
					const want = all.get(second);
					if (found.kind !== 'named') {
						expect(want === undefined || want.length === 0, `${first} → ${second}`).toBe(true);
						continue;
					}
					expect(
						found.relations.map((x) => [x.relation.text, x.relation.kind, x.relation.distance, x.relation.maybe]),
						`${first} → ${second}`,
					).toEqual(want!.map((x) => [x.text, x.kind, x.distance, x.maybe]));
				}
			}
		});
	}

	it('a sibling step of a half pair uses the sure test of the setting (Helen → Ingrid)', () => {
		expect(named(findRelation(g, 'p12', 'p13', ON)).relations[0].steps).toEqual([{ person: 'p13', of: 'p12', word: 'half-sister' }]);
		expect(named(findRelation(g, 'p12', 'p13', OFF)).relations[0].steps).toEqual([{ person: 'p13', of: 'p12', word: 'sister' }]);
	});
});

// ---------------------------------------------------------------------------------------------
// Beyond siblings: uncle, niece, cousin (spec §13.1 "Half": c1 and c2 are the children of X on the paths)

describe('D174 beside the direct line: half-uncle, half-niece, cousins', () => {
	const g = sample([
		'  - {id: q1, name: Nina, sex: f, parents: [p12]}',
		'  - {id: q2, name: Olive, sex: f, parents: [p13]}',
		'  - {id: q3, name: Ivan, sex: m, parents: [p1]}',
		'  - {id: q4, name: Ada, sex: f, parents: [p2]}',
		'  - {id: q5, name: Ella, sex: f, parents: [p8]}',
		'  - {id: q6, name: Fay, sex: f, parents: [p9]}',
	]);
	const one = (me: string, other: string, options: RelationOptions, want: Want) => {
		const list = rels(g, me, other, options);
		expect(texts(list), `${me} → ${other}`).toEqual(want.names);
		expect(list[0]?.maybe, `${me} → ${other}`).toEqual(want.maybe);
	};

	it('half-uncle: Nina (Helen\'s daughter) → Ivan (lists only Mary)', () => {
		one('Nina', 'Ivan', ON, { names: ['Half-uncle'], maybe: maybe('full', 'Uncle', 'unlisted', 'same-person') });
		one('Nina', 'Ivan', OFF, { names: ['Uncle'] });
	});

	it('half-niece: Ingrid → Nina', () => {
		one('Ingrid', 'Nina', ON, { names: ['Half-niece'], maybe: maybe('full', 'Niece', 'unlisted', 'same-person') });
		one('Ingrid', 'Nina', OFF, { names: ['Niece'] });
	});

	it('half first cousin: Nina and Olive (their mothers list only Mary)', () => {
		for (const [me, other] of [
			['Nina', 'Olive'],
			['Olive', 'Nina'],
		]) {
			one(me, other, ON, { names: ['Half first cousin'], maybe: maybe('full', 'First cousin', 'unlisted', 'same-person') });
			one(me, other, OFF, { names: ['First cousin'] });
		}
	});

	it('Ada (Alice\'s daughter) and Beatrix: Half-aunt / Half-niece, maybe full, with the rumoured line', () => {
		for (const [, options] of SETTINGS) {
			one('Ada', 'Beatrix', options, { names: ['Half-aunt', 'Rumoured aunt'], maybe: maybe('full', 'Aunt', 'rumoured') });
			one('Beatrix', 'Ada', options, { names: ['Half-niece', 'Rumoured niece'], maybe: maybe('full', 'Niece', 'rumoured') });
		}
	});

	it('Ella (Eleanor\'s daughter) and Fay (Fiona\'s daughter): First cousin, maybe half', () => {
		for (const [, options] of SETTINGS) {
			one('Ella', 'Fay', options, { names: ['First cousin', 'Rumoured half first cousin'], maybe: maybe('half', 'Half first cousin', 'rumoured') });
			one('Fay', 'Ella', options, { names: ['First cousin', 'Rumoured half first cousin'], maybe: maybe('half', 'Half first cousin', 'rumoured') });
			one('Ella', 'Fiona', options, { names: ['Aunt', 'Rumoured half-aunt'], maybe: maybe('half', 'Half-aunt', 'rumoured') });
		}
	});
});

// ---------------------------------------------------------------------------------------------
// The invariants at the end of the case table

describe('D174 invariant 1: no rumoured link, setting off = the rule of 0.2.4', () => {
	it('two children who each list only X are full siblings with the setting off, and their children first cousins', () => {
		const h = tree(['x m', 's1 f x', 's2 m x', 'k1 m s1', 'k2 f s2']);
		expect(texts(computeRelations(h, 's1', OFF).get('s2')!)).toEqual(['Brother']);
		expect(texts(computeRelations(h, 'k1', OFF).get('k2')!)).toEqual(['First cousin']);
		expect(computeRelations(h, 's1', OFF).get('s2')![0].maybe).toBeUndefined();
	});

	it('with the setting off and no rumoured link, no relation has a maybe (fixtures 1, 2, 3, 11, 15)', () => {
		for (const id of ['01', '02', '03', '11', '15']) {
			const g = build(fixture(id)).g;
			for (const p of g.people) for (const [other, list] of computeRelations(g, p.id, OFF)) for (const r of list) expect(r.maybe, `${id}: ${p.id} → ${other}`).toBeUndefined();
		}
	});

	it('no rumoured link and every child lists two parents: the two settings give the same names, and no maybe (fixtures 1, 2, 3, 11)', () => {
		for (const id of ['01', '02', '03', '11']) {
			const g = build(fixture(id)).g;
			for (const p of g.people) {
				const on = computeRelations(g, p.id, ON);
				const off = computeRelations(g, p.id, OFF);
				expect([...on.keys()], `${id}: ${p.id}`).toEqual([...off.keys()]);
				for (const [other, list] of on) {
					expect(list.map((r) => [r.text, r.kind, r.distance, r.maybe]), `${id}: ${p.id} → ${other}`).toEqual(off.get(other)!.map((r) => [r.text, r.kind, r.distance, undefined]));
				}
			}
		}
	});

	it('fixture 3 keeps its names in both settings (Conrad marked)', () => {
		const g = build(fixture('03')).g;
		for (const [, options] of SETTINGS) {
			const n = computeRelations(g, 'conrad', options);
			expect(n.get('giselle')!.map((r) => r.lower)).toEqual(['aunt', 'mother-in-law']);
			expect(n.get('lisette')!.map((r) => r.lower)).toEqual(['wife', 'first cousin']);
			expect(n.get('ulric')!.map((r) => r.lower)).toEqual(['first cousin', 'brother-in-law']);
			expect(n.get('blanche')!.map((r) => r.lower)).toEqual(['sister', 'wife’s first cousin']);
		}
	});

	it('fixture 15: Beatrix\'s four daughters list only her: sisters with the setting off, half-sisters with it on', () => {
		const g = build(fixture('15')).g;
		expect(computeRelations(g, 'alys', OFF).get('blanche')!.map((r) => r.lower)).toEqual(['sister']);
		const on = computeRelations(g, 'alys', ON).get('blanche')!;
		expect(on.map((r) => r.lower)).toEqual(['half-sister']);
		expect(on[0].maybe).toEqual(maybe('full', 'Sister', 'unlisted', 'same-person'));
	});
});

describe('D174 invariant 2: adoptive and ward links never make a child incomplete', () => {
	const h = tree(['x m', 'y f', 'a1 m x:adoptive', 'a2 m x:adoptive', 'b m x', 'c m x y', 'a3 m x:adoptive', 'd m x y:ward', 'e m x']);

	it('two children who each have one adoptive parent X: Adoptive brother, no maybe, in both settings', () => {
		for (const [, options] of SETTINGS) {
			const list = computeRelations(h, 'a1', options).get('a2')!;
			expect(texts(list)).toEqual(['Adoptive brother']);
			expect(list[0].maybe).toBeUndefined();
		}
	});

	it('a birth child with one listed parent and an adopted child of the same parent: half with the setting on (the birth child is incomplete), full with it off; never a maybe', () => {
		const on = computeRelations(h, 'b', ON).get('a1')!;
		expect(texts(on)).toEqual(['Adoptive half-brother']);
		expect(on[0].maybe).toBeUndefined();
		const off = computeRelations(h, 'b', OFF).get('a1')!;
		expect(texts(off)).toEqual(['Adoptive brother']);
		expect(off[0].maybe).toBeUndefined();
	});

	it('no maybe when the link of c1 or c2 to X is adoptive, though the two sets together are two people (spec fix of 2026-10-06)', () => {
		for (const [, options] of SETTINGS) {
			for (const [me, other] of [
				['c', 'a3'],
				['a3', 'c'],
			]) {
				const list = computeRelations(h, me, options).get(other)!;
				expect(texts(list)).toEqual(['Adoptive half-brother']);
				for (const r of list) expect(r.maybe).toBeUndefined();
			}
		}
	});

	it('a ward parent does not count as a second birth parent', () => {
		// d lists x (birth) and y (ward); e lists only x.
		const on = computeRelations(h, 'd', ON).get('e')!;
		expect(texts(on)).toEqual(['Half-brother']);
		expect(on[0].maybe).toEqual(maybe('full', 'Brother', 'unlisted', 'same-person'));
		expect(texts(computeRelations(h, 'd', OFF).get('e')!)).toEqual(['Brother']);
	});
});

describe('D174 invariant 3: cousins through two brothers who list only their father', () => {
	const h = tree(['x m', 'b1 m x', 'b2 m x', 'k1 m b1', 'k2 f b2']);

	it('setting on: the brothers are Half-brother, maybe full; their children Half first cousin, maybe full (cause unlisted)', () => {
		const brothers = computeRelations(h, 'b1', ON).get('b2')!;
		expect(texts(brothers)).toEqual(['Half-brother']);
		expect(brothers[0].maybe).toEqual(maybe('full', 'Brother', 'unlisted', 'same-person'));
		for (const [me, other] of [
			['k1', 'k2'],
			['k2', 'k1'],
		]) {
			const list = computeRelations(h, me, ON).get(other)!;
			expect(texts(list)).toEqual(['Half first cousin']);
			expect(list[0].maybe).toEqual(maybe('full', 'First cousin', 'unlisted', 'same-person'));
		}
		expect(texts(computeRelations(h, 'k1', ON).get('b2')!)).toEqual(['Half-uncle']);
		expect(texts(computeRelations(h, 'b1', ON).get('k2')!)).toEqual(['Half-niece']);
	});

	it('setting off: Brother, First cousin, Uncle, Niece, with no maybe', () => {
		expect(texts(computeRelations(h, 'b1', OFF).get('b2')!)).toEqual(['Brother']);
		expect(texts(computeRelations(h, 'k1', OFF).get('k2')!)).toEqual(['First cousin']);
		expect(texts(computeRelations(h, 'k1', OFF).get('b2')!)).toEqual(['Uncle']);
		expect(texts(computeRelations(h, 'b1', OFF).get('k2')!)).toEqual(['Niece']);
		for (const me of ['b1', 'b2', 'k1', 'k2']) for (const [, list] of computeRelations(h, me, OFF)) for (const r of list) expect(r.maybe).toBeUndefined();
	});
});

describe('D174 invariant 4: a name by marriage, a double name and the direct line never get a maybe', () => {
	it('by marriage: Ingrid\'s husband is Helen\'s brother-in-law, with no maybe', () => {
		const g = sample(['  - {id: q7, name: Hal, sex: m}'], ['  - partners: [p13, q7]']);
		for (const [, options] of SETTINGS) {
			const list = rels(g, 'Helen', 'Hal', options);
			expect(list[0].text).toBe('Brother-in-law');
			expect(list[0].kind).toBe('by-marriage');
			for (const r of list) expect(r.maybe).toBeUndefined();
		}
	});

	it('the direct line: mother, daughter, rumoured father; no maybe', () => {
		const g = sample();
		for (const [, options] of SETTINGS) {
			for (const [me, other, text] of [
				['Helen', 'Mary', 'Mother'],
				['Mary', 'Helen', 'Daughter'],
				['Eleanor', 'Yannick', 'Rumoured father'],
				['Alice', 'Mary', 'Mother'],
			]) {
				const list = rels(g, me, other, options);
				expect(list[0].text, `${me} → ${other}`).toBe(text);
				for (const r of list) expect(r.maybe, `${me} → ${other}`).toBeUndefined();
			}
		}
	});

	it('a double first cousin whose father alone has a rumoured parent: no maybe half', () => {
		const rows = ['g1 m', 'g2 f', 'g3 f', 'g4 m', 'Z m', 'f1 m g1 g2 Z:rumoured', 'f2 m g1 g2', 'm1 f g3 g4', 'm2 f g3 g4', 'E m f1 m1', 'P m f2 m2'];
		for (const order of [rows, [...rows].reverse()]) {
			for (const [, options] of SETTINGS) {
				const list = computeRelations(tree(order), 'E', options).get('P')!;
				expect(list[0].text).toBe('Double first cousin');
				for (const r of list) expect(r.maybe).toBeUndefined();
			}
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Other link shapes

describe('D174 other shapes: three parents, an unknown parent type, a rumoured parent that repeats a parent', () => {
	const g = sample([
		'  - {id: q8, name: Kim, sex: f, parents: [p7, p1, p10]}',
		'  - {id: q9, name: Lia, sex: f, parents: [p10, p1, p7]}',
		'  - {id: q10, name: Uma, sex: f, parents: [p7, {id: p1, type: godparent}]}',
		'  - {id: q11, name: Vic, sex: f, parents: [{id: p1, type: godparent}]}',
		'  - {id: q12, name: Lena, sex: f, parents: [p7, p1, {id: p7, type: rumoured}]}',
		'  - {id: q13, name: Kate, sex: f, parents: [p1, {id: p1, type: rumoured}]}',
	]);

	it('a child with three birth parents: full only with the same three', () => {
		for (const [, options] of SETTINGS) {
			checkPair(g, 'Kim', 'Lia', options, { names: ['Sister'] });
			checkPair(g, 'Kim', 'Fiona', options, { names: ['Half-sister'] });
			// Eleanor's rumoured Yannick is Kim's birth parent: the second test gives equal sets.
			checkPair(g, 'Kim', 'Eleanor', options, { names: ['Half-sister', 'Rumoured sister'], maybe: maybe('full', 'Sister', 'rumoured') });
		}
		// Kim and Helen: three people in the two sets, so no maybe with either setting.
		checkPair(g, 'Kim', 'Helen', ON, { names: ['Half-sister'] });
		checkPair(g, 'Kim', 'Helen', OFF, { names: ['Half-sister'] });
	});

	it('an unknown parent type counts as birth (spec §8)', () => {
		for (const [, options] of SETTINGS) checkPair(g, 'Uma', 'Fiona', options, { names: ['Sister'] });
		checkPair(g, 'Vic', 'Helen', ON, { names: ['Half-sister'], maybe: maybe('full', 'Sister', 'unlisted', 'same-person') });
		checkPair(g, 'Vic', 'Helen', OFF, { names: ['Sister'] });
	});

	it('a rumoured parent who is also a birth parent of a child with two parents: Sister, no maybe', () => {
		for (const [, options] of SETTINGS) {
			for (const [me, other] of [
				['Lena', 'Fiona'],
				['Fiona', 'Lena'],
			]) {
				const list = rels(g, me, other, options);
				expect(list[0].text, `${me} → ${other}`).toBe('Sister');
				for (const r of list) expect(r.maybe, `${me} → ${other}: ${r.text}`).toBeUndefined();
				expect(texts(list)).not.toContain('Rumoured half-sister');
			}
		}
	});

	it('a rumoured parent who is also the one birth parent, setting on: Half-sister, maybe full', () => {
		// Kate lists Mary as a birth parent and as a rumoured parent. With the setting on she is incomplete.
		// The cause with the setting on is not tested (the spec leaves it open).
		const list = rels(g, 'Kate', 'Helen', ON);
		expect(list[0].text).toBe('Half-sister');
		expect(list[0].maybe?.effect).toBe('full');
		expect(list[0].maybe?.text).toBe('Sister');
	});

	it('a rumoured parent who is also in the sure set does not make the child incomplete: setting off, Kate and Helen are sisters', () => {
		// Spec §13.1 "Half" (supervisor answer of 2026-10-06): Mary is in Kate's sure set, so her rumoured link to Mary does not count.
		for (const [me, other] of [
			['Kate', 'Helen'],
			['Helen', 'Kate'],
		]) {
			const list = rels(g, me, other, OFF);
			expect(list[0].text, `${me} → ${other}`).toBe('Sister');
			for (const r of list) expect(r.maybe, `${me} → ${other}: ${r.text}`).toBeUndefined();
		}
	});
});

describe('D174 rule 1: a rumoured line takes half or full from the second test', () => {
	// Two children of only a rumoured Harold.
	const h = tree(['harold m', 'w1 m harold:rumoured', 'w2 m harold:rumoured', 'una f', 'leo m harold una']);

	it('setting on: Rumoured half-brother (a set of one person is half in the second test), no maybe', () => {
		const list = computeRelations(h, 'w1', ON).get('w2')!;
		expect(texts(list)).toEqual(['Rumoured half-brother']);
		for (const r of list) expect(r.maybe).toBeUndefined();
		const r = named(findRelation(h, 'w1', 'w2', ON));
		expect(r.relations[0].steps.map((s) => s.word)).toEqual(['rumoured half-brother']);
	});

	it('setting off: Rumoured brother, no maybe', () => {
		const list = computeRelations(h, 'w1', OFF).get('w2')!;
		expect(texts(list)).toEqual(['Rumoured brother']);
		for (const r of list) expect(r.maybe).toBeUndefined();
		const r = named(findRelation(h, 'w1', 'w2', OFF));
		expect(r.relations[0].steps.map((s) => s.word)).toEqual(['rumoured brother']);
	});

	it('a rumoured child of Harold and a birth child of Harold and Una: Rumoured half-brother in both settings', () => {
		for (const [, options] of SETTINGS) expect(texts(computeRelations(h, 'leo', options).get('w1')!)).toEqual(['Rumoured half-brother']);
	});
});

describe('D174 rule 6: equal names merge; full beats half, then rumoured beats unlisted', () => {
	// P is a half first cousin of E through two routes. Route g1: f1 {g1, g2} and f2 {g1} with a rumoured g2:
	// maybe full, cause rumoured. Route g3: m1 {g3} and m2 {g3}: with the setting on, maybe full, cause unlisted.
	const rows = ['g1 m', 'g2 f', 'g3 f', 'f1 m g1 g2', 'f2 m g1 g2:rumoured', 'm1 f g3', 'm2 f g3', 'E m f1 m1', 'P m f2 m2'];
	for (const [label, order] of [
		['document order', rows],
		['reverse order', [...rows].reverse()],
	] as const) {
		it(`setting on, ${label}: one "half first cousin" with maybe full, cause rumoured`, () => {
			const list = computeRelations(tree([...order]), 'E', ON).get('P')!;
			const half = list.filter((r) => r.lower === 'half first cousin');
			expect(half).toHaveLength(1);
			expect(half[0].maybe).toEqual(maybe('full', 'First cousin', 'rumoured'));
			expect(texts(list)).toContain('Rumoured first cousin');
		});
	}

	it('different names keep their own maybe: "first cousin" (maybe half) and "half first cousin" (none)', () => {
		// Route g1 + g2: full, and Y (rumoured, on f1 only) makes it maybe half. Route g3: half, three people, no maybe.
		const h = tree(['g1 m', 'g2 f', 'Y m', 'g3 f', 'g4 m', 'g5 m', 'f1 m g1 g2 Y:rumoured', 'f2 m g1 g2', 'm1 f g3 g4', 'm2 f g3 g5', 'E m f1 m1', 'P m f2 m2']);
		for (const [, options] of SETTINGS) {
			const list = computeRelations(h, 'E', options).get('P')!;
			expect(list.find((r) => r.lower === 'first cousin')?.maybe).toEqual(maybe('half', 'Half first cousin', 'rumoured'));
			expect(list.find((r) => r.lower === 'half first cousin')?.maybe).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Options plumbing

describe('D174 options: the default, and the cache key', () => {
	const g = sample();

	it('computeRelations with no options equals the setting on', () => {
		for (const p of g.people) {
			const a = computeRelations(g, p.id);
			const b = computeRelations(g, p.id, ON);
			expect([...a].map(([id, list]) => [id, list.map((r) => [r.text, r.maybe])])).toEqual([...b].map(([id, list]) => [id, list.map((r) => [r.text, r.maybe])]));
		}
	});

	it('relationsKey: no options = on; on and off give different keys', () => {
		expect(relationsKey(g, 'p12')).toBe(relationsKey(g, 'p12', ON));
		expect(relationsKey(g, 'p12', OFF)).not.toBe(relationsKey(g, 'p12', ON));
		expect(relationsKey(g, 'p12', OFF)).toBe(relationsKey(g, 'p12', { oneParentUnknown: false }));
	});
});

// ---------------------------------------------------------------------------------------------
// Property: a rumoured link changes nothing outside the people below it

/** A small seeded generator. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

describe('D174 property: adding a rumoured link never changes a pair with no rumoured parent in its two ancestries', () => {
	it('200 random trees with no rumoured link, then one rumoured link; both settings', () => {
		const rand = rng(20261006);
		let compared = 0;
		for (let round = 0; round < 200; round++) {
			const n = 6 + Math.floor(rand() * 14);
			const parents: string[][] = [];
			const lines: string[] = [];
			for (let i = 0; i < n; i++) {
				const ps: string[] = [];
				if (i > 1 && rand() < 0.8) {
					const count = rand() < 0.3 ? 1 : rand() < 0.9 ? 2 : 3;
					while (ps.length < Math.min(count, i)) {
						const q = `p${Math.floor(rand() * i)}`;
						if (!ps.includes(q)) ps.push(q);
					}
				}
				parents.push(ps);
				const refs = ps.map((q) => (rand() < 0.1 ? `${q}:adoptive` : q));
				lines.push(`p${i} ${rand() < 0.5 ? 'm' : 'f'} ${refs.join(' ')}`.trim());
			}
			// The rumoured link: child c, rumoured parent r (an earlier person who is not a parent of c).
			const c = 2 + Math.floor(rand() * (n - 2));
			const free = Array.from({ length: c }, (_, k) => `p${k}`).filter((q) => !parents[c].includes(q));
			if (!free.length) continue;
			const r = free[Math.floor(rand() * free.length)];
			const before = tree(lines);
			const after = tree(lines.map((l, i) => (i === c ? `${l} ${r}:rumoured` : l)));
			// Ancestry (with the person) of each person in the tree before.
			const anc = (id: string, seen = new Set<string>()): Set<string> => {
				if (seen.has(id)) return seen;
				seen.add(id);
				for (const q of parents[Number(id.slice(1))]) anc(q, seen);
				return seen;
			};
			const clean = (id: string) => !anc(id).has(`p${c}`);
			for (const [, options] of SETTINGS) {
				for (let m = 0; m < n; m++) {
					if (!clean(`p${m}`)) continue;
					const a = computeRelations(before, `p${m}`, options);
					const b = computeRelations(after, `p${m}`, options);
					for (let p = 0; p < n; p++) {
						if (p === m || !clean(`p${p}`)) continue;
						const blood = (list: readonly Relation[] | undefined) => (list ?? []).filter((x) => x.kind === 'blood').map((x) => [x.text, x.distance, x.maybe]);
						expect(blood(b.get(`p${p}`)), `round ${round}, p${m} → p${p}, rumoured ${r} on p${c}\n${lines.join('\n')}`).toEqual(blood(a.get(`p${p}`)));
						compared++;
					}
				}
			}
		}
		expect(compared).toBeGreaterThan(5000);
	});
});

// ---------------------------------------------------------------------------------------------
// Card text: depends on the render change of the obsidian-engineer (", maybe half", the "unlisted" texts)

describe('card text (depends on the render change)', () => {
	const g = sample();

	it('Eleanor → Fiona: "Sister, maybe half"; spoken "sister, or half-sister if the rumoured links are true"', () => {
		const [first] = rels(g, 'Eleanor', 'Fiona', ON);
		expect(cardRelationText(first)).toBe('Sister, maybe half');
		expect(spokenRelation(first)).toBe('sister, or half-sister if the rumoured links are true');
		expect(relationSummary(rels(g, 'Eleanor', 'Fiona', ON), false).maybe).toBe('If every rumoured link is true, this person is your half-sister.');
	});

	it('Alice → Beatrix: "Half-sister, maybe full" in both settings', () => {
		for (const [, options] of SETTINGS) expect(cardRelationText(rels(g, 'Alice', 'Beatrix', options)[0])).toBe('Half-sister, maybe full');
	});

	it('Helen → Ingrid, setting on: "Half-sister, maybe full"; the texts for a parent who is not listed', () => {
		const list = rels(g, 'Helen', 'Ingrid', ON);
		expect(cardRelationText(list[0])).toBe('Half-sister, maybe full');
		expect(spokenRelation(list[0])).toBe('half-sister, or sister if the parent that the note does not name is the same person for both');
		const summary = relationSummary(list, false);
		expect(summary.maybe).toBe('If the parent that the note does not name is the same person for both, this person is your sister.');
		expect(summary.also).toBeUndefined();
	});

	it('Helen → Ingrid, setting off: "Sister"', () => {
		expect(cardRelationText(rels(g, 'Helen', 'Ingrid', OFF)[0])).toBe('Sister');
	});

	it('Fiona → Helen, setting on: "Half-sister, maybe full"; setting off: "Half-sister"', () => {
		expect(cardRelationText(rels(g, 'Fiona', 'Helen', ON)[0])).toBe('Half-sister, maybe full');
		expect(cardRelationText(rels(g, 'Fiona', 'Helen', OFF)[0])).toBe('Half-sister');
	});
});
