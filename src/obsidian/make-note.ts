/*
 * "Make a note for this person" (spec §13.11, D60, D86, D87): the steps that
 * check the tree, choose the folder and the name, make the note with a link back to the tree, and
 * give the sheet what it needs to write the link. The edit sheet supplies the same-name question, the
 * write of the link with the unsaved draft, and the Notices; this file never shows anything. It also
 * opens a made note the way D87 says. `makeNote` (table-note.ts) makes the file.
 *
 * Steps of the flow (D60, D86, D87):
 * - Offer: mode 'new' when the draft has no link; mode 'linked' when the link names a note path that
 *   the vault does not have. The sheet decides; a web link has no button.
 * - A busy flag covers the flow from the tap to the note opening. Before `vault.create`, `ready()` and
 *   `alive()` must pass, again after each `await`. A failed check before `vault.create` makes no note
 *   ('stopped', or 'stale'); after it, the note exists and the outcome is 'link-not-added'.
 * - Mode 'new': (1) `handle.refresh()`; if the body is not the one the sheet loaded, no note is made.
 *   (2) Folder from `getNewFileParent(sourcePath)` and name from `personNoteName`; a note with that
 *   path (compared without case) opens the same-name question: link to it, make "X 1", or cancel. (3)
 *   Content is `Tree: ` and a link back made by `generateMarkdownLink`, no heading. (4) `vault.create`;
 *   if it throws, a Notice and no tree change. (5) `link` = `generateMarkdownLink` with a leading "!"
 *   removed, written with the unsaved draft in one write, so one undo step reverts all of it.
 * - Mode 'linked': the same checks; the folder is the one `linkedNotePath` gives (missing folders made
 *   one by one); no tree write, no undo.
 * - The note opens after the sheet closed: a new tab on the computer, the same place on a phone.
 */

import { TFile, type App, type TFolder } from 'obsidian';
import { sameBody } from '../core/block-match';
import { linkedNotePath, personNoteName } from '../core/note-make';
import { NOTE_UI } from '../render/ui-text';
import type { Handle, Written } from './block-handle';
import { isPhoneWindow } from '../view/focus-mode';
import { freeName, makeNote, namesIn } from './table-note';

/** Which button the sheet offers (N1): 'new' makes a note for the person; 'linked' makes the note that the link already names. */
export type MakeNoteMode = 'new' | 'linked';

/** What the sheet gives makePersonNote. */
export interface MakePersonNoteInput {
	app: App;
	mode: MakeNoteMode;
	personId: string;
	/** The draft name and the draft link. */
	name: string;
	link: string;
	sourcePath: string;
	/** The body the sheet loaded, for the stale check (step 1). */
	loadedBody: string;
	/** pendingOps() !== null && fresh(): checked before ault.create and after each wait. */
	ready: () => boolean;
	/** The sheet is still shown and not gone: checked after each wait. */
	alive: () => boolean;
}

/** The result of the flow; the sheet closes and opens the note only on 'made', 'linked-existing' and 'made-linked'. */
export type MakePersonNoteOutcome =
	| { kind: 'made'; file: TFile; written: Written | null }
	| { kind: 'stale' }
	| { kind: 'stopped' }
	| { kind: 'question-cancelled' }
	| { kind: 'linked-existing'; file: TFile; written: Written | null }
	| { kind: 'made-linked'; file: TFile }
	| { kind: 'link-not-added'; file: TFile }
	| { kind: 'failed' };

/** The answer to the same-name question (N2 step 2). */
export type SameNameAnswer = 'link' | 'new' | 'cancel';

/**
 * What the flow needs besides `MakePersonNoteInput`: the handle for
 * the stale check, the same-name question, and the write of `link` with the unsaved draft.
 */
export interface MakePersonNoteExtra {
	handle: Pick<Handle, 'refresh' | 'body'>;
	/** Shows the question; resolves with the choice, and with 'cancel' if the question goes away. */
	ask: (name: string, freeName: string) => Promise<SameNameAnswer>;
	/** Writes `link` in the same write as the unsaved draft (one undo step); null if nothing was written. */
	write: (link: string) => Promise<Written | null>;
}

/** The note of the tree as a file, or null. */
function fileAt(app: App, path: string): TFile | null {
	const f = app.vault.getAbstractFileByPath(path);
	return f instanceof TFile ? f : null;
}

/** "Tree: " and the link back to the tree's note, made by Obsidian so it follows the link settings (D86). */
function contentFor(app: App, sourcePath: string, newPath: string): string {
	const tree = fileAt(app, sourcePath);
	let back: string;
	if (tree) back = app.fileManager.generateMarkdownLink(tree, newPath);
	else {
		// The tree's note is not in the vault index: a plain link by its name still leads back.
		const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
		back = `[[${base}]]`;
	}
	return `${NOTE_UI.treeLine}${back.replace(/^!/, '')}\n`;
}

/** The note in `folder` with this file name, compared without case, or null. */
function existingIn(app: App, folder: TFolder | null, fileName: string): TFile | null {
	const want = fileName.toLowerCase();
	const hit = (folder?.children ?? []).find((c) => c.name.toLowerCase() === want);
	return hit ? fileAt(app, hit.path) : null;
}

/**
 * The flow of N2 (mode 'new') and N3 (mode 'linked'). It checks `ready()` and `alive()` at the start,
 * after each `await` and before `vault.create`; a failed check before the note exists gives 'stopped'
 * ('stale' when the body changed). It never throws.
 */
export async function makePersonNote(input: MakePersonNoteInput & Partial<MakePersonNoteExtra>): Promise<MakePersonNoteOutcome> {
	try {
		return await run(input);
	} catch (e) {
		console.error('Crown and Kin: the note flow failed', e);
		return { kind: 'failed' };
	}
}

async function run(input: MakePersonNoteInput & Partial<MakePersonNoteExtra>): Promise<MakePersonNoteOutcome> {
	const { app, sourcePath } = input;
	const go = () => input.ready() && input.alive();
	if (!go()) return { kind: 'stopped' };

	// Step 1: the stale check. The handle reads the note again first.
	if (input.handle) {
		await input.handle.refresh();
		if (!input.alive()) return { kind: 'stopped' };
		if (!sameBody(input.handle.body, input.loadedBody)) return { kind: 'stale' };
	}
	if (!go()) return { kind: 'stopped' };

	// Step 2: folder and name.
	let folderPath: string | undefined;
	let name: string;
	let fileName: string;
	if (input.mode === 'linked') {
		const lp = linkedNotePath(input.link);
		if (!lp) return { kind: 'stopped' };
		folderPath = lp.folder === '' ? undefined : lp.folder;
		name = lp.name;
		fileName = lp.path.slice(lp.path.lastIndexOf('/') + 1);
	} else {
		name = personNoteName({ name: input.name });
		fileName = `${name}.md`;
	}
	let folder: TFolder | null;
	if (folderPath === undefined) folder = app.fileManager.getNewFileParent(sourcePath);
	else {
		const at = app.vault.getAbstractFileByPath(folderPath);
		folder = at && 'children' in at ? (at as TFolder) : null;
	}
	const root = !!folder && folder.isRoot();
	const dir = folder ? (root ? '' : folder.path) : (folderPath ?? '');
	const there = existingIn(app, folder, fileName);

	let target: string = name;
	let linkTo: TFile | null = null;
	if (there) {
		if (input.mode === 'linked') {
			// The note is there already (the link resolved while the sheet was open): nothing to make.
			return { kind: 'linked-existing', file: there, written: null };
		}
		const free = freeName(name, namesIn(folder));
		if (!input.ask) return { kind: 'failed' };
		const answer = await input.ask(name, free);
		if (!go()) return { kind: 'stopped' };
		if (answer === 'cancel') return { kind: 'question-cancelled' };
		if (answer === 'link') linkTo = there;
		else target = free;
	}

	if (!linkTo) {
		// Step 3 and 4: the content and the file.
		const newPath = dir ? `${dir}/${target}.md` : `${target}.md`;
		const content = contentFor(app, sourcePath, newPath);
		if (!go()) return { kind: 'stopped' };
		const made = await makeNote(app, sourcePath, target, content, { ...(folderPath !== undefined ? { folder: folderPath } : {}), exact: true });
		if (!made.ok) return { kind: 'failed' };
		if (input.mode === 'linked') return { kind: 'made-linked', file: made.file };
		linkTo = made.file;
		// The note exists now: a failed check only means the link is not added.
		if (!go() || !input.write) return { kind: 'link-not-added', file: linkTo };
		const written = await input.write(link(app, linkTo, sourcePath));
		if (!written) return { kind: 'link-not-added', file: linkTo };
		return { kind: 'made', file: linkTo, written };
	}

	// Link to the note that was there: no note is made.
	if (!input.write) return { kind: 'failed' };
	const written = await input.write(link(app, linkTo, sourcePath));
	return { kind: 'linked-existing', file: linkTo, written };
}

/** The `link` value for a note (N2 step 5): a link made by Obsidian, without a leading "!". */
function link(app: App, file: TFile, sourcePath: string): string {
	return app.fileManager.generateMarkdownLink(file, sourcePath).replace(/^!/, '');
}

/**
 * Opens a made note (D87, N2 step 7): a new tab on the computer, so the tree stays open in its tab;
 * the same place on a phone, so Back returns to the tree. A tablet is not a phone.
 */
export async function openMadeNote(app: App, file: TFile): Promise<void> {
	const win = typeof window !== 'undefined' ? window : undefined;
	const coarse = !!win?.matchMedia?.('(pointer: coarse)').matches;
	const phone = isPhoneWindow(coarse, win?.innerWidth ?? 1024, win?.innerHeight ?? 768);
	await app.workspace.getLeaf(phone ? false : 'tab').openFile(file);
}
