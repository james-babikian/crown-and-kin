// Reports how many bytes of main.js each layer of the plugin makes (0.4, slim assessment Q1).
// `npm run size` prints the table. `npm run size -- --check` fails when a layer is over its budget in scripts/size-budget.json.
// `npm run size -- --write-budget` sets every budget to today's size plus 5 %: run it only when a bigger size is on purpose.
// It builds in memory with the options of esbuild.config.mjs (production), so the numbers are those of the file in a release.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './is-main.mjs';
import { bundleOptions } from '../esbuild.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = path.join(ROOT, 'scripts', 'size-budget.json');
const MARGIN = 1.05;

// The layers in the order of spec §3, lowest first. `yaml` is the one package that the plugin ships.
export const LAYERS = ['core', 'layout', 'render', 'view', 'obsidian', 'yaml'];

/** The layer of a source path in the esbuild metafile (slashes forward), or 'other'. */
export function layerOf(file) {
	const m = /^src\/(core|layout|render|view|obsidian)\//.exec(file);
	if (m) return m[1];
	// A worktree reaches node_modules through a junction, so the path can start with ../ before node_modules.
	if (/(^|\/)node_modules\/yaml\//.test(file)) return 'yaml';
	return 'other';
}

/** Bytes in the output for each layer, from the metafile of one esbuild build. `other` is the banner and anything not in a layer. */
export function sizesFromMetafile(metafile, totalBytes) {
	const sizes = Object.fromEntries([...LAYERS, 'other'].map((name) => [name, 0]));
	const output = Object.values(metafile.outputs)[0];
	for (const [file, info] of Object.entries(output.inputs)) sizes[layerOf(file.replaceAll('\\', '/'))] += info.bytesInOutput;
	const counted = LAYERS.reduce((sum, name) => sum + sizes[name], 0);
	sizes.other = totalBytes - counted;
	sizes.total = totalBytes;
	return sizes;
}

/** The layers that are over their budget, as plain sentences. A layer with no budget is an error too, so a new layer cannot slip in. */
export function overBudget(sizes, budget) {
	const problems = [];
	for (const name of [...LAYERS, 'other', 'total']) {
		const limit = budget[name];
		if (typeof limit !== 'number') problems.push(`${name}: no budget in scripts/size-budget.json.`);
		else if (sizes[name] > limit) problems.push(`${name}: ${sizes[name]} bytes, budget ${limit} bytes (${sizes[name] - limit} over).`);
	}
	return problems;
}

async function measure() {
	process.chdir(ROOT);
	const result = await esbuild.build({ ...bundleOptions(true), metafile: true, write: false, logLevel: 'silent' });
	const bytes = result.outputFiles.find((file) => file.path.endsWith('main.js')).contents.length;
	return sizesFromMetafile(result.metafile, bytes);
}

async function main() {
	const args = process.argv.slice(2);
	const sizes = await measure();
	const budget = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')) : {};
	if (args.includes('--write-budget')) {
		const next = Object.fromEntries([...LAYERS, 'other', 'total'].map((name) => [name, Math.ceil(sizes[name] * MARGIN)]));
		fs.writeFileSync(BUDGET_FILE, JSON.stringify(next, null, '\t') + '\n');
		console.log(`Wrote ${path.relative(ROOT, BUDGET_FILE)} (size plus 5 %).`);
	}
	const pad = (text, n) => String(text).padStart(n);
	console.log(`${'layer'.padEnd(10)}${pad('bytes', 10)}${pad('budget', 10)}`);
	for (const name of [...LAYERS, 'other', 'total']) console.log(`${name.padEnd(10)}${pad(sizes[name], 10)}${pad(budget[name] ?? '-', 10)}`);
	if (args.includes('--check')) {
		const problems = overBudget(sizes, budget);
		if (problems.length > 0) {
			console.error(`\nmain.js is over its size budget:\n${problems.map((p) => `  ${p}`).join('\n')}\nIf the growth is on purpose, run "npm run size -- --write-budget" and commit scripts/size-budget.json.`);
			process.exit(1);
		}
		console.log('\nAll layers are inside their budget.');
	}
}

if (isMain(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
