import { describe, expect, it } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { type Shapes, MARKER_QUOTE, randomLines } from '../support/r030-j-diff-gen';
import { findBlocks as findBlocksBefore } from '../support/old-block-locate';

/*
 * 0.3 package J, fix round: a differential of `findBlocks` against the code of release 0.2.8 (`old-block-locate.ts`,
 * a copy) over random line combinations (list markers, quote markers, fences at several indents, margin lines, a
 * quote opened on a marker line, spaced thematic breaks). The branch may differ from the old code only for a note that
 * holds one of the two shapes that package J repairs: a quote opened on a list marker line ("- > q", fault F1) or a
 * spaced thematic break ("- - -", fault F4). Seeds are fixed. Deep run: R030_DEEP=1.
 */

const DEEP = process.env.R030_DEEP === '1';
const COUNT = DEEP ? 2_000_000 : 100_000;
const LIMIT = DEEP ? 600_000 : 30_000;

const shape = (f: typeof findBlocks, text: string) => f(text).map((b) => [b.openLine, b.closeLine, b.prefix, b.body]);

/** A line that is a thematic break with a space inside ("- - -", "* * *", also behind a quote marker or a list marker). */
function hasSpacedBreak(text: string): boolean {
	return text.split('\n').some((l) => /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(l) && /[-*_][ \t]+[-*_]/.test(l));
}

interface Result {
	count: number;
	differences: number;
	/** Differences without a quote-on-marker-line shape. */
	notQuote: string[];
	/** Differences without a spaced thematic break. */
	notBreak: string[];
	/** Differences that are neither. */
	neither: string[];
}

function run(mode: Shapes, count: number): Result {
	const r: Result = { count, differences: 0, notQuote: [], notBreak: [], neither: [] };
	for (let seed = 0; seed < count; seed++) {
		const text = randomLines(seed, mode);
		const now = shape(findBlocks, text);
		const before = shape(findBlocksBefore as never, text);
		if (JSON.stringify(now) === JSON.stringify(before)) continue;
		r.differences++;
		const note = `${mode} seed ${seed}: ${JSON.stringify(text)}\n now ${JSON.stringify(now)}\n old ${JSON.stringify(before)}`;
		const quote = MARKER_QUOTE.test(text);
		const rule = hasSpacedBreak(text);
		if (!quote) r.notQuote.push(note);
		if (!rule) r.notBreak.push(note);
		if (!quote && !rule) r.neither.push(note);
	}
	return r;
}

describe('findBlocks against the code of release 0.2.8, over random line combinations', () => {
	it('notes with neither shape: no difference at all', () => {
		const r = run('none', COUNT);
		expect(r.differences, r.neither.slice(0, 3).join('\n')).toBe(0);
	}, LIMIT);

	it('notes with a quote on a marker line (F1): every difference holds that shape', () => {
		const r = run('quote', COUNT);
		expect(r.notQuote.slice(0, 3).join('\n')).toBe('');
		// The shape is common enough that the run proves something.
		expect(r.differences).toBeGreaterThan(0);
	}, LIMIT);

	it('notes with a spaced thematic break (F4): every difference holds that shape', () => {
		const r = run('break', COUNT);
		expect(r.notBreak.slice(0, 3).join('\n')).toBe('');
		expect(r.differences).toBeGreaterThan(0);
	}, LIMIT);

	it('notes with both shapes: every difference holds one of them', () => {
		const r = run('both', COUNT);
		expect(r.neither.slice(0, 3).join('\n')).toBe('');
		expect(r.differences).toBeGreaterThan(0);
	}, LIMIT);
});
