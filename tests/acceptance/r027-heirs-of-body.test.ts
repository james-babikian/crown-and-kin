import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionSpec } from '../../src/core/succession';
import type { Title } from '../../src/core/types';
import { golden, replaceOnce } from './golden';
import { oldApplyOp, oldBuild } from './r027-old-builds';
import { blockOf, lineOfTitle } from './r027-support';
import { applyTitleOp, bodyOf, refusal, type AnyOp } from './titles-support';

/*
 * Version 0.2.7, WP2 fix round: the first-holder switch `heirs-of-body` (the 0.2.7 contract section L.1 to L.5,
 * spec D189). The cases L01 to L11 are the "Cases of D189" of an internal study; the
 * families of L08 to L11 follow an internal study. Every expected line is the
 * table's line, written by hand; the engine is only called. Also here: how the key is read, how it is
 * written (key order, plain text, the switch rules) and that the 0.2.6 and 0.1.1 builds keep it (L.1, A.4).
 * These tests wait for the WP 2 fix round (`src/core/succession.ts`, `title-ops.ts`, `parse.ts`).
 * Run: npx vitest run tests/acceptance/r027-heirs-of-body.test.ts
 */

// ---- The common tree "cadet" of the table ----

/** K is the king; E and Y are his sons; Y holds the cadet duchy. `eAlive` removes E's death (case L05c). */
const king = (eAlive = false): string[] => [
	'{id: k, name: K, sex: m, born: 1100, died: 1160}',
	'{id: kb, name: Kb, sex: m, born: 1105, died: 1165}',
	`{id: e, name: E, sex: m, born: 1125, ${eAlive ? '' : 'died: 1185, '}parents: [k]}`,
	'{id: e1, name: E1, sex: m, born: 1150, parents: [e]}',
	'{id: y, name: Y, sex: m, born: 1130, died: 1190, parents: [k]}',
];
/** Y's children for L01, L05 and L07. */
const CKIDS = [
	'{id: c1, name: C1, sex: m, born: 1155, parents: [y]}',
	'{id: c2, name: C2, sex: m, born: 1158, parents: [y]}',
	'{id: c3, name: C3, sex: m, born: 1160, parents: [y]}',
	'{id: k1, name: K1, sex: m, born: 1185, parents: [c1]}',
];
/** The holders CH: Y, then C1 (R = c1). */
const CH = ['{person: y, from: 1155, to: 1190}', '{person: c1, from: 1190}'];
const BASE_KEYS = ['succession: eldest-child', 'inherit: no-preference'];

interface LCase {
	id: string;
	what: string;
	people: string[];
	holders: string[];
	keys: string[];
	off: string[];
	on: string[];
	/** The first holder the engine must report with the switch on. */
	first: string;
	/** True when the switch on leaves nobody on the climb to the first holder. */
	outside?: boolean;
	named?: [string, string][];
}

const Q = [
	'{id: q, name: Q, sex: f, born: 1128, died: 1190, parents: [k]}',
	'{id: qs, name: Qs, sex: m, born: 1150, parents: [q]}',
	'{id: qs2, name: Qs2, sex: m, born: 1152, parents: [q]}',
	'{id: qd, name: Qd, sex: f, born: 1153, parents: [q]}',
	'{id: qds, name: Qds, sex: m, born: 1175, parents: [qd]}',
	'{id: qk, name: Qk, sex: m, born: 1180, parents: [qs]}',
];
const QH = ['{person: q, from: 1155, to: 1190}', '{person: qs, from: 1190}'];
const ADOPT = [
	'{id: c1, name: C1, sex: m, born: 1155, parents: [y]}',
	'{id: c2, name: C2, sex: m, born: 1158, parents: [y]}',
	'{id: a, name: A, sex: m, born: 1156, parents: [{id: y, type: adoptive}]}',
	'{id: as, name: As, sex: m, born: 1185, parents: [a]}',
];
const ADOPT_HOLDERS = ['{person: y, from: 1155, to: 1190}', '{person: a, from: 1190}'];
/** L08 and L09: sons and daughters of Y and of C1. */
const HOUSE = [
	'{id: c1, name: C1, sex: m, born: 1155, parents: [y]}',
	'{id: c2, name: C2, sex: m, born: 1158, parents: [y]}',
	'{id: cs, name: Cs, sex: f, born: 1157, parents: [y]}',
	'{id: kd, name: Kd, sex: f, born: 1184, parents: [c1]}',
	'{id: ks, name: Ks, sex: m, born: 1186, parents: [c1]}',
];
const CB = '{id: cb, name: Cb, sex: m, born: 1162, illegitimate: true, parents: [y]}';

const CASES: LCase[] = [
	{ id: 'L01a', what: 'the cadet duchy: the king\'s other son\'s line is out', people: [...king(), ...CKIDS], holders: CH, keys: BASE_KEYS, off: ['k1', 'c2', 'c3', 'e1'], on: ['k1', 'c2', 'c3'], first: 'y' },
	{
		id: 'L01b',
		what: 'R has no children and his brother is dead: the title lapses, and that is not outsideBody',
		people: [...king(), '{id: c1, name: C1, sex: m, born: 1155, parents: [y]}', '{id: c2, name: C2, sex: m, born: 1158, died: 1180, parents: [y]}'],
		holders: CH,
		keys: BASE_KEYS,
		off: ['e1'],
		on: [],
		first: 'y',
	},
	{
		id: 'L02',
		what: 'a usurper (a cousin of Y) holds after Y: R is not in the body',
		people: [...king(), '{id: z, name: Z, sex: m, born: 1135, parents: [kb]}', '{id: zs, name: Zs, sex: m, born: 1160, parents: [z]}', '{id: zb, name: Zb, sex: m, born: 1140, parents: [kb]}'],
		holders: ['{person: y, from: 1155, to: 1170}', '{person: z, from: 1170}'],
		keys: BASE_KEYS,
		off: ['zs', 'zb'],
		on: [],
		first: 'y',
		outside: true,
	},
	{
		id: 'L03',
		what: 'R is the first holder: no climb',
		people: [...king(), '{id: c1, name: C1, sex: m, born: 1155, parents: [y]}', '{id: c2, name: C2, sex: f, born: 1158, parents: [y]}'],
		holders: ['{person: y, from: 1155}'],
		keys: BASE_KEYS,
		off: ['c1', 'c2', 'e1'],
		on: ['c1', 'c2'],
		first: 'y',
	},
	{ id: 'L04a', what: 'a woman is the first holder, men-only, inherit-through absent: she is exempt', people: [...king(), ...Q], holders: QH, keys: ['succession: eldest-child', 'inherit: men-only'], off: ['qk', 'qs2', 'e1'], on: ['qk', 'qs2'], first: 'q' },
	{
		id: 'L04b',
		what: 'a woman is the first holder, men-only + inherit-through men: she does not pass, so nobody can inherit',
		people: [...king(), ...Q],
		holders: QH,
		keys: ['succession: eldest-child', 'inherit: men-only', 'inherit-through: men'],
		off: ['qk'],
		on: [],
		first: 'q',
		outside: true,
	},
	{ id: 'L04c', what: 'a woman is the first holder, no-preference', people: [...king(), ...Q], holders: QH, keys: BASE_KEYS, off: ['qk', 'qs2', 'qd', 'qds', 'e1'], on: ['qk', 'qs2', 'qd', 'qds'], first: 'q' },
	{ id: 'L05a', what: 'siblings-first: the uncle E leaves, brothers then children', people: [...king(), ...CKIDS], holders: CH, keys: ['succession: siblings-first', 'inherit: no-preference'], off: ['c2', 'c3', 'e1', 'k1'], on: ['c2', 'c3', 'k1'], first: 'y' },
	{ id: 'L05c', what: 'siblings-first, the uncle E is alive: he is out as well', people: [...king(true), ...CKIDS], holders: CH, keys: ['succession: siblings-first', 'inherit: no-preference'], off: ['e', 'c2', 'c3', 'e1', 'k1'], on: ['c2', 'c3', 'k1'], first: 'y' },
	{ id: 'L05b', what: 'nearest-relative: child, brothers', people: [...king(), ...CKIDS], holders: CH, keys: ['succession: nearest-relative', 'inherit: no-preference'], off: ['k1', 'c2', 'c3', 'e1'], on: ['k1', 'c2', 'c3'], first: 'y' },
	{ id: 'L06a', what: 'an adopted holder, inherit-adopted off: the claim link is cut, nobody can inherit', people: [...king(), ...ADOPT], holders: ADOPT_HOLDERS, keys: BASE_KEYS, off: ['as', 'c1', 'c2', 'e1'], on: [], first: 'y', outside: true },
	{ id: 'L06b', what: 'an adopted holder, inherit-adopted on', people: [...king(), ...ADOPT], holders: ADOPT_HOLDERS, keys: [...BASE_KEYS, 'inherit-adopted: true'], off: ['as', 'c1', 'c2', 'e1'], on: ['as', 'c1', 'c2'], first: 'y' },
	{
		id: 'L07',
		what: 'a named heir outside the body comes first',
		people: [...king(), ...CKIDS],
		holders: CH,
		keys: [...BASE_KEYS, 'heir: e1'],
		off: ['e1', 'k1', 'c2', 'c3'],
		on: ['e1', 'k1', 'c2', 'c3'],
		first: 'y',
		named: [['e1', 'first']],
	},
	{ id: 'L08', what: 'men-first-in-house: each pass has its own body', people: [...king(), ...HOUSE], holders: CH, keys: ['succession: eldest-child', 'inherit: men-first-in-house'], off: ['ks', 'c2', 'e1', 'kd', 'cs'], on: ['ks', 'c2', 'kd', 'cs'], first: 'y' },
	{
		id: 'L09',
		what: 'inherit-illegitimate after: the illegitimate son of Y comes last, inside the body',
		people: [...king(), ...HOUSE, CB],
		holders: CH,
		keys: [...BASE_KEYS, 'inherit-illegitimate: after'],
		off: ['kd', 'ks', 'c2', 'cs', 'e1', 'cb'],
		on: ['kd', 'ks', 'c2', 'cs', 'cb'],
		first: 'y',
	},
	{ id: 'L10', what: 'the first entry has a name and no person in the tree: H is Y', people: [...king(), ...CKIDS], holders: ['{name: Legend, from: 1100}', ...CH], keys: BASE_KEYS, off: ['k1', 'c2', 'c3', 'e1'], on: ['k1', 'c2', 'c3'], first: 'y' },
	{
		id: 'L11',
		what: 'cousin marriage: R is a child of Y and of E\'s daughter; the body is from Y only',
		people: [...king(), '{id: ew, name: Ew, sex: f, born: 1135, parents: [e]}', '{id: c1, name: C1, sex: m, born: 1155, parents: [y, ew]}', '{id: c2, name: C2, sex: m, born: 1158, parents: [y]}'],
		holders: CH,
		keys: BASE_KEYS,
		off: ['c2', 'e1'],
		on: ['c2'],
		first: 'y',
	},
];

/** The line of a case with the switch off or on, from the key written on the title. */
const lineOf = (c: LCase, on: boolean, more: string[] = []) => lineOfTitle(blockOf(c.people, c.holders, [...c.keys, ...(on ? ['heirs-of-body: true'] : []), ...more]));

/** True when `sub` is in `all` in the same relative order. */
const isSubsequence = (sub: string[], all: string[]): boolean => {
	let at = 0;
	for (const x of all) if (x === sub[at]) at++;
	return at === sub.length;
};

describe('heirs-of-body: the cases L01 to L11 with the switch off and on (contract L.2 to L.5)', () => {
	for (const c of CASES) {
		describe(`${c.id}: ${c.what}`, () => {
			it('switch off: the line of the engine without the switch; no first holder, no outsideBody', () => {
				const { result } = lineOf(c, false);
				expect(result.kind).toBe('line');
				expect(result.heirs).toEqual(c.off);
				expect(result.firstHolder).toBeUndefined();
				expect(result.outsideBody).toBe(false);
			});

			it('switch on: the line of the table, the first holder, and outsideBody', () => {
				const { result } = lineOf(c, true);
				expect(result.kind).toBe('line');
				expect(result.heirs).toEqual(c.on);
				expect(result.firstHolder).toBe(c.first);
				expect(result.outsideBody).toBe(c.outside ?? false);
				if (c.named) expect(result.namedHeirs.map((n) => [n.id, n.state])).toEqual(c.named);
				else expect(result.namedHeirs).toEqual([]);
			});

			it('the switch on gives a subset of the switch off, in the same relative order (L.7)', () => {
				expect(isSubsequence(c.on, c.off)).toBe(true);
			});

			it('the switch does not change the ruler, the year or the length flag', () => {
				const off = lineOf(c, false).result;
				const on = lineOf(c, true).result;
				expect([on.ruler, on.year, on.yearFrom, on.coRulers]).toEqual([off.ruler, off.year, off.yearFrom, off.coRulers]);
			});
		});
	}

	it('every case has its own id', () => {
		expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
	});
});

describe('heirs-of-body: other rules on the cadet duchy (the same families, lines worked out by hand from C.8)', () => {
	const tree = { people: [...king(), ...CKIDS], holders: CH };
	const line = (rule: string, on: boolean) => lineOfTitle(blockOf(tree.people, tree.holders, [`succession: ${rule}`, 'inherit: no-preference', ...(on ? ['heirs-of-body: true'] : [])])).result;

	it('youngest-child: C1\'s son, then Y\'s children from the youngest, then the uncle\'s line only with the switch off', () => {
		expect(line('youngest-child', false).heirs).toEqual(['k1', 'c3', 'c2', 'e1']);
		expect(line('youngest-child', true).heirs).toEqual(['k1', 'c3', 'c2']);
	});

	it('born-in-reign: all of Y\'s children were born in his reign, so the written order stands', () => {
		expect(line('born-in-reign', false).heirs).toEqual(['k1', 'c2', 'c3', 'e1']);
		expect(line('born-in-reign', true).heirs).toEqual(['k1', 'c2', 'c3']);
	});
});

describe('heirs-of-body: L.2, the first holder', () => {
	it('an entry with an id that is not in the tree is skipped like an entry with only a name (L10 again)', () => {
		const { result } = lineOfTitle(blockOf([...king(), ...CKIDS], ['{person: ghost, from: 1100}', ...CH], [...BASE_KEYS, 'heirs-of-body: true']));
		expect(result.firstHolder).toBe('y');
		expect(result.heirs).toEqual(['k1', 'c2', 'c3']);
	});

	it('the first holder in list order is H, though a later entry has an earlier date (dates do not reorder)', () => {
		// The list order is the order of succession: Y first, then C1. The entry of C1 starts later; the list is not sorted.
		const { result } = lineOfTitle(blockOf([...king(), ...CKIDS], ['{person: y, from: 1190, to: 1195}', '{person: c1, from: 1155}'], [...BASE_KEYS, 'heirs-of-body: true', 'year: 1200']));
		expect(result.firstHolder).toBe('y');
	});
});

describe('heirs-of-body: the switch is a title key (L.1, L.5)', () => {
	const people = [...king(), ...CKIDS];

	it('named heirs bypass the switch, and with nobody in the body the line is only the named heirs (L.5)', () => {
		const c = CASES.find((x) => x.id === 'L02')!;
		const { result } = lineOf(c, true, ['heir: zb']);
		expect([result.outsideBody, result.heirs]).toEqual([true, ['zb']]);
		expect(result.namedHeirs).toEqual([{ id: 'zb', state: 'first' }]);
	});

	it('an excluded person is blocked as before: the line of the body without him', () => {
		const { result } = lineOfTitle(blockOf(people, CH, [...BASE_KEYS, 'heirs-of-body: true', 'exclude: c2']));
		expect(result.heirs).toEqual(['k1', 'c3']);
	});

	it('inherit acts as before inside the body: with men-only the daughter of the first holder is out (L03 tree)', () => {
		const c = CASES.find((x) => x.id === 'L03')!;
		const { result } = lineOfTitle(blockOf(c.people, c.holders, ['succession: eldest-child', 'inherit: men-only', 'heirs-of-body: true']));
		expect(result.heirs).toEqual(['c1']);
	});

	it('a title with a switch and no rule has no line and the switch has no effect (B.6)', () => {
		const off = lineOfTitle(blockOf(people, CH, [])).result;
		const on = lineOfTitle(blockOf(people, CH, ['heirs-of-body: true'])).result;
		expect(off.kind).toBe('no-rule');
		expect(on).toEqual(off);
		expect(on.firstHolder).toBeUndefined();
		expect(on.outsideBody).toBe(false);
	});

	it('a title with a named heir and a switch, but no rule: the same line as without the switch', () => {
		const off = lineOfTitle(blockOf(people, CH, ['heir: e1'])).result;
		const on = lineOfTitle(blockOf(people, CH, ['heir: e1', 'heirs-of-body: true'])).result;
		expect(off.heirs).toEqual(['e1']);
		expect(on).toEqual(off);
	});

	it('a hand-built spec with `body: true` gives the line of the written key (the Titles window draft)', () => {
		const { g, title } = lineOfTitle(blockOf(people, CH, BASE_KEYS));
		const spec: SuccessionSpec = { ...specOf(title), body: true };
		const result = successionLine(g, title, spec, 50, 110);
		expect([result.heirs, result.firstHolder, result.outsideBody]).toEqual([['k1', 'c2', 'c3'], 'y', false]);
		expect(successionLine(g, title, { ...spec, body: false }, 50, 110).heirs).toEqual(['k1', 'c2', 'c3', 'e1']);
	});

	it('the call is pure: the title and the graph are not changed by the switch', () => {
		const { g, title } = lineOfTitle(blockOf(people, CH, [...BASE_KEYS, 'heirs-of-body: true']));
		const before = JSON.stringify(title);
		const spec = specOf(title);
		const first = successionLine(g, title, spec, 50, 110);
		expect(successionLine(g, title, spec, 50, 110)).toEqual(first);
		expect(JSON.stringify(title)).toBe(before);
	});

	it('limit and more act on the line of the body', () => {
		const { result } = lineOfTitle(blockOf(people, CH, [...BASE_KEYS, 'heirs-of-body: true']), 'duke', 2);
		expect([result.heirs, result.more]).toEqual([['k1', 'c2'], true]);
		const exact = lineOfTitle(blockOf(people, CH, [...BASE_KEYS, 'heirs-of-body: true']), 'duke', 3).result;
		expect([exact.heirs, exact.more]).toEqual([['k1', 'c2', 'c3'], false]);
	});
});

// ---- Reading the key (L.1) ----

describe('heirs-of-body: how the key is read (contract L.1)', () => {
	const PEOPLE = ['people:', '  - id: aldric', '    name: Aldric', '    sex: m', ''].join('\n');
	const note = (...keys: string[]) => ['titles:', '  - id: duke', '    name: Duke', ...keys.map((k) => `    ${k}`), '    holders:', '      - {person: aldric, from: 1175}', PEOPLE].join('\n');
	const read = (...keys: string[]) => {
		const r = parseDynasty(note(...keys));
		if (!r.ok) throw new Error(`hard error ${r.error.code}`);
		const g = deriveFamilies(r.tree);
		return { read: r.tree.titles![0], title: g.titles[0], g };
	};
	const has = (t: Title, key: string) => Object.prototype.hasOwnProperty.call(t, key);

	it.each(['true', 'True', 'TRUE', 'yes', 'YES', '" yes "'])('heirs-of-body: %s is on, in the tree as read and in the graph, and the spec says so', (written) => {
		const t = read('succession: eldest-child', `heirs-of-body: ${written}`);
		expect(t.read.heirsOfBody).toBe(true);
		expect(t.title.heirsOfBody).toBe(true);
		expect(specOf(t.title).body).toBe(true);
		expect(t.g.issues).toEqual([]);
	});

	it.each(['false', 'no', 'on', '1', 'Y', 'maybe', 'always', '""'])('heirs-of-body: %s is off, with no field and no warning (as inherit-adopted)', (written) => {
		const t = read('succession: eldest-child', `heirs-of-body: ${written}`);
		expect(has(t.read, 'heirsOfBody')).toBe(false);
		expect(has(t.title, 'heirsOfBody')).toBe(false);
		expect(specOf(t.title).body).toBeFalsy();
		expect(t.g.issues).toEqual([]);
	});

	it('a title without the key has no field, and a spec with no switch', () => {
		const t = read('succession: eldest-child');
		expect(has(t.title, 'heirsOfBody')).toBe(false);
		expect(specOf(t.title).body).toBeFalsy();
	});

	it('a list or a map is not a switch: off, no field, and no warning', () => {
		for (const v of ['[true]', '{a: b}']) {
			const t = read('succession: eldest-child', `heirs-of-body: ${v}`);
			expect(has(t.title, 'heirsOfBody'), v).toBe(false);
			expect(t.g.issues, v).toEqual([]);
		}
	});

	it('the switch alone is read and gives no warning (L.1)', () => {
		const t = read('heirs-of-body: true');
		expect(t.title.heirsOfBody).toBe(true);
		expect(t.g.issues).toEqual([]);
	});
});

// ---- Writing the key (L.1) ----

describe('heirs-of-body: how edit-title writes the key (contract L.1, A.3)', () => {
	const PEOPLE = ['people:', '  - id: aldric', '    name: Aldric Valmont', '    sex: m', '  - id: hugo', '    name: Hugo Valmont', '    sex: m', ''].join('\n');
	const BASE = ['titles:', '  - id: duke-of-valmont', '    name: Duke of Valmont', '    plural: Dukes of Valmont', '    holders:', '      - {person: aldric, number: II, from: 1175}', PEOPLE].join('\n').replace(/\n$/, '');
	const T = (line: string) => BASE.replace('    holders:\n', `    ${line}\n    holders:\n`);
	const apply = (op: Record<string, unknown>, body = BASE) => applyTitleOp(body, { kind: 'edit-title', id: 'duke-of-valmont', ...op } as AnyOp);
	const write = (op: Record<string, unknown>, body = BASE) => bodyOf(apply(op, body));
	const goldenBody = (file: string) => golden(file).replace(/\n$/, '');

	it('true writes the key, plain, never quoted', () => {
		expect(write({ heirsOfBody: true })).toBe(replaceOnce(BASE, '    plural: Dukes of Valmont\n', '    plural: Dukes of Valmont\n    heirs-of-body: true\n'));
		expect(write({ heirsOfBody: true })).not.toContain('"true"');
	});

	it('true keeps a text that already reads as true; it turns a text that reads as false into true', () => {
		expect(write({ heirsOfBody: true }, T('heirs-of-body: yes'))).toBe(T('heirs-of-body: yes'));
		expect(write({ heirsOfBody: true }, T('heirs-of-body: True'))).toBe(T('heirs-of-body: True'));
		expect(write({ heirsOfBody: true }, T('heirs-of-body: true'))).toBe(T('heirs-of-body: true'));
		expect(write({ heirsOfBody: true }, T('heirs-of-body: false'))).toBe(T('heirs-of-body: true'));
		expect(write({ heirsOfBody: true }, T('heirs-of-body: maybe'))).toBe(T('heirs-of-body: true'));
	});

	it('false removes the key only when it is there', () => {
		expect(write({ heirsOfBody: false })).toBe(BASE);
		expect(write({ heirsOfBody: false }, T('heirs-of-body: true'))).toBe(BASE);
		expect(write({ heirsOfBody: false }, T('heirs-of-body: yes'))).toBe(BASE);
	});

	it('a value that is not a boolean is refused: bad-value, and nothing is written', () => {
		expect(refusal(apply({ heirsOfBody: 'yes' }))).toBe('bad-value');
		expect(refusal(apply({ heirsOfBody: 1 }))).toBe('bad-value');
	});

	it('the key lands after inherit-adopted and before year, heir, exclude and holders (key order)', () => {
		const start = BASE.replace('    holders:\n', '    succession: eldest-child\n    inherit-adopted: true\n    year: 1210\n    heir: hugo\n    holders:\n');
		expect(write({ heirsOfBody: true }, start)).toBe(replaceOnce(start, '    inherit-adopted: true\n', '    inherit-adopted: true\n    heirs-of-body: true\n'));
		const noAdopt = BASE.replace('    holders:\n', '    succession: eldest-child\n    inherit-illegitimate: after\n    year: 1210\n    holders:\n');
		expect(write({ heirsOfBody: true }, noAdopt)).toBe(replaceOnce(noAdopt, '    inherit-illegitimate: after\n', '    inherit-illegitimate: after\n    heirs-of-body: true\n'));
		const onlyYear = BASE.replace('    holders:\n', '    year: 1210\n    holders:\n');
		expect(write({ heirsOfBody: true }, onlyYear)).toBe(replaceOnce(onlyYear, '    year: 1210\n', '    heirs-of-body: true\n    year: 1210\n'));
	});

	it('all the keys at once come out in the order of the contract (golden)', () => {
		expect(
			write({
				succession: 'eldest-child',
				inherit: 'men-only',
				inheritThrough: 'men',
				inheritIllegitimate: 'after',
				inheritAdopted: true,
				heirsOfBody: true,
				year: '1210',
				heirs: ['hugo'],
				exclude: ['aldric'],
			}),
		).toBe(goldenBody('16-edit-title-heirs-of-body.yaml'));
	});

	it('the same value again changes nothing, and another edit leaves the key line alone', () => {
		const start = T('heirs-of-body: true');
		expect(write({ heirsOfBody: true }, start)).toBe(start);
		expect(write({ name: 'Duke of Valmont, the Old' }, start)).toContain('\n    heirs-of-body: true\n');
		expect(write({ succession: 'eldest-child' }, start)).toContain('\n    succession: eldest-child\n    heirs-of-body: true\n');
	});

	it('a comment on the key line stays when the key is kept', () => {
		const start = T('heirs-of-body: yes   # the first holder only');
		expect(write({ heirsOfBody: true }, start)).toBe(start);
		expect(write({ year: '1210' }, start)).toContain('    heirs-of-body: yes   # the first holder only\n    year: 1210\n');
	});
});

// ---- The older builds keep the key (L.1, A.4) ----

describe('the 0.2.6 and 0.1.1 builds keep heirs-of-body on an edit (contract L.1, A.4, spec §13.0 item 2)', () => {
	const PEOPLE = ['people:', '  - id: aldric', '    name: Aldric Valmont', '    sex: m', '  - id: hugo', '    name: Hugo Valmont', '    sex: m', ''].join('\n');
	const KEYS = ['    succession: eldest-child', '    inherit: men-only', '    inherit-adopted: true', '    heirs-of-body: true', '    year: 1210', '    heir: hugo'];
	const NOTE = ['titles:', '  - id: duke', '    name: Duke', ...KEYS, '    holders:', '      - {person: aldric, number: II, from: 1175}', PEOPLE].join('\n');
	const keyLines = (body: string) => body.split('\n').filter((l) => KEYS.includes(l));

	it('the current build keeps the key line when another field changes', () => {
		for (const op of [
			{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
			{ kind: 'edit-title', id: 'duke', name: 'Duke of Valmont' },
			{ kind: 'edit-holder', holder: { title: 'duke', index: 0, person: 'aldric' }, fields: { to: '1200' } },
			{ kind: 'set-option', key: 'start', value: 'aldric' },
		]) {
			const out = bodyOf(applyTitleOp(NOTE, op as AnyOp));
			expect(keyLines(out), JSON.stringify(op)).toEqual(KEYS);
			expect(out, JSON.stringify(op)).toContain(KEYS.join('\n'));
		}
	});

	for (const tag of ['v0.2.6', 'v0.1.1']) {
		const dir = oldBuild(tag);
		const ops: Record<string, unknown>[] =
			tag === 'v0.2.6'
				? [
						{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
						{ kind: 'edit-title', id: 'duke', name: 'Duke of Valmont', plural: 'Dukes of Valmont' },
						{ kind: 'edit-holder', holder: { title: 'duke', index: 0, person: 'aldric' }, fields: { to: '1200' } },
						{ kind: 'set-option', key: 'start', value: 'aldric' },
					]
				: [
						{ kind: 'set-person-fields', id: 'aldric', fields: { name: 'Aldric the Old' } },
						{ kind: 'set-option', key: 'start', value: 'aldric' },
					];
		it.skipIf(dir === null)(`${tag}: the key line stays, in its place, after ${ops.length} different edits`, async () => {
			const applyOld = await oldApplyOp(dir!);
			for (const op of ops) {
				const r = applyOld(NOTE, op);
				expect(r.ok, JSON.stringify(op)).toBe(true);
				if (!r.ok) continue;
				expect(keyLines(r.body), JSON.stringify(op)).toEqual(KEYS);
				expect(r.body).toContain(KEYS.join('\n'));
			}
		});
	}
});
