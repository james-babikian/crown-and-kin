import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import type { CodedIssue } from '../../src/core/messages';
import { parseBody, parseDynasty, referencedIds } from '../../src/core/parse';
import { lineSubgraph } from '../../src/core/relations';
import type { RawMap } from '../../src/core/tolerate';
import type { Tree } from '../../src/core/types';
import { fixture } from '../support/helpers';

// Spec §13.3, §13.4 (M8 contract rules 1–3): reading `titles` and `card-title`, the title
// warnings, and the titles that the family graph and the subgraphs carry.

function tree(src: string): Tree {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}
const graph = (src: string) => deriveFamilies(tree(src));
const codes = (issues: CodedIssue[]) => issues.map((i) => i.code);

const BASE = [
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    plural: Dukes of Valmont',
	'    numbering: written   # kept, never read (D59)',
	'    count-with: [king]',
	'    holders:',
	'      - {name: Aldric, number: I, from: 1062, to: 1101}',
	'      - {person: aldric, number: II, from: 1131, to: 1160}',
	'      - roderick',
	'      - person: wren     # hand-typed block map',
	'        from: 1175',
	'  - id: count',
	'    holders: aldric',
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    card-title: count',
	'  - id: roderick',
	'    name: Roderick Valmont',
	'    title: Lord Protector',
	'  - id: wren',
	'    name: Wren',
	'',
].join('\n');

describe('reading titles (rule 1)', () => {
	it('reads titles, names, plurals and holders in written order', () => {
		const t = tree(BASE);
		expect(t.issues).toEqual([]);
		expect(t.titles!.map((x) => [x.id, x.name, x.plural, x.index])).toEqual([
			['duke', 'Duke of Valmont', 'Dukes of Valmont', 0],
			['count', 'count', 'count', 1],
		]);
		expect(t.titles![0].holders).toEqual([
			{ name: 'Aldric', number: 'I', from: '1062', to: '1101', index: 0, text: '{name: Aldric, number: I, from: 1062, to: 1101}' },
			{ person: 'aldric', number: 'II', from: '1131', to: '1160', index: 1, text: '{person: aldric, number: II, from: 1131, to: 1160}' },
			{ person: 'roderick', index: 2, text: 'roderick' },
			{ person: 'wren', from: '1175', index: 3, text: 'person: wren from: 1175' },
		]);
		// `holders: aldric` is one holder.
		expect(t.titles![1].holders).toEqual([{ person: 'aldric', index: 0, text: 'aldric' }]);
	});

	it('reads card-title as written, and only when written', () => {
		const t = tree(BASE);
		expect(t.people[0].cardTitle).toBe('count');
		expect('cardTitle' in t.people[1]).toBe(false);
		expect(tree('people:\n  - id: a\n    name: A\n    card-title: 0042\n').people[0].cardTitle).toBe('0042');
	});

	it('a tree with no titles key has no titles, and its graph has none', () => {
		const src = 'people:\n  - id: a\n    name: A\n';
		expect('titles' in tree(src)).toBe(false);
		expect(graph(src).titles).toEqual([]);
		expect(graph(src).writtenTitles).toEqual([]);
		expect(tree('titles:\npeople:\n  - id: a\n    name: A\n').titles).toEqual([]);
	});

	it('numeric scalars are text', () => {
		const t = tree('titles:\n  - id: 7\n    name: 1066\n    holders:\n      - {person: 0042, number: 2, from: 01}\npeople:\n  - id: "0042"\n    name: Odo\n');
		expect(t.titles![0]).toMatchObject({ id: '7', name: '1066', holders: [{ person: '0042', number: '2', from: '01' }] });
		expect(graph('titles:\n  - id: t\n    holders: [0042]\npeople:\n  - id: "0042"\n    name: Odo\n').titles[0].holders[0].person).toBe('0042');
	});

	it('the titles section in the wrong shape', () => {
		const t = tree('titles:\n  id: duke\npeople: []\n');
		expect(t.titles).toEqual([]);
		expect(t.issues).toEqual([{ code: 'section-wrong-shape', level: 'warning', params: { section: 'titles' } }]);
	});

	it('an entry that is not a map, and a title with no id', () => {
		const t = tree('titles:\n  - duke\n  - name: Duke of Valmont\n  - {}\n  - id: count\npeople: []\n');
		expect(t.titles!.map((x) => [x.id, x.index])).toEqual([['count', 3]]);
		expect(t.issues.map((i) => [i.code, i.params])).toEqual([
			['entry-not-map', { section: 'titles', index: 1 }],
			['missing-id', { section: 'titles', index: 2, name: 'Duke of Valmont' }],
			['missing-id', { section: 'titles', index: 3 }],
		]);
	});

	it('holders written as a map, or with items that are not holders', () => {
		const t = tree('titles:\n  - id: duke\n    name: Duke\n    holders: {person: a}\n  - id: count\n    holders:\n      - [a, b]\n      - {person: a}\npeople:\n  - id: a\n    name: A\n');
		expect(t.titles![0].holders).toEqual([]);
		expect(t.titles![1].holders.map((h) => [h.person, h.index])).toEqual([['a', 1]]);
		expect(t.issues.map((i) => [i.code, i.params])).toEqual([
			['section-wrong-shape', { section: 'holders', title: 'Duke' }],
			['entry-not-map', { section: 'holders', index: 1, title: 'count' }],
		]);
	});

	it('an empty holder item is not a holder (supervisor ruling)', () => {
		const t = tree('titles:\n  - id: t\n    name: T\n    holders:\n      -\n      - {as: Odo}\n      - ""\npeople: []\n');
		expect(t.titles![0].holders.map((h) => h.index)).toEqual([1]);
		expect(t.titles![0].items).toBe(3);
		expect(t.issues.map((i) => [i.code, i.params])).toEqual([
			['entry-not-map', { section: 'holders', index: 1, title: 'T' }],
			['entry-not-map', { section: 'holders', index: 3, title: 'T' }],
		]);
	});

	it('referencedIds includes every holder person', () => {
		const p = parseBody('titles:\n  - id: t\n    holders: [a, {person: b}, {name: C}]\n  - id: u\n    holders: d\n  - id: v\n    holders: {person: e}\npeople: []\n');
		if (!p.ok) throw new Error('parse');
		const ids = referencedIds(p.data as RawMap);
		expect([...ids].sort()).toEqual(['a', 'b', 'd']);
	});
});

describe('validating titles (rule 2)', () => {
	it('the first title with an id wins', () => {
		const g = graph('titles:\n  - id: t\n    name: First\n  - id: t\n    name: Second\n  - id: t\npeople: []\n');
		expect(g.titles.map((t) => t.name)).toEqual(['First']);
		expect(g.writtenTitles.map((t) => t.name)).toEqual(['First', 'Second', 't']);
		expect(g.issues.map((i) => [i.code, i.params])).toEqual([['duplicate-title-id', { id: 't', title: 'First' }]]);
	});

	it('a holder whose person names nobody: kept with a name, else dropped', () => {
		const g = graph('titles:\n  - id: t\n    name: Duke\n    holders:\n      - {person: ghost, name: Aldric}\n      - {person: nobody}\n      - {person: a}\npeople:\n  - id: a\n    name: A\n');
		expect(g.titles[0].holders.map((h) => [h.person, h.name])).toEqual([['ghost', 'Aldric'], ['a', undefined]]);
		expect(g.issues.map((i) => [i.code, i.params, i.ids])).toEqual([
			['missing-holder', { title: 'Duke', ref: 'ghost', name: 'Aldric' }, undefined],
			['missing-holder', { title: 'Duke', ref: 'nobody' }, undefined],
		]);
		// The written text keeps both entries.
		expect(g.writtenTitles[0].holders).toHaveLength(3);
	});

	it('a holder with no person and no name is dropped', () => {
		const g = graph('titles:\n  - id: t\n    name: Duke\n    holders:\n      - {number: II}\n      - {name: ""}\n      - {name: Odo}\npeople: []\n');
		expect(g.titles[0].holders.map((h) => h.name)).toEqual(['Odo']);
		expect(g.issues.map((i) => [i.code, i.params])).toEqual([
			['holder-empty', { title: 'Duke', index: 1 }],
			['holder-empty', { title: 'Duke', index: 2 }],
		]);
	});

	it('card-title must name a title the person holds', () => {
		const src = [
			'titles:',
			'  - id: duke',
			'    holders: [a, b]',
			'  - id: count',
			'    holders: [a]',
			'people:',
			'  - {id: a, name: A, card-title: count}',
			'  - {id: b, name: B, card-title: count}',
			'  - {id: c, name: C, card-title: nothing}',
			'',
		].join('\n');
		const g = graph(src);
		expect(g.issues.map((i) => [i.code, i.params, i.ids])).toEqual([
			['card-title-not-held', { person: 'B', ref: 'count' }, ['b']],
			['card-title-not-held', { person: 'C', ref: 'nothing' }, ['c']],
		]);
	});

	it('card-title in a tree with no titles gives only the warning', () => {
		const g = graph('people:\n  - {id: a, name: A, card-title: duke}\n');
		expect(codes(g.issues)).toEqual(['card-title-not-held']);
	});

	it('card-title matches only the first title with a duplicate id', () => {
		const g = graph('titles:\n  - id: t\n    holders: [b]\n  - id: t\n    holders: [a]\npeople:\n  - {id: a, name: A, card-title: t}\n  - {id: b, name: B}\n');
		expect(codes(g.issues)).toEqual(['duplicate-title-id', 'card-title-not-held']);
	});

	it('a holder whose person is not in the tree does not make card-title valid', () => {
		const g = graph('titles:\n  - id: t\n    holders: [{person: a2, name: A}]\npeople:\n  - {id: a, name: A, card-title: t}\n');
		expect(codes(g.issues)).toEqual(['missing-holder', 'card-title-not-held']);
	});

	it('the base sample has no issues, and the tree order of issues is kept', () => {
		expect(graph(BASE).issues).toEqual([]);
		const g = graph('houses:\n  - name: H\ntitles:\n  - name: T\npeople:\n  - name: P\n');
		expect(g.issues.map((i) => i.params.section)).toEqual(['houses', 'titles', 'people']);
	});
});

describe('subgraphs keep titles (rule 3)', () => {
	it('focus mode keeps the titles unchanged', () => {
		const t = tree(BASE);
		const sub = focusSubgraph(t, 'wren', 0)!;
		expect(sub.tree.titles).toBe(t.titles);
		expect(sub.tree.people.find((p) => p.id === 'wren')).toBeDefined();
		const g = deriveFamilies(sub.tree);
		expect(g.titles.map((x) => x.id)).toEqual(['duke', 'count']);
		// People left out of the focus family are not holders there.
		expect(g.titles[0].holders.map((h) => h.person ?? h.name)).toEqual(['Aldric', 'wren']);
	});

	it('focus mode of a tree with no titles has no titles key', () => {
		const t = tree(fixture('01'));
		const sub = focusSubgraph(t, t.people[0].id, 1)!;
		expect('titles' in sub.tree).toBe(false);
	});

	it('the relation finder small tree keeps the titles of the whole tree', () => {
		const g = graph(BASE);
		const sub = lineSubgraph(g, { people: ['aldric', 'roderick'], links: [], unions: [] });
		expect(sub.titles).toBe(g.titles);
		expect(sub.writtenTitles).toBe(g.writtenTitles);
		expect(sub.issues).toEqual([]);
	});
});
