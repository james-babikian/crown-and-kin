// Sets a new plugin version in the four files that carry it, so a release cannot miss one.
// Run it as `npm run version-bump -- 0.4.0`. The pure function `bumpVersion` does the work on file texts
// (tests/scripts/version-bump.test.ts); the run at the bottom only reads and writes the files.
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './is-main.mjs';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The three numbers of an x.y.z text, or null when the text has another shape. */
export function parseVersion(text) {
	const m = VERSION.exec(text);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when version a is higher than version b (both x.y.z texts). */
export function isHigher(a, b) {
	const x = parseVersion(a);
	const y = parseVersion(b);
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
	return false;
}

// The files keep their own indent (tab or two spaces). A file that does not read back to the same text
// is refused: the script must never reformat a file as a side effect.
function readJson(name, text) {
	const indent = /^\{\n\t/.test(text) ? '\t' : 2;
	const data = JSON.parse(text);
	if (JSON.stringify(data, null, indent) + '\n' !== text) throw new Error(`${name} is not in the standard JSON layout; the script would reformat it.`);
	return { data, write: () => JSON.stringify(data, null, indent) + '\n' };
}

/**
 * Takes the texts of manifest.json, package.json, package-lock.json and versions.json and the new version.
 * Returns the four new texts. Throws an Error with a plain message when the version is not x.y.z, is not
 * higher than the current one, or when the four files do not agree on the current version.
 */
export function bumpVersion(files, next) {
	if (!parseVersion(next)) throw new Error(`"${next}" is not a version. Write it as x.y.z, for example 0.4.0.`);
	const manifest = readJson('manifest.json', files.manifest);
	const pkg = readJson('package.json', files.pkg);
	const lock = readJson('package-lock.json', files.lock);
	const versions = readJson('versions.json', files.versions);

	const current = manifest.data.version;
	const places = { 'package.json': pkg.data.version, 'package-lock.json': lock.data.version, 'package-lock.json packages[""]': lock.data.packages?.['']?.version };
	for (const [where, value] of Object.entries(places)) {
		if (value !== current) throw new Error(`${where} has version ${value}, but manifest.json has ${current}. Make them equal first.`);
	}
	if (!parseVersion(current)) throw new Error(`manifest.json has "${current}", which is not x.y.z.`);
	if (!isHigher(next, current)) throw new Error(`${next} is not higher than the current version ${current}.`);
	if (Object.hasOwn(versions.data, next)) throw new Error(`versions.json already has ${next}.`);
	const minApp = manifest.data.minAppVersion;
	if (typeof minApp !== 'string' || !minApp) throw new Error('manifest.json has no minAppVersion.');

	manifest.data.version = next;
	pkg.data.version = next;
	lock.data.version = next;
	lock.data.packages[''].version = next;
	versions.data[next] = minApp;
	return { manifest: manifest.write(), pkg: pkg.write(), lock: lock.write(), versions: versions.write() };
}

const FILES = { manifest: 'manifest.json', pkg: 'package.json', lock: 'package-lock.json', versions: 'versions.json' };

/** Reads the four files in the folder, bumps them and writes them back. Nothing is written when the bump is refused. */
export function bumpInFolder(dir, next) {
	const texts = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, fs.readFileSync(path.join(dir, name), 'utf8')]));
	const out = bumpVersion(texts, next);
	for (const [key, name] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), out[key]);
}

if (isMain(import.meta.url)) {
	const next = process.argv[2];
	try {
		if (!next) throw new Error('Give the new version: npm run version-bump -- 0.4.0');
		bumpInFolder(process.cwd(), next);
		console.log(`Version ${next} is set in manifest.json, package.json, package-lock.json and versions.json.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
