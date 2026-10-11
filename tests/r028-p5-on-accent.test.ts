import { describe, expect, it } from 'vitest';
import { contrastRatio, onAccentChoice, onAccentFrom } from '../src/render/dom/theme-read';

/*
 * 0.2.8 (I40, contract G.12): the text on the accent is black or white by measured contrast, only where the theme's own pair is under 4.5:1.
 */

describe('onAccentFrom', () => {
	it('keeps the theme pair when it reaches 4.5:1', () => {
		// White on a dark violet: about 9:1.
		expect(onAccentFrom([70, 50, 160], [255, 255, 255])).toBeNull();
		// Black on a light accent.
		expect(onAccentFrom([240, 220, 120], [0, 0, 0])).toBeNull();
	});

	it('takes black where the theme pair is white on a mid-light accent (the default light theme: white on 8a5cf5 is about 4.2:1)', () => {
		const accent = [138, 92, 245];
		expect(contrastRatio([255, 255, 255], accent)).toBeLessThan(4.5);
		expect(onAccentFrom(accent, [255, 255, 255])).toBe('#000000');
	});

	it('takes white where the theme pair is weak on a dark accent', () => {
		const accent = [40, 40, 90];
		expect(onAccentFrom(accent, [90, 90, 140])).toBe('#ffffff');
	});

	it('with no readable pair it chooses by the accent alone', () => {
		expect(onAccentFrom([250, 250, 210], null)).toBe('#000000');
		expect(onAccentFrom([10, 10, 60], null)).toBe('#ffffff');
	});

	it('the chosen colour always reaches the larger of the two contrasts', () => {
		for (const accent of [[138, 92, 245], [127, 109, 242], [200, 60, 60], [20, 120, 200], [240, 200, 60], [120, 120, 120]]) {
			const pick = onAccentFrom(accent, [200, 200, 200])!;
			const rgb = pick === '#000000' ? [0, 0, 0] : [255, 255, 255];
			expect(contrastRatio(rgb, accent)).toBeGreaterThanOrEqual(Math.min(contrastRatio([0, 0, 0], accent), contrastRatio([255, 255, 255], accent)));
		}
	});
});

describe('onAccentChoice', () => {
	const el = (vars: Record<string, string>) => {
		(globalThis as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: (n: string) => vars[n] ?? '' });
		return {} as Element;
	};
	const hex = (css: string): number[] | null => {
		const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
		return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
	};

	it('reads the two roles of the page', () => {
		expect(onAccentChoice(el({ '--interactive-accent': '#8a5cf5', '--text-on-accent': '#ffffff' }), hex)).toBe('#000000');
		expect(onAccentChoice(el({ '--interactive-accent': '#46329f', '--text-on-accent': '#ffffff' }), hex)).toBeNull();
	});

	it('keeps the base token when the accent cannot be read', () => {
		expect(onAccentChoice(el({ '--interactive-accent': 'weird', '--text-on-accent': '#ffffff' }), hex)).toBeNull();
	});
});
