// G2 review of r033/names-core (WP-6 step 1): the reviewer proofs, merged into the branch for the fix round. Each test failed on 38fdb2a6 and showed one defect; F2 is changed to the ruling.
import { describe, expect, it } from 'vitest';
import { editCalendarBlock, parseCalendarBlock } from '../src/core/calendar-block';
import { checkCalendars, compileCalendars, nameLinesText, parseNameLines, type Calendar, type NameList } from '../src/core/dates';
import { cycles, list } from './dates-support/names';

const body = (r: ReturnType<typeof editCalendarBlock>): string => ('body' in r ? (r as { body: string }).body : JSON.stringify(r));

describe('K1 (known): a leading marker takes the whole literal up to the next place', () => {
	it('{planet} Year {year} of Cycle {cycle}: the plain-looking "13 of Cycle 22" must not read as this calendar', () => {
		const r = compileCalendars([cycles('C', ['{planet} Year {year} of Cycle {cycle}'], [list()])], true);
		expect(r.read('Sa Year 13 of Cycle 22')?.source).toBe('calendar');
		expect(r.read('13 of Cycle 22')?.source).not.toBe('calendar');
	});
});

describe('K2 (known): N2 takes the written name only from the first calendar that has the list', () => {
	it('a name written through the second calendar format is still a written name', () => {
		const a = cycles('A', ['{cycle}.{year}'], [list()], 60, 1, 'A.md');
		const b = cycles('B', ['{cycle}.{year} {p}'], [list({ marker: 'p' })], 60, 1, 'B.md');
		const d = compileCalendars([a, b], true).read('22.13 Sa')!;
		expect(d.year).toBe(1273);
		expect(d.names).toHaveLength(1);
		expect(d.names![0].written).toEqual({ index: 0, form: 'short' });
	});
});

describe('F1: a list with an unreadable marker drops every format that names a marker, with no problem shown', () => {
	const block = (marker: string) => `calendars:
  - name: C
    kind: cycles
    length: 60
    formats: ["{cycle}.{year} {planet}"]
    lists:
      - name: Planets
${marker}
        names: [Saturn, Jupiter]
        known: {year: 1273, index: 0}
`;
	it('marker: {planet} written without quotes (a YAML map) shows an issue or leaves the base form readable', () => {
		const p = parseCalendarBlock(block('        marker: {planet}'), 'n.md', 0);
		const read = compileCalendars(p.calendars, true).read('22.13');
		expect(p.issues.length > 0 || read?.source === 'calendar').toBe(true);
	});
	it('a list with no marker at all, beside a format with a marker place, shows an issue or leaves the base form readable', () => {
		const p = parseCalendarBlock(block(''), 'n.md', 0);
		const read = compileCalendars(p.calendars, true).read('22.13');
		expect(p.issues.length > 0 || read?.source === 'calendar').toBe(true);
	});
});

// Ruling F2 of the supervisor: a comma in a short form is refused, so the text field stays the inverse of its reader for every name that can be saved.
// The reviewer expected "S,a" to survive the field; that contradicts the ruling, so it is now refused (tests/dates-names-fix.test.ts has the rest).
describe('F2: a short form with a comma is refused, so nameLinesText stays the inverse of parseNameLines', () => {
	it('{name: Saturn, short: "S,a"} is refused by the window; every name that can be saved survives the text field', () => {
		const bad = [{ name: 'Saturn', short: 'S,a' }];
		expect(checkCalendars([cycles('C', ['{cycle}.{year}'], [list({ names: bad })])]).map((r) => r.key)).toEqual(['name-short-comma']);
		const names = [{ name: 'Saturn', short: 'Sa' }, { name: 'Mary, Queen of Scots' }, { name: 'Mary, Queen', short: 'MQ' }];
		const back = parseNameLines(nameLinesText(names));
		expect(back.refusal).toBeUndefined();
		expect(back.names).toEqual(names);
	});
});

describe('F3: edit-list with the names that are already written is not a no-op for the shorthand "- Saturn"', () => {
	const note = `calendars:
  - name: C
    kind: cycles
    length: 60
    formats: ["{cycle}.{year} {planet}"]
    lists:
      - name: Planets
        marker: planet
        names:
          - Saturn   # the first
          - Jupiter
        known: {year: 1273, index: 0}
`;
	it('writes nothing and does not refuse (contract: a value equal to the written one writes nothing)', () => {
		const r = editCalendarBlock(note, { kind: 'edit-list', calendar: 0, list: 0, fields: { names: [{ name: 'Saturn' }, { name: 'Jupiter' }] } });
		expect('body' in r, JSON.stringify(r)).toBe(true);
		expect(body(r)).toBe(note);
	});
});

describe('F4: a bracket in the middle of a format stays in the base form', () => {
	it('{cycle} ({planet}) {year}: the plain "22 13" reads, and the example is not "22) 13"', () => {
		const c: Calendar = cycles('C', ['{cycle} ({planet}) {year}'], [list()]);
		expect(compileCalendars([c], true).read('22 13')?.source).toBe('calendar');
	});
});

describe('F5: two lists of one calendar with the same name', () => {
	it('is refused, or both lists give a name', () => {
		const animals: NameList = list({ name: 'planets', marker: 'q', names: [{ name: 'Rat', short: 'Ra' }, { name: 'Ox' }] });
		const c = cycles('C', ['{cycle}.{year} {planet} {q}'], [list(), animals]);
		const names = compileCalendars([c], true).read('22.13 Sa Ra')?.names ?? [];
		expect(checkCalendars([c]).length > 0 || names.length === 2).toBe(true);
	});
});
