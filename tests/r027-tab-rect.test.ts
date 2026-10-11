// 0.2.7 WP4 geometry (CONTRACT F.4): the numbers and the rules of `ordinalTabRect`, on both card forms, for every picture kind, with a
// 3-character text ("1st") and a 4-character text ("20th"), at the font sizes of the other geometry tests. Each rule of F.4 has its own test.
import { describe, expect, it } from 'vitest';
import { ordinal } from '../src/core/succession-keys';
import { ORDINAL_EM, ROUNDEL_EM, cardForm, drawnGeometry, geometryFor, ordinalTabRect, roundelAxis, roundelPics, youTabRect } from '../src/layout/geometry';
import type { Geometry, LayoutSettings } from '../src/layout/model';

const SIZES = [8, 12, 14, 16, 20, 24];
const KINDS = [
	{ name: 'portrait', portrait: true, arms: false },
	{ name: 'portrait and arms', portrait: true, arms: true },
	{ name: 'arms only', portrait: false, arms: true },
	{ name: 'no picture', portrait: false, arms: false },
] as const;
const TEXTS = [ordinal(1), ordinal(20)];
const FAR = { maxCardWidths: 3, maxGenerations: 3 };

/** The geometry a layout with an ordinal tab draws with (it has the reach). */
function geo(f: number, form: 'roundel' | 'text'): Geometry {
	const settings: LayoutSettings = { sweeps: 4, far: FAR, ordinalCards: ['a'], ...(form === 'text' ? { orientation: 'sideways' as const } : {}) };
	return drawnGeometry(cardForm(geometryFor(f), form === 'text' ? 'sideways' : 'down'), settings);
}

describe('F.4: the tab text and width', () => {
	it('the texts are 3 and 4 characters long', () => {
		expect(TEXTS.map((t) => t.length)).toEqual([3, 4]);
	});

	it('2.3 em wide for 3 characters, 2.7 em for 4; 0.4 em more for each further character, at most 6 counted', () => {
		for (const f of SIZES) {
			for (const form of ['roundel', 'text'] as const) {
				const g = geo(f, form);
				const w = (n: number) => ordinalTabRect(g, false, false, n).w;
				expect(w(3)).toBeCloseTo(2.3 * f, 9);
				expect(w(4)).toBeCloseTo(2.7 * f, 9);
				expect(w(5)).toBeCloseTo(3.1 * f, 9);
				expect(w(6)).toBeCloseTo(3.5 * f, 9);
				expect(w(9)).toBeCloseTo(3.5 * f, 9);
				expect(w(1)).toBeCloseTo(2.3 * f, 9);
			}
		}
	});

	it('the width does not depend on the picture kind and the height is the "You" tab height', () => {
		const g = geo(16, 'roundel');
		for (const k of KINDS) {
			const r = ordinalTabRect(g, k.portrait, k.arms, 4);
			expect(r.w).toBeCloseTo(2.7 * 16, 9);
			expect(r.h).toBeCloseTo(youTabRect(g, true).h, 9);
		}
	});
});

describe('F.4: the Roundel right edge', () => {
	it('portrait: axis - 1.9 em; arms only: axis - 1.75 em; no picture: axis - 0.4 em (a portrait with arms is a portrait); 0.2.8 (G.5): 0.3 em further out', () => {
		for (const f of SIZES) {
			const g = geo(f, 'roundel');
			const axis = roundelAxis(g);
			const right = (portrait: boolean, arms: boolean, n = 3) => {
				const r = ordinalTabRect(g, portrait, arms, n);
				return axis - (r.x + r.w);
			};
			for (const n of [3, 4]) {
				expect(right(true, false, n), `f${f}`).toBeCloseTo(1.9 * f, 9);
				expect(right(true, true, n), `f${f}`).toBeCloseTo(1.9 * f, 9);
				expect(right(false, true, n), `f${f}`).toBeCloseTo(1.75 * f, 9);
				expect(right(false, false, n), `f${f}`).toBeCloseTo(0.4 * f, 9);
			}
		}
	});

	it('sits at the height of the "You" tab: 0.55 em above the top edge', () => {
		for (const f of SIZES) {
			const g = geo(f, 'roundel');
			for (const k of KINDS) expect(ordinalTabRect(g, k.portrait, k.arms, 3).y).toBeCloseTo(-0.55 * f, 9);
		}
	});
});

describe('F.4: the clear spaces, on both forms, for every picture kind and text', () => {
	for (const f of SIZES) {
		for (const k of KINDS) {
			for (const text of TEXTS) {
				it(`Roundel, ${f} px, ${k.name}, "${text}": 0.25 em from the halo (or the arms, or the axis), 0.25 em from the strip, not right of the card's middle, top inside the reach`, () => {
					const g = geo(f, 'roundel');
					const r = ordinalTabRect(g, k.portrait, k.arms, text.length);
					const pics = roundelPics(g, { portrait: k.portrait, arms: k.arms });
					const eps = 1e-9;
					const right = r.x + r.w;
					if (k.portrait) expect(right, 'halo').toBeLessThanOrEqual(pics.cx - pics.haloR - 0.25 * f + eps);
					else if (k.arms) expect(right, 'arms').toBeLessThanOrEqual(pics.arms!.x - 0.25 * f + eps);
					else expect(right, 'axis').toBeLessThanOrEqual(pics.cx - 0.25 * f + eps);
					// The arms beside a portrait lie right of the medallion, so only the strip limits the left end.
					expect(r.x, 'strip').toBeGreaterThanOrEqual(0.5 * f + 0.25 * f - eps);
					expect(right, 'middle').toBeLessThanOrEqual(g.cardW / 2 + eps);
					expect(r.y, 'top').toBeGreaterThanOrEqual(-g.reach! + eps);
					expect(r.y + r.h, 'bottom edge is on the card').toBeGreaterThan(0);
				});

				it(`text card, ${f} px, "${text}": left edge 0.875 em, 0.25 em from the strip, not right of the card's middle, top inside the reach`, () => {
					const g = geo(f, 'text');
					const r = ordinalTabRect(g, k.portrait, k.arms, text.length);
					const eps = 1e-9;
					expect(r.x).toBeCloseTo(0.875 * f, 9);
					expect(r.x).toBeGreaterThanOrEqual(0.5 * f + 0.25 * f - eps);
					expect(r.x + r.w).toBeLessThanOrEqual(g.cardW / 2 + eps);
					expect(r.y).toBeCloseTo(-0.9 * f, 9);
					expect(r.y).toBeGreaterThanOrEqual(-g.reach! + eps);
				});
			}
		}
	}

	it('the text card ignores the picture flags (it has no picture)', () => {
		const g = geo(16, 'text');
		const first = ordinalTabRect(g, false, false, 4);
		for (const k of KINDS) expect(ordinalTabRect(g, k.portrait, k.arms, 4)).toEqual(first);
	});

	it('plain geometry with no form places the tab as the text card does', () => {
		const g = geometryFor(16);
		const r = ordinalTabRect(g, true, true, 3);
		expect([r.x, r.y]).toEqual([0.875 * 16, -0.9 * 16]);
	});
});

describe('F.4: the numbers at 16 px', () => {
	const g = geo(16, 'roundel');
	it('"20th" with a portrait has 48 px of room and needs 43', () => {
		const axis = roundelAxis(g);
		const room = axis - 1.9 * 16 - (0.5 + 0.25) * 16;
		expect(Math.round(room)).toBe(48);
		const r = ordinalTabRect(g, true, false, 4);
		expect(r.w).toBeCloseTo(43.2, 9);
		expect(r.w).toBeLessThanOrEqual(room);
	});

	it('measured rectangles (card-relative px): "1st" and "20th", each picture kind', () => {
		const at = (p: boolean, a: boolean, n: number) => {
			const r = ordinalTabRect(g, p, a, n);
			return [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 100) / 100);
		};
		expect(at(true, false, 3)).toEqual([22.8, -8.8, 36.8, 18.4]);
		expect(at(true, false, 4)).toEqual([16.4, -8.8, 43.2, 18.4]);
		expect(at(false, true, 3)).toEqual([25.2, -8.8, 36.8, 18.4]);
		expect(at(false, false, 3)).toEqual([46.8, -8.8, 36.8, 18.4]);
		expect(at(false, false, 4)).toEqual([40.4, -8.8, 43.2, 18.4]);
	});

	it('the constants are the contract numbers', () => {
		expect(ORDINAL_EM.width3).toBe(2.3);
		expect(ORDINAL_EM.width4).toBe(2.7);
		expect(ORDINAL_EM.corner).toBe(0.2);
		expect(ORDINAL_EM.text).toBe(0.8);
		expect(ROUNDEL_EM.tabH).toBe(1.15);
	});
});
