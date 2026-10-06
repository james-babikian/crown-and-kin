import { describe, expect, it } from 'vitest';
import { foldHidden, foldKey } from '../src/core/folds';
import { foldExtent } from '../src/layout/fold-spots';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../src/layout/index';
import type { LayoutSettings, Rect } from '../src/layout/model';
import { block15, graphOf } from './acceptance/m10-support';

/* M10 fix round (V2, V4): no fold control's hit area lies on a far-couple tag or on the hit area of another control. */

const g = graphOf(block15(0));
const VIEWS: [string, LayoutSettings][] = [
	['down', DEFAULT_LAYOUT_SETTINGS],
	['sideways', { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' }],
];
const SETS: [string, string[][]][] = [
	['A', [['osric', 'mathilde']]],
	['A+B', [['osric', 'mathilde'], ['ulric', 'agnes']]],
	['NEST+IMPL', [['hadrian', 'elinor'], ['matthias', 'rosalind']]],
	['TWO2+BQ', [['corwin', 'wanda'], ['godric', 'wanda']]],
	['COUSIN+SOLO', [['clarice', 'dorian'], ['beatrix']]],
	['GODRIC', [['godric', 'clarice']]],
	['WANDA', [['wanda']]],
];

function lay(settings: LayoutSettings, parents: string[][]) {
	const folded = parents.map((p) => foldKey(p));
	const hidden = foldHidden(g, new Set(folded));
	clearLayoutCache();
	return layoutTree(g, geometryFor(16, 'normal'), { ...settings, foldHidden: [...hidden].sort(), foldedFamilies: folded, foldControls: true }, 'font');
}

const meet = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

describe('fold controls keep clear of tags and of each other (fixture 15)', () => {
	for (const [view, settings] of VIEWS) {
		for (const [label, parents] of SETS) {
			it(`${view}, folds ${label}`, () => {
				const { layout, edges } = lay(settings, parents);
				const folds = layout.folds ?? [];
				const boxes = folds.map((c) => foldExtent(c, c.spot, 16));
				const hits: string[] = [];
				for (const [i, c] of folds.entries()) {
					for (const t of layout.farTags.values()) if (meet(boxes[i], t.hit)) hits.push(`${c.key} on the tag of ${t.person}`);
					for (let j = i + 1; j < folds.length; j++) if (meet(boxes[i], boxes[j])) hits.push(`${c.key} on ${folds[j].key}`);
				}
				expect(hits).toEqual([]);
				// The stem of a folded family ends at its spot, and the room follows: the drawing holds every hit area.
				for (const c of folds) {
					const box = foldExtent(c, c.spot, 16);
					expect(box.x).toBeGreaterThanOrEqual(-1e-6);
					expect(box.y).toBeGreaterThanOrEqual(-1e-6);
					expect(box.x + box.w).toBeLessThanOrEqual(layout.width + 1e-6);
					expect(box.y + box.h).toBeLessThanOrEqual(layout.height + 1e-6);
					if (!c.folded) continue;
					const stem = edges.paths.find((p) => p.kind === 'descent' && p.parents?.join() === c.parents.join());
					const end = stem?.d.match(/([\d.]+)$/);
					expect(end && Number(end[1]), `${c.key} stem`).toBeCloseTo(view === 'down' ? c.spot.y : c.spot.x, 2);
				}
			});
		}
	}
});
