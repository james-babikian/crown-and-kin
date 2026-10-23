/*
 * The More list item "Calendar note" (spec §14 rule 7, D289): the user chooses the one calendar note that the tree uses, or "No calendar", which removes the key.
 * The list holds the notes that the note index knows have a `kin-calendar` block, and the note the tree names if that is not in the list. The choice is written into
 * the tree text as the option `calendar` (a link, kept up to date on a rename by the link update of §6.9) with `SetOption`; one write, one undo step.
 */

import { Notice, TFile, type App } from 'obsidian';
import { CALENDAR_UI as T } from '../render/calendar-text';
import { byNameThenPath, type CalendarIndex } from '../view/calendar-index';
import type { Handle } from './block-handle';
import { linkTextFor } from './calendar-link';
import { choose } from './choice-modal';

/** The name of a calendar note for the list and the Notice: the file name without ".md". */
const nameOf = (path: string): string => path.replace(/^.*\//, '').replace(/\.md$/i, '');

/**
 * Asks which calendar note the tree uses and writes the answer. `link` is the option as written now (undefined: no key, the tree reads plain years only). A Cancel writes nothing.
 * Never throws: a failed write gives a Notice.
 */
export async function chooseCalendarNote(app: App, index: CalendarIndex, handle: Pick<Handle, 'write'>, treePath: string, link: string | undefined): Promise<void> {
	try {
		const named = !!link?.trim();
		// A tree that names a note which is missing uses no calendar note at all, so no choice is marked "In use".
		const current = named ? index.resolve(link as string, treePath) : null;
		const listed = index.notes();
		// With a key the list always opens, so that the key can be removed; with no key and no note there is nothing to choose.
		if (!named && !listed.length && index.notesComplete()) {
			new Notice(T.noNotes);
			return;
		}
		const notes = current !== null && !listed.includes(current) ? [...listed, current].sort(byNameThenPath) : listed;
		const choices = [
			{ value: { path: null as string | null }, label: T.noCalendar, detail: !named ? T.inUse : T.noCalendarDetail, cta: !named },
			...notes.map((path) => ({ value: { path }, label: nameOf(path), detail: path === current ? T.inUse : path, cta: path === current })),
		];
		const picked = await choose(app, { title: T.noteTitle, text: index.notesComplete() ? [T.noteText] : [T.noteText, T.stillLooking], choices, name: 'calendar-note' });
		if (!picked) return;
		let value: string | null = null;
		if (picked.path !== null) {
			const file = app.vault.getAbstractFileByPath(picked.path);
			if (!(file instanceof TFile)) {
				new Notice(T.noteFailed);
				return;
			}
			value = linkTextFor(app, file, treePath);
		} else if (link === undefined) {
			// The tree has no key: "No calendar" is what it does already, so there is nothing to write.
			new Notice(T.noCalendarChosen);
			return;
		}
		const out = await handle.write({ kind: 'set-option', key: 'calendar', value });
		new Notice(!out.ok ? T.noteFailed : picked.path === null ? T.noCalendarChosen : T.noteChosen(nameOf(picked.path)));
	} catch (e) {
		console.error('Crown and Kin: cannot choose the calendar note', e);
		new Notice(T.noteFailed);
	}
}
