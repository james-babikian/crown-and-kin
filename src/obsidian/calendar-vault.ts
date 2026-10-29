/*
 * The real vault behind the calendar index (`src/view/calendar-index.ts`). It reads one note from the cache of the vault, resolves a link with
 * Obsidian's own rules, and passes the vault events on ('cache' brings the text of the note, 'rename' the old path). It lists no notes: the notes that hold a
 * fence come from the fence index. `cacheReady` follows the start-up gate of D183: it settles when the metadata cache has finished once, or after the start
 * limit, so a plugin that starts late never waits for an event that already came.
 */

import { TFile, type App, type EventRef } from 'obsidian';
import { parseLink } from '../core/picture-link';
import type { CalendarVault } from '../view/calendar-index';

/** What the adaptor needs of the start-up gate (`TreeHost.startedUp`, D183). */
interface CacheGate {
	/** True once the metadata cache has finished, or the start limit has passed. */
	seen(): boolean;
	/** How long to wait for the cache at most, in ms. */
	limitMs: number;
}

const markdown = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';

/** Makes the calendar vault of an app. */
export function obsidianCalendarVault(app: App, gate: CacheGate): CalendarVault {
	const fileAt = (path: string): TFile | null => {
		const f = app.vault.getAbstractFileByPath(path);
		return markdown(f) ? f : null;
	};
	return {
		async read(path) {
			const f = fileAt(path);
			if (!f) throw new Error('not a note');
			return app.vault.cachedRead(f);
		},
		resolve(link, fromPath) {
			const target = parseLink(link)?.target;
			if (!target) return null;
			const dest = app.metadataCache.getFirstLinkpathDest(target, fromPath);
			return dest && markdown(dest) ? dest.path : null;
		},
		on(event, cb) {
			let ref: EventRef;
			if (event === 'cache') {
				ref = app.metadataCache.on('changed', (file, data) => markdown(file) && cb(file.path, data));
				return () => app.metadataCache.offref(ref);
			}
			if (event === 'rename') ref = app.vault.on('rename', (file, old) => markdown(file) && cb(file.path, old));
			else if (event === 'delete') ref = app.vault.on('delete', (file) => markdown(file) && cb(file.path));
			else ref = app.vault.on('create', (file) => markdown(file) && cb(file.path));
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
	};
}
