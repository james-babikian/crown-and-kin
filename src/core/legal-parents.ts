/**
 * The two legal parents of a child through an adoption (spec §13.1, D293), for the half and full test of the relation
 * words. `relations.ts` calls these two functions; they know nothing of the rest of the relation search.
 */

import type { ParentType } from './types';

/**
 * A child with one birth parent and one adoptive parent who share a union of the tree (a step-parent or second-parent
 * adoption) has two legal parents: the birth and the adoptive parents together, in the order of `links`. For the link
 * types birth and adoptive only; undefined for every other child, so a full adoption by unrelated parents and a child
 * with two birth parents keep the parents of their own link type.
 */
export function legalParents(links: readonly { p: number; type: ParentType }[], type: ParentType, share: (a: number, b: number) => boolean): number[] | undefined {
	if (type !== 'birth' && type !== 'adoptive') return undefined;
	const of = (t: ParentType) => [...new Set(links.filter((l) => l.type === t).map((l) => l.p))];
	const [birth, adoptive] = [of('birth'), of('adoptive')];
	if (birth.length !== 1 || adoptive.length !== 1 || adoptive[0] === birth[0] || !share(birth[0], adoptive[0])) return undefined;
	return [...new Set(links.filter((l) => l.type === 'birth' || l.type === 'adoptive').map((l) => l.p))];
}

/**
 * The order of the two parents of a full pair, so that the line and the word do not depend on which child is first.
 * With legal parents the two children can link to the parents with different types. The line goes up to the first parent
 * and comes down from the second, and the word follows the first parent. So the parent where both children have the
 * best link (`rank1` and `rank2` give the rank of the link of each child, lower is better) comes first: "Brother" if
 * they share a birth parent. If the two parents tie, the one whose line shows the worse link comes first, so the steps
 * agree with "Adoptive brother". When every link has one type (all other pairs) the order of the list stays.
 */
export function orderCouple(list: number[], rank1: (parent: number) => number, rank2: (parent: number) => number): number[] {
	if (list.length !== 2) return list;
	const [m, n] = list;
	const word = (v: number) => Math.max(rank1(v), rank2(v));
	const shown = (v: number, other: number) => Math.max(rank1(v), rank2(other));
	return word(n) < word(m) || (word(n) === word(m) && shown(n, m) > shown(m, n)) ? [n, m] : list;
}
