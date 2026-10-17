/*
 * A fixed piece of plain JavaScript work, timed in the same process as a speed test. A test divides its own time by
 * this time, so the limit is a ratio: a busy machine slows both and the ratio stays, while a real slowdown of the code
 * under test raises it. The work uses strings, a Map, objects and a sort, like the parser and the relation search.
 */

/** One run of the reference work. The result is returned so that the engine cannot drop the work. */
function referenceWork(): number {
	const map = new Map<string, { i: number; s: string }>();
	for (let i = 0; i < 100_000; i++) map.set(`k${i}`, { i, s: `v${i}` });
	let sum = 0;
	for (let i = 0; i < 100_000; i += 3) sum += map.get(`k${i}`)!.s.length;
	const keys = [...map.keys()].sort();
	return sum + keys.length;
}

/** The time of one reference run in ms (best of `runs`), measured now. */
export function referenceMs(runs = 5): number {
	let best = Infinity;
	let keep = 0;
	for (let k = 0; k < runs; k++) {
		const t0 = performance.now();
		keep += referenceWork();
		best = Math.min(best, performance.now() - t0);
	}
	if (keep < 0) throw new Error('unreachable');
	return best;
}

/**
 * Times `fn` against the reference: `runs` pairs, each a reference time just before the call, and returns the best
 * ratio of the pairs (a pause of the machine during one pair does not count) with the times of that pair.
 */
export function timedRatio<T>(fn: () => T, runs: number): { ratio: number; ms: number; refMs: number; out: T } {
	let best = { ratio: Infinity, ms: 0, refMs: 0, out: undefined as T };
	for (let k = 0; k < runs; k++) {
		const refMs = referenceMs(3);
		const t0 = performance.now();
		const out = fn();
		const ms = performance.now() - t0;
		const ratio = ms / refMs;
		if (ratio < best.ratio) best = { ratio, ms, refMs, out };
	}
	return best;
}
