// D334 Q11, second repair round: the reason line names only a cause that the claim and pass rules prove. Made-up trees around the ruler Konrad.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { successionLine, type SuccessionSpec } from '../../src/core/succession';
import { firstHeirReason } from '../../src/core/succession-reason';

const FM = ['{id: f, name: Fulk, sex: m, born: 1040, died: 1100}', '{id: m, name: Mathilde, sex: f, born: 1042, died: 1101}'];
const K = '{id: k, name: Konrad, sex: m, born: 1070, parents: [f, m]}';
const B = '{id: b, name: Bero, sex: m, born: 1072, parents: [f, m]}';
const J = '{id: j, name: Jadwiga, sex: f, born: 1075, parents: [f, m]}';
const DORA = '{id: d, name: Dora, sex: f, born: 1095, parents: [k]}';
const DORA_ILL = '{id: d, name: Dora, sex: f, born: 1095, parents: [k], illegitimate: true}';
const DORA_ADOPTED = '{id: d, name: Dora, sex: f, born: 1095, parents: [{id: k, type: adoptive}]}';
const VRENI = ['{id: v, name: Vreni, sex: f, born: 1090, died: 1099, parents: [k]}', '{id: w, name: Wido, sex: m, born: 1098, parents: [v]}'];
const HOLDER = '{person: k, from: 1100}';

function reasonOf(people: string[], spec: Partial<SuccessionSpec> = {}, holders = [HOLDER]) {
	const text = `people:\n${people.map((p) => `  - ${p}`).join('\n')}\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n${holders.map((h) => `      - ${h}`).join('\n')}\n`;
	const parsed = parseDynasty(text);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	const full: SuccessionSpec = { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec };
	const res = successionLine(g, g.titles[0], full, 99, 0);
	return { res, why: firstHeirReason(g, res, full) };
}

describe('a child who cannot inherit because of the mark or an adoption', () => {
	it('names the mark, not "Men first", when the only child Dora is illegitimate', () => {
		const { res, why } = reasonOf([...FM, K, B, DORA_ILL], { inherit: 'men-first' });
		expect(res.heirs[0]).toBe('b');
		expect(why).toEqual({ kind: 'barred', child: 'd', heir: 'b', bar: 'illegitimate' });
	});

	it('names the later place when illegitimate children inherit after the others', () => {
		const { res, why } = reasonOf([...FM, K, B, DORA_ILL], { inherit: 'men-first', illegitimate: 'after' });
		expect(res.heirs).toEqual(['b', 'd']);
		expect(why).toEqual({ kind: 'barred', child: 'd', heir: 'b', bar: 'illegitimate-after' });
	});

	it('names the adoption when the only child Dora is adopted and adopted children cannot inherit', () => {
		expect(reasonOf([...FM, K, B, DORA_ADOPTED], { inherit: 'men-first' }).why).toEqual({ kind: 'barred', child: 'd', heir: 'b', bar: 'adopted' });
		// With adopted children on, Dora is the first heir and needs no reason.
		expect(reasonOf([...FM, K, B, DORA_ADOPTED], { inherit: 'men-first', adopted: true }).why).toBeNull();
	});

	it('also names the mark with "Nearest relative first", where a child comes first', () => {
		expect(reasonOf([...FM, K, B, DORA_ILL], { rule: 'nearest-relative' }).why).toEqual({ kind: 'barred', child: 'd', heir: 'b', bar: 'illegitimate' });
	});

	it('gives no line for two such children, for two causes, or with "Oldest generation first"', () => {
		const ella = '{id: e, name: Ella, sex: f, born: 1096, parents: [k], illegitimate: true}';
		expect(reasonOf([...FM, K, B, DORA_ILL, ella]).why).toBeNull();
		// Under "Men only" Dora cannot inherit as a woman either.
		expect(reasonOf([...FM, K, B, DORA_ILL], { inherit: 'men-only' }).why).toBeNull();
		// A brother comes before a child under this rule anyway.
		expect(reasonOf([...FM, K, B, DORA_ILL], { rule: 'siblings-first' }).why).toBeNull();
	});

	it('gives no line when the line of a dead child is cut by the mark or an adoption', () => {
		const deadIll = ['{id: v, name: Volkmar, sex: m, born: 1090, died: 1099, parents: [k], illegitimate: true}', '{id: w, name: Wido, sex: m, born: 1098, parents: [v]}'];
		expect(reasonOf([...FM, K, B, ...deadIll]).why).toBeNull();
		const deadAdopted = ['{id: v, name: Volkmar, sex: m, born: 1090, died: 1099, parents: [{id: k, type: adoptive}]}', '{id: w, name: Wido, sex: m, born: 1098, parents: [v]}'];
		expect(reasonOf([...FM, K, J, ...deadAdopted]).why).toBeNull();
	});

	it('never names the sex rule under "Men first" or "Women first": a child who can inherit is first', () => {
		expect(reasonOf([...FM, K, B, DORA], { inherit: 'men-first' }).res.heirs[0]).toBe('d');
		expect(reasonOf([...FM, K, J, '{id: s, name: Sigmar, sex: m, born: 1095, parents: [k]}'], { inherit: 'women-first' }).res.heirs[0]).toBe('s');
	});
});

describe('the sex rule as the cause', () => {
	it('gives no line for the son of a dead daughter under "Men only": with no sex rule he would still be first, so the rule is not the cause', () => {
		const { res, why } = reasonOf([...FM, K, B, ...VRENI], { inherit: 'men-only', inheritThrough: 'anyone' });
		expect(res.heirs[0]).toBe('w');
		expect(why).toBeNull();
	});

	it('keeps the dead-child line for the son of a dead son under "Men only"', () => {
		const volkmar = ['{id: v, name: Volkmar, sex: m, born: 1090, died: 1099, parents: [k]}', '{id: w, name: Wido, sex: m, born: 1098, parents: [v]}'];
		expect(reasonOf([...FM, K, B, DORA, ...volkmar], { inherit: 'men-only' }).why).toEqual({ kind: 'dead-child', via: 'v', ruler: 'k' });
	});

	it('names the semi-Salic rule when the brother comes before the son of a dead daughter', () => {
		const { res, why } = reasonOf([...FM, K, B, ...VRENI], { inherit: 'men-first-in-house' });
		expect(res.heirs[0]).toBe('b');
		expect(why).toEqual({ kind: 'inherit', heir: 'b', inherit: 'men-first-in-house' });
	});

	it('keeps the dead-child line under the semi-Salic rule when no man of the male line is in the line', () => {
		expect(reasonOf([...FM, K, ...VRENI], { inherit: 'men-first-in-house' }).why).toEqual({ kind: 'dead-child', via: 'v', ruler: 'k' });
	});

	it('names "Men only" with "Nearest relative first" for a living daughter, because a child is nearest', () => {
		expect(reasonOf([...FM, K, B, DORA], { inherit: 'men-only', rule: 'nearest-relative' }).why).toEqual({ kind: 'inherit', heir: 'b', inherit: 'men-only' });
	});

	it('gives no line with "Oldest generation first", where the brother comes first anyway', () => {
		expect(reasonOf([...FM, K, B, DORA], { inherit: 'men-only', rule: 'siblings-first' }).why).toBeNull();
	});
});

describe('the order rule as the cause', () => {
	it('names "Oldest generation first" and not "no child" when the ruler has no child', () => {
		expect(reasonOf([...FM, K, J], { rule: 'siblings-first' }).why).toEqual({ kind: 'rule', heir: 'j', rule: 'siblings-first' });
	});

	it('names "Oldest generation first" when a living son comes after the brother', () => {
		expect(reasonOf([...FM, K, B, '{id: s, name: Sigmar, sex: m, born: 1095, parents: [k]}'], { rule: 'siblings-first' }).why).toEqual({ kind: 'rule', heir: 'b', rule: 'siblings-first' });
	});

	it('names "Nearest relative first" when a sister is nearer than a great-grandson', () => {
		const line = ['{id: v, name: Volkmar, sex: m, born: 1088, died: 1099, parents: [k]}', '{id: w, name: Wido, sex: m, born: 1105, died: 1115, parents: [v]}', '{id: z, name: Zeno, sex: m, born: 1114, parents: [w]}'];
		const { res, why } = reasonOf([...FM, K, J, ...line], { rule: 'nearest-relative', year: '1120' });
		expect(res.heirs).toEqual(['j', 'z']);
		expect(why).toEqual({ kind: 'rule', heir: 'j', rule: 'nearest-relative' });
	});
});

describe('a rumoured word and the cases with no sure cause', () => {
	it('falls back to the rule when the sure word is only "maybe" and the other word is rumoured', () => {
		// Rainald has the birth parents of Konrad and a rumoured father Xaver: "brother" has a maybe, "rumoured half-brother" is not a fact.
		const people = [...FM, '{id: x, name: Xaver, sex: m, born: 1040}', K, '{id: r, name: Rainald, sex: m, born: 1073, parents: [f, m, {id: x, type: rumoured}]}'];
		expect(reasonOf(people).why).toEqual({ kind: 'rule', heir: 'r', rule: 'eldest-child' });
	});

	it('gives no line when the ruler passes no claim on', () => {
		const people = [...FM, '{id: k, name: Kunigunde, sex: f, born: 1070, parents: [f, m]}', B, '{id: s, name: Sigmar, sex: m, born: 1095, parents: [k]}'];
		expect(reasonOf(people, { inheritThrough: 'men' }).why).toBeNull();
	});

	it('gives no line when a child of the ruler rules too', () => {
		const { res, why } = reasonOf([...FM, K, B, '{id: s, name: Sigmar, sex: m, born: 1080, parents: [k]}'], {}, ['{person: s, from: 1100}', HOLDER]);
		expect(res.coRulers).toEqual(['s']);
		expect(why).toBeNull();
	});

	it('gives no line when the first heir is also reached through a cousin marriage', () => {
		const people = [...FM, K, B, '{id: bs, name: Bodo, sex: m, born: 1090, parents: [b]}', '{id: v, name: Vreni, sex: f, born: 1091, died: 1099, parents: [k]}', '{id: w, name: Wido, sex: m, born: 1098, parents: [v, bs]}'];
		const { res, why } = reasonOf(people, { inherit: 'men-first-in-house', inheritThrough: 'anyone' });
		expect(res.heirs[0]).toBe('w');
		expect(why).toBeNull();
	});

	it('gives the same answer for any order of the people', () => {
		const cases: [string[], Partial<SuccessionSpec>][] = [
			[[...FM, K, B, DORA_ILL], { inherit: 'men-first' }],
			[[...FM, K, B, ...VRENI], { inherit: 'men-only', inheritThrough: 'anyone' }],
			[[...FM, K, B, ...VRENI], { inherit: 'men-first-in-house' }],
			[[...FM, K, B, DORA], { inherit: 'men-only', rule: 'nearest-relative' }],
		];
		for (const [people, spec] of cases) expect(reasonOf([...people].reverse(), spec).why).toEqual(reasonOf(people, spec).why);
	});
});
