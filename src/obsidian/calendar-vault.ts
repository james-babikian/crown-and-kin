/*
 * The real vault behind the calendar index (`src/view/calendar-index.ts`). It lists the Markdown notes, reads one note from the cache of the
 * vault, tells from the metadata cache whether a note has a section that can hold a block (the same section types as `rename-links.ts`),
 * resolves a link with Obsidian's own rules, and passes the vault events on. `cacheReady` follows the start-up gate of D183: it settles when
 * the metadata cache has finished once, or after the start limit, so a plugin that starts late never waits for an event that already came.
 */

import { TFile, type App, type EventRef } from 'obsidian';
import { parseLink } from '../core/picture-link';
import type { CalendarVault } from '../view/calendar-index';

/** The section types of the metadata cache that can hold a fenced block. */
const BLOCK_SECTIONS = new Set(['code', 'callout', 'blockquote', 'list']);

/** What the adaptor needs of the start-up gate (`TreeHost.startedUp`, D183). */
export interface CacheGate {
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
		list: () => app.vault.getMarkdownFiles().map((f) => f.path),
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
		resolve(link, fromPath) {
			const target = parseLink(link)?.target;
			if (!target) return null;
			const dest = app.metadataCache.getFirstLinkpathDest(target, fromPath);
			return dest && markdown(dest) ? dest.path : null;
		},
		on(event, cb) {
			let ref: EventRef;
			if (event === 'cache') {
				ref = app.metadataCache.on('changed', (file) => cb(file.path));
				return () => app.metadataCache.offref(ref);
			}
			if (event === 'rename') ref = app.vault.on('rename', (file, old) => markdown(file) && cb(file.path, old));
			else if (event === 'delete') ref = app.vault.on('delete', (file) => markdown(file) && cb(file.path));
			else if (event === 'create') ref = app.vault.on('create', (file) => markdown(file) && cb(file.path));
			else ref = app.vault.on('modify', (file) => markdown(file) && cb(file.path));
			return () => app.vault.offref(ref);
		},
		cacheReady() {
			if (gate.seen()) return Promise.resolve();
			return new Promise<void>((resolve) => {
				let ref: EventRef | null = null;
				let timer: ReturnType<typeof setTimeout> | null = null;
				const done = () => {
					if (ref) app.metadataCache.offref(ref);
					if (timer !== null) clearTimeout(timer);
					resolve();
				};
				ref = app.metadataCache.on('resolved', done);
				timer = setTimeout(done, gate.limitMs);
			});
		},
	};
}
