// Step 4.3 of WP-4 (the architecture notes §5.7): every `deriveFamilies(` in the view and shell layers passes the date reader of the tree, so a date in a calendar of the user reads
// the same in every window. `core/focus-subgraph.ts`, `core/yaml-edit.ts` and `core/relationship-ops.ts` read no dates and may stay plain (they are in `src/core`,
// which this test does not scan). Comments and strings are blanked by the scanner of the scan tests.
import { describe, expect, it } from 'vitest';
import { codeOf, read, tsFiles } from '../support/scan';

/** The argument text of each call of `name(` in `code`: from the bracket to its match. */
function callsOf(code: string, name: string): string[] {
	const out: string[] = [];
	for (const m of code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
		let depth = 0;
		let end = m.index! + m[0].length - 1;
		for (; end < code.length; end++) {
			if (code[end] === '(') depth++;
			else if (code[end] === ')' && --depth === 0) break;
		}
		out.push(code.slice(m.index! + m[0].length, end));
	}
	return out;
}

describe('deriveFamilies in the view and shell layers (the architecture notes §5.7)', () => {
	const files = ['src/obsidian', 'src/view', 'src/render'].flatMap((d) => tsFiles(d));
	const calls = files.flatMap((file) => callsOf(codeOf(read(file)), 'deriveFamilies').map((args) => ({ file, args })));

	it('finds the calls that exist today', () => {
		expect(calls.length).toBeGreaterThanOrEqual(5);
	});

	it('every call passes dates', () => {
		expect(calls.filter((c) => !/\bdates\b/.test(c.args)).map((c) => `${c.file}: deriveFamilies(${c.args.trim()})`)).toEqual([]);
	});

	it('the scan sees a plain call and an argument with dates, and no call in a comment', () => {
		expect(callsOf('const g = deriveFamilies(tree);', 'deriveFamilies')).toEqual(['tree']);
		expect(callsOf('deriveFamilies(a(b), { dates: r })', 'deriveFamilies')).toEqual(['a(b), { dates: r }']);
		expect(callsOf(codeOf('// deriveFamilies(tree)\nx()'), 'deriveFamilies')).toEqual([]);
	});
});
