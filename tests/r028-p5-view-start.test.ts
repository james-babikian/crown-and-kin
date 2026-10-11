import { describe, expect, it } from 'vitest';
import { parentsAbove } from '../src/obsidian/focus-mode';
import { defaultView, type View } from '../src/render/view-math';

/*
 * 0.2.8 (G.4): the readable first view of a note shows the start person with the row of their parents above.
 */

const size = { w: 800, h: 500 };
const shown = (v: View, inset: number) => ({ top: v.cy - size.h / 2 / v.scale + inset / v.scale, bottom: v.cy + size.h / 2 / v.scale });

describe('parentsAbove', () => {
	const bounds = { x: -24, y: -24, w: 6000, h: 1200 };
	const parents = [{ x: 2500, y: 0, w: 170, h: 70 }];
	const start = { x: 2500, y: 300, w: 170, h: 70 };

	it('moves the view up so that the parents show, and the start card is still whole', () => {
		const base = defaultView(bounds, size, 16, start, 44, { partners: [], children: [] });
		expect(shown(base, 44).top).toBeGreaterThan(parents[0].y);
		const v = parentsAbove(base, size, 44, start, parents);
		expect(v.scale).toBe(base.scale);
		expect(v.cx).toBe(base.cx);
		const a = shown(v, 44);
		expect(a.top).toBeLessThanOrEqual(parents[0].y);
		expect(a.bottom).toBeGreaterThanOrEqual(start.y + start.h);
	});

	it('does not move a view that shows the parents already', () => {
		const base: View = { scale: 1, cx: 2585, cy: 200 };
		expect(parentsAbove(base, size, 44, start, parents)).toBe(base);
	});

	it('does not move a view when the start card would leave the foot of the area', () => {
		const tall = { x: 2500, y: 1000, w: 170, h: 70 };
		const base = defaultView(bounds, size, 16, tall, 44, null);
		expect(parentsAbove(base, size, 44, tall, parents)).toBe(base);
	});

	it('does nothing for a person with no parent row', () => {
		const base: View = { scale: 1, cx: 2585, cy: 600 };
		expect(parentsAbove(base, size, 44, start, [])).toBe(base);
	});
});
