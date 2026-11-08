/*
 * The shapes by person index that the relation search passes around (a blood candidate, a walk, a line), the groups of the names by marriage, and the small helpers on them. They
 * are not part of the public result: `relation-kin-*.ts` and `relation-candidates.ts` use them, `relations.ts` turns them into the frozen `Relation`.
 */

import type { FamilyGraph, FamilyUnion } from './derive';
import { MarriageYears } from './marriage-years';
import type { RelationKind, RelationMaybe } from './relation-types';
import { WORDS } from './relation-words';
import { isUnionType, type ParentType } from './types';

/** One parent link of a person: the parent's index and the link type. */
export interface Up {
	/** The parent's index. */
	p: number;
	type: ParentType;
}

/** One step of a walk from the first person to the second. A partner step with `marriage` names that union, the marriage of a name by marriage; any other names the pair's last-listed union. */
export type Edge = { k: 'up' | 'down'; type: ParentType } | { k: 'partner'; union: string; marriage?: true };

/** Links left out of a view: the links from `parent` down to the people of `kids`. */
export interface Drop {
	parent: number;
	kids: ReadonlySet<number>;
}

/** The people of a relation in step order, and the edge between each two (`edges[i]` joins `nodes[i]` and `nodes[i + 1]`). */
export interface Walk {
	nodes: number[];
	edges: Edge[];
}

/** The people, the parent links and the unions of one relation line, by person index. */
export interface Line {
	people: number[];
	links: { parent: number; child: number; type: ParentType }[];
	unions: string[];
}

/** One blood candidate (X, a, b) of §13.1, with the two paths its line uses. */
export interface Blood {
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
	/** Set with an 'unlisted' `maybe` (`RelationMaybe.unlistedForm`). */
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
export type BloodLine = Pick<Blood, 'a' | 'b' | 'x' | 'y' | 'pathF' | 'pathP'>;

/** One line of a blood candidate at its common ancestor: the children `c1` (first person's side) and `c2`, and the word of the line. */
export interface Via {
	c1: number;
	c2: number;
	word: Blood['word'];
}

/** Half or full for two children of a common ancestor, the couple of a full relation (else the ancestor), and the candidate key. */
export interface Shape {
	half: boolean;
	couple: number[];
	key: string;
}

/** The shortest paths between two people as a whole (`KinBlood.dagOf`); `rank` is -1 until `KinBlood.dagRank` sets it. */
export interface Dag {
	sole: Int32Array;
	rank: number;
}

/** A named relation before it becomes a `Relation`, with the values the order of §13.1 needs. */
export interface Cand {
	lower: string;
	/** D307: only on a name with "former": the same name without it. Key 10 of `compareCands` and rule D read it; every other name has none. */
	base?: string;
	kind: RelationKind;
	distance: number;
	/** Birth 0, adoptive 1, guardian or ward 2, by marriage 3, rumoured 4 ("Which name wins" rule 4). */
	cat: number;
	direct: number;
	half: number;
	removal: number;
	/** D200 R3 key 8: the blood leg's a - b (larger = older generation first). 0 for the kinds that have no leg. */
	elder: number;
	/** D200 R3 key 9, by marriage only: 0 step names (and step-sibling), 1 in-law names, 2 "by marriage", 3 the possessive forms. */
	group: number;
	/** Document index of the common ancestor, for the final tie-break (D200 R3 key 11). */
	anc: number;
	/** 1 for a name by marriage of a person who also has a blood name: it comes after every other name. */
	after?: number;
	/** D123: set on a sure blood name that a rumoured parent could change. */
	maybe?: RelationMaybe;
	/** A rumoured blood name: its sibling steps take half or full from the second test (spec §13.2), as the name does. */
	second?: boolean;
	/** D200 R4: the extra name of a maybe is the other outcome of the sure candidate; its sibling steps print that outcome (true: half), not what the second test says. */
	stepHalf?: boolean;
	/** Builds the line and the walk; only the names that are kept need them. */
	make: () => { line: Line; walk: Walk };
}

/** The parent sets of a child for the D123 comparisons, as sorted id lists. */
export interface Counted {
	/** The sure parents of the type of the child's link (the half rule of §13.1). */
	sure: string;
	/** The same people as a list (D200 R4: the sure set alone is an outcome of a child with two sure parents). */
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
	/** D293: only for a child with two legal parents, its sets as they are without them (birth and rumoured parents); the doubt of a parent who is not listed reads these. */
	plain?: Counted;
	/** D293 in the second test: the child has its legal pair only if its rumoured links are true (`allList` is that pair). */
	byRumour?: true;
}

/**
 * A name by marriage: its text, its group (D200 R3 key 9) and, when it has "former" (D307), the same text without it (`base`; the order of
 * the names and rule D compare it, so "former" never changes a tie).
 */
export type Word = readonly [lower: string, group: number, base?: string];

/** The `cat` of a name through a rumoured link ("Which name wins" rule 4). */
export const RUMOURED_CAT = 4;
/** "rumoured " goes before a named form by marriage whose blood leg is rumoured. */
export const RUMOURED = `${WORDS.rumoured} `;
/** "former " goes before the whole name, after "rumoured " (D304 to D309). */
export const FORMER = `${WORDS.former} `;

/** A name by marriage with its group (D200 R3 key 9); a leg through a rumoured link puts "rumoured" in front. */
export function named(c: Blood, word: string, group: number, former: boolean): Word {
	const rumoured = c.word === 'rumoured' ? RUMOURED : '';
	return former ? [`${rumoured}${FORMER}${word}`, group, `${rumoured}${word}`] : [`${rumoured}${word}`, group];
}

/** A possessive form: "former" describes the marriage, so it stands before the partner word (D304 to D309). */
export const possessive = (text: (former: string) => string, former: boolean): Word => (former ? [text(FORMER), BY_POSSESSIVE, text('')] : [text(''), BY_POSSESSIVE]);

/** D200 R3 key 9, the groups of the names by marriage: step names (and step-sibling), in-law names, "by marriage" names, the possessive forms. */
export const BY_STEP = 0;
/** Group 1 of the names by marriage: the in-law names. */
export const BY_IN_LAW = 1;
/** Group 2 of the names by marriage: the "by marriage" names. */
export const BY_MARRIAGE = 2;
/** Group 3 of the names by marriage: the possessive forms ("Wife’s half-nephew"). */
export const BY_POSSESSIVE = 3;

/** The years and `ended-by` of the marriages of a graph (D304 to D309), made when a partner word or a name by marriage first needs them. A graph never changes, so each mark of it shares them. */
export const YEARS = new WeakMap<FamilyGraph, MarriageYears>();

/** Rule 3: step-siblings come through birth and adoptive parents only. */
export const isStepLink = (l: Up) => l.type === 'birth' || l.type === 'adoptive';
/** The key of the implicit union of two people; it is the same in either order. */
export const implicitKey = (a: string, b: string) => `i:${JSON.stringify(a < b ? [a, b] : [b, a])}`;
/** True for a union that counts as a marriage: not implicit, and of type marriage or of a type the plugin does not know. */
export const isMarriage = (u: FamilyUnion) => !u.implicit && (u.type === 'marriage' || !isUnionType(u.type));
