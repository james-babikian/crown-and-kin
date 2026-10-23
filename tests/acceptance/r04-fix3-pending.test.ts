import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { fakeLocalStorage } from '../support/fake-fence-vault';
import { PENDING_KEY_LOCAL, bootPlugin, savedFiles } from '../support/r04-wiring-app';
import { clock, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Fix round of part 3 (D282), item 6 and item 2: the late migration merges the list that the updater has not queued yet (`stored`) with the store and the file, never the entries that run
 * or wait in its queue; the store still keeps every entry that waits.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const S = { oldPath: 'Store.md', newPath: 'StoreNew.md', others: [] as string[] };
const F = { oldPath: 'File.md', newPath: 'FileNew.md', others: [] as string[] };
const fileWith = (pending: unknown) => ({ ...DEFAULT_SETTINGS, settingsVersion: 1, pendingRenames: pending });
const keys = (xs: { oldPath: string; newPath: string }[]) => xs.map((p) => `${p.oldPath}>${p.newPath}`).sort();

describe('a late migration (D282 item 6)', () => {
	it('merges the store list, the updater stored list and the list of the file; a running rename is not queued again but stays in the store', async () => {
		const ls = fakeLocalStorage({ [PENDING_KEY_LOCAL]: { v: 1, migrated: false, pendingRenames: [S] } });
		const b = await bootPlugin({ files: { 'Old.md': 'Old.\n', 'Tree.md': 'Text.\n' }, stored: fileWith([F]), ls, loadFails: 1 });
		// The first read failed: the updater holds the list of the store only.
		expect(keys(b.plugin.links.storedList())).toEqual(keys([S]));
		const f = b.app.move('Old.md', 'New3.md');
		b.app.app.vault.fire('rename', f, 'Old.md');
		expect(b.plugin.links.openList()).toHaveLength(1);
		await b.plugin.changeSettings({ showDates: false });
		// The updater got the store list and the file list, and not the running rename (resume() then queued them and dropped those with no note).
		const restored = b.restore.mock.calls.map((c) => c[0] as { oldPath: string; newPath: string }[]);
		expect(keys(restored[restored.length - 1])).toEqual(keys([S, F]));
		const open = keys(b.plugin.links.openList());
		expect(open).toEqual(['Old.md>New3.md']);
		expect(keys(b.plugin.links.pendingList())).toEqual(open);
		// The save of the migration kept every entry that waits, the running one too; the later saves (after resume dropped the entries with no note) hold the running one.
		type Saved = { migrated: boolean; pendingRenames: { oldPath: string; newPath: string }[] };
		const saves = ls.savesOf(PENDING_KEY_LOCAL) as Saved[];
		const migration = saves.find((v) => v.migrated);
		expect(keys(migration?.pendingRenames ?? [])).toEqual(keys([S, F, { oldPath: 'Old.md', newPath: 'New3.md' }]));
		expect((ls.data.get(PENDING_KEY_LOCAL) as Saved).migrated).toBe(true);
		// The file is clean.
		expect('pendingRenames' in savedFiles(b)[savedFiles(b).length - 1]).toBe(false);
	});
});
