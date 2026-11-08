// Begetter links (spec §0 D332): names that do not depend on order, and a huge parents list that stays fast.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';
import { timedRatio } from '../support/speed-ref';
import { speedTest } from '../support/speed-test';

const NL = '\n';
const graph = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
};

describe('names do not depend on the order of the people and of the parents lists (D332 R6)', () => {
	// M (p1) is the wife of her own granddaughter (p5); the begetter links make the same pair p1 -> p4 get "Wife's uncle" in one order only.
	const people = [
		['p0', 'm', []],
		['p1', 'f', []],
		['p2', 'f', [['p0', 'begetter'], ['p1', 'birth']]],
		['p3', 'f', [['p1', 'birth'], ['p0', 'birth']]],
		['p4', 'm', [['p0', 'birth'], ['p1', 'begetter']]],
		['p5', 'f', [['p3', 'birth'], ['p2', 'birth']]],
	] as const;
	const write = (reverse: boolean): string => {
		const list = reverse ? [...people].reverse() : [...people];
		const lines = list.map(([id, sex, parents]) => {
			const ps = (reverse ? [...parents].reverse() : parents).map(([p, t]) => `{id: ${p}, type: ${t}}`);
			return `  - {id: ${id}, name: ${id}, sex: ${sex}${ps.length ? `, parents: [${ps.join(', ')}]` : ''}}`;
		});
		return `people:${NL}${lines.join(NL)}${NL}unions:${NL}  - {partners: [p1, p5]}${NL}`;
	};
	const texts = (src: string) => (computeRelations(graph(src), 'p1').get('p4') ?? []).map((r) => r.text);

	it('p1 -> p4 has the same names with the people and the parents lists reversed', () => {
		expect(texts(write(true))).toEqual(texts(write(false)));
	});

	it('p1 -> p4 is only "Begotten son" in every order: the full uncle line of the wife runs through M, as with birth links', () => {
		// Only the parents lists reversed, in the people order of the note: `write` reverses both.
		const listsOnly = write(false).replace(/parents: \[(.*)\]/g, (_, list: string) => `parents: [${list.split(/, (?=\{)/).reverse().join(', ')}]`);
		for (const src of [write(false), write(true), listsOnly]) expect(texts(src)).toEqual(['Begotten son']);
	});

	it('the same tree with every begetter link written as birth has the same names in both orders (so the fault is the begetter code)', () => {
		const asBirth = (s: string) => s.replace(/type: begetter/g, 'type: birth');
		expect(texts(asBirth(write(true)))).toEqual(texts(asBirth(write(false))));
	});
});

const RATIO_BIRTH = 5;
const RATIO_BEGETTER = 9;

describe('a huge parents list stays fast (spec §8)', () => {
	const big = (n: number, withBegetters: boolean): string => {
		const lines = ['people:'];
		for (let i = 0; i < n; i++) lines.push(`  - {id: a${i}, name: A${i}}`);
		const ids = Array.from({ length: n }, (_, i) => `a${i}`);
		const parents = [...ids, ...(withBegetters ? ids.map((id) => `{id: ${id}, type: begetter}`) : [])];
		lines.push(`  - {id: k, name: K, parents: [${parents.join(', ')}]}`);
		return lines.join(NL) + NL;
	};

	// The limits are ratios to the reference job (the decision notes "Timing tests"), not milliseconds: a busy machine slows both. Alone the best ratios are
	// 3.7 (birth parents) and 5.6 to 6.6 (begetters); the limits are 1.4 times that. The quadratic fault of 0.5.2 was 1 637 ms (ratio about 70), and 2 times
	// the code of today (ratio 7 and 12) also fails.
	speedTest(
		'40 000 birth parents of one person: the relation search is not quadratic (0.5.2: 90 ms)',
		() => {
			const g = graph(big(40000, false));
			const { ratio, ms, refMs } = timedRatio(() => computeRelations(g, 'a0'), 5);
			console.log(`relations of 40 000 parents: ${ms.toFixed(0)} ms, reference ${refMs.toFixed(1)} ms, ratio ${ratio.toFixed(2)}`);
			expect(ratio).toBeLessThan(RATIO_BIRTH);
		},
		120_000,
	);

	speedTest(
		'40 000 ids as birth parent and as begetter of one person: validation is not quadratic (0.5.2 without begetters: 75 ms)',
		() => {
			const r = parseDynasty(big(40000, true));
			if (!r.ok) throw new Error('parse');
			const { ratio, ms, refMs } = timedRatio(() => deriveFamilies(r.tree), 5);
			console.log(`validation of 40 000 begetters: ${ms.toFixed(0)} ms, reference ${refMs.toFixed(1)} ms, ratio ${ratio.toFixed(2)}`);
			expect(ratio).toBeLessThan(RATIO_BEGETTER);
		},
		120_000,
	);
});
