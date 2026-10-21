/*
 * The date side of the Titles window's line of succession (spec §14 rules 5 and 7), kept out of `succession-section.ts` so that file does not grow:
 * the label of the ruler (the holder text of the reign that the line's year reaches, read through the tree's dates) and the quiet note for a date
 * warning that the line met. Pure.
 */

import type { FamilyGraph } from '../core/derive';
import { codedIssue, issueText, type IssueParams } from '../core/messages';
import type { SuccessionNote, SuccessionResult } from '../core/succession';
import type { DateWarningRow } from '../core/succession-dates';
import { SUCCESSION_UI as T } from '../render/ui-text';
import { holderText, type HolderRow } from './titles-draft';

/** "Aldric II": the ruler text of the holder entry of `id` that the year reaches; else `name`. `year` is the internal year of the line (null for "now"). */
export function rulerLabelOf(g: FamilyGraph, holders: readonly HolderRow[], id: string, year: number | null, name: string): string {
	let pick: string | null = null;
	for (const h of holders) {
		if (h.values.person !== id) continue;
		const from = g.dates.read(h.values.from)?.year;
		if (pick === null || year === null || from === undefined || from <= year) pick = holderText(g, h.values).ruler;
	}
	return pick || name;
}

/** The sentence of a date warning row of the line (`SuccessionResult.dateWarnings`): the sentence of the warning list of the tree, with the owner of the date named. */
export function dateWarningText(row: DateWarningRow, g: FamilyGraph, nameOf: (id: string) => string, title: string): string {
	if (row.warning === 'calendar-no-anchor') return issueText(codedIssue('calendar-no-anchor', 'warning', { calendar: row.text }));
	const r = g.dates.read(row.text);
	const base: IssueParams = { where: row.what, value: row.text, ...(row.id !== undefined ? { person: nameOf(row.id) } : { title }) };
	const calendars = [...(r?.calendar !== undefined ? [r.calendar] : []), ...(r?.also ?? [])];
	return issueText(codedIssue(row.warning, 'warning', row.warning === 'fits-two-calendars' ? { ...base, calendars } : base));
}

/**
 * The quiet notes that stand after the rows of the line: a note of a person with no row (out of the line only for a death date with no year; the notes of people with a
 * row stand under that row) and then the date warnings that the line met. `under` holds the notes by person, as the section made them.
 */
export function afterNotes(res: SuccessionResult, g: FamilyGraph, under: ReadonlyMap<string, { n: SuccessionNote; text: string }[]>, nameOf: (id: string) => string, title: string): { text: string; kind: string }[] {
	const rows = new Set([...res.heirs, ...res.openBranches.map((b) => b.id)]);
	const strays = [...under].filter(([id]) => !rows.has(id)).flatMap(([, xs]) => xs.map((x) => ({ text: x.text, kind: x.n.kind as string })));
	return [...strays, ...res.dateWarnings.map((w) => ({ text: dateWarningText(w, g, nameOf, title), kind: 'date-warning' }))];
}

/**
 * The quiet notes under a named heir (G.6): why the heir is not used (not alive, not born yet, the ruler, excluded), a birth date with no year and, for a
 * death date with no year (spec §14 rule 5), the note that says how the line counts the heir. The sentences name the year as it is written.
 */
export function heirNotes(res: SuccessionResult | null, id: string, nameOf: (id: string) => string): { text: string; note: string }[] {
	if (!res) return [];
	const name = nameOf(id);
	const state = res.namedHeirs.find((h) => h.id === id)?.state;
	const said = { 'not-alive': T.heirNotAlive(name, res.yearText), 'not-born': T.heirNotBorn(name, res.yearText), 'is-ruler': T.heirIsRuler(name), excluded: T.heirExcluded(name) };
	const dead = res.notes.find((n) => n.kind === 'died-no-year' && n.params.person === id);
	return [
		...(state && state in said ? [{ text: said[state as keyof typeof said], note: state }] : []),
		...(res.noYear.some((n) => n.id === id && n.what === 'born') ? [{ text: T.noYearDate(name), note: 'no-year' }] : []),
		...(dead ? [{ text: T.diedNoYear(name, String(dead.params.year ?? '')), note: 'died-no-year' }] : []),
	];
}
