import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The slow tests (0.4, slim assessment T3). A file is here when one of its tests took over 4 s when all files ran at once (that is the
// "over 5 s" of the assessment on a quiet machine), when the file took over 20 s in all, or when its name says speed, timing or huge.
// `npm test` (G1 and CI) runs every other file; `npm run test:perf` runs these; `npx vitest run` runs both. Move a file into this list when it becomes slow.
// The choice is by file, so a file with one slow test takes its fast tests with it.
export const PERF_FILES = [
	'tests/acceptance/focus-subgraph.test.ts',
	'tests/acceptance/houses-ops.test.ts',
	'tests/acceptance/link-rewrite.test.ts',
	'tests/acceptance/m10-g5-saved.test.ts',
	'tests/acceptance/m11-review-speed.test.ts',
	'tests/view/dates43-speed.test.ts',
	'tests/layout/fuzz.test.ts',
	'tests/core/r05-g2-fuzz-order.test.ts',
	'tests/obsidian/g2-k-timing.test.ts',
	'tests/obsidian/g2b-k-timing.test.ts',
	'tests/view/names-render-speed.test.ts',
	'tests/core/parse-limits.test.ts',
	'tests/layout/r024-speed.test.ts',
	'tests/core/r026-rel-invariants.test.ts',
	'tests/core/r027-succession-speed.test.ts',
	'tests/render/r028-adv-huge.test.ts',
	'tests/render/r028-adv-trees.test.ts',
	'tests/render/r028-speed-repair.test.ts',
	'tests/core/r030-d-random-notes.test.ts',
	'tests/obsidian/r030-d-random-vault.test.ts',
	'tests/obsidian/r030-k-fix-timing.test.ts',
	'tests/obsidian/r030-k-timing.test.ts',
	'tests/core/r030-relations-scope.test.ts',
	'tests/obsidian/r04-t10-saved.test.ts',
	'tests/core/r112-review-a-fuzz-idops.test.ts',
	'tests/core/r112-review-a-missing-id-speed.test.ts',
	'tests/obsidian/r112-review-d-draft-fuzz.test.ts',
	'tests/obsidian/r113-review-c-me-matrix.test.ts',
	'tests/core/relations-timing.test.ts',
	'tests/core/relationship-ops-property.test.ts',
	'tests/core/review-d131-fuzz.test.ts',
	'tests/core/review-d131b-checks.test.ts',
	'tests/core/review-d131c-checks.test.ts',
	'tests/core/review-d131d-checks.test.ts',
	'tests/layout/review-m7-core.test.ts',
	'tests/layout/review-r028-layout-speed.test.ts',
	'tests/obsidian/review-r032-fix-round.test.ts',
	'tests/layout/s025-rows.test.ts',
	'tests/core/yaml-edit-property.test.ts',
];

// A name that is not a file would silently move nothing, so a wrong list stops here.
const missing = PERF_FILES.filter((file) => !existsSync(file));
if (missing.length > 0) throw new Error(`vitest.config.ts: PERF_FILES names files that do not exist: ${missing.join(', ')}`);

export default defineConfig({
	test: {
		// `window.setTimeout` in the plugin code needs a `window` in Node (see the file). Both projects inherit it (`extends: true`).
		setupFiles: ['tests/support/window-timers.ts', 'tests/support/common-mocks.ts'],
		// Many heavy tests take 2.5 to 5 s alone and failed only on the 5 s default when agents ran suites in parallel (steward W1, 0.3.2).
		testTimeout: 30_000,
		// A test with a wall-clock limit (tests/support/speed-test.ts) runs again, up to 3 times, 1.5 s apart, before it fails: a busy machine
		// (16 test files at once, or another agent's run) is slow for seconds, and the limits are meant for a quiet moment. A real slowdown fails every time.
		tags: [{ name: 'timing', retry: { count: 3, delay: 1500 } }],
		projects: [
			{ extends: true, test: { name: 'fast', include: ['tests/**/*.test.ts'], exclude: [...PERF_FILES] } },
			{ extends: true, test: { name: 'perf', include: [...PERF_FILES] } },
		],
	},
});
