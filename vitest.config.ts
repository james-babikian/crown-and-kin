import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The slow tests (0.4, slim assessment T3). A file is here when one of its tests took over 4 s when all files ran at once (that is the
// "over 5 s" of the assessment on a quiet machine), when the file took over 20 s in all, or when its name says speed, timing or huge.
// `npm test` (G1 and CI) runs every other file; `npm run test:perf` runs these; `npx vitest run` runs both. Move a file into this list when it becomes slow.
// The choice is by file, so a file with one slow test takes its fast tests with it.
export const PERF_FILES = [
	'tests/obsidian/window-link-under-last-field.test.ts',
	'tests/obsidian/phone-list-arrival-order.test.ts',
	'tests/acceptance/focus-subgraph.test.ts',
	'tests/acceptance/houses-ops.test.ts',
	'tests/acceptance/link-rewrite.test.ts',
	'tests/acceptance/saved-picture-three-name-lines.test.ts',
	'tests/acceptance/view-no-empty-cards-while-zooming.test.ts',
	'tests/view/dates43-speed.test.ts',
	'tests/layout/fuzz.test.ts',
	'tests/core/years-name-order-fuzz.test.ts',
	'tests/obsidian/open-timing-closed-view.test.ts',
	'tests/obsidian/open-timing-replaced-view.test.ts',
	'tests/view/names-render-speed.test.ts',
	'tests/core/parse-limits.test.ts',
	'tests/layout/row-dots-cost.test.ts',
	'tests/core/relation-invariants-random-trees.test.ts',
	'tests/core/succession-line-speed.test.ts',
	'tests/render/huge-notes.test.ts',
	'tests/render/generated-trees-pipeline.test.ts',
	'tests/render/compact-name-sizes.test.ts',
	'tests/core/random-notes-block-write.test.ts',
	'tests/obsidian/rename-kind-random-vault.test.ts',
	'tests/obsidian/render-timing-opens.test.ts',
	'tests/obsidian/render-timing-user-wait.test.ts',
	'tests/core/relation-lookup.test.ts',
	'tests/obsidian/saved-picture-narrow-script-names.test.ts',
	'tests/core/id-ops-mutated-trees.test.ts',
	'tests/core/missing-id-speed.test.ts',
	'tests/obsidian/houses-draft-accepted-never-refused.test.ts',
	'tests/obsidian/first-view-mark-matrix.test.ts',
	'tests/core/relations-timing.test.ts',
	'tests/core/relationship-ops-property.test.ts',
	'tests/layout/rumoured-parent-every-person-speed.test.ts',
	'tests/obsidian/error-line-after-in-place-change.test.ts',
	'tests/layout/lone-rumoured-parent-rows.test.ts',
	'tests/core/yaml-edit-property.test.ts',
	'tests/core/relations-random-sweep.test.ts',
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
