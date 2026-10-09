// Contract 0.2.7 M.1, M.3, M.4 (WP2c): the single conditions of an open branch, one by one, on small trees.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';

const HOLD = '\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: c, from: 1120, to: 1150}\n      - {person: r, from: 1150}\n';
/** A ruler R with father C, and the extra people. R's brothers are the people under test. */
function line(extra: string[], spec: Partial<SuccessionSpec> = {}, young = 0, limit = 99, holders = HOLD, extraTop: string[] = []): SuccessionResult {
	const rows = ['{id: c, name: C, sex: m, born: 1090, died: 1150}', '{id: r, name: R, sex: m, born: 1120, parents: [c]}', ...extraTop, ...extra];
	const parsed = parseDynasty(`people:\n${rows.map((x) => '  - ' + x).join('\n')}\n${holders}`);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	return successionLine(g, g.titles[0], { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec }, limit, 0, young);
}
const ids = (r: SuccessionResult) => r.openBranches.map((b) => `${b.id}@${b.before}`);

describe('who is an open branch (M.1)', () => {
	it('is a dead brother of the ruler with no child', () => {
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}']))).toEqual(['b@0']);
	});
	it('is a person whose died text has no year, and not a person with an alive word', () => {
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: unknown, parents: [c]}']))).toEqual(['b@0']);
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: long ago, parents: [c]}']))).toEqual(['b@0']);
		for (const word of ['alive', 'living', 'no', 'never']) expect(ids(line([`{id: b, name: B, sex: m, born: 1122, died: ${word}, parents: [c]}`]))).toEqual([]);
	});
	it('is never a living person, R, or the holder before R', () => {
		const r = line(['{id: b, name: B, sex: m, born: 1122, parents: [c]}']);
		expect(ids(r)).toEqual([]);
		expect(r.heirs).toEqual(['b']);
		// R is dead later, and has no child: R is the ruler, so no row. C held the title before R and has a child (R).
		expect(ids(line([], {}, 0, 99, '\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: r, from: 1150, to: 1160}\n'))).toEqual([]);
	});
	it('is not a person who held the title before R, though the person died with no child', () => {
		const holders = '\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: a, from: 1110, to: 1130}\n      - {person: r, from: 1130}\n';
		const a = '{id: a, name: A, sex: m, born: 1085, died: 1130, parents: [c]}';
		expect(ids(line([a], {}, 0, 99, holders))).toEqual([]);
		expect(ids(line([a, '{id: d, name: D, sex: m, born: 1086, died: 1100, parents: [c]}'], {}, 0, 99, holders))).toEqual(['d@0']);
	});
	it('is not a person who is unborn in a past year', () => {
		const r = line(['{id: w, name: W, sex: m, born: 1131, parents: [c]}', '{id: u, name: U, sex: m, born: 1116, died: 1125, parents: [c]}'], { year: '1130' }, 0, 99, '\ntitles:\n  - id: duke\n    name: Duke\n    year: 1130\n    holders:\n      - {person: c, from: 1110, to: 1128}\n      - {person: r, from: 1128}\n');
		expect(ids(r)).toEqual(['u@0']);
	});
	it('is closed by a birth, adoptive or rumoured child, but not by a ward or a partnership (D191)', () => {
		for (const type of ['adoptive', 'ward', 'rumoured', 'birth']) {
			const rows = ['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}', `{id: k, name: K, sex: m, born: 1135, died: 1140, parents: [{id: b, type: ${type}}]}`];
			// A ward link does not close the branch, so B stays; the other types close it.
			expect(ids(line(rows)).includes('b@0'), type).toBe(type === 'ward');
		}
		const unions = HOLD + '\nunions:\n  - {partners: [b, w]}\n';
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}', '{id: w, name: W, sex: f, born: 1124}'], {}, 0, 99, unions))).toEqual(['b@0']);
	});
	it('is closed by a child who died with no child, and the child is the branch', () => {
		const r = line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}', '{id: k, name: K, sex: m, born: 1125, died: 1126, parents: [b]}']);
		expect(ids(r)).toEqual(['k@0']);
	});
	it('is not a person with childless true, and childless on a person with a child changes nothing', () => {
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: 1130, childless: true, parents: [c]}']))).toEqual([]);
		const withChild = ['{id: b, name: B, sex: m, born: 1122, died: 1130, childless: true, parents: [c]}', '{id: k, name: K, sex: m, born: 1125, parents: [b]}'];
		expect(line(withChild).heirs).toEqual(['k']);
		expect(ids(line(withChild))).toEqual([]);
	});
	it('childless true on a living person has no effect', () => {
		const r = line(['{id: b, name: B, sex: m, born: 1122, childless: true, parents: [c]}']);
		expect(r.heirs).toEqual(['b']);
		expect(ids(r)).toEqual([]);
	});
	it('is not removed by exclude (K.3)', () => {
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}'], { exclude: ['b'] }))).toEqual(['b@0']);
	});
});

describe('the setting youngDeathAge (M.1 item 6)', () => {
	const B = ['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}'];
	it('is off at 0, and a person who died at exactly the age keeps the branch', () => {
		expect(ids(line(B, {}, 0))).toEqual(['b@0']);
		expect(ids(line(B, {}, 8))).toEqual(['b@0']);
		expect(ids(line(B, {}, 9))).toEqual([]);
	});
	it('keeps the branch when a year cannot be read', () => {
		expect(ids(line(['{id: b, name: B, sex: m, died: 1130, parents: [c]}'], {}, 50))).toEqual(['b@0']);
		expect(ids(line(['{id: b, name: B, sex: m, born: 1122, died: unknown, parents: [c]}'], {}, 50))).toEqual(['b@0']);
	});
	it('has the default 0 when the argument is left out', () => {
		const parsed = parseDynasty(`people:\n  - {id: c, name: C, sex: m, born: 1090, died: 1150}\n  - {id: r, name: R, sex: m, born: 1120, parents: [c]}\n  - ${B[0]}\n${HOLD}`);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		expect(successionLine(g, g.titles[0], { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false }, 5, 0).openBranches).toEqual([{ id: 'b', before: 0 }]);
	});
});

describe('the result (M.3, M.4)', () => {
	it('is empty for a tree with no rule, a bad rule, or a line of named heirs only', () => {
		const none = line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}'], { rule: undefined });
		expect(none).toMatchObject({ kind: 'no-rule', openBranches: [], moreBranches: false });
		const heirsOnly = line(['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}', '{id: z, name: Z, sex: m, born: 1100}'], { rule: undefined, heirs: ['z'] });
		expect(heirsOnly).toMatchObject({ kind: 'line', heirs: ['z'], openBranches: [], moreBranches: false });
		expect(line([], { bad: 'succession' })).toMatchObject({ kind: 'bad-rule', openBranches: [], moreBranches: false });
	});
	it('is empty when the title has no ruler', () => {
		const r = line([], {}, 0, 99, '\ntitles:\n  - id: duke\n    name: Duke\n    holders: []\n');
		expect(r.openBranches).toEqual([]);
		expect(r.moreBranches).toBe(false);
	});
	it('reports at most limit rows and sets moreBranches only when more are cut', () => {
		const rows = ['b1', 'b2', 'b3'].map((id, i) => `{id: ${id}, name: ${id}, sex: m, born: ${1121 + i}, died: 11${30 + i}, parents: [c]}`);
		expect(line(rows, {}, 0, 3)).toMatchObject({ openBranches: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }], moreBranches: false });
		expect(line(rows, {}, 0, 2)).toMatchObject({ openBranches: [{ id: 'b1' }, { id: 'b2' }], moreBranches: true });
		// limit 0: no heirs, and the rows are cut.
		expect(line(rows, {}, 0, 0)).toMatchObject({ heirs: [], openBranches: [], moreBranches: true });
	});
	it('counts a person with no sex whom a one-sex rule stops (M.1)', () => {
		const rows = ['{id: n, name: N, born: 1121, died: 1130, parents: [c]}', '{id: x, name: X, sex: m, born: 1122, died: 1131, parents: [c]}'];
		const r = line(rows, { inherit: 'men-only' });
		expect(ids(r)).toEqual(['x@0']);
		expect(r.leftOutNoSex).toBe(1);
		// A dead person with a child who has no sex: not a branch, but the old count rule holds.
		const closed = line([rows[0], '{id: k, name: K, sex: m, born: 1125, parents: [n]}'], { inherit: 'men-only' });
		expect(ids(closed)).toEqual([]);
	});
	it('puts a row at the place of the dead person among the heirs, and keeps heirs as they are', () => {
		const rows = ['{id: b, name: B, sex: m, born: 1122, died: 1130, parents: [c]}', '{id: k1, name: K1, sex: m, born: 1145, parents: [r]}', '{id: k2, name: K2, sex: m, born: 1146, died: 1148, parents: [r]}', '{id: k3, name: K3, sex: m, born: 1147, parents: [r]}'];
		const r = line(rows);
		expect(r.heirs).toEqual(['k1', 'k3']);
		expect(ids(r)).toEqual(['k2@1', 'b@2']);
	});
});
