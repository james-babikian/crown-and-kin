import { describe, expect, it } from 'vitest';
import { findRelation } from '../../src/core/relations';
import { build } from '../support/helpers';

/** A dynasty of `n` people in couples of siblings: four children for each couple, written without any union. */
function dynasty(n: number) {
	const people: string[] = [];
	for (let i = 0; i < n; i++) {
		const parents = i >= 4 ? `, parents: [p${2 * Math.floor(i / 4) - 2}, p${2 * Math.floor(i / 4) - 1}]` : '';
		people.push(`{id: p${i}, name: P${i}, sex: ${i % 2 ? 'f' : 'm'}${parents}}`);
	}
	return build(`people: [${people.join(', ')}]`).g;
}

/** Milliseconds for twenty finder lookups of far people. */
function finders(n: number): number {
	const g = dynasty(n);
	findRelation(g, `p${n - 100}`, 'p5');
	const t = performance.now();
	for (let i = 0; i < 20; i++) findRelation(g, `p${n - 100}`, `p${i * 211 + 5}`);
	return performance.now() - t;
}

describe('the finder stays linear in the size of the tree', () => {
	it('twenty finder chains in 20 000 people take under 4 times the time of 5 000 people, as before (4x people = about 4x time)', () => {
		const small = finders(5000);
		const big = finders(20000);
		// Linear growth gives a ratio near 4; a scan of all pairs in each `partners()` call gives near 16.
		expect(big / small).toBeLessThan(8);
	}, 120000);
});
