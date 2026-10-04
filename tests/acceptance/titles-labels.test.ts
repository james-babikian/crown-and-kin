import { describe, expect, it } from 'vitest';
import type { Holder } from '../../src/core/types';
import { fixtureSource } from './load';
import { BLOCKS_13, BODY_13, graphOf, sample13, titleLine, titleOf, titlesModule } from './titles-support';

/*
 * Spec §13.3 (the title text line, D56, D61–D63), §13.4 (holder list, table note, Delete title),
 * §13.5 (ruler name and number, D58; picker and Find) and §13.11 (note names), through the frozen
 * helpers of `src/core/titles.ts`. Sample tree 13 gives each person's
 * expected card texts in comments. These tests wait for WP 8.1.
 */

const h = (fields: Partial<Holder>, index = 0): Holder => ({ index, ...fields });

describe('sample tree 13: every card shows the texts in its comments (spec §13.3, §13.5 acceptance)', () => {
	for (const block of [0, 1]) {
		const s = sample13(block);
		it(`block ${block + 1}: the comments are complete`, () => {
			expect(s.errors).toEqual([]);
			expect(s.cards.size).toBe(block === 0 ? 14 : 1);
		});
		for (const [id, want] of s.cards) {
			it(`block ${block + 1}, ${id}`, async () => {
				const { cardLabels, searchNames, pickerSuffix } = await titlesModule();
				const g = graphOf(s.body);
				const label = cardLabels(g).get(id);
				expect(label).toBeDefined();
				const l = label!;
				const personName = g.byId.get(id)!.name;
				expect({
					name: l.name,
					titleLine: titleLine(l),
					holds: l.holdings.map((x) => x.title.id),
					shown: l.shown?.title.id ?? null,
					selected: l.selected,
					search: [...searchNames(l, personName)].sort(),
					picker: pickerSuffix(l, personName) ?? null,
				}).toEqual({ ...want, search: [...want.search].sort() });
			});
		}
	}
});

describe('card labels: the parts (contract CardLabel, spec §13.3)', () => {
	it('one label for every person, memoised per graph (contract rule 4)', async () => {
		const { cardLabels } = await titlesModule();
		const g = graphOf(BODY_13);
		const labels = cardLabels(g);
		expect([...labels.keys()].sort()).toEqual(g.people.map((p) => p.id).sort());
		expect(cardLabels(g)).toBe(labels);
		expect(cardLabels(graphOf(BODY_13))).not.toBe(labels);
	});

	it('the title and the reign are separate: the written title with the reign of the first title (Bertrand)', async () => {
		const { cardLabels } = await titlesModule();
		const l = cardLabels(graphOf(BODY_13)).get('bertrand')!;
		expect([l.title, l.reign, l.selected]).toEqual(['Count Palatine of Orsini', '(r. 1090–1128)', false]);
	});

	it('card-title replaces a written title (D63, King Roderick); the written text stays in the tree', async () => {
		const { cardLabels } = await titlesModule();
		const g = graphOf(BODY_13);
		const l = cardLabels(g).get('king-roderick')!;
		expect([l.title, l.reign, l.selected]).toEqual(['King of the Vale', '(r. from 1228)', true]);
		expect(g.byId.get('king-roderick')!.title).toBe('Prince of the Vale');
	});

	it('card-title selects the second title: its name, its reign and its number (D62, the younger Aldric)', async () => {
		const { cardLabels } = await titlesModule();
		const l = cardLabels(graphOf(BODY_13)).get('young-aldric')!;
		expect(l.shown?.title.id).toBe('king-of-the-vale');
		expect(l.shown?.entries.map((e) => e.index)).toEqual([0]);
		expect([l.name, l.title, l.reign]).toEqual(['Aldric III', 'King of the Vale', '(r. 1180–1210)']);
		// The sheet lists all titles, in the order of the titles list.
		expect(l.holdings.map((x) => [x.title.id, x.entries.map((e) => e.index)])).toEqual([
			['duke-of-valmont', [5]],
			['king-of-the-vale', [0]],
		]);
	});

	it('a restored ruler: both entries of the title, in list order, and the number of the first entry that has one', async () => {
		const { cardLabels } = await titlesModule();
		const l = cardLabels(graphOf(BODY_13)).get('roderick')!;
		expect(l.holdings.map((x) => [x.title.id, x.entries.map((e) => e.index)])).toEqual([['duke-of-valmont', [2, 4]]]);
		expect([l.name, l.reign]).toEqual(['Roderick I', '(r. 1150–1158, from 1163)']);
	});

	it('a number on a second title does not show on the card (Edmund)', async () => {
		const { cardLabels } = await titlesModule();
		const l = cardLabels(graphOf(BODY_13)).get('edmund')!;
		expect([l.name, l.title, l.reign, l.selected]).toEqual(['Edmund Valmont', 'Duke of Valmont', '(r. 1210–1228)', false]);
	});

	it('a bad card-title is ignored: the card follows the rules as if it were absent (Isolde)', async () => {
		const { cardLabels } = await titlesModule();
		const l = cardLabels(graphOf(BODY_13)).get('isolde')!;
		expect(l).toEqual({ holdings: [], selected: false, name: 'Isolde Orsini', title: 'Duchess of Valmont' });
	});

	it('a tree with no titles: every label is the 0.1 card text', async () => {
		const { cardLabels } = await titlesModule();
		const g = graphOf(fixtureSource('08'));
		for (const p of g.people) {
			const l = cardLabels(g).get(p.id)!;
			expect(l.holdings, p.id).toEqual([]);
			expect(l.shown, p.id).toBeUndefined();
			expect(l.reign, p.id).toBeUndefined();
			expect([l.name, l.title ?? undefined, l.selected], p.id).toEqual([p.name, p.title, false]);
		}
	});

	it('a card-title that selects the first title of a person with no written title: the same card, selected (§13.3)', async () => {
		const { cardLabels } = await titlesModule();
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders: [{person: a, number: II, from: 1100}]\npeople:\n  - id: a\n    name: Aldo Brand\n    card-title: duke\n');
		expect(g.issues).toEqual([]);
		const l = cardLabels(g).get('a')!;
		expect([l.name, l.title, l.reign, l.selected]).toEqual(['Aldo II', 'Duke', '(r. from 1100)', true]);
	});

	it('the ruler name on the card comes from the entry with the number, with its as (§13.5)', async () => {
		const { cardLabels } = await titlesModule();
		const g = graphOf(
			'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: a, as: Wolf, from: 1100, to: 1110}\n      - {person: a, as: Leo, number: IV, from: 1115}\n' +
				'people:\n  - id: a\n    name: Ser Aldo Brand\n',
		);
		const l = cardLabels(g).get('a')!;
		expect([l.name, l.title, l.reign]).toEqual(['Leo IV', 'Duke', '(r. 1100–1110, from 1115)']);
	});
});

describe('reign text (spec §13.3 forms)', () => {
	it('one entry: both years, start only, end only, neither', async () => {
		const { entryReign, reignText } = await titlesModule();
		expect(entryReign(h({ from: '1131', to: '1160' }))).toBe('1131–1160');
		expect(entryReign(h({ from: '1131' }))).toBe('from 1131');
		expect(entryReign(h({ to: '1160' }))).toBe('until 1160');
		expect(entryReign(h({}))).toBeUndefined();
		expect(reignText([h({ from: '1131', to: '1160' })])).toBe('(r. 1131–1160)');
		expect(reignText([h({ from: '1131' })])).toBe('(r. from 1131)');
		expect(reignText([h({ to: '1160' })])).toBe('(r. until 1160)');
		expect(reignText([h({ person: 'a' })])).toBeUndefined();
		expect(reignText([])).toBeUndefined();
	});

	it('values are free text, never read as dates (§4.1)', async () => {
		const { reignText } = await titlesModule();
		expect(reignText([h({ from: 'the Year of the Comet', to: '12 AC' })])).toBe('(r. the Year of the Comet–12 AC)');
		expect(reignText([h({ from: '1102-03-04' })])).toBe('(r. from 1102-03-04)');
	});

	it('two reigns: in list order, "r." only once, each later entry in its own form', async () => {
		const { reignText } = await titlesModule();
		expect(reignText([h({ from: '1131', to: '1140' }), h({ from: '1145', to: '1160' }, 1)])).toBe('(r. 1131–1140, 1145–1160)');
		expect(reignText([h({ from: '1131', to: '1140' }), h({ from: '1145' }, 1)])).toBe('(r. 1131–1140, from 1145)');
		expect(reignText([h({ to: '1140' }), h({ from: '1145', to: '1160' }, 1)])).toBe('(r. until 1140, 1145–1160)');
		expect(reignText([h({ from: '1100', to: '1110' }), h({ from: '1120', to: '1130' }, 1), h({ to: '1150' }, 2)])).toBe('(r. 1100–1110, 1120–1130, until 1150)');
	});

	it('an entry with no reign adds nothing; "r." goes before the first entry that has one', async () => {
		const { reignText } = await titlesModule();
		expect(reignText([h({ from: '1131', to: '1140' }), h({ number: 'II' }, 1)])).toBe('(r. 1131–1140)');
		expect(reignText([h({ number: 'II' }), h({ from: '1145' }, 1)])).toBe('(r. from 1145)');
		expect(reignText([h({}), h({}, 1)])).toBeUndefined();
	});
});

describe('ruler name, search names and the picker suffix (spec §13.5)', () => {
	it('ruler name: as, else the first word of the person name, else the holder name', async () => {
		const { rulerName } = await titlesModule();
		expect(rulerName(h({ person: 'gareth', as: 'Gareth' }), 'Ser Gareth Orsini')).toBe('Gareth');
		expect(rulerName(h({ person: 'aldric' }), 'Aldric Valmont')).toBe('Aldric');
		expect(rulerName(h({ person: 'wren' }), 'Wren')).toBe('Wren');
		expect(rulerName(h({ name: 'Orso the Old' }), undefined)).toBe('Orso the Old');
		// A person who is not in the tree, with a name: the name (sample tree 13, Cosimo).
		expect(rulerName(h({ person: 'cosimo', name: 'Cosimo Orsini' }), undefined)).toBe('Cosimo Orsini');
		// With both, person counts (§13.4).
		expect(rulerName(h({ person: 'aldric', name: 'The Old Duke' }), 'Aldric Valmont')).toBe('Aldric');
		expect(rulerName(h({ name: 'Orso the Old', as: 'Orso' }), undefined)).toBe('Orso');
	});

	it('Find "Aldric II" finds the right person; the name-only Aldric I is nobody in the tree', async () => {
		const { cardLabels, searchNames } = await titlesModule();
		const g = graphOf(BODY_13);
		const labels = cardLabels(g);
		const who = (text: string) => g.people.filter((p) => searchNames(labels.get(p.id)!, p.name).includes(text)).map((p) => p.id);
		expect(who('Aldric II')).toEqual(['aldric']);
		expect(who('Aldric III')).toEqual(['young-aldric']);
		expect(who('Aldric I')).toEqual([]);
		expect(who('Gareth I')).toEqual(['gareth']);
		expect(who('Edmund I')).toEqual(['edmund']);
		// The picker row tells the two people named Aldric Valmont apart.
		const { pickerSuffix } = await titlesModule();
		expect(pickerSuffix(labels.get('aldric')!, 'Aldric Valmont')).toBe('(Aldric II)');
		expect(pickerSuffix(labels.get('young-aldric')!, 'Aldric Valmont')).toBe('(Aldric III)');
	});

	it('every numbered entry is searchable, once each; the suffix is that of the shown title, else the first numbered entry', async () => {
		const { cardLabels, searchNames, pickerSuffix } = await titlesModule();
		const body = (cardTitle: string) =>
			'titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: h, number: IV, from: 1100}\n      - {person: h, number: IV, from: 1120}\n' +
			'  - id: king\n    name: King\n    holders:\n      - {person: h, as: Harald, number: II, from: 1110}\n' +
			`people:\n  - id: h\n    name: Hal Brand\n${cardTitle}`;
		const plain = graphOf(body(''));
		const lp = cardLabels(plain).get('h')!;
		expect([...searchNames(lp, 'Hal Brand')].sort()).toEqual(['Hal IV', 'Harald II']);
		expect(pickerSuffix(lp, 'Hal Brand')).toBe('(Hal IV)');
		expect(lp.name).toBe('Hal IV');
		const selected = graphOf(body('    card-title: king\n'));
		const ls = cardLabels(selected).get('h')!;
		expect([...searchNames(ls, 'Hal Brand')].sort()).toEqual(['Hal IV', 'Harald II']);
		expect(pickerSuffix(ls, 'Hal Brand')).toBe('(Harald II)');
		expect(ls.name).toBe('Harald II');
	});

	it('no numbered entry: no search names and no suffix', async () => {
		const { cardLabels, searchNames, pickerSuffix } = await titlesModule();
		const g = graphOf(BODY_13);
		for (const id of ['bertrand', 'piero', 'luca', 'isolde', 'king-roderick', 'elinor']) {
			const l = cardLabels(g).get(id)!;
			expect(searchNames(l, g.byId.get(id)!.name), id).toEqual([]);
			expect(pickerSuffix(l, g.byId.get(id)!.name), id).toBeUndefined();
		}
	});
});

describe('"Show on the card" (D62, §13.3 tree text): cardTitleOp', () => {
	it('another title: writes card-title', async () => {
		const { cardTitleOp } = await titlesModule();
		const g = graphOf(BODY_13);
		expect(cardTitleOp(g, 'edmund', 'king-of-the-vale')).toEqual({ kind: 'set-person-fields', id: 'edmund', fields: { 'card-title': 'king-of-the-vale' } });
		expect(cardTitleOp(g, 'young-aldric', 'king-of-the-vale')).toEqual({ kind: 'set-person-fields', id: 'young-aldric', fields: { 'card-title': 'king-of-the-vale' } });
	});

	it('the first title of a person with no written title: removes card-title instead (same card)', async () => {
		const { cardTitleOp } = await titlesModule();
		const g = graphOf(BODY_13);
		expect(cardTitleOp(g, 'young-aldric', 'duke-of-valmont')).toEqual({ kind: 'set-person-fields', id: 'young-aldric', fields: { 'card-title': null } });
		expect(cardTitleOp(g, 'edmund', 'duke-of-valmont')).toEqual({ kind: 'set-person-fields', id: 'edmund', fields: { 'card-title': null } });
	});

	it('the first title of a person with a written title: writes card-title, so the title replaces the written text (D63)', async () => {
		const { cardTitleOp } = await titlesModule();
		const g = graphOf(BODY_13);
		expect(cardTitleOp(g, 'bertrand', 'count-of-orsini')).toEqual({ kind: 'set-person-fields', id: 'bertrand', fields: { 'card-title': 'count-of-orsini' } });
		expect(cardTitleOp(g, 'king-roderick', 'king-of-the-vale')).toEqual({ kind: 'set-person-fields', id: 'king-roderick', fields: { 'card-title': 'king-of-the-vale' } });
	});
});

describe('Delete title confirmation (spec §13.4): describeDeleteTitle', () => {
	it('holders = the written holder items; cards = the people whose shown title it is', async () => {
		const { describeDeleteTitle } = await titlesModule();
		const g = graphOf(BODY_13);
		// Aldric, Roderick, Gareth, Edmund. Isolde's card-title is not valid; the younger Aldric shows King.
		expect(describeDeleteTitle(g, 'duke-of-valmont')).toEqual({ holders: 7, cards: 4 });
		// All 9 written items, also the two that do not show. Bertrand (written title), Matteo, Piero, Luca.
		expect(describeDeleteTitle(g, 'count-of-orsini')).toEqual({ holders: 9, cards: 4 });
		// The younger Aldric and King Roderick; the item that is not a holder counts as written.
		expect(describeDeleteTitle(g, 'king-of-the-vale')).toEqual({ holders: 4, cards: 2 });
		expect(describeDeleteTitle(g, 'warden-of-the-marches').cards).toBe(0);
	});
});

describe('the table note (D55, §13.4): noteName and holderTable', () => {
	it('note name: the §13.11 cleaning, with the fallback when nothing is left', async () => {
		const { noteName } = await titlesModule();
		expect(noteName('Dukes of Valmont', 'duke-of-valmont')).toBe('Dukes of Valmont');
		expect(noteName('Kings: of / the Vale?', 'king')).toBe('Kings of the Vale');
		expect(noteName('  [[Lords]]  #1 ', 'lord')).toBe('Lords 1');
		expect(noteName('A*B"C<D>E|F^G\\H', 'x')).toBe('ABCDEFGH');
		expect(noteName('.Dukes', 'x')).toBe('Dukes');
		expect(noteName('\\/:*?"<>|#^[]', 'duke-of-valmont')).toBe('duke-of-valmont');
		expect(noteName('   ', 'duke-of-valmont')).toBe('duke-of-valmont');
	});

	/** The rows of the first Markdown table in `text`, cells trimmed, "\|" kept as "|"; the separator row left out. */
	function tableRows(text: string): string[][] {
		const rows = text
			.split('\n')
			.filter((l) => l.trim().startsWith('|'))
			.map((l) =>
				l
					.trim()
					.replace(/^\|/, '')
					.replace(/(?<!\\)\|$/, '')
					.split(/(?<!\\)\|/)
					.map((c) => c.trim().replace(/\\\|/g, '|')),
			);
		return rows.filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c)));
	}

	it('Dukes of Valmont: columns Ruler, Name, Reign; one row per holder entry, in list order', async () => {
		const { holderTable } = await titlesModule();
		const g = graphOf(BODY_13);
		const rows = tableRows(holderTable(g, titleOf(g, 'duke-of-valmont')));
		expect(rows[0]).toEqual(['Ruler', 'Name', 'Reign']);
		// Reign = entryReign of the entry: no "r.", no parentheses (supervisor ruling).
		const body = rows.slice(1).map(([r, n, y]) => [r, n, y ?? '']);
		expect(body.map((r) => r[0])).toEqual(['Aldric I', 'Aldric II', 'Roderick', 'Gareth I', 'Roderick I', 'Aldric III', 'Edmund']);
		expect(body.map((r) => r[2])).toEqual(['1062–1110', '1110–1150', '1150–1158', '1158–1163', 'from 1163', '1175–1210', '1210–1228']);
		expect(body.map((r) => r[1])).toEqual(['', 'Aldric Valmont', 'Roderick Valmont', 'Ser Gareth Orsini', 'Roderick Valmont', 'Aldric Valmont', 'Edmund Valmont']);
		// The name-only "Aldric" (ruler name Aldric, number I): the full name equals the ruler name
		// without the number, so the Name cell is empty (supervisor ruling).
	});

	it('Counts of Orsini: holders not in the tree, a name that is the same as the ruler name, an entry with no reign', async () => {
		const { holderTable } = await titlesModule();
		const g = graphOf(BODY_13);
		const rows = tableRows(holderTable(g, titleOf(g, 'count-of-orsini')));
		expect(rows[0]).toEqual(['Ruler', 'Name', 'Reign']);
		expect(rows.slice(1).map(([r, n, y]) => [r, n, y ?? ''])).toEqual([
			['Orso the Old', '', 'until 1090'],
			['Bertrand', 'Bertrand Orsini', '1090–1128'],
			['Matteo', 'Matteo Orsini', '1128–1140'],
			['Piero', 'Piero Orsini', 'until 1140'],
			['Cosimo Orsini', '', '1140–1145'],
			['Piero', 'Piero Orsini', '1145–1160'],
			['Luca', 'Luca Orsini', ''],
		]);
	});

	it('"|" in a value is escaped as "\\|"', async () => {
		const { holderTable } = await titlesModule();
		const g = graphOf('titles:\n  - id: duke\n    name: Duke\n    holders:\n      - {name: "Orso | the Old", from: "1|2"}\npeople:\n  - id: a\n    name: A\n');
		const text = holderTable(g, titleOf(g, 'duke'));
		expect(text).toContain('Orso \\| the Old');
		expect(text).not.toMatch(/[^\\]\| the Old/);
		expect(tableRows(text)[1][0]).toBe('Orso | the Old');
	});

	it('the table does not change the tree (the graph and the body stay as they were)', async () => {
		const { holderTable } = await titlesModule();
		const g = graphOf(BLOCKS_13[0]);
		const before = JSON.stringify(g.titles);
		holderTable(g, titleOf(g, 'king-of-the-vale'));
		expect(JSON.stringify(g.titles)).toBe(before);
	});
});
