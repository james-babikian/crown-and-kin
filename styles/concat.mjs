// Joins the numbered style chunks of this folder into the text of the plugin's styles.css.
// The build (esbuild.config.mjs) and the drift test (tests/styles/styles-drift.test.ts) both use it,
// so the committed styles.css can never differ from what the build makes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The chunk file names in build order (`NN-<area>.css`, sorted by name). */
export function chunkNames(dir = here) {
	return fs
		.readdirSync(dir)
		.filter((name) => /^\d\d-.+\.css$/.test(name))
		.sort();
}

/** The text of styles.css: the chunks joined in order, with nothing added between them. */
export function concatStyles(dir = here) {
	return chunkNames(dir)
		.map((name) => fs.readFileSync(path.join(dir, name), 'utf8'))
		.join('');
}

/** Writes styles.css next to the folder, only when the text changed. Returns true if it wrote. */
export function writeStyles(outFile, dir = here) {
	const text = concatStyles(dir);
	if (fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === text) return false;
	fs.writeFileSync(outFile, text);
	return true;
}
