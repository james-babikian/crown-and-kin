/*
 * Version 0.5 step 1a-B, fix round (D297): the people K whose life the years test reads, and the finder line through them.
 * For a confirmed name, K holds only people linked by birth or adoptive links on both steps; a rumour never changes a confirmed word
 * (R1). A rumoured name keeps every link. The finder line of a step-grandparent or step-grandchild name goes through a K that passes.
 * A partner step of the finder takes its word type from the last-listed union of the pair, as the card does (RULES §2.5, §9.8).
 */

import { describe, expect, it } from 'vitest';
import { graphOf, p, reversed, stepsOf, w, wordsOf, type Tree } from './r05-marriage-years-trees';

/** The tree as written and with the people, the parents and the unions reversed; a check runs on both, with the setting on and off. */
function both(tree: Tree, check: (read: (from: string, to: string) => string, steps: (from: string, to: string) => string[]) => void): void {
	const back = reversed(tree);
	for (const on of [true, false]) {
		for (const g of [graphOf(tree), graphOf(tree, undefined, back.people, back.unions)]) {
			check(
				(from, to) => wordsOf(g, from, to, { oneParentUnknown: on }),
				(from, to) => stepsOf(g, from, to),
			);
		}
	}
}

describe('rule 2: a rumoured parent is not a K of a confirmed name', () => {
	// M and S married 1100-1110 and divorced. S has the children B (1105, in the marriage) and B2 (1120, after it). P (1145) has B2 as a birth
	// parent and B as a rumoured parent. The confirmed line runs through B2, who fails the years test: "Former wife's grandson".
	const tree = (parents: string[]): Tree => ({
		people: [p('m', 'm'), p('s', 'f'), p('o', 'm'), p('b', 'm', '1105', undefined, ['o', 's']), p('b2', 'm', '1120', undefined, ['o', 's']), p('pp', 'm', '1145', undefined, parents)],
		unions: [w('m', 's', { start: '1100', end: '1110', endedBy: 'divorce' })],
	});
	it('M to P reads "Former wife’s grandson" and P to M "Grandmother’s former husband"', () => {
		for (const parents of [['b2', 'b:rumoured'], ['b:rumoured', 'b2']]) {
			both(tree(parents), (read) => {
				expect(read('m', 'pp')).toBe('Former wife’s grandson');
				expect(read('pp', 'm')).toBe('Grandmother’s former husband');
			});
		}
	});
	it('a rumoured name keeps every link: with only rumoured parents the K at B passes', () => {
		both(tree(['b2:rumoured', 'b:rumoured']), (read) => {
			expect(read('m', 'pp')).toBe('Rumoured former step-grandson');
			expect(read('pp', 'm')).toBe('Rumoured former step-grandfather');
		});
	});
	it('a stepchild by a rumoured link keeps "Rumoured former stepson"', () => {
		const t: Tree = { ...tree(['b:rumoured']), people: [p('m', 'm'), p('s', 'f'), p('b', 'm', '1105', undefined, ['s:rumoured'])] };
		both(t, (read) => expect(read('m', 'b')).toBe('Rumoured former stepson'));
	});
});

describe('rule 1: a rumoured link between M and R is not a K of a confirmed name', () => {
	// R and PW married 1100-1110 and divorced. K1 (1105) and K2 (1115) are children of R; M (1140) is the child of both. K2 fails the years test.
	const tree = (k1Parents: string[], mParents: string[]): Tree => ({
		people: [
			p('r', 'm'), p('pw', 'f'), p('w1', 'f'), p('w2', 'f'),
			p('k1', 'm', '1105', undefined, k1Parents), p('k2', 'f', '1115', undefined, ['r', 'w2']), p('mm', 'f', '1140', undefined, mParents),
		],
		unions: [w('r', 'pw', { start: '1100', end: '1110', endedBy: 'divorce' })],
	});
	const cases: [string, Tree][] = [
		['K1 is a rumoured son of R', tree(['r:rumoured', 'w1'], ['k1', 'k2'])],
		['M is a rumoured child of K1', tree(['r', 'w1'], ['k1:rumoured', 'k2'])],
		['K1 is a rumoured son of R, parents listed the other way', tree(['r:rumoured', 'w1'], ['k2', 'k1'])],
	];
	for (const [name, t] of cases) {
		it(`${name}: M to PW reads "Grandfather’s former wife"`, () => {
			both(t, (read) => {
				expect(read('mm', 'pw')).toBe('Grandfather’s former wife');
				expect(read('pw', 'mm')).toBe('Former husband’s granddaughter');
			});
		});
	}
	it('control: with K1 a sure son and a sure parent of M, K1 passes and the word is "Former step-grandmother"', () => {
		both(tree(['r', 'w1'], ['k1', 'k2']), (read) => expect(read('mm', 'pw')).toBe('Former step-grandmother'));
	});
});

describe('the finder line goes through a K that passes', () => {
	it('rule 1: the parents of M are K1 (passes) and K2 (does not): the steps go through K1 in every order', () => {
		const t = (parents: string[]): Tree => ({
			people: [p('r', 'm'), p('pw', 'f'), p('w1', 'f'), p('w2', 'f'), p('k1', 'm', '1105', undefined, ['r', 'w1']), p('k2', 'f', '1115', undefined, ['r', 'w2']), p('mm', 'f', '1140', undefined, parents)],
			unions: [w('r', 'pw', { start: '1100', end: '1110', endedBy: 'divorce' })],
		});
		for (const parents of [['k1', 'k2'], ['k2', 'k1']]) {
			both(t(parents), (read, steps) => {
				expect(read('mm', 'pw')).toBe('Former step-grandmother');
				expect(steps('mm', 'pw')).toEqual(['k1 is mm’s father', 'r is k1’s father', 'pw is r’s former wife']);
			});
		}
	});
	it('rule 2: the parents of P are B (passes) and B2 (does not): the steps go through B in every order', () => {
		const t = (parents: string[]): Tree => ({
			people: [p('m', 'm'), p('s', 'f'), p('o', 'm'), p('b', 'm', '1105', undefined, ['o', 's']), p('b2', 'f', '1120', undefined, ['o', 's']), p('pp', 'm', '1145', undefined, parents)],
			unions: [w('m', 's', { start: '1100', end: '1110', endedBy: 'divorce' })],
		});
		for (const parents of [['b', 'b2'], ['b2', 'b']]) {
			both(t(parents), (read, steps) => {
				expect(read('m', 'pp')).toBe('Former step-grandson');
				expect(steps('m', 'pp')).toEqual(['s is m’s former wife', 'b is s’s son', 'pp is b’s son']);
				expect(steps('pp', 'm')).toEqual(['b is pp’s father', 's is b’s mother', 'm is s’s former husband']);
			});
		}
	});
});

describe('a partner step of the finder says what the card says', () => {
	// Ned and Ola married 1140-1150 (divorce) and had an affair after it. The card of the pair follows the last-listed union.
	const tree = (marriageLast: boolean): Tree => {
		const wed = w('ned', 'ola', { start: '1140', end: '1150', endedBy: 'divorce' });
		const affair = w('ned', 'ola', { type: 'affair', start: '1160' });
		return { people: [p('ned', 'm', '1100', '1170'), p('ola', 'f', '1102', '1175'), p('pip', 'm', '1130', undefined, ['ned'])], unions: marriageLast ? [affair, wed] : [wed, affair] };
	};
	it('affair listed last: the card says "Lover" and so does the step', () => {
		const g = graphOf(tree(false));
		expect(wordsOf(g, 'ned', 'ola')).toBe('Lover');
		expect(stepsOf(g, 'pip', 'ola')).toContain('ola is ned’s lover');
	});
	it('marriage listed last: the card says "Former wife" and so does the step', () => {
		const g = graphOf(tree(true));
		expect(wordsOf(g, 'ned', 'ola')).toBe('Former wife');
		expect(stepsOf(g, 'pip', 'ola')).toContain('ola is ned’s former wife');
	});
});
