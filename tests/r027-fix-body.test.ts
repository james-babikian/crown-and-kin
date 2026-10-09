// Contract 0.2.7 section L (D189): the switch `heirs-of-body`. Reading, writing, the engine (cases L01 to L11 of
// An internal study) and the result fields `firstHolder` and `outsideBody`.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';
import { applyOp } from '../src/core/yaml-edit';

const holdersBlock = (h: string[]) => `\ntitles:\n  - id: duke\n    name: Duke\n    holders:\n${h.map((x) => '      - ' + x).join('\n')}\n`;
const KING = `  - {id: k, name: K, sex: m, born: 1100, died: 1160}
  - {id: kb, name: Kb, sex: m, born: 1105, died: 1165}
  - {id: e, name: E, sex: m, born: 1125, died: 1185, parents: [k]}
  - {id: e1, name: E1, sex: m, born: 1150, parents: [e]}
  - {id: y, name: Y, sex: m, born: 1130, died: 1190, parents: [k]}
`;
const cadet = (extra: string, holders: string[]) => `people:\n${KING}${extra}${holdersBlock(holders)}`;
const CH = ['{person: y, from: 1155, to: 1190}', '{person: c1, from: 1190}'];
const CKIDS = `  - {id: c1, name: C1, sex: m, born: 1155, parents: [y]}
  - {id: c2, name: C2, sex: m, born: 1158, parents: [y]}
  - {id: c3, name: C3, sex: m, born: 1160, parents: [y]}
  - {id: k1, name: K1, sex: m, born: 1185, parents: [c1]}
`;
const Q = `  - {id: q, name: Q, sex: f, born: 1128, died: 1190, parents: [k]}
  - {id: qs, name: Qs, sex: m, born: 1150, parents: [q]}
  - {id: qs2, name: Qs2, sex: m, born: 1152, parents: [q]}
  - {id: qd, name: Qd, sex: f, born: 1153, parents: [q]}
  - {id: qds, name: Qds, sex: m, born: 1175, parents: [qd]}
  - {id: qk, name: Qk, sex: m, born: 1180, parents: [qs]}
`;
const QH = ['{person: q, from: 1155, to: 1190}', '{person: qs, from: 1190}'];
const AD = `  - {id: c1, name: C1, sex: m, born: 1155, parents: [y]}
  - {id: c2, name: C2, sex: m, born: 1158, parents: [y]}
  - {id: a, name: A, sex: m, born: 1156, parents: [{id: y, type: adoptive}]}
  - {id: as, name: As, sex: m, born: 1185, parents: [a]}
`;
const AH = ['{person: y, from: 1155, to: 1190}', '{person: a, from: 1190}'];
const HH = `  - {id: c1, name: C1, sex: m, born: 1155, parents: [y]}
  - {id: c2, name: C2, sex: m, born: 1158, parents: [y]}
  - {id: cs, name: Cs, sex: f, born: 1157, parents: [y]}
  - {id: kd, name: Kd, sex: f, born: 1184, parents: [c1]}
  - {id: ks, name: Ks, sex: m, born: 1186, parents: [c1]}
  - {id: cb, name: Cb, sex: m, born: 1162, illegitimate: true, parents: [y]}
`;

function line(source: string, spec: Partial<SuccessionSpec>): SuccessionResult {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	return successionLine(g, g.titles[0], { rule: 'eldest-child', inherit: 'no-preference', illegitimate: 'no', adopted: false, ...spec }, 99, 0);
}

interface Case {
	id: string;
	src: string;
	spec: Partial<SuccessionSpec>;
	off: string[];
	on: string[];
	outside?: boolean;
}
const ids = (s: string) => (s === '' ? [] : s.split(', '));
const cases: Case[] = [
	{ id: 'L01a', src: cadet(CKIDS, CH), spec: {}, off: ids('k1, c2, c3, e1'), on: ids('k1, c2, c3') },
	{ id: 'L01b', src: cadet('  - {id: c1, name: C1, sex: m, born: 1155, parents: [y]}\n  - {id: c2, name: C2, sex: m, born: 1158, died: 1180, parents: [y]}\n', CH), spec: {}, off: ['e1'], on: [] },
	{
		id: 'L02',
		src: cadet(`  - {id: z, name: Z, sex: m, born: 1135, parents: [kb]}\n  - {id: zs, name: Zs, sex: m, born: 1160, parents: [z]}\n  - {id: zb, name: Zb, sex: m, born: 1140, parents: [kb]}\n`, ['{person: y, from: 1155, to: 1170}', '{person: z, from: 1170}']),
		spec: {},
		off: ids('zs, zb'),
		on: [],
		outside: true,
	},
	{ id: 'L03', src: cadet('  - {id: c1, name: C1, sex: m, born: 1155, parents: [y]}\n  - {id: c2, name: C2, sex: f, born: 1158, parents: [y]}\n', ['{person: y, from: 1155}']), spec: {}, off: ids('c1, c2, e1'), on: ids('c1, c2') },
	{ id: 'L04a', src: cadet(Q, QH), spec: { inherit: 'men-only' }, off: ids('qk, qs2, e1'), on: ids('qk, qs2') },
	{ id: 'L04b', src: cadet(Q, QH), spec: { inherit: 'men-only', inheritThrough: 'men' }, off: ['qk'], on: [], outside: true },
	{ id: 'L04c', src: cadet(Q, QH), spec: { inherit: 'no-preference' }, off: ids('qk, qs2, qd, qds, e1'), on: ids('qk, qs2, qd, qds') },
	{ id: 'L05a', src: cadet(CKIDS, CH), spec: { rule: 'siblings-first' }, off: ids('c2, c3, e1, k1'), on: ids('c2, c3, k1') },
	{ id: 'L05c', src: cadet(CKIDS, CH).replace('died: 1185, ', ''), spec: { rule: 'siblings-first' }, off: ids('e, c2, c3, e1, k1'), on: ids('c2, c3, k1') },
	{ id: 'L05b', src: cadet(CKIDS, CH), spec: { rule: 'nearest-relative' }, off: ids('k1, c2, c3, e1'), on: ids('k1, c2, c3') },
	{ id: 'L06a', src: cadet(AD, AH), spec: {}, off: ids('as, c1, c2, e1'), on: [], outside: true },
	{ id: 'L06b', src: cadet(AD, AH), spec: { adopted: true }, off: ids('as, c1, c2, e1'), on: ids('as, c1, c2') },
	{ id: 'L07', src: cadet(CKIDS, CH), spec: { heirs: ['e1'] }, off: ids('e1, k1, c2, c3'), on: ids('e1, k1, c2, c3') },
	{ id: 'L08', src: cadet(HH, CH), spec: { inherit: 'men-first-in-house' }, off: ids('ks, c2, e1, kd, cs'), on: ids('ks, c2, kd, cs') },
	{ id: 'L09', src: cadet(HH, CH), spec: { illegitimate: 'after' }, off: ids('kd, ks, c2, cs, e1, cb'), on: ids('kd, ks, c2, cs, cb') },
	{ id: 'L10', src: cadet(CKIDS, ['{name: Legend, from: 1100}', ...CH]), spec: {}, off: ids('k1, c2, c3, e1'), on: ids('k1, c2, c3') },
	{
		id: 'L11',
		src: cadet(`  - {id: ew, name: Ew, sex: f, born: 1135, parents: [e]}\n  - {id: c1, name: C1, sex: m, born: 1155, parents: [y, ew]}\n  - {id: c2, name: C2, sex: m, born: 1158, parents: [y]}\n`, CH),
		spec: {},
		off: ids('c2, e1'),
		on: ['c2'],
	},
];

describe('heirs-of-body: the cases L01 to L11 (L.2 to L.5)', () => {
	for (const c of cases) {
		it(`${c.id}: switch off gives the old line, switch on gives the body only`, () => {
			const off = line(c.src, c.spec);
			const on = line(c.src, { ...c.spec, body: true });
			expect(off.heirs).toEqual(c.off);
			expect(on.heirs).toEqual(c.on);
			expect(on.outsideBody).toBe(c.outside === true);
			expect(on.firstHolder).toBe(c.id.startsWith('L04') ? 'q' : 'y');
			expect(off.outsideBody).toBe(false);
			expect(off.firstHolder).toBeUndefined();
		});
	}

	it('with the switch on, the line is a subset of the line with the switch off, in the same relative order (L.7)', () => {
		for (const c of cases) {
			const off = line(c.src, c.spec).heirs;
			const on = line(c.src, { ...c.spec, body: true }).heirs;
			expect(off.filter((x) => on.includes(x)), c.id).toEqual(on);
		}
	});

	it('the named heirs stay first and stay when the switch lapses the line (L.4, L.5)', () => {
		const r = line(cases.find((c) => c.id === 'L02')!.src, { body: true, heirs: ['e1'] });
		expect(r.heirs).toEqual(['e1']);
		expect(r.outsideBody).toBe(true);
		expect(r.namedHeirs).toEqual([{ id: 'e1', state: 'first' }]);
	});

	it('a house form keeps the body in both passes: outsideBody is false when one pass finds the first holder (L.4)', () => {
		const r = line(cadet(HH, CH), { inherit: 'men-first-in-house', body: true });
		expect(r.outsideBody).toBe(false);
	});

	it('no one can inherit and R is in the body: outsideBody is false (L.5)', () => {
		const r = line(cases.find((c) => c.id === 'L01b')!.src, { body: true });
		expect(r.heirs).toEqual([]);
		expect(r.outsideBody).toBe(false);
		expect(r.firstHolder).toBe('y');
	});

	it('the switch does nothing without a rule: no engine, no first holder (B.6, L.1)', () => {
		const r = line(cadet(CKIDS, CH), { rule: undefined, heirs: ['e1'], body: true });
		expect(r.heirs).toEqual(['e1']);
		expect(r.firstHolder).toBeUndefined();
		expect(r.outsideBody).toBe(false);
	});

	it('no ruler or an unreadable title has no first holder', () => {
		expect(line(cadet(CKIDS, CH), { body: true, bad: 'inherit' }).firstHolder).toBeUndefined();
	});

	it('an adopted child is outside the body when adoption does not count, and cuts its own line (L.3)', () => {
		const r = line(cadet(AD, AH), { body: true, adopted: false });
		expect(r.heirs).toEqual([]);
	});

	it('a first holder list entry with an id that is not in the tree is skipped (L.2)', () => {
		const r = line(cadet(CKIDS, ['{person: ghost, from: 1100}', ...CH]), { body: true });
		expect(r.firstHolder).toBe('y');
		expect(r.heirs).toEqual(['k1', 'c2', 'c3']);
	});

	it('the first holder is by list order, not by date (L.2)', () => {
		const r = line(cadet(CKIDS, ['{person: y, from: 1155, to: 1190}', '{person: e, from: 1100, to: 1110}', '{person: c1, from: 1190}']), { body: true });
		expect(r.firstHolder).toBe('y');
	});

	it('works on a deep house without a stack overflow', () => {
		const n = 3000;
		const people = ['people:', ...Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}, sex: m, born: ${1000 + i}${i ? `, parents: [p${i - 1}]` : ''}}`)];
		const r = line([...people, holdersBlock(['{person: p0, to: 1100}', '{person: p1}'])].join('\n'), { body: true, rule: 'nearest-relative' });
		expect(r.firstHolder).toBe('p0');
		expect(r.heirs.length).toBeGreaterThan(0);
	});
});

describe('heirs-of-body: reading (L.1)', () => {
	const read = (key: string) => {
		const r = parseDynasty(`people:\n  - {id: a, name: A}\n\ntitles:\n  - id: t\n    name: T\n${key}    holders: [a]\n`);
		if (!r.ok) throw new Error('parse');
		return { title: r.tree.titles![0], codes: deriveFamilies(r.tree).issues.map((i) => i.code) };
	};
	it('reads true, yes and 1 as the switch; anything else leaves it off, with no warning', () => {
		for (const v of ['true', 'yes', 'True']) expect(read(`    heirs-of-body: ${v}\n`).title.heirsOfBody).toBe(true);
		for (const v of ['false', 'no', 'maybe', '[a]']) {
			const { title, codes } = read(`    heirs-of-body: ${v}\n`);
			expect(title.heirsOfBody).toBeUndefined();
			expect(codes.filter((c) => /body/.test(c))).toEqual([]);
		}
		expect('heirsOfBody' in read('').title).toBe(false);
	});
	it('specOf carries it as body', () => {
		expect(specOf(read('    heirs-of-body: true\n').title).body).toBe(true);
		expect('body' in specOf(read('').title)).toBe(false);
	});
});

describe('heirs-of-body: writing (L.1)', () => {
	const PEOPLE = ['people:', '  - {id: aldric, name: Aldric}'];
	const src = (title: string[]) => [...title, ...PEOPLE].join('\n') + '\n';
	const BASE = ['titles:', '  - id: duke', '    name: Duke', '    holders: [aldric]'];
	const body = (r: EditResult): string => {
		if (!r.ok) throw new Error(`refused: ${r.code}`);
		return r.body;
	};
	const edit = (text: string, fields: object) => body(applyOp(text, { kind: 'edit-title', id: 'duke', ...fields } as Op));

	it('true writes the key after inherit-adopted and before year, plain', () => {
		const out = edit(src(['titles:', '  - id: duke', '    name: Duke', '    inherit-adopted: true', '    year: 1210', '    holders: [aldric]']), { heirsOfBody: true });
		expect(out).toContain('    inherit-adopted: true\n    heirs-of-body: true\n    year: 1210\n');
	});
	it('true over a written yes is no change; true over a written false writes true', () => {
		const yes = src(['titles:', '  - id: duke', '    name: Duke', '    heirs-of-body: yes', '    holders: [aldric]']);
		expect(edit(yes, { heirsOfBody: true })).toBe(yes);
		const no = src(['titles:', '  - id: duke', '    name: Duke', '    heirs-of-body: no', '    holders: [aldric]']);
		expect(edit(no, { heirsOfBody: true })).toContain('    heirs-of-body: true\n');
	});
	it('false removes the key and keeps the other keys; false with no key is no change', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heirs-of-body: true  # the rule', '    inherit-adopted: true', '    holders: [aldric]']);
		expect(edit(text, { heirsOfBody: false })).toBe(src(['titles:', '  - id: duke', '    name: Duke', '    inherit-adopted: true', '    holders: [aldric]']));
		expect(edit(src(BASE), { heirsOfBody: false })).toBe(src(BASE));
	});
	it('null removes the key like false', () => {
		const text = src(['titles:', '  - id: duke', '    name: Duke', '    heirs-of-body: true', '    holders: [aldric]']);
		expect(edit(text, { heirsOfBody: null })).toBe(src(BASE));
		expect(edit(src(BASE), { heirsOfBody: null })).toBe(src(BASE));
	});
	it('refuses a value that is not true or false, and writes nothing', () => {
		const r = applyOp(src(BASE), { kind: 'edit-title', id: 'duke', heirsOfBody: 'yes' } as never);
		expect(r.ok ? 'ok' : r.code).toBe('bad-value');
	});
	it('the written key reads back', () => {
		const r = parseDynasty(edit(src(BASE), { heirsOfBody: true }));
		expect(r.ok && r.tree.titles![0].heirsOfBody).toBe(true);
	});
});

describe('heirs-of-body: random trees (L.7)', () => {
	it('the line with the switch on is a subset of the line with the switch off, in the same order, and every heir descends from the first holder', () => {
		let seed = 12345;
		const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
		const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
		const rules = ['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign'] as const;
		const inherits = ['men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-only'] as const;
		let checked = 0;
		let withHeirs = 0;
		for (let t = 0; t < 400; t++) {
			const n = 6 + Math.floor(rnd() * 14);
			const people: string[] = [];
			const parentsOf: number[][] = [];
			for (let i = 0; i < n; i++) {
				const ps: string[] = [];
				parentsOf.push([]);
				if (i > 0) {
					const k = rnd() < 0.15 ? 2 : rnd() < 0.8 ? 1 : 0;
					for (let j = 0; j < k; j++) {
						const par = Math.floor(rnd() * i);
						const type = rnd() < 0.1 ? 'adoptive' : rnd() < 0.05 ? 'rumoured' : 'birth';
						const e = type === 'birth' ? `p${par}` : `{id: p${par}, type: ${type}}`;
						if (!ps.includes(e)) {
							ps.push(e);
							if (type !== 'rumoured') parentsOf[i].push(par);
						}
					}
				}
				const died = rnd() < 0.4 ? `, died: ${1300 + i}` : '';
				const ill = rnd() < 0.1 ? ', illegitimate: true' : '';
				people.push(`  - {id: p${i}, name: P${i}, sex: ${rnd() < 0.5 ? 'm' : 'f'}, born: ${1000 + i * 10}${died}${ill}${ps.length ? ', parents: [' + ps.join(', ') + ']' : ''}}`);
			}
			const holderIds = new Set<number>();
			for (let j = 0, nh = 1 + Math.floor(rnd() * 3); j < nh; j++) holderIds.add(Math.floor(rnd() * n));
			let y = 1100;
			const holders = [...holderIds].map((id, j) => {
				const h = `{person: p${id}, from: ${y}${j < holderIds.size - 1 ? ', to: ' + (y + 20) : ''}}`;
				y += 20;
				return h;
			});
			const source = `people:\n${people.join('\n')}\n${holdersBlock(holders)}`;
			const spec: Partial<SuccessionSpec> = { rule: pick(rules), inherit: pick(inherits), illegitimate: pick(['no', 'after', 'equal'] as const), adopted: rnd() < 0.5 };
			if (rnd() < 0.3) spec.inheritThrough = pick(['men', 'women', 'anyone'] as const);
			const off = line(source, spec);
			const on = line(source, { ...spec, body: true });
			if (off.kind !== 'line') continue;
			checked++;
			if (on.heirs.length) withHeirs++;
			expect(off.heirs.filter((x) => on.heirs.includes(x)), source).toEqual(on.heirs);
			// Every heir descends from H over some link that is not a ward or rumoured link.
			const H = on.firstHolder!;
			const down = new Set([Number(H.slice(1))]);
			for (let i = 0; i < n; i++) if (parentsOf[i].some((q) => down.has(q))) down.add(i);
			for (const h of on.heirs) expect(down.has(Number(h.slice(1))), `${h} descends from ${H}`).toBe(true);
		}
		expect(checked).toBeGreaterThan(300);
		expect(withHeirs).toBeGreaterThan(50);
	});
});
