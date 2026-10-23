import { describe, expect, it } from 'vitest';
import { FILL_MS, covers, fillDue, gestureMatrix, gestureTransform } from '../../src/render/dom/pan-zoom';
import { pinchView, type Size, type View } from '../../src/render/view-math';
import { rng } from '../support/rng';

/** Screen point of tree point `p` in `v` (the scene transform of `transformFor`). */
const screen = (v: View, p: { x: number; y: number }, s: Size) => ({ x: (p.x - v.cx) * v.scale + s.w / 2, y: (p.y - v.cy) * v.scale + s.h / 2 });

describe('gestureTransform (WP5.3, spec §7.6: a CSS transform on a wrapper during a pinch)', () => {
	it('shows every tree point where the real view would draw it', () => {
		const next = rng(53);
		for (let i = 0; i < 200; i++) {
			const size: Size = { w: 200 + next() * 1400, h: 200 + next() * 900 };
			const drawn: View = { scale: 0.05 + next() * 3, cx: next() * 4000 - 500, cy: next() * 2000 - 300 };
			const view: View = { scale: 0.05 + next() * 3, cx: next() * 4000 - 500, cy: next() * 2000 - 300 };
			const { k, tx, ty } = gestureTransform(drawn, view, size);
			for (let j = 0; j < 5; j++) {
				const p = { x: next() * 5000 - 800, y: next() * 3000 - 500 };
				const q = screen(drawn, p, size);
				const want = screen(view, p, size);
				expect(k * q.x + tx).toBeCloseTo(want.x, 6);
				expect(k * q.y + ty).toBeCloseTo(want.y, 6);
			}
		}
	});

	it('is the identity when the view has not changed', () => {
		const v: View = { scale: 0.37, cx: 812, cy: 240 };
		expect(gestureTransform(v, v, { w: 390, h: 844 })).toEqual({ k: 1, tx: 0, ty: 0 });
		expect(gestureMatrix(v, v, { w: 390, h: 844 })).toBe('matrix(1, 0, 0, 1, 0, 0)');
	});

	it('keeps the tree point under the fingers there during a pinch', () => {
		const size: Size = { w: 390, h: 844 };
		const start: View = { scale: 0.3, cx: 1500, cy: 900 };
		const from: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 150, y: 400 }, { x: 230, y: 400 }];
		const to: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 40, y: 420 }, { x: 360, y: 420 }];
		const view = pinchView(start, from, to, size, { min: 0.1, max: 4 });
		const { k, tx, ty } = gestureTransform(start, view, size);
		// The picture point under the first midpoint (190, 400) moves to the new midpoint (200, 420).
		expect(k * 190 + tx).toBeCloseTo(200, 6);
		expect(k * 400 + ty).toBeCloseTo(420, 6);
		expect(k).toBeCloseTo(4, 6);
	});

	it('writes a CSS matrix with rounded numbers', () => {
		const m = gestureMatrix({ scale: 0.3, cx: 100, cy: 50 }, { scale: 0.9, cx: 120.123456, cy: 40 }, { w: 400, h: 300 });
		expect(m).toMatch(/^matrix\(3, 0, 0, 3, -?\d+(\.\d{1,3})?, -?\d+(\.\d{1,3})?\)$/);
	});
});

describe('covers (the wrapper of a pinch only while it shows the drawn picture)', () => {
	const size: Size = { w: 390, h: 844 };
	const drawn: View = { scale: 0.25, cx: 1200, cy: 800 };

	it('a view is covered by itself, a closer view inside it is covered, a wider or moved one is not', () => {
		expect(covers(drawn, drawn, size)).toBe(true);
		expect(covers(drawn, { scale: 0.5, cx: 1200, cy: 800 }, size)).toBe(true);
		expect(covers(drawn, { scale: 0.2, cx: 1200, cy: 800 }, size)).toBe(false);
		expect(covers(drawn, { scale: 0.25, cx: 1210, cy: 800 }, size)).toBe(false);
		// Half a screen px of drift is allowed (rounding).
		expect(covers(drawn, { scale: 0.25, cx: 1200 + 0.4 / 0.25, cy: 800 }, size)).toBe(true);
	});
});

describe('fillDue (owner decision D19: fill empty space about every 250 ms during a pinch)', () => {
	const size: Size = { w: 390, h: 844 };
	const drawn: View = { scale: 0.5, cx: 1000, cy: 700 };
	const closer: View = { scale: 0.8, cx: 1000, cy: 700 };
	const wider: View = { scale: 0.3, cx: 1000, cy: 700 };

	it('never fills while the wrapped picture covers the viewport, however old it is', () => {
		expect(fillDue(drawn, closer, size, 10_000, 0)).toEqual({ fill: false, waitMs: 0 });
		expect(fillDue(drawn, drawn, size, 10_000, 0)).toEqual({ fill: false, waitMs: 0 });
	});

	it('fills empty space once the last drawing is FILL_MS old, and says how long to wait before that', () => {
		expect(FILL_MS).toBe(250);
		expect(fillDue(drawn, wider, size, 1000, 1000)).toEqual({ fill: false, waitMs: 250 });
		expect(fillDue(drawn, wider, size, 1100, 1000)).toEqual({ fill: false, waitMs: 150 });
		expect(fillDue(drawn, wider, size, 1250, 1000)).toEqual({ fill: true, waitMs: 0 });
		expect(fillDue(drawn, wider, size, 5000, 1000)).toEqual({ fill: true, waitMs: 0 });
	});

	it('a pinch out at 60 frames per second shows empty space for at most one fill period', () => {
		// Each frame zooms out 1 %; a fill draws the frame's view and restarts the clock.
		let d = { view: drawn, at: 0 };
		let v = drawn;
		let emptySince: number | null = null;
		let longest = 0;
		for (let t = 0; t <= 3000; t += 1000 / 60) {
			v = { ...v, scale: v.scale * 0.99 };
			const due = fillDue(d.view, v, size, t, d.at);
			if (due.fill) d = { view: v, at: t };
			const empty = !covers(d.view, v, size);
			if (empty && emptySince === null) emptySince = t;
			if (!empty && emptySince !== null) {
				longest = Math.max(longest, t - emptySince);
				emptySince = null;
			}
		}
		expect(longest).toBeGreaterThan(0);
		expect(longest).toBeLessThanOrEqual(FILL_MS + 1000 / 60);
	});
});
