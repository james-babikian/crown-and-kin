/*
 * Version 0.5 step 1a-B: `exactYear` (an internal study §5). A shape for every kind of text that gives an exact year, a
 * test for every kind of text that does not, the calendar reads, the readiness of the reader, the memo and the side flag of `dates.ts`.
 */

import { describe, expect, it } from 'vitest';
import { compileCalendars, isExactCalendarRead, MEMO_CAP, PLAIN_READER, type Calendar } from '../../src/core/dates';
import { exactYear } from '../../src/core/exact-year';
import type { NameList } from '../../src/core/name-lists';

const plain = (text: string | undefined) => exactYear(text, PLAIN_READER);

describe('plain texts that give an exact year (RULES §5.2 item 4)', () => {
	const rows: [string, number][] = [
		['1135', 1135],
		['  1135  ', 1135],
		['-200', -199],
		['−200', -199],
		['5', 5],
		['1135 AD', 1135],
		['1135 A.D.', 1135],
		['1135 CE', 1135],
		['1135 C.E.', 1135],
		['AD 1135', 1135],
		['CE 1135', 1135],
		['200 BC', -199],
		['200 B.C.', -199],
		['200 BCE', -199],
		['200 B.C.E.', -199],
		['BC 200', -199],
		['12 May 1135', 1135],
		['May 1135', 1135],
		['May, 1135', 1135],
		['12th May 1135', 1135],
		['1st May 1135', 1135],
		['12 may 1135', 1135],
		['12 MAY 1135', 1135],
		['12 Sept 1135', 1135],
		['12 Sep. 1135', 1135],
		['12 September 1135', 1135],
		['May 12, 1135', 1135],
		['May. 12, 1135', 1135],
		['May 12th, 1135 AD', 1135],
		['12 May 200 BC', -199],
		['12th of May 1135', 1135],
		['12th of May, 1135', 1135],
		['12/5/1135', 1135],
		['12.5.1135', 1135],
		['12-5-1135', 1135],
		['1135-05-12', 1135],
	];
	for (const [text, year] of rows) {
		it(`${JSON.stringify(text)} is ${year}`, () => expect(plain(text)).toBe(year));
	}
});

describe('plain texts that give no exact year (the old word stays)', () => {
	const rows = [
		'c. 1135',
		'ca. 1135',
		'~1135',
		'about 1135',
		'circa 1135',
		'abt 1135',
		'before 1135',
		'after 1135',
		'bet 1130 and 1135',
		'between 1130 and 1135',
		'1130 or 1131',
		'1130–35',
		'1130-35',
		'1130/35',
		'1130s',
		'1135?',
		'1135 (in Rome)',
		'Year 1135 of Cycle 2',
		'in 1135',
		'12 Mai 1135',
		'1135 and 1136',
		'12 May 35',
		'May 12, 35',
		'12345',
		'0',
		'-0',
		'unknown',
		'no',
		'alive',
		'',
		' ',
		'1,135',
		'1.135',
		'12/5',
		'13 15 1135',
		'32 May 1135',
		'May 32, 1135',
	];
	for (const text of rows) {
		it(`${JSON.stringify(text)} is not exact`, () => expect(plain(text)).toBeUndefined());
	}
	it('a value that is not text is not exact', () => {
		expect(plain(undefined)).toBeUndefined();
		expect(exactYear(1135 as unknown as string, PLAIN_READER)).toBeUndefined();
	});
});

describe('the year comes from the reader, never from a second parse', () => {
	it('"200 BC" and "-200" are the internal years of the reader', () => {
		expect(plain('200 BC')).toBe(PLAIN_READER.read('200 BC')?.year);
		expect(plain('-200')).toBe(PLAIN_READER.read('-200')?.year);
	});
	it('a dual date and a written zero are not exact', () => {
		expect(plain('1700/01')).toBeUndefined();
		expect(plain('0 BC')).toBeUndefined();
	});
});

const cycles: Calendar = { id: 'C.md#0#0', name: 'C', note: 'C.md', formats: ['Year {year} of Cycle {cycle}'], kind: { type: 'cycles', length: 28, start: 1100 } };

describe('calendar reads (RULES §5.2 item 3)', () => {
	const ready = compileCalendars([cycles], true);
	it('a whole calendar date is exact; the reader gives its year', () => {
		expect(exactYear('Year 3 of Cycle 2', ready)).toBe(1130);
		expect(exactYear('  year 3 of cycle 2  ', ready)).toBe(1130);
	});
	it('a calendar date with more text, a qualifier or a second date is not exact', () => {
		const texts = ['c. Year 3 of Cycle 2', 'about Year 3 of Cycle 2', 'Year 3 of Cycle 2 (in Rome)', 'in Year 3 of Cycle 2', 'Year 3 of Cycle 2 and Year 4 of Cycle 2', 'Year 3 of Cycle 2 or so'];
		for (const text of texts) {
			expect(exactYear(text, ready), text).toBeUndefined();
			expect(ready.read(text)?.year, `${text} is still read`).toBeDefined();
		}
	});
	it('a range skipped at its second number is not exact', () => {
		const ranged: Calendar = { id: 'E.md#0#0', name: 'E', note: 'E.md', formats: ['{year} c{cycle}'], kind: { type: 'cycles', length: 28, start: 1100 } };
		const reader = compileCalendars([ranged], true);
		expect(exactYear('3-5 c2', reader)).toBeUndefined();
		expect(reader.read('3-5 c2')?.year).toBeDefined();
		expect(exactYear('3 c2', reader)).toBe(1130);
	});
	it('a plain year in a tree that names a calendar is exact by the shape gate', () => {
		expect(exactYear('1135', ready)).toBe(1135);
		expect(exactYear('c. 1135', ready)).toBeUndefined();
	});
	it('a date that two calendars read differently has no year, so it is not exact', () => {
		const both = compileCalendars([cycles, { ...cycles, id: 'D.md#0#0', name: 'D', note: 'D.md', kind: { type: 'cycles', length: 10, start: 1000 } }], true);
		expect(both.read('Year 3 of Cycle 2')?.year).toBeUndefined();
		expect(exactYear('Year 3 of Cycle 2', both)).toBeUndefined();
	});
	it('a warning of the reader (a year past the end of its cycle) is not exact', () => {
		expect(exactYear('Year 29 of Cycle 1', ready)).toBeUndefined();
		expect(ready.read('Year 29 of Cycle 1')?.warnings).toContain('calendar-year-past-end');
	});
	it('the flag is in a side table: a read has no new key', () => {
		const r = ready.read('Year 3 of Cycle 2')!;
		expect(isExactCalendarRead(r)).toBe(true);
		expect(Object.keys(r).sort()).toEqual(['calendar', 'count', 'source', 'span', 'text', 'warnings', 'year']);
		expect(isExactCalendarRead(ready.read('Year 3 of Cycle 2 (in Rome)')!)).toBe(false);
		expect(isExactCalendarRead(PLAIN_READER.read('1135')!)).toBe(false);
	});
});

describe('the reader that is not ready', () => {
	it('gives no exact year for any text, not even a plain year (RULES §5.1)', () => {
		const pending = compileCalendars([cycles], false);
		expect(pending.ready).toBe(false);
		expect(exactYear('1135', pending)).toBeUndefined();
		expect(exactYear('Year 3 of Cycle 2', pending)).toBeUndefined();
	});
});

describe('year names of the plain years (RULES §5.2 item 4, last shape)', () => {
	const list: NameList = { name: 'Planets', names: [{ name: 'Saturn' }, { name: 'Jupiter' }], known: { year: 1135, index: 0 }, show: 'full' };
	const reader = compileCalendars([], true, [], [list]);
	it('a year followed by its name is exact', () => {
		expect(reader.read('1135 Saturn')?.whole).toBe(true);
		expect(exactYear('1135 Saturn', reader)).toBe(1135);
	});
	it('a year with the wrong name (a warning), or with an approximate prefix, is not exact', () => {
		expect(exactYear('1135 Jupiter', reader)).toBeUndefined();
		expect(exactYear('c. 1135 Saturn', reader)).toBeUndefined();
	});
	it('a plain shape still reads in a tree with lists', () => {
		expect(exactYear('12 May 1135', reader)).toBe(1135);
	});
});

describe('the memo', () => {
	it('is for each reader: two readers never share an answer', () => {
		const a = compileCalendars([cycles], true);
		const b = compileCalendars([{ ...cycles, kind: { type: 'cycles', length: 28, start: 2000 } }], true);
		expect(exactYear('Year 3 of Cycle 2', a)).toBe(1130);
		expect(exactYear('Year 3 of Cycle 2', b)).toBe(2030);
		expect(exactYear('Year 3 of Cycle 2', a)).toBe(1130);
	});
	it('gives the same answer on a second ask, also for a text with no exact year, and stays bounded', () => {
		const reader = compileCalendars([], true, [{ key: 'calendar-note-missing' }]);
		expect(exactYear('1135', reader)).toBe(1135);
		expect(exactYear('1135', reader)).toBe(1135);
		expect(exactYear('c. 1135', reader)).toBeUndefined();
		expect(exactYear('c. 1135', reader)).toBeUndefined();
		for (let i = 0; i < MEMO_CAP + 5; i++) exactYear(`${100 + (i % 800)}${' '.repeat(1 + Math.floor(i / 800))}`, reader);
		expect(exactYear('1135', reader)).toBe(1135);
	});
});
