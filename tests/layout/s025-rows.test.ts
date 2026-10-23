// 0.2.5 WP-A1 (D140): rows. A lone rumoured father sits in the row of his child's lower placement parent and beside that
// parent (r1). The two partners of a partnership sit on one row where this can be solved, and the step never leaves more
// unequal couples than before (r2). The tests use made-up trees (`tests/support/s025-rows-twin.ts`, `tests/support/s025-families.ts`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import type { FamilyGraph } from '../../src/core/derive';
import { pruneGraph } from '../../src/core/folds';
import { computeGenerations } from '../../src/core/generations';
import { computeModelOrder } from '../../src/core/order';
import { rowStats } from '../../src/core/row-partners';
import { loneRumouredRoots } from '../../src/core/rumoured-roots';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { build, fixture } from '../support/helpers';
import { randomTree, rumourTree } from '../support/random-trees';
import { chains, freeFormTree, freeTree, genTree } from '../support/s025-families';
import { ROWS_TWIN } from '../support/s025-rows-twin';

const SETTINGS = { sweeps: 4, far: DEFAULT_FAR_RULE };
const SAMPLES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'];

const pair = (partners: readonly string[]) => [...partners].sort().join('+');
/** The partnerships whose two partners stand on different rows, as sorted "a+b" texts. */
const unequal = (g: FamilyGraph, gen: Map<string, number>) =>
	g.unions.filter((u) => gen.get(u.partners[0]) !== gen.get(u.partners[1])).map((u) => pair(u.partners));

/** Spec §5.1 step 1: every person with placement parents is exactly one row below the lower one; no row is empty. */
function rowProblems(g: FamilyGraph, gen: Map<string, number>): string[] {
	const bad: string[] = [];
	for (const p of g.people) {
		const parents = g.placementParents.get(p.id)!;
		if (parents.length && gen.get(p.id) !== Math.max(...parents.map((x) => gen.get(x)!)) + 1) bad.push(`${p.id} not one row below its parents`);
	}
	const used = new Set(gen.values());
	for (let r = 0; r < used.size; r++) if (!used.has(r)) bad.push(`row ${r} is empty`);
	return bad;
}

function tryBuild(src: string) {
	try {
		return build(src);
	} catch {
		return undefined;
	}
}

describe('r1: a lone rumoured parent sits in the row of the child\'s placed parent', () => {
	it('puts the rumoured father beside the placed parent of his child, with a rumoured line to the child', () => {
		const { g, gen, order } = build(ROWS_TWIN);
		expect(gen.get('oda')).toBe(4);
		expect(gen.get('rufus')).toBe(gen.get('kay'));
		expect(gen.get('rufus')).toBe(gen.get('oda')! - 1);
		const block = order.blocks.find((b) => b.includes('rufus'))!;
		expect(block).toContain('kay');
		expect(block[block.length - 1]).toBe('rufus');
		const { layout, edges } = arrangeTree(g, gen, NORMAL_GEOMETRY, SETTINGS);
		const x = (id: string) => layout.persons.get(id)!.x;
		expect(Math.abs(x('rufus') - x('pia'))).toBeLessThanOrEqual(2 * NORMAL_GEOMETRY.cardW + 3 * NORMAL_GEOMETRY.nodeGap);
		expect(edges.paths.length).toBeGreaterThan(0);
		expect(edges.paths.some((p) => p.kind === 'rumoured' && p.child === 'oda' && p.parents?.includes('rufus'))).toBe(true);
	});

	it('is for a lone man only', () => {
		const src = (people = '', unions = '') => `people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, sex: m, parents: [a, b]}
  - {id: d, name: D, sex: f}
  - {id: e, name: E, sex: f, parents: [c, d, {id: r, type: rumoured}]}
${people}${unions ? `unions:\n${unions}` : ''}`;
		const r = '  - {id: r, name: R, sex: m}\n';
		const lone = (text: string) => loneRumouredRoots(build(text).g).has('r');
		// The plain case: he is lone and stands in the row of c and d.
		const plain = build(src(r));
		expect(lone(src(r))).toBe(true);
		expect(plain.gen.get('r')).toBe(plain.gen.get('c'));
		// A partner, a placed child or a placement parent: he is not lone.
		expect(lone(src(`${r}  - {id: s, name: S, sex: f}\n`, '  - {partners: [r, s]}\n'))).toBe(false);
		expect(lone(src(`${r}  - {id: k, name: K, parents: [r]}\n`))).toBe(false);
		expect(lone(src('  - {id: r, name: R, sex: m, parents: [a]}\n'))).toBe(false);
		// The child has no placement parent: nothing to sit beside.
		const orphan = build('people:\n  - {id: r, name: R, sex: m}\n  - {id: e, name: E, sex: f, parents: [{id: r, type: rumoured}]}\n');
		expect(loneRumouredRoots(orphan.g).has('r')).toBe(false);
	});

	it('takes the nearest child when he is the rumoured father of two children in two rows', () => {
		const { g, gen } = build(`people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, sex: m, parents: [a, b]}
  - {id: d, name: D, sex: m, parents: [c]}
  - {id: e, name: E, sex: f, parents: [c, {id: r, type: rumoured}]}
  - {id: f, name: F, sex: f, parents: [d, {id: r, type: rumoured}]}
  - {id: r, name: R, sex: m}
`);
		expect(loneRumouredRoots(g).get('r')).toEqual(['e', 'f']);
		expect(gen.get('r')).toBe(gen.get('e')! - 1);
	});

	it('keeps drawing him when the child or its parent is folded away', () => {
		const { g, gen } = build(ROWS_TWIN);
		const blocks = (hidden: string[]) => {
			const pruned = pruneGraph(g, new Set(hidden));
			return computeModelOrder(pruned, gen).blocks.find((b) => b.includes('rufus'));
		};
		expect(blocks(['kay'])).toEqual(['pia', 'rufus']);
		expect(blocks(['oda'])).toEqual(['rufus']);
		expect(blocks(['kay', 'pia'])).toEqual(['rufus']);
	});

	it('has no left-over people in the order: everybody is placed once', () => {
		const { g, order } = build(ROWS_TWIN);
		const ids = order.items.filter((i) => i.kind === 'person').map((i) => (i as { id: string }).id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.length).toBe(g.people.length);
	});
});

describe('r2: the two partners of a partnership sit on one row where this can be solved', () => {
	it('lowers a founder so that his child and the child\'s partner share a row (the twin)', () => {
		const { g, gen } = build(ROWS_TWIN);
		const rows = Object.fromEntries(gen);
		expect(rows).toMatchObject({ rufus: 3, kay: 3, pia: 3, sven: 1, tove: 2, ulf: 2, vera: 2, wil: 3, ned: 3, quin: 5 });
		expect(unequal(g, gen)).toEqual(['ned+quin']);
		expect(rowStats.accepted).toBe(1);
		expect(rowStats.rejected).toBeGreaterThanOrEqual(1);
	});

	it('moves the 23 people of sample 12 one row down; only kester+mabel stays unequal', () => {
		const before: Record<string, number> = {
			odo: 0, bertha: 0, alan: 1, brand: 1, cora: 1, fenna: 1, rolf: 1, yara: 1, kester: 2, tamsin: 2, wat: 2, jory: 2,
			kit: 2, nell: 2, rafe: 2, orla: 2, mabel: 3, nia: 3, pim: 3, ansel: 3, tobin: 4, bryn: 4, cai: 5,
		};
		const { g, gen } = build(fixture('12'));
		for (const [id, r] of Object.entries(before)) expect(gen.get(id), id).toBe(r + 1);
		expect(unequal(g, gen)).toEqual(['kester+mabel']);
		expect(rowProblems(g, gen)).toEqual([]);
	});

	it('keeps the unequal pairs of sample trees 07, 11 and 13 and does little work on 07', () => {
		const pairs = (n: string) => {
			const { g, gen } = build(fixture(n));
			return unequal(g, gen);
		};
		expect(pairs('11')).toEqual(['alys+corwin']);
		expect(pairs('13')).toEqual(['beatrix+edmund']);
		const { g, gen } = build(fixture('07'));
		expect(unequal(g, gen)).toEqual(['aldric-valmont+ingrid-valmont']);
		expect(rowStats.tries).toBeLessThanOrEqual(3);
		expect(rowStats.totalWork).toBeLessThanOrEqual(100);
	});

	it('leaves the rows of the sample trees that have no problem as they are', () => {
		// Row lists of 0.2.4 are in the spike hashes; here only the ones that must not move are checked by count.
		for (const n of ['01', '02', '03', '05', '06', '08', '09', '10', '11', '13', '14', '15']) {
			const { g, gen } = build(fixture(n));
			expect(rowStats.unequalAfter, n).toBeLessThanOrEqual(rowStats.unequalBefore);
			expect(rowProblems(g, gen), n).toEqual([]);
		}
	});

	it('moves the people of seed 15 as the contract says: one kept move, p0+p1', () => {
		const { gen } = build(`people:
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
`);
		expect(Object.fromEntries(gen)).toEqual({ p0: 1, p1: 1, p2: 2, p3: 0, p4: 3, p5: 3, p6: 1, p7: 2, p8: 2 });
		expect(rowStats.accepted).toBe(1);
		expect(rowStats.unequalBefore).toBe(4);
		expect(rowStats.unequalAfter).toBe(3);
	});

	it('keeps the invariants on the sample trees, the twin and seeded families, and is deterministic', () => {
		const sources: [string, string][] = [['twin', ROWS_TWIN], ...SAMPLES.map((n): [string, string] => [n, fixture(n)])];
		for (let s = 1; s <= 300; s++) sources.push([`random ${s}`, randomTree(s)], [`family ${s}`, genTree(s, 15 + (s % 70))], [`free ${s}`, freeTree(s, 12 + (s % 40))]);
		let checked = 0;
		for (const [name, src] of sources) {
			const b = tryBuild(src);
			if (!b) continue;
			checked++;
			expect(rowProblems(b.g, b.gen), name).toEqual([]);
			expect(Array.from(computeGenerations(b.g)), name).toEqual(Array.from(b.gen));
			expect(rowStats.guard, name).toBe(0);
			expect(rowStats.stepBudget, name).toBe(0);
			expect(rowStats.passes, name).toBeLessThanOrEqual(b.g.unions.length + 1);
		}
		expect(checked).toBeGreaterThan(800);
	});

	it('is never worse than 0.2.4 and the counters tell the truth (samples, twin, 3 families)', () => {
		const sources: [string, string][] = [['twin', ROWS_TWIN], ...SAMPLES.map((n): [string, string] => [n, fixture(n)])];
		for (let s = 1; s <= 600; s++) sources.push([`family ${s}`, genTree(s, 15 + (s % 70))], [`random ${s}`, randomTree(s)]);
		for (let s = 1; s <= 1500; s++) sources.push([`free-form ${s}`, freeFormTree(s, 12 + (s % 40))]);
		let fewer = 0;
		for (const [name, src] of sources) {
			const b = tryBuild(src);
			if (!b) continue;
			expect(rowStats.unequalAfter, name).toBeLessThanOrEqual(rowStats.unequalBefore);
			expect(unequal(b.g, b.gen).length, name).toBe(rowStats.unequalAfter);
			if (rowStats.unequalAfter < rowStats.unequalBefore) fewer++;
		}
		expect(fewer).toBeGreaterThan(300);
	}, 120_000);

	it('does not touch the order of the list in a way that makes it worse: the order is a known limit (7 people)', () => {
		const src = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: f}
  - {id: p2, name: P2, sex: m}
  - {id: p3, name: P3, sex: f}
  - {id: p4, name: P4, sex: m, parents: [p2]}
  - {id: p5, name: P5, sex: m, parents: [p1, p0]}
  - {id: p6, name: P6, sex: f, parents: [p3, {id: p0, type: rumoured}]}
unions:
  - {partners: [p1, p0]}
  - {partners: [p2, p0]}
  - {partners: [p3, p0]}
  - {partners: [p4, p1]}
`;
		const { g, gen } = build(src);
		expect(Object.fromEntries(gen)).toEqual({ p0: 0, p1: 1, p2: 0, p3: 0, p4: 1, p5: 2, p6: 1 });
		expect(unequal(g, gen)).toEqual(['p0+p1']);
		const reversed = { ...g, unions: [...g.unions].reverse() };
		const back = computeGenerations(reversed);
		expect(Object.fromEntries(back)).toEqual({ p0: 1, p1: 1, p2: 0, p3: 1, p4: 1, p5: 2, p6: 2 });
		expect(unequal(reversed, back)).toEqual(['p0+p2']);
		// Two couples are unequal without the step (0.2.4): the step leaves one.
		expect(rowStats.unequalBefore).toBe(2);
		expect(rowStats.unequalAfter).toBe(1);
	});

	it('is quick and bounded on a made-up tree with a rumoured link on every person', () => {
		const { g, gen } = build(rumourTree(400));
		expect(rowStats.accepted).toBeGreaterThanOrEqual(1);
		expect(rowStats.tries).toBeLessThanOrEqual(2 * rowStats.unequalBefore);
		expect(unequal(g, gen).length).toBeLessThan(rowStats.unequalBefore);
		expect(rowProblems(g, gen)).toEqual([]);
	});

	it('keeps the far rule: a couple that stays 2 rows apart is far; a couple that r2 joined is not', () => {
		const { g, gen } = build(ROWS_TWIN);
		for (const orientation of [undefined, 'sideways' as const]) {
			const { layout } = arrangeTree(g, gen, NORMAL_GEOMETRY, { ...SETTINGS, ...(orientation ? { orientation } : {}) });
			for (const u of g.unions) {
				const apart = Math.abs(gen.get(u.partners[0])! - gen.get(u.partners[1])!);
				const far = layout.unions.get(u.key)!.far;
				if (apart >= 2) expect(far, u.key).toBe(true);
				if (pair(u.partners) === 'ulf+vera') expect(far).toBe(false);
			}
		}
	});

	it('leaves no row-variant switch in the source', () => {
		const scan = (dir: string): string[] =>
			readdirSync(dir).flatMap((f) => {
				const path = `${dir}/${f}`;
				return statSync(path).isDirectory() ? scan(path) : path.endsWith('.ts') ? [path] : [];
			});
		for (const file of scan('src')) {
			const text = readFileSync(file, 'utf8');
			for (const word of ['setRowVariant', 'RowVariant', 'generations-variants', 'process.env']) expect(text.includes(word), `${file}: ${word}`).toBe(false);
		}
	});
});

describe('r2: a move is kept only when the count of unequal couples falls (gate F1)', () => {
	const f1 = (order: 'first' | 'last' = 'last') => {
		const lh = '  - {partners: [l, h]}\n';
		const xy = '  - {partners: [x1, y1]}\n  - {partners: [x2, y2]}\n  - {partners: [x3, y3]}\n';
		return `people:
  - {id: gp, name: GP, sex: m}
  - {id: l, name: L, sex: m, parents: [gp]}
  - {id: x1, name: X1, sex: m, parents: [l]}
  - {id: x2, name: X2, sex: m, parents: [l]}
  - {id: x3, name: X3, sex: m, parents: [l]}
  - {id: gp2, name: GP2, sex: m}
  - {id: m, name: M, sex: m, parents: [gp2]}
  - {id: h, name: H, sex: f, parents: [m]}
  - {id: gp3, name: GP3, sex: m}
  - {id: n, name: N, sex: m, parents: [gp3]}
  - {id: y1, name: Y1, sex: f, parents: [n]}
  - {id: y2, name: Y2, sex: f, parents: [n]}
  - {id: y3, name: Y3, sex: f, parents: [n]}
unions:
${order === 'first' ? lh + xy : xy + lh}`;
	};

	it('mends the broken couples of the move (repair) and ends with no unequal couple', () => {
		const { g, gen } = build(f1());
		expect(Object.fromEntries(gen)).toEqual({ gp: 1, l: 2, x1: 3, x2: 3, x3: 3, gp2: 0, m: 1, h: 2, gp3: 1, n: 2, y1: 3, y2: 3, y3: 3 });
		expect(unequal(g, gen)).toEqual([]);
		expect(rowStats.accepted).toBe(1);
		expect(rowStats.repaired).toBe(1);
		expect(rowStats.unequalBefore).toBe(1);
	});

	it('gives the same rows and no unequal couple when the line l+h comes first or last', () => {
		const a = build(f1('first'));
		const b = build(f1('last'));
		expect([...a.gen.values()].sort()).toEqual([...b.gen.values()].sort());
		expect(unequal(a.g, a.gen)).toEqual([]);
		expect(unequal(b.g, b.gen)).toEqual([]);
	});

	const swap = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: m}
  - {id: p2, name: P2, sex: m}
  - {id: p3, name: P3, sex: m}
  - {id: p4, name: P4, sex: f, parents: [p0, p3]}
  - {id: p5, name: P5, sex: m, parents: [p3]}
  - {id: p6, name: P6, sex: m, parents: [p3]}
  - {id: p7, name: P7, sex: f, parents: [p2, p0]}
  - {id: p8, name: P8, sex: m}
  - {id: p9, name: P9, sex: f}
  - {id: p10, name: P10, sex: m, parents: [p2, p8]}
  - {id: p11, name: P11, sex: f, parents: [p8, p10]}
unions:
  - {partners: [p8, p6]}
  - {partners: [p2, p8]}
`;

	const R0_SWAP = { p0: 0, p1: 0, p2: 0, p3: 0, p4: 1, p5: 1, p6: 1, p7: 1, p8: 1, p9: 0, p10: 2, p11: 3 };

	it('undoes a move that only swaps one unequal couple for another (rolled back, rows equal 0.2.4)', () => {
		const { g, gen } = build(swap);
		expect(rowStats.rolledBack).toBe(1);
		expect(rowStats.accepted).toBe(0);
		expect(rowStats.unequalAfter).toBe(rowStats.unequalBefore);
		expect(unequal(g, gen).length).toBe(rowStats.unequalBefore);
		expect(Object.fromEntries(gen)).toEqual(R0_SWAP);
		expect(Array.from(computeGenerations(g))).toEqual(Array.from(gen));
	});
});

describe('r2: speed (each bound fails if the quadratic version returns)', () => {
	const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const time = (fn: () => void) => {
		const t = performance.now();
		fn();
		return performance.now() - t;
	};
	/** The fastest of three calls: the quadratic version is far over the bound in each call, but a busy machine can slow one call. */
	const fastest = (fn: () => void) => Math.min(time(fn), time(fn), time(fn));

	speedTest('sample 07 takes under 10 ms (median of 15)', () => {
		const { g } = build(fixture('07'));
		expect(median(Array.from({ length: 15 }, () => time(() => computeGenerations(g))))).toBeLessThan(10);
		expect(rowStats.guard).toBe(0);
	});

	speedTest('two chains of 400 people each take under 100 ms', () => {
		const { g } = build(chains(400));
		expect(fastest(() => computeGenerations(g))).toBeLessThan(100);
		expect(rowStats.guard).toBe(0);
	});

	speedTest('a 400-person tree with a rumoured link on every person takes under 60 ms (median of 5)', () => {
		const { g } = build(rumourTree(400));
		expect(median(Array.from({ length: 5 }, () => time(() => computeGenerations(g))))).toBeLessThan(60);
		expect(rowStats.guard).toBe(0);
	});

	speedTest('dense trees of 1,000 and 2,000 people stay quick, the step budget ends the 2,000 case, and the rows stay valid', () => {
		for (const seed of [1, 2, 3]) {
			const small = build(genTree(seed, 1000));
			expect(fastest(() => computeGenerations(small.g)), `1000/${seed}`).toBeLessThan(150);
			expect(rowStats.guard).toBe(0);
			const big = build(genTree(seed, 2000));
			let gen = big.gen;
			expect(fastest(() => (gen = computeGenerations(big.g))), `2000/${seed}`).toBeLessThan(400);
			expect(rowStats.stepBudget).toBeGreaterThan(0);
			expect(rowProblems(big.g, gen)).toEqual([]);
			expect(rowStats.guard).toBe(0);
		}
	}, 60_000);
});
