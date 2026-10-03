import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../src/core/parse';

// Review round, area A (core), 1.1.2. Finding 1: the "has no id" example of a person (D104,
// spec §13.17 rule 1) is made by `nextPersonId`, which walks every id in `taken`. The reader calls
// it once for each person with no id, and each example is added to `taken`, so reading a tree with
// N people that have no id costs N * N steps. On `main` (1.1.1) the same read is linear.

const noIds = (n: number) => 'people:\n' + Array.from({ length: n }, (_, i) => `  - name: Person ${i}`).join('\n') + '\n';

describe('reading people with no id stays linear (spec §7.7, §8)', () => {
	it('20 000 people with no id are read in under 3 s (main: about 0.2 s; 1.1.2 head: about 7 s)', () => {
		parseDynasty(noIds(500)); // warm up
		const body = noIds(20000);
		const t0 = performance.now();
		const r = parseDynasty(body);
		const ms = performance.now() - t0;
		expect(r.ok).toBe(true);
		expect(ms).toBeLessThan(3000);
	}, 60000);

	it('four times the people does not take sixteen times as long (linear, not quadratic)', () => {
		const time = (n: number) => {
			const body = noIds(n);
			const t0 = performance.now();
			parseDynasty(body);
			return performance.now() - t0;
		};
		time(500); // warm up
		const small = Math.min(time(6000), time(6000));
		const large = Math.min(time(24000), time(24000));
		// 6000 to 24000 is four times the people: linear gives about 4, quadratic about 16. 9 is the middle.
		expect(large / small).toBeLessThan(9);
	}, 120000);
});
