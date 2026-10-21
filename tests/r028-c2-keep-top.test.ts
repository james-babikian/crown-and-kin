import { describe, expect, it } from 'vitest';
import { keepTopCardWhole } from '../src/view/focus-mode';
import type { View } from '../src/render/view-math';

/*
 * 0.2.8 (D212 bars-in-flow, package C2): a view that the plugin chooses keeps the top card whole under the band of the toolbar and the banner.
 * The box is 400 x 300 px at scale 1, the band is 80 px high. A view {cx, cy} shows the layout point (cx, cy) in the middle of the box.
 */

const size = { w: 400, h: 300 };
const band = 80;
const view = (cx: number, cy: number, scale = 1): View => ({ scale, cx, cy });
const top = (v: View, y: number, scale = 1) => size.h / 2 + (y - v.cy) * scale;

describe('keepTopCardWhole', () => {
	const ruler = { x: 150, y: 140, w: 100, h: 50 };
	const parent = { x: 150, y: 40, w: 100, h: 50 };

	it('leaves a view alone when no card is cut by the band', () => {
		// At cy 170 the parent is at screen y 20 to 70 (wholly under the band) and the ruler at 120 to 170 (wholly below it).
		expect(keepTopCardWhole(view(200, 170), size, band, size.h, [ruler, parent], [ruler])).toEqual(view(200, 170));
	});

	it('moves the view down until the cut card is whole, when the key card still fits at the foot', () => {
		// At cy 130 the parent is at screen y 60 to 110 (cut by the band at 80), the ruler at 160 to 210.
		const out = keepTopCardWhole(view(200, 130), size, band, size.h, [ruler, parent], [ruler]);
		expect(top(out, parent.y)).toBeGreaterThanOrEqual(band);
		expect(out.cy).toBeLessThan(130);
		expect(out.scale).toBe(1);
		expect(out.cx).toBe(200);
	});

	it('moves the view up, so that the cut card is under the band entirely, when a key card would leave the foot', () => {
		// The parent is cut (screen y 60 to 110). The key card is whole at 220 to 280 now, but a move down of 20 px would put its foot at 300 + 10.
		const key = { x: 150, y: 210, w: 100, h: 60 };
		const out = keepTopCardWhole(view(200, 130), size, band, size.h, [parent, key], [key]);
		expect(top(out, parent.y) + parent.h).toBeLessThanOrEqual(band);
		expect(top(out, key.y)).toBeGreaterThanOrEqual(band);
	});

	it('does nothing when neither move keeps the key cards whole', () => {
		// Whole at 90 to 290 now: a move down puts its foot at 310, a move up puts its top at 60.
		const tall = { x: 150, y: 70, w: 100, h: 200 };
		const v = view(200, 130);
		expect(keepTopCardWhole(v, size, band, size.h, [parent, tall], [tall])).toEqual(v);
	});

	it('does not touch a card that lies wholly under the band or wholly below it, and ignores a card off to the side', () => {
		const hidden = { x: 150, y: -50, w: 100, h: 50 };
		const side = { x: 1000, y: 40, w: 100, h: 50 };
		const v = view(200, 130);
		expect(keepTopCardWhole(v, size, band, size.h, [hidden, side, ruler], [ruler])).toEqual(v);
	});

	it('works at another scale and never zooms', () => {
		const v = view(200, 100, 2);
		const out = keepTopCardWhole(v, size, band, size.h, [parent, ruler], [ruler]);
		expect(out.scale).toBe(2);
		expect(top(out, parent.y, 2)).toBeGreaterThanOrEqual(band);
	});

	it('is a no-op for a view with no scale or no band', () => {
		expect(keepTopCardWhole(view(1, 1, 0), size, band, size.h, [parent], [])).toEqual(view(1, 1, 0));
		expect(keepTopCardWhole(view(200, 130), size, 0, size.h, [parent], [])).toEqual(view(200, 130));
	});
});
