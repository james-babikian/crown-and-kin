/*
 * Tests for `src/core/order.ts`, the walk of the card-and-line build (the decision notes "0.3.1" WP-1): the three
 * changed rules W1 to W3, `familyOrder`, `farGenerations`, ids that contain `|` or `:`, and D2 (the order
 * in which the user wrote the children never changes). Where the new walk differs from the walk of 0.3.0 and where it must
 * not, the tests state the answers of 0.3.0 as fixed values: the frozen copy of the old `order.ts` was deleted in 0.4
 * (slim assessment T1); the values were recorded from it on 2026-10-22 (commit 1b5e2674 holds the copy).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { computeGenerations } from '../../src/core/generations';
import { computeModelOrder, sideByWalk, soloKey, type ModelOrder } from '../../src/core/order';
import { parseDynasty } from '../../src/core/parse';
import { randomTree } from '../support/random-trees';

interface Walked {
	g: FamilyGraph;
	gen: Map<string, number>;
	order: ModelOrder;
}

/** The walk of a tree text, with the graph and the generations it was made from. */
function walk(source: string, farGenerations?: number): Walked {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.detail ?? ''}`);
	const g = deriveFamilies(parsed.tree);
	const gen = computeGenerations(g);
	return { g, gen, order: computeModelOrder(g, gen, farGenerations) };
}

/** The key of the union of two partners (listed or implicit). */
function unionOf(g: FamilyGraph, a: string, b: string): string {
	const found = g.unions.find((u) => u.partners.includes(a) && u.partners.includes(b));
	if (!found) throw new Error(`no union of ${a} and ${b}`);
	return found.key;
}

const personIds = (order: ModelOrder) => order.items.flatMap((i) => (i.kind === 'person' ? [i.id] : []));
const unionKeys = (order: ModelOrder) => order.items.flatMap((i) => (i.kind === 'union' ? [i.key] : []));

// Uncle (row 1) and niece (row 2) are the parents of kid (row 3): a couple on two rows.
const TWO_ROWS = `people:
  - {id: gp, name: GP}
  - {id: uncle, name: Uncle, parents: [gp]}
  - {id: sib, name: Sib, parents: [gp]}
  - {id: niece, name: Niece, parents: [sib]}
  - {id: kid, name: Kid, parents: [uncle, niece]}
`;

describe('W1: a couple on two rows is anchored to the lower partner', () => {
	it('puts the dot and the children with the lower partner', () => {
		const { g, gen, order } = walk(TWO_ROWS);
		expect(gen.get('uncle')).toBe(1);
		expect(gen.get('niece')).toBe(2);
		expect(order.anchors.get(unionOf(g, 'uncle', 'niece'))).toBe('niece');
	});

	it('differs from today: the old walk anchors the couple to the partner it reaches first', () => {
		const { g, order } = walk(TWO_ROWS);
		// The walk of 0.3.0 gave 'uncle' here (the partner it reaches first).
		expect(order.anchors.get(unionOf(g, 'uncle', 'niece'))).not.toBe('uncle');
	});

	it('anchors to the lower partner also when the children carry the house of the upper partner', () => {
		const { g, order } = walk(`houses:
  - {id: hu, name: House U}
  - {id: hn, name: House N}
people:
  - {id: gp, name: GP}
  - {id: uncle, name: Uncle, parents: [gp], house: hu, sex: m}
  - {id: sib, name: Sib, parents: [gp]}
  - {id: niece, name: Niece, parents: [sib], house: hn, sex: f}
  - {id: kid1, name: Kid1, parents: [uncle, niece], house: hu}
  - {id: kid2, name: Kid2, parents: [uncle, niece], house: hu}
`);
		expect(order.anchors.get(unionOf(g, 'uncle', 'niece'))).toBe('niece');
	});

	it('emits the union once, before the children, and the children once', () => {
		const { g, order } = walk(TWO_ROWS);
		const key = unionOf(g, 'uncle', 'niece');
		expect(unionKeys(order).filter((k) => k === key)).toHaveLength(1);
		expect(personIds(order).filter((p) => p === 'kid')).toHaveLength(1);
		const at = (item: ModelOrder['items'][number]) => order.items.findIndex((x) => JSON.stringify(x) === JSON.stringify(item));
		expect(at({ kind: 'union', key })).toBeLessThan(at({ kind: 'person', id: 'kid' }));
	});

	it('keeps the old anchor for partners on one row', () => {
		const { g, order } = walk(`people:
  - {id: gp, name: GP}
  - {id: a, name: A, parents: [gp], sex: m}
  - {id: b, name: B, sex: f}
  - {id: kid, name: Kid, parents: [a, b]}
`);
		const key = unionOf(g, 'a', 'b');
		// The walk of 0.3.0 gave 'a' (the blood person).
		expect(order.anchors.get(key)).toBe('a');
	});
});

describe('W2: partners in one block but not side by side', () => {
	// The blood person has three married-in spouses: the block is [s1, id, s2, s3] and s3 stands two cards along.
	const THREE_SPOUSES = `people:
  - {id: gp, name: GP}
  - {id: id, name: Id, parents: [gp], sex: m}
  - {id: s1, name: S1, sex: f}
  - {id: s2, name: S2, sex: f}
  - {id: s3, name: S3, sex: f}
  - {id: c1, name: C1, parents: [id, s1]}
  - {id: c2, name: C2, parents: [id, s2]}
  - {id: c3, name: C3, parents: [id, s3]}
unions:
  - partners: [id, s1]
  - partners: [id, s2]
  - partners: [id, s3]
`;

	it('puts the three spouses in one block with the third two cards from the person', () => {
		const { order } = walk(THREE_SPOUSES);
		const block = order.blocks.find((b) => b.includes('s3'))!;
		expect(Math.abs(block.indexOf('s3') - block.indexOf('id'))).toBe(2);
	});

	it('lets the outer partner anchor the children', () => {
		const { g, order } = walk(THREE_SPOUSES);
		expect(order.anchors.get(unionOf(g, 'id', 's3'))).toBe('s3');
	});

	it('differs from today: the old walk anchors that couple to the blood person', () => {
		const { g, order } = walk(THREE_SPOUSES);
		// The walk of 0.3.0 gave 'id' (the blood person).
		expect(order.anchors.get(unionOf(g, 'id', 's3'))).not.toBe('id');
	});

	it('keeps a spouse beside the person with the person as the emitter', () => {
		const { g, order } = walk(THREE_SPOUSES);
		expect(order.anchors.get(unionOf(g, 'id', 's2'))).toBe('id');
	});
});

describe('W3: the families of a person follow the order of their hang points', () => {
	const THREE_SPOUSES_OF_ONE = `people:
  - {id: gp, name: GP}
  - {id: id, name: Id, parents: [gp], sex: m}
  - {id: s1, name: S1, sex: f}
  - {id: s2, name: S2, sex: f}
  - {id: c1, name: C1, parents: [id, s1]}
  - {id: c2, name: C2, parents: [id, s2]}
  - {id: c0, name: C0, parents: [id]}
unions:
  - partners: [id, s2]
  - partners: [id, s1]
`;

	it('puts the spouse on the left first, the children of one parent alone, then the spouse on the right', () => {
		// The block is [s2, id, s1]: s2 married in first and stands on the left (the first spouse is placed left of the person).
		const { g, order } = walk(THREE_SPOUSES_OF_ONE);
		const block = order.blocks.find((b) => b.includes('id'))!;
		const left = block[block.indexOf('id') - 1];
		const right = block[block.indexOf('id') + 1];
		expect(order.familyOrder.get('id')).toEqual([unionOf(g, 'id', left), soloKey('id'), unionOf(g, 'id', right)]);
	});

	it('emits the groups of children in that order', () => {
		const { g, order } = walk(THREE_SPOUSES_OF_ONE);
		const keys = order.familyOrder.get('id')!;
		const kids = keys.map((k) => (k === soloKey('id') ? g.soloChildren.get('id')! : g.unionByKey.get(k)!.children)).flat();
		const persons = personIds(order);
		expect(kids.map((k) => persons.indexOf(k))).toEqual([...kids.map((k) => persons.indexOf(k))].sort((p, q) => p - q));
	});

	it('records every person who has a block, with their unions and their one-parent family', () => {
		const { g, order } = walk(THREE_SPOUSES_OF_ONE);
		for (const p of g.people) {
			const keys = order.familyOrder.get(p.id)!;
			expect(keys).toContain(soloKey(p.id));
			expect([...keys].filter((k) => k !== soloKey(p.id)).sort()).toEqual([...(g.unionsOf.get(p.id) ?? [])].sort());
		}
	});

	// a has a spouse c in the block and a partner x elsewhere (a cousin marriage with children); the order depends on
	// which of the two blocks the walk reaches first.
	const partnerElsewhere = (first: 'a' | 'x') => `people:
  - {id: ${first === 'a' ? 'f1' : 'f2'}, name: F}
  - {id: ${first === 'a' ? 'f2' : 'f1'}, name: F}
  - {id: a, name: A, parents: [f1], sex: m}
  - {id: x, name: X, parents: [f2], sex: f}
  - {id: c, name: C, sex: f}
  - {id: k, name: K, parents: [a, x]}
  - {id: j, name: J, parents: [a, c]}
unions:
  - partners: [a, c]
`;

	it('puts a partner elsewhere on the right when the walk has not reached the partner yet', () => {
		const { g, order } = walk(partnerElsewhere('a'));
		expect(order.familyOrder.get('a')).toEqual([soloKey('a'), unionOf(g, 'a', 'x'), unionOf(g, 'a', 'c')]);
	});

	it('puts a partner elsewhere on the left when the walk reached the partner first', () => {
		const { g, order } = walk(partnerElsewhere('x'));
		expect(order.familyOrder.get('a')).toEqual([unionOf(g, 'a', 'x'), soloKey('a'), unionOf(g, 'a', 'c')]);
	});

	it('keeps the list order inside a group', () => {
		// Two partners elsewhere, both not reached: both sort to the right of the person, in list order.
		const { g, order } = walk(`people:
  - {id: f1, name: F}
  - {id: f2, name: F}
  - {id: a, name: A, parents: [f1]}
  - {id: x, name: X, parents: [f2]}
  - {id: y, name: Y, parents: [f2]}
  - {id: k, name: K, parents: [a, x]}
  - {id: l, name: L, parents: [a, y]}
`);
		expect(order.familyOrder.get('a')).toEqual([soloKey('a'), unionOf(g, 'a', 'x'), unionOf(g, 'a', 'y')]);
	});

	it('puts a partner on another row on the right when the walk has not reached her yet', () => {
		const { g, order } = walk(TWO_ROWS);
		expect(order.familyOrder.get('uncle')).toEqual([soloKey('uncle'), unionOf(g, 'uncle', 'niece')]);
	});

	it('gives sideByWalk one rule: the position in a block, else the walk index', () => {
		const same = (to: number) => sideByWalk({ block: 3, at: 2 }, { block: 3, at: to }, (b) => b);
		expect(same(1)).toBe('left');
		expect(same(3)).toBe('right');
		expect(sideByWalk({ block: 3, at: 0 }, { block: 1, at: 5 }, (b) => b)).toBe('left');
		expect(sideByWalk({ block: 3, at: 0 }, { block: 7, at: 0 }, (b) => b)).toBe('right');
		expect(sideByWalk({ block: 3, at: 0 }, { block: Infinity, at: -1 }, (b) => b)).toBe('right');
	});
});

describe('farGenerations (D10)', () => {
	// a (row 1) and z (row 3) have a child: a far couple. a also has a spouse c in the block.
	const FAR_PARTNER = `people:
  - {id: f1, name: F1}
  - {id: a, name: A, parents: [f1], sex: m}
  - {id: b, name: B, parents: [f1]}
  - {id: m, name: M, parents: [b]}
  - {id: z, name: Z, parents: [m]}
  - {id: c, name: C, sex: f}
  - {id: k, name: K, parents: [a, z]}
  - {id: j, name: J, parents: [a, c]}
unions:
  - partners: [a, c]
`;

	it('has the partners three rows apart in the sample', () => {
		const { gen } = walk(FAR_PARTNER);
		expect(gen.get('z')! - gen.get('a')!).toBe(2);
	});

	it('defaults to 1: a partner two rows away hangs from the own place of the person (before the one-parent family)', () => {
		const { g, order } = walk(FAR_PARTNER);
		const far = unionOf(g, 'a', 'z');
		expect(order.familyOrder.get('a')).toEqual([far, soloKey('a'), unionOf(g, 'a', 'c')]);
		expect(walk(FAR_PARTNER, 1).order.familyOrder).toEqual(order.familyOrder);
	});

	it('with 2 the same partner counts as near and sorts by the side of the walk', () => {
		const { g, order } = walk(FAR_PARTNER, 2);
		expect(order.familyOrder.get('a')).toEqual([soloKey('a'), unionOf(g, 'a', 'z'), unionOf(g, 'a', 'c')]);
	});

	it('does not change blocks, items or anchors', () => {
		const one = walk(FAR_PARTNER, 1).order;
		const two = walk(FAR_PARTNER, 2).order;
		expect(two.blocks).toEqual(one.blocks);
		expect(unionKeys(two).sort()).toEqual(unionKeys(one).sort());
		expect([...two.anchors].sort()).toEqual([...one.anchors].sort());
	});
});

describe('ids with | and : (control flow never reads text)', () => {
	// Ids that look like parts of a key: `a|b` is the join of two ids in a union key, `solo:x` is the key of the family of x alone.
	const ODD = `people:
  - {id: "a|b", name: AB}
  - {id: x, name: X}
  - {id: "solo:x", name: SoloX}
  - {id: "u:1", name: U1, parents: ["a|b"]}
  - {id: "n:2", name: N2, parents: ["a|b"]}
  - {id: "k|1", name: K1, parents: ["u:1", "n:2"]}
  - {id: "s:z", name: Sz, parents: [x]}
  - {id: "s:y", name: Sy, parents: ["solo:x"]}
`;

	it('walks the tree with the same shape as the same tree with plain ids', () => {
		const rename = (s: string) => s.replace(/"a\|b"/g, 'ab').replace(/"u:1"/g, 'u1').replace(/"n:2"/g, 'n2').replace(/"k\|1"/g, 'k1').replace(/"solo:x"/g, 'sx').replace(/"s:z"/g, 'sz').replace(/"s:y"/g, 'sy');
		const odd = walk(ODD).order;
		const plain = walk(rename(ODD)).order;
		const back = (id: string) => ({ ab: 'a|b', u1: 'u:1', n2: 'n:2', k1: 'k|1', sx: 'solo:x', sz: 's:z', sy: 's:y' } as Record<string, string>)[id] ?? id;
		expect(personIds(plain).map(back)).toEqual(personIds(odd));
		expect(plain.blocks.map((b) => b.map(back))).toEqual(odd.blocks);
		expect(unionKeys(plain)).toHaveLength(unionKeys(odd).length);
	});

	it('keeps the children of x and of solo:x apart (soloKey is a key, not an id)', () => {
		const { g, order } = walk(ODD);
		expect(g.soloChildren.get('x')).toEqual(['s:z']);
		expect(g.soloChildren.get('solo:x')).toEqual(['s:y']);
		expect(order.familyOrder.get('x')).toContain(soloKey('x'));
		expect(order.familyOrder.get('solo:x')).toContain(soloKey('solo:x'));
		expect(soloKey('x')).not.toBe(soloKey('solo:x'));
		expect(personIds(order).sort()).toEqual(g.people.map((p) => p.id).sort());
	});

	it('anchors a couple on two rows to the lower partner with such ids', () => {
		const { g, order } = walk(`people:
  - {id: "g|p", name: GP}
  - {id: "un:cle", name: Uncle, parents: ["g|p"]}
  - {id: "si:b", name: Sib, parents: ["g|p"]}
  - {id: "nie|ce", name: Niece, parents: ["si:b"]}
  - {id: "k:id", name: Kid, parents: ["un:cle", "nie|ce"]}
`);
		expect(order.anchors.get(unionOf(g, 'un:cle', 'nie|ce'))).toBe('nie|ce');
	});

	it('lets the outer partner anchor with such ids', () => {
		const { g, order } = walk(`people:
  - {id: "g|p", name: GP}
  - {id: "i:d", name: Id, parents: ["g|p"], sex: m}
  - {id: "s|1", name: S1, sex: f}
  - {id: "s:2", name: S2, sex: f}
  - {id: "s|3", name: S3, sex: f}
  - {id: c1, name: C1, parents: ["i:d", "s|1"]}
  - {id: c3, name: C3, parents: ["i:d", "s|3"]}
unions:
  - partners: ["i:d", "s|1"]
  - partners: ["i:d", "s:2"]
  - partners: ["i:d", "s|3"]
`);
		expect(order.anchors.get(unionOf(g, 'i:d', 's|3'))).toBe('s|3');
	});
});

describe('D2: the written sibling order never changes', () => {
	const fixtures = readdirSync('fixtures')
		.filter((f) => f.endsWith('.md'))
		.flatMap((f) => {
			const m = readFileSync(`fixtures/${f}`, 'utf8').match(/^```kin\r?\n([\s\S]*?)^```/m);
			return m ? [{ name: f, source: m[1] }] : [];
		});
	const randoms = Array.from({ length: 150 }, (_, seed) => ({ name: `random ${seed}`, source: randomTree(seed) }));
	const hand = [{ name: 'two rows', source: TWO_ROWS }];

	/** The families whose children do not stand in written order in the walk. */
	function misordered(source: string): string[] {
		const parsed = parseDynasty(source);
		if (!parsed.ok) return [];
		const g = deriveFamilies(parsed.tree);
		const order = computeModelOrder(g, computeGenerations(g));
		const at = new Map(personIds(order).map((id, i) => [id, i]));
		const families: Array<[string, readonly string[]]> = [
			...g.unions.map((u): [string, readonly string[]] => [u.key, u.children]),
			...[...g.soloChildren].map(([p, kids]): [string, readonly string[]] => [soloKey(p), kids]),
		];
		return families.filter(([, kids]) => kids.some((k, i) => i > 0 && at.get(k)! < at.get(kids[i - 1])!)).map(([key]) => key);
	}

	it.each([...fixtures, ...hand, ...randoms].map((t) => [t.name, t.source] as const))('%s: the children of every family stand in written order', (_name, source) => {
		expect(misordered(source)).toEqual([]);
	});

	it('also walks every sample and random tree to the end: every person once, every union once', () => {
		for (const { source } of [...fixtures, ...randoms]) {
			const parsed = parseDynasty(source);
			if (!parsed.ok) continue;
			const g = deriveFamilies(parsed.tree);
			const order = computeModelOrder(g, computeGenerations(g));
			expect(personIds(order).sort()).toEqual(g.people.map((p) => p.id).sort());
			expect(unionKeys(order).sort()).toEqual(g.unions.map((u) => u.key).sort());
		}
	});
});

describe('where no rule can fire the new walk equals today', () => {
	it('gives the items, blocks and anchors of order.ts for a tree of single marriages on one row', () => {
		const { order } = walk(`people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, parents: [a, b], sex: m}
  - {id: d, name: D, sex: f}
  - {id: e, name: E, parents: [c, d]}
  - {id: f, name: F, parents: [c, d]}
`);
		// The walk of 0.3.0 gave exactly these items, blocks and anchors.
		expect(order.items).toEqual([
			{ kind: 'person', id: 'a' },
			{ kind: 'person', id: 'b' },
			{ kind: 'union', key: 'i:["a","b"]' },
			{ kind: 'person', id: 'c' },
			{ kind: 'person', id: 'd' },
			{ kind: 'union', key: 'i:["c","d"]' },
			{ kind: 'person', id: 'e' },
			{ kind: 'person', id: 'f' },
		]);
		expect(order.blocks).toEqual([['a', 'b'], ['c', 'd'], ['e'], ['f']]);
		expect([...order.anchors]).toEqual([['i:["a","b"]', 'a'], ['i:["c","d"]', 'c']]);
	});

	it('does not throw for a tree with a parent cycle', () => {
		const parsed = parseDynasty(`people:
  - {id: a, name: A, parents: [b]}
  - {id: b, name: B, parents: [a]}
`);
		if (!parsed.ok) return;
		const g = deriveFamilies(parsed.tree);
		expect(() => computeModelOrder(g, computeGenerations(g))).not.toThrow();
	});
});
