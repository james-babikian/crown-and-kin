// 0.2.6 WP3 fix round: the marked bar takes the corner radius of the card bg from the computed style.
import { afterEach, describe, expect, it } from 'vitest';
import { readCornerRadius } from '../../src/render/dom/scene';

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
