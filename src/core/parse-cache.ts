/*
 * The parse cache (spec §13.15 rule 3). It keeps the last few parse results so that a redraw of the same
 * note does not parse the same block text again. Only readers share it; code that edits a note parses
 * for itself. Pure: no `obsidian` import.
 *
 * Rules:
 * - One cache for the plugin (`TreeHost.parseCache`, so a test can inject its own). The key is the note's
 *   path and the exact block text (`${path}\0${text}`). The size is `PARSE_CACHE_SIZE` (4) entries, least
 *   recently used first out (a hit moves the entry to the newest end). It stores the whole `ParseResult`,
 *   errors too (the same text gives the same error).
 * - Shared by the calls that only read: `TreeView.render`, the full-screen validity check and the two
 *   read helpers at the end of the tree view. Not shared: `edit-sheet`, `houses-window`, `titles-window`,
 *   `table-note`, the ops in `core` and the block writer, which use `parseDynasty` or `parseBody`
 *   directly because they read `doc` for edits.
 * - The cached `ParseResult` (and the `Tree` in it) is read-only for every user. `deriveFamilies` is not
 *   cached, because the views may change a `FamilyGraph`.
 * - An edit writes a new block text and so gets a new key; there is no explicit invalidation, and
 *   `clear()` runs at plugin unload.
 * - The option `freeze` freezes the returned `Tree` (not its `Source`), so a write by any user throws in a
 *   strict-mode run. It is on in the unit tests and in a harness build, so a writer that a unit test
 *   cannot reach (layout, relations, fold planning) throws there.
 */

import { parseDynasty } from './parse';
import type { ParseResult } from './types';

/** the parse cache size. */
export const PARSE_CACHE_SIZE = 4;

/** The parse cache. */
export interface ParseCache {
	/** The parse of `text` for the note at `path`; the result is shared and read-only. */
	get(path: string, text: string): ParseResult;
	/** Entries now (at most `PARSE_CACHE_SIZE`). */
	readonly size: number;
	/** Plugin unload. */
	clear(): void;
}

/** Makes a cache. `parse` is `parseDynasty` in the plugin; `freeze` freezes the returned `Tree`, not its `Source` (unit tests and a harness build). */
type CreateParseCache = (options?: { parse?: (text: string) => ParseResult; limit?: number; freeze?: boolean }) => ParseCache;

/** Freezes a plain data value at every depth; a shared object is visited once. */
function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
	if (typeof value !== 'object' || value === null || seen.has(value)) return;
	seen.add(value);
	Object.freeze(value);
	for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
}

/** Makes a cache that keeps the `limit` (default 4) most recently used parse results, errors included. */
export const createParseCache: CreateParseCache = (options = {}) => {
	const parse = options.parse ?? parseDynasty;
	const limit = Math.max(1, options.limit ?? PARSE_CACHE_SIZE);
	const freeze = options.freeze === true;
	// A Map keeps insertion order, so the first key is always the least recently used one.
	const entries = new Map<string, ParseResult>();
	return {
		get(path: string, text: string): ParseResult {
			const key = `${path}\0${text}`;
			const hit = entries.get(key);
			if (hit) {
				entries.delete(key);
				entries.set(key, hit);
				return hit;
			}
			const result = parse(text);
			if (freeze && result.ok) deepFreeze(result.tree);
			entries.set(key, result);
			while (entries.size > limit) entries.delete(entries.keys().next().value as string);
			return result;
		},
		get size() {
			return entries.size;
		},
		clear() {
			entries.clear();
		},
	};
};
