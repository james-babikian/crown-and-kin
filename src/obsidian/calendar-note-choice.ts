/*
 * The More list item "Calendar note" (spec §14 rule 7): the user chooses the one calendar note that the tree uses, or "Every calendar note", which removes the key.
 * The choice is written into the tree text as the option `calendar` (a link, kept up to date on a rename by the link update of §6.9) with `SetOption`; one write, one undo step.
 */

import { Notice, TFile, type App } from 'obsidian';
import { CALENDAR_UI as T } from '../render/calendar-text';
import type { CalendarIndex } from '../view/calendar-index';
import type { Handle } from './block-handle';
import { choose } from './choice-modal';

/** The name of a calendar note for the list and the Notice: the file name without ".md". */
const nameOf = (path: string): string => path.replace(/^.*\//, '').replace(/\.md$/i, '');

/**
 * Asks which calendar note the tree uses and writes the answer. `link` is the option as written now (undefined: every calendar note). A Cancel writes nothing.
 * Never throws: a failed write gives a Notice.
 */
export async function chooseCalendarNote(app: App, index: CalendarIndex, handle: Pick<Handle, 'write'>, treePath: string, link: string | undefined): Promise<void> {
	try {
		const notes = index.notes();
		if (!notes.length) {
			new Notice(T.noNotes);
			return;
		}
		// A tree that names a note which is missing uses no calendar note at all, so no choice is marked "In use".
		const named = !!link?.trim();
		const current = named ? index.resolve(link as string, treePath) : null;
		const every = !named;
		const choices = [
			{ value: { path: null as string | null }, label: T.everyNote, detail: every ? T.inUse : T.everyNoteDetail, cta: every },
			...notes.map((path) => ({ value: { path }, label: nameOf(path), detail: path === current ? T.inUse : path, cta: path === current })),
		];
		const picked = await choose(app, { title: T.noteTitle, text: [T.noteText], choices, name: 'calendar-note' });
		if (!picked) return;
		let value: string | null = null;
		if (picked.path !== null) {
			const file = app.vault.getAbstractFileByPath(picked.path);
			if (!(file instanceof TFile)) {
				new Notice(T.noteFailed);
				return;
			}
			value = `[[${app.metadataCache.fileToLinktext(file, treePath, true)}]]`;
		}
		const out = await handle.write({ kind: 'set-option', key: 'calendar', value });
		new Notice(!out.ok ? T.noteFailed : picked.path === null ? T.everyChosen : T.noteChosen(nameOf(picked.path)));
	} catch (e) {
		console.error('Crown and Kin: cannot choose the calendar note', e);
		new Notice(T.noteFailed);
	}
}
