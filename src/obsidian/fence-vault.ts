/*
 * The real vault behind the fence index (`src/view/fence-index.ts`). It lists the Markdown notes with their stamp, reads from the cache of the vault, tells from the metadata cache
 * whether a note has a section that can hold a block, and passes the vault events on (`cache` is the metadata cache event `changed`, with the text). The store is the local storage of the vault:
 * per vault and per device, never synced. `saveWhenLeaving` saves the index when the page hides or the app goes to the background. `cacheReady` follows the start-up gate of D183.
 */

import type { App, TFile } from 'obsidian';
import { mediaMatches } from '../render/dom/page-reads';
import { BLOCK_SECTIONS, type FenceFile, type FenceIndex, type FenceOptions, type FenceStore, type FenceVault } from '../view/fence-index';
import { later } from '../view/idle';
import { cacheReadyOf, fileAt, onVaultEvent, readNote, type CacheGate } from './vault-parts';

/** The key of the saved copy. Obsidian adds the name of the vault. */
export const FENCE_STORE_KEY = 'crown-and-kin-fence-index';

/** What the adaptor needs of the start-up gate (`startedUp`, D183). */
interface FenceGate extends CacheGate {
	/** True only when the metadata cache has finished; the limit does not count. */
	done(): boolean;
}

const record = (f: TFile): FenceFile => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size });

/** Makes the fence vault of an app. */
export function obsidianFenceVault(app: App, gate: FenceGate): FenceVault {
	return {
		files: () => app.vault.getMarkdownFiles().map(record),
		read: (path) => readNote(app, path),
		sectionState(path) {
			const f = fileAt(app, path);
			if (!f) return 'no';
			let cache;
			try {
				cache = app.metadataCache.getFileCache(f);
			} catch {
				return 'unknown';
			}
			if (!cache) return 'unknown';
			return cache.sections?.some((s) => BLOCK_SECTIONS.has(s.type)) ? 'yes' : 'no';
		},
		cacheDone: () => gate.done(),
		on(event, cb) {
			return onVaultEvent(app, event, (file, text, old) => {
				if (event === 'cache') cb(record(file), text);
				else if (event === 'rename') cb(record(file), undefined, old);
				else cb(record(file));
			});
		},
		cacheReady: () => cacheReadyOf(app, gate),
		idle: () => new Promise<void>((resolve) => later(() => resolve())),
	};
}

/** The saved copy in the local storage of the vault. A load of nothing is null; a failed save throws, and the index stops saving. */
export function obsidianFenceStore(app: App): FenceStore {
	return {
		load: () => app.loadLocalStorage(FENCE_STORE_KEY) as unknown,
		save: (value) => app.saveLocalStorage(FENCE_STORE_KEY, value),
	};
}

/** The options for this device: a phone reads fewer notes in one slice. Decided by pointer type, never by `Platform` (spec §7). */
export function fenceOptionsForDevice(): FenceOptions {
	return mediaMatches(window, '(pointer: coarse)') ? { readsPerSlice: 10 } : {};
}

/** The two event targets that tell that the page goes away; tests give small fakes. */
interface LeaveTargets {
	win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
	doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}

/**
 * Saves the index at `pagehide` and when the page becomes hidden. iOS can end the app with no other warning. Gives a function that removes the listeners.
 */
export function saveWhenLeaving(index: Pick<FenceIndex, 'flush'>, targets: LeaveTargets = { win: window, doc: document }): () => void {
	const flush = () => {
		try {
			index.flush();
		} catch (e) {
			console.error('Crown and Kin: the note index could not be saved.', e);
		}
	};
	const hidden = () => {
		if (targets.doc.visibilityState === 'hidden') flush();
	};
	targets.win.addEventListener('pagehide', flush);
	targets.doc.addEventListener('visibilitychange', hidden);
	return () => {
		targets.win.removeEventListener('pagehide', flush);
		targets.doc.removeEventListener('visibilitychange', hidden);
	};
}
