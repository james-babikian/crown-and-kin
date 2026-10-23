/*
 * Child process of `tests/core/fuzz-hostile.test.ts`: runs the hostile cases one after the other and writes one line to
 * the parent before a case (`START <index>`) and one after it (`END <json>`). The parent stops the child if a case does
 * not end in time, and the START line names the case that hung. The writes are synchronous, so a line is out before the next case starts.
 */
import { writeSync } from 'node:fs';
import { buildCases, runCase } from './hostile-cases';

const cases = buildCases();
const only = process.argv[2] === undefined ? null : new Set(process.argv[2].split(',').map(Number));
cases.forEach((c, i) => {
	if (only && !only.has(i)) return;
	writeSync(1, `START ${i}\n`);
	writeSync(1, `END ${JSON.stringify({ index: i, ...runCase(c) })}\n`);
});
writeSync(1, 'DONE\n');
