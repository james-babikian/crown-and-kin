/*
 * The kinship words of the relation names (spec §13.1; exempt from the STE word rule, §13.0 item 5): the `WORDS` table and the functions that put them together. Pure; no
 * graph is read here.
 */

import { CURLY_APOSTROPHE } from './quote';
import { ordinal } from './succession-keys';
import type { ParentType } from './types';

/** 0 = male (`sex: m`), 1 = female (`sex: f`), 2 = neutral (any other value, or none; D12). */
export type Sex = 0 | 1 | 2;

/** Every kinship word the plugin shows, by sex where it changes: [male, female, neutral]. */
export const WORDS = {
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
	former: 'former',
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
export function uncleWord(a: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${ancestorWord(a - 1, 2)}${WORDS.possessive} ${siblingWord(2, half)}`;
	const word = `${greats(a - 2)}${WORDS.uncle[sex]}`;
	return half ? halfOf(word) : word;
}

/** Nephew or niece with `b` − 2 "great"; the neutral form puts "great" and "half" on the inner word. */
export function nephewWord(b: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${siblingWord(2, half)}${WORDS.possessive} ${descendantWord(b - 1, 2)}`;
	const word = `${greats(b - 2)}${WORDS.nephew[sex]}`;
	return half ? halfOf(word) : word;
}

/** "first cousin", "second cousin once removed", "11th cousin 3 times removed". */
export function cousinWord(a: number, b: number, half: boolean): string {
	const degree = Math.min(a, b) - 1;
	const removal = Math.abs(a - b);
	let word = `${WORDS.degrees[degree - 1] ?? ordinal(degree)} ${WORDS.cousin}`;
	if (removal === 1) word += ` ${WORDS.once}`;
	else if (removal === 2) word += ` ${WORDS.twice}`;
	else if (removal > 2) word += ` ${WORDS.times(removal)}`;
	return half ? halfOf(word) : word;
}

/** The §13.1 table name of P for M up `a` and P up `b` to the common ancestor, without type words. */
export function shapeWord(a: number, b: number, sex: Sex, half: boolean): string {
	if (a === 0) return descendantWord(b, sex);
	if (b === 0) return ancestorWord(a, sex);
	if (a === 1 && b === 1) return siblingWord(sex, half);
	if (b === 1) return uncleWord(a, sex, half);
	if (a === 1) return nephewWord(b, sex, half);
	return cousinWord(a, b, half);
}

/** A union type's partner word (§13.1 partner table); `implicit` is a couple with a child and no union. */
export function partnerWord(type: string, implicit: boolean, sex: Sex): string {
	if (implicit) return WORDS.coParent;
	if (type === 'betrothal') return WORDS.betrothed;
	if (type === 'concubinage') return WORDS.concubinage;
	if (type === 'affair') return WORDS.lover;
	return WORDS.spouse[sex];
}

/** A sibling step's word: "rumoured" if one of its two links is rumoured or the rumours change its half or full (`rumour`), else "adoptive" if one is adoptive (as a blood name). */
export function siblingStepWord(sex: Sex, half: boolean, up: ParentType, down: ParentType, rumour: boolean): string {
	const word = siblingWord(sex, half);
	if (rumour || up === 'rumoured' || down === 'rumoured') return `${WORDS.rumoured} ${word}`;
	if (up === 'adoptive' || down === 'adoptive') return `${WORDS.adoptive} ${word}`;
	return word;
}

/** The word of a step up to a parent, with its link type ("adoptive father"). */
export const parentStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.guardian : type === 'adoptive' ? `${WORDS.adoptive} ${WORDS.parent[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.parent[sex]}` : WORDS.parent[sex];
/** The word of a step down to a child, with its link type ("adopted son"). */
export const childStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.ward : type === 'adoptive' ? `${WORDS.adopted} ${WORDS.child[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.child[sex]}` : WORDS.child[sex];

/** The text with its first letter in capitals. */
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
