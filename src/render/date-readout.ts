/*
 * The grey line under Born and Died in the person window, and the test line of the Calendars window (spec §14 rule 6). It tells how the plugin reads a date
 * text that is not a plain year: the calendar, the cycle or era and the year in it, and the internal year as a whole number; "Fits two calendars"; or "No year
 * found". A plain year, and an empty field, give no line. Three exceptions: an old double date (`1700/01`) shows the year that the plugin reads, a calendar
 * match shows the warning of rule 5 after it, and a date with name lists (spec §14 rule 15) gets one sentence for each list, "Planets: Saturn.", after the year; a whole
 * plain year with a plain-year list has this line too. A written name that is wrong for its year adds the sentence of the mismatch. The line shows the full names, also when the
 * cards show the short form. The line is not a warning of the tree. The sentence of a wrong written name is a separate part (`dateReadoutParts`), because the windows
 * show it on a text line of its own with a warning mark. Pure; the texts are in `calendar-text.ts`.
 */

import { nameMismatches, type ReadDate } from '../core/dates';
import { DATE_READOUT_UI as T } from './calendar-text';

/** The warning sentences that follow a calendar match, one for each warning of rule 5 that applies to a calendar date. */
function warningTails(r: ReadDate): string[] {
	return [...(r.warnings.includes('calendar-year-zero') ? [T.yearZero] : []), ...(r.warnings.includes('calendar-year-past-end') ? [T.pastEnd] : [])];
}

/** One sentence of the line; `warning` marks the sentence of a wrong written name (spec §14 rule 14), which the windows show on a text line of its own. */
interface Sentence {
	text: string;
	warning?: true;
}

/**
 * One sentence for each name list of the date, in list order (spec §14 rule 15). A list with a wrong written name (rule 14) gets the sentence of the mismatch in place of "<list>: <name>."
 * (it says the right name too); a mismatch of a list that the date does not name follows at the end.
 */
function nameSentences(r: ReadDate): Sentence[] {
	const wrong = new Map(nameMismatches(r).map((m) => [m.list, m]));
	const mismatch = (m: { list: string; expected: string; written: string }): Sentence => ({ text: T.nameMismatch(m.list, m.expected, m.written), warning: true });
	const out = (r.names ?? []).map((n): Sentence => {
		const m = wrong.get(n.list);
		wrong.delete(n.list);
		return m ? mismatch(m) : { text: T.listName(n.list, n.name) };
	});
	return [...out, ...[...wrong.values()].map(mismatch)];
}

/** The two parts of the line: the reading of the date, and the warning about a wrong written name (empty when there is none). */
export interface ReadoutParts {
	reading: string;
	warning: string;
}

const plainParts = (reading: string): ReadoutParts => ({ reading, warning: '' });
const sentenceText = (list: readonly Sentence[]): string => list.map((x) => x.text).join(' ');

/**
 * The line for the read of one date text, in two parts: `reading` is grey and `warning` (the sentence of a wrong written name) stands on its own text line.
 * `text` is the field as typed: an empty field gives no line. The read comes from the reader of the tree (`TreeDates.read`), which reads a draft text as well
 * as a saved one. `ready` is the `ready` of that reader.
 */
export function dateReadoutParts(text: string, r: ReadDate | undefined, ready = true): ReadoutParts {
	if (text.trim() === '') return plainParts('');
	// A reader that is not ready reads plain years only: "No year found" would be wrong for a date that a calendar will read.
	if (!ready) return plainParts('');
	if (!r) return plainParts(T.noYear);
	if (r.samePlace) return plainParts(T.samePlace);
	const names = [...(r.calendar !== undefined ? [r.calendar] : []), ...(r.also ?? [])];
	if (r.warnings.includes('fits-two-calendars')) return plainParts(T.fitsTwo(names));
	if (r.source === 'calendar' && r.year !== undefined && r.calendar !== undefined && r.span !== undefined && r.count !== undefined) {
		const all: Sentence[] = [...nameSentences(r), ...(r.also?.length ? [{ text: T.alsoSame(r.also) }] : []), ...warningTails(r).map((x) => ({ text: x }))];
		const rest = sentenceText(all.filter((x) => !x.warning));
		const warning = sentenceText(all.filter((x) => x.warning));
		const match = T.match(r.calendar, r.span, r.count, r.year);
		return { reading: rest ? `${match}. ${rest}` : warning ? `${match}.` : match, warning };
	}
	if (r.source === 'plain' && r.dual && r.year !== undefined) return plainParts(T.dual(r.year));
	if (r.source === 'plain' && r.year !== undefined) {
		const all = nameSentences(r);
		return { reading: sentenceText(all.filter((x) => !x.warning)), warning: sentenceText(all.filter((x) => x.warning)) };
	}
	return plainParts(T.noYear);
}

/** The line as one text: the two parts of `dateReadoutParts` with a space between; '' when no line shows. */
export function dateReadout(text: string, r: ReadDate | undefined, ready = true): string {
	const { reading, warning } = dateReadoutParts(text, r, ready);
	return [reading, warning].filter((x) => x !== '').join(' ');
}
