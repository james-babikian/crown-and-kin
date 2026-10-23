import { describe, expect, it } from 'vitest';
import { foldHidden, foldKey } from '../../src/core/folds';
import { foldExtent } from '../../src/layout/fold-spots';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../../src/layout/index';
import type { LayoutSettings, Rect } from '../../src/layout/model';
import { drawFold } from '../../src/render/dom/folds';
import { approxMeasure } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { block15, graphOf } from '../acceptance/m10-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * M10 fix round (V2, V4): no fold control's hit area lies on another control's, and no visible "+ N" sign (Full and
 * Overview) lies on a far-couple tag's hit area. WP-Q (0.3): the tag check compares the drawn sign marks, not
 * `foldExtent`, which is a worst-case bound (1.5 em per character plus the 44 px squares); at run time the tag wins
 * and the fold's tap area is cut back (`cutBack`). The bound met Wanda's tag in "sideways, folds A" after the WP-Q
 * placement step although the drawn signs keep clear (G2 of WP-Q).
 */

useFakeDom();
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };

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
	return layoutTree(g, geometryFor(16), { ...settings, foldHidden: [...hidden].sort(), foldedFamilies: folded, foldControls: true }, 'font');
}

const meet = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;

describe('fold controls keep clear of tags and of each other (fixture 15)', () => {
	for (const [view, settings] of VIEWS) {
		for (const [label, parents] of SETS) {
			it(`${view}, folds ${label}`, () => {
				const { layout, edges } = lay(settings, parents);
				const folds = layout.folds ?? [];
				const boxes = folds.map((c) => foldExtent(c, c.spot, 16, layout.orientation === 'sideways'));
				const hits: string[] = [];
				for (const [i, c] of folds.entries()) {
					if (c.folded) {
						const ref = drawFold({ controls: new FEl('g') as never, hits: new FEl('g') as never, fonts: FONTS, measure: approxMeasure, em: 16, label: 'x', fitters: [], ...(layout.orientation === 'sideways' ? { anchored: true } : {}) }, c);
						for (const t of layout.farTags.values()) {
							if (meet(ref.mark, t.hit)) hits.push(`${c.key} sign on the tag of ${t.person}`);
							if (ref.markOverview && meet(ref.markOverview, t.hit)) hits.push(`${c.key} overview sign on the tag of ${t.person}`);
						}
					} else {
						for (const t of layout.farTags.values()) if (meet(boxes[i], t.hit)) hits.push(`${c.key} on the tag of ${t.person}`);
					}
					for (let j = i + 1; j < folds.length; j++) if (meet(boxes[i], boxes[j])) hits.push(`${c.key} on ${folds[j].key}`);
				}
				expect(hits).toEqual([]);
				// The stem of a folded family ends at its spot, and the room follows: the drawing holds every hit area.
				for (const c of folds) {
					const box = foldExtent(c, c.spot, 16, layout.orientation === 'sideways');
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
