import { describe, expect, it } from 'vitest';
import { build, fixture } from './helpers';
import { randomTree } from './random-trees';

describe('computeGenerations', () => {
	it('puts married-in spouses beside their partner', () => {
		const { gen } = build(fixture('01'));
		expect(gen.get('mathilde')).toBe(gen.get('roderick'));
		expect(gen.get('edric')).toBe(2);
	});

	it('handles a first-cousin marriage', () => {
		const { gen } = build(fixture('03'));
		expect(gen.get('conrad')).toBe(2);
		expect(gen.get('lisette')).toBe(2);
		expect(gen.get('tristan')).toBe(3);
		expect(gen.get('stefan')).toBe(1);
	});

	it('places a child of a cross-generation couple below the younger parent', () => {
		const { gen } = build(`people:
  - {id: gp, name: GP}
  - {id: uncle, name: Uncle, parents: [gp]}
  - {id: sib, name: Sib, parents: [gp]}
  - {id: niece, name: Niece, parents: [sib]}
  - {id: kid, name: Kid, parents: [uncle, niece]}
`);
		expect(gen.get('uncle')).toBe(1);
		expect(gen.get('niece')).toBe(2);
		expect(gen.get('kid')).toBe(3);
	});

	it('handles sibling and parent–child marriages without warnings', () => {
		const { g, gen } = build(fixture('11'));
		expect(g.issues).toEqual([]);
		expect(gen.get('varian')).toBe(1);
		expect(gen.get('yseult')).toBe(1);
		expect(gen.get('valen')).toBe(2);
		expect(gen.get('corwin')).toBe(1);
		expect(gen.get('alys')).toBe(2);
		expect(gen.get('osric')).toBe(3);
	});

	it('pulls a lone founder down to just above their child', () => {
		const { gen } = build(`people:
  - {id: a, name: A}
  - {id: b, name: B, parents: [a]}
  - {id: c, name: C, parents: [b]}
  - {id: stranger, name: Stranger}
  - {id: d, name: D, parents: [c, stranger]}
`);
		expect(gen.get('stranger')).toBe(gen.get('c'));
	});
});

/** Spec §5.1 step 1: every person with placement parents is exactly one row below the lower one. */
function rowProblems(src: string): string[] {
	const { g, gen } = build(src);
	const bad: string[] = [];
	for (const p of g.people) {
		const parents = g.placementParents.get(p.id)!;
		if (parents.length && gen.get(p.id) !== Math.max(...parents.map((x) => gen.get(x)!)) + 1) bad.push(`${p.id} not one row below its parents`);
	}
	const used = new Set(gen.values());
	for (let r = 0; r < used.size; r++) if (!used.has(r)) bad.push(`row ${r} is empty`);
	return bad;
}

describe('computeGenerations: founders who marry a descendant', () => {
	it('settles the shape of random seed 15: the founder p0 stays above his daughter and beside his other wife', () => {
		// p0 marries his daughter p2 and also p6; p6's father p3 is the other parent of p2's son p5.
		// 0.2.5 (D140): the partner step moves p1 one row down (the parents p0 and p1 of p2 stand on one row); p7 and her husband p8 follow him.
		const src = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: m}
  - {id: p2, name: P2, sex: f, parents: [p0, p1]}
  - {id: p3, name: P3, sex: m}
  - {id: p4, name: P4, sex: m, parents: [p1, p2]}
  - {id: p5, name: P5, sex: m, parents: [p2, p3]}
  - {id: p6, name: P6, sex: f, parents: [p3]}
  - {id: p7, name: P7, sex: f, parents: [p1]}
  - {id: p8, name: P8, sex: f}
unions:
  - {partners: [p2, p0]}
  - {partners: [p5, p4]}
  - {partners: [p6, p0]}
  - {partners: [p8, p7]}
`;
		const { gen } = build(src);
		expect(rowProblems(src)).toEqual([]);
		expect(Object.fromEntries(gen)).toEqual({ p0: 1, p1: 1, p2: 2, p3: 0, p4: 3, p5: 3, p6: 1, p7: 2, p8: 2 });
	});

	it('keeps a founder who marries his granddaughter two rows above her', () => {
		const src = `people:
  - {id: gp, name: GP, sex: m}
  - {id: gm, name: GM, sex: f}
  - {id: c, name: C, parents: [gp, gm]}
  - {id: gd, name: GD, sex: f, parents: [c]}
  - {id: k, name: K, parents: [gp, gd]}
unions:
  - {partners: [gp, gm]}
  - {partners: [gp, gd]}
`;
		const { gen } = build(src);
		expect(rowProblems(src)).toEqual([]);
		expect(Object.fromEntries(gen)).toEqual({ gp: 0, gm: 0, c: 1, gd: 2, k: 3 });
	});

	it('a founder whose only spouse is his daughter sits one row above her', () => {
		const src = 'people:\n  - {id: f, name: F}\n  - {id: d, name: D, parents: [f]}\nunions:\n  - {partners: [d, f]}\n';
		expect(Object.fromEntries(build(src).gen)).toEqual({ f: 0, d: 1 });
	});

	it('fixture 11: every child one row below the lower parent, the founders above', () => {
		expect(rowProblems(fixture('11'))).toEqual([]);
		const { gen } = build(fixture('11'));
		expect(gen.get('maud')).toBe(gen.get('corwin'));
		expect(gen.get('osric')).toBe(gen.get('alys')! + 1);
	});

	it('every fixture obeys the row rule', () => {
		for (const f of ['01', '02', '03', '04', '05', '06', '07', '08', '10', '11']) expect(rowProblems(fixture(f)), f).toEqual([]);
	});

	it('400 random trees obey the row rule and have no empty row', () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= 400; seed++) {
			const problems = rowProblems(randomTree(seed));
			if (problems.length) failures.push(`seed ${seed}: ${problems.join(', ')}`);
		}
		expect(failures).toEqual([]);
	});
});

describe('computeModelOrder', () => {
	it('keeps each married-in spouse in the same block as their partner', () => {
		const { order } = build(fixture('01'));
		expect(order.blocks).toContainEqual(['aldric', 'isolde']);
		expect(order.blocks).toContainEqual(['roderick', 'mathilde']);
	});

	it('puts the first of several spouses on the left and the rest on the right', () => {
		const { order } = build(fixture('02'));
		expect(order.blocks).toContainEqual(['agnes', 'edmund', 'beatrix', 'clarice']);
	});

	it('puts a husband who married in to the left of his wife', () => {
		const { order } = build(fixture('03'));
		expect(order.blocks).toContainEqual(['stefan', 'giselle']);
	});

	it("draws an intermarried couple's children under the parent whose house they carry", () => {
		const { order } = build(`houses:
  - {id: a, name: A}
  - {id: b, name: B}
people:
  - {id: fa, name: FA, house: a}
  - {id: fb, name: FB, house: b}
  - {id: wife, name: Wife, house: a, sex: f, parents: [fa]}
  - {id: husband, name: Husband, house: b, sex: m, parents: [fb]}
  - {id: kid, name: Kid, house: b, parents: [husband, wife]}
unions:
  - partners: [husband, wife]
`);
		expect(order.anchors.get('u0')).toBe('husband');
	});

	it('walks depth first: all of one child line before the next sibling, then the next union', () => {
		const { order } = build(`people:
  - {id: a}
  - {id: b}
  - {id: c}
  - {id: k1, parents: [a, b]}
  - {id: k2, parents: [a, b]}
  - {id: g1, parents: [k1]}
  - {id: k3, parents: [a, c]}
  - {id: s1, parents: [a]}
unions:
  - partners: [a, b]
  - partners: [a, c]
`);
		const seq = order.items.map((i) => (i.kind === 'person' ? i.id : i.key));
		expect(seq).toEqual(['b', 'a', 'c', 'u0', 'k1', 'g1', 'k2', 'u1', 'k3', 's1']);
	});

	it('a line of 20000 generations is ordered without a stack overflow', () => {
		const lines = ['people:', '  - {id: p0}'];
		for (let i = 1; i < 20000; i++) lines.push(`  - {id: p${i}, parents: [p${i - 1}]}`);
		const { order } = build(lines.join('\n'));
		expect(order.items).toHaveLength(20000);
		expect(order.items[19999]).toEqual({ kind: 'person', id: 'p19999' });
	});

	it('emits every person exactly once', () => {
		for (const f of ['01', '02', '03', '04', '06', '07', '08', '11']) {
			const { g, order } = build(fixture(f));
			const people = order.items.flatMap((i) => (i.kind === 'person' ? [i.id] : []));
			expect(new Set(people).size).toBe(g.people.length);
			expect(people).toHaveLength(g.people.length);
		}
	});
});
