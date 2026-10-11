import { describe, expect, it } from 'vitest';
import { keepTopCardWhole } from '../src/obsidian/focus-mode';
import type { Rect } from '../src/layout/model';
import type { View } from '../src/render/view-math';

/*
 * G2 review of the 0.2.8 look round (package C2): keepTopCardWhole.
 */

const size = { w: 400, h: 300 };
// Scale 1, centre at the middle of the box: layout (x, y) is screen (x, y).
const view: View = { scale: 1, cx: 200, cy: 150 };

const screenTop = (v: View, b: Rect) => size.h / 2 + (b.y - v.cy) * v.scale;
const cutAtTop = (v: View, boxes: Rect[]) => boxes.filter((b) => screenTop(v, b) < -0.5 && screenTop(v, b) + b.h * v.scale > 0.5);

describe('keepTopCardWhole', () => {
	it('never returns a view that has a card cut at the top when the view it was given had one cut and no move improves it (raise branch)', () => {
		// A is cut by the top edge (y -10 to 40). K is a key card whose foot (295) a move down by 10 would push under the foot (300).
		// So the function raises the view by 40 px. C (30 to 80, another column) is whole before, and cut after.
		const a: Rect = { x: 10, y: -10, w: 100, h: 50 };
		const c: Rect = { x: 130, y: 30, w: 80, h: 50 };
		const k: Rect = { x: 250, y: 215, w: 100, h: 80 };
		const boxes = [a, c, k];
		expect(cutAtTop(view, boxes)).toEqual([a]);
		const out = keepTopCardWhole(view, size, 0, size.h, boxes, [k]);
		// The promise of the function: "the top card is whole". The result may keep the original view, or fix A, but it must not trade A for C.
		expect(cutAtTop(out, boxes).length).toBe(0);
	});
});

describe('keepTopCardWhole (cascade)', () => {
	it('does not push a whole card out of the bottom of the area while it chases a staircase of cut cards at the top', () => {
		// Four cards in four columns, each 45 px higher than the one before. Card 0 is cut by the top edge; every move down brings the next one in, cut again.
		const stairs: Rect[] = [0, 1, 2, 3].map((i) => ({ x: i * 70, y: -10 - 45 * i, w: 60, h: 50 }));
		// The start person is whole in the middle of the area and is no key card (the default view passes none).
		const start: Rect = { x: 300, y: 150, w: 60, h: 50 };
		const boxes = [...stairs, start];
		const before = screenTop(view, start);
		expect(before + start.h).toBeLessThan(size.h);
		const out = keepTopCardWhole(view, size, 0, size.h, boxes, []);
		expect(screenTop(out, start) + start.h, 'foot of the start person on the screen').toBeLessThanOrEqual(size.h);
	});
});
