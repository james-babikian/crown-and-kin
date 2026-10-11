/*
 * D219: the outline of an arms picture, for the gap round it. `traceOutline` must follow any escutcheon (heater, round, lozenge, a square picture), keep
 * several parts, drop specks and give null for a clear picture; `armsGap` must put the outline into the arms' box and size the stroke so that the gap
 * is the same width on every side.
 */
import { describe, expect, it } from 'vitest';
import { OUTLINE_GRID, armsGap, outlineGrid, traceOutline } from '../src/layout/arms-outline';

/** RGBA pixels of a `w` x `h` picture whose alpha is `alpha(x, y)` (pixel centres). */
function mask(w: number, h: number, alpha: (x: number, y: number) => number): Uint8ClampedArray {
	const px = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			px[(y * w + x) * 4 + 3] = alpha(x + 0.5, y + 0.5);
			px[(y * w + x) * 4] = 120;
		}
	}
	return px;
}

/** The polygons of a path `M x y L x y … Z`, as lists of points. */
function polygons(d: string): [number, number][][] {
	return d
		.split('M')
		.filter(Boolean)
		.map((part) => part.replace('Z', '').split('L').map((p) => p.trim().split(' ').map(Number) as [number, number]));
}

const inside = (x: number, y: number, poly: [number, number][]) => {
	let c = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i]!;
		const [xj, yj] = poly[j]!;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
};

describe('traceOutline', () => {
	it('gives null for a clear picture and for specks of noise', () => {
		expect(traceOutline(mask(32, 32, () => 0), 32, 32)).toBeNull();
		expect(traceOutline(mask(32, 32, (x, y) => (Math.abs(x - 10) < 1 && Math.abs(y - 10) < 1 ? 255 : 0)), 32, 32)).toBeNull();
		expect(traceOutline(new Uint8ClampedArray(3), 32, 32)).toBeNull();
	});

	it('a picture that is opaque everywhere (a square picture, a white background) gets its own box, edge to edge', () => {
		const o = traceOutline(mask(20, 30, () => 255), 20, 30)!;
		expect(o.w).toBe(20);
		expect(o.h).toBe(30);
		const [poly] = polygons(o.d);
		// The marching squares cut each corner by half a cell (4 corners, 8 points); at 128 cells that is a tenth of a pixel on a card.
		expect(poly!.length).toBeLessThanOrEqual(8);
		const xs = poly!.map((p) => p[0]);
		const ys = poly!.map((p) => p[1]);
		expect(Math.min(...xs)).toBeCloseTo(0, 1);
		expect(Math.max(...xs)).toBeCloseTo(20, 1);
		expect(Math.min(...ys)).toBeCloseTo(0, 1);
		expect(Math.max(...ys)).toBeCloseTo(30, 1);
	});

	it('a round escutcheon: every point lies on the circle, within a fifth of a cell', () => {
		const n = 64;
		const r = 28;
		const o = traceOutline(mask(n, n, (x, y) => Math.max(0, Math.min(255, Math.round(255 * (r + 0.5 - Math.hypot(x - 32, y - 32)))))), n, n)!;
		const polys = polygons(o.d);
		expect(polys).toHaveLength(1);
		expect(polys[0]!.length).toBeGreaterThan(12);
		for (const [x, y] of polys[0]!) expect(Math.abs(Math.hypot(x - 32, y - 32) - r), `${x} ${y}`).toBeLessThan(0.3);
	});

	it('a lozenge keeps its four points; a heater keeps its flat top and its point', () => {
		const lozenge = traceOutline(mask(64, 64, (x, y) => (Math.abs(x - 32) + Math.abs(y - 32) <= 28 ? 255 : 0)), 64, 64)!;
		expect(polygons(lozenge.d)[0]!.length).toBeLessThanOrEqual(8);
		const pts = polygons(lozenge.d)[0]!;
		expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(4, 0);
		expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(60, 0);
		// A heater: flat top, straight sides to half way, then curves to a point at the bottom.
		const heater = traceOutline(mask(60, 70, (x, y) => (y < 4 ? 0 : y < 35 ? (x > 5 && x < 55 ? 255 : 0) : Math.abs(x - 30) < ((70 - y) / 35) * 25 ? 255 : 0)), 60, 70)!;
		const h = polygons(heater.d)[0]!;
		expect(Math.min(...h.map((p) => p[1]))).toBeCloseTo(4, 0);
		// The last half cell of a point sharper than a cell is lost.
		expect(Math.max(...h.map((p) => p[1]))).toBeGreaterThan(68);
		const bottom = h.filter((p) => p[1] > 64);
		expect(bottom.length).toBeGreaterThan(0);
		for (const [x] of bottom) expect(Math.abs(x - 30)).toBeLessThan(4);
	});

	it('a picture of two parts gives two polygons, and a hole in the shield gives a second ring', () => {
		const two = traceOutline(mask(64, 32, (x, y) => ((x > 4 && x < 24 && y > 4 && y < 28) || (x > 40 && x < 60 && y > 4 && y < 28) ? 255 : 0)), 64, 32)!;
		expect(polygons(two.d)).toHaveLength(2);
		const ring = traceOutline(mask(40, 40, (x, y) => (x > 4 && x < 36 && y > 4 && y < 36 && !(x > 14 && x < 26 && y > 14 && y < 26) ? 255 : 0)), 40, 40)!;
		expect(polygons(ring.d)).toHaveLength(2);
	});

	it('a saddle (two shapes that touch at a corner) closes both shapes', () => {
		const o = traceOutline(mask(8, 8, (x, y) => ((x < 4 && y < 4) || (x > 4 && y > 4) ? 255 : 0)), 8, 8)!;
		expect(o).not.toBeNull();
		for (const poly of polygons(o.d)) expect(poly.length).toBeGreaterThanOrEqual(3);
	});

	it('the path covers the opaque pixels and no clear pixel far from them', () => {
		const n = 48;
		const alpha = (x: number, y: number) => (Math.hypot(x - 24, (y - 22) * 0.8) < 18 ? 255 : 0);
		const o = traceOutline(mask(n, n, alpha), n, n)!;
		const polys = polygons(o.d);
		let wrong = 0;
		for (let y = 0; y < n; y++) {
			for (let x = 0; x < n; x++) {
				const covered = polys.some((p) => inside(x + 0.5, y + 0.5, p));
				if (covered !== (alpha(x + 0.5, y + 0.5) === 255)) wrong++;
			}
		}
		// Only pixels on the edge itself may differ.
		expect(wrong).toBeLessThan(8);
	});
});

describe('outlineGrid', () => {
	it('puts the longer side at 128 cells and keeps the proportion', () => {
		expect(outlineGrid(500, 600)).toEqual({ w: 107, h: OUTLINE_GRID });
		expect(outlineGrid(64, 64)).toEqual({ w: OUTLINE_GRID, h: OUTLINE_GRID });
		expect(outlineGrid(0, 10)).toEqual({ w: 1, h: 1 });
	});
});

describe('armsGap', () => {
	it('puts the grid into the arms box with "meet" (in the middle), writes the path in layout px and makes the stroke twice the gap wide', () => {
		const o = { w: 100, h: 120, d: 'M0 0L100 0L50 120Z' };
		const g = armsGap(o, { x: 10, y: 20, w: 40, h: 24 }, 3.2);
		// The box is wider than the shape: the height limits (24 / 120 = 0.2), the shape is centred sideways (x from 20 to 40).
		expect(g.d).toBe('M20 20L40 20L30 44Z');
		expect(g.strokeWidth).toBe(6.4);
	});

	it('keeps several parts and negative or fractional numbers', () => {
		const o = { w: 10, h: 10, d: 'M0.5 0.25L9.5 0.25L9.5 9.75ZM2 2L3 2L3 3Z' };
		const g = armsGap(o, { x: -5, y: -5, w: 20, h: 20 }, 1);
		expect(g.d).toBe('M-4 -4.5L14 -4.5L14 14.5ZM-1 -1L1 -1L1 1Z');
	});
});
