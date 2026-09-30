/*
 * The relation names of a tree (spec §13.1, D40), kept for the session. The tree view and the edit
 * sheet both ask here: the names of one tree and one mark are computed once, from the WHOLE tree
 * (never a focus family), and shared until the tree or the mark changes (key: `relationsKey`).
 * Nothing here runs during a pan or zoom: only a render or a sheet asks.
 */

import type { FamilyGraph } from '../core/derive';
import type { Relation } from '../core/relations';
import { computeRelations, relationsKey } from '../core/relations';

/** The names of one tree for one mark: all names of each person, and the card name of each person. */
export interface TreeRelations {
	/** Every relation of each person to the marked person, best first (the sheet lists them). */
	all: ReadonlyMap<string, readonly Relation[]>;
	/** The first relation of each person: what the card shows (`SceneOptions.relations`). */
	cards: ReadonlyMap<string, Relation>;
}

/** A few trees are open at a time; each note's tree keeps its names while the user moves between them. */
export const RELATION_CACHE_SIZE = 8;

const cache = new Map<string, TreeRelations>();

/** How often the names were computed (not taken from the cache); the tests read it. */
export const relationStats = { computed: 0 };

/** The mark of `g` if it names a person of `g` (spec §13.1: otherwise the tree shows no names). */
export function validMe(g: FamilyGraph, me: string | undefined): string | null {
	return me !== undefined && g.byId.has(me) ? me : null;
}

/** The relation names of the whole tree `g` to `me`, from the cache when the tree and the mark did not change. */
export function relationsFor(g: FamilyGraph, me: string): TreeRelations {
	const key = relationsKey(g, me);
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	relationStats.computed++;
	const all = computeRelations(g, me);
	const cards = new Map<string, Relation>();
	for (const [id, rels] of all) if (rels[0]) cards.set(id, rels[0]);
	const out: TreeRelations = { all, cards };
	cache.set(key, out);
	while (cache.size > RELATION_CACHE_SIZE) cache.delete(cache.keys().next().value!);
	return out;
}

/** Empties the cache: the settings button "Arrange again", and the harness before a cold timing. */
export function clearRelationCache(): void {
	cache.clear();
}
