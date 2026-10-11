import { describe, expect, it } from 'vitest';
import { specOf, successionLine } from '../../src/core/succession';
import { RUNS } from './r027-cases-data';
import { blockOf, graphOf, lineOfRun, lineOfTitle, sourceOf, titleIn } from './r027-support';

/*
 * Version 0.2.7, WP2: the parts of the result of `successionLine` that the case table does not show, and the
 * rules of the 0.2.7 contract sections B (year, ruler, who is alive), C.2 (claim links), C.10 (length), D.1 (kinds),
 * J.4, J.7, J.9 and K.6 to K.9 (co-rulers, `old`, `noYear`, `leftOutNoSex`, `noBirthYear`). Each expected
 * value is written by hand from the contract. These tests wait for WP 2 (`src/core/succession.ts`).
 * Run: npx vitest run tests/acceptance/r027-succession-results.test.ts
 */

const run = (id: string) => {
	const r = RUNS.find((x) => x.id === id);
	if (!r) throw new Error(`No run ${id}`);
	return r;
};
const HOUSE = [
	'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
	'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
	'{id: c1, name: C1, sex: m, born: 1175, parents: [r]}',
	'{id: c2, name: C2, sex: f, born: 1177, parents: [r]}',
];
const REIGNS = ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'];

describe('the kind of a result (contract D.1, B.6)', () => {
	it('a title with no succession and no heir has no line: no-rule', () => {
		expect(lineOfTitle(blockOf(HOUSE, REIGNS, [])).result.kind).toBe('no-rule');
	});

	it.each([
		['succession: salic', 'succession'],
		['inherit: sideways', 'inherit'],
		['inherit-through: sideways', 'inherit-through'],
		['inherit-illegitimate: maybe', 'inherit-illegitimate'],
		['succession: [eldest-child, youngest-child]', 'succession'],
		['inherit: {a: b}', 'inherit'],
	])('%s: bad-rule, and no line', (key, bad) => {
		const { title, result } = lineOfTitle(blockOf(HOUSE, REIGNS, key.startsWith('succession') ? [key, 'inherit: men-only'] : ['succession: eldest-child', key]));
		expect(specOf(title).bad).toBe(bad);
		expect(result.kind).toBe('bad-rule');
		expect(result.heirs).toEqual([]);
	});

	it('a title with a named heir and no rule has a line of the named heirs (B.6)', () => {
		const { result } = lineOfTitle(blockOf(HOUSE, REIGNS, ['heir: c2']));
		expect([result.kind, result.heirs, result.namedHeirs]).toEqual(['line', ['c2'], [{ id: 'c2', state: 'first' }]]);
	});

	it('B.6: several named heirs in list order, only those alive at the year, not the ruler, not excluded', () => {
		const people = [...HOUSE, '{id: dead, name: Dead, sex: m, born: 1160, died: 1185, parents: [a1]}', '{id: x, name: X, sex: f, born: 1178, parents: [r]}'];
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['heir: [x, c1, dead, r, c2, ghost]', 'exclude: c2']));
		expect(result.kind).toBe('line');
		expect(result.heirs).toEqual(['x', 'c1']);
		expect(result.namedHeirs).toEqual([
			{ id: 'x', state: 'first' },
			{ id: 'c1', state: 'first' },
			{ id: 'dead', state: 'not-alive' },
			{ id: 'r', state: 'is-ruler' },
			{ id: 'c2', state: 'excluded' },
			{ id: 'ghost', state: 'not-in-tree' },
		]);
	});

	it('B.6: a named heir who is dead gives a line of nobody: "No heir in the tree"', () => {
		const people = [...HOUSE, '{id: dead, name: Dead, sex: m, born: 1160, died: 1185, parents: [a1]}'];
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['heir: dead']));
		expect([result.kind, result.heirs]).toEqual(['line', []]);
	});

	it('C.11: a house with nobody left has kind line and an empty list', () => {
		const { result } = lineOfTitle(blockOf(HOUSE.slice(0, 2), REIGNS));
		expect([result.kind, result.heirs, result.more]).toEqual(['line', [], false]);
	});
});

describe('the year and the ruler (contract B.2, B.3)', () => {
	it('no Year field and a last reign with no end: now (year null)', () => {
		const { result } = lineOfRun(run('S01a'));
		expect([result.year, result.yearFrom, result.ruler]).toEqual([null, 'now', 'r']);
	});

	it('no Year field and a last reign with an end: the end of the last reign', () => {
		const { result } = lineOfRun(run('S11a'));
		expect([result.year, result.yearFrom, result.ruler]).toEqual([1199, 'reign-end', 'ric']);
	});

	it('a Year field: its year ("c. 1170" reads 1170), and the ruler of that year (the line of 1170)', () => {
		const { result } = lineOfRun(run('S23a'));
		expect([result.year, result.yearFrom, result.ruler]).toEqual([1170, 'field', 'a1']);
	});

	it('a Year field after the last reign keeps the last holder as the ruler', () => {
		const { result } = lineOfRun(run('S13a'));
		expect([result.year, result.yearFrom, result.ruler]).toEqual([1190, 'field', 'a1']);
	});

	it('a Year field with no year in it falls back to the end of the last reign', () => {
		const { result } = lineOfTitle(blockOf(HOUSE, ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: 1200}'], ['succession: eldest-child', 'year: "the old days"']));
		expect([result.year, result.yearFrom, result.ruler]).toEqual([1200, 'reign-end', 'r']);
	});

	it('the end of the last reign is read with the year reader: "to: c. 1200" is 1200', () => {
		const { result } = lineOfTitle(blockOf(HOUSE, ['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: "c. 1200"}']));
		expect([result.year, result.yearFrom]).toEqual([1200, 'reign-end']);
	});

	it('B.5 and S30: a ruler who is dead is still the ruler, and is not in his own line', () => {
		const { result } = lineOfRun(run('S30a'));
		expect([result.ruler, result.heirs.includes('r')]).toEqual(['r', false]);
	});

	it('K.6: an entry with a name and no person in the tree: ruler-not-in-tree', () => {
		const { result } = lineOfRun(run('S25a'));
		expect(result.kind).toBe('ruler-not-in-tree');
	});

	it('K.6: a dangling entry with no name does not exist for the line (the engine uses the validated entries)', () => {
		const holders = ['{person: a1, from: 1150, to: 1180}', '{person: ghost, from: 1180}'];
		const { g, result } = lineOfTitle(blockOf(HOUSE, holders));
		expect(g.issues.map((i) => i.code)).toContain('missing-holder');
		expect([result.kind, result.ruler, result.year, result.yearFrom]).toEqual(['line', 'a1', 1180, 'reign-end']);
		expect(result.heirs).toEqual(['r', 'c1', 'c2']);
	});

	it('the title the Titles window passes may have another holder list (the draft): the ruler follows that list', () => {
		const { g, title } = lineOfTitle(blockOf(HOUSE, REIGNS));
		const draft = { ...title, holders: [title.holders[0]] };
		const before = JSON.stringify(title);
		const result = successionLine(g, draft, specOf(draft), 50, 110);
		expect([result.ruler, result.year, result.heirs]).toEqual(['a1', 1180, ['r', 'c1', 'c2']]);
		expect(JSON.stringify(title)).toBe(before);
	});

	it('the call is pure: the same arguments give the same result, and the title does not change', () => {
		const { g, title } = lineOfTitle(blockOf(HOUSE, REIGNS));
		const before = JSON.stringify(title);
		const spec = specOf(title);
		const first = successionLine(g, title, spec, 50, 110);
		expect(successionLine(g, title, spec, 50, 110)).toEqual(first);
		expect(JSON.stringify(title)).toBe(before);
	});
});

describe('co-rulers (contract K.6)', () => {
	const people = ['{id: w, name: W, sex: m, born: 1650}', '{id: m, name: M, sex: f, born: 1662}', '{id: w2, name: W2, sex: m, born: 1700, parents: [w]}'];
	const co = (holders: string[]) => lineOfTitle(blockOf(people, holders)).result;

	it('William and Mary: both start in 1689 and neither has ended', () => {
		const r = co(['{person: w, from: 1689}', '{person: m, from: 1689}']);
		expect([r.ruler, r.coRulers]).toEqual(['m', ['w']]);
	});

	it('a normal handover (one `to` equals the next `from`) is no co-rule', () => {
		const r = co(['{person: w, from: 1660, to: 1689}', '{person: m, from: 1689}']);
		expect([r.ruler, r.coRulers]).toEqual(['m', []]);
	});

	it('an earlier entry with no `to` ends when a later entry starts later', () => {
		const r = co(['{person: w, from: 1660}', '{person: m, from: 1689}']);
		expect([r.ruler, r.coRulers]).toEqual(['m', []]);
	});

	it('an entry with no `from` year is never reported, and a holder who is not in the tree is not reported', () => {
		const holders = ['{person: w, from: 1660, to: 1700}', '{person: m, to: 1700}', '{name: Outsider, from: 1660, to: 1700}'];
		const r = lineOfTitle(blockOf(people, holders, ['succession: eldest-child', 'year: 1690'])).result;
		expect([r.ruler, r.coRulers]).toEqual(['w', []]);
	});

	it('no co-ruler: an empty list, not undefined', () => {
		expect(lineOfRun(run('S01a')).result.coRulers).toEqual([]);
	});
});

describe('who is alive (contract B.4, J.7)', () => {
	const tree = (died: string) => [
		'{id: a1, name: A1, sex: m, born: 1125, died: 1200}',
		`{id: e, name: E, sex: m, born: 1170, died: ${died}, parents: [a1]}`,
		'{id: y, name: Y, sex: m, born: 1175, parents: [a1]}',
	];
	const holders = ['{person: a1, from: 1150, to: 1200}'];

	it.each(['"alive"', '"Living"', '" never "', '"no"', 'false', '"false"'])('died: %s means alive (J.7)', (died) => {
		expect(lineOfTitle(blockOf(tree(died), holders)).result.heirs).toEqual(['e', 'y']);
	});

	it.each(['"?"', '"unknown"', '"maybe"', '"in infancy"', '1185', '"c. 1185"'])('died: %s means dead', (died) => {
		expect(lineOfTitle(blockOf(tree(died), holders)).result.heirs).toEqual(['y']);
	});

	it('a person who died in year Y is dead; one who died in the next year is alive (the line at the end of Y)', () => {
		const people = [...tree('1200'), '{id: z, name: Z, sex: m, born: 1176, died: 1201, parents: [a1]}'];
		expect(lineOfTitle(blockOf(people, holders)).result.heirs).toEqual(['y', 'z']);
	});

	it('a person born after Y is not alive at Y', () => {
		const people = [...tree('1185'), '{id: z, name: Z, sex: m, born: 1210, parents: [a1]}'];
		expect(lineOfTitle(blockOf(people, holders)).result.heirs).toEqual(['y']);
		expect(lineOfTitle(blockOf(people, holders, ['succession: eldest-child', 'year: 1250'])).result.heirs).toEqual(['y', 'z']);
	});

	it('an alive person with no born year is alive at every year', () => {
		const people = [...tree('1185'), '{id: z, name: Z, sex: m, parents: [a1]}'];
		expect(lineOfTitle(blockOf(people, holders)).result.heirs).toEqual(['y', 'z']);
	});
});

describe('the warning "old" (contract B.4, K.8, J.8)', () => {
	const old = (keys: string[] = ['succession: eldest-child', 'inherit: no-preference'], oldAge = 110) => lineOfTitle(sourceOf('S32', null).replace('    holders:', keys.map((k) => `    ${k}`).join('\n') + '\n    holders:'), 'duke', 50, oldAge).result.old;

	it('an heir with no death date who is older than the limit at the reference year', () => {
		expect(old()).toEqual(['u']);
	});

	it('the limit is an argument: 0 gives no warning; "older than" means more than N years', () => {
		expect(old(undefined, 0)).toEqual([]);
		expect(old(undefined, 115)).toEqual([]);
		expect(old(undefined, 114)).toEqual(['u']);
		expect(old(undefined, 80)).toEqual(['u', 'uc']);
	});

	it('the reference year is the Year field when it is a number', () => {
		expect(old(['succession: eldest-child', 'year: 1180'])).toEqual([]);
		expect(old(['succession: eldest-child', 'year: 1190'])).toEqual(['u']);
	});

	it('the warning does not change the line', () => {
		expect(lineOfTitle(sourceOf('S32', { succession: 'eldest-child', inherit: 'no-preference' })).result.heirs).toEqual(['s', 'u', 'uc']);
	});

	it('a named heir joins the check (K.3), also when the rule would leave him out', () => {
		expect(old(['succession: eldest-child', 'inherit: women-only', 'heir: u'])).toEqual(['u']);
	});

	it('an heir with a death date is never old (u dies in 1250, after the year 1190 of the line)', () => {
		const src = sourceOf('S32', { succession: 'eldest-child', inherit: 'no-preference', year: '1190' }).replace('{id: u, name: U, sex: m, born: 1075,', '{id: u, name: U, sex: m, born: 1075, died: 1250,');
		const { result } = lineOfTitle(src);
		expect(result.heirs).toEqual(['s', 'u', 'uc']);
		expect(result.old).toEqual([]);
	});
});

describe('years that the plugin cannot read (contract J.2, K.4)', () => {
	it('an heir with a born text and no year: noYear names the person and "born" (the year is a number)', () => {
		const people = [...HOUSE.slice(0, 2), '{id: x, name: X, sex: m, born: "long ago", parents: [r]}', '{id: y, name: Y, sex: m, born: 1176, parents: [r]}'];
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['succession: eldest-child', 'year: 1250']));
		expect(result.heirs).toEqual(['x', 'y']);
		expect(result.noYear).toContainEqual({ id: 'x', what: 'born' });
		expect(result.noYear.some((n) => n.id === 'y')).toBe(false);
	});

	it('a holder entry with a text and no year: noYear names the person, "reign" and the entry index', () => {
		// A number year, so that the scan of contract B.3 reads the text "early times" (with the year "now" it reads no date; contract L.9).
		const { result } = lineOfTitle(blockOf(HOUSE, ['{person: a1, from: 1150, to: 1180}', '{person: r, from: "early times"}'], ['succession: eldest-child', 'year: 1190']));
		expect(result.ruler).toBe('r');
		expect(result.noYear).toContainEqual({ id: 'r', what: 'reign', entry: 1 });
	});

	it('nothing is unreadable: an empty list', () => {
		expect(lineOfRun(run('S01a')).result.noYear).toEqual([]);
	});
});

describe('people with no sex value (contract J.4, K.9)', () => {
	it('a one-sex rule counts the people it leaves out only for lack of a sex (S22)', () => {
		expect(lineOfRun(run('S22d')).result.leftOutNoSex).toBe(2);
		expect(lineOfRun(run('S22e')).result.leftOutNoSex).toBe(2);
	});

	it('a rule that accepts everybody leaves nobody out', () => {
		for (const id of ['S22a', 'S22b', 'S22c']) expect(lineOfRun(run(id)).result.leftOutNoSex, id).toBe(0);
	});

	it('men-only leaves out no man or woman: the count is for "no sex" and other values only', () => {
		const people = [...HOUSE.slice(0, 2), '{id: m1, name: M1, sex: m, born: 1175, parents: [r]}', '{id: w1, name: W1, sex: f, born: 1176, parents: [r]}'];
		expect(lineOfTitle(blockOf(people, REIGNS, ['succession: eldest-child', 'inherit: men-only'])).result.leftOutNoSex).toBe(0);
	});

	it('inherit-through with a ruler of no sex: the ruler passes nothing, and is counted (K.1, K.9)', () => {
		const people = ['{id: a1, name: A1, sex: m, born: 1125, died: 1180}', '{id: r, name: R, born: 1150, parents: [a1]}', '{id: c1, name: C1, sex: m, born: 1175, parents: [r]}'];
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['succession: eldest-child', 'inherit: no-preference', 'inherit-through: men']));
		expect(result.heirs).toEqual([]);
		expect(result.leftOutNoSex).toBe(1);
	});

	it('no such people: 0, not undefined', () => {
		expect(lineOfRun(run('S01a')).result.leftOutNoSex).toBe(0);
	});
});

describe('born during the reign with no birth years (contract J.9, K.8)', () => {
	const people = [
		'{id: a1, name: A1, sex: m, born: 1125, died: 1180}',
		'{id: r, name: R, sex: m, born: 1150, parents: [a1]}',
		'{id: c1, name: C1, sex: m, born: 1170, parents: [r]}',
		'{id: c2, name: C2, sex: m, parents: [r]}',
		'{id: c3, name: C3, sex: m, born: 1185, parents: [r]}',
	];
	it('counts the returned heirs with no readable birth year', () => {
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['succession: born-in-reign']));
		expect(result.heirs).toContain('c2');
		expect(result.noBirthYear).toBe(1);
	});

	it('only for born-in-reign: any other rule gives 0', () => {
		expect(lineOfTitle(blockOf(people, REIGNS, ['succession: eldest-child'])).result.noBirthYear).toBe(0);
	});

	it('the count is for the returned heirs: a person after `limit` is not counted', () => {
		const { result } = lineOfTitle(blockOf(people, REIGNS, ['succession: born-in-reign']), 'duke', 1);
		expect(result.heirs.length).toBe(1);
		expect(result.noBirthYear).toBe(0);
	});

	it('a parent who never held the title gives no precedence: the birth years (D193) decide, not the reign', () => {
		const more = [...people.slice(0, 3), '{id: k1, name: K1, sex: m, born: 1180, parents: [c1]}', '{id: k2, name: K2, sex: m, born: 1176, parents: [c1]}'];
		const { result } = lineOfTitle(blockOf(more, REIGNS, ['succession: born-in-reign']));
		// D193: C1 never held the title, so there is no reign precedence among his sons. K1 1180 and K2 1176 are both dated:
		// K2 1176 before K1 1180 (written K1, K2).
		expect(result.heirs).toEqual(['c1', 'k2', 'k1']);
	});
});

describe('the length of the line (contract C.10)', () => {
	it('exactly `limit` people left: more is false; one more left: more is true', () => {
		const run01 = run('S01a');
		const src = sourceOf(run01.tree, run01.keys);
		const at = (limit: number) => lineOfTitle(src, 'duke', limit).result;
		expect([at(7).heirs.length, at(7).more]).toEqual([7, false]);
		expect([at(6).heirs.length, at(6).more]).toEqual([6, true]);
		expect([at(1).heirs, at(1).more]).toEqual([['s1'], true]);
		expect([at(20).heirs.length, at(20).more]).toEqual([7, false]);
	});
});

describe('claim links (contract C.2)', () => {
	const house = ['{id: a1, name: A1, sex: m, born: 1125, died: 1180}', '{id: r, name: R, sex: m, born: 1150, parents: [a1]}'];
	const heirs = (extra: string[], keys: string[], inherit = 'no-preference') => lineOfTitle(blockOf([...house, ...extra], REIGNS, ['succession: eldest-child', `inherit: ${inherit}`, ...keys])).result.heirs;

	it('a link of an unknown type reads as a birth link', () => {
		expect(heirs(['{id: g, name: G, sex: m, born: 1176, parents: [{id: r, type: godfather}]}'], [])).toEqual(['g']);
	});

	it('the illegitimate flag does not bar an adoptive claim', () => {
		const ad = '{id: ad, name: Ad, sex: m, born: 1176, illegitimate: true, parents: [{id: r, type: adoptive}]}';
		expect(heirs([ad], ['inherit-adopted: true', 'inherit-illegitimate: no'])).toEqual(['ad']);
		expect(heirs([ad], ['inherit-illegitimate: no'])).toEqual([]);
	});

	it('inherit-adopted written as "yes" is on (it reads like the person key)', () => {
		expect(heirs(['{id: ad, name: Ad, sex: m, born: 1176, parents: [{id: r, type: adoptive}]}'], ['inherit-adopted: yes'])).toEqual(['ad']);
	});

	it('a child of unmarried parents with no flag is not illegitimate to the engine', () => {
		expect(heirs(['{id: p, name: P, sex: f, born: 1152}', '{id: k, name: K, sex: m, born: 1176, parents: [r, p]}'], ['inherit-illegitimate: no'])).toEqual(['k']);
	});

	it('the flag bars the child on both birth links (the data cannot say whose marriage was missing)', () => {
		const people = ['{id: p, name: P, sex: f, born: 1152, died: 1190}', '{id: k, name: K, sex: f, born: 1176, illegitimate: true, parents: [r, p]}'];
		expect(heirs(people, [], 'women-only')).toEqual([]);
		expect(heirs(people, ['inherit-illegitimate: equal'], 'women-only')).toEqual(['k']);
	});
});

describe('every run of the table reads the same through the Titles window draft (contract D: `specOf`)', () => {
	it('a hand-built spec gives the line of the written keys', () => {
		const r = run('S17b');
		const g = graphOf(sourceOf(r.tree, r.keys));
		const title = titleIn(g);
		const spec = { rule: 'eldest-child' as const, inherit: 'men-only' as const, illegitimate: 'no' as const, adopted: false, heirs: ['d'] };
		expect(successionLine(g, title, spec, 50, 110).heirs).toEqual(['d', 's1', 's2', 'b']);
	});
});
