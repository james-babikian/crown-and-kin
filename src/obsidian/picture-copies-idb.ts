/*
 * The real storage of the picture copies (spec §0 D318): one IndexedDB database in Obsidian's private storage on this device. It is not
 * in the vault, not in `data.json`, and Obsidian Sync does not copy it. `picture-copies.ts` holds the rules; this file only gives it a
 * key-value store.
 */

import type { App } from 'obsidian';
import { NO_COPIES, createPictureCopies, type CopyBackend, type PictureCopies } from './picture-copies';

/** The database name starts with the plugin id. */
export const COPIES_DB_NAME = 'crown-and-kin-picture-copies';
const STORE = 'copies';

function backendOf(db: IDBDatabase): CopyBackend {
	// Another window that upgrades the database must not wait for this one.
	db.onversionchange = () => db.close();
	return {
		get: (key) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE, 'readonly');
				const req = tx.objectStore(STORE).get(key);
				req.onsuccess = () => resolve(req.result as unknown);
				req.onerror = () => reject(req.error ?? new Error('the picture copies could not be read'));
				tx.onabort = () => reject(tx.error ?? new Error('the read was stopped'));
			}),
		keys: () =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE, 'readonly');
				const req = tx.objectStore(STORE).getAllKeys();
				req.onsuccess = () => resolve(req.result.filter((k): k is string => typeof k === 'string'));
				tx.onabort = () => reject(tx.error ?? new Error('the list was stopped'));
			}),
		write: (puts, dels) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(STORE, 'readwrite');
				const store = tx.objectStore(STORE);
				for (const p of puts) store.put(p.value, p.key);
				for (const k of dels) store.delete(k);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('the picture copies could not be written'));
				tx.onabort = () => reject(tx.error ?? new Error('the write was stopped (the storage may be full)'));
			}),
	};
}

/** Opens the database; null when this device has no IndexedDB. */
export function openCopyBackend(): Promise<CopyBackend | null> {
	let factory: IDBFactory | undefined;
	try {
		factory = window.indexedDB;
	} catch {
		// Some privacy modes throw on the first access.
		factory = undefined;
	}
	if (!factory) return Promise.resolve(null);
	const f = factory;
	return new Promise((resolve, reject) => {
		const req = f.open(COPIES_DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE);
		};
		req.onsuccess = () => resolve(backendOf(req.result));
		req.onerror = () => reject(req.error ?? new Error('the picture copies could not be opened'));
		req.onblocked = () => reject(new Error('the picture copies are blocked by another window'));
	});
}

/** The name that keeps two vaults apart: Obsidian's own id of the vault when it has one, else the vault's name. */
function vaultIdOf(app: App): string {
	const id = (app as { appId?: unknown }).appId;
	return typeof id === 'string' && id ? id : app.vault.getName();
}

/** The copies kept on this device for the vault of `app`, or `NO_COPIES` when the device has no IndexedDB (then the store works as before). */
export function deviceCopies(app: App): PictureCopies {
	try {
		if (!window.indexedDB) return NO_COPIES;
		return createPictureCopies({
			vault: vaultIdOf(app),
			open: openCopyBackend,
			exists: (path) => !!app.vault.getAbstractFileByPath(path),
		});
	} catch {
		return NO_COPIES;
	}
}
