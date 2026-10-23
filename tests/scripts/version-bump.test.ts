// Tests for scripts/version-bump.mjs: the pure function on file texts, and one run on a copy in a temporary folder.
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bumpInFolder, bumpVersion, isHigher, parseVersion, type VersionFiles } from '../../scripts/version-bump.mjs';

const NAMES = { manifest: 'manifest.json', pkg: 'package.json', lock: 'package-lock.json', versions: 'versions.json' } as const;

const files = (): VersionFiles => ({
	manifest: '{\n\t"id": "x",\n\t"version": "0.3.3",\n\t"minAppVersion": "1.5.0"\n}\n',
	pkg: '{\n  "name": "x",\n  "version": "0.3.3"\n}\n',
	lock: '{\n  "name": "x",\n  "version": "0.3.3",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "0.3.3"\n    },\n    "node_modules/y": {\n      "version": "0.3.3"\n    }\n  }\n}\n',
	versions: '{\n\t"0.3.2": "1.5.0",\n\t"0.3.3": "1.5.0"\n}\n',
});

describe('parseVersion and isHigher', () => {
	it('accepts only x.y.z', () => {
		expect(parseVersion('0.4.0')).toEqual([0, 4, 0]);
		for (const bad of ['v0.4.0', '0.4', '0.4.0.1', '0.4.0-beta', '01.4.0', '', ' 0.4.0', '0.4.x']) expect(parseVersion(bad), bad).toBeNull();
	});

	it('compares number by number, not as text', () => {
		expect(isHigher('0.10.0', '0.9.9')).toBe(true);
		expect(isHigher('1.0.0', '0.99.99')).toBe(true);
		expect(isHigher('0.3.3', '0.3.3')).toBe(false);
		expect(isHigher('0.3.2', '0.3.3')).toBe(false);
	});
});

describe('bumpVersion', () => {
	it('sets the version in all five places and adds the versions.json row with the current minAppVersion', () => {
		const out = bumpVersion(files(), '0.4.0');
		expect(JSON.parse(out.manifest).version).toBe('0.4.0');
		expect(JSON.parse(out.pkg).version).toBe('0.4.0');
		const lock = JSON.parse(out.lock);
		expect(lock.version).toBe('0.4.0');
		expect(lock.packages[''].version).toBe('0.4.0');
		expect(lock.packages['node_modules/y'].version).toBe('0.3.3');
		expect(JSON.parse(out.versions)).toEqual({ '0.3.2': '1.5.0', '0.3.3': '1.5.0', '0.4.0': '1.5.0' });
	});

	it('takes the minAppVersion of manifest.json as it is now', () => {
		const f = files();
		f.manifest = f.manifest.replace('1.5.0', '1.8.7');
		expect(JSON.parse(bumpVersion(f, '0.3.4').versions)['0.3.4']).toBe('1.8.7');
	});

	it('keeps the layout of each file: only the version text changes', () => {
		const f = files();
		const out = bumpVersion(f, '0.4.0');
		expect(out.manifest).toBe(f.manifest.replace('"0.3.3"', '"0.4.0"'));
		expect(out.pkg).toBe(f.pkg.replace('"0.3.3"', '"0.4.0"'));
		expect(out.versions).toBe(f.versions.replace('"0.3.3": "1.5.0"\n', '"0.3.3": "1.5.0",\n\t"0.4.0": "1.5.0"\n'));
		expect(out.lock).toBe(f.lock.replace('"version": "0.3.3",', '"version": "0.4.0",').replace('      "version": "0.3.3"\n    },\n    "node_modules/y"', '      "version": "0.4.0"\n    },\n    "node_modules/y"'));
	});

	it('refuses a version that is not x.y.z', () => {
		for (const bad of ['v0.4.0', '0.4', '0.4.0-rc1', 'latest', '']) expect(() => bumpVersion(files(), bad), bad).toThrow(/not a version/);
	});

	it('refuses a version that is not higher', () => {
		expect(() => bumpVersion(files(), '0.3.3')).toThrow(/not higher/);
		expect(() => bumpVersion(files(), '0.3.2')).toThrow(/not higher/);
		expect(() => bumpVersion(files(), '0.2.99')).toThrow(/not higher/);
	});

	it('refuses when the four files disagree on the current version', () => {
		const f = files();
		f.pkg = f.pkg.replace('0.3.3', '0.3.2');
		expect(() => bumpVersion(f, '0.4.0')).toThrow(/package\.json has version 0\.3\.2/);
		const g = files();
		g.lock = g.lock.replace('      "version": "0.3.3"\n    },', '      "version": "0.3.2"\n    },');
		expect(() => bumpVersion(g, '0.4.0')).toThrow(/packages/);
	});

	it('refuses a file that it would reformat', () => {
		const f = files();
		f.versions = '{"0.3.3":"1.5.0"}';
		expect(() => bumpVersion(f, '0.4.0')).toThrow(/versions\.json/);
	});

	it('refuses a version that versions.json already has', () => {
		const f = files();
		f.versions = '{\n\t"0.4.0": "1.5.0"\n}\n';
		expect(() => bumpVersion(f, '0.4.0')).toThrow(/already/);
	});
});

describe('the real files of the project', () => {
	it('are in a layout that the script accepts, and agree on one version', () => {
		const real = Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, readFileSync(name, 'utf8')])) as unknown as VersionFiles;
		const current = JSON.parse(real.manifest).version as string;
		const out = bumpVersion(real, '99.0.0');
		expect(JSON.parse(out.versions)['99.0.0']).toBe(JSON.parse(real.manifest).minAppVersion);
		// The released version has a row; its value is the floor of that release, which a later raise of minAppVersion does not change.
		expect(JSON.parse(real.versions)[current]).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe('bumpInFolder', () => {
	it('writes the four files, and writes nothing when it refuses', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bump-'));
		try {
			for (const name of Object.values(NAMES)) copyFileSync(name, join(dir, name));
			const before = readFileSync(join(dir, 'manifest.json'), 'utf8');
			expect(() => bumpInFolder(dir, '0.0.1')).toThrow(/not higher/);
			expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toBe(before);
			bumpInFolder(dir, '99.1.2');
			expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version).toBe('99.1.2');
			expect(JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf8'))['99.1.2']).toBe(JSON.parse(before).minAppVersion);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
