// Helpers of the name-list tests (spec §14 rules 13 to 16, WP-6 step 1): small builders for calendars with name lists.
import type { Calendar, ListName, NameList } from '../../src/core/dates';

/** The seven planets of the contract's example; "Saturn (Sa)" is the first. */
export const PLANETS: ListName[] = [
	{ name: 'Saturn', short: 'Sa' },
	{ name: 'Jupiter', short: 'Ju' },
	{ name: 'Mars', short: 'Ma' },
	{ name: 'Sun', short: 'Su' },
	{ name: 'Venus', short: 'Ve' },
	{ name: 'Mercury', short: 'Me' },
	{ name: 'Moon', short: 'Mo' },
];

/** A name list; by default Planets with the marker `planet`, and 1273 = Saturn. */
export function list(over: Partial<NameList> = {}): NameList {
	return { name: 'Planets', marker: 'planet', names: PLANETS, known: { year: 1273, index: 0 }, show: 'short', ...over };
}

/** A cycle calendar. */
export function cycles(name: string, formats: string[], lists?: NameList[], length = 60, start = 1, note = 'C.md'): Calendar {
	return { id: `${note}#0#0`, name, note, formats, kind: { type: 'cycles', length, start }, ...(lists ? { lists } : {}) };
}

/** An era calendar. */
export function eras(name: string, list: { name: string; start: number; length?: number }[], formats = ['{era} {year}'], lists?: NameList[], note = 'C.md'): Calendar {
	return { id: `${note}#0#0`, name, note, formats, kind: { type: 'eras', eras: list }, ...(lists ? { lists } : {}) };
}
