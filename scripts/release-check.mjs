// Checks a release tag before the release workflow builds anything (0.4, D281 part 1). The tag must be a bare version (0.4.0, no "v"),
// equal to the version in manifest.json and package.json, package-lock.json must carry it in both places (the top and the root package), and versions.json must list it with the minAppVersion of manifest.json.
// Run it as `node scripts/release-check.mjs <tag>`. It prints one problem on each line and exits with 1 when it finds any.
import fs from 'node:fs';
import { isMain } from './is-main.mjs';

/** The problems of a tag, as plain sentences; an empty list means that the tag can be released. */
export function releaseProblems(tag, manifest, pkg, versions, lock) {
	if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) return [`The tag "${tag}" is not a bare version. Write it as x.y.z, without "v".`];
	const problems = [];
	if (manifest.version !== tag) problems.push(`The tag is ${tag}, but manifest.json has version ${manifest.version}.`);
	if (pkg.version !== tag) problems.push(`The tag is ${tag}, but package.json has version ${pkg.version}.`);
	if (lock.version !== tag) problems.push(`The tag is ${tag}, but package-lock.json has version ${lock.version}.`);
	const rootVersion = lock.packages?.['']?.version;
	if (rootVersion !== tag) problems.push(`The tag is ${tag}, but the root package in package-lock.json has version ${rootVersion}.`);
	if (!Object.hasOwn(versions, tag)) problems.push(`versions.json has no row for ${tag}.`);
	else if (versions[tag] !== manifest.minAppVersion) problems.push(`versions.json maps ${tag} to ${versions[tag]}, but manifest.json has minAppVersion ${manifest.minAppVersion}.`);
	return problems;
}

if (isMain(import.meta.url)) {
	const tag = process.argv[2] ?? '';
	const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
	const problems = releaseProblems(tag, read('manifest.json'), read('package.json'), read('versions.json'), read('package-lock.json'));
	if (problems.length > 0) {
		console.error(problems.join('\n'));
		process.exit(1);
	}
	console.log(`The tag ${tag} equals the version in manifest.json, package.json and package-lock.json, and versions.json lists it.`);
}
