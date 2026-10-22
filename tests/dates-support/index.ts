/*
 * Shared helpers of the WP-4 acceptance tests (`tests/dates-*.test.ts`).
 *
 * The tests are written from spec §14 and the dates seam in the architecture notes §5.7. This file declares the shape of the API of
 * `src/core/dates.ts` locally, as the tests read it, and exports the real module under that shape as `datesApi`.
 */

import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import * as dates from '../../src/core/dates';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../../src/core/succession';
import { cardLabel, dateLine } from '../../src/render/tree-info';
import type { Person, Title, Tree } from '../../src/core/types';

// ---------- The frozen API of src/core/dates.ts (the architecture notes §5.7), declared here ----------

/** The architecture notes §5.7 `Calendar`. */
export interface CalendarDef {
	id: string;
	name: string;
	note: string;
	formats: string[];
	kind: { type: 'cycles'; length: number; start: number } | { type: 'eras'; eras: { name: string; start: number; length?: number }[] };
}

/** The architecture notes §5.7 `DateWarning`. */
export type DateWarningKey = 'year-zero' | 'calendar-year-zero' | 'calendar-year-past-end' | 'fits-two-calendars' | 'calendar-name-mismatch';

/** The architecture notes §5.7 `ReadDate`. */
export interface ReadDateT {
	text: string;
	year?: number;
	approx?: true;
	source: 'plain' | 'calendar' | 'none';
	calendar?: string;
	span?: string;
	count?: number;
	also?: string[];
	dual?: true;
	samePlace?: true;
	warnings: DateWarningKey[];
}

/** The architecture notes §5.7 `CalendarProblem`. */
export interface CalendarProblemT {
	key: 'calendar-note-missing' | 'calendar-duplicate';
	calendar?: string;
	note?: string;
	other?: string;
}

/** The architecture notes §5.7 `DateReader`. */
export interface DateReaderT {
	readonly ready: boolean;
	read(text: string | undefined): ReadDateT | undefined;
	readonly key: string;
	readonly problems: CalendarProblemT[];
}

/** The architecture notes §5.7 `TreeDates`. */
export interface TreeDatesT {
	readonly reader: DateReaderT;
	readonly ready: boolean;
	read(text: string | undefined): ReadDateT | undefined;
	latestYear(): number | undefined;
	unanchored(): string[];
}

/** The exports of `src/core/dates.ts` that the tests use (the architecture notes §5.7). */
export interface DatesApi {
	compileCalendars(calendars: CalendarDef[], ready: boolean, problems?: CalendarProblemT[]): DateReaderT;
	PLAIN_READER: DateReaderT;
	buildTreeDates(reader: DateReaderT, people: readonly Person[], titles: readonly Title[]): TreeDatesT;
	formatInternalYear(y: number): string;
	checkFormat(kind: 'cycles' | 'eras', format: string): string | null;
	checkCalendars(calendars: CalendarDef[]): { calendar: string; key: string; other?: string }[];
	findCrossNoteDuplicates(calendars: CalendarDef[]): CalendarProblemT[];
	startFromSameYear(example: { cycle?: number; year: number }, otherInternalYear: number, length?: number): number;
	exampleText(calendar: CalendarDef, internalYear: number): string | null;
}

/** `src/core/dates.ts` under the shape that the tests use. */
export const datesApi = dates as unknown as DatesApi;

// ---------- The calendars of the owner's doc (spec §14 rule 2 and the special-cases table) ----------

/** The cycle calendar of the doc: cycles of 60 years, Year 1 of Cycle 1 is internal year 1. */
export const LONG_COUNT: CalendarDef = {
	id: 'Calendars.md#0#0',
	name: 'The Long Count',
	note: 'Calendars.md',
	formats: ['{year} Year of the {cycle} Cycle', 'Year {year} of Cycle {cycle}'],
	kind: { type: 'cycles', length: 60, start: 1 },
};

/** The era calendar of the doc: Qinglong Emperor 130 to 140, Jianwen Emperor from 141 with no length. */
export const REIGN_NAMES: CalendarDef = {
	id: 'Calendars.md#0#1',
	name: 'Reign names',
	note: 'Calendars.md',
	formats: ['{year} Year of the {era}', '{era} {year}'],
	kind: {
		type: 'eras',
		eras: [
			{ name: 'Qinglong Emperor', start: 130, length: 11 },
			{ name: 'Jianwen Emperor', start: 141 },
		],
	},
};

/** Two eras that share one year: Shōwa 64 and Heisei 1 are both 1989 (spec §14 rule 1). */
export const JAPAN: CalendarDef = {
	id: 'Calendars.md#0#2',
	name: 'Japan',
	note: 'Calendars.md',
	formats: ['{era} {year}'],
	kind: {
		type: 'eras',
		eras: [
			{ name: 'Shōwa', start: 1926, length: 64 },
			{ name: 'Heisei', start: 1989, length: 31 },
		],
	},
};

/** A third-person calendar with easy numbers: Aldric 1 is internal 1100, so "Aldric N" is 1099 + N. Length 50. */
export const ALDRIC: CalendarDef = {
	id: 'Realm.md#0#0',
	name: 'Aldric',
	note: 'Realm.md',
	formats: ['{era} {year}'],
	kind: { type: 'eras', eras: [{ name: 'Aldric', start: 1100, length: 50 }] },
};

/** A calendar for the longest-name rule; the short name is listed first on purpose. */
export const QING: CalendarDef = {
	id: 'Prefix.md#0#0',
	name: 'Qing names',
	note: 'Prefix.md',
	formats: ['{era} {year}'],
	kind: {
		type: 'eras',
		eras: [
			{ name: 'Qing', start: 500 },
			{ name: 'Qing Emperor', start: 600 },
		],
	},
};

/** The copy that a sync conflict makes: the same calendar in another note, with another id and name. */
export function copyOf(c: CalendarDef, note: string, patch: Partial<CalendarDef> = {}): CalendarDef {
	return { ...c, id: `${note}#0#0`, name: `${c.name} (copy)`, note, ...patch };
}

/** Every calendar of the doc together: the "full calendar set" of the sample-tree regression. */
export const FULL_SET: CalendarDef[] = [
	LONG_COUNT,
	REIGN_NAMES,
	JAPAN,
	ALDRIC,
	{
		id: 'More.md#0#0',
		name: 'Age of Stars',
		note: 'More.md',
		formats: ['Year {year} of the {cycle} Age', '{year} AS'],
		kind: { type: 'cycles', length: 1000, start: 1 },
	},
	{
		id: 'More.md#0#1',
		name: 'Dynasties',
		note: 'More.md',
		formats: ['{era} dynasty, year {year}', 'year {year} of the {era} dynasty'],
		kind: { type: 'eras', eras: [{ name: 'Tang', start: 618, length: 289 }, { name: 'Song', start: 960 }] },
	},
];

// ---------- Trees and lines ----------

/** Parses a block; throws on a hard error. */
export function parse(source: string): Tree {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(`parse: ${parsed.error.code}`);
	return parsed.tree;
}

/** Builds the graph of a block with a reader (the option of the architecture notes §5.7); without a reader, the graph of today. */
export function graphOf(source: string, reader?: DateReaderT): FamilyGraph {
	const derive = deriveFamilies as unknown as (tree: Tree, options?: Record<string, unknown>) => FamilyGraph;
	return derive(parse(source), reader ? { dates: reader } : {});
}

/** The line of the first title of `source`, read with `reader`. The spec comes from the keys of the title. */
export function lineOf(source: string, reader?: DateReaderT, patch: Partial<SuccessionSpec> = {}, limit = 99, oldAge = 110): SuccessionResult & Record<string, unknown> {
	const g = graphOf(source, reader);
	return successionLine(g, g.titles[0], { ...specOf(g.titles[0]), ...patch }, limit, oldAge) as SuccessionResult & Record<string, unknown>;
}

/** The notes of a line result, as plain objects (the architecture notes §5.7 adds the kind `died-no-year`). */
export function notesOf(res: SuccessionResult, kind: string): { kind: string; params: Record<string, string | string[]> }[] {
	return (res.notes as unknown as { kind: string; params: Record<string, string | string[]> }[]).filter((n) => n.kind === kind);
}

/** The date warnings of a line result (the architecture notes §5.7). */
export function warningsOf(res: Record<string, unknown>): { warning: string; id?: string; entry?: number; what: string; text: string }[] {
	return (res.dateWarnings ?? []) as { warning: string; id?: string; entry?: number; what: string; text: string }[];
}

/** The issue codes of a graph (the tree warning list), as plain strings so that new codes need no type. */
export function issueCodes(g: FamilyGraph): string[] {
	return g.issues.map((i) => String(i.code));
}

/** A person with only the fields a date test needs. */
export function person(p: Partial<Person> & { id: string; name: string }): Person {
	return { parents: [], illegitimate: false, index: 0, ...p };
}

/** True when `x` names calendar `c` (the architecture notes §5.7 ruling 1: a ReadDate names a calendar by name). */
export function names(x: string | undefined, c: CalendarDef): boolean {
	return x === c.id || x === c.name;
}

/** The calendars (id or name) that a read date names: `calendar` first, then `also`. */
export function namedBy(r: ReadDateT | undefined): string[] {
	return r ? [...(r.calendar !== undefined ? [r.calendar] : []), ...(r.also ?? [])] : [];
}

/** The `dateLine` of a person with a dates view; the second parameter is required from step 4.2. */
export function dateLineWith(p: Person, dates: Pick<TreeDatesT, 'read'>): string | undefined {
	return (dateLine as unknown as (p: Person, d: unknown) => string | undefined)(p, dates);
}

/** The screen-reader label of a card with a dates view; the last parameter is required from step 4.2. */
export function cardLabelWith(p: Person, dates: Pick<TreeDatesT, 'read'>): string {
	return (cardLabel as unknown as (p: Person, r: undefined, l: undefined, i: undefined, d: unknown) => string)(p, undefined, undefined, undefined, dates);
}

/** `successionLine` with an explicit dates view as the last parameter (the architecture notes §5.7), for a draft title. */
export function lineWithDates(g: FamilyGraph, spec: Partial<SuccessionSpec>, dates: Pick<TreeDatesT, 'read'>): SuccessionResult & Record<string, unknown> {
	const run = successionLine as unknown as (g: FamilyGraph, t: Title, s: SuccessionSpec, limit: number, oldAge: number, young: number, d: unknown) => SuccessionResult;
	return run(g, g.titles[0], { ...specOf(g.titles[0]), ...spec }, 99, 110, 0, dates) as SuccessionResult & Record<string, unknown>;
}
