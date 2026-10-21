import { describe, expect, it } from 'vitest';
import { badgeTap } from '../src/view/focus-mode';
import { badgeSquare } from './badge-square';
import type { Rect } from '../src/layout/model';
import { discPath, BADGE_RADIUS_EM } from '../src/render/dom/scene';

// Contract 4.2: which element wins a tap in the overlap of the badge's tap square and its own card (the rule of spec §13.10, 6 screen px).
// The card in these tests is 180 x 61 layout px with its top right corner at (400, 200); the font is 16 px; the 14 px first view is scale 0.875.
const F = 16;
const R = BADGE_RADIUS_EM * F;
const CARD = { x: 220, y: 200, w: 180, h: 61 };
const CX = CARD.x + CARD.w;
const CY = CARD.y;
const MARK = { x: CX - R, y: CY - R, w: 2 * R, h: 2 * R };
const SCALE = 14 / F;
const CAP = CARD.h / 2;
/**
 * The rule of contract 4.2 as a model for these tests (the view gets the same result from the stacking of the badge square and the card):
 * the part of the square outside its own card is the badge; over its own card the card wins, except inside the disc round the badge centre.
 */
function badgeTapWins(mark: Rect, point: { x: number; y: number }, scale: number, fontPx: number, capPx: number, avoid: readonly Rect[]): boolean {
	const { square, disc } = badgeTap(mark, scale, fontPx, capPx, avoid);
	const inSquare = point.x >= square.x && point.x <= square.x + square.w && point.y >= square.y && point.y <= square.y + square.h;
	const overOwnCard = point.x <= disc.cx && point.y >= disc.cy;
	if (inSquare && !overOwnCard) return true;
	return point.y >= disc.top && Math.hypot(point.x - disc.cx, point.y - disc.cy) <= disc.r;
}
const wins = (x: number, y: number, avoid: { x: number; y: number; w: number; h: number }[] = [], scale = SCALE) => badgeTapWins(MARK, { x, y }, scale, F, CAP, avoid);

describe('badgeTapWins (contract 4.2)', () => {
	it('a tap at the badge centre is a badge tap', () => {
		expect(wins(CX, CY)).toBe(true);
	});

	it('a tap at the middle of the card is a card tap', () => {
		expect(wins(CARD.x + CARD.w / 2, CARD.y + CARD.h / 2)).toBe(false);
	});

	it('a tap on the card farther than r + 6 px from the badge centre is a card tap; nearer is a badge tap', () => {
		const disc = R + 6 / SCALE;
		// Inside the square (half side 25.1) and over the card: along the left edge of the card's corner region.
		expect(wins(CX - disc - 0.5, CY + 1)).toBe(false);
		expect(wins(CX - disc + 0.5, CY + 1)).toBe(true);
		expect(wins(CX - 1, CY + disc - 0.5)).toBe(true);
		expect(wins(CX - 1, CY + disc + 0.5)).toBe(false);
		// The diagonal: the disc is round, not square (a point in the corner of the square near the disc box is not in it).
		expect(wins(CX - disc * 0.9, CY + disc * 0.9)).toBe(false);
		expect(wins(CX - disc * 0.6, CY + disc * 0.6)).toBe(true);
	});

	it('a tap above the card, inside the square and clear of the avoid rects, is a badge tap; right of the card too', () => {
		expect(wins(CX - 20, CY - 20)).toBe(true);
		expect(wins(CX + 8, CY + 20)).toBe(true);
		// Outside the square: the square is 50.3 px wide and ends 9.6 px right of the corner.
		expect(wins(CX + R + 3, CY + 20)).toBe(false);
		expect(wins(CX - 45, CY - 20)).toBe(false);
	});

	it('a tap in the clipped strip that a tag tap area covers is not a badge tap', () => {
		// A tag area ends 8 px above the card top: the square reaches 8 px up and no more.
		const tag = { x: CX - 60, y: CY - 40, w: 100, h: 32 };
		expect(wins(CX - 20, CY - 4, [tag])).toBe(true);
		expect(wins(CX - 20, CY - 12, [tag])).toBe(false);
		expect(wins(CX - 20, CY - 12)).toBe(true);
		// Not even the disc takes the strip above the clip line.
		expect(wins(CX, CY - 9, [tag])).toBe(false);
	});

	it('a tag tap area that touches the card top leaves no strip above it', () => {
		const tag = { x: CX - 60, y: CY - 30, w: 100, h: 30 };
		const sq = badgeSquare(MARK, SCALE, F, CAP, [tag]);
		expect(sq.y).toBeCloseTo(CY, 9);
		expect(wins(CX, CY - 1, [tag])).toBe(false);
		// The own card's corner under the disc is still the badge.
		expect(wins(CX - 5, CY + 5, [tag])).toBe(true);
	});

	it('a tag tap area that does not meet the square or lies beside the card changes nothing', () => {
		const far = { x: CX + 200, y: CY - 30, w: 100, h: 30 };
		const below = { x: CX - 60, y: CY + 70, w: 100, h: 30 };
		expect(badgeSquare(MARK, SCALE, F, CAP, [far, below])).toEqual(badgeSquare(MARK, SCALE, F, CAP, []));
	});

	it('at a low zoom (names under 11 px) the badge is its circle only, with no 6 px margin', () => {
		const scale = 0.5;
		const tap = badgeTap(MARK, scale, F, CAP, []);
		expect(tap.square.w).toBeCloseTo(2 * R, 9);
		expect(tap.disc.r).toBeCloseTo(R, 9);
		expect(wins(CX - R - 1, CY + 1, [], scale)).toBe(false);
		expect(wins(CX - 3, CY + 3, [], scale)).toBe(true);
	});

	it('zoomed in the square never shrinks below the visible circle and the disc margin is 6 screen px', () => {
		const scale = 3;
		const tap = badgeTap(MARK, scale, F, CAP, []);
		expect(tap.square.w).toBeGreaterThanOrEqual(2 * R - 1e-9);
		expect(tap.disc.r).toBeCloseTo(R + 6 / scale, 9);
	});
});

describe('discPath (the disc as the scene draws it)', () => {
	it('is a circle of radius r when nothing is cut', () => {
		const d = discPath(100, 50, 10, 0);
		expect(d.startsWith('M90 50A10 10 0 1 0 110 50')).toBe(true);
	});

	it('is a chord when the strip above is cut: the chord lies at the clip line and the big arc runs round the bottom', () => {
		const d = discPath(100, 50, 10, 46);
		const dx = Math.sqrt(100 - 16);
		expect(d).toBe(`M${Math.round((100 - dx) * 100) / 100} 46A10 10 0 1 0 ${Math.round((100 + dx) * 100) / 100} 46Z`);
		// No part above the card top: the whole disc half is below the centre when the cut is at the centre.
		expect(discPath(100, 50, 10, 50)).toBe('M90 50A10 10 0 0 0 110 50Z');
	});
});
