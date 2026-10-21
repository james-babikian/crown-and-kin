/*
 * The write of the Calendars window (spec §14 rule 2), with no Obsidian: it turns the edit operations of `calendar-draft.ts` into the new text of a calendar note.
 * Each block is written with `planWrite` (language `kin-calendar`), which checks that the block still holds the text the window loaded, so a change made
 * elsewhere (a sync, another window) is never overwritten. The window does the file work: it gives this function the text that the note holds at the moment of the write.
 */

import { CALENDAR_LANGUAGE, findBlocks } from '../core/block-locate';
import { planWrite } from '../core/block-write';
import { editCalendarBlock, type CalendarOp } from '../core/calendar-block';

/** The first text of a new calendar note: one block with no calendar. */
export const NEW_NOTE_TEXT = '```kin-calendar\ncalendars: []\n```\n';

/** The bodies of the `kin-calendar` blocks of a note text, in order. */
export const calendarBodies = (text: string): string[] => findBlocks(text, CALENDAR_LANGUAGE).map((b) => b.body);

/** The result of the write: the new note text, or why there is none. `stale`: a block is not the one that the window loaded. */
export type CalendarWrite = { ok: true; text: string } | { ok: false; code: 'stale' | 'rejected'; reason?: string };

/**
 * Applies the operations of each block, in the order given, to `text` (the note as it is now). `loaded` are the block bodies that the window started from.
 * Never throws.
 */
export function writeCalendars(text: string, loaded: readonly string[], plan: readonly { block: number; ops: readonly CalendarOp[] }[]): CalendarWrite {
	let out = text;
	for (const { block, ops } of plan) {
		const body = loaded[block];
		const result = planWrite(
			out,
			block,
			body ?? '',
			(current) => {
				let cur = current;
				for (const op of ops) {
					const r = editCalendarBlock(cur, op);
					if (!r.ok) return { ok: false, reason: r.detail ?? r.code };
					cur = r.body;
				}
				return { ok: true, body: cur };
			},
			CALENDAR_LANGUAGE,
		);
		if (!result.ok) return result.code === 'rejected' ? { ok: false, code: 'rejected', reason: result.reason } : { ok: false, code: 'stale' };
		out = result.newText;
	}
	return { ok: true, text: out };
}
