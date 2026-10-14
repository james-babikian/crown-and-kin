// Writes `docs/format.md` and the generated part of `README.md` from the key table (`npm run format-doc`).
// With `--check` it writes nothing and fails when a file differs from the output.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { formatDoc, spliceReadme } from './render';

const check = process.argv.includes('--check');
const DOC = 'docs/format.md';
const README = 'README.md';

const doc = formatDoc();
const readme = readFileSync(README, 'utf8');
const nextReadme = spliceReadme(readme);
if (nextReadme === undefined) {
	console.error(`${README} has no format markers. Add the two marker lines first (scripts/format/render.ts).`);
	process.exit(1);
}

const stale = [existsSync(DOC) && readFileSync(DOC, 'utf8') === doc ? null : DOC, nextReadme === readme ? null : README].filter((f): f is string => f !== null);
if (check) {
	if (stale.length) {
		console.error(`These files differ from the key table: ${stale.join(', ')}. Run "npm run format-doc".`);
		process.exit(1);
	}
	console.log('docs/format.md and README.md match the key table.');
} else {
	writeFileSync(DOC, doc);
	writeFileSync(README, nextReadme);
	console.log(stale.length ? `Wrote ${stale.join(', ')}.` : 'Nothing changed.');
}
