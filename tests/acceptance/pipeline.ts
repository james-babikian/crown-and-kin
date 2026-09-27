import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import { geometryFor } from '../../src/layout/geometry';
import { layoutTree } from '../../src/layout/index';
import type { EdgeDrawing, Geometry, LayoutSettings, TreeLayout } from '../../src/layout/model';

/** Spec defaults for D10 (§5.3) and the 4 centring rounds of §5.1 step 4. */
export const SETTINGS: LayoutSettings = { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 } };
export const FONT_FAMILY = 'sans-serif';

let geo: Geometry | undefined;
export const geometry = (): Geometry => (geo ??= geometryFor(16, 'normal'));

export interface Built {
	tree: Tree;
	g: FamilyGraph;
	layout: TreeLayout;
	edges: EdgeDrawing;
}

export function layOut(source: string): Built {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	const g = deriveFamilies(r.tree);
	const { layout, edges } = layoutTree(g, geometry(), SETTINGS, FONT_FAMILY);
	return { tree: r.tree, g, layout, edges };
}
