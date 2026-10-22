// Spec §14 rules 13 and 14 (WP-6 step 1): marker places in a format (the optional group), written names, whole dates and the
// names of a date that two calendars read.
import { describe, expect, it } from 'vitest';
import { checkCalendars, checkFormat, compileCalendars, findCrossNoteDuplicates, markerValid, nameMismatches, normalizeMarker, plainWhole, type Calendar, type NameList } from '../src/core/dates';
import { cycles, eras, list, PLANETS } from './dates-support/names';

const ANIMALS: NameList = { name: 'Animals', marker: 'animal', names: [{ name: 'Rat', short: 'Ra' }, { name: 'Ox', short: 'Ox' }, { name: 'Dog', short: 'Do' }], known: { year: 1273, index: 0 }, show: 'short' };
const read = (cals: Calendar[], text: string, plain: NameList[] = []) => compileCalendars(cals, true, [], plain).read(text)!;
const one = (formats: string[], lists: NameList[] = [list()]) => [cycles('C', formats, lists)];
/** The written names of a read date: list name, index and form. */
const written = (r: ReturnType<typeof read>) => (r.names ?? []).flatMap((n) => (n.written ? [`${n.list}:${n.written.index}:${n.written.form}`] : []));

describe('§14 rule 14: the marker', () => {
	it('accepts letters of any script, digits and hyphens, starting with a letter', () => {
		for (const m of ['planet', 'Planet-2', 'a', 'Éléphant', '行星', 'x'.repeat(24)]) expect(markerValid(m), m).toBe(true);
	});
	it('refuses a marker that starts with a digit or a hyphen, is too long, empty, or year, cycle, era', () => {
		for (const m of ['2planet', '-planet', 'x'.repeat(25), '', 'year', 'Cycle', 'ERA', 'pla net', 'pla_net', 'plan{et}', ' planet']) expect(markerValid(m), m).toBe(false);
	});
	it('takes the marker typed with or without braces', () => {
		expect(normalizeMarker('{planet}')).toBe('planet');
		expect(normalizeMarker(' planet ')).toBe('planet');
		expect(normalizeMarker('{ planet }')).toBe('planet');
		expect(normalizeMarker(5)).toBe('');
	});
});

describe('§14 rule 14: each shape of a marker group', () => {
	it('marker last: {cycle}.{year} {planet}', () => {
		const c = one(['{cycle}.{year} {planet}']);
		expect(read(c, '22.13 Sa')).toMatchObject({ year: 1273, whole: true });
		expect(written(read(c, '22.13 Sa'))).toEqual(['Planets:0:short']);
		expect(written(read(c, '22.13 Saturn'))).toEqual(['Planets:0:full']);
		expect(written(read(c, '22.13'))).toEqual([]);
		expect(read(c, '22.13').whole).toBe(true);
		expect(read(c, '22.13').year).toBe(read(c, '22.13 Sa').year);
	});

	it('marker first: {planet} {cycle}.{year}', () => {
		const c = one(['{planet} {cycle}.{year}']);
		expect(written(read(c, 'Ju 22.13'))).toEqual(['Planets:1:short']);
		expect(written(read(c, 'jupiter 22.13'))).toEqual(['Planets:1:full']);
		expect(read(c, '22.13')).toMatchObject({ year: 1273, source: 'calendar' });
		expect(read(c, 'Ju 22.13').year).toBe(1273);
	});

	it('marker in brackets: {cycle}.{year} ({planet})', () => {
		const c = one(['{cycle}.{year} ({planet})']);
		expect(written(read(c, '22.13 (Sa)'))).toEqual(['Planets:0:short']);
		expect(read(c, '22.13 (Sa)').whole).toBe(true);
		expect(written(read(c, '22.13'))).toEqual([]);
		// The bracket belongs to the group: the group is absent when the bracket is not closed.
		expect(written(read(c, '22.13 (Sa'))).toEqual([]);
		expect(read(c, '22.13 (Sa').whole).toBeUndefined();
	});

	it('marker between two places: {cycle} {planet} {year}', () => {
		const c = one(['{cycle} {planet} {year}']);
		expect(written(read(c, '22 Sa 13'))).toEqual(['Planets:0:short']);
		expect(read(c, '22 13')).toMatchObject({ source: 'calendar' });
		expect(read(c, '22 13').year).toBe(read(c, '22 Sa 13').year);
	});

	it('two markers: every combination of present and absent', () => {
		const c = one(['{cycle}.{year} {planet} {animal}'], [list(), ANIMALS]);
		const base = read(c, '22.13').year;
		const all = read(c, '22.13 Sa Ra');
		expect(all.year).toBe(base);
		expect(written(all)).toEqual(['Planets:0:short', 'Animals:0:short']);
		expect(written(read(c, '22.13 Sa'))).toEqual(['Planets:0:short']);
		// "Ox" is the full name and the short form of the entry: it counts as the full name.
		expect(written(read(c, '22.13 Ox'))).toEqual(['Animals:1:full']);
		expect(written(read(c, '22.13'))).toEqual([]);
		for (const text of ['22.13 Sa Ra', '22.13 Sa', '22.13 Ox', '22.13']) expect(read(c, text).year, text).toBe(base);
		expect(read(c, '22.13 Sa Ra').whole).toBe(true);
		expect(read(c, '22.13 Ox').whole).toBe(true);
	});

	it('two markers at the start: every group takes the literal after it', () => {
		const c = one(['{planet} {animal} {cycle}.{year}'], [list(), ANIMALS]);
		expect(written(read(c, 'Sa Ra 22.13'))).toEqual(['Planets:0:short', 'Animals:0:short']);
		expect(written(read(c, 'Ra 22.13'))).toEqual(['Animals:0:short']);
		expect(written(read(c, 'Sa 22.13'))).toEqual(['Planets:0:short']);
		expect(read(c, '22.13').year).toBe(read(c, 'Sa Ra 22.13').year);
	});

	it('a name that is a prefix of another name is not cut: the longest first', () => {
		const prefixes = list({ names: [{ name: 'Ma' }, { name: 'Mars', short: 'Mrs' }, { name: 'Mar' }], known: { year: 1, index: 0 } });
		const c = one(['{cycle}.{year} {planet}'], [prefixes]);
		expect(written(read(c, '1.1 Mars'))).toEqual(['Planets:1:full']);
		expect(written(read(c, '1.1 Mar'))).toEqual(['Planets:2:full']);
		expect(written(read(c, '1.1 Ma'))).toEqual(['Planets:0:full']);
		expect(written(read(c, '1.1 Mrs'))).toEqual(['Planets:1:short']);
		// A name must end at a boundary: "Marsh" is none of the names.
		expect(written(read(c, '1.1 Marsh'))).toEqual([]);
	});

	it('names with digits, a dot or a comma', () => {
		const odd = list({ names: [{ name: 'Year 7' }, { name: 'St. John', short: 'St.J' }, { name: 'Mary, Queen of Scots' }], known: { year: 1, index: 0 } });
		const c = one(['{cycle}.{year} {planet}'], [odd]);
		expect(written(read(c, '1.1 Year 7'))).toEqual(['Planets:0:full']);
		expect(written(read(c, '1.1 st. john'))).toEqual(['Planets:1:full']);
		expect(written(read(c, '1.1 St.J'))).toEqual(['Planets:1:short']);
		expect(written(read(c, '1.1 Mary, Queen of Scots'))).toEqual(['Planets:2:full']);
		expect(read(c, '1.1 Mary, Queen of Scots').whole).toBe(true);
	});

	it('a name is compared folded: case, white space and a combining mark', () => {
		const accented = list({ names: [{ name: 'Étoile  du Nord' }, { name: 'Lune' }], known: { year: 1, index: 0 } });
		const c = one(['{cycle}.{year} {planet}'], [accented]);
		expect(written(read(c, '1.1 étoile du nord'))).toEqual(['Planets:0:full']);
		expect(written(read(c, '1.1 LUNE'))).toEqual(['Planets:1:full']);
	});

	it('a word that is no name of the list is ignored: the group is absent, no warning', () => {
		const c = one(['{cycle}.{year} {planet}']);
		const r = read(c, '22.13 Xyzzy');
		expect(r).toMatchObject({ year: read(c, '22.13').year, warnings: [] });
		expect(written(r)).toEqual([]);
		expect(r.whole).toBeUndefined();
		// 0.3.2 ignored "Sa" the same way.
		expect(read(c, '22.13 Sabre').warnings).toEqual([]);
	});

	it('the greatest end wins among formats of one calendar with the same year', () => {
		// A hand-written note can hold both formats (the window refuses it): the one that reads the name wins.
		const c = one(['{cycle}.{year}', '{cycle}.{year} {planet}']);
		expect(written(read(c, '22.13 Sa'))).toEqual(['Planets:0:short']);
		expect(read(c, '22.13 Sa').whole).toBe(true);
		const swapped = one(['{cycle}.{year} {planet}', '{cycle}.{year}']);
		expect(written(read(swapped, '22.13 Sa'))).toEqual(['Planets:0:short']);
	});

	it('different years at the same start stay one place with no year (rule 4)', () => {
		const c = [cycles('A', ['{year}'], [list()], 60, 1), cycles('B', ['{year} {planet}'], [list()], 60, 100)];
		const r = read(c, '5 Sa');
		expect(r.year).toBeUndefined();
		expect(r.names).toBeUndefined();
	});

	it('a marker format of a calendar without the list, or with a list that cannot be used, still reads its base form', () => {
		const dead = list({ names: [] });
		const c = one(['{cycle}.{year} {planet}'], [dead]);
		const r = read(c, '22.13 Sa');
		expect(r).toMatchObject({ source: 'calendar', year: 22 * 60 - 60 + 13 });
		expect(r.names).toBeUndefined();
		expect(compileCalendars(c, true).hasLists).toBe(false);
		// With no list at all the marker place is a group that is never present (spec §14 rule 13), so the base form reads; 0.3.2 read nothing here.
		expect(read(one(['{cycle}.{year} {planet}'], []), '22.13 Sa')).toMatchObject({ source: 'calendar', year: 22 * 60 - 60 + 13 });
		expect(read(one(['{cycle}.{year} {planet}'], []), '22.13 Sa').names).toBeUndefined();
	});

	it('the marker is a place name folded: {Planet} reads like {planet}', () => {
		const c = one(['{cycle}.{year} {PLANET}']);
		expect(written(read(c, '22.13 Sa'))).toEqual(['Planets:0:short']);
	});
});

describe('§14 rule 14: formats that are refused', () => {
	it('checkFormat: a marker of the calendar is fine, any other word is not', () => {
		expect(checkFormat('cycles', '{cycle}.{year} {planet}', ['planet'])).toBeNull();
		expect(checkFormat('cycles', '{cycle}.{year} {planet}', ['Planet'])).toBeNull();
		expect(checkFormat('cycles', '{cycle}.{year} {planet}', ['animal'])).toBe('calendar-marker-unknown');
		expect(checkFormat('cycles', '{cycle}.{year} {planet}', [])).toBe('calendar-marker-unknown');
		// Without markers it is the refusal of 0.3.2.
		expect(checkFormat('cycles', '{cycle}.{year} {planet}')).toBe('calendar-format-cycle');
		expect(checkFormat('eras', '{era} {year} {planet}', ['planet'])).toBeNull();
		// A place of the other kind is no marker.
		expect(checkFormat('cycles', '{year} {era}', ['planet'])).toBe('calendar-format-cycle');
	});
	it('a marker twice, or a marker next to a place', () => {
		expect(checkFormat('cycles', '{cycle}.{year} {planet} {planet}', ['planet'])).toBe('calendar-marker-twice');
		expect(checkFormat('cycles', '{cycle}.{year}{planet}', ['planet'])).toBe('calendar-marker-touching');
		expect(checkFormat('cycles', '{planet}{cycle}.{year}', ['planet'])).toBe('calendar-marker-touching');
		expect(checkFormat('cycles', '{cycle} {planet}{animal} {year}', ['planet', 'animal'])).toBe('calendar-marker-touching');
		expect(checkFormat('eras', '{era} {year}{planet}', ['planet'])).toBe('calendar-marker-touching');
		// Two numbers still touch as before; an era and a year do not.
		expect(checkFormat('cycles', '{cycle}{year}', ['planet'])).toBe('calendar-format-touching');
		expect(checkFormat('eras', '{era}{year}', ['planet'])).toBeNull();
	});
	it('a marker twice in a format does not read', () => {
		expect(read(one(['{cycle}.{year} {planet} {planet}']), '22.13 Sa Sa').year).toBeUndefined();
	});

	it('the same base form in one calendar, in two calendars of one note, and across notes', () => {
		const a = cycles('A', ['{cycle}.{year} {planet}', '{cycle}.{year}'], [list()]);
		expect(checkCalendars([a])).toEqual([{ calendar: 'A', key: 'calendar-format-duplicate' }]);
		const b = cycles('B', ['{planet} {cycle}.{year}'], [list()]);
		const c = cycles('C', ['{cycle}.{year}']);
		expect(checkCalendars([b, c])).toEqual([{ calendar: 'C', key: 'calendar-format-duplicate', other: 'B' }]);
		const d = cycles('D', ['{cycle}.{year} ({planet})'], [list()], 60, 1, 'D.md');
		expect(findCrossNoteDuplicates([c, d])).toEqual([{ key: 'calendar-duplicate', calendar: 'D', note: 'D.md', other: 'C.md' }]);
		// Formats with another base form do not clash.
		expect(checkCalendars([cycles('E', ['{cycle}.{year} {planet}', '{year} Year of the {cycle} Cycle {planet}'], [list()])])).toEqual([]);
	});
});

describe('§14 rule 14: written names and whole dates', () => {
	const c = one(['{cycle}.{year} {planet}']);

	it('a wrong full name and a wrong short name give calendar-name-mismatch and keep the year', () => {
		const right = read(c, '22.13 Sa');
		const wrongFull = read(c, '22.13 Jupiter');
		const wrongShort = read(c, '22.13 Ju');
		expect(right.warnings).toEqual([]);
		for (const r of [wrongFull, wrongShort]) {
			expect(r.year).toBe(right.year);
			expect(r.warnings).toEqual(['calendar-name-mismatch']);
			expect(nameMismatches(r)).toEqual([{ list: 'Planets', expected: 'Saturn', written: 'Jupiter' }]);
		}
		expect(wrongFull.names?.[0].written).toEqual({ index: 1, form: 'full' });
		expect(wrongShort.names?.[0].written).toEqual({ index: 1, form: 'short' });
		expect(nameMismatches(right)).toEqual([]);
	});

	it('the other warnings stay in their order before the mismatch', () => {
		const r = read(c, '22.0 Sa');
		expect(r.warnings).toEqual(['calendar-year-zero', 'calendar-name-mismatch']);
		expect(read(c, '22.61 Ju').warnings).toEqual(['calendar-year-past-end', 'calendar-name-mismatch']);
	});

	it('a date is whole when the match is all of the text, with an approximate prefix at most', () => {
		for (const text of ['22.13', '22.13 Sa', '  22.13 Sa  ', 'c. 22.13 Sa', 'ca. 22.13', 'about 22.13 Sa', 'circa 22.13', '~22.13 Sa', '~ 22.13']) expect(read(c, text).whole, text).toBe(true);
	});

	it('a date is not whole with other text before or after the match', () => {
		for (const text of ['22.13 Sa, at dawn', 'in 22.13 Sa', 'between 22.13 and 22.15', '22.13 Sa or 22.14', '22.13?', 'late 22.13 Sa', '22.13 Xyzzy']) expect(read(c, text).whole, text).toBeUndefined();
		// The year is still read as in 0.3.2.
		expect(read(c, 'in 22.13 Sa').year).toBe(read(c, '22.13').year);
	});

	it('a year-first range is never whole', () => {
		const r = compileCalendars([cycles('Long', ['{year} Year of the {cycle} Cycle {planet}'], [list()])], true);
		expect(r.read('13 Year of the 22 Cycle Sa')?.whole).toBe(true);
		expect(r.read('13-15 Year of the 22 Cycle')?.whole).toBeUndefined();
		expect(r.read('13-15 Year of the 22 Cycle Sa')?.whole).toBeUndefined();
		expect(r.read('13 to 15 Year of the 22 Cycle')?.names).toHaveLength(1);
		expect(r.read('13-15 Year of the 22 Cycle')?.year).toBe(r.read('13 Year of the 22 Cycle')?.year);
	});

	it('an era calendar with a list: the name of an era year', () => {
		const e = [eras('Reigns', [{ name: 'Qinglong', start: 130, length: 11 }], ['{era} {year} {planet}'], [list()])];
		const r = read(e, 'Qinglong 3 Sa');
		// 132 is 1141 years before 1273 = Saturn; 1141 = 7 * 163, so it is Saturn too.
		expect(r).toMatchObject({ year: 132, whole: true, names: [{ name: 'Saturn', written: { index: 0, form: 'short' } }], warnings: [] });
		expect(read(e, 'Qinglong 4 Sa').warnings).toEqual(['calendar-name-mismatch']);
	});
});

describe('§14 rule 14: a plain year with names', () => {
	const plain = [list({ marker: undefined })];

	it('plainWhole: a bare year, an approximate prefix and names at the end', () => {
		const ok = (text: string) => plainWhole(text, plain).whole;
		for (const t of ['1273', '1273 Sa', '1273 Saturn', '-5', '-5 Sa', '1273 AD', 'AD 1273', '1273 CE Sa', '12 BC', '200 BCE Sun', '200BC', 'c. 1273', 'ca. 1273 Sa', 'about 1273', 'circa 1273 Sa', '~1273 Sa', '１２７３ Sa']) {
			expect(ok(t), t).toBe(true);
		}
	});

	it('plainWhole: anything else is not whole', () => {
		const ok = (text: string) => plainWhole(text, plain).whole;
		for (const t of ['1273?', '1700/01', '12 March 1273', '1273 Sun rose', '1273-05-12', 'Sa', 'Sa 1273', '12345', '1273 and 1274', 'in 1273', '1273 Xyz', '1273Sa', '']) expect(ok(t), t).toBe(false);
		expect(plainWhole(undefined as never, plain)).toEqual({ whole: false, written: [] });
		expect(plainWhole('1273 Sa', [])).toEqual({ whole: false, written: [] });
	});

	it('plainWhole: the removed words are the written names, one for each list, the longest first', () => {
		const two = [list({ marker: undefined }), { ...ANIMALS, marker: undefined }];
		expect(plainWhole('1273 Sa Ra', two)).toEqual({ whole: true, written: [{ list: 1, index: 0, form: 'short' }, { list: 0, index: 0, form: 'short' }] });
		expect(plainWhole('1273 Sa Ju', two).whole).toBe(false);
		expect(plainWhole('1273 Sa', two).written).toEqual([{ list: 0, index: 0, form: 'short' }]);
		const long = [list({ marker: undefined, names: [{ name: 'Sun' }, { name: 'Red Sun' }], known: { year: 1, index: 0 } })];
		expect(plainWhole('1273 Red Sun', long).written).toEqual([{ list: 0, index: 1, form: 'full' }]);
	});

	it('the reader gives the names of a whole plain year, with the written one and the warning', () => {
		const r1 = read([], '1273', plain);
		expect(r1).toMatchObject({ year: 1273, source: 'plain', whole: true, names: [{ list: 'Planets', name: 'Saturn', short: 'Sa', show: 'short' }] });
		expect(r1.names?.[0].written).toBeUndefined();
		const r2 = read([], '1273 Sa', plain);
		expect(r2.names?.[0].written).toEqual({ index: 0, form: 'short' });
		expect(r2.warnings).toEqual([]);
		const r3 = read([], 'ca. 1274 Sa', plain);
		expect(r3).toMatchObject({ year: 1274, approx: true, whole: true, warnings: ['calendar-name-mismatch'] });
		expect(nameMismatches(r3)).toEqual([{ list: 'Planets', expected: 'Jupiter', written: 'Saturn' }]);
	});

	it('a plain year that is not whole has no name and no warning', () => {
		for (const t of ['1273?', '1700/01', '12 March 1273', '1273 Sun rose', '1273-05-12', '1273 Ju or 1274']) {
			const r = read([], t, plain);
			expect(r.names, t).toBeUndefined();
			expect(r.whole, t).toBeUndefined();
			expect(r.warnings.includes('calendar-name-mismatch'), t).toBe(false);
		}
		// The year itself is read as before.
		expect(read([], '12 March 1273', plain).year).toBe(1273);
	});

	it('a year 0 plain text keeps its warning and gets its name', () => {
		const r = read([], '0 Sa', plain);
		expect(r.year).toBeUndefined();
		const z = read([], '000', plain);
		expect(z.year).toBe(0);
		expect(z.warnings).toEqual(['year-zero']);
		expect(z.names).toHaveLength(1);
	});

	it('a calendar date does not use the plain-year lists', () => {
		const r = read(one(['{cycle}.{year}'], []), '22.13 Sa', plain);
		expect(r.source).toBe('calendar');
		expect(r.names).toBeUndefined();
	});
});

describe('§14 rule 13: the lists of every calendar that matched with the same year', () => {
	it('two calendars with the same year: the lists of both, in calendar order', () => {
		const a = cycles('A', ['{cycle}.{year}'], [list()]);
		const b = cycles('B', ['{cycle}.{year}'], [{ ...ANIMALS, marker: 'animal' }]);
		const r = read([a, b], '22.13');
		expect(r.names?.map((n) => n.list)).toEqual(['Planets', 'Animals']);
		expect(r.also).toEqual(['B']);
		expect(r.year).toBeDefined();
		expect(r.whole).toBe(true);
	});

	it('lists in one calendar only: a copy without lists does not hide them', () => {
		const a = cycles('A', ['{cycle}.{year}'], [list()]);
		const copy = cycles('A copy', ['{cycle}.{year}']);
		for (const cals of [[a, copy], [copy, a]]) {
			const r = read(cals, '22.13 Sa');
			expect(r.names?.map((n) => n.list)).toEqual(['Planets']);
		}
	});

	it('a sync copy of a calendar gives no double names', () => {
		const a = cycles('A', ['{cycle}.{year} {planet}'], [list()]);
		const copy = { ...cycles('A', ['{cycle}.{year} {planet}'], [list()], 60, 1, 'C 1.md') };
		const r = read([a, copy], '22.13 Sa');
		expect(r.names).toHaveLength(1);
		expect(r.names?.[0].written).toEqual({ index: 0, form: 'short' });
		expect(r.warnings).toEqual([]);
		// Lists of one folded name are kept once, also with another case.
		const loud = cycles('X', ['{cycle}.{year}'], [list({ name: 'PLANETS' })]);
		expect(read([a, loud], '22.13').names).toHaveLength(1);
	});

	it('a date that fits two calendars with different years, or one place, has no year and no name', () => {
		const a = cycles('A', ['{cycle}.{year}'], [list()], 60, 1);
		const b = cycles('B', ['{cycle}.{year}'], [list()], 60, 5);
		const r = read([a, b], '22.13');
		expect(r.warnings).toEqual(['fits-two-calendars']);
		expect(r.year).toBeUndefined();
		expect(r.names).toBeUndefined();
		expect(r.whole).toBeUndefined();
		const same = read([cycles('A', ['{year}'], [list()]), { ...cycles('A', ['{year} {planet}'], [list()], 60, 9) }], '1 Sa');
		expect(same.names).toBeUndefined();
	});

	it('a calendar date and a plain-year list: the names come from the calendar only', () => {
		const r = read(one(['{cycle}.{year}'], [list()]), '22.13', [list({ marker: undefined, name: 'Other' })]);
		expect(r.names?.map((n) => n.list)).toEqual(['Planets']);
	});
});

describe('§14 rule 13: show', () => {
	it('is short unless the list says full or none; a wrong value is short in the reader', () => {
		const c = (show: string) => one(['{cycle}.{year}'], [list({ show: show as never })]);
		expect(read(c('short'), '22.13').names?.[0].show).toBe('short');
		expect(read(c('full'), '22.13').names?.[0].show).toBe('full');
		expect(read(c('none'), '22.13').names?.[0].show).toBe('none');
		expect(read(c('loud'), '22.13').names?.[0].show).toBe('short');
	});
	it('the names keep the short form of a name only when it has one', () => {
		const c = one(['{cycle}.{year}'], [list({ names: [{ name: 'A' }, { name: 'B', short: '  ' }, { name: 'C', short: 'c' }], known: { year: 1, index: 0 } })]);
		expect(read(c, '1.1').names?.[0]).toEqual({ list: 'Planets', name: 'A', show: 'short' });
		expect(read(c, '1.2').names?.[0]).toEqual({ list: 'Planets', name: 'B', show: 'short' });
		expect(read(c, '1.3').names?.[0]).toEqual({ list: 'Planets', name: 'C', short: 'c', show: 'short' });
	});
});

describe('names and the 60 names of a list', () => {
	it('a list needs 1 to 60 names to be used; a name with only white space is no match but keeps its place', () => {
		expect(PLANETS).toHaveLength(7);
		const blank = list({ names: [{ name: '  ' }, { name: 'Real' }], known: { year: 1, index: 1 } });
		const c = one(['{cycle}.{year} {planet}'], [blank]);
		expect(written(read(c, '1.1 Real'))).toEqual(['Planets:1:full']);
	});
});
