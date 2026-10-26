// G2 of 1a-B (proof), focus 5: the finder partner step and the card word of one pair must agree (RULES §2.5, §9.8).
import { describe, expect, it } from 'vitest';
import { graphOf, p, w, wordsOf, stepsOf, type Tree } from './r05-marriage-years-trees';

// Ned and Ola married 1140-1150 (divorce), and later had an affair (listed last). Pip is Ned's son.
const t: Tree = {
	people: [p('ned', 'm', '1100', '1170'), p('ola', 'f', '1102', '1175'), p('pip', 'm', '1130', undefined, ['ned'])],
	unions: [w('ned', 'ola', { start: '1140', end: '1150', endedBy: 'divorce' }), w('ned', 'ola', { type: 'affair', start: '1160' })],
};

describe('G2 1a-B focus 5: card word and finder step of one pair', () => {
	it('Ned to Ola: the card says Lover; the finder step in Pip to Ola must not say a different partner word', () => {
		const g = graphOf(t);
		const card = wordsOf(g, 'ned', 'ola');
		const steps = stepsOf(g, 'pip', 'ola');
		const partnerStep = steps.find((s) => s.startsWith('ola is ned'));
		expect(partnerStep).toBe(`ola is ned’s ${card.toLowerCase()}`);
	});
});
