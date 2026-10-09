// Contract 0.2.7 (WP2): the succession engine. Cases follow the case table in an internal study.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';

const H = (holders: string[]) => `\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n${holders.map((x) => '      - ' + x).join('\n')}\n`;
const STD = H(['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}']);

/** Runs the engine on a source. `spec` is merged over eldest-child / no-preference / no / off. */
function run(source: string, spec: Partial<SuccessionSpec> = {}, limit = 99, oldAge = 110): SuccessionResult {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	return successionLine(g, g.titles[0], { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec }, limit, oldAge);
}
const line = (source: string, spec: Partial<SuccessionSpec> = {}, limit = 99) => run(source, spec, limit).heirs;

const S01 = `people:
  - {id: f, name: F, sex: m, born: 1100, died: 1150}
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}
  - {id: u, name: U, sex: m, born: 1130, parents: [f]}
  - {id: uc, name: Uc, sex: m, born: 1155, parents: [u]}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: bs, name: Bs, sex: m, born: 1178, parents: [b]}
  - {id: s1, name: S1, sex: m, born: 1175, parents: [r]}
  - {id: d1, name: D1, sex: f, born: 1176, parents: [r]}
  - {id: s2, name: S2, sex: m, born: 1178, parents: [r]}
${STD}`;

const S05 = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: f, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: s, name: S, sex: m, born: 1175, parents: [r]}
  - {id: d, name: D, sex: f, born: 1177, parents: [r]}
${STD}`;

describe('specOf (A.1, K.4)', () => {
	const title = (keys: string) => {
		const r = parseDynasty(`people:\n  - {id: a, name: A}\n\ntitles:\n  - id: t\n    name: T\n${keys}`);
		if (!r.ok) throw new Error('parse');
		return r.tree.titles![0];
	};
	it('gives the defaults for a title without keys', () => {
		expect(specOf(title('    holders: []\n'))).toEqual({ inherit: 'no-preference', illegitimate: 'no', adopted: false });
	});
	it('reads every key and the old names', () => {
		const spec = specOf(title('    succession: primogeniture\n    inherit: semi-salic\n    inherit-through: female\n    inherit-illegitimate: true\n    inherit-adopted: true\n    year: 1210\n    heir: [x, y]\n    exclude: z\n'));
		expect(spec).toEqual({ rule: 'eldest-child', inherit: 'men-first-in-house', inheritThrough: 'women', illegitimate: 'after', adopted: true, year: '1210', heirs: ['x', 'y'], exclude: ['z'] });
	});
	it('sets bad for an unusable value of each key, the first one in the order succession, inherit, inherit-through, inherit-illegitimate', () => {
		expect(specOf(title('    succession: salic\n')).bad).toBe('succession');
		expect(specOf(title('    succession: [a]\n')).bad).toBe('succession');
		expect(specOf(title('    inherit: sons\n')).bad).toBe('inherit');
		expect(specOf(title('    inherit-through: both\n')).bad).toBe('inherit-through');
		expect(specOf(title('    inherit-illegitimate: maybe\n')).bad).toBe('inherit-illegitimate');
		expect(specOf(title('    inherit: sons\n    succession: salic\n')).bad).toBe('succession');
	});
	it('does not share the heir list with the title', () => {
		const t = title('    heir: [x, y]\n');
		specOf(t).heirs!.push('z');
		expect(t.heirs).toEqual(['x', 'y']);
	});
});

describe('result kinds (D.1, B.3, B.6)', () => {
	it('no-rule when there is no rule and no heir; bad-rule when the spec is bad', () => {
		expect(run(S01, { rule: undefined }).kind).toBe('no-rule');
		expect(run(S01, { bad: 'inherit' }).kind).toBe('bad-rule');
		expect(run(S01, { bad: 'inherit' }).heirs).toEqual([]);
	});
	it('no-ruler when the year is before the first reign, ruler-not-in-tree for a holder who is not a person', () => {
		const src = `people:
  - {id: x, name: X, sex: m, born: 1100}
  - {id: xs, name: Xs, sex: m, born: 1130, parents: [x]}

titles:
  - id: duke
    name: Duke
    holders:
      - {name: Old Duke, from: 1050, to: 1100}
      - {person: x, from: 1100}
`;
		expect(run(src, { year: '1075' }).kind).toBe('ruler-not-in-tree');
		expect(run(src, { year: '1040' }).kind).toBe('no-ruler');
		const ok = run(src, { year: '1150' });
		expect(ok).toMatchObject({ kind: 'line', ruler: 'x', heirs: ['xs'], year: 1150, yearFrom: 'field' });
	});
	it('no-ruler for a title with no holders, also with a named heir', () => {
		const src = `people:\n  - {id: a, name: A}\n\ntitles:\n  - {id: duke, name: Duke}\n`;
		expect(run(src).kind).toBe('no-ruler');
		expect(run(src, { rule: undefined, heirs: ['a'] }).kind).toBe('no-ruler');
	});
	it('a title with a named heir and no rule has a line of that heir (B.6)', () => {
		const r = run(S01, { rule: undefined, heirs: ['b', 'ghost', 'r', 'u'] });
		expect(r.kind).toBe('line');
		expect(r.heirs).toEqual(['b', 'u']);
		expect(r.namedHeirs.map((n) => `${n.id}:${n.state}`)).toEqual(['b:first', 'ghost:not-in-tree', 'r:is-ruler', 'u:first']);
		expect(run(S01, { rule: undefined, heirs: ['ghost'] }).heirs).toEqual([]);
	});
});

describe('the five gender rules and the limit (S01)', () => {
	it('lists the line for each rule', () => {
		expect(line(S01, { inherit: 'no-preference' })).toEqual(['s1', 'd1', 's2', 'b', 'bs', 'u', 'uc']);
		expect(line(S01, { inherit: 'men-only' })).toEqual(['s1', 's2', 'b', 'bs', 'u', 'uc']);
		expect(line(S01, { inherit: 'men-first' })).toEqual(['s1', 's2', 'd1', 'b', 'bs', 'u', 'uc']);
		expect(line(S01, { inherit: 'women-first' })).toEqual(['d1', 's1', 's2', 'b', 'bs', 'u', 'uc']);
		expect(line(S01, { inherit: 'women-only' })).toEqual(['d1']);
	});
	it('cuts the line at the limit and says there are more', () => {
		const r = run(S01, {}, 2);
		expect(r.heirs).toEqual(['s1', 'd1']);
		expect(r.more).toBe(true);
		expect(run(S01, {}, 7).more).toBe(false);
		expect(run(S01, {}, 0).heirs).toEqual([]);
	});
	it('reverses the age order for youngest-child', () => {
		expect(line(S01, { rule: 'youngest-child' })).toEqual(['s2', 'd1', 's1', 'b', 'bs', 'u', 'uc']);
	});
	it('never has the ruler or an ancestor in the line', () => {
		const l = line(S01, { inherit: 'no-preference' });
		expect(l).not.toContain('r');
		expect(l).not.toContain('a1');
		expect(l).not.toContain('f');
	});
});

describe('who passes a claim on (C.3, K.1)', () => {
	it('a woman ruler under men-only passes the title to her sons (S05); the key absent', () => {
		expect(line(S05, { inherit: 'men-only' })).toEqual(['s', 'b']);
	});
	it('inherit-through written tests the ruler too (S05)', () => {
		expect(line(S05, { inherit: 'men-only', inheritThrough: 'men' })).toEqual(['b']);
		expect(line(S05, { inherit: 'men-only', inheritThrough: 'women' })).toEqual(['s']);
		expect(line(S05, { inherit: 'men-only', inheritThrough: 'anyone' })).toEqual(['s', 'b']);
	});
	it('the avunculate: a sister\'s son before the ruler\'s own children (S49b)', () => {
		const AV = `people:
  - {id: gm, name: Gm, sex: f, born: 1100, died: 1160}
  - {id: r, name: R, sex: m, born: 1130, parents: [gm]}
  - {id: sis, name: Sis, sex: f, born: 1132, parents: [gm]}
  - {id: bro, name: Bro, sex: m, born: 1135, parents: [gm]}
  - {id: rs1, name: Rs1, sex: m, born: 1155, parents: [r]}
  - {id: sn1, name: Sn1, sex: m, born: 1156, parents: [sis]}
  - {id: sd1, name: Sd1, sex: f, born: 1158, parents: [sis]}
  - {id: sds, name: Sds, sex: m, born: 1180, parents: [sd1]}
  - {id: bs, name: Bs, sex: m, born: 1160, parents: [bro]}
${H(['{person: gm, from: 1130, to: 1170}', '{person: r, from: 1170}'])}`;
		expect(line(AV, { inherit: 'men-only' })).toEqual(['rs1', 'bro', 'bs']);
		expect(line(AV, { inherit: 'men-only', inheritThrough: 'women' })).toEqual(['sn1', 'sds', 'bro']);
		expect(line(AV, { inherit: 'men-only', inheritThrough: 'anyone' })).toEqual(['rs1', 'sn1', 'sds', 'bro', 'bs']);
		expect(line(AV, { inherit: 'men-only', inheritThrough: 'men' })).toEqual(['rs1']);
	});
	it('a house form keeps the written key in both passes (S49h)', () => {
		const src = `people:
  - {id: gm, name: Gm, sex: f, born: 1100, died: 1160}
  - {id: r, name: R, sex: m, born: 1130, parents: [gm]}
  - {id: sis, name: Sis, sex: f, born: 1132, parents: [gm]}
  - {id: bro, name: Bro, sex: m, born: 1135, parents: [gm]}
  - {id: sn1, name: Sn1, sex: m, born: 1156, parents: [sis]}
  - {id: sd1, name: Sd1, sex: f, born: 1158, parents: [sis]}
  - {id: sds, name: Sds, sex: m, born: 1180, parents: [sd1]}
${H(['{person: gm, from: 1130, to: 1170}', '{person: r, from: 1170}'])}`;
		expect(line(src, { inherit: 'men-first-in-house', inheritThrough: 'women' })).toEqual(['sn1', 'sds', 'bro', 'sis', 'sd1']);
	});
});

describe('the semi-Salic forms and the order rules (C.8, C.8a)', () => {
	const S15 = `people:
  - {id: f, name: F, sex: m, born: 1100, died: 1150}
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}
  - {id: u, name: U, sex: m, born: 1130, parents: [f]}
  - {id: uc, name: Uc, sex: m, born: 1155, parents: [u]}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: bs, name: Bs, sex: m, born: 1178, parents: [b]}
  - {id: d1, name: D1, sex: f, born: 1172, parents: [r]}
  - {id: d2, name: D2, sex: f, born: 1175, parents: [r]}
  - {id: ds, name: Ds, sex: m, born: 1195, parents: [d1]}
${STD}`;
	it('men first in the whole house: the brother before the daughters (S15)', () => {
		expect(line(S15, { inherit: 'men-first-in-house' })).toEqual(['b', 'bs', 'u', 'uc', 'd1', 'ds', 'd2']);
		expect(line(S15, { inherit: 'men-first' })).toEqual(['d1', 'ds', 'd2', 'b', 'bs', 'u', 'uc']);
		expect(line(S15, { inherit: 'women-first-in-house' })).toEqual(['d1', 'd2', 'ds', 'b', 'bs', 'u', 'uc']);
	});
	const S43 = `people:
  - {id: f, name: F, sex: m, born: 1100, died: 1150}
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}
  - {id: u, name: U, sex: m, born: 1130, parents: [f]}
  - {id: ud, name: Ud, sex: f, born: 1157, parents: [u]}
  - {id: uc, name: Uc, sex: m, born: 1160, parents: [u]}
  - {id: sis, name: Sis, sex: f, born: 1148, parents: [a1]}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: d1, name: D1, sex: f, born: 1172, parents: [r]}
  - {id: s1, name: S1, sex: m, born: 1175, parents: [r]}
${STD}`;
	it('siblings before children: every man of the house before every woman (S43)', () => {
		expect(line(S43, { rule: 'siblings-first', inherit: 'men-first-in-house' })).toEqual(['u', 'b', 'uc', 's1', 'sis', 'ud', 'd1']);
		expect(line(S43, { rule: 'siblings-first', inherit: 'men-first' })).toEqual(['u', 'b', 'uc', 'sis', 'ud', 's1', 'd1']);
		expect(line(S43, { rule: 'siblings-first', inherit: 'women-first-in-house' })).toEqual(['sis', 'd1', 'u', 'ud', 'b', 'uc', 's1']);
	});
	const S08 = `people:
  - {id: f, name: F, sex: m, born: 1100, died: 1150}
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180, parents: [f]}
  - {id: u, name: U, sex: m, born: 1130, parents: [f]}
  - {id: uu, name: Uu, sex: m, born: 1135, parents: [f]}
  - {id: uc, name: Uc, sex: m, born: 1155, parents: [u]}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: bs, name: Bs, sex: m, born: 1178, parents: [b]}
  - {id: s1, name: S1, sex: m, born: 1175, parents: [r]}
  - {id: s2, name: S2, sex: m, born: 1178, parents: [r]}
${STD}`;
	it('siblings-first puts a living uncle before the brother, nearest-relative the children first (S08)', () => {
		expect(line(S08, { rule: 'siblings-first' })).toEqual(['u', 'uu', 'b', 'uc', 's1', 's2', 'bs']);
		expect(line(S08, { rule: 'nearest-relative' })).toEqual(['s1', 's2', 'b', 'bs', 'u', 'uu', 'uc']);
	});
	const S45 = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1155, parents: [a1]}
  - {id: bd, name: Bd, sex: f, born: 1178, parents: [b]}
  - {id: s0, name: S0, sex: m, born: 1170, parents: [r]}
  - {id: d0, name: D0, sex: f, born: 1172, parents: [r]}
  - {id: s1, name: S1, sex: m, born: 1182, parents: [r]}
  - {id: d1, name: D1, sex: f, born: 1184, parents: [r]}
${STD}`;
	it('born-in-reign puts the children born during the reign first (S45)', () => {
		expect(line(S45, { rule: 'born-in-reign', inherit: 'men-first-in-house' })).toEqual(['s1', 's0', 'b', 'd1', 'd0', 'bd']);
		expect(line(S45, { rule: 'born-in-reign', inherit: 'men-first' })).toEqual(['s1', 's0', 'd1', 'd0', 'b', 'bd']);
		expect(line(S45, { rule: 'eldest-child', inherit: 'no-preference' })).toEqual(['s0', 'd0', 's1', 'd1', 'b', 'bd']);
	});
});

describe('children born outside a marriage (C.2, C.4a, S46, S57)', () => {
	const S46 = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1155, parents: [a1]}
  - {id: bd, name: Bd, sex: f, born: 1178, parents: [b]}
  - {id: d, name: D, sex: f, born: 1172, parents: [r]}
  - {id: bs, name: Bs, sex: m, born: 1175, parents: [r], illegitimate: true}
${STD}`;
	it('no: the flagged child is out; after: last of all; equal: by age', () => {
		expect(line(S46, { inherit: 'men-first-in-house', illegitimate: 'no' })).toEqual(['b', 'd', 'bd']);
		expect(line(S46, { inherit: 'men-first-in-house', illegitimate: 'after' })).toEqual(['b', 'd', 'bd', 'bs']);
		expect(line(S46, { inherit: 'men-first-in-house', illegitimate: 'equal' })).toEqual(['bs', 'b', 'd', 'bd']);
		expect(line(S46, { inherit: 'women-first-in-house', illegitimate: 'after' })).toEqual(['d', 'b', 'bd', 'bs']);
		expect(line(S46, { inherit: 'men-first', illegitimate: 'after' })).toEqual(['d', 'b', 'bd', 'bs']);
	});
	it('an adoptive link carries a claim only with the switch, and the flag does not bar it (S19, S21)', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: ad, name: Ad, sex: m, born: 1170, parents: [{id: r, type: adoptive}], illegitimate: true}
  - {id: w, name: W, sex: m, born: 1171, parents: [{id: r, type: ward}]}
  - {id: ru, name: Ru, sex: m, born: 1172, parents: [{id: r, type: rumoured}]}
${STD}`;
		expect(line(src, {})).toEqual([]);
		expect(line(src, { adopted: true })).toEqual(['ad']);
	});
});

describe('both parents in the search for relatives (K.2)', () => {
	const S52 = `people:
  - {id: f, name: F, sex: m, born: 1100, died: 1150}
  - {id: m, name: M, sex: f, born: 1105}
  - {id: w2, name: W2, sex: f, born: 1106}
  - {id: h0, name: H0, sex: m, born: 1101}
  - {id: hp, name: Hp, sex: m, born: 1125, parents: [f, w2]}
  - {id: hpd, name: Hpd, sex: f, born: 1127, parents: [f, w2]}
  - {id: hm, name: Hm, sex: m, born: 1126, parents: [h0, m]}
  - {id: hmd, name: Hmd, sex: f, born: 1128, parents: [h0, m]}
  - {id: r, name: R, sex: m, born: 1130, parents: [f, m]}
  - {id: s1, name: S1, sex: m, born: 1155, parents: [r]}
${H(['{person: r, from: 1150}'])}`;
	it('half-brothers through the father and the mother (S52)', () => {
		expect(line(S52, {})).toEqual(['s1', 'hp', 'hpd', 'hm', 'hmd']);
		expect(line(S52, { inherit: 'women-first' })).toEqual(['s1', 'hmd', 'hm', 'hpd', 'hp']);
		expect(line(S52, { inherit: 'men-only' })).toEqual(['s1', 'hp']);
		expect(line(S52, { inherit: 'women-only' })).toEqual(['hmd']);
		expect(line(S52, { rule: 'siblings-first' })).toEqual(['hp', 'hpd', 'hm', 'hmd', 's1']);
		expect(line(S52, { inherit: 'women-first-in-house' })).toEqual(['hmd', 's1', 'hm', 'hpd', 'hp']);
	});
	it('with no preference the order of the parents decides (S52j)', () => {
		expect(line(S52.replace('parents: [f, m]', 'parents: [m, f]'), {})).toEqual(['s1', 'hm', 'hmd', 'hp', 'hpd']);
	});
	it('the flag applies to the half-brother, so after puts him last (S57)', () => {
		const src = S52.replace('parents: [f, w2]}\n  - {id: hpd', 'parents: [f, w2], illegitimate: true}\n  - {id: hpd');
		expect(line(src, { illegitimate: 'no' })).toEqual(['s1', 'hpd', 'hm', 'hmd']);
		expect(line(src, { illegitimate: 'after' })).toEqual(['s1', 'hpd', 'hm', 'hmd', 'hp']);
		expect(line(src, { illegitimate: 'equal' })).toEqual(['s1', 'hp', 'hpd', 'hm', 'hmd']);
	});
	it('the level counts from R (S53): chains of different length', () => {
		const src = `people:
  - {id: ffa, name: Ffa, sex: m, born: 1020, died: 1080}
  - {id: gu, name: Gu, sex: m, born: 1055, parents: [ffa]}
  - {id: ff, name: Ff, sex: m, born: 1050, died: 1110, parents: [ffa]}
  - {id: u, name: U, sex: m, born: 1080, parents: [ff]}
  - {id: f, name: F, sex: m, born: 1078, died: 1140, parents: [ff]}
  - {id: m, name: M, sex: f, born: 1085}
  - {id: h0, name: H0, sex: m, born: 1086}
  - {id: hm, name: Hm, sex: m, born: 1110, parents: [h0, m]}
  - {id: r, name: R, sex: m, born: 1115, parents: [f, m]}
  - {id: s1, name: S1, sex: m, born: 1140, parents: [r]}
${H(['{person: r, from: 1140}'])}`;
		expect(line(src, { rule: 'siblings-first' })).toEqual(['gu', 'u', 'hm', 's1']);
		expect(line(src, { rule: 'nearest-relative' })).toEqual(['s1', 'hm', 'u', 'gu']);
	});
	it('ancestors are never heirs, also when they are cousins of the parents (S54, S55)', () => {
		const S55 = `people:
  - {id: ff, name: Ff, sex: m, born: 1050, died: 1100}
  - {id: b, name: B, sex: m, born: 1078, died: 1120, parents: [ff]}
  - {id: f, name: F, sex: m, born: 1075, died: 1150, parents: [ff]}
  - {id: m, name: M, sex: f, born: 1100, parents: [b]}
  - {id: r, name: R, sex: m, born: 1125, parents: [f, m]}
  - {id: s1, name: S1, sex: m, born: 1150, parents: [r]}
${H(['{person: f, from: 1100, to: 1150}', '{person: r, from: 1150}'])}`;
		expect(line(S55, {})).toEqual(['s1']);
	});
});

describe('the year and the ruler (B.2, B.3, B.4)', () => {
	const TREE = `people:
  - {id: pa, name: Pa, sex: m, born: 1060, died: 1110}
  - {id: pb, name: Pb, sex: m, born: 1085, died: 1130, parents: [pa]}
  - {id: pc, name: Pc, sex: m, born: 1110, parents: [pb]}
  - {id: pd, name: Pd, sex: m, born: 1112, parents: [pb]}

titles:
  - id: duke
    name: Duke
    holders:
      - {person: pa, to: 1110}
      - {person: pb, from: 1110, to: 1130}
      - {person: pc}
`;
	it('uses the end of the last reign when there is no year, and now when that has no end', () => {
		const withEnd = `${TREE.replace('{person: pc}', '{person: pc, from: 1130, to: 1160}')}`;
		expect(run(withEnd)).toMatchObject({ year: 1160, yearFrom: 'reign-end', ruler: 'pc' });
		expect(run(TREE)).toMatchObject({ year: null, yearFrom: 'now', ruler: 'pc' });
		expect(run(TREE, { year: 'c. 1120' })).toMatchObject({ year: 1120, yearFrom: 'field', ruler: 'pb' });
	});
	it('an entry with no dates has not started while an earlier entry runs past Y (S24)', () => {
		expect(run(TREE, { year: '1120' }).ruler).toBe('pb');
		expect(line(TREE, { year: '1120' })).toEqual(['pc', 'pd']);
	});
	it('a year after the last reign keeps the last holder; an earlier year gives an earlier ruler', () => {
		const src = `people:
  - {id: a, name: A, sex: m, born: 1100}
  - {id: b, name: B, sex: m, born: 1130, parents: [a]}
  - {id: c, name: C, sex: m, born: 1160, parents: [b]}

titles:
  - id: duke
    name: Duke
    holders:
      - {person: a, from: 1150, to: 1180}
      - {person: b, from: 1180, to: 1200}
`;
		expect(run(src, { year: '1300' }).ruler).toBe('b');
		expect(run(src, { year: '1160' }).ruler).toBe('a');
		expect(line(src, { year: '1160' })).toEqual(['b', 'c']);
	});
	it('a death text with no year is dead; the alive words are alive; died in year Y is dead; not yet born is not alive (S28, J.7)', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: e, name: E, sex: m, born: 1170, died: in infancy, parents: [r]}
  - {id: y, name: Y, sex: m, born: 1172, died: alive, parents: [r]}
  - {id: y2, name: Y2, sex: m, born: 1174, died: 1210, parents: [r]}
  - {id: y3, name: Y3, sex: m, born: 1176, died: 1211, parents: [r]}
  - {id: y4, name: Y4, sex: m, born: 1215, parents: [r]}
${H(['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180, to: 1210}'])}`;
		// Y = the end of the last reign, 1210: y2 died in 1210 and is dead, y3 lives, y4 is not born.
		expect(line(src, {})).toEqual(['y', 'y3']);
		expect(line(src, { year: '1190' })).toEqual(['y', 'y2', 'y3']);
	});
	it('with Y = now, any written died text means dead', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: e, name: E, sex: m, born: 1170, died: killed, parents: [r]}
  - {id: y, name: Y, sex: m, born: 1172, died: never, parents: [r]}
  - {id: z, name: Z, sex: m, born: 1174, parents: [r]}
${H(['{person: a1, from: 1150, to: 1180}', '{person: r, from: 1180}'])}`;
		expect(line(src, {})).toEqual(['y', 'z']);
	});
});

describe('named heirs and exclusion (K.3, S58)', () => {
	const S58 = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: b, name: B, sex: m, born: 1152, parents: [a1]}
  - {id: dd, name: Dd, sex: m, born: 1160, died: 1185, parents: [a1]}
  - {id: e, name: E, sex: m, born: 1170, parents: [r]}
  - {id: f2, name: F2, sex: f, born: 1172, parents: [r]}
  - {id: s3, name: S3, sex: m, born: 1175, parents: [r]}
  - {id: es, name: Es, sex: m, born: 1195, parents: [e]}
  - {id: ed, name: Ed, sex: f, born: 1196, parents: [e]}
${STD}`;
	const states = (r: SuccessionResult) => r.namedHeirs.map((n) => `${n.id}:${n.state}`);
	it('lists the line with no heir and no exclusion', () => {
		expect(line(S58, {})).toEqual(['e', 'es', 'ed', 'f2', 's3', 'b']);
	});
	it('exclusion is personal: the descendants keep their claim', () => {
		expect(line(S58, { exclude: ['e'] })).toEqual(['es', 'ed', 'f2', 's3', 'b']);
		expect(line(S58, { exclude: ['e', 'es', 'ed'] })).toEqual(['f2', 's3', 'b']);
		expect(line(S58, { exclude: ['e'], rule: 'nearest-relative' })).toEqual(['f2', 's3', 'es', 'ed', 'b']);
		expect(line(S58, { exclude: ['e'], inherit: 'men-only' })).toEqual(['es', 's3', 'b']);
	});
	it('named heirs come first in order; the states are checked in the order of K.3', () => {
		const r = run(S58, { heirs: ['b', 'ghost', 'dd', 'r', 's3', 'b'] });
		expect(r.heirs).toEqual(['b', 's3', 'e', 'es', 'ed', 'f2']);
		expect(states(r)).toEqual(['b:first', 'ghost:not-in-tree', 'dd:not-alive', 'r:is-ruler', 's3:first']);
		const x = run(S58, { heirs: ['s3', 'e'], exclude: ['e'] });
		expect(x.heirs).toEqual(['s3', 'es', 'ed', 'f2', 'b']);
		expect(states(x)).toEqual(['s3:first', 'e:excluded']);
	});
	it('the filters of the rule do not apply to a named heir (S58j)', () => {
		expect(line(S58, { heirs: ['f2'], exclude: [], inherit: 'men-only' })).toEqual(['f2', 'e', 'es', 's3', 'b']);
	});
	it('only a named heir who is first uses a place of the limit', () => {
		const r = run(S58, { heirs: ['s3', 'ghost', 'b'] }, 2);
		expect(r.heirs).toEqual(['s3', 'b']);
		expect(r.more).toBe(true);
		const one = run(S58, { heirs: ['e'] }, 1);
		expect(one.heirs).toEqual(['e']);
		expect(one.more).toBe(true);
	});
});

describe('the facts beside the line (J.2, J.4, J.6, J.8, J.9, K.6, K.8, K.9)', () => {
	it('reports the holders who rule at the same time (William and Mary), not a handover', () => {
		const src = `people:
  - {id: w, name: W, sex: m, born: 1650}
  - {id: m, name: M, sex: f, born: 1662}
  - {id: x, name: X, sex: m, born: 1600, died: 1688}
  - {id: s, name: S, sex: m, born: 1690, parents: [m]}

titles:
  - id: crown
    name: Crown
    holders:
      - {person: x, from: 1660, to: 1688}
      - {person: w, from: 1689}
      - {person: m, from: 1689}
`;
		const r = run(src, { year: '1695' });
		expect(r.ruler).toBe('m');
		expect(r.coRulers).toEqual(['w']);
		expect(run(src, { year: '1670' }).coRulers).toEqual([]);
		expect(run(src, { year: '1670' }).ruler).toBe('x');
		const handover = src.replace('{person: m, from: 1689}', '{person: m, from: 1700}');
		expect(run(handover, { year: '1710' }).coRulers).toEqual([]);
	});
	it('an entry with no from year is never a co-ruler', () => {
		const src = `people:
  - {id: a, name: A, sex: m, born: 1100}
  - {id: b, name: B, sex: m, born: 1105}

titles:
  - id: t
    name: T
    holders:
      - {person: a}
      - {person: b, from: 1150}
`;
		expect(run(src, { year: '1160' }).coRulers).toEqual([]);
	});
	it('names the holder entries and the heirs whose date has no year', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: c1, name: C1, sex: m, born: spring, parents: [r]}

titles:
  - id: t
    name: T
    holders:
      - {person: a1, from: long ago, to: 1180}
      - {person: r, from: 1180, to: 1210}
`;
		const r = run(src, {});
		expect(r.noYear).toEqual([{ id: 'a1', what: 'reign', entry: 0 }, { id: 'c1', what: 'born' }]);
		expect(run(src, { rule: 'eldest-child' }, 99).heirs).toEqual(['c1']);
	});
	it('counts the heirs with no birth year for born-in-reign only', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: c1, name: C1, sex: m, parents: [r]}
  - {id: c2, name: C2, sex: m, born: 1182, parents: [r]}
${STD}`;
		expect(run(src, { rule: 'born-in-reign' }).noBirthYear).toBe(1);
		expect(run(src, { rule: 'eldest-child' }).noBirthYear).toBe(0);
	});
	it('warns about an heir who is older than the limit and has no death date; oldAge 0 gives no warning', () => {
		const src = `people:
  - {id: f, name: F, sex: m, born: 1050, died: 1120}
  - {id: a1, name: A1, sex: m, born: 1100, died: 1160, parents: [f]}
  - {id: u, name: U, sex: m, born: 1075, parents: [f]}
  - {id: uc, name: Uc, sex: m, born: 1105, parents: [u]}
  - {id: r, name: R, sex: m, born: 1130, parents: [a1]}
  - {id: s, name: S, sex: m, born: 1190, parents: [r]}
${H(['{person: a1, from: 1130, to: 1160}', '{person: r, from: 1160}'])}`;
		const r = run(src, {});
		expect(r.heirs).toEqual(['s', 'u', 'uc']);
		// Y is now: the reference year is the latest year in the tree, 1190; u is 115 years old.
		expect(r.old).toEqual(['u']);
		expect(run(src, {}, 99, 0).old).toEqual([]);
		expect(run(src, {}, 99, 200).old).toEqual([]);
		expect(run(src, { year: '1170' }).old).toEqual([]);
	});
	it('counts people that a one-sex rule left out only because they have no sex', () => {
		const src = `people:
  - {id: a1, name: A1, sex: m, born: 1125, died: 1180}
  - {id: r, name: R, sex: m, born: 1150, parents: [a1]}
  - {id: x, name: X, born: 1170, parents: [r]}
  - {id: y, name: Y, sex: Male, born: 1172, parents: [r]}
  - {id: z, name: Z, sex: m, born: 1174, parents: [r]}
${STD}`;
		const r = run(src, { inherit: 'men-only' });
		expect(r.heirs).toEqual(['z']);
		expect(r.leftOutNoSex).toBe(2);
		expect(run(src, { inherit: 'no-preference' }).leftOutNoSex).toBe(0);
		const noSexRuler = src.replace('{id: r, name: R, sex: m,', '{id: r, name: R,');
		expect(run(noSexRuler, { inherit: 'no-preference', inheritThrough: 'men' }).leftOutNoSex).toBeGreaterThan(0);
	});
});

describe('safety', () => {
	it('does not change the title, the spec or the graph', () => {
		const parsed = parseDynasty(S01);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		const spec: SuccessionSpec = { rule: 'siblings-first', inherit: 'men-first-in-house', illegitimate: 'after', adopted: true, heirs: ['b'], exclude: ['u'] };
		const before = JSON.stringify([g.titles, spec, g.people, g.secondary]);
		successionLine(g, g.titles[0], spec, 5, 110);
		expect(JSON.stringify([g.titles, spec, g.people, g.secondary])).toBe(before);
	});
	it('gives the same result when called twice', () => {
		expect(run(S01, { rule: 'nearest-relative', inherit: 'men-first-in-house', illegitimate: 'after' })).toEqual(run(S01, { rule: 'nearest-relative', inherit: 'men-first-in-house', illegitimate: 'after' }));
	});
	it('ends on a cycle of claim links (the graph is cycle-broken) and on a very deep house', () => {
		const people = ['  - {id: p0, name: P0, sex: m, born: 1000}'];
		const n = 3000;
		for (let i = 1; i <= n; i++) people.push(`  - {id: p${i}, name: P${i}, sex: m, born: ${1000 + i}, parents: [p${i - 1}]}`);
		const src = `people:\n${people.join('\n')}\n${H(['{person: p0, from: 1000, to: 1001}', '{person: p1, from: 1001}'])}`;
		const r = run(src, { rule: 'eldest-child' }, 5);
		expect(r.heirs).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);
		expect(r.more).toBe(true);
		const cyc = `people:\n  - {id: a, name: A, sex: m, born: 1000, parents: [b]}\n  - {id: b, name: B, sex: m, born: 1001, parents: [a]}\n  - {id: c, name: C, sex: m, born: 1020, parents: [a]}\n${H(['{person: a, from: 1000}'])}`;
		expect(() => run(cyc, {})).not.toThrow();
	});
	it('a graph with no titles or an unknown title does not throw in the caller\'s hands', () => {
		const parsed = parseDynasty('people:\n  - {id: a, name: A}\n');
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		const stub = { id: 'x', name: 'X', plural: 'X', holders: [], index: 0, items: 0 };
		expect(successionLine(g, stub, { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false }, 5, 110).kind).toBe('no-ruler');
	});
});
