// G2b review of the N05 fix round (scratch/n05-g2b). Each test fails on r030/n05-union-dot 36fa950e and shows one defect.
// Both come from one cause: when no place in the span of the legs is free, `moveDotIntoLegs` takes an entry of a leg without the checks
// that `clear` makes (a line of another family through the gap, the "+ N" sign of a folded family): `entries.find(...) ?? entries[0]`.
import { describe, expect, it } from 'vitest';
import { foldFamilies, foldHidden, pruneGraph } from '../../src/core/folds';
import { foldMark } from '../../src/layout/fold-spots';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { build } from '../support/helpers';
import { lineProblems, randomTree } from '../support/random-trees';

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

function sideways(src: string) {
	const { g } = build(src);
	clearLayoutCache();
	const settings: LayoutSettings = { sweeps: 4, far: FAR, orientation: 'sideways' };
	const { layout, edges } = layoutTree(g, cardForm(geometryFor(16), 'sideways'), settings, 'x');
	return lineProblems(g, layout, edges);
}

describe('G2b finding 1: the fallback puts a dot on a line of another family (sideways tree)', () => {
	it('random tree 3863: no dot lies on the marriage line of another couple', () => {
		expect(sideways(randomTree(3863))).toEqual([]);
	});

	it('made-up tree (dense seed 116): no dot lies on a line of another family', () => {
		expect(sideways(DENSE_116)).toEqual([]);
	});
});

describe('G2b finding 2: the fallback ignores the "+ N" sign of a folded family (top-to-bottom tree, fold controls on)', () => {
	it('made-up tree (dense seed 351, every 3rd family folded, 24 px): no union dot lies inside the sign of another union', () => {
		const { g } = build(DENSE_351);
		const fams = foldFamilies(g)
			.filter((_, i) => i % 3 === 1)
			.map((x) => x.key);
		const hidden = foldHidden(g, new Set(fams));
		clearLayoutCache();
		const settings: LayoutSettings = { sweeps: 4, far: FAR, foldControls: true, foldedFamilies: fams, foldHidden: [...hidden].sort() };
		const { layout, edges } = layoutTree(g, cardForm(geometryFor(24), 'down'), settings, 'x');
		expect(lineProblems(pruneGraph(g, hidden), layout, edges)).toEqual([]);
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

const DENSE_116 = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: m}
  - {id: p2, name: P2, sex: f, parents: [p0, p1]}
  - {id: p3, name: P3, sex: m, parents: [p2, p1]}
  - {id: p4, name: P4, sex: m, parents: [p0, p1]}
  - {id: p5, name: P5, sex: f, parents: [p2]}
  - {id: p6, name: P6, sex: f, parents: [p2, p5]}
  - {id: p7, name: P7, sex: f, parents: [p6, p0]}
  - {id: p8, name: P8, sex: m, parents: [p2, p0]}
  - {id: p9, name: P9, sex: m, parents: [p3, p5]}
  - {id: p10, name: P10, sex: f, parents: [p4, p6]}
  - {id: p11, name: P11, sex: f, parents: [p10, p2]}
  - {id: p12, name: P12, sex: f, parents: [p2, p3]}
  - {id: p13, name: P13, sex: m, parents: [p6, p12]}
  - {id: p14, name: P14, sex: m, parents: [p8, p1]}
  - {id: p15, name: P15, sex: m, parents: [p9, p5]}
  - {id: p16, name: P16, sex: f, parents: [p9]}
  - {id: p17, name: P17, sex: m}
  - {id: p18, name: P18, sex: m, parents: [p4]}
  - {id: p19, name: P19, sex: f, parents: [p9, p10]}
  - {id: p20, name: P20, sex: f, parents: [p5, p19]}
  - {id: p21, name: P21, sex: m, parents: [p14, p10]}
  - {id: p22, name: P22, sex: m}
  - {id: p23, name: P23, sex: f, parents: [p0, p9]}
  - {id: p24, name: P24, sex: f}
  - {id: p25, name: P25, sex: m, parents: [p14, p0]}
  - {id: p26, name: P26, sex: m, parents: [p8, p9]}
  - {id: p27, name: P27, sex: m, parents: [p8, p9]}
  - {id: p28, name: P28, sex: f}
  - {id: p29, name: P29, sex: f, parents: [p2, p9]}
  - {id: p30, name: P30, sex: f, parents: [p22, p17]}
  - {id: p31, name: P31, sex: m, parents: [p21, p25]}
unions:
  - {partners: [p1, p0]}
  - {partners: [p4, p1]}
  - {partners: [p7, p2]}
  - {partners: [p8, p3]}
  - {partners: [p9, p7]}
  - {partners: [p10, p2]}
  - {partners: [p11, p6]}
  - {partners: [p13, p0]}
  - {partners: [p15, p5]}
  - {partners: [p16, p9]}
  - {partners: [p20, p9]}
  - {partners: [p23, p7]}
  - {partners: [p24, p3]}
  - {partners: [p25, p15]}
  - {partners: [p28, p16]}
  - {partners: [p29, p14]}
  - {partners: [p31, p18]}
`;
const DENSE_351 = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p1, name: P1, sex: m}
  - {id: p2, name: P2, sex: f, parents: [p1, p0]}
  - {id: p3, name: P3, sex: m, parents: [p1]}
  - {id: p4, name: P4, sex: f, parents: [p2, p1]}
  - {id: p5, name: P5, sex: m, parents: [p0, p3]}
  - {id: p6, name: P6, sex: f, parents: [p4]}
  - {id: p7, name: P7, sex: m, parents: [p4]}
  - {id: p8, name: P8, sex: m, parents: [p3]}
  - {id: p9, name: P9, sex: m, parents: [p6, p0]}
  - {id: p10, name: P10, sex: f, parents: [p5, p0]}
  - {id: p11, name: P11, sex: m, parents: [p8, p4]}
  - {id: p12, name: P12, sex: f}
  - {id: p13, name: P13, sex: f, parents: [p8]}
  - {id: p14, name: P14, sex: m, parents: [p8, p12]}
  - {id: p15, name: P15, sex: m, parents: [p9]}
  - {id: p16, name: P16, sex: m, parents: [p13, p3]}
  - {id: p17, name: P17, sex: m, parents: [p2, p4]}
  - {id: p18, name: P18, sex: m, parents: [p6, p5]}
  - {id: p19, name: P19, sex: m, parents: [p18, p12]}
  - {id: p20, name: P20, sex: m, parents: [p4, p11]}
  - {id: p21, name: P21, sex: f, parents: [p11, p5]}
  - {id: p22, name: P22, sex: f, parents: [p11, p10]}
  - {id: p23, name: P23, sex: f, parents: [p7, p17]}
  - {id: p24, name: P24, sex: m, parents: [p2, p18]}
  - {id: p25, name: P25, sex: f}
  - {id: p26, name: P26, sex: f, parents: [p24, p25]}
  - {id: p27, name: P27, sex: m, parents: [p9]}
  - {id: p28, name: P28, sex: f, parents: [p25, p4]}
  - {id: p29, name: P29, sex: m, parents: [p14]}
  - {id: p30, name: P30, sex: f, parents: [p20, p3]}
  - {id: p31, name: P31, sex: m}
  - {id: p32, name: P32, sex: f}
unions:
  - {partners: [p1, p0]}
  - {partners: [p2, p0]}
  - {partners: [p8, p3]}
  - {partners: [p9, p2]}
  - {partners: [p10, p3]}
  - {partners: [p12, p1]}
  - {partners: [p14, p0]}
  - {partners: [p16, p7]}
  - {partners: [p19, p11]}
  - {partners: [p20, p9]}
  - {partners: [p25, p21]}
  - {partners: [p29, p14]}
  - {partners: [p30, p29]}
  - {partners: [p31, p29]}
  - {partners: [p32, p13]}
`;
