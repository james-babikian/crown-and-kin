import { describe, expect, it } from 'vitest';
import { foldHidden, pruneGraph } from '../src/core/folds';
import { geometryFor } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { build } from './helpers';
import { lineProblems } from './random-trees';

// s024 L1: with fold controls on, the stem and the sign of a folded family run on the line or the dot of another family.

const F = { maxCardWidths: 3, maxGenerations: 1 };

// p8's family is folded (child p9 hidden). Its stem drops at p8's middle, where the p5+p0 trunk to p6 also runs.
const STEM_ON_TRUNK = `people:
  - {id: p0, name: P0, sex: m}
  - {id: p2, name: P2, sex: f}
  - {id: p5, name: P5, sex: f}
  - {id: p6, name: P6, sex: m, parents: [p5, p0]}
  - {id: p8, name: P8, sex: f}
  - {id: p9, name: P9, sex: m, parents: [{id: p0, type: adoptive}, p8]}
unions:
  - {partners: [p2, p0]}
  - {partners: [p8, p0]}
`;
const DOT_ON_STEM = `people:
  - {id: p0, sex: m, illegitimate: true}
  - {id: p1, sex: m}
  - {id: p2, sex: f}
  - {id: p3, sex: f, parents: [p2, p1]}
  - {id: p6, sex: f, parents: [p2, p0]}
  - {id: p8, sex: f, parents: [p0]}
unions:
  - {partners: [p1, p0]}
`;
const SIDE_DOT_ON_STEM = `people:
  - {id: p0, sex: f}
  - {id: p1, sex: m}
  - {id: p2, sex: f, parents: [{id: p1, type: adoptive}]}
  - {id: p3, sex: m, parents: [p0, {id: p2, type: adoptive}]}
  - {id: p4, sex: m, parents: [{id: p0, type: adoptive}, {id: p3, type: ward}]}
unions:
  - {partners: [p1, p0]}
  - {partners: [p3, p1]}
`;

function problems(src: string, folded: string[], orientation: 'down' | 'sideways', controls: boolean) {
	const { g } = build(src);
	const hidden = foldHidden(g, new Set(folded));
	const s: LayoutSettings = { sweeps: 4, far: F, orientation, foldHidden: [...hidden].sort(), foldedFamilies: folded, ...(controls ? { foldControls: true as const } : {}) };
	clearLayoutCache();
	const { layout, edges } = layoutTree(g, geometryFor(16), s, 'x');
	return lineProblems(pruneGraph(g, hidden), layout, edges);
}

describe('s024 L1: folded-family stems and signs keep clear of other lines', () => {
	it('control: the same trees without fold controls have no line problems', () => {
		expect(problems(STEM_ON_TRUNK, ['["p8"]'], 'down', false)).toEqual([]);
		expect(problems(DOT_ON_STEM, ['["p0"]'], 'down', false)).toEqual([]);
		expect(problems(SIDE_DOT_ON_STEM, ['["p1"]'], 'sideways', false)).toEqual([]);
	});
	it('down: the stem of a folded family does not share a stretch with another family trunk', () => {
		expect(problems(STEM_ON_TRUNK, ['["p8"]'], 'down', true)).toEqual([]);
	});
	it('down: the stem of a folded family does not share a stretch with another trunk (second tree)', () => {
		expect(problems(DOT_ON_STEM, ['["p0"]'], 'down', true)).toEqual([]);
	});
	it('sideways: no union dot lies on the stem of a folded family', () => {
		expect(problems(SIDE_DOT_ON_STEM, ['["p1"]'], 'sideways', true)).toEqual([]);
	});
});
