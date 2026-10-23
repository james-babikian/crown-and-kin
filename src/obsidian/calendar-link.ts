/*
 * The link to a calendar note, and the facts about a tree that the Calendars window needs (D289, D290). The chooser "Calendar note" and the Calendars window both write the
 * option `calendar` of a tree as a link in the form that Obsidian prefers, so they share `linkTextFor`. A tree view builds a `CalendarTree` for the window.
 */

import type { App, TFile } from 'obsidian';

/** What `setLink` answers: `ok` the key is written; `has-key` the tree has a key now (a sync added one) and nothing is written; `failed` the write did not go through. */
export type SetLinkResult = 'ok' | 'has-key' | 'failed';

/**
 * The tree that opens the Calendars window. `link` is the option `calendar` as written; undefined for a tree with no key. `setLink` writes the key; it is not null only for a tree
 * with no key that can be written (it has drawn, it has no problem that blocks edits, and it is not read-only).
 */
export interface CalendarTree {
	treePath: string;
	link: string | undefined;
	setLink: ((link: string) => Promise<SetLinkResult>) | null;
}

/** The text of the option `calendar` for a note, seen from the note of the tree: a wiki link with the shortest name that is still clear. */
export const linkTextFor = (app: App, file: TFile, treePath: string): string => `[[${app.metadataCache.fileToLinktext(file, treePath, true)}]]`;
