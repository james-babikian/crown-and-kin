import { describe, expect, it } from 'vitest';
import { PENDING_STORE_KEY, emptyPendingStore, loadPendingStore, mergePending, readPendingStore, savePendingStore, type LocalStorageApp } from '../../src/obsidian/pending-store';
import type { PendingRename } from '../../src/view/settings';

// The functions of src/obsidian/pending-store.ts that the acceptance tests of package P (readPending) do not reach.

const a: PendingRename = { oldPath: 'A.md', newPath: 'B.md', others: ['x/A.md'] };
const b: PendingRename = { oldPath: 'C.md', newPath: 'D.md', others: [] };

function storage(initial?: unknown) {
	const data = new Map<string, unknown>(initial === undefined ? [] : [[PENDING_STORE_KEY, initial]]);
	const app: LocalStorageApp & { failLoad?: boolean; failSave?: boolean } = {
		loadLocalStorage(key) {
			if (app.failLoad) throw new Error('blocked');
			return data.get(key) ?? null;
		},
		saveLocalStorage(key, value) {
			if (app.failSave) throw new Error('full');
			data.set(key, value);
		},
	};
	return { app, data };
}

describe('readPendingStore', () => {
	it('reads the store of version 1 and drops bad entries', () => {
		expect(readPendingStore({ v: 1, migrated: true, pendingRenames: [a, { oldPath: '' }, b] })).toEqual({ v: 1, migrated: true, pendingRenames: [a, b] });
	});

	it('gives null for anything else: another version, no flag, not an object', () => {
		for (const raw of [null, undefined, 0, 'x', [], { v: 2, migrated: true, pendingRenames: [] }, { v: 1, pendingRenames: [a] }, { v: 1, migrated: 'yes', pendingRenames: [] }, { migrated: true }]) expect(readPendingStore(raw)).toBeNull();
	});
});

describe('loadPendingStore and savePendingStore', () => {
	it('a missing or broken store loads as a fresh one and is readable', () => {
		expect(loadPendingStore(storage().app)).toEqual({ value: emptyPendingStore(), readable: true });
		expect(loadPendingStore(storage({ v: 9 }).app)).toEqual({ value: emptyPendingStore(), readable: true });
		expect(emptyPendingStore().migrated).toBe(false);
	});

	it('a throw while reading gives a fresh store that is marked not readable, so no migration runs', () => {
		const s = storage({ v: 1, migrated: true, pendingRenames: [a] });
		s.app.failLoad = true;
		expect(loadPendingStore(s.app)).toEqual({ value: emptyPendingStore(), readable: false });
	});

	it('a save is read back, writes a copy, and throws when the storage throws', () => {
		const s = storage();
		const value = { v: 1 as const, migrated: true, pendingRenames: [{ ...a, others: [...a.others] }] };
		savePendingStore(s.app, value);
		value.pendingRenames[0].others.push('changed');
		expect(loadPendingStore(s.app).value).toEqual({ v: 1, migrated: true, pendingRenames: [a] });
		s.app.failSave = true;
		expect(() => savePendingStore(s.app, value)).toThrow();
	});
});

describe('mergePending', () => {
	it('keeps one entry for the same old and new path, and the order of the first list', () => {
		expect(mergePending([a], [b, { ...a, others: [] }])).toEqual([a, b]);
		expect(mergePending([], [])).toEqual([]);
	});

	it('does not join entries that differ in one path', () => {
		expect(mergePending([a], [{ ...a, newPath: 'Z.md' }])).toHaveLength(2);
	});

	it('returns copies', () => {
		const from = { ...a, others: [...a.others] };
		const out = mergePending([from], []);
		out[0].others.push('z');
		expect(from.others).toEqual(['x/A.md']);
	});
});
