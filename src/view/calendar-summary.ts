/*
 * The title and the summary line of a section of the Calendars window (spec §14 rule 16), with no DOM. A closed section shows its calendar as one line, for example
 * "Cycle calendar · 60 years · 2 formats · Planets"; the line follows the draft on every change. The texts are in `render/calendar-text.ts`.
 */

import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { formatsOf, wholeOf, type CalendarDraft } from './calendar-draft';
import type { ListDraft } from './calendar-list-draft';

/** The names of the lists, or "No name list". */
export function listsSummary(lists: readonly ListDraft[]): string {
	return lists.length === 0 ? T.summaryNoLists : T.summaryLists(lists.map((l) => l.name.trim() || T.summaryUnnamedList));
}

/** The title of the section of a calendar: its name, or its kind while the name is empty. */
export const calendarTitle = (d: CalendarDraft): string => d.name.trim() || (d.kind === 'cycles' ? T.kindCycles : T.kindEras);

/** The line under the title of a closed calendar: the kind, the length and the formats (a cycle calendar) or the eras (an era calendar), and the name lists. */
export function calendarSummary(d: CalendarDraft): string {
	const parts: string[] = [d.kind === 'cycles' ? T.kindCycles : T.kindEras];
	if (d.kind === 'cycles') {
		const length = wholeOf(d.length);
		if (typeof length === 'number' && length >= 1) parts.push(T.summaryYears(length));
		parts.push(T.summaryFormats(formatsOf(d.formats, d.formatsWas).length));
	} else {
		parts.push(T.summaryEras(d.eras.map((e) => e.name.trim()).filter((n) => n !== '')));
	}
	parts.push(listsSummary(d.lists));
	return parts.join(' · ');
}
