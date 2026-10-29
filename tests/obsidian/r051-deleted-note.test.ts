import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadThen } from '../../src/obsidian/calendar-block-view';
import { createCalendarIndex } from '../../src/view/calendar-index';
import { createFenceIndex } from '../../src/view/fence-index';
import { fakeVault } from '../support/calendar-vault';
import { fakeFenceVault, fakeStore } from '../support/fake-fence-vault';

/*
 * Does a note that is deleted right after it changed give an unhandled rejection from the code that reads notes?
 * Every read of the fence index and of the calendar index is run with a fake whose read fails with ENOENT after the delete.
 * A listener on `unhandledRejection` collects what escapes.
 */

const enoent = (path: string): Error => Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });

let escaped: unknown[] = [];
const onEscape = (reason: unknown) => escaped.push(reason);

beforeEach(() => {
	escaped = [];
	process.on('unhandledRejection', onEscape);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	process.off('unhandledRejection', onEscape);
	vi.restoreAllMocks();
});

/** The Node event `unhandledRejection` comes after the microtask queue is empty: a real macrotask turn waits for it. */
const settle = async () => {
	await new Promise((r) => setTimeout(r, 30));
};

describe('fence index: a note deleted right after it changed', () => {
	it('modify, then delete while the safety read is held: the read fails with ENOENT and nothing escapes', async () => {
		const vault = fakeFenceVault({ 'a.md': '```kin\npeople: []\n```\n' });
		const idx = createFenceIndex(vault, fakeStore(), { safetyMs: 5 });
		await idx.start();
		const held = vault.hold('a.md');
		vault.edit('a.md', '```kin\npeople: []\n```\nmore\n', { cache: false });
		await new Promise((r) => setTimeout(r, 20));
		expect(held.started).toBe(true);
		vault.remove('a.md');
		held.fail(enoent('a.md').message);
		await settle();
		expect(escaped).toEqual([]);
		idx.dispose();
	});

	it('create, then delete before the first read: the read fails and nothing escapes', async () => {
		const vault = fakeFenceVault({});
		const idx = createFenceIndex(vault, fakeStore(), { safetyMs: 5 });
		await idx.start();
		vault.add('b.md', '```kin\npeople: []\n```\n', { cache: false });
		vault.remove('b.md');
		await new Promise((r) => setTimeout(r, 30));
		await settle();
		expect(escaped).toEqual([]);
		idx.dispose();
	});
});

describe('calendar index: a note deleted right after it changed', () => {
	it('a key that names a note whose read fails with ENOENT: nothing escapes', async () => {
		const vault = fakeVault({ 'Calendars.md': 'x' });
		vault.links.set('[[Calendars]]', 'Calendars.md');
		vault.read = async (path: string) => {
			throw enoent(path);
		};
		const index = createCalendarIndex(vault, { waitMs: 1 });
		index.readerFor('t.md', '[[Calendars]]');
		await settle();
		vault.emit('delete', 'Calendars.md');
		await settle();
		expect(escaped).toEqual([]);
	});

	it('the Edit button of a calendar block on a deleted note: nothing escapes and the window stays shut', async () => {
		const vault = fakeVault({});
		vault.read = async (path: string) => {
			throw enoent(path);
		};
		const index = createCalendarIndex(vault);
		const open = vi.fn();
		reloadThen(index, 'Gone.md', open);
		await settle();
		expect(open).not.toHaveBeenCalled();
		expect(escaped).toEqual([]);
	});
});
