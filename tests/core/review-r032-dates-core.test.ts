// G2 review of WP-4 4.1a (scratch/r032-dates-review): failing tests that prove defects in src/core/dates.ts and readPlain.
// Each test states the rule it holds (spec §14, the architecture notes §5.7) and fails on release-0.3.2 d09c654e.
import { describe, expect, it } from 'vitest';
import { checkCalendars, checkFormat, compileCalendars, exampleText, type Calendar } from '../../src/core/dates';
import { readPlain } from '../../src/core/succession-keys';

const cyc = (formats: string[], length = 60, start = 1, name = 'C', note = 'C.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'cycles', length, start } });
const era = (formats: string[], eras: { name: string; start: number; length?: number }[], name = 'E', note = 'E.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'eras', eras } });

describe('R1: a format that checkFormat accepts must read back what exampleText shows (spec §14 rule 1: "shows the example back")', () => {
	it('{cycle}{year} (two places, no text between): Cycle 2 Year 25 is shown as "225" and read as Cycle 22 Year 5', () => {
		const cal = cyc(['{cycle}{year}']);
		// ruling WP-4.1a G2: the window refuses two number places that touch, and the example is null.
		expect(checkFormat('cycles', '{cycle}{year}')).toBe('calendar-format-touching');
		const internal = 1 + 1 * 60 + 24; // Cycle 2, Year 25
		expect(exampleText(cal, internal)).toBeNull();
	});
	it('{era}{year} with the eras A and A1: Year 12 of A is shown as "A12" and read as Year 2 of A1', () => {
		const cal = era(['{era}{year}'], [{ name: 'A', start: 100 }, { name: 'A1', start: 500 }]);
		expect(checkFormat('eras', '{era}{year}')).toBeNull(); // ruling WP-4.1a G2: the format stays allowed
		// ruling WP-4.1a G2: "A12" does not read back as year 111, so the example is null instead of a wrong text.
		expect(exampleText(cal, 111)).toBeNull(); // Year 12 of A
	});
});

describe('R2: nothing throws on bad input (spec §8; compileOne already guards the same shapes)', () => {
	it('checkCalendars does not throw for an era with no name', () => {
		const bad = era(['{era} {year}'], [{ name: undefined as unknown as string, start: 1 }]);
		expect(() => checkCalendars([bad])).not.toThrow();
	});
	it('checkCalendars does not throw for a format that is not text (two cycle calendars)', () => {
		expect(() => checkCalendars([cyc([123 as unknown as string]), cyc([123 as unknown as string], 60, 1, 'D', 'D.md')])).not.toThrow();
	});
	it('checkCalendars does not throw when formats is null', () => {
		expect(() => checkCalendars([{ ...cyc([]), formats: null as unknown as string[] }])).not.toThrow();
	});
	it('exampleText does not throw for an era calendar with no eras list', () => {
		const bad = { ...era(['{era} {year}'], []), kind: { type: 'eras' } as unknown as Calendar['kind'] };
		expect(() => exampleText(bad, 5)).not.toThrow();
	});
	it('compileCalendars does not throw when problems is null', () => {
		expect(() => compileCalendars([], true, null as unknown as [])).not.toThrow();
	});
});

describe('R3: exampleText returns null (the architecture notes §5.7 ruling 2), never a text with NaN or Infinity', () => {
	const none = (text: string | null) => (text === null ? null : /NaN|Infinity|\./.test(text) ? 'garbage: ' + text : text);
	it('a cycle length of 0 (the window shows the example while the user types)', () => {
		expect(none(exampleText(cyc(['{year} {cycle}'], 0, 1), 5))).toBeNull();
	});
	it('an internal year that is NaN (an empty "same year as" field)', () => {
		expect(none(exampleText(cyc(['{year} {cycle}']), NaN))).toBeNull();
	});
	it('an internal year that is not whole (1.5)', () => {
		expect(none(exampleText(cyc(['{year} {cycle}']), 1.5))).toBeNull();
	});
});

describe('R4: the plain reader marks "approximate" only for the prefixes of spec §14 rule 4', () => {
	it('"C.E. 200" (an era mark) is not "c." (circa)', () => {
		expect(readPlain('C.E. 200').year).toBe(200);
		expect(readPlain('C.E. 200').approx).toBeUndefined();
	});
	it('"c.e. 200" in lower case', () => {
		expect(readPlain('c.e. 200').approx).toBeUndefined();
	});
});

describe('R5: the reader key is order independent, so what the reader returns must be order independent too (the architecture notes §5.7: the view redraws only when the key changes)', () => {
	it('two calendars with the same era name and year: the warnings do not depend on their order', () => {
		const A = era(['{era} {year}'], [{ name: 'Ming', start: 100, length: 3 }], 'A', 'a.md');
		const B = era(['{era} {year}'], [{ name: 'Ming', start: 100 }], 'B', 'b.md');
		const ab = compileCalendars([A, B], true);
		const ba = compileCalendars([B, A], true);
		expect(ab.key).toBe(ba.key); // true today: the view would not redraw on a reorder
		expect(ab.read('Ming 5')?.warnings).toEqual(ba.read('Ming 5')?.warnings);
	});
});
