/*
 * The public types and counters of the relation names (spec §13.1, §13.2) and the rank tables of the link types. `relations.ts` re-exports the public ones, so
 * importers use that file; the shapes by person index are in `relation-internal.ts`.
 */

import type { FamilyGraph } from './derive';
import type { ParentType } from './types';

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
	/** D176: only with effect 'full' and cause 'rumoured'. True if the set of parents that makes the pair full leaves out a rumoured parent of either person: then not every rumoured link need be true ("If some of the rumoured links are true", D176). Absent if every rumoured link must be true. */
	some?: true;
	/** Only with cause 'unlisted'. 'same-person': both people list the same one parent, so the unlisted parent could be the same person. 'other-parent': one lists both parents and the other one, so the other's unlisted parent could be that second parent. Cousins and beyond always read 'same-person' (known limit). */
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
 * Cache key of `computeRelations(g, me)`: ids, `sex`, `born` and `died` as written, the primary unions, the cycle-broken parent
 * links with their types, the unions (key, partners, type, order, `start` and `end` as written, the meaning of `ended-by`), the readiness and key of the date
 * reader (the words read exact years, D304 and D306) and `me`; not names. The view
 * keeps one result per key of the WHOLE tree and never uses a focus subgraph for names.
 */
export type RelationsKey = (g: FamilyGraph, me: string, options?: RelationOptions) => string;

/** The most relations the finder cycles through (§13.2): no limit (D53). A number caps the list. */
export const FINDER_LIMIT: number = Infinity;

/**
 * The rank of a blood link for the choice of lines: a line with only birth links (0) comes before
 * one with adoptive links (1), before one with rumoured links (2), as §13.1 "Which name wins" rule 4
 * orders the words. Ward links make no blood line.
 */
export const RANK: Record<ParentType, number> = { birth: 0, adoptive: 1, rumoured: 2, ward: 2 };
/** The rank of the three link words of a blood line, as `RANK` without the ward link. */
export const WORD_RANK: Record<'birth' | 'adoptive' | 'rumoured', number> = { birth: 0, adoptive: 1, rumoured: 2 };
