/*
 * The Save of the Calendars window, as a sequence of steps with no window in it (spec §14 rule 7, D289, D290): make the note if it is new, write the changes of the draft,
 * tell the calendar index, and, in a window that opened from a tree with no key, set the key of that tree to the note. The result is the one Notice for the user, or the
 * sentence for the window when a step failed. The key is the last step, so a failed key never loses the saved calendars.
 */

import { TFile, type App } from 'obsidian';
import type { CalendarOp } from '../core/calendar-block';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import type { CalendarIndex } from '../view/calendar-index';
import { linkTextFor, type SetLinkResult } from './calendar-link';
import { loadNote, makeCalendarNote, saveNote, type LoadedNote } from './calendar-note';

/** The operations for each block of a note. */
export type SavePlan = readonly { block: number; ops: readonly CalendarOp[] }[];

/** What a Save needs. */
export interface SaveJob {
	app: App;
	index: CalendarIndex;
	/** The note of the tree (or the note that was open): a new note is made near it, and the key is a link seen from it. */
	treePath: string;
	/** The note as the window loaded it; null for a note that this Save makes. */
	note: LoadedNote | null;
	/** The name and the folder of the note that a Save makes. */
	name: string;
	folder: string;
	/** The operations for the note (as loaded, or as just made). */
	planFor: (note: LoadedNote) => SavePlan;
	/** Set only when the tree has no key and can take one; the Save then sets the key to the note. */
	setLink: ((link: string) => Promise<SetLinkResult>) | null;
	/** Told when the Save made a note, so that a second try does not make another. */
	onNote: (note: LoadedNote) => void;
}

/** The result of a Save: `notice` is the one Notice to show; `message` is the sentence for the window, which stays open. */
export type SaveOutcome = { ok: true; notice: string } | { ok: false; message: string };

/** The end of the Notice, for the answer of `setLink`. */
function keyText(result: SetLinkResult, made: boolean, name: string): string {
	return result === 'ok' ? (made ? T.keyNowMade : T.keyNow(name)) : result === 'has-key' ? T.keyHas : T.keyFailed;
}

/** The key step: the link to the note, asked of the tree. Never throws. */
async function setKey(job: SaveJob, path: string): Promise<SetLinkResult> {
	try {
		const file = job.app.vault.getAbstractFileByPath(path);
		return job.setLink && file instanceof TFile ? await job.setLink(linkTextFor(job.app, file, job.treePath)) : 'failed';
	} catch (e) {
		console.error('Crown and Kin: cannot set the calendar note of the tree', e);
		return 'failed';
	}
}

/** Makes the note if it is new, writes the draft, tells the index and sets the key. */
export async function saveCalendars(job: SaveJob): Promise<SaveOutcome> {
	let note = job.note;
	let made: string | null = null;
	if (note === null) {
		const file = await makeCalendarNote(job.app, job.treePath, job.name, job.folder);
		if (!file) return { ok: false, message: T.cannotMake };
		made = file.name;
		note = await loadNote(job.app, file.path);
		if (!note) return { ok: false, message: T.cannotSave };
		job.onNote(note);
	}
	const plan = job.planFor(note);
	const out = plan.length ? await saveNote(job.app, note.path, note.bodies, plan) : { ok: true as const };
	if (!out.ok) {
		if (out.code === 'stale') return { ok: false, message: T.stale };
		console.error('Crown and Kin: the calendar edit was refused', out.reason);
		// The reason is a sentence of the core (a refused edit); an error of the file system has none.
		return { ok: false, message: out.reason ? T.cannotSaveBecause(out.reason) : T.cannotSave };
	}
	await job.index.reload(note.path);
	const noteName = made ?? note.path.replace(/^.*\//, '').replace(/\.md$/i, '');
	const first = made ? T.madeNote(made) : T.saved;
	if (!job.setLink) return { ok: true, notice: first };
	return { ok: true, notice: `${first} ${keyText(await setKey(job, note.path), made !== null, noteName)}` };
}
