// A test whose pass or fail depends on the wall clock (0.3.3 A3, 0.3.1 clean-up assessment T2). It is a normal `it` with the tag `timing`, and
// vitest.config.ts gives that tag three retries, 1.5 s apart. A speed limit then fails only when the code is over the limit four times in a row, so one pause of a
// machine that runs 16 test files at once is not a failure, and a real slowdown still fails every time. The test body and its limits are not changed.
import { it } from 'vitest';

/** `it` for a test with a wall-clock limit. `timeout` is the test timeout in ms, as the third argument of `it`. */
export function speedTest(name: string, fn: () => unknown, timeout?: number): void {
	it(name, { tags: ['timing'], ...(timeout === undefined ? {} : { timeout }) }, fn);
}
