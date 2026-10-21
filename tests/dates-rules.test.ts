/*
 * Step 4.0 of WP-4: the rules of the Calendars window that live in `src/core/dates.ts` (spec §14 rules 1, 3 and 6):
 * the format check, the refusals inside one note, the warning across notes, the entry form "same year as", the example
 * shown back, and the text of an internal year.
 *
 * Enable at 4.1a: skipped until `src/core/dates.ts` exists, then it runs by itself.
 */

import { describe, expect, it } from 'vitest';
import { ALDRIC, copyOf, JAPAN, LONG_COUNT, loadDatesApi, names, REIGN_NAMES, type CalendarDef, type DatesApi } from './dates-support';

const api = await loadDatesApi();

if (!api) it.todo('enable at 4.1a: formats, refusals, same-year-as, example text (needs src/core/dates.ts)');

const cycles = (id: string, name: string, formats: string[], length = 60, start = 1, note = 'Calendars.md'): CalendarDef => ({ id, name, note, formats, kind: { type: 'cycles', length, start } });
const eras = (id: string, name: string, list: { name: string; start: number; length?: number }[], formats = ['{era} {year}'], note = 'Calendars.md'): CalendarDef => ({ id, name, note, formats, kind: { type: 'eras', eras: list } });

describe.skipIf(!api)('§14 r3: the format check', () => {
	const A = api as DatesApi;

	it('§14 r3: a cycle format with {year} and {cycle} once each is valid', () => {
		expect(A.checkFormat('cycles', '{year} Year of the {cycle} Cycle')).toBeNull();
		expect(A.checkFormat('cycles', 'Year {year} of Cycle {cycle}')).toBeNull();
		expect(A.checkFormat('cycles', '{cycle} {year}')).toBeNull();
	});

	it('§14 r3: an era format with {year} and {era} once each is valid', () => {
		expect(A.checkFormat('eras', '{era} {year}')).toBeNull();
		expect(A.checkFormat('eras', '{year} Year of the {era}')).toBeNull();
	});

	const refused: [kind: 'cycles' | 'eras', format: string, why: string][] = [
		['cycles', '{year}', 'a missing {cycle}'],
		['cycles', '{cycle}', 'a missing {year}'],
		['cycles', 'Year 5 of Cycle 3', 'no place at all'],
		['cycles', '', 'an empty format'],
		['cycles', '{year} {year} {cycle}', '{year} twice'],
		['cycles', '{year} {cycle} {cycle}', '{cycle} twice'],
		['cycles', '{year} {cycle} {era}', 'a place name of the other kind'],
		['cycles', '{year} {cycle} {month}', 'an unknown place name'],
		['cycles', '{era} {year}', 'an era format in a cycle calendar'],
		['eras', '{year}', 'a missing {era}'],
		['eras', '{era}', 'a missing {year}'],
		['eras', '{era} {era} {year}', '{era} twice'],
		['eras', '{era} {year} {year}', '{year} twice'],
		['eras', '{year} {cycle}', 'a cycle format in an era calendar'],
		['eras', '{era} {year} {day}', 'an unknown place name'],
	];
	for (const [kind, format, why] of refused) {
		it(`§14 r3: ${kind} format ${JSON.stringify(format)} is refused (${why}) with a message key`, () => {
			const key = A.checkFormat(kind, format);
			expect(typeof key).toBe('string');
			expect((key as string).length).toBeGreaterThan(0);
		});
	}
});

describe.skipIf(!api)('§14 r3: refusals inside the note that the window saves', () => {
	const A = api as DatesApi;
	const involved = (calendars: CalendarDef[]) => A.checkCalendars(calendars).flatMap((r) => [r.calendar, r.other]);

	it('§14 r3: a valid set of calendars gives no refusal (eras of two calendars may share a format)', () => {
		expect(A.checkCalendars([LONG_COUNT, REIGN_NAMES, JAPAN])).toEqual([]);
		expect(A.checkCalendars([])).toEqual([]);
	});

	it('§14 r3: the same cycle format in two cycle calendars is refused, after folding case and white space, and the other calendar is named', () => {
		const one = cycles('n#0#0', 'One', ['Year {year} of Cycle {cycle}']);
		const two = cycles('n#0#1', 'Two', ['  YEAR   {year} of cycle {cycle}']);
		const res = A.checkCalendars([one, two]);
		expect(res.length).toBeGreaterThan(0);
		const who = involved([one, two]);
		expect(who.some((x) => names(x, one))).toBe(true);
		expect(who.some((x) => names(x, two))).toBe(true);
		expect(res.every((r) => typeof r.key === 'string' && r.key.length > 0)).toBe(true);
	});

	it('§14 r3: different cycle formats in two cycle calendars are fine', () => {
		expect(A.checkCalendars([cycles('n#0#0', 'One', ['Year {year} of Cycle {cycle}']), cycles('n#0#1', 'Two', ['Year {year} of Age {cycle}'])])).toEqual([]);
	});

	it('§14 r3: the same era name in two eras of one calendar is refused, after folding', () => {
		const dup = eras('n#0#0', 'Dup', [{ name: 'Aldric', start: 1 }, { name: ' ALDRIC ', start: 100 }]);
		expect(A.checkCalendars([dup]).length).toBeGreaterThan(0);
	});

	it('§14 r3: the same era name in two eras of two calendars of the same note is refused, and the other calendar is named', () => {
		const copy = copyOf(REIGN_NAMES, 'Calendars.md', { id: 'Calendars.md#0#9' });
		const who = involved([REIGN_NAMES, copy]);
		expect(who.length).toBeGreaterThan(0);
		expect(who.some((x) => names(x, REIGN_NAMES))).toBe(true);
		expect(who.some((x) => names(x, copy))).toBe(true);
	});

	it('§14 r3: a length below 1 is refused, in a cycle calendar and in an era', () => {
		expect(A.checkCalendars([cycles('n#0#0', 'Zero', ['Y{year} C{cycle}'], 0)]).length).toBeGreaterThan(0);
		expect(A.checkCalendars([cycles('n#0#0', 'Negative', ['Y{year} C{cycle}'], -3)]).length).toBeGreaterThan(0);
		expect(A.checkCalendars([eras('n#0#0', 'Short', [{ name: 'A', start: 1, length: 0 }])]).length).toBeGreaterThan(0);
		expect(A.checkCalendars([eras('n#0#0', 'Short', [{ name: 'A', start: 1, length: -1 }])]).length).toBeGreaterThan(0);
	});

	it('§14 r3: a length of 1 and an era with no length are fine', () => {
		expect(A.checkCalendars([cycles('n#0#0', 'One', ['Y{year} C{cycle}'], 1)])).toEqual([]);
		expect(A.checkCalendars([eras('n#0#0', 'Open', [{ name: 'A', start: 1 }, { name: 'B', start: 50, length: 1 }])])).toEqual([]);
	});

	it('§14 r1: eras may have gaps and may overlap (Shōwa 64 and Heisei 1 share a year) without a refusal', () => {
		expect(A.checkCalendars([JAPAN])).toEqual([]);
		expect(A.checkCalendars([eras('n#0#0', 'Gaps', [{ name: 'A', start: 100, length: 10 }, { name: 'B', start: 200 }])])).toEqual([]);
	});
});

describe.skipIf(!api)('§14 r3: the same format or era name across calendar notes is a warning, not a refusal (D254 item 2)', () => {
	const A = api as DatesApi;
	const text = (p: unknown) => JSON.stringify(p);

	it('§14 r3: the same cycle format in another note gives calendar-duplicate and names both notes', () => {
		const copy = copyOf(LONG_COUNT, 'Calendars 1.md');
		const res = A.findCrossNoteDuplicates([LONG_COUNT, copy]);
		expect(res.length).toBeGreaterThan(0);
		expect(res.every((p) => p.key === 'calendar-duplicate')).toBe(true);
		expect(text(res)).toContain('Calendars.md');
		expect(text(res)).toContain('Calendars 1.md');
	});

	it('§14 r3: the same cycle format after folding in another note is a duplicate too', () => {
		const other = cycles('b#0#0', 'Other', ['year  {year} OF cycle {cycle}'], 60, 1, 'Other.md');
		expect(A.findCrossNoteDuplicates([LONG_COUNT, other]).length).toBeGreaterThan(0);
	});

	it('§14 r3: the same era name in another note gives calendar-duplicate', () => {
		const other = eras('b#0#0', 'Elsewhere', [{ name: 'QINGLONG emperor', start: 900 }], ['{era} {year}'], 'Other.md');
		const res = A.findCrossNoteDuplicates([REIGN_NAMES, other]);
		expect(res.length).toBeGreaterThan(0);
		expect(res.every((p) => p.key === 'calendar-duplicate')).toBe(true);
	});

	it('§14 r3: calendars of different notes with different formats and era names give no warning', () => {
		expect(A.findCrossNoteDuplicates([LONG_COUNT, REIGN_NAMES, JAPAN, ALDRIC])).toEqual([]);
		expect(A.findCrossNoteDuplicates([])).toEqual([]);
	});
});

describe.skipIf(!api)('§14 r1: "same year as" gives the start S', () => {
	const A = api as DatesApi;

	it('§14 r1: era: Jianwen Emperor Year 1 is the same year as internal 141, so S = 141', () => {
		expect(A.startFromSameYear({ year: 1 }, 141)).toBe(141);
	});

	it('§14 r1: era: S = other - (Y - 1)', () => {
		expect(A.startFromSameYear({ year: 21 }, 161)).toBe(141);
		expect(A.startFromSameYear({ year: 0 }, 129)).toBe(130);
	});

	it('§14 r1: cycles: S = other - (C - 1) * L - (Y - 1); Year 21 of Cycle 3 is 141 when S = 1', () => {
		expect(A.startFromSameYear({ cycle: 3, year: 21 }, 141, 60)).toBe(1);
		expect(A.startFromSameYear({ cycle: 1, year: 1 }, 500, 60)).toBe(500);
		expect(A.startFromSameYear({ cycle: 0, year: 1 }, 500, 60)).toBe(560);
		expect(A.startFromSameYear({ cycle: 2, year: 0 }, 500, 60)).toBe(441);
	});

	it('§14 r1: the S that the entry form computes reads back as the example (no calendar depends on another one later)', () => {
		for (const [cycle, year, other] of [[3, 21, 141], [1, 1, 1], [5, 60, 2000], [0, 7, -3]] as const) {
			const s = A.startFromSameYear({ cycle, year }, other, 60);
			const cal = cycles('x#0#0', 'New', ['Year {year} of Cycle {cycle}'], 60, s);
			expect(A.compileCalendars([cal], true).read(`Year ${year} of Cycle ${cycle}`)?.year).toBe(other);
		}
		const s = A.startFromSameYear({ year: 4 }, 1000);
		const cal = eras('x#0#0', 'New', [{ name: 'Nova', start: s }]);
		expect(A.compileCalendars([cal], true).read('Nova 4')?.year).toBe(1000);
	});
});

describe.skipIf(!api)('§14 r1: the example shown back (the internal year in the first format, digits)', () => {
	const A = api as DatesApi;

	it('§14 r1: The Long Count: internal 141 is "21 Year of the 3 Cycle" (first format, digits)', () => {
		expect(A.exampleText(LONG_COUNT, 141)).toBe('21 Year of the 3 Cycle');
		expect(A.exampleText(LONG_COUNT, 1)).toBe('1 Year of the 1 Cycle');
		expect(A.exampleText(LONG_COUNT, 120)).toBe('60 Year of the 2 Cycle');
		expect(A.exampleText(LONG_COUNT, 0)).toBe('60 Year of the 0 Cycle');
		expect(A.exampleText(LONG_COUNT, -59)).toBe('1 Year of the 0 Cycle');
	});

	it('§14 r1: Reign names: the era that holds the year, in the first format', () => {
		expect(A.exampleText(REIGN_NAMES, 135)).toBe('6 Year of the Qinglong Emperor');
		expect(A.exampleText(REIGN_NAMES, 141)).toBe('1 Year of the Jianwen Emperor');
		expect(A.exampleText(REIGN_NAMES, 1000)).toBe('860 Year of the Jianwen Emperor');
	});

	it('§14 r1: a year that no era holds (before the first era, or in a gap) gives null', () => {
		expect(A.exampleText(REIGN_NAMES, 100)).toBeNull();
		const gaps = eras('x#0#0', 'Gaps', [{ name: 'A', start: 100, length: 10 }, { name: 'B', start: 200 }]);
		expect(A.exampleText(gaps, 150)).toBeNull();
		expect(A.exampleText(gaps, 105)).toBe('A 6');
	});

	it('§14 r1: the example text reads back to the same internal year, in every calendar', () => {
		const cals = [LONG_COUNT, REIGN_NAMES, ALDRIC];
		// Not below -59: that would be a negative cycle number, which no format reads (the spec does not say what the example is then).
		const years = [-59, -1, 0, 1, 59, 60, 61, 120, 129, 130, 135, 140, 141, 142, 1000, 1100, 1149, 2020];
		for (const cal of cals) {
			const reader = A.compileCalendars([cal], true);
			for (const y of years) {
				const text = A.exampleText(cal, y);
				if (text === null) continue;
				expect(reader.read(text)?.year, `${cal.name} ${y}: ${text}`).toBe(y);
			}
		}
		for (const y of years) expect(A.exampleText(LONG_COUNT, y)).not.toBeNull();
	});
});

describe.skipIf(!api)('§14 r6: the text of an internal year', () => {
	const A = api as DatesApi;
	it('§14 r6: "year N", and "year −N" with the minus sign U+2212 for a year before 1 (D254 item 3)', () => {
		expect(A.formatInternalYear(130)).toBe('year 130');
		expect(A.formatInternalYear(1)).toBe('year 1');
		expect(A.formatInternalYear(0)).toBe('year 0');
		expect(A.formatInternalYear(-1)).toBe('year −1');
		expect(A.formatInternalYear(-59)).toBe('year −59');
		expect(A.formatInternalYear(-1)).not.toContain('-');
	});
});
