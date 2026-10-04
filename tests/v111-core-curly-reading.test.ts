import { describe, expect, it } from 'vitest';
import { build } from './helpers';
import { parseDynasty } from '../src/core/parse';
import { linkTargets, parsePictureLink } from '../src/core/link-rewrite';
import { curlyParts, unwrapCurly } from '../src/core/tolerate';

// Version 0.2.1, D103 (spec §13.16 rule 11): one pair of curly quote marks around a structural value
// (colour, link, picture links, references) is read as the value inside. Names, titles and notes
// are read as typed. A phone keyboard makes these marks from ' and " (Smart Punctuation).

const PAIRS: [string, string, string][] = [
	['double', '“', '”'],
	['single', '‘', '’'],
	['low-high', '„', '“'],
	['low-close', '„', '”'],
];

const tree = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};
const wrap = (open: string, v: string, close: string) => `${open}${v}${close}`;

describe('curly pairs: the helper', () => {
	it.each(PAIRS)('takes off a %s pair', (_, o, c) => {
		expect(curlyParts(wrap(o, 'x y', c))).toEqual({ open: o, inner: 'x y', close: c });
		expect(unwrapCurly(wrap(o, ' x ', c))).toBe('x');
	});

	it('leaves a value that is not wrapped as a whole, or is wrapped by marks that do not pair', () => {
		for (const v of ['“x', 'x”', '“x’', '‘x”', 'a “x”', '“x” b', '“a” and “b”', '““x””', '“‘x’”', 'x', '“', '']) {
			expect(unwrapCurly(v)).toBe(v);
		}
	});

	it('keeps an apostrophe inside the marks', () => {
		expect(unwrapCurly('“[[d’España]]”')).toBe('[[d’España]]');
		expect(unwrapCurly('‘[[d’España]]’')).toBe('[[d’España]]');
		expect(unwrapCurly('“’tis”')).toBe('’tis');
	});

	it('takes off only one pair, so a second reading changes nothing', () => {
		for (const v of ['“x”', '““x””', '“ ‘x’ ”', 'plain']) {
			const once = unwrapCurly(v);
			expect(unwrapCurly(once)).toBe(once);
		}
	});

	it('does not change a value that is not text', () => {
		expect(unwrapCurly(5)).toBe(5);
		expect(unwrapCurly(undefined)).toBeUndefined();
		expect(unwrapCurly(null)).toBeNull();
	});
});

describe('curly pairs: colour', () => {
	it.each(PAIRS)('reads a house colour in a %s pair like the colour inside', (_, o, c) => {
		const t = tree(`houses:\n  - id: v\n    name: Valmont\n    color: ${wrap(o, '#fff', c)}\n`);
		expect(t.houses[0].color).toBe('#fff');
		expect(t.issues).toEqual([]);
	});

	it('gives the colour and no warning for the owner example', () => {
		const { tree: t, g } = build('houses:\n  - id: v\n    name: Valmont\n    color: “#fff”\npeople:\n  - {id: a, name: A, house: v}\n');
		expect(t.houses[0].color).toBe('#fff');
		expect(g.issues).toEqual([]);
	});

	it('trims the spaces inside the marks', () => {
		// A space before the # would start a YAML comment, so the colour has its space after.
		const t = tree('houses:\n  - id: v\n    name: V\n    color: “#8b1e3f ”\npeople:\n  - {id: “ a ”, name: A, house: “ v ”}\n');
		expect(t.houses[0].color).toBe('#8b1e3f');
		expect(t.people[0]).toMatchObject({ id: 'a', house: 'v' });
	});

	it('reads the same in a flow map', () => {
		const t = tree('houses: [{id: v, name: V, color: “#fff”}]\n');
		expect(t.houses[0].color).toBe('#fff');
	});

	it('reads a straight-quoted colour as before', () => {
		expect(tree('houses:\n  - {id: v, name: V, color: "#fff"}\n').houses[0].color).toBe('#fff');
	});
});

describe('curly pairs: links and picture links', () => {
	it.each(PAIRS)('reads link, portrait and arms in a %s pair', (_, o, c) => {
		const t = tree(
			[
				'houses:',
				'  - id: v',
				'    name: V',
				`    arms: ${wrap(o, '[[valmont-arms.png]]', c)}`,
				'people:',
				'  - id: a',
				'    name: A',
				`    link: ${wrap(o, '[[Aldric]]', c)}`,
				`    portrait: ${wrap(o, '![[a.png]]', c)}`,
				'',
			].join('\n'),
		);
		expect(t.houses[0].arms).toBe('[[valmont-arms.png]]');
		expect(t.people[0].link).toBe('[[Aldric]]');
		expect(t.people[0].portrait).toBe('![[a.png]]');
	});

	it('gives the picture parser the name inside the marks', () => {
		const t = tree('people:\n  - id: a\n    name: A\n    portrait: “[[Pictures/a.png|Face]]”\n');
		expect(parsePictureLink(t.people[0].portrait!)?.target).toBe('Pictures/a.png');
	});

	it('lists the targets of curly links for the rename scan', () => {
		const body = 'houses:\n  - id: v\n    name: V\n    arms: “[[arms.png]]”\npeople:\n  - id: a\n    name: A\n    link: “[[Old]]”\n    portrait: ‘[[p.png]]’\n';
		expect(linkTargets(body)).toEqual(['arms.png', 'Old', 'p.png']);
	});

	it('reads a Markdown link and a bare name inside the marks', () => {
		const t = tree('people:\n  - id: a\n    name: A\n    link: “[Al](Notes/Aldric.md)”\n  - id: b\n    name: B\n    link: “Notes/Bea”\n');
		expect(t.people[0].link).toBe('[Al](Notes/Aldric.md)');
		expect(t.people[1].link).toBe('Notes/Bea');
	});

	it('keeps an apostrophe in a name inside the marks', () => {
		const t = tree('people:\n  - id: a\n    name: A\n    link: “[[d’España]]”\n');
		expect(t.people[0].link).toBe('[[d’España]]');
	});
});

describe('curly pairs: references', () => {
	const SRC = [
		'options:',
		'  start: “aldric”',
		'  focus: ‘bea’',
		'  me: “cara”',
		'houses:',
		'  - {id: “valmont”, name: Valmont}',
		'people:',
		'  - {id: “aldric”, name: Aldric, house: “valmont”}',
		'  - {id: “bea”, name: Bea}',
		'  - id: cara',
		'    name: Cara',
		'    house: “valmont”',
		'    parents: [“aldric”, ‘bea’]',
		'    union: “u1”',
		'    placement: “birth”',
		'  - id: dan',
		'    name: Dan',
		'    parents: “aldric”',
		'  - id: eve',
		'    name: Eve',
		'    parents:',
		'      - {id: “aldric”, type: adoptive}',
		'unions:',
		'  - {id: “u1”, partners: [“aldric”, “bea”]}',
		'  - partners: “dan”',
		'',
	].join('\n');

	it('reads every reference like the id inside', () => {
		const t = tree(SRC);
		expect(t.options).toMatchObject({ start: 'aldric', focus: 'bea', me: 'cara' });
		expect(t.houses[0].id).toBe('valmont');
		expect(t.people.map((p) => p.id)).toEqual(['aldric', 'bea', 'cara', 'dan', 'eve']);
		expect(t.people[0].house).toBe('valmont');
		expect(t.people[2]).toMatchObject({ house: 'valmont', union: 'u1', placement: 'birth' });
		expect(t.people[2].parents).toEqual([
			{ id: 'aldric', type: 'birth' },
			{ id: 'bea', type: 'birth' },
		]);
		expect(t.people[3].parents).toEqual([{ id: 'aldric', type: 'birth' }]);
		expect(t.people[4].parents).toEqual([{ id: 'aldric', type: 'adoptive' }]);
		expect(t.unions[0]).toMatchObject({ id: 'u1', partners: ['aldric', 'bea'] });
		expect(t.unions[1].partners).toEqual(['dan']);
	});

	it('resolves a person in marks, with no warning for the references', () => {
		const { g } = build(SRC);
		expect(g.byId.get('aldric')?.name).toBe('Aldric');
		expect(g.byId.get('cara')?.parents.map((p) => p.id)).toEqual(['aldric', 'bea']);
		expect(g.houses.get('valmont')?.name).toBe('Valmont');
		const unresolved = ['missing-parent', 'missing-partner', 'missing-house', 'missing-union', 'missing-start', 'missing-focus', 'missing-me', 'unknown-placement'];
		expect(g.issues.filter((i) => unresolved.includes(i.code))).toEqual([]);
	});

	it.each(PAIRS)('reads a person id in a %s pair', (_, o, c) => {
		const { g } = build(`people:\n  - {id: ${wrap(o, 'a', c)}, name: A}\n  - {id: b, name: B, parents: [${wrap(o, 'a', c)}]}\n`);
		expect(g.byId.get('a')?.name).toBe('A');
		expect(g.byId.get('b')?.parents.map((p) => p.id)).toEqual(['a']);
	});

	it('reads the holder of a title in marks', () => {
		const t = tree('titles:\n  - id: crown\n    name: Crown\n    holders: [“aldric”, {person: “bea”, as: King}]\n  - id: duke\n    name: Duke\n    holders: “cara”\npeople:\n  - {id: aldric, name: A}\n');
		expect(t.titles![0].holders.map((h) => h.person)).toEqual(['aldric', 'bea']);
		expect(t.titles![1].holders.map((h) => h.person)).toEqual(['cara']);
	});

	it('reads a reference in marks like the straight one in the warnings too', () => {
		const curly = build('people:\n  - {id: a, name: A, parents: [“zed”]}\n').g.issues.map((i) => i.params);
		const straight = build('people:\n  - {id: a, name: A, parents: ["zed"]}\n').g.issues.map((i) => i.params);
		expect(curly).toEqual(straight);
	});
});

describe('curly pairs: values that stay as typed', () => {
	it('does not touch names, titles, notes, dates and other keys', () => {
		const q = (v: string) => `“${v}”`;
		const t = tree(
			[
				'houses:',
				`  - {id: v, name: ${q('House Valmont')}}`,
				'people:',
				'  - id: a',
				`    name: ${q('Aldric')}`,
				`    title: ${q('The Bold')}`,
				`    card-title: ${q('crown')}`,
				`    sex: ${q('m')}`,
				`    born: ${q('1102')}`,
				`    notes: ${q('A note')}`,
				'    house: v',
				'',
			].join('\n'),
		);
		expect(t.houses[0].name).toBe(q('House Valmont'));
		expect(t.people[0]).toMatchObject({ name: q('Aldric'), title: q('The Bold'), cardTitle: q('crown'), sex: q('m'), born: q('1102'), notes: q('A note') });
	});

	it('does not touch the type of a parent or a partnership', () => {
		const t = tree('people:\n  - {id: a, name: A}\n  - {id: b, name: B, parents: [{id: a, type: “adoptive”}]}\nunions:\n  - {partners: [a, b], type: “marriage”, start: “1100”}\n');
		expect(t.people[1].parents[0].type).toBe('“adoptive”');
		expect(t.unions[0]).toMatchObject({ type: '“marriage”', start: '“1100”' });
	});

	it('does not touch holder names and title names', () => {
		const t = tree('titles:\n  - id: crown\n    name: “Crown”\n    holders:\n      - {name: “Usurper”, as: “King”}\n');
		expect(t.titles![0].name).toBe('“Crown”');
		expect(t.titles![0].holders[0]).toMatchObject({ name: '“Usurper”', as: '“King”' });
	});

	it('keeps each unbalanced value as typed', () => {
		const t = tree('people:\n  - id: a\n    name: A\n    link: “[[A]]” and “[[B]]”\n  - id: b\n    name: B\n    link: ““[[B]]””\n  - id: c\n    name: C\n    link: x “[[C]]”\n  - id: d\n    name: D\n    link: “[[D]]\n');
		expect(t.people.map((p) => p.link)).toEqual(['“[[A]]” and “[[B]]”', '““[[B]]””', 'x “[[C]]”', '“[[D]]']);
	});

	it('keeps an unbalanced colour as typed', () => {
		for (const v of ['“#fff', 'fff”', '“#fff’']) {
			const t = tree(`houses:\n  - id: v\n    name: V\n    color: ${v}\n`);
			expect(t.houses[0].color).toBe(v);
		}
	});
});

describe('curly pairs: empty inside', () => {
	it('reads marks with nothing inside like empty straight marks', () => {
		const curly = tree('houses:\n  - {id: v, name: V, color: “”, arms: “ ”}\npeople:\n  - {id: a, name: A, link: “”, portrait: “  ”}\n');
		const straight = tree('houses:\n  - {id: v, name: V, color: "", arms: " "}\npeople:\n  - {id: a, name: A, link: "", portrait: "  "}\n');
		expect(curly.houses[0].color).toBeUndefined();
		expect(curly.houses[0].arms).toBeUndefined();
		expect(curly.people[0].link).toBeUndefined();
		expect(curly.people[0].portrait).toBeUndefined();
		expect(curly.issues).toEqual(straight.issues);
	});

	it('reports an id with nothing inside as a missing id', () => {
		const t = tree('people:\n  - {id: “”, name: Nobody}\n');
		expect(t.issues.map((i) => i.code)).toEqual(['missing-id']);
	});
});
