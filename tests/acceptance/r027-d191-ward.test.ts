import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { blockOf, branchLine, graphOf, titleIn, type BranchResult } from './r027-support';
import { rng } from '../support/rng';

/*
 * Version 0.2.7, open branches and wards (owner decision D191, spec section 0; the 0.2.7 contract M.1 item 4): a
 * ward does not close an open branch, because a ward is not a descendant. Only a child by a birth, adoptive or
 * rumoured link (or a link of unknown type, read as birth) closes it. The cases M13z to M13i2 are in
 * an internal study ("Cases of D191"), written by hand by the genealogy-reviewer; no value
 * comes from the engine. A row `id@n` is a branch of the person `id` with n heirs before it. Also: the warning
 * `childless-has-child` does not count a ward, and a property test: a ward link on a branch person never
 * removes the row and never changes the heirs.
 * Run: npx vitest run tests/acceptance/r027-d191-ward.test.ts
 */

// ---- the base tree of the table ----

/** The base tree: F, C, R (the ruler, from 1150), R's son K1 and R's dead brother Rb (no child in the base tree). */
const BASE = [
	'{id: f,  name: F,  sex: m, born: 1060, died: 1110}',
	'{id: c,  name: C,  sex: m, born: 1090, died: 1150, parents: [f]}',
	'{id: r,  name: R,  sex: m, born: 1120, parents: [c]}',
	'{id: k1, name: K1, sex: m, born: 1145, parents: [r]}',
	'{id: rb, name: Rb, sex: m, born: 1122, died: 1140, parents: [c]}',
];
const HOLDERS = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];

/** The base tree with `childless: true` on Rb. */
const BASE_CHILDLESS = BASE.map((p) => (p.startsWith('{id: rb,') ? p.replace('{id: rb,', '{id: rb, childless: true,') : p));

interface Keys {
	inherit?: string;
	through?: string;
	adopted?: boolean;
}
interface Case {
	id: string;
	what: string;
	people: string[];
	extra: string[];
	keys?: Keys;
	heirs: string;
	rows: string;
}

const RS = '{id: rs, name: Rs, sex: f, born: 1124, died: 1130, parents: [c]}';

const CASES: Case[] = [
	{ id: 'M13z', what: 'control: no extra person; Rb is an open branch', people: BASE, extra: [], heirs: 'k1', rows: 'rb@1' },
	{
		id: 'M13a',
		what: 'a ward of Rb does not close the branch',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'],
		heirs: 'k1',
		rows: 'rb@1',
	},
	{
		id: 'M13b',
		what: 'the same person is a ward and a birth child of Rb: the birth link closes the branch and W is an heir',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}, {id: rb, type: birth}]}'],
		heirs: 'k1 w',
		rows: '',
	},
	{
		id: 'M13c',
		what: 'a link of unknown type (warrd) is read as birth: it closes the branch and W is an heir',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: warrd}]}'],
		heirs: 'k1 w',
		rows: '',
	},
	{
		id: 'M13d',
		what: 'childless: true on Rb closes the branch; a ward does not open it again',
		people: BASE_CHILDLESS,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'],
		heirs: 'k1',
		rows: '',
	},
	{
		id: 'M13e1',
		what: 'an adopted child of Rb closes the branch although the switch is off; W (ward) is no child',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}', '{id: a, name: A, sex: m, born: 1136, parents: [{id: rb, type: adoptive}]}'],
		heirs: 'k1',
		rows: '',
	},
	{
		id: 'M13e2',
		what: 'the same tree with inherit-adopted on: A is an heir; the ward W is still no heir',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}', '{id: a, name: A, sex: m, born: 1136, parents: [{id: rb, type: adoptive}]}'],
		keys: { adopted: true },
		heirs: 'k1 a',
		rows: '',
	},
	{
		id: 'M13f',
		what: 'W is a birth child of R and a ward of Rb: W is an heir through R; Rb stays a branch, now after two heirs',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1147, parents: [{id: r, type: birth}, {id: rb, type: ward}]}'],
		heirs: 'k1 w',
		rows: 'rb@2',
	},
	{
		id: 'M13g',
		what: 'a rumoured child of Rb closes the branch and has no claim; the ward W changes nothing',
		people: BASE,
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}', '{id: q, name: Q, sex: m, born: 1136, parents: [{id: rb, type: rumoured}]}'],
		heirs: 'k1',
		rows: '',
	},
	{
		id: 'M13h',
		what: 'a child of Rb marked illegitimate closes the branch (switch: no); the ward W changes nothing',
		people: BASE,
		extra: ['{id: i, name: I, sex: m, born: 1135, illegitimate: true, parents: [rb]}', '{id: w, name: W, sex: m, born: 1137, parents: [{id: rb, type: ward}]}'],
		heirs: 'k1',
		rows: '',
	},
	{
		id: 'M13i1',
		what: 'men-only: the dead daughter Rs is not walked, so a ward of Rs makes no row; Rb stays',
		people: [...BASE, RS],
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rs, type: ward}]}'],
		keys: { inherit: 'men-only' },
		heirs: 'k1',
		rows: 'rb@1',
	},
	{
		id: 'M13i2',
		what: 'men-only with inherit-through anyone: Rs is walked; a ward does not close her branch',
		people: [...BASE, RS],
		extra: ['{id: w, name: W, sex: m, born: 1135, parents: [{id: rs, type: ward}]}'],
		keys: { inherit: 'men-only', through: 'anyone' },
		heirs: 'k1',
		rows: 'rb@1 rs@1',
	},
];

// ---- helpers ----

const ids = (s: string): string[] => (s === '' ? [] : s.split(' '));
const rowsOf = (res: BranchResult): string[] => res.openBranches.map((b) => `${b.id}@${b.before}`);
const keyLines = (k: Keys = {}): string[] => ['succession: eldest-child', `inherit: ${k.inherit ?? 'no-preference'}`, ...(k.through ? [`inherit-through: ${k.through}`] : []), ...(k.adopted ? ['inherit-adopted: true'] : [])];
const lineOf = (people: string[], keys: string[], limit = 20): BranchResult => {
	const g = graphOf(blockOf(people, HOLDERS, keys));
	return branchLine(g, titleIn(g), limit, 0);
};

// ---- the cases (table "Cases of D191") ----

describe('D191: a ward does not close an open branch (cases M13z to M13i2)', () => {
	for (const c of CASES) {
		it(`${c.id}: ${c.what}: heirs [${c.heirs}], rows [${c.rows}]`, () => {
			const res = lineOf([...c.people, ...c.extra], keyLines(c.keys));
			expect(res.kind).toBe('line');
			expect(res.heirs).toEqual(ids(c.heirs));
			expect(rowsOf(res)).toEqual(ids(c.rows));
			expect(res.moreBranches).toBe(false);
		});
	}

	it('M13a, M13z: the ward changes neither the heirs nor the rows of the control', () => {
		const control = lineOf(BASE, keyLines());
		const ward = lineOf([...BASE, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'], keyLines());
		expect(ward.heirs).toEqual(control.heirs);
		expect(ward.openBranches).toEqual(control.openBranches);
	});

	it('the ward is no row and no heir itself (alive, no child of anyone but Rb as ward)', () => {
		const res = lineOf([...BASE, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'], keyLines());
		expect(res.heirs).not.toContain('w');
		expect(res.openBranches.map((b) => b.id)).not.toContain('w');
	});

	it('a dead ward of Rb is no row and does not close the branch of Rb', () => {
		const res = lineOf([...BASE, '{id: w, name: W, sex: m, born: 1135, died: 1160, parents: [{id: rb, type: ward}]}'], keyLines());
		expect(res.heirs).toEqual(['k1']);
		expect(rowsOf(res)).toEqual(['rb@1']);
	});

	it('a ward whose own children exist: the children of the ward are no descendants of Rb and give Rb no child', () => {
		const people = [
			...BASE,
			'{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}',
			'{id: wk, name: Wk, sex: m, born: 1160, parents: [w]}',
		];
		const res = lineOf(people, keyLines());
		expect(res.heirs).toEqual(['k1']);
		expect(rowsOf(res)).toEqual(['rb@1']);
	});

	it('the rows keep the line order with a ward on every branch (two branches, two wards)', () => {
		const res = lineOf(
			[...BASE, RS, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}', '{id: v, name: V, sex: m, born: 1136, parents: [{id: rs, type: ward}]}'],
			keyLines({ inherit: 'no-preference' }),
		);
		expect(res.heirs).toEqual(['k1']);
		expect(rowsOf(res)).toEqual(['rb@1', 'rs@1']);
	});

	it('a child of Rb by a real link and a ward in the same tree: only the child closes the branch', () => {
		const res = lineOf([...BASE, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}', '{id: z, name: Z, sex: m, born: 1138, parents: [rb]}'], keyLines());
		expect(res.heirs).toEqual(['k1', 'z']);
		expect(rowsOf(res)).toEqual([]);
	});
});

// ---- the warning childless-has-child ----

describe('D191: childless-has-child does not count a ward as a child (M.6)', () => {
	const warn = (people: string[]) => {
		const r = parseDynasty(blockOf(people, HOLDERS, keyLines()));
		if (!r.ok) throw new Error(`hard error ${r.error.code}`);
		return deriveFamilies(r.tree).issues.filter((i) => (i.code as string) === 'childless-has-child');
	};

	it('M13d: childless: true on Rb and a ward only: no warning', () => {
		expect(warn([...BASE_CHILDLESS, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'])).toEqual([]);
	});

	it('control: childless: true on Rb and a birth child: one warning for Rb', () => {
		const w = warn([...BASE_CHILDLESS, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: birth}]}']);
		expect(w.map((i) => i.ids)).toEqual([['rb']]);
	});

	it('childless: true on Rb with a ward and no other child: no warning, and no row either', () => {
		const people = [...BASE_CHILDLESS, '{id: w, name: W, sex: m, born: 1135, parents: [{id: rb, type: ward}]}'];
		expect(warn(people)).toEqual([]);
		expect(rowsOf(lineOf(people, keyLines()))).toEqual([]);
	});
});

// ---- property: a ward link never removes a row and never changes the heirs ----

interface RandomPerson {
	id: string;
	sex: 'm' | 'f';
	born: number;
	died?: number;
	parents: { id: string; type: string }[];
}

const personText = (p: RandomPerson): string => {
	const parts = [`id: ${p.id}`, `name: ${p.id.toUpperCase()}`, `sex: ${p.sex}`, `born: ${p.born}`];
	if (p.died !== undefined) parts.push(`died: ${p.died}`);
	if (p.parents.length > 0) parts.push(`parents: [${p.parents.map((x) => (x.type === 'birth' ? x.id : `{id: ${x.id}, type: ${x.type}}`)).join(', ')}]`);
	return `{${parts.join(', ')}}`;
};

describe('D191: property: a ward link on a branch person never removes the row and never changes the heirs', () => {
	const RULES = ['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative'];
	const INHERIT = ['no-preference', 'men-first', 'men-only', 'women-first', 'women-only'];

	it('300 random small trees: a new ward person, and a ward link on an existing later person', () => {
		const rand = rng(191);
		const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
		let checkedRows = 0;
		let checkedLinks = 0;
		for (let n = 0; n < 300; n++) {
			// The persons are born in the order of their numbers, so a parent always comes before a child (no cycle).
			const count = 5 + Math.floor(rand() * 8);
			const persons: RandomPerson[] = [];
			for (let i = 0; i < count; i++) {
				const born = 1000 + i * 7;
				const dead = i > 0 && rand() < 0.55;
				const parents: { id: string; type: string }[] = [];
				if (i > 0) {
					parents.push({ id: persons[Math.floor(rand() * i)].id, type: pick(['birth', 'birth', 'birth', 'adoptive', 'rumoured']) });
					if (i > 2 && rand() < 0.15) {
						const other = persons[Math.floor(rand() * i)].id;
						if (!parents.some((x) => x.id === other)) parents.push({ id: other, type: 'birth' });
					}
				}
				persons.push({ id: `p${i}`, sex: rand() < 0.5 ? 'm' : 'f', born, died: dead ? born + 1 + Math.floor(rand() * 60) : undefined, parents });
			}
			const keys = [`succession: ${pick(RULES)}`, `inherit: ${pick(INHERIT)}`, ...(rand() < 0.3 ? ['inherit-through: anyone'] : [])];
			const holders = ['{person: p0, from: 1000}'];
			const textOf = (ps: RandomPerson[]): string => blockOf(ps.map(personText), holders, keys);
			const run = (ps: RandomPerson[]): BranchResult => {
				const g = graphOf(textOf(ps));
				return branchLine(g, titleIn(g), 50, 0);
			};
			const base = run(persons);
			if (base.kind !== 'line' || base.openBranches.length === 0) continue;
			const latest = Math.max(...persons.map((p) => Math.max(p.born, p.died ?? 0)));
			for (const row of base.openBranches) {
				checkedRows++;
				const at = `tree ${n}, row ${row.id}, ${keys.join(', ')}`;
				// (a) A new person who is a ward of the branch person. Born in the latest year of the tree, so "now" does not move.
				const withWard = run([...persons, { id: 'ww', sex: 'm', born: latest, parents: [{ id: row.id, type: 'ward' }] }]);
				expect(withWard.heirs, at).toEqual(base.heirs);
				expect(withWard.openBranches, at).toEqual(base.openBranches);
				// (b) A ward link added to a later person who is not yet a parent-link holder of this person.
				const index = persons.findIndex((p) => p.id === row.id);
				const later = persons.filter((p, i) => i > index && !p.parents.some((x) => x.id === row.id));
				if (later.length > 0) {
					const target = pick(later);
					const linked = persons.map((p) => (p === target ? { ...p, parents: [...p.parents, { id: row.id, type: 'ward' }] } : p));
					const res = run(linked);
					checkedLinks++;
					expect(res.heirs, `${at}, ward link on ${target.id}`).toEqual(base.heirs);
					expect(res.openBranches, `${at}, ward link on ${target.id}`).toEqual(base.openBranches);
				}
			}
		}
		// The property must not be empty: the generator gives many rows.
		expect(checkedRows).toBeGreaterThan(50);
		expect(checkedLinks).toBeGreaterThan(20);
	});
});
