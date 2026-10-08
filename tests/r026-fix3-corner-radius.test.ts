// 0.2.6 WP3 fix round: the marked bar takes the corner radius of the card bg from the computed style.
import { afterEach, describe, expect, it } from 'vitest';
import { parsePxRadius, readCornerRadius } from '../src/render/dom/scene';
import { markedBarPath } from '../src/render/view-math';

const g = globalThis as Record<string, unknown>;
afterEach(() => {
	delete g.getComputedStyle;
});

describe('readCornerRadius', () => {
	it('reads rx of the computed style', () => {
		g.getComputedStyle = () => ({ rx: '6px' });
		expect(readCornerRadius({ isConnected: true } as Element, 4)).toBe(6);
	});
	it('falls back when detached, empty or without the function', () => {
		g.getComputedStyle = () => ({ rx: '6px' });
		expect(readCornerRadius({ isConnected: false } as Element, 4)).toBe(4);
		g.getComputedStyle = () => ({ rx: '' });
		expect(readCornerRadius({ isConnected: true } as Element, 4)).toBe(4);
		delete g.getComputedStyle;
		expect(readCornerRadius({ isConnected: true } as Element, 4)).toBe(4);
	});
});

describe('markedBarPath with a large corner', () => {
	it('keeps the arc radius and cuts the bar at its inner edge', () => {
		// Border 3, outer radius 8 gives an inner radius of 6.5, wider than the 4 px strip.
		const d = markedBarPath(0, 0, 60, 4, 3, 8);
		expect(d).toContain('A6.5 6.5');
		const m = /^M4 ([\d.]+)V([\d.]+)A/.exec(d);
		expect(m).not.toBeNull();
		// The cut points lie on the circle of the inner corner (centre 8, 8; radius 6.5).
		const yt = Number(m![1]);
		expect(Math.hypot(4 - 8, yt - 8)).toBeCloseTo(6.5, 6);
		expect(Number(m![2])).toBeCloseTo(60 - yt, 6);
	});
	it('is the plain path when the corner fits in the strip', () => {
		expect(markedBarPath(0, 0, 40, 6, 2, 4)).toBe('M4 1H6V39H4A3 3 0 0 1 1 36V4A3 3 0 0 1 4 1Z');
	});
});

describe('parsePxRadius', () => {
	it('parses px values and falls back otherwise', () => {
		expect(parsePxRadius('8px', 4)).toBe(8);
		expect(parsePxRadius(' 6.5px ', 4)).toBe(6.5);
		expect(parsePxRadius('0', 4)).toBe(0);
		expect(parsePxRadius('0.5rem', 4)).toBe(4);
		expect(parsePxRadius('', 4)).toBe(4);
		expect(parsePxRadius(undefined, 4)).toBe(4);
	});
});
