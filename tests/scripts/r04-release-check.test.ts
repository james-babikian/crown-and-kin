import { describe, expect, it } from 'vitest';
import { releaseProblems } from '../../scripts/release-check.mjs';

const manifest = { version: '0.4.0', minAppVersion: '1.11.0' };
const pkg = { version: '0.4.0' };
const versions = { '0.4.0': '1.11.0' };
const lock = { version: '0.4.0', packages: { '': { version: '0.4.0' } } };

describe('release-check', () => {
	it('accepts a tag that all the files carry', () => {
		expect(releaseProblems('0.4.0', manifest, pkg, versions, lock)).toEqual([]);
	});

	it('names package-lock.json when its top version is old', () => {
		const problems = releaseProblems('0.4.0', manifest, pkg, versions, { ...lock, version: '0.3.3' });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('package-lock.json has version 0.3.3');
	});

	it('names the root package of package-lock.json when its version is old', () => {
		const problems = releaseProblems('0.4.0', manifest, pkg, versions, { ...lock, packages: { '': { version: '0.3.3' } } });
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('root package in package-lock.json has version 0.3.3');
	});

	it('names the root package when package-lock.json has none', () => {
		expect(releaseProblems('0.4.0', manifest, pkg, versions, { version: '0.4.0' })).toHaveLength(1);
	});
});
