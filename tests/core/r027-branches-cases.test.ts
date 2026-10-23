// Contract 0.2.7 M.1-M.5 (WP2c): open branches. Cases M01-M12 follow the section "Cases of D190" in an internal study.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionSpec } from '../../src/core/succession';

interface Run {
	l: string;
	spec: Record<string, unknown>;
	limit?: number;
	young?: number;
	heirs: string;
	rows: string;
	more?: boolean;
	moreBranches?: boolean;
	noSex?: number;
}
interface Case { id: string; what: string; people: string[]; holders: string[]; titleExtra?: string; runs: Run[] }
const srcOf = (c: Case) => `people:\n${c.people.map((p) => '  - ' + p).join('\n')}\n\ntitles:\n  - id: duke\n    name: Duke\n${c.titleExtra ?? ''}    holders:\n${c.holders.map((h) => '      - ' + h).join('\n')}\n`;

// The depth-first tree of the game: a ruler line of 4 generations, dead siblings, no side branches drawn.
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
const GH = ['{person: f, from: 1000, to: 1060}', '{person: a, from: 1060, to: 1090}', '{person: b, from: 1090, to: 1120}', '{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];
const EC = { rule: 'eldest-child' };

// R with children; one child dead and childless; two dead brothers.
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
const KH = ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}'];

const cases: Case[] = [
	{
		id: 'M01', what: 'depth-first game tree: 4 generations, dead siblings, no side branches drawn, the main line dies out (R has no children yet)',
		people: GAME, holders: GH,
		runs: [
			{ l: 'a', spec: EC, limit: 20, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0 ab@0 ac@0' },
			{ l: 'b', spec: EC, limit: 5, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0', moreBranches: true },
			{ l: 'c', spec: { ...EC, inherit: 'men-only' }, limit: 20, heirs: '', rows: 'rb@0 cc@0 bb@0 ab@0', noSex: 0 },
			{ l: 'd', spec: EC, limit: 20, young: 10, heirs: '', rows: 'rb@0 rc@0 cb@0 cc@0 bb@0 ac@0' },
			{ l: 'e', spec: { rule: 'youngest-child' }, limit: 20, heirs: '', rows: 'rc@0 rb@0 cc@0 cb@0 bb@0 ac@0 ab@0' },
		],
	},
	{
		id: 'M02', what: 'rows between and after heirs: R has K1, K2 (dead, no children), K3; R has two dead brothers, one older (Re), one younger (Rb), and a dead sister Rs',
		people: KIDS, holders: KH,
		runs: [
			{ l: 'a', spec: EC, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
			{ l: 'b', spec: EC, limit: 2, heirs: 'k1 k3', rows: 'k2@1 re@2', more: false, moreBranches: true },
			{ l: 'c', spec: EC, limit: 1, heirs: 'k1', rows: 'k2@1', more: true },
			{ l: 'd', spec: { ...EC, inherit: 'men-only' }, limit: 5, heirs: 'k1 k3', rows: 're@2 rb@2' },
			{ l: 'e', spec: { ...EC, inherit: 'men-only', inheritThrough: 'anyone' }, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
		],
	},
	{
		id: 'M03', what: 'childless: true closes one branch (Re) and nothing else; a young death with the setting on and off (Re died at 7)',
		people: KIDS.map((p) => p.replace('{id: rb,', '{id: rb, childless: true,')), holders: KH,
		runs: [
			{ l: 'a', spec: EC, limit: 5, heirs: 'k1 k3', rows: 'k2@1 re@2 rs@2' },
			{ l: 'b', spec: EC, limit: 5, young: 8, heirs: 'k1 k3', rows: '' },
			{ l: 'c', spec: EC, limit: 5, young: 7, heirs: 'k1 k3', rows: 're@2' },
			{ l: 'd', spec: EC, limit: 5, young: 3, heirs: 'k1 k3', rows: 'k2@1 re@2 rs@2' },
			{ l: 'e', spec: EC, limit: 5, young: 4, heirs: 'k1 k3', rows: 're@2 rs@2' },
		],
	},
	{
		id: 'M04', what: 'a branch at the edge of the limit: R has K1, K2 (alive), K3 (dead, no children), K4; limit 2 shows the row after the 2nd heir, limit 1 does not',
		people: [
			'{id: r, name: R, sex: m, born: 1120}',
			'{id: k1, name: K1, sex: m, born: 1145, parents: [r]}',
			'{id: k2, name: K2, sex: m, born: 1147, parents: [r]}',
			'{id: k3, name: K3, sex: m, born: 1149, died: 1155, parents: [r]}',
			'{id: k4, name: K4, sex: m, born: 1150, parents: [r]}',
		],
		holders: ['{person: r, from: 1150}'],
		runs: [
			{ l: 'a', spec: EC, limit: 2, heirs: 'k1 k2', rows: 'k3@2', more: true },
			{ l: 'b', spec: EC, limit: 1, heirs: 'k1', rows: '', more: true },
			{ l: 'c', spec: EC, limit: 3, heirs: 'k1 k2 k4', rows: 'k3@2', more: false },
		],
	},
	{
		id: 'M05', what: 'siblings-first and nearest-relative: R has child K; S living brother; B dead brother; U dead uncle; no branch drawn',
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
			{ l: 'a', spec: { rule: 'siblings-first' }, heirs: 's k', rows: 'u@1 b@2' },
			{ l: 'b', spec: { rule: 'nearest-relative' }, heirs: 'k s', rows: 'b@2 u@2' },
			{ l: 'c', spec: EC, heirs: 'k s', rows: 'b@1 u@2' },
		],
	},
	{
		id: 'M06', what: 'siblings-first with a gender step: dead brother B (unknown children), living sister Sd; men-first puts the row ahead of Sd (earliest possible place)',
		people: [
			'{id: f, name: F, sex: m, born: 1090, died: 1140}',
			'{id: b, name: B, sex: m, born: 1118, died: 1135, parents: [f]}',
			'{id: r, name: R, sex: m, born: 1120, parents: [f]}',
			'{id: sd, name: Sd, sex: f, born: 1124, parents: [f]}',
			'{id: k, name: K, sex: f, born: 1148, parents: [r]}',
		],
		holders: ['{person: f, from: 1120, to: 1150}', '{person: r, from: 1150}'],
		runs: [
			{ l: 'a', spec: { rule: 'siblings-first', inherit: 'men-first' }, heirs: 'sd k', rows: 'b@1' },
			{ l: 'b', spec: { rule: 'siblings-first', inherit: 'no-preference' }, heirs: 'sd k', rows: 'b@2' },
			{ l: 'c', spec: { rule: 'siblings-first', inherit: 'women-first' }, heirs: 'sd k', rows: 'b@2' },
		],
	},
	{
		id: 'M07', what: 'a named heir: Z (a distant living cousin) is named; the rows keep their place after the named heir; a named heir that is also in the line is counted once',
		people: [
			...KIDS,
			'{id: z, name: Z, sex: m, born: 1100, parents: [f]}',
		],
		holders: KH,
		titleExtra: '    heir: z\n',
		runs: [
			{ l: 'a', spec: { ...EC, heirs: ['z'] }, limit: 5, heirs: 'z k1 k3', rows: 'k2@2 re@3 rb@3 rs@3' },
			{ l: 'b', spec: { ...EC, heirs: ['k3'] }, limit: 5, heirs: 'k3 k1 z', rows: 'k2@2 re@2 rb@2 rs@2' },
			{ l: 'c', spec: { ...EC, heirs: ['k3'] }, limit: 2, heirs: 'k3 k1', rows: 'k2@2 re@2', more: true, moreBranches: true },
		],
	},
	{
		id: 'M08', what: 'heirs-of-body: first holder is C; F (his father) and F\'s other dead children are outside the body; C\'s own dead siblings are outside it, R\'s are inside',
		people: [
			...KIDS,
			'{id: fb, name: Fb, sex: m, born: 1065, died: 1100, parents: [f]}',
		],
		holders: KH,
		runs: [
			{ l: 'a', spec: { ...EC, body: false }, limit: 20, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2 fb@2' },
			{ l: 'b', spec: { ...EC, body: true }, limit: 20, heirs: 'k1 k3', rows: 'k2@1 re@2 rb@2 rs@2' },
		],
	},
	{
		id: 'M09', what: 'which drawn children close a branch: X1 has an adopted child (switch off), X2 a rumoured child, X3 an illegitimate child (no), X4 a partnership only, X5 two dead childless children',
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
		titleExtra: '',
		runs: [
			{ l: 'a', spec: EC, limit: 5, heirs: '', rows: 'x4@0 x5a@0 x5b@0' },
			{ l: 'b', spec: { ...EC, adopted: true }, limit: 5, heirs: 'x1a', rows: 'x4@1 x5a@1 x5b@1' },
			{ l: 'c', spec: { ...EC, illegitimate: 'after' }, limit: 5, heirs: 'x3i', rows: 'x4@0 x5a@0 x5b@0' },
		],
	},
	{
		id: 'M10', what: 'house form and illegitimate: "after" with men-first-in-house; dead daughter D (no children) and dead bastard son Bs (no children) of R',
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
			{ l: 'a', spec: { rule: 'eldest-child', inherit: 'men-first-in-house', illegitimate: 'after' }, heirs: 's1 sb', rows: 'ds@2 bs@2' },
			{ l: 'b', spec: { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'after' }, heirs: 's1 sb', rows: 'ds@0 bs@2' },
			{ l: 'c', spec: { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no' }, heirs: 's1 sb', rows: 'ds@0' },
			{ l: 'd', spec: { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'equal' }, heirs: 's1 sb', rows: 'ds@0 bs@1' },
		],
	},
	{
		id: 'M11', what: 'a line for a past year: Y=1130; a brother born 1131 is not born (no row), a brother who died in 1140 is alive at 1130 (no row, an heir), one who died 1125 is a row',
		people: [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1115, parents: [c]}',
			'{id: u, name: U, sex: m, born: 1116, died: 1125, parents: [c]}',
			'{id: v, name: V, sex: m, born: 1117, died: 1140, parents: [c]}',
			'{id: w, name: W, sex: m, born: 1131, parents: [c]}',
			'{id: z, name: Z, sex: m, born: 1118, died: unknown, parents: [c]}',
		],
		holders: ['{person: c, from: 1110, to: 1128}', '{person: r, from: 1128}'],
		titleExtra: '    year: 1130\n',
		runs: [
			{ l: 'a', spec: { rule: 'eldest-child', year: '1130' }, heirs: 'v', rows: 'u@0 z@1' },
			{ l: 'b', spec: { rule: 'eldest-child', year: '1130' }, young: 10, heirs: 'v', rows: 'z@1' },
		],
	},
	{
		id: 'M12', what: 'a former holder is no branch: A held the title, then his brother B, then B\'s son R; A died with no children in the tree; D (another dead brother) is a row; A\'s sister S (dead) too',
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
			{ l: 'a', spec: { rule: 'eldest-child' }, heirs: '', rows: 'd@0 s@0' },
			{ l: 'b', spec: { rule: 'eldest-child', inherit: 'men-only' }, heirs: '', rows: 'd@0' },
		],
	},
];

describe('open branches: cases M01-M12', () => {
	for (const c of cases) {
		for (const r of c.runs) {
			it(`${c.id}${r.l}: ${c.what.slice(0, 60)}`, () => {
				const parsed = parseDynasty(srcOf(c));
				if (!parsed.ok) throw new Error('parse');
				const g = deriveFamilies(parsed.tree);
				const spec = { inherit: 'no-preference', illegitimate: 'no', adopted: false, ...r.spec } as SuccessionSpec;
				const res = successionLine(g, g.titles[0], spec, r.limit ?? 99, 0, r.young ?? 0);
				expect(res.heirs.join(' ')).toBe(r.heirs);
				expect(res.openBranches.map((x) => `${x.id}@${x.before}`).join(' ')).toBe(r.rows);
				if (r.more !== undefined) expect(res.more).toBe(r.more);
				if (r.moreBranches !== undefined) expect(res.moreBranches).toBe(r.moreBranches);
				if (r.noSex !== undefined) expect(res.leftOutNoSex).toBe(r.noSex);
			});
		}
	}
});
