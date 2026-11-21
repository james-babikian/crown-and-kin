// The fixed ceiling for main.js (D376 (c)): the check passes today, a total above the ceiling fails, and --write-budget cannot raise it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { CEILING, LAYERS, measure, nextBudget, overBudget, overCeiling } from '../../scripts/size.mjs';

type Sizes = Record<string, number>;
const budget = JSON.parse(readFileSync('scripts/size-budget.json', 'utf8')) as Sizes;

/** A copy of the sizes with a total of the given bytes. */
function withTotal(sizes: Sizes, total: number): Sizes {
	return { ...sizes, total };
}

describe('size ceiling', () => {
	it('is 1,400,000 bytes, and passes today', async () => {
		expect(CEILING).toBe(1_400_000);
		const sizes: Sizes = await measure();
		expect(overCeiling(sizes)).toEqual([]);
		expect(overBudget(sizes, budget)).toEqual([]);
	});

	it('fails a total above the ceiling, even when the budget file allows it', () => {
		const sizes = withTotal(budget, CEILING + 1);
		const problems: string[] = overCeiling(sizes);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('fixed');
		expect(problems[0]).toContain('owner');
		expect(overCeiling(withTotal(budget, CEILING))).toEqual([]);
		expect(overBudget(sizes, { ...budget, total: CEILING + 100 })).toEqual([]);
	});

	it('--write-budget cannot raise the budget past the ceiling', () => {
		// 5 % on top of a total just below the ceiling would pass it.
		const nearly = withTotal(budget, Math.floor(CEILING / 1.05) + 1000);
		expect(() => nextBudget(nearly)).toThrow(/fixed ceiling/);
		// The layer budgets alone can pass it while the total does not.
		const layers: Sizes = { ...budget, total: 1000 };
		for (const name of LAYERS as string[]) layers[name] = Math.floor(CEILING / 5);
		expect(() => nextBudget(layers)).toThrow(/fixed ceiling/);
		// A size well inside the ceiling still gets a budget, and the result has no ceiling key.
		const ok = nextBudget(withTotal(budget, 1_000_000));
		expect(ok.total).toBeLessThanOrEqual(CEILING);
		expect(Object.keys(ok)).not.toContain('ceiling');
	});
});
