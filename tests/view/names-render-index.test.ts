// Spec §14 rules 13 and 15 (WP-6 step 2), as 0.4 WP-3a changes it (D289, D270 item 3): the calendar index with name lists. The plain-year lists of the one note that a tree names,
// a plain-only note as a calendar note, and the lists in the signature of an entry and of a reader. A tree used the lists of every note, the first of a folded name kept and
// `calendar-duplicate` for a later one: a tree now names one note, so those cases are gone; the lists of other notes are never used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileCalendars } from '../../src/core/dates';
import { MAX_DATE_TEXT, capReader, compileCapped } from '../../src/view/calendar-reader';
import { CHANGE_WAIT_MS, createCalendarIndex } from '../../src/view/calendar-index';
import { cycleNote, fakeVault, settle } from '../support/calendar-vault';
import { cycles, list } from '../dates-support/names';

/** The key that names the note `a.md` is `[[a]]`: the fake vault resolves one link for each note. */
const link = (path: string): string => `[[${path.replace(/[.]md$/, '')}]]`;
const A = link('a.md');
const make = (files: Record<string, string>) => {
	const vault = fakeVault(files, true);
	for (const path of Object.keys(files)) vault.links.set(link(path), path);
	const index = createCalendarIndex(vault);
	return { vault, index };
};
/** Lets the loads end and the wait of the change pass. */
const later = async (): Promise<void> => {
	await settle();
	await vi.advanceTimersByTimeAsync(CHANGE_WAIT_MS * 3);
	await settle();
};
/** An index on the files, with the reader of the key that names `a.md` asked once and loaded. */
const ready = async (files: Record<string, string>) => {
	const m = make(files);
	m.index.readerFor('t.md', A);
	await later();
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
		const r = index.readerFor('t.md', A);
		expect(r.key).not.toBe('plain');
		expect(r.hasLists).toBe(true);
		expect(r.read('1273')?.names?.[0]).toMatchObject({ list: 'Planets', name: 'Saturn', short: 'Sa' });
		expect(r.read('1273')?.whole).toBe(true);
		expect(r.problems).toEqual([]);
	});

	it('a note with an empty `plain` key is a calendar note too, with no list', async () => {
		const { index } = await ready({ 'a.md': '```kin-calendar\nplain:\n```\n' });
		expect(index.notes()).toEqual(['a.md']);
		expect(index.readerFor('t.md', A).hasLists).toBe(false);
	});
});

describe('§14 rule 13: the link of a tree and a note that has only plain-year lists', () => {
	it('is not "missing"; a note with no calendar and no plain lists still is', async () => {
		const m = make({ 'plain.md': plainNote(PLANETS), 'empty.md': '```kin-calendar\ncalendars: []\n```\n' });
		m.vault.links.set('P', 'plain.md');
		m.vault.links.set('E', 'empty.md');
		m.index.readerFor('t.md', 'P');
		m.index.readerFor('t.md', 'E');
		await later();
		expect(m.index.readerFor('t.md', 'P').problems).toEqual([]);
		expect(m.index.readerFor('t.md', 'E').problems).toEqual([{ key: 'calendar-note-missing', note: 'E' }]);
		expect(m.index.readerFor('t.md', 'P').hasLists).toBe(true);
	});
});

describe('§14 rule 13: the plain-year lists of the note that a tree names', () => {
	it('two lists of the same name in one note are no warning of the index (the window refuses them on Save)', async () => {
		const { index } = await ready({ 'a.md': plainNote(PLANETS, PLANETS) });
		expect(index.readerFor('t.md', A).problems).toEqual([]);
		expect(index.readerFor('t.md', A).read('1273')?.names).toHaveLength(1);
	});

	it('a tree that names one note uses the plain-year lists of that note only, whatever other notes hold', async () => {
		const m = make({ 'a.md': plainNote(PLANETS), 'b.md': plainNote(ANIMALS), 'c.md': plainNote(PLANETS) });
		m.index.readerFor('t.md', link('b.md'));
		await later();
		expect(m.index.readerFor('t.md', link('b.md')).read('1273')?.names?.map((n) => n.list)).toEqual(['Animals']);
		expect(m.index.readerFor('t.md', link('b.md')).problems).toEqual([]);
		// The notes that no tree names are never read.
		expect(m.vault.reads).toEqual(['b.md']);
		expect(m.index.plainListsOf('a.md')).toEqual([]);
	});

	it('a tree with no key has no name for a plain year, although the vault holds a list', async () => {
		const m = make({ 'a.md': plainNote(PLANETS) });
		await m.index.start();
		const r = m.index.readerFor('t.md');
		expect(r.hasLists).toBe(false);
		expect(r.read('1273')?.names).toBeUndefined();
	});
});

describe('§14 rules 13 and 15: the signature of an entry and of a reader', () => {
	it('a change of a list is a change: the listeners hear of it, and the reader is another one', async () => {
		const m = await ready({ 'a.md': richNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		const before = m.index.readerFor('t.md', A);
		const keyBefore = before.key;
		// Only the plain-year list changes (a short form).
		m.vault.write('a.md', richNote(PLANETS.replace('short: Sa', 'short: Sat')));
		await settle();
		await vi.advanceTimersByTimeAsync(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		const after = m.index.readerFor('t.md', A);
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
		await vi.advanceTimersByTimeAsync(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		expect(m.index.calendarsOf('a.md')[0].lists?.[0]?.show).toBe('full');
	});

	it('the same text writes again: no change, the same reader', async () => {
		const m = await ready({ 'a.md': richNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		const before = m.index.readerFor('t.md', A);
		m.vault.write('a.md', richNote());
		await settle();
		await vi.advanceTimersByTimeAsync(CHANGE_WAIT_MS + 1);
		expect(heard).not.toHaveBeenCalled();
		expect(m.index.readerFor('t.md', A)).toBe(before);
	});

	it('a note without lists keeps its reader key as in 0.3.2: a hash of the calendars alone', async () => {
		const m = await ready({ 'a.md': cycleNote() });
		const plain = compileCalendars(m.index.calendarsOf('a.md'), true, []);
		expect(m.index.readerFor('t.md', A).key).toBe(plain.key);
	});

	it('the key is exactly "pending" before the note is read, and "plain" for a tree with no key', async () => {
		const m = make({ 'a.md': plainNote(PLANETS) });
		expect(m.index.readerFor('t.md', A).key).toBe('pending');
		expect(m.index.readerFor('t.md', A).hasLists).toBe(false);
		await later();
		expect(m.index.readerFor('t.md', A).key).not.toBe('plain');
		expect(m.index.readerFor('t.md').key).toBe('plain');
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
