import { describe, expect, it } from 'vitest';
import type { NameRoom } from '../src/layout/model';
import { parseBreakList } from '../src/render/break-words';
import { breakPlaces, breakWord, cardNameLines, fitRuns, nameLines, runsText, syllableBreaks, type NameMeasure } from '../src/render/name-lines';

// 0.2.4 (D117, D118, D122, D125, D127; contract 4.3 and 5): the card name with a sobriquet. The measure is a plain
// number per character, a little narrower for the regular sobriquet, so every width in these tests is plain arithmetic.
const m: NameMeasure = (s, sob) => (sob ? 6.4 : 6.8) * s.length;
const lines = (name: string, sob: string | undefined, room: number | NameRoom, max: 1 | 2 | 3 = 3, breaks?: ReturnType<typeof parseBreakList>) => cardNameLines(name, sob, room, m, max, breaks).map(runsText);
const widthOf = (runs: ReturnType<typeof cardNameLines>[number]) => runs.reduce((a, r) => a + m(r.text, r.sob), 0);

describe('cardNameLines: one text line and the sobriquet as one part (rule C)', () => {
	it('a name that fits keeps its text on one line, with the curly marks added to the sobriquet', () => {
		expect(lines('Aldric II', 'the Wise', 160)).toEqual(['Aldric II “the Wise”']);
		const runs = cardNameLines('Aldric II', 'the Wise', 160, m)[0];
		expect(runs.map((r) => [r.text, r.sob])).toEqual([['Aldric II ', false], ['“the Wise”', true]]);
	});

	it('the sobriquet moves whole to the next text line and its inner spaces never break', () => {
		expect(lines('Roderick Fitzwilliam', 'the Wise', 132)).toEqual(['Roderick', 'Fitzwilliam', '“the Wise”']);
		// 54.4 + 6.8 + 64 = 125.2 px does not fit 100 px, so the sobriquet (64 px) stands alone on text line 2.
		expect(lines('Roderick', 'the Wise', 100)).toEqual(['Roderick', '“the Wise”']);
	});

	it('a sobriquet wider than a whole text line is cut with "…" and never at a hyphen (Aldric II and "the Magnificent Defender of the North")', () => {
		const out = lines('Aldric II', 'the Magnificent Defender of the North', 132);
		expect(out).toHaveLength(2);
		expect(out[0]).toBe('Aldric II');
		expect(out[1].startsWith('“the Magnificent')).toBe(true);
		expect(out[1].endsWith('…')).toBe(true);
		expect(out[1]).not.toContain('-');
	});

	it('a person with no name text shows no sobriquet (D122)', () => {
		expect(cardNameLines('', 'the Wise', 160, m)).toEqual([[]]);
		expect(cardNameLines('   ', 'the Wise', 160, m)).toEqual([[]]);
	});

	it('a blank sobriquet adds nothing', () => {
		expect(lines('Aldric', '   ', 160)).toEqual(['Aldric']);
	});
});

describe('cardNameLines: rule D, a name of three text lines (D127)', () => {
	const FOUR = 'Alexandrovich Bartholomew Cadwallader Fitzgerald';

	it('four long words on three text lines: the last text line ends after a whole word with "…"', () => {
		expect(lines(FOUR, undefined, 132)).toEqual(['Alexandrovich', 'Bartholomew', 'Cadwallader…']);
	});

	it('the sobriquet goes first, completely: a name that needs the three text lines shows no part of it', () => {
		const out = lines(FOUR, 'the Wise', 132);
		expect(out).toEqual(['Alexandrovich', 'Bartholomew', 'Cadwallader…']);
		expect(out.join(' ')).not.toContain('“');
	});

	it('a name that fits the three text lines whole, and a sobriquet with no room: "…" after the last whole word when it fits on text line 3', () => {
		// Three words of 11 characters: three text lines of 75 px; room 100 leaves 25 px beside the last word, so the "…" (6.8) fits.
		const out = lines('Bartholomew Cadwallader Fitzgeralds', 'the Wise', 100);
		expect(out).toEqual(['Bartholomew', 'Cadwallader', 'Fitzgeralds…']);
	});

	it('the same, when the "…" has no room: the whole name shows and nothing is added; no word is dropped', () => {
		// Words of 14 characters are 95.2 px: the third text line holds 95.2 of 100 px, and the "…" (6.8) does not fit.
		const out = lines('Alexandrovichs Cadwalladerson Fitzgeraldsons', 'the Wise', 100);
		expect(out).toEqual(['Alexandrovichs', 'Cadwalladerson', 'Fitzgeraldsons']);
	});

	it('the room left on the last text line is smaller than the sobriquet: it goes completely, the name stays, a "…" follows when it fits', () => {
		// Text line 3 holds "Cadwallader Fitz" (108.8 px) of 132 px: the sobriquet (64 px and a space) does not fit beside it.
		const out = lines('Alexandrovich Bartholomew Cadwallader Fitz', 'the Wise', 132);
		expect(out).toEqual(['Alexandrovich', 'Bartholomew', 'Cadwallader Fitz…']);
	});

	it('the sobriquet keeps a text line of its own within the three text lines when the name takes two', () => {
		const out = lines('Alexandrovich Bartholomew', 'the Wise', 132);
		expect(out).toEqual(['Alexandrovich', 'Bartholomew', '“the Wise”']);
	});

	it('maxLines 2: the same rules with two text lines', () => {
		expect(lines('Aldric Bartholomew Cadwallader', 'the Wise', 132, 2)).toEqual(['Aldric Bartholomew', 'Cadwallader…']);
	});

	it('maxLines 1: a name that does not fit is cut with "…" after whole words', () => {
		expect(lines('Aldric Bartholomew Cadwallader', undefined, 132, 1)).toEqual(['Aldric Bartholomew…']);
	});

	it('only a first word that is wider than the text line is cut inside, with "…" and no hyphen', () => {
		const out = lines('Antidisestablishmentarianism Fitz', undefined, 100, 1);
		expect(out).toHaveLength(1);
		expect(out[0].endsWith('…')).toBe(true);
		expect(out[0]).not.toContain('-');
	});
});

describe('cardNameLines: rule A, the room that the arms box and the portrait leave', () => {
	const room = (full: number, last: number, only = last): NameRoom => ({ full, last, only });

	it('a name of one line that fits `full` but not `last` takes a second text line and no line ends with "…"', () => {
		// 11 characters = 74.8 px: fits 104.4 (last), so choose a narrower last.
		const out = lines('Bartholomew', undefined, room(132, 70));
		expect(out).toHaveLength(2);
		expect(out.some((l) => l.endsWith('…'))).toBe(false);
		expect(out.join('').replace('-', '')).toBe('Bartholomew');
	});

	it('two words that fit `full` together but not `last`: the last word goes to the second text line', () => {
		expect(lines('Aldric Bartholomew', undefined, room(132, 104.4))).toEqual(['Aldric', 'Bartholomew']);
	});

	it('a name of two text lines whose last line fits `last`', () => {
		const out = lines('Alexandrovich Bartholomew Cadwallader', undefined, room(132, 104.4));
		expect(out).toEqual(['Alexandrovich', 'Bartholomew', 'Cadwallader']);
		expect(widthOf(cardNameLines('Alexandrovich Bartholomew Cadwallader', undefined, room(132, 104.4), m)[2])).toBeLessThanOrEqual(104.4);
	});

	it('with `only` wider than `last` (a signed names-only card) a one-line name stays on one line', () => {
		expect(lines('Aldric Bartholomew', undefined, room(132, 104.4, 132))).toEqual(['Aldric Bartholomew']);
	});

	it('a plain number is `full`, `last` and `only` at once', () => {
		expect(lines('Aldric Bartholomew', undefined, 132)).toEqual(['Aldric Bartholomew']);
	});

	it('no text line is wider than its room, for random names and rooms (property)', () => {
		let seed = 7;
		const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
		const words = ['Aldric', 'Bartholomew', 'Cadwallader', 'Fitzgerald', 'Ann', 'Lo', 'Maximilianus', 'Wolfeschlegelstein', 'Ba-ron', 'Anne-Marie', 'Longnamunda'];
		for (let k = 0; k < 600; k++) {
			const name = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => words[Math.floor(rand() * words.length)]).join(' ');
			const sob = rand() < 0.4 ? 'the Wise One' : undefined;
			const full = 70 + Math.floor(rand() * 90);
			const last = full - Math.floor(rand() * 40);
			const max = (1 + Math.floor(rand() * 3)) as 1 | 2 | 3;
			const out = cardNameLines(name, sob, { full, last, only: last }, m, max);
			expect(out.length, name).toBeLessThanOrEqual(max);
			out.forEach((line, i) => {
				const limit = i === out.length - 1 ? last : full;
				expect(widthOf(line), `${name} / ${sob} / ${full},${last} line ${i}: ${runsText(line)}`).toBeLessThanOrEqual(limit + 1e-6);
				expect(line.length, 'a line is never empty').toBeGreaterThan(0);
			});
		}
	});
});

describe('hyphens (D117): own hyphen, syllable rule, the owner list (D118)', () => {
	it('syllableBreaks: a vowel, a consonant and a vowel break before the consonant; two consonants between vowels break between them; digraphs stay', () => {
		expect(syllableBreaks('Longnamunda')).toEqual([6, 9]);
		expect(syllableBreaks('Ana')).toEqual([]);
		expect(syllableBreaks('Ottavia')).toEqual([2, 4]);
		// "sh" is a digraph: no break between s and h.
		expect(syllableBreaks('Ashira')).toEqual([4]);
		expect(syllableBreaks('Ab')).toEqual([]);
	});

	it('breakWord gives the pieces without added hyphens', () => {
		expect(breakWord('Longnamunda')).toEqual(['Longna', 'mun', 'da']);
		expect(breakWord('Anne-Marie')).toEqual(['An', 'ne-', 'Ma', 'rie']);
	});

	it('a word that does not fit breaks with a hyphen at the end of the text line', () => {
		expect(lines('Longnamunda', undefined, 60)).toEqual(['Longna-', 'munda']);
	});

	it('a name with an own hyphen breaks at it when the part before it fits: the last own hyphen that fits', () => {
		expect(lines('Anne-Marie-Louise', undefined, 90)).toEqual(['Anne-Marie-', 'Louise']);
	});

	it('an own hyphen at index 0 leaves no text line that holds only "-"', () => {
		expect(lines('-Longnamunda', undefined, 60).some((l) => l.trim() === '-')).toBe(false);
	});

	it('the owner list wins over the simple rule, and a listed word breaks only at the owner places', () => {
		const list = parseBreakList('Lon-gnam-unda');
		expect(breakPlaces('Longnamunda', list)).toEqual([3, 7]);
		expect(breakPlaces('Longnamunda')).toEqual([6, 9]);
		// 3 letters + hyphen = 27.2 px; "Longnam" + hyphen = 54.4 px.
		expect(lines('Longnamunda', undefined, 60, 3, list)).toEqual(['Longnam-', 'unda']);
	});

	it('the second and the third piece of a word follow the list (the offsets stay offsets into the original word)', () => {
		const list = parseBreakList('Lo-ngna-mun-da');
		expect(breakPlaces('Longnamunda', list)).toEqual([2, 6, 9]);
		// 40 px: "Lo-" (20.4) is the last place of the list that fits, then "ngna-" (34), then "munda" (34) is the last text line.
		expect(lines('Longnamunda', undefined, 40, 3, list)).toEqual(['Lo-', 'ngna-', 'munda']);
	});

	it('a word of the list matches without case, and an NFD name matches the NFC entry', () => {
		const list = parseBreakList('Ame-lie');
		expect(breakPlaces('AMELIE', list)).toEqual([3]);
		expect(breakPlaces('Ame\u0301lie', parseBreakList('Amé-lie'))).toEqual([3]);
	});

	it('an entry applies only when its length is the length of the name part ("İstanbul" does not shift the offsets)', () => {
		const list = parseBreakList('İs-tanbul');
		expect(breakPlaces('İstanbul', list)).toEqual([2]);
		// lower-case "i\u0307stanbul" has 9 code points: the same key, a different length: the simple rule applies.
		expect(breakPlaces('i\u0307stanbul', list)).toEqual(syllableBreaks('i\u0307stanbul'));
	});

	it('a word with no break place that is wider than the line is cut with "…", never inside the word without it', () => {
		const out = lines('Дмитрий Александрович', undefined, 40);
		expect(out).toEqual(['Дмит…', 'Алек…']);
	});

	it('a list change changes the lines', () => {
		const a = lines('Longnamunda', undefined, 60);
		const b = lines('Longnamunda', undefined, 60, 3, parseBreakList('Lon-gnam-unda'));
		expect(a).toEqual(['Longna-', 'munda']);
		expect(b).toEqual(['Longnam-', 'unda']);
	});
});

describe('parseBreakList (contract 5.3)', () => {
	it('"Long-na-munda" gives the places [4, 6]', () => {
		expect([...parseBreakList('Long-na-munda').get('longnamunda')!.places]).toEqual([4, 6]);
		expect(parseBreakList('Long-na-munda').get('longnamunda')!.length).toBe(11);
	});

	it('splits on new lines and white space; blank lines are fine', () => {
		const list = parseBreakList('  Al-dric   Bar-ton\n\n\tFitz-gerald \r\n');
		expect([...list.keys()].sort()).toEqual(['aldric', 'barton', 'fitzgerald']);
	});

	it('skips a token with no hyphen, a leading or trailing hyphen, or a doubled hyphen (no repair)', () => {
		const list = parseBreakList('Aldric -Aldric Aldric- Al--dric Bar-ton');
		expect([...list.keys()]).toEqual(['barton']);
	});

	it('keeps at most 2000 entries', () => {
		const text = Array.from({ length: 2100 }, (_, i) => `a-b${String(i).padStart(4, 'c')}`).join('\n');
		expect(parseBreakList(text).size).toBe(2000);
	});

	it('drops a place that falls before a combining mark, and counts the places in the NFC form', () => {
		const dropped = parseBreakList('Ame-\u0301lie');
		expect([...dropped.get('am\u00e9lie')!.places]).toEqual([]);
		const nfd = parseBreakList('Ame\u0301-lie');
		expect([...nfd.get('am\u00e9lie')!.places]).toEqual([3]);
		expect(nfd.get('am\u00e9lie')!.length).toBe(6);
	});

	it('is memoised on the last text', () => {
		expect(parseBreakList('Al-dric')).toBe(parseBreakList('Al-dric'));
	});
});

describe('fitRuns', () => {
	it('cuts with "…" and keeps the style of the last kept piece', () => {
		const runs = fitRuns([{ text: 'Aldric ', sob: false }, { text: '“the Wise”', sob: true }], 90, m);
		expect(runsText(runs).endsWith('…')).toBe(true);
		expect(widthOf(runs)).toBeLessThanOrEqual(90);
	});
	it('returns the runs unchanged when they fit', () => {
		expect(runsText(fitRuns([{ text: 'Aldric', sob: false }], 90, m))).toBe('Aldric');
	});
});

// ---------------------------------------------------------------------------------------------
// L5 (D124 5, contract 5.4): the text measured stays near linear in the length of the name.
describe('L5 cost bound: measured characters stay under 40 x the length of the name', () => {
	const counting = () => {
		const stat = { measured: 0 };
		return { stat, measure: (s: string) => ((stat.measured += s.length), s.length * 7.5) };
	};
	const cases: [string, string][] = [
		['834 words, 5000 characters', Array.from({ length: 834 }, (_, i) => 'ab' + (i % 10) + 'de').join(' ')],
		['5000 letters, no space', 'ab'.repeat(2500)],
		['2500 own hyphens', 'a-'.repeat(2500)],
		['20 000 characters of words', Array.from({ length: 3300 }, (_, i) => 'ab' + (i % 10) + 'de').join(' ')],
	];
	for (const [label, name] of cases) {
		it(`nameLines: ${label}`, () => {
			const { stat, measure } = counting();
			const out = nameLines(name, 150, measure);
			expect(out.length).toBeGreaterThan(0);
			expect(stat.measured, `${name.length} characters in the name`).toBeLessThan(40 * name.length);
		});
		it(`cardNameLines: ${label}`, () => {
			const { stat, measure } = counting();
			const out = cardNameLines(name, undefined, 150, (s) => measure(s), 3);
			expect(out.length).toBeGreaterThan(0);
			expect(stat.measured, `${name.length} characters in the name`).toBeLessThan(40 * name.length);
		});
	}
	it('cardNameLines with a sobriquet and the owner list', () => {
		const { stat, measure } = counting();
		const name = 'ab'.repeat(2500);
		cardNameLines(name, 'the Wise', 150, (s) => measure(s), 3, parseBreakList('ab-ab-ab'));
		expect(stat.measured).toBeLessThan(40 * name.length);
	});
});
