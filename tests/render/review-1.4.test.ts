import { describe, expect, it } from 'vitest';
import { geometryFor } from '../../src/layout/geometry';
import { familyNames, fontsChanged, parsePx, usesFamily, type FontState } from '../../src/render/fonts';

/*
 * Adopted from review WP1.4 (scratch/review-1.4, ca4b81c). The review proved an endless
 * re-render: TreeView stored the clamped `geo.fontPx` but compared it with the raw value read
 * from `--font-text-size`, so any size outside 8–48 px (or not in px) never compared equal.
 * The fix stores the fonts exactly as read and compares with `fontsChanged`, which looks only
 * at what the layout and the measurement use. Sizes are read as a computed `font-size`, which
 * is always in px, so `1.1rem` arrives as `17.6px`.
 */
const state = (px: number, over: Partial<FontState> = {}): FontState => ({ px, text: 'Inter, sans-serif', ui: 'Inter', bold: '600', ...over });

describe('review 1.4: a font size read again never causes another render', () => {
	it.each([
		['--font-text-size: 50px', '50px'],
		['--font-text-size: 6px', '6px'],
		['--font-text-size: 1.1rem', '17.6px'],
		['--font-text-size: calc(1em + 2px)', '18px'],
	])('%s (computed %s)', (_css, computed) => {
		const px = parsePx(computed);
		expect(px).not.toBeNull();
		// What render() stores is what readFonts() reads again: no change, no re-render.
		expect(fontsChanged(state(px!), state(px!))).toBe(false);
	});

	it('the clamped sizes are the same layout, so they are no change either', () => {
		expect(geometryFor(50).fontPx).toBe(geometryFor(60).fontPx);
		expect(fontsChanged(state(50), state(60))).toBe(false);
		expect(fontsChanged(state(6), state(7))).toBe(false);
	});

	it('a real size or family change is a change', () => {
		expect(fontsChanged(state(16), state(20))).toBe(true);
		expect(fontsChanged(state(16), state(16, { text: 'Georgia' }))).toBe(true);
		expect(fontsChanged(state(16), state(16, { ui: 'Georgia' }))).toBe(true);
		expect(fontsChanged(state(16), state(16, { bold: '700' }))).toBe(true);
	});
});

describe('font helpers', () => {
	it('reads only px lengths', () => {
		expect(parsePx('16px')).toBe(16);
		expect(parsePx(' 17.6px ')).toBe(17.6);
		expect(parsePx('1.1rem')).toBeNull();
		expect(parsePx('')).toBeNull();
		expect(parsePx('0px')).toBeNull();
	});

	it('splits family lists', () => {
		expect(familyNames('"Inter", \'Noto Sans\', sans-serif')).toEqual(['inter', 'noto sans', 'sans-serif']);
	});

	it('knows when a loaded web font is one of ours', () => {
		const s = state(16, { text: '"Literata", serif', ui: 'Inter' });
		expect(usesFamily(s, ['Literata'])).toBe(true);
		expect(usesFamily(s, ['"Inter"'])).toBe(true);
		expect(usesFamily(s, ['Roboto'])).toBe(false);
	});
});
