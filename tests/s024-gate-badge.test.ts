import { describe, expect, it } from 'vitest';
import { badgeHit } from '../src/obsidian/focus-mode';
import { BADGE_RADIUS_EM } from '../src/render/dom/scene';
import { geometryFor, sidewaysGeometry } from '../src/layout/geometry';
import { READABLE_NAME_PX } from '../src/render/view-math';

// Contract 4.2 (E2): the tap square of the "+" badge must not reach any other card. The badge centre is the card's top right corner in both
// orientations. In `sideways` the cards of one column are `nodeGap` apart (1.5 em), and the square's half side is capped at that gap.
// Checked at the 14 px first view of the phone preview, with the five-argument `badgeHit(mark, scale, fontPx, capPx, avoid)`.
describe('badge tap square against the card above in a sideways column (contract 4.2 E2)', () => {
	for (const f of [12, 14, 16, 20]) {
		it(`note font ${f} px, first view scale ${READABLE_NAME_PX}/${f}`, () => {
			const geo = sidewaysGeometry(geometryFor(f, 'normal'), 'narrow');
			const scale = READABLE_NAME_PX / f;
			const r = BADGE_RADIUS_EM * f;
			const mark = { x: geo.cardW - r, y: -r, w: 2 * r, h: 2 * r }; // centre on the top right corner of a card at (0, 0)
			const hit = badgeHit(mark, scale, f, geo.nodeGap, []);
			// The card above ends `nodeGap` above this card's top edge (y = 0), in the same column, so it spans the same x range.
			const reach = -hit.y;
			expect(reach, `square ${hit.w.toFixed(1)} px, nodeGap ${geo.nodeGap}`).toBeLessThanOrEqual(geo.nodeGap);
			// Without the cap the square would be 44 screen px: 18.86 > 18 at 12 px, 22 > 21 at 14, 25.14 > 24 at 16, 31.43 > 30 at 20.
			expect(22 / scale).toBeGreaterThan(geo.nodeGap - 1e-9);
			expect(hit.h).toBeCloseTo(2 * geo.nodeGap, 6);
			expect(hit.x + hit.w).toBeCloseTo(geo.cardW + r, 6);
		});
	}

	it('in down the cap is half the own card: a 44 screen px square at the 14 px first view', () => {
		const geo = geometryFor(16, 'normal');
		const scale = READABLE_NAME_PX / 16;
		const r = BADGE_RADIUS_EM * 16;
		const mark = { x: geo.cardW - r, y: -r, w: 2 * r, h: 2 * r };
		const hit = badgeHit(mark, scale, 16, geo.cardH / 2, []);
		expect(hit.w * scale).toBeCloseTo(44, 6);
		expect(hit.h * scale).toBeCloseTo(44, 6);
		// A tall card of 93 px: the caller passes its own half height.
		expect(badgeHit(mark, scale, 16, 93 / 2, []).w).toBeCloseTo(44 / scale, 6);
		// A small cap holds the square back (E2: at most half the own card).
		expect(badgeHit(mark, scale, 16, 20, []).w).toBeCloseTo(40, 6);
	});

	it('below 11 px names the square is only the visible circle', () => {
		const r = BADGE_RADIUS_EM * 16;
		const mark = { x: 100 - r, y: 50 - r, w: 2 * r, h: 2 * r };
		const hit = badgeHit(mark, 0.5, 16, 24, []);
		expect([hit.x, hit.y, hit.w, hit.h].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([mark.x, mark.y, mark.w, mark.h].map((v) => Math.round(v * 1e6) / 1e6));
	});
});
