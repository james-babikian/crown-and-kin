// Names contract, WP-6 step 1, fix round (supervisor rulings K1 K2 F1 to F5 and notes 8 and 9): the group rule of a marker, the written name from any calendar,
// a missing or brace-typed marker, shorthand names in an edit, a comma in a short form, two lists with one name, and direction marks in a date text.
import { describe, expect, it } from 'vitest';
import { editCalendarBlock, parseCalendarBlock, type CalendarOp } from '../src/core/calendar-block';
import { groupFormat, readableFormat, withoutGroups, type Seg } from '../src/core/date-formats';
import { checkCalendars, compileCalendars, exampleText, nameLinesText, parseNameLines, type Calendar, type NameList } from '../src/core/dates';
import { calendarRefusalText, issueText } from '../src/core/messages';
import { markerMap } from '../src/core/name-lists';
import { fold } from '../src/core/date-text';
import { cycles, list } from './dates-support/names';

const ANIMALS: NameList = { name: 'Animals', marker: 'animal', names: [{ name: 'Rat', short: 'Ra' }, { name: 'Ox', short: 'Ox' }, { name: 'Dog', short: 'Do' }], known: { year: 1273, index: 0 }, show: 'short' };
const read = (cals: Calendar[], text: string) => compileCalendars(cals, true).read(text)!;
const segText = (s: Seg): string => ('lit' in s ? s.lit : 'place' in s ? `{${s.place}}` : '{marker}');

/** The groups of a format as text (a marker is written `{marker}`), and its base form. */
function groups(format: string, lists: NameList[] = [list()]): { groups: string[]; base: string } {
	const c = cycles('C', [format], lists);
	const segs = readableFormat('cycles', format, markerMap(c.lists))!;
	const { items, base } = groupFormat(segs);
	return { groups: items.flatMap((item) => ('group' in item ? [item.group.map(segText).join('')] : [])), base };
}

describe('K1 and F4: the group of a marker', () => {
	it('is the marker, the punctuation next to it, and one run of white space', () => {
		expect(groups('{cycle}.{year} {planet}')).toEqual({ groups: [' {marker}'], base: '{cycle}.{year}' });
		expect(groups('{cycle}.{year} ({planet})')).toEqual({ groups: [' ({marker})'], base: '{cycle}.{year}' });
		expect(groups('{cycle} ({planet}) {year}')).toEqual({ groups: [' ({marker})'], base: '{cycle} {year}' });
		expect(groups('{planet} Year {year} of Cycle {cycle}')).toEqual({ groups: ['{marker} '], base: 'year {year} of cycle {cycle}' });
		expect(groups('{cycle}.{year}, {planet}')).toEqual({ groups: [', {marker}'], base: '{cycle}.{year}' });
	});

	it('takes the white space after the marker when nothing is before it, also for brackets and a chain of markers', () => {
		expect(groups('{planet} {cycle}.{year}')).toEqual({ groups: ['{marker} '], base: '{cycle}.{year}' });
		expect(groups('({planet}) {cycle}.{year}')).toEqual({ groups: ['({marker}) '], base: '{cycle}.{year}' });
		expect(groups('{planet} {animal} {cycle}.{year}', [list(), ANIMALS])).toEqual({ groups: ['{marker} ', '{marker} '], base: '{cycle}.{year}' });
		expect(groups('{planet} ({animal}) {cycle}.{year}', [list(), ANIMALS])).toEqual({ groups: ['{marker} ', '({marker}) '], base: '{cycle}.{year}' });
	});

	it('leaves a word next to the marker in the base form, and gives each marker its own punctuation', () => {
		expect(groups('{cycle}.{year} in {planet}')).toEqual({ groups: [' {marker}'], base: '{cycle}.{year} in' });
		expect(groups('{cycle}.{year} {planet}.{animal}', [list(), ANIMALS])).toEqual({ groups: [' {marker}', '.{marker}'], base: '{cycle}.{year}' });
		expect(groups('{cycle}.{year} {planet} {animal}', [list(), ANIMALS])).toEqual({ groups: [' {marker}', ' {marker}'], base: '{cycle}.{year}' });
	});

	it('withoutGroups and the example follow the rule', () => {
		const m = markerMap([list()]);
		expect(withoutGroups('{cycle} ({planet}) {year}')).toBe('{cycle} {year}');
		expect(withoutGroups('{Planet} Year {year} of Cycle {cycle}')).toBe('Year {year} of Cycle {cycle}');
		expect(withoutGroups('{cycle}.{year}, {planet}')).toBe('{cycle}.{year}');
		expect(withoutGroups('{cycle}.{year}')).toBe('{cycle}.{year}');
		expect(m.size).toBe(1);
		expect(exampleText(cycles('C', ['{cycle} ({planet}) {year}'], [list()]), 1273)).toBe('22 13');
		expect(exampleText(cycles('C', ['{planet} Year {year} of Cycle {cycle}'], [list()]), 1273)).toBe('Year 13 of Cycle 22');
	});

	it('reads the group present, absent, and in a bracket in the middle', () => {
		const c = [cycles('C', ['{cycle} ({planet}) {year}'], [list()])];
		expect(read(c, '22 13').year).toBe(1273);
		expect(read(c, '22 (Sa) 13')).toMatchObject({ year: 1273, names: [{ written: { index: 0, form: 'short' } }] });
		expect(read(c, '22 (Ju) 13').warnings).toEqual(['calendar-name-mismatch']);
		const first = [cycles('C', ['{planet} Year {year} of Cycle {cycle}'], [list()])];
		expect(read(first, 'Sa Year 13 of Cycle 22')).toMatchObject({ source: 'calendar', year: 1273 });
		expect(read(first, 'Year 13 of Cycle 22')).toMatchObject({ source: 'calendar', year: 1273 });
		// The plain-looking tail of the format is not the format: "Year" belongs to the base.
		expect(read(first, '13 of Cycle 22').source).not.toBe('calendar');
		const chain = [cycles('C', ['{planet} {animal} {cycle}.{year}'], [list(), ANIMALS])];
		for (const text of ['Sa Ra 22.13', 'Sa 22.13', 'Ra 22.13', '22.13']) expect(read(chain, text), text).toMatchObject({ source: 'calendar', year: 1273 });
		const twoSides = [cycles('C', ['{cycle}.{year} {planet}.{animal}'], [list(), ANIMALS])];
		for (const text of ['22.13 Sa.Ra', '22.13.Ra', '22.13 Sa', '22.13']) expect(read(twoSides, text), text).toMatchObject({ source: 'calendar', year: 1273 });
		expect(read(twoSides, '22.13.Ra').names?.map((n) => n.written?.index)).toEqual([undefined, 0]);
	});

	it('compares base forms for duplicates with the new rule', () => {
		expect(checkCalendars([cycles('C', ['{cycle} ({planet}) {year}', '{cycle} {year}'], [list()])]).map((r) => r.key)).toEqual(['calendar-format-duplicate']);
		expect(checkCalendars([cycles('C', ['{planet} Year {year} of Cycle {cycle}', '{year} of Cycle {cycle}'], [list()])])).toEqual([]);
	});
});

describe('K2: a written name from any calendar that matched', () => {
	const a = cycles('A', ['{cycle}.{year}'], [list()], 60, 1, 'A.md');
	const b = cycles('B', ['{cycle}.{year} {p}'], [list({ marker: 'p' })], 60, 1, 'B.md');

	it('takes the written name from the second calendar, in either order', () => {
		for (const cals of [[a, b], [b, a]]) {
			const d = read(cals, '22.13 Sa');
			expect(d.names).toHaveLength(1);
			expect(d.names![0].written).toEqual({ index: 0, form: 'short' });
		}
	});

	it('takes the first written name, and a wrong one gives the mismatch', () => {
		const wrong = read([a, b], '22.13 Ju');
		expect(wrong.warnings).toEqual(['calendar-name-mismatch']);
		expect(wrong.names![0].written).toEqual({ index: 1, form: 'short' });
	});

	it('finds a name written through a list with other names by its text; a name the first list lacks is wrong', () => {
		const other = cycles('B', ['{cycle}.{year} {p}'], [list({ marker: 'p', names: [{ name: 'Sun', short: 'Su' }, { name: 'Saturn', short: 'Sa' }, { name: 'Zeta' }], known: { year: 1273, index: 1 } })], 60, 1, 'B.md');
		const same = read([a, other], '22.13 Saturn');
		expect(same.names![0].written).toEqual({ index: 0, form: 'full' });
		expect(same.warnings).toEqual([]);
		const lacking = read([a, other], '22.13 Zeta');
		expect(lacking.warnings).toEqual(['calendar-name-mismatch']);
		expect(() => lacking.names![0].written!.index).not.toThrow();
		expect(lacking.names![0].written!.index).toBeLessThan(7);
	});
});

describe('F1: a marker that is missing or typed with brackets', () => {
	const block = (marker: string, formats = '["{cycle}.{year} {planet}"]') => `calendars:
  - name: C
    kind: cycles
    length: 60
    formats: ${formats}
    lists:
      - name: Planets
${marker}
        names: [{name: Saturn, short: Sa}, Jupiter]
        known: {year: 1273, index: 0}
`;
	const parsed = (marker: string, formats?: string) => parseCalendarBlock(block(marker, formats), 'n.md', 0);

	it('reads marker: {planet} without quotes as the key', () => {
		const p = parsed('        marker: {planet}');
		expect(p.issues).toEqual([]);
		expect(p.calendars[0].lists![0].marker).toBe('planet');
		expect(read(p.calendars, '22.13 Sa')).toMatchObject({ year: 1273, names: [{ written: { index: 0, form: 'short' } }] });
		// A map with two keys, or a value, is no marker.
		expect(parsed('        marker: {planet: 1, animal: 2}').calendars[0].lists![0].marker).toBeUndefined();
		expect(parsed('        marker: {planet: x}').calendars[0].lists![0].marker).toBeUndefined();
	});

	it('takes curly brackets out of a marker text', () => {
		expect(parsed('        marker: "{planet}"').calendars[0].lists![0].marker).toBe('planet');
		expect(parsed('        marker: "{pla}net"').calendars[0].lists![0].marker).toBe('planet');
		expect(parsed('        marker: "{}"').calendars[0].lists![0].marker).toBeUndefined();
	});

	it('a marker place that no list has still reads the base form, with a problem shown and a refusal on save', () => {
		const p = parsed('');
		expect(p.issues.map((i) => [i.code, (i.params as { why: string; marker: string }).why, (i.params as { marker: string }).marker])).toEqual([['calendar-list-invalid', 'marker', 'planet']]);
		const r = read(p.calendars, '22.13 Sa');
		expect(r).toMatchObject({ source: 'calendar', year: 1273 });
		// The list has no marker place to fill, so a written name is not read; the list still names the year after a whole date.
		expect(r.names).toMatchObject([{ list: 'Planets', name: 'Saturn' }]);
		expect(r.names![0].written).toBeUndefined();
		expect(checkCalendars(p.calendars).map((x) => x.key)).toContain('calendar-marker-unknown');
		const text = issueText(p.issues[0]);
		expect(text).toContain('{planet}');
		expect(text).not.toMatch(/undefined|NaN|\?/);
		for (const sentence of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(25);
	});

	it('the problem is shown once for each marker, and not for a marker that a list has', () => {
		expect(parsed('', '["{cycle}.{year} {planet} {planet}", "{year}.{cycle} ({moon})"]').issues).toHaveLength(2);
		expect(parsed('        marker: planet').issues).toEqual([]);
		// A list that cannot be used keeps its marker, so only the list is reported.
		const dead = parseCalendarBlock(block('        marker: planet').replace('names: [{name: Saturn, short: Sa}, Jupiter]', 'names: []'), 'n.md', 0);
		expect(dead.issues.map((i) => (i.params as { why: string }).why)).toEqual(['names']);
	});

	it('a marker place twice that no list has is unreadable, as with a list', () => {
		const p = parsed('', '["{cycle}.{year} {planet} {planet}"]');
		expect(read(p.calendars, '22.13').source).not.toBe('calendar');
	});
});

describe('F3: edit-list with the names already written as a shorthand', () => {
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
          - {name: Mars, short: Ma}
        known: {year: 1273, index: 0}
`;
	const edit = (names: { name: string; short?: string }[]) => editCalendarBlock(note, { kind: 'edit-list', calendar: 0, list: 0, fields: { names } } as CalendarOp);

	it('writes nothing for equal names', () => {
		const r = edit([{ name: 'Saturn' }, { name: 'Jupiter' }, { name: 'Mars', short: 'Ma' }]);
		expect(r.ok && r.body).toBe(note);
	});

	it('refuses a change to names that carry a comment, as before', () => {
		const r = edit([{ name: 'Saturn' }, { name: 'Jupiter' }, { name: 'Mars' }]);
		expect(r.ok).toBe(false);
	});

	it('a shorthand name is not equal to a name with a short form', () => {
		const r = editCalendarBlock(note.replace('   # the first', ''), { kind: 'edit-list', calendar: 0, list: 0, fields: { names: [{ name: 'Saturn', short: 'Sa' }, { name: 'Jupiter' }, { name: 'Mars', short: 'Ma' }] } });
		expect(r.ok && parseCalendarBlock(r.body, 'n.md', 0).calendars[0].lists![0].names[0]).toEqual({ name: 'Saturn', short: 'Sa' });
	});
});

describe('F2: a comma in a short form', () => {
	const bad = [{ name: 'Saturn', short: 'S,a' }, { name: 'Jupiter' }];

	it('is a refusal of the window, with its own sentence', () => {
		const refusals = checkCalendars([cycles('C', ['{cycle}.{year}'], [list({ names: bad })])]);
		expect(refusals).toMatchObject([{ key: 'name-short-comma', listName: 'Planets', detail: 'S,a' }]);
		expect(calendarRefusalText(refusals[0])).toBe('In the name list “Planets”, the short form “S,a” has a comma. A short form cannot have a comma. Correct the list in the note, or write the list again in the Calendars window.');
		expect(checkCalendars([], [list({ marker: undefined, names: bad })]).map((r) => r.key)).toEqual(['name-short-comma']);
	});

	it('is refused by add-list, edit-list and add-calendar', () => {
		const body = 'calendars:\n  - name: C\n    kind: cycles\n    length: 60\n    formats: ["{cycle}.{year}"]\n';
		const text = 'A short form cannot have a comma. Correct the list in the note, or write the list again in the Calendars window.';
		const add = editCalendarBlock(body, { kind: 'add-list', calendar: 0, list: list({ names: bad }) });
		expect(add).toMatchObject({ ok: false, detail: text });
		const ok = editCalendarBlock(body, { kind: 'add-list', calendar: 0, list: list() });
		const body2 = ok.ok ? ok.body : '';
		expect(editCalendarBlock(body2, { kind: 'edit-list', calendar: 0, list: 0, fields: { names: bad } })).toMatchObject({ ok: false, detail: text });
		expect(editCalendarBlock(body, { kind: 'add-calendar', calendar: { name: 'D', kind: 'cycles', formats: ['{cycle}.{year}'], length: 60, lists: [list({ names: bad })] } })).toMatchObject({ ok: false, detail: text });
	});

	it('leaves the text field the inverse of its reader for every name that can be saved', () => {
		const names = [{ name: 'Saturn', short: 'Sa' }, { name: 'Mary, Queen of Scots' }, { name: 'Mary, Queen', short: 'MQ' }, { name: 'A,B', short: 'AB' }, { name: 'Sun' }];
		const back = parseNameLines(nameLinesText(names));
		expect(back.refusal).toBeUndefined();
		expect(back.names).toEqual(names);
	});
});

describe('F5: two lists of one owner with the same name', () => {
	it('is refused in a calendar and in the plain years, with a folded comparison', () => {
		const second = list({ name: ' PLANETS ', marker: 'q' });
		const refusals = checkCalendars([cycles('C', ['{cycle}.{year}'], [list(), second])]);
		expect(refusals).toMatchObject([{ key: 'list-name-twice', list: 1, detail: 'PLANETS' }]);
		expect(calendarRefusalText(refusals[0])).toBe('The calendar “C” has two name lists with the name “PLANETS”. Give each list its own name.');
		const plain = checkCalendars([], [list({ marker: undefined }), list({ marker: undefined, name: 'planets' })]);
		expect(plain).toMatchObject([{ key: 'list-name-twice', plain: true }]);
		expect(calendarRefusalText(plain[0])).toBe('The plain years have two name lists with the name “planets”. Give each list its own name.');
	});

	it('allows the same list name in two calendars', () => {
		expect(checkCalendars([cycles('A', ['{cycle}.{year}'], [list()]), cycles('B', ['{year} of {cycle}'], [list()])])).toEqual([]);
	});

	it('does not count an empty name twice', () => {
		const keys = checkCalendars([cycles('C', ['{cycle}.{year}'], [list({ name: '' }), list({ name: ' ', marker: 'q' })])]).map((r) => r.key);
		expect(keys).not.toContain('list-name-twice');
	});
});

describe('Note 9: direction marks are white space in a date text', () => {
	it('folds U+200E, U+200F and U+061C like a space, also at the ends', () => {
		expect(fold('‎22‏.13؜')).toBe('22 .13');
		expect(fold('a‎‏ ؜b')).toBe('a b');
	});

	it('reads a date with a direction mark where a space is, and a name after a mark', () => {
		const c = [cycles('C', ['{cycle} {year} {planet}'], [list()])];
		for (const mark of ['‎', '‏', '؜']) {
			expect(read(c, `22${mark}13${mark}Sa`), JSON.stringify(mark)).toMatchObject({ year: 1273, whole: true, names: [{ written: { index: 0, form: 'short' } }] });
			expect(read(c, `${mark}22 13`).year).toBe(1273);
		}
	});
});
