// The split of the heavy test files into `slow` (values) and `timing` (times), D369. A slow run must never fail on the clock, a timing run must
// hold every wall-clock test of the heavy files, and each heavy test must run exactly once in `npm run test:all`. The last test proves that this
// vitest applies a `tagsFilter` written in a project, which the split needs and the type of a project does not promise.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { BROWSER_FILES, hasTimingTag, PERF_FILES, SLOW_FILES, TIMING_FILES } from '../../vitest.config';

type Project = { test?: { name?: string; include?: string[]; exclude?: string[]; tagsFilter?: string[] } };
const projects = (config.test?.projects ?? []) as Project[];
const project = (name: string): Project['test'] => projects.find((p) => p.test?.name === name)?.test;
const read = (file: string): string => readFileSync(file, 'utf8');

describe('the slow and timing projects', () => {
	it('has every heavy file in one list only, and the projects of today', () => {
		expect(new Set(PERF_FILES).size).toBe(PERF_FILES.length);
		expect(SLOW_FILES.filter((f) => TIMING_FILES.includes(f))).toEqual([]);
		expect(projects.map((p) => p.test?.name)).toEqual(['fast', 'browser', 'slow', 'slow-browser', 'timing', 'timing-browser', 'timing-tagged']);
	});

	it('runs no test with the tag `timing` in the slow run, and only such tests in the timing-tagged run', () => {
		expect(project('slow')?.tagsFilter).toEqual(['!timing']);
		expect(project('slow-browser')?.tagsFilter).toEqual(['!timing']);
		expect(project('timing-tagged')?.tagsFilter).toEqual(['timing']);
		expect(project('timing')?.tagsFilter).toBeUndefined();
	});

	it('gives the timing-tagged run exactly the slow files that have a timing test', () => {
		const tagged = SLOW_FILES.filter((f) => !BROWSER_FILES.includes(f) && hasTimingTag(read(f)));
		expect(project('timing-tagged')?.include).toEqual(tagged);
		// A floor that holds in the private set and in the public set (5 files there): the split must not shrink to a few files.
		expect(tagged.length).toBeGreaterThanOrEqual(5);
	});

	it('keeps every timing file a file about time: a speedTest, a clock read, or the time of a helper (`.ms`)', () => {
		for (const f of TIMING_FILES) expect(/\bspeedTest\(|performance\.now\(|Date\.now\(|setTimeout\(|\.ms\b/.test(read(f)), f).toBe(true);
	});

	it('finds the tag in a speedTest and in a tag written by hand, and not in a describe named "timing"', () => {
		expect(hasTimingTag("speedTest('x', () => {});")).toBe(true);
		expect(hasTimingTag("it('x', { tags: ['timing'] }, () => {});")).toBe(true);
		expect(hasTimingTag("describe.skipIf(!process.env.REVIEW_PERF)('timing', () => {});")).toBe(false);
	});

	it('leaves the heavy files out of the fast run', () => {
		const excluded = project('fast')?.exclude ?? [];
		for (const f of PERF_FILES) expect(excluded, f).toContain(f);
	});

	it('this vitest applies a tagsFilter written in a project (a run of two small projects)', { timeout: 120_000 }, () => {
		const dir = path.join('out', 'tag-filter-probe');
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		try {
			writeFileSync(path.join(dir, 'probe.test.ts'), "import { it } from 'vitest';\nit('plain', () => {});\nit('timed', { tags: ['timing'] }, () => {});\n");
			writeFileSync(
				path.join(dir, 'probe.config.ts'),
				[
					"import { defineConfig } from 'vitest/config';",
					'export default defineConfig({ test: { tags: [{ name: "timing" }], projects: [',
					"\t{ extends: true, test: { name: 'values', include: ['probe.test.ts'], tagsFilter: ['!timing'] } as never },",
					"\t{ extends: true, test: { name: 'times', include: ['probe.test.ts'], tagsFilter: ['timing'] } as never },",
					'] } });',
					'',
				].join('\n'),
			);
			const vitest = path.resolve('node_modules', 'vitest', 'vitest.mjs');
			const res = spawnSync(process.execPath, [vitest, 'run', '--config', 'probe.config.ts', '--root', '.', '--reporter', 'json', '--outputFile', 'result.json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
			expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
			const result = JSON.parse(read(path.join(dir, 'result.json'))) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
			const ran = result.testResults.flatMap((r) => r.assertionResults.filter((a) => a.status === 'passed').map((a) => a.title)).sort();
			// Without the project filters both tests would run in both projects (four passes).
			expect(ran).toEqual(['plain', 'timed']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
