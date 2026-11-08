// D334 Q11: the reason that the first heir is not a child of the ruler. The tests use made-up trees; the rule of the line is never changed.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionResult, type SuccessionSpec } from '../../src/core/succession';
import { firstHeirReason } from '../../src/core/succession-reason';

const PARENTS = ['{id: f, name: F, sex: m, born: 1050, died: 1100}', '{id: m, name: M, sex: f, born: 1052, died: 1101}'];
const TITLE = '\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n      - {person: k, from: 1100}\n';

function reasonOf(people: string[], spec: Partial<SuccessionSpec> = {}, extra = TITLE) {
	const parsed = parseDynasty(`people:\n${people.map((p) => `  - ${p}`).join('\n')}\n${extra}`);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	const full: SuccessionSpec = { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec };
	const res: SuccessionResult = successionLine(g, g.titles[0], full, 99, 0);
	return { res, why: firstHeirReason(g, res, full) };
}

describe('the reason for a first heir who is not a child of the ruler', () => {
	it('names the sister when the ruler has no child in the tree', () => {
		const { why } = reasonOf(PARENTS.concat(['{id: k, name: K, sex: m, born: 1070, parents: [f, m]}', '{id: j, name: J, sex: f, born: 1075, parents: [f, m]}']));
		expect(why).toEqual({ kind: 'no-child', ruler: 'k', heir: 'j', relation: 'sister' });
	});

	it('names the dead child when the first heir is a child of a dead child', () => {
		const { why } = reasonOf([
			'{id: k, name: K, sex: m, born: 1070}',
			'{id: v, name: V, sex: m, born: 1095, died: 1120, parents: [k]}',
			'{id: w, name: W, sex: m, born: 1118, parents: [v]}',
		]);
		expect(why).toEqual({ kind: 'dead-child', via: 'v', ruler: 'k' });
	});

	it('gives the neutral reason when a child exists but the rule skips the child', () => {
		const { why } = reasonOf(['{id: f, name: F, sex: m, born: 1050, died: 1100}', '{id: k, name: K, sex: m, born: 1070, parents: [f]}', '{id: d, name: D, sex: f, born: 1095, parents: [k]}', '{id: b, name: B, sex: m, born: 1075, parents: [f]}'], { inherit: 'men-only' });
		expect(why).toEqual({ kind: 'inherit', heir: 'b', inherit: 'men-only' });
	});

	it('shows nothing when the first heir is a child of the ruler', () => {
		const { why } = reasonOf(['{id: k, name: K, sex: m, born: 1070}', '{id: c, name: C, sex: m, born: 1095, parents: [k]}']);
		expect(why).toBeNull();
	});

	it('shows nothing when the first heir is a named heir', () => {
		const { why } = reasonOf(['{id: f, name: F, sex: m, born: 1050, died: 1100}', '{id: k, name: K, sex: m, born: 1070, parents: [f]}', '{id: j, name: J, sex: f, born: 1075, parents: [f]}'], { heirs: ['j'] });
		expect(why).toBeNull();
	});

	it('shows nothing when the line has no heir or no rule', () => {
		expect(reasonOf(['{id: k, name: K, sex: m, born: 1070}']).why).toBeNull();
		expect(reasonOf(['{id: f, name: F, sex: m}', '{id: k, name: K, sex: m, parents: [f]}', '{id: j, name: J, sex: m, parents: [f]}'], { heirs: ['j'], rule: undefined }).why).toBeNull();
	});

	it('keeps the neutral reason for an uncertain relation word', () => {
		// Only one parent is listed for both: the word could be "sister" or "half-sister", so the note does not name it.
		const { why } = reasonOf(['{id: f, name: F, sex: m, born: 1050, died: 1100}', '{id: k, name: K, sex: m, born: 1070, parents: [f]}', '{id: j, name: J, sex: f, born: 1075, parents: [f]}']);
		expect(why).toEqual({ kind: 'rule', heir: 'j', rule: 'eldest-child' });
	});

	it('skips a rumoured name and takes the first sure blood name', () => {
		// Hugo is a rumoured half-brother of Konrad through Fulk, and a first cousin through the sisters Mathilde and Ada.
		const { why } = reasonOf([
			'{id: fulk, name: Fulk, sex: m, born: 1040, died: 1090}',
			'{id: gran, name: Gran, sex: f, born: 1030, died: 1090}',
			'{id: grandpa, name: Grandpa, sex: m, born: 1028, died: 1088}',
			'{id: bram, name: Bram, sex: m, born: 1050, died: 1095}',
			'{id: mathilde, name: Mathilde, sex: f, born: 1050, died: 1095, parents: [gran, grandpa]}',
			'{id: ada, name: Ada, sex: f, born: 1052, died: 1095, parents: [gran, grandpa]}',
			'{id: k, name: Konrad, sex: m, born: 1070, parents: [fulk, mathilde]}',
			'{id: hugo, name: Hugo, sex: m, born: 1075, parents: [ada, bram, {id: fulk, type: rumoured}]}',
		]);
		expect(why).toEqual({ kind: 'no-child', ruler: 'k', heir: 'hugo', relation: 'first cousin' });
	});

	it('does not count a rumoured child as a child of the ruler', () => {
		const { why } = reasonOf([
			'{id: p, name: P, sex: m, born: 1040, died: 1090}',
			'{id: k, name: Konrad, sex: m, born: 1070, parents: [p]}',
			'{id: bero, name: Bero, sex: m, born: 1068, died: 1099, parents: [p]}',
			'{id: niko, name: Nikolaus, sex: m, born: 1095, parents: [bero, {id: k, type: rumoured}]}',
		]);
		// The rumoured link is not a child link for the line, so the first heir needs a reason; the ruler does have a (rumoured) child, so it is not "no child".
		expect(why).toEqual({ kind: 'rule', heir: 'niko', rule: 'eldest-child' });
	});

	it('gives no dead-child reason when the child of the ruler is not born yet', () => {
		// The child V is born after the line year and has no death text: not alive at that year, but not dead either.
		const { why } = reasonOf([
			'{id: k, name: K, sex: m, born: 1070}',
			'{id: v, name: V, sex: m, born: 1200, parents: [k]}',
			'{id: w, name: W, sex: m, born: 1220, parents: [v]}',
		]);
		expect(why?.kind).not.toBe('dead-child');
	});
});
