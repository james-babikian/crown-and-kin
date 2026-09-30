/*
 * Names and paths for notes made from the tree (spec §13.11, D60, D86): the note name for a new
 * person note, and the vault path of the note that a person's `link` names. The Obsidian side makes
 * the files; this file only decides names, so the rules can be tested without a vault.
 *
 * Rules:
 * - `personNoteName` uses the name as written (not the regnal name), cleaned by `noteName`.
 * - `linkedNotePath` reads the target of a `link` the way `linkTarget` (`render/tree-info.ts`) does,
 *   without `#...` and `|...`, and without a leading "/". It splits at the last "/" into a folder
 *   ('' = the D60 folder) and a name, and adds ".md" unless the path already ends with it (compared
 *   without case). It gives null for no link, an empty target, a web address, a path with a ".."
 *   segment, or a target whose extension is in `NON_NOTE_EXTENSIONS`, so the plugin never makes
 *   "Report.pdf.md". Any other extension is part of the name: "St.John" is a note.
 */

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

/** The target of a `link` value the way `linkTarget` in `render/tree-info.ts` reads it (core cannot import render). */
function target(link: string): string {
	let s = link.trim();
	const wiki = /^!?\[\[([^\]]*)\]\]$/.exec(s);
	const md = /^!?\[[^\]]*\]\(([^)]*)\)$/.exec(s);
	if (wiki) s = wiki[1].split('|')[0];
	else if (md) {
		s = md[1].trim().replace(/^<(.*)>$/, '$1');
		try {
			s = decodeURIComponent(s);
		} catch {
			// Keep the text as written if it is not valid percent-encoding.
		}
	}
	return s.trim();
}

/** The path of the note that a person's `link` names, or null (no link, a web address, or another kind of file). */
export function linkedNotePath(link: string | undefined): LinkedNotePath | null {
	if (typeof link !== 'string') return null;
	const text = target(link).split('#')[0].split('|')[0].trim();
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
