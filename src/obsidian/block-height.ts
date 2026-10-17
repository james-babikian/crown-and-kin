/*
 * The last known height of each block (0.2.8 contract B.5, D183). On a cold start the tree of a note draws before the plugin styles
 * are applied. The view then shows an empty box of this height, so the note does not jump when the real tree comes. The heights
 * are kept for the session, and in the vault's local storage (never synced, never in the note) so that the next start knows them too.
 * Nothing here throws: a storage that fails only means that the default height is used.
 */

import type { App } from 'obsidian';

/** The key of the local storage entry. */
const STORE_KEY = 'crown-and-kin-block-heights';
/** The most blocks whose height is kept. */
const MAX_BLOCKS = 300;
/** A change of this many px or less is not stored again. */
const SAME_PX = 2;

/** Heights by block key, newest last (a Map keeps the order of insertion). */
const heights = new Map<string, number>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function readStore(app: App): void {
	if (loaded) return;
	loaded = true;
	try {
		const raw: unknown = typeof app.loadLocalStorage === 'function' ? app.loadLocalStorage(STORE_KEY) : null;
		if (!raw || typeof raw !== 'object') return;
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof v === 'number' && Number.isFinite(v) && v > 0 && !heights.has(k)) heights.set(k, v);
		}
	} catch {
		// No kept heights: the default is used.
	}
}

/** The last known height of the block `key` in px, or null. */
export function lastHeight(app: App, key: string): number | null {
	readStore(app);
	return heights.get(key) ?? null;
}

/** Keeps the height of the block `key` (the height of its root, in px). A height of 0 or an unreadable one is not kept. */
export function rememberHeight(app: App, key: string, px: number): void {
	if (!(px > 0) || !Number.isFinite(px)) return;
	readStore(app);
	const rounded = Math.round(px);
	const old = heights.get(key);
	if (old !== undefined && Math.abs(old - rounded) <= SAME_PX) return;
	heights.delete(key);
	heights.set(key, rounded);
	while (heights.size > MAX_BLOCKS) heights.delete(heights.keys().next().value!);
	scheduleSave(app);
}

/** One write for a burst of changes, and none while the view is still settling. */
function scheduleSave(app: App): void {
	if (saveTimer !== null || typeof app.saveLocalStorage !== 'function') return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			app.saveLocalStorage(STORE_KEY, Object.fromEntries(heights));
		} catch {
			// The heights stay in memory.
		}
	}, 2000);
}

/** Forgets the kept height of the block `key`, in memory and in the store: the block now shows something of another height (the low bar of a large tree). */
export function forgetHeight(app: App, key: string): void {
	readStore(app);
	if (heights.delete(key)) scheduleSave(app);
}

/** Moves the kept height of a renamed note's blocks to the new path (the key starts with the path and a NUL). */
export function renameHeights(oldPath: string, newPath: string): void {
	const prefix = `${oldPath}\u0000`;
	for (const [k, v] of [...heights]) {
		if (!k.startsWith(prefix)) continue;
		heights.delete(k);
		heights.set(newPath + k.slice(oldPath.length), v);
	}
}

/** Forgets every kept height (the tests). */
export function forgetHeights(): void {
	heights.clear();
	loaded = false;
	if (saveTimer !== null) clearTimeout(saveTimer);
	saveTimer = null;
}
