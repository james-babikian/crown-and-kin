/*
 * Relation names (spec §13.1) and the relation finder (spec §13.2; D40–D50). `computeRelations`
 * names every person's relation to the marked person ("This is me"); `findRelation` names the
 * relation of one person to another, or finds the shortest chain of links between them;
 * `relationLookup` gives the same names for the people a view asks for, each worked out once;
 * `lineSubgraph` builds the small tree that shows one relation (D47); `relationsKey` is the cache
 * key of the names. The names are English kinship words (exempt from the STE word rule, §13.0
 * item 5), all in the `WORDS` table (`relation-words.ts`); `src/render/tree-info.ts` builds the sentences around them.
 *
 * The code is in several files. This file holds the public functions and this header. `relation-types.ts` holds the public types, `relation-words.ts` the `WORDS` table and the
 * word functions, `relation-internal.ts` the shapes by person index, and `relation-candidates.ts` the helpers on lists of candidates. The search is a chain of three classes:
 * `KinBase` (`relation-kin-base.ts`: the graph by index, the parent sets, the readers of unions and partners), `KinBlood` (`relation-kin-blood.ts`: the blood search and the
 * views of the tree) and `Kin` (`relation-kin.ts`: the names, the chain and the steps).
 *
 * Links. Every rule follows the parent links after validation and cycle breaking, from
 * `drawnParents` (placement links, then `g.secondary` in order), so a parent cycle can never make a
 * search loop. `writtenParents`, `ancestorsOf` and `person.parents` are not cycle-broken, so this
 * file never uses them.
 *
 * Lines (the `RelationLine` of each kind of relation):
 * - Blood (common ancestor X, M up a links, P up b links): M up to X, then (full relations only) X's
 *   partner in the couple, then down to P. The lengths a and b are always the shortest over all
 *   links. Among the shortest lines, one with only birth links wins, then one with birth and
 *   adoptive links, then any (the rank of the two links at the top of a full pair is read at the
 *   couple member whose link the word uses, the first of the couple, not at the X of the search, so
 *   a birth line through X2 beats an adoptive link to X1); then full before half; then list order: at each step up, the first
 *   parent in the child's `drawnParents` list that lies on such a line, and at X the first pair of
 *   children (c1, c2) in `down` order. For a full relation, X is the member of the couple first in
 *   c1's list, and the union is c1's `primaryUnion` if it is the couple's, else the couple's
 *   last-listed union, else their implicit key. A line uses a couple only if the two share a union
 *   of the tree (listed, or implicit through a child placed under both); else it passes X alone
 *   (two rumoured parents, an adoptive couple beside birth parents). A full line of rule 1 below
 *   follows rule 1. A double relation takes the line of its first couple (the lowest X).
 * - Partner: M and P, with the pair's last-listed union, or their implicit key. The word reads every marriage of the pair (see "Years").
 * - Guardian and ward: M and P, with the one ward link.
 * - By marriage, rule 1: the blood line from M to R, then P, with the last-listed marriage of R and P (the words read every marriage, see "Years").
 * - By marriage, rule 2: M, then M's spouse S, then S's blood line to P; the M–S marriage comes first.
 *   The name needs a line that does not pass M. Any line of the name will do: its own, one joined into
 *   it (rule 6 of "Half or full"), or one of the other couple of a double name. The first that avoids
 *   M is shown. The search keeps one line for each name, so a line that avoids M can be missing; then
 *   the search runs once more in the tree without M's own blood links (`KinBlood.cutView`), and the name stays
 *   if that tree gives the same name text and a line that avoids M. A "double" name needs a line of
 *   each of its couples that avoids M, so the same tree decides it: a double that needs a line through
 *   M shows as the single name of the couple whose line avoids M. A descendant of S (a = 0) is a
 *   step-descendant of M only through a child of S who is not M's child by a birth or adoptive link:
 *   its name, its link word and its line come from the tree without S's links down to M's own
 *   children (`KinBlood.stepView`), so a child linked to S by a rumoured link only gives a rumoured name. So the
 *   name does not depend on the order of the people or of a person's parents. Known limits: (a) the
 *   cut tree gives names, not link words: a name that differs only in its link word (adoptive,
 *   rumoured) is not restored; (b) a rumoured cousin name by marriage,
 *   where a line of the name runs through M (a rumoured double cousin, or a rumoured cousin that the second
 *   test makes), can still change with the parent order;
 *   (c) a child with three birth parents: the order inside S's parent list can decide a name such as
 *   "Sister-in-law" (the placement uses two of the three parents); (d) when M is a descendant
 *   of S (a marriage to one's own parent or adoptive parent), a step-descendant name is not shown when
 *   the line through M is shorter than the line that avoids M. A candidate keeps these
 *   other lines (`also`: one flat list, each line once, only its people) and the line of its maybe
 *   (`maybeFrom`) only until the names of its person are made; then `forget` drops them, so a result
 *   keeps only the one line that each name shows.
 * - Step-sibling: M, N, Q, P, with the links N→M and Q→P and the N–Q marriage. N is the first
 *   parent of M (in `drawnParents` order) with such a marriage.
 * - Chain: the people of a breadth-first search in order. It counts raw links; from each person it
 *   visits the parents in `drawnParents` order, then the children in `g.people` order, then the
 *   partners in `unionsOf` order. The first chain found wins.
 *
 * Years (D304 to D309, `exact-year.ts`, `marriage-years.ts`). A year counts only if it is exact
 * (`exactYear`), and every comparison is strict. The words of a pair read ALL the marriages of the pair (`marriagesOf`), never the last-listed one;
 * the line shows the last-listed marriage as before. (1) A step word (step-parent, step-grandparent, stepchild, step-grandchild, step-sibling) holds only
 * if some marriage may overlap the life of the child at the step link (not APART): K is M for a step-parent, every parent of M who is a child of R for
 * a step-grandparent, P or any stepchild of S on a shortest line to P for a stepchild or step-grandchild, and both M and P for a step-sibling. For a
 * confirmed name the K sets hold only birth and adoptive links on both steps (a rumour never changes a confirmed word); a rumoured name keeps every link. The
 * finder line goes through a K that passes (the line found first if its K passes, else the lowest document index). A step
 * word that fails is the possessive form ("Father's wife"). (2) "Former" (D305, D307): a marriage that ENDED (`ended-by` divorce or annulment, or an
 * exact end year before both exact death years) gives "Former" to the partner word, to a step word and to an in-law or "by marriage" name (F4, D309: not
 * if the person on the blood side died, by exact years, before the exact end year), and to the partner word of a possessive form (rule P: "Father's
 * former wife", "Former wife's half-nephew", no death test). A death never adds a word (D308). "Former" stands before the whole name, after "Rumoured".
 * A candidate with "former" keeps the same name without it in `base`: the order of the names (key 10) and rule D read it, so "former" never changes a
 * tie; and when one name comes both with and without "former" (two marriages, one ended), only the form without stays (rule D). A restored name
 * (rule 2 above) gets the same test through the same marriages. The finder's partner steps read the pair's marriages too, so they agree with the card.
 * `relationsKey` holds the date texts, `ended-by` and the date reader (ready, key), so an edit of one of them makes new names.
 * Limits: a child born the year after his father died reads his widow as "Father's wife" (the strict test); a divorce with no `ended-by` is found only
 * from an exact end year and exact death years of both partners (`died: no` gives none); a death with no exact year never stops a "former".
 *
 * Candidates (the §13.1 blood rules). A candidate (X, a, b) stays if at least one pair of shortest
 * paths leaves X through different children and does not have both paths pass through one other
 * common ancestor below X (spec §13.1 step 3). The search for such a pair is exact. Each distinct
 * full or half result at X (full: one per couple) is one candidate (D50), so the names never depend
 * on the order of siblings; each takes the line with the best link type, as above.
 *
 * D200 R1. The search keeps the shortest line to each ancestor, so a rumoured link could hide a longer sure line
 * ("Great-grandfather" beside "Rumoured father"). When a rumoured link lies in the ancestry of either person and the sure
 * distances differ from the whole ones, `KinBlood.sureView` (the same tree with the rumoured links left out of `up` and `down`) gives
 * the candidates of the sure links; those whose key the whole tree did not give join the list, and "double" is decided
 * for the whole list. The by-marriage gate of rule 1 asks for a sure blood name, not any blood name. Sure-on-sure collapse
 * (a mother who is also the great-grandmother shows only as "Mother") stays, by design.
 *
 * Double (D175). Full cousin candidates of one name and one link word make a "double" name only if two
 * of them come from two couples. Not if one is a couple of the second test (rule 1 below) and a
 * couple of two or more people of one is part of the couple of the other: a sure couple plus a
 * rumoured parent is one couple. A parent alone is never part of another couple, so one parent and a
 * couple with that parent (setting off) are two couples, as are two couples that share one person
 * (a man and his two wives). And not if every line of the two, of that word, leaves through the same
 * two children. Each candidate keeps every pair of children that gave it a line, also the pairs the
 * search passed over because the key was taken, so the first pair found never decides it and the names
 * do not depend on the order of the people. A passed-over pair is searched only for a group of names
 * that the lines found so far do not settle and the couple test alone does not settle either, and only
 * if its key could be one of that group.
 *
 * Order. Names come best first by §13.1 "Which name wins", rules 1–4, with the keys of `compareCands`: each one
 * belongs to the name itself, so the order of the people in the note never decides a name. A name by marriage of a person
 * who also has a sure blood name comes after all other names; a rumoured blood name competes with the names by marriage
 * by distance and kind. A name by marriage whose blood leg is rumoured counts as rumoured and gets "Rumoured " in front
 * (the possessive forms already say it, and an adoptive leg gets no word). Each distinct `lower` is listed once
 * (the first in the order is kept). Distances: self 0, partner 1, guardian and ward 1, by marriage 1 + the blood
 * distance, step-sibling 3, blood a + b.
 *
 * Known limits (D200 R5): the partner names of a child with three birth or three adoptive parents use the two parents
 * used for placement (so the parent order of such a child can decide "Co-parent", and whether two adoptive parents share an
 * implicit union, which decides D293: "Adoptive sister" or "Adoptive half-sister"); a pair with a sure and a rumoured line of equal length can have different "Also" lists in
 * the two directions; rule 1 of the names by marriage skips a blood relative of M, rule 2 does not;
 * a rumoured link plus a person married to their own child can still make a name by marriage depend on
 * the order of the people.
 *
 * Steps (the finder and "Show the steps"). There is one step per link, except that a step up to a
 * parent followed by a step down to another child of that parent is one sibling step ("brother",
 * "half-brother" by the sure test of "Half or full" below, "sibling"); a ward link never joins a
 * sibling step. A step carries the type of its links: "adoptive father", "adopted son", "rumoured
 * father", "rumoured son", "guardian", "ward", and for a sibling step "rumoured brother" or "rumoured
 * half-brother" (half or full by rule 1 of "Half or full") if one of its two links is rumoured, else
 * "adoptive brother" if one is adoptive. The sibling steps of a rumoured name (a rumoured line, or
 * the extra "Rumoured X" name) all take half or full from rule 1, so the steps agree with the name;
 * a sibling step whose half or full the second test changes is "rumoured" also over two birth links.
 * A partner step uses the §13.1 partner table. "Through N other people" counts `line.people.length − 2`.
 *
 * Half or full (D123, D174). Per candidate (X, c1, c2), with c1 and c2 the children of X on the two
 * paths: S_i are the parents of c_i of the type of c_i's link to X; R_i are the rumoured parents of c_i
 * that are not in S_i (none when the link is adoptive); A_i is S_i plus R_i. The setting
 * `oneParentUnknown` (on by default) says if a person who lists one parent has an unknown second parent.
 * - D293, the legal parents. A child with one birth parent and one adoptive parent who share a union of the tree (a
 *   step-parent or second-parent adoption) has two legal parents: for a birth or an adoptive link its S_i is the birth
 *   and the adoptive parents together (`legalParents`), so it is complete and a sibling with the same two is full
 *   ("Adoptive brother", or "Brother" if they share a birth parent: `orderCouple` puts that parent first, and the
 *   link to the second parent can only make a word rumoured). A full adoption by unrelated parents, a child with two
 *   birth parents, a child with more than one adoptive parent, and a sibling who has only one of the two stay as before.
 *   Only the sure test uses the legal parents; the second test and its choices count the birth and rumoured parents.
 * - The sure test. A child is incomplete if its link is not adoptive, S_i has fewer than two people, and
 *   the setting is on or the child has a rumoured parent who is not also a birth parent. The pair is full only if S1 equals S2 and
 *   neither child is incomplete. A rumoured parent is never in the S_i of a birth link. The finder's
 *   sibling steps use the same test.
 * - The second test counts every rumoured link like a birth link: compare A1 with A2. With the setting
 *   on, an A_i of fewer than two people (not for an adoptive link) makes the pair half.
 * - D176, the choices. A child with at most one sure parent and three or more listed parents (S + R) could have
 *   any two of them, since one of the rumours may be false: its `choices` are S plus each set of rumoured parents
 *   that makes two people, and also the whole S + R (without it, a person who lists all of three parents would
 *   lose a maybe). Every other child has one choice, S + R; so has a child of an adoptive link, and one with more
 *   than eight rumoured parents. The second test is `secondHalf` alone: the pair is full if a choice of one child
 *   equals a choice of the other and that set is not one that the setting calls incomplete. The card, the sheet,
 *   rule 1 and the steps of the finder all use it, so they cannot disagree. With one choice each it is the
 *   comparison of A1 and A2 above.
 * (1) A candidate on a rumoured line takes half or full from the second test; it is a candidate of its
 * own, apart from the sure candidate of the same pair (other key). If that makes it half, its line
 * passes X alone. If it makes it full, its couple is A1 (with several choices: the people of all the
 * equal choices) and its key is that set, so Xan and a rumoured Zoe give one candidate, found at both of them (D175). Its line must keep a rumoured link,
 * so that the steps say "rumoured" (§13.2): it passes the first two members of A1 (c1's list order)
 * that share a union of the tree and give the line a rumoured link (below c1 and c2, from c1 up to the
 * first, or from the second down to c2); else the first member with a rumoured link to c1 or c2,
 * alone, so the line has a "rumoured" sibling step. Siblings keep X alone, as their one sibling step
 * shows the rumoured link (D174). (2) A sure half candidate
 * gets `maybe` 'full' if either child has a rumoured parent and a choice of one equals a choice of the other (any size; D176);
 * with the setting on, also if two choices together have at most two people. The `some` flag (D176) says that
 * an equal choice leaves out a rumoured parent of either person, so one rumoured link is enough. D200 R4: for this
 * maybe a child with two sure parents and a rumoured parent has one more outcome, the two sure parents alone (the
 * rumour may be false), so Tom (Anna, rumoured Carl) and Sue (Carl, Anna, rumoured Dirk) read "Half-brother, maybe
 * full". The same outcomes serve the unlisted parent: Sue and Tom (Anna) read "maybe full" too. `choices` and so `secondHalf` do not change
 * (Eleanor and Fiona stay "Sister, maybe half"). The extra name takes the other outcome and its steps print it; a rumoured half line
 * of the same degree adds no second "Rumoured half-brother" beside "Rumoured brother" (D205 item 2). An 'unlisted' maybe says which of two sentences is true. (3) With the setting off, a parent who is not listed adds no maybe.
 * (4) A sure full candidate gets `maybe` 'half' if the rumoured parents of the two children differ; one rumoured parent is enough.
 * (5) No maybe on a rumoured line, on a `double` name, or where the link of c1 or c2 to X is adoptive.
 * The `cause` of a maybe is 'rumoured' for rule 4 and for rule 2 with equal A1 and A2; else 'unlisted'
 * (rule 2 by the count of two, setting on). Only a rumoured cause adds the extra name ("Rumoured
 * brother"), with the line of the pair of children that gave the maybe, so that a step says "rumoured"
 * in any order of the people; the half name's line passes the top alone (D176): the rumoured parent is not an
 * ancestor of the other person, so the sibling step says "rumoured half-sister"; not if the list has the "double" form of it ("Rumoured double first
 * cousin" already says that the rumours make the two full cousins). (6) Equal names keep the maybe of
 * any of them: 'full' over 'half', then 'rumoured' over
 * 'unlisted'; this holds also for two pairs of children at one X with one sure key (cousin
 * marriage), so the names never depend on the order of the children. The second test runs only
 * where a rumoured link lies in the blood ancestry of either person, or where the setting is on and
 * the sure test gives half, so a tree with no doubt does no extra work. The setting lives on the `Kin` of one call, so no memo mixes the two modes.
 *
 * Results are deep-frozen, like layout results, because the views share them.
 */

import { deepFreeze, lockMap } from './deep-freeze';
import { deriveFamilies, type DrawnParent, drawnParentMap, type FamilyGraph, type FamilyUnion } from './derive';
import { walkLine } from './relation-candidates';
import { Kin } from './relation-kin';
import { type ComputeRelations, DEFAULT_RELATION_OPTIONS, FINDER_LIMIT, type FinderResult, type FindRelation, type LineSubgraph, type Relation, type RelationLink, type RelationOptions, type RelationsKey } from './relation-types';
import { capital, WORDS } from './relation-words';
import { readEndedBy, type Tree, type Union } from './types';
import { push } from './validate';

export type { ComputeRelations, FinderResult, FindRelation, LineSubgraph, Relation, RelationLine, RelationMaybe, RelationOptions, RelationsKey, RelationStep } from './relation-types';
export { DEFAULT_RELATION_OPTIONS, FINDER_LIMIT, relationCallStats, relationRunStats } from './relation-types';

/** Blocks `set`, `delete` and `clear` too: `Object.freeze` does not stop them on a Map, and the views share the result. */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
	lockMap(map);
	return Object.freeze(map);
}

/** Implements `ComputeRelations`: every person's relations to `me`, best first. */
export const computeRelations: ComputeRelations = (g, me, options = DEFAULT_RELATION_OPTIONS) => {
	const out = new Map<string, readonly Relation[]>();
	const kin = new Kin(g, options);
	const m = kin.idx.get(me);
	if (m === undefined) return freezeMap(out);
	const self: Relation = { text: capital(WORDS.you), lower: WORDS.you, kind: 'self', distance: 0, line: { people: [me], links: [], unions: [] } };
	for (let p = 0; p < kin.ids.length; p++) {
		if (p === m) {
			out.set(me, deepFreeze([self]));
			continue;
		}
		const cands = kin.relationsFor(m, p);
		if (cands.length) out.set(kin.ids[p], Object.freeze(cands.map((c) => kin.lazyRelation(c))));
	}
	kin.release();
	return freezeMap(out);
};

/** The relations of the people that a view asks for, one answer per person (spec §13.1 "Performance"). */
export interface RelationLookup {
	/** The same value as `computeRelations(g, me, options).get(id)`: undefined for a person with no relation, for an unknown id, and for every id when `me` is not a person. */
	get(id: string): readonly Relation[] | undefined;
	/** `get` for each id of the list, as a map that holds only the people with a relation (like `computeRelations`). The search memos are dropped once, at the end. */
	getMany(ids: Iterable<string>): ReadonlyMap<string, readonly Relation[]>;
}

/**
 * A lookup that gives what `computeRelations(g, me, options)` gives, for the people asked, each worked out once on one full
 * `Kin` (same code, same data, so same names, lines and order). It must never call `relationsFor` twice for one person: a
 * second call reads candidates that the first one cleaned (`forget`) and loses names. So each answer is kept. The search
 * memos are dropped after every request (`release`); the lines that are built later need only the candidates.
 */
export function relationLookup(g: FamilyGraph, me: string, options: RelationOptions = DEFAULT_RELATION_OPTIONS): RelationLookup {
	let kin: Kin | undefined;
	let mark: number | undefined;
	let self: readonly Relation[] | undefined;
	// By index, not by id: a tree that repeats an id (computeRelations keeps the last index that has a name) needs each index once.
	const done = new Map<number, readonly Relation[] | null>();
	let repeated: Map<string, number[]> | undefined;
	let worked = false;

	const open = (k: Kin): void => {
		mark = k.idx.get(me);
		if (k.idx.size === k.ids.length) return;
		const by = new Map<string, number[]>();
		k.ids.forEach((id, i) => by.set(id, [...(by.get(id) ?? []), i]));
		repeated = by;
	};

	const named = (k: Kin, m: number, p: number): readonly Relation[] | null => {
		const hit = done.get(p);
		if (hit !== undefined) return hit;
		let out: readonly Relation[] | null;
		if (p === m) {
			self ??= deepFreeze([{ text: capital(WORDS.you), lower: WORDS.you, kind: 'self', distance: 0, line: { people: [me], links: [], unions: [] } } satisfies Relation]);
			out = self;
		} else {
			const cands = k.relationsFor(m, p);
			out = cands.length ? Object.freeze(cands.map((c) => k.lazyRelation(c))) : null;
		}
		done.set(p, out);
		worked = true;
		return out;
	};

	const one = (id: string): readonly Relation[] | undefined => {
		if (!kin) {
			kin = new Kin(g, options);
			open(kin);
		}
		if (mark === undefined) return undefined;
		const at = repeated ? (repeated.get(id) ?? []) : kin.idx.has(id) ? [kin.idx.get(id)!] : [];
		for (let i = at.length - 1; i >= 0; i--) {
			const r = named(kin, mark, at[i]);
			if (r) return r;
		}
		return undefined;
	};

	const finish = (): void => {
		if (worked) kin?.release();
		worked = false;
	};

	return {
		get(id) {
			const r = one(id);
			finish();
			return r;
		},
		getMany(ids) {
			const out = new Map<string, readonly Relation[]>();
			for (const id of ids) {
				const r = one(id);
				if (r) out.set(id, r);
			}
			finish();
			return freezeMap(out);
		},
	};
}

/** Implements `FindRelation`: the second person as a relative of the first (§13.2). */
export const findRelation: FindRelation = (g, first, second, options = DEFAULT_RELATION_OPTIONS) => {
	const none: FinderResult = { kind: 'none', first, second };
	const kin = new Kin(g, options);
	const f = kin.idx.get(first);
	const s = kin.idx.get(second);
	if (f === undefined || s === undefined || f === s) return deepFreeze(none);
	const cands = kin.relationsFor(f, s);
	if (cands.length) {
		const relations = cands.slice(0, FINDER_LIMIT).map((c) => {
			const { line, walk } = c.make();
			return { relation: kin.relation(c, line), steps: kin.steps(walk, c.second, c.stepHalf) };
		});
		return deepFreeze({ kind: 'named', first, second, relations });
	}
	const walk = kin.chain(f, s);
	if (!walk) return deepFreeze(none);
	return deepFreeze({ kind: 'chain', first, second, steps: kin.steps(walk), line: kin.lineIds(walkLine(walk)) });
};

/** Implements `LineSubgraph`: the small tree of one relation line (D47). */
export const lineSubgraph: LineSubgraph = (g, line) => {
	const on = new Set(line.people.filter((id) => g.byId.has(id)));
	const own = new Map<string, RelationLink[]>();
	const has = (l: RelationLink) => (own.get(l.child) ?? []).some((k) => k.parent === l.parent && k.type === l.type);
	for (const l of line.links) if (on.has(l.parent) && on.has(l.child) && !has(l)) push(own, l.child, l);
	// A full relation's couple keeps its shared trunk. A child on the line with a
	// link to one partner of a couple of the line also keeps its drawn link of the same type to the other.
	const drawn = drawnParentMap(g);
	for (const key of line.unions) {
		const pair = g.unionByKey.get(key)?.partners ?? (key.startsWith('i:') ? parsePair(key.slice(2)) : undefined);
		if (!pair || !pair.every((id) => on.has(id))) continue;
		for (const l of [...line.links]) {
			const other = l.parent === pair[0] ? pair[1] : l.parent === pair[1] ? pair[0] : undefined;
			if (other === undefined || !on.has(l.child) || !(drawn.get(l.child) ?? []).some((d) => d.id === other && d.type === l.type)) continue;
			const link: RelationLink = { parent: other, child: l.child, type: l.type };
			if (!has(link)) push(own, l.child, link);
		}
	}
	// Parents in the order the whole tree lists them, so the small tree places a child as it does.
	const order = (id: string, links: RelationLink[]) => {
		const rank = (l: RelationLink) => {
			const k = (drawn.get(id) ?? []).findIndex((d) => d.id === l.parent && d.type === l.type);
			return k < 0 ? Infinity : k;
		};
		return [...links].sort((a, b) => rank(a) - rank(b));
	};
	for (const [id, links] of own) own.set(id, order(id, links));
	const people = g.people.filter((p) => on.has(p.id)).map((p) => ({ ...p, parents: (own.get(p.id) ?? []).map((l) => ({ id: l.parent, type: l.type })) }));

	const unions: Union[] = [];
	for (const key of new Set(line.unions)) {
		const fu = g.unionByKey.get(key);
		if (!fu || fu.implicit || fu.unionIndex === undefined || !fu.partners.every((id) => on.has(id))) continue;
		const u: Union = { partners: [...fu.partners], type: fu.type, index: fu.unionIndex };
		for (const key of ['id', 'start', 'end', 'endedBy', 'text'] as const) if (fu[key] !== undefined) u[key] = fu[key];
		unions.push(u);
	}
	unions.sort((a, b) => a.index - b.index);
	const tree: Tree = { options: {}, houses: [...g.houses.values()], people, unions, issues: [] };
	const sub = deriveFamilies(tree);
	// Spec §13.4, titles rule 3 (`titles.ts` header): the whole tree's titles, unchanged, so the cards show the same texts.
	sub.titles = g.titles;
	sub.writtenTitles = g.writtenTitles;
	sub.dates = g.dates;

	// A child on the line only through rumoured links hangs from its first rumoured parent (drawn
	// with the rumoured line and its "?"), not as a separate root.
	for (const p of sub.people) {
		if ((sub.placementParents.get(p.id) ?? []).length) continue;
		const links = own.get(p.id) ?? [];
		if (!links.length || links.some((l) => l.type !== 'rumoured')) continue;
		const parent = links[0].parent;
		sub.placementParents.set(p.id, [parent]);
		sub.placementType.set(p.id, 'rumoured');
		const solo = sub.soloChildren.get(parent) ?? [];
		solo.push(p.id);
		solo.sort((a, b) => sub.byId.get(a)!.index - sub.byId.get(b)!.index);
		sub.soloChildren.set(parent, solo);
		sub.secondary = sub.secondary.flatMap((e) => {
			if (e.child !== p.id || e.type !== 'rumoured' || !e.parents.includes(parent)) return [e];
			const rest = e.parents.filter((q) => q !== parent);
			return rest.length ? [{ child: e.child, type: e.type, parents: rest }] : [];
		});
	}

	// An implicit couple of the line with no shared child on it stays as a plain connector.
	for (const key of line.unions) {
		if (!key.startsWith('i:') || sub.unionByKey.has(key)) continue;
		const pair = parsePair(key.slice(2));
		if (!pair || !pair.every((id) => on.has(id))) continue;
		const fu: FamilyUnion = { key, partners: pair, type: 'implicit', implicit: true, children: [] };
		sub.unions.push(fu);
		sub.unionByKey.set(key, fu);
		for (const id of pair) push(sub.unionsOf, id, key);
	}
	return { ...sub, issues: [] };
};

function parsePair(json: string): [string, string] | undefined {
	try {
		const v: unknown = JSON.parse(json);
		if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0] !== v[1]) return [v[0], v[1]];
	} catch {
		// Not a key this module made.
	}
	return undefined;
}

/** Implements `RelationsKey`: what `computeRelations(g, me)` depends on, not names. */
export const relationsKey: RelationsKey = (g, me, options = DEFAULT_RELATION_OPTIONS) => {
	const drawn = drawnParentMap(g);
	// The words read exact years (D304, D306): the key holds the date texts as written, not the years, so it needs no date read; an edit that keeps the year only makes a harmless new lookup.
	const people = g.people.map((p) => [p.id, p.sex ?? null, g.primaryUnion.get(p.id) ?? null, (drawn.get(p.id) ?? []).map((d: DrawnParent) => [d.id, d.type]), p.born ?? null, p.died ?? null]);
	const unions = g.unions.map((u) => [u.key, u.partners, u.type, u.start ?? null, u.end ?? null, readEndedBy(u.endedBy)]);
	// A tree that names a calendar reads its years only when the reader is ready, so the words may change once.
	return JSON.stringify([me, people, unions, options.oneParentUnknown, g.dates.reader.ready, g.dates.reader.key]);
};
