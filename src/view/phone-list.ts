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
 *   relation cache that the caller passes in (`relationsFor(whole, me).cards`). `linkWord(g, data, row)` gives the kind of
 *   parent or child link (D210), which does not depend on a mark or a setting.
 * - `pushTrail` / `popTrail` keep the Back trail (`st.listBack`) at most `BACK_LIMIT` long. A tap on a name or Find
 *   pushes the old centre; Back pops. `popTrail` skips a person who is not in the tree any more.
 */

import { drawnParents, pairKey, partnerOf, placedChildren, type FamilyGraph } from '../core/derive';
import { computeGenerations } from '../core/generations';
import { parentKind } from '../core/types';
import type { ListData, ListGroup, ListRow, ListWord } from '../render/dom/phone-list-dom';
import { startPerson } from '../render/tree-info';
import { LINK_WORDS, PHONE_LIST_UI } from '../render/view-text';
import type { CardRelation } from './relation-cache';

/** Which rung of the start chain chose the person in the middle. */
export type ListFrom = 'session' | 'pin' | 'me' | 'edited' | 'oldest' | 'first';

/** The most people that the Back trail keeps; the oldest is dropped. */
export const BACK_LIMIT = 20;

/**
 * The oldest person who has a child: the smallest generation (0 is the top row), then the earliest birth year (the year of `born` through `g.dates`, so a calendar date counts; a person
 * with no year comes last), then document order. Null when nobody has a child.
 */
export function oldestParent(g: FamilyGraph): string | null {
	let gens: Map<string, number> | undefined;
	let best: { id: string; gen: number; year: number } | null = null;
	for (const p of g.people) {
		if (placedChildren(g, p.id).length === 0) continue;
		gens ??= computeGenerations(g);
		const gen = gens.get(p.id) ?? 0;
		const year = g.dates.read(p.born)?.year ?? Number.POSITIVE_INFINITY;
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
	/** The person of the last Save that closed a person window (`st.lastSaved`), or null. An in-place write does not count (B1). */
	edited?: string | null;
	/** An open person window wrote in place (`st.listHold`): the view keeps the start it had instead of choosing again. `listStart` does not read it. */
	hold?: boolean;
	/** The count `st.listKeep` of closed person windows that held the list; a view keeps its start once for each new count. `listStart` does not read it. */
	keep?: number;
	g: FamilyGraph;
}

/**
 * The person in the middle of the list when it is first drawn (D144): the session choice, the pin, the marked person,
 * the person saved last, the oldest person who has a child, the first root. A person who is not in the tree is skipped.
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
 * then the children that only a side link names. A person appears once in the children.
 * A child that is placed under the centre (a partnership or alone) always stays in that group; only then do the side links place the other children.
 * A side link of a partnership of the centre (a birth child drawn under adoptive parents) stands in the group of that partnership (D214): the partnership
 * is a written union or the implicit one of two parents that have a placed child (the pair key). A rumoured link never wins over another kind of link
 * of the same person, whatever the order in the note. Every parent and child row carries the kind of its link to `centre`.
 */
export function listData(g: FamilyGraph, centre: string): ListData {
	const parents: ListRow[] = [];
	for (const dp of drawnParents(g, centre)) {
		if (!g.byId.has(dp.id)) continue;
		const at = parents.findIndex((r) => r.id === dp.id);
		if (at < 0) parents.push({ id: dp.id, role: 'parent', link: dp.type });
		else if (parents[at].link === 'rumoured' && dp.type !== 'rumoured') parents[at] = { id: dp.id, role: 'parent', link: dp.type };
	}

	const person: ListRow[] = [{ id: centre, role: 'centre' }];
	const groups: ListGroup[] = [];
	const seen = new Set<string>([centre]);
	const unionKeys = g.unionsOf.get(centre) ?? [];
	const child = (id: string, link = parentKind(g.placementType.get(id))): ListRow => ({ id, role: 'child', link });

	// The placed children of every partnership and of the centre alone come first, so that no side link takes one of them away from its confirmed group.
	const partnerships: { key: string; partner: string; rows: ListRow[] }[] = [];
	for (const key of unionKeys) {
		const u = g.unionByKey.get(key);
		if (!u) continue;
		const pid = partnerOf(u, centre);
		if (!g.byId.has(pid)) continue;
		if (!person.some((r) => r.id === pid)) person.push({ id: pid, role: 'partner' });
		const rows = u.children.filter((c) => !seen.has(c) && g.byId.has(c)).map((c) => child(c));
		for (const r of rows) seen.add(r.id);
		partnerships.push({ key, partner: pid, rows });
	}
	const solo = (g.soloChildren.get(centre) ?? []).filter((c) => !seen.has(c) && g.byId.has(c));
	for (const c of solo) seen.add(c);

	// The side links of the centre, the other kinds before the rumoured ones, each in the order of the note.
	const side = g.secondary.filter((e) => e.parents.includes(centre) && g.byId.has(e.child));
	const ordered = [...side.filter((e) => parentKind(e.type) !== 'rumoured'), ...side.filter((e) => parentKind(e.type) === 'rumoured')];
	// The parents that a child has by side links of one kind: a pair of them is a couple even when no union is written (implicit partnership).
	const sideParents = new Map<string, Set<string>>();
	for (const e of g.secondary) {
		const k = `${e.child}|${parentKind(e.type)}`;
		const set = sideParents.get(k) ?? new Set<string>();
		for (const q of e.parents) set.add(q);
		sideParents.set(k, set);
	}
	const home = (e: (typeof side)[number]) => {
		if (e.unionKey) return partnerships.find((x) => x.key === e.unionKey);
		const named = sideParents.get(`${e.child}|${parentKind(e.type)}`);
		if (!named || named.size !== 2 || !named.has(centre)) return undefined;
		const [a, b] = [...named];
		const key = `i:${pairKey(a, b)}`;
		return partnerships.find((x) => x.key === key);
	};
	const other: ListRow[] = [];
	for (const e of ordered) {
		if (seen.has(e.child)) continue;
		seen.add(e.child);
		const row = child(e.child, parentKind(e.type));
		const into = home(e);
		if (into) into.rows.push(row);
		else other.push(row);
	}

	for (const x of partnerships) if (x.rows.length) groups.push({ heading: { kind: 'partner', partner: x.partner }, rows: x.rows });
	if (solo.length) groups.push({ heading: partnerships.length ? { kind: 'solo' } : null, rows: solo.map((c) => child(c)) });
	if (other.length) groups.push({ heading: { kind: 'other' }, rows: other });

	return { centre, parents, person, groups };
}

/**
 * The kind of link of a parent or child row, seen from the person at the top of the list (D210): "Adoptive father", "Guardian", "Rumoured son",
 * "Adopted daughter", "Ward". A birth parent has a word only when the person also has an adoptive parent; a birth child has none. The centre and a
 * partner have none. The words are those of the relation finder's steps.
 */
export function linkWord(g: FamilyGraph, data: ListData, row: ListRow): ListWord | null {
	if (row.role !== 'parent' && row.role !== 'child') return null;
	const link = row.link ?? 'birth';
	const sex = g.byId.get(row.id)?.sex;
	const at = sex === 'm' ? 0 : sex === 'f' ? 1 : 2;
	let text: string;
	if (row.role === 'parent') {
		if (link === 'birth' && !data.parents.some((r) => r.link === 'adoptive')) return null;
		text = LINK_WORDS.parent[link][at];
	} else {
		if (link === 'birth') return null;
		text = LINK_WORDS.child[link][at];
	}
	return { text, lower: text.toLowerCase() };
}

/** The people the list shows, each once: the rows that carry a relation word are these (WP-K asks for their names in one request). */
export function listIds(data: ListData): string[] {
	const ids = new Set<string>();
	for (const r of [...data.parents, ...data.person, ...data.groups.flatMap((gr) => gr.rows)]) ids.add(r.id);
	return [...ids];
}

/** What `listWord` reads. */
export interface ListWordFacts {
	me: string | null;
	/** The setting "Show relation names on cards". */
	showRelations: boolean;
	/** `relationsFor(whole, me).cards`; undefined when there is no mark. */
	cards: { get(id: string): CardRelation | undefined } | undefined;
}

/**
 * The relation word of a row (C.3.1): the real word of the relation cache, so it names the relation to You. No mark, no
 * word. With the setting off, only the marked person's "You".
 */
export function listWord(id: string, f: ListWordFacts): ListWord | null {
	if (f.me === null) return null;
	if (id === f.me) return { text: PHONE_LIST_UI.you, lower: PHONE_LIST_UI.you.toLowerCase(), strong: true };
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
