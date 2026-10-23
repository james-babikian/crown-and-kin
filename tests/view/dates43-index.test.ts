// Step 4.3 of WP-4 (the architecture notes §5.7, rule 11), as 0.4 WP-3a changes it (D289, the index contract 4.1): the calendar readers through a fake vault. A tree reads a calendar only when it
// names a note, so every test asks for a reader with a link. Change, rename, delete, a note that cannot be read, the cache gate, the identity of the reader, the debounce and the problem of
// a note that is missing. The cases of the old first scan (notes read for their sections, the "unknown" cache state, every note used by a tree with no key) and the sync-conflict copy
// (`calendar-duplicate`) have no meaning now: the index reads no note that no tree names. The new rules are tested in `tests/acceptance/r04-calendar-readers.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_WAIT_MS, createCalendarIndex } from '../../src/view/calendar-index';
import { cycleNote, eraNote, fakeVault, settle } from '../support/calendar-vault';

const A = '[[A]]';

const make = (files: Record<string, string>, cache = true) => {
	const vault = fakeVault(files, cache);
	vault.links.set(A, 'a.md');
	vault.links.set('[[B]]', 'b.md');
	const index = createCalendarIndex(vault);
	return { vault, index };
};

/** Lets the loads end and the wait of the change pass. */
const later = async (ms = CHANGE_WAIT_MS * 3): Promise<void> => {
	await settle();
	await vi.advanceTimersByTimeAsync(ms);
	await settle();
};

/** An index on a vault, with the reader of the key `[[A]]` asked once and loaded. */
const loaded = async (files: Record<string, string>) => {
	const m = make(files);
	m.index.readerFor('t.md', A);
	await later();
	return m;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the readers and the cache gate', () => {
	it('a key is pending until the metadata cache is ready and the note is read; a tree with no key is never pending', async () => {
		const m = make({ 'a.md': cycleNote() }, false);
		await m.index.start();
		expect(m.index.readerFor('t.md', A).ready).toBe(false);
		expect(m.index.readerFor('t.md', A).key).toBe('pending');
		expect(m.index.readerFor('t.md').key).toBe('plain');
		expect(m.vault.reads).toEqual([]);
		m.vault.cacheDone();
		await later();
		expect(m.index.readerFor('t.md', A).ready).toBe(true);
		expect(m.vault.reads).toEqual(['a.md']);
	});

	it('the same pending reader serves every tree until ready; the ready moment changes the key once', async () => {
		const m = make({ 'a.md': cycleNote() }, false);
		const before = m.index.readerFor('t.md', A);
		expect(m.index.readerFor('u.md', A)).toBe(before);
		m.vault.cacheDone();
		await later();
		const after = m.index.readerFor('t.md', A);
		expect(after.key).not.toBe(before.key);
		expect(after.key).not.toBe('pending');
	});

	it('tells the listeners once when the note is read', async () => {
		const m = make({ 'a.md': cycleNote() });
		const heard = vi.fn();
		m.index.onChange(heard);
		m.index.readerFor('t.md', A);
		await later();
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('a tree with no key reads plain years: the plain key, no problem, whatever notes the vault has', async () => {
		const m = make({ 'a.md': cycleNote() });
		await m.index.start();
		const r = m.index.readerFor('t.md');
		expect(r.key).toBe('plain');
		expect(r.problems).toEqual([]);
		expect(m.vault.reads).toEqual([]);
	});
});

describe('vault events', () => {
	it('a change of the note that a tree names updates its calendars with the text of the event', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		const key = index.readerFor('t.md', A).key;
		vault.write('a.md', cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100));
		await later();
		expect(index.readerFor('t.md', A).key).not.toBe(key);
		expect(index.calendarsOf('a.md')[0].kind).toMatchObject({ start: 100 });
		expect(vault.reads).toEqual(['a.md']);
	});

	it('removing the block from the note makes it a note with no calendar', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		vault.write('a.md', 'no more');
		await later();
		expect(index.calendarsOf('a.md')).toEqual([]);
		expect(index.readerFor('t.md', A).problems.map((p) => p.key)).toEqual(['calendar-note-missing']);
	});

	it('rename moves the entry to the new path', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		vault.notes.set('b.md', vault.notes.get('a.md')!);
		vault.notes.delete('a.md');
		vault.links.set(A, 'b.md');
		vault.emit('rename', 'b.md', 'a.md');
		await later();
		expect(index.usedNotes('t.md', A)).toEqual(['b.md']);
		expect(index.calendarsOf('b.md')[0].note).toBe('b.md');
		expect(vault.reads).toEqual(['a.md']);
	});

	it('delete removes the calendars', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		vault.notes.delete('a.md');
		vault.emit('delete', 'a.md');
		await later();
		expect(index.calendarsOf('a.md')).toEqual([]);
		expect(index.readerFor('t.md', A).problems.map((p) => p.key)).toEqual(['calendar-note-missing']);
	});

	it('a note that cannot be read has no calendars and does not stop the index', async () => {
		const m = make({});
		m.vault.links.set(A, 'a.md');
		m.vault.notes.set('a.md', cycleNote());
		m.vault.read = () => Promise.reject(new Error('locked'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		m.index.readerFor('t.md', A);
		await later();
		expect(m.index.readerFor('t.md', A).problems.map((p) => p.key)).toEqual(['calendar-note-missing']);
		// The next event of the note brings the text, and the calendars are there.
		m.vault.write('a.md', cycleNote());
		await later();
		expect(m.index.readerFor('t.md', A).problems).toEqual([]);
		spy.mockRestore();
	});
});

describe('readers', () => {
	it('readerFor gives the same instance while nothing changed, also for another change that moves no calendar', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		const r = index.readerFor('t.md', A);
		expect(index.readerFor('t.md', A)).toBe(r);
		vault.write('other.md', 'text only');
		await later();
		expect(index.readerFor('t.md', A)).toBe(r);
		// A note with a block whose calendars equal the old ones does not change the content of the set that the tree reads.
		vault.write('a.md', `${cycleNote()}\nmore text`);
		await later();
		expect(index.readerFor('t.md', A)).toBe(r);
	});

	it('reads a date in the calendar of the note', async () => {
		const { index } = await loaded({ 'a.md': eraNote() });
		const r = index.readerFor('t.md', A).read('Qinglong Emperor 3');
		expect(r?.year).toBe(132);
		expect(r?.source).toBe('calendar');
	});

	it('a tree uses only the note it names', async () => {
		const m = make({ 'a.md': eraNote('A era', 'Alpha'), 'b.md': eraNote('B era', 'Beta') });
		m.index.readerFor('t.md', '[[B]]');
		await later();
		const r = m.index.readerFor('t.md', '[[B]]');
		expect(r.read('Beta 1')?.year).toBe(130);
		expect(r.read('Alpha 1')?.source).not.toBe('calendar');
		expect(m.index.usedNotes('t.md', '[[B]]')).toEqual(['b.md']);
		expect(m.index.usedNotes('t.md')).toEqual([]);
		expect(m.vault.reads).toEqual(['b.md']);
	});

	it('a link to a missing note, or to a note with no calendar, gives calendar-note-missing and no calendars', async () => {
		const m = make({ 'a.md': eraNote(), 'plain.md': 'text' });
		m.vault.links.set('[[Plain]]', 'plain.md');
		m.index.readerFor('t.md', '[[Nowhere]]');
		m.index.readerFor('t.md', '[[Plain]]');
		await later();
		const missing = m.index.readerFor('t.md', '[[Nowhere]]');
		expect(missing.problems).toEqual([{ key: 'calendar-note-missing', note: '[[Nowhere]]' }]);
		expect(missing.read('Qinglong Emperor 3')?.source).not.toBe('calendar');
		expect(m.index.readerFor('t.md', '[[Plain]]').problems[0]?.key).toBe('calendar-note-missing');
	});

	it('a link that starts to resolve (the note is made) clears the problem', async () => {
		const m = make({});
		m.index.readerFor('t.md', '[[Far]]');
		await later();
		const before = m.index.readerFor('t.md', '[[Far]]');
		expect(before.problems).toHaveLength(1);
		m.vault.links.set('[[Far]]', 'far.md');
		m.vault.write('far.md', eraNote());
		await later();
		const after = m.index.readerFor('t.md', '[[Far]]');
		expect(after.problems).toEqual([]);
		expect(after.key).not.toBe(before.key);
	});

	it('one note with two calendars of the same era name but other starts: a date that fits both has no year', async () => {
		// Before D289 these were two notes (a sync-conflict copy gave `calendar-duplicate`); a tree now reads the one note that it names, and the matcher still finds the clash inside it.
		const { index } = await loaded({ 'a.md': `${eraNote('One', 'Qinglong Emperor', 130)}\n${eraNote('Two', 'Qinglong Emperor', 500)}` });
		const d = index.readerFor('t.md', A).read('Qinglong Emperor 3');
		expect(d?.year).toBeUndefined();
		expect(d?.warnings).toContain('fits-two-calendars');
	});
});

describe('onChange', () => {
	it('is debounced: a burst of events is one call after the wait', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote('Zero') });
		const heard = vi.fn();
		index.onChange(heard);
		vault.write('a.md', cycleNote('One'));
		await settle();
		vault.write('a.md', cycleNote('Two'));
		await settle();
		vault.write('a.md', cycleNote('Three', '{year} of {cycle}'));
		await settle();
		expect(heard).not.toHaveBeenCalled();
		vi.advanceTimersByTime(CHANGE_WAIT_MS - 1);
		expect(heard).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2);
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('an event that changes nothing in the calendars tells nobody', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote() });
		const heard = vi.fn();
		index.onChange(heard);
		vault.write('x.md', 'plain');
		vault.write('a.md', cycleNote());
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS * 2);
		expect(heard).not.toHaveBeenCalled();
	});

	it('the unsubscribe function stops the calls, and dispose stops the events', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote('Zero') });
		const heard = vi.fn();
		const off = index.onChange(heard);
		off();
		vault.write('a.md', cycleNote('One'));
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS * 2);
		expect(heard).not.toHaveBeenCalled();
		index.dispose();
		vault.write('a.md', cycleNote('Two'));
		await settle();
		expect(index.calendarsOf('a.md')[0].name).toBe('One');
	});

	it('a failing listener does not stop the others', async () => {
		const { vault, index } = await loaded({ 'a.md': cycleNote('Zero') });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const heard = vi.fn();
		index.onChange(() => {
			throw new Error('boom');
		});
		index.onChange(heard);
		vault.write('a.md', cycleNote('One'));
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
