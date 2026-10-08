import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, FINDER_LIMIT, findRelation, lineSubgraph, relationsKey } from '../src/core/relations';
import type { FinderResult, Relation, RelationOptions, RelationStep } from '../src/core/relations';
import { fixture } from './helpers';

// Unit tests for src/core/relations.ts (spec §13.1, §13.2; the rules in the relations.ts header and
// the supervisor rulings of WP7.0 in the decision notes). tests/acceptance/relations*.test.ts covers
// sample tree 12; these tests cover each rule on small trees made for it.

function graph(yaml: string): FamilyGraph {
	const r = parseDynasty(yaml);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** A block from compact person lines ("id sex parents…") and union lines ("a b [type]"). */
function tree(people: string[], unions: string[] = []): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		out.push(`  - id: ${id}`, `    name: ${id}`);
		if (sex !== '-') out.push(`    sex: ${sex}`);
		if (parents.length) {
			const refs = parents.map((p) => {
				const [pid, type] = p.split(':');
				return type ? `{id: ${pid}, type: ${type}}` : pid;
			});
			out.push(`    parents: [${refs.join(', ')}]`);
		}
	}
	if (unions.length) out.push('unions:');
	for (const u of unions) {
		const [a, b, type] = u.split(' ');
		out.push(`  - partners: [${a}, ${b}]`);
		if (type) out.push(`    type: ${type}`);
	}
	return graph(out.join('\n') + '\n');
}

/** Every person's names for `me`, best first. */
function names(g: FamilyGraph, me: string, options?: RelationOptions): Record<string, string[]> {
	return Object.fromEntries([...computeRelations(g, me, options)].map(([id, rels]) => [id, rels.map((r) => r.lower)]));
}

const first = (g: FamilyGraph, me: string, id: string, options?: RelationOptions) => computeRelations(g, me, options).get(id)?.[0]?.lower;

/** D174: the setting "Assume an unknown second parent" off; the default (no options) is on. */
const OFF: RelationOptions = { oneParentUnknown: false };

const named = (r: FinderResult) => {
	if (r.kind !== 'named') throw new Error(`expected named, got ${r.kind}`);
	return r;
};
const step = (person: string, of: string, word: string): RelationStep => ({ person, of, word });

/** A couple r1 + r2 with two lines of single-parent descent, a1…aN and b1…bN. */
function twoLines(n: number, sexA = 'm', sexB = 'm'): FamilyGraph {
	const people = ['r1 m', 'r2 f'];
	for (const [side, sex] of [['a', sexA], ['b', sexB]]) {
		for (let k = 1; k <= n; k++) people.push(`${side}${k} ${sex} ${k === 1 ? 'r1 r2' : `${side}${k - 1}`}`);
	}
	return tree(people, ['r1 r2']);
}

describe('computeRelations basics', () => {
	it('gives the marked person "You" and nothing for an id that names nobody', () => {
		const g = tree(['a m', 'b f a']);
		const rels = computeRelations(g, 'a');
		expect(rels.get('a')).toEqual([{ text: 'You', lower: 'you', kind: 'self', distance: 0, line: { people: ['a'], links: [], unions: [] } }]);
		expect(computeRelations(g, 'ghost').size).toBe(0);
	});

	it('leaves out a person with no relation', () => {
		const g = tree(['a m', 'b f', 'c m a']);
		expect(Object.keys(names(g, 'a')).sort()).toEqual(['a', 'c']);
	});

	it('returns frozen relations with frozen lines', () => {
		const g = tree(['a m', 'b f a']);
		const [rel] = computeRelations(g, 'a').get('b')!;
		expect(Object.isFrozen(computeRelations(g, 'a').get('b'))).toBe(true);
		expect(Object.isFrozen(rel)).toBe(true);
		expect(Object.isFrozen(rel.line)).toBe(true);
		expect(Object.isFrozen(rel.line.people)).toBe(true);
		expect(rel.line).toBe(rel.line);
		expect(rel).toMatchObject({ text: 'Daughter', lower: 'daughter', kind: 'blood', distance: 1 });
	});

	it('returns a map that no view can change (M7 code check ruling)', () => {
		const g = tree(['a m', 'b f a']);
		const rels = computeRelations(g, 'a') as Map<string, readonly Relation[]>;
		expect(() => rels.set('c', [])).toThrow(TypeError);
		expect(() => rels.delete('b')).toThrow(TypeError);
		expect(() => rels.clear()).toThrow(TypeError);
		expect([...rels.keys()]).toEqual(['a', 'b']);
		expect(() => (computeRelations(g, 'ghost') as Map<string, readonly Relation[]>).set('a', [])).toThrow(TypeError);
	});

	it('ends on a parent cycle (fixture 5) and names the people around it', () => {
		const g = graph(fixture('05'));
		for (const p of g.people) expect(() => computeRelations(g, p.id)).not.toThrow();
		expect(computeRelations(g, 'arn').size).toBeGreaterThan(1);
	});
});

describe('the §13.1 table: direct line, siblings, uncles, nephews, cousins', () => {
	const g = twoLines(25);

	it('descendants: son, grandson, great-, great-great-, 3rd great-, 21st great-', () => {
		const n = names(g, 'a1');
		expect(n.a2).toEqual(['son']);
		expect(n.a3).toEqual(['grandson']);
		expect(n.a4).toEqual(['great-grandson']);
		expect(n.a5).toEqual(['great-great-grandson']);
		expect(n.a6).toEqual(['3rd great-grandson']);
		expect(n.a7).toEqual(['4th great-grandson']);
		expect(n.a14).toEqual(['11th great-grandson']);
		expect(n.a24).toEqual(['21st great-grandson']);
		expect(n.a25).toEqual(['22nd great-grandson']);
	});

	it('ancestors: father, grandfather, great-grandfather, 3rd great-grandfather at a = 5', () => {
		const n = names(g, 'a6');
		expect(n.a5).toEqual(['father']);
		expect(n.a4).toEqual(['grandfather']);
		expect(n.a3).toEqual(['great-grandfather']);
		expect(n.a1).toEqual(['3rd great-grandfather']);
		expect(n.r2).toEqual(['4th great-grandmother']);
	});

	it('siblings, uncles and nephews with "great"', () => {
		expect(first(g, 'a1', 'b1')).toBe('brother');
		expect(first(g, 'a2', 'b1')).toBe('uncle');
		expect(first(g, 'a3', 'b1')).toBe('great-uncle');
		expect(first(g, 'a4', 'b1')).toBe('great-great-uncle');
		expect(first(g, 'a5', 'b1')).toBe('3rd great-uncle');
		expect(first(g, 'a1', 'b2')).toBe('nephew');
		expect(first(g, 'a1', 'b3')).toBe('great-nephew');
		expect(first(g, 'a1', 'b5')).toBe('3rd great-nephew');
	});

	it('cousins: degree min(a, b) − 1 in words to tenth, then 11th; removal once, twice, then N times', () => {
		expect(first(g, 'a2', 'b2')).toBe('first cousin');
		expect(first(g, 'a3', 'b4')).toBe('second cousin once removed');
		expect(first(g, 'a4', 'b2')).toBe('first cousin twice removed');
		expect(first(g, 'a2', 'b5')).toBe('first cousin 3 times removed');
		expect(first(g, 'a11', 'b11')).toBe('tenth cousin');
		expect(first(g, 'a12', 'b12')).toBe('11th cousin');
		expect(first(g, 'a13', 'b17')).toBe('12th cousin 4 times removed');
		expect(first(g, 'a22', 'b22')).toBe('21st cousin');
	});

	it('distance is a + b; the card text has a capital first letter', () => {
		const [rel] = computeRelations(g, 'a3').get('b4')!;
		expect(rel).toMatchObject({ text: 'Second cousin once removed', kind: 'blood', distance: 7 });
	});
});

describe('words for each sex (D12)', () => {
	it('female words', () => {
		const g = twoLines(4, 'f', 'f');
		expect(first(g, 'a2', 'a1')).toBe('mother');
		expect(first(g, 'a1', 'a2')).toBe('daughter');
		expect(first(g, 'a1', 'b1')).toBe('sister');
		expect(first(g, 'a3', 'b1')).toBe('great-aunt');
		expect(first(g, 'a1', 'b3')).toBe('great-niece');
		expect(first(g, 'a1', 'a3')).toBe('granddaughter');
		expect(first(g, 'a4', 'a1')).toBe('great-grandmother');
	});

	it('any value other than m or f, or none, gives the neutral word; the neutral forms carry "great" on the inner word', () => {
		for (const sex of ['x', 'M', '-']) {
			const g = twoLines(5, sex, sex);
			expect(first(g, 'a2', 'a1')).toBe('parent');
			expect(first(g, 'a1', 'a2')).toBe('child');
			expect(first(g, 'a1', 'b1')).toBe('sibling');
			expect(first(g, 'a1', 'a3')).toBe('grandchild');
			expect(first(g, 'a3', 'a1')).toBe('grandparent');
			expect(first(g, 'a2', 'b1')).toBe("parent’s sibling");
			expect(first(g, 'a3', 'b1')).toBe("grandparent’s sibling");
			expect(first(g, 'a4', 'b1')).toBe("great-grandparent’s sibling");
			expect(first(g, 'a1', 'b2')).toBe("sibling’s child");
			expect(first(g, 'a1', 'b3')).toBe("sibling’s grandchild");
			expect(first(g, 'a1', 'b4')).toBe("sibling’s great-grandchild");
			expect(first(g, 'a2', 'b2')).toBe('first cousin');
		}
	});

	it('changing sex changes only the words', () => {
		const one = computeRelations(twoLines(3, 'x', 'x'), 'a2').get('b1')!;
		const two = computeRelations(twoLines(3, 'x', 'm'), 'a2').get('b1')!;
		expect(one.map((r) => r.lower)).toEqual(["parent’s sibling"]);
		expect(two.map((r) => r.lower)).toEqual(['uncle']);
		expect(one[0].line).toEqual(two[0].line);
		expect(one[0].distance).toBe(two[0].distance);
	});
});

describe('half relations (§13.1 half rule, D45, ruling 3)', () => {
	// x had m1 with w1 and h1 with w2; me is m1's daughter, kid is me's son.
	const people = ['x m', 'w1 f', 'w2 f', 'm1 m x w1', 'h1 m x w2', 'me f m1', 'hc f h1', 'hn m h1', 'kid m me', 'nh - x w2', 'nhc - nh'];
	const g = tree(people, ['x w1', 'x w2']);

	it('half-brother, half-uncle, half-niece, half-nephew, half first cousin, half-great-uncle', () => {
		expect(first(g, 'm1', 'h1')).toBe('half-brother');
		expect(first(g, 'me', 'h1')).toBe('half-uncle');
		expect(first(g, 'm1', 'hc')).toBe('half-niece');
		expect(first(g, 'm1', 'hn')).toBe('half-nephew');
		expect(first(g, 'me', 'hc')).toBe('half first cousin');
		expect(first(g, 'kid', 'h1')).toBe('half-great-uncle');
	});

	it('the neutral forms put "half" on the inner word', () => {
		expect(first(g, 'm1', 'nh')).toBe('half-sibling');
		expect(first(g, 'me', 'nh')).toBe("parent’s half-sibling");
		expect(first(g, 'kid', 'nh')).toBe("grandparent’s half-sibling");
		expect(first(g, 'm1', 'nhc')).toBe("half-sibling’s child");
	});

	it('the direct line is never half', () => {
		expect(first(g, 'kid', 'x')).toBe('great-grandfather');
		expect(first(g, 'x', 'kid')).toBe('great-grandson');
	});

	it('two children who each list only X are full siblings with the setting off, half with it on (D174)', () => {
		const h = tree(['x m', 's1 f x', 's2 m x', 'k1 m s1', 'k2 f s2']);
		expect(first(h, 's1', 's2', OFF)).toBe('brother');
		expect(first(h, 'k1', 'k2', OFF)).toBe('first cousin');
		expect(first(h, 's1', 's2')).toBe('half-brother');
		expect(first(h, 'k1', 'k2')).toBe('half first cousin');
	});

	it('the link type does not make a relation half: adoptive parents who are the birth parents give a full relation', () => {
		const h = tree(['f m', 'm f', 'r m f m', 't m f:adoptive m:adoptive', 'w f f'], ['f m']);
		expect(first(h, 'r', 't')).toBe('adoptive brother');
		expect(first(h, 'w', 't')).toBe('adoptive half-brother');
		expect(first(h, 'r', 'w')).toBe('half-sister');
	});
});

describe('double relations', () => {
	// Brothers b1, b2 (of p1 + q1) married sisters s1, s2 (of p2 + q2).
	const g = tree(
		['p1 m', 'q1 f', 'p2 m', 'q2 f', 'b1 m p1 q1', 'b2 m p1 q1', 's1 f p2 q2', 's2 f p2 q2', 'c1 m b1 s1', 'c2 f b2 s2', 'c2k m c2'],
		['p1 q1', 'p2 q2', 'b1 s1', 'b2 s2'],
	);

	it('the same cousin name from two couples is one "double" name', () => {
		expect(names(g, 'c1').c2).toEqual(['double first cousin']);
		expect(names(g, 'c1').c2k).toEqual(['double first cousin once removed']);
	});

	it('the double relation shows the line of the first couple in document order', () => {
		const [rel] = computeRelations(g, 'c1').get('c2')!;
		expect(rel.line).toEqual({
			people: ['c1', 'b1', 'p1', 'q1', 'b2', 'c2'],
			links: [
				{ parent: 'b1', child: 'c1', type: 'birth' },
				{ parent: 'p1', child: 'b1', type: 'birth' },
				{ parent: 'q1', child: 'b2', type: 'birth' },
				{ parent: 'b2', child: 'c2', type: 'birth' },
			],
			unions: ['u0'],
		});
	});

	it('the other names are listed once', () => {
		// b1 is c1's father and b2 is c1's uncle through both couples: one "uncle".
		expect(names(g, 'c1').b2).toEqual(['uncle']);
	});
});

describe('adoptive, rumoured and ward links (D44)', () => {
	const g = tree(
		['gp m', 'x m gp', 'w f', 'm1 m x w', 'ad m x:adoptive w:adoptive', 'adk f ad', 'ru f x:rumoured', 'ar m ad:rumoured', 'wd m x:ward', 'wdc f wd'],
		['x w'],
	);

	it('an adoptive link adds "adoptive"; for a descendant of the marked person "adopted"', () => {
		expect(first(g, 'x', 'ad')).toBe('adopted son');
		expect(first(g, 'x', 'adk')).toBe('adopted granddaughter');
		expect(first(g, 'gp', 'ad')).toBe('adopted grandson');
		expect(first(g, 'ad', 'x')).toBe('adoptive father');
		expect(first(g, 'ad', 'gp')).toBe('adoptive grandfather');
		expect(first(g, 'm1', 'ad')).toBe('adoptive brother');
		expect(first(g, 'm1', 'adk')).toBe('adoptive niece');
	});

	it('a rumoured link adds "rumoured"; with an adoptive link too, only "rumoured"', () => {
		expect(first(g, 'x', 'ru')).toBe('rumoured daughter');
		expect(first(g, 'ru', 'x')).toBe('rumoured father');
		expect(first(g, 'm1', 'ru')).toBe('rumoured half-sister');
		expect(first(g, 'x', 'ar')).toBe('rumoured grandson');
	});

	it('a ward link makes only "guardian" and "ward", and relations do not continue through it', () => {
		expect(names(g, 'x').wd).toEqual(['ward']);
		expect(names(g, 'wd').x).toEqual(['guardian']);
		expect(names(g, 'x').wdc).toBeUndefined();
		expect(names(g, 'wd').m1).toBeUndefined();
		expect(names(g, 'wd').gp).toBeUndefined();
		const [rel] = computeRelations(g, 'wd').get('x')!;
		expect(rel).toMatchObject({ kind: 'guardian', distance: 1, text: 'Guardian' });
		expect(rel.line).toEqual({ people: ['wd', 'x'], links: [{ parent: 'x', child: 'wd', type: 'ward' }], unions: [] });
	});
});

describe('partners (§13.1 partner table)', () => {
	it('husband, wife and spouse from the last-listed union; betrothed, partner in concubinage, lover, co-parent', () => {
		const g = tree(
			['me f', 'h m', 'n -', 'b m', 'c m', 'l m', 'cp m', 'kid m me cp', 'u m'],
			['me h betrothal', 'me h', 'me n', 'me b betrothal', 'me c concubinage', 'me l affair', 'me u handfasting'],
		);
		const n = names(g, 'me');
		expect(n.h).toEqual(['husband']);
		expect(n.n).toEqual(['spouse']);
		expect(n.b).toEqual(['betrothed']);
		expect(n.c).toEqual(['partner in concubinage']);
		expect(n.l).toEqual(['lover']);
		expect(n.cp).toEqual(['co-parent']);
		expect(n.u).toEqual(['husband']);
		expect(names(g, 'h').me).toEqual(['wife']);
		expect(computeRelations(g, 'me').get('h')![0].line).toEqual({ people: ['me', 'h'], links: [], unions: ['u1'] });
		expect(computeRelations(g, 'me').get('cp')![0].line).toEqual({ people: ['me', 'cp'], links: [], unions: ['i:["cp","me"]'] });
	});

	it('the partner name wins over a smaller blood distance (D46)', () => {
		const g = graph(fixture('11'));
		expect(names(g, 'alys').corwin).toEqual(['husband', 'father']);
		expect(names(g, 'alys').osric).toEqual(['son', 'half-brother']);
	});
});

describe('relations by marriage (§13.1 rules 1–4, D43)', () => {
	const g = tree(
		[
			'ggf m',
			'ggw f',
			'gf m ggf',
			'gm f',
			'sgm f',
			'dad m gf gm',
			'mom f',
			'stepmom f',
			'aunt f gf gm',
			'auntH m',
			'wgf m',
			'wf m wgf',
			'wm f',
			'waunt f wgf',
			'wcousin m waunt',
			'me m dad mom',
			'sis f dad mom',
			'sisHf m',
			'sisH m sisHf',
			'hsis f dad',
			'hsisH m',
			'wife f wf wm',
			'wbro m wf wm',
			'ex m',
			'wstep f wife ex',
			'wstepk m wstep',
			'kid m me wife',
			'kidW f',
			'gkid f kid kidW',
			'gkidH m',
			'ggkid m gkid',
			'ggkidW f',
			'cousin m aunt auntH',
			'cousinW f',
			'other m',
			'stepsib f stepmom other',
			'bet f',
		],
		[
			'ggf ggw',
			'gf gm',
			'gf sgm',
			'dad mom',
			'dad stepmom',
			'aunt auntH',
			'wf wm',
			'sis sisH',
			'hsis hsisH',
			'me wife',
			'wife ex',
			'kid kidW',
			'gkid gkidH',
			'ggkid ggkidW',
			'cousin cousinW',
			'stepmom other',
			'wbro bet betrothal',
		],
	);
	const n = names(g, 'me');

	it('rule 1: step-parent, step-grandparent, sibling-in-law, child-in-law, grandchild-in-law', () => {
		expect(n.stepmom).toEqual(['stepmother']);
		expect(n.sgm).toEqual(['step-grandmother']);
		expect(n.sisH).toEqual(['brother-in-law']);
		expect(n.kidW).toEqual(['daughter-in-law']);
		expect(n.gkidH).toEqual(['grandson-in-law']);
	});

	it('rule 1: uncle, cousin by marriage; any other relation: "great-grandson\’s wife", "great-grandfather\’s wife"', () => {
		expect(n.auntH).toEqual(['uncle by marriage']);
		expect(n.cousinW).toEqual(['first cousin by marriage']);
		expect(n.ggkidW).toEqual(["great-grandson’s wife"]);
		expect(n.ggw).toEqual(["great-grandfather’s wife"]);
	});

	it('the named forms leave out "half": the husband of a half-sister is a brother-in-law', () => {
		expect(n.hsis).toEqual(['half-sister']);
		expect(n.hsisH).toEqual(['brother-in-law']);
	});

	it('rule 2: parent-in-law, grandparent-in-law, sibling-in-law, stepchild, step-grandchild, "wife\’s …"', () => {
		expect(n.wf).toEqual(['father-in-law']);
		expect(n.wm).toEqual(['mother-in-law']);
		expect(n.wgf).toEqual(['grandfather-in-law']);
		expect(n.wbro).toEqual(['brother-in-law']);
		expect(n.wstep).toEqual(['stepdaughter']);
		expect(n.wstepk).toEqual(['step-grandson']);
		// D174 (setting on): wf and waunt list only wgf, so they are half; the "’s" form keeps "half".
		expect(n.waunt).toEqual(["wife’s half-aunt"]);
		expect(n.wcousin).toEqual(["wife’s half first cousin"]);
		expect(names(g, 'me', OFF).waunt).toEqual(["wife’s aunt"]);
		expect(names(g, 'me', OFF).wcousin).toEqual(["wife’s first cousin"]);
	});

	it('rule 2: a child of the spouse who is also the marked person\'s child is only a child', () => {
		expect(n.kid).toEqual(['son']);
		expect(n.gkid).toEqual(['granddaughter']);
	});

	it('rule 2: a relation to the spouse that runs through the marked person gives no name by marriage', () => {
		// me married his sister s; p is his son by c, so p is also s's nephew through me.
		const h = tree(['x m', 'y f', 'me m x y', 's f x y', 'c f', 'p m me c'], ['x y', 'me s', 'me c']);
		expect(names(h, 'me').p).toEqual(['son']);
		expect(names(h, 'me').s).toEqual(['wife', 'sister']);
	});

	it('rule 3: a step-sibling shares no parent', () => {
		expect(n.stepsib).toEqual(['stepsister']);
		const [rel] = computeRelations(g, 'me').get('stepsib')!;
		expect(rel).toMatchObject({ kind: 'step-sibling', distance: 3 });
	});

	it('rule 4: through two marriages there is no name; a betrothal is not a marriage', () => {
		expect(n.sisHf).toBeUndefined();
		expect(n.other).toBeUndefined();
		expect(n.ex).toBeUndefined();
		expect(n.bet).toBeUndefined();
	});

	it('distance is 1 + the blood distance (2 for a parent-in-law or a step-parent)', () => {
		const rels = computeRelations(g, 'me');
		expect(rels.get('wf')![0]).toMatchObject({ kind: 'by-marriage', distance: 2 });
		expect(rels.get('stepmom')![0]).toMatchObject({ kind: 'by-marriage', distance: 2 });
		expect(rels.get('wcousin')![0]).toMatchObject({ kind: 'by-marriage', distance: 5 });
	});

	it('the "\’s" form follows the spouse\'s sex and keeps half; the named forms leave it out', () => {
		// s is a grandchild of x through c (x + y); hb is x's son with z: the half-uncle of s.
		const h = tree(['me m', 'x m', 'y f', 'z f', 'c m x y', 's - c', 'hb m x z', 'hs f x z'], ['me s', 'x y', 'x z']);
		expect(names(h, 'me').hb).toEqual(["spouse’s half-uncle"]);
		const w = tree(['me f', 'x m', 'y f', 'z f', 'c m x y', 's m c', 'hb m x z'], ['me s', 'x y', 'x z']);
		expect(names(w, 'me').hb).toEqual(["husband’s half-uncle"]);
		// A half-brother of the spouse is a brother-in-law.
		const b = tree(['me f', 'x m', 'y f', 'z f', 's m x y', 'hb m x z'], ['me s', 'x y', 'x z']);
		expect(names(b, 'me').hb).toEqual(['brother-in-law']);
	});

	it('neutral and "great" forms by marriage (ruling 2)', () => {
		const h = tree(['gg m', 'g m gg', 'gu m gg', 'guW -', 'p m g', 'me f p', 'ne m me', 'neW f', 'gn m ne', 'gnW f'], ['gu guW', 'ne neW', 'gn gnW']);
		const m = names(h, 'me');
		expect(m.guW).toEqual(["grandparent’s sibling by marriage"]);
		expect(m.gnW).toEqual(['granddaughter-in-law']);
		const k = names(h, 'p');
		expect(k.guW).toEqual(["parent’s sibling by marriage"]);
		const u = tree(['gg m', 'g m gg', 'gu m gg', 'guW f', 'p m g', 'me f p', 'sib m p', 'nep m sib', 'nepW f', 'gnep m nep', 'gnepW f'], ['gu guW', 'nep nepW', 'gnep gnepW']);
		expect(names(u, 'me').guW).toEqual(['great-aunt by marriage']);
		expect(names(u, 'me').nepW).toEqual(['niece by marriage']);
		expect(names(u, 'me').gnepW).toEqual(['great-niece by marriage']);
	});

	it('an unknown union type counts as a marriage', () => {
		const h = tree(['me m', 'w f', 'wf m', 'w2 f wf'], ['me w handfasting']);
		const k = tree(['me m', 'w f wf', 'wf m'], ['me w handfasting']);
		expect(names(k, 'me').wf).toEqual(['father-in-law']);
		expect(names(h, 'me').w2).toBeUndefined();
	});

	it('step-siblings come only through birth and adoptive parents (ruling 4)', () => {
		const h = tree(['n m', 'q f', 'o m', 'me m n', 'p f q:rumoured', 'pa f q:adoptive', 'pw f q:ward', 'pb f q o'], ['n q']);
		const m = names(h, 'me');
		expect(m.p).toBeUndefined();
		expect(m.pw).toBeUndefined();
		expect(m.pa).toEqual(['stepsister']);
		expect(m.pb).toEqual(['stepsister']);
		const r = tree(['n m', 'q f', 'me m n:rumoured', 'p f q'], ['n q']);
		expect(names(r, 'me').p).toBeUndefined();
	});
});

describe('which name wins (§13.1, ruling 1)', () => {
	it('a name by marriage never wins over a blood name', () => {
		const g = graph(fixture('03'));
		const n = names(g, 'conrad');
		expect(n.giselle).toEqual(['aunt', 'mother-in-law']);
		expect(n.lisette).toEqual(['wife', 'first cousin']);
		expect(n.stefan).toEqual(['father-in-law', 'uncle by marriage']);
		expect(n.ulric).toEqual(['first cousin', 'brother-in-law']);
	});

	it('the child of a first-cousin marriage is also the first cousin once removed: one path meets no other common ancestor', () => {
		const n = names(graph(fixture('03')), 'conrad');
		expect(n.tristan).toEqual(['son', 'first cousin once removed']);
	});

	it('a candidate whose two paths both pass through one other common ancestor is dropped', () => {
		// a and b are siblings who married; me is their son, kid me's son. Through x, the paths of me
		// and kid meet at me, so kid is only a son.
		const g = tree(['x m', 'y f', 'a m x y', 'b f x y', 'me m a b', 'kid m me'], ['x y', 'a b']);
		expect(names(g, 'me').kid).toEqual(['son']);
		// Through x, me's paths go through a or b, and a is also the father: a is father and uncle.
		expect(names(g, 'me').a).toEqual(['father', 'uncle']);
	});

	it('at equal distance: the direct line first', () => {
		// f is the father of me and of c; c and f have p: p is me's half-brother and grandson.
		const g = tree(['f m', 'g f', 'me m f g', 'c f me', 'p m c f'], ['f g', 'f c']);
		expect(names(g, 'me').p).toEqual(['grandson', 'half-brother']);
	});

	it('at equal distance: birth before adoptive, adoptive before guardian', () => {
		const g = tree(['f m', 'g f', 'me m f g', 'p m f g:adoptive'], ['f g']);
		expect(names(g, 'me').p).toEqual(['half-brother', 'adoptive half-brother']);
		const h = tree(['p m', 'me m p:adoptive p:ward']);
		expect(names(h, 'me').p).toEqual(['adoptive father', 'guardian']);
	});

	it('at equal distance: the smaller removal first', () => {
		// Through x1: a = b = 3 (second cousin). Through x2: a = 2, b = 4 (first cousin twice removed).
		// Every child lists one parent: the setting off keeps both names full (D174).
		const g = tree(['x1 m', 'a1 m x1', 'c1 m x1', 'x2 m', 'bb m x2', 'd2 m x2', 'a m a1', 'd1 m d2', 'c m c1', 'd m d1', 'me m a bb', 'p m c d']);
		expect(names(g, 'me', OFF).p).toEqual(['second cousin', 'first cousin twice removed']);
	});

	it('at equal distance: full before half', () => {
		// Through the couple x + y: first cousin. Through z (half): half first cousin.
		const g = tree(['x m', 'y f', 'z m', 'w f', 'v f', 'a m x y', 'b m x y', 'c m z w', 'd f z v', 'me m a c', 'p m b d'], ['x y', 'z w', 'z v']);
		expect(names(g, 'me').p).toEqual(['first cousin', 'half first cousin']);
	});
});

describe('the choice of lines: link type first, then list order (M7 code check rulings)', () => {
	it('a line of birth links wins over an adoptive line of the same length, whichever parent is listed first', () => {
		// k is a's son by birth and b's adopted son; "placement: adoptive" lists b first.
		const g = graph(
			'people:\n  - {id: gp, name: gp, sex: m}\n  - {id: a, name: a, sex: m, parents: [gp]}\n  - {id: b, name: b, sex: m, parents: [gp]}\n' +
				'  - {id: k, name: k, sex: m, parents: [a, {id: b, type: adoptive}], placement: adoptive}\n',
		);
		expect(first(g, 'gp', 'k')).toBe('grandson');
		expect(first(g, 'k', 'gp')).toBe('grandfather');
		expect(computeRelations(g, 'gp').get('k')![0].line.people).toEqual(['gp', 'a', 'k']);
	});

	it('an adoptive line wins over a rumoured line of the same length, whichever is listed first', () => {
		for (const parents of ['c b:rumoured a:adoptive', 'c a:adoptive b:rumoured']) {
			const g = tree(['gp m', 'a m gp', 'b m gp', 'c m', `k m ${parents}`]);
			expect(first(g, 'gp', 'k')).toBe('adopted grandson');
			expect(first(g, 'k', 'gp')).toBe('adoptive grandfather');
		}
	});

	it('at one common ancestor, each distinct full or half result is a name, whatever the order of the children (D50)', () => {
		// P's father descends from c2 (full sibling of M's father c1), P's mother from c3 (half sibling).
		const rest = ['M m c1', 'c2s m c2', 'c3d f c3', 'P m c2s c3d'];
		const want = ['first cousin once removed', 'half first cousin once removed'];
		expect(names(tree(['X m', 'Y f', 'Z f', 'c1 m X Y', 'c2 f X Y', 'c3 m X Z', ...rest]), 'M').P).toEqual(want);
		expect(names(tree(['X m', 'Y f', 'Z f', 'c1 m X Y', 'c3 m X Z', 'c2 f X Y', ...rest]), 'M').P).toEqual(want);
	});

	it('when both first paths meet, the exact search finds two shortest paths that share nobody below X', () => {
		// M's only parent Q is on P's first path (through V1); P's other path (V2, w1) reaches T1, which
		// is on M's first path. The pair M-Q-T2-c1-X and P-V2-w1-T1-c2-X shares nobody below X.
		// The setting off (D174): with it on, the nephew and third-cousin names are half, since M, V1, c1 and c2 list one parent.
		const g = tree(['X m', 'c1 m X', 'c2 m X', 'T1 m c1 c2', 'T2 m c1 c2', 'Q m T1 T2', 'M m Q', 'V1 m Q', 'w1 m T1', 'V2 m w1', 'P m V1 V2']);
		const rels = computeRelations(g, 'M', OFF).get('P')!;
		expect(rels.map((r) => r.lower)).toEqual(['nephew', 'half first cousin once removed', 'second cousin once removed', 'third cousin once removed']);
		expect(rels[3].line.people).toEqual(['M', 'Q', 'T2', 'c1', 'X', 'c2', 'T1', 'w1', 'V2', 'P']);
	});
});

describe('lines (relations.ts line rules)', () => {
	const lineOf = (g: FamilyGraph, me: string, id: string, i = 0) => computeRelations(g, me).get(id)![i].line;
	const birth = (parent: string, child: string) => ({ parent, child, type: 'birth' });

	it('the direct line goes up by the tie-break: the first parent in the child\'s list at the shortest distance', () => {
		const g = tree(['t m', 'l m t', 'r f t', 'me m l r']);
		expect(lineOf(g, 'me', 't')).toEqual({ people: ['me', 'l', 't'], links: [birth('l', 'me'), birth('t', 'l')], unions: [] });
		const h = tree(['t m', 'l m t', 'r f t', 'me m r l']);
		expect(lineOf(h, 'me', 't').people).toEqual(['me', 'r', 't']);
	});

	it('a full relation crosses the couple; the union is c1\'s primary union', () => {
		const g = tree(['x m', 'y f', 'a m x y', 'b m x y', 'me m a', 'p m b'], ['x y']);
		expect(lineOf(g, 'me', 'p')).toEqual({ people: ['me', 'a', 'x', 'y', 'b', 'p'], links: [birth('a', 'me'), birth('x', 'a'), birth('y', 'b'), birth('b', 'p')], unions: ['u0'] });
	});

	it('a full relation through a couple with no union uses the implicit key', () => {
		const g = tree(['x m', 'y f', 'a m x y', 'b m x y']);
		expect(lineOf(g, 'a', 'b')).toEqual({ people: ['a', 'x', 'y', 'b'], links: [birth('x', 'a'), birth('y', 'b')], unions: ['i:["x","y"]'] });
	});

	it('when c1 is not placed under the couple, the couple\'s last-listed union', () => {
		// a is placed under its birth parents; its adoptive parents are x and y, like b's birth parents.
		const g = tree(['x m', 'y f', 'o m', 'a m o x:adoptive y:adoptive', 'b m x y'], ['x y betrothal', 'x y']);
		expect(first(g, 'a', 'b')).toBe('adoptive brother');
		expect(lineOf(g, 'a', 'b')).toEqual({
			people: ['a', 'x', 'y', 'b'],
			links: [{ parent: 'x', child: 'a', type: 'adoptive' }, birth('y', 'b')],
			unions: ['u1'],
		});
	});

	it('by marriage, rule 1: the blood line, then P and the marriage', () => {
		const g = tree(['d m', 'me m d', 'sm f'], ['d sm']);
		expect(lineOf(g, 'me', 'sm')).toEqual({ people: ['me', 'd', 'sm'], links: [birth('d', 'me')], unions: ['u0'] });
	});

	it('by marriage, rule 2: M, S, then S\'s blood line', () => {
		const g = tree(['me m', 'wf m', 'w f wf'], ['me w']);
		expect(lineOf(g, 'me', 'wf')).toEqual({ people: ['me', 'w', 'wf'], links: [birth('wf', 'w')], unions: ['u0'] });
	});
});

describe('findRelation (§13.2)', () => {
	it('none for the same person or an id that names nobody; none for two unconnected parts', () => {
		const g = tree(['a m', 'b m']);
		expect(findRelation(g, 'a', 'a')).toEqual({ kind: 'none', first: 'a', second: 'a' });
		expect(findRelation(g, 'a', 'zz').kind).toBe('none');
		expect(findRelation(g, 'a', 'b')).toEqual({ kind: 'none', first: 'a', second: 'b' });
	});

	it('names the second person as a relative of the first, with steps; every relation (D53)', () => {
		const g = tree(['x m', 'y f', 'a m x y', 'me m a']);
		const r = named(findRelation(g, 'me', 'x'));
		expect(r.relations.map((x) => x.relation.lower)).toEqual(['grandfather']);
		expect(r.relations[0].steps).toEqual([step('a', 'me', 'father'), step('x', 'a', 'father')]);
		expect(Object.isFrozen(r)).toBe(true);
		expect(Object.isFrozen(r.relations[0].steps)).toBe(true);
		// Fixture 7 has pairs with more than 10 relations; the finder lists them all, in the same order (D53).
		expect(FINDER_LIMIT).toBe(Infinity);
		const g7 = graph(fixture('07'));
		const rels = computeRelations(g7, 'cecily-orsini');
		const many = [...rels].find(([, list]) => list.length > 10);
		expect(many).toBeDefined();
		const f = named(findRelation(g7, 'cecily-orsini', many![0]));
		expect(f.relations.map((x) => x.relation.lower)).toEqual(many![1].map((x) => x.lower));
	});

	it('steps: one sibling step for a half-sibling; the full relation keeps its partner step; types in the words', () => {
		const g = tree(['x m', 'y f', 'z f', 'a m x y', 'h f x z', 'b m x y', 'ad f x:adoptive', 'ru m x:rumoured', 'wd m x:ward'], ['x y', 'x z']);
		expect(named(findRelation(g, 'a', 'h')).relations[0].steps).toEqual([step('h', 'a', 'half-sister')]);
		expect(named(findRelation(g, 'a', 'b')).relations[0].steps).toEqual([step('x', 'a', 'father'), step('y', 'x', 'wife'), step('b', 'y', 'son')]);
		expect(named(findRelation(g, 'x', 'ad')).relations[0].steps).toEqual([step('ad', 'x', 'adopted daughter')]);
		expect(named(findRelation(g, 'ad', 'x')).relations[0].steps).toEqual([step('x', 'ad', 'adoptive father')]);
		expect(named(findRelation(g, 'x', 'ru')).relations[0].steps).toEqual([step('ru', 'x', 'rumoured son')]);
		expect(named(findRelation(g, 'ru', 'x')).relations[0].steps).toEqual([step('x', 'ru', 'rumoured father')]);
		expect(named(findRelation(g, 'wd', 'x')).relations[0].steps).toEqual([step('x', 'wd', 'guardian')]);
	});

	it('a sibling step carries the type word of its links, like the relation name (finishing-round ruling 3)', () => {
		const g = tree(['x m', 'y f', 'z f', 'a m x y', 'h f x z', 'ad f x:adoptive', 'ru m x:rumoured'], ['x y', 'x z']);
		const sibling = (from: string, to: string, options?: RelationOptions) => {
			const { relation, steps } = named(findRelation(g, from, to, options)).relations[0];
			expect(steps).toHaveLength(1);
			// The step word and the relation name agree for a half-sibling.
			expect(steps[0].word).toBe(relation.lower);
			return steps[0];
		};
		expect(sibling('a', 'h')).toEqual(step('h', 'a', 'half-sister'));
		expect(sibling('a', 'ad')).toEqual(step('ad', 'a', 'adoptive half-sister'));
		expect(sibling('ad', 'a')).toEqual(step('a', 'ad', 'adoptive half-brother'));
		expect(sibling('a', 'ru')).toEqual(step('ru', 'a', 'rumoured half-brother'));
		expect(sibling('ru', 'a')).toEqual(step('a', 'ru', 'rumoured half-brother'));
		// A rumoured link and an adoptive link to the same one parent (full by the half rule with the setting off): "rumoured" wins, as in the name.
		expect(sibling('ad', 'ru', OFF)).toEqual(step('ru', 'ad', 'rumoured brother'));
		// D174, setting on: ru's set in the second test is {x}, one person, so the rumoured line is half.
		expect(sibling('ad', 'ru')).toEqual(step('ru', 'ad', 'rumoured half-brother'));
		// A neutral sex keeps the neutral word.
		const n = tree(['x m', 'y f', 'a - x y', 'b - x:adoptive']);
		expect(named(findRelation(n, 'a', 'b')).relations[0].steps).toEqual([step('b', 'a', 'adoptive half-sibling')]);
		expect(named(findRelation(n, 'a', 'b')).relations[0].relation.lower).toBe('adoptive half-sibling');
	});

	it('a full sibling step inside a chain carries the type word too ("adoptive brother")', () => {
		// l is b's lover (no name); c is adopted by both of b's parents: the chain l > b > x > c.
		const g = tree(['x m', 'y f', 'b m x y', 'c m x:adoptive y:adoptive', 'l f', 'r m x:rumoured y:rumoured'], ['x y', 'l b affair']);
		const r = findRelation(g, 'l', 'c');
		expect(r.kind).toBe('chain');
		if (r.kind !== 'chain') return;
		expect(r.steps).toEqual([step('b', 'l', 'lover'), step('c', 'b', 'adoptive brother')]);
		const q = findRelation(g, 'l', 'r');
		expect(q.kind === 'chain' && q.steps).toEqual([step('b', 'l', 'lover'), step('r', 'b', 'rumoured brother')]);
		// A birth sibling keeps the plain word.
		const h = tree(['x m', 'y f', 'b m x y', 'c f x y', 'l f'], ['x y', 'l b affair']);
		const s = findRelation(h, 'l', 'c');
		expect(s.kind === 'chain' && s.steps).toEqual([step('b', 'l', 'lover'), step('c', 'b', 'sister')]);
	});

	it('the chain: breadth-first, parents before children before partners; a ward link is its own step', () => {
		// f has a guardian g and a ward w; t is a ward of both. The search reaches t through g first.
		const g = tree(['g m', 'f m g:ward', 'w m f:ward', 't m g:ward w:ward']);
		const r = findRelation(g, 'f', 't');
		expect(r.kind).toBe('chain');
		if (r.kind !== 'chain') return;
		expect(r.line).toEqual({ people: ['f', 'g', 't'], links: [{ parent: 'g', child: 'f', type: 'ward' }, { parent: 'g', child: 't', type: 'ward' }], unions: [] });
		expect(r.steps).toEqual([step('g', 'f', 'guardian'), step('t', 'g', 'ward')]);
		// Children before partners: c is reached through the child k, not through the partner s.
		const h = tree(['f m', 's f', 'k m f:ward', 'c m k:ward s:ward'], ['f s affair']);
		const q = findRelation(h, 'f', 'c');
		expect(q.kind === 'chain' && q.line.people).toEqual(['f', 'k', 'c']);
	});

	it('a chain through partnerships of any type names each partner step', () => {
		const g = tree(['a m', 'b f', 'c m', 'd f'], ['a b affair', 'b c concubinage', 'c d betrothal']);
		const r = findRelation(g, 'a', 'd');
		expect(r.kind).toBe('chain');
		if (r.kind !== 'chain') return;
		expect(r.steps).toEqual([step('b', 'a', 'lover'), step('c', 'b', 'partner in concubinage'), step('d', 'c', 'betrothed')]);
		expect(r.line.unions).toEqual(['u0', 'u1', 'u2']);
	});

	it('works on every pair of fixture 5 (a cycle) and ends', () => {
		const g = graph(fixture('05'));
		for (const a of g.people) for (const b of g.people) expect(() => findRelation(g, a.id, b.id)).not.toThrow();
	});
});

describe('lineSubgraph (D47)', () => {
	it('keeps the original unions by key, with no issues', () => {
		const g = tree(['x m', 'y f', 'a m x y', 'b m x y', 'me m a', 'p m b', 'o f'], ['x o', 'x y']);
		const line = computeRelations(g, 'me').get('p')![0].line;
		const sub = lineSubgraph(g, line);
		expect(sub.people.map((p) => p.id)).toEqual(['x', 'y', 'a', 'b', 'me', 'p']);
		expect(sub.unions.map((u) => u.key)).toEqual(['u1']);
		expect(sub.issues).toEqual([]);
		// The line's links, plus the couple's shared trunk (supervisor ruling): a and b hang from x + y.
		expect(sub.placementParents.get('a')).toEqual(['x', 'y']);
		expect(sub.placementParents.get('b')).toEqual(['x', 'y']);
		expect(sub.primaryUnion.get('a')).toBe('u1');
		expect(sub.placementParents.get('me')).toEqual(['a']);
	});

	it('the shared trunk keeps the whole tree\'s parent order and link types; a half relation has no trunk', () => {
		// b lists y before x; t has x and y as adoptive parents.
		const g = tree(['x m', 'y f', 'z f', 'a m x y', 'b m y x', 't m x:adoptive y:adoptive', 'h m x z'], ['x y', 'x z']);
		expect(lineSubgraph(g, computeRelations(g, 'a').get('b')![0].line).placementParents.get('b')).toEqual(['y', 'x']);
		const adopted = lineSubgraph(g, computeRelations(g, 'a').get('t')![0].line);
		expect(adopted.placementParents.get('t')).toEqual(['x', 'y']);
		expect(adopted.placementType.get('t')).toBe('adoptive');
		const half = computeRelations(g, 'a').get('h')![0];
		expect(half.line).toEqual({ people: ['a', 'x', 'h'], links: [{ parent: 'x', child: 'a', type: 'birth' }, { parent: 'x', child: 'h', type: 'birth' }], unions: [] });
		expect(lineSubgraph(g, half.line).placementParents.get('h')).toEqual(['x']);
	});

	it('a child whose only line links are rumoured hangs from the first rumoured parent', () => {
		const g = tree(['x m', 'a m x', 'r f x:rumoured']);
		const line = computeRelations(g, 'a').get('r')![0].line;
		expect(line.links).toEqual([{ parent: 'x', child: 'a', type: 'birth' }, { parent: 'x', child: 'r', type: 'rumoured' }]);
		const sub = lineSubgraph(g, line);
		expect(sub.placementParents.get('r')).toEqual(['x']);
		expect(sub.placementType.get('r')).toBe('rumoured');
		expect(sub.soloChildren.get('x')).toEqual(['a', 'r']);
		expect(sub.secondary).toEqual([]);
	});

	it('an implicit couple with no child on the line stays as a plain connector', () => {
		const g = tree(['a m', 'b f', 'c m a b']);
		const line = computeRelations(g, 'a').get('b')![0].line;
		expect(line.unions).toEqual(['i:["a","b"]']);
		const sub = lineSubgraph(g, line);
		expect(sub.unions).toEqual([{ key: 'i:["a","b"]', partners: ['a', 'b'], type: 'implicit', implicit: true, children: [] }]);
		expect(sub.unionsOf.get('a')).toEqual(['i:["a","b"]']);
	});

	it('ignores ids and keys it does not know', () => {
		const g = tree(['a m', 'b f']);
		const sub = lineSubgraph(g, { people: ['a', 'ghost'], links: [{ parent: 'ghost', child: 'a', type: 'birth' }], unions: ['u9', 'i:nonsense', 'i:["a","ghost"]'] });
		expect(sub.people.map((p) => p.id)).toEqual(['a']);
		expect(sub.unions).toEqual([]);
	});
});

describe('relationsKey', () => {
	const base = tree(['a m', 'b f a', 'c m'], ['a c']);

	it('is the same for the same tree and mark, and not changed by names', () => {
		const renamed = graph('people:\n  - id: a\n    name: Other\n    sex: m\n  - id: b\n    name: B\n    sex: f\n    parents: [a]\n  - id: c\n    name: C\n    sex: m\nunions:\n  - partners: [a, c]\n');
		expect(relationsKey(base, 'a')).toBe(relationsKey(tree(['a m', 'b f a', 'c m'], ['a c']), 'a'));
		expect(relationsKey(renamed, 'a')).toBe(relationsKey(base, 'a'));
	});

	it('changes with the mark, a sex, a parent link or its type, and a union', () => {
		const key = relationsKey(base, 'a');
		expect(relationsKey(base, 'b')).not.toBe(key);
		expect(relationsKey(tree(['a m', 'b m a', 'c m'], ['a c']), 'a')).not.toBe(key);
		expect(relationsKey(tree(['a m', 'b f a:adoptive', 'c m'], ['a c']), 'a')).not.toBe(key);
		expect(relationsKey(tree(['a m', 'b f', 'c m'], ['a c']), 'a')).not.toBe(key);
		expect(relationsKey(tree(['a m', 'b f a', 'c m'], ['a c affair']), 'a')).not.toBe(key);
		expect(relationsKey(tree(['a m', 'b f a', 'c m']), 'a')).not.toBe(key);
	});
});

describe('the small tree of every relation lays out (fixtures 3, 5, 11, 12)', async () => {
	const { layoutTree } = await import('../src/layout/index');
	const { geometryFor } = await import('../src/layout/geometry');
	const NEVER_FAR = { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } };
	for (const id of ['03', '05', '11', '12']) {
		it(`fixture ${id}`, () => {
			const g = graph(fixture(id));
			let count = 0;
			for (const me of g.people) {
				for (const [, rels] of computeRelations(g, me.id)) {
					for (const rel of rels as readonly Relation[]) {
						const sub = lineSubgraph(g, rel.line);
						const { layout } = layoutTree(sub, geometryFor(16), NEVER_FAR, 'sans-serif');
						expect([...layout.persons.keys()].sort()).toEqual([...new Set(rel.line.people)].sort());
						count++;
					}
				}
				for (const other of g.people) {
					const r = findRelation(g, me.id, other.id);
					if (r.kind === 'chain') layoutTree(lineSubgraph(g, r.line), geometryFor(16), NEVER_FAR, 'sans-serif');
				}
			}
			expect(count).toBeGreaterThan(g.people.length);
		});
	}
});
