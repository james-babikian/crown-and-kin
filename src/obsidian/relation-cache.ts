/*
 * The relation names of a tree (spec §13.1, D40), kept for the session. The tree view and the edit
 * sheet both ask here: the names of one tree and one mark are computed once, from the WHOLE tree
 * (never a focus family), and shared until the tree, the mark or the setting "Assume an unknown
 * second parent" (D174) changes: the key (`relationsKey`) holds all three, so a change of the
 * setting computes the names again. Nothing here runs during a pan or zoom: only a render or a
 * sheet asks.
 */

import type { FamilyGraph } from '../core/derive';
import type { Relation, RelationOptions } from '../core/relations';
import { computeRelations, DEFAULT_RELATION_OPTIONS, relationsKey } from '../core/relations';
import { cardRelationText, spokenRelation } from '../render/tree-info';

/** What a card needs of a relation: the text on the card and the words of the screen-reader label (D123, D174 add "maybe full" or "maybe half" to both). */
export interface CardRelation {
	text: string;
	lower: string;
}

/** The names of one tree for one mark: all names of each person, and the card name of each person. */
export interface TreeRelations {
	/** Every relation of each person to the marked person, best first (the sheet lists them). */
	all: ReadonlyMap<string, readonly Relation[]>;
	/** The first relation of each person: what the card shows (`SceneOptions.relations`). */
	cards: ReadonlyMap<string, CardRelation>;
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

/**
 * The relation names of the whole tree `g` to `me`, from the cache when the tree, the mark and the
 * options did not change. The plugin passes `{ oneParentUnknown }` of its settings (D174).
 */
export function relationsFor(g: FamilyGraph, me: string, options: RelationOptions = DEFAULT_RELATION_OPTIONS): TreeRelations {
	// The options are in the key, so names of the other setting never come back from the cache.
	const key = relationsKey(g, me, options);
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	relationStats.computed++;
	const all = computeRelations(g, me, options);
	const cards = new Map<string, CardRelation>();
	for (const [id, rels] of all) if (rels[0]) cards.set(id, { text: cardRelationText(rels[0]), lower: spokenRelation(rels[0]) });
	const out: TreeRelations = { all, cards };
	cache.set(key, out);
	while (cache.size > RELATION_CACHE_SIZE) cache.delete(cache.keys().next().value!);
	return out;
}

/** Empties the cache: the settings button "Arrange again", and the harness before a cold timing. */
export function clearRelationCache(): void {
	cache.clear();
}
