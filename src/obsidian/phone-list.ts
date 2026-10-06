/*
 * The pure parts of the phone list (D144, contract C.3.1): who the list stands on when a note opens, what the list
 * holds, which relation word a row shows and how the Back trail grows. No `obsidian` import and no DOM, so the tests
 * run it on plain data. `src/render/dom/phone-list-dom.ts` builds the DOM from `ListData`; the tree view (WP-C2b)
 * calls these functions and keeps the state (`BlockState.focus`, `BlockState.listBack`).
 *
 * How the caller wires it:
 * - `listStart({ session, pin, me, edited, g })` gives the person in the middle and where that choice came from
 *   (`data-dynasty-list-from`). `session` is `st.focus?.id` (null for "all people", which means nothing to a list).
 *   `options.start` is NOT an input: it is not part of the chain.
 * - `listData(g, centre)` gives the sections. `listWord(id, ...)` gives the relation word of a row, from the
 *   relation cache that the caller passes in (`relationsFor(whole, me).cards`).
 * - `pushTrail` / `popTrail` keep the Back trail (`st.listBack`) at most `BACK_LIMIT` long. A tap on a name or Find
 *   pushes the old centre; Back pops. `popTrail` skips a person who is not in the tree any more.
 */

import { drawnParents, partnerOf, placedChildren, type FamilyGraph } from '../core/derive';
import { computeGenerations } from '../core/generations';
import { parentKind } from '../core/types';
import type { ListData, ListGroup, ListRow, ListWord } from '../render/dom/phone-list-dom';
import { startPerson } from '../render/tree-info';
import { PHONE_LIST_UI } from '../render/ui-text';
import type { CardRelation } from './relation-cache';

export type { ListData, ListGroup, ListHeading, ListRow, ListWord } from '../render/dom/phone-list-dom';

/** Which rung of the start chain chose the person in the middle. */
export type ListFrom = 'session' | 'pin' | 'me' | 'edited' | 'oldest' | 'first';

/** The most people that the Back trail keeps; the oldest is dropped. */
export const BACK_LIMIT = 20;

/** The year of a person for the "oldest" order: the first run of three or four digits in `born`; undefined when there is none. */
function birthYear(born: string | undefined): number | undefined {
	const m = born === undefined ? null : /(?<!\d)\d{3,4}(?!\d)/.exec(born);
	return m ? Number(m[0]) : undefined;
}

/**
 * The oldest person who has a child: the smallest generation (0 is the top row), then the earliest birth year (a person
 * with no year comes last), then document order. Null when nobody has a child.
 */
export function oldestParent(g: FamilyGraph): string | null {
	let gens: Map<string, number> | undefined;
	let best: { id: string; gen: number; year: number } | null = null;
	for (const p of g.people) {
		if (placedChildren(g, p.id).length === 0) continue;
		gens ??= computeGenerations(g);
		const gen = gens.get(p.id) ?? 0;
		const year = birthYear(p.born) ?? Number.POSITIVE_INFINITY;
		// Strictly smaller wins, so a tie keeps the person who comes first in the note.
		if (!best || gen < best.gen || (gen === best.gen && year < best.year)) best = { id: p.id, gen, year };
	}
	return best ? best.id : null;
}

/** What the start chain reads. */
export interface ListStartFacts {
	/** The session choice (`st.focus?.id`); null or undefined when there is none or it is "all people". */
	session: string | null | undefined;
	/** `options.focus`, the pin. */
	pin: string | undefined;
	/** The marked person, already checked against the tree (`validMe`), or null. */
	me: string | null;
	/** The person edited last (`st.lastEdited`), or null. */
	edited: string | null;
	g: FamilyGraph;
}

/**
 * The person in the middle of the list when it is first drawn (D144): the session choice, the pin, the marked person,
 * the person edited last, the oldest person who has a child, the first root. A person who is not in the tree is skipped.
 * Null only for a tree with no people.
 */
export function listStart(f: ListStartFacts): { id: string; from: ListFrom } | null {
	const { g } = f;
	const ok = (id: string | null | undefined): id is string => id !== null && id !== undefined && g.byId.has(id);
	if (ok(f.session)) return { id: f.session, from: 'session' };
	if (ok(f.pin)) return { id: f.pin, from: 'pin' };
	if (ok(f.me)) return { id: f.me, from: 'me' };
	if (ok(f.edited)) return { id: f.edited, from: 'edited' };
	const oldest = oldestParent(g);
	if (oldest !== null) return { id: oldest, from: 'oldest' };
	const first = startPerson(g, undefined);
	return first === null ? null : { id: first, from: 'first' };
}

/**
 * The sections of the list for `centre`: the drawn parents (placement links first, then side links), the centre with each
 * partner once in union order, and the children in groups by partnership, then the children with no listed partner,
 * then the children that only a side link names. A person appears once in the children (the first place wins).
 */
export function listData(g: FamilyGraph, centre: string): ListData {
	const parents: ListRow[] = [];
	for (const dp of drawnParents(g, centre)) {
		if (g.byId.has(dp.id) && !parents.some((r) => r.id === dp.id)) parents.push({ id: dp.id, role: 'parent', link: dp.type });
	}

	const person: ListRow[] = [{ id: centre, role: 'centre' }];
	const groups: ListGroup[] = [];
	const seen = new Set<string>([centre]);
	const unionKeys = g.unionsOf.get(centre) ?? [];
	const child = (id: string, link = parentKind(g.placementType.get(id))): ListRow => ({ id, role: 'child', link });
	let partnerships = 0;
	for (const key of unionKeys) {
		const u = g.unionByKey.get(key);
		if (!u) continue;
		const pid = partnerOf(u, centre);
		if (!g.byId.has(pid)) continue;
		partnerships++;
		if (!person.some((r) => r.id === pid)) person.push({ id: pid, role: 'partner' });
		const rows = u.children.filter((c) => !seen.has(c) && g.byId.has(c));
		for (const c of rows) seen.add(c);
		if (rows.length) groups.push({ heading: { kind: 'partner', partner: pid }, rows: rows.map((c) => child(c)) });
	}

	const solo = (g.soloChildren.get(centre) ?? []).filter((c) => !seen.has(c) && g.byId.has(c));
	for (const c of solo) seen.add(c);
	if (solo.length) groups.push({ heading: partnerships ? { kind: 'solo' } : null, rows: solo.map((c) => child(c)) });

	const other: ListRow[] = [];
	for (const e of g.secondary) {
		if (!e.parents.includes(centre) || seen.has(e.child) || !g.byId.has(e.child)) continue;
		seen.add(e.child);
		other.push(child(e.child, parentKind(e.type)));
	}
	if (other.length) groups.push({ heading: { kind: 'other' }, rows: other });

	return { centre, parents, person, groups };
}

/** What `listWord` reads. */
export interface ListWordFacts {
	me: string | null;
	/** The setting "Show relation names on cards". */
	showRelations: boolean;
	/** `relationsFor(whole, me).cards`; undefined when there is no mark. */
	cards: ReadonlyMap<string, CardRelation> | undefined;
}

/**
 * The relation word of a row (C.3.1): the real word of the relation cache, so it names the relation to You. No mark, no
 * word. With the setting off, only the marked person's "You".
 */
export function listWord(id: string, f: ListWordFacts): ListWord | null {
	if (f.me === null) return null;
	if (id === f.me) return { text: PHONE_LIST_UI.you, lower: PHONE_LIST_UI.you.toLowerCase() };
	if (!f.showRelations) return null;
	return f.cards?.get(id) ?? null;
}

/** A new Back trail with `id` added last; at most `BACK_LIMIT` entries, the oldest dropped. The old array does not change. */
export function pushTrail(trail: readonly string[] | undefined, id: string): string[] {
	const next = [...(trail ?? []), id];
	return next.length > BACK_LIMIT ? next.slice(next.length - BACK_LIMIT) : next;
}

/** The newest person of the trail who is still in the tree, and the trail without that person and without the missing people; null when there is none. */
export function popTrail(trail: readonly string[] | undefined, has: (id: string) => boolean): { id: string; rest: string[] } | null {
	if (!trail) return null;
	for (let i = trail.length - 1; i >= 0; i--) if (has(trail[i])) return { id: trail[i], rest: trail.slice(0, i).filter(has) };
	return null;
}
