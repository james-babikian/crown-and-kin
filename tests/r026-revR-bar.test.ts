// Review R (0.2.6, scratch), rewritten for 0.2.8: the house ribbon path (`ribbonPath`) at small note fonts, where the ribbon is thinner than the corner radius. The old
// proof was about the marked bar path; the ribbon takes its place for every card, and the same fault could come back: a path that runs back past its own end or out of the
// strip. Each point of the path must lie inside the strip, and the strip must have its corners.
import { describe, expect, it } from 'vitest';
import { ribbonWidth } from '../src/layout/geometry';
import { geometryFor } from '../src/layout/geometry';
import { ribbonPath } from '../src/render/view-math';

/** The end points of the path's pieces, in order (the commands M, H, V, A and Z are absolute). */
function points(d: string): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVA])([^MHVAZ]*)/g)) {
		const n = args.trim().split(/[ ,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') x = n[0];
		else if (cmd === 'V') y = n[0];
		else [x, y] = [n[5], n[6]];
		out.push({ x, y });
	}
	return out;
}

describe('R ribbon path', () => {
	for (const px of [8, 10, 11, 16, 24, 48]) {
		for (const radius of [0, 4, 8, 12, 20]) {
			for (const marked of [false, true]) {
				it(`note font ${px}px, corner ${radius}px${marked ? ', marked card' : ''}: every point lies inside the strip, along both edges`, () => {
					const rib = ribbonWidth(geometryFor(px));
					const inset = marked ? 1.5 : 0;
					const r = Math.max(0, radius - inset);
					const [x, y, w, h] = [40, 20, 180, 64];
					const top = ribbonPath(x + inset, y + inset, w - 2 * inset, rib, rib, r, 'top');
					for (const p of points(top)) {
						expect(p.x, top).toBeGreaterThanOrEqual(x + inset - 1e-6);
						expect(p.x, top).toBeLessThanOrEqual(x + w - inset + 1e-6);
						expect(p.y, top).toBeGreaterThanOrEqual(y + inset - 1e-6);
						expect(p.y, top).toBeLessThanOrEqual(y + inset + rib + 1e-6);
					}
					const left = ribbonPath(x + inset, y + inset, rib, h - 2 * inset, rib, r, 'left');
					for (const p of points(left)) {
						expect(p.x, left).toBeGreaterThanOrEqual(x + inset - 1e-6);
						expect(p.x, left).toBeLessThanOrEqual(x + inset + rib + 1e-6);
						expect(p.y, left).toBeGreaterThanOrEqual(y + inset - 1e-6);
						expect(p.y, left).toBeLessThanOrEqual(y + h - inset + 1e-6);
					}
					// A closed shape; with a radius it has arcs at both ends of the strip's outer edge.
					for (const d of [top, left]) {
						expect(d).toMatch(/Z$/);
						if (r > 0) expect(d.match(/A/g)).toHaveLength(2);
					}
				});
			}
		}
	}

	it('a strip as thick as the corner or thicker keeps a straight foot; a thinner strip ends in the arc', () => {
		expect(ribbonPath(0, 0, 100, 8, 8, 4, 'top')).toBe('M4 0H96A4 4 0 0 1 100 4V8H0V4A4 4 0 0 1 4 0Z');
		const thin = ribbonPath(0, 0, 100, 3, 3, 8, 'top');
		expect(thin.startsWith('M8 0H92A8 8 0 0 1 98.2')).toBe(true);
		expect(thin).not.toMatch(/V/);
	});
});
