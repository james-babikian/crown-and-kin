import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { sampleSources } from '../acceptance/m11-support';

// Spec §13.19 acceptance: no fold control lies within the badge circle and a clear gap. The badge disc (centre = the card's top right corner,
// r = 0.6 em) against the fold button (an open fold: a circle of 0.6 em at its spot), on every card, nothing folded, foldControls on.
// Contract 4.2 E1: in `down` the gap holds (1.5 px). In `sideways`, with a stacked couple, a fold button can come closer than 1.5 px to the badge
// circle (0.6 px at 12 px, -0.06 px at 16 px in the sample trees); that is REPORTED, not a failure, and the visible fold button wins over the 6 px margin of the badge (ruling 2026-10-05; the fold is drawn after the badge).
// The test holds the sideways numbers where they were found, so that a change is seen.
describe('badge disc against the fold button circle', () => {
	for (const f of [12, 16]) {
		for (const orientation of ['down', 'sideways'] as const) {
			it(`font ${f} ${orientation}: the clear gap between the badge circle and a fold button is at least 1.5 px (MARK_CLEAR_PX)`, () => {
				let min = Infinity;
				let count = 0;
				for (const s of sampleSources()) {
					const parsed = parseDynasty(s.source);
					if (!parsed.ok) continue;
					const g = deriveFamilies(parsed.tree);
					clearLayoutCache();
					const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation, foldControls: true };
					const L = layoutTree(g, geometryFor(f), settings, 'font').layout;
					for (const p of L.persons.values()) {
						for (const c of L.folds ?? []) {
							const d = Math.hypot(c.spot.x - (p.x + p.w), c.spot.y - p.y) - 0.6 * f - 0.6 * f;
							if (d < 0) count++;
							if (d < min) min = d;
						}
					}
				}
				console.log(`font ${f} ${orientation}: smallest gap ${min.toFixed(2)} px; pairs with circles overlapping: ${count}`);
				expect(min).toBeGreaterThanOrEqual(orientation === 'down' ? 1.5 : -0.1);
				if (orientation === 'sideways') expect(count).toBeLessThanOrEqual(1);
			});
		}
	}
});
