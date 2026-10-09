import { describe, expect, it } from 'vitest';
import { blockOf, branchLine, graphOf, titleIn, type BranchResult } from './r027-support';

/*
 * Version 0.2.7, open branches (spec D190, the 0.2.7 contract section M): the rows "Branch of NAME" of the line of
 * succession. A branch is a dead person who is walked, who is no earlier holder, and who has no child in the tree.
 * The trees and expected values are the cases M01 to M12 of an internal study ("Cases of
 * D190"), written by hand from the table; no value comes from the engine. A row `id@n` is a branch of the person
 * `id` with n heirs before it. Further tests prove M.1 to M.4: the kinds other than 'line', that rows never change
 * the heirs or `more`, that a child closes a row and takes its place, and that `childless: true` closes it.
 * They wait for the engine of WP2c (fields `openBranches` and `moreBranches`, 6th argument `youngDeathAge`).
 * Run: npx vitest run tests/acceptance/r027-open-branches.test.ts
 */

// ---- the case trees (table M01 to M12) ----

interface Keys {
	rule?: string;
	inherit?: string;
	through?: string;
	ill?: string;
	adopted?: boolean;
	body?: boolean;
	year?: string;
	heir?: string[];
}
interface Run {
	l: string;
	keys: Keys;
	limit?: number;
	young?: number;
	heirs: string;
	rows: string;
	more?: boolean;
	moreBranches?: boolean;
	noSex?: number;
}
interface Case {
	id: string;
	what: string;
	people: string[];
	holders: string[];
	runs: Run[];
}

/** The key lines of a title in the order of contract K.4 and L.1. */
function titleKeys(k: Keys): string[] {
	const out: string[] = [];
	if (k.rule) out.push(`succession: ${k.rule}`);
	out.push(`inherit: ${k.inherit ?? 'no-preference'}`);
	if (k.through) out.push(`inherit-through: ${k.through}`);
	if (k.ill) out.push(`inherit-illegitimate: ${k.ill}`);
	if (k.adopted) out.push('inherit-adopted: true');
	if (k.body) out.push('heirs-of-body: true');
	if (k.year) out.push(`year: ${k.year}`);
	if (k.heir) out.push(`heir: ${k.heir.length === 1 ? k.heir[0] : `[${k.heir.join(', ')}]`}`);
	return out;
}

const EC: Keys = { rule: 'eldest-child' };

// T1: the depth-first game tree. R has no children yet; now.
const GAME = [
	'{id: f,  name: F,  sex: m, born: 1000, died: 1060}',
	'{id: a,  name: A,  sex: m, born: 1030, died: 1090, parents: [f]}',
	'{id: ab, name: Ab, sex: m, born: 1033, died: 1040, parents: [f]}',
	'{id: ac, name: Ac, sex: f, born: 1036, died: 1100, parents: [f]}',
	'{id: b,  name: B,  sex: m, born: 1060, died: 1120, parents: [a]}',
	'{id: bb, name: Bb, sex: m, born: 1062, died: 1110, parents: [a]}',
	'{id: c,  name: C,  sex: m, born: 1090, died: 1150, parents: [b]}',
	'{id: cb, name: Cb, sex: f, born: 1092, died: 1130, parents: [b]}',
	'{id: cc, name: Cc, sex: m, born: 1095, died: 1125, parents: [b]}',
	'{id: r,  name: R,  sex: m, born: 1120, parents: [c]}',
	'{id: rb, name: Rb, sex: m, born: 1122, died: 1140, parents: [c]}',
	'{id: rc, name: Rc, sex: f, born: 1125, died: 1145, parents: [c]}',
];
const GAME_HOLDERS = ['{person: f, from: 1000, to: 1060}', '{person: a, from: 1060, to: 1090}', '{person: b, from: 1090, to: 1120}', '{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];

// T2: R has K1, K2 (dead, no children), K3 and two dead brothers and a dead sister.
const KIDS = [
	'{id: f,  name: F,  sex: m, born: 1060, died: 1110}',
	'{id: c,  name: C,  sex: m, born: 1090, died: 1150, parents: [f]}',
	'{id: re, name: Re, sex: m, born: 1118, died: 1125, parents: [c]}',
	'{id: r,  name: R,  sex: m, born: 1120, parents: [c]}',
	'{id: rb, name: Rb, sex: m, born: 1122, died: 1140, parents: [c]}',
	'{id: rs, name: Rs, sex: f, born: 1124, died: 1130, parents: [c]}',
	'{id: k1, name: K1, sex: m, born: 1145, parents: [r]}',
	'{id: k2, name: K2, sex: f, born: 1147, died: 1150, parents: [r]}',
	'{id: k3, name: K3, sex: m, born: 1150, parents: [r]}',
];
const KIDS_HOLDERS = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];

/** A people item with `childless: true` right after its id. */
const childless = (items: string[], id: string): string[] => items.map((p) => (p.startsWith(`{id: ${id},`) ? p.replace(`{id: ${id},`, `{id: ${id}, childless: true,`) : p));

const CASES: Case[] = [
	{
		id: 'M01',
		what: 'the game tree: 4 generations, dead siblings without children, the main line dies out',
		people: GAME,
		holders: GAME_HOLDERS,
		runs: [
			{ l: 'a', keys: EC, limit: 20, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0 ab@0 ac@0' },
			{ l: 'b', keys: EC, limit: 5, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0', moreBranches: true },
			{ l: 'c', keys: { ...EC, inherit: 'men-only' }, limit: 20, heirs: '', rows: 'rb@0 cc@0 bb@0 ab@0', noSex: 0 },
			{ l: 'd', keys: EC, limit: 20, young: 10, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0 ac@0' },
			{ l: 'e', keys: { rule: 'youngest-child' }, limit: 20, heirs: '', rows: 'rc@0 rb@0 cc@0 cb@0 bb@0 ac@0 ab@0' },
		],
	},
	{
		id: 'M02',
		what: 'rows between and after heirs; a dead daughter under men-only; inherit-through anyone gives her a branch',
		people: KIDS,
		holders: KIDS_HOLDERS,
		runs: [
			{ l: 'a', keys: EC, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
			{ l: 'b', keys: EC, limit: 2, heirs: 'k1 k3', rows: 'k2@1 re@2', more: false, moreBranches: true },
			{ l: 'c', keys: EC, limit: 1, heirs: 'k1', rows: 'k2@1', more: true },
			{ l: 'd', keys: { ...EC, inherit: 'men-only' }, limit: 5, heirs: 'k1 k3', rows: 're@2 rb@2' },
			{ l: 'e', keys: { ...EC, inherit: 'men-only', through: 'anyone' }, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
		],
	},
	{
		id: 'M03',
		what: 'childless: true on Rb closes one branch and nothing else; the setting youngDeathAge (Re died at 7, Rs at 6, K2 at 3)',
		people: childless(KIDS, 'rb'),
		holders: KIDS_HOLDERS,
		runs: [
			{ l: 'a', keys: EC, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rs@2' },
			{ l: 'b', keys: EC, limit: 5, young: 8, heirs: 'k1 k3', rows: '' },
			{ l: 'c', keys: EC, limit: 5, young: 7, heirs: 'k1 k3', rows: 're@2' },
			{ l: 'd', keys: EC, limit: 5, young: 3, heirs: 'k1 k3', rows: 'k2@1 re@2 rs@2' },
			{ l: 'e', keys: EC, limit: 5, young: 4, heirs: 'k1 k3', rows: 're@2 rs@2' },
		],
	},
	{
		id: 'M04',
		what: 'a branch at the edge of the limit: K3 is dead and childless between the alive K2 and K4',
		people: [
			'{id: r, name: R, sex: m, born: 1120}',
			'{id: k1, name: K1, sex: m, born: 1145, parents: [r]}',
			'{id: k2, name: K2, sex: m, born: 1147, parents: [r]}',
			'{id: k3, name: K3, sex: m, born: 1149, died: 1155, parents: [r]}',
			'{id: k4, name: K4, sex: m, born: 1150, parents: [r]}',
		],
		holders: ['{person: r, from: 1150}'],
		runs: [
			{ l: 'a', keys: EC, limit: 2, heirs: 'k1 k2', rows: 'k3@2', more: true },
			{ l: 'b', keys: EC, limit: 1, heirs: 'k1', rows: '', more: true },
			{ l: 'c', keys: EC, limit: 3, heirs: 'k1 k2 k4', rows: 'k3@2', more: false },
		],
	},
	{
		id: 'M05',
		what: 'siblings-first and nearest-relative: R has the child K; S is a living brother; B a dead brother; U a dead uncle',
		people: [
			'{id: g, name: G, sex: m, born: 1060, died: 1120}',
			'{id: u, name: U, sex: m, born: 1085, died: 1100, parents: [g]}',
			'{id: f, name: F, sex: m, born: 1090, died: 1140, parents: [g]}',
			'{id: b, name: B, sex: m, born: 1118, died: 1135, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1120, parents: [f]}',
			'{id: s, name: S, sex: m, born: 1124, parents: [f]}',
			'{id: k, name: K, sex: m, born: 1148, parents: [r]}',
		],
		holders: ['{person: f, from: 1120, to: 1150}', '{person: r, from: 1150}'],
		runs: [
			{ l: 'a', keys: { rule: 'siblings-first' }, heirs: 's k', rows: 'u@1 b@2' },
			{ l: 'b', keys: { rule: 'nearest-relative' }, heirs: 'k s', rows: 'b@2 u@2' },
			{ l: 'c', keys: EC, heirs: 'k s', rows: 'b@1 u@2' },
		],
	},
	{
		id: 'M06',
		what: 'siblings-first with a gender step: the dead brother B with a child of unknown sex, the living sister Sd, the daughter K',
		people: [
			'{id: f, name: F, sex: m, born: 1090, died: 1140}',
			'{id: b, name: B, sex: m, born: 1118, died: 1135, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1120, parents: [f]}',
			'{id: sd, name: Sd, sex: f, born: 1124, parents: [f]}',
			'{id: k, name: K, sex: f, born: 1148, parents: [r]}',
		],
		holders: ['{person: f, from: 1120, to: 1150}', '{person: r, from: 1150}'],
		runs: [
			{ l: 'a', keys: { rule: 'siblings-first', inherit: 'men-first' }, heirs: 'sd k', rows: 'b@1' },
			{ l: 'b', keys: { rule: 'siblings-first', inherit: 'no-preference' }, heirs: 'sd k', rows: 'b@2' },
			{ l: 'c', keys: { rule: 'siblings-first', inherit: 'women-first' }, heirs: 'sd k', rows: 'b@2' },
		],
	},
	{
		id: 'M07',
		what: 'a named heir comes first and the rows count after it; a named heir that is also in the line counts once',
		people: [...KIDS, '{id: z, name: Z, sex: m, born: 1100, parents: [f]}'],
		holders: KIDS_HOLDERS,
		runs: [
			{ l: 'a', keys: { ...EC, heir: ['z'] }, limit: 5, heirs: 'z k1 k3', rows: 'k2@2 re@3 rb@3 rs@3' },
			{ l: 'b', keys: { ...EC, heir: ['k3'] }, limit: 5, heirs: 'k3 k1 z', rows: 'k2@2 re@2 rb@2 rs@2' },
			{ l: 'c', keys: { ...EC, heir: ['k3'] }, limit: 2, heirs: 'k3 k1', rows: 'k2@2 re@2', more: true, moreBranches: true },
		],
	},
	{
		id: 'M08',
		what: 'heirs-of-body: the first holder is C; Fb, a dead child of C\'s father F, is outside the body; R\'s dead brothers and sister are inside',
		people: [...KIDS, '{id: fb, name: Fb, sex: m, born: 1065, died: 1100, parents: [f]}'],
		holders: KIDS_HOLDERS,
		runs: [
			{ l: 'a', keys: EC, limit: 20, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2 fb@2' },
			{ l: 'b', keys: { ...EC, body: true }, limit: 20, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
		],
	},
	{
		id: 'M09',
		what: 'which drawn children close a branch: X1 an adopted child (switch off), X2 a rumoured child, X3 a child marked illegitimate (no), X4 a partnership only, X5 two dead childless children',
		people: [
			'{id: f, name: F, sex: m, born: 1060, died: 1110}',
			'{id: x1, name: X1, sex: m, born: 1085, died: 1100, parents: [f]}',
			'{id: x1a, name: X1a, sex: m, born: 1095, parents: [{id: x1, type: adoptive}]}',
			'{id: x2, name: X2, sex: m, born: 1086, died: 1101, parents: [f]}',
			'{id: x2r, name: X2r, sex: m, born: 1095, parents: [{id: x2, type: rumoured}]}',
			'{id: x3, name: X3, sex: m, born: 1087, died: 1102, parents: [f]}',
			'{id: x3i, name: X3i, sex: m, born: 1096, illegitimate: true, parents: [x3]}',
			'{id: x4, name: X4, sex: m, born: 1088, died: 1103, parents: [f]}',
			'{id: x4w, name: X4w, sex: f, born: 1090, died: 1110}',
			'{id: x5, name: X5, sex: m, born: 1089, died: 1104, parents: [f]}',
			'{id: x5a, name: X5a, sex: m, born: 1115, died: 1120, parents: [x5]}',
			'{id: x5b, name: X5b, sex: f, born: 1117, died: 1130, parents: [x5]}',
			'{id: c, name: C, sex: m, born: 1090, died: 1150, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
		],
		holders: ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'],
		runs: [
			{ l: 'a', keys: EC, limit: 5, heirs: '', rows: 'x4@0 x5a@0 x5b@0' },
			{ l: 'b', keys: { ...EC, adopted: true }, limit: 5, heirs: 'x1a', rows: 'x4@1 x5a@1 x5b@1' },
			{ l: 'c', keys: { ...EC, ill: 'after' }, limit: 5, heirs: 'x3i', rows: 'x4@0 x5a@0 x5b@0' },
		],
	},
	{
		id: 'M10',
		what: 'a house form and "after": the dead daughter Ds and the dead illegitimate son Bs have no children',
		people: [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: sb, name: Sb, sex: m, born: 1122, parents: [c]}',
			'{id: ds, name: Ds, sex: f, born: 1146, died: 1149, parents: [r]}',
			'{id: s1, name: S1, sex: m, born: 1148, parents: [r]}',
			'{id: bs, name: Bs, sex: m, born: 1149, died: 1152, illegitimate: true, parents: [r]}',
		],
		holders: ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'],
		runs: [
			{ l: 'a', keys: { rule: 'eldest-child', inherit: 'men-first-in-house', ill: 'after' }, heirs: 's1 sb', rows: 'ds@2 bs@2' },
			{ l: 'b', keys: { rule: 'eldest-child', inherit: 'no-preference', ill: 'after' }, heirs: 's1 sb', rows: 'ds@0 bs@2' },
			{ l: 'c', keys: { rule: 'eldest-child', inherit: 'no-preference', ill: 'no' }, heirs: 's1 sb', rows: 'ds@0' },
			{ l: 'd', keys: { rule: 'eldest-child', inherit: 'no-preference', ill: 'equal' }, heirs: 's1 sb', rows: 'ds@0 bs@1' },
		],
	},
	{
		id: 'M11',
		what: 'a line for a past year (1130): W is not born, V died in 1140 and is alive, U died in 1125 (a row), Z has a death text with no year (a row)',
		people: [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1115, parents: [c]}',
			'{id: u, name: U, sex: m, born: 1116, died: 1125, parents: [c]}',
			'{id: v, name: V, sex: m, born: 1117, died: 1140, parents: [c]}',
			'{id: w, name: W, sex: m, born: 1131, parents: [c]}',
			'{id: z, name: Z, sex: m, born: 1118, died: unknown, parents: [c]}',
		],
		holders: ['{person: c, from: 1110, to: 1128}', '{person: r, from: 1128}'],
		runs: [
			{ l: 'a', keys: { rule: 'eldest-child', year: '1130' }, heirs: 'v', rows: 'u@0 z@1' },
			{ l: 'b', keys: { rule: 'eldest-child', year: '1130' }, young: 10, heirs: 'v', rows: 'z@1' },
		],
	},
	{
		id: 'M12',
		what: 'a former holder is no branch: A held the title and died with no children; D and S are rows',
		people: [
			'{id: f, name: F, sex: m, born: 1060, died: 1110}',
			'{id: a, name: A, sex: m, born: 1085, died: 1130, parents: [f]}',
			'{id: d, name: D, sex: m, born: 1086, died: 1100, parents: [f]}',
			'{id: b, name: B, sex: m, born: 1088, died: 1145, parents: [f]}',
			'{id: s, name: S, sex: f, born: 1090, died: 1120, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1115, parents: [b]}',
		],
		holders: ['{person: a, from: 1110, to: 1130}', '{person: b, from: 1130, to: 1145}', '{person: r, from: 1145}'],
		runs: [
			{ l: 'a', keys: { rule: 'eldest-child' }, heirs: '', rows: 'd@0 s@0' },
			{ l: 'b', keys: { rule: 'eldest-child', inherit: 'men-only' }, heirs: '', rows: 'd@0' },
		],
	},
];

// ---- helpers ----

const ids = (s: string): string[] => (s === '' ? [] : s.split(' '));
const rowsOf = (res: BranchResult): string[] => res.openBranches.map((b) => `${b.id}@${b.before}`);
const sourceOf = (people: string[], holders: string[], keys: Keys) => blockOf(people, holders, titleKeys(keys));
const lineOf = (people: string[], holders: string[], keys: Keys, limit: number, young?: number) => {
	const g = graphOf(sourceOf(people, holders, keys));
	return branchLine(g, titleIn(g), limit, young);
};
const runOf = (c: Case, r: Run) => lineOf(c.people, c.holders, r.keys, r.limit ?? 99, r.young);
/** The result without the fields of this feature. */
const withoutBranches = (res: BranchResult): Record<string, unknown> => {
	const rest: Record<string, unknown> = { ...res };
	delete rest.openBranches;
	delete rest.moreBranches;
	return rest;
};
/** A child of this person: alive, no dates, the sex that the rule prefers. */
const childOf = (inherit: string | undefined, parent: string) => `{id: zz9, name: Zz9, sex: ${inherit?.startsWith('women') ? 'f' : 'm'}, parents: [${parent}]}`;

// ---- the cases M01 to M12 (M.1 to M.4) ----

describe('open branches: the cases M01 to M12 of the table (contract M)', () => {
	for (const c of CASES) {
		describe(`${c.id}: ${c.what}`, () => {
			for (const r of c.runs) {
				it(`${c.id}${r.l}: heirs [${r.heirs}], rows [${r.rows}]`, () => {
					const res = runOf(c, r);
					expect(res.kind).toBe('line');
					expect(res.heirs).toEqual(ids(r.heirs));
					expect(rowsOf(res)).toEqual(ids(r.rows));
					if (r.more !== undefined) expect(res.more).toBe(r.more);
					expect(res.moreBranches).toBe(r.moreBranches ?? false);
					if (r.noSex !== undefined) expect(res.leftOutNoSex).toBe(r.noSex);
				});
			}
		});
	}
});

describe('open branches: the shape of the result (M.3, M.4)', () => {
	for (const c of CASES) {
		for (const r of c.runs) {
			it(`${c.id}${r.l}: line order, at most limit rows, each id once, before at most the number of heirs`, () => {
				const res = runOf(c, r);
				const limit = r.limit ?? 99;
				expect(res.openBranches.length).toBeLessThanOrEqual(limit);
				const befores = res.openBranches.map((b) => b.before);
				expect(befores).toEqual([...befores].sort((a, b) => a - b));
				for (const b of res.openBranches) {
					expect(Number.isInteger(b.before)).toBe(true);
					expect(b.before).toBeGreaterThanOrEqual(0);
					expect(b.before).toBeLessThanOrEqual(res.heirs.length);
				}
				expect(new Set(res.openBranches.map((b) => b.id)).size).toBe(res.openBranches.length);
				// A branch is not an heir.
				for (const b of res.openBranches) expect(res.heirs).not.toContain(b.id);
			});
		}
	}

	it('a row never changes heirs, more, old, noYear, noBirthYear or the other result fields: the setting only takes rows away', () => {
		for (const c of CASES) {
			for (const r of c.runs) {
				expect(lineOf(c.people, c.holders, r.keys, r.limit ?? 99, 0).openBranches, `${c.id}${r.l}`).toBeDefined();
				const base = withoutBranches(lineOf(c.people, c.holders, r.keys, r.limit ?? 99, 0));
				for (const young of [undefined, 3, 7, 10, 1000]) {
					expect(withoutBranches(lineOf(c.people, c.holders, r.keys, r.limit ?? 99, young)), `${c.id}${r.l} young ${young}`).toEqual(base);
				}
			}
		}
	});

	it('M.4: the call without the 6th argument is the call with youngDeathAge 0 (every row)', () => {
		const c = CASES[0];
		expect(lineOf(c.people, c.holders, c.runs[0].keys, 20).openBranches).toBeDefined();
		expect(lineOf(c.people, c.holders, c.runs[0].keys, 20)).toEqual(lineOf(c.people, c.holders, c.runs[0].keys, 20, 0));
	});

	it('M.1 (6): a very large youngDeathAge takes away every row whose two years can be read, and keeps the others', () => {
		// M01: all dates are readable, so nothing stays; M11: Z has a death text with no year and stays.
		expect(rowsOf(lineOf(CASES[0].people, CASES[0].holders, EC, 20, 1000))).toEqual([]);
		const m11 = CASES[10];
		expect(rowsOf(lineOf(m11.people, m11.holders, m11.runs[0].keys, 99, 1000))).toEqual(['z@1']);
	});
});

describe('open branches: a child closes a row and takes its place; childless closes it (M.1, M.2, M.5)', () => {
	for (const c of CASES) {
		for (const r of c.runs) {
			if (r.rows === '') continue;
			const full = { ...r, limit: 50 };
			it(`${c.id}${r.l}: a living child of the person of each row is an heir at the place "before"; the row is gone`, () => {
				const base = runOf(c, full);
				// With a limit of 50 no row is cut, so every row of the table is there (no empty loop).
				expect(base.openBranches.length).toBeGreaterThanOrEqual(ids(r.rows).length);
				for (const row of base.openBranches) {
					const res = lineOf([...c.people, childOf(r.keys.inherit, row.id)], c.holders, r.keys, 50, r.young);
					expect(res.heirs.indexOf('zz9'), `child of ${row.id}`).toBe(row.before);
					expect(res.heirs.filter((h) => h !== 'zz9'), `child of ${row.id}`).toEqual(base.heirs);
					expect(res.openBranches.map((b) => b.id), `child of ${row.id}`).toEqual(base.openBranches.map((b) => b.id).filter((id) => id !== row.id));
				}
			});
			it(`${c.id}${r.l}: childless: true on the person of a row takes away this row only; heirs do not change`, () => {
				const base = runOf(c, full);
				expect(base.openBranches.length).toBeGreaterThanOrEqual(ids(r.rows).length);
				for (const row of base.openBranches) {
					const res = lineOf(childless(c.people, row.id), c.holders, r.keys, 50, r.young);
					expect(res.heirs, `childless ${row.id}`).toEqual(base.heirs);
					expect(res.openBranches, `childless ${row.id}`).toEqual(base.openBranches.filter((b) => b.id !== row.id));
				}
			});
		}
	}
});

// ---- the kinds other than 'line' (M.4) ----

describe('open branches: kinds other than "line" give [] and false (M.4)', () => {
	// The tree has dead people without children, so an engine that forgets the kind would give rows.
	const keysOf = (...extra: string[]) => ['inherit: no-preference', ...extra];
	const at = (extra: string[], holders = KIDS_HOLDERS) => {
		const g = graphOf(blockOf(KIDS, holders, extra));
		return branchLine(g, titleIn(g), 20, 0);
	};

	it('no-rule: a title with neither a rule nor a named heir', () => {
		const res = at(keysOf());
		expect(res.kind).toBe('no-rule');
		expect([res.openBranches, res.moreBranches]).toEqual([[], false]);
	});

	it('no-ruler: the year is before the first holder started', () => {
		const res = at(keysOf('succession: eldest-child', 'year: 1100'));
		expect(res.kind).toBe('no-ruler');
		expect([res.openBranches, res.moreBranches]).toEqual([[], false]);
	});

	it('ruler-not-in-tree: the holder is a name with no person', () => {
		const res = at(keysOf('succession: eldest-child'), ['{person: c, from: 1120, to: 1150}', '{name: Old King, from: 1150}']);
		expect(res.kind).toBe('ruler-not-in-tree');
		expect([res.openBranches, res.moreBranches]).toEqual([[], false]);
	});

	const BAD: string[][] = [
		['succession: primogenitor', 'inherit: no-preference'],
		['succession: eldest-child', 'inherit: sideways'],
		['succession: eldest-child', 'inherit: no-preference', 'inherit-through: sideways'],
		['succession: eldest-child', 'inherit: no-preference', 'inherit-illegitimate: maybe'],
	];
	for (const lines of BAD) {
		it(`bad-rule: ${lines.join(', ')}`, () => {
			const res = at(lines);
			expect(res.kind).toBe('bad-rule');
			expect([res.openBranches, res.moreBranches]).toEqual([[], false]);
		});
	}
});

// ---- more cases of M.1 ----

describe('open branches: more of the conditions of M.1', () => {
	it('(2) the ruler is no row, also when the ruler is dead and has no children', () => {
		const people = ['{id: c, name: C, sex: m, born: 1090, died: 1150}', '{id: r, name: R, sex: m, born: 1120, died: 1190, parents: [c]}', '{id: s, name: S, sex: m, born: 1122, died: 1140, parents: [c]}'];
		const holders = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];
		const res = lineOf(people, holders, EC, 20);
		expect(res.ruler).toBe('r');
		expect(rowsOf(res)).toEqual(['s@0']);
	});

	it('(3) a death text that means alive gives no row, one that means dead gives a row', () => {
		const people = [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: a1, name: A1, sex: m, born: 1121, died: alive, parents: [c]}',
			'{id: a2, name: A2, sex: m, born: 1122, died: living, parents: [c]}',
			'{id: d1, name: D1, sex: m, born: 1123, died: "?", parents: [c]}',
			'{id: d2, name: D2, sex: m, born: 1124, died: "before the war", parents: [c]}',
		];
		const res = lineOf(people, ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'], EC, 20);
		expect(res.heirs).toEqual(['a1', 'a2']);
		expect(rowsOf(res)).toEqual(['d1@2', 'd2@2']);
	});

	it('(4) a person with a drawn child is no branch; the dead childless child is the branch', () => {
		// The partnership alone (X4) and the children of X5 are in the table (M09).
		const people = [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: p, name: P, sex: m, born: 1122, died: 1130, parents: [c]}',
			'{id: pw, name: Pw, sex: f, born: 1124, died: 1135}',
			'{id: pc, name: Pc, sex: m, born: 1150, died: 1155, parents: [p, pw]}',
		];
		const res = lineOf(people, ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'], EC, 20);
		expect(res.heirs).toEqual([]);
		expect(rowsOf(res)).toEqual(['pc@0']);
	});

	it('K.3, M.1: exclude does not close a branch (a dead excluded person with no children is still a row)', () => {
		const res = lineOf(KIDS, KIDS_HOLDERS, EC, 20);
		const withExclude = blockOf(KIDS, KIDS_HOLDERS, ['succession: eldest-child', 'inherit: no-preference', 'exclude: [re, k1]']);
		const g = graphOf(withExclude);
		const res2 = branchLine(g, titleIn(g), 20, 0);
		expect(rowsOf(res)).toEqual(['k2@1', 're@2', 'rb@2', 'rs@2']);
		// K1 is excluded, so the heirs are K3 alone; the rows keep their places among the shown heirs: k2 is now at 0.
		expect(res2.heirs).toEqual(['k3']);
		expect(rowsOf(res2)).toEqual(['k2@0', 're@1', 'rb@1', 'rs@1']);
	});

	it('M.1 (1), M.1 end: a dead child with no sex under a one-sex rule is no row, and it is counted in leftOutNoSex', () => {
		const people = [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: n, name: N, born: 1121, died: 1130, parents: [c]}',
			'{id: x, name: X, sex: m, born: 1122, died: 1131, parents: [c]}',
			'{id: y, name: Y, sex: m, born: 1123, parents: [c]}',
		];
		const holders = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];
		const only = lineOf(people, holders, { ...EC, inherit: 'men-only' }, 20);
		expect(rowsOf(only)).toEqual(['x@0']);
		expect(only.leftOutNoSex).toBe(1);
		const free = lineOf(people, holders, EC, 20);
		expect(rowsOf(free)).toEqual(['n@0', 'x@0']);
		expect(free.leftOutNoSex).toBe(0);
	});

	it('M.2: born-in-reign puts a row at the walk place of its person', () => {
		const people = [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: k1, name: K1, sex: m, born: 1148, parents: [r]}',
			'{id: k2, name: K2, sex: m, born: 1155, died: 1160, parents: [r]}',
			'{id: k3, name: K3, sex: m, born: 1152, parents: [r]}',
		];
		const holders = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];
		// R reigns from 1150: K2 and K3 are born in the reign and come first, in the written order (K2, then K3); K1 follows.
		const res = lineOf(people, holders, { rule: 'born-in-reign' }, 20);
		expect(res.heirs).toEqual(['k3', 'k1']);
		expect(rowsOf(res)).toEqual(['k2@0']);
	});
});
