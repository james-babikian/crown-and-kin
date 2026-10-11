// Test round of 0.2.8, target X2: failing proof T-X2-01. Run with: npx vitest run tests/r028-adv-proof-x2.test.ts
// A name, a title or a relation word that is too long ends with "…" (spec §13.9, §13.19 rule 2). The cut falls between code points, so it can fall inside one letter
// that is made of several code points: a flag (two regional indicators), a family or other joined emoji, an emoji with a skin tone, a conjunct of Devanagari or Hangul jamo.
// The card then shows half a letter before the "…" (a flag shows as a lone letter in a box). The spec is silent on this; a user expects a whole letter. Severity: note.
// The helpers `cardNameLines`, `nameLines` and `truncate` all cut at code points.
import { describe, expect, it } from 'vitest';
import { cardNameLines, nameLines, runsText } from '../src/render/name-lines';
import { truncate } from '../src/render/view-math';

// The TypeScript library of the project (ES2020) has no type for `Intl.Segmenter`; Node 22 has the function.
type Segmenter = new (locale: string, options: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> };
const segmenter = new (Intl as unknown as { Segmenter: Segmenter }).Segmenter('en', { granularity: 'grapheme' });
const clusters = (s: string) => Array.from(segmenter.segment(s), (x) => x.segment);

/** Every code point is 14 px wide, except marks and joiners, which take nothing (as a real font does). */
function measure(s: string): number {
	let w = 0;
	for (const ch of s) w += /[\p{M}‍️\u{1f3fb}-\u{1f3ff}]/u.test(ch) ? 0 : 14;
	return w;
}

const NAMES: Record<string, string> = {
	'flags': 'Rurik ' + '🇳🇴🇸🇪🇩🇰🇫🇮🇮🇸🇬🇧',
	'a joined family emoji': 'Rurik ' + '👨‍👩‍👧‍👦'.repeat(6),
	'an emoji with a skin tone': 'Rurik ' + '👍🏽'.repeat(10),
	'a Devanagari conjunct': 'क्षत्रिय'.repeat(6),
	'Hangul jamo': '한'.repeat(10),
};

/** The text of a cut line without its "…" and its hyphen. */
const body = (line: string) => line.replace(/[…-]$/, '');

/** Problems of one line of a name: its last cluster must be one that the name has, so that nothing is cut inside a letter. */
function split(name: string, lines: string[]): string[] {
	const whole = new Set(clusters(name));
	const bad: string[] = [];
	for (const line of lines) {
		const cs = clusters(body(line));
		const last = cs[cs.length - 1];
		if (last && !whole.has(last)) bad.push(`"${line}" ends inside the letter ${JSON.stringify(last)} (${[...last].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase()).join(' ')})`);
	}
	return bad;
}

describe('T-X2-01: a cut with "…" never falls inside a letter that has several code points', () => {
	for (const [label, name] of Object.entries(NAMES)) {
		for (const width of [100, 150]) {
			it(`T-X2-01: cardNameLines cuts ${label} inside a letter (width ${width} px)`, () => {
				const lines = cardNameLines(name, undefined, width, (t) => measure(t), 3).map(runsText);
				expect(split(name, lines)).toEqual([]);
			});
			it(`T-X2-01: nameLines (the title text line) cuts ${label} inside a letter (width ${width} px)`, () => {
				expect(split(name, nameLines(name, width, measure, 3))).toEqual([]);
			});
			it(`T-X2-01: truncate (title, dates and relation word) cuts ${label} inside a letter (width ${width} px)`, () => {
				expect(split(name, [truncate(name, width, measure)])).toEqual([]);
			});
		}
	}

	it('T-X2-01: nameLines also breaks between two text lines inside a letter when a long word has no space (a family emoji is split over two lines)', () => {
		const name = '👨‍👩‍👧‍👦'.repeat(30);
		const lines = nameLines(name, 100, measure, 3);
		const whole = new Set(clusters(name));
		const firsts = lines.map((l) => clusters(body(l))[0]).filter((c) => c && !whole.has(c));
		expect(firsts, 'a text line starts inside a letter').toEqual([]);
	});
});
