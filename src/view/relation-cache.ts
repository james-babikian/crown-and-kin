/*
 * The relation names of a tree (spec §13.1, D40), kept for the session. The tree view and the edit
 * sheet both ask here. A lookup is made for one tree, one mark and the setting "Assume an unknown
 * second parent" (D174), and shared until one of them changes: the key (`relationsKey`) holds all
 * three, so a change of the setting makes a new lookup. The lookup works out the names of the
 * people asked for, from the WHOLE tree (never a focus family), once each, with the same result as
 * the names of all people (WP-K). A view asks for the people it shows: the rows of the phone list,
 * the cards of a focus family, one person window. The view of the whole tree asks for all drawn cards.
 * Nothing here runs during a pan or zoom: only a render or a sheet asks.
 *
 * Memory (0.4 WP-3b). A lookup of a big tree is large (about 45 MB at 1 000 people asked, 240 MB at 3 000), and every edit that
 * changes a parent or a partnership makes a new key. So the cache is bounded in three ways. (1) One block keeps one lookup: a new
 * lookup for a block (its `block` key: the view state key of note path and block place, shared by the block and its full-screen
 * view) takes the older ones of that block out. (2) The lookups together stay under a size budget (`RELATION_BUDGET_BYTES`, an
 * estimate from the people of the tree and the people asked); the least recently used go first, never the one just asked for.
 * (3) A closed view releases its block (`releaseRelations`): the lookup is then idle. It is not dropped at once, because Obsidian
 * unloads and draws a block again (reading and edit view, scrolling) and a big tree would work its names out again; a new view of
 * the same tree that asks before the lookup is evicted gets a hit. Idle lookups are the first to go under the budget. A renamed
 * note moves its blocks (`moveRelationBlocks`), so no key outlives its block. A caller with no block (a test, a script) is only
 * bound by the budget and `RELATION_CACHE_SIZE`, which also counts the idle lookups.
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

/** The most lookups that callers with no block keep. A caller with a block keeps one lookup for each block. */
export const RELATION_CACHE_SIZE = 8;

/**
 * The size the kept lookups may have together, in bytes: two lookups of 1 000 people asked (45 MB each, measured). One lookup that is
 * larger than this is still kept while it is the one asked for, because a view draws from it.
 */
export const RELATION_BUDGET_BYTES = 100_000_000;

// Fitted to the heap that a lookup of generated trees of 500 to 3 000 people keeps when every person is asked: 19, 45, 121 and 240 MB (0.4 WP-3b).
const BYTES_PER_TREE_PERSON = 1000;
const BYTES_PER_NAMED = 30_000;
// The cost of each named person grows with the people named (more candidates share each search), so the total grows with the square.
const BYTES_PER_NAMED_SQUARED = 26;

/**
 * The bytes that a lookup of a tree of `people` keeps when `named` of them were worked out and got a relation (an estimate within about
 * 10 % for a whole tree, and high for a few people: it is a budget, so an error to the high side is the safe one).
 */
export function estimateRelationBytes(people: number, named: number): number {
	return people * BYTES_PER_TREE_PERSON + named * BYTES_PER_NAMED + named * named * BYTES_PER_NAMED_SQUARED;
}

interface Entry {
	value: TreeRelations;
	/** The blocks that asked for this lookup last; an entry that a newer lookup of its last block replaces goes, unless a caller with no block asked for it. */
	blocks: Set<string>;
	/** The blocks that let go of this lookup when their views closed: a newer lookup of such a block also takes this one out. */
	released: Set<string>;
	loose: boolean;
	/** True after the last block of the entry was released (its views closed): the first to be evicted, and a hit by a block takes it back. */
	idle: boolean;
	/** People of the tree, and the distinct people who got a relation so far: the size grows while views ask. */
	people: number;
	named: Set<string>;
}

/** Map order is the order of use: the first entry is the least recently used. */
const cache = new Map<string, Entry>();

const sizeOf = (e: Entry): number => estimateRelationBytes(e.people, e.named.size);

/**
 * The `relationsKey` of each graph object, by mark and options: it costs about 4.5 ms for 5 000 people, and a render asks several times.
 * This relies on a `FamilyGraph` never being changed after `deriveFamilies` made it: an edit makes a new graph.
 */
const keys = new WeakMap<FamilyGraph, Map<string, string>>();

/** How often a lookup was made (not taken from the cache), and how often one was taken out of it; the tests read them. */
export const relationStats = { computed: 0, evicted: 0 };

/** The mark of `g` if it names a person of `g` (spec §13.1: otherwise the tree shows no names). */
export function validMe(g: FamilyGraph, me: string | undefined): string | null {
	return me !== undefined && g.byId.has(me) ? me : null;
}

function keyOf(g: FamilyGraph, me: string, options: RelationOptions): string {
	let per = keys.get(g);
	if (!per) keys.set(g, (per = new Map<string, string>()));
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

function drop(key: string): void {
	if (cache.delete(key)) relationStats.evicted++;
}

/** Takes `block` off every entry except `keep`, and drops the entries that no block holds any more (an entry that a caller with no block made stays). */
function leaveOthers(block: string, keep: string | null): void {
	for (const [key, e] of [...cache]) {
		if (key === keep) continue;
		const had = e.blocks.delete(block) || e.released.delete(block);
		if (had && e.blocks.size === 0 && !e.loose) drop(key);
	}
}

/** Keeps the cache inside its bounds. `current` is the lookup just asked for; it always stays. */
function enforce(current: string): void {
	let loose = 0;
	let total = 0;
	for (const e of cache.values()) {
		if (e.loose || e.idle) loose++;
		total += sizeOf(e);
	}
	// A hit on an unchanged tree stops here, with no allocation: a row of a sheet asks once for each person.
	if (loose <= RELATION_CACHE_SIZE && total <= RELATION_BUDGET_BYTES) return;
	for (const [key, e] of [...cache]) {
		if (loose <= RELATION_CACHE_SIZE) break;
		if (key === current || !(e.loose || e.idle)) continue;
		drop(key);
		total -= sizeOf(e);
		loose--;
	}
	// Idle lookups first, each group in order of use.
	for (const idle of [true, false]) {
		for (const [key, e] of [...cache]) {
			if (total <= RELATION_BUDGET_BYTES) return;
			if (key === current || e.idle !== idle) continue;
			total -= sizeOf(e);
			drop(key);
		}
	}
}

/**
 * The relation names of the whole tree `g` to `me`, from the cache when the tree, the mark and the
 * options did not change. The plugin passes `{ oneParentUnknown }` of its settings (D174), and the
 * `block` that asks (see the header): the older lookups of that block go when it gets another one.
 */
export function relationsFor(g: FamilyGraph, me: string, options: RelationOptions = DEFAULT_RELATION_OPTIONS, block?: string): TreeRelations {
	// The options are in the key, so names of the other setting never come back from the cache.
	const key = keyOf(g, me, options);
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		if (block !== undefined) {
			leaveOthers(block, key);
			hit.blocks.add(block);
			hit.loose = false;
			hit.idle = false;
			hit.released.delete(block);
		}
		enforce(key);
		return hit.value;
	}
	relationStats.computed++;
	const all = relationLookup(g, me, options);
	const named = new Set<string>();
	// The count of the people with a relation is what the lookup keeps; `get` and `getMany` are the only ways in.
	const counted: RelationLookup = {
		get(id) {
			const r = all.get(id);
			if (r && !named.has(id)) {
				named.add(id);
				grew();
			}
			return r;
		},
		getMany(ids) {
			const out = all.getMany(ids);
			const was = named.size;
			for (const id of out.keys()) named.add(id);
			if (named.size > was) grew();
			return out;
		},
	};
	// The lookup grows while views ask, so the budget is applied then too; a lookup that was taken out meanwhile (a view still holds it) pushes nothing out.
	const grew = (): void => {
		if (cache.get(key)?.value === value) enforce(key);
	};
	const value: TreeRelations = { all: counted, cards: cardsOf(counted) };
	if (block !== undefined) leaveOthers(block, null);
	cache.set(key, { value, blocks: new Set(block !== undefined ? [block] : []), released: new Set(), loose: block === undefined, idle: false, people: g.people.length, named });
	enforce(key);
	return value;
}

/** A view closed: its block lets go of its lookup, which becomes idle if no other block holds it. The caller checks that no other view of the same block (the full-screen view) is still open. */
export function releaseRelations(block: string): void {
	for (const e of cache.values()) {
		if (!e.blocks.delete(block)) continue;
		e.released.add(block);
		if (e.blocks.size === 0) e.idle = true;
	}
}

/** A note was renamed: the blocks of `oldPath` (keys that start with the path and a NUL) go on under `newPath`. */
export function moveRelationBlocks(oldPath: string, newPath: string): void {
	const prefix = `${oldPath}\u0000`;
	for (const e of cache.values()) {
		for (const set of [e.blocks, e.released]) {
			for (const b of [...set]) {
				if (!b.startsWith(prefix)) continue;
				set.delete(b);
				set.add(newPath + b.slice(oldPath.length));
			}
		}
	}
}

/** The block of a view got another key (Obsidian told its place): its lookup follows. */
export function moveRelationBlock(oldBlock: string, newBlock: string): void {
	if (oldBlock === newBlock) return;
	for (const e of cache.values()) {
		for (const set of [e.blocks, e.released]) if (set.delete(oldBlock)) set.add(newBlock);
	}
}

/** What the cache holds now, for the tests: the number of lookups, their estimated size and the blocks that hold one. */
export function relationCacheInfo(): { lookups: number; bytes: number; blocks: string[]; idle: number } {
	let bytes = 0;
	let idle = 0;
	const blocks = new Set<string>();
	for (const e of cache.values()) {
		bytes += sizeOf(e);
		if (e.idle) idle++;
		for (const b of e.blocks) blocks.add(b);
	}
	return { lookups: cache.size, bytes, blocks: [...blocks], idle };
}

/** Empties the cache: the settings button "Arrange again", and the harness before a cold timing. */
export function clearRelationCache(): void {
	cache.clear();
}
