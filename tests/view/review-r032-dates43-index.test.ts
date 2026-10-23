// G2 review of WP-4 step 4.3: the calendar index on a fake vault. Probes; a failing test is a proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarIndex } from '../../src/view/calendar-index';
import { readFileSync } from 'node:fs';
import { cycleNote, fakeVault, settle } from '../support/calendar-vault';


describe('the index after dispose', () => {
	it('start after dispose (the plugin was turned off before the layout was ready) leaves no event handler behind', async () => {
		const vault = fakeVault({ 'a.md': cycleNote() });
		let live = 0;
		const on = vault.on.bind(vault);
		vault.on = (e, cb) => {
			live++;
			const off = on(e, cb);
			return () => {
				live--;
				off();
			};
		};
		const index = createCalendarIndex(vault);
		index.dispose();
		await index.start();
		expect(live).toBe(0);
	});
});

describe('the cache catches up (D289: a note that a tree names is read once; later changes come with the cache event)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('a note that gained a block while the app was closed is found when the cache catches up', async () => {
		const vault = fakeVault({ 'plain.md': 'just text' });
		vault.links.set('[[plain]]', 'plain.md');
		const index = createCalendarIndex(vault);
		index.readerFor('t.md', '[[plain]]');
		await settle();
		await vi.advanceTimersByTimeAsync(1000);
		expect(index.readerFor('t.md', '[[plain]]').problems.map((p) => p.key)).toEqual(['calendar-note-missing']);
		// The file was changed outside Obsidian: no modify event comes, the cache parses it again and brings the text.
		vault.notes.set('plain.md', cycleNote());
		vault.emit('cache', 'plain.md', cycleNote());
		await settle();
		await vi.advanceTimersByTimeAsync(1000);
		expect(index.notes()).toEqual(['plain.md']);
		expect(index.readerFor('t.md', '[[plain]]').problems).toEqual([]);
	});
});

describe('the source file', () => {
	it('holds no NUL byte (git and grep treat such a file as binary, so a review of it shows no diff)', () => {
		expect(readFileSync('src/view/calendar-index.ts', 'utf8').includes(String.fromCharCode(0))).toBe(false);
	});
});
