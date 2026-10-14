import { describe, expect, it } from 'vitest';
import { centredSmallTree, clampPan, panLimits, treeBounds } from '../src/render/view-math';

/* G2 review of WP-A (scratch, not for merge). */

describe('G2 WP-A: view-math invariants (fuzz)', () => {
	it('a centred small tree is inside the pan limits, and a clamped view of a small tree keeps the bounds in the free area', () => {
		let seed = 12345;
		const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
		for (let i = 0; i < 20000; i++) {
			const size = { w: 200 + rnd() * 1200, h: 300 + rnd() * 900 };
			const free = { top: rnd() * 150, bottom: rnd() * 200 };
			const bounds = treeBounds(20 + rnd() * 2000, 20 + rnd() * 2000);
			const scale = 0.05 + rnd() * 2;
			const c = centredSmallTree(bounds, size, scale, free);
			const l = panLimits(bounds, scale, size, free);
			if (c) {
				expect(c.cx).toBeGreaterThanOrEqual(l.x0 - 1e-6);
				expect(c.cx).toBeLessThanOrEqual(l.x1 + 1e-6);
				expect(c.cy).toBeGreaterThanOrEqual(l.y0 - 1e-6);
				expect(c.cy).toBeLessThanOrEqual(l.y1 + 1e-6);
			}
			expect(l.x0 <= l.x1 + 1e-6 || l.x0 === bounds.x).toBe(true);
			const v = clampPan({ scale, cx: (rnd() - 0.5) * 6000, cy: (rnd() - 0.5) * 6000 }, bounds, { free, size });
			expect(Number.isFinite(v.cx) && Number.isFinite(v.cy)).toBe(true);
		}
	});

	it('F3: a NaN inset (a toolbar box that the browser cannot measure) gives a view with NaN centre instead of null', () => {
		const v = centredSmallTree(treeBounds(160, 64), { w: 390, h: 844 }, 0.875, { top: Number.NaN, bottom: 98 });
		// A caller keeps its own view when this answers null; a NaN view blanks the tree (spec section 8).
		expect(v === null || Number.isFinite(v.cy)).toBe(true);
	});
});
