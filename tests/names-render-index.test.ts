// Spec §14 rules 13 and 15 (WP-6 step 2): the calendar index with name lists. Plain-year lists from the notes in index order, the first list of a folded name
// kept, `calendar-duplicate` for a later one, a plain-only note as a calendar note, and the lists in the signature of an entry and of a reader.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileCalendars } from '../src/core/dates';
import { MAX_DATE_TEXT, capReader, compileCapped } from '../src/view/calendar-reader';
import { CHANGE_WAIT_MS, createCalendarIndex } from '../src/view/calendar-index';
import { cycleNote, fakeVault, settle } from './support/calendar-vault';
import { cycles, list } from './dates-support/names';

const make = (files: Record<string, string>) => {
	const vault = fakeVault(files, true);
	const index = createCalendarIndex(vault, { pause: async () => undefined });
	return { vault, index };
};
const ready = async (files: Record<string, string>) => {
	const m = make(files);
	await m.index.start();
	return m;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A note with a block that has only the plain-year lists `lists` (each a one-line YAML map). */
const plainNote = (...lists: string[]): string => ['```kin-calendar', 'plain:', '  lists:', ...lists.map((l) => `    - ${l}`), '```', ''].join('\n');
const PLANETS = '{name: Planets, names: [{name: Saturn, short: Sa}, {name: Jupiter, short: Ju}], known: {year: 1273, index: 0}, show: short}';
const ANIMALS = '{name: Animals, names: [Rat, Ox, Dog], known: {year: 1000, index: 1}, show: full}';
/** A note with a cycle calendar that has a list, and plain-year lists. */
const richNote = (plain = PLANETS): string =>
	[
		'```kin-calendar', 'calendars:', '  - name: The Long Count', '    kind: cycles', '    length: 60', '    start: 1', '    formats: ["{cycle}.{year} {planet}", "{cycle}.{year}"]',
		'    lists:', '      - name: Planets', '        marker: planet', '        names: [{name: Saturn, short: Sa}, {name: Jupiter, short: Ju}]', '        known: {year: 1273, index: 0}', '        show: short',
		'plain:', '  lists:', `    - ${plain}`, '```', '',
	].join('\n');

describe('§14 rule 13: a note with only plain-year lists', () => {
	it('is a calendar note, and its lists give names to plain years', async () => {
		const { index } = await ready({ 'a.md': plainNote(PLANETS) });
		expect(index.notes()).toEqual(['a.md']);
		const r = index.readerFor('t.md');
		expect(r.key).not.toBe('plain');
		expect(r.hasLists).toBe(true);
		expect(r.read('1273')?.names?.[0]).toMatchObject({ list: 'Planets', name: 'Saturn', short: 'Sa' });
		expect(r.read('1273')?.whole).toBe(true);
		expect(r.problems).toEqual([]);
	});

	it('a note with an empty `plain` key is a calendar note too, with no list', async () => {
		const { index } = await ready({ 'a.md': '```kin-calendar\nplain:\n```\n' });
		expect(index.notes()).toEqual(['a.md']);
		expect(index.readerFor('t.md').hasLists).toBe(false);
	});
});

describe('§14 rule 13: the link of a tree and a note that has only plain-year lists', () => {
	it('is not "missing"; a note with no calendar and no plain lists still is', async () => {
		const m = make({ 'plain.md': plainNote(PLANETS), 'empty.md': '```kin-calendar\ncalendars: []\n```\n' });
		m.vault.links.set('P', 'plain.md');
		m.vault.links.set('E', 'empty.md');
		await m.index.start();
		expect(m.index.readerFor('t.md', 'P').problems).toEqual([]);
		expect(m.index.readerFor('t.md', 'E').problems).toEqual([{ key: 'calendar-note-missing', note: 'E' }]);
		expect(m.index.readerFor('t.md', 'P').hasLists).toBe(true);
	});
});

describe('§14 rule 13: the plain-year lists of several notes', () => {
	it('collects the lists of every note in index order and keeps the first list of each folded name', async () => {
		const { index } = await ready({
			'a.md': plainNote(PLANETS),
			'b.md': plainNote(ANIMALS, PLANETS.replace('Saturn', 'Other')),
			'c.md': richNote(),
		});
		const r = index.readerFor('t.md');
		const names = r.read('1273')?.names?.map((n) => `${n.list}:${n.name}`);
		// The plain-year lists in index order: Planets (a.md), Animals (b.md); the later Planets of b.md and c.md are dropped.
		expect(names).toEqual(['Planets:Saturn', 'Animals:Ox']);
	});

	it('gives `calendar-duplicate`, naming the other note, for a later list of the same name in another note', async () => {
		const { index } = await ready({ 'a.md': plainNote(PLANETS), 'b.md': plainNote(ANIMALS), 'c.md': plainNote(PLANETS) });
		const dup = index.readerFor('t.md').problems.filter((p) => p.key === 'calendar-duplicate');
		expect(dup).toEqual([
			{ key: 'calendar-duplicate', list: 'Planets', note: 'c.md', other: 'a.md' },
		]);
	});

	it('folds the name: "planets" in a later note is the same list', async () => {
		const { index } = await ready({ 'a.md': plainNote(PLANETS), 'b.md': plainNote(PLANETS.replace('name: Planets', 'name: planets')) });
		expect(index.readerFor('t.md').problems).toEqual([{ key: 'calendar-duplicate', list: 'planets', note: 'b.md', other: 'a.md' }]);
	});

	it('two lists of the same name in one note are no warning of the index (the window refuses them on Save)', async () => {
		const { index } = await ready({ 'a.md': plainNote(PLANETS, PLANETS) });
		expect(index.readerFor('t.md').problems).toEqual([]);
		expect(index.readerFor('t.md').read('1273')?.names).toHaveLength(1);
	});

	it('a tree that links to one note uses the plain-year lists of that note only', async () => {
		const m = make({ 'a.md': plainNote(PLANETS), 'b.md': plainNote(ANIMALS) });
		m.vault.links.set('B', 'b.md');
		await m.index.start();
		expect(m.index.readerFor('t.md', 'B').read('1273')?.names?.map((n) => n.list)).toEqual(['Animals']);
		expect(m.index.readerFor('t.md').read('1273')?.names?.map((n) => n.list)).toEqual(['Planets', 'Animals']);
	});
});

describe('§14 rules 13 and 15: the signature of an entry and of a reader', () => {
	it('a change of a list is a change: the listeners hear of it, and the reader is another one', async () => {
		const m = await ready({ 'a.md': richNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		const before = m.index.readerFor('t.md');
		const keyBefore = before.key;
		// Only the plain-year list changes (a short form).
		m.vault.write('a.md', richNote(PLANETS.replace('short: Sa', 'short: Sat')));
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		const after = m.index.readerFor('t.md');
		expect(after).not.toBe(before);
		expect(after.key).not.toBe(keyBefore);
		expect(after.read('1273')?.names?.[0]?.short).toBe('Sat');
	});

	it('a list inside a calendar also changes the entry', async () => {
		const m = await ready({ 'a.md': richNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		m.vault.write('a.md', richNote().replace('show: short\nplain', 'show: full\nplain'));
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		expect(m.index.calendarsOf('a.md')[0].lists?.[0]?.show).toBe('full');
	});

	it('the same text writes again: no change, the same reader', async () => {
		const m = await ready({ 'a.md': richNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		const before = m.index.readerFor('t.md');
		m.vault.write('a.md', richNote());
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS + 1);
		expect(heard).not.toHaveBeenCalled();
		expect(m.index.readerFor('t.md')).toBe(before);
	});

	it('a note without lists keeps its reader key as in 0.3.2: a hash of the calendars alone', async () => {
		const m = await ready({ 'a.md': cycleNote() });
		const plain = compileCalendars(m.index.calendarsOf('a.md'), true, []);
		expect(m.index.readerFor('t.md').key).toBe(plain.key);
	});

	it('the key is exactly "pending" before the first scan ends and "plain" with no calendar, no list and no problem', async () => {
		const m = make({ 'a.md': plainNote(PLANETS) });
		const started = m.index.start();
		expect(m.index.readerFor('t.md').key).toBe('pending');
		expect(m.index.readerFor('t.md').hasLists).toBe(false);
		await started;
		expect(m.index.readerFor('t.md').key).not.toBe('plain');
		expect((await ready({ 'a.md': 'hello' })).index.readerFor('t.md').key).toBe('plain');
	});
});

describe('§14 rule 15: `capReader` and `compileCapped` forward the plain-year lists and `hasLists`', () => {
	const plainLists = [list({ marker: undefined })];

	it('`compileCapped` gives the plain-year lists to the reader', () => {
		const r = compileCapped([], true, [], plainLists);
		expect(r.hasLists).toBe(true);
		expect(r.read('1273')?.names?.[0]?.name).toBe('Saturn');
		expect(compileCapped([], true).hasLists).toBe(false);
	});

	it('`capReader` keeps `hasLists`, and a text over the limit is read by the plain reader (no name)', () => {
		const r = capReader(compileCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list()])], true));
		expect(r.hasLists).toBe(true);
		expect(r.read('22.13')?.names?.[0]?.name).toBe('Saturn');
		expect(r.read(`1273${' '.repeat(MAX_DATE_TEXT)}`)?.names).toBeUndefined();
	});
});
