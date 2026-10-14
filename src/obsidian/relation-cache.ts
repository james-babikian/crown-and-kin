/*
 * The relation names of a tree (spec §13.1, D40), kept for the session. The tree view and the edit
 * sheet both ask here. A lookup is made for one tree, one mark and the setting "Assume an unknown
 * second parent" (D174), and shared until one of them changes: the key (`relationsKey`) holds all
 * three, so a change of the setting makes a new lookup. The lookup works out the names of the
 * people asked for, from the WHOLE tree (never a focus family), once each, with the same result as
 * the names of all people (WP-K). A view asks for the people it shows: the rows of the phone list,
 * the cards of a focus family, one person window. The view of the whole tree asks for all drawn cards.
 * Nothing here runs during a pan or zoom: only a render or a sheet asks.
 */

import type { FamilyGraph } from '../core/derive';
import type { Relation, RelationLookup, RelationOptions } from '../core/relations';
import { DEFAULT_RELATION_OPTIONS, relationLookup, relationsKey } from '../core/relations';
import { cardRelationText, spokenRelation } from '../render/tree-info';

/** What a card needs of a relation: the text on the card and the words of the screen-reader label (D123, D174 add "maybe full" or "maybe half" to both). */
export interface CardRelation {
	text: string;
	lower: string;
}

/** The first relation of a person: what the card, the row or the picker shows. */
export interface CardLookup {
	get(id: string): CardRelation | undefined;
	/** True when the person is already worked out (with or without a relation). */
	known(id: string): boolean;
	/** The relation of a person who is already worked out; it never works one out (a row that draws before its batch ran). */
	peek(id: string): CardRelation | undefined;
	/** Works out the people of the list in one request, and gives those that have a relation. Ask for the people a view shows, then `get` each. */
	getMany(ids: Iterable<string>): ReadonlyMap<string, CardRelation>;
}

/** The names of one tree for one mark, worked out for the people asked. */
export interface TreeRelations {
	/** Every relation of a person to the marked person, best first (the sheet lists them). */
	all: RelationLookup;
	/** The first relation of a person: what the card shows (`SceneOptions.relations`). */
	cards: CardLookup;
}

/** A few trees are open at a time; each note's tree keeps its names while the user moves between them. */
export const RELATION_CACHE_SIZE = 8;

const cache = new Map<string, TreeRelations>();

/**
 * The `relationsKey` of each graph object, by mark and options: it costs about 4.5 ms for 5 000 people, and a render asks several times.
 * This relies on a `FamilyGraph` never being changed after `deriveFamilies` made it: an edit makes a new graph.
 */
const keys = new WeakMap<FamilyGraph, Map<string, string>>();

/** How often a lookup was made (not taken from the cache); the tests read it. */
export const relationStats = { computed: 0 };

/** The mark of `g` if it names a person of `g` (spec §13.1: otherwise the tree shows no names). */
export function validMe(g: FamilyGraph, me: string | undefined): string | null {
	return me !== undefined && g.byId.has(me) ? me : null;
}

function keyOf(g: FamilyGraph, me: string, options: RelationOptions): string {
	let per = keys.get(g);
	if (!per) keys.set(g, (per = new Map()));
	const own = JSON.stringify([me, options]);
	let key = per.get(own);
	if (key === undefined) per.set(own, (key = relationsKey(g, me, options)));
	return key;
}

/** Card texts over a lookup; each person's text is made once. */
function cardsOf(all: RelationLookup): CardLookup {
	const made = new Map<string, CardRelation | null>();
	const make = (id: string, rels: readonly Relation[] | undefined): CardRelation | undefined => {
		const out = rels?.[0] ? { text: cardRelationText(rels[0]), lower: spokenRelation(rels[0]) } : null;
		made.set(id, out);
		return out ?? undefined;
	};
	return {
		get(id) {
			const hit = made.get(id);
			return hit !== undefined ? (hit ?? undefined) : make(id, all.get(id));
		},
		known: (id) => made.has(id),
		peek: (id) => made.get(id) ?? undefined,
		getMany(ids) {
			const wanted = [...new Set(ids)];
			const fresh = wanted.filter((id) => !made.has(id));
			const rels = fresh.length ? all.getMany(fresh) : undefined;
			for (const id of fresh) make(id, rels?.get(id));
			const out = new Map<string, CardRelation>();
			for (const id of wanted) {
				const card = made.get(id);
				if (card) out.set(id, card);
			}
			return out;
		},
	};
}

/**
 * The relation names of the whole tree `g` to `me`, from the cache when the tree, the mark and the
 * options did not change. The plugin passes `{ oneParentUnknown }` of its settings (D174).
 */
export function relationsFor(g: FamilyGraph, me: string, options: RelationOptions = DEFAULT_RELATION_OPTIONS): TreeRelations {
	// The options are in the key, so names of the other setting never come back from the cache.
	const key = keyOf(g, me, options);
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	relationStats.computed++;
	const all = relationLookup(g, me, options);
	const out: TreeRelations = { all, cards: cardsOf(all) };
	cache.set(key, out);
	while (cache.size > RELATION_CACHE_SIZE) cache.delete(cache.keys().next().value!);
	return out;
}

/** Empties the cache: the settings button "Arrange again", and the harness before a cold timing. */
export function clearRelationCache(): void {
	cache.clear();
}
