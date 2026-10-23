import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCases, type CaseResult } from '../support/hostile-cases';
import { LIMIT_DETAIL } from '../../src/core/messages';

/*
 * Spec §8 and the release plan W4: a bad or huge tree text must not hang, throw or blank the note. Hostile texts: alias
 * bombs, values of 100 000 characters, blocks with 10 000 keys and deeply nested flow collections
 * (`tests/support/hostile-cases.ts`). Each case goes through locate, parse, derive, layout, relations and one edit
 * through the write plan.
 *
 * Every case must:
 *   - not throw (the pipeline reports no exception),
 *   - end within CASE_LIMIT_MS = 10 s (the child process is killed at the limit, and the case fails and is named),
 *   - leave the note text as it was (a write keeps every byte outside the body; a refused edit writes nothing),
 *   - read as the case says: a bomb is a hard error; a plain block of many keys parses.
 *
 * The cases run in child processes, because a hang in the test process itself could not be stopped. After a hang
 * the next child starts with the cases that are left. No case is a known finding: F1 to F3 were fixed in WP-H2, and since 0.4 (D286)
 * the test has no `it.fails` and the cases have no `finding` mark. A new case that does not end in time is a failing test: fix the fault,
 * or pin the result of today and record the limit.
 *
 * About the alias limit: the plugin does not keep the library's default `maxAliasCount` of 100. `parseBody` passes
 * `max(100, length of the text)`, so a large tree can use `house: *h` for every person (the decision notes: review 101-a,
 * ruling 3). The limit is the length of the text. The library counts the product of the uses along a chain of
 * aliases, so a deep bomb (the classic one) is a hard error; a wide bomb (one list used by many lists) is not.
 */

/** The time one case may take, with the child process under the load of a parallel test run. */
const CASE_LIMIT_MS = 10_000;

const cases = buildCases();
const results = new Map<number, CaseResult>();
const hung = new Set<number>();
let childFailure = '';

/** Runs the child over `indices`; a case that does not end within the limit is killed, named, and the child starts again with the rest. */
async function runChild(indices: number[]): Promise<void> {
	let todo = indices;
	while (todo.length) {
		const stopped = await new Promise<number | null>((resolve) => {
			const child = spawn(process.execPath, ['--import', 'tsx', join(__dirname, '..', 'support', 'hostile-child.ts'), todo.join(',')], { stdio: ['ignore', 'pipe', 'pipe'] });
			let buffer = '';
			let stderr = '';
			let timer: NodeJS.Timeout | null = null;
			let current: number | null = null;
			let killed = false;
			child.stdout.on('data', (chunk: Buffer) => {
				buffer += chunk.toString();
				let at: number;
				while ((at = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, at);
					buffer = buffer.slice(at + 1);
					if (line.startsWith('START ')) {
						current = Number(line.slice(6));
						if (timer) clearTimeout(timer);
						timer = setTimeout(() => {
							killed = true;
							hung.add(current!);
							child.kill('SIGKILL');
						}, CASE_LIMIT_MS);
					} else if (line.startsWith('END ')) {
						if (timer) clearTimeout(timer);
						const r = JSON.parse(line.slice(4)) as CaseResult & { index: number };
						results.set(r.index, r);
						current = null;
					}
				}
			});
			child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
			child.on('close', (code) => {
				if (timer) clearTimeout(timer);
				if (!killed && code !== 0) childFailure += `the child process ended with code ${code}: ${stderr.slice(0, 400)} `;
				resolve(killed ? current : null);
			});
		});
		if (stopped === null) return;
		const at = todo.indexOf(stopped);
		todo = todo.slice(at + 1);
	}
}

const all = cases.map((_, i) => i);

describe('hostile tree texts (spec §8, the release plan W4)', () => {
	beforeAll(() => runChild(all), 10 * 60_000);

	it('the child processes ran every case', () => {
		expect(childFailure).toBe('');
		const missing = all.filter((i) => !results.has(i) && !hung.has(i));
		expect(missing.map((i) => cases[i].name)).toEqual([]);
	});

	/** The assertions of one case. */
	const check = (index: number) => {
		const c = cases[index];
		const r = results.get(index);
		if (!r) throw new Error(hung.has(index) ? `did not end within ${CASE_LIMIT_MS} ms` : 'the child process gave no result for this case');
		expect(r.threw, 'no exception').toBeNull();
		// F3: the engine's own text for a nesting that is too deep must not reach the box.
		expect(r.detail, 'no raw engine text in the box').not.toMatch(/call stack/i);
		expect(r.ms, `time of the case in ms (limit ${CASE_LIMIT_MS})`).toBeLessThan(CASE_LIMIT_MS);
		expect(r.noteSame, 'a write keeps every byte outside the body').toBe(true);
		if (c.expect === 'error') {
			expect(r.read, 'a hard error').toMatch(/^error:/);
			expect(r.detail.length, 'the error has a text').toBeGreaterThan(0);
		} else if (c.expect === 'ok') {
			expect(r.read).toBe('ok');
		}
	};

	for (const i of all) it(cases[i].name, () => check(i));

	it('the classic alias bomb is stopped by the alias limit and says the tree text is too large', () => {
		const r = results.get(cases.findIndex((c) => c.name === 'alias bomb, classic, 9 levels of 9'));
		expect(r?.read).toBe('error:yaml-invalid');
		// The child process sends only the start of the detail.
		expect(LIMIT_DETAIL.tooLarge.startsWith(r?.detail ?? '-')).toBe(true);
		expect(r?.detail?.length).toBeGreaterThan(40);
	});

	it('many aliases of one small value (a large tree) are still allowed', () => {
		const r = results.get(cases.findIndex((c) => c.name.startsWith('aliases of one small value in 400 people')));
		expect(r?.read).toBe('ok');
	});
});
