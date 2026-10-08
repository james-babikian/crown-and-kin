import { describe, expect, it } from 'vitest';
import { geometryFor } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../src/layout/index';
import { build } from './helpers';
import { lineProblems } from './random-trees';

// s024 L2: sideways cards with three-line names put a union dot on another couple's line.

const SRC = `people:
  - {id: p0, sex: m}
  - {id: p1, sex: f}
  - {id: p2, sex: f, parents: [p0]}
  - {id: p3, sex: f, parents: [p2, p1]}
  - {id: p4, sex: f, parents: [p0, {id: p3, type: ward}], illegitimate: true}
  - {id: p5, sex: m, parents: [p2, p3]}
  - {id: p6, sex: f}
  - {id: p7, sex: m, parents: [p6, p1]}
  - {id: p8, sex: f, parents: [p1, p2]}
  - {id: p10, sex: f}
  - {id: p11, sex: m}
  - {id: p12, sex: f, parents: [p8, p11]}
  - {id: p13, sex: m, parents: [{id: p5, type: adoptive}, p8]}
  - {id: p14, sex: m, parents: [p8]}
  - {id: p15, sex: f}
  - {id: p16, sex: f, parents: [p6]}
  - {id: p17, sex: m}
  - {id: p18, sex: f, parents: [p4, p3]}
  - {id: p19, sex: m, parents: [p10], illegitimate: true}
unions:
  - {partners: [p1, p0]}
  - {partners: [p8, p6]}
  - {partners: [p18, p13]}
  - {partners: [p19, p1]}
`;
const FAR = { maxCardWidths: 3, maxGenerations: 1 };
const LONG = ['p0', 'p6', 'p12', 'p18'];

describe('s024 L2: three-line names in sideways cards', () => {
	it('control: without long names there is no line problem', () => {
		const { g } = build(SRC);
		clearLayoutCache();
		const { layout, edges } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR, orientation: 'sideways' }, 'x');
		expect(lineProblems(g, layout, edges)).toEqual([]);
	});
	it('no union dot lies on the line of another couple', () => {
		const { g } = build(SRC);
		clearLayoutCache();
		const { layout, edges } = layoutTree(g, geometryFor(16), { sweeps: 4, far: FAR, orientation: 'sideways', tallCards: LONG, longNames: LONG }, 'x');
		expect(lineProblems(g, layout, edges)).toEqual([]);
	});
});
