import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// Many heavy tests take 2.5 to 5 s alone and failed only on the 5 s default when agents ran suites in parallel (steward W1, 0.3.2).
		testTimeout: 30_000,
		// A test with a wall-clock limit (tests/support/speed-test.ts) runs again, up to 3 times, 1.5 s apart, before it fails: a busy machine
		// (16 test files at once, or another agent's run) is slow for seconds, and the limits are meant for a quiet moment. A real slowdown fails every time.
		tags: [{ name: 'timing', retry: { count: 3, delay: 1500 } }],
	},
});
