import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { blockOf, lineOfTitle } from './r027-support';
import { applyTitleOp, type AnyOp } from './titles-support';

/*
 * Version 0.2.7, WP2 fix round (the 0.2.7 contract L.9; spec D189). What the round changes in the result of
 * `successionLine` and in the writes of `edit-title`: `noYear` reports only a text that could change the ruler
 * and never an open-end word, the named-heir state `not-born`, `leftOutNoSex` for the house forms, and the
 * comment of a curly-quoted list item. The cost fixes (`old` once for each call, `findCoRulers` in O(h), a `Set`
 * for the named heirs) must leave every result as it was: the tests below pin those results. Every expected
 * value is written by hand from the contract. These tests wait for the fix round (`src/core/succession.ts`,
 * `title-ops.ts`).
 * Run: npx vitest run tests/acceptance/r027-fix-round.test.ts
 */

const HOUSE = [
	'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
	'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
	'{id: c1, name: C1, sex: m, born: 1175, parents: [r]}',
	'{id: c2, name: C2, sex: f, born: 1177, parents: [r]}',
];
const RULE = ['succession: eldest-child', 'inherit: no-preference'];
const withYear = (year: string) => [...RULE, `year: ${year}`];

// ---- noYear: only a text that could change the ruler (L.9) ----

describe('noYear: a to-text that means an open end is open and is never reported (contract L.9)', () => {
	const OPEN = ['present', 'now', 'current', 'ongoing', 'living', 'alive', 'reigning', '" Present "', '"NOW"', 'Reigning', '"  Ongoing"'];

	it.each(OPEN)('the last entry has `to: %s`: the line is for now, and nothing is reported', (word) => {
		const holders = ['{person: a1, from: 1150, to: 1180}', `{person: r, from: 1180, to: ${word}}`];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, RULE));
		expect([result.kind, result.ruler, result.year, result.yearFrom]).toEqual(['line', 'r', null, 'now']);
		expect(result.heirs).toEqual(['c1', 'c2']);
		expect(result.noYear).toEqual([]);
	});

	it('an open-end word on an entry that the scan reads is not reported either (an entry with no `from` follows it)', () => {
		const holders = ['{person: a1, from: 1100, to: present}', '{person: r}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1160')));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toEqual([]);
	});

	it('a to-text with no year that is not an open-end word is reported when the default year comes from it', () => {
		const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: someday}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, RULE));
		expect([result.ruler, result.yearFrom]).toEqual(['r', 'now']);
		expect(result.noYear).toEqual([{ id: 'r', what: 'reign', entry: 1 }]);
	});

	it('the same unreadable text is not reported when a Year field decides the year and the scan does not read it', () => {
		const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: someday}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1190')));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toEqual([]);
	});
});

describe('noYear: a text is reported when the scan of B.3 reads it up to the ruler (contract L.9, B.3)', () => {
	it('a `from` text with no year, on an entry before the ruler, with a number year', () => {
		const holders = ['{person: a1, from: "age of myth", to: 1180}', '{person: r, from: 1180}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1190')));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toContainEqual({ id: 'a1', what: 'reign', entry: 0 });
	});

	it('a `to` text with no year that decides whether a later entry with no `from` has started', () => {
		const holders = ['{person: a1, from: 1100, to: "long ago"}', '{person: r}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1160')));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toContainEqual({ id: 'a1', what: 'reign', entry: 0 });
	});

	it('the ruler\'s own `from` text with no year, with a number year', () => {
		const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: "early times"}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1190')));
		expect(result.noYear).toEqual([{ id: 'r', what: 'reign', entry: 1 }]);
	});

	it('an entry far after the ruler, behind the entry that stops the scan, is never reported', () => {
		const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: 1250}', '{name: Xerxes, from: 1300}', '{name: Zed, from: someday}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, withYear('1190')));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toEqual([]);
	});

	it('with the year "now" no `from` text is read, so none is reported', () => {
		const holders = ['{person: a1, from: "age of myth", to: 1180}', '{person: r, from: "early times"}'];
		const { result } = lineOfTitle(blockOf(HOUSE, holders, RULE));
		expect([result.ruler, result.yearFrom]).toEqual(['r', 'now']);
		expect(result.noYear).toEqual([]);
	});
});

describe('noYear: the legendary house (contract L.9, the example of the genealogy check)', () => {
	// Holders a (from "age of myth", to "long ago"), b (from "age of myth"), c (from 1000, to present): the line is for now,
	// the ruler is c, and the legends of a and b cannot change that, so nothing is reported.
	const people = [
		'{id: a, name: A, sex: m, born: "age of myth", died: "long ago"}',
		'{id: b, name: B, sex: m, born: "age of myth", parents: [a]}',
		'{id: c, name: C, sex: m, born: 980, parents: [b]}',
		'{id: d, name: D, sex: m, born: 1010, parents: [c]}',
	];
	const holders = ['{person: a, from: "age of myth", to: "long ago"}', '{person: b, from: "age of myth"}', '{person: c, from: 1000, to: present}'];

	it('the ruler is c, the line is d, and there is no noYear row', () => {
		const { result } = lineOfTitle(blockOf(people, holders, RULE));
		expect([result.kind, result.ruler, result.year, result.yearFrom]).toEqual(['line', 'c', null, 'now']);
		expect(result.heirs).toEqual(['d']);
		expect(result.noYear).toEqual([]);
	});

	it('the open end of c is never reported, also when a Year field makes the scan read the legends', () => {
		const { result } = lineOfTitle(blockOf(people, holders, withYear('1100')));
		expect(result.ruler).toBe('c');
		expect(result.noYear.some((n) => n.id === 'c')).toBe(false);
	});
});

describe('noYear: the born texts of the heirs are still reported (contract J.2, K.4)', () => {
	it('with the year "now" and a rule that does not use birth years, a born text is not read', () => {
		const people = [...HOUSE.slice(0, 2), '{id: x, name: X, sex: m, born: "long ago", parents: [r]}'];
		const { result } = lineOfTitle(blockOf(people, ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'], RULE));
		expect(result.heirs).toEqual(['x']);
		expect(result.noYear).toEqual([]);
	});
});

// ---- The named heir who is not born yet (L.9) ----

describe('a named heir who is not born yet gets the state not-born (contract L.9)', () => {
	const people = [...HOUSE, '{id: x, name: X, sex: m, born: 1210, parents: [r]}'];
	const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'];
	const line = (extra: string[], keys: string[] = withYear('1190'), people_ = people) => lineOfTitle(blockOf(people_, holders, [...keys, ...extra])).result;

	it('born after the year of the line: state not-born, and not in the line', () => {
		const result = line(['heir: x']);
		expect(result.namedHeirs).toEqual([{ id: 'x', state: 'not-born' }]);
		expect(result.heirs).toEqual(['c1', 'c2']);
	});

	it('the same person with the year "now": born, so the state is first', () => {
		const result = line(['heir: x'], RULE);
		expect(result.namedHeirs).toEqual([{ id: 'x', state: 'first' }]);
		expect(result.heirs[0]).toBe('x');
	});

	it('born in the year of the line: alive, so the state is first', () => {
		const result = line(['heir: x'], withYear('1210'));
		expect(result.namedHeirs).toEqual([{ id: 'x', state: 'first' }]);
	});

	it('a born text with no year: the person counts as born', () => {
		const result = line(['heir: x'], withYear('1190'), [...HOUSE, '{id: x, name: X, sex: m, born: "long ago", parents: [r]}']);
		expect(result.namedHeirs).toEqual([{ id: 'x', state: 'first' }]);
	});

	it('not born yet wins over a death date of later years (a person is not dead before birth)', () => {
		const dead = [...HOUSE, '{id: x, name: X, sex: m, born: 1210, died: 1215, parents: [r]}'];
		expect(line(['heir: x'], withYear('1190'), dead).namedHeirs).toEqual([{ id: 'x', state: 'not-born' }]);
		const text = [...HOUSE, '{id: x, name: X, sex: m, born: 1210, died: "in infancy", parents: [r]}'];
		expect(line(['heir: x'], withYear('1190'), text).namedHeirs).toEqual([{ id: 'x', state: 'not-born' }]);
	});

	it('a person who died before the year is still not-alive, not not-born', () => {
		const dead = [...HOUSE, '{id: x, name: X, sex: m, born: 1160, died: 1170, parents: [r]}'];
		expect(line(['heir: x'], withYear('1190'), dead).namedHeirs).toEqual([{ id: 'x', state: 'not-alive' }]);
	});

	it('with no rule (B.6): a line of nobody, and the state is still reported', () => {
		const result = lineOfTitle(blockOf(people, holders, ['year: 1190', 'heir: x'])).result;
		expect([result.kind, result.heirs, result.namedHeirs]).toEqual(['line', [], [{ id: 'x', state: 'not-born' }]]);
	});

	it('in a list, the others keep their own states and the not-born person takes no place of the limit', () => {
		const result = lineOfTitle(blockOf(people, holders, [...withYear('1190'), 'heir: [x, c2]']), 'duke', 2).result;
		expect(result.namedHeirs).toEqual([
			{ id: 'x', state: 'not-born' },
			{ id: 'c2', state: 'first' },
		]);
		expect(result.heirs).toEqual(['c2', 'c1']);
		expect(result.more).toBe(false);
	});
});

describe('named heirs: a repeated id is ignored (contract K.3, L.9)', () => {
	const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'];

	it('a repeated id gives one state and one place in the line, in the order of the first mention', () => {
		const { result } = lineOfTitle(blockOf(HOUSE, holders, [...RULE, 'heir: [c2, c1, c2, c1, c2]']));
		expect(result.heirs).toEqual(['c2', 'c1']);
		expect(result.namedHeirs).toEqual([
			{ id: 'c2', state: 'first' },
			{ id: 'c1', state: 'first' },
		]);
	});

	it('a repeated id that names nobody gives one not-in-tree state', () => {
		const { result } = lineOfTitle(blockOf(HOUSE, holders, [...RULE, 'heir: [ghost, c1, ghost]']));
		expect(result.namedHeirs).toEqual([
			{ id: 'ghost', state: 'not-in-tree' },
			{ id: 'c1', state: 'first' },
		]);
	});

	it('a long list with many repeats keeps the same result (the cost fix must not change it)', () => {
		const ids = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 'c1' : 'c2'));
		const { result } = lineOfTitle(blockOf(HOUSE, holders, [...RULE, `heir: [${ids.join(', ')}]`]));
		expect(result.namedHeirs).toEqual([
			{ id: 'c1', state: 'first' },
			{ id: 'c2', state: 'first' },
		]);
	});
});

// ---- leftOutNoSex (L.9) ----

describe('leftOutNoSex: a person that the second pass of a house form puts in the line is not left out (contract L.9)', () => {
	const people = [
		'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
		'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
		'{id: c1, name: C1, sex: m, born: 1175, parents: [r]}',
		'{id: x, name: X, born: 1177, parents: [r]}',
		'{id: xs, name: Xs, sex: m, born: 1200, parents: [x]}',
	];
	const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'];
	const run = (inherit: string, more: string[] = []) => lineOfTitle(blockOf(people, holders, ['succession: eldest-child', `inherit: ${inherit}`, ...more])).result;

	it('men-first-in-house: pass 2 takes the person with no sex and his son, so nobody is left out', () => {
		const result = run('men-first-in-house');
		expect(result.heirs).toEqual(['c1', 'x', 'xs']);
		expect(result.leftOutNoSex).toBe(0);
	});

	it('women-first-in-house: the same', () => {
		const result = run('women-first-in-house');
		expect(result.heirs).toEqual(['c1', 'x', 'xs']);
		expect(result.leftOutNoSex).toBe(0);
	});

	it('men-only: the person with no sex is left out, and counted once', () => {
		const result = run('men-only');
		expect(result.heirs).toEqual(['c1']);
		expect(result.leftOutNoSex).toBe(1);
	});

	it('men-only with two illegitimacy passes: still counted once', () => {
		const result = run('men-only', ['inherit-illegitimate: after']);
		expect(result.heirs).toEqual(['c1']);
		expect(result.leftOutNoSex).toBe(1);
	});

	it('men-first-in-house with two illegitimacy passes: nobody is left out', () => {
		const result = run('men-first-in-house', ['inherit-illegitimate: after']);
		expect(result.heirs).toEqual(['c1', 'x', 'xs']);
		expect(result.leftOutNoSex).toBe(0);
	});

	it('a rule that accepts everybody leaves nobody out', () => {
		expect(run('no-preference').leftOutNoSex).toBe(0);
		expect(run('men-first').leftOutNoSex).toBe(0);
	});
});

// ---- old: the same results after the cost fix (L.9 finding 1) ----

describe('old: the results stay as they were (contract B.4, K.8, L.9)', () => {
	// F's sons: A1 (the old ruler's line) and the uncles U (born 1069) and V (born 1070); the tree reaches 1180.
	const people = [
		'{id: f, name: F, sex: m, born: 1040, died: 1120}',
		'{id: a1, name: A1, sex: m, born: 1100, died: 1180, parents: [f]}',
		'{id: u, name: U, sex: m, born: 1069, parents: [f]}',
		'{id: v, name: V, sex: m, born: 1070, parents: [f]}',
		'{id: w, name: W, sex: m, parents: [f]}',
		'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
	];
	const holders = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'];
	const old = (keys: string[] = RULE, oldAge = 110, hs = holders, ps = people) => lineOfTitle(blockOf(ps, hs, keys), 'duke', 50, oldAge).result;

	it('with the year "now" the reference year is the latest year of the tree; "older than N" means more than N years', () => {
		const result = old();
		expect(result.heirs).toEqual(['u', 'v', 'w']);
		// The latest year is 1180: U is 111 years old (older than 110), V is 110 (not older), W has no born year (never old).
		expect(result.old).toEqual(['u']);
	});

	it('the latest year also comes from a `from` or `to` text of a holder', () => {
		const later = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1300, to: present}'];
		const result = old(RULE, 110, later);
		expect(result.heirs).toEqual(['u', 'v', 'w']);
		expect(result.old).toEqual(['u', 'v']);
	});

	it('the limit is an argument, and 0 gives no warning', () => {
		expect(old(RULE, 0).old).toEqual([]);
		expect(old(RULE, 111).old).toEqual([]);
		expect(old(RULE, 109).old).toEqual(['u', 'v']);
	});

	it('a Year field with a number is the reference year, whatever the tree holds', () => {
		expect(old(withYear('1170')).old).toEqual([]);
		expect(old(withYear('1181')).old).toEqual(['u', 'v']);
	});

	it('a born text with a year counts', () => {
		const text = people.map((p) => p.replace('born: 1069', 'born: "c. 1069"'));
		expect(old(RULE, 110, holders, text).old).toEqual(['u']);
	});

	it('an heir with a death date is never old; the warning does not change the line', () => {
		const dead = people.map((p) => p.replace('born: 1069,', 'born: 1069, died: 1175,'));
		const result = old(RULE, 110, holders, dead);
		expect(result.heirs).toEqual(['v', 'w']);
		expect(result.old).toEqual([]);
	});

	it('many heirs: only the heirs of the returned line are checked, in the order of the line', () => {
		const kids = Array.from({ length: 200 }, (_, i) => `{id: k${i}, name: K${i}, sex: m, born: 1010, parents: [r0]}`);
		const tree = ['{id: r0, name: R0, sex: m, born: 1000}', ...kids, '{id: z, name: Z, sex: m, born: 1290, died: 1300}'];
		const h = ['{person: r0, from: 1000}'];
		const full = lineOfTitle(blockOf(tree, h, RULE), 'duke', 20, 110).result;
		expect(full.heirs).toEqual(Array.from({ length: 20 }, (_, i) => `k${i}`));
		expect(full.old).toEqual(full.heirs);
		expect(full.more).toBe(true);
		const one = lineOfTitle(blockOf(tree, h, RULE), 'duke', 1, 110).result;
		expect(one.old).toEqual(['k0']);
	});

	it('an heir the rule leaves out is not checked; a named heir is, also when the rule would leave him out', () => {
		const result = old(['succession: eldest-child', 'inherit: women-only', 'heir: u']);
		expect(result.heirs).toEqual(['u']);
		expect(result.old).toEqual(['u']);
	});
});

// ---- co-rulers: the same results after the cost fix (L.9 finding 2) ----

describe('coRulers: the results stay as they were (contract K.6, L.9)', () => {
	const mk = (n: number) => Array.from({ length: n }, (_, i) => `{id: p${i}, name: P${i}, sex: m, born: 1000}`);
	const co = (people: string[], holders: string[], keys: string[] = ['succession: eldest-child']) => lineOfTitle(blockOf(people, holders, keys)).result;

	it('a later entry that starts at the same year does not end an earlier one (William and Mary), but a later year does', () => {
		const people = mk(3);
		const result = co(people, ['{person: p0, from: 1660}', '{person: p1, from: 1689}', '{person: p2, from: 1689, to: 1700}']);
		expect([result.ruler, result.coRulers]).toEqual(['p2', ['p1']]);
	});

	it('an entry whose `to` year is the year of the line has ended; one that ends a year later has not', () => {
		const people = mk(2);
		const ended = co(people, ['{person: p0, from: 1650, to: 1700}', '{person: p1, from: 1689, to: 1710}'], withYear('1700'));
		expect([ended.ruler, ended.coRulers]).toEqual(['p1', []]);
		const open = co(people, ['{person: p0, from: 1650, to: 1701}', '{person: p1, from: 1689, to: 1710}'], withYear('1700'));
		expect([open.ruler, open.coRulers]).toEqual(['p1', ['p0']]);
	});

	it('an earlier entry with no `to` has ended when a later entry with no `from` has started', () => {
		const result = co(mk(2), ['{person: p0, from: 1660}', '{person: p1}']);
		expect([result.ruler, result.coRulers]).toEqual(['p1', []]);
	});

	it('1 500 holders in a row, each from a later year: nobody co-rules', () => {
		const n = 1500;
		const result = co(mk(n), Array.from({ length: n }, (_, i) => `{person: p${i}, from: ${1000 + i}}`));
		expect([result.ruler, result.coRulers]).toEqual([`p${n - 1}`, []]);
	});

	it('1 500 holders from the same year: all but the ruler co-rule, once each', () => {
		const n = 1500;
		const result = co(mk(n), Array.from({ length: n }, (_, i) => `{person: p${i}, from: 1200}`));
		expect(result.ruler).toBe(`p${n - 1}`);
		expect(result.coRulers.length).toBe(n - 1);
		expect(new Set(result.coRulers)).toEqual(new Set(Array.from({ length: n - 1 }, (_, i) => `p${i}`)));
	});
});

// ---- The comment of a curly-quoted list item (L.9 finding 4) ----

describe('edit-title keeps the comment of a curly-quoted list item (contract L.9)', () => {
	const NOTE = [
		'titles:',
		'  - id: duke',
		'    name: Duke',
		'    heir:',
		'      - “hugo” # the eldest',
		'      - wren',
		'    holders: [aldric]',
		'people:',
		'  - {id: aldric, name: Aldric}',
		'  - {id: hugo, name: Hugo}',
		'  - {id: wren, name: Wren}',
		'  - {id: tom, name: Tom}',
		'',
	].join('\n');
	const edit = (heirs: string[]) => applyTitleOp(NOTE, { kind: 'edit-title', id: 'duke', heirs } as AnyOp);

	it('the written ids again (the first item is written with curly marks): nothing changes', () => {
		const r = edit(['hugo', 'wren']);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.body).toBe(NOTE);
	});

	it('an id added at the end: the comment stays, and the ids read as asked', () => {
		const r = edit(['hugo', 'wren', 'tom']);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.body).toContain('# the eldest');
		const parsed = parseDynasty(r.body);
		if (!parsed.ok) throw new Error('parse');
		expect(deriveFamilies(parsed.tree).titles[0].heirs).toEqual(['hugo', 'wren', 'tom']);
	});
});

// ---- The refusal text of inheritIllegitimate (L.9, J.10) ----

describe('the refusal text for a value of inheritIllegitimate that is not known (contract L.9, J.10)', () => {
	const body = ['titles:', '  - id: duke', '    name: Duke', '    holders: [aldric]', 'people:', '  - {id: aldric, name: Aldric}', ''].join('\n');

	it('is refused as bad-value and the text names the box Illegitimate', () => {
		const r = applyTitleOp(body, { kind: 'edit-title', id: 'duke', inheritIllegitimate: 'maybe' } as unknown as AnyOp);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.code).toBe('bad-value');
		expect(r.detail).toContain('children with the box “Illegitimate” ticked');
		expect(r.detail).not.toContain('born outside a marriage');
	});
});
