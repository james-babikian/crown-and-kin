/*
 * The real vault behind the fence index (`src/view/fence-index.ts`). It lists the Markdown notes with their stamp, reads from the cache of the vault, tells from the metadata cache
 * whether a note has a section that can hold a block, and passes the vault events on (`cache` is the metadata cache event `changed`, with the text). The store is the local storage of the vault:
 * per vault and per device, never synced. `saveWhenLeaving` saves the index when the page hides or the app goes to the background. `cacheReady` follows the start-up gate of D183.
 */

import { TFile, type App, type EventRef } from 'obsidian';
import { BLOCK_SECTIONS, type FenceFile, type FenceIndex, type FenceOptions, type FenceStore, type FenceVault } from '../view/fence-index';
import { later } from '../view/idle';

/** The key of the saved copy. Obsidian adds the name of the vault. */
export const FENCE_STORE_KEY = 'crown-and-kin-fence-index';

/** What the adaptor needs of the start-up gate (`startedUp`, D183). */
interface FenceGate {
	/** True once the metadata cache has finished, or the start limit has passed. */
	seen(): boolean;
	/** True only when the metadata cache has finished; the limit does not count. */
	done(): boolean;
	/** How long to wait for the cache at most, in ms. */
	limitMs: number;
}

const markdown = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';
const record = (f: TFile): FenceFile => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size });

/** Makes the fence vault of an app. */
export function obsidianFenceVault(app: App, gate: FenceGate): FenceVault {
	const fileAt = (path: string): TFile | null => {
		const f = app.vault.getAbstractFileByPath(path);
		return markdown(f) ? f : null;
	};
	return {
		files: () => app.vault.getMarkdownFiles().map(record),
		async read(path) {
			const f = fileAt(path);
			if (!f) throw new Error('not a note');
			return app.vault.cachedRead(f);
		},
		sectionState(path) {
			const f = fileAt(path);
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
			let ref: EventRef;
			if (event === 'cache') {
				ref = app.metadataCache.on('changed', (file, data) => markdown(file) && cb(record(file), data));
				return () => app.metadataCache.offref(ref);
			}
			if (event === 'rename') ref = app.vault.on('rename', (file, old) => markdown(file) && cb(record(file), undefined, old));
			else if (event === 'delete') ref = app.vault.on('delete', (file) => markdown(file) && cb(record(file)));
			else if (event === 'create') ref = app.vault.on('create', (file) => markdown(file) && cb(record(file)));
			else ref = app.vault.on('modify', (file) => markdown(file) && cb(record(file)));
			return () => app.vault.offref(ref);
		},
		cacheReady() {
			if (gate.seen()) return Promise.resolve();
			return new Promise<void>((resolve) => {
				let ref: EventRef | null = null;
				let timer: number | null = null;
				const done = () => {
					if (ref) app.metadataCache.offref(ref);
					if (timer !== null) window.clearTimeout(timer);
					resolve();
				};
				ref = app.metadataCache.on('resolved', done);
				timer = window.setTimeout(done, gate.limitMs);
			});
		},
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
	const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
	return coarse ? { readsPerSlice: 10 } : {};
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
