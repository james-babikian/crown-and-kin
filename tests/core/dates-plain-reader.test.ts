/*
 * Step 4.0 of WP-4: the corrections of the plain-year reader (spec §14 rule 8) and the plain readings that must not move.
 *
 * The same table runs on `yearOf` and on `readPlain`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatYear, readPlain, yearOf } from '../../src/core/succession-keys';
import { datesApi, lineOf } from '../dates-support';

type Reader = (text: string | undefined) => number | undefined;
const readers: [string, Reader][] = [['yearOf', yearOf], ['readPlain', (t) => readPlain(t).year]];

describe.each(readers)('§14 r8 corrections on %s', (_name, read) => {
	const table: [string, number][] = [
		// n BC is internal year 1 - n: no year 0 between 1 BC and AD 1.
		['1 BC', 0],
		['2 BC', -1],
		['200 BC', -199],
		['200 BCE', -199],
		['c. 200 BC', -199],
		['BC 300', -299],
		['12 000 BC', -11999],
		// A minus number is what the line shows as "n BC", so it means 1 - n (the sign U+2212 too).
		['-1', 0],
		['-200', -199],
		['−200', -199],
		// Dual dates: the later year.
		['1700/01', 1701],
		['1799/00', 1800],
		['1699/00', 1700],
		['1709/10', 1710],
		// Decimal digits of other scripts read as 0 to 9.
		['١٢٠٣', 1203],
		['१२०३', 1203],
		['１２０３', 1203],
		['c. ١٢٠٣', 1203],
		['12 May ١٢٠٣', 1203],
	];
	for (const [text, want] of table) {
		it(`§14 r8: ${JSON.stringify(text)} reads internal year ${want}`, () => {
			expect(read(text)).toBe(want);
		});
	}

	it('§14 r8: BP (before present) after a number gives no year', () => {
		for (const text of ['1500 BP', '1500 bp', 'c. 1500 BP']) expect(read(text), text).toBeUndefined();
	});

	it('§14 r8: 0 beside -1 beside 1 BC are one year; AD 1 is one year after 1 BC', () => {
		expect(read('0')).toBe(read('-1'));
		expect(read('0')).toBe(read('1 BC'));
		expect(read('1 AD')! - read('1 BC')!).toBe(1);
		expect(read('AD 45')! - read('45 BC')!).toBe(45 + 44);
	});
});

describe.each(readers)('§14 r8 readings that stay the same on %s', (_name, read) => {
	it('§14 r8: -0 reads as 0 (and is not negative zero)', () => {
		expect(Object.is(read('-0'), 0)).toBe(true);
		expect(Object.is(read('0'), 0)).toBe(true);
	});

	it('§14 r8: years after the change of era and plain years do not move', () => {
		const same: [string, number | undefined][] = [
			['1 AD', 1],
			['AD 45', 45],
			['45 CE', 45],
			['1203', 1203],
			['c. 1203', 1203],
			['12 May 1203', 1203],
			['1203-05-12', 1203],
			['spring 870', 870],
			['12', 12],
			['12000', 12000],
			['1,250', 1250],
			['AD 1,250', 1250],
			['1st century', undefined],
			['year 12', undefined],
			['long ago', undefined],
			['', undefined],
			[undefined as unknown as string, undefined],
		];
		for (const [text, want] of same) expect(read(text), String(text)).toBe(want);
	});

	it('§14 r8: a fragment of a grouped number is still no year', () => {
		for (const text of ['1.250', '12,00', 'about 1,250 men']) expect(read(text), text).toBeUndefined();
	});

	it('§14 r8: a date with a slash that is not a dual date keeps its first year ("1203/05/12")', () => {
		expect(read('1203/05/12')).toBe(1203);
	});
});

describe('§14 r8: formatYear shows an internal year y <= 0 as "(1 - y) BC"', () => {
	const table: [number, string][] = [
		[0, '1 BC'],
		[-1, '2 BC'],
		[-199, '200 BC'],
		[-11999, '12000 BC'],
	];
	for (const [y, want] of table) {
		it(`§14 r8: formatYear(${y}) is "${want}"`, () => {
			expect(formatYear(y)).toBe(want);
		});
	}

	it('§14 r8: a positive year shows as a plain number', () => {
		expect(formatYear(1)).toBe('1');
		expect(formatYear(1203)).toBe('1203');
	});

	it('§14 r8: what the line writes for a BC text reads back as the same text (round trip)', () => {
		for (const text of ['1 BC', '200 BC', '12000 BC']) {
			expect(formatYear(yearOf(text)!), text).toBe(text);
		}
	});
});

describe('§14 r8: no lookbehind in any pattern (iOS before 16.4)', () => {
	it('succession-keys.ts has no lookbehind', () => {
		const src = readFileSync('src/core/succession-keys.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		expect(src).not.toMatch(/\(\?<[=!]/);
	});
});

describe('§14 r8: the flags of the plain reader (readPlain, PLAIN_READER)', () => {
	it('§14 r8: readPlain("1700/01") is year 1701 and a dual date', () => {
		expect(readPlain('1700/01')).toMatchObject({ year: 1701, dual: true });
		expect(readPlain('1799/00')).toMatchObject({ year: 1800, dual: true });
	});
	it('§14 r8: readPlain("0") is internal year 0 and flags the zero', () => {
		expect(readPlain('0')).toMatchObject({ year: 0, zero: true });
	});
	it('§14 r8: an ordinary year has no dual and no zero flag', () => {
		expect(readPlain('1203')).toMatchObject({ year: 1203 });
		expect(readPlain('1203')!.dual).toBeUndefined();
		expect(readPlain('1203')!.zero).toBeUndefined();
		expect(readPlain('long ago')!.year).toBeUndefined();
		expect(readPlain(undefined)!.year).toBeUndefined();
	});
	it('§14 r8: PLAIN_READER.read("0") is year 0 with the warning year-zero', () => {
		const r = datesApi.PLAIN_READER.read('0')!;
		expect(r.year).toBe(0);
		expect(r.warnings).toEqual(['year-zero']);
	});
	it('§14 r8: PLAIN_READER.read("1799/00") is year 1800 and a dual date', () => {
		const r = datesApi.PLAIN_READER.read('1799/00')!;
		expect(r.year).toBe(1800);
		expect(r.dual).toBe(true);
	});
	it('§14 r8: a plain year has no warning', () => {
		expect(datesApi.PLAIN_READER.read('1203')!.warnings).toEqual([]);
		expect(datesApi.PLAIN_READER.read('200 BC')!.warnings).toEqual([]);
	});
});

// ---- What moves in the line (rule 8 "What moves") ----

const TWO_SIBLINGS = (born1: string, born2: string) => `people:
  - {id: r, name: Rolf, sex: m, born: "1000"}
  - {id: b, name: Bea, sex: f, born: "${born1}", parents: [r]}
  - {id: a, name: Ada, sex: f, born: "${born2}", parents: [r]}

titles:
  - id: crown
    name: Crown
    succession: eldest-child
    holders:
      - {person: r}
`;

describe('§14 r8: what moves in the line of succession', () => {
	it('§14 r8: a written 0 and a written 1 BC are one year, so equal years fall back to the written order', () => {
		// Written order: Bea (0), Ada (1 BC). Today 1 BC is before 0, so Ada comes first.
		expect(lineOf(TWO_SIBLINGS('0', '1 BC')).heirs).toEqual(['b', 'a']);
		expect(lineOf(TWO_SIBLINGS('1 BC', '0')).heirs).toEqual(['b', 'a']);
	});

	it('§14 r8: two different years keep their order across the change of era', () => {
		expect(lineOf(TWO_SIBLINGS('10', '5 BC')).heirs).toEqual(['a', 'b']);
		expect(lineOf(TWO_SIBLINGS('5 BC', '10')).heirs).toEqual(['b', 'a']);
	});

	const HEIR = (died: string, born: string, year: string) => `people:
  - {id: r, name: Rolf, sex: m}
  - {id: c, name: Cade, sex: m, born: "${born}", died: "${died}"}

titles:
  - id: crown
    name: Crown
    year: "${year}"
    heir: [c]
    holders:
      - {person: r}
`;

	it('§14 r8: a person who died in year 0 is no longer alive in 1 BC', () => {
		expect(lineOf(HEIR('0', '10 BC', '1 BC')).namedHeirs).toEqual([{ id: 'c', state: 'not-alive' }]);
	});

	it('§14 r8: a person born in year 0 is born in 1 BC (same year), not "not born yet"', () => {
		expect(lineOf(HEIR('50', '0', '1 BC')).namedHeirs).toEqual([{ id: 'c', state: 'first' }]);
	});

	const OLD = (year: string) => `people:
  - {id: r, name: Rolf, sex: m, born: "200 BC"}
  - {id: c, name: Cade, sex: m, born: "100 BC", parents: [r]}

titles:
  - id: crown
    name: Crown
    succession: eldest-child
    year: "${year}"
    holders:
      - {person: r, from: "200 BC"}
`;

	it('§14 r8: a difference across the change of era is one year smaller (100 BC to AD 11 is 110 years, so no old-age note)', () => {
		expect(lineOf(OLD('11'), undefined, {}, 99, 110).old).toEqual([]);
	});

	it('§14 r8: AD 12 is 111 years after 100 BC, so the old-age note shows', () => {
		expect(lineOf(OLD('12'), undefined, {}, 99, 110).old).toEqual(['c']);
	});
});
