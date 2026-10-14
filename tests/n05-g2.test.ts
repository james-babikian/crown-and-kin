// G2 review of the N05 fix (scratch/n05-g2). Each test fails on r030/n05-union-dot dad14ff9 and shows one defect.
import { describe, expect, it } from 'vitest';
import { foldFamilies, foldHidden, pruneGraph } from '../src/core/folds';
import { foldMark } from '../src/layout/fold-spots';
import { cardForm, geometryFor, lineMetrics } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../src/layout/index';
import { planLines } from '../src/layout/lines';
import { build } from './helpers';
import { lineProblems, randomTree } from './random-trees';

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

/** The x of the last vertical run of a path: where the leg reaches the line of the dot's row (as in an internal test). */
function column(d: string): number {
	let x = 0;
	let col = 0;
	for (const m of d.matchAll(/([MHV])(-?[\d.]+)/g)) {
		if (m[1] === 'M' || m[1] === 'H') x = Number(m[2]);
		if (m[1] === 'V') col = x;
	}
	return col;
}

describe('G2 finding 1: the dot stays outside its legs when the span between them is crowded', () => {
	it('random tree 204: the dot of p5 + p8 (rows 2 and 3) lies between the columns of its two legs', () => {
		const { g } = build(randomTree(204));
		clearLayoutCache();
		const { layout, edges } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR }, 'x');
		const fu = g.unions.find((u) => u.partners.includes('p5') && u.partners.includes('p8'))!;
		const u = layout.unions.get(fu.key)!;
		expect(u.bar || u.far).toBe(false);
		expect(layout.persons.get('p5')!.gen).not.toBe(layout.persons.get('p8')!.gen);
		const cols = edges.paths.filter((p) => p.union === fu.key && p.kind !== 'descent' && p.people.length === 2).map((p) => column(p.d));
		expect(cols).toHaveLength(2);
		expect(u.x).toBeGreaterThanOrEqual(Math.min(...cols) - 0.5);
		expect(u.x).toBeLessThanOrEqual(Math.max(...cols) + 0.5);
	});

	it('random trees 1 to 400 at 16 px: no dot of partners on two rows lies outside the columns of its legs', () => {
		const stubs: string[] = [];
		for (let seed = 1; seed <= 400; seed++) {
			const { g } = build(randomTree(seed));
			clearLayoutCache();
			const { layout, edges } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR }, 'x');
			for (const fu of g.unions) {
				const u = layout.unions.get(fu.key)!;
				const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
				if (u.bar || u.far || a.gen === b.gen) continue;
				const cols = edges.paths.filter((p) => p.union === fu.key && p.kind !== 'descent' && p.people.length === 2).map((p) => column(p.d));
				if (cols.length === 2 && (u.x < Math.min(...cols) - 0.5 || u.x > Math.max(...cols) + 0.5)) stubs.push(`seed ${seed} ${fu.key}`);
			}
		}
		expect(stubs).toEqual([]);
	});
});

describe('G2 finding 2: a moved dot can land on the sign of another folded family', () => {
	it('random tree 293, every 4th family folded: no union dot lies inside the "+ N" sign of another union', () => {
		const { g } = build(randomTree(293));
		const fams = foldFamilies(g).filter((_, i) => i % 4 === 1).map((x) => x.key);
		const hidden = foldHidden(g, new Set(fams));
		clearLayoutCache();
		const { layout, edges } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR, foldControls: true, foldedFamilies: fams, foldHidden: [...hidden].sort() }, 'x');
		const r = layout.geometry.unionSize / 2;
		const hits: string[] = [];
		for (const c of layout.folds ?? []) {
			if (!c.folded) continue;
			const k = foldMark(c, c.spot, layout.geometry.fontPx, false);
			for (const m of edges.markers) {
				if (m.union === undefined || m.union === c.union) continue;
				const dx = Math.max(Math.min(k.x1, k.x2) - m.x, 0, m.x - Math.max(k.x1, k.x2));
				const dy = Math.max(Math.min(k.y1, k.y2) - m.y, 0, m.y - Math.max(k.y1, k.y2));
				if (Math.hypot(dx, dy) < k.r + r) hits.push(`dot ${m.union} at ${m.x.toFixed(1)},${m.y.toFixed(1)} on the sign of ${c.key}`);
			}
		}
		expect(hits).toEqual([]);
	});
});

describe('G2 finding 3: the lane of a moved dot still holds the stretch the dot has left', () => {
	/** The couple lanes of each gap, found again by the first-fit rule of `pack` from the lines that are really drawn. */
	function lanesFromDrawnRuns(seed: number): { plan: number[]; drawn: number[] } {
		const { g, order } = build(randomTree(seed));
		clearLayoutCache();
		const { layout } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR }, 'x');
		const plan = planLines({ g, persons: layout.persons, rows: layout.rows, unions: layout.unions, anchors: order.anchors, geo: layout.geometry });
		const margin = lineMetrics(layout.geometry).laneMargin;
		const runs: { gap: number; lo: number; hi: number }[] = [];
		for (const fu of g.unions) {
			if (!plan.dots.has(fu.key)) continue;
			const mine = plan.legs.filter((l) => l.union === fu.key);
			for (const leg of mine) {
				let cur = leg.startX;
				for (const hop of leg.hops) {
					runs.push({ gap: hop.gap, lo: Math.min(cur, hop.x), hi: Math.max(cur, hop.x) });
					cur = hop.x;
				}
			}
			const xs = [plan.dotX.get(fu.key) ?? layout.unions.get(fu.key)!.x, ...mine.map((l) => l.entryX)];
			runs.push({ gap: plan.dots.get(fu.key)!.gap, lo: Math.min(...xs), hi: Math.max(...xs) });
		}
		const drawn = plan.coupleLanes.map(() => 0);
		for (let gap = 0; gap < drawn.length; gap++) {
			const laneEnd: number[] = [];
			for (const r of runs.filter((x) => x.gap === gap).sort((a, b) => a.lo - b.lo)) {
				let lane = laneEnd.findIndex((end) => end + margin < r.lo);
				if (lane === -1) lane = laneEnd.length;
				laneEnd[lane] = r.hi;
			}
			drawn[gap] = laneEnd.length;
		}
		return { plan: plan.coupleLanes, drawn };
	}

	it('random tree 22: the gap needs as many couple lanes as the lines drawn in it', () => {
		const { plan, drawn } = lanesFromDrawnRuns(22);
		expect(plan).toEqual(drawn);
	});
});

// Made-up trees (written out from a seeded generator of the review) with fold controls on, as the tree view has them.
const FOLD_A = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: f}
  - {id: p2, name: P2, sex: f}
  - {id: p3, name: P3, sex: f, parents: [p2]}
  - {id: p4, name: P4, sex: m, parents: [p0, p1]}
  - {id: p5, name: P5, sex: m, parents: [p4, p2]}
  - {id: p6, name: P6, sex: m, parents: [p3]}
  - {id: p7, name: P7, sex: m}
  - {id: p8, name: P8, sex: m, parents: [p0, p4]}
  - {id: p9, name: P9, sex: f, parents: [p3, p7]}
  - {id: p10, name: P10, sex: f, parents: [p5]}
  - {id: p11, name: P11, sex: f, parents: [p0, p4]}
  - {id: p12, name: P12, sex: f, parents: [p8, p3]}
  - {id: p13, name: P13, sex: f, parents: [p7, p1]}
  - {id: p14, name: P14, sex: f, parents: [p12, p4]}
  - {id: p15, name: P15, sex: m, parents: [p3, p13]}
  - {id: p16, name: P16, sex: m, parents: [p7, p11]}
  - {id: p17, name: P17, sex: m, parents: [p14]}
  - {id: p18, name: P18, sex: m, parents: [p8, p9]}
  - {id: p19, name: P19, sex: m, parents: [p7, p12]}
  - {id: p20, name: P20, sex: m, parents: [p11, p19]}
  - {id: p21, name: P21, sex: m, parents: [p13, p9]}
  - {id: p22, name: P22, sex: m, parents: [p21, p16]}
unions:
  - {partners: [p5, p2]}
  - {partners: [p6, p0]}
  - {partners: [p10, p1]}
  - {partners: [p12, p0]}
  - {partners: [p15, p5]}
  - {partners: [p16, p4]}
  - {partners: [p19, p8]}
  - {partners: [p22, p14]}
`;
const FOLD_B = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: m}
  - {id: p2, name: P2, sex: m}
  - {id: p3, name: P3, sex: f, parents: [p1]}
  - {id: p4, name: P4, sex: f, parents: [p0, p2]}
  - {id: p5, name: P5, sex: f, parents: [p2]}
  - {id: p6, name: P6, sex: m, parents: [p2, p1]}
  - {id: p7, name: P7, sex: f}
  - {id: p8, name: P8, sex: m, parents: [p0]}
  - {id: p9, name: P9, sex: m, parents: [p3, p1]}
  - {id: p10, name: P10, sex: m}
  - {id: p11, name: P11, sex: f, parents: [p4, p7]}
  - {id: p12, name: P12, sex: m, parents: [p11, p4]}
  - {id: p13, name: P13, sex: f, parents: [p9, p8]}
  - {id: p14, name: P14, sex: m, parents: [p8, p3]}
  - {id: p15, name: P15, sex: f, parents: [p4, p13]}
  - {id: p16, name: P16, sex: f}
  - {id: p17, name: P17, sex: f, parents: [p14, p16]}
  - {id: p18, name: P18, sex: m, parents: [p11, p13]}
  - {id: p19, name: P19, sex: f, parents: [p13, p9]}
  - {id: p20, name: P20, sex: m}
  - {id: p21, name: P21, sex: f, parents: [p14, p15]}
  - {id: p22, name: P22, sex: f, parents: [p12, p13]}
  - {id: p23, name: P23, sex: f, parents: [p22, p12]}
  - {id: p24, name: P24, sex: f, parents: [p12, p23]}
  - {id: p25, name: P25, sex: f, parents: [p17, p19]}
  - {id: p26, name: P26, sex: m, parents: [p22]}
  - {id: p27, name: P27, sex: f, parents: [p24, p17]}
unions:
  - {partners: [p2, p0]}
  - {partners: [p4, p0]}
  - {partners: [p5, p0]}
  - {partners: [p6, p2]}
  - {partners: [p9, p0]}
  - {partners: [p10, p6]}
  - {partners: [p11, p9]}
  - {partners: [p14, p11]}
  - {partners: [p16, p7]}
  - {partners: [p17, p10]}
  - {partners: [p18, p6]}
  - {partners: [p20, p19]}
  - {partners: [p21, p8]}
  - {partners: [p24, p15]}
  - {partners: [p26, p24]}
`;

describe('G2 finding 4: the router plan starts a moved dot from a recomputed place, so a tie can fall the other way', () => {
	// With fold controls the layout moves every card by one amount after the first plan (room for a control). The first plan read the dot at its old
	// place (a card centre exactly, 90 against 90); the router's plan finds it again from the moved cards ("home" in lines.ts) and gets 99.19999999999999
	// against 99.2, so a leg of p0 leaves the other side of the card and crosses the tag zone that the layout kept free.
	const problems = (src: string) => {
		const { g } = build(src);
		const fams = foldFamilies(g).filter((_, i) => i % 4 === 1).map((x) => x.key);
		const hidden = foldHidden(g, new Set(fams));
		clearLayoutCache();
		const geo = cardForm(geometryFor(16), 'down');
		const { layout, edges } = layoutTree(g, geo, { sweeps: 4, far: FAR, foldControls: true, foldedFamilies: fams, foldHidden: [...hidden].sort() }, 'x');
		return lineProblems(pruneGraph(g, hidden), layout, edges);
	};

	it('tree A: no line passes through the tag of a card', () => {
		expect(problems(FOLD_A)).toEqual([]);
	});

	it('tree B: no dot lies on the line of another couple and no two families share a stretch', () => {
		expect(problems(FOLD_B)).toEqual([]);
	});
});
