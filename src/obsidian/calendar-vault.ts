/*
 * The real vault behind the calendar index (`src/view/calendar-index.ts`). It reads one note from the cache of the vault, resolves a link with
 * Obsidian's own rules, and passes the vault events on ('cache' brings the text of the note, 'rename' the old path). It lists no notes: the notes that hold a
 * fence come from the fence index. `cacheReady` follows the start-up gate of D183: it settles when the metadata cache has finished once, or after the start
 * limit, so a plugin that starts late never waits for an event that already came.
 */

import type { App } from 'obsidian';
import { parseLink } from '../core/picture-link';
import type { CalendarVault } from '../view/calendar-index';
import { cacheReadyOf, markdown, onVaultEvent, readNote, type CacheGate } from './vault-parts';

/** Makes the calendar vault of an app. */
export function obsidianCalendarVault(app: App, gate: CacheGate): CalendarVault {
	return {
		read: (path) => readNote(app, path),
		resolve(link, fromPath) {
			const target = parseLink(link)?.target;
			if (!target) return null;
			const dest = app.metadataCache.getFirstLinkpathDest(target, fromPath);
			return dest && markdown(dest) ? dest.path : null;
		},
		on(event, cb) {
			return onVaultEvent(app, event, (file, text, old) => {
				if (event === 'cache') cb(file.path, text);
				else if (event === 'rename') cb(file.path, old);
				else cb(file.path);
			});
		},
		cacheReady: () => cacheReadyOf(app, gate),
	};
}
