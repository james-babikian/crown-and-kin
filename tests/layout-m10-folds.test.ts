import { describe, expect, it } from 'vitest';
import { foldHidden, foldKey } from '../src/core/folds';
import { foldExtent, foldSpots } from '../src/layout/fold-spots';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { block15, graphOf } from './acceptance/m10-support';

/* WP 10.2b, own checks: the sideways gap holds the whole "+ N" pill, hidden people never change the cache, extents and spots. */

const GEO = geometryFor(16, 'normal');
const g = graphOf(block15(0));
const A = foldKey(['osric', 'mathilde']);

function lay(orientation: 'down' | 'sideways', folded: string[]) {
	const hidden = foldHidden(g, new Set(folded));
	const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, ...(orientation === 'sideways' ? { orientation } : {}), foldHidden: [...hidden].sort(), foldedFamilies: folded, foldControls: true };
	clearLayoutCache();
	return layoutTree(g, GEO, settings, 'font');
}

describe('folds in the layout (WP 10.2b)', () => {
	it('sideways, the sign of a folded family ends before the next column', () => {
		const { layout } = lay('sideways', [A]);
		const sign = layout.folds!.find((c) => c.key === A)!;
		const ext = foldExtent(sign, sign.spot, 16);
		const gap = layout.rowGaps[layout.persons.get('osric')!.gen];
		// The real pill: "+ 75" is about 3.3 em wide at most.
		expect(sign.spot.x - 10 + 3.3 * 16).toBeLessThanOrEqual(gap.bottom);
		expect(ext.x + ext.w).toBeLessThanOrEqual(layout.width);
	});

	it('rows are dense and the spots lie inside the layout', () => {
		for (const o of ['down', 'sideways'] as const) {
			const { layout } = lay(o, [A]);
			expect(layout.rows.every((r) => r.length > 0)).toBe(true);
			for (const c of layout.folds!) {
				expect(c.spot.x).toBeGreaterThan(0);
				expect(c.spot.y).toBeGreaterThan(0);
				expect(c.spot.y + 22).toBeLessThanOrEqual(layout.height + 1e-6);
			}
		}
	});

	it('foldSpots leaves out a control whose parent is not in the layout', () => {
		const { layout } = lay('down', [A]);
		const gone = { key: 'x', parents: ['nobody'], folded: false, count: 0 };
		expect(foldSpots([gone], layout.persons, layout.unions, layout.rowGaps, 16)).toEqual([]);
	});

	it('the stem of a folded family with a short stem ends at the middle of the stem', () => {
		const persons = new Map([['a', { id: 'a', x: 0, y: 0, w: 100, h: 60, gen: 0 }]]);
		const spots = foldSpots([{ key: '["a"]', parents: ['a'], folded: true, count: 3 }], persons, new Map(), [{ top: 60, bottom: 80 }], 16);
		expect(spots[0].spot).toEqual({ x: 50, y: 70 });
	});
});
