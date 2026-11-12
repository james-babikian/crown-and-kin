// Test files that start a real browser run one file at a time, in projects of their own. Six agents once ran them together and four or five files
// timed out in `afterAll`. A new browser test that is not in BROWSER_FILES would run beside the others again, so this test finds it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { BROWSER_FILES, PERF_FILES } from '../../vitest.config';

const LAUNCH = /\b(?:puppeteer|webkit|chromium|firefox)\.launch\(/;

function testFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = `${dir}/${e.name}`;
		if (e.isDirectory()) return testFiles(p);
		return e.name.endsWith('.test.ts') ? [p] : [];
	});
}

type Project = { test?: { name?: string; include?: string[]; exclude?: string[]; fileParallelism?: boolean } };
const projects = (config.test?.projects ?? []) as Project[];
const project = (name: string): Project | undefined => projects.find((p) => p.test?.name === name);

describe('the browser tests run one file at a time', () => {
	it('lists every test file that starts a browser', () => {
		const launching = testFiles('tests').filter((f) => LAUNCH.test(readFileSync(f, 'utf8')));
		expect(launching.length).toBeGreaterThan(5);
		expect(launching.filter((f) => !BROWSER_FILES.includes(f))).toEqual([]);
	});

	it('lists no file twice and no file that does not start a browser', () => {
		expect(new Set(BROWSER_FILES).size).toBe(BROWSER_FILES.length);
		const notLaunching = BROWSER_FILES.filter((f) => !LAUNCH.test(readFileSync(f, 'utf8')));
		expect(notLaunching).toEqual([]);
	});

	it('runs the browser projects with fileParallelism off', () => {
		for (const name of ['browser', 'perf-browser']) {
			expect(project(name)?.test?.fileParallelism, name).toBe(false);
		}
	});

	it('gives each browser file to exactly one project, and keeps the slow ones in the slow run', () => {
		const fast = project('browser')?.test?.include ?? [];
		const slow = project('perf-browser')?.test?.include ?? [];
		expect([...fast, ...slow].sort()).toEqual([...BROWSER_FILES].sort());
		expect(slow.every((f) => PERF_FILES.includes(f))).toBe(true);
		expect(fast.some((f) => PERF_FILES.includes(f))).toBe(false);
		const excluded = project('fast')?.test?.exclude ?? [];
		for (const f of BROWSER_FILES) expect(excluded, f).toContain(f);
		const perfInclude = project('perf')?.test?.include ?? [];
		for (const f of BROWSER_FILES) expect(perfInclude, f).not.toContain(f);
	});

	it('is part of npm test (the fast and browser projects) and of npm run test:perf', () => {
		const pkg = JSON.parse(readFileSync(join('package.json'), 'utf8')) as { scripts: Record<string, string> };
		expect(pkg.scripts.test).toBe('vitest run --project fast --project browser');
		expect(pkg.scripts['test:perf']).toBe('vitest run --project perf --project perf-browser');
	});
});
