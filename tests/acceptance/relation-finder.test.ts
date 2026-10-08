import { describe, expect, it } from 'vitest';
import type { FinderResult, RelationLine, RelationStep } from '../../src/core/relations';
import { geometryFor } from '../../src/layout/geometry';
import { layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { fixtureSource } from './load';
import { graphOf, lowers, relationsModule, relationText, sample12, SPEC_4 } from './relations-support';

/*
 * The relation finder (spec §13.2, D47, D48): acceptance tests written from the spec and the
 * line and step rules in the relations.ts header, before the build (WP7.0). They fail until WP7.1 adds
 * `src/core/relations.ts` (`findRelation`, `lineSubgraph`) and WP7.2 adds the sentence builders.
 *
 * Union keys in sample tree 12 are `u<index in unions>`: u0 sigmund–wilma, u2 odo–bertha,
 * u5 alan–dana, u6 alan–fenna, u8 rolf–fenna, u12 kester–mabel, u15 ivo–kit (the marriage; u14 is
 * the betrothal before it); Nora and Zed have only the implicit union i:["nora","zed"] (Otto).
 */

const SAMPLE = sample12();
const G = graphOf(SAMPLE.source);

const named = (r: FinderResult) => {
	if (r.kind !== 'named') throw new Error(`expected a named result, got ${r.kind}`);
	return r;
};
const step = (person: string, of: string, word: string): RelationStep => ({ person, of, word });
const birth = (parent: string, child: string) => ({ parent, child, type: 'birth' as const });

describe('sample tree 12: the 10 finder pairs of its comments (spec §13.2 acceptance)', () => {
	it('lists 10 pairs', () => {
		expect(SAMPLE.pairs).toHaveLength(10);
	});

	for (const pair of SAMPLE.pairs) {
		it(`${pair.first} > ${pair.second}: "${pair.sentence}"`, async () => {
			const { findRelation } = await relationsModule();
			const r = findRelation(G, pair.first, pair.second);
			expect(r.first).toBe(pair.first);
			expect(r.second).toBe(pair.second);
			if (pair.count === 'none') {
				expect(r.kind).toBe('none');
			} else if (pair.count === 'chain') {
				expect(r.kind).toBe('chain');
				if (r.kind === 'chain') expect(r.line.people).toEqual(pair.line);
			} else {
				const n = named(r);
				expect(n.relations).toHaveLength(pair.count);
				expect(n.relations[0].relation.line.people).toEqual(pair.line);
			}
			expect(relationText('finderSentence')(G, r, 0)).toBe(pair.sentence);
		});
	}
});

describe('lines, links and unions (relations.ts line rules)', () => {
	const line = async (first: string, second: string, index = 0): Promise<RelationLine> => {
		const { findRelation } = await relationsModule();
		return named(findRelation(G, first, second)).relations[index].relation.line;
	};

	it('half blood (leo > wynn): up to Harold, down to Wynn by the rumoured link; no union', async () => {
		expect(await line('leo', 'wynn')).toEqual({
			people: ['leo', 'harold', 'wynn'],
			links: [birth('harold', 'leo'), { parent: 'harold', child: 'wynn', type: 'rumoured' }],
			unions: [],
		});
	});

	it('partner (ivo > kit): the pair and its last-listed union (the marriage after the betrothal)', async () => {
		expect(await line('ivo', 'kit')).toEqual({ people: ['ivo', 'kit'], links: [], unions: ['u15'] });
	});

	it('full blood (ivo > kit, the first cousin): up to Odo through Brand, across to Bertha, down through Cora', async () => {
		// c1 = Brand, whose parents are listed [odo, bertha]: X is Odo; the union is Brand's primary union.
		expect(await line('ivo', 'kit', 1)).toEqual({
			people: ['ivo', 'brand', 'odo', 'bertha', 'cora', 'kit'],
			links: [birth('brand', 'ivo'), birth('odo', 'brand'), birth('bertha', 'cora'), birth('cora', 'kit')],
			unions: ['u2'],
		});
	});

	it('father–daughter marriage (mabel > kester): the partner line, then the parent line', async () => {
		expect(await line('mabel', 'kester', 0)).toEqual({ people: ['mabel', 'kester'], links: [], unions: ['u12'] });
		expect(await line('mabel', 'kester', 1)).toEqual({ people: ['mabel', 'kester'], links: [birth('kester', 'mabel')], unions: [] });
	});

	it('step-sibling (gwen > tamsin): [M, N, Q, P] with the N–Q marriage', async () => {
		expect(await line('gwen', 'tamsin')).toEqual({
			people: ['gwen', 'alan', 'fenna', 'tamsin'],
			links: [birth('alan', 'gwen'), birth('fenna', 'tamsin')],
			unions: ['u6'],
		});
	});

	it('ward (alan > pim): the one ward link; then the step-grandchild by rule 2', async () => {
		expect(await line('alan', 'pim', 0)).toEqual({ people: ['alan', 'pim'], links: [{ parent: 'alan', child: 'pim', type: 'ward' }], unions: [] });
		expect(await line('alan', 'pim', 1)).toEqual({
			people: ['alan', 'fenna', 'tamsin', 'pim'],
			links: [birth('fenna', 'tamsin'), birth('tamsin', 'pim')],
			unions: ['u6'],
		});
	});

	it("rule 2 with a full relation (alan > nils): the marriage, then Dana's line through the couple Sigmund and Wilma", async () => {
		expect(await line('alan', 'nils')).toEqual({
			people: ['alan', 'dana', 'hugo', 'sigmund', 'wilma', 'maud', 'nils'],
			links: [birth('hugo', 'dana'), birth('sigmund', 'hugo'), birth('wilma', 'maud'), birth('maud', 'nils')],
			unions: ['u5', 'u0'],
		});
	});

	it('an implicit union (nora > zed)', async () => {
		expect(await line('nora', 'zed')).toEqual({ people: ['nora', 'zed'], links: [], unions: ['i:["nora","zed"]'] });
	});

	it('guardian (wat > alan)', async () => {
		expect(await line('wat', 'alan')).toEqual({ people: ['wat', 'alan'], links: [{ parent: 'alan', child: 'wat', type: 'ward' }], unions: [] });
	});

	it('double first cousin (gwen > ivo): the line of the first couple in document order (Odo and Bertha)', async () => {
		expect(await line('gwen', 'ivo')).toEqual({
			people: ['gwen', 'alan', 'odo', 'bertha', 'brand', 'ivo'],
			links: [birth('alan', 'gwen'), birth('odo', 'alan'), birth('bertha', 'brand'), birth('brand', 'ivo')],
			unions: ['u2'],
		});
	});

	it('chain (gwen > rolf): the breadth-first path, with both partnerships', async () => {
		const { findRelation } = await relationsModule();
		const r = findRelation(G, 'gwen', 'rolf');
		expect(r.kind).toBe('chain');
		if (r.kind === 'chain') expect(r.line).toEqual({ people: ['gwen', 'alan', 'fenna', 'rolf'], links: [birth('alan', 'gwen')], unions: ['u6', 'u8'] });
	});
});

describe('"Show the steps" (D48): one step per link; up and down to a sibling is one step', () => {
	const steps = async (first: string, second: string, index = 0) => {
		const { findRelation } = await relationsModule();
		return named(findRelation(G, first, second)).relations[index].steps;
	};

	it('step-sibling: father, wife, daughter', async () => {
		expect(await steps('gwen', 'tamsin')).toEqual([step('alan', 'gwen', 'father'), step('fenna', 'alan', 'wife'), step('tamsin', 'fenna', 'daughter')]);
	});

	it('ward, then step-grandson', async () => {
		expect(await steps('alan', 'pim', 0)).toEqual([step('pim', 'alan', 'ward')]);
		expect(await steps('alan', 'pim', 1)).toEqual([step('fenna', 'alan', 'wife'), step('tamsin', 'fenna', 'daughter'), step('pim', 'tamsin', 'son')]);
	});

	it("wife's first cousin: 6 steps (the partner step between Sigmund and Wilma keeps up and down apart)", async () => {
		expect(await steps('alan', 'nils')).toEqual([
			step('dana', 'alan', 'wife'),
			step('hugo', 'dana', 'father'),
			step('sigmund', 'hugo', 'father'),
			step('wilma', 'sigmund', 'wife'),
			step('maud', 'wilma', 'daughter'),
			step('nils', 'maud', 'son'),
		]);
	});

	it('first cousin: 5 steps', async () => {
		expect(await steps('ivo', 'kit', 1)).toEqual([
			step('brand', 'ivo', 'father'),
			step('odo', 'brand', 'father'),
			step('bertha', 'odo', 'wife'),
			step('cora', 'bertha', 'daughter'),
			step('kit', 'cora', 'daughter'),
		]);
	});

	it('a half-sibling is one sibling step', async () => {
		expect(await steps('gwen', 'kester')).toEqual([step('kester', 'gwen', 'half-brother')]);
		// Finishing-round ruling 3: a sibling step carries the type word of its links, like the name.
		expect(await steps('leo', 'wynn')).toEqual([step('wynn', 'leo', 'rumoured half-brother')]);
	});

	it('partner words: husband, co-parent, guardian', async () => {
		expect(await steps('mabel', 'kester', 0)).toEqual([step('kester', 'mabel', 'husband')]);
		expect(await steps('mabel', 'kester', 1)).toEqual([step('kester', 'mabel', 'father')]);
		expect(await steps('nora', 'zed')).toEqual([step('zed', 'nora', 'co-parent')]);
		expect(await steps('wat', 'alan')).toEqual([step('alan', 'wat', 'guardian')]);
	});

	it('an adopted child and an adoptive parent carry the link type', async () => {
		expect(await steps('cora', 'nell')).toEqual([step('nell', 'cora', 'adopted daughter')]);
		expect(await steps('nell', 'cora')).toEqual([step('cora', 'nell', 'adoptive mother')]);
	});

	it('the step sentences: "Alan is Gwen\'s father."; at most 8, then the count of the others', async () => {
		const { findRelation } = await relationsModule();
		const sentences = relationText('stepSentences');
		const r = findRelation(G, 'gwen', 'tamsin');
		expect(sentences(G, named(r).relations[0].steps)).toEqual({ shown: ["Alan is Gwen’s father.", "Fenna is Alan’s wife.", "Tamsin is Fenna’s daughter."], more: 0 });
		const twelve = Array.from({ length: 12 }, () => step('alan', 'gwen', 'father'));
		const long = sentences(G, twelve);
		expect(long.shown).toHaveLength(8);
		expect(long.more).toBe(4);
	});
});

describe('the named result', () => {
	it('names the second person as a relative of the first, like the marked person, with every relation (spec §13.2 "Rules", D53)', async () => {
		const { computeRelations, findRelation } = await relationsModule();
		for (const first of SAMPLE.marked) {
			const rels = computeRelations(G, first);
			for (const p of G.people) {
				if (p.id === first) continue;
				const r = findRelation(G, first, p.id);
				const want = lowers(rels.get(p.id));
				if (want.length) expect(named(r).relations.map((x) => x.relation.lower), `${first} > ${p.id}`).toEqual(want);
				else expect(r.kind, `${first} > ${p.id}`).not.toBe('named');
			}
		}
	});

	it('the relation of the other direction: Gwen is Leo\'s aunt, Leo is Gwen\'s nephew', async () => {
		const { findRelation } = await relationsModule();
		const sentence = relationText('finderSentence');
		expect(sentence(G, findRelation(G, 'leo', 'gwen'), 0)).toBe("Gwen is Leo’s aunt.");
		expect(sentence(G, findRelation(G, 'gwen', 'leo'), 0)).toBe("Leo is Gwen’s nephew.");
		expect(sentence(G, findRelation(G, 'cora', 'nell'), 0)).toBe("Nell is Cora’s adopted daughter.");
	});

	it('"Other relation" order on a cousin marriage (fixture 3): the partner name, then the blood name', async () => {
		const { findRelation } = await relationsModule();
		const g = graphOf(fixtureSource('03'));
		const conrad = named(findRelation(g, 'conrad', 'lisette'));
		expect(conrad.relations.map((x) => x.relation.lower)).toEqual(['wife', 'first cousin']);
		expect(conrad.relations[0].relation.line.people).toEqual(['conrad', 'lisette']);
		expect(conrad.relations[1].relation.line.people).toEqual(['conrad', 'bastien', 'aurel', 'viviane', 'giselle', 'lisette']);
		expect(named(findRelation(g, 'lisette', 'conrad')).relations.map((x) => x.relation.lower)).toEqual(['husband', 'first cousin']);
		const sentence = relationText('finderSentence');
		expect(sentence(g, conrad, 0)).toBe("Lisette Veyle is Conrad Castellane’s wife.");
		expect(sentence(g, conrad, 1)).toBe("Lisette Veyle is Conrad Castellane’s first cousin.");
	});

	it('from the sheet of Wren, picking Roderick (the §4 tree): Wren is the half-sister', async () => {
		const { findRelation } = await relationsModule();
		// From the sheet the picked person is first and the sheet's person second.
		const g = graphOf(SPEC_4);
		const r = named(findRelation(g, 'roderick', 'wren'));
		expect(r.relations.map((x) => x.relation.lower)).toEqual(['half-sister']);
		expect(r.relations[0].relation.line).toEqual({ people: ['roderick', 'aldric', 'wren'], links: [birth('aldric', 'roderick'), birth('aldric', 'wren')], unions: [] });
		// Names come from the name field (relations.ts), so the sentence has the full name.
		expect(relationText('finderSentence')(g, r, 0)).toBe("Wren is Roderick Valmont’s half-sister.");
	});
});

describe('chain and none (spec §13.2 "No relation of §13.1")', () => {
	it('two marriages apart: the chain sentences', async () => {
		const { findRelation } = await relationsModule();
		const sentence = relationText('finderSentence');
		const sentences = relationText('stepSentences');
		const rolf = findRelation(G, 'gwen', 'rolf');
		expect(rolf.kind).toBe('chain');
		if (rolf.kind !== 'chain') return;
		expect(rolf.steps).toEqual([step('alan', 'gwen', 'father'), step('fenna', 'alan', 'wife'), step('rolf', 'fenna', 'husband')]);
		expect(sentences(G, rolf.steps)).toEqual({ shown: ["Alan is Gwen’s father.", "Fenna is Alan’s wife.", "Rolf is Fenna’s husband."], more: 0 });
		const alan = findRelation(G, 'alan', 'rolf');
		expect(sentence(G, alan, 0)).toBe('Alan and Rolf have a relation through 1 other person.');
	});

	it('an affair partner and a ward give no relation of §13.1, only a chain', async () => {
		const { findRelation } = await relationsModule();
		const yara = findRelation(G, 'gwen', 'yara');
		expect(yara.kind === 'chain' && yara.steps).toEqual([step('alan', 'gwen', 'father'), step('yara', 'alan', 'lover')]);
		const wat = findRelation(G, 'gwen', 'wat');
		expect(wat.kind === 'chain' && wat.steps).toEqual([step('alan', 'gwen', 'father'), step('wat', 'alan', 'ward')]);
		const pim = findRelation(G, 'gwen', 'pim');
		expect(pim.kind === 'chain' && pim.line.people).toEqual(['gwen', 'alan', 'pim']);
	});

	it('two unconnected parts of a tree: none, and the tree text does not matter to the order', async () => {
		const { findRelation } = await relationsModule();
		expect(findRelation(G, 'gwen', 'quill')).toEqual({ kind: 'none', first: 'gwen', second: 'quill' });
		expect(findRelation(G, 'quill', 'gwen')).toEqual({ kind: 'none', first: 'quill', second: 'gwen' });
		expect(relationText('finderSentence')(G, findRelation(G, 'quill', 'gwen'), 0)).toBe('Quill and Gwen have no relation in this tree.');
	});

	it('the same person twice, or an id that names nobody: none', async () => {
		const { findRelation } = await relationsModule();
		expect(findRelation(G, 'gwen', 'gwen').kind).toBe('none');
		expect(findRelation(G, 'gwen', 'nobody').kind).toBe('none');
		expect(findRelation(G, 'nobody', 'gwen').kind).toBe('none');
	});

	it('works without a mark and on a cycle (fixture 5): it ends', async () => {
		const { findRelation } = await relationsModule();
		const g = graphOf(fixtureSource('05'));
		for (const a of ['arn', 'bram', 'col']) for (const b of ['arn', 'bram', 'col']) if (a !== b) expect(findRelation(g, a, b).kind).toBe('named');
		expect(findRelation(g, 'arn', 'osmund').kind).toBe('none');
	});
});

describe('the small tree of the line (D47, LineSubgraph)', () => {
	const NEVER_FAR: LayoutSettings = { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } };

	const small = async (first: string, second: string, index = 0) => {
		const { findRelation, lineSubgraph } = await relationsModule();
		const r = findRelation(G, first, second);
		const line = r.kind === 'named' ? r.relations[index].relation.line : r.kind === 'chain' ? r.line : null;
		if (!line) throw new Error('no line');
		return { line, g: lineSubgraph(G, line) };
	};

	it("keeps only the people of the line, their links among themselves and the line's unions (alan > nils)", async () => {
		const { line, g } = await small('alan', 'nils');
		expect(g.people.map((p) => p.id).sort()).toEqual([...line.people].sort());
		// Only the line's links: Dana keeps Hugo, not Clara. For the full relation through the couple
		// Sigmund and Wilma, both children keep both parents, so the couple has its shared trunk
		// (supervisor ruling, the decision notes "Ruling for WP7.1 lineSubgraph").
		expect(g.placementParents.get('hugo')).toEqual(['sigmund', 'wilma']);
		expect(g.placementParents.get('maud')).toEqual(['sigmund', 'wilma']);
		expect(g.placementParents.get('dana')).toEqual(['hugo']);
		expect(g.placementParents.get('nils')).toEqual(['maud']);
		expect(g.placementParents.get('alan')).toEqual([]);
		expect(g.unions.map((u) => [u.key, u.partners]).sort()).toEqual([
			['u0', ['sigmund', 'wilma']],
			['u5', ['alan', 'dana']],
		]);
		expect(g.secondary).toEqual([]);
		const { layout } = layoutTree(g, geometryFor(16), NEVER_FAR, 'sans-serif');
		expect([...layout.persons.keys()].sort()).toEqual([...line.people].sort());
	});

	it('a child whose only line link is rumoured hangs from that parent with the rumoured type (leo > wynn)', async () => {
		const { g } = await small('leo', 'wynn');
		expect(g.people.map((p) => p.id).sort()).toEqual(['harold', 'leo', 'wynn']);
		expect(g.placementParents.get('wynn')).toEqual(['harold']);
		expect(g.placementType.get('wynn')).toBe('rumoured');
		expect(g.placementParents.get('leo')).toEqual(['harold']);
		expect(g.unions).toEqual([]);
		layoutTree(g, geometryFor(16), NEVER_FAR, 'sans-serif');
	});

	it('an implicit union with no shared child stays as a plain connector (nora > zed)', async () => {
		const { g } = await small('nora', 'zed');
		expect(g.people.map((p) => p.id).sort()).toEqual(['nora', 'zed']);
		expect(g.unions).toHaveLength(1);
		expect(g.unions[0]).toMatchObject({ key: 'i:["nora","zed"]', implicit: true, children: [] });
		layoutTree(g, geometryFor(16), NEVER_FAR, 'sans-serif');
	});

	it('a chain (gwen > rolf) and a full relation (ivo > kit) lay out with exactly their people', async () => {
		for (const [first, second, index] of [
			['gwen', 'rolf', 0],
			['ivo', 'kit', 1],
			['gwen', 'tamsin', 0],
		] as const) {
			const { line, g } = await small(first, second, index);
			const { layout } = layoutTree(g, geometryFor(16), NEVER_FAR, 'sans-serif');
			expect([...layout.persons.keys()].sort(), `${first} > ${second}`).toEqual([...line.people].sort());
		}
	});
});
