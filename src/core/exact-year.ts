/*
 * The exact year of a date text (0.5 step 1a, D304 and D306; an internal study §5). The relation words compare years only
 * when both years are certain, so this file says which date texts give a certain year. It is not a second date reader: a shape gate decides
 * if a plain text is only a date, and the year itself always comes from the graph's reader (`DateReader.read`), so a calendar date and a
 * plain year are compared as internal years. A text with a qualifier ("c. 1135", "before 1135", "1130–35", "1135?") has no exact year,
 * and neither has any text while the calendar reader is not ready. Pure; it never throws.
 */

import { isExactCalendarRead, MEMO_CAP, type DateReader } from './dates';

// "jan" to "dec", the long forms, and "sept".
const MON = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY = '(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?';
const Y = '\\d{1,4}';
const ERA = '(?:a\\.?\\s*d\\.?|c\\.?\\s*e\\.?|b\\.?\\s*c\\.?(?:\\s*e\\.?)?)';
const SHAPES: readonly RegExp[] = [
	`-?${Y}`,
	`${Y}\\s*${ERA}`,
	`${ERA}\\s*${Y}`,
	`(?:${DAY}\\s+)?${MON},?\\s+${Y}(?:\\s*${ERA})?`,
	`${MON}\\s+${DAY},\\s*${Y}(?:\\s*${ERA})?`,
	`${DAY}\\s+of\\s+${MON},?\\s+${Y}`,
	'\\d{1,2}([/.-])\\d{1,2}\\1\\d{3,4}',
	'\\d{1,4}-\\d{2}-\\d{2}',
].map((s) => new RegExp(`^${s}$`, 'i'));

/** True if a plain text is only a date of one of the shapes of RULES §5.2 (item 4). The year is not read here. */
function isDateShape(text: string): boolean {
	const t = text.trim().replace(/−/g, '-');
	return SHAPES.some((re) => re.test(t));
}

function compute(text: string, reader: DateReader): number | undefined {
	const r = reader.read(text);
	if (!r || r.year === undefined || r.approx || r.dual || r.samePlace || r.warnings.length) return undefined;
	if (r.source === 'calendar') return isExactCalendarRead(r) ? r.year : undefined;
	// A plain year that the reader set `whole` is a bare year with names of the year list after it.
	return r.source === 'plain' && (r.whole || isDateShape(text)) ? r.year : undefined;
}

// One memo for each reader: a reader never changes after it is made, and a new reader (a new calendar set) starts a new memo.
const MEMOS = new WeakMap<DateReader, Map<string, number | null>>();

/**
 * The year of `text` if it is exact, as the reader reads it (an internal year), else undefined. A year is exact only if the reader is
 * ready, reads a year, shows no qualifier, warning or dual date, and the text is only that date (a calendar date: the whole text; a
 * plain text: one of the shapes of RULES §5.2). Memoised for each reader.
 */
export function exactYear(text: string | undefined, reader: DateReader): number | undefined {
	if (typeof text !== 'string' || text === '' || !reader.ready) return undefined;
	let memo = MEMOS.get(reader);
	if (!memo) MEMOS.set(reader, (memo = new Map<string, number | null>()));
	const known = memo.get(text);
	if (known !== undefined) return known ?? undefined;
	const year = compute(text, reader);
	if (memo.size >= MEMO_CAP) memo.clear();
	memo.set(text, year ?? null);
	return year;
}
