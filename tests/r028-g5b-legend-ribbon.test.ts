/*
 * 0.2.8 G5b: P8 (the ribbon lies on the border circle at its lower corners, so the "gap" of 0.3 to 0.8 px that the harness measured at the straight edge is the
 * shape of the corner, not a gap), and the fit of the open legend in a short tree box (`fitLegend`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { fitLegend } from '../src/render/dom/widgets';
import { ribbonPath } from '../src/render/view-math';

describe('P8: the corners of a thin ribbon lie on the circle of the card corner', () => {
	// A thin ribbon (thickness under the radius) ends in the arc of the corner circle: its lower corner is on the circle, and so flush with the border.
	for (const [r, t] of [[7, 5], [8.5, 5], [11, 5], [8, 4], [4, 3], [24, 5]] as const) {
		it(`radius ${r}, thickness ${t}`, () => {
			const x = 10;
			const y = 20;
			const d = ribbonPath(x, y, 200, t, t, r, 'top');
			const nums = (s: string) => s.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
			// The path is: M start, H, A (right arc) ..., H, A (left arc) back to start. The lower left corner is the end of the right-to-left bottom edge.
			const arcs = [...d.matchAll(/A[^A]*?(?=[A-Z])/g)].map((m) => nums(m[0]));
			const [rx, , , , , ex, ey] = arcs[0];
			expect(rx).toBeCloseTo(r, 6);
			// Right arc end: on the circle that has its centre at (x + 200 - r, y + r).
			expect(Math.hypot(ex - (x + 200 - r), ey - (y + r))).toBeCloseTo(r, 1);
			const dx = r - Math.sqrt(r * r - (r - t) * (r - t));
			expect(ex).toBeCloseTo(x + 200 - dx, 1);
			expect(ey).toBeCloseTo(y + t, 6);
		});
	}

	it('a ribbon as thick as the radius or thicker has a straight foot on the edge (no gap)', () => {
		const d = ribbonPath(10, 20, 200, 6, 6, 5, 'top');
		expect(d).toContain('V26H10V25');
	});
});

describe('fitLegend', () => {
	const box = (scrollHeight: number, clientHeight: number) => {
		const classes: string[] = [];
		return { el: { scrollHeight, clientHeight, addClass: (c: string) => classes.push(c) } as unknown as HTMLElement, classes };
	};

	it('adds is-tight when the rows are taller than the box', () => {
		const b = box(520, 448);
		expect(fitLegend(b.el)).toBe(true);
		expect(b.classes).toEqual(['is-tight']);
	});

	it('leaves a legend that fits as it is (1 px of rounding is not a reason)', () => {
		const b = box(449, 448);
		expect(fitLegend(b.el)).toBe(false);
		expect(b.classes).toEqual([]);
	});
});
