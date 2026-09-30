import { describe, expect, it } from 'vitest';
import { computeRelations } from '../src/core/relations';
import { build, fixture } from './helpers';

// The hard timing test of spec §13.1 ("fixture 7 under 20 ms on the computer"): every person of
// fixture 7 in turn as the marked person, after a warm-up pass. It fails if the median is 20 ms or
// more, or if one mark takes 60 ms or more. The limits hold on the development computer; the soft
// check in tests/acceptance/relations.test.ts only logs its time.

/**
 * A mark over the limit is timed again, at most this many times, and keeps its best time: other
 * test files run at the same time, and one pause of the machine is not a slow mark.
 */
const RETRIES = 2;
const MEDIAN_LIMIT = 20;
const MAX_LIMIT = 60;

describe('computeRelations timing (spec §13.1)', () => {
	it(`fixture 7, every person marked: median under ${MEDIAN_LIMIT} ms, slowest under ${MAX_LIMIT} ms (warm)`, () => {
		const { g } = build(fixture('07'));
		const ids = g.people.map((p) => p.id);
		for (const me of ids) computeRelations(g, me);
		const times: number[] = [];
		let slowest = { id: '', ms: 0 };
		for (const me of ids) {
			let ms = timeOf(() => computeRelations(g, me));
			for (let k = 0; k < RETRIES && ms >= MAX_LIMIT; k++) ms = Math.min(ms, timeOf(() => computeRelations(g, me)));
			times.push(ms);
			if (ms > slowest.ms) slowest = { id: me, ms };
		}
		const sorted = [...times].sort((a, b) => a - b);
		const median = sorted[Math.floor(sorted.length / 2)];
		const mean = times.reduce((a, b) => a + b, 0) / times.length;
		console.log(
			`computeRelations, fixture 7, ${ids.length} marks: median ${median.toFixed(2)} ms, mean ${mean.toFixed(2)} ms, slowest ${slowest.ms.toFixed(2)} ms (${slowest.id}); limits ${MEDIAN_LIMIT} / ${MAX_LIMIT} ms`,
		);
		expect(ids.length).toBeGreaterThan(300);
		expect(median).toBeLessThan(MEDIAN_LIMIT);
		expect(slowest.ms).toBeLessThan(MAX_LIMIT);
	}, 60_000);
});

function timeOf(run: () => unknown): number {
	const t = performance.now();
	run();
	return performance.now() - t;
}
