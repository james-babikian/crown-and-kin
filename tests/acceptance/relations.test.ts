import { describe, expect, it } from 'vitest';
import type { Relation } from '../../src/core/relations';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { fixtureSource } from './load';
import { graphOf, lowers, relationsModule, relationText, sample12, SPEC_4, type ExpectedNames } from './relations-support';

/*
 * Relation names (spec §13.1, D40–D46): acceptance tests written from the spec before the build
 * (WP7.0). They fail until WP7.1 adds `src/core/relations.ts` and WP7.2 adds the sheet texts.
 *
 * Sample tree 12 keeps the expected names in its comments, worked out by hand from the §13.1 rules
 * (option A everywhere). The golden test compares the whole table for each marked person, so any
 * change anywhere shows as one diff. The reasoning for the hard cases:
 *
 * - Ivo (Gwen): common ancestors Odo+Bertha (Gwen→Alan→Odo, Ivo→Brand→Odo: a = b = 2) and
 *   Hugo+Clara (Gwen→Dana→Hugo, Ivo→Edith→Hugo: a = b = 2). The same cousin name from two couples:
 *   "Double first cousin". Sigmund gives no candidate: both paths leave him through Hugo.
 * - Cass (child of the first cousins Ivo and Kit): for Gwen, a = 2 and b = 3 through both couples,
 *   so "Double first cousin once removed"; for Leo a = b = 3 through both couples, "Double second
 *   cousin". For Alan the two routes (Ivo→Brand, Kit→Cora) meet the same couple Odo+Bertha with the
 *   same (a, b) = (1, 3): one candidate, "Great-niece", not double (double is only for cousins).
 * - Kester (Gwen): X = Alan, c1 = Gwen {alan, dana}, c2 = Kester {alan, fenna}: "Half-brother". He is a
 *   child of Fenna, who married Gwen's father, but he shares Alan with Gwen, so no step-sibling.
 * - Tamsin (Gwen): a child of Fenna by Rolf, Fenna married Alan, and she shares no parent with Gwen:
 *   "Stepsister" (rule 3). For Leo she has no name: Fenna married his grandfather, not a parent.
 * - Mabel and Nia list only Kester, so they are full sisters; for Gwen X = Alan and the children of
 *   Alan where the paths leave are Gwen and Kester (half): "Half-niece"; Nia has no sex, so the
 *   neutral form carries "half" on the inner word: "Half-sibling's child". For Leo X = Alan,
 *   c1 = Harold, c2 = Kester: "Half first cousin". Mabel married her father Kester, but she is a blood
 *   relative, so rule 1 ("aunt by marriage" for Leo) does not apply to her.
 * - Tobin (Kester and Mabel): rule 1 takes the shortest b for each X, so for Gwen X = Alan gives
 *   (1, 2) through Kester: "Half-nephew" (the longer path through Mabel adds nothing).
 * - Wynn lists only a rumoured father (Harold): Gwen "Rumoured nephew" (X = Alan+Dana, full), Alan
 *   "Rumoured grandson", Leo "Rumoured half-brother" (Leo's birth parents {harold, una} differ from
 *   Wynn's rumoured parents {harold}). Rule 3 does not make him Leo's stepbrother: they share Harold.
 * - Nell is Cora's adopted daughter: "Adoptive first cousin" (Gwen), "Adoptive niece" (Alan). The
 *   word "adopted" is only for a descendant of the marked person through the adoption; the spec's
 *   own example gives the adopted Tomas "Adoptive brother". Her husband Rafe drops "adoptive":
 *   "First cousin by marriage" (Gwen), "Nephew by marriage" (Alan).
 * - Orla married Kester and then Jory: rule 1 gives one name for each marriage. Gwen: Kester is her
 *   half-brother ("Sister-in-law", half left out) and Jory her first cousin ("first cousin by
 *   marriage"); Alan: son ("Daughter-in-law") and nephew ("niece by marriage"); Leo: half-uncle
 *   ("Aunt by marriage") and first cousin once removed ("first cousin once removed by marriage").
 * - Pim is Tamsin's son and Alan's ward: "Ward" (distance 1) before "step-grandson" (a grandchild of
 *   Alan's wife Fenna through a stepchild; distance 1 + 2). The ward link does not continue, so Pim
 *   has no name for Gwen. Cai is Leo's ward and his second cousin twice removed (a = 3, b = 5).
 * - Edith for Alan: rule 1 (Brand's wife) and rule 2 (Dana's sister) both give "sister-in-law"; each
 *   distinct name is listed once.
 * - Thea and Ysolde married Gwen's great-grandfather Sigmund and grandfather Hugo: "Step-grandmother"
 *   for Ysolde, but a great-grandparent is "any other", so Thea is "Great-grandfather's wife".
 *   For Alan they have no name (two marriages away). Maud is Dana's aunt: "Wife's aunt"; her son
 *   Nils is Dana's first cousin: "Wife's first cousin".
 * - Great forms: Leo's great-great-grandfather Sigmund (a = 4); Gwen's great-great-nephew Otto
 *   (b = 4); Alan's 3rd great-nephew Cai (a = 1, b = 5: b − 2 = 3 greats).
 *
 * "maybe" names (allowed, not required) are the §13.1 rule 2 names of people who are also blood
 * relatives of the marked person, for example Leo for Alan: Leo is the grandson of Alan's wife Dana
 * through Harold, who is not a stepchild, so rule 2 read word for word gives "wife's grandson". The
 * spec does not say whether rule 2 applies to a blood relative (see the WP7.0 report).
 */

const SAMPLE = sample12();

function expectedTable(marked: string): string {
	const names = SAMPLE.names.get(marked)!;
	return SAMPLE.people
		.map((id) => {
			const e = names.get(id)!;
			return `${id}: ${e.card ?? 'none'}${e.also.length ? `; also: ${e.also.join(', ')}` : ''}`;
		})
		.join('\n');
}

function actualTable(marked: string, rels: ReadonlyMap<string, readonly Relation[]>): string {
	const names = SAMPLE.names.get(marked)!;
	return SAMPLE.people
		.map((id) => {
			const list = rels.get(id);
			if (!list || !list.length) return `${id}: none`;
			const maybe = new Set(names.get(id)?.maybe ?? []);
			const others = lowers(list.slice(1)).filter((l) => l !== list[0].lower && !maybe.has(l));
			return `${id}: ${list[0].text}${others.length ? `; also: ${others.join(', ')}` : ''}`;
		})
		.join('\n');
}

describe('sample tree 12: the expected names are complete (spec §13.0 item 12)', () => {
	it('names 3 marked people, and every comment follows the format', () => {
		expect(SAMPLE.marked).toEqual(['gwen', 'alan', 'leo']);
		expect(SAMPLE.errors).toEqual([]);
	});

	it('every person has one expected name for each marked person', () => {
		const g = graphOf(SAMPLE.source);
		expect(SAMPLE.people).toEqual(g.people.map((p) => p.id));
		for (const m of SAMPLE.marked) expect([...SAMPLE.names.get(m)!.keys()], m).toEqual(SAMPLE.people);
	});

	it('each marked person is "You" in their own list', () => {
		for (const m of SAMPLE.marked) expect(SAMPLE.names.get(m)!.get(m)).toEqual<ExpectedNames>({ card: 'You', also: [], maybe: [] });
	});

	it('has no problems (well-formed; a close-kin marriage is valid data, spec §1)', () => {
		expect(graphOf(SAMPLE.source).issues).toEqual([]);
	});
});

describe('sample tree 12: every card for each marked person (golden, spec §13.1 acceptance)', () => {
	for (const marked of SAMPLE.marked) {
		it(`marked ${marked}: the card name of every person, and the sheet's other names`, async () => {
			const { computeRelations } = await relationsModule();
			const rels = computeRelations(graphOf(SAMPLE.source), marked);
			expect(actualTable(marked, rels)).toBe(expectedTable(marked));
		});

		it(`marked ${marked}: the "maybe" names are the only extra names, and each name is listed once`, async () => {
			const { computeRelations } = await relationsModule();
			const rels = computeRelations(graphOf(SAMPLE.source), marked);
			for (const [id, e] of SAMPLE.names.get(marked)!) {
				const list = rels.get(id) ?? [];
				const names = list.map((r) => r.lower);
				expect(new Set(names).size, `${id}: a name twice in ${names.join(', ')}`).toBe(names.length);
				const allowed = new Set([...(e.card ? [e.card.toLowerCase()] : []), ...e.also, ...e.maybe]);
				expect(names.filter((n) => !allowed.has(n)), id).toEqual([]);
			}
		});
	}

	it('a person with no relation is absent from the map; no one has an empty list', async () => {
		const { computeRelations } = await relationsModule();
		const rels = computeRelations(graphOf(SAMPLE.source), 'gwen');
		for (const id of ['quill', 'rolf', 'yara', 'wat', 'pim', 'zed']) expect(rels.has(id), id).toBe(false);
		for (const [id, list] of rels) expect(list.length, id).toBeGreaterThan(0);
	});

	it('text is lower with a capital first letter; "You" is the only self relation', async () => {
		const { computeRelations } = await relationsModule();
		const g = graphOf(SAMPLE.source);
		for (const marked of SAMPLE.marked) {
			for (const [id, list] of computeRelations(g, marked)) {
				for (const r of list) expect(r.text, `${marked} → ${id}`).toBe(r.lower.charAt(0).toUpperCase() + r.lower.slice(1));
				expect(list.some((r) => r.kind === 'self'), `${marked} → ${id}`).toBe(id === marked);
			}
			expect(computeRelations(g, marked).get(marked)).toMatchObject([{ text: 'You', lower: 'you', kind: 'self', distance: 0 }]);
		}
	});

	it('kinds and distances follow "Which name wins" rule 3 (relations.ts header)', async () => {
		const { computeRelations } = await relationsModule();
		const g = graphOf(SAMPLE.source);
		const pick = (marked: string, id: string) => computeRelations(g, marked).get(id)!.map((r) => [r.lower, r.kind, r.distance]);
		expect(pick('gwen', 'fenna')).toEqual([['stepmother', 'by-marriage', 2]]);
		expect(pick('gwen', 'tamsin')).toEqual([['stepsister', 'step-sibling', 3]]);
		expect(pick('gwen', 'thea')).toEqual([["great-grandfather's wife", 'by-marriage', 4]]);
		expect(pick('gwen', 'ysolde')).toEqual([['step-grandmother', 'by-marriage', 3]]);
		expect(pick('gwen', 'ivo')).toEqual([['double first cousin', 'blood', 4]]);
		expect(pick('gwen', 'cai')).toEqual([['first cousin 3 times removed', 'blood', 7]]);
		expect(pick('gwen', 'rafe')).toEqual([['first cousin by marriage', 'by-marriage', 5]]);
		expect(pick('alan', 'dana')).toEqual([['wife', 'partner', 1]]);
		expect(pick('alan', 'yara')).toEqual([['lover', 'partner', 1]]);
		expect(pick('alan', 'wat')).toEqual([['ward', 'ward', 1]]);
		expect(pick('alan', 'pim')).toEqual([
			['ward', 'ward', 1],
			['step-grandson', 'by-marriage', 3],
		]);
		expect(pick('alan', 'nils')).toEqual([["wife's first cousin", 'by-marriage', 5]]);
		expect(pick('alan', 'cai')).toEqual([['3rd great-nephew', 'blood', 6]]);
		expect(pick('leo', 'orla')).toEqual([
			['aunt by marriage', 'by-marriage', 4],
			['first cousin once removed by marriage', 'by-marriage', 6],
		]);
		expect(pick('leo', 'cai')).toEqual([
			['ward', 'ward', 1],
			['second cousin twice removed', 'blood', 8],
		]);
		expect(pick('leo', 'wynn')).toEqual([['rumoured half-brother', 'blood', 2]]);
		expect(pick('leo', 'sigmund')).toEqual([['great-great-grandfather', 'blood', 4]]);
	});

	it('a guardian is "Guardian" (the parent side of a ward link)', async () => {
		const { computeRelations } = await relationsModule();
		const g = graphOf(SAMPLE.source);
		expect(computeRelations(g, 'wat').get('alan')?.map((r) => [r.text, r.kind, r.distance])).toEqual([['Guardian', 'guardian', 1]]);
		// Relations do not continue through a ward link: Wat has no other relative.
		expect([...computeRelations(g, 'wat').keys()].sort()).toEqual(['alan', 'wat']);
	});

	it('the results are frozen (the view shares them)', async () => {
		const { computeRelations } = await relationsModule();
		const list = computeRelations(graphOf(SAMPLE.source), 'alan').get('pim')!;
		expect(Object.isFrozen(list)).toBe(true);
		expect(Object.isFrozen(list[0])).toBe(true);
		expect(Object.isFrozen(list[0].line)).toBe(true);
		expect(Object.isFrozen(list[0].line.people)).toBe(true);
	});

	it('a mark that names nobody gives an empty map', async () => {
		const { computeRelations } = await relationsModule();
		expect(computeRelations(graphOf(SAMPLE.source), 'nobody').size).toBe(0);
	});
});

describe('the sheet texts (spec §13.1 "What the user sees"; RelationTexts.relationSummary)', () => {
	it('sample tree 12: one name, two names, the marked person and no relation', async () => {
		const { computeRelations } = await relationsModule();
		const summary = relationText('relationSummary');
		const alan = computeRelations(graphOf(SAMPLE.source), 'alan');
		expect(summary(alan.get('hugo'), false)).toEqual({ main: 'Relation to you: Father-in-law.' });
		expect(summary(alan.get('orla'), false)).toEqual({ main: 'Relation to you: Daughter-in-law.', also: 'Also: niece by marriage.' });
		expect(summary(alan.get('pim'), false)).toEqual({ main: 'Relation to you: Ward.', also: 'Also: step-grandson.' });
		expect(summary(alan.get('alan'), true)).toEqual({ main: 'This is you.' });
		expect(summary(alan.get('quill'), false)).toEqual({ main: 'No relation to you in this tree.' });
	});

	it('up to 3 other names, then ", and N more" when there are more than 4 names', () => {
		const summary = relationText('relationSummary');
		const rel = (lower: string, distance: number): Relation => ({
			text: lower.charAt(0).toUpperCase() + lower.slice(1),
			lower,
			kind: 'blood',
			distance,
			line: { people: [], links: [], unions: [] },
		});
		const names = ['second cousin', 'brother-in-law', 'third cousin', 'fourth cousin', 'fifth cousin', 'sixth cousin'];
		const rels = names.map((n, i) => rel(n, i + 6));
		expect(summary(rels.slice(0, 3), false)).toEqual({ main: 'Relation to you: Second cousin.', also: 'Also: brother-in-law, third cousin.' });
		expect(summary(rels.slice(0, 4), false).also).toBe('Also: brother-in-law, third cousin, fourth cousin.');
		expect(summary(rels.slice(0, 5), false).also).toBe('Also: brother-in-law, third cousin, fourth cousin, and 1 more.');
		expect(summary(rels, false).also).toBe('Also: brother-in-law, third cousin, fourth cousin, and 2 more.');
	});
});

/**
 * The §4 tree with the people of the §13.1 "Other examples": Aldric's parents Aldous and Agnes,
 * Aldous's father Edwin and brother Godric (whose son Hamo and grandson Ivo are Roderick's father's
 * first cousin and Roderick's second cousin), Aldric's sister Maud and her husband Osric, Roderick's
 * sister Elinor and her husband Piers, and Roderick's wife Mira and her brother Bran.
 */
const SPEC_4_WIDER = SPEC_4.replace('    born: 1102\n', '    born: 1102\n    parents: [aldous, agnes]\n')
	.replace(
		'\nunions:\n',
		`  - id: edwin
    name: Edwin
    sex: m
  - id: aldous
    name: Aldous
    sex: m
    parents: [edwin]
  - id: agnes
    name: Agnes
    sex: f
  - id: godric
    name: Godric
    sex: m
    parents: [edwin]
  - id: hamo
    name: Hamo
    sex: m
    parents: [godric]
  - id: ivo
    name: Ivo
    sex: m
    parents: [hamo]
  - id: maud
    name: Maud
    sex: f
    parents: [aldous, agnes]
  - id: osric
    name: Osric
    sex: m
  - id: elinor
    name: Elinor
    sex: f
    parents: [aldric, isolde]
  - id: piers
    name: Piers
    sex: m
  - id: hal
    name: Hal
    sex: m
  - id: mira
    name: Mira
    sex: f
    parents: [hal]
  - id: bran
    name: Bran
    sex: m
    parents: [hal]

unions:
`,
	)
	.concat('  - partners: [aldous, agnes]\n  - partners: [maud, osric]\n  - partners: [elinor, piers]\n  - partners: [roderick, mira]\n');

describe('the §13.1 examples', () => {
	const cards = async (source: string, marked: string) => {
		const { computeRelations } = await relationsModule();
		const rels = computeRelations(graphOf(source), marked);
		return (id: string) => rels.get(id)?.[0]?.text;
	};

	it('the §4 tree, Roderick marked', async () => {
		const card = await cards(SPEC_4, 'roderick');
		expect(card('aldric')).toBe('Father');
		expect(card('isolde')).toBe('Mother');
		// Her known parents {Aldric} differ from Roderick's {Aldric, Isolde}.
		expect(card('wren')).toBe('Half-sister');
		// His adoptive parents are Roderick's birth parents, so the relation is full.
		expect(card('tomas')).toBe('Adoptive brother');
		expect(card('gareth')).toBe('Rumoured father');
		expect(card('roderick')).toBe('You');
	});

	it('the §4 tree, Wren marked', async () => {
		const card = await cards(SPEC_4, 'wren');
		expect(card('roderick')).toBe('Half-brother');
		// Married to Wren's father, not her parent.
		expect(card('isolde')).toBe('Stepmother');
		expect(card('aldric')).toBe('Father');
		// Derived, not in the spec's list: X = Aldric, Wren's birth parents {aldric} differ from Tomas's
		// adoptive parents {aldric, isolde}, so half; the adoptive link adds "adoptive".
		expect(card('tomas')).toBe('Adoptive half-brother');
	});

	it('the §4 tree with the "Other examples", Roderick marked', async () => {
		const card = await cards(SPEC_4_WIDER, 'roderick');
		// The brother of Roderick's wife (rule 2) and the husband of his sister (rule 1).
		expect(card('bran')).toBe('Brother-in-law');
		expect(card('piers')).toBe('Brother-in-law');
		// The husband of his father's sister.
		expect(card('osric')).toBe('Uncle by marriage');
		// A grandson of his grandfather's brother: a = b = 3.
		expect(card('ivo')).toBe('Second cousin');
		// His father's first cousin: a = 3, b = 2.
		expect(card('hamo')).toBe('First cousin once removed');
		expect(card('mira')).toBe('Wife');
		expect(card('hal')).toBe('Father-in-law');
		// The first examples still hold in the wider tree.
		expect(card('wren')).toBe('Half-sister');
		expect(card('tomas')).toBe('Adoptive brother');
		expect(card('gareth')).toBe('Rumoured father');
	});

	it('fixture 3, Conrad marked: his first-cousin wife shows "Wife", and the sheet adds "Also: first cousin"', async () => {
		const { computeRelations } = await relationsModule();
		const rels = computeRelations(graphOf(fixtureSource('03')), 'conrad');
		expect(rels.get('lisette')?.[0].text).toBe('Wife');
		expect(lowers(rels.get('lisette'))).toEqual(['wife', 'first cousin']);
		expect(relationText('relationSummary')(rels.get('lisette'), false)).toEqual({ main: 'Relation to you: Wife.', also: 'Also: first cousin.' });
	});

	it('fixture 11, Alys marked: her father shows "Husband", and the sheet adds "Also: father"', async () => {
		const { computeRelations } = await relationsModule();
		const rels = computeRelations(graphOf(fixtureSource('11')), 'alys');
		expect(rels.get('corwin')?.[0].text).toBe('Husband');
		expect(lowers(rels.get('corwin'))).toEqual(['husband', 'father']);
		expect(relationText('relationSummary')(rels.get('corwin'), false)).toEqual({ main: 'Relation to you: Husband.', also: 'Also: father.' });
	});
});

describe('words for each sex (spec §13.1, D12)', () => {
	it('Rowan (sex: x) gets the neutral words; with sex: m only Rowan\'s words change', async () => {
		const { computeRelations } = await relationsModule();
		const before = graphOf(SAMPLE.source);
		const source = SAMPLE.source.replace('    sex: x\n', '    sex: m\n');
		expect(source).not.toBe(SAMPLE.source);
		const after = graphOf(source);
		const neutral = { gwen: "Sibling's child", alan: 'Grandchild', leo: 'Sibling' };
		const male = { gwen: 'Nephew', alan: 'Grandson', leo: 'Brother' };
		for (const marked of ['gwen', 'alan', 'leo'] as const) {
			const a = computeRelations(before, marked);
			const b = computeRelations(after, marked);
			expect(a.get('rowan')?.[0].text, marked).toBe(neutral[marked]);
			expect(b.get('rowan')?.[0].text, marked).toBe(male[marked]);
			for (const p of before.people) {
				if (p.id === 'rowan') continue;
				expect(lowers(b.get(p.id)), `${marked} → ${p.id}`).toEqual(lowers(a.get(p.id)));
			}
		}
	});

	it('no sex, or any other value, gives the neutral words and no warning', async () => {
		const { computeRelations } = await relationsModule();
		for (const sex of ['', '    sex: x\n', '    sex: M\n', '    sex: other\n']) {
			const source = SAMPLE.source.replace('  - id: nia\n    name: Nia\n', `  - id: nia\n    name: Nia\n${sex}`);
			const g = graphOf(source);
			expect(g.issues, JSON.stringify(sex)).toEqual([]);
			expect(computeRelations(g, 'gwen').get('nia')?.[0].text, JSON.stringify(sex)).toBe("Half-sibling's child");
			expect(computeRelations(g, 'alan').get('nia')?.[0].text, JSON.stringify(sex)).toBe('Grandchild');
		}
	});
});

describe('other cases (spec §13.1 "Rules: other cases")', () => {
	it('fixture 5: the cycle ends, and names come from the drawn model', async () => {
		const { computeRelations } = await relationsModule();
		const g = graphOf(fixtureSource('05'));
		const osmund = computeRelations(g, 'osmund');
		// The first "hal" is the one drawn (duplicate ids, §8).
		expect(osmund.get('hal')?.[0].text).toBe('Son');
		// Joss has sex: x.
		expect(osmund.get('joss')?.[0].text).toBe('Child');
		expect(osmund.get('wynn')?.[0].text).toBe('Daughter');
		expect(osmund.get('piers')?.[0].text).toBe('Son');
		expect(osmund.get('tilda')?.[0].text).toBe('Daughter');
		expect(osmund.get('cole')?.[0].text).toBe('Son');
		const ranulf = computeRelations(g, 'ranulf');
		// An unknown parent type counts as birth (§8, §13.1).
		expect(ranulf.get('edda')?.[0].text).toBe('Daughter');
		// Joss's third birth parent is kept as a side link after validation.
		expect(ranulf.get('joss')?.[0].text).toBe('Child');
		// An unknown union type is drawn like a marriage and named like one.
		expect(ranulf.get('sela')?.[0].text).toBe('Wife');
		for (const marked of ['arn', 'bram', 'col']) {
			const rels = computeRelations(g, marked);
			expect(rels.get(marked)?.[0].text).toBe('You');
			// Two of the three cycle links stay, so the other two people are relatives.
			for (const other of ['arn', 'bram', 'col']) expect(rels.get(other)?.length ?? 0, `${marked} → ${other}`).toBeGreaterThan(0);
		}
	});

	it('several unions count; a far couple has the same names as a near one (D10)', async () => {
		const { computeRelations } = await relationsModule();
		// Kester married Orla and then Mabel: both are "Wife" for him.
		const kester = computeRelations(graphOf(SAMPLE.source), 'kester');
		expect(kester.get('orla')?.[0].text).toBe('Wife');
		expect(kester.get('mabel')?.[0].text).toBe('Wife');
		// Ivo and Kit have a betrothal and then a marriage: the last-listed union names the pair.
		expect(computeRelations(graphOf(SAMPLE.source), 'ivo').get('kit')?.[0].text).toBe('Wife');
	});

	it('the partner table: betrothal, concubinage, affair and an implicit union', async () => {
		const { computeRelations } = await relationsModule();
		const block = (type: string, sex: string) =>
			`people:\n  - id: a\n    name: A\n    sex: m\n  - id: b\n    name: B\n${sex}${type ? `unions:\n  - partners: [a, b]\n    type: ${type}\n` : '  - id: c\n    name: C\n    parents: [a, b]\n'}`;
		const name = (type: string, sex = '    sex: f\n') => computeRelations(graphOf(block(type, sex)), 'a').get('b')?.[0].text;
		expect(name('marriage')).toBe('Wife');
		expect(name('marriage', '    sex: m\n')).toBe('Husband');
		expect(name('marriage', '')).toBe('Spouse');
		expect(name('handfasting')).toBe('Wife');
		expect(name('betrothal')).toBe('Betrothed');
		expect(name('concubinage')).toBe('Partner in concubinage');
		expect(name('affair')).toBe('Lover');
		expect(name('')).toBe('Co-parent');
	});

	it('the relations key changes with ids, sex, links, unions and the mark, not with names', async () => {
		const { relationsKey } = await relationsModule();
		const key = (source: string, me = 'gwen') => relationsKey(graphOf(source), me);
		const base = key(SAMPLE.source);
		expect(key(SAMPLE.source)).toBe(base);
		expect(key(SAMPLE.source.replace('    name: Quill\n', '    name: Quill the Elder\n'))).toBe(base);
		expect(key(SAMPLE.source.replace('    sex: x\n', '    sex: m\n'))).not.toBe(base);
		expect(key(SAMPLE.source, 'leo')).not.toBe(base);
		expect(key(SAMPLE.source.replace('    parents: [{id: harold, type: rumoured}]\n', '    parents: [{id: harold, type: adoptive}]\n'))).not.toBe(base);
		expect(key(SAMPLE.source.replace('  - partners: [alan, yara]\n    type: affair\n', '  - partners: [alan, yara]\n'))).not.toBe(base);
	});

	it('fixture 7 with a mark: all names in under 20 ms after warm-up (soft check: logs the time)', async () => {
		const { computeRelations } = await relationsModule();
		const r = parseDynasty(fixtureSource('07'));
		if (!r.ok) throw new Error('fixture 7 does not parse');
		const g = deriveFamilies(r.tree);
		const me = g.people[g.people.length - 1].id;
		for (let i = 0; i < 3; i++) computeRelations(g, me);
		const times: number[] = [];
		for (let i = 0; i < 7; i++) {
			const t = performance.now();
			computeRelations(g, me);
			times.push(performance.now() - t);
		}
		times.sort((x, y) => x - y);
		const median = times[3];
		const text = `computeRelations, fixture 7 (${g.people.length} people, me = ${me}): median ${median.toFixed(2)} ms, best ${times[0].toFixed(2)} ms; target under 20 ms (spec §13.1)`;
		if (median < 20) console.log(text);
		else console.warn(`SLOW: ${text}`);
		expect(computeRelations(g, me).get(me)?.[0].text).toBe('You');
	});
});
