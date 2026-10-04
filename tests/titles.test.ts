import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardLabels, cardTitleOp, describeDeleteTitle, entryReign, holderTable, noteName, pickerSuffix, reignText, rulerName, searchNames } from '../src/core/titles';
import type { Holder } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';
import { fixture } from './helpers';

// Spec §13.3–§13.5 (D56, D58, D61–D63): card labels, reign texts, ruler names, the picker and
// Find texts, "Show on the card", the Delete title counts and the table note.

function graph(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}
const h = (fields: Partial<Holder>): Holder => ({ index: 0, ...fields });

const TREE = [
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    plural: Dukes of Valmont',
	'    holders:',
	'      - {name: Aldric, number: I, from: 1062, to: 1101}',
	'      - {person: aldric, number: II, from: 1131, to: 1140}',
	'      - {person: roderick, from: 1140}',
	'      - {person: aldric, from: 1145, to: 1160}',
	'      - {person: gareth, as: Gareth, number: I}',
	'      - {person: ghost, name: Odo | the Lame, from: 1200}',
	'  - id: count',
	'    name: Count of Orsini',
	'    holders:',
	'      - {person: roderick, number: III, to: 1130}',
	'      - {person: isolde}',
	'      - {person: wren, from: 1170}',
	'  - id: king',
	'    name: King of Ostmark',
	'    holders: [wren, {person: tomas, number: IV}]',
	'people:',
	'  - {id: aldric, name: Aldric Valmont}',
	'  - {id: roderick, name: Roderick Valmont, title: Lord Protector}',
	'  - {id: gareth, name: Ser Gareth Orsini}',
	'  - {id: isolde, name: Isolde Orsini, title: Lady of the Lake, card-title: count}',
	'  - {id: wren, name: Wren, card-title: king}',
	'  - {id: tomas, name: Tomas, card-title: duke}',
	'  - {id: piers, name: Piers, title: Squire}',
	'',
].join('\n');

describe('reign texts (§13.3)', () => {
	it('entryReign in the three forms', () => {
		expect(entryReign(h({ from: '1131', to: '1160' }))).toBe('1131–1160');
		expect(entryReign(h({ from: '1131' }))).toBe('from 1131');
		expect(entryReign(h({ to: '1160' }))).toBe('until 1160');
		expect(entryReign(h({}))).toBeUndefined();
		expect(entryReign(h({ from: 'Spring of the Third Age' }))).toBe('from Spring of the Third Age');
	});

	it('reignText: "r." before the first reign, entries in list order, entries with no reign add nothing', () => {
		expect(reignText([h({ from: '1175', to: '1207' })])).toBe('(r. 1175–1207)');
		expect(reignText([h({ from: '1131', to: '1140' }), h({ from: '1145', to: '1160' })])).toBe('(r. 1131–1140, 1145–1160)');
		expect(reignText([h({ from: '1131', to: '1140' }), h({ from: '1145' })])).toBe('(r. 1131–1140, from 1145)');
		expect(reignText([h({ to: '1140' }), h({ from: '1145', to: '1160' })])).toBe('(r. until 1140, 1145–1160)');
		expect(reignText([h({ number: 'II' }), h({ from: '1145' })])).toBe('(r. from 1145)');
		expect(reignText([h({})])).toBeUndefined();
		expect(reignText([])).toBeUndefined();
	});
});

describe('ruler names (§13.5)', () => {
	it('as, else the first word of the name, else the holder name', () => {
		expect(rulerName(h({ person: 'g', as: 'Gareth' }), 'Ser Gareth Orsini')).toBe('Gareth');
		expect(rulerName(h({ person: 'g' }), 'Ser Gareth Orsini')).toBe('Ser');
		expect(rulerName(h({ person: 'g' }), '  Wren  ')).toBe('Wren');
		expect(rulerName(h({ name: 'Aldric' }), undefined)).toBe('Aldric');
		expect(rulerName(h({ person: 'ghost', name: 'Odo the Lame' }), undefined)).toBe('Odo the Lame');
		expect(rulerName(h({}), undefined)).toBe('');
	});
});

describe('cardLabels (§13.3, §13.5, D56, D58, D61–D63)', () => {
	const g = graph(TREE);
	const labels = cardLabels(g);

	it('the first title shows, with the reigns of all its entries and the first numbered entry on the name line', () => {
		const a = labels.get('aldric')!;
		expect(a.holdings.map((x) => [x.title.id, x.entries.map((e) => e.index)])).toEqual([['duke', [1, 3]]]);
		expect(a.shown?.title.id).toBe('duke');
		expect(a.selected).toBe(false);
		expect(a.name).toBe('Aldric II');
		expect(a.title).toBe('Duke of Valmont');
		expect(a.reign).toBe('(r. 1131–1140, 1145–1160)');
	});

	it('a written title shows with the reign of the first title (D56); the number comes from the shown title only', () => {
		const r = labels.get('roderick')!;
		expect(r.holdings.map((x) => x.title.id)).toEqual(['duke', 'count']);
		expect(r.title).toBe('Lord Protector');
		expect(r.reign).toBe('(r. from 1140)');
		// "III" is on the second title, so the name line does not change (§13.5).
		expect(r.name).toBe('Roderick Valmont');
	});

	it('a holder with "as" uses it', () => {
		expect(labels.get('gareth')).toMatchObject({ name: 'Gareth I', title: 'Duke of Valmont' });
		expect(labels.get('gareth')!.reign).toBeUndefined();
	});

	it('a selected title replaces a written title (D63)', () => {
		const i = labels.get('isolde')!;
		expect(i).toMatchObject({ selected: true, title: 'Count of Orsini', name: 'Isolde Orsini' });
		expect(i.shown?.title.id).toBe('count');
		expect(i.reign).toBeUndefined();
	});

	it('card-title selects the second title, with its reign and number', () => {
		const w = labels.get('wren')!;
		expect(w.holdings.map((x) => x.title.id)).toEqual(['count', 'king']);
		expect(w).toMatchObject({ selected: true, title: 'King of Ostmark', name: 'Wren' });
		expect(w.reign).toBeUndefined();
	});

	it('a card-title that the person does not hold is ignored', () => {
		const t = labels.get('tomas')!;
		expect(t).toMatchObject({ selected: false, title: 'King of Ostmark', name: 'Tomas IV' });
	});

	it('a person with no title keeps the 0.1 text', () => {
		const p = labels.get('piers')!;
		expect(p).toEqual({ holdings: [], selected: false, name: 'Piers', title: 'Squire' });
		expect('shown' in p).toBe(false);
		expect('reign' in p).toBe(false);
	});

	it('has a label for every person, memoised per graph', () => {
		expect([...labels.keys()]).toEqual(g.people.map((p) => p.id));
		expect(cardLabels(g)).toBe(labels);
		expect(cardLabels(graph(TREE))).not.toBe(labels);
		expect(Object.isFrozen(labels.get('aldric'))).toBe(true);
	});

	it('a tree with no titles: every label is the 0.1 name and title', () => {
		const g1 = graph(fixture('01'));
		for (const p of g1.people) {
			const l = cardLabels(g1).get(p.id)!;
			expect(l.name).toBe(p.name);
			expect(l.title).toBe(p.title);
			expect(l.holdings).toEqual([]);
			expect(l.reign).toBeUndefined();
		}
	});

	it('fixture 7 takes well under 5 ms', () => {
		const g7 = graph(fixture('07'));
		cardLabels(graph(fixture('01')));
		const times: number[] = [];
		for (let i = 0; i < 5; i++) {
			const fresh = { ...g7 };
			const t0 = performance.now();
			cardLabels(fresh);
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		expect(times[2]).toBeLessThan(5);
	});
});

describe('picker and Find texts (§13.5)', () => {
	const g = graph(TREE);
	const labels = cardLabels(g);
	const name = (id: string) => g.byId.get(id)!.name;

	it('searchNames: every numbered entry, once each', () => {
		expect(searchNames(labels.get('aldric')!, name('aldric'))).toEqual(['Aldric II']);
		expect(searchNames(labels.get('roderick')!, name('roderick'))).toEqual(['Roderick III']);
		expect(searchNames(labels.get('gareth')!, name('gareth'))).toEqual(['Gareth I']);
		expect(searchNames(labels.get('piers')!, name('piers'))).toEqual([]);
		const twice = graph('titles:\n  - id: a\n    holders: [{person: x, number: II}, {person: x, number: II}]\n  - id: b\n    holders: [{person: x, number: V}]\npeople:\n  - {id: x, name: Xan Y}\n');
		expect(searchNames(cardLabels(twice).get('x')!, 'Xan Y')).toEqual(['Xan II', 'Xan V']);
	});

	it('pickerSuffix: the shown title first, else the first numbered entry', () => {
		expect(pickerSuffix(labels.get('aldric')!, name('aldric'))).toBe('(Aldric II)');
		expect(pickerSuffix(labels.get('roderick')!, name('roderick'))).toBe('(Roderick III)');
		expect(pickerSuffix(labels.get('tomas')!, name('tomas'))).toBe('(Tomas IV)');
		expect(pickerSuffix(labels.get('piers')!, name('piers'))).toBeUndefined();
		const g2 = graph('titles:\n  - id: a\n    holders: [{person: x, number: II}]\n  - id: b\n    holders: [{person: x, number: V}]\npeople:\n  - {id: x, name: Xan, card-title: b}\n');
		expect(pickerSuffix(cardLabels(g2).get('x')!, 'Xan')).toBe('(Xan V)');
	});
});

describe('cardTitleOp (D62, §13.3)', () => {
	const g = graph(TREE);

	it('the first title with no written title removes card-title', () => {
		expect(cardTitleOp(g, 'aldric', 'duke')).toEqual({ kind: 'set-person-fields', id: 'aldric', fields: { 'card-title': null } });
		expect(cardTitleOp(g, 'wren', 'count')).toEqual({ kind: 'set-person-fields', id: 'wren', fields: { 'card-title': null } });
	});

	it('another title, or any title with a written title, writes card-title', () => {
		expect(cardTitleOp(g, 'wren', 'king')).toEqual({ kind: 'set-person-fields', id: 'wren', fields: { 'card-title': 'king' } });
		expect(cardTitleOp(g, 'roderick', 'duke')).toEqual({ kind: 'set-person-fields', id: 'roderick', fields: { 'card-title': 'duke' } });
	});

	it('the op writes only the card-title line', () => {
		const r = applyOp(TREE, cardTitleOp(g, 'roderick', 'count'));
		if (!r.ok) throw new Error(r.code);
		expect(r.body).toBe(TREE.replace('title: Lord Protector}', 'title: Lord Protector, card-title: count}'));
	});
});

describe('describeDeleteTitle (§13.4)', () => {
	it('counts the written holder items and the cards that show the title', () => {
		const g = graph(TREE);
		// Aldric, Roderick (written title, but the shown title is the first), Gareth.
		expect(describeDeleteTitle(g, 'duke')).toEqual({ holders: 6, cards: 3 });
		expect(describeDeleteTitle(g, 'count')).toEqual({ holders: 3, cards: 1 });
		expect(describeDeleteTitle(g, 'king')).toEqual({ holders: 2, cards: 2 });
		expect(describeDeleteTitle(g, 'none')).toEqual({ holders: 0, cards: 0 });
	});

	it('holders that validation drops still count, and a duplicate title does not', () => {
		const g = graph('titles:\n  - id: t\n    holders: [{person: ghost}, {number: II}, {person: a}]\n  - id: t\n    holders: [a, a, a]\npeople:\n  - {id: a, name: A}\n');
		expect(describeDeleteTitle(g, 't')).toEqual({ holders: 3, cards: 1 });
	});
});

describe('noteName (§13.11)', () => {
	it('removes the characters a note name cannot have, joins spaces and trims', () => {
		expect(noteName('Dukes of Valmont', 'duke')).toBe('Dukes of Valmont');
		expect(noteName('Kings: of / the \\ North? "|#^[]<>*', 'king')).toBe('Kings of the North');
		expect(noteName('  Lords   of\tthe  Isles ', 'x')).toBe('Lords of the Isles');
		expect(noteName('..Hidden', 'x')).toBe('Hidden');
		expect(noteName(' . Dotted', 'x')).toBe('Dotted');
		expect(noteName('###', 'duke-of-valmont')).toBe('duke-of-valmont');
		expect(noteName('', 'duke')).toBe('duke');
	});
});

describe('bad input (spec §8: nothing throws)', () => {
	it('the helpers return empty results', () => {
		const none = undefined as never;
		expect(entryReign(none)).toBeUndefined();
		expect(reignText(none)).toBeUndefined();
		expect(rulerName(none, undefined)).toBe('');
		expect(cardLabels(none).size).toBe(0);
		expect(searchNames(none, 'A')).toEqual([]);
		expect(pickerSuffix(none, 'A')).toBeUndefined();
		expect(describeDeleteTitle(none, 'x')).toEqual({ holders: 0, cards: 0 });
		expect(noteName(none, 'x')).toBe('x');
		expect(holderTable(none, none)).toBe('| Ruler | Name | Reign |\n| --- | --- | --- |\n');
		expect(cardTitleOp(none, 'a', 't')).toEqual({ kind: 'set-person-fields', id: 'a', fields: { 'card-title': 't' } });
	});

	it('title ops with malformed fields are refused, not thrown', () => {
		const src = 'titles:\n  - id: t\n    holders: [a]\npeople:\n  - {id: a, name: A}\n';
		for (const op of [
			{ kind: 'add-holder', title: 't', fields: 'x' },
			{ kind: 'add-holder', title: 't', fields: { person: ['a'] } },
			{ kind: 'edit-holder', holder: null, fields: {} },
			{ kind: 'remove-holder', holder: { title: 't', index: 'x' } },
			{ kind: 'set-holders', title: 't', items: 'x' },
			{ kind: 'set-holders', title: 't', items: [null] },
			{ kind: 'add-title', id: 5, name: 'X' },
			{ kind: 'edit-title', id: 't', plural: 5 },
			{ kind: 'delete-title', id: null },
		]) {
			const r = applyOp(src, op as never);
			expect(r.ok, JSON.stringify(op)).toBe(false);
		}
	});
});

describe('holderTable (D55, §13.4)', () => {
	it('one row per holder entry in list order, with ruler, full name and reign', () => {
		const g = graph(TREE);
		expect(holderTable(g, g.titles[0])).toBe(
			[
				'| Ruler | Name | Reign |',
				'| --- | --- | --- |',
				'| Aldric I |  | 1062–1101 |',
				'| Aldric II | Aldric Valmont | 1131–1140 |',
				'| Roderick | Roderick Valmont | from 1140 |',
				'| Aldric | Aldric Valmont | 1145–1160 |',
				'| Gareth I | Ser Gareth Orsini |  |',
				'| Odo \\| the Lame |  | from 1200 |',
				'',
			].join('\n'),
		);
	});

	it('a one-word name is not repeated, and an empty list gives only the header', () => {
		const g = graph('titles:\n  - id: t\n    holders: [{person: w, to: 9}]\n  - id: u\npeople:\n  - {id: w, name: Wren}\n');
		expect(holderTable(g, g.titles[0])).toBe('| Ruler | Name | Reign |\n| --- | --- | --- |\n| Wren |  | until 9 |\n');
		expect(holderTable(g, g.titles[1])).toBe('| Ruler | Name | Reign |\n| --- | --- | --- |\n');
	});
});
