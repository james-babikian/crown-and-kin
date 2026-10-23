import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { fakeLocalStorage } from '../support/fake-fence-vault';
import { FENCE_KEY, PENDING_KEY_LOCAL, advance, bootPlugin, type Booted } from '../support/r04-wiring-app';
import { clock, dispatchWindow, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-3a, step T0, package W: `main.ts` and the fence index (the index contract 1.5, 2, 4.1; test list 5, 8; gate finding M3). The plugin makes `fence` (the fence index with the local storage of the vault
 * under the key `crown-and-kin-fence-index`), starts it when the layout is ready (not at load), gives the calendar index `notes: () => fence.notes('cal')`, gives the rename scan
 * `kinNotes: () => fence.complete ? new Set([...fence.notes('kin'), ...fence.unsure()]) : null`, saves the store at `pagehide`, and stops it at unload. Some tests put a unit fake of the contract's `FenceIndex`
 * in the place of `plugin.fence` before the plugin loads (the field is named `fence` in the contract); the others use the real index on the fake app.
 * Written from the contract, before the code exists: These tests are expected to fail until package W is built.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

const KIN = (link: string) => ['```kin', 'people:', '  - id: a', '    name: A', `    link: "[[${link}]]"`, '```', ''].join('\n');
const CAL = '```kin-calendar\ncalendars: []\n```\n';
const PLAIN = 'Just text.\n';

/** A unit fake of the contract's FenceIndex: the test sets what it says. */
function stubFence(o: { complete?: boolean; kin?: string[]; cal?: string[]; unsure?: string[] } = {}) {
	const s = {
		complete: o.complete ?? false,
		kin: o.kin ?? [],
		cal: o.cal ?? [],
		unsureNotes: new Set(o.unsure ?? []),
		started: 0,
		disposed: 0,
		start: async () => void s.started++,
		dispose: () => void s.disposed++,
		has: (p: string, k: 'kin' | 'cal') => (k === 'kin' ? s.kin : s.cal).includes(p),
		notes: (k: 'kin' | 'cal') => [...(k === 'kin' ? s.kin : s.cal)].sort(),
		unsure: (): ReadonlySet<string> => s.unsureNotes,
		onChange: () => () => undefined,
	};
	return s;
}

const fileWith = (extra: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, settingsVersion: 1, ...extra });
const migrated = () => fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });

async function boot(o: Parameters<typeof bootPlugin>[0], run = 6000): Promise<Booted> {
	const b = await bootPlugin(o);
	b.app.layoutReady();
	await advance(run);
	return b;
}

const rename = (b: Booted, from: string, to: string) => {
	const f = b.app.move(from, to);
	b.app.app.vault.fire('rename', f, from);
};

describe('the fence index in main.ts (the index contract 1.5)', () => {
	const FILES = { 'Tree.md': KIN('Old'), 'Cal.md': CAL, 'Plain.md': PLAIN, 'More.md': PLAIN };

	it('starts when the layout is ready, not at load', async () => {
		const ls = migrated();
		const b = await bootPlugin({ files: FILES, stored: fileWith(), ls });
		expect(ls.calls.filter((c) => c.key === FENCE_KEY)).toEqual([]);
		b.app.layoutReady();
		await advance(6000);
		expect(ls.calls.some((c) => c.op === 'load' && c.key === FENCE_KEY)).toBe(true);
		expect(b.app.metaCount('changed')).toBeGreaterThan(0);
	});

	it('a plugin that loads after the cache resolved (no "resolved" event, every note has a cache entry) skips the notes with no block section', async () => {
		const b = await bootPlugin({ files: FILES, stored: fileWith(), ls: migrated() });
		const sections = (type: string) => ({ sections: [{ type }] });
		(b.app.app.metadataCache as unknown as { getFileCache: (f: { path: string }) => unknown }).getFileCache = (f) => sections(f.path === 'Tree.md' || f.path === 'Cal.md' ? 'code' : 'paragraph');
		b.app.layoutReady();
		await advance(6000);
		expect([...new Set(b.app.reads)].sort()).toEqual(['Cal.md', 'Tree.md']);
		expect((b.plugin as unknown as { dates: { notes(): string[] } }).dates.notes()).toEqual(['Cal.md']);
	});

	it('the same start with one note that has no cache entry is a cold pass: every note is read once', async () => {
		const b = await bootPlugin({ files: FILES, stored: fileWith(), ls: migrated() });
		(b.app.app.metadataCache as unknown as { getFileCache: (f: { path: string }) => unknown }).getFileCache = (f) => (f.path === 'More.md' ? null : { sections: [{ type: 'paragraph' }] });
		b.app.layoutReady();
		await advance(6000);
		expect([...new Set(b.app.reads)].sort()).toEqual(['Cal.md', 'More.md', 'Plain.md', 'Tree.md']);
	});

	it('the pass saves a store with the fence notes under the key of the contract', async () => {
		const ls = migrated();
		await boot({ files: FILES, stored: fileWith(), ls });
		const saved = ls.savesOf(FENCE_KEY);
		expect(saved.length).toBeGreaterThanOrEqual(1);
		const last = saved[saved.length - 1] as { v: number; n: number; f: Record<string, number> };
		expect(last.v).toBe(1);
		expect(last.f).toEqual({ 'Tree.md': 1, 'Cal.md': 2 });
		expect(last.n).toBe(4);
	});

	it('the calendar index lists the calendar notes of the fence index, and the plugin reads each note once', async () => {
		const ls = migrated();
		const b = await boot({ files: FILES, stored: fileWith(), ls });
		expect((b.plugin as unknown as { dates: { notes(): string[] } }).dates.notes()).toEqual(['Cal.md']);
		// D289: the plugin does not scan the vault for calendars; the one pass of the fence index is the only read.
		expect(b.app.reads.filter((p) => p === 'Cal.md')).toHaveLength(1);
		expect(b.app.reads.filter((p) => p === 'Tree.md').length).toBeLessThanOrEqual(1);
	});

	it('a calendar note that comes later (a "changed" event with the text) is in the list of the calendar index', async () => {
		const ls = migrated();
		const b = await boot({ files: FILES, stored: fileWith(), ls });
		const f = b.app.put('NewCal.md', CAL);
		b.app.metaFire('changed', f, CAL);
		await advance(1000);
		expect((b.plugin as unknown as { dates: { notes(): string[] } }).dates.notes()).toEqual(['Cal.md', 'NewCal.md']);
	});

	it('a restart with the saved store reads no note that has not changed', async () => {
		const ls = migrated();
		const first = await boot({ files: FILES, stored: fileWith(), ls });
		first.fake.unload();
		resetDom();
		const second = await boot({ files: FILES, stored: fileWith(), ls });
		expect(second.app.reads.length).toBeLessThanOrEqual(5);
		expect((second.plugin as unknown as { dates: { notes(): string[] } }).dates.notes()).toEqual(['Cal.md']);
	});

	it('the page hide saves the store at once, with a change that was not saved yet', async () => {
		const ls = migrated();
		const b = await boot({ files: FILES, stored: fileWith(), ls });
		const before = ls.savesOf(FENCE_KEY).length;
		const f = b.app.put('Late.md', KIN('Old'));
		b.app.metaFire('changed', f, KIN('Old'));
		await advance(500);
		// The wait of the save (10 s) has not passed.
		expect(ls.savesOf(FENCE_KEY).length).toBe(before);
		dispatchWindow('pagehide');
		await advance(250);
		const saved = ls.savesOf(FENCE_KEY);
		expect(saved.length).toBeGreaterThan(before);
		expect((saved[saved.length - 1] as { f: Record<string, number> }).f['Late.md']).toBe(1);
	});

	it('the unload stops the index: its events are taken away and the store is saved', async () => {
		const ls = migrated();
		const b = await boot({ files: FILES, stored: fileWith(), ls });
		const before = ls.savesOf(FENCE_KEY).length;
		const f = b.app.put('Late.md', KIN('Old'));
		b.app.metaFire('changed', f, KIN('Old'));
		b.fake.unload();
		const saved = ls.savesOf(FENCE_KEY);
		expect(saved.length).toBeGreaterThan(before);
		expect((saved[saved.length - 1] as { f: Record<string, number> }).f['Late.md']).toBe(1);
		expect(b.app.metaCount('changed')).toBe(0);
	});

	it('with a fence unit fake in its place, the plugin starts it at layout ready, once, and disposes it at unload', async () => {
		const fence = stubFence({ complete: true });
		const b = await bootPlugin({ files: FILES, stored: fileWith(), ls: migrated(), fence });
		expect(fence.started).toBe(0);
		b.app.layoutReady();
		await advance(500);
		expect(fence.started).toBe(1);
		b.fake.unload();
		expect(fence.disposed).toBeGreaterThanOrEqual(1);
	});

	it('the calendar index takes its list from fence.notes("cal")', async () => {
		const fence = stubFence({ complete: true, cal: ['Z/Cal.md', 'A.md'] });
		const b = await boot({ files: FILES, stored: fileWith(), ls: migrated(), fence }, 500);
		expect((b.plugin as unknown as { dates: { notes(): string[] } }).dates.notes()).toEqual(['A.md', 'Z/Cal.md']);
	});
});

describe('the rename scan gets the fence notes and the unsure notes (the index contract 2, gate finding M3)', () => {
	const NOTES = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`text/n${i}.md`, `A note about [[Old]] and kin ${i}.\n`]));
	const FILES = { 'Old.md': 'The old note.\n', 'T1.md': KIN('Old'), 'T2.md': KIN('Old'), 'U.md': KIN('Old'), ...NOTES(30) };

	it('a complete index with kin notes T1 and T2: only they are read; the other notes are not, and the unlisted tree is left', async () => {
		const fence = stubFence({ complete: true, kin: ['T1.md', 'T2.md'] });
		const b = await boot({ files: FILES, stored: fileWith(), ls: migrated(), fence }, 500);
		const before = b.app.reads.length;
		rename(b, 'Old.md', 'New.md');
		await advance(8000);
		const reads = b.app.reads.slice(before);
		expect([...new Set(reads)].sort()).toEqual(['T1.md', 'T2.md']);
		expect(b.app.texts.get('T1.md')).toContain('[[New]]');
		expect(b.app.texts.get('T2.md')).toContain('[[New]]');
		expect(b.app.texts.get('U.md')).toContain('[[Old]]');
	});

	it('M3: an unsure note is scanned after the index is complete', async () => {
		const fence = stubFence({ complete: true, kin: ['T1.md'], unsure: ['U.md'] });
		const b = await boot({ files: FILES, stored: fileWith(), ls: migrated(), fence }, 500);
		const before = b.app.reads.length;
		rename(b, 'Old.md', 'New.md');
		await advance(8000);
		expect([...new Set(b.app.reads.slice(before))].sort()).toEqual(['T1.md', 'U.md']);
		expect(b.app.texts.get('U.md')).toContain('[[New]]');
	});

	it('an index that is not complete gives the scan of today: notes with no cache entry are all read', async () => {
		const fence = stubFence({ complete: false, kin: ['T1.md'] });
		const b = await boot({ files: FILES, stored: fileWith(), ls: migrated(), fence }, 500);
		const before = b.app.reads.length;
		rename(b, 'Old.md', 'New.md');
		await advance(8000);
		const reads = new Set(b.app.reads.slice(before));
		expect(reads.has('T1.md') && reads.has('T2.md') && reads.has('U.md')).toBe(true);
		expect(reads.has('text/n0.md')).toBe(true);
		expect(b.app.texts.get('U.md')).toContain('[[New]]');
	});

	it('the set is made when the rename happens: the index that becomes complete is used from then on', async () => {
		const fence = stubFence({ complete: false });
		const b = await boot({ files: FILES, stored: fileWith(), ls: migrated(), fence }, 500);
		fence.complete = true;
		fence.kin = ['T2.md'];
		const before = b.app.reads.length;
		rename(b, 'Old.md', 'New.md');
		await advance(8000);
		expect([...new Set(b.app.reads.slice(before))].sort()).toEqual(['T2.md']);
	});

	it('the real index: a note that came with "create" and no "changed" (unsure) is scanned, and a plain note is not read', async () => {
		const b = await boot({ files: { 'Old.md': 'The old note.\n', 'T1.md': KIN('Old'), ...NOTES(10) }, stored: fileWith(), ls: migrated() }, 6000);
		const fence = (b.plugin as unknown as { fence: { complete: boolean; unsure(): ReadonlySet<string> } }).fence;
		expect(fence.complete).toBe(true);
		// A sync tool writes a note into the open vault: the vault says "create", and the metadata cache has not told yet.
		const u = b.app.put('U.md', KIN('Old'));
		b.app.app.vault.fire('create', u);
		expect(fence.unsure().has('U.md')).toBe(true);
		const before = b.app.reads.length;
		rename(b, 'Old.md', 'New.md');
		await advance(8000);
		const reads = new Set(b.app.reads.slice(before));
		expect(reads.has('T1.md')).toBe(true);
		expect(reads.has('U.md')).toBe(true);
		expect([...reads].some((p) => p.startsWith('text/'))).toBe(false);
		expect(b.app.texts.get('U.md')).toContain('[[New]]');
	});
});

describe('one list of the sections that can hold a block (the index contract 1.2, gate pass 2 item 1)', () => {
	const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

	it('rename-links.ts uses the constant of the fence index and keeps no list of its own', () => {
		const src = read('src/obsidian/rename-links.ts');
		expect(/const TREE_SECTIONS\s*=\s*new Set/.test(src)).toBe(false);
		expect(/from '\.\.\/view\/fence-index'/.test(src)).toBe(true);
	});

	it('calendar-vault.ts keeps no list of the sections either (the calendar vault no longer asks the cache)', () => {
		const src = read('src/obsidian/calendar-vault.ts');
		expect(/const BLOCK_SECTIONS\s*=\s*new Set/.test(src)).toBe(false);
	});
});
