// G2 of 1a-B (proof), focus 5: the finder partner step and the card word of one pair (§9.8). Since 0.5.3 (spec §13.1 rule 6, D334) the partner
// step of a line by marriage names the marriage that made the name, so in Pip to Ola it says "former wife" while the card of Ned to Ola says "Lover".
import { describe, expect, it } from 'vitest';
import { graphOf, p, w, wordsOf, stepsOf, type Tree } from './marriage-years-trees';

// Ned and Ola married 1140-1150 (divorce), and later had an affair (listed last). Pip is Ned's son.
const t: Tree = {
	people: [p('ned', 'm', '1100', '1170'), p('ola', 'f', '1102', '1175'), p('pip', 'm', '1130', undefined, ['ned'])],
	unions: [w('ned', 'ola', { start: '1140', end: '1150', endedBy: 'divorce' }), w('ned', 'ola', { type: 'affair', start: '1160' })],
};

describe('card word and finder step of one pair', () => {
	it('Ned to Ola: the card says Lover; the finder step in Pip to Ola names the marriage that makes Ola his former stepmother', () => {
		const g = graphOf(t);
		expect(wordsOf(g, 'ned', 'ola')).toBe('Lover');
		const steps = stepsOf(g, 'pip', 'ola');
		const partnerStep = steps.find((s) => s.startsWith('ola is ned'));
		expect(partnerStep).toBe('ola is ned’s former wife');
	});
});
