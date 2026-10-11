/*
 * The line of succession of a title (contract 0.2.7, sections B, C, J, K and M): the people who come after the ruler,
 * in order, under the rule and the switches that the title names, and the open branches (dead people with no children in
 * the tree) that stand between the heirs. It reads the family graph of the whole tree and
 * changes nothing. The Titles window and the Show view call `successionLine`; `specOf` turns the keys of a title into
 * the shape the engine reads, and the window passes its draft in the same shape.
 *
 * 0.2.8 adds: the birth-year order of brothers and sisters (D193, slot-fill), a holder entry that holds the title through the
 * spouse (D195, spec §13.21 rule 13a), co-rulers that are never in the line (S2), the climb in the order of the note
 * (F-KIN-11), and `SuccessionResult.notes` for the quiet notes of the window.
 */

import { drawnParentMap, partnerOf, type DrawnParent, type FamilyGraph } from './derive';
import { isDead, readInherit, readRule, resolveSpouse, yearOf, type InheritRule, type InheritThrough, type SpouseWorld, type SuccessionRule } from './succession-keys';
import type { Holder, Person, Title } from './types';

/** The succession keys of one title as the engine reads them; the Titles window passes its draft in the same shape. */
export interface SuccessionSpec {
	rule?: SuccessionRule;
	inherit: InheritRule;
	/** K.1: who passes a claim on. Absent: the test of `inherit` decides (C.3). */
	inheritThrough?: InheritThrough;
	illegitimate: 'no' | 'after' | 'equal';
	adopted: boolean;
	/** L.1: only the first holder and the people who descend from the first holder can inherit. */
	body?: boolean;
	year?: string;
	/** K.3: the named heirs in order. */
	heirs?: string[];
	/** K.3: the people who are never in the line. */
	exclude?: string[];
	/** Set by `specOf` when a written value cannot be used (A.5): the line is 'bad-rule'. */
	bad?: 'succession' | 'inherit' | 'inherit-through' | 'inherit-illegitimate';
}

/** The keys of a title as the engine reads them (A.1). */
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

/**
 * A quiet note under or above the line (0.2.8 contract B.2, an internal note §2.1). The window turns `kind` and `params` into a text of
 * `SUCCESSION_UI`. Params hold person ids, except `entry` of `body-skipped`, which is the name written in the holder entry.
 * - `order-from-note` {a, b}: two neighbouring children of one parent, in line order, ordered only by the order in the note;
 *   {a, b, reason: 'same-year'} when both have the same birth year (without `reason`, a birth year is missing).
 * - `order-contradiction` {people}: birth years and the order in the note do not agree for these children, in written order.
 * - `co-rulers-not-in-line` {}: the other holders (`coRulers`) are not in the line.
 * - `born-in-reign-no-from` {parent}: the parent holds this title, but no entry has a readable start year, so the children keep their rank.
 * - `through-spouse` {holder, spouse}: the holder holds the title through the spouse; the line is for the spouse.
 * - `body-skipped` {first, entry}: with `heirs-of-body`, the first holder is `first` because the first entry `entry` is not a person in the tree.
 */
export interface SuccessionNote {
	kind: 'order-from-note' | 'order-contradiction' | 'co-rulers-not-in-line' | 'born-in-reign-no-from' | 'through-spouse' | 'body-skipped';
	params: Record<string, string | string[]>;
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
	/** The ruler R: the person the line is computed after. */
	ruler?: string;
	heirs: string[];
	/** True when the line has more people than `limit`. */
	more: boolean;
	namedHeirs: { id: string; state: NamedHeirState }[];
	/** K.6: holders other than R who rule at the same time. */
	coRulers: string[];
	/** J.2: a holder entry or a person whose date text has no year. `entry` is the `index` of the holder entry. */
	noYear: { id: string; what: 'born' | 'reign'; entry?: number }[];
	/** K.9: people that a one-sex rule or pass left out only because they have no `sex: m` or `sex: f`. */
	leftOutNoSex: number;
	/** K.8: heirs in the returned line with no birth year, only for `born-in-reign`. */
	noBirthYear: number;
	/** K.8: heirs in the returned line older than `oldAge` years with no death date. */
	old: string[];
	/** L.5: the first holder H; only with the switch `heirs-of-body` on and a rule. */
	firstHolder?: string;
	/** L.5: the switch is on and no pass found H above R, so only the named heirs are in the line. */
	outsideBody: boolean;
	/** M.4: open branches, in line order; `before` is the index in `heirs` before which the row stands. */
	openBranches: { id: string; before: number }[];
	/** M.4: more open branches than the cap (`limit`) in the shown line. */
	moreBranches: boolean;
	/** 0.2.8: quiet notes for the window (see `SuccessionNote`); empty when there is nothing to say. */
	notes: SuccessionNote[];
}

/** M.2: a line entry inside the engine, an heir or an open branch. */
interface Item {
	id: string;
	branch?: true;
}
const itemKey = (i: Item) => (i.branch ? 'b:' : 'h:') + i.id;
function mergeItems(a: Item[], b: Item[]): Item[] {
	const seen = new Set(a.map(itemKey));
	return [...a, ...b.filter((x) => !seen.has(itemKey(x)))];
}

/** L.9: `to` texts that mean the reign is not over. */
const OPEN_END: readonly string[] = ['present', 'now', 'current', 'ongoing', 'living', 'alive', 'reigning'];
const NONE: Person[] = [];
const NONE_DRAWN: DrawnParent[] = [];
const NO_IDS: string[] = [];

const empty = (kind: SuccessionKind, year: number | null, yearFrom: SuccessionResult['yearFrom']): SuccessionResult => ({
	kind,
	year,
	yearFrom,
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
});

/** The list `a`, then the items of `b` that `a` does not have, in the order of `b`. */
function merge(a: string[], b: string[]): string[] {
	const seen = new Set(a);
	return [...a, ...b.filter((x) => !seen.has(x))];
}

/** The claim children of each person for one reading of the flag `illegitimate` (C.2), in written order. */
type ClaimKids = Map<string, Person[]>;

/**
 * The line after the ruler (sections B and C). Pure. `title.holders` is the list the caller wants (the window passes
 * a copy). `limit` is the length of the line; `oldAge` is the age in years from which an heir with no death date gets
 * a warning (0 for none). `youngDeathAge` (M.1) is the age under which a death opens no branch (0 for none).
 */
export function successionLine(g: FamilyGraph, title: Title, spec: SuccessionSpec, limit: number, oldAge: number, youngDeathAge = 0): SuccessionResult {
	if (spec.bad) return empty('bad-rule', null, 'now');
	const hasHeirs = (spec.heirs?.length ?? 0) > 0;
	if (!spec.rule && !hasHeirs) return empty('no-rule', null, 'now');

	const entries = title.holders;
	// B.2: the year of the line.
	let Y: number | null;
	let yearFrom: SuccessionResult['yearFrom'];
	const fieldYear = yearOf(spec.year);
	const lastTo = entries.length ? yearOf(entries[entries.length - 1].to) : undefined;
	if (fieldYear !== undefined) [Y, yearFrom] = [fieldYear, 'field'];
	else if (lastTo !== undefined) [Y, yearFrom] = [lastTo, 'reign-end'];
	else [Y, yearFrom] = [null, 'now'];

	// L.9: a holder text with no year is reported only when it could change R: the entries the B.3 scan reads up to R's
	// entry, and the last entry when the year of the line comes from it. A `to` that means "still ruling" is an open end.
	const noYear: SuccessionResult['noYear'] = [];
	const reigned = new Set<number>();
	const reignText = (h: Holder, fromToo: boolean, toToo: boolean) => {
		if (reigned.has(h.index)) return;
		const unreadable = (text: string | undefined) => text !== undefined && yearOf(text) === undefined;
		if ((fromToo && unreadable(h.from)) || (toToo && unreadable(h.to) && !OPEN_END.includes(h.to!.trim().toLowerCase()))) {
			reigned.add(h.index);
			noYear.push({ id: h.person ?? h.name ?? '', what: 'reign', entry: h.index });
		}
	};

	// B.3: the ruler. An entry has started at Y when Y is now, its `from` year is <= Y, or it has no `from` year and
	// no earlier entry ends after Y.
	const startedAt = (i: number, maxTo: number): boolean => {
		if (Y === null) return true;
		const from = yearOf(entries[i].from);
		return from !== undefined ? from <= Y : !(maxTo > Y);
	};
	let rIdx = -1;
	let maxTo = -Infinity;
	for (let i = 0; i < entries.length; i++) {
		if (!startedAt(i, maxTo)) {
			// The entry that did not start: a year in its `from` could have started it, so its `from` text is reported.
			reignText(entries[i], Y !== null, false);
			break;
		}
		// With "now" every entry has started, so no `from` text can change R.
		reignText(entries[i], Y !== null, false);
		rIdx = i;
		const to = yearOf(entries[i].to);
		if (to !== undefined) maxTo = Math.max(maxTo, to);
	}
	// The `to` of an entry before R fed the start test of a later entry. R's own `to` feeds the test of the next entry only,
	// and it decides nothing when the title names the year. The `to` of the last entry gives the year of the line.
	for (let i = 0; i <= rIdx && Y !== null; i++) if (i < rIdx || (yearFrom !== 'field' && i < entries.length - 1)) reignText(entries[i], false, true);
	if (yearFrom !== 'field' && entries.length) reignText(entries[entries.length - 1], false, true);
	noYear.sort((p, q) => p.entry! - q.entry!);
	if (rIdx < 0) return { ...empty('no-ruler', Y, yearFrom), noYear };
	const ruler = entries[rIdx].person !== undefined && g.byId.has(entries[rIdx].person!) ? entries[rIdx].person! : undefined;
	if (ruler === undefined) return { ...empty('ruler-not-in-tree', Y, yearFrom), noYear };
	const X: string = ruler;

	// D195, rule 13a: a holder entry with `through-spouse` (up to R's entry) is read as its spouse S. The key is ignored when
	// no spouse can be found (`validate.ts` warns). Without a rule there is no line and the key changes nothing.
	const spouseAt = new Map<number, string>();
	if (spec.rule) {
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
	}
	// R is the person the line is computed after: the spouse of a keyed ruler entry. `X` stays the holder (the result's `ruler`).
	const R: string = spouseAt.get(rIdx) ?? X;

	const P = (id: string): Person => g.byId.get(id)!;
	const excluded = new Set(spec.exclude ?? []);

	// B.4: alive at Y. The answer is kept for each person (`index` is the place in the written list).
	let size = 0;
	for (const p of g.people) if (p.index >= size) size = p.index + 1;
	const aliveMemo = new Int8Array(size);
	// The birth year of a person, read once (NaN for no year).
	const yearKnown = new Uint8Array(size);
	const yearValue = new Float64Array(size);
	const bornOf = (p: Person): number | undefined => {
		if (!yearKnown[p.index]) {
			const y = yearOf(p.born);
			yearValue[p.index] = y === undefined ? NaN : y;
			yearKnown[p.index] = 1;
		}
		const v = yearValue[p.index];
		return Number.isNaN(v) ? undefined : v;
	};
	const bornYear = (id: string) => bornOf(P(id));
	const aliveOf = (p: Person): boolean => {
		let a = aliveMemo[p.index];
		if (a === 0) {
			let alive: boolean;
			if (Y === null) alive = !isDead(p);
			else {
				const by = bornYear(p.id);
				if (by !== undefined && by > Y) alive = false;
				else if (!isDead(p)) alive = true;
				else {
					const dy = yearOf(p.died);
					alive = dy !== undefined && dy > Y;
				}
			}
			a = alive ? 1 : 2;
			aliveMemo[p.index] = a;
		}
		return a === 1;
	};
	const aliveAt = (id: string) => aliveOf(P(id));

	// K.6: the holders who rule at the same time as R.
	const coRulers = findCoRulers(g, entries, X, Y, startedFor(entries, Y));

	// The rule line.
	const rule = spec.rule;
	// L.2: the first holder is the first entry, in list order, whose person is in the tree; D195: its spouse if the entry has the key.
	const firstIdx = spec.body ? entries.findIndex((e) => e.person !== undefined && g.byId.has(e.person)) : -1;
	const firstHolder = firstIdx >= 0 ? spouseAt.get(firstIdx) ?? entries[firstIdx].person : undefined;
	// Who held the title (an open branch needs none of them), who the climb follows, and who is never in the line (S2, D195).
	const hold = holdersOf(g, entries, rIdx, R, X, spouseAt, coRulers);
	const engine = rule ? makeEngine(g, entries, spec, rule, R, Y, aliveOf, bornYear, bornOf, excluded, firstHolder, youngDeathAge, hold, spouseAt) : undefined;
	const items = engine ? engine.line() : [];
	const ruleLine = items.filter((i) => !i.branch).map((i) => i.id);

	// K.3: the named heirs come first.
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
		else if (!aliveAt(id)) state = Y !== null && (bornYear(id) ?? -Infinity) > Y ? 'not-born' : 'not-alive';
		else {
			state = 'first';
			first.push(id);
		}
		namedHeirs.push({ id, state });
	}
	const all = merge(first, ruleLine);
	const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
	const heirs = all.slice(0, max);
	// M.3: the rows. `before` counts the named heirs and the rule-line heirs that stay after the merge.
	const firstSet = new Set(first);
	let pos = first.length;
	let rows: { id: string; before: number }[] = [];
	for (const it of items) {
		if (it.branch) rows.push({ id: it.id, before: pos });
		else if (!firstSet.has(it.id)) pos++;
	}
	rows = rows.filter((r) => r.before <= heirs.length);
	const moreBranches = rows.length > max;
	if (moreBranches) rows = rows.slice(0, max);

	// J.2: the births that the line read and could not use.
	const readsBorn = Y !== null || rule === 'born-in-reign';
	if (readsBorn) {
		const ids = merge(heirs, namedHeirs.filter((n) => n.state === 'first' || n.state === 'not-alive').map((n) => n.id));
		for (const id of ids) {
			const born = P(id).born;
			if (born !== undefined && yearOf(born) === undefined) noYear.push({ id, what: 'born' });
		}
	}
	const noBirthYear = rule === 'born-in-reign' ? heirs.filter((id) => bornYear(id) === undefined).length : 0;
	// The reference year with "now" scans the whole tree: do it once, and only if an heir needs it.
	let latest: number | undefined;
	let latestDone = false;
	const reference = () => {
		if (Y !== null) return Y;
		if (!latestDone) [latest, latestDone] = [latestYear(g), true];
		return latest;
	};
	const old = oldAge > 0 ? heirs.filter((id) => isOld(P(id), reference, oldAge)) : [];

	// 0.2.8: the notes. The order of the groups is the order the window shows them in.
	const notes: SuccessionNote[] = [];
	if (spouseAt.has(rIdx)) notes.push({ kind: 'through-spouse', params: { holder: X, spouse: R } });
	if (coRulers.length) notes.push({ kind: 'co-rulers-not-in-line', params: {} });
	if (engine && firstHolder !== undefined && firstIdx > 0) {
		const skipped = entries[0];
		notes.push({ kind: 'body-skipped', params: { first: firstHolder, entry: skipped.name ?? skipped.person ?? '' } });
	}
	if (engine) notes.push(...engine.notes(new Set(heirs)));

	return {
		kind: 'line',
		year: Y,
		yearFrom,
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
		...(engine && firstHolder !== undefined ? { firstHolder } : {}),
	};
}

/** The partners and the birth and adoptive parents of the family graph, in the form the partner choice reads (spec §13.21 rule 13a). */
function spouseWorldOf(g: FamilyGraph): SpouseWorld {
	const drawn = drawnParentMap(g);
	return {
		partners: (id) =>
			(g.unionsOf.get(id) ?? []).map((key) => {
				const fu = g.unionByKey.get(key)!;
				return { id: partnerOf(fu, id), type: fu.type };
			}),
		claimParents: (id) => [...new Set((drawn.get(id) ?? []).filter((d) => d.type === 'birth' || d.type === 'adoptive').map((d) => d.id))],
		exists: (id) => g.byId.has(id),
	};
}

/** Who held the title, who the climb follows as an earlier holder, and who is never in the line. */
interface Holders {
	/** The persons of the entries before R's entry, a keyed entry by its spouse; the climb follows them (rule 13). */
	earlier: Set<string>;
	/** Everyone who held the title as far as an open branch is concerned: the persons as written, the spouses, R, the holder and the co-rulers (rule 23). */
	held: Set<string>;
	/** Never in the line, but they still pass a claim: the co-rulers (S2) and the holder of a keyed ruler entry (D195). */
	blocked: Set<string>;
}

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

/** True when the entry at index `i` has started at `Y`, for every entry in the list (the B.3 test without the stop). */
function startedFor(entries: readonly Holder[], Y: number | null): boolean[] {
	let maxTo = -Infinity;
	return entries.map((h) => {
		const from = yearOf(h.from);
		const started = Y === null ? true : from !== undefined ? from <= Y : !(maxTo > Y);
		const to = yearOf(h.to);
		if (to !== undefined) maxTo = Math.max(maxTo, to);
		return started;
	});
}

/**
 * K.6: entries other than R's with a person in the tree, a `from` year <= Y, that have not ended at Y. The years are read
 * once; `later[i]` is the largest start year among the entries after `i` that have started (an entry with no start year
 * counts as infinite), so the "ended" test of an entry with no `to` year is one comparison.
 */
function findCoRulers(g: FamilyGraph, entries: readonly Holder[], R: string, Y: number | null, started: boolean[]): string[] {
	const n = entries.length;
	const from = entries.map((e) => yearOf(e.from));
	const to = entries.map((e) => yearOf(e.to));
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

/** K.8: an heir with no death date who is older than `oldAge` years at the reference year (`ref`, read when first needed). */
function isOld(p: Person, ref: () => number | undefined, oldAge: number): boolean {
	if (isDead(p)) return false;
	const by = yearOf(p.born);
	if (by === undefined) return false;
	const r = ref();
	return r !== undefined && r - by > oldAge;
}

/** The latest year in the `born`, `died`, `from` and `to` texts of the whole tree. */
function latestYear(g: FamilyGraph): number | undefined {
	let latest: number | undefined;
	const see = (text: string | undefined) => {
		const y = yearOf(text);
		if (y !== undefined && (latest === undefined || y > latest)) latest = y;
	};
	for (const p of g.people) {
		see(p.born);
		see(p.died);
	}
	for (const t of g.titles) {
		for (const h of t.holders) {
			see(h.from);
			see(h.to);
		}
	}
	return latest;
}

/** The pieces of one pass: the sex tests that follow from `inherit`. */
interface PassKind {
	inherit: Exclude<InheritRule, 'men-first-in-house' | 'women-first-in-house'>;
}

/** What the rest of `successionLine` needs from the walks. */
interface Engine {
	line(): Item[];
	leftOutNoSex(inLine: ReadonlySet<string>): number;
	outsideBody(): boolean;
	/** The notes of the walks (0.2.8): D202 order notes, S3; only for people in the shown line (`shown`). */
	notes(shown: ReadonlySet<string>): SuccessionNote[];
}

/**
 * The walks of C.4 to C.8a. The line is built from passes: the illegitimacy passes (C.4a) outside, the sex passes
 * (C.8a) inside. Each pass has its own climb, walk and sort. Everything that does not depend on the pass is made once.
 */
function makeEngine(
	g: FamilyGraph,
	entries: readonly Holder[],
	spec: SuccessionSpec,
	rule: SuccessionRule,
	R: string,
	Y: number | null,
	alive: (p: Person) => boolean,
	bornYear: (id: string) => number | undefined,
	yearAt: (p: Person) => number | undefined,
	excluded: ReadonlySet<string>,
	body: string | undefined,
	youngDeath: number,
	hold: Holders,
	spouseAt: ReadonlyMap<number, string>,
): Engine {
	const P = (id: string): Person => g.byId.get(id)!;
	const drawn = drawnParentMap(g);
	const noSex = new Set<string>();
	// L.4: passes that found the first holder above R, and passes that did not.
	let reached = 0;
	let lapsed = 0;
	// `Person.index` is the place in the written list: it is unique and small, so flags can sit in an array.
	let size = 0;
	for (const p of g.people) if (p.index >= size) size = p.index + 1;

	// C.2: does the link from a drawn parent to a child carry a claim, for one reading of the flag `illegitimate`?
	const carries = (d: DrawnParent, child: Person, illOn: boolean) => (d.type === 'birth' && (!child.illegitimate || illOn)) || (d.type === 'adoptive' && spec.adopted);
	// The claim children of each person, built when a pass needs them (one build for each reading of the flag).
	const kidsCache = new Map<boolean, ClaimKids>();
	const kidsFor = (illOn: boolean): ClaimKids => {
		let kids = kidsCache.get(illOn);
		if (kids) return kids;
		kids = new Map();
		for (const child of g.people) {
			const ds = drawn.get(child.id);
			if (!ds) continue;
			for (let i = 0; i < ds.length; i++) {
				const d = ds[i];
				if (!carries(d, child, illOn) || (i > 0 && ds.some((e, j) => j < i && e.id === d.id && carries(e, child, illOn)))) continue;
				const siblings = kids.get(d.id);
				if (siblings) siblings.push(child);
				else kids.set(d.id, [child]);
			}
		}
		kidsCache.set(illOn, kids);
		return kids;
	};

	// The earlier holders: the persons of the entries before R's entry (C.6), a keyed entry by its spouse (D195).
	const earlier = hold.earlier;

	// Born during a reign of the parent (key 2 of C.4): the reigns with a start year, by person.
	const reigns = new Map<string, { from: number; to?: number }[]>();
	if (rule === 'born-in-reign') {
		entries.forEach((h, i) => {
			const from = yearOf(h.from);
			if (h.person === undefined || from === undefined) return;
			const to = yearOf(h.to);
			// D195: the years of a keyed entry are also reigns of the spouse.
			for (const id of [h.person, spouseAt.get(i)]) {
				if (id === undefined) continue;
				const list = reigns.get(id) ?? [];
				list.push(to === undefined ? { from } : { from, to });
				reigns.set(id, list);
			}
		});
	}

	const through = spec.inheritThrough;

	// What the walks note for the window (0.2.8): D202 pairs and breaks of the order, S3 parents. Filled by `rank` in every pass.
	const pairs = new Map<string, [string, string, boolean]>();
	const loops = new Map<string, string[]>();
	const noFrom = new Map<string, string[]>();
	// S3: the people who hold the title in an entry with no readable start year (a keyed entry holds for its spouse too).
	const unstarted = new Set<string>();
	if (rule === 'born-in-reign') {
		entries.forEach((h, i) => {
			if (h.person === undefined || yearOf(h.from) !== undefined) return;
			unstarted.add(h.person);
			const spouse = spouseAt.get(i);
			if (spouse !== undefined) unstarted.add(spouse);
		});
	}
	// The primary parents are the ones the edit sheet orders brothers and sisters by (it moves a person among the same parents).
	// A placement list holds at most two ids, so the test is a few comparisons.
	const sameParents = (a: string, b: string): boolean => {
		const x = g.placementParents.get(a) ?? NO_IDS;
		const y = g.placementParents.get(b) ?? NO_IDS;
		if (x.length !== y.length) return false;
		if (x.length < 2) return x.length === 0 || x[0] === y[0];
		return (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
	};
	// M.1: a person who has a child in the tree by a birth, adoptive or rumoured link has a drawn family; a ward link does not count (D191). Made on first need.
	let parentOf: Set<string> | undefined;
	const hasChild = (id: string): boolean => {
		if (!parentOf) {
			parentOf = new Set();
			// I42: a person who lists the same person as a parent (a self-listing) is no child; a cycle link still is.
			for (const q of g.people) for (const r of q.parents) if (r.type !== 'ward' && r.id !== q.id && g.byId.has(r.id)) parentOf.add(r.id);
		}
		return parentOf.has(id);
	};
	// M.1: dead at Y (not alive and not just unborn), not R, not closed, no child, not too young at death.
	const openBranch = (x: Person): boolean => {
		// M.1: R, and a person who held the title before R (the title passed on, so the line of the holder is closed).
		if (x.id === R || hold.held.has(x.id) || alive(x)) return false;
		if (Y !== null && (bornYear(x.id) ?? -Infinity) > Y) return false;
		if (x.childless === true || hasChild(x.id)) return false;
		if (youngDeath > 0) {
			const b = bornYear(x.id);
			const d = yearOf(x.died);
			if (b !== undefined && d !== undefined && d - b < youngDeath) return false;
		}
		return true;
	};
	const reverse = rule === 'youngest-child';

	/** One pass: the line for one illegitimacy reading and one single-sex form of `inherit`. */
	function pass(illOn: boolean, inh: PassKind['inherit']): Item[] {
		const kidsOf = kidsFor(illOn);
		const claimKids = (x: string) => kidsOf.get(x) ?? NONE;
		// The parents of x whose link carries a claim, once each, in drawn order.
		const claimParents = (x: string): string[] => {
			const out: string[] = [];
			for (const d of drawn.get(x) ?? NONE_DRAWN) if (carries(d, P(x), illOn) && !out.includes(d.id)) out.push(d.id);
			return out;
		};

		// C.3, K.1: who may stand in the line (`eligible`) and whose claim children are followed (`passes`).
		const only = inh === 'men-only' ? 'm' : inh === 'women-only' ? 'f' : undefined;
		const sexOk = (x: Person) => only === undefined || x.sex === only;
		const needs = through === undefined ? only : through === 'anyone' ? undefined : through === 'men' ? 'm' : 'f';
		const passesP = (x: Person) => needs === undefined || x.sex === needs;
		// A person with no sex who is left out by a one-sex test is counted (K.9) when something is lost: an heir, or a claim.
		const lost = (x: Person) => {
			if (x.sex !== 'm' && x.sex !== 'f') noSex.add(x.id);
		};
		const passes = (id: string): boolean => {
			const x = P(id);
			const ok = passesP(x);
			if (!ok && claimKids(id).length) lost(x);
			return ok;
		};
		const stepPref = inh === 'men-first' ? 'm' : inh === 'women-first' ? 'f' : undefined;
		const parentPref = inh === 'men-first' || inh === 'men-only' ? 'm' : inh === 'women-first' || inh === 'women-only' ? 'f' : undefined;
		const step = (x: Person) => (stepPref === undefined ? 0 : x.sex === stepPref ? 0 : 1);

		// The people who descend from an earlier holder through people who pass (the holder is not tested). Made on the
		// first need: the climb asks only when a person has several claim parents and none of them held the title.
		let descends: Set<string> | undefined;
		const descendsFrom = (p: string): boolean => {
			if (!descends) {
				descends = new Set();
				const opened = new Set<string>();
				for (const h of earlier) {
					if (opened.has(h)) continue;
					opened.add(h);
					const stack = [h];
					while (stack.length) {
						for (const k of claimKids(stack.pop()!)) {
							if (descends.has(k.id)) continue;
							descends.add(k.id);
							if (!opened.has(k.id) && passesP(k)) {
								opened.add(k.id);
								stack.push(k.id);
							}
						}
					}
				}
			}
			return descends.has(p);
		};

		// L.3: the first holder and the people who descend from the first holder through people who pass (the holder is not
		// tested). Made on the first need; each pass has its own, as its reading of `illegitimate` and its sex test can differ.
		let bodySet: Set<string> | undefined;
		const inBody = (p: string): boolean => {
			if (!bodySet) {
				bodySet = new Set([body!]);
				const stack = [body!];
				while (stack.length) {
					for (const k of claimKids(stack.pop()!)) {
						if (bodySet.has(k.id)) continue;
						bodySet.add(k.id);
						if (passesP(k)) stack.push(k.id);
					}
				}
			}
			return bodySet.has(p);
		};

		// K.2: the parents followed from x. L.4: with the switch on, only parents in the body, over claim links.
		// The preferred sex first, then the order of `parents` in the note (F-KIN-11); the drawn order only lists the parents.
		const noteOrder = (x: string, ids: string[]): string[] => {
			if (ids.length < 2) return ids;
			const written = P(x).parents;
			const at = (id: string) => {
				const i = written.findIndex((r) => r.id === id);
				return i < 0 ? Infinity : i;
			};
			return ids.slice().sort((a, b) => at(a) - at(b));
		};
		const order = (x: string, ids: string[]) => {
			const inNote = noteOrder(x, ids);
			return parentPref === undefined || inNote.length < 2 ? inNote : [...inNote.filter((p) => P(p).sex === parentPref), ...inNote.filter((p) => P(p).sex !== parentPref)];
		};
		const nextParents = (x: string): string[] => {
			const holders: string[] = [];
			for (const d of drawn.get(x) ?? []) {
				if (d.type === 'ward' || d.type === 'rumoured' || !earlier.has(d.id) || holders.includes(d.id)) continue;
				if (body !== undefined && !(carries(d, P(x), illOn) && inBody(d.id))) continue;
				if (through === undefined || passes(d.id)) holders.push(d.id);
			}
			if (holders.length) return order(x, holders);
			const followed = claimParents(x).filter(passes).filter((q) => body === undefined || inBody(q));
			const near = followed.length < 2 ? followed : followed.filter((p) => earlier.has(p) || descendsFrom(p));
			return order(x, near.length ? near : followed);
		};

		// `up`: R and the ancestors that carry the claim, breadth first, with their distance from R.
		const up = [R];
		const dist = new Map<string, number>([[R, 0]]);
		for (let i = 0; i < up.length; i++) {
			for (const p of nextParents(up[i])) {
				if (dist.has(p)) continue;
				dist.set(p, dist.get(up[i])! + 1);
				up.push(p);
			}
		}
		// L.4: a pass whose climb does not reach the first holder has no line.
		if (body !== undefined) {
			if (!dist.has(body)) {
				lapsed++;
				return [];
			}
			reached++;
		}
		// Everyone above R over claim links, passing or not: none of them is ever in the line.
		const ancestors = new Set<string>();
		for (const stack = [R]; stack.length; ) {
			for (const q of claimParents(stack.pop()!)) {
				if (ancestors.has(q)) continue;
				ancestors.add(q);
				stack.push(q);
			}
		}
		const walkable = (u: string) => (through === undefined ? true : passes(u));

		// C.4: the claim children of one person in sibling rank.
		const reigning = rule === 'born-in-reign';
		const reignOk = (parent: string, child: Person): boolean => {
			const by = bornYear(child.id);
			return by !== undefined && (reigns.get(parent) ?? []).some((r) => by >= r.from && (r.to === undefined || by <= r.to));
		};
		// D193 key 3 (slot-fill): the children with a birth year are put in year order, the earlier first, and fill the places
		// that the dated children hold in the written order; a child with no year keeps its place and equal years keep the written order.
		const slotFill = (group: Person[]): Person[] => {
			let last = -Infinity;
			let sorted = true;
			let dated = 0;
			for (let i = 0; i < group.length; i++) {
				const y = yearAt(group[i]);
				if (y === undefined) continue;
				dated++;
				if (y < last) sorted = false;
				last = y;
			}
			if (dated < 2 || sorted) return group;
			const slots: number[] = [];
			const people: { x: Person; y: number; i: number }[] = [];
			group.forEach((x, i) => {
				const y = yearAt(x);
				if (y === undefined) return;
				slots.push(i);
				people.push({ x, y, i });
			});
			people.sort((a, b) => a.y - b.y || a.i - b.i);
			const out = group.slice();
			slots.forEach((slot, k) => {
				out[slot] = people[k].x;
			});
			return out;
		};
		// One group in rank order: slot-fill, the notes, and the reversal of `youngest-child`.
		// Only the children who pass the sex test of the pass take part: under "women-only" a brother with a year must not move his
		// sisters. A child left out keeps his place in the written order.
		// With `after` the illegitimate children are a group of their own (the pass that reads the flag): a legitimate child with
		// a year never moves them, and the notes name only the people of one tier.
		const tiered = illOn && spec.illegitimate === 'after';
		const tierFill = (eligible: Person[]): Person[] => {
			const legit = eligible.filter((x) => !x.illegitimate);
			if (!tiered || legit.length === 0 || legit.length === eligible.length) {
				const sorted = slotFill(eligible);
				noteGroup(eligible, sorted);
				return sorted;
			}
			const tiers = [legit, eligible.filter((x) => x.illegitimate)];
			const out = eligible.slice();
			let changed = false;
			for (const tier of tiers) {
				const sorted = slotFill(tier);
				noteGroup(tier, sorted);
				if (sorted === tier) continue;
				changed = true;
				const inTier = new Set(tier);
				let next = 0;
				eligible.forEach((x, i) => {
					if (inTier.has(x)) out[i] = sorted[next++];
				});
			}
			return changed ? out : eligible;
		};
		const rankGroup = (group: Person[]): Person[] => {
			const eligible = only === undefined ? group : group.filter(sexOk);
			const sorted = tierFill(eligible);
			let final = group;
			if (sorted !== eligible) {
				let next = 0;
				final = eligible === group ? sorted : group.map((x) => (sexOk(x) ? sorted[next++] : x));
			}
			return reverse ? final.slice().reverse() : final;
		};
		const grouped = stepPref !== undefined || reigning;
		const rank = (parent: string): Person[] => {
			const kids = claimKids(parent);
			if (kids.length < 2) return kids;
			// S3: with this rule a holder with no start year gives the children no precedence. A parent who never held the title is not a holder.
			if (reigning && unstarted.has(parent) && !reigns.has(parent) && !noFrom.has(parent)) noFrom.set(parent, kids.map((k) => k.id));
			if (!grouped) return rankGroup(kids);
			// The gender step, then the reign step make the groups; the written order and the birth years decide inside a group.
			const code = (x: Person) => step(x) * 2 + (reigning && !reignOk(parent, x) ? 1 : 0);
			const first = code(kids[0]);
			if (kids.every((x) => code(x) === first)) return rankGroup(kids);
			const buckets: Person[][] = [[], [], [], []];
			for (const x of kids) buckets[code(x)].push(x);
			return ([] as Person[]).concat(...buckets.filter((b) => b.length).map(rankGroup));
		};
		// D202: the notes of one group. `final` is the group in rank order (before `youngest-child` reverses it).
		const noteGroup = (group: Person[], final: Person[]) => {
			for (let k = 0; k + 1 < final.length; k++) {
				const a = final[k];
				const b = final[k + 1];
				const ya = yearAt(a);
				const yb = yearAt(b);
				// Two years that differ put the pair in order; every other pair stands in the order of the note.
				if (ya !== undefined && yb !== undefined && ya !== yb) continue;
				// Brothers and sisters of the same parents can move in the edit sheet; the note is for the other case.
				if (sameParents(a.id, b.id)) continue;
				const [first, second] = reverse ? [b.id, a.id] : [a.id, b.id];
				pairs.set(`${first}\0${second}`, [first, second, ya !== undefined && ya === yb]);
			}
			if (final === group) return;
			// A dated child that crossed a child with no year breaks the order of the note: the data does not agree with itself.
			const place = new Map(final.map((x, i) => [x.id, i]));
			const involved = new Set<string>();
			group.forEach((u, i) => {
				if (yearAt(u) !== undefined) return;
				group.forEach((w, j) => {
					// w stood on one side of u in the note; it is a break when w stands on the other side now.
					const wasBefore = j < i;
					const isBefore = place.get(w.id)! < i;
					if (yearAt(w) !== undefined && wasBefore !== isBefore) {
						involved.add(u.id);
						involved.add(w.id);
					}
				});
			});
			if (involved.size) loops.set([...involved].sort().join('\0'), group.filter((x) => involved.has(x.id)).map((x) => x.id));
		};

		// C.5: the walk with representation, from each person of `up`. Iterative: a house can be hundreds of generations deep.
		// `flags` marks, for each person: reached, walked, or never in the line (R, `up`, the ancestors, the excluded).
		const REACHED = 1;
		const WALKED = 2;
		const BLOCKED = 4;
		const flags = new Uint8Array(size);
		for (const id of up) flags[P(id).index] |= BLOCKED;
		for (const id of ancestors) flags[P(id).index] |= BLOCKED;
		for (const id of excluded) {
			const x = g.byId.get(id);
			if (x) flags[x.index] |= BLOCKED;
		}
		// S2, D195: the co-rulers and the holder of a keyed entry are never in the line, but they still pass a claim.
		for (const id of hold.blocked) {
			const x = g.byId.get(id);
			if (x) flags[x.index] |= BLOCKED;
		}
		const walks = (c: Person): boolean => {
			if (needs === undefined || c.sex === needs) return true;
			if (claimKids(c.id).length) lost(c);
			return false;
		};
		interface Out { x: Person; branch: boolean }
		const outP: Out[] = [];
		const walk = (start: string) => {
			const s0 = P(start);
			if (flags[s0.index] & WALKED) return;
			flags[s0.index] |= WALKED;
			const lists: Person[][] = [rank(start)];
			const at: number[] = [0];
			while (lists.length) {
				const top = lists.length - 1;
				const kids = lists[top];
				if (at[top] >= kids.length) {
					lists.pop();
					at.pop();
					continue;
				}
				const c = kids[at[top]++];
				if (!(flags[c.index] & (REACHED | BLOCKED)) && alive(c)) {
					if (sexOk(c)) {
						flags[c.index] |= REACHED;
						outP.push({ x: c, branch: false });
					} else lost(c);
				}
				if (!(flags[c.index] & WALKED)) {
					if (walks(c)) {
						flags[c.index] |= WALKED;
						// M.2: a person who passes a claim and is an open branch stands here, where the children would be walked.
						if (openBranch(c)) outP.push({ x: c, branch: true });
						lists.push(rank(c.id));
						at.push(0);
					} else if (c.sex !== 'm' && c.sex !== 'f' && openBranch(c)) lost(c);
				}
			}
		};
		for (const u of up) if (walkable(u)) walk(u);
		const asItem = (o: Out): Item => (o.branch ? { id: o.x.id, branch: true } : { id: o.x.id });
		if (rule !== 'siblings-first' && rule !== 'nearest-relative') return outP.map(asItem);

		// C.7, C.8: rules without representation. Level and degree from one pass over all people of `up`.
		const sources = up.filter(walkable);
		const reach = (sign: 1 | -1): Int32Array => {
			const best = new Int32Array(size);
			const done = new Uint8Array(size);
			const starts = sources.map((u) => ({ x: P(u), v: sign * dist.get(u)! })).sort((a, b) => a.v - b.v);
			const isSource = new Uint8Array(size);
			for (const st of starts) isSource[st.x.index] = 1;
			const qx: Person[] = [];
			const qv: number[] = [];
			let s = 0;
			let h = 0;
			while (s < starts.length || h < qx.length) {
				const fromQueue = h < qx.length && (s >= starts.length || qv[h] <= starts[s].v);
				const x = fromQueue ? qx[h] : starts[s].x;
				const v = fromQueue ? qv[h++] : starts[s++].v;
				if (done[x.index]) continue;
				done[x.index] = 1;
				best[x.index] = v;
				if (!isSource[x.index] && !passesP(x)) continue;
				for (const k of claimKids(x.id)) {
					if (done[k.index]) continue;
					qx.push(k);
					qv.push(v + 1);
				}
			}
			return best;
		};
		if (rule === 'siblings-first') {
			const level = reach(-1);
			const keyed = outP.map((o, i) => ({ o, i, a: level[o.x.index] + (o.branch ? 1 : 0), b: o.branch ? 0 : step(o.x) }));
			keyed.sort((p, q) => p.a - q.a || p.b - q.b || p.i - q.i);
			return keyed.map((k) => asItem(k.o));
		}
		const degree = reach(1);
		// Descendants of R first: those reached from R alone through people who pass.
		const fromR = new Uint8Array(size);
		if (walkable(R)) {
			for (const stack = [R]; stack.length; ) {
				for (const k of claimKids(stack.pop()!)) {
					if (fromR[k.index]) continue;
					fromR[k.index] = 1;
					if (passesP(k)) stack.push(k.id);
				}
			}
		}
		const keyed = outP.map((o, i) => ({ o, i, a: degree[o.x.index] + (o.branch ? 1 : 0), b: fromR[o.x.index] ? 0 : 1, c: o.branch ? 0 : step(o.x) }));
		keyed.sort((p, q) => p.a - q.a || p.b - q.b || p.c - q.c || p.i - q.i);
		return keyed.map((k) => asItem(k.o));
	}

	// C.8a: a house form runs two passes, the preferred sex only, then both sexes with that sex first.
	const house = spec.inherit === 'men-first-in-house' ? 'men' : spec.inherit === 'women-first-in-house' ? 'women' : undefined;
	const sexPasses = (illOn: boolean): Item[] => {
		if (house === undefined) return pass(illOn, spec.inherit as PassKind['inherit']);
		const only = pass(illOn, `${house}-only`);
		return mergeItems(only, pass(illOn, `${house}-first`));
	};
	return {
		// C.4a: `after` is the line without the flagged people, then the line with them.
		line: () => (spec.illegitimate === 'after' ? mergeItems(sexPasses(false), sexPasses(true)) : sexPasses(spec.illegitimate === 'equal')),
		// A person that another pass put in the line (the second pass of a house form) is not left out.
		outsideBody: () => body !== undefined && lapsed > 0 && reached === 0,
		leftOutNoSex: (inLine) => {
			let n = 0;
			for (const id of noSex) if (!inLine.has(id)) n++;
			return n;
		},
		notes: (shown) => {
			const out: SuccessionNote[] = [];
			// S3: a parent with no start year, when some of the children are in the shown line.
			for (const [parent, kids] of noFrom) {
				if (kids.some((id) => shown.has(id))) out.push({ kind: 'born-in-reign-no-from', params: { parent } });
			}
			// D202: a break shows for the people it names; a pair inside a break is part of that note.
			const inLoop = new Set<string>();
			for (const people of loops.values()) {
				if (people.filter((id) => shown.has(id)).length < 2) continue;
				out.push({ kind: 'order-contradiction', params: { people } });
				for (const id of people) inLoop.add(id);
			}
			for (const [a, b, same] of pairs.values()) {
				if (shown.has(a) && shown.has(b) && !(inLoop.has(a) && inLoop.has(b))) out.push({ kind: 'order-from-note', params: same ? { a, b, reason: 'same-year' } : { a, b } });
			}
			return out;
		},
	};
}
