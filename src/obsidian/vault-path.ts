/*
 * One place where text that a user typed (a folder in the Calendars window, the target of a `link` key) becomes a vault path.
 * Obsidian's `normalizePath` removes the slips that make a path miss its file: a backslash, a doubled or a leading or trailing slash,
 * a no-break space, and a different Unicode form of the same letters.
 */

import { normalizePath } from 'obsidian';

/**
 * A vault path from `text`. The vault root is '' here (Obsidian's `normalizePath` writes it as '/'), so '', '/' and '.' give ''.
 * A path that is already clean comes back the same.
 */
export function vaultPath(text: string): string {
	const path = normalizePath(text);
	return path === '/' || path === '.' ? '' : path;
}
