import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { fakeLocalStorage } from '../support/fake-fence-vault';
import { PENDING_KEY_LOCAL, advance, bootPlugin, savedFiles, type Booted } from '../support/r04-wiring-app';
import { clock, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 probe of part 3: the pending renames per device (the index contract 3), three faults that the T0 tests do not reach. They drive the real plugin on the fake app of the wiring tests.
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
const TREE = ['```kin', 'people:', '  - id: a', '    name: A', '    link: "[[Old]]"', '```', ''].join('\n');
const FILES = { 'New.md': 'The renamed note.\n', 'Tree.md': TREE, 'Other.md': 'Text.\n' };
const fileWith = (pending: unknown, extra: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, settingsVersion: 1, pendingRenames: pending, ...extra });

async function boot(o: Parameters<typeof bootPlugin>[0], run = 4000): Promise<Booted> {
	const b = await bootPlugin(o);
	b.app.layoutReady();
	await advance(run);
	return b;
}

describe('G2 part 3: pending renames', () => {
	it('F1: a rename that waited in data.json because the local save failed is run at the next start, also when the store has the flag', async () => {
		// Device already migrated: the store has the flag and an empty list.
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: true, pendingRenames: [] } });
		const first = await boot({ files: { ...FILES, 'Old.md': 'The old note.\n' }, stored: fileWith([]), ls }, 6000);
		// The local storage is full now: the fallback writes the waiting rename into data.json (the index contract 3, "Failure").
		ls.failSave = (key) => key === PENDING_KEY_LOCAL;
		const f = first.app.move('Old.md', 'New2.md');
		first.app.app.vault.fire('rename', f, 'Old.md');
		// The file holds the rename while the update waits for Obsidian; the app ends before the update is done.
		await advance(500);
		first.fake.unload();
		const file = savedFiles(first).find((x) => Array.isArray(x.pendingRenames) && (x.pendingRenames as { oldPath: string }[]).some((e) => e.oldPath === 'Old.md'));
		expect(file).toBeDefined();
		// The next start: the storage works again, the vault has the renamed note.
		ls.failSave = false;
		resetDom();
		const second = await boot({ files: { ...FILES, 'New2.md': 'The old note.\n' }, stored: file, ls });
		await advance(8000);
		// The rename of the file is lost: the store (flag set, stale list) wins and the file list is ignored.
		expect(second.app.texts.get('Tree.md')).toContain('link: "[[New2]]"');
	});

	it('F1 control: the same file, but a store without the flag, runs the rename (so the loss in F1 is the ignored file list)', async () => {
		const ls = fakeLocalStorage();
		const entry = { oldPath: 'Old.md', newPath: 'New2.md', others: [] as string[] };
		const second = await boot({ files: { ...FILES, 'New2.md': 'The old note.\n' }, stored: fileWith([entry]), ls });
		await advance(8000);
		expect(second.app.texts.get('Tree.md')).toContain('link: "[[New2]]"');
	});

	it('F2: in the fallback, a list that was handled is not written back from the old file at each save', async () => {
		const ls = fakeLocalStorage();
		ls.failSave = true;
		// A 0.3.3 file with one waiting rename, and a local storage that cannot be written.
		const b = await boot({ files: FILES, stored: fileWith([E1]), ls });
		await advance(8000);
		expect(b.app.texts.get('Tree.md')).toContain('link: "[[New]]"');
		expect(b.plugin.links.pendingList()).toEqual([]);
		// Another save of the file (any setting): the handled rename must not come back.
		await b.plugin.changeSettings({ showDates: false });
		const last = savedFiles(b)[savedFiles(b).length - 1];
		expect(last.pendingRenames).toBeUndefined();
	});

	it('F3: a late migration does not queue a rename twice that is already running', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: false, pendingRenames: [] } });
		// The first read of data.json fails; the first save reads it again (a late migration).
		const b = await boot({ files: { ...FILES, 'Old.md': 'The old note.\n' }, stored: fileWith([]), ls, loadFails: 1 });
		const f = b.app.move('Old.md', 'New3.md');
		b.app.app.vault.fire('rename', f, 'Old.md');
		// The update has been queued ("open") but not run. A setting changes now: recoverStartupRead, then the late migration.
		await b.plugin.changeSettings({ showDates: false });
		const list = b.plugin.links.pendingList();
		const keys = list.map((p) => `${p.oldPath}>${p.newPath}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
