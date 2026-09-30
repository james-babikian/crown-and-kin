import { describe, expect, it } from 'vitest';
import { armsColours } from '../src/core/arms-colours';

// Unit tests for `armsColours` (spec §13.6 "Colours from the arms", D68; M9 core contract rule 10):
// the edges of the input that the acceptance tests do not reach.

/** `n` pixels of one colour. */
const pixels = (hex: string, n: number, alpha = 255): number[] => {
	const v = parseInt(hex.slice(1), 16);
	const px = [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
	return Array.from({ length: n }, () => px).flat();
};

describe('armsColours', () => {
	it('reads only width × height pixels; bytes after them do not count', () => {
		const rgba = [...pixels('#1f4e9c', 4), ...pixels('#c8102e', 4)];
		expect(armsColours(rgba, 2, 2)).toEqual(['#1f4e9c']);
		// With no usable size, every whole pixel counts.
		expect(armsColours(rgba, 0, 0)).toHaveLength(2);
	});

	it('an odd number of bytes and pixels that are not numbers do not count', () => {
		const rgba = [...pixels('#1f4e9c', 3), 1, 2, 3, Number.NaN, Number.NaN, 0, 0, 255, 9];
		expect(armsColours(rgba, 5, 1)).toEqual(['#1f4e9c']);
	});

	it('never throws on odd input', () => {
		for (const v of [undefined, null, [], 'text']) expect(armsColours(v as unknown as number[], 64, 64)).toEqual([]);
	});

	it('the largest share comes first, also when the smaller colour was seen first', () => {
		const got = armsColours([...pixels('#f2c230', 10), ...pixels('#1e7b3a', 30)], 40, 1);
		expect(got).toEqual(['#1e7b3a', '#f2c230']);
	});

	it('many colours give at most 5, with no colour twice', () => {
		const colours = ['#c8102e', '#1f4e9c', '#1e7b3a', '#f2c230', '#141414', '#f7f7f4', '#6b2c7a', '#e07020', '#20a0b0', '#808080'];
		const got = armsColours(colours.flatMap((c) => pixels(c, 100)), 1000, 1);
		expect(got.length).toBeGreaterThan(0);
		expect(got.length).toBeLessThanOrEqual(5);
		expect(new Set(got).size).toBe(got.length);
	});
});
