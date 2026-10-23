import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, NO_EXTRAS, PENDING_KEY, buildStoredData, normaliseSettings, readStoredSettings, type PendingRename } from '../../src/view/settings';

/*
 * 0.4 WP-3a, step T0, package P: the pending renames per device (the index contract 3, test list 7.6): the validation of the list in `src/obsidian/pending-store.ts`, and what
 * `view/settings.ts` keeps and writes of `pendingRenames` before the migration to the local storage has happened.
 * The contract fixes: the key `crown-and-kin-pending-renames`, the value `{ v: 1, migrated: boolean, pendingRenames: PendingRename[] }`, `readPending(value)` that validates the list,
 * `StoredExtras.pending` (the raw `pendingRenames` of the file), and `buildStoredData(settings, extras, pending)` with the same signature: the `pending` argument wins when it is not empty,
 * else `extras.pending` is written. The migration itself and the fallback (they need `main.ts`) are in r04-wiring-pending.test.ts.
 * Written from the contract, before the code exists: the builder of package P removes the `.skip` below. These tests are expected to fail until package P is built.
 */

interface PendingStoreModule {
	readPending(value: unknown): PendingRename[];
}
const PENDING_STORE_PATH = '../../src/obsidian/pending-store';
const loadPendingStore = (): Promise<PendingStoreModule> => import(/* @vite-ignore */ PENDING_STORE_PATH) as Promise<PendingStoreModule>;

const entry: PendingRename = { oldPath: 'Old.md', newPath: 'New.md', others: ['y/Old.md'] };
const other: PendingRename = { oldPath: 'Keep.md', newPath: 'Hall.md', others: [] };

describe('readPending of the pending store (the index contract 3)', () => {
	it('keeps good entries, from the shape of the store and from the shape of data.json', async () => {
		const { readPending } = await loadPendingStore();
		expect(readPending({ v: 1, migrated: false, pendingRenames: [entry, other] })).toEqual([entry, other]);
		expect(readPending({ ...DEFAULT_SETTINGS, [PENDING_KEY]: [entry] })).toEqual([entry]);
	});

	it('gives others: [] to an entry that has none, and keeps only the good paths of others', async () => {
		const { readPending } = await loadPendingStore();
		expect(readPending({ pendingRenames: [{ oldPath: 'a.md', newPath: 'b.md' }] })).toEqual([{ oldPath: 'a.md', newPath: 'b.md', others: [] }]);
		expect(readPending({ pendingRenames: [{ oldPath: 'a.md', newPath: 'b.md', others: ['x.md', 3, '', null] }] })).toEqual([{ oldPath: 'a.md', newPath: 'b.md', others: ['x.md'] }]);
		expect(readPending({ pendingRenames: [{ oldPath: 'a.md', newPath: 'b.md', others: 'x.md' }] })).toEqual([{ oldPath: 'a.md', newPath: 'b.md', others: [] }]);
	});

	it('drops every invalid entry and keeps the valid ones around it', async () => {
		const { readPending } = await loadPendingStore();
		const bad = [null, 'x', 5, [], {}, { oldPath: 'a.md' }, { newPath: 'b.md' }, { oldPath: '', newPath: 'b.md' }, { oldPath: 'a.md', newPath: '' }, { oldPath: 1, newPath: 'b.md' }, { oldPath: 'a.md', newPath: ['b.md'] }];
		expect(readPending({ pendingRenames: [...bad, entry, ...bad, other] })).toEqual([entry, other]);
	});

	it('gives an empty list for a value that is not a store, has no list, or has a list that is not a list', async () => {
		const { readPending } = await loadPendingStore();
		for (const raw of [null, undefined, 0, 'x', [], true, DEFAULT_SETTINGS, { v: 1 }, { pendingRenames: {} }, { pendingRenames: 'a' }, { pendingRenames: null }]) expect(readPending(raw)).toEqual([]);
	});

	it('returns copies: a change of the result does not change the value it came from', async () => {
		const { readPending } = await loadPendingStore();
		const value = { pendingRenames: [{ oldPath: 'a.md', newPath: 'b.md', others: ['x.md'] }] };
		const out = readPending(value);
		out[0].others.push('z.md');
		out[0].newPath = 'changed.md';
		expect(value.pendingRenames[0]).toEqual({ oldPath: 'a.md', newPath: 'b.md', others: ['x.md'] });
	});
});

describe('before the migration, data.json keeps pendingRenames (the index contract 3, "Until migrated is true")', () => {
	const file = (extra: Record<string, unknown> = {}) => ({ ...DEFAULT_SETTINGS, settingsVersion: 1, [PENDING_KEY]: [entry, other], ...extra });
	type Extras = ReturnType<typeof readStoredSettings>['extras'] & { pending?: unknown };

	it('readStoredSettings keeps the raw pendingRenames of the file in extras.pending, and not as an unknown key', () => {
		const { extras } = readStoredSettings(file());
		expect((extras as Extras).pending).toEqual([entry, other]);
		expect(PENDING_KEY in extras.unknown).toBe(false);
	});

	it('a save with no list of its own writes extras.pending back, so a save before the migration cannot wipe the list', () => {
		const { settings, extras } = readStoredSettings(file());
		expect(buildStoredData(settings, extras, [])[PENDING_KEY]).toEqual([entry, other]);
	});

	it('a save after recoverStartupRead applies the data does the same (the settings are applied again, the list stays)', () => {
		// recoverStartupRead reads the file a second time and applies it: the extras are made again from the file.
		const first = readStoredSettings(null);
		expect(buildStoredData(first.settings, first.extras, [])[PENDING_KEY]).toBeUndefined();
		const second = readStoredSettings(file());
		expect(buildStoredData(second.settings, second.extras, [])[PENDING_KEY]).toEqual([entry, other]);
	});

	it('the list that the updater holds wins when it is not empty', () => {
		const { settings, extras } = readStoredSettings(file());
		const fresh: PendingRename = { oldPath: 'A.md', newPath: 'B.md', others: [] };
		expect(buildStoredData(settings, extras, [fresh])[PENDING_KEY]).toEqual([fresh]);
	});

	it('after the migration the extras are cleared and the key is gone from the file', () => {
		const { settings, extras } = readStoredSettings(file());
		const cleared = { ...extras, pending: [] } as typeof extras;
		const written = buildStoredData(settings, cleared, []);
		expect(PENDING_KEY in written).toBe(false);
	});

	it('with no list anywhere the file keeps the shape of earlier versions: no pendingRenames key', () => {
		const { settings, extras } = readStoredSettings({ ...DEFAULT_SETTINGS, settingsVersion: 1 });
		const written = buildStoredData(settings, extras, []);
		expect(PENDING_KEY in written).toBe(false);
		expect(Object.keys(written).sort()).toEqual([...Object.keys(DEFAULT_SETTINGS), 'settingsVersion'].sort());
		expect(PENDING_KEY in buildStoredData(DEFAULT_SETTINGS, NO_EXTRAS, [])).toBe(false);
	});

	it('the signature of buildStoredData does not change: settings, extras, pending', () => {
		expect(buildStoredData.length).toBe(3);
	});

	it('the settings do not take pendingRenames in, and the key stays "pendingRenames"', () => {
		expect(PENDING_KEY).toBe('pendingRenames');
		expect(normaliseSettings({ ...DEFAULT_SETTINGS, [PENDING_KEY]: [entry] })).toEqual(DEFAULT_SETTINGS);
	});

	it('invalid entries in the file do not stop the settings from loading', () => {
		const { settings, extras } = readStoredSettings(file({ [PENDING_KEY]: [null, 'x', entry, { oldPath: '' }] }));
		expect(settings).toEqual(DEFAULT_SETTINGS);
		// What is written back is a list of the entries that are valid, or the raw list; either way the valid entry is in it.
		const back = buildStoredData(settings, extras, [])[PENDING_KEY] as unknown[];
		expect(back).toContainEqual(entry);
	});
});
