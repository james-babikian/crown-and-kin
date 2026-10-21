// Step 4.3 of WP-4 (the architecture notes §5.7, rule 11): the calendar index through a fake vault. Create, change, rename, delete, a sync-conflict copy, notes
// whose cache entry is unknown, the cache gate, the identity of the reader, the debounce and the two tree problems.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_WAIT_MS, createCalendarIndex } from '../src/view/calendar-index';
import { cycleNote, eraNote, fakeVault, settle } from './support/calendar-vault';

const make = (files: Record<string, string>, cache = true) => {
	const vault = fakeVault(files, cache);
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

describe('first scan', () => {
	it('reads only notes that can hold a block, and is ready after the cache', async () => {
		const m = make({ 'a.md': cycleNote(), 'b.md': 'plain text', 'c.md': '```js\nx\n```' }, false);
		m.vault.sections.set('b.md', 'no');
		const started = m.index.start();
		await settle();
		expect(m.index.ready).toBe(false);
		// 'b.md' has a cache entry that says no code section: it is never read.
		expect(m.vault.reads).not.toContain('b.md');
		expect(m.vault.reads).toContain('a.md');
		expect(m.index.readerFor('t.md').ready).toBe(false);
		expect(m.index.readerFor('t.md').key).toBe('pending');
		m.vault.cacheDone();
		await started;
		expect(m.index.ready).toBe(true);
		expect(m.index.notes()).toEqual(['a.md']);
		expect(m.index.readerFor('t.md').ready).toBe(true);
	});

	it('reads a note whose cache entry is unknown (the cache is still being built)', async () => {
		const m = make({ 'a.md': cycleNote() }, false);
		const started = m.index.start();
		await settle();
		expect(m.vault.reads).toEqual(['a.md']);
		m.vault.cacheDone();
		await started;
		expect(m.index.notes()).toEqual(['a.md']);
	});

	it('the same pending reader serves every tree until ready; the ready moment changes the key once', async () => {
		const m = make({ 'a.md': cycleNote() }, false);
		const started = m.index.start();
		await settle();
		const before = m.index.readerFor('t.md');
		expect(m.index.readerFor('u.md')).toBe(before);
		m.vault.cacheDone();
		await started;
		const after = m.index.readerFor('t.md');
		expect(after.key).not.toBe(before.key);
		expect(after.key).not.toBe('pending');
	});

	it('tells the listeners at once when it is ready', async () => {
		const m = make({ 'a.md': cycleNote() }, false);
		const heard = vi.fn();
		m.index.onChange(heard);
		const started = m.index.start();
		m.vault.cacheDone();
		await started;
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('a vault with no calendar note is ready with the plain key', async () => {
		const { index } = await ready({ 'a.md': 'hello' });
		const r = index.readerFor('t.md');
		expect(r.key).toBe('plain');
		expect(r.problems).toEqual([]);
	});
});

describe('vault events', () => {
	it('create and modify read that one note', async () => {
		const { vault, index } = await ready({});
		vault.write('new.md', cycleNote());
		await settle();
		expect(index.notes()).toEqual(['new.md']);
		const key = index.readerFor('t.md').key;
		vault.write('new.md', cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100));
		await settle();
		expect(index.readerFor('t.md').key).not.toBe(key);
		expect(index.calendarsOf('new.md')[0].kind).toMatchObject({ start: 100 });
	});

	it('modify reads the note even when the cache still says it has no section', async () => {
		const { vault, index } = await ready({ 'a.md': 'nothing' });
		vault.sections.set('a.md', 'no');
		vault.write('a.md', cycleNote());
		await settle();
		expect(index.notes()).toEqual(['a.md']);
	});

	it('removing the block from a note removes its calendars', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		vault.write('a.md', 'no more');
		await settle();
		expect(index.notes()).toEqual([]);
		expect(index.readerFor('t.md').key).toBe('plain');
	});

	it('rename moves the entry to the new path', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		vault.notes.set('b.md', vault.notes.get('a.md')!);
		vault.notes.delete('a.md');
		vault.emit('rename', 'b.md', 'a.md');
		await settle();
		expect(index.notes()).toEqual(['b.md']);
		expect(index.calendarsOf('b.md')[0].note).toBe('b.md');
	});

	it('delete removes the calendars', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		vault.notes.delete('a.md');
		vault.emit('delete', 'a.md');
		expect(index.notes()).toEqual([]);
	});

	it('a read that is slower than a newer read of the same note is dropped', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		const slow = vault.read;
		let release: (t: string) => void = () => undefined;
		vault.read = (p) => (vault.reads.push(p), new Promise<string>((r) => (release = r)));
		vault.emit('modify', 'a.md');
		const first = release;
		vault.read = slow;
		vault.notes.set('a.md', cycleNote('Newer'));
		vault.emit('modify', 'a.md');
		await settle();
		first(cycleNote('Older'));
		await settle();
		expect(index.calendarsOf('a.md')[0].name).toBe('Newer');
	});

	it('a cache event reads a note that was unknown, and no other', async () => {
		const m = make({ 'a.md': cycleNote(), 'b.md': cycleNote('Other') }, false);
		m.vault.sections.set('b.md', 'yes');
		const started = m.index.start();
		await settle();
		m.vault.cacheDone();
		await started;
		const before = m.vault.reads.length;
		m.vault.sections.set('a.md', 'yes');
		m.vault.emit('cache', 'b.md');
		m.vault.emit('cache', 'a.md');
		await settle();
		expect(m.vault.reads.slice(before)).toEqual(['a.md']);
	});

	it('an unreadable note has no calendars and does not stop the index', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		vault.notes.delete('a.md');
		vault.emit('modify', 'a.md');
		await settle();
		expect(index.notes()).toEqual([]);
	});
});

describe('readers', () => {
	it('readerFor gives the same instance while nothing changed, also for another change that moves no calendar', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		const r = index.readerFor('t.md');
		expect(index.readerFor('t.md')).toBe(r);
		vault.write('other.md', 'text only');
		await settle();
		expect(index.readerFor('t.md')).toBe(r);
		// A note with a block whose calendars equal the old ones does not change the content of the set that the tree reads.
		vault.write('a.md', `${cycleNote()}\nmore text`);
		await settle();
		expect(index.readerFor('t.md')).toBe(r);
	});

	it('sorts the calendars by note, then block, then calendar, so the scan order does not matter', async () => {
		const files = { 'b.md': eraNote('B era', 'Beta'), 'a.md': eraNote('A era', 'Alpha') };
		const one = await ready(files);
		const two = await ready({ 'a.md': files['a.md'], 'b.md': files['b.md'] });
		expect(one.index.readerFor('t.md').key).toBe(two.index.readerFor('t.md').key);
		expect(one.index.readerFor('t.md').read('Alpha 3')?.calendar).toBe('A era');
	});

	it('reads a date in the calendar of a note', async () => {
		const { index } = await ready({ 'a.md': eraNote() });
		const r = index.readerFor('t.md').read('Qinglong Emperor 3');
		expect(r?.year).toBe(132);
		expect(r?.source).toBe('calendar');
	});

	it('a tree with a calendar link uses only that note', async () => {
		const { vault, index } = await ready({ 'a.md': eraNote('A era', 'Alpha'), 'b.md': eraNote('B era', 'Beta') });
		vault.links.set('[[B]]', 'b.md');
		const r = index.readerFor('t.md', '[[B]]');
		expect(r.read('Beta 1')?.year).toBe(130);
		expect(r.read('Alpha 1')?.source).not.toBe('calendar');
		expect(index.usedNotes('t.md', '[[B]]')).toEqual(['b.md']);
		expect(index.usedNotes('t.md')).toEqual(['a.md', 'b.md']);
	});

	it('a link to a missing note, or to a note with no calendar, gives calendar-note-missing and no calendars', async () => {
		const { vault, index } = await ready({ 'a.md': eraNote(), 'plain.md': 'text' });
		vault.links.set('[[Plain]]', 'plain.md');
		const missing = index.readerFor('t.md', '[[Nowhere]]');
		expect(missing.problems).toEqual([{ key: 'calendar-note-missing', note: '[[Nowhere]]' }]);
		expect(missing.read('Qinglong Emperor 3')?.source).not.toBe('calendar');
		expect(index.readerFor('t.md', '[[Plain]]').problems[0]?.key).toBe('calendar-note-missing');
	});

	it('a link that starts to resolve (the note is made) clears the problem', async () => {
		const { vault, index } = await ready({});
		const before = index.readerFor('t.md', '[[Far]]');
		expect(before.problems).toHaveLength(1);
		vault.links.set('[[Far]]', 'far.md');
		vault.write('far.md', eraNote());
		await settle();
		const after = index.readerFor('t.md', '[[Far]]');
		expect(after.problems).toEqual([]);
		expect(after.key).not.toBe(before.key);
	});

	it('a sync-conflict copy gives calendar-duplicate and keeps the year of a date that fits both', async () => {
		const { index } = await ready({ 'Calendars.md': eraNote(), 'Calendars (conflicted copy).md': eraNote() });
		const r = index.readerFor('t.md');
		expect(r.problems.map((p) => p.key)).toEqual(['calendar-duplicate']);
		const d = r.read('Qinglong Emperor 3');
		expect(d?.year).toBe(132);
		expect(d?.warnings).not.toContain('fits-two-calendars');
	});

	it('two notes with the same era name but other starts: a date that fits both has no year', async () => {
		const { index } = await ready({ 'a.md': eraNote('One', 'Qinglong Emperor', 130), 'b.md': eraNote('Two', 'Qinglong Emperor', 500) });
		const d = index.readerFor('t.md').read('Qinglong Emperor 3');
		expect(d?.year).toBeUndefined();
		expect(d?.warnings).toContain('fits-two-calendars');
	});
});

describe('onChange', () => {
	it('is debounced: a burst of events is one call after the wait', async () => {
		const { vault, index } = await ready({});
		const heard = vi.fn();
		index.onChange(heard);
		vault.write('a.md', cycleNote('One'));
		await settle();
		vault.write('a.md', cycleNote('Two'));
		await settle();
		vault.write('b.md', cycleNote('Three', '{year} of {cycle}'));
		await settle();
		expect(heard).not.toHaveBeenCalled();
		vi.advanceTimersByTime(CHANGE_WAIT_MS - 1);
		expect(heard).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2);
		expect(heard).toHaveBeenCalledTimes(1);
	});

	it('an event that changes nothing in the calendars tells nobody', async () => {
		const { vault, index } = await ready({ 'a.md': cycleNote() });
		const heard = vi.fn();
		index.onChange(heard);
		vault.write('x.md', 'plain');
		vault.write('a.md', cycleNote());
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS * 2);
		expect(heard).not.toHaveBeenCalled();
	});

	it('the unsubscribe function stops the calls, and dispose stops the events', async () => {
		const { vault, index } = await ready({});
		const heard = vi.fn();
		const off = index.onChange(heard);
		off();
		vault.write('a.md', cycleNote());
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS * 2);
		expect(heard).not.toHaveBeenCalled();
		index.dispose();
		vault.write('b.md', eraNote());
		await settle();
		expect(index.notes()).toEqual(['a.md']);
	});

	it('a failing listener does not stop the others', async () => {
		const { vault, index } = await ready({});
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const heard = vi.fn();
		index.onChange(() => {
			throw new Error('boom');
		});
		index.onChange(heard);
		vault.write('a.md', cycleNote());
		await settle();
		vi.advanceTimersByTime(CHANGE_WAIT_MS + 1);
		expect(heard).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
