/*
 * Relation names (spec §13.1) and the relation finder (spec §13.2; D40–D50). `computeRelations`
 * names every person's relation to the marked person ("This is me"); `findRelation` names the
 * relation of one person to another, or finds the shortest chain of links between them;
 * `relationLookup` gives the same names for the people a view asks for, each worked out once (WP-K);
 * `lineSubgraph` builds the small tree that shows one relation (D47); `relationsKey` is the cache
 * key of the names. The names are English kinship words (exempt from the STE word rule, §13.0
 * item 5), all in the `WORDS` table below; `src/render/tree-info.ts` builds the sentences around them.
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
 *   adoptive links, then any; then full before half; then list order: at each step up, the first
 *   parent in the child's `drawnParents` list that lies on such a line, and at X the first pair of
 *   children (c1, c2) in `down` order. For a full relation, X is the member of the couple first in
 *   c1's list, and the union is c1's `primaryUnion` if it is the couple's, else the couple's
 *   last-listed union, else their implicit key. A line uses a couple only if the two share a union
 *   of the tree (listed, or implicit through a child placed under both); else it passes X alone
 *   (two rumoured parents, an adoptive couple beside birth parents). A full line of rule 1 below
 *   follows rule 1. A double relation takes the line of its first couple (the lowest X).
 * - Partner: M and P, with the pair's last-listed union, or their implicit key.
 * - Guardian and ward: M and P, with the one ward link.
 * - By marriage, rule 1: the blood line from M to R, then P, with the last-listed marriage of R and P.
 * - By marriage, rule 2: M, then M's spouse S, then S's blood line to P; the M–S marriage comes first.
 *   The name needs a line that does not pass M. Any line of the name will do: its own, one joined into
 *   it (rule 6 of "Half or full"), or one of the other couple of a double name. The first that avoids
 *   M is shown, so the name does not depend on which line was found first. A candidate keeps these
 *   other lines (`also`: one flat list, each line once, only its people) and the line of its maybe
 *   (`maybeFrom`) only until the names of its person are made; then `forget` drops them, so a result
 *   keeps only the one line that each name shows.
 * - Step-sibling: M, N, Q, P, with the links N→M and Q→P and the N–Q marriage. N is the first
 *   parent of M (in `drawnParents` order) with such a marriage.
 * - Chain: the people of a breadth-first search in order. It counts raw links; from each person it
 *   visits the parents in `drawnParents` order, then the children in `g.people` order, then the
 *   partners in `unionsOf` order. The first chain found wins.
 *
 * Candidates (the §13.1 blood rules). A candidate (X, a, b) stays if at least one pair of shortest
 * paths leaves X through different children and does not have both paths pass through one other
 * common ancestor below X (spec §13.1 step 3). The search for such a pair is exact. Each distinct
 * full or half result at X (full: one per couple) is one candidate (D50), so the names never depend
 * on the order of siblings; each takes the line with the best link type, as above.
 *
 * R1 (0.2.8, D200). The search keeps the shortest line to each ancestor, so a rumoured link could hide a longer sure line
 * ("Great-grandfather" beside "Rumoured father"). When a rumoured link lies in the ancestry of either person and the sure
 * distances differ from the whole ones, `sureView` (the same tree with the rumoured links left out of `up` and `down`) gives
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
 * Order (R3, 0.2.8). Names come best first by §13.1 "Which name wins", rules 1–4, with the keys of `compareCands`: each one
 * belongs to the name itself, so the order of the people in the note never decides a name. A name by marriage of a person
 * who also has a sure blood name comes after all other names; a rumoured blood name competes with the names by marriage
 * by distance and kind. A name by marriage whose blood leg is rumoured counts as rumoured and gets "Rumoured " in front
 * (R2; the possessive forms already say it, and an adoptive leg gets no word). Each distinct `lower` is listed once
 * (the first in the order is kept). Distances: self 0, partner 1, guardian and ward 1, by marriage 1 + the blood
 * distance, step-sibling 3, blood a + b.
 *
 * Known limits (D200 R5, contract B.1): the partner names of a child with three birth parents use the two parents used
 * for placement (F-KIN-05); a pair with a sure and a rumoured line of equal length can have different "Also" lists in
 * the two directions (F-KIN-09); rule 1 of the names by marriage skips a blood relative of M, rule 2 does not
 * (F-KIN-12); a rumoured link plus a person married to their own child can still make a name by marriage depend on
 * the order of the people (I10).
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
 * shows the rumoured link (D174 ruling 8). (2) A sure half candidate
 * gets `maybe` 'full' if R1 or R2 is not empty and a choice of one equals a choice of the other (any size; D176);
 * with the setting on, also if two choices together have at most two people. The `some` flag (D176) says that
 * an equal choice leaves out a rumoured parent of either person, so one rumoured link is enough. R4 (0.2.8, I09): for this
 * maybe a child with two sure parents and a rumoured parent has one more outcome, the two sure parents alone (the
 * rumour may be false), so Tom (Anna, rumoured Carl) and Sue (Carl, Anna, rumoured Dirk) read "Half-brother, maybe
 * full". The same outcomes serve the unlisted parent: Sue and Tom (Anna) read "maybe full" too. `choices` and so `secondHalf` do not change
 * (Eleanor and Fiona stay "Sister, maybe half"). The extra name takes the other outcome and its steps print it; a rumoured half line
 * of the same degree adds no second "Rumoured half-brother" beside "Rumoured brother" (D205 item 2). F-KIN-08: an 'unlisted' maybe says which of two sentences is true. (3) With the setting off, a parent who is not listed adds no maybe.
 * (4) A sure full candidate gets `maybe` 'half' if R1 and R2 differ; one rumoured parent is enough.
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
import { deriveFamilies, drawnParentMap, type DrawnParent, type FamilyGraph, type FamilyUnion } from './derive';
import { CURLY_APOSTROPHE } from './quote';
import { sameList } from './same-list';
import { ordinal } from './succession-keys';
import { isUnionType, PARENT_LIMIT, PARENT_TYPES, type ParentType, type Tree, type Union } from './types';
import { push } from './validate';

/** The kinds of §13.1: which rule named the relation. */
export type RelationKind = 'self' | 'blood' | 'partner' | 'guardian' | 'ward' | 'by-marriage' | 'step-sibling';

/** One parent link that a line uses (a cycle-broken link, see the file header). */
export interface RelationLink {
	parent: string;
	child: string;
	type: ParentType;
}

/** What the result tree highlights for one relation (line rules in the file header). */
export interface RelationLine {
	/** No repeats; [0] is the first person, the last is the second person; order per the line rules. */
	people: string[];
	/** The parent links the line uses, in step order. */
	links: RelationLink[];
	/** Unions the line uses: a partner step, or the ancestor couple of a full relation. Both partners are in `people`. */
	unions: string[];
}

/**
 * D174: the one switch of the sibling rule. `oneParentUnknown` on (the default): a person who lists
 * fewer than two birth parents has an unknown parent, so two such people are at most half
 * (spec §13.1). Off: a person with one listed parent and no rumoured parent is complete.
 */
export interface RelationOptions {
	oneParentUnknown: boolean;
}

/** The options of a fresh install (D174). The functions below use them when the caller passes none. */
export const DEFAULT_RELATION_OPTIONS: Readonly<RelationOptions> = Object.freeze({ oneParentUnknown: true });

/** D123: what rumoured links could change in a blood relation. */
export interface RelationMaybe {
	/** 'full': the sure relation is half and the doubt could make it full (card text ", maybe full"). 'half': the sure relation is full and a rumoured parent would make it half (card text ", maybe half"; D174). */
	effect: 'full' | 'half';
	/** The name if the rumoured links are true, with no word "rumoured": "Brother". */
	text: string;
	/** The same name in lower case: "brother". */
	lower: string;
	/** D174: 'rumoured' if the second test settles it (the rumoured links make the sets equal, or any maybe half); 'unlisted' if the pair is full only when a parent who is not listed is the same person (setting on only). */
	cause: 'rumoured' | 'unlisted';
	/** D176: only with effect 'full' and cause 'rumoured'. True if the set of parents that makes the pair full leaves out a rumoured parent of either person: then not every rumoured link need be true ("If some of the rumoured links are true", D176 fix round). Absent if every rumoured link must be true. */
	some?: true;
	/** F-KIN-08: only with cause 'unlisted'. 'same-person': both people list the same one parent, so the unlisted parent could be the same person. 'other-parent': one lists both parents and the other one, so the other's unlisted parent could be that second parent. Cousins and beyond always read 'same-person' (known limit). */
	unlistedForm?: 'same-person' | 'other-parent';
}

/** D123: counts the second comparison run (the one that counts a rumoured link like a birth link). A tree with no rumoured link leaves it at 0 if the setting of D174 is off or no pair is half. */
export const relationRunStats = { second: 0 };

/** How often `Kin.relationsFor` ran (one call names one person), for the tests of the lookup: a person is worked out at most once. */
export const relationCallStats = { calls: 0 };

/** One name of a person's relation to the marked person (or to the finder's first person). */
export interface Relation {
	/** As a card shows it, first letter capital: "Second cousin once removed", "Wife's first cousin", "You". */
	text: string;
	/** The same name in lower case for sentences and "Also:" lists ("second cousin once removed"). */
	lower: string;
	kind: RelationKind;
	/** §13.1 "Which name wins", rule 3; the values per kind are in the file header. */
	distance: number;
	line: RelationLine;
	/** D123: only on `kind: 'blood'`, only when a rumoured link or (D174) a parent who is not listed could change the relation. */
	maybe?: RelationMaybe;
}

/**
 * All relations of every person to `me`, best first. `me` itself maps to one `self` relation ("You").
 * A person with no relation of §13.1 is absent. Returns an empty map if `me` is not a person of `g`.
 * Pure; it always ends. Each `line` is built the first time it is read.
 */
export type ComputeRelations = (g: FamilyGraph, me: string, options?: RelationOptions) => ReadonlyMap<string, readonly Relation[]>;

/** One step of a chain or of "Show the steps": `person` is `of`'s `word` ("Isolde is Roderick's wife."). */
export interface RelationStep {
	person: string;
	of: string;
	/** Lower case: a parent, child, sibling or partner word with its link type (file header), following the person's `sex`. */
	word: string;
}

/** The finder's answer for an ordered pair: the second person as a relative of the first (§13.2). */
export type FinderResult =
	| {
			kind: 'named';
			first: string;
			second: string;
			/** Every distinct relation (D53; see `FINDER_LIMIT`), best first, each with its steps; "Other relation" cycles through them. */
			relations: { relation: Relation; steps: RelationStep[] }[];
	  }
	| {
			/** No relation of §13.1: the shortest chain of parent links (any type) and partnerships (any type, also implicit). */
			kind: 'chain';
			first: string;
			second: string;
			steps: RelationStep[];
			line: RelationLine;
	  }
	| { kind: 'none'; first: string; second: string };

/** Pure. `first` and `second` are different people of `g`; otherwise `kind: 'none'`. */
export type FindRelation = (g: FamilyGraph, first: string, second: string, options?: RelationOptions) => FinderResult;

/**
 * The small tree of D47: a `FamilyGraph` with only the people of `line.people`, ready for
 * `layoutTree` with `NEVER_FAR_RULE` (`src/layout/layout.ts`), so a couple on the line is never split.
 * It runs `deriveFamilies` on a `Tree` whose people are the line's people with `parents` = the line's
 * links among them (never the raw `person.parents`) and whose unions are the original union objects
 * of `line.unions` (same keys), then makes two patches: a child whose only line link to a parent is
 * `rumoured` gets `placementParents = [parent]` and `placementType = 'rumoured'` (`layout/draw.ts` draws it
 * with the rumoured stroke and the "?" marker); an implicit union of `line.unions` with no shared
 * child stays as an implicit `FamilyUnion` with `children: []` (a plain connector). Pure.
 */
export type LineSubgraph = (g: FamilyGraph, line: RelationLine) => FamilyGraph;

/**
 * Cache key of `computeRelations(g, me)`: ids, `sex`, the primary unions, the cycle-broken parent
 * links with their types, the unions (key, partners, type, order) and `me`; not names. The view
 * keeps one result per key of the WHOLE tree and never uses a focus subgraph for names.
 */
export type RelationsKey = (g: FamilyGraph, me: string, options?: RelationOptions) => string;

/** The most relations the finder cycles through (§13.2): no limit, as the owner decided (D53). A number caps the list. */
export const FINDER_LIMIT: number = Infinity;

/**
 * The rank of a blood link for the choice of lines: a line with only birth links (0) comes before
 * one with adoptive links (1), before one with rumoured links (2), as §13.1 "Which name wins" rule 4
 * orders the words. Ward links make no blood line.
 */
const RANK: Record<ParentType, number> = { birth: 0, adoptive: 1, rumoured: 2, ward: 2 };
const WORD_RANK: Record<'birth' | 'adoptive' | 'rumoured', number> = { birth: 0, adoptive: 1, rumoured: 2 };

// ---------------------------------------------------------------------------------------------
// Words

/** 0 = male (`sex: m`), 1 = female (`sex: f`), 2 = neutral (any other value, or none; D12). */
type Sex = 0 | 1 | 2;

/** Every kinship word the plugin shows, by sex where it changes: [male, female, neutral]. */
const WORDS = {
	you: 'you',
	parent: ['father', 'mother', 'parent'],
	child: ['son', 'daughter', 'child'],
	sibling: ['brother', 'sister', 'sibling'],
	uncle: ['uncle', 'aunt'],
	nephew: ['nephew', 'niece'],
	grand: 'grand',
	great: 'great-',
	half: 'half',
	double: 'double',
	adoptive: 'adoptive',
	adopted: 'adopted',
	rumoured: 'rumoured',
	cousin: 'cousin',
	degrees: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
	once: 'once removed',
	twice: 'twice removed',
	times: (n: number) => `${n} times removed`,
	possessive: `${CURLY_APOSTROPHE}s`,
	spouse: ['husband', 'wife', 'spouse'],
	betrothed: 'betrothed',
	concubinage: 'partner in concubinage',
	lover: 'lover',
	coParent: 'co-parent',
	guardian: 'guardian',
	ward: 'ward',
	byMarriage: 'by marriage',
	parentInLaw: ['father-in-law', 'mother-in-law', 'parent-in-law'],
	grandparentInLaw: ['grandfather-in-law', 'grandmother-in-law', 'grandparent-in-law'],
	childInLaw: ['son-in-law', 'daughter-in-law', 'child-in-law'],
	grandchildInLaw: ['grandson-in-law', 'granddaughter-in-law', 'grandchild-in-law'],
	siblingInLaw: ['brother-in-law', 'sister-in-law', 'sibling-in-law'],
	stepParent: ['stepfather', 'stepmother', 'step-parent'],
	stepGrandparent: ['step-grandfather', 'step-grandmother', 'step-grandparent'],
	stepChild: ['stepson', 'stepdaughter', 'stepchild'],
	stepGrandchild: ['step-grandson', 'step-granddaughter', 'step-grandchild'],
	stepSibling: ['stepbrother', 'stepsister', 'step-sibling'],
} as const;

/** 0 → "", 1 → "great-", 2 → "great-great-", 3 or more → "3rd great-", "4th great-", … */
function greats(n: number): string {
	if (n <= 0) return '';
	if (n <= 2) return WORDS.great.repeat(n);
	return `${ordinal(n)} ${WORDS.great}`;
}

/** "half-uncle", but "half first cousin" and "half 3rd great-uncle" when the word has a space. */
const halfOf = (word: string) => (word.includes(' ') ? `${WORDS.half} ${word}` : `${WORDS.half}-${word}`);

/** Parent (1), grandparent (2), great-grandparent (3), …, with the word for `sex`. */
const ancestorWord = (a: number, sex: Sex) => (a === 1 ? WORDS.parent[sex] : `${greats(a - 2)}${WORDS.grand}${WORDS.parent[sex]}`);
/** Child (1), grandchild (2), great-grandchild (3), …, with the word for `sex`. */
const descendantWord = (b: number, sex: Sex) => (b === 1 ? WORDS.child[sex] : `${greats(b - 2)}${WORDS.grand}${WORDS.child[sex]}`);
const siblingWord = (sex: Sex, half: boolean) => (half ? `${WORDS.half}-${WORDS.sibling[sex]}` : WORDS.sibling[sex]);

/** Uncle or aunt with `a` − 2 "great"; the neutral form puts "great" and "half" on the inner word. */
function uncleWord(a: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${ancestorWord(a - 1, 2)}${WORDS.possessive} ${siblingWord(2, half)}`;
	const word = `${greats(a - 2)}${WORDS.uncle[sex]}`;
	return half ? halfOf(word) : word;
}

/** Nephew or niece with `b` − 2 "great"; the neutral form puts "great" and "half" on the inner word. */
function nephewWord(b: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${siblingWord(2, half)}${WORDS.possessive} ${descendantWord(b - 1, 2)}`;
	const word = `${greats(b - 2)}${WORDS.nephew[sex]}`;
	return half ? halfOf(word) : word;
}

/** "first cousin", "second cousin once removed", "11th cousin 3 times removed". */
function cousinWord(a: number, b: number, half: boolean): string {
	const degree = Math.min(a, b) - 1;
	const removal = Math.abs(a - b);
	let word = `${WORDS.degrees[degree - 1] ?? ordinal(degree)} ${WORDS.cousin}`;
	if (removal === 1) word += ` ${WORDS.once}`;
	else if (removal === 2) word += ` ${WORDS.twice}`;
	else if (removal > 2) word += ` ${WORDS.times(removal)}`;
	return half ? halfOf(word) : word;
}

/** The §13.1 table name of P for M up `a` and P up `b` to the common ancestor, without type words. */
function shapeWord(a: number, b: number, sex: Sex, half: boolean): string {
	if (a === 0) return descendantWord(b, sex);
	if (b === 0) return ancestorWord(a, sex);
	if (a === 1 && b === 1) return siblingWord(sex, half);
	if (b === 1) return uncleWord(a, sex, half);
	if (a === 1) return nephewWord(b, sex, half);
	return cousinWord(a, b, half);
}

/** A union type's partner word (§13.1 partner table); `implicit` is a couple with a child and no union. */
function partnerWord(type: string, implicit: boolean, sex: Sex): string {
	if (implicit) return WORDS.coParent;
	if (type === 'betrothal') return WORDS.betrothed;
	if (type === 'concubinage') return WORDS.concubinage;
	if (type === 'affair') return WORDS.lover;
	return WORDS.spouse[sex];
}

/** A sibling step's word: "rumoured" if one of its two links is rumoured or the rumours change its half or full (`rumour`), else "adoptive" if one is adoptive (as a blood name). */
function siblingStepWord(sex: Sex, half: boolean, up: ParentType, down: ParentType, rumour: boolean): string {
	const word = siblingWord(sex, half);
	if (rumour || up === 'rumoured' || down === 'rumoured') return `${WORDS.rumoured} ${word}`;
	if (up === 'adoptive' || down === 'adoptive') return `${WORDS.adoptive} ${word}`;
	return word;
}

const parentStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.guardian : type === 'adoptive' ? `${WORDS.adoptive} ${WORDS.parent[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.parent[sex]}` : WORDS.parent[sex];
const childStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.ward : type === 'adoptive' ? `${WORDS.adopted} ${WORDS.child[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.child[sex]}` : WORDS.child[sex];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// The graph by person index

interface Up {
	/** The parent's index. */
	p: number;
	type: ParentType;
}

/** One step of a walk from the first person to the second. */
type Edge = { k: 'up' | 'down'; type: ParentType } | { k: 'partner'; union: string };

/** The people of a relation in step order, and the edge between each two (`edges[i]` joins `nodes[i]` and `nodes[i + 1]`). */
interface Walk {
	nodes: number[];
	edges: Edge[];
}

interface Line {
	people: number[];
	links: { parent: number; child: number; type: ParentType }[];
	unions: string[];
}

/** One blood candidate (X, a, b) of §13.1, with the two paths its line uses. */
interface Blood {
	a: number;
	b: number;
	/** The common ancestor on the line: for a full relation, the member of the couple first in c1's list. */
	x: number;
	/** The other member of the couple of a full relation, or -1. */
	y: number;
	half: boolean;
	double: boolean;
	word: 'birth' | 'adoptive' | 'rumoured';
	/** From the first person up to `x`, both included. */
	pathF: number[];
	/** From the second person up to `x`, both included. */
	pathP: number[];
	key: string;
	/** The people of the key: the couple of a full candidate (all of it, also a third parent), else `x`. The "double" test compares them. */
	couple: number[];
	/** Every pair of children of the key's couple that gave a line, with the line's word: the "double" test needs them all (D175). */
	via: Via[];
	/** D123: the effect a rumoured parent or (D174) a parent who is not listed could have on this sure candidate (file header). */
	maybe?: 'full' | 'half';
	/** D174: set with `maybe`; 'rumoured' if the second test settles the doubt, else 'unlisted' (file header). */
	cause?: RelationMaybe['cause'];
	/** D176: set with `maybe`; true if the matching set leaves out a rumoured parent of either person (`RelationMaybe.some`). */
	some?: true;
	/** F-KIN-08: set with an 'unlisted' `maybe` (`RelationMaybe.unlistedForm`). */
	form?: RelationMaybe['unlistedForm'];
	/** The line of the pair of children that gave `maybe`, if it is not this candidate's own line (rule 6): the extra "Rumoured X" name takes it. */
	maybeFrom?: BloodLine;
	/**
	 * Other lines of this name, of the same word, each once and none equal to its own: those of the candidates
	 * joined into it (rule 6) or merged into its "double" name. Rule 2 by marriage reads them; `forget` drops them.
	 */
	also?: BloodLine[];
}

/** What the line of a blood candidate reads (`bloodWalk`). `also` and `maybeFrom` keep only this of a candidate they drop. */
type BloodLine = Pick<Blood, 'a' | 'b' | 'x' | 'y' | 'pathF' | 'pathP'>;

/** One line of a blood candidate at its common ancestor: the children `c1` (first person's side) and `c2`, and the word of the line. */
interface Via {
	c1: number;
	c2: number;
	word: Blood['word'];
}

/** Half or full for two children of a common ancestor, the couple of a full relation (else the ancestor), and the candidate key. */
interface Shape {
	half: boolean;
	couple: number[];
	key: string;
}

/** The shortest paths between two people as a whole (`Kin.dagOf`); `rank` is -1 until `Kin.dagRank` sets it. */
interface Dag {
	sole: Int32Array;
	rank: number;
}

/** A named relation before it becomes a `Relation`, with the values the order of §13.1 needs. */
interface Cand {
	lower: string;
	kind: RelationKind;
	distance: number;
	/** Birth 0, adoptive 1, guardian or ward 2, by marriage 3, rumoured 4 ("Which name wins" rule 4). */
	cat: number;
	direct: number;
	half: number;
	removal: number;
	/** R3 key 8: the blood leg's a - b (larger = older generation first). 0 for the kinds that have no leg. */
	elder: number;
	/** R3 key 9, by marriage only: 0 step names (and step-sibling), 1 in-law names, 2 "by marriage", 3 the possessive forms. */
	group: number;
	/** Document index of the common ancestor, for the final tie-break (R3 key 11). */
	anc: number;
	/** 1 for a name by marriage of a person who also has a blood name: it comes after every other name. */
	after?: number;
	/** D123: set on a sure blood name that a rumoured parent could change. */
	maybe?: RelationMaybe;
	/** A rumoured blood name: its sibling steps take half or full from the second test (spec §13.2), as the name does. */
	second?: boolean;
	/** R4: the extra name of a maybe is the other outcome of the sure candidate; its sibling steps print that outcome (true: half), not what the second test says. */
	stepHalf?: boolean;
	/** Builds the line and the walk; only the names that are kept need them. */
	make: () => { line: Line; walk: Walk };
}

/** The parent sets of a child for the D123 comparisons, as sorted id lists. */
interface Counted {
	/** The sure parents of the type of the child's link (the half rule of §13.1). */
	sure: string;
	/** The same people as a list (R4: the sure set alone is an outcome of a child with two sure parents). */
	sureList: number[];
	/** The sure parents and every rumoured parent counted as a birth parent. */
	all: string;
	/** The rumoured parents alone; empty for an adoptive link. */
	rumoured: string;
	hasRumoured: boolean;
	/** The people of `all`, for the D174 count of both sets together. */
	allList: number[];
	/** False for an adoptive link: it never makes a child incomplete (D174). */
	canLack: boolean;
	/** The rumoured parents alone, as people (the people of `rumoured`). */
	rumouredList: number[];
	/**
	 * D176: the parent sets that this child could have if some rumoured links are true. One set (`allList`) unless the child
	 * has at most one sure parent and three or more listed parents: then the sure parents plus each set of rumoured parents
	 * that makes two, and also the whole `allList`.
	 */
	choices: number[][];
}

/** A name by marriage with its group (R3 key 9); a leg through a rumoured link puts "rumoured" in front (R2). */
function named(c: Blood, word: string, group: number): [string, number] {
	return [c.word === 'rumoured' ? `${WORDS.rumoured} ${word}` : word, group];
}

/** R3 key 9, the groups of the names by marriage: step names (and step-sibling), in-law names, "by marriage" names, the possessive forms. */
const BY_STEP = 0;
const BY_IN_LAW = 1;
const BY_MARRIAGE = 2;
const BY_POSSESSIVE = 3;

/** Supervisor ruling on rule 3: step-siblings come through birth and adoptive parents only. */
const isStepLink = (l: Up) => l.type === 'birth' || l.type === 'adoptive';
const implicitKey = (a: string, b: string) => `i:${JSON.stringify(a < b ? [a, b] : [b, a])}`;
const isMarriage = (u: FamilyUnion) => !u.implicit && (u.type === 'marriage' || !isUnionType(u.type));

class Kin {
	readonly ids: string[];
	readonly idx = new Map<string, number>();
	readonly sex: Sex[];
	/** Every drawn parent link, in `drawnParents` order. */
	readonly drawn: Up[][];
	/** Parent links that make blood relations (not ward), one per parent (its first type). */
	readonly up: Up[][];
	/** The same for the whole tree: `up` itself, except in the sure view (`sureView`), where `up` leaves the rumoured links out. */
	private readonly upAll: Up[][];
	/** Children through those links, in document order. */
	readonly down: number[][];
	/** Children through any drawn link, in document order, one per child (its first type). */
	readonly downAll: Up[][];
	/** A topological rank: every blood parent has a smaller one than its child. */
	private readonly tau: Int32Array;
	/** The highest `RANK` of any blood link from the person up to its ancestors. */
	private readonly topRank: Uint8Array;
	/** The marks of `mark`: a person is in the current set if its stamp is `stamp`. */
	private readonly stamps: Int32Array;
	private stamp = 0;
	private readonly fromAnc = new Map<number, Map<number, number>>();
	/** `blood` results by `f * n + p`. */
	private readonly bloodMemo = new Map<number, Blood[]>();
	private readonly spouseMemo: (number[] | undefined)[] = [];
	/** `sharesUnion`: by person, both partners of each of its unions (-1 for an unknown id). It runs for every full candidate. */
	private readonly unionPeople: (number[] | undefined)[] = [];
	/** `path` results without `blocked`, by `(v * n + t) * 3 + level`. Never changed after. */
	private readonly firstPaths = new Map<number, number[] | null>();
	/** `below` maps by `v * n + t`, kept for the people relations are counted from. */
	private readonly belowMemo = new Map<number, Map<number, number>>();
	/** `below` maps of the other people, by `v * n + t`; emptied for each new second person. */
	private readonly belowScratch = new Map<number, Map<number, number>>();
	/** `parentsOfType` results by `child * 4 + type`. */
	private readonly typedParents = new Map<number, { list: number[]; sig: string }>();
	/** `counted` results by `child * 2 + (adoptive ? 1 : 0)`. */
	private readonly countedMemo = new Map<number, Counted>();
	/** `incomplete` results by `child * 4 + type`: 0 not known yet, 1 no, 2 yes. It reads the setting, as does every `Kin`. */
	private readonly lackMemo: Uint8Array;
	/** `dagOf` results, kept like `belowMemo` and `belowScratch`. */
	private readonly dagMemo = new Map<number, Dag>();
	private readonly dagScratch = new Map<number, Dag>();
	/** R1: the same tree seen with the sure links only, made the first time a pair needs it. */
	private sure?: Kin;

	constructor(
		readonly g: FamilyGraph,
		/** D174: the sibling rule switch; the half and full tests read it. */
		readonly options: Readonly<RelationOptions> = DEFAULT_RELATION_OPTIONS,
		/** R1: the whole-tree `Kin` that this one is the sure view of (see `sureView`). */
		whole?: Kin,
	) {
		const n = g.people.length;
		this.stamps = new Int32Array(n);
		this.lackMemo = new Uint8Array(n * 4);
		this.tau = new Int32Array(n);
		this.down = Array.from({ length: n }, () => []);
		this.up = [];
		if (whole) {
			// The sure view shares the people and the drawn links of the whole tree; only `up` and `down` leave the rumoured links out.
			this.ids = whole.ids;
			this.idx = whole.idx;
			this.sex = whole.sex;
			this.drawn = whole.drawn;
			this.downAll = whole.downAll;
			this.upAll = whole.up;
			this.topRank = whole.topRank;
			for (let i = 0; i < n; i++) {
				const seen = new Set<number>();
				const up: Up[] = [];
				for (const l of this.drawn[i]) {
					if (l.type === 'ward' || l.type === 'rumoured' || seen.has(l.p)) continue;
					seen.add(l.p);
					up.push(l);
					this.down[l.p].push(i);
				}
				this.up.push(up);
			}
			this.order();
			return;
		}
		this.ids = g.people.map((p) => p.id);
		this.ids.forEach((id, i) => this.idx.set(id, i));
		this.sex = g.people.map((p) => (p.sex === 'm' ? 0 : p.sex === 'f' ? 1 : 2));
		const map = drawnParentMap(g);
		this.drawn = [];
		this.downAll = Array.from({ length: n }, () => []);
		for (let i = 0; i < n; i++) {
			const links: Up[] = [];
			for (const d of map.get(this.ids[i]) ?? []) {
				const p = this.idx.get(d.id);
				if (p !== undefined) links.push({ p, type: d.type });
			}
			this.drawn.push(links);
			const up: Up[] = [];
			const seen = new Set<number>();
			const seenAll = new Set<number>();
			for (const l of links) {
				if (!seenAll.has(l.p)) {
					seenAll.add(l.p);
					this.downAll[l.p].push({ p: i, type: l.type });
				}
				if (l.type === 'ward' || seen.has(l.p)) continue;
				seen.add(l.p);
				up.push(l);
				this.down[l.p].push(i);
			}
			this.up.push(up);
		}
		this.upAll = this.up;
		this.topRank = new Uint8Array(n);
		this.order();
	}

	/** Parents first (Kahn); the drawn links have no cycle, but a person left over still gets a rank. The sure view keeps the rank of the whole tree, which says if a rumour lies in the ancestry. */
	private order(): void {
		const n = this.ids.length;
		const waiting = this.up.map((u) => u.length);
		const order: number[] = [];
		for (let i = 0; i < n; i++) if (!waiting[i]) order.push(i);
		for (let head = 0; head < order.length; head++) for (const c of this.down[order[head]]) if (--waiting[c] === 0) order.push(c);
		for (let i = 0; i < n; i++) if (waiting[i] > 0) order.push(i);
		const own = this.upAll === this.up;
		order.forEach((v, k) => {
			this.tau[v] = k;
			if (!own) return;
			let top = waiting[v] > 0 ? 2 : 0;
			for (const l of this.up[v]) top = Math.max(top, RANK[l.type], this.topRank[l.p]);
			this.topRank[v] = top;
		});
	}

	/** Every blood ancestor of `i` (and `i` at 0) with the fewest parent links up to it. */
	anc(i: number): Map<number, number> {
		const out = new Map<number, number>([[i, 0]]);
		let frontier = [i];
		for (let d = 1; frontier.length; d++) {
			const next: number[] = [];
			for (const v of frontier) {
				for (const l of this.up[v]) {
					if (out.has(l.p)) continue;
					out.set(l.p, d);
					next.push(l.p);
				}
			}
			frontier = next;
		}
		return out;
	}

	/** `anc` of a person that relations are counted from (the marked person, their partners), kept. */
	ancFrom(i: number): Map<number, number> {
		let m = this.fromAnc.get(i);
		if (!m) this.fromAnc.set(i, (m = this.anc(i)));
		return m;
	}

	/** The type of `child`'s first blood link to `parent`. */
	typeOf(child: number, parent: number): ParentType {
		return this.up[child].find((l) => l.p === parent)?.type ?? 'birth';
	}

	/** The parents of `child` whose link has `type`, in `drawnParents` order, and the same set as a sorted text (kept). */
	parentsOfType(child: number, type: ParentType): { list: number[]; sig: string } {
		const key = child * 4 + PARENT_TYPES.indexOf(type);
		let out = this.typedParents.get(key);
		if (!out) {
			const list = [...new Set(this.drawn[child].filter((l) => l.type === type).map((l) => l.p))];
			out = { list, sig: [...list].sort((i, j) => i - j).join(',') };
			this.typedParents.set(key, out);
		}
		return out;
	}

	/** True if `child` has a rumoured parent who is not also a birth parent (spec §13.1 "Half": that parent does not count). */
	private hasRumouredBeyondBirth(child: number): boolean {
		const birth = this.parentsOfType(child, 'birth').list;
		return this.drawn[child].some((l) => l.type === 'rumoured' && !birth.includes(l.p));
	}

	/**
	 * D174, the sure test: `child`, linked to the common ancestor by `t`, may have a parent that the
	 * tree does not list. An adoptive or ward link never; else fewer than two parents of the link's
	 * type (its sure set), and the setting is on or the child has a rumoured parent.
	 */
	incomplete(child: number, t: ParentType): boolean {
		const key = child * 4 + PARENT_TYPES.indexOf(t);
		if (!this.lackMemo[key]) {
			const lacks = t !== 'adoptive' && t !== 'ward' && this.parentsOfType(child, t).list.length < 2 && (this.options.oneParentUnknown || this.hasRumouredBeyondBirth(child));
			this.lackMemo[key] = lacks ? 2 : 1;
		}
		return this.lackMemo[key] === 2;
	}

	/** §13.1 half rule, the sure test: `c1` (linked by `t1`) and `c2` (by `t2`) have different parents of their link's type, or one of them is incomplete (D174). */
	isHalf(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		return this.parentsOfType(c1, t1).sig !== this.parentsOfType(c2, t2).sig || this.incomplete(c1, t1) || this.incomplete(c2, t2);
	}

	/** D123: the parent sets of `child` for a link of type `t` (an adoptive link counts adoptive parents only; birth and rumoured links count birth parents and rumoured parents). */
	counted(child: number, t: ParentType): Counted {
		const adoptive = t === 'adoptive';
		const key = child * 2 + (adoptive ? 1 : 0);
		let out = this.countedMemo.get(key);
		if (!out) {
			const sure = this.parentsOfType(child, adoptive ? 'adoptive' : 'birth');
			const rumoured = adoptive ? [] : this.upAll[child].filter((l) => l.type === 'rumoured' && !sure.list.includes(l.p)).map((l) => l.p);
			const text = (list: number[]) => [...list].sort((i, j) => i - j).join(',');
			const allList = [...sure.list, ...rumoured];
			let choices: number[][] = [allList];
			// With more rumoured parents than PARENT_LIMIT the sets would grow too fast, so the one set stays (the relation words can then miss a "maybe"; the warning of contract B.3 says so).
			if (!adoptive && sure.list.length < 2 && allList.length > 2 && rumoured.length <= PARENT_LIMIT.rumoured) {
				const need = 2 - sure.list.length;
				choices = [];
				const pick = (start: number, acc: number[]) => {
					if (acc.length === need) {
						choices.push([...sure.list, ...acc]);
						return;
					}
					for (let i = start; i < rumoured.length; i++) pick(i + 1, [...acc, rumoured[i]]);
				};
				pick(0, []);
				// The whole set stays a choice: without it a person who lists all three parents loses a maybe.
				choices.push(allList);
			}
			out = { sure: sure.sig, sureList: sure.list, all: text(allList), rumoured: text(rumoured), hasRumoured: rumoured.length > 0, allList, canLack: !adoptive, rumouredList: rumoured, choices };
			this.countedMemo.set(key, out);
		}
		return out;
	}

	/** D123 rule 1: half or full for two children with a link of `t1` and `t2`, every rumoured parent counted as a birth parent; with the setting on, a set of fewer than two people is half (D174). */
	halfCounted(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		relationRunStats.second++;
		return this.secondHalf(c1, t1, c2, t2);
	}

	/** `halfCounted` without the count, for the search to know a key before it looks for paths. This is the one place that decides the second test (D176). */
	private secondHalf(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		const [s1, s2] = [this.counted(c1, t1), this.counted(c2, t2)];
		if (s1.choices.length === 1 && s2.choices.length === 1) return s1.all !== s2.all || this.lacks(s1) || this.lacks(s2);
		return this.matches(s1, s2, true).length === 0;
	}

	/**
	 * D176: the sets that both children could have (a choice of one equal to a choice of the other). `sure`: a set of
	 * fewer than two people does not count where the setting says it lacks a parent (the second test); else any size
	 * (the maybe of a half pair).
	 */
	private matches(s1: Counted, s2: Counted, sure: boolean): number[][] {
		const sig = (l: number[]) => [...l].sort((i, j) => i - j).join(',');
		const other = new Set(s2.choices.map(sig));
		return s1.choices.filter((t) => other.has(sig(t)) && !(sure && t.length < 2 && (this.lacks(s1, t) || this.lacks(s2, t))));
	}

	/**
	 * R4: the sets that both children could have as outcomes: a set of one equal to a set of the other, where a child with two
	 * sure parents and a rumoured parent also has the two sure parents alone (the rumour may be false). Only the maybe of a half
	 * pair reads this. `secondHalf` and rule 1 keep the `choices` (D174 item 4: Eleanor and Fiona stay "Sister, maybe half").
	 */
	private outcomeMatches(s1: Counted, s2: Counted): number[][] {
		const sig = (l: number[]) => [...l].sort((i, j) => i - j).join(',');
		const other = new Set(outcomesOf(s2).map(sig));
		return outcomesOf(s1).filter((t) => other.has(sig(t)));
	}


	/** The people of all the matching sets, for the couple and key of a full line of rule 1 (the sets of one choice: A1, as before D176). */
	private matchedPeople(s1: Counted, s2: Counted): number[] {
		if (s1.choices.length === 1 && s2.choices.length === 1) return s1.allList;
		return [...new Set(this.matches(s1, s2, true).flat())].sort((i, j) => i - j);
	}

	/** D174, the second test: a set of fewer than two people is incomplete when the setting is on. */
	private lacks(s: Counted, set: number[] = s.allList): boolean {
		return this.options.oneParentUnknown && s.canLack && set.length < 2;
	}

	/**
	 * The first shortest path from `v` up to its ancestor `t` (both included) by the tie-break of
	 * the file header, using only links of `RANK` up to `level`: at each step, the first parent in the
	 * child's list that still lies on such a path. With `blocked`, only a path whose people after `v`
	 * are all outside `blocked`, if one exists. `av` is `anc(v)`; the length is always the shortest
	 * over all links.
	 */
	path(v: number, t: number, av: Map<number, number>, level: number, blocked?: { has(i: number): boolean }): number[] | undefined {
		const d = av.get(t);
		if (d === undefined) return undefined;
		const key = (v * this.ids.length + t) * 3 + level;
		if (!blocked) {
			const known = this.firstPaths.get(key);
			if (known !== undefined) return known ?? undefined;
		}
		const below = this.belowOf(v, t, av);
		// Depth-first in list order; on the shortest-path graph every person has one depth, so a
		// person that led nowhere once leads nowhere again.
		const dead = new Set<number>();
		const path = [v];
		const at = [0];
		while (path.length) {
			const cur = path[path.length - 1];
			if (cur === t) break;
			const depth = path.length;
			const ups = this.up[cur];
			let k = at[at.length - 1];
			for (; k < ups.length; k++) {
				const q = ups[k].p;
				if (RANK[ups[k].type] <= level && av.get(q) === depth && below.get(q) === d - depth && !dead.has(q) && !blocked?.has(q)) break;
			}
			if (k < ups.length) {
				at[at.length - 1] = k + 1;
				path.push(ups[k].p);
				at.push(0);
			} else {
				dead.add(cur);
				path.pop();
				at.pop();
			}
		}
		if (!blocked) this.firstPaths.set(key, path.length ? path : null);
		return path.length ? path : undefined;
	}

	/** The first path of `path` at the lowest level that has one: birth links only, then adoptive too, then all. */
	bestPath(v: number, t: number, av: Map<number, number>): number[] | undefined {
		for (let level = 0; level <= this.topRank[v]; level++) {
			const path = this.path(v, t, av, level);
			if (path) return path;
		}
		return undefined;
	}

	/** `below(t, anc(v))`, kept for the people relations are counted from. */
	private belowOf(v: number, t: number, av: Map<number, number>): Map<number, number> {
		const key = v * this.ids.length + t;
		const memo = this.fromAnc.has(v) ? this.belowMemo : this.belowScratch;
		let below = memo.get(key);
		if (!below) memo.set(key, (below = this.below(t, av)));
		return below;
	}

	/** Distance down from `t` to each of `v`'s ancestors below it (`av` is `anc(v)`); the true distance, as every person between is one of them too. */
	private below(t: number, av: Map<number, number>): Map<number, number> {
		const out = new Map<number, number>([[t, 0]]);
		let frontier = [t];
		for (let k = 1; frontier.length; k++) {
			const next: number[] = [];
			for (const u of frontier) {
				for (const c of this.down[u]) {
					if (out.has(c) || !av.has(c)) continue;
					out.set(c, k);
					next.push(c);
				}
			}
			frontier = next;
		}
		return out;
	}

	/** Blood candidates of `p` as a relative of `f` (§13.1 blood rules), deduplicated, doubles merged. */
	blood(f: number, p: number, aP?: Map<number, number>): Blood[] {
		const memoKey = f * this.ids.length + p;
		const known = this.bloodMemo.get(memoKey);
		if (known) return known;
		const aF = this.ancFrom(f);
		aP ??= this.anc(p);
		const run = this.candidates(f, p, aF, aP);
		// R1: the sure view may add candidates that a rumoured short line hid. All are merged for "double" together.
		const sure = this.sureRun(f, p, aF, aP, run.list);
		const list = sure ? [...run.list, ...sure.list] : run.list;
		// Most pairs of people have fewer than two full cousin names, so nothing can be "double".
		const out =
			cousinCount(list) < 2
				? list
				: this.mergeDoubles(list, (keys) => {
						this.searchPending(f, p, aF, aP, run.pending, list, keys);
						if (sure) sure.kin.searchPending(f, p, sure.aF, sure.aP, sure.pending, list, keys);
					});
		this.bloodMemo.set(memoKey, out);
		return out;
	}

	/** The candidates of every common ancestor of `f` and `p`, one per key, before the doubles are merged; `pending` holds the cousin pairs passed over. */
	private candidates(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, only?: number[]): { list: Blood[]; pending: number[] } {
		const common: number[] = [];
		const [small, big] = aF.size <= aP.size ? [aF, aP] : [aP, aF];
		if (only) common.push(...only);
		else for (const x of small.keys()) if (big.has(x)) common.push(x);
		// Document order, so the same tree always keeps the same candidate of a couple.
		const ordered = Int32Array.from(common).sort();

		const found = new Map<string, Blood>();
		const pending: number[] = [];
		for (const x of ordered) {
			const cs = x === f ? [this.direct(f, p, aP, 0)] : x === p ? [this.direct(f, p, aF, 1)] : this.collateral(f, p, x, aF, aP, pending);
			for (const c of cs) {
				if (!c) continue;
				// A full relation is found at both members of its couple; keep the better word, and the better maybe (rule 6).
				const old = found.get(c.key);
				found.set(c.key, old ? joinCandidates(old, c) : c);
			}
		}
		return { list: [...found.values()], pending };
	}

	/**
	 * R1: a rumoured link can make the shortest line to an ancestor shorter than every sure line, and the search keeps the
	 * shortest, so the sure line would be lost ("Great-grandfather" beside "Rumoured father"). The sure view finds the
	 * candidates of the sure links alone; the run holds those whose key `list` (the whole tree's candidates) does not have.
	 * It exists only when a rumoured link lies in the ancestry of either person and the sure distances differ from the whole
	 * ones: if they are equal, the sure view can give no key that the search has not given.
	 */
	private sureRun(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, list: Blood[]): { kin: Kin; list: Blood[]; pending: number[]; aF: Map<number, number>; aP: Map<number, number> } | undefined {
		if (this.upAll !== this.up || (this.topRank[f] < 2 && this.topRank[p] < 2)) return undefined;
		const kin = this.sureView();
		// A person with no rumoured link in the ancestry has the same ancestors in both views.
		if (this.topRank[f] < 2 && !kin.fromAnc.has(f)) kin.fromAnc.set(f, aF);
		const sureF = kin.ancFrom(f);
		const sureP = this.topRank[p] < 2 ? aP : kin.anc(p);
		const differing = this.sureDiffering(aF, aP, sureF, sureP);
		if (!differing.length) return undefined;
		const keys = new Set(list.map((c) => c.key));
		// The common ancestors where the distances are the same give the same candidates in both views: only the others are searched.
		const run = kin.candidates(f, p, sureF, sureP, differing);
		const more = run.list.filter((c) => !keys.has(c.key));
		return more.length ? { kin, list: more, pending: run.pending, aF: sureF, aP: sureP } : undefined;
	}

	/**
	 * The common ancestors where the sure ancestors of `f` or `p` are at other distances than the whole tree's, at the
	 * ancestor or at a child of it: only there can the sure view give a candidate whose key the whole tree did not give.
	 */
	private sureDiffering(aF: Map<number, number>, aP: Map<number, number>, sureF: Map<number, number>, sureP: Map<number, number>): number[] {
		const out: number[] = [];
		if (aF === sureF && aP === sureP) return out;
		const [small, big] = aF.size <= aP.size ? [aF, aP] : [aP, aF];
		for (const x of small.keys()) {
			if (!big.has(x)) continue;
			if (aF.get(x) !== sureF.get(x) || aP.get(x) !== sureP.get(x) || this.down[x].some((c) => aF.get(c) !== sureF.get(c) || aP.get(c) !== sureP.get(c))) out.push(x);
		}
		return out.sort((i, j) => i - j);
	}

	/** The tree with the rumoured links left out (R1), made once. */
	private sureView(): Kin {
		return (this.sure ??= new Kin(this.g, this.options, this));
	}

	/** The direct line: `p` descends from `f` (`side` 0) or `p` is an ancestor of `f` (`side` 1). */
	private direct(f: number, p: number, av: Map<number, number>, side: 0 | 1): Blood | undefined {
		const [from, to] = side === 0 ? [p, f] : [f, p];
		const path = this.bestPath(from, to, av);
		if (!path) return undefined;
		const pathF = side === 0 ? [f] : path;
		const pathP = side === 0 ? path : [p];
		const a = pathF.length - 1;
		const b = pathP.length - 1;
		return { a, b, x: to, y: -1, half: false, double: false, word: this.wordOf(pathF, pathP, -1), pathF, pathP, key: `D:${a}:${b}`, couple: [to], via: [] };
	}

	/**
	 * The candidates at a common ancestor `x` that is neither person: the shortest pairs of paths
	 * through different children of `x`. §13.1 rule 3 drops a pair when both paths pass through one
	 * other common ancestor below `x`; it stays if one pair of shortest paths shares nobody below
	 * `x` (a person on both paths is a common ancestor, or one of the two people). Each distinct
	 * full or half result is one candidate (D50), so the names never depend on the order of the
	 * children; each takes the pair with the lowest link rank, then the first in list order. A cousin pair
	 * that is passed over because its key is taken goes to `pending` (x, c1, c2): the "double" test may need its line.
	 */
	private collateral(f: number, p: number, x: number, aF: Map<number, number>, aP: Map<number, number>, pending: number[]): Blood[] {
		const kids = this.down[x];
		let bestF = -1;
		let bestP = -1;
		for (const c1 of kids) {
			const d1 = aF.get(c1);
			if (d1 === undefined) continue;
			for (const c2 of kids) {
				const d2 = aP.get(c2);
				if (d2 === undefined || c1 === c2) continue;
				if (bestF < 0 || better(d1, d2, bestF, bestP)) {
					bestF = d1;
					bestP = d2;
				}
			}
		}
		if (bestF < 0) return [];
		const pairs: { c1: number; c2: number; lo: number; hi: number; shape?: Shape; done: boolean }[] = [];
		for (const c1 of kids) {
			if (aF.get(c1) !== bestF) continue;
			for (const c2 of kids) {
				if (aP.get(c2) !== bestP || c1 === c2) continue;
				pairs.push({ c1, c2, lo: Math.max(RANK[this.typeOf(c1, x)], RANK[this.typeOf(c2, x)]), hi: -1, done: false });
			}
		}
		const shapeOf = (pair: (typeof pairs)[number]) => (pair.shape ??= this.pairShape(x, pair.c1, pair.c2, bestF + 1, bestP + 1));
		// D123: a rumoured link can matter only if one lies in the blood ancestry of either person (that covers c1 and c2 too).
		const rumour = this.topRank[f] === 2 || this.topRank[p] === 2;
		const out: Blood[] = [];
		const has = (key: string) => out.some((b) => b.key === key);
		// Only a cousin name can be "double".
		const cousins = bestF >= 1 && bestP >= 1;
		for (let level = 0; level <= 2; level++) {
			for (const pair of pairs) {
				const { c1, c2, lo } = pair;
				// A pair that gave a candidate gives no better one at a higher level. Rule 1 can give it a key other
				// than its sure shape's (D174 makes that common), so the key test alone would search it again.
				if (level < lo || pair.done) continue;
				// With one pair (nearly always) the key is needed only for a found candidate. A pair whose sure key
				// another pair took is searched only if it could add to the names (rule 6): a better maybe, or a
				// rule 1 name that no pair gave yet. So the names never depend on the order of the children (D2).
				if (pairs.length > 1 || pair.shape) {
					const shape = shapeOf(pair);
					const taken = out.find((b) => b.key === shape.key);
					if (taken && !this.couldAdd(taken, shape, x, c1, c2, rumour, has)) {
						// Neither can change later: the taken maybe only gets better, and keys are only added.
						pair.done = true;
						if (cousins) pending.push(x, c1, c2);
						continue;
					}
				}
				// A line found at level 2 has a rumoured link (no lower level had one), so it takes rule 1 and its key is known now.
				if (level === 2 && pairs.length > 1 && out.some(isRuleOne) && has(this.ruleOneKey(shapeOf(pair), x, c1, c2, bestF + 1, bestP + 1))) {
					if (cousins) pending.push(x, c1, c2);
					continue;
				}
				// A higher level changes the answer only if the shortest-path graphs have a link of that rank.
				if (level > lo) {
					if (level > Math.max(lo, this.topRank[f], this.topRank[p])) continue;
					if (pair.hi < 0) pair.hi = Math.max(lo, this.dagRank(f, c1, aF), this.dagRank(p, c2, aP));
					if (level > pair.hi) continue;
				}
				const paths = this.disjointPair(f, c1, aF, p, c2, aP, level);
				if (!paths) continue;
				pair.done = true;
				const c = this.collateralCandidate(shapeOf(pair), paths[0], paths[1], x, c1, c2, rumour);
				const k = out.findIndex((b) => b.key === c.key);
				if (k < 0) out.push(c);
				else out[k] = joinCandidates(out[k], c);
			}
		}
		return out;
	}

	/**
	 * Rule 6 for a pair whose sure key the candidate `taken` already has: true if the pair could add to
	 * the names, so it must be searched. Its sure line could bring a better maybe (not to a rumoured
	 * line, which has no maybe; a pair with a sure line was found before a rumoured one at a higher
	 * level), or its rumoured line a rule 1 key that no pair gave yet.
	 */
	private couldAdd(taken: Blood, shape: Shape, x: number, c1: number, c2: number, rumour: boolean, has: (key: string) => boolean): boolean {
		if (!rumour && !(shape.half && this.options.oneParentUnknown)) return false;
		const doubt = this.doubtOf(shape, x, c1, c2, taken.a === 1 && taken.b === 1);
		if (doubt && taken.word !== 'rumoured' && (!taken.maybe || doubtRank(doubt.maybe, doubt.cause, doubt.some, doubt.form) < doubtRank(taken.maybe, taken.cause!, taken.some, taken.form))) return true;
		return rumour && !has(this.ruleOneKey(shape, x, c1, c2, taken.a, taken.b));
	}

	/**
	 * D175: searches the cousin pairs that `collateral` passed over (`pending`: x, c1, c2) whose key could
	 * be one of `keys`, as it would have searched them, and adds each line found to the candidate of `list`
	 * with its key. Only the "double" test reads these lines, and only for a group of `keys` that the lines
	 * it has cannot decide, so the result never depends on which pair of children was searched first.
	 */
	private searchPending(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, pending: number[], list: Blood[], keys: Set<string>): void {
		const rumour = this.topRank[f] === 2 || this.topRank[p] === 2;
		for (let k = 0; k < pending.length; k += 3) {
			const [x, c1, c2] = [pending[k], pending[k + 1], pending[k + 2]];
			if (x < 0) continue;
			// A line takes the sure key of its pair, or on a rumoured line the key of the second test: no other.
			const [a, b] = [aF.get(c1)! + 1, aP.get(c2)! + 1];
			const shape = this.pairShape(x, c1, c2, a, b);
			if (!keys.has(shape.key) && !(rumour && keys.has(this.ruleOneKey(shape, x, c1, c2, a, b)))) continue;
			pending[k] = -1;
			for (let level = Math.max(RANK[this.typeOf(c1, x)], RANK[this.typeOf(c2, x)]); level <= 2; level++) {
				const paths = this.disjointPair(f, c1, aF, p, c2, aP, level);
				if (!paths) continue;
				const c = this.collateralCandidate(shape, paths[0], paths[1], x, c1, c2, rumour);
				const owner = list.find((d) => d.key === c.key);
				if (owner) for (const v of c.via) addVia(owner, v);
				break;
			}
		}
	}

	/** The people of `list` as a set, valid until the next call; this runs for most pairs, so it builds no `Set`. */
	private mark(list: number[]): { has(i: number): boolean } {
		const stamp = ++this.stamp;
		for (const v of list) this.stamps[v] = stamp;
		return { has: (i) => this.stamps[i] === stamp };
	}

	/** The first pair of shortest paths `f`…`c1` and `p`…`c2` with links up to `level` that share no person, if any. */
	private disjointPair(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>, level: number): [number[], number[]] | undefined {
		const pf = this.path(f, c1, aF, level);
		const pp = this.path(p, c2, aP, level);
		if (!pf || !pp) return undefined;
		const onP = this.mark(pp);
		if (!pf.some((v) => onP.has(v))) return [pf, pp];
		const altF = onP.has(f) ? undefined : this.path(f, c1, aF, level, onP);
		if (altF) return [altF, pp];
		const onF = this.mark(pf);
		const altP = onF.has(p) ? undefined : this.path(p, c2, aP, level, onF);
		if (altP) return [pf, altP];
		// Rare (heavy inbreeding): both first paths must change.
		return this.sharedCut(f, c1, aF, p, c2, aP) ? undefined : this.pebbles(f, c1, aF, p, c2, aP, level);
	}

	/**
	 * The exact search for two shortest paths `f`…`c1` and `p`…`c2` (links up to `level`) that share
	 * no person. Two pebbles climb the two shortest-path graphs; the pebble lower in `tau` moves. If
	 * two paths share a person, the first pebble there waits for the other, which cannot pass above
	 * it, so the pebbles meet: a search that never puts both pebbles on one person finds exactly the
	 * disjoint pairs. The states are pairs of people, so the search is at most quadratic.
	 */
	private pebbles(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>, level: number): [number[], number[]] | undefined {
		const n = this.ids.length;
		const dF = aF.get(c1)!;
		const dP = aP.get(c2)!;
		const bF = this.belowOf(f, c1, aF);
		const bP = this.belowOf(p, c2, aP);
		const next = (v: number, av: Map<number, number>, below: Map<number, number>, d: number) => {
			const depth = av.get(v)! + 1;
			const out: number[] = [];
			for (const l of this.up[v]) if (RANK[l.type] <= level && av.get(l.p) === depth && below.get(l.p) === d - depth) out.push(l.p);
			return out;
		};
		const prev = new Map<number, number>();
		const stack: [number, number][] = [[f * n + p, -1]];
		while (stack.length) {
			const [s, from] = stack.pop()!;
			if (prev.has(s)) continue;
			prev.set(s, from);
			const u = Math.floor(s / n);
			const v = s % n;
			if (u === c1 && v === c2) {
				const pf: number[] = [];
				const pp: number[] = [];
				for (let k = s; k >= 0; k = prev.get(k)!) {
					const [ku, kv] = [Math.floor(k / n), k % n];
					if (pf[pf.length - 1] !== ku) pf.push(ku);
					if (pp[pp.length - 1] !== kv) pp.push(kv);
				}
				return [pf.reverse(), pp.reverse()];
			}
			const moveF = v === c2 || (u !== c1 && this.tau[u] > this.tau[v]);
			const steps = moveF ? next(u, aF, bF, dF) : next(v, aP, bP, dP);
			// Reversed, so the first parent in the list is tried first.
			for (let k = steps.length - 1; k >= 0; k--) {
				const [nu, nv] = moveF ? [steps[k], v] : [u, steps[k]];
				if (nu !== nv && !prev.has(nu * n + nv)) stack.push([nu * n + nv, s]);
			}
		}
		return undefined;
	}

	/**
	 * True if one person is on every shortest path `f`…`c1` and on every shortest path `p`…`c2`:
	 * then no pair of them is disjoint. On a shortest-path graph such a person is the only one at
	 * its distance, so the check is linear; it spares the full search most of the pairs it would fail.
	 */
	private sharedCut(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>): boolean {
		const soleF = this.dagOf(f, c1, aF).sole;
		for (const w of this.dagOf(p, c2, aP).sole) if (w >= 0 && soleF[aF.get(w) ?? -1] === w) return true;
		return false;
	}

	/** The shortest paths `v`…`t` as a whole: for each distance from `v`, the one person at it, or -1 if there are more. */
	private dagOf(v: number, t: number, av: Map<number, number>): Dag {
		const key = v * this.ids.length + t;
		const memo = this.fromAnc.has(v) ? this.dagMemo : this.dagScratch;
		const known = memo.get(key);
		if (known) return known;
		const d = av.get(t)!;
		const sole = new Int32Array(d + 1).fill(-2);
		for (const [w, k] of this.belowOf(v, t, av)) {
			const j = av.get(w)!;
			if (j + k === d) sole[j] = sole[j] === -2 ? w : -1;
		}
		const out: Dag = { sole, rank: -1 };
		memo.set(key, out);
		return out;
	}

	/** The highest `RANK` of a link on the shortest paths `v`…`t`. */
	private dagRank(v: number, t: number, av: Map<number, number>): number {
		const dag = this.dagOf(v, t, av);
		if (dag.rank >= 0) return dag.rank;
		const d = av.get(t)!;
		const below = this.belowOf(v, t, av);
		let rank = 0;
		for (const [w, k] of below) {
			const j = av.get(w)!;
			if (j + k !== d) continue;
			for (const l of this.up[w]) if (av.get(l.p) === j + 1 && below.get(l.p) === k - 1) rank = Math.max(rank, RANK[l.type]);
		}
		return (dag.rank = rank);
	}

	/** Half or full for the children `c1` and `c2` of `x` (§13.1 half rule), the couple, and the candidate key. */
	private pairShape(x: number, c1: number, c2: number, a: number, b: number): Shape {
		const t1 = this.typeOf(c1, x);
		const own = this.parentsOfType(c1, t1);
		const half = this.isHalf(c1, t1, c2, this.typeOf(c2, x));
		return half ? { half, couple: [x], key: `H:${x}:${a}:${b}` } : { half, couple: own.list, key: `F:${own.sig}:${a}:${b}` };
	}

	/**
	 * The blood candidate of one pair of paths, with the second test of D123 and D174 (file header):
	 * it runs if a rumoured link lies in the ancestry (`rumour`), or if the setting is on and the
	 * sure test gives half. Else the candidate is the sure one, as in a tree with no doubt.
	 */
	private collateralCandidate(shape: Shape, pf: number[], pp: number[], x: number, c1: number, c2: number, rumour: boolean): Blood {
		const lx = shape.couple[0];
		// A couple with no union in the tree (two rumoured parents, an adoptive couple beside birth parents) is not
		// drawn: the line passes `lx` alone. Every member has the same link type, so the word stays the same.
		const y = shape.couple.length > 1 && this.sharesUnion(lx, shape.couple[1]) ? shape.couple[1] : -1;
		const pathF = [...pf, lx];
		const pathP = [...pp, lx];
		const word = this.wordOf(pathF, pathP, y);
		const out: Blood = { a: pathF.length - 1, b: pathP.length - 1, x: lx, y, half: shape.half, double: false, word, pathF, pathP, key: shape.key, couple: shape.couple, via: [{ c1, c2, word }] };
		if (!rumour && !(shape.half && this.options.oneParentUnknown)) return out;
		const [t1, t2] = [this.typeOf(c1, x), this.typeOf(c2, x)];
		if (word === 'rumoured') {
			// Rule 1. When the result changes, the new key keeps the line apart from the sure shape of the pair.
			const half = this.halfCounted(c1, t1, c2, t2);
			if (half !== shape.half) {
				const s1 = this.counted(c1, t1);
				out.half = half;
				// A half key holds no set, so the set of the matching choices is built only for a full line.
				const setList = half ? [x] : this.matchedPeople(s1, this.counted(c2, t2));
				out.key = ruleOneKey(half, x, half ? '' : setList === s1.allList ? s1.all : setList.join(','), out.a, out.b);
				out.couple = setList;
				// A half line passes `x` alone. A full line passes the couple of the second test (D175), the same at
				// each of its members, so a couple with a rumoured parent stays one couple and never makes a "double".
				// Siblings keep `x` alone: their one sibling step shows the rumoured link (D174 ruling 8), and they are never double.
				const [nx, ny] = half || (out.a === 1 && out.b === 1) ? [x, -1] : this.ruleOneTop(pf, pp, x, c1, c2, setList);
				if (nx !== lx || ny !== y) {
					out.x = nx;
					out.y = ny;
					out.pathF = [...pf, nx];
					out.pathP = [...pp, nx];
				}
			}
			return out;
		}
		// Rule 5: no maybe where the link of c1 or c2 to `x` is adoptive (ward links make no blood line).
		if (t1 === 'adoptive' || t2 === 'adoptive') return out;
		relationRunStats.second++;
		const doubt = this.doubtOf(shape, x, c1, c2, pf.length === 1 && pp.length === 1);
		if (doubt) {
			out.maybe = doubt.maybe;
			out.cause = doubt.cause;
			if (doubt.some) out.some = true;
			if (doubt.form) out.form = doubt.form;
		}
		return out;
	}

	/**
	 * Rule 1, a full line through the couple `set` of the second test (D175): the top of the line, `x`
	 * and `y` of the candidate. Two members of the couple, in c1's list order, that have a union in the
	 * tree, such that the line keeps a rumoured link (below c1 and c2, or from c1 up to the first member,
	 * or from the second member down to c2): the name says "rumoured", so its steps must too (§13.2).
	 * Else the first member with a rumoured link to c1 or c2, alone: the line then has a sibling step
	 * through a rumoured link and draws no couple that the tree does not have.
	 */
	private ruleOneTop(pf: number[], pp: number[], x: number, c1: number, c2: number, set: number[]): [number, number] {
		const below = this.hasRumouredLink(pf) || this.hasRumouredLink(pp);
		const members = this.up[c1].filter((l) => set.includes(l.p));
		for (const top of members) {
			for (const other of members) {
				if (other === top || (!below && top.type !== 'rumoured' && this.typeOf(c2, other.p) !== 'rumoured')) continue;
				if (this.sharesUnion(top.p, other.p)) return [top.p, other.p];
			}
		}
		const alone = members.find((l) => l.type === 'rumoured' || this.typeOf(c2, l.p) === 'rumoured');
		return [alone ? alone.p : x, -1];
	}

	/** True if `x` and `y` share a union of the tree, listed or implicit: then `coupleUnion` gives a key of the tree (contract "unknown union"). */
	private sharesUnion(x: number, y: number): boolean {
		let partners = this.unionPeople[x];
		if (!partners) {
			partners = [];
			for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
				const fu = this.g.unionByKey.get(key);
				if (fu) for (const id of fu.partners) partners.push(this.idx.get(id) ?? -1);
			}
			this.unionPeople[x] = partners;
		}
		return partners.includes(y);
	}

	/** True if a link of the path (each person up to the next) is rumoured. */
	private hasRumouredLink(path: number[]): boolean {
		for (let i = 0; i + 1 < path.length; i++) if (this.typeOf(path[i], path[i + 1]) === 'rumoured') return true;
		return false;
	}

	/** The maybe of a sure line of the pair (`c1`, `c2`) at `x` (file header, rules 2 to 5), if any. `sibling`: the two are children of the common ancestor themselves (the unlisted-parent sentence has two forms only for them). */
	private doubtOf(shape: Shape, x: number, c1: number, c2: number, sibling: boolean): { maybe: 'full' | 'half'; cause: RelationMaybe['cause']; some?: true; form?: RelationMaybe['unlistedForm'] } | undefined {
		const [t1, t2] = [this.typeOf(c1, x), this.typeOf(c2, x)];
		if (t1 === 'adoptive' || t2 === 'adoptive') return undefined;
		const [s1, s2] = [this.counted(c1, t1), this.counted(c2, t2)];
		const rumoured = s1.hasRumoured || s2.hasRumoured;
		if (shape.half) {
			// Rule 2: the rumour gives equal sets (the second test says full), or (setting on) an unknown parent could make them equal.
			if (rumoured) {
				// One choice each (nearly always): the sets are equal or not, and equal sets hold every rumoured parent.
				const single = s1.choices.length === 1 && s2.choices.length === 1;
				if (single && s1.all === s2.all) return { maybe: 'full', cause: 'rumoured' };
				// R4: a child with two sure parents may also have just those two, if the rumoured link is false.
				const equal = this.outcomeMatches(s1, s2);
				if (equal.length) {
					// D176: the sheet says "one of the links" if some matching set leaves out a rumoured parent of either person.
					const all = [...s1.rumouredList, ...s2.rumouredList];
					return { maybe: 'full', cause: 'rumoured', ...(equal.some((t) => all.some((r) => !t.includes(r))) ? { some: true as const } : {}) };
				}
			}
			if (this.options.oneParentUnknown && outcomesOf(s1).some((a) => outcomesOf(s2).some((b) => joinedSize(a, b) <= 2))) {
				return { maybe: 'full', cause: 'unlisted', form: unlistedForm(sibling, s1, s2) };
			}
			return undefined;
		}
		return s1.rumoured !== s2.rumoured ? { maybe: 'half', cause: 'rumoured' } : undefined;
	}

	/** The key of a candidate on a rumoured line of the pair (`c1`, `c2`) at `x`: its sure key, or the rule 1 key if the second test differs. */
	private ruleOneKey(shape: Shape, x: number, c1: number, c2: number, a: number, b: number): string {
		const t1 = this.typeOf(c1, x);
		const half = this.secondHalf(c1, t1, c2, this.typeOf(c2, x));
		if (half === shape.half) return shape.key;
		if (half) return ruleOneKey(true, x, '', a, b);
		const q1 = this.counted(c1, t1);
		const setList = this.matchedPeople(q1, this.counted(c2, this.typeOf(c2, x)));
		return ruleOneKey(false, x, setList === q1.allList ? q1.all : setList.join(','), a, b);
	}

	/** "rumoured" if a link of the line is rumoured, else "adoptive" if one is adoptive, else "birth". */
	private wordOf(pathF: number[], pathP: number[], y: number): Blood['word'] {
		let adoptive = false;
		const check = (child: number, parent: number) => {
			const t = this.typeOf(child, parent);
			if (t === 'adoptive') adoptive = true;
			return t === 'rumoured';
		};
		for (const path of [pathF, pathP]) {
			for (let i = 0; i + 1 < path.length; i++) if (check(path[i], path[i + 1])) return 'rumoured';
			if (y >= 0 && path.length >= 2 && check(path[path.length - 2], y)) return 'rumoured';
		}
		return adoptive ? 'adoptive' : 'birth';
	}

	/**
	 * §13.1 "Double": one cousin name from two different couples is one "double" name, with the first
	 * couple's line; the other lines stay in `also`. `more(keys)` adds the lines of the pairs that the
	 * search passed over and that could have one of `keys`; it runs for a group only if the lines found
	 * so far say "one couple" and the couple test alone does not (D175).
	 */
	private mergeDoubles(list: Blood[], more: (keys: Set<string>) => void): Blood[] {
		const groups = new Map<string, Blood[]>();
		for (const c of list) if (isFullCousin(c)) push(groups, `${c.word}:${cousinWord(c.a, c.b, false)}`, c);
		const drop = new Set<Blood>();
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			if (!anyPair(group, twoCouples)) {
				// More lines change nothing where every pair of the group is one couple by the couple test alone.
				if (!anyPair(group, notOneCouple)) continue;
				more(new Set(group.map((c) => c.key)));
				if (!anyPair(group, twoCouples)) continue;
			}
			group.sort((i, j) => i.x - j.x);
			group[0].double = true;
			// A double name is one name from two couples; no rumour is compared against it (rule 5).
			delete group[0].maybe;
			delete group[0].cause;
			delete group[0].some;
			delete group[0].form;
			group[0].maybeFrom = undefined;
			for (const c of group.slice(1)) {
				drop.add(c);
				addLines(group[0], c);
			}
		}
		return list.filter((c) => !drop.has(c));
	}

	/** The name of a blood candidate, with the words for the second person's `sex`. */
	bloodLower(c: Blood, sex: Sex): string {
		let word = shapeWord(c.a, c.b, sex, c.half);
		if (c.double) word = `${WORDS.double} ${word}`;
		if (c.word === 'rumoured') word = `${WORDS.rumoured} ${word}`;
		else if (c.word === 'adoptive') word = `${c.a === 0 ? WORDS.adopted : WORDS.adoptive} ${word}`;
		return word;
	}

	/**
	 * The walk of a blood candidate (file header, "Lines", blood): up from the first person to `x`;
	 * for a full relation across the couple to `x`'s partner; then down to the second person.
	 */
	bloodWalk(c: BloodLine): Walk {
		const nodes = [...c.pathF];
		const edges: Edge[] = [];
		for (let i = 0; i + 1 < c.pathF.length; i++) edges.push({ k: 'up', type: this.typeOf(c.pathF[i], c.pathF[i + 1]) });
		let top = c.x;
		if (c.y >= 0 && c.a > 0 && c.b > 0) {
			nodes.push(c.y);
			edges.push({ k: 'partner', union: this.coupleUnion(c.pathF[c.pathF.length - 2], c.x, c.y) });
			top = c.y;
		}
		for (let i = c.pathP.length - 2; i >= 0; i--) {
			nodes.push(c.pathP[i]);
			edges.push({ k: 'down', type: this.typeOf(c.pathP[i], i === c.pathP.length - 2 ? top : c.pathP[i + 1]) });
		}
		return { nodes, edges };
	}

	/** The line of a blood candidate. */
	bloodLine(c: BloodLine): Line {
		return walkLine(this.bloodWalk(c));
	}

	/** c1's primary union if it is the couple's, else the couple's last-listed union, else the implicit key. */
	private coupleUnion(c1: number, x: number, y: number): string {
		const primary = this.g.primaryUnion.get(this.ids[c1]);
		const fu = primary === undefined ? undefined : this.g.unionByKey.get(primary);
		const pair = new Set([this.ids[x], this.ids[y]]);
		if (fu && pair.has(fu.partners[0]) && pair.has(fu.partners[1])) return fu.key;
		return this.lastUnion(x, y, false)?.key ?? implicitKey(this.ids[x], this.ids[y]);
	}

	/** The last-listed union of a pair (only marriage-type ones if `marriage`). */
	lastUnion(x: number, y: number, marriage: boolean): FamilyUnion | undefined {
		let out: FamilyUnion | undefined;
		const other = this.ids[y];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu || fu.implicit || (fu.partners[0] !== other && fu.partners[1] !== other)) continue;
			if (!marriage || isMarriage(fu)) out = fu;
		}
		return out;
	}

	/** The union a partner step uses: the pair's last-listed union, or their implicit union. */
	pairUnion(x: number, y: number): FamilyUnion | undefined {
		const listed = this.lastUnion(x, y, false);
		if (listed) return listed;
		const key = implicitKey(this.ids[x], this.ids[y]);
		return (this.g.unionsOf.get(this.ids[x]) ?? []).includes(key) ? this.g.unionByKey.get(key) : undefined;
	}

	/** Partners in a marriage (or a union of unknown type), in `unionsOf` order. */
	spouses(x: number): number[] {
		const known = this.spouseMemo[x];
		if (known) return known;
		const out: number[] = [];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu || !isMarriage(fu)) continue;
			const other = this.idx.get(fu.partners[0] === this.ids[x] ? fu.partners[1] : fu.partners[0]);
			if (other !== undefined && other !== x && !out.includes(other)) out.push(other);
		}
		this.spouseMemo[x] = out;
		return out;
	}

	/** Partners in any union, also implicit, in `unionsOf` order. */
	partners(x: number): number[] {
		const out: number[] = [];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu) continue;
			const other = this.idx.get(fu.partners[0] === this.ids[x] ? fu.partners[1] : fu.partners[0]);
			if (other !== undefined && other !== x && !out.includes(other)) out.push(other);
		}
		return out;
	}

	/** Every named relation of `p` to `m` (§13.1), best first, one per name. */
	relationsFor(m: number, p: number): Cand[] {
		relationCallStats.calls++;
		this.belowScratch.clear();
		this.dagScratch.clear();
		this.sure?.belowScratch.clear();
		this.sure?.dagScratch.clear();
		const cands: Cand[] = [];
		const sexP = this.sex[p];
		const aP = this.anc(p);

		const pu = this.pairUnion(m, p);
		if (pu) {
			const walk: Walk = { nodes: [m, p], edges: [{ k: 'partner', union: pu.key }] };
			cands.push({ lower: partnerWord(pu.type, pu.implicit, sexP), kind: 'partner', distance: 1, cat: 0, direct: 1, half: 0, removal: 0, elder: 0, group: 0, anc: -1, make: () => ({ line: walkLine(walk), walk }) });
		}

		if (this.drawn[m].some((l) => l.p === p && l.type === 'ward')) cands.push(this.wardCand(m, p, 'guardian'));
		if (this.drawn[p].some((l) => l.p === m && l.type === 'ward')) cands.push(this.wardCand(m, p, 'ward'));

		const blood = this.blood(m, p, aP);
		// A rumoured half line of the same degree as a sure line whose "maybe full" the rumour causes adds no name: the "maybe" has made its
		// "Rumoured" name already (R4-1). It reads no pair of children, since the lines kept for a key depend on the order of the people.
		const dupRumoured = (rc: Blood) => rc.word === 'rumoured' && blood.some((c) => c !== rc && c.word !== 'rumoured' && c.maybe === 'full' && c.cause === 'rumoured' && c.half && rc.half && c.a === rc.a && c.b === rc.b);
		for (const c of blood) {
			if (dupRumoured(c)) continue;
			const lower = this.bloodLower(c, sexP);
			cands.push({
				lower,
				...(c.maybe ? { maybe: this.maybeOf(c, sexP) } : {}),
				kind: 'blood',
				distance: c.a + c.b,
				cat: c.word === 'rumoured' ? 4 : c.word === 'adoptive' ? 1 : 0,
				second: c.word === 'rumoured',
				direct: c.a === 0 || c.b === 0 ? 0 : 1,
				half: c.half ? 1 : 0,
				removal: Math.abs(c.a - c.b),
				elder: c.a - c.b,
				group: 0,
				anc: c.x,
				make: () => ({ line: this.bloodLine(c), walk: this.bloodWalk(c) }),
			});
		}

		// D123: the name that the rumoured parents would make true is also a relation, with the word "rumoured", unless a rumoured line already gave it.
		// A doubt of only a parent who is not listed adds no name (D174).
		const have = new Set(cands.map((c) => c.lower));
		for (const c of blood) {
			if (!c.maybe || c.cause !== 'rumoured') continue;
			const lower = this.bloodLower({ ...c, half: !c.half, word: 'rumoured' }, sexP);
			// A "double" name of the rumoured lines already says that the rumours make them full cousins, and more.
			if (have.has(lower) || have.has(this.bloodLower({ ...c, half: !c.half, word: 'rumoured', double: true }, sexP))) continue;
			have.add(lower);
			// The line of the pair of children that the rumour concerns, so that a step says "rumoured" whatever the order of the people.
			const source = c.maybeFrom ?? c;
			cands.push({
				lower,
				kind: 'blood',
				distance: c.a + c.b,
				cat: 4,
				second: true,
				direct: 1,
				half: c.half ? 0 : 1,
				removal: Math.abs(c.a - c.b),
				elder: c.a - c.b,
				group: 0,
				stepHalf: !c.half,
				anc: c.x,
				// A half name passes the top of its line alone (D176 item 7): the rumoured parent is not an ancestor of the other person, so a couple would be false.
				make: () => {
					const top = c.half ? source : { ...source, y: -1 };
					return { line: this.bloodLine(top), walk: this.bloodWalk(top) };
				},
			});
		}

		// A sure blood name of P puts the names by marriage after it (R3 key 2) and hides rule 1; a name through a rumoured link does neither (R1).
		const sureBlood = blood.some((c) => c.word !== 'rumoured');
		// By marriage, rule 1: P is married to a blood relative R of M, and P is not a sure blood relative.
		if (!sureBlood) {
			// A rumoured blood relative P can lie on the line from M to R, and the line lists each person once: such a name is left out.
			// The test reads the ancestors, not the line found, so the names never depend on the order of the people.
			const aM = blood.length ? this.ancFrom(m) : undefined;
			for (const r of this.spouses(p)) {
				if (r === m) continue;
				const marriage = this.lastUnion(r, p, true)!;
				const aR = aM ? this.anc(r) : undefined;
				for (const c of this.blood(m, r)) {
					// The first member of a couple is chosen by the order of the people, so every member counts.
					if (aM && (c.x === p || c.y === p || c.couple.includes(p) || ((aM.has(p) || aR!.has(p)) && (aP.has(c.x) || c.couple.some((q) => aP.has(q)))))) continue;
					cands.push(
						this.marriageCand(...this.rule1Word(c, this.sex[r], sexP), c, () => {
							const line = this.bloodLine(c);
							line.people.push(p);
							line.unions.push(marriage.key);
							const walk = this.bloodWalk(c);
							walk.nodes.push(p);
							walk.edges.push({ k: 'partner', union: marriage.key });
							return { line, walk };
						}),
					);
				}
			}
		}

		// By marriage, rule 2: P is a blood relative of M's spouse S.
		const avoids = (d: BloodLine) => d.y !== m && !d.pathF.includes(m) && !d.pathP.includes(m);
		for (const s of this.spouses(m)) {
			if (s === p) continue;
			const marriage = this.lastUnion(m, s, true)!;
			const ofS = this.blood(s, p, aP);
			for (const c of ofS) {
				// A descendant of S through M's own child is M's own descendant, not a step-relation.
				if (c.a === 0 && this.up[c.pathP[c.pathP.length - 2]].some((l) => l.p === m && l.type !== 'rumoured')) continue;
				// The line lists each person once, so a relation to S that runs through M is not one by marriage. Any line
				// of the name that avoids M will do (the first one found depends on the order of the people), and is shown.
				const via = avoids(c) ? c : c.also?.find(avoids);
				if (!via) continue;
				cands.push(
					this.marriageCand(...this.rule2Word(c, sexP, this.sex[s]), c, () => {
						const inner = this.bloodLine(via);
						const walk = this.bloodWalk(via);
						return {
							line: { people: [m, ...inner.people], links: inner.links, unions: [marriage.key, ...inner.unions] },
							walk: { nodes: [m, ...walk.nodes], edges: [{ k: 'partner', union: marriage.key }, ...walk.edges] },
						};
					}),
				);
			}
			forget(ofS);
		}
		// Only this call reads the other lines of these lists; rule 1 reads none.
		forget(blood);

		const step = this.stepSibling(m, p);
		if (step) cands.push(step);

		// Supervisor ruling, R3 key 2: a name by marriage (rules 1 and 2) never wins over a sure blood name.
		if (sureBlood) for (const c of cands) if (c.kind === 'by-marriage') c.after = 1;
		cands.sort(compareCands);
		const seen = new Map<string, Cand>();
		return cands.filter((c) => {
			const first = seen.get(c.lower);
			if (!first) {
				seen.set(c.lower, c);
				return true;
			}
			// Equal names keep the maybe of any of them ('full' wins, then a rumoured cause), so it never depends on the order of the people.
			if (c.maybe && first.kind === 'blood' && c.kind === 'blood' && (!first.maybe || maybeRank(c.maybe) < maybeRank(first.maybe))) first.maybe = c.maybe;
			return false;
		});
	}

	/** D123: the name a sure blood candidate would have if every rumoured link were true (or, D174, if the parent who is not listed is the same person). */
	private maybeOf(c: Blood, sex: Sex): RelationMaybe {
		const lower = this.bloodLower({ ...c, half: !c.half }, sex);
		return Object.freeze({ effect: c.maybe!, text: capital(lower), lower, cause: c.cause ?? 'rumoured', ...(c.some ? { some: true as const } : {}), ...(c.cause === 'unlisted' && c.form ? { unlistedForm: c.form } : {}) });
	}

	private wardCand(m: number, p: number, kind: 'guardian' | 'ward'): Cand {
		const [parent, child] = kind === 'guardian' ? [p, m] : [m, p];
		const walk: Walk = { nodes: [m, p], edges: [{ k: kind === 'guardian' ? 'up' : 'down', type: 'ward' }] };
		const line: Line = { people: [m, p], links: [{ parent, child, type: 'ward' }], unions: [] };
		return { lower: kind === 'guardian' ? WORDS.guardian : WORDS.ward, kind, distance: 1, cat: 2, direct: 1, half: 0, removal: 0, elder: 0, group: 0, anc: -1, make: () => ({ line, walk }) };
	}

	private marriageCand(lower: string, group: number, c: Blood, make: Cand['make']): Cand {
		return {
			lower,
			kind: 'by-marriage',
			distance: 1 + c.a + c.b,
			// R3 key 4: a name through a rumoured link counts as rumoured.
			cat: c.word === 'rumoured' ? 4 : 3,
			direct: c.a === 0 || c.b === 0 ? 0 : 1,
			half: c.half ? 1 : 0,
			removal: Math.abs(c.a - c.b),
			elder: c.a - c.b,
			group,
			anc: c.x,
			make,
		};
	}

	/**
	 * Rule 1 names, by R's relation `c` to M; P has `sexP`, R has `sexR`. The second value is the group of R3 key 9. A leg through
	 * a rumoured link puts "rumoured" in front (R2); the possessive form already says it in the name of the leg.
	 */
	private rule1Word(c: Blood, sexR: Sex, sexP: Sex): [string, number] {
		const { a, b } = c;
		if (b === 0 && a === 1) return named(c, WORDS.stepParent[sexP], BY_STEP);
		if (b === 0 && a === 2) return named(c, WORDS.stepGrandparent[sexP], BY_STEP);
		if (a === 0 && b === 1) return named(c, WORDS.childInLaw[sexP], BY_IN_LAW);
		if (a === 0 && b === 2) return named(c, WORDS.grandchildInLaw[sexP], BY_IN_LAW);
		if (a === 1 && b === 1) return named(c, WORDS.siblingInLaw[sexP], BY_IN_LAW);
		if (a >= 2 && b === 1) return named(c, `${uncleWord(a, sexP, false)} ${WORDS.byMarriage}`, BY_MARRIAGE);
		if (a === 1 && b >= 2) return named(c, `${nephewWord(b, sexP, false)} ${WORDS.byMarriage}`, BY_MARRIAGE);
		if (a >= 2 && b >= 2) return named(c, `${cousinWord(a, b, false)} ${WORDS.byMarriage}`, BY_MARRIAGE);
		return [`${this.bloodLower(c, sexR)}${WORDS.possessive} ${WORDS.spouse[sexP]}`, BY_POSSESSIVE];
	}

	/** Rule 2 names, by P's relation `c` to M's spouse S, with the group of R3 key 9 (see `rule1Word`). */
	private rule2Word(c: Blood, sexP: Sex, sexS: Sex): [string, number] {
		const { a, b } = c;
		if (b === 0 && a === 1) return named(c, WORDS.parentInLaw[sexP], BY_IN_LAW);
		if (b === 0 && a === 2) return named(c, WORDS.grandparentInLaw[sexP], BY_IN_LAW);
		if (a === 1 && b === 1) return named(c, WORDS.siblingInLaw[sexP], BY_IN_LAW);
		if (a === 0 && b === 1) return named(c, WORDS.stepChild[sexP], BY_STEP);
		if (a === 0 && b === 2) return named(c, WORDS.stepGrandchild[sexP], BY_STEP);
		return [`${WORDS.spouse[sexS]}${WORDS.possessive} ${this.bloodLower(c, sexP)}`, BY_POSSESSIVE];
	}

	/** Rule 3: P is a child of Q, Q is married to M's parent N, and P and M share no parent (birth and adoptive parents only). */
	private stepSibling(m: number, p: number): Cand | undefined {
		const mine = this.up[m].filter(isStepLink);
		const theirs = this.up[p].filter(isStepLink);
		if (mine.some((l) => theirs.some((t) => t.p === l.p))) return undefined;
		for (const n of mine) {
			for (const q of this.spouses(n.p)) {
				const link = theirs.find((t) => t.p === q);
				if (!link || new Set([m, n.p, q, p]).size < 4) continue;
				const marriage = this.lastUnion(n.p, q, true)!;
				const walk: Walk = {
					nodes: [m, n.p, q, p],
					edges: [
						{ k: 'up', type: n.type },
						{ k: 'partner', union: marriage.key },
						{ k: 'down', type: link.type },
					],
				};
				return { lower: WORDS.stepSibling[this.sex[p]], kind: 'step-sibling', distance: 3, cat: 3, direct: 1, half: 0, removal: 0, elder: 0, group: BY_STEP, anc: -1, make: () => ({ line: walkLine(walk), walk }) };
			}
		}
		return undefined;
	}

	/** The shortest chain of links of any type and partnerships (§13.2), by the search order of the file header. */
	chain(f: number, t: number): Walk | undefined {
		const n = this.ids.length;
		const prev = new Int32Array(n).fill(-1);
		const via: (Edge | undefined)[] = new Array(n);
		prev[f] = f;
		const queue = [f];
		for (let head = 0; head < queue.length && prev[t] < 0; head++) {
			const v = queue[head];
			const visit = (w: number, e: Edge) => {
				if (prev[w] >= 0) return;
				prev[w] = v;
				via[w] = e;
				queue.push(w);
			};
			for (const l of this.drawn[v]) visit(l.p, { k: 'up', type: l.type });
			for (const c of this.downAll[v]) visit(c.p, { k: 'down', type: c.type });
			for (const w of this.partners(v)) visit(w, { k: 'partner', union: this.pairUnion(v, w)?.key ?? implicitKey(this.ids[v], this.ids[w]) });
		}
		if (prev[t] < 0) return undefined;
		const nodes = [t];
		const edges: Edge[] = [];
		for (let cur = t; cur !== f; cur = prev[cur]) {
			nodes.push(prev[cur]);
			edges.push(via[cur]!);
		}
		return { nodes: nodes.reverse(), edges: edges.reverse() };
	}

	/** The steps of a walk (file header, "Steps"): an up step then a down step to another child is one sibling step (not through a ward link). `second`: the walk of a rumoured name. */
	steps(walk: Walk, second = false, stepHalf?: boolean): RelationStep[] {
		const out: RelationStep[] = [];
		const { nodes, edges } = walk;
		for (let i = 0; i < edges.length; i++) {
			const e = edges[i];
			const from = nodes[i];
			const to = nodes[i + 1];
			const after = edges[i + 1];
			// A ward is not a sibling: a ward link stays a step of its own.
			if (e.k === 'up' && after?.k === 'down' && nodes[i + 2] !== from && e.type !== 'ward' && after.type !== 'ward') {
				const sib = nodes[i + 2];
				// The steps of a rumoured name follow its second test; a chain's step follows its own links.
				const sure = this.isHalf(from, e.type, sib, after.type);
					// R4: the extra name of a maybe prints the other outcome of the sure pair, whatever the second test says.
				const half = stepHalf ?? (second || e.type === 'rumoured' || after.type === 'rumoured' ? this.halfCounted(from, e.type, sib, after.type) : sure);
				// A step that only the rumours make full (or half) says so, also over two birth links.
				out.push({ person: this.ids[sib], of: this.ids[from], word: siblingStepWord(this.sex[sib], half, e.type, after.type, half !== sure) });
				i++;
				continue;
			}
			let word: string;
			if (e.k === 'partner') {
				const fu = this.g.unionByKey.get(e.union);
				word = partnerWord(fu?.type ?? 'implicit', fu ? fu.implicit : true, this.sex[to]);
			} else word = e.k === 'up' ? parentStepWord(e.type, this.sex[to]) : childStepWord(e.type, this.sex[to]);
			out.push({ person: this.ids[to], of: this.ids[from], word });
		}
		return out;
	}

	/** A `Relation` with ids in place of indices. */
	relation(c: Cand, line: Line): Relation {
		return { text: capital(c.lower), lower: c.lower, kind: c.kind, distance: c.distance, line: this.lineIds(line), ...(c.maybe ? { maybe: c.maybe } : {}) };
	}

	/**
	 * A frozen `Relation` whose line is built (and frozen) the first time it is read: a tree of
	 * hundreds of people has thousands of names, and the cards need only the text.
	 */
	lazyRelation(c: Cand): Relation {
		let line: RelationLine | undefined;
		const make = () => (line ??= deepFreeze(this.lineIds(c.make().line)));
		return Object.freeze({
			text: capital(c.lower),
			lower: c.lower,
			kind: c.kind,
			distance: c.distance,
			...(c.maybe ? { maybe: c.maybe } : {}),
			get line() {
				return make();
			},
		});
	}

	/** Drops the search memos; the lines built later need only the graph and the candidates. */
	release(): void {
		this.sure?.release();
		this.fromAnc.clear();
		this.bloodMemo.clear();
		this.firstPaths.clear();
		this.belowMemo.clear();
		this.belowScratch.clear();
		this.dagMemo.clear();
		this.dagScratch.clear();
		this.unionPeople.length = 0;
	}

	lineIds(line: Line): RelationLine {
		return {
			people: line.people.map((i) => this.ids[i]),
			links: line.links.map((l): RelationLink => ({ parent: this.ids[l.parent], child: this.ids[l.child], type: l.type })),
			unions: [...line.unions],
		};
	}
}

/** R4: a child with two sure parents and a rumoured parent may have just the two sure parents (the rumour may be false). */
function hasSureAlone(s: Counted): boolean {
	return s.canLack && s.hasRumoured && s.sureList.length === 2;
}

/** R4: the parent sets that a child could have, as outcomes: its choices, and the sure set alone when `hasSureAlone`. Only the maybe of a half pair reads the sure set alone; `choices` itself is unchanged (D174 item 4). */
function outcomesOf(s: Counted): number[][] {
	return hasSureAlone(s) ? [...s.choices, s.sureList] : s.choices;
}

/** Smaller a + b first, then the smaller removal, then the smaller first distance. */
function better(d1: number, d2: number, b1: number, b2: number): boolean {
	if (d1 + d2 !== b1 + b2) return d1 + d2 < b1 + b2;
	if (Math.abs(d1 - d2) !== Math.abs(b1 - b2)) return Math.abs(d1 - d2) < Math.abs(b1 - b2);
	return d1 < b1;
}

/** Rule 6 order of a maybe: 'full' first, then a rumoured cause, then one with `some` (D176), so the flag never depends on the order of the people. */
const doubtRank = (maybe: 'full' | 'half', cause: RelationMaybe['cause'], some?: true, form?: RelationMaybe['unlistedForm']) => (((maybe === 'full' ? 0 : 2) + (cause === 'rumoured' ? 0 : 1)) * 2 + (some ? 0 : 1)) * 2 + (form === 'other-parent' ? 1 : 0);

/**
 * F-KIN-08: which sentence tells the user what to check. Two siblings that both list the same single parent (or any pair
 * above the sibling level, the known limit) read 'same-person'; if one lists both parents, the other's unlisted parent
 * is the question: 'other-parent'. The first kind wins when both are possible, so the answer never depends on the order.
 */
function unlistedForm(sibling: boolean, s1: Counted, s2: Counted): RelationMaybe['unlistedForm'] {
	if (!sibling) return 'same-person';
	for (const a of s1.choices) for (const b of s2.choices) if (joinedSize(a, b) <= 2 && a.length === 1 && b.length === 1) return 'same-person';
	return 'other-parent';
}

/**
 * Two candidates with one key: the one with the better word (the first if equal), with the better
 * maybe of the two if their words are equal (rule 6), so the result never depends on their order.
 */
function joinCandidates(old: Blood, c: Blood): Blood {
	const keep = WORD_RANK[c.word] < WORD_RANK[old.word] ? c : old;
	for (const v of (keep === c ? old : c).via) addVia(keep, v);
	if (WORD_RANK[c.word] !== WORD_RANK[old.word]) return keep;
	if (c.maybe && (!old.maybe || doubtRank(c.maybe, c.cause!, c.some, c.form) < doubtRank(old.maybe, old.cause!, old.some, old.form))) {
		old.maybe = c.maybe;
		old.cause = c.cause;
		if (c.some) old.some = true;
		else delete old.some;
		if (c.form) old.form = c.form;
		else delete old.form;
		const from = c.maybeFrom ?? c;
		old.maybeFrom = sameLine(old, from) ? undefined : (c.maybeFrom ?? lineOf(c));
	}
	addLines(old, c);
	return old;
}

/**
 * Adds the lines of `c`, which is dropped for `old`, to `old.also`: one flat list, each line once and not
 * `old`'s own (a full line is often found the same at both members of its couple), so the list stays short.
 */
function addLines(old: Blood, c: Blood): void {
	if (isNewLine(old, c)) (old.also ??= []).push(lineOf(c));
	if (c.also) for (const d of c.also) if (isNewLine(old, d)) (old.also ??= []).push(d);
}

/** True if `d` is neither the line of `c` nor one of its other lines. */
function isNewLine(c: Blood, d: BloodLine): boolean {
	if (sameLine(c, d)) return false;
	if (c.also) for (const e of c.also) if (sameLine(e, d)) return false;
	return true;
}

/** The line of a candidate alone, so that a list of lines does not keep the rest of a dropped candidate. */
const lineOf = (c: BloodLine): BloodLine => ({ a: c.a, b: c.b, x: c.x, y: c.y, pathF: c.pathF, pathP: c.pathP });

/** True if two lines have the same people in the same places: `bloodWalk` makes the same walk of them. */
function sameLine(c: BloodLine, d: BloodLine): boolean {
	return c === d || (c.x === d.x && c.y === d.y && sameList(c.pathF, d.pathF) && sameList(c.pathP, d.pathP));
}

/** Drops the other lines of the candidates of `list` once the names of one person are made: their closures keep the line they show, and a result keeps every candidate it names. */
function forget(list: Blood[]): void {
	// Only where set: a new property on every candidate would cost memory.
	for (const c of list) {
		if (c.also) c.also = undefined;
		if (c.maybeFrom) c.maybeFrom = undefined;
	}
}

/** Adds the line `v` to the candidate `c` once. */
function addVia(c: Blood, v: Via): void {
	if (!c.via.some((w) => w.c1 === v.c1 && w.c2 === v.c2 && w.word === v.word)) c.via.push(v);
}

/**
 * §13.1 "Double" (D175): two full candidates of one name and one word come from two couples, unless
 * one is a couple of the second test (an FR key) and a couple of two or more people of one is part of
 * the couple of the other (a sure couple plus a rumoured parent), or every line of both, of that word,
 * leaves through the same two children. Two couples that share one person (a man with two wives) are
 * still two couples, and so are one parent alone and a couple with that parent (setting off).
 */
function twoCouples(c: Blood, d: Blood): boolean {
	if (oneCouple(c, d)) return false;
	// Any two different lines will do: one line for each couple.
	const lines = [...c.via, ...d.via].filter((v) => v.word === c.word);
	return lines.some((v) => v.c1 !== lines[0].c1 || v.c2 !== lines[0].c2);
}

/** The couple test of `twoCouples`, which reads no line: one is a couple of the second test and a couple of two or more people of one is part of the couple of the other. */
function oneCouple(c: Blood, d: Blood): boolean {
	return (isFullRuleOne(c) || isFullRuleOne(d)) && (inside(c.couple, d.couple) || inside(d.couple, c.couple));
}

const notOneCouple = (c: Blood, d: Blood) => !oneCouple(c, d);

/** True if `s` has two or more people and all are in `t`. */
function inside(s: number[], t: number[]): boolean {
	if (s.length < 2) return false;
	for (const v of s) if (!t.includes(v)) return false;
	return true;
}

/** True if `test` holds for two different candidates of `group` (the first before the second). */
function anyPair(group: Blood[], test: (c: Blood, d: Blood) => boolean): boolean {
	for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (test(group[i], group[j])) return true;
	return false;
}

/** A full cousin candidate: only these can make a "double" name. */
const isFullCousin = (c: Blood) => !c.half && c.a >= 2 && c.b >= 2;

/** The number of full cousin candidates of `list`, up to 2. */
function cousinCount(list: Blood[]): number {
	let n = 0;
	for (const c of list) if (isFullCousin(c) && ++n === 2) break;
	return n;
}

/** True for a full candidate whose couple comes from the second test (rule 1, `ruleOneKey`). */
const isFullRuleOne = (c: Blood) => c.key.startsWith('FR');

/** True for a candidate that has a rule 1 key (`ruleOneKey`). */
const isRuleOne = (c: Blood) => c.key.charCodeAt(1) === 82;

/**
 * The key of a rule 1 candidate whose half or full differs from the sure test: a half one passes `x`
 * alone; a full one is its couple of the second test (`set`, sorted), as a sure full key is its couple
 * (D175). The "R" keeps it apart from a sure key, so a rumoured line never joins a sure one.
 */
const ruleOneKey = (half: boolean, x: number, set: string, a: number, b: number) => (half ? `HR:${x}:${a}:${b}` : `FR:${set}:${a}:${b}`);

/** The number of different people in two short lists (the two parent sets of D174 rule 2). */
function joinedSize(a: number[], b: number[]): number {
	let n = a.length;
	for (const v of b) if (!a.includes(v)) n++;
	return n;
}

/** Which of two maybes of one name is kept: 'full' first, then a rumoured cause. */
const maybeRank = (m: RelationMaybe) => doubtRank(m.effect, m.cause, m.some, m.unlistedForm);

/** The line of a walk: its people, its parent links and its partnerships, in step order. */
function walkLine(walk: Walk): Line {
	const line: Line = { people: [...walk.nodes], links: [], unions: [] };
	walk.edges.forEach((e, i) => {
		const [a, b] = [walk.nodes[i], walk.nodes[i + 1]];
		if (e.k === 'partner') line.unions.push(e.union);
		else line.links.push(e.k === 'up' ? { parent: b, child: a, type: e.type } : { parent: a, child: b, type: e.type });
	});
	return line;
}

/**
 * §13.1 "Which name wins" with the eleven keys of R3, every one a property of the name and none of the place in the note:
 * 1 partner names; 2 sure blood before by marriage (`after`); 3 smaller distance; 4 link kind (`cat`); 5 direct line;
 * 6 full before half; 7 smaller removal; 8 older generation first (larger `elder`); 9 by marriage: step, in-law, "by
 * marriage", possessive (`group`); 10 the name text by code unit (`<`, not `localeCompare`, so no locale decides);
 * 11 the common ancestor's index, only to choose which line a name shows.
 */
function compareCands(x: Cand, y: Cand): number {
	const partner = (c: Cand) => (c.kind === 'partner' ? 0 : 1);
	return (
		partner(x) - partner(y) ||
		(x.after ?? 0) - (y.after ?? 0) ||
		x.distance - y.distance ||
		x.cat - y.cat ||
		x.direct - y.direct ||
		x.half - y.half ||
		x.removal - y.removal ||
		y.elder - x.elder ||
		x.group - y.group ||
		(x.lower < y.lower ? -1 : x.lower > y.lower ? 1 : 0) ||
		x.anc - y.anc
	);
}

/** Blocks `set`, `delete` and `clear` too: `Object.freeze` does not stop them on a Map, and the views share the result. */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
	lockMap(map);
	return Object.freeze(map);
}

// ---------------------------------------------------------------------------------------------
// Public functions

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

/** The relations of the people that a view asks for, one answer per person (WP-K, spec §13.1 "Performance"). */
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
	// Supervisor ruling: a full relation's couple keeps its shared trunk. A child on the line with a
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
		if (fu.id !== undefined) u.id = fu.id;
		if (fu.start !== undefined) u.start = fu.start;
		if (fu.end !== undefined) u.end = fu.end;
		if (fu.text !== undefined) u.text = fu.text;
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
	const people = g.people.map((p) => [p.id, p.sex ?? null, g.primaryUnion.get(p.id) ?? null, (drawn.get(p.id) ?? []).map((d: DrawnParent) => [d.id, d.type])]);
	const unions = g.unions.map((u) => [u.key, u.partners, u.type]);
	return JSON.stringify([me, people, unions, options.oneParentUnknown]);
};
