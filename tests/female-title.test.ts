import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { cardLabels, cardTitleOp, describeDeleteTitle, holderTable, pickerSuffix, searchNames, titleNameFor } from '../src/core/titles';
import type { Title, Tree } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';
import { fixture } from './helpers';

// Spec §13.3, §13.4 (D65): the title key `female-name`, the female form on the card title text
// line for a holder with `sex: f`, and the add-title / edit-title writes of the key.

function tree(src: string): Tree {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}
const graph = (src: string): FamilyGraph => deriveFamilies(tree(src));
function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (src: string, op: Op) => body(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};

const TREE = [
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    female-name: Duchess of Valmont',
	'    plural: Dukes of Valmont',
	'    holders:',
	'      - {person: aldric, number: II, from: 1131, to: 1160}',
	'      - {person: maud, from: 1160, to: 1175}',
	'      - {person: sybil, from: 1175}',
	'      - {person: ada, from: 1180}',
	'      - {name: Matilda, from: 1190}',
	'  - id: count',
	'    name: Count of Orsini',
	'    female-name: Countess of Orsini',
	'    holders: [maud, sybil, ada, {person: ines}, {person: una}, {person: vera}]',
	'  - id: king',
	'    name: King of Ostmark',
	'    holders: [maud, wren]',
	'people:',
	'  - {id: aldric, name: Aldric Valmont, sex: m}',
	'  - {id: maud, name: Maud Valmont, sex: f}',
	'  - {id: sybil, name: Sybil Valmont, sex: f, title: Lady of the Lake}',
	'  - {id: ada, name: Ada Valmont, sex: f, title: Lady Ada, card-title: count}',
	'  - {id: ines, name: Ines, sex: F}',
	'  - {id: una, name: Una}',
	'  - {id: vera, name: Vera, sex: x}',
	'  - {id: wren, name: Wren, sex: f, card-title: king}',
	'',
].join('\n');

describe('reading female-name (D65)', () => {
	const titleOf = (src: string) => tree(src).titles![0];
	const one = (line: string) => `titles:\n  - id: t\n    name: Duke\n${line}\npeople: []\n`;

	it('is read as written, numbers as text', () => {
		expect(titleOf(one('    female-name: Duchess of Valmont')).femaleName).toBe('Duchess of Valmont');
		expect(titleOf(one('    female-name: 1234')).femaleName).toBe('1234');
		expect(titleOf(one('    female-name: "  Duchess  "')).femaleName).toBe('Duchess');
	});

	it('an empty value, or no key, leaves it absent', () => {
		for (const line of ['    female-name:', '    female-name: ""', '    female-name: "  "', '    plural: Dukes']) {
			const t = titleOf(one(line));
			expect(Object.prototype.hasOwnProperty.call(t, 'femaleName')).toBe(false);
		}
	});

	it('gives no warning', () => {
		expect(tree(TREE).issues).toEqual([]);
		expect(graph(TREE).issues).toEqual([]);
	});
});

describe('titleNameFor (D65)', () => {
	const title: Title = { id: 'duke', name: 'Duke of Valmont', femaleName: 'Duchess of Valmont', plural: 'Dukes of Valmont', holders: [], index: 0, items: 0 };
	const plain: Title = { id: 'king', name: 'King of Ostmark', plural: 'King of Ostmark', holders: [], index: 1, items: 0 };

	it('the female form only for sex f, and only if the title has one', () => {
		expect(titleNameFor(title, { sex: 'f' })).toBe('Duchess of Valmont');
		expect(titleNameFor(plain, { sex: 'f' })).toBe('King of Ostmark');
		for (const sex of ['m', 'F', 'female', 'x', undefined]) expect(titleNameFor(title, { sex })).toBe('Duke of Valmont');
		expect(titleNameFor(title, undefined)).toBe('Duke of Valmont');
	});

	it('does not throw for bad input', () => {
		expect(titleNameFor(undefined as unknown as Title, { sex: 'f' })).toBe('');
	});
});

describe('card labels with female-name (D65)', () => {
	const labels = cardLabels(graph(TREE));
	const title = (id: string) => labels.get(id)?.title;

	it('a woman with no written title gets the female form of the first title (D56)', () => {
		expect(title('maud')).toBe('Duchess of Valmont');
		expect(labels.get('maud')?.reign).toBe('(r. 1160–1175)');
	});

	it('a written title stays as written', () => {
		expect(title('sybil')).toBe('Lady of the Lake');
	});

	it('a title selected with card-title shows in its female form (D63)', () => {
		expect(title('ada')).toBe('Countess of Orsini');
		expect(labels.get('ada')?.selected).toBe(true);
	});

	it('a title with no female-name keeps its name for a woman', () => {
		expect(title('wren')).toBe('King of Ostmark');
	});

	it('a man and sex values other than f keep the name', () => {
		expect(title('aldric')).toBe('Duke of Valmont');
		expect(title('ines')).toBe('Count of Orsini');
		expect(title('una')).toBe('Count of Orsini');
		expect(title('vera')).toBe('Count of Orsini');
	});

	it('the holder list, the table, search names and picker suffix do not change', () => {
		const g = graph(TREE);
		const duke = g.titles.find((t) => t.id === 'duke')!;
		expect(holderTable(g, duke)).toBe(
			[
				'| Ruler | Name | Reign |',
				'| --- | --- | --- |',
				'| Aldric II | Aldric Valmont | 1131–1160 |',
				'| Maud | Maud Valmont | 1160–1175 |',
				'| Sybil | Sybil Valmont | from 1175 |',
				'| Ada | Ada Valmont | from 1180 |',
				'| Matilda |  | from 1190 |',
				'',
			].join('\n'),
		);
		expect(duke.plural).toBe('Dukes of Valmont');
		expect(describeDeleteTitle(g, 'duke')).toEqual({ holders: 5, cards: 3 });
		const maud = cardLabels(g).get('maud')!;
		expect(searchNames(maud, 'Maud Valmont')).toEqual([]);
		expect(pickerSuffix(maud, 'Maud Valmont')).toBeUndefined();
		expect(cardTitleOp(g, 'maud', 'duke').fields['card-title']).toBeNull();
	});

	it('a tree without female-name has the same labels as the D56/D63 rule on the name', () => {
		const g = graph(fixture('13'));
		expect(g.titles.some((t) => Object.prototype.hasOwnProperty.call(t, 'femaleName'))).toBe(false);
		for (const p of g.people) {
			const label = cardLabels(g).get(p.id)!;
			const expected = label.selected ? label.shown!.title.name : p.title ?? label.shown?.title.name;
			expect(label.title).toBe(expected);
		}
		// The same people as women, still with no female-name: no label changes.
		const women = fixture('13').replace(/^(\s*-?\s*)sex: m\b/gm, '$1sex: f');
		expect(women).not.toBe(fixture('13'));
		const gw = graph(women);
		for (const p of g.people) expect(cardLabels(gw).get(p.id)!.title).toBe(cardLabels(g).get(p.id)!.title);
	});
});

const TITLES = [
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    plural: Dukes of Valmont',
	'    numbering: written',
	'    holders: []',
	'  - {id: king, name: King}',
	'  - id: count',
	'    name: Count of Orsini   # the counts',
	'    numbering: written',
	'people: []',
	'',
].join('\n');

describe('add-title with femaleName (D65)', () => {
	it('writes female-name after name and before plural', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'earl', name: 'Earl of Vell', femaleName: 'Countess of Vell', plural: 'Earls of Vell' });
		expect(out).toBe(TITLES.replace('people: []', '  - id: earl\n    name: Earl of Vell\n    female-name: Countess of Vell\n    plural: Earls of Vell\npeople: []'));
	});

	it('quotes the value as for name; empty text writes nothing', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'earl', name: 'Earl', femaleName: 'Countess: of Vell' });
		expect(out).toBe(TITLES.replace('people: []', '  - id: earl\n    name: Earl\n    female-name: "Countess: of Vell"\npeople: []'));
		expect(edit(TITLES, { kind: 'add-title', id: 'earl', name: 'Earl', femaleName: '  ' })).toBe(TITLES.replace('people: []', '  - id: earl\n    name: Earl\npeople: []'));
		const flow = 'titles: [{id: a, name: A}]\npeople: []\n';
		expect(edit(flow, { kind: 'add-title', id: 'b', name: 'B', femaleName: 'Lady B', plural: 'Bs' })).toBe('titles: [{id: a, name: A}, {id: b, name: B, female-name: Lady B, plural: Bs}]\npeople: []\n');
	});

	it('refuses a value that is not text', () => {
		expect(code(TITLES, { kind: 'add-title', id: 'earl', name: 'Earl', femaleName: 5 as unknown as string })).toBe('bad-value');
	});

	it('the new title reads back with its female form', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'earl', name: 'Earl', femaleName: 'Countess' });
		expect(tree(out).titles!.find((t) => t.id === 'earl')!.femaleName).toBe('Countess');
	});
});

describe('edit-title with femaleName (D65)', () => {
	it('sets it between name and plural: only that line is new', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', femaleName: 'Duchess of Valmont' })).toBe(
			TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    female-name: Duchess of Valmont\n'),
		);
	});

	it('with no plural, before numbering; a comment on the name stays', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'count', femaleName: 'Countess of Orsini' })).toBe(
			TITLES.replace('    name: Count of Orsini   # the counts\n', '    name: Count of Orsini   # the counts\n    female-name: Countess of Orsini\n'),
		);
	});

	it('in a flow map, after name', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'king', femaleName: 'Queen' })).toBe(TITLES.replace('{id: king, name: King}', '{id: king, name: King, female-name: Queen}'));
	});

	it('changes and removes it', () => {
		const src = edit(TITLES, { kind: 'edit-title', id: 'duke', femaleName: 'Duchess of Valmont' });
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: 'Grand Duchess' })).toBe(src.replace('female-name: Duchess of Valmont', 'female-name: Grand Duchess'));
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: null })).toBe(TITLES);
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: ' ' })).toBe(TITLES);
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: 'Duchess of Valmont' })).toBe(src);
		// No key and null: nothing to write.
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', femaleName: null })).toBe(TITLES);
	});

	it('changes name, female-name and plural in one write', () => {
		const out = edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Grand Duke', femaleName: 'Grand Duchess', plural: 'Grand Dukes' });
		expect(out).toBe(TITLES.replace('    name: Duke of Valmont\n    plural: Dukes of Valmont\n', '    name: Grand Duke\n    female-name: Grand Duchess\n    plural: Grand Dukes\n'));
	});

	it('keeps a hand-typed position and quoting of the key when it changes', () => {
		const src = TITLES.replace('    numbering: written\n    holders: []\n', "    numbering: written\n    female-name: 'Duchess'\n    holders: []\n");
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: 'Grand Duchess' })).toBe(src.replace("female-name: 'Duchess'", "female-name: 'Grand Duchess'"));
	});

	it('refuses a value that is not text', () => {
		expect(code(TITLES, { kind: 'edit-title', id: 'duke', femaleName: 5 as unknown as string })).toBe('bad-value');
	});
});
