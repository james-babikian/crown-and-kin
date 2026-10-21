import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// Many heavy tests take 2.5 to 5 s alone and failed only on the 5 s default when agents ran suites in parallel (steward W1, 0.3.2).
		testTimeout: 30_000,
	},
});
