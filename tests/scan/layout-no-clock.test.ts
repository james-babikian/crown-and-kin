// Scan test `layout-no-clock` (the architecture notes §4.2.7, invariant I7): the layout and the core read no clock and no random source. The time budget
// (spec §7.7, D225) reaches the layout only through `shouldStop` and `opts.check`; a clock inside a stage would make the drawing depend on the speed of the
// machine, and `Math.random` would make it differ between two runs. The scan reads the CODE of every file of `src/layout` and `src/core` and finds
// `Date.now`, `new Date(`, `performance.` and `Math.random`. `instanceof Date` and the methods of a Date value that the code was given are allowed.
import { describe, expect, it } from 'vitest';
import { balanced, codeOf, lineOf, read, tsFiles } from '../support/scan';

/** A hit of the scan: what, and where. */
interface Hit {
	what: string;
	line: number;
}

const CLOCKS: [string, RegExp][] = [
	['Date.now', /(?<![\w$.])Date\s*\.\s*now\b/g],
	['new Date(', /\bnew\s+Date\s*\(/g],
	['performance.', /(?<![\w$.])performance\s*\./g],
	['Math.random', /(?<![\w$.])Math\s*\.\s*random\b/g],
];

/** The clock and random uses in a TypeScript text. */
export function clockUses(text: string): Hit[] {
	const code = codeOf(text);
	const hits: Hit[] = [];
	for (const [what, re] of CLOCKS) for (const m of code.matchAll(re)) hits.push({ what, line: lineOf(code, m.index) });
	return hits;
}

describe('the scan finds what it should (self-test)', () => {
	it('finds each of the four forms', () => {
		expect(clockUses('const t = Date.now();').map((h) => h.what)).toEqual(['Date.now']);
		expect(clockUses('const d = new Date(0);').map((h) => h.what)).toEqual(['new Date(']);
		expect(clockUses('const t0 = performance.now();').map((h) => h.what)).toEqual(['performance.']);
		expect(clockUses('const r = Math.random();').map((h) => h.what)).toEqual(['Math.random']);
		expect(clockUses('\n\nconst r = Math.random();').map((h) => h.line)).toEqual([3]);
	});

	it('passes instanceof Date, methods of a given Date, and words in comments and strings', () => {
		expect(clockUses('if (v instanceof Date) return v.getTime();')).toEqual([]);
		expect(clockUses('const y = given.getFullYear(); const s = given.toISOString();')).toEqual([]);
		expect(clockUses('// Date.now() and Math.random() are not used\n/* new Date( */')).toEqual([]);
		expect(clockUses('const m = "performance.now and Date.now";')).toEqual([]);
		expect(clockUses('const x = obj.performance.mark; const y = a.Math.random;')).toEqual([]);
	});
});

describe('no clock and no random source in src/layout and src/core (I7, §3.5 item 1)', () => {
	const files = [...tsFiles('src/layout'), ...tsFiles('src/core')];

	it('there are files to scan (the scan is not empty)', () => {
		expect(files.length).toBeGreaterThan(40);
		expect(files).toContain('src/layout/geometry.ts');
		expect(files).toContain('src/core/derive.ts');
	});

	it('the scanner read every file whole: the brackets of the code of each file balance', () => {
		expect(files.filter((f) => !balanced(codeOf(read(f))))).toEqual([]);
	});

	it('no Date.now, new Date(, performance. or Math.random in any of them', () => {
		const bad: string[] = [];
		for (const f of files) for (const h of clockUses(read(f))) bad.push(`${f}:${h.line} ${h.what}`);
		expect(bad).toEqual([]);
	});
});
