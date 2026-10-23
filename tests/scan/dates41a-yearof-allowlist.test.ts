// Step 4.1a of WP-4 (the architecture notes §5.7): `yearOf` may be named only in the plain reader, in `dates.ts` and in the files that
// still read a date text on their own. Each later step removes a name from the allow-list (step 4.2 removed `succession.ts`, `validate.ts`, `tree-info.ts` and the phone list); it is empty at the end of 4.3
// (then only `succession-keys.ts` and `dates.ts` remain; step 4.3 emptied it: the Titles window reads `g.dates`). Comments and strings are blanked by the scanner of the scan tests.
import { describe, expect, it } from 'vitest';
import { codeOf, read, tsFiles } from '../support/scan';

/** Files outside the two core files that may still use `yearOf`. A step removes one name here when it moves that file to `g.dates`. */
const STILL_READING: string[] = [];
const HOME = ['src/core/succession-keys.ts', 'src/core/dates.ts'];

describe('yearOf allow-list (the architecture notes §5.7)', () => {
	const users = tsFiles('src').filter((f) => /\byearOf\b/.test(codeOf(read(f))));

	it('no file outside the allow-list names yearOf', () => {
		expect(users.filter((f) => !HOME.includes(f) && !STILL_READING.includes(f))).toEqual([]);
	});

	it('the allow-list has no name that is not used any more (remove it when a step moves the file)', () => {
		expect(STILL_READING.filter((f) => !users.includes(f))).toEqual([]);
	});

	it('the scan sees yearOf in code and not in a comment', () => {
		expect(/\byearOf\b/.test(codeOf('// yearOf here\nconst a = 1;'))).toBe(false);
		expect(/\byearOf\b/.test(codeOf('const a = yearOf(x);'))).toBe(true);
	});
});
