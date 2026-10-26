// G2 of 1a-B (proof), focus 2: the K set of the years is read from whole-tree distances.
import { describe, expect, it } from 'vitest';
import { graphOf, p, reversed, w, wordsOf, type Tree } from './r05-marriage-years-trees';

// M and S were married 1100-1110 (divorced). S has two children: K (born 1120, after the marriage) and K2 (born 1105, in it).
// P is the child of K by a sure link and of K2 by a rumoured link. The sure line is M - S - K - P, so K is the stepchild the sure
// name reads; K was born after the marriage ended, so the step word must not stand for the sure name.
const t: Tree = {
	people: [
		p('m', 'm'),
		p('s', 'f'),
		p('o', 'm'),
		p('k', 'f', '1120', undefined, ['o', 's']),
		p('k2', 'f', '1105', undefined, ['o', 's']),
		p('pp', 'm', '1145', undefined, ['k', 'k2:rumoured']),
	],
	unions: [w('m', 's', { start: '1100', end: '1110', endedBy: 'divorce' })],
};

const without: Tree = { ...t, people: t.people.map((x) => (x.id === 'pp' ? p('pp', 'm', '1145', undefined, ['k']) : x)) };

describe('G2 1a-B finding: K set from whole-tree distances', () => {
	it('the sure name reads K (born 1120, after the marriage), not the rumoured parent K2', () => {
		const back = reversed(t);
		const got = [wordsOf(graphOf(t), 'm', 'pp'), wordsOf(graphOf(t, undefined, back.people, back.unions), 'm', 'pp')];
		// A sure line through K fails the years test, so no sure "step-grandson" may show.
		for (const g of got) expect(g.split(' | ')[0]).not.toMatch(/step-grand/);
	});
	it('control: without the rumoured parent the same sure name is the possessive form', () => {
		expect(wordsOf(graphOf(without), 'm', 'pp')).toBe('Former wife’s grandson');
	});
	it('rule 1 side: the step-grandmother is read at M’s rumoured parent too', () => {
		// pp looks up to S: S was married to M (1100-1110, divorced). The sure parent K (born 1120) is apart; the rumoured parent K2 (1105) is not.
		const back = reversed(t);
		const got = [wordsOf(graphOf(t), 'pp', 'm'), wordsOf(graphOf(t, undefined, back.people, back.unions), 'pp', 'm')];
		for (const g of got) expect(g.split(' | ')[0]).not.toMatch(/step-grand/);
	});
	it('control for rule 1: without the rumoured parent the name is the possessive form', () => {
		expect(wordsOf(graphOf(without), 'pp', 'm')).toBe('Grandmother’s former husband');
	});
});
