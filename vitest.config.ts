import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The test projects. `npm test` (G1 and CI) runs `fast` and `browser`. The heavy files are split by what a failure means (D369):
// - `slow` holds the heavy files that check a value: goldens, fuzz, acceptance, data-safety properties, sweeps. A failure is a fault.
//   G1 runs the slow files that import a changed file (an internal script); `npm run test:slow` runs them all.
// - `timing` holds the files whose purpose is a time: a wall-clock limit or a ratio of two times. A failure on a busy machine can be load.
// A test with the tag `timing` (`speedTest`, tests/support/speed-test.ts) inside a slow file runs in the timing run, never in the slow run
// (`timing-tagged`), so a slow run never fails on the clock. `npm run test:perf` and `npm run test:all` run every project.
// A file goes into one of the two lists when one of its tests took over 4 s when all files ran at once, when the file took over 20 s in all,
// or when its name says speed, timing or huge. The choice is by file. Each group below has a comment line with its reason.
/** The heavy files that check a value, not a time (the `slow` and `slow-browser` projects). */
export const SLOW_FILES = [
	// Acceptance tests from the spec: behaviour, words and pictures of whole features.
	'tests/acceptance/focus-subgraph.test.ts',
	'tests/acceptance/houses-ops.test.ts',
	'tests/acceptance/link-rewrite.test.ts',
	'tests/acceptance/saved-picture-three-name-lines.test.ts',
	'tests/acceptance/view-no-empty-cards-while-zooming.test.ts',
	// Layout: hard faults, invariants and fixed layouts on the sample trees, hand cases and random trees.
	'tests/layout/fuzz.test.ts',
	// Layout with picture hashes or fixed rows; their few speed tests carry the tag `timing`.
	'tests/layout/lone-rumoured-parent-rows.test.ts',
	'tests/layout/row-dots-cost.test.ts',
	// Drawn values: sign and name sizes, the kept place of an edited card, the saved picture, the picker rows, the census sheets.
	'tests/render/compact-name-sizes.test.ts',
	'tests/obsidian/saved-picture-narrow-script-names.test.ts',
	// Relation words: oracles, order independence and sweeps on generated trees; the cache of a huge tree counts entries.
	'tests/core/years-name-order-fuzz.test.ts',
	'tests/core/relation-invariants-random-trees.test.ts',
	'tests/core/relation-lookup.test.ts',
	'tests/core/relations-random-sweep.test.ts',
	// Data safety: random notes, edits, renames and ids keep every text line; the read limits and huge notes never throw.
	'tests/core/random-notes-block-write.test.ts',
	'tests/core/relationship-ops-property.test.ts',
	'tests/core/yaml-edit-property.test.ts',
	'tests/core/id-ops-mutated-trees.test.ts',
	'tests/obsidian/rename-kind-random-vault.test.ts',
	'tests/obsidian/houses-draft-accepted-never-refused.test.ts',
	'tests/core/parse-limits.test.ts',
	'tests/render/huge-notes.test.ts',
	// Whole pipeline and succession on generated trees: no throw, determinism, the words of the spec.
	'tests/render/generated-trees-pipeline.test.ts',
	// The view with a fake host and a fake clock: render timing reports, the first view, the error line (values, not the wall clock).
	'tests/obsidian/open-timing-closed-view.test.ts',
	'tests/obsidian/open-timing-replaced-view.test.ts',
	'tests/obsidian/render-timing-opens.test.ts',
	'tests/obsidian/render-timing-user-wait.test.ts',
	'tests/obsidian/first-view-mark-matrix.test.ts',
	'tests/obsidian/relation-view-first-view-sweep.test.ts',
	'tests/obsidian/error-line-after-in-place-change.test.ts',
	// A real browser: the boxes of the window link (also in BROWSER_FILES).
	'tests/obsidian/window-link-under-last-field.test.ts',
];

/** The heavy files whose purpose is a time (the `timing` and `timing-browser` projects). */
export const TIMING_FILES = [
	// A wall-clock limit or a ratio of two times in a plain `it` (no tag), so the whole file is a timing file.
	'tests/core/finder-partner-index-speed.test.ts',
	// Real waits of 80 ms jobs: the arrival times of the pictures are measured on the clock.
	'tests/obsidian/phone-list-arrival-order.test.ts',
	// Every test is a `speedTest`: speed limits and growth ratios.
	'tests/view/dates43-speed.test.ts',
	'tests/view/names-render-speed.test.ts',
	'tests/core/succession-line-speed.test.ts',
	'tests/core/missing-id-speed.test.ts',
	'tests/core/relations-timing.test.ts',
	'tests/layout/rumoured-parent-every-person-speed.test.ts',
	// A real browser: the cost of the font of a saved picture (also in BROWSER_FILES).
];

/** Every heavy file: the slow files and the timing files. */
export const PERF_FILES = [...SLOW_FILES, ...TIMING_FILES];

// The browser tests: every file that starts a real browser (Chrome through puppeteer-core, WebKit through playwright). Started together on a busy
// machine, their browsers are slow to start and some files time out in `afterAll`. So these files run one at a time in a project of their own
// (`fileParallelism: false`), next to the other tests of `npm test`. A test checks that every file that starts a browser is in this list.
export const BROWSER_FILES = [
	'tests/obsidian/calendar-eras-box-chrome.test.ts',
	'tests/obsidian/calendar-hint-no-lost-press-chrome.test.ts',
	'tests/obsidian/full-screen-bar-badge-narrow.test.ts',
	'tests/obsidian/head-house-long-name-wraps.test.ts',
	'tests/obsidian/legend-begetter-sample-colour.test.ts',
	'tests/obsidian/new-person-name-placeholder-fits.test.ts',
	'tests/obsidian/problem-panel-in-note.test.ts',
	'tests/obsidian/succession-bar-phone-wraps.test.ts',
	'tests/obsidian/window-link-under-last-field.test.ts',
];

// A name that is not a file would silently move nothing, and a file in both lists would run twice, so a wrong list stops here.
const missing = [...PERF_FILES, ...BROWSER_FILES].filter((file) => !existsSync(file));
if (missing.length > 0) throw new Error(`vitest.config.ts: SLOW_FILES, TIMING_FILES or BROWSER_FILES names files that do not exist: ${missing.join(', ')}`);
const twice = SLOW_FILES.filter((file) => TIMING_FILES.includes(file));
if (twice.length > 0) throw new Error(`vitest.config.ts: these files are in SLOW_FILES and in TIMING_FILES: ${twice.join(', ')}`);

/** True when a test file has a test with the tag `timing` (`speedTest`, or the tag written by hand). */
export function hasTimingTag(text: string): boolean {
	return /\bspeedTest\(|\btags:\s*\[[^\]]*'timing'/.test(text);
}

// A browser file that is also heavy keeps its place in the heavy run, in a project that also runs one file at a time.
const isBrowser = (file: string): boolean => BROWSER_FILES.includes(file);
const SLOW_ONLY_FILES = SLOW_FILES.filter((file) => !isBrowser(file));
const SLOW_BROWSER_FILES = SLOW_FILES.filter(isBrowser);
const TIMING_ONLY_FILES = TIMING_FILES.filter((file) => !isBrowser(file));
const TIMING_BROWSER_FILES = TIMING_FILES.filter(isBrowser);
const FAST_BROWSER_FILES = BROWSER_FILES.filter((file) => !PERF_FILES.includes(file));
// The timing tests inside slow files. A slow browser file with such a test would need a browser project of its own, so it stops here.
const SLOW_TIMED_FILES = SLOW_FILES.filter((file) => hasTimingTag(readFileSync(file, 'utf8')));
const timedBrowser = SLOW_TIMED_FILES.filter(isBrowser);
if (timedBrowser.length > 0) throw new Error(`vitest.config.ts: a slow browser file has a timing test; move it to TIMING_FILES: ${timedBrowser.join(', ')}`);

// `tagsFilter` is a project option in this vitest (it is applied per project); the type of a project does not list it.
const onlyTag = (filter: string): Record<string, unknown> => ({ tagsFilter: [filter] });

export default defineConfig({
	// The study switches of move-layer.ts are on in tests, as in the harness and the study build (see harness-flag.d.ts).
	define: { __DYNASTY_SWITCHES__: 'true' },
	test: {
		// `window.setTimeout` in the plugin code needs a `window` in Node (see the file). All projects inherit it (`extends: true`).
		setupFiles: ['tests/support/window-timers.ts', 'tests/support/common-mocks.ts'],
		// Many heavy tests take 2.5 to 5 s alone and failed only on the 5 s default when agents ran suites in parallel (steward W1, 0.3.2).
		testTimeout: 30_000,
		// A test with a wall-clock limit (tests/support/speed-test.ts) runs again, up to 3 times, 1.5 s apart, before it fails: a busy machine
		// (16 test files at once, or another agent's run) is slow for seconds, and the limits are meant for a quiet moment. A real slowdown fails every time.
		tags: [{ name: 'timing', retry: { count: 3, delay: 1500 } }],
		projects: [
			{ extends: true, test: { name: 'fast', include: ['tests/**/*.test.ts'], exclude: [...PERF_FILES, ...BROWSER_FILES] } },
			{ extends: true, test: { name: 'browser', include: FAST_BROWSER_FILES, fileParallelism: false } },
			{ extends: true, test: { name: 'slow', include: [...SLOW_ONLY_FILES], ...onlyTag('!timing') } },
			{ extends: true, test: { name: 'slow-browser', include: SLOW_BROWSER_FILES, fileParallelism: false, ...onlyTag('!timing') } },
			{ extends: true, test: { name: 'timing', include: TIMING_ONLY_FILES } },
			{ extends: true, test: { name: 'timing-browser', include: TIMING_BROWSER_FILES, fileParallelism: false } },
			{ extends: true, test: { name: 'timing-tagged', include: SLOW_TIMED_FILES, ...onlyTag('timing') } },
		],
	},
});
