import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { cardLabels, cardTitleOp, describeDeleteTitle, holderTable, pickerSuffix, searchNames, titleNameFor } from '../src/core/titles';
import type { Title, Tree } from '../src/core/types';
import { applyOp } from '../src/core/yaml-edit';
import { fixture } from './helpers';

// Spec §13.3, §13.4 (D66): the title key `male-name`, the male form on the card title text line
// for a holder with `sex: m`, and the add-title / edit-title writes of the key. D66 mirrors D65
// (`female-title.test.ts`); both forms are equal and optional.

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
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

// A mostly female line with a male form (the owner's case), a title with both forms, and a title
// with only the female form.
const TREE = [
	'titles:',
	'  - id: queen',
	'    name: Queen of the Isles',
	'    male-name: King of the Isles',
	'    plural: Rulers of the Isles',
	'    holders:',
	'      - {person: morag, number: I, from: 1100, to: 1130}',
	'      - {person: angus, from: 1130, to: 1150}',
	'      - {person: brenna, from: 1150, to: 1160}',
	'      - {person: col, from: 1160, to: 1170}',
	'      - {person: dun, from: 1170}',
	'      - {name: Harald, from: 1180}',
	'  - id: vell',
	'    name: Ruler of Vell',
	'    male-name: Lord of Vell',
	'    female-name: Lady of Vell',
	'    holders: [dun, fin, gil, hal, ida, lew]',
	'  - id: arran',
	'    name: Earl of Arran',
	'    female-name: Countess of Arran',
	'    holders: [jon, kit]',
	'  - id: skye',
	'    name: Queen of Skye',
	'    male-name: King of Skye',
	'    holders: [lew]',
	'people:',
	'  - {id: morag, name: Morag, sex: f}',
	'  - {id: angus, name: Angus, sex: m}',
	'  - {id: brenna, name: Brenna, sex: f}',
	'  - {id: col, name: Col, sex: m, title: Lord Col}',
	'  - {id: dun, name: Dun, sex: m, card-title: vell}',
	'  - {id: fin, name: Fin, sex: M}',
	'  - {id: gil, name: Gil, sex: x}',
	'  - {id: hal, name: Hal}',
	'  - {id: ida, name: Ida, sex: f}',
	'  - {id: jon, name: Jon, sex: m}',
	'  - {id: kit, name: Kit, sex: f}',
	'  - {id: lew, name: Lew, sex: m, card-title: skye}',
	'',
].join('\n');

describe('reading male-name (D66)', () => {
	const titleOf = (src: string) => tree(src).titles![0];
	const one = (lines: string) => `titles:\n  - id: t\n    name: Queen\n${lines}\npeople: []\n`;

	it('is read as written, numbers as text', () => {
		expect(titleOf(one('    male-name: King of the Isles')).maleName).toBe('King of the Isles');
		expect(titleOf(one('    male-name: 1234')).maleName).toBe('1234');
		expect(titleOf(one('    male-name: "  King  "')).maleName).toBe('King');
	});

	it('an empty value, or no key, leaves it absent', () => {
		for (const line of ['    male-name:', '    male-name: ""', '    male-name: "  "', '    plural: Queens', '    female-name: Queen']) {
			expect(has(titleOf(one(line)), 'maleName')).toBe(false);
		}
	});

	it('reads both forms of one title apart', () => {
		const t = titleOf(one('    male-name: King\n    female-name: Lady'));
		expect([t.name, t.maleName, t.femaleName, t.plural]).toEqual(['Queen', 'King', 'Lady', 'Queen']);
	});

	it('gives no warning', () => {
		expect(tree(TREE).issues).toEqual([]);
		// Contract 0.2.7 K.9: `sex: M` (a capital letter) is the one thing the graph warns about, and it names Fin.
		expect(graph(TREE).issues.map((i) => [i.code, i.ids])).toEqual([['sex-spelling', ['fin']]]);
	});
});

describe('titleNameFor (D66)', () => {
	const both: Title = { id: 'vell', name: 'Ruler of Vell', maleName: 'Lord of Vell', femaleName: 'Lady of Vell', plural: 'Ruler of Vell', holders: [], index: 0, items: 0 };
	const male: Title = { id: 'queen', name: 'Queen of the Isles', maleName: 'King of the Isles', plural: 'Queen of the Isles', holders: [], index: 1, items: 0 };
	const female: Title = { id: 'arran', name: 'Earl of Arran', femaleName: 'Countess of Arran', plural: 'Earl of Arran', holders: [], index: 2, items: 0 };
	const plain: Title = { id: 'king', name: 'King of Ostmark', plural: 'King of Ostmark', holders: [], index: 3, items: 0 };

	it('with both forms: m gets the male form, f the female form', () => {
		expect(titleNameFor(both, { sex: 'm' })).toBe('Lord of Vell');
		expect(titleNameFor(both, { sex: 'f' })).toBe('Lady of Vell');
	});

	it('only the exact values m and f count; other values and none get the name', () => {
		for (const sex of ['M', 'F', 'male', 'female', 'x', '', undefined]) {
			expect(titleNameFor(both, { sex })).toBe('Ruler of Vell');
			expect(titleNameFor(male, { sex })).toBe('Queen of the Isles');
		}
		expect(titleNameFor(both, undefined)).toBe('Ruler of Vell');
	});

	it('a title with one form: the other sex gets the name', () => {
		expect(titleNameFor(male, { sex: 'm' })).toBe('King of the Isles');
		expect(titleNameFor(male, { sex: 'f' })).toBe('Queen of the Isles');
		expect(titleNameFor(female, { sex: 'm' })).toBe('Earl of Arran');
		expect(titleNameFor(female, { sex: 'f' })).toBe('Countess of Arran');
		expect(titleNameFor(plain, { sex: 'm' })).toBe('King of Ostmark');
		expect(titleNameFor(plain, { sex: 'f' })).toBe('King of Ostmark');
	});

	it('does not throw for bad input', () => {
		expect(titleNameFor(undefined as unknown as Title, { sex: 'm' })).toBe('');
	});
});

describe('card labels with male-name (D66)', () => {
	const labels = cardLabels(graph(TREE));
	const title = (id: string) => labels.get(id)?.title;

	it('a man with no written title gets the male form of the first title (D56)', () => {
		expect(title('angus')).toBe('King of the Isles');
		expect(labels.get('angus')?.reign).toBe('(r. 1130–1150)');
		expect(labels.get('angus')?.name).toBe('Angus');
	});

	it('a woman gets the name when the title has no female form', () => {
		expect(title('morag')).toBe('Queen of the Isles');
		expect(labels.get('morag')?.name).toBe('Morag I');
		expect(title('brenna')).toBe('Queen of the Isles');
	});

	it('a written title stays as written', () => {
		expect(title('col')).toBe('Lord Col');
	});

	it('a title selected with card-title shows in the male form (D63)', () => {
		expect(title('dun')).toBe('Lord of Vell');
		expect(labels.get('dun')?.selected).toBe(true);
		expect(title('lew')).toBe('King of Skye');
		expect(labels.get('lew')?.selected).toBe(true);
	});

	it('a title with both forms: each holder gets the form for their sex, else the name', () => {
		expect(title('ida')).toBe('Lady of Vell');
		expect(title('fin')).toBe('Ruler of Vell');
		expect(title('gil')).toBe('Ruler of Vell');
		expect(title('hal')).toBe('Ruler of Vell');
	});

	it('a title with only a female form keeps its name for a man', () => {
		expect(title('jon')).toBe('Earl of Arran');
		expect(title('kit')).toBe('Countess of Arran');
	});

	it('a holder not in the tree has no card and changes no label', () => {
		const ghost = TREE.replace('      - {name: Harald, from: 1180}\n', '      - {name: Harald, from: 1180}\n      - {person: ghost, name: Ghost, from: 1190}\n');
		const g = graph(ghost);
		// Contract 0.2.7 K.9: Fin has `sex: M`, which gives the warning sex-spelling.
		expect(g.issues.map((i) => i.code).sort()).toEqual(['missing-holder', 'sex-spelling']);
		const withGhost = cardLabels(g);
		expect(withGhost.has('ghost')).toBe(false);
		expect(withGhost.has('Harald')).toBe(false);
		for (const [id, label] of labels) expect(withGhost.get(id)?.title).toBe(label.title);
		expect(titleNameFor(g.titles[0], g.byId.get('ghost'))).toBe('Queen of the Isles');
	});

	it('the holder list, the table, search names, picker suffix and Delete title counts do not change', () => {
		const g = graph(TREE);
		const plainTree = TREE.replace(/^ {4}male-name: .*\n/gm, '');
		expect(plainTree).not.toBe(TREE);
		const gp = graph(plainTree);
		for (const id of ['queen', 'vell', 'skye']) {
			const t = g.titles.find((x) => x.id === id)!;
			const tp = gp.titles.find((x) => x.id === id)!;
			expect(holderTable(g, t)).toBe(holderTable(gp, tp));
			expect(t.plural).toBe(tp.plural);
			expect(describeDeleteTitle(g, id)).toEqual(describeDeleteTitle(gp, id));
		}
		expect(g.titles[0].plural).toBe('Rulers of the Isles');
		const angus = cardLabels(g).get('angus')!;
		const angusPlain = cardLabels(gp).get('angus')!;
		expect(searchNames(angus, 'Angus')).toEqual(searchNames(angusPlain, 'Angus'));
		expect(pickerSuffix(angus, 'Angus')).toEqual(pickerSuffix(angusPlain, 'Angus'));
		expect(cardTitleOp(g, 'dun', 'queen')).toEqual(cardTitleOp(gp, 'dun', 'queen'));
	});

	it('a tree without male-name has the same labels as before D66, also with every person a man', () => {
		const g = graph(fixture('13'));
		expect(g.titles.some((t) => has(t, 'maleName'))).toBe(false);
		for (const p of g.people) {
			const label = cardLabels(g).get(p.id)!;
			const expected = label.selected ? label.shown!.title.name : p.title ?? label.shown?.title.name;
			expect(label.title).toBe(expected);
		}
		const men = fixture('13').replace(/^(\s*-?\s*)sex: f\b/gm, '$1sex: m');
		expect(men).not.toBe(fixture('13'));
		const gm = graph(men);
		for (const p of g.people) expect(cardLabels(gm).get(p.id)!.title).toBe(cardLabels(g).get(p.id)!.title);
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
const add = (lines: string) => TITLES.replace('people: []', `${lines}\npeople: []`);

describe('add-title with maleName (D66)', () => {
	it('writes the keys in the order id, name, male-name, female-name, plural', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'vell', name: 'Ruler of Vell', maleName: 'Lord of Vell', femaleName: 'Lady of Vell', plural: 'Rulers of Vell' });
		expect(out).toBe(add('  - id: vell\n    name: Ruler of Vell\n    male-name: Lord of Vell\n    female-name: Lady of Vell\n    plural: Rulers of Vell'));
	});

	it('writes male-name alone after name', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'queen', name: 'Queen of the Isles', maleName: 'King of the Isles' });
		expect(out).toBe(add('  - id: queen\n    name: Queen of the Isles\n    male-name: King of the Isles'));
	});

	it('quotes the value as for name; empty text writes nothing', () => {
		expect(edit(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: 'King: of Vell' })).toBe(add('  - id: q\n    name: Queen\n    male-name: "King: of Vell"'));
		expect(edit(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: '  ' })).toBe(add('  - id: q\n    name: Queen'));
		expect(edit(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: '' })).toBe(add('  - id: q\n    name: Queen'));
	});

	it('writes a value equal to the name as typed', () => {
		expect(edit(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: 'Queen' })).toBe(add('  - id: q\n    name: Queen\n    male-name: Queen'));
	});

	it('in a flow list, a flow map in the same order', () => {
		const flow = 'titles: [{id: a, name: A}]\npeople: []\n';
		expect(edit(flow, { kind: 'add-title', id: 'b', name: 'B', maleName: 'Lord B', femaleName: 'Lady B', plural: 'Bs' })).toBe(
			'titles: [{id: a, name: A}, {id: b, name: B, male-name: Lord B, female-name: Lady B, plural: Bs}]\npeople: []\n',
		);
	});

	it('refuses a value that is not text', () => {
		expect(code(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: 5 as unknown as string })).toBe('bad-value');
	});

	it('the new title reads back with its male form', () => {
		const out = edit(TITLES, { kind: 'add-title', id: 'q', name: 'Queen', maleName: 'King' });
		expect(tree(out).titles!.find((t) => t.id === 'q')!.maleName).toBe('King');
	});
});

describe('edit-title with maleName (D66)', () => {
	it('sets it between name and plural: only that line is new', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke of Valmont' })).toBe(
			TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    male-name: Grand Duke of Valmont\n'),
		);
	});

	it('with no plural, before numbering; a comment on the name stays', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'count', maleName: 'Count of Orsini' })).toBe(
			TITLES.replace('    name: Count of Orsini   # the counts\n', '    name: Count of Orsini   # the counts\n    male-name: Count of Orsini\n'),
		);
	});

	it('in a flow map, after name', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'king', maleName: 'High King' })).toBe(TITLES.replace('{id: king, name: King}', '{id: king, name: King, male-name: High King}'));
	});

	it('goes before an existing female-name', () => {
		const src = TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    female-name: Duchess of Valmont\n');
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke' })).toBe(
			src.replace('    female-name: Duchess of Valmont\n', '    male-name: Grand Duke\n    female-name: Duchess of Valmont\n'),
		);
		const flow = TITLES.replace('{id: king, name: King}', '{id: king, name: King, female-name: Queen}');
		expect(edit(flow, { kind: 'edit-title', id: 'king', maleName: 'High King' })).toBe(flow.replace('female-name: Queen}', 'male-name: High King, female-name: Queen}'));
	});

	it('goes before the comment lines above an existing female-name', () => {
		const src = TITLES.replace('    name: Count of Orsini   # the counts\n', '    name: Count of Orsini   # the counts\n    # for a woman\n    female-name: Countess of Orsini\n');
		expect(edit(src, { kind: 'edit-title', id: 'count', maleName: 'Count' })).toBe(src.replace('    # for a woman\n', '    male-name: Count\n    # for a woman\n'));
	});

	it('a female-name set later goes after male-name', () => {
		const src = edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke' });
		expect(edit(src, { kind: 'edit-title', id: 'duke', femaleName: 'Duchess' })).toBe(src.replace('    male-name: Grand Duke\n', '    male-name: Grand Duke\n    female-name: Duchess\n'));
	});

	it('changes and removes it', () => {
		const src = edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke' });
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: 'Arch Duke' })).toBe(src.replace('male-name: Grand Duke', 'male-name: Arch Duke'));
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: null })).toBe(TITLES);
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: ' ' })).toBe(TITLES);
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: '' })).toBe(TITLES);
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke' })).toBe(src);
		// No key and null: nothing to write.
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: null })).toBe(TITLES);
	});

	it('removing male-name keeps female-name, and the other way round', () => {
		const both = edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke', femaleName: 'Duchess' });
		expect(both).toBe(TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    male-name: Grand Duke\n    female-name: Duchess\n'));
		expect(edit(both, { kind: 'edit-title', id: 'duke', maleName: null })).toBe(both.replace('    male-name: Grand Duke\n', ''));
		expect(edit(both, { kind: 'edit-title', id: 'duke', femaleName: null })).toBe(both.replace('    female-name: Duchess\n', ''));
	});

	it('writes a value equal to the name as typed', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Duke of Valmont' })).toBe(
			TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    male-name: Duke of Valmont\n'),
		);
	});

	it('changes name, male-name, female-name and plural in one write', () => {
		const out = edit(TITLES, { kind: 'edit-title', id: 'duke', name: 'Ruler', maleName: 'Grand Duke', femaleName: 'Grand Duchess', plural: 'Rulers' });
		expect(out).toBe(TITLES.replace('    name: Duke of Valmont\n    plural: Dukes of Valmont\n', '    name: Ruler\n    male-name: Grand Duke\n    female-name: Grand Duchess\n    plural: Rulers\n'));
	});

	it('keeps a hand-typed position and quoting of the key when it changes', () => {
		const src = TITLES.replace('    numbering: written\n    holders: []\n', "    numbering: written\n    male-name: 'Duke'\n    holders: []\n");
		expect(edit(src, { kind: 'edit-title', id: 'duke', maleName: 'Grand Duke' })).toBe(src.replace("male-name: 'Duke'", "male-name: 'Grand Duke'"));
	});

	it('quotes the value as for name', () => {
		expect(edit(TITLES, { kind: 'edit-title', id: 'duke', maleName: 'Duke: the Great' })).toBe(
			TITLES.replace('    name: Duke of Valmont\n', '    name: Duke of Valmont\n    male-name: "Duke: the Great"\n'),
		);
	});

	it('refuses a value that is not text', () => {
		expect(code(TITLES, { kind: 'edit-title', id: 'duke', maleName: 5 as unknown as string })).toBe('bad-value');
	});
});
