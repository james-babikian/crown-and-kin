import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { fakeLocalStorage, type FakeLocalStorage } from '../support/fake-fence-vault';
import { FENCE_KEY, PENDING_KEY_LOCAL, advance, bootPlugin, savedFiles, type Booted } from '../support/r04-wiring-app';
import { clock, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-3a, step T0, package W: `main.ts` and the pending renames per device (the index contract 3, test list 6). The list of renames that wait lives in the local storage of the vault, key
 * `crown-and-kin-pending-renames`, value `{ v: 1, migrated, pendingRenames }`. Until `migrated` is true, the list stays in `data.json`. The migration runs once, on the device that loads first: it
 * merges the list of the file into the store, sets the flag, SAVES THE STORE FIRST, and only if that worked clears the list in the file and writes the file one time. It also runs after
 * `recoverStartupRead` (a late migration), and then `links.resume()` runs again at once. A local save that throws sets the fallback: the list goes to `data.json` as in 0.3.3, and all saving of the fence
 * store stops. A device whose flag is set ignores `pendingRenames` in the file. These tests drive the real plugin on a fake app (tests/support/r04-wiring-app.ts).
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

const E1 = { oldPath: 'Old.md', newPath: 'New.md', others: [] as string[] };
const E2 = { oldPath: 'Gone.md', newPath: 'Here.md', others: ['x/Gone.md'] };
const TREE = ['```kin', 'people:', '  - id: a', '    name: A', '    link: "[[Old]]"', '```', ''].join('\n');
const FILES = { 'New.md': 'The renamed note.\n', 'Tree.md': TREE, 'Other.md': 'Text.\n' };

const fileWith = (pending: unknown, extra: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, settingsVersion: 1, pendingRenames: pending, ...extra });
const storeOf = (ls: FakeLocalStorage) => ls.data.get(PENDING_KEY_LOCAL) as { v: number; migrated: boolean; pendingRenames: unknown[] } | undefined;
const withoutKey = (o: Record<string, unknown>) => !('pendingRenames' in o);
const sortedByOld = (xs: unknown[]) => [...(xs as { oldPath: string }[])].sort((a, b) => a.oldPath.localeCompare(b.oldPath));

/** Boots, fires layout ready and lets the plugin run. */
async function boot(o: Parameters<typeof bootPlugin>[0], run = 4000): Promise<Booted> {
	const b = await bootPlugin(o);
	b.app.layoutReady();
	await advance(run);
	return b;
}

describe('the migration of pendingRenames from data.json to the local storage (the index contract 3)', () => {
	it('moves the list once: the store is saved first with the flag set, then data.json is cleaned with one write', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([E1, E2]), ls });
		const first = ls.savesOf(PENDING_KEY_LOCAL)[0] as { v: number; migrated: boolean; pendingRenames: unknown[] };
		expect(first).toMatchObject({ v: 1, migrated: true });
		expect(sortedByOld(first.pendingRenames)).toEqual(sortedByOld([E1, E2]));
		// The file is written once, after the store; it keeps the settings and loses the list.
		expect(b.log.indexOf(`local:${PENDING_KEY_LOCAL}`)).toBeGreaterThanOrEqual(0);
		expect(b.log.indexOf(`local:${PENDING_KEY_LOCAL}`)).toBeLessThan(b.log.indexOf('data'));
		expect(b.log.filter((x) => x === 'data')).toHaveLength(1);
		expect(savedFiles(b)).toHaveLength(1);
		expect(withoutKey(savedFiles(b)[0])).toBe(true);
		expect(savedFiles(b)[0]).toMatchObject({ settingsVersion: 1, showDates: true });
		// The updater got the merged list.
		const restored = b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0);
		expect(sortedByOld(restored ?? [])).toEqual(sortedByOld([E1, E2]));
		expect(b.resume).toHaveBeenCalled();
	});

	it('an entry runs only if its new path exists on this device; the others are dropped when they run', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([E1, E2]), ls });
		await advance(8000);
		// E1 ran (New.md exists, Tree.md named Old); E2 had no note to run for.
		expect(b.app.texts.get('Tree.md')).toContain('link: "[[New]]"');
		expect(b.plugin.links.pendingList()).toEqual([]);
		expect(storeOf(ls)?.pendingRenames).toEqual([]);
	});

	it('a start with the flag set and no list in the file uses the store and does not write data.json', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [E1] } });
		const b = await boot({ files: FILES, stored: fileWith([]), ls });
		const restored = b.restore.mock.calls.map((c) => c[0] as unknown[]).flat();
		expect(restored).toEqual([E1]);
		expect(savedFiles(b)).toHaveLength(0);
	});

	it('with the flag set, a list in the file (the fallback wrote it after a failed local save) is merged into the store, with no entry twice, and then the file is cleaned (G2 part 3, item 1)', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [E1] } });
		const b = await bootPlugin({ files: FILES, stored: fileWith([E1, E2]), ls });
		await advance(10);
		const first = ls.savesOf(PENDING_KEY_LOCAL)[0] as { migrated: boolean; pendingRenames: unknown[] };
		expect(first.migrated).toBe(true);
		expect(sortedByOld(first.pendingRenames)).toEqual(sortedByOld([E1, E2]));
		expect(b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0)).toHaveLength(2);
		// The store is saved before the file is cleaned; the cleaned file has no list.
		expect(b.log.indexOf(`local:${PENDING_KEY_LOCAL}`)).toBeLessThan(b.log.indexOf('data'));
		expect(savedFiles(b)).toHaveLength(1);
		expect(withoutKey(savedFiles(b)[0])).toBe(true);
	});

	it('with the flag set, the file is not cleaned when the store save fails; the list still runs from memory (G2 part 3, item 1)', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });
		ls.failSave = true;
		const b = await bootPlugin({ files: FILES, stored: fileWith([E1]), ls });
		expect(b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0)).toEqual([E1]);
		expect(savedFiles(b)).toHaveLength(0);
		await b.plugin.changeSettings({ showDates: false });
		expect(savedFiles(b)[0].pendingRenames).toEqual([E1]);
	});

	it('with the flag set, the next save of the file drops the key that a 0.3.3 device wrote', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });
		const b = await boot({ files: FILES, stored: fileWith([E2]), ls });
		await b.plugin.changeSettings({ showDates: false });
		const last = savedFiles(b)[savedFiles(b).length - 1];
		expect(last).toMatchObject({ showDates: false });
		expect(withoutKey(last)).toBe(true);
	});

	it('merges the list of the file into a store that has no flag yet, with no entry twice', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: false, pendingRenames: [E1] } });
		const b = await boot({ files: FILES, stored: fileWith([E1, E2]), ls });
		const first = ls.savesOf(PENDING_KEY_LOCAL)[0] as { migrated: boolean; pendingRenames: { oldPath: string }[] };
		expect(first.migrated).toBe(true);
		expect(sortedByOld(first.pendingRenames)).toEqual(sortedByOld([E1, E2]));
		expect(b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0)).toHaveLength(2);
	});

	it('drops invalid entries in the file and migrates the valid ones', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([null, 'x', { oldPath: '' }, { oldPath: 'a.md' }, E1]), ls });
		const first = ls.savesOf(PENDING_KEY_LOCAL)[0] as { pendingRenames: unknown[] };
		expect(first.pendingRenames).toEqual([E1]);
		expect(b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0)).toEqual([E1]);
	});

	it('a file without pendingRenames still sets the flag, so that the device is a 0.4 device', async () => {
		const ls = fakeLocalStorage();
		await boot({ files: FILES, stored: { ...DEFAULT_SETTINGS, settingsVersion: 1 }, ls });
		const stored = storeOf(ls);
		// Either the store is written with the flag and an empty list, or it is not written until a rename; the list must be empty.
		expect(stored === undefined || (stored.migrated === true && stored.pendingRenames.length === 0)).toBe(true);
	});

	it('a read of data.json that fails: no migration, the flag is not set, and nothing is written', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([E1]), ls, loadFails: 'always' });
		expect(storeOf(ls)?.migrated ?? false).toBe(false);
		expect(savedFiles(b)).toHaveLength(0);
		expect(b.plugin.links.pendingList()).toEqual([]);
	});

	it('the store save fails: the file is not cleaned, the list goes on from data.json, and the fallback is set', async () => {
		const ls = fakeLocalStorage();
		ls.failSave = true;
		// The layout is not ready: the updater holds the list and has not run it.
		const b = await bootPlugin({ files: FILES, stored: fileWith([E1, E2]), ls });
		// Whatever is written to the file in this session keeps the list (the migration did not happen).
		await b.plugin.changeSettings({ showDates: false });
		const last = savedFiles(b)[savedFiles(b).length - 1];
		expect(last).toMatchObject({ showDates: false });
		expect(last.pendingRenames).toBeDefined();
		expect(sortedByOld(last.pendingRenames as unknown[])).toEqual(sortedByOld([E1, E2]));
		expect(storeOf(ls)).toBeUndefined();
	});
});

describe('a late migration after recoverStartupRead (the index contract 3, gate pass 2 item 5)', () => {
	it('the first read of the file fails; the first save reads it again, migrates, and resumes the updater at once', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([E1, E2]), ls, loadFails: 1 });
		// At load nothing could be migrated.
		expect(storeOf(ls)?.migrated ?? false).toBe(false);
		const resumedAtLayout = b.resume.mock.calls.length;
		expect(resumedAtLayout).toBeGreaterThanOrEqual(1);
		await b.plugin.changeSettings({ showDates: false });
		await advance(1000);
		const stored = storeOf(ls);
		expect(stored?.migrated).toBe(true);
		const restored = b.restore.mock.calls.map((c) => c[0] as unknown[]).find((l) => l.length > 0);
		expect(sortedByOld(restored ?? [])).toEqual(sortedByOld([E1, E2]));
		// A late migration resumes at once; it does not wait for the next start.
		expect(b.resume.mock.calls.length).toBeGreaterThan(resumedAtLayout);
		// The file that this save wrote has the settings and not the list.
		const last = savedFiles(b)[savedFiles(b).length - 1];
		expect(last).toMatchObject({ showDates: false });
		expect(withoutKey(last)).toBe(true);
		await advance(8000);
		expect(b.app.texts.get('Tree.md')).toContain('link: "[[New]]"');
	});

	it('before the migration the key stays in data.json through recoverStartupRead: a save with the store blocked still writes the list', async () => {
		const ls = fakeLocalStorage();
		ls.failSave = true;
		const b = await boot({ files: FILES, stored: fileWith([E1]), ls, loadFails: 1 });
		await b.plugin.changeSettings({ showDates: false });
		const last = savedFiles(b)[savedFiles(b).length - 1];
		expect(last.pendingRenames).toEqual([E1]);
		expect(last).toMatchObject({ showDates: false });
	});

	it('the migration happens once: a second save does not migrate again', async () => {
		const ls = fakeLocalStorage();
		const b = await boot({ files: FILES, stored: fileWith([E1]), ls, loadFails: 1 });
		await b.plugin.changeSettings({ showDates: false });
		await advance(1000);
		const stores = ls.savesOf(PENDING_KEY_LOCAL).length;
		const restores = b.restore.mock.calls.length;
		await b.plugin.changeSettings({ showDates: true });
		await advance(1000);
		expect(b.restore.mock.calls.length).toBe(restores);
		expect(ls.savesOf(PENDING_KEY_LOCAL).length).toBe(stores);
	});
});

describe('renames after the migration, and the fallback (the index contract 3, "Failure")', () => {
	const rename = (b: Booted, from: string, to: string) => {
		const f = b.app.move(from, to);
		b.app.app.vault.fire('rename', f, from);
	};

	it('a rename writes the local store and never data.json', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });
		const b = await boot({ files: { ...FILES, 'Old.md': 'The old note.\n' }, stored: fileWith([]), ls });
		const files = savedFiles(b).length;
		rename(b, 'Old.md', 'New2.md');
		await advance(8000);
		const lists = ls.savesOf(PENDING_KEY_LOCAL).map((v) => (v as { pendingRenames: { oldPath: string }[] }).pendingRenames);
		expect(lists.some((l) => l.some((e) => e.oldPath === 'Old.md'))).toBe(true);
		// When the update ends, the list is empty again.
		expect(lists[lists.length - 1]).toEqual([]);
		expect(savedFiles(b).length).toBe(files);
	});

	it('a local save that throws: the list is written to data.json as in 0.3.3, once is logged, and the fence store is not saved again in this session', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });
		const b = await boot({ files: { ...FILES, 'Old.md': 'The old note.\n' }, stored: fileWith([]), ls }, 6000);
		const fenceSaves = ls.savesOf(FENCE_KEY).length;
		ls.failSave = (key) => key === PENDING_KEY_LOCAL;
		rename(b, 'Old.md', 'New2.md');
		await advance(8000);
		const withList = savedFiles(b).filter((f) => Array.isArray(f.pendingRenames) && (f.pendingRenames as { oldPath: string }[]).some((e) => e.oldPath === 'Old.md'));
		expect(withList.length).toBeGreaterThanOrEqual(1);
		expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThanOrEqual(1);
		// The fence store is still able to save, but the plugin stopped it: a new fence note is not saved, not at the page hide either.
		const f = b.app.put('Fence.md', TREE);
		b.app.metaFire('changed', f, TREE);
		await advance(30_000, 2000);
		expect(ls.savesOf(FENCE_KEY).length).toBe(fenceSaves);
	});

	it('the fallback is for the session only: the next start with a working storage migrates again from the file', async () => {
		const ls = fakeLocalStorage();
		ls.failSave = (key) => key === PENDING_KEY_LOCAL;
		const first = await boot({ files: FILES, stored: fileWith([E1]), ls });
		expect(storeOf(ls)).toBeUndefined();
		first.fake.unload();
		ls.failSave = false;
		resetDom();
		const second = await boot({ files: FILES, stored: fileWith([E1]), ls });
		expect(storeOf(ls)?.migrated).toBe(true);
		expect(withoutKey(savedFiles(second)[0])).toBe(true);
	});
});
