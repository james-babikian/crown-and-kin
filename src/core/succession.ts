/*
 * The line of succession of a title: the people who come after the ruler,
 * in order, under the rule and the switches that the title names, and the open branches (dead people with no children in
 * the tree) that stand between the heirs. It reads the family graph of the whole tree and
 * changes nothing. The Titles window and the Show view call `successionLine`; `specOf` turns the keys of a title into
 * the shape the engine reads, and the window passes its draft in the same shape.
 *
 * It also covers the birth-year order of brothers and sisters (D193, slot-fill), a holder entry that holds the title through the
 * spouse (D195, spec §13.21 rule 13a), co-rulers that are never in the line, the climb in the order of the note,
 * and `SuccessionResult.notes` for the quiet notes of the window. The walks themselves are in `succession-engine.ts`, `succession-pass.ts`,
 * `succession-rank.ts` and `succession-ctx.ts`; this file reads the title, builds the result and holds the date and holder helpers.
 */

import type { TreeDates } from './dates';
import type { FamilyGraph } from './derive';
import { makeContext, type Holders, type Item } from './succession-ctx';
import { bornNoYear, dateRows, deathNotes, findRuler, fitsTwoCalendars, lineYear, makeLife, missingBirthYears, personTexts, yearNotes, type DateText, type DateWarningRow, type Life, type NoYearRow, type YearReader } from './succession-dates';
import { makeEngine } from './succession-engine';
import { firstHolderOf, spouseWorldOf } from './succession-first';
import { isDead, readInherit, readRule, resolveSpouse, type SpouseWorld } from './succession-keys';
import type { SuccessionNote, SuccessionSpec } from './succession-types';
import type { Holder, Person, Title } from './types';

export type { SuccessionNote, SuccessionSpec } from './succession-types';

/** The keys of a title as the engine reads them. */
export function specOf(title: Title): SuccessionSpec {
	const bad = title.badKeys ?? {};
	const rule = readRule(title.succession);
	const inherit = readInherit(title.inherit);
	const spec: SuccessionSpec = { inherit: inherit ?? 'no-preference', illegitimate: title.inheritIllegitimate ?? 'no', adopted: title.inheritAdopted === true };
	if (title.heirsOfBody) spec.body = true;
	if (rule) spec.rule = rule;
	if (title.inheritThrough) spec.inheritThrough = title.inheritThrough;
	if (title.year !== undefined) spec.year = title.year;
	if (title.heirs?.length) spec.heirs = [...title.heirs];
	if (title.exclude?.length) spec.exclude = [...title.exclude];
	if (bad.succession !== undefined || (title.succession !== undefined && !rule)) spec.bad = 'succession';
	else if (bad.inherit !== undefined || (title.inherit !== undefined && !inherit)) spec.bad = 'inherit';
	else if (bad['inherit-through'] !== undefined) spec.bad = 'inherit-through';
	else if (bad['inherit-illegitimate'] !== undefined) spec.bad = 'inherit-illegitimate';
	return spec;
}

/** What the line is: a list of heirs, or the reason there is none. */
export type SuccessionKind = 'line' | 'no-rule' | 'no-ruler' | 'ruler-not-in-tree' | 'bad-rule';

/** Why a named heir is first in the line, or is not. */
export type NamedHeirState = 'first' | 'not-alive' | 'not-born' | 'is-ruler' | 'not-in-tree' | 'excluded';

/** The line of succession and the facts the Titles window shows with it. */
export interface SuccessionResult {
	kind: SuccessionKind;
	/** The year Y of the line; null for "now". */
	year: number | null;
	yearFrom: 'field' | 'reign-end' | 'now';
	/** The text that gives Y (the title `year`, else the `to` of the last holder), as written; null for "now". Every sentence of the line names this text (spec §14 rule 7). */
	yearText: string | null;
	/** The ruler R: the person the line is computed after. */
	ruler?: string;
	heirs: string[];
	/** True when the line has more people than `limit`. */
	more: boolean;
	namedHeirs: { id: string; state: NamedHeirState }[];
	/** Holders other than R who rule at the same time. */
	coRulers: string[];
	/** A holder entry or a person whose date text has no year. `entry` is the `index` of the holder entry. Empty before the calendars are ready (spec §14 rule 7). */
	noYear: NoYearRow[];
	/** People that a one-sex rule or pass left out only because they have no `sex: m` or `sex: f`. */
	leftOutNoSex: number;
	/** Heirs in the returned line with no birth year, only for `born-in-reign`. */
	noBirthYear: number;
	/** Heirs in the returned line older than `oldAge` years with no death date. */
	old: string[];
	/** The first holder H; only with the switch `heirs-of-body` on and a rule. */
	firstHolder?: string;
	/** The switch is on and no pass found H above R, so only the named heirs are in the line. */
	outsideBody: boolean;
	/** Open branches, in line order; `before` is the index in `heirs` before which the row stands. */
	openBranches: { id: string; before: number }[];
	/** More open branches than the cap (`limit`) in the shown line. */
	moreBranches: boolean;
	/** Quiet notes for the window (see `SuccessionNote`); empty when there is nothing to say. */
	notes: SuccessionNote[];
	/** Spec §14 rule 5: the warnings of the date texts the line read (the title year, the holder texts and the dates of the people in the line), and `calendar-no-anchor`. Empty before the calendars are ready. */
	dateWarnings: DateWarningRow[];
}

const empty = (kind: SuccessionKind, year: number | null, yearFrom: SuccessionResult['yearFrom'], yearText: string | null = null): SuccessionResult => ({
	kind,
	year,
	yearFrom,
	yearText,
	heirs: [],
	more: false,
	namedHeirs: [],
	coRulers: [],
	noYear: [],
	leftOutNoSex: 0,
	noBirthYear: 0,
	old: [],
	outsideBody: false,
	openBranches: [],
	moreBranches: false,
	notes: [],
	dateWarnings: [],
});

/** The list `a`, then the items of `b` that `a` does not have, in the order of `b`. */
function merge(a: string[], b: string[]): string[] {
	const seen = new Set(a);
	return [...a, ...b.filter((x) => !seen.has(x))];
}

/** What `successionLine` finds before the rule runs: the year of the line, the ruler's entry and the date texts read so far. */
interface Setup {
	Y: number | null;
	yearFrom: SuccessionResult['yearFrom'];
	yearText: string | null;
	entries: readonly Holder[];
	rIdx: number;
	/** The holder of the ruler's entry; `R` in `successionLine` is its spouse when the entry is keyed. */
	X: string;
	noYear: NoYearRow[];
	texts: DateText[];
}

/** The year, the ruler and the holder texts; or the finished result when there is no ruler to compute the line after. */
function setupOf(g: FamilyGraph, title: Title, spec: SuccessionSpec, dates: TreeDates, yr: YearReader): Setup | SuccessionResult {
	const entries = title.holders;
	// The year of the line, and the text that gives it (the sentences of the line name that text, spec §14 rule 7).
	const { Y, yearFrom, yearText } = lineYear(entries, spec.year, yr);
	// The ruler, and the holder texts with no year (a note shows only when the calendars are ready, rule 7).
	const found = findRuler(entries, Y, yearFrom, yr, fitsTwoCalendars(dates));
	const rIdx = found.rIdx;
	const noYear = dates.ready ? found.noYear : [];
	// The date texts the line reads: the title year and the holder texts. People are added later.
	const texts: DateText[] = [...(spec.year !== undefined ? [{ text: spec.year, what: 'year' as const }] : []), ...found.reads];
	if (rIdx < 0) return { ...empty('no-ruler', Y, yearFrom, yearText), noYear, dateWarnings: dateRows(dates, texts) };
	const ruler = entries[rIdx].person !== undefined && g.byId.has(entries[rIdx].person) ? entries[rIdx].person : undefined;
	if (ruler === undefined) return { ...empty('ruler-not-in-tree', Y, yearFrom, yearText), noYear, dateWarnings: dateRows(dates, texts) };
	return { Y, yearFrom, yearText, entries, rIdx, X: ruler, noYear, texts };
}

/**
 * D195, rule 13a: a holder entry with `through-spouse` (up to R's entry) is read as its spouse S. The key is ignored when
 * no spouse can be found (`validate.ts` warns). Without a rule there is no line and the key changes nothing.
 */
function spouseEntries(g: FamilyGraph, entries: readonly Holder[], rIdx: number, spec: SuccessionSpec): Map<number, string> {
	const spouseAt = new Map<number, string>();
	if (!spec.rule) return spouseAt;
	let world: SpouseWorld | undefined;
	let holderIds: string[] | undefined;
	for (let i = 0; i <= rIdx; i++) {
		const e = entries[i];
		if (e.throughSpouse === undefined || e.person === undefined || !g.byId.has(e.person)) continue;
		world ??= spouseWorldOf(g);
		holderIds ??= entries.flatMap((h) => (h.person !== undefined && g.byId.has(h.person) ? [h.person] : []));
		const s = resolveSpouse(world, e.person, e.throughSpouse, holderIds);
		if (s.ok) spouseAt.set(i, s.id);
	}
	return spouseAt;
}

/** The named heirs come first: the state of each, and the ones who stand first in the line. */
function namedHeirsOf(g: FamilyGraph, spec: SuccessionSpec, R: string, X: string, Y: number | null, life: Life, excluded: ReadonlySet<string>): { namedHeirs: SuccessionResult['namedHeirs']; first: string[] } {
	const namedHeirs: SuccessionResult['namedHeirs'] = [];
	const first: string[] = [];
	const named = new Set<string>();
	for (const id of spec.heirs ?? []) {
		if (named.has(id)) continue;
		named.add(id);
		let state: NamedHeirState;
		if (!g.byId.has(id)) state = 'not-in-tree';
		// R, and the holder of a keyed entry (D195: the holder and the spouse both are "the ruler"). A co-ruler is left to the ruler's choice.
		else if (id === R || id === X) state = 'is-ruler';
		else if (excluded.has(id)) state = 'excluded';
		else if (!life.alive(g.byId.get(id)!)) state = Y !== null && (life.born(g.byId.get(id)!) ?? -Infinity) > Y ? 'not-born' : 'not-alive';
		else {
			state = 'first';
			first.push(id);
		}
		namedHeirs.push({ id, state });
	}
	return { namedHeirs, first };
}

/** The open-branch rows. `before` counts the named heirs and the rule-line heirs that stay after the merge. */
function branchRows(items: readonly Item[], first: readonly string[], heirCount: number, max: number): { rows: SuccessionResult['openBranches']; moreBranches: boolean } {
	const firstSet = new Set(first);
	let pos = first.length;
	let rows: SuccessionResult['openBranches'] = [];
	for (const it of items) {
		if (it.branch) rows.push({ id: it.id, before: pos });
		else if (!firstSet.has(it.id)) pos++;
	}
	rows = rows.filter((r) => r.before <= heirCount);
	const moreBranches = rows.length > max;
	return { rows: moreBranches ? rows.slice(0, max) : rows, moreBranches };
}

/**
 * The line after the ruler. Pure. `title.holders` is the list the caller wants (the window passes
 * a copy). `limit` is the length of the line; `oldAge` is the age in years from which an heir with no death date gets
 * a warning (0 for none). `youngDeathAge` is the age under which a death opens no branch (0 for none). `dates` reads every
 * date text (spec §14): the graph's own, or another view when the window passes a draft. Before the calendars are ready it reads
 * plain years and reports no date note and no date warning (rule 7).
 */
export function successionLine(g: FamilyGraph, title: Title, spec: SuccessionSpec, limit: number, oldAge: number, youngDeathAge = 0, dates: TreeDates = g.dates): SuccessionResult {
	if (spec.bad) return empty('bad-rule', null, 'now');
	const hasHeirs = (spec.heirs?.length ?? 0) > 0;
	if (!spec.rule && !hasHeirs) return empty('no-rule', null, 'now');

	const yr: YearReader = (text) => dates.read(text)?.year;
	const setup = setupOf(g, title, spec, dates, yr);
	if ('kind' in setup) return setup;
	const { Y, yearFrom, yearText, entries, rIdx, X, noYear, texts } = setup;
	const spouseAt = spouseEntries(g, entries, rIdx, spec);
	// R is the person the line is computed after: the spouse of a keyed ruler entry. `X` stays the holder (the result's `ruler`).
	const R: string = spouseAt.get(rIdx) ?? X;

	const P = (id: string): Person => g.byId.get(id)!;
	const excluded = new Set(spec.exclude ?? []);
	const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;

	// Alive at Y, the birth year of a person, and the people whose death text has no year (spec §14 rule 5).
	const life = makeLife(g.people, Y, yr, dates.ready && Y !== null);

	// The holders who rule at the same time as R.
	const coRulers = findCoRulers(g, entries, X, Y, startedFor(entries, Y, yr), yr);

	// The rule line.
	const rule = spec.rule;
	// The first holder, only read when the switch is on.
	const bodyFirst = spec.body ? firstHolderOf(g, entries, spouseAt) : null;
	const firstHolder = bodyFirst?.id;
	// Who held the title (an open branch needs none of them), who the climb follows, and who is never in the line (D195).
	const hold = holdersOf(g, entries, rIdx, R, X, spouseAt, coRulers);
	const engine = rule ? makeEngine(makeContext(g, entries, spec, rule, R, Y, life, excluded, firstHolder, youngDeathAge, hold, spouseAt, yr)) : undefined;
	const items = engine ? engine.line() : [];
	const ruleLine = items.filter((i) => !i.branch).map((i) => i.id);

	const { namedHeirs, first } = namedHeirsOf(g, spec, R, X, Y, life, excluded);
	const all = merge(first, ruleLine);
	const heirs = all.slice(0, max);
	const { rows, moreBranches } = branchRows(items, first, heirs.length, max);

	// The births that the line read and could not use.
	const readsBorn = Y !== null || rule === 'born-in-reign';
	const shownNamed = namedHeirs.filter((n) => n.state === 'first' || n.state === 'not-alive').map((n) => n.id);
	const people = merge(heirs, shownNamed);
	if (readsBorn) noYear.push(...bornNoYear(people.map(P), dates));
	const noBirthYear = missingBirthYears(rule === 'born-in-reign' && dates.ready, heirs, (id) => life.born(P(id)));
	// The reference year with "now" scans the whole tree: do it once, and only if an heir needs it.
	const old = oldAge > 0 ? heirs.filter((id) => isOld(P(id), () => (Y !== null ? Y : dates.latestYear()), oldAge, yr)) : [];

	// The notes. The order of the groups is the order the window shows them in.
	const notes: SuccessionNote[] = [];
	if (spouseAt.has(rIdx)) notes.push({ kind: 'through-spouse', params: { holder: X, spouse: R } });
	if (coRulers.length) notes.push({ kind: 'co-rulers-not-in-line', params: {} });
	if (engine && bodyFirst && bodyFirst.index > 0) {
		const skipped = entries[0];
		notes.push({ kind: 'body-skipped', params: { first: bodyFirst.id, entry: skipped.name ?? skipped.person ?? '' } });
	}
	if (engine) notes.push(...yearNotes(dates.ready, engine.notes(new Set(heirs))));
	// Spec §14 rule 5: a death date with no year, for the people the line meets (the note names the text that gives Y).
	notes.push(...deathNotes(life, P, namedHeirs, rows, max, yearText));

	// Spec §14 rule 5: the warnings of the date texts of the people in the line.
	for (const id of people) texts.push(...personTexts(P(id)));

	return {
		kind: 'line',
		year: Y,
		yearFrom,
		yearText,
		ruler: X,
		heirs,
		more: all.length > max,
		namedHeirs,
		coRulers,
		noYear,
		leftOutNoSex: engine ? engine.leftOutNoSex(new Set(all)) : 0,
		noBirthYear,
		old,
		outsideBody: engine ? engine.outsideBody() : false,
		openBranches: rows,
		moreBranches,
		notes,
		dateWarnings: dateRows(dates, texts, life.texts()),
		...(engine && firstHolder !== undefined ? { firstHolder } : {}),
	};
}

/** Who held the title, who the climb follows as an earlier holder, and who is never in the line. */
function holdersOf(g: FamilyGraph, entries: readonly Holder[], rIdx: number, R: string, X: string, spouseAt: ReadonlyMap<number, string>, coRulers: readonly string[]): Holders {
	const earlier = new Set<string>();
	const held = new Set<string>([R, X, ...coRulers]);
	for (let i = 0; i < rIdx; i++) {
		const id = entries[i].person;
		if (id === undefined || !g.byId.has(id)) continue;
		held.add(id);
		const s = spouseAt.get(i);
		if (s === undefined) earlier.add(id);
		else {
			// The spouse takes the place of the holder; a spouse who is R is not added.
			held.add(s);
			if (s !== R) earlier.add(s);
		}
	}
	const blocked = new Set<string>(coRulers);
	if (spouseAt.has(rIdx)) blocked.add(X);
	return { earlier, held, blocked };
}

/** True when the entry at index `i` has started at `Y`, for every entry in the list (the test for the ruler, without the stop). */
function startedFor(entries: readonly Holder[], Y: number | null, yr: YearReader): boolean[] {
	let maxTo = -Infinity;
	return entries.map((h) => {
		const from = yr(h.from);
		const started = Y === null ? true : from !== undefined ? from <= Y : !(maxTo > Y);
		const to = yr(h.to);
		if (to !== undefined) maxTo = Math.max(maxTo, to);
		return started;
	});
}

/**
 * Entries other than R's with a person in the tree, a `from` year <= Y, that have not ended at Y. The years are read
 * once; `later[i]` is the largest start year among the entries after `i` that have started (an entry with no start year
 * counts as infinite), so the "ended" test of an entry with no `to` year is one comparison.
 */
function findCoRulers(g: FamilyGraph, entries: readonly Holder[], R: string, Y: number | null, started: boolean[], yr: YearReader): string[] {
	const n = entries.length;
	const from = entries.map((e) => yr(e.from));
	const to = entries.map((e) => yr(e.to));
	const later: number[] = new Array<number>(n);
	let best = -Infinity;
	for (let i = n - 1; i >= 0; i--) {
		later[i] = best;
		if (started[i]) best = Math.max(best, from[i] ?? Infinity);
	}
	const out = new Set<string>();
	for (let i = 0; i < n; i++) {
		const id = entries[i].person;
		const f = from[i];
		if (id === undefined || id === R || !g.byId.has(id) || out.has(id)) continue;
		if (f === undefined || (Y !== null && f > Y)) continue;
		const t = to[i];
		const ended = t !== undefined ? Y === null || t <= Y : later[i] > f;
		if (!ended) out.add(id);
	}
	return [...out];
}

/** An heir with no death date who is older than `oldAge` years at the reference year (`ref`, read when first needed). */
function isOld(p: Person, ref: () => number | undefined, oldAge: number, yr: YearReader): boolean {
	if (isDead(p)) return false;
	const by = yr(p.born);
	if (by === undefined) return false;
	const r = ref();
	return r !== undefined && r - by > oldAge;
}
