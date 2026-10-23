// Step 4.1b of WP-4: unit tests of the corrections of spec §14 rule 8 in `succession-keys.ts` (my own cases; the acceptance
// table of step 4.0 is in `tests/core/dates-plain-reader.test.ts`), the year-zero warning of the plain path and the NFC fold.
import { describe, expect, it } from 'vitest';
import { compileCalendars, PLAIN_READER, type Calendar } from '../../src/core/dates';
import { formatYear, readPlain, yearOf } from '../../src/core/succession-keys';

describe('§14 rule 8: every Unicode decimal digit reads as 0 to 9', () => {
	it('each decimal digit code point reads as one digit, and a digit follows the one before it in its run', () => {
		const ND = /^\p{Nd}$/u;
		const value = (cp: number) => Math.floor(yearOf(`12${String.fromCodePoint(cp)}0`)! / 10) % 10;
		let count = 0;
		for (let cp = 0x80; cp <= 0x10ffff; cp++) {
			if (!ND.test(String.fromCodePoint(cp))) continue;
			count++;
			const v = value(cp);
			expect(v >= 0 && v <= 9, `U+${cp.toString(16)}`).toBe(true);
			if (ND.test(String.fromCodePoint(cp - 1))) expect(v, `U+${cp.toString(16)}`).toBe((value(cp - 1) + 1) % 10);
			else expect(v, `U+${cp.toString(16)} starts a run`).toBe(0);
		}
		expect(count).toBeGreaterThan(500);
	}, 30_000);

	it('the runs of Unicode decimal digits are whole sets of ten that start with a zero', () => {
		// A run that does not start at a multiple of ten from its start would read wrong; this finds one.
		const ND = /^\p{Nd}$/u;
		const bad: string[] = [];
		let run = 0;
		for (let cp = 0x80; cp <= 0x110000; cp++) {
			if (cp < 0x110000 && ND.test(String.fromCodePoint(cp))) run++;
			else {
				if (run % 10 !== 0) bad.push(`U+${cp.toString(16)}`);
				run = 0;
			}
		}
		expect(bad, 'runs that do not have a length of a multiple of ten').toEqual([]);
	}, 30_000);

	it('other scripts read in a plain text, with a dual date, with BC and in a longer text', () => {
		expect(yearOf('１２０３')).toBe(1203);
		expect(yearOf('𝟏𝟐𝟎𝟑')).toBe(1203);
		expect(yearOf('𝟣𝟤𝟢𝟥')).toBe(1203);
		expect(yearOf('c. ١٢٠٣')).toBe(1203);
		expect(yearOf('٢٠٠ BC')).toBe(-199);
		expect(readPlain('١٧٠٠/٠١')).toMatchObject({ year: 1701, dual: true });
		expect(readPlain('c. １２０３').approx).toBe(true);
		expect(readPlain('٠')).toMatchObject({ year: 0, zero: true });
	});
});

describe('§14 rule 8: no year 0', () => {
	it('n BC and -n are 1 - n in every written form', () => {
		for (const t of ['1 BC', '1BC', 'BC 1', 'B.C. 1', '1 BCE', '-1', '−1', '1 b.c.']) expect(yearOf(t), t).toBe(0);
		for (const t of ['2 BC', 'BC 2', '-2']) expect(yearOf(t), t).toBe(-1);
		expect(yearOf('c. 44 BC')).toBe(-43);
		expect(yearOf('BC 1,250')).toBe(-1249);
		expect(yearOf('-999999999999999')).toBe(-999999999999998);
	});

	it('a written zero is year 0 with the flag, also in a BC or AD form', () => {
		for (const t of ['0', '00', '-0', '−0', '0 BC', 'BC 0', '0 AD', '٠', 'c. 0']) {
			// "c. 0" has no run of three digits and no BC mark: it is no year at all.
			if (t === 'c. 0') expect(readPlain(t).year, t).toBeUndefined();
			else expect(readPlain(t), t).toMatchObject({ year: 0, zero: true });
		}
		expect(Object.is(readPlain('-0').year, 0)).toBe(true);
		expect(readPlain('1').zero).toBeUndefined();
		expect(readPlain('1 BC').zero).toBeUndefined();
		expect(readPlain('2 BC').zero).toBeUndefined();
	});

	it('formatYear shows (1 - y) BC for y <= 0 and a plain number above', () => {
		expect([0, -1, -224, 1, 2, 1210].map(formatYear)).toEqual(['1 BC', '2 BC', '225 BC', '1', '2', '1210']);
	});

	it('what the line writes reads back as the same year for every BC year from 1 to 3000', () => {
		for (let n = 1; n <= 3000; n++) expect(yearOf(formatYear(1 - n))).toBe(1 - n);
	});

	it('the plain path warns year-zero for a written zero only', () => {
		for (const t of ['0', '-0', '0 BC']) expect(PLAIN_READER.read(t)!.warnings, t).toEqual(['year-zero']);
		for (const t of ['1', '1 BC', '2 BC', '1203', 'long ago']) expect(PLAIN_READER.read(t)!.warnings, t).toEqual([]);
		expect(compileCalendars([], true).read('0')!.warnings).toEqual(['year-zero']);
		// A calendar that does not match leaves the plain reading, with its warning.
		expect(compileCalendars([], true).read('0')!.source).toBe('plain');
	});
});

describe('§14 rule 8: BP after a number gives no year', () => {
	it('gives no year for BP in any written form', () => {
		for (const t of ['1500 BP', '1500BP', '1500 bp', '1500 B.P.', 'c. 1500 BP', '1500 BP.', 'about 1500 BP (radiocarbon)']) expect(yearOf(t), t).toBeUndefined();
	});

	it('skips only the number that BP follows', () => {
		expect(yearOf('1203 or 1500 BP')).toBe(1203);
		expect(yearOf('1500 BP, 1203')).toBe(1203);
		expect(yearOf('1500 BP 1203 AD')).toBe(1203);
	});

	it('does not take a word that only starts with BP', () => {
		expect(yearOf('1500 BPM')).toBe(1500);
		expect(yearOf('1500 bpx')).toBe(1500);
	});
});

describe('§14 rule 8 and the architecture notes §5.7 ruling 3: dual dates', () => {
	it('reads the later year when the part after the slash fits', () => {
		const rows: [string, number][] = [
			['1700/01', 1701],
			['1700/1', 1701],
			['1799/00', 1800],
			['1699/00', 1700],
			['1709/10', 1710],
			['c. 1700/01', 1701],
			['March 1700/01', 1701],
			['1203/4', 1204],
			['1800/01', 1801],
			// ruling 4.1b vet: dual only up to 1800 ('1999/00' was a dual date before)
		];
		for (const [t, y] of rows) expect(readPlain(t), t).toMatchObject({ year: y, dual: true });
	});

	it('a first year after 1800 is not a dual date: it reads that year and has no dual flag', () => {
		// ruling 4.1b vet: dual only up to 1800
		const rows: [string, number][] = [['1801/02', 1801], ['1850/51', 1850], ['1905/06', 1905], ['1999/00', 1999], ['2008/09', 2008]];
		for (const [t, y] of rows) {
			const r = readPlain(t);
			expect(r.year, t).toBe(y);
			expect(r.dual, t).toBeUndefined();
		}
	});

	it('reads the first year when the part after the slash is anything else', () => {
		for (const t of ['1700/05', '1700/02', '1700/001', '1203/05/12', '1203/04/12', '12/05/1203']) {
			const r = readPlain(t);
			expect(r.dual, t).toBeUndefined();
		}
		expect(yearOf('1700/05')).toBe(1700);
		expect(yearOf('1203/04/12')).toBe(1203);
		expect(yearOf('12/05/1203')).toBe(1203);
	});

	it('the approximate flag stays beside the dual flag', () => {
		expect(readPlain('c. 1700/01')).toMatchObject({ year: 1701, dual: true, approx: true });
	});
});

describe('§14 rule 8: readings that did not move', () => {
	it('a plain year, AD and a day-month-year text read as before', () => {
		const rows: [string, number | undefined][] = [
			['1203', 1203],
			['AD 1', 1],
			['1 AD', 1],
			['12 May 1203', 1203],
			['12', 12],
			['c. 12000', undefined],
			['1,250', 1250],
			['1.250', undefined],
			['long ago', undefined],
		];
		for (const [t, y] of rows) expect(yearOf(t), t).toBe(y);
	});

	it('never throws for a text that is not a string', () => {
		expect(readPlain(undefined)).toEqual({});
		expect(readPlain(12 as unknown as string)).toEqual({});
		expect(readPlain(null as unknown as string)).toEqual({});
	});
});

describe('§14 rule 4 and the ruling of 4.1a: the fold applies Unicode NFC', () => {
	const eraCal = (eraName: string, format: string): Calendar => ({
		id: 'C.md#0#0',
		name: 'Court',
		note: 'C.md',
		formats: [format],
		kind: { type: 'eras', eras: [{ name: eraName, start: 100 }] },
	});

	it('an era name typed with a combining mark matches a text typed with the one-piece letter, and the other way round', () => {
		const composed = 'Café Emperor';
		const decomposed = 'Café Emperor';
		expect(compileCalendars([eraCal(composed, '{era} {year}')], true).read(`${decomposed} 3`)?.year).toBe(102);
		expect(compileCalendars([eraCal(decomposed, '{era} {year}')], true).read(`${composed} 3`)?.year).toBe(102);
	});

	it('a format typed decomposed matches a text typed composed', () => {
		expect(compileCalendars([eraCal('Qing', 'Année {year} de {era}')], true).read('Année 3 de Qing')?.year).toBe(102);
		expect(compileCalendars([eraCal('Qing', 'Année {year} de {era}')], true).read('Année 3 de Qing')?.year).toBe(102);
	});

	it('a letter with a combining mark is still a letter at the edge of a match', () => {
		// "Qinge + combining mark" is a longer word: the mark touches the end of "Qinge", so it is no match for the era "Qinge".
		expect(compileCalendars([eraCal('Qinge', '{era} {year}')], true).read('Qinge\u0301 3')?.source).toBe('none');
	});
});
