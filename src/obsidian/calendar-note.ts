/*
 * The file work of the Calendars window (spec §14 rule 2): reading a calendar note into calendars, making a new calendar note, and writing the edits of the
 * window into a note. The text work is pure (`view/calendar-write.ts`); this file only reads and writes the vault. The write runs inside `vault.process`, so the
 * block bodies are checked against the note as it is at that moment, and a write never replaces a change that came from elsewhere.
 */

import { TFile, type App } from 'obsidian';
import { CALENDAR_LANGUAGE, findBlocks } from '../core/block-locate';
import type { CalendarOp } from '../core/calendar-block';
import { parseCalendarBlock } from '../core/calendar-block';
import type { Calendar, NameList } from '../core/dates';
import type { CodedIssue } from '../core/messages';
import { calendarNotePath } from '../core/note-make';
import { NEW_NOTE_TEXT, writeCalendars, type CalendarWrite } from '../view/calendar-write';
import { makeNote } from './table-note';

/** A calendar note as read: its text, the bodies of its blocks, its calendars, the name lists of its plain years and the problems of its blocks. */
export interface LoadedNote {
	path: string;
	text: string;
	bodies: string[];
	calendars: Calendar[];
	/** The name lists of the plain years (spec §14 rule 13): those of the first block that has the key `plain`. */
	plain: NameList[];
	/** The block that holds `plain`, or the first block when none does: a list that the window adds goes there. */
	plainBlock: number;
	issues: CodedIssue[];
}

/** The note at `path` read into calendars, or null when it cannot be read. */
export async function loadNote(app: App, path: string): Promise<LoadedNote | null> {
	try {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		const text = await app.vault.read(file);
		const blocks = findBlocks(text, CALENDAR_LANGUAGE);
		const read = blocks.map((b, i) => parseCalendarBlock(b.body, path, i));
		const plainAt = read.findIndex((r) => r.plain !== undefined);
		return { path, text, bodies: blocks.map((b) => b.body), calendars: read.flatMap((r) => r.calendars), plain: plainAt >= 0 ? (read[plainAt].plain ?? []) : [], plainBlock: Math.max(plainAt, 0), issues: read.flatMap((r) => r.issues) };
	} catch (e) {
		console.error('Crown and Kin: cannot read the calendar note', e);
		return null;
	}
}

/** The name and the folder that a new calendar note starts with: `Calendars` at the root of the vault, else `Calendars 1` and so on (spec §14 rule 2). */
export function newNoteDefaults(app: App): { name: string; folder: string } {
	const path = calendarNotePath((p) => app.vault.getAbstractFileByPath(p) !== null);
	return { name: path.replace(/\.md$/i, ''), folder: '' };
}

/** Makes a new calendar note with one empty block; the path of the made note, or null when it cannot be made. */
export async function makeCalendarNote(app: App, sourcePath: string, name: string, folder: string): Promise<{ path: string; name: string } | null> {
	const made = await makeNote(app, sourcePath, name, NEW_NOTE_TEXT, { folder });
	return made.ok ? { path: made.file.path, name: made.name } : null;
}

/** Writes the operations into the note at `path`. `bodies` are the block bodies that the window loaded. Never throws. */
export async function saveNote(app: App, path: string, bodies: readonly string[], plan: readonly { block: number; ops: readonly CalendarOp[] }[]): Promise<CalendarWrite> {
	try {
		const file = app.vault.getAbstractFileByPath(path);
		// The note was moved or renamed while the window was open: the window keeps its draft and tells the user (the same text as a note that changed).
		if (!(file instanceof TFile)) return { ok: false, code: 'stale' };
		let result: CalendarWrite = { ok: false, code: 'stale' };
		await app.vault.process(file, (current) => {
			result = writeCalendars(current, bodies, plan);
			return result.ok ? result.text : current;
		});
		return result;
	} catch (e) {
		console.error('Crown and Kin: cannot write the calendar note', e);
		return { ok: false, code: 'rejected' };
	}
}
