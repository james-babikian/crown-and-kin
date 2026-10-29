/*
 * The renames that wait for a link update, kept per device. They used to live in
 * `data.json`, which a sync tool copies to every device, so one device could run the update of another.
 * Now they live in the local storage of the vault (never synced). Until `migrated` is true the list also
 * stays in `data.json`, so an older device or a failed read cannot lose it. This file only reads, checks
 * and writes the stored value; `main.ts` decides when (migration, fallback).
 */

import { readPending, type PendingRename } from '../view/settings';

export { readPending };

/** The key in the local storage of the vault. Obsidian adds the vault name, so the store is per vault and per device. */
export const PENDING_STORE_KEY = 'crown-and-kin-pending-renames';

/** The stored value. `migrated` is true once the list of `data.json` has moved here. */
export interface PendingStoreValue {
	v: 1;
	migrated: boolean;
	pendingRenames: PendingRename[];
}

/** The part of `App` the store needs (a fake in tests). */
export interface LocalStorageApp {
	loadLocalStorage(key: string): unknown;
	saveLocalStorage(key: string, value: unknown): void;
}

/** A fresh store: nothing stored, nothing migrated. */
export const emptyPendingStore = (): PendingStoreValue => ({ v: 1, migrated: false, pendingRenames: [] });

/** Checks a stored value. Null if it is not a store of this version: it is then ignored and the next save overwrites it. Pure. */
export function readPendingStore(value: unknown): PendingStoreValue | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const r = value as Record<string, unknown>;
	if (r.v !== 1 || typeof r.migrated !== 'boolean') return null;
	return { v: 1, migrated: r.migrated, pendingRenames: readPending(r) };
}

/** What a load found: the store (a fresh one if none or broken) and whether the storage could be read at all. */
export interface PendingLoad {
	value: PendingStoreValue;
	/** False when the local storage threw: nothing is known, so no migration may run. */
	readable: boolean;
}

/** Reads the store. A throw (blocked storage) gives a fresh store and `readable: false`. */
export function loadPendingStore(app: LocalStorageApp): PendingLoad {
	try {
		return { value: readPendingStore(app.loadLocalStorage(PENDING_STORE_KEY)) ?? emptyPendingStore(), readable: true };
	} catch {
		return { value: emptyPendingStore(), readable: false };
	}
}

/** Writes the store at once. It throws when the storage is full or blocked: the caller falls back to `data.json`. */
export function savePendingStore(app: LocalStorageApp, value: PendingStoreValue): void {
	app.saveLocalStorage(PENDING_STORE_KEY, { v: 1, migrated: value.migrated, pendingRenames: value.pendingRenames.map((p) => ({ ...p, others: [...p.others] })) });
}

/** The two lists as one, with no duplicate of `oldPath` and `newPath`. The first list keeps its order. Pure. */
export function mergePending(first: readonly PendingRename[], second: readonly PendingRename[]): PendingRename[] {
	const seen = new Set<string>();
	const out: PendingRename[] = [];
	for (const p of [...first, ...second]) {
		const key = `${p.oldPath}\u0000${p.newPath}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ ...p, others: [...p.others] });
	}
	return out;
}
