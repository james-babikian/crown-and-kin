/*
 * Makes notes from the tree. `makeNote` is the one place that makes a note: the folder, the
 * first free name, the missing folders, and `vault.create`. "Make a note with this table" (spec
 * §13.4, D55, D60) uses it for the holder list of one title (`holderTable`), named by the title's
 * plural (`noteName`); the house page (§13.12) and "Make a note" for a person (§13.11) use it too.
 * It never opens a note and never changes the tree; the caller does that.
 */

import type { App, TFile, TFolder } from 'obsidian';
import { parseDynasty } from '../core/parse';
import { holderTable, noteName } from '../core/titles';
import { deriveDated, type DatesFor } from '../view/calendar-index';
import { vaultPath } from './vault-path';

/** Where a made note goes. The default is the folder that Obsidian picks for new notes next to sourcePath (D60); folder is a vault folder path ('' = the vault root). */
export interface NoteWhere {
	folder?: string;
	/** Use exactly this note name without ".md"; do not look for a free one. */
	exact?: boolean;
}

/** The result of makeNote. */
export type MakeNoteResult = { ok: true; file: TFile; name: string } | { ok: false; why: 'failed' };

/** The first free note name: `base`, else "base 1", "base 2", … (compared without case, as on Windows and macOS). */
export function freeName(base: string, taken: ReadonlySet<string>): string {
	const has = (n: string) => taken.has(`${n}.md`.toLowerCase());
	if (!has(base)) return base;
	for (let i = 1; ; i++) if (!has(`${base} ${i}`)) return `${base} ${i}`;
}

/** The lower-case names of the children of a folder (none for no folder). */
export function namesIn(folder: TFolder | null): Set<string> {
	return new Set((folder?.children ?? []).map((f) => f.name.toLowerCase()));
}

/** The vault folder at `path`, if there is one. */
function folderAt(app: App, path: string): TFolder | null {
	const f = app.vault.getAbstractFileByPath(vaultPath(path)) as (TFolder & { children?: unknown }) | null;
	return f && Array.isArray(f.children) ? f : null;
}

/** Makes the folders of `path` one by one, so the parents exist first. */
async function ensureFolder(app: App, path: string): Promise<TFolder | null> {
	let made = '';
	for (const part of vaultPath(path).split('/').filter((x) => x !== '')) {
		made = made ? `${made}/${part}` : part;
		if (!folderAt(app, made)) await app.vault.createFolder(made);
	}
	return folderAt(app, path);
}

/**
 * Makes a note with `content`. The folder is `where.folder` ('' = the vault root) or the D60
 * folder of `sourcePath`. The name is the first free one ("Name", "Name 1", …) unless `where.exact`.
 * It never throws.
 */
export async function makeNote(app: App, sourcePath: string, baseName: string, content: string, where: NoteWhere = {}): Promise<MakeNoteResult> {
	try {
		// A "." or ".." segment would place a folder or note outside the intended place.
		if ([where.folder ?? '', baseName].some((p) => p.split(/[\\/]/).some((x) => x === '.' || x === '..'))) return { ok: false, why: 'failed' };
		let folder: TFolder | null;
		if (where.folder === undefined) folder = app.fileManager.getNewFileParent(sourcePath);
		else if (vaultPath(where.folder) === '') folder = app.vault.getRoot();
		else folder = folderAt(app, where.folder) ?? (await ensureFolder(app, where.folder));
		if (!folder) return { ok: false, why: 'failed' };
		const root = folder.isRoot();
		// Another writer can take the name between the look and the write: look again, a few times.
		for (let attempt = 0; attempt < 3; attempt++) {
			const taken = namesIn(folder);
			if (where.exact && taken.has(`${baseName}.md`.toLowerCase())) return { ok: false, why: 'failed' };
			const name = where.exact ? baseName : freeName(baseName, taken);
			// folder.path comes from Obsidian: it is already a vault path, and normalizePath could turn it into a folder that does not exist.
			const path = root ? `${name}.md` : `${folder.path}/${name}.md`;
			try {
				const file: TFile = await app.vault.create(path, content);
				return { ok: true, file, name };
			} catch (e) {
				const raced = !where.exact && app.vault.getAbstractFileByPath(path) !== null;
				if (!raced) throw e;
			}
		}
		return { ok: false, why: 'failed' };
	} catch (e) {
		console.error('Crown and Kin: cannot make the note', e);
		return { ok: false, why: 'failed' };
	}
}

/** The result of `makeTableNote`: the new note's name, or why there is none. */
export type TableNoteResult = { ok: true; name: string; path: string } | { ok: false; why: 'gone' | 'failed' };

/**
 * Makes the table note of title `id` from the block text `body` (the saved list, spec §13.4).
 * `sourcePath` is the tree's note: Obsidian's "same folder as current file" setting uses it.
 */
export async function makeTableNote(app: App, body: string, id: string, sourcePath: string, dates?: DatesFor): Promise<TableNoteResult> {
	const parsed = parseDynasty(body);
	if (!parsed.ok) return { ok: false, why: 'gone' };
	const g = deriveDated(parsed.tree, dates);
	const title = g.titles.find((t) => t.id === id);
	if (!title) return { ok: false, why: 'gone' };
	const made = await makeNote(app, sourcePath, noteName(title.plural, title.id), holderTable(g, title));
	return made.ok ? { ok: true, name: made.name, path: made.file.path } : { ok: false, why: 'failed' };
}
