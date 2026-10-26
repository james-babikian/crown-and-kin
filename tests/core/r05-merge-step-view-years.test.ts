/*
 * Version 0.5, merge of step 1(d) (step-descendant rule) and step 1a-B (marriage years): the stepchildren of S whom the years read
 * (RULES §2.1, order-fault gate rule 8) are those of the step view, never M's own children. S is married to M from 1100 to 1110
 * (divorced). A is the child of M and S; B is S's child by another man; P is the child of A and B.
 */

import { describe, expect, it } from 'vitest';
import { graphOf, p, reversed, w, wordsOf, type Tree } from './r05-marriage-years-trees';

const tree = (aBorn: string, bBorn: string): Tree => ({
	people: [p('m', 'm'), p('s', 'f'), p('o', 'm'), p('a', 'm', aBorn, undefined, ['m', 's']), p('b', 'f', bBorn, undefined, ['o', 's']), p('pp', 'm', '1145', undefined, ['a', 'b'])],
	unions: [w('m', 's', { start: '1100', end: '1110', endedBy: 'divorce' })],
});

function both(t: Tree): string[] {
	const back = reversed(t);
	return [wordsOf(graphOf(t), 'm', 'pp'), wordsOf(graphOf(t, undefined, back.people, back.unions), 'm', 'pp')];
}

describe('the years read the stepchild of S (B), not M’s own child (A)', () => {
	it('B was born in the marriage, A after it: the step word stays, with "former"', () => {
		expect(both(tree('1120', '1105'))).toEqual(['Grandson | Former step-grandson', 'Grandson | Former step-grandson']);
	});
	it('A was born in the marriage, B after it: B fails the years test, so the possessive form shows', () => {
		expect(both(tree('1105', '1120'))).toEqual(['Grandson | Former wife’s grandson', 'Grandson | Former wife’s grandson']);
	});
});
