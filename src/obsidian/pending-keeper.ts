/*
 * The keeper of the renames that wait for a link update, on this device (0.4, the index contract 3). It sits between `main.ts` and the pending store: it loads the store at start, moves the list
 * of `data.json` into the store once (the migration), writes the store at each change of the list, and, if the local storage fails, switches to the fallback of 0.3.3 (the list goes to
 * `data.json` again). `main.ts` decides when each step runs and owns `data.json`; this file owns the rules of the store.
 */

import { PENDING_KEY, readPending, type PendingRename } from '../view/settings';
import { emptyPendingStore, loadPendingStore, mergePending, savePendingStore, type LocalStorageApp, type PendingStoreValue } from './pending-store';

/** What `settle` tells `main.ts`. */
export interface PendingSettle {
	/** The list the updater must hold now. */
	list: PendingRename[];
	/** The flag is set: `data.json` no longer holds the list (the caller clears its copy). */
	migrated: boolean;
	/** The file had a `pendingRenames` key that the migration moved: one write of the file lets the cleaned copy sync. */
	cleanFile: boolean;
}

const pendingKey = (p: PendingRename): string => `${p.oldPath}\u0000${p.newPath}`;

/** Keeps the pending store of this device. */
export class PendingKeeper {
	private value: PendingStoreValue = emptyPendingStore();
	private failed = false;

	constructor(private readonly app: LocalStorageApp) {}

	/** True after a local save or load threw: the list lives in `data.json` for the rest of the session, and the fence store does not save. */
	get fallback(): boolean {
		return this.failed;
	}

	/** True when the flag of the store is set: `data.json` is not the home of the list on this device. */
	get migrated(): boolean {
		return this.value.migrated;
	}

	/** Reads the store. A blocked storage is the fallback from the start. */
	load(): void {
		const r = loadPendingStore(this.app);
		this.value = r.value;
		if (!r.readable) this.fall(new Error('the local storage cannot be read'));
	}

	/**
	 * Writes the list to the store. Returns false when the caller must write `data.json` instead (the fallback). A throw sets the fallback: it is logged one time and never tried again.
	 */
	save(list: PendingRename[]): boolean {
		if (this.failed) return false;
		try {
			const next: PendingStoreValue = { v: 1, migrated: this.value.migrated, pendingRenames: list };
			savePendingStore(this.app, next);
			this.value = next;
			return true;
		} catch (e) {
			this.fall(e);
			return false;
		}
	}

	/**
	 * The start (`late` false) and a late read of `data.json` (`late` true, after `recoverStartupRead`). `raw` is the stored file, `fileOk` says it was read. `stored` is the list that the updater has not
	 * queued yet, `open` the renames that run or wait in its queue (a late migration never merges these into `stored`, or a rename would run twice).
	 * A flagged device merges a list that the file holds too (the fallback wrote it after a failed save). Null: nothing changes. The store is saved before the caller cleans the file, and only a store that
	 * was saved counts as migrated.
	 */
	settle(raw: unknown, fileOk: boolean, stored: PendingRename[], open: PendingRename[], late: boolean): PendingSettle | null {
		const v = this.value;
		// A failed read of the file: no migration and no flag. The list of the store, if any, runs.
		if (!fileOk) return late ? null : { list: v.pendingRenames, migrated: v.migrated, cleanFile: false };
		const fromFile = readPending(raw);
		if (v.migrated && !fromFile.length) return late ? null : { list: v.pendingRenames, migrated: true, cleanFile: false };
		const running = new Set(open.map(pendingKey));
		const merged = mergePending(late ? stored : v.pendingRenames, fromFile).filter((p) => !running.has(pendingKey(p)));
		const hadKey = raw !== null && typeof raw === 'object' && PENDING_KEY in raw;
		if (this.failed) return { list: merged, migrated: v.migrated, cleanFile: false };
		// The store keeps every rename that waits, the open ones too.
		const next: PendingStoreValue = { v: 1, migrated: true, pendingRenames: mergePending(merged, open) };
		try {
			savePendingStore(this.app, next);
		} catch (e) {
			this.fall(e);
			return { list: merged, migrated: v.migrated, cleanFile: false };
		}
		this.value = next;
		return { list: merged, migrated: true, cleanFile: hadKey };
	}

	private fall(e: unknown): void {
		if (this.failed) return;
		this.failed = true;
		console.error('Crown and Kin: cannot keep the renames that wait in the local storage. They stay in the settings file.', e);
	}
}
