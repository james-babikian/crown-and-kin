/*
 * The date readers of the plugin, with a limit on the length of a date text (spec §14 rule 9, ruling 4.3 fix). A calendar matcher walks a text character by
 * character, so a very long text (a note, a pasted page) in a date field would cost time for nothing. A text longer than `MAX_DATE_TEXT` is not a date: it is
 * read by the plain reader, which finds the year only at the start. The limit lives here, in the view layer, so `src/core/dates.ts` stays as it is.
 */

import { PLAIN_READER, compileCalendars, type Calendar, type CalendarProblem, type DateReader, type NameList } from '../core/dates';

/** The longest text, in characters, that a calendar matcher reads. */
export const MAX_DATE_TEXT = 500;

/** The reader `reader` for texts of up to `MAX_DATE_TEXT` characters; a longer text goes to the plain reader. */
export function capReader(reader: DateReader): DateReader {
	return {
		ready: reader.ready,
		key: reader.key,
		problems: reader.problems,
		hasLists: reader.hasLists,
		read: (text) => (typeof text === 'string' && text.length > MAX_DATE_TEXT ? PLAIN_READER.read(text) : reader.read(text)),
	};
}

/** `compileCalendars` with the limit of `capReader`; `plainLists` are the name lists of the plain years. */
export const compileCapped = (calendars: Calendar[], ready: boolean, problems: CalendarProblem[] = [], plainLists: NameList[] = []): DateReader => capReader(compileCalendars(calendars, ready, problems, plainLists));
