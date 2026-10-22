// Spec §14 rule 16 (WP-6 step 1): the text field of names, the known year, and the refusals of the Calendars window.
import { describe, expect, it } from 'vitest';
import { calendarRefusalText } from '../src/core/messages';
import { checkCalendars, compileCalendars, exampleText, MAX_NAMES, nameLinesText, parseNameLines, startFromSameYear, yearName, type Calendar, type NameList } from '../src/core/dates';
import { LIST_REFUSAL_TEXT, REFUSAL_TEXT } from '../src/core/refusal-text';
import { cycles, list } from './dates-support/names';

describe('§14 rule 16: the text field of names', () => {
	it('one name for each line; the short form follows the last comma', () => {
		expect(parseNameLines('Saturn, Sa\nJupiter, Ju\nMars')).toEqual({ names: [{ name: 'Saturn', short: 'Sa' }, { name: 'Jupiter', short: 'Ju' }, { name: 'Mars' }] });
		expect(parseNameLines('  Saturn  ,  Sa  ')).toEqual({ names: [{ name: 'Saturn', short: 'Sa' }] });
		expect(parseNameLines('Mary, Queen of Scots, MQS')).toEqual({ names: [{ name: 'Mary, Queen of Scots', short: 'MQS' }] });
	});

	it('empty lines are ignored, and the line breaks of any system work', () => {
		expect(parseNameLines('\n\nA\r\n\r\nB\rC\n   \n')).toEqual({ names: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
		expect(parseNameLines('')).toEqual({ names: [] });
		expect(parseNameLines(undefined as never)).toEqual({ names: [] });
	});

	it('a line that ends with a comma has no short form and the name keeps its other commas', () => {
		expect(parseNameLines('Mary, Queen of Scots,')).toEqual({ names: [{ name: 'Mary, Queen of Scots' }] });
		expect(parseNameLines('Saturn,')).toEqual({ names: [{ name: 'Saturn' }] });
		expect(parseNameLines('Saturn,   ')).toEqual({ names: [{ name: 'Saturn' }] });
	});

	it('a line with an empty name is refused', () => {
		expect(parseNameLines(', Sa').refusal).toBe(REFUSAL_TEXT.nameLineEmpty);
		expect(parseNameLines('A\n,\nB').refusal).toBe(REFUSAL_TEXT.nameLineEmpty);
		expect(parseNameLines('A\n,\nB').names).toEqual([{ name: 'A' }, { name: 'B' }]);
		expect(parseNameLines('A, Sa').refusal).toBeUndefined();
	});

	it('at most 60 lines: line 61 is refused', () => {
		const lines = (n: number) => Array.from({ length: n }, (_, i) => `Name ${i}`).join('\n');
		expect(parseNameLines(lines(60))).toMatchObject({ names: expect.any(Array) });
		expect(parseNameLines(lines(60)).refusal).toBeUndefined();
		expect(parseNameLines(lines(60)).names).toHaveLength(MAX_NAMES);
		const over = parseNameLines(lines(61));
		expect(over.refusal).toBe(REFUSAL_TEXT.nameLinesTooMany);
		expect(over.names).toHaveLength(MAX_NAMES);
		// Empty lines do not count.
		expect(parseNameLines(`${lines(60)}\n\n\n`).refusal).toBeUndefined();
	});

	it('a name and a short form have 1 to 40 characters', () => {
		expect(parseNameLines(`${'x'.repeat(40)}, ${'y'.repeat(40)}`).refusal).toBeUndefined();
		expect(parseNameLines('x'.repeat(41)).refusal).toBe(REFUSAL_TEXT.nameTooLong);
		expect(parseNameLines(`A, ${'y'.repeat(41)}`).refusal).toBe(REFUSAL_TEXT.nameTooLong);
		// A character outside the basic plane is one character.
		expect(parseNameLines('\u{1F409}'.repeat(40)).refusal).toBeUndefined();
	});

	it('nameLinesText writes the lines back, with the comma at the end for a name with a comma and no short form', () => {
		expect(nameLinesText([{ name: 'Saturn', short: 'Sa' }, { name: 'Mars' }, { name: 'Mary, Queen of Scots' }, { name: 'Mary, Queen', short: 'MQ' }])).toBe('Saturn, Sa\nMars\nMary, Queen of Scots,\nMary, Queen, MQ');
		expect(nameLinesText([])).toBe('');
		expect(nameLinesText(undefined as never)).toBe('');
	});

	it('round trip: the text reads back as the same names', () => {
		const names = [{ name: 'Saturn', short: 'Sa' }, { name: 'Mary, Queen of Scots' }, { name: 'A, B', short: 'AB' }, { name: 'Plain' }];
		expect(parseNameLines(nameLinesText(names)).names).toEqual(names);
	});
});

describe('§14 rule 16: the known year', () => {
	const marked = (start: number): Calendar => cycles('Long', ['{cycle}.{year} {planet}', 'Year {year} of Cycle {cycle}'], [list()], 60, start);

	it('the example is the base form: the markers are dropped, the case of the words stays', () => {
		expect(exampleText(marked(1), 1273)).toBe('22.13');
		const second = cycles('Long', ['Year {year} of Cycle {cycle} {planet}'], [list()]);
		expect(exampleText(second, 1273)).toBe('Year 13 of Cycle 22');
		const brackets = cycles('Long', ['{cycle}.{year} ({planet})'], [list()]);
		expect(exampleText(brackets, 1273)).toBe('22.13');
		expect(exampleText(cycles('Long', ['{cycle} {planet} {year}'], [list()]), 1273)).toBe('22 13');
	});

	it('a calendar with a list that is not usable still shows its example, and null stays null', () => {
		expect(exampleText({ ...marked(1), lists: [list({ names: [] })] }, 1273)).toBe('22.13');
		// A marker place that no list has reads as its base form (spec §14 rule 13), so the example is the base form too.
		expect(exampleText(cycles('Long', ['{cycle}.{year} {planet}'], []), 1273)).toBe('22.13');
		expect(exampleText(cycles('Long', ['{cycle}.{year}'], [list()], 60, 1), Number.NaN)).toBeNull();
	});

	it('the name stays on the date the user wrote when the Start changes', () => {
		// The window keeps the date text "22.13"; Save reads it with the draft and stores the internal year and the index.
		const store = (cal: Calendar, text: string, index: number): NameList => ({ ...list(), known: { year: compileCalendars([cal], true).read(text)!.year!, index } });
		const before = store(marked(1), '22.13', 0);
		const after = store(marked(5000), '22.13', 0);
		expect(before.known.year).toBe(1273);
		expect(after.known.year).toBe(5000 + 21 * 60 + 12);
		// With the new Start the date 22.13 is still Saturn; the old internal year is not.
		expect(yearName(after, after.known.year).entry.name).toBe('Saturn');
		expect(yearName(after, 1273).entry.name).not.toBe('Saturn');
		const moved = { ...marked(5000), lists: [after] };
		expect(compileCalendars([moved], true).read('22.13 Sa')).toMatchObject({ year: after.known.year, warnings: [] });
		expect(startFromSameYear({ cycle: 22, year: 13 }, 1273, 60)).toBe(1);
	});
});

describe('§14 rule 16: the refusals of the window', () => {
	const refusals = (calendars: Calendar[], plain: NameList[] = []) => checkCalendars(calendars, plain).map((r) => r.key);
	const one = (over: Partial<NameList>) => [cycles('C', ['{cycle}.{year}'], [list(over)])];

	it('a calendar with good lists has no refusal', () => {
		expect(checkCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list()])])).toEqual([]);
		expect(checkCalendars([], [list({ marker: undefined })])).toEqual([]);
	});

	it('a list with no names, an empty list name', () => {
		expect(refusals(one({ names: [] }))).toContain('list-no-names');
		expect(refusals(one({ name: '  ' }))).toContain('list-name-empty');
		expect(refusals([], [list({ marker: undefined, names: [] })])).toEqual(['list-no-names', 'known-no-name']);
	});

	it('more than 4 lists, more than 60 names', () => {
		const five = Array.from({ length: 5 }, (_, i) => list({ name: `L${i}`, marker: `m${i}` }));
		expect(refusals([cycles('C', ['{cycle}.{year}'], five)])).toEqual(['lists-too-many']);
		expect(refusals([], five.map((l) => ({ ...l, marker: undefined })))).toEqual(['lists-too-many']);
		const names = Array.from({ length: 61 }, (_, i) => ({ name: `N${i}` }));
		expect(refusals(one({ names }))).toEqual(['names-too-many']);
		expect(refusals(one({ names: names.slice(0, 60) }))).toEqual([]);
	});

	it('the same name or short form twice in one list: folded, a short form equal to its own full name is allowed', () => {
		const dup = (names: NameList['names']) => refusals(one({ names, known: { year: 1, index: 0 } }));
		expect(dup([{ name: 'Ox' }, { name: 'ox' }])).toEqual(['name-twice']);
		expect(dup([{ name: 'Rat', short: 'R' }, { name: 'Ram', short: 'r' }])).toEqual(['name-twice']);
		expect(dup([{ name: 'Rat', short: 'Ox' }, { name: 'Ox' }])).toEqual(['name-twice']);
		expect(dup([{ name: 'Ox', short: 'ox' }, { name: 'Rat' }])).toEqual([]);
		expect(dup([{ name: 'A' }, { name: 'B', short: 'a' }])).toEqual(['name-twice']);
		const r = checkCalendars(one({ names: [{ name: 'Ox' }, { name: 'OX' }], known: { year: 1, index: 0 } }))[0];
		expect(r).toMatchObject({ calendar: 'C', list: 0, listName: 'Planets', detail: 'OX' });
		// The same list name in two calendars is allowed.
		expect(refusals([cycles('A', ['{cycle}.{year}'], [list()]), cycles('B', ['{year} in {cycle}'], [list()])])).toEqual([]);
	});

	it('a name or a short form of 0 or more than 40 characters', () => {
		expect(refusals(one({ names: [{ name: 'x'.repeat(41) }], known: { year: 1, index: 0 } }))).toEqual(['name-length']);
		expect(refusals(one({ names: [{ name: 'A', short: 'x'.repeat(41) }], known: { year: 1, index: 0 } }))).toEqual(['name-length']);
		expect(refusals(one({ names: [{ name: ' ' }], known: { year: 1, index: 0 } }))).toEqual(['name-length']);
	});

	it('a marker that breaks §14 rule 14, the same marker twice in one calendar', () => {
		expect(refusals(one({ marker: '2x' }))).toEqual(['marker-invalid']);
		expect(refusals(one({ marker: 'year' }))).toEqual(['marker-invalid']);
		expect(refusals(one({ marker: undefined }))).toEqual(['marker-invalid']);
		expect(refusals(one({ marker: 'x'.repeat(25) }))).toEqual(['marker-invalid']);
		const twice = [cycles('C', ['{cycle}.{year}'], [list({ name: 'A', marker: 'Planet' }), list({ name: 'B', marker: 'planet' })])];
		expect(checkCalendars(twice)).toEqual([{ calendar: 'C', key: 'marker-twice', list: 1, listName: 'B', detail: 'planet' }]);
		// A marker with braces is read as the marker.
		expect(refusals(one({ marker: '{planet}' }))).toEqual([]);
		// The same marker in two calendars is allowed.
		expect(refusals([cycles('A', ['{cycle}.{year}'], [list()]), cycles('B', ['{year} in {cycle}'], [list()])])).toEqual([]);
		// A list of the plain years has no marker.
		expect(refusals([], [list({ marker: undefined })])).toEqual([]);
		expect(refusals([], [list({ marker: 'year' })])).toEqual([]);
	});

	it('a format with a marker of no list of its calendar, a marker twice, or a marker that touches a place', () => {
		const withFormat = (format: string) => checkCalendars([cycles('C', [format], [list()])]);
		expect(withFormat('{cycle}.{year} {animal}')).toEqual([{ calendar: 'C', key: 'calendar-marker-unknown', detail: '{cycle}.{year} {animal}', marker: 'animal' }]);
		expect(withFormat('{cycle}.{year} {planet} {planet}')).toEqual([{ calendar: 'C', key: 'calendar-marker-twice', detail: '{cycle}.{year} {planet} {planet}' }]);
		expect(withFormat('{cycle}.{year}{planet}')).toEqual([{ calendar: 'C', key: 'calendar-marker-touching', detail: '{cycle}.{year}{planet}' }]);
		expect(withFormat('{planet}{cycle}.{year}')).toHaveLength(1);
		// A format of a calendar with no list and an unknown word is a marker with no list.
		expect(checkCalendars([cycles('C', ['{cycle}.{year} {planet}'])]).map((r) => r.key)).toEqual(['calendar-marker-unknown']);
		expect(checkCalendars([cycles('C', ['{cycle}.{year} {nope!}'])]).map((r) => r.key)).toEqual(['calendar-format-cycle']);
	});

	it('a known year with no year, or with a name that is not in the list', () => {
		expect(refusals(one({ known: { year: Number.NaN, index: 0 } }))).toEqual(['known-no-year']);
		expect(refusals(one({ known: { year: 1.5, index: 0 } }))).toEqual(['known-no-year']);
		expect(refusals(one({ known: undefined as never }))).toEqual(['known-no-year']);
		expect(refusals(one({ known: { year: 1, index: 7 } }))).toEqual(['known-no-name']);
		expect(refusals(one({ known: { year: 1, index: -1 } }))).toEqual(['known-no-name']);
		expect(refusals(one({ known: { year: 1, index: 0.5 } }))).toEqual(['known-no-name']);
	});

	it('a refusal of a list in the plain years says so', () => {
		expect(checkCalendars([], [list({ marker: undefined, names: [] })])[0]).toMatchObject({ calendar: '', plain: true, list: 0, key: 'list-no-names' });
	});

	it('never throws for a bad shape', () => {
		expect(() => checkCalendars([cycles('C', ['{cycle}.{year}'], 5 as never)], 7 as never)).not.toThrow();
		expect(() => checkCalendars([cycles('C', ['{cycle}.{year}'], [null, 4, { name: 3 }] as never)], [null] as never)).not.toThrow();
		expect(() => checkCalendars([{ ...cycles('C', ['x'], [list()]), formats: 5 } as never])).not.toThrow();
	});

	it('every refusal has a sentence of its own, with the names filled in', () => {
		const samples = Object.keys(LIST_REFUSAL_TEXT);
		expect(samples.sort()).toEqual(['calendar-marker-touching', 'calendar-marker-twice', 'calendar-marker-unknown', 'known-no-name', 'known-no-year', 'list-name-empty', 'list-name-length', 'list-name-twice', 'list-no-names', 'lists-too-many', 'marker-invalid', 'marker-twice', 'name-length', 'name-short-comma', 'name-twice', 'names-too-many'].sort());
		for (const key of samples) {
			const text = calendarRefusalText({ calendar: 'Long Count', key, listName: 'Planets', list: 0, detail: '{cycle}.{year} {planet}' });
			expect(text, key).not.toMatch(/undefined|null|NaN|\$\{|\?\?/);
			expect(text, key).not.toBe('The calendar has an error. Correct the calendar.');
			for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(sentence.split(/\s+/).length, `${key}: ${sentence}`).toBeLessThanOrEqual(25);
			// A refusal of the plain years names the plain years, not a calendar.
			if (key !== 'calendar-marker-unknown') expect(calendarRefusalText({ calendar: '', plain: true, key, listName: 'Planets', list: 0, detail: 'x' }), key).not.toContain('“”');
		}
		expect(calendarRefusalText({ calendar: 'Long Count', key: 'list-no-names', listName: 'Planets', list: 0 })).toBe('The name list “Planets” of the calendar “Long Count” has no names. Write at least one name.');
		expect(calendarRefusalText({ calendar: '', plain: true, key: 'lists-too-many' })).toBe('The plain years have more than 4 name lists. Remove a list.');
		expect(calendarRefusalText({ calendar: 'A', key: 'list-no-names', list: 1 })).toMatch(/name list 2/i);
		expect(calendarRefusalText({ calendar: 'A', key: 'toString' })).toBe('The calendar has an error. Correct the calendar.');
	});
});
