// Test round of 0.2.8, target X1: failing proof T-X1-01. Run with: npx vitest run tests/core/r028-adv-proof-x1.test.ts
// Found by the generated trees of `tests/render/r028-adv-trees.test.ts` on `r028/adv-tests-a` (the card-word test that counts flips: 10 of 120 trees flipped, all between names of equal distance and kind).
// Spec §13.1 "Rules: which name wins" rule 4 ends with "then the smaller removal"; it does not say which name wins when a person is both a half-aunt and a half-niece.
// The spec does not fix the answer, so this is a question for the supervisor first (and for the genealogy reviewer): the answer must not depend on the order of the people (§4.3 D2 is only the order of siblings).
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';

/** P0 is the mother of P1; P1 the father of P2 and P4; P3 is the child of P2 and of P2's grandmother P0. */
const LINES: Record<string, string> = {
	p0: '  - {id: p0, name: P0, sex: f}',
	p1: '  - {id: p1, name: P1, sex: m, parents: [p0]}',
	p2: '  - {id: p2, name: P2, sex: m, parents: [p1]}',
	p3: '  - {id: p3, name: P3, sex: m, parents: [p2, p0]}',
	p4: '  - {id: p4, name: P4, sex: f, parents: [p1]}',
};

function permutations<T>(xs: T[]): T[][] {
	if (xs.length <= 1) return [xs];
	return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** The card word of P4 for the marked person P3, with the people written in `order`. */
function wordOf(order: string[]): string | undefined {
	const parsed = parseDynasty(`people:\n${order.map((id) => LINES[id]).join('\n')}\n`);
	if (!parsed.ok) throw new Error('parse');
	return computeRelations(deriveFamilies(parsed.tree), 'p3').get('p4')?.[0].text;
}

describe('T-X1-01: the card word of a person with two names of equal rank does not depend on the order of the people in the text', () => {
	it('T-X1-01: P4 is P3\'s half-aunt (a half-sibling of P3\'s father) and P3\'s half-niece (a child of P3\'s half-brother); the word is the same in the 120 orders of the 5 people', () => {
		const words = new Map<string, string[]>();
		for (const order of permutations(Object.keys(LINES))) {
			const w = wordOf(order) ?? 'none';
			words.set(w, [...(words.get(w) ?? []), order.join(' ')]);
		}
		// The failure message lists both words and one order for each.
		const seen = [...words].map(([w, orders]) => `${w}: e.g. ${orders[0]} (${orders.length} orders)`);
		expect(words.size, seen.join(' | ')).toBe(1);
	});

	it('T-X1-01: the two names are both in the list of names (the set of names does not depend on the order, only the first one does)', () => {
		const names = (order: string[]) => {
			const parsed = parseDynasty(`people:\n${order.map((id) => LINES[id]).join('\n')}\n`);
			if (!parsed.ok) throw new Error('parse');
			return (computeRelations(deriveFamilies(parsed.tree), 'p3').get('p4') ?? []).map((r) => r.text).sort();
		};
		expect(names(['p0', 'p1', 'p2', 'p3', 'p4'])).toEqual(['Half-aunt', 'Half-niece']);
		expect(names(['p4', 'p3', 'p2', 'p1', 'p0'])).toEqual(['Half-aunt', 'Half-niece']);
	});
});
