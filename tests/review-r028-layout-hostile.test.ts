/*
 * Search round 0.2.8, area A3 (layout): a tree with a parent loop (broken by the validator) still gets a line through a far-couple tag.
 */
import { describe, expect, it } from 'vitest';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS } from '../src/layout/layout';
import { arrangeTree } from '../src/layout/pipeline';
import { build } from './helpers';
import { lineProblems } from './random-trees';

// Reduced from a fuzz tree: people who are each other's parents in a loop, plus ward and "weird" links.
const SRC = `people:
  - {id: p0, name: Np0, sex: x, parents: [p8]}
  - {id: p1, name: Np1, sex: x, parents: [p4, {id: p5, type: rumoured}, ghost], illegitimate: true}
  - {id: p2, name: Np2, sex: m, parents: [p8, p8, p9]}
  - {id: p3, name: Np3, sex: m}
  - {id: p4, name: Np4, sex: m, parents: [p0, p7, p5]}
  - {id: p5, name: Np5, sex: f, parents: [p6, {id: p12, type: weird}]}
  - {id: p6, name: Np6, sex: m, parents: [p8, {id: p10, type: ward}]}
  - {id: p7, name: "", sex: f}
  - {id: p8, name: Np8, sex: x, parents: [p7, {id: p12, type: ward}, {id: p9, type: weird}]}
  - {id: p9, name: Np9, sex: x, parents: [p3]}
  - {id: p10, name: Np10, sex: m, parents: [p12, {id: p0, type: weird}], illegitimate: true}
  - {id: p11, name: Np11, sex: m, parents: [p2, p12, ghost]}
  - {id: p12, name: Np12, sex: x, parents: [ghost, p10, p11]}
unions:
  - {partners: [p12, p11]}
  - {partners: [p10, p12]}
  - {partners: [p9, p0], type: foo}
`;

describe('a tree with a parent loop', () => {
	// F-LAYOUT-04 is a note, not chosen for 0.2.8 (FINDINGS): the proof stays, skipped.
	it.skip('draws no line through a far-couple tag (note font 8 px, top to bottom)', () => {
		const { g, gen } = build(SRC);
		const { layout, edges } = arrangeTree(g, gen, { ...cardForm(geometryFor(8), 'down') }, { ...DEFAULT_LAYOUT_SETTINGS });
		const problems = lineProblems(g, layout, edges);
		expect(problems).toEqual([]);
	});
});
