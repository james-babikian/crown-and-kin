import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/*
 * G2 review of 0.4 (scratch). The scripts start their work only when
 * `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`. Node gives `import.meta.url` of the main file as its REAL path
 * (symlinks and junctions resolved), but `process.argv[1]` is not resolved. Through a symlink or a junction the test is false:
 * the script ends with exit code 0 and does nothing, so `release-check.mjs` passes every tag.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r04-g2-'));
const link = path.join(dir, 'repo');
fs.symlinkSync(ROOT, link, 'junction');
afterAll(() => {
	fs.rmSync(link, { recursive: true, force: true });
	fs.rmSync(dir, { recursive: true, force: true });
});

const run = (cwd: string, script: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

describe('G2: scripts reached through a symlink or junction', () => {
	it('release-check rejects a bad tag in the real folder (control)', () => {
		expect(run(ROOT, 'scripts/release-check.mjs', 'v9').status).toBe(1);
	});

	it('release-check rejects a bad tag when the folder is reached through a junction', () => {
		const r = run(link, 'scripts/release-check.mjs', 'v9');
		expect({ status: r.status, stderr: r.stderr }).toMatchObject({ status: 1 });
	});

	it('version-bump without a version stops with an error through a junction', () => {
		expect(run(link, 'scripts/version-bump.mjs').status).toBe(1);
	});

	it('size --check prints its table through a junction', () => {
		expect(run(link, 'scripts/size.mjs', '--check').stdout).toContain('layer');
	});
});
