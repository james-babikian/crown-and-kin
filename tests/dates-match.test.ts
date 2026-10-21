/*
 * Step 4.0 of WP-4: the case table of spec §14 rules 1, 4 and 5 and the reader contract of rule 9 (`compileCalendars`,
 * `PLAIN_READER`, `DateReader`). Every example of the owner's doc (The Long Count, Reign names, Qinglong Emperor start
 * 130 length 11, Jianwen Emperor start 141, Shōwa 64 / Heisei 1, "Third Age 3019" with no calendar) is a row.
 *
 * The numbers are worked out by hand from the rule, never taken from a run:
 *   cycle:  year Y of cycle C = S + (C - 1) * L + (Y - 1)        (The Long Count: S = 1, L = 60)
 *   era:    year Y of era E   = S(E) + (Y - 1)
 *
 * Enable at 4.1a: the whole file is skipped until `src/core/dates.ts` exists, then it runs by itself.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { yearOf } from '../src/core/succession-keys';
import { ALDRIC, copyOf, FULL_SET, JAPAN, LONG_COUNT, loadDatesApi, namedBy, names, QING, REIGN_NAMES, type CalendarDef, type DatesApi } from './dates-support';

const api = await loadDatesApi();

if (!api) it.todo('enable at 4.1a: the case table of §14 rules 4 and 5 (needs src/core/dates.ts)');

type Row = [text: string, year: number | undefined, warnings?: string[]];

describe.skipIf(!api)('§14 r4, r5: matching and the year', () => {
	const A = api as DatesApi;
	const read = (cals: CalendarDef[], text: string) => A.compileCalendars(cals, true).read(text)!;

	function table(title: string, cals: CalendarDef[], rows: Row[]) {
		describe(title, () => {
			for (const [text, year, warnings = []] of rows) {
				it(`§14 r5: ${JSON.stringify(text)} is year ${year ?? 'none'}${warnings.length ? ` with ${warnings.join(', ')}` : ''}`, () => {
					const r = read(cals, text);
					expect(r.year).toBe(year);
					expect([...r.warnings].sort()).toEqual([...warnings].sort());
					expect(r.text).toBe(text);
					expect(r.source).toBe(year === undefined ? 'none' : 'calendar');
				});
			}
		});
	}

	table('The Long Count (S = 1, L = 60): the formula', [LONG_COUNT], [
		['Year 1 of Cycle 1', 1],
		['Year 60 of Cycle 1', 60],
		['Year 1 of Cycle 2', 61],
		['Year 5 of Cycle 3', 125],
		['10 Year of the 3 Cycle', 130],
		['21st Year of the 3rd Cycle', 141],
		['Year 5 of Cycle 31', 1805],
		['Year 1203 of Cycle 3', 1323, ['calendar-year-past-end']],
	]);

	table('The Long Count: the four number forms in a number place', [LONG_COUNT], [
		['10th Year of the 3rd Cycle', 130],
		['ten Year of the three Cycle', 130],
		['tenth Year of the third Cycle', 130],
		['X Year of the III Cycle', 130],
		['x year of the iii cycle', 130],
		['twenty-first Year of the third Cycle', 141],
		['twenty first Year of the third Cycle', 141],
		['Twenty-First Year of the Third Cycle', 141],
		['Year seventeen of Cycle 3', 137],
		['ninety-nine Year of the first Cycle', 99, ['calendar-year-past-end']],
		['Year 1 of Cycle MMMCMXCIX', 239881],
	]);

	table('The Long Count: Cycle 0, Year 0, past the end', [LONG_COUNT], [
		// Cycle 0 is the cycle before Cycle 1.
		['Year 1 of Cycle 0', -59],
		['Year 60 of Cycle 0', 0],
		// Year 0 is the year before Year 1: Year 0 of Cycle 3 is the last year of Cycle 2 (120 = Year 60 of Cycle 2).
		['Year 0 of Cycle 3', 120, ['calendar-year-zero']],
		['Year 0 of Cycle 1', 0, ['calendar-year-zero']],
		// Year above L counts on and warns.
		['Year 61 of Cycle 1', 61, ['calendar-year-past-end']],
		['Year 60 of Cycle 1', 60],
	]);

	it('§14 r5: Year 0 of Cycle 3 is the last year of Cycle 2', () => {
		expect(read([LONG_COUNT], 'Year 0 of Cycle 3').year).toBe(read([LONG_COUNT], 'Year 60 of Cycle 2').year);
	});

	it('§14 r5: Year 61 of Cycle 1 is Year 1 of Cycle 2 (it counts on)', () => {
		expect(read([LONG_COUNT], 'Year 61 of Cycle 1').year).toBe(read([LONG_COUNT], 'Year 1 of Cycle 2').year);
	});

	table('The Long Count: folding and where the match may stand', [LONG_COUNT], [
		['  YEAR   5\tof   CYCLE 3  ', 125],
		['He died in Year 5 of Cycle 3 of fever', 125],
		['Year 5 of Cycle 3, a hard winter', 125],
		['the fifth year of the third cycle', 125],
	]);

	table('The Long Count: texts with no year', [LONG_COUNT], [
		// A letter or a digit may not touch either end of the match.
		['xYear 5 of Cycle 3', undefined],
		['Year 5 of Cycle 3x', undefined],
		['2Year 5 of Cycle 3', undefined],
		// A negative cycle number is never read.
		['Year 5 of Cycle -1', undefined],
		['Year 5 of Cycle', undefined],
		// Words go to 99 and Roman numerals are a value only in a place.
		['Year one hundred of Cycle 3', undefined],
		['X', undefined],
		['iii', undefined],
		['ten', undefined],
		['twenty-first', undefined],
		['the fifth year of the third age', undefined],
	]);

	table('Reign names (Qinglong Emperor 130, length 11; Jianwen Emperor 141)', [REIGN_NAMES], [
		['Qinglong Emperor 1', 130],
		['Qinglong Emperor 3', 132],
		['3 Year of the Qinglong Emperor', 132],
		['third Year of the Qinglong Emperor', 132],
		['Qinglong Emperor 3rd', 132],
		['qinglong emperor 3', 132],
		['Qinglong Emperor 11', 140],
		['Qinglong Emperor 12', 141, ['calendar-year-past-end']],
		['Qinglong Emperor 31', 160, ['calendar-year-past-end']],
		['Qinglong Emperor 0', 129, ['calendar-year-zero']],
		['Jianwen Emperor 1', 141],
		['Jianwen Emperor 21', 161],
		// No length: no end, so no warning at any number.
		['Jianwen Emperor 500', 640],
		// Roman numerals directly after an era name are Year II (owner, 2026-10-19).
		['Qinglong Emperor II', 131],
		['Qinglong Emperor X', 139],
		['Qinglong Emperor third', 132],
	]);

	table('Reign names: texts with no year', [REIGN_NAMES], [
		['late in the Qinglong Emperor era', undefined],
		['Qinglong Emperor', undefined],
		// "Qinglong" alone is not an era name of this calendar.
		['Qinglong 3', undefined],
		['xQinglong Emperor 3', undefined],
		['Qinglong Emperor 3x', undefined],
	]);

	table('Reign names: more than one match in a text', [REIGN_NAMES], [
		// The first match in text order wins, not the smallest year.
		['Qinglong Emperor 3 or Qinglong Emperor 4', 132],
		['Qinglong Emperor 4 or Qinglong Emperor 3', 133],
		['Jianwen Emperor 2 or Qinglong Emperor 3', 142],
		// A range reads its first date.
		['between Qinglong Emperor 3 and 5', 132],
		// The calendar reader runs before the plain reader, wherever the plain number stands.
		['Qinglong Emperor 3, 1203', 132],
		['1203, Qinglong Emperor 3', 132],
	]);

	table('Shōwa 64 and Heisei 1 (eras that share one year)', [JAPAN], [
		['Shōwa 1', 1926],
		['Shōwa 64', 1989],
		['Heisei 1', 1989],
		['SHŌWA 64', 1989],
		['Heisei 31', 2019],
		['Shōwa 65', 1990, ['calendar-year-past-end']],
		['Heisei 32', 2020, ['calendar-year-past-end']],
		['Heisei 0', 1988, ['calendar-year-zero']],
		// Only the case and the white space are folded, not the macron.
		['Showa 64', undefined],
	]);

	it('§14 r1: Shōwa 64 and Heisei 1 are the same year, inside one calendar, with no warning of two calendars', () => {
		const a = read([JAPAN], 'Shōwa 64');
		const b = read([JAPAN], 'Heisei 1');
		expect(a.year).toBe(b.year);
		expect(a.warnings).toEqual([]);
		expect(b.warnings).toEqual([]);
	});

	it('§14 r4: the longest era name wins, whatever the order of the eras', () => {
		const reversed: CalendarDef = { ...QING, kind: { type: 'eras', eras: [...(QING.kind as { eras: { name: string; start: number }[] }).eras].reverse() } };
		for (const cal of [QING, reversed]) {
			expect(read([cal], 'Qing Emperor 3').year).toBe(602);
			expect(read([cal], 'Qing 3').year).toBe(502);
		}
	});

	describe('prefixes that make a date approximate', () => {
		for (const prefix of ['c. ', 'ca. ', 'about ', 'circa ', '~', 'ABOUT ']) {
			it(`§14 r4: ${JSON.stringify(prefix)} keeps the year and marks it approximate`, () => {
				const r = read([LONG_COUNT], `${prefix}Year 5 of Cycle 3`);
				expect(r.year).toBe(125);
				expect(r.approx).toBe(true);
				const e = read([REIGN_NAMES], `${prefix}Qinglong Emperor 3`);
				expect(e.year).toBe(132);
				expect(e.approx).toBe(true);
			});
		}
		it('§14 r4: no prefix, no approx', () => {
			expect(read([LONG_COUNT], 'Year 5 of Cycle 3').approx).toBeUndefined();
		});
	});

	describe('a text that fits no format goes to the plain reader (§13.21 rule 5)', () => {
		const rows: [string, number | undefined][] = [
			['1203', 1203],
			['c. 1203', 1203],
			['12 May 1203', 1203],
			['1203-05-12', 1203],
			['Third Age 3019', 3019],
			['spring 870', 870],
			['1st century', undefined],
			['long ago', undefined],
		];
		for (const [text, year] of rows) {
			it(`§14 r4: ${JSON.stringify(text)} reads ${year ?? 'no year'} as plain, also with calendars loaded`, () => {
				for (const cals of [[] as CalendarDef[], [LONG_COUNT, REIGN_NAMES], FULL_SET]) {
					const r = read(cals, text);
					expect(r.year).toBe(yearOf(text));
					expect(r.year).toBe(year);
					expect(r.source).toBe(year === undefined ? 'none' : 'plain');
				}
			});
		}
		it('§14 r10: "Third Age 3019" with no calendar reads 3019 and the calendar-free reader says so', () => {
			const r = A.PLAIN_READER.read('Third Age 3019')!;
			expect(r.year).toBe(3019);
			expect(r.source).toBe('plain');
		});
	});

	describe('two matches at the same place', () => {
		const SWAP: CalendarDef = {
			id: 'Swap.md#0#0',
			name: 'Swap',
			note: 'Swap.md',
			formats: ['{year} {cycle}', '{cycle} {year}'],
			kind: { type: 'cycles', length: 60, start: 1 },
		};
		it('§14 r4: two matches at the same place with different years give no year and say so (not a warning)', () => {
			const r = read([SWAP], '1 2');
			expect(r.year).toBeUndefined();
			expect(r.samePlace).toBe(true);
			expect(r.warnings).toEqual([]);
		});
		it('§14 r4: two matches at the same place with the same year give that year', () => {
			const r = read([SWAP], '2 2');
			expect(r.year).toBe(62);
			expect(r.samePlace).toBeUndefined();
		});
	});

	describe('two calendars (family history S1: equal calendars keep the year)', () => {
		const COPY = copyOf(LONG_COUNT, 'Calendars 1.md');
		it('§14 r4: the same text in two calendars that give the same year keeps the year, and both are named', () => {
			const r = read([LONG_COUNT, COPY], 'Year 5 of Cycle 3');
			expect(r.year).toBe(125);
			expect(r.warnings).toEqual([]);
			expect(r.also).toHaveLength(1);
			const named = namedBy(r);
			expect(named.some((x) => names(x, LONG_COUNT))).toBe(true);
			expect(named.some((x) => names(x, COPY))).toBe(true);
		});

		it('§14 r4: the same text in two calendars that give different years has no year, with fits-two-calendars, and both are named', () => {
			const other = copyOf(LONG_COUNT, 'Calendars 1.md', { kind: { type: 'cycles', length: 60, start: 2 } });
			const r = read([LONG_COUNT, other], 'Year 5 of Cycle 3');
			expect(r.year).toBeUndefined();
			expect(r.warnings).toEqual(['fits-two-calendars']);
			const named = namedBy(r);
			expect(named.some((x) => names(x, LONG_COUNT))).toBe(true);
			expect(named.some((x) => names(x, other))).toBe(true);
		});

		it('§14 r4: when the years differ the text does not fall back to a plain number in it', () => {
			const other = copyOf(LONG_COUNT, 'Calendars 1.md', { kind: { type: 'cycles', length: 60, start: 2 } });
			expect(read([LONG_COUNT, other], 'Year 5 of Cycle 3, 1203').year).toBeUndefined();
		});

		it('§14 r4: the same era name in two calendar notes: a date with that name fits two calendars', () => {
			const same = copyOf(REIGN_NAMES, 'Calendars 1.md');
			expect(read([REIGN_NAMES, same], 'Qinglong Emperor 3').year).toBe(132);
			const moved = copyOf(REIGN_NAMES, 'Calendars 1.md', {
				kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 500, length: 11 }, { name: 'Jianwen Emperor', start: 141 }] },
			});
			const r = read([REIGN_NAMES, moved], 'Qinglong Emperor 3');
			expect(r.year).toBeUndefined();
			expect(r.warnings).toEqual(['fits-two-calendars']);
			// Jianwen Emperor is the same in both: that date keeps its year.
			expect(read([REIGN_NAMES, moved], 'Jianwen Emperor 2').year).toBe(142);
		});
	});

	describe('a full calendar set captures no date that another calendar or the plain reader owns', () => {
		const owned: [string, number][] = [
			['Year 5 of Cycle 3', 125],
			['21st Year of the 3rd Cycle', 141],
			['Qinglong Emperor 3', 132],
			['Jianwen Emperor 21', 161],
			['Shōwa 64', 1989],
			['Heisei 1', 1989],
			['Aldric 10', 1109],
			['1203', 1203],
			['c. 1203', 1203],
			['Third Age 3019', 3019],
		];
		for (const [text, year] of owned) {
			it(`§14 r11: ${JSON.stringify(text)} is year ${year} with the full set`, () => {
				const r = read(FULL_SET, text);
				expect(r.year).toBe(year);
				expect(r.warnings).toEqual([]);
			});
		}
		it('§14 r1: Aldric (start 1100) is year 1099 + N', () => {
			expect(read([ALDRIC], 'Aldric 1').year).toBe(1100);
			expect(read([ALDRIC], 'Aldric 50').year).toBe(1149);
			expect(read([ALDRIC], 'Aldric 51').year).toBe(1150);
		});
	});
});

describe.skipIf(!api)('§14 r9: the reader (ready, key, plain reader, memo)', () => {
	const A = api as DatesApi;

	it('§14 r9: PLAIN_READER is ready, has key "plain" and no problems', () => {
		expect(A.PLAIN_READER.ready).toBe(true);
		expect(A.PLAIN_READER.key).toBe('plain');
		expect(A.PLAIN_READER.problems).toEqual([]);
	});

	it('§14 r9: PLAIN_READER reads like yearOf and never reads a calendar text', () => {
		for (const text of ['1203', 'c. 1203', '12 May 1203', 'Third Age 3019', 'Year 5 of Cycle 3', 'Qinglong Emperor 3', '', 'x']) {
			const r = A.PLAIN_READER.read(text);
			expect(r?.year, text).toBe(yearOf(text));
			expect(r?.source === 'calendar', text).toBe(false);
		}
		expect(A.PLAIN_READER.read(undefined)).toBeUndefined();
	});

	it('§14 r9: read(undefined) is undefined for a compiled reader', () => {
		expect(A.compileCalendars([LONG_COUNT], true).read(undefined)).toBeUndefined();
	});

	it('§14 r9: a calendar match says which calendar it came from and keeps the text as written', () => {
		const r = A.compileCalendars([LONG_COUNT, REIGN_NAMES], true).read('Qinglong Emperor 3')!;
		expect(r.source).toBe('calendar');
		expect(names(r.calendar, REIGN_NAMES)).toBe(true);
		expect(r.text).toBe('Qinglong Emperor 3');
	});

	it('§14 r9: key is "pending" while not ready, with or without calendars', () => {
		expect(A.compileCalendars([], false).key).toBe('pending');
		expect(A.compileCalendars([LONG_COUNT], false).key).toBe('pending');
	});

	it('§14 r9: key is "plain" when ready with no calendars and no problem', () => {
		expect(A.compileCalendars([], true).key).toBe('plain');
	});

	it('§14 r9: key is neither "plain" nor "pending" with calendars or with a problem, so the ready moment changes the key', () => {
		const withCals = A.compileCalendars([LONG_COUNT], true).key;
		expect(['plain', 'pending']).not.toContain(withCals);
		const withProblem = A.compileCalendars([], true, [{ key: 'calendar-note-missing', note: 'Nowhere' }]);
		expect(['plain', 'pending']).not.toContain(withProblem.key);
		expect(withProblem.problems).toEqual([{ key: 'calendar-note-missing', note: 'Nowhere' }]);
	});

	it('§14 r9: the key follows the content: the same content gives the same key, any order; a change of a start gives another key', () => {
		const a = A.compileCalendars([LONG_COUNT, REIGN_NAMES], true).key;
		expect(A.compileCalendars([LONG_COUNT, REIGN_NAMES], true).key).toBe(a);
		expect(A.compileCalendars([REIGN_NAMES, LONG_COUNT], true).key).toBe(a);
		const moved: CalendarDef = { ...LONG_COUNT, kind: { type: 'cycles', length: 60, start: 2 } };
		expect(A.compileCalendars([moved, REIGN_NAMES], true).key).not.toBe(a);
		const renamedFormat: CalendarDef = { ...LONG_COUNT, formats: ['Y{year} C{cycle}'] };
		expect(A.compileCalendars([renamedFormat, REIGN_NAMES], true).key).not.toBe(a);
	});

	it('§14 r9: before ready the reader reads plain years only; after ready it reads the calendar', () => {
		const pending = A.compileCalendars([LONG_COUNT, REIGN_NAMES], false);
		const ready = A.compileCalendars([LONG_COUNT, REIGN_NAMES], true);
		expect(pending.ready).toBe(false);
		expect(ready.ready).toBe(true);
		for (const text of ['Year 5 of Cycle 3', 'Qinglong Emperor 3']) {
			expect(pending.read(text)?.year).toBeUndefined();
			expect(pending.read(text)?.warnings).toEqual([]);
		}
		expect(pending.read('1203')?.year).toBe(1203);
		expect(ready.read('Year 5 of Cycle 3')?.year).toBe(125);
		expect(ready.read('Qinglong Emperor 12')?.warnings).toEqual(['calendar-year-past-end']);
		expect(pending.read('Qinglong Emperor 12')?.warnings).toEqual([]);
	});

	it('§14 r9: the memo is capped (5 000 texts) and a full memo gives the same answers', () => {
		const reader = A.compileCalendars([LONG_COUNT], true);
		// Year n of Cycle 1 is year n.
		for (let n = 1; n <= 6500; n++) expect(reader.read(`Year ${n} of Cycle 1`)?.year).toBe(n);
		expect(reader.read('Year 1 of Cycle 1')?.year).toBe(1);
		expect(reader.read('Year 6500 of Cycle 1')?.year).toBe(6500);
	});
});

describe.skipIf(!api || !existsSync('src/core/dates.ts'))('§14 r8: no lookbehind in dates.ts (iOS before 16.4)', () => {
	it('dates.ts has no lookbehind', () => {
		const src = readFileSync('src/core/dates.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		expect(src).not.toMatch(/\(\?<[=!]/);
	});
});
