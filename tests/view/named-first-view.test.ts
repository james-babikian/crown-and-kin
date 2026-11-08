import { describe, expect, it } from 'vitest';

import { NAMED_MIN_NOTE_PX, namedFirstView, namedWhole } from '../../src/view/focus-mode';

/* D334 Q1 B: the rule that picks the first view of the relation view on a phone, on plain numbers. */

const size = { w: 400, h: 800 };
const FONT = 16;
const cardA = { x: 0, y: 0, w: 100, h: 50 };
const cardB = { x: 300, y: 100, w: 100, h: 50 };

describe('namedFirstView', () => {
	it('keeps the readable view when both named people are whole in it', () => {
		const first = { scale: 1, cx: 200, cy: 200 };
		expect(namedFirstView(first, { scale: 0.5, cx: 200, cy: 200 }, size, 100, 700, [cardA, cardB], FONT)).toBe(first);
	});

	it('zooms out to the fitted view when a named person is cut', () => {
		const first = { scale: 1, cx: 300, cy: 200 };
		const fitted = { scale: 0.6, cx: 200, cy: 200 };
		expect(namedWhole(first, size, 100, 700, [cardA, cardB])).toBe(false);
		expect(namedFirstView(first, fitted, size, 100, 700, [cardA, cardB], FONT)).toBe(fitted);
	});

	it('keeps the readable view when the fitted names would be under the floor', () => {
		const first = { scale: 1, cx: 300, cy: 200 };
		const tiny = { scale: (NAMED_MIN_NOTE_PX - 0.1) / FONT, cx: 200, cy: 200 };
		expect(namedFirstView(first, tiny, size, 100, 700, [cardA, cardB], FONT)).toBe(first);
	});

	it('never zooms in', () => {
		const first = { scale: 0.5, cx: 300, cy: 200 };
		expect(namedFirstView(first, { scale: 0.8, cx: 200, cy: 200 }, size, 100, 700, [cardA, cardB], FONT)).toBe(first);
	});
});
