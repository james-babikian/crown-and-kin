/*
 * Names and paths for notes made from the tree (spec §13.11, D60, D86): the note name for a new
 * person note, and the vault path of the note that a person's `link` names. The Obsidian side makes
 * the files; this file only decides names, so the rules can be tested without a vault.
 *
 * Rules:
 * - `personNoteName` uses the name as written (not the regnal name), cleaned by `noteName`.
 * - `linkedNotePath` reads the target of a `link` with `linkText` (`link-text.ts`), as `linkTarget` (`render/tree-info.ts`) does,
 *   without `#...` and `|...`, and without a leading "/". It splits at the last "/" into a folder
 *   ('' = the D60 folder) and a name, and adds ".md" unless the path already ends with it (compared
 *   without case). It gives null for no link, an empty target, a web address, a path with a ".."
 *   segment, or a target whose extension is in `NON_NOTE_EXTENSIONS`, so the plugin never makes
 *   "Report.pdf.md". Any other extension is part of the name: "St.John" is a note.
 * - `uniqueNotePath` and `calendarNotePath` choose the path of a note the plugin makes, so that no name takes an existing note.
 */

import { linkText } from './link-text';
import { noteName } from './titles';
import type { Person } from './types';

/** Extensions that Obsidian opens as another kind of file; a `link` with one of them names no note. */
export const NON_NOTE_EXTENSIONS: readonly string[] = [
	'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'avif', 'heic', 'tif', 'tiff',
	'pdf', 'canvas', 'base',
	'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus',
	'mp4', 'webm', 'ogv', 'mov', 'mkv',
];

/** Where the linked note goes. `folder` '' = the D60 folder; `path` = folder + name + ".md" without a leading "/". */
export interface LinkedNotePath {
	folder: string;
	/** The note name without ".md". */
	name: string;
	path: string;
}

/** The note name for a person: the name as written, cleaned; "Person" when nothing is left. */
export function personNoteName(person: Pick<Person, 'name'>): string {
	return noteName(person?.name ?? '', 'Person');
}

/** The path of the note that a person's `link` names, or null (no link, a web address, or another kind of file). */
export function linkedNotePath(link: string | undefined): LinkedNotePath | null {
	if (typeof link !== 'string') return null;
	const text = linkText(link).split('#')[0].split('|')[0].trim();
	// A scheme such as "https:" or "mailto:" is an address, not a vault path.
	if (text === '' || /^[a-z][a-z0-9+.-]+:/i.test(text)) return null;
	const parts = text.split('/').filter((x) => x !== '' && x !== '.');
	// A path that leaves the vault names no note.
	if (parts.includes('..')) return null;
	const file = parts.pop();
	if (file === undefined || file.trim() === '') return null;
	const folder = parts.join('/');
	const dot = file.lastIndexOf('.');
	const extension = dot >= 0 ? file.slice(dot + 1).toLowerCase() : '';
	if (NON_NOTE_EXTENSIONS.includes(extension)) return null;
	const isNote = extension === 'md';
	const name = isNote ? file.slice(0, dot) : file;
	if (name === '') return null;
	const fileName = isNote ? file : `${file}.md`;
	return { folder, name, path: folder ? `${folder}/${fileName}` : fileName };
}

/** The most numbers `uniqueNotePath` tries before it takes the next one without a check (a vault with that many copies is not real). */
const UNIQUE_TRIES = 10000;

/**
 * The path of a new note that takes no existing path: `Name.md`, then `Name 1.md`, `Name 2.md` and so on (spec §14 rule 2).
 * `taken` tells if a path exists; the caller compares without case, as a vault does. `folder` '' is the root of the vault.
 */
export function uniqueNotePath(name: string, taken: (path: string) => boolean, folder = ''): string {
	const at = (n: number) => {
		const file = `${n === 0 ? name : `${name} ${n}`}.md`;
		return folder ? `${folder}/${file}` : file;
	};
	for (let n = 0; n < UNIQUE_TRIES; n++) if (!taken(at(n))) return at(n);
	return at(UNIQUE_TRIES);
}

/** The note that the Calendars window makes the first time it saves: `Calendars.md` at the root of the vault, else `Calendars 1.md` and so on. */
export const calendarNotePath = (taken: (path: string) => boolean): string => uniqueNotePath('Calendars', taken);
