// G2 proof (code-reviewer, scratch branch, never merged). D246 item 2 (F3): "a small tree opens in the centre ... when only its empty margin is cut;
// on a narrower screen it opens smaller so that no card is cut". `centredOpening` (src/render/view-math.ts) allows the tree bounds to be wider than
// the screen by `2 * (FIT_MARGIN - CENTRE_EDGE_MIN)` = 32 SCREEN px, but the margin it may cut is FIT_MARGIN LAYOUT px, which is only `FIT_MARGIN * scale`
// screen px. At a scale below 2/3 (names 14 px on a note font of 21 px or more, the opening scale is 14 / font) the cut is larger than the margin: a card is cut.
import { describe, expect, it } from 'vitest';
import { CENTRE_EDGE_MIN, FIT_MARGIN, centredOpening, treeBounds } from '../../src/render/view-math';

/** The screen x of the left and right edges of the leftmost and rightmost card of a tree of `width` x `height` layout px (the cards start 0, the bounds hold the margin). */
function cardEdges(view: { scale: number; cx: number }, width: number, size: { w: number }) {
	return { left: size.w / 2 + (0 - view.cx) * view.scale, right: size.w / 2 + (width - view.cx) * view.scale };
}

describe('G2: centredOpening cuts a card at a small opening scale (D246 item 2)', () => {
	for (const fontPx of [21, 24, 28, 32]) {
		it(`note font ${fontPx} px: the opening at 14 px names (scale ${(14 / fontPx).toFixed(3)}) shows every card whole`, () => {
			const size = { w: 390, h: 800 };
			const scale = 14 / fontPx;
			// A tree whose bounds are wider than the screen by 31 screen px: inside the allowed cut of 32.
			const boundsW = (size.w + 31) / scale;
			const width = boundsW - 2 * FIT_MARGIN;
			const height = 200;
			const bounds = treeBounds(width, height);
			const view = centredOpening(bounds, size, scale, { top: 0, bottom: 0 }, fontPx);
			expect(view, 'the tree is opened centred').not.toBeNull();
			const e = cardEdges(view!, width, size);
			// D246 item 2: no card is cut by the screen edge.
			expect(e.left, `left card edge at ${e.left.toFixed(2)} px`).toBeGreaterThanOrEqual(0);
			expect(size.w - e.right, `right card edge ${e.right.toFixed(2)} px of ${size.w}`).toBeGreaterThanOrEqual(0);
			expect(CENTRE_EDGE_MIN).toBe(8);
		});
	}
});
