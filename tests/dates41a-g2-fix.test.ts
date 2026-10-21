// Fix round of WP-4.1a G2 (supervisor rulings in the decision notes "WP-4.1a G2"): touching number places, the example that reads back,
// helpers that never throw, the `c.` prefix, the union of warnings in a tie, and whole starts. Spec §14 rules 1 to 5, the architecture notes §5.7 rulings.
import { describe, expect, it } from 'vitest';
import {
	checkCalendars,
	checkFormat,
	compileCalendars,
	exampleText,
	findCrossNoteDuplicates,
	startFromSameYear,
	type Calendar,
} from '../src/core/dates';
import { readPlain } from '../src/core/succession-keys';

const cycles = (name: string, formats: string[], length = 60, start = 1, note = 'C.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'cycles', length, start } });
const eras = (name: string, list: { name: string; start: number; length?: number }[], formats = ['{era} {year}'], note = 'E.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'eras', eras: list } });
const bad = (c: unknown) => c as Calendar;

describe('touching number places (ruling 1)', () => {
	it('checkFormat refuses {cycle}{year} and {year}{cycle} with their own key', () => {
		expect(checkFormat('cycles', '{cycle}{year}')).toBe('calendar-format-touching');
		expect(checkFormat('cycles', '{year}{cycle}')).toBe('calendar-format-touching');
		expect(checkFormat('cycles', ' {Year}{CYCLE} ')).toBe('calendar-format-touching');
	});
	it('text between the places, and {era}{year} or {year}{era}, stay allowed', () => {
		expect(checkFormat('cycles', '{cycle}-{year}')).toBeNull();
		expect(checkFormat('cycles', '{cycle} {year}')).toBeNull();
		expect(checkFormat('eras', '{era}{year}')).toBeNull();
		expect(checkFormat('eras', '{year}{era}')).toBeNull();
	});
	it('a wrong format is still refused with the old keys, not the new one', () => {
		expect(checkFormat('cycles', '{year}{era}')).toBe('calendar-format-cycle');
		expect(checkFormat('eras', '{year}')).toBe('calendar-format-era');
	});
	it('checkCalendars lists the refusal and the reader does not use a refused format', () => {
		const c = cycles('C', ['{cycle}{year}', 'c{cycle}-{year}']);
		expect(checkCalendars([c])).toEqual([{ calendar: 'C', key: 'calendar-format-touching' }]);
		const r = compileCalendars([c], true);
		expect(r.read('225')?.source).toBe('plain');
		expect(r.read('c2-25')?.year).toBe(1 + 60 + 24);
	});
});

describe('exampleText reads its own text back (ruling 2)', () => {
	it('{era}{year} with the eras A and A1: the first format cannot be read back, so the next format is used', () => {
		const cal = eras('E', [{ name: 'A', start: 100 }, { name: 'A1', start: 500 }], ['{era}{year}', '{era} {year}']);
		expect(exampleText(cal, 111)).toBe('A 12');
	});
	it('with one format that cannot be read back the example is null', () => {
		const cal = eras('E', [{ name: 'A', start: 100 }, { name: 'A1', start: 500 }], ['{era}{year}']);
		expect(exampleText(cal, 111)).toBeNull();
	});
	it('a format that reads back is shown as before', () => {
		expect(exampleText(cycles('C', ['{year} of {cycle}']), 62)).toBe('2 of 2');
		expect(exampleText(eras('E', [{ name: 'Ming', start: 100 }], ['{era}{year}']), 105)).toBe('Ming6');
	});
	it('a refused format is skipped, and the next one gives the text', () => {
		expect(exampleText(cycles('C', ['{cycle}{year}', 'c{cycle}-{year}']), 85)).toBe('c2-25');
	});
});

describe('exampleText returns null for input it cannot show (ruling 4)', () => {
	const C = cycles('C', ['{year} {cycle}']);
	it('an internal year that is not finite or not whole', () => {
		for (const y of [NaN, Infinity, -Infinity, 1.5, 2 ** 60]) expect(exampleText(C, y), String(y)).toBeNull();
	});
	it('a cycle length below 1, or that is not whole', () => {
		for (const n of [0, -3, 2.5, NaN]) expect(exampleText(cycles('C', ['{year} {cycle}'], n), 5), String(n)).toBeNull();
	});
	it('a start that is not whole, and an era length below 1', () => {
		expect(exampleText(cycles('C', ['{year} {cycle}'], 60, 1.5), 5)).toBeNull();
		expect(exampleText(eras('E', [{ name: 'A', start: NaN }]), 5)).toBeNull();
		expect(exampleText(eras('E', [{ name: 'A', start: 1, length: 0 }]), 5)).toBeNull();
	});
	it('a year before the first era and a calendar with no format', () => {
		expect(exampleText(eras('E', [{ name: 'A', start: 100 }]), 5)).toBeNull();
		expect(exampleText(cycles('C', []), 5)).toBeNull();
	});
});

describe('the helpers never throw (ruling 3, spec §8)', () => {
	const shapes: unknown[] = [
		null,
		undefined,
		{},
		{ name: 'X', formats: null, kind: { type: 'cycles', length: 60, start: 1 } },
		{ name: 'X', formats: [123, null, undefined], kind: { type: 'cycles', length: 60, start: 1 } },
		{ name: 'X', formats: ['{era} {year}'], kind: { type: 'eras' } },
		{ name: 'X', formats: ['{era} {year}'], kind: { type: 'eras', eras: null } },
		{ name: 'X', formats: ['{era} {year}'], kind: { type: 'eras', eras: [null, {}, { name: 5, start: 1 }, { name: undefined, start: 1 }, { name: 'A', start: NaN }] } },
		{ name: 'X', formats: ['{year} {cycle}'], kind: { type: 'cycles', length: NaN, start: NaN } },
		{ name: 'X', formats: ['{year} {cycle}'], kind: null },
		{ name: 'X', formats: ['{year} {cycle}'], kind: { type: 'weeks' } },
	];
	it('checkCalendars, findCrossNoteDuplicates, exampleText and compileCalendars take every shape', () => {
		for (const a of shapes) {
			for (const b of shapes) {
				expect(() => checkCalendars([bad(a), bad(b)]), 'check').not.toThrow();
				expect(() => findCrossNoteDuplicates([bad(a), bad(b)]), 'cross').not.toThrow();
				expect(() => compileCalendars([bad(a), bad(b)], true).read('year 5'), 'compile').not.toThrow();
			}
			expect(() => exampleText(bad(a), 5), 'example').not.toThrow();
			expect(exampleText(bad(a), 5)).toBeNull();
		}
	});
	it('the lists themselves may be wrong', () => {
		expect(checkCalendars(null as unknown as Calendar[])).toEqual([]);
		expect(findCrossNoteDuplicates(undefined as unknown as Calendar[])).toEqual([]);
		expect(() => compileCalendars(null as unknown as Calendar[], true)).not.toThrow();
		expect(() => compileCalendars([], true, [null, 3] as never)).not.toThrow();
		expect(compileCalendars([], true, null as never).problems).toEqual([]);
	});
	it('startFromSameYear and checkFormat take bad input', () => {
		expect(startFromSameYear(null as never, 5)).toBeNaN();
		expect(checkFormat('cycles', null as unknown as string)).toBe('calendar-format-cycle');
		expect(checkFormat('weeks' as never, 5 as never)).toBe('calendar-format-era');
	});
	it('an era with no name is skipped, not matched as a duplicate', () => {
		const c = eras('E', [{ name: undefined as unknown as string, start: 1 }, { name: undefined as unknown as string, start: 2 }]);
		expect(checkCalendars([c])).toEqual([]);
	});
	it('the real duplicates are still found beside a bad part', () => {
		const a = eras('A', [{ name: 'Ming', start: 1 }, null as never], ['{era} {year}'], 'a.md');
		const b = eras('B', [{ name: 'MING', start: 1 }], ['{era} {year}'], 'b.md');
		expect(findCrossNoteDuplicates([a, b])).toEqual([{ key: 'calendar-duplicate', calendar: 'B', note: 'b.md', other: 'a.md' }]);
		expect(checkCalendars([a, b])).toEqual([{ calendar: 'B', key: 'calendar-era-duplicate', other: 'A' }]);
	});
});

describe('the approximate prefix c. (ruling 5)', () => {
	it('the plain reader: "C.E. 200" and "c.e. 200" are not approximate', () => {
		for (const t of ['C.E. 200', 'c.e. 200', 'ca.e. 200', 'c.AD 200']) expect(readPlain(t).approx, t).toBeUndefined();
	});
	it('the plain reader: a space or a digit after c. or ca. keeps it approximate', () => {
		for (const t of ['c. 200', 'C.200', 'ca. 200', 'Ca.200', 'c.  200', '~200', 'circa 200']) expect(readPlain(t).approx, t).toBe(true);
	});
	it('the calendar side: the same rule', () => {
		const E = eras('E', [{ name: 'E', start: 100 }, { name: 'Ming', start: 300 }], ['{era} {year}']);
		const r = compileCalendars([E], true);
		expect(r.read('C.E 5')?.approx).toBeUndefined();
		expect(r.read('c. E 5')?.approx).toBe(true);
		expect(r.read('c.Ming 5')?.approx).toBeUndefined();
		const C = cycles('C', ['{year}/{cycle}']);
		const rc = compileCalendars([C], true);
		expect(rc.read('c.5/2')?.approx).toBe(true);
		expect(rc.read('ca. 5/2')?.approx).toBe(true);
	});
});

describe('a tie keeps the warnings of every equal-year hit (ruling 6)', () => {
	const A = eras('A', [{ name: 'Ming', start: 100, length: 3 }], ['{era} {year}'], 'a.md');
	const B = eras('B', [{ name: 'Ming', start: 100 }], ['{era} {year}'], 'b.md');
	const Z = eras('Z', [{ name: 'Ming', start: 100, length: 9 }], ['{era} {year}'], 'z.md');
	it('one warning of the second calendar is kept, whatever the order', () => {
		expect(compileCalendars([B, A], true).read('Ming 5')?.warnings).toEqual(['calendar-year-past-end']);
		expect(compileCalendars([A, B], true).read('Ming 5')?.warnings).toEqual(['calendar-year-past-end']);
	});
	it('no duplicate when several calendars give the same warning', () => {
		expect(compileCalendars([A, B, Z, A], true).read('Ming 5')?.warnings).toEqual(['calendar-year-past-end']);
	});
	it('the year-zero warning of the tie is kept once', () => {
		expect(compileCalendars([B, A], true).read('Ming 0')?.warnings).toEqual(['calendar-year-zero']);
	});
	it('a tie of different years still gives fits-two-calendars and no year', () => {
		const D = eras('D', [{ name: 'Ming', start: 200 }], ['{era} {year}'], 'd.md');
		const r = compileCalendars([A, D], true).read('Ming 2');
		expect(r?.year).toBeUndefined();
		expect(r?.warnings).toEqual(['fits-two-calendars']);
	});
});

describe('checkCalendars refuses a start or length that is not whole (ruling 7)', () => {
	it('a cycle start that is not whole, not finite or not safe', () => {
		for (const s of [1.5, NaN, Infinity, 2 ** 60]) expect(checkCalendars([cycles('C', ['{year} {cycle}'], 60, s)]), String(s)).toEqual([{ calendar: 'C', key: 'calendar-number' }]);
	});
	it('an era start that is not whole', () => {
		expect(checkCalendars([eras('E', [{ name: 'A', start: 0.5 }])])).toEqual([{ calendar: 'E', key: 'calendar-number' }]);
	});
	it('a length that is not whole or not safe is still calendar-length', () => {
		expect(checkCalendars([cycles('C', ['{year} {cycle}'], 2 ** 60)])).toEqual([{ calendar: 'C', key: 'calendar-length' }]);
		expect(checkCalendars([eras('E', [{ name: 'A', start: 1, length: 1.5 }])])).toEqual([{ calendar: 'E', key: 'calendar-length' }]);
	});
	it('a start of 0 or a negative start is valid', () => {
		expect(checkCalendars([cycles('C', ['{year} {cycle}'], 60, -300), eras('E', [{ name: 'A', start: 0 }])])).toEqual([]);
	});
});
