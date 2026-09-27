import { describe, expect, it } from 'vitest';
import { routeEdges } from '../src/layout/edges';
import { NORMAL_GEOMETRY } from '../src/layout/geometry';
import { layoutFamilies } from '../src/layout/layout';
import type { FarCoupleRule } from '../src/layout/model';
import { build } from './helpers';
import { lineProblems, randomTree } from './random-trees';

// RANDOM_TREES=5000 npm test runs a longer search.
const TREES = Number(process.env.RANDOM_TREES ?? 400);

const RULES: [string, FarCoupleRule][] = [
	['spec default', { maxCardWidths: 3, maxGenerations: 1 }],
	['loose', { maxCardWidths: Infinity, maxGenerations: Infinity }],
];

describe('random trees: no line behind a card, no line shared by two families', () => {
	for (const [label, far] of RULES) {
		it(label, () => {
			const failures: string[] = [];
			for (let seed = 1; seed <= TREES; seed++) {
				const src = randomTree(seed);
				const { g, gen, order } = build(src);
				const layout = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far });
				const problems = lineProblems(g, layout, routeEdges(g, layout, order.anchors));
				if (problems.length) failures.push(`seed ${seed}: ${problems[0]} (+${problems.length - 1})`);
			}
			expect(failures.slice(0, 10), `${failures.length} of ${TREES} trees`).toEqual([]);
		});
	}
});
