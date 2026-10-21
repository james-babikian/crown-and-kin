/*
 * The grey line under Born and Died in the person window, and the test line of the Calendars window (spec §14 rule 6). It tells how the plugin reads a date
 * text that is not a plain year: the calendar, the cycle or era and the year in it, and the internal year as a whole number; "Fits two calendars"; or "No year
 * found". A plain year, and an empty field, give no line. Two exceptions: an old double date (`1700/01`) shows the year that the plugin reads, and a calendar
 * match shows the warning of rule 5 after it. The line is not a warning of the tree. Pure; the texts are in `calendar-text.ts`.
 */

import type { ReadDate } from '../core/dates';
import { DATE_READOUT_UI as T } from './calendar-text';

/** The warning sentences that follow a calendar match, one for each warning of rule 5 that applies to a calendar date. */
function warningTails(r: ReadDate): string[] {
	return [...(r.warnings.includes('calendar-year-zero') ? [T.yearZero] : []), ...(r.warnings.includes('calendar-year-past-end') ? [T.pastEnd] : [])];
}

/**
 * The grey line for the read of one date text; '' when no line shows. `text` is the field as typed: an empty field gives no line. The read comes from the
 * reader of the tree (`TreeDates.read`), which reads a draft text as well as a saved one. `ready` is the `ready` of that reader.
 */
export function dateReadout(text: string, r: ReadDate | undefined, ready = true): string {
	if (text.trim() === '') return '';
	// A reader that is not ready reads plain years only: "No year found" would be wrong for a date that a calendar will read.
	if (!ready) return '';
	if (!r) return T.noYear;
	if (r.samePlace) return T.samePlace;
	const names = [...(r.calendar !== undefined ? [r.calendar] : []), ...(r.also ?? [])];
	if (r.warnings.includes('fits-two-calendars')) return T.fitsTwo(names);
	if (r.source === 'calendar' && r.year !== undefined && r.calendar !== undefined && r.span !== undefined && r.count !== undefined) {
		const rest = [...(r.also?.length ? [T.alsoSame(r.also)] : []), ...warningTails(r)].join(' ');
		const match = T.match(r.calendar, r.span, r.count, r.year);
		return rest ? `${match}. ${rest}` : match;
	}
	if (r.source === 'plain' && r.dual && r.year !== undefined) return T.dual(r.year);
	if (r.source === 'plain' && r.year !== undefined) return '';
	return T.noYear;
}
