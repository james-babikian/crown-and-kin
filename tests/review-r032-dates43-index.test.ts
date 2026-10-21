// G2 review of WP-4 step 4.3: the calendar index on a fake vault. Probes; a failing test is a proof.
import { describe, expect, it } from 'vitest';
import { createCalendarIndex } from '../src/view/calendar-index';
import { readFileSync } from 'node:fs';
import { cycleNote, fakeVault, settle } from './support/calendar-vault';


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
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		index.dispose();
		await index.start();
		expect(live).toBe(0);
	});
});

describe('the first scan trusts the cache', () => {
	it('a note that gained a block while the app was closed is found when the cache catches up', async () => {
		const vault = fakeVault({ 'plain.md': 'just text' });
		// At the scan the cache still holds the old answer for the note ("no section that can hold a block").
		vault.sections.set('plain.md', 'no');
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		await index.start();
		expect(index.notes()).toEqual([]);
		// The file was changed outside Obsidian: no modify event comes, the cache parses it again and says so.
		vault.notes.set('plain.md', cycleNote());
		vault.sections.set('plain.md', 'yes');
		vault.emit('cache', 'plain.md');
		await settle();
		expect(index.notes()).toEqual(['plain.md']);
	});
});

describe('the source file', () => {
	it('holds no NUL byte (git and grep treat such a file as binary, so a review of it shows no diff)', () => {
		expect(readFileSync('src/view/calendar-index.ts', 'utf8').includes(String.fromCharCode(0))).toBe(false);
	});
});
