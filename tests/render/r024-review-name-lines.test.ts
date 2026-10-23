import { describe, expect, it } from 'vitest';
import { cardNameLines, runsText } from '../../src/render/name-lines';

// G2 review of 0.2.4: two defects of `cardNameLines` (src/render/name-lines.ts). All names are made up.
const px = (t: string) => Array.from(t).length * 7;
const measure = (t: string) => px(t);
const widthOf = (runs: { text: string }[]) => px(runs.map((r) => r.text).join(''));

describe('review: cardNameLines', () => {
	it('F1: a name that does not fit never loses words without a "…" (the last text line holds one word that fits only without the "…")', () => {
		// Line width 70 px = 10 characters. "Bbbbbbbbbb" fits exactly; with "…" it does not. "Cc" is dropped.
		const lines = cardNameLines('Aaaaaaaaaa Bbbbbbbbbb Cc', undefined, 70, measure, 2).map(runsText);
		expect(lines.join(' ')).toMatch(/…/);
	});

	it('F1b: the same with three text lines and a longer tail', () => {
		const lines = cardNameLines('Aaaaaaaaaa Bbbbbbbbbb Cccccccccc Dd', undefined, 70, measure, 3).map(runsText);
		expect(lines.join(' ')).toMatch(/…/);
	});

	it('F2: a one-word name wider than `full` with no break place (here CJK) is cut to `only`, the room beside the boxes, not to `full`', () => {
		const room = { full: 100, last: 70, only: 70 };
		const lines = cardNameLines('ウィリアムシェイクスピアウィリアムシェイクスピア', undefined, room, measure, 3);
		expect(lines).toHaveLength(1);
		expect(widthOf(lines[0])).toBeLessThanOrEqual(room.only);
	});

	it('F2b: the last text line of a name whose word has no break place is cut to `last`', () => {
		const room = { full: 100, last: 70, only: 100 };
		const lines = cardNameLines('Aaa ウィリアムシェイクスピアウィリアムシェイクスピア', undefined, room, measure, 3);
		const last = lines[lines.length - 1];
		expect(widthOf(last)).toBeLessThanOrEqual(room.last);
	});
});
