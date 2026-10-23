// Writes `docs/format.md` from the key table (`npm run format-doc`).
// With `--check` it writes nothing and fails when the file differs from the output.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { formatDoc } from './render';

const check = process.argv.includes('--check');
const DOC = 'docs/format.md';

const doc = formatDoc();
const stale = !(existsSync(DOC) && readFileSync(DOC, 'utf8') === doc);
if (check) {
	if (stale) {
		console.error(`${DOC} differs from the key table. Run "npm run format-doc".`);
		process.exit(1);
	}
	console.log(`${DOC} matches the key table.`);
} else {
	writeFileSync(DOC, doc);
	console.log(stale ? `Wrote ${DOC}.` : 'Nothing changed.');
}
