/*
 * The shared state of the succession walks. `makeContext` builds, once for a line, everything that does not depend on the pass:
 * the drawn parents, the reign table, the earlier holders, the claim children of each reading of the flag `illegitimate`, and the counters
 * and notes that every pass fills. `passRules` builds the part that one pass owns: its sex tests and its two lazy sets. The climb,
 * the rank, the walk and the engine (`succession-pass.ts`, `succession-rank.ts`, `succession-engine.ts`) take these records as their first argument.
 */

import { drawnParentMap, type DrawnParent, type FamilyGraph } from './derive';
import type { InheritRule, SuccessionRule } from './succession-keys';
import type { Life, YearReader } from './succession-dates';
import type { SuccessionSpec } from './succession-types';
import type { Holder, Person } from './types';

/** Who held the title, who the climb follows as an earlier holder, and who is never in the line. */
export interface Holders {
	/** The persons of the entries before R's entry, a keyed entry by its spouse; the climb follows them (rule 13). */
	earlier: Set<string>;
	/** Everyone who held the title as far as an open branch is concerned: the persons as written, the spouses, R, the holder and the co-rulers (rule 23). */
	held: Set<string>;
	/** Never in the line, but they still pass a claim: the co-rulers and the holder of a keyed ruler entry (D195). */
	blocked: Set<string>;
}

/** A line entry inside the engine, an heir or an open branch. */
export interface Item {
	id: string;
	branch?: true;
}

const itemKey = (i: Item) => (i.branch ? 'b:' : 'h:') + i.id;

/** The items of `a`, then the items of `b` that `a` does not have, in the order of `b`. */
export function mergeItems(a: Item[], b: Item[]): Item[] {
	const seen = new Set(a.map(itemKey));
	return [...a, ...b.filter((x) => !seen.has(itemKey(x)))];
}

/** The shared empty list of people: a person with no claim children. */
export const NONE: Person[] = [];
/** The shared empty list of drawn parents. */
export const NONE_DRAWN: DrawnParent[] = [];
const NO_IDS: string[] = [];

/** Whether two lists of distinct ids hold the same ids, in any order. */
function sameIds(x: readonly string[], y: readonly string[]): boolean {
	if (x.length !== y.length) return false;
	const ys = new Set(y);
	return x.every((q) => ys.has(q));
}

/** The claim children of each person for one reading of the flag `illegitimate`, in written order. */
export type ClaimKids = Map<string, Person[]>;

/** The form of `inherit` that one pass reads: the house forms are two passes of the single-sex forms. */
export type PassInherit = Exclude<InheritRule, 'men-first-in-house' | 'women-first-in-house'>;

/** The state of one line that all passes share. The fields after `noSex` change while the passes run. */
export interface EngineCtx {
	g: FamilyGraph;
	spec: SuccessionSpec;
	rule: SuccessionRule;
	R: string;
	Y: number | null;
	/** The first holder, only with the switch `heirs-of-body` on. */
	body: string | undefined;
	hold: Holders;
	life: Life;
	excluded: ReadonlySet<string>;
	youngDeath: number;
	yr: YearReader;
	drawn: Map<string, DrawnParent[]>;
	/** One more than the largest `Person.index`: flags can sit in an array of this size. */
	size: number;
	/** Born during a reign of the parent (sort key 2): the reigns with a start year, by person. */
	reigns: Map<string, { from: number; to?: number }[]>;
	/** What the walks note for the window: D202 pairs and breaks of the order, S3 parents. Filled by `rank` in every pass. */
	pairs: Map<string, [string, string, boolean]>;
	loops: Map<string, string[]>;
	noFrom: Map<string, string[]>;
	/** S3: the people who hold the title in an entry with no readable start year (a keyed entry holds for its spouse too). */
	unstarted: Set<string>;
	noSex: Set<string>;
	/** Passes that found the first holder above R, and passes that did not. */
	reached: number;
	lapsed: number;
	/** The claim children of each reading of the flag, built when a pass first needs them. */
	kidsCache: Map<boolean, ClaimKids>;
	/** Everyone who is a parent of somebody, built on first need (see `hasChild`). */
	parentOf: Set<string> | undefined;
}

/** The reigns with a start year, by person; a keyed entry (D195) also gives its years to the spouse. */
function reignTable(entries: readonly Holder[], yr: YearReader, spouseAt: ReadonlyMap<number, string>): EngineCtx['reigns'] {
	const reigns: EngineCtx['reigns'] = new Map();
	entries.forEach((h, i) => {
		const from = yr(h.from);
		if (h.person === undefined || from === undefined) return;
		const to = yr(h.to);
		for (const id of [h.person, spouseAt.get(i)]) {
			if (id === undefined) continue;
			const list = reigns.get(id) ?? [];
			list.push(to === undefined ? { from } : { from, to });
			reigns.set(id, list);
		}
	});
	return reigns;
}

/** S3: the people who hold the title in an entry with no readable start year. */
function unstartedHolders(entries: readonly Holder[], yr: YearReader, spouseAt: ReadonlyMap<number, string>): Set<string> {
	const unstarted = new Set<string>();
	entries.forEach((h, i) => {
		if (h.person === undefined || yr(h.from) !== undefined) return;
		unstarted.add(h.person);
		const spouse = spouseAt.get(i);
		if (spouse !== undefined) unstarted.add(spouse);
	});
	return unstarted;
}

/** Builds the state of one line: everything that does not depend on the pass. */
export function makeContext(
	g: FamilyGraph,
	entries: readonly Holder[],
	spec: SuccessionSpec,
	rule: SuccessionRule,
	R: string,
	Y: number | null,
	life: Life,
	excluded: ReadonlySet<string>,
	body: string | undefined,
	youngDeath: number,
	hold: Holders,
	spouseAt: ReadonlyMap<number, string>,
	yr: YearReader,
): EngineCtx {
	let size = 0;
	for (const p of g.people) if (p.index >= size) size = p.index + 1;
	const reigning = rule === 'born-in-reign';
	return {
		g, spec, rule, R, Y, body, hold, life, excluded, youngDeath, yr,
		drawn: drawnParentMap(g),
		size,
		reigns: reigning ? reignTable(entries, yr, spouseAt) : new Map<string, { from: number; to?: number }[]>(),
		pairs: new Map(),
		loops: new Map(),
		noFrom: new Map(),
		unstarted: reigning ? unstartedHolders(entries, yr, spouseAt) : new Set(),
		noSex: new Set(),
		reached: 0,
		lapsed: 0,
		kidsCache: new Map(),
		parentOf: undefined,
	};
}

/** The person of an id that the tree has. */
export const personOf = (e: EngineCtx, id: string): Person => e.g.byId.get(id)!;

/** Does the link from a drawn parent to a child carry a claim, for one reading of the flag `illegitimate`? */
export function carries(e: EngineCtx, d: DrawnParent, child: Person, illOn: boolean): boolean {
	return (d.type === 'birth' && (!child.illegitimate || illOn)) || (d.type === 'adoptive' && e.spec.adopted);
}

/** The claim children of each person for one reading of the flag, built on first need. */
export function kidsFor(e: EngineCtx, illOn: boolean): ClaimKids {
	let kids = e.kidsCache.get(illOn);
	if (kids) return kids;
	kids = new Map();
	for (const child of e.g.people) {
		const ds = e.drawn.get(child.id);
		if (!ds) continue;
		for (let i = 0; i < ds.length; i++) {
			const d = ds[i];
			if (!carries(e, d, child, illOn) || (i > 0 && ds.some((x, j) => j < i && x.id === d.id && carries(e, x, child, illOn)))) continue;
			const siblings = kids.get(d.id);
			if (siblings) siblings.push(child);
			else kids.set(d.id, [child]);
		}
	}
	e.kidsCache.set(illOn, kids);
	return kids;
}

/** The primary parents are the ones the edit sheet orders brothers and sisters by; the same set of ids (a placement list holds two ids, or all of a group). */
export function sameParents(e: EngineCtx, a: string, b: string): boolean {
	return sameIds(e.g.placementParents.get(a) ?? NO_IDS, e.g.placementParents.get(b) ?? NO_IDS);
}

/** A person who has a child in the tree by a birth, adoptive, rumoured or begetter link (D332) has a drawn family; a ward link does not count (D191). Made on first need. */
function hasChild(e: EngineCtx, id: string): boolean {
	if (!e.parentOf) {
		e.parentOf = new Set();
		// A person who lists the same person as a parent (a self-listing) is no child; a cycle link still is.
		for (const q of e.g.people) for (const r of q.parents) if (r.type !== 'ward' && r.id !== q.id && e.g.byId.has(r.id)) e.parentOf.add(r.id);
	}
	return e.parentOf.has(id);
}

/** Dead at Y (not alive and not just unborn), not R, not closed, no child, not too young at death. */
export function openBranch(e: EngineCtx, x: Person): boolean {
	// R, and a person who held the title before R (the title passed on, so the line of the holder is closed).
	if (x.id === e.R || e.hold.held.has(x.id) || e.life.alive(x)) return false;
	const b = e.life.born(x);
	if (e.Y !== null && (b ?? -Infinity) > e.Y) return false;
	if (x.childless === true || hasChild(e, x.id)) return false;
	if (e.youngDeath > 0) {
		const d = e.yr(x.died);
		if (b !== undefined && d !== undefined && d - b < e.youngDeath) return false;
	}
	return true;
}

/** The state of one pass: the line for one illegitimacy reading and one single-sex form of `inherit`. */
export interface PassCtx {
	e: EngineCtx;
	illOn: boolean;
	kidsOf: ClaimKids;
	/** Who may stand in the line, or undefined for both sexes. */
	only: 'm' | 'f' | undefined;
	/** Who passes a claim on, or undefined for both sexes. */
	needs: 'm' | 'f' | undefined;
	/** The preferred sex of the step, and of the parents the climb follows first. */
	stepPref: 'm' | 'f' | undefined;
	parentPref: 'm' | 'f' | undefined;
	/** The people who descend from an earlier holder through people who pass. Made on first need (see `descendsFrom`). */
	descends: Set<string> | undefined;
	/** The first holder and the people who descend from the first holder through people who pass. Made on first need (see `inBody`). */
	bodySet: Set<string> | undefined;
}

/** The sex tests of one pass: who may stand in the line (`only`) and whose claim children are followed (`needs`). */
export function passRules(e: EngineCtx, illOn: boolean, inh: PassInherit): PassCtx {
	const only = inh === 'men-only' ? 'm' : inh === 'women-only' ? 'f' : undefined;
	const through = e.spec.inheritThrough;
	return {
		e,
		illOn,
		kidsOf: kidsFor(e, illOn),
		only,
		needs: through === undefined ? only : through === 'anyone' ? undefined : through === 'men' ? 'm' : 'f',
		stepPref: inh === 'men-first' ? 'm' : inh === 'women-first' ? 'f' : undefined,
		parentPref: inh === 'men-first' || inh === 'men-only' ? 'm' : inh === 'women-first' || inh === 'women-only' ? 'f' : undefined,
		descends: undefined,
		bodySet: undefined,
	};
}

/** The claim children of a person, in written order. */
export const claimKids = (p: PassCtx, x: string): Person[] => p.kidsOf.get(x) ?? NONE;

/** May the person stand in the line? */
export const sexOk = (p: PassCtx, x: Person): boolean => p.only === undefined || x.sex === p.only;

/** Does the person pass a claim on? */
export const passesP = (p: PassCtx, x: Person): boolean => p.needs === undefined || x.sex === p.needs;

/** A person with no sex who is left out by a one-sex test is counted when something is lost: an heir, or a claim. */
export function lost(p: PassCtx, x: Person): void {
	if (x.sex !== 'm' && x.sex !== 'f') p.e.noSex.add(x.id);
}

/** Does the person (by id) pass a claim on; a person who does not and has claim children counts as a loss. */
export function passes(p: PassCtx, id: string): boolean {
	const x = personOf(p.e, id);
	const ok = passesP(p, x);
	if (!ok && claimKids(p, id).length) lost(p, x);
	return ok;
}

/** The sex step of the sort: 0 for the preferred sex (or no preference), else 1. */
export const stepOf = (p: PassCtx, x: Person): number => (p.stepPref === undefined ? 0 : x.sex === p.stepPref ? 0 : 1);
