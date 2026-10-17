// Scan test `layout-no-node` (the architecture notes §4.2.7, rule 0.7): nothing under `src/` uses Node. The plugin runs on Obsidian for iOS, where there
// is no `process`, no `require` and no `node:` module; `tsconfig` has `types: ["node"]`, so the compiler does not catch this and a build can pass while the
// phone fails. The scan reads the CODE of every file of `src/` (comments and strings are blanked, so a word in a message does not count) and finds three
// things: the bare global `process` (an identifier not preceded by "."; the Obsidian call `vault.process(...)` is allowed), `require(`, and an import from
// `node:`. The self-test proves the scan finds each of them and passes the allowed forms.
import { describe, expect, it } from 'vitest';
import { balanced, codeOf, lineOf, read, tsFiles } from './support/scan';

/** A hit of the scan: what, and where. */
interface Hit {
	what: string;
	line: number;
}

/** The uses of Node in a TypeScript text (the three forms of the contract). */
export function nodeUses(text: string): Hit[] {
	const hits: Hit[] = [];
	const add = (what: string, code: string, at: number) => hits.push({ what, line: lineOf(code, at) });
	const code = codeOf(text);
	// An identifier `process` that is not a property (`vault.process`) and not an object key (`process:`).
	for (const m of code.matchAll(/(?<![\w$.])process(?![\w$])(?!\s*:)/g)) add('the global process', code, m.index);
	for (const m of code.matchAll(/(?<![\w$.])require\s*\(/g)) add('require(', code, m.index);
	const withStrings = codeOf(text, true);
	for (const m of withStrings.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])node:[^'"]*\1/g)) add('an import from node:', withStrings, m.index);
	return hits;
}

describe('the scan finds what it should (self-test)', () => {
	it('finds the bare global process, require( and a node: import', () => {
		expect(nodeUses('const t = process.hrtime();').map((h) => h.what)).toEqual(['the global process']);
		expect(nodeUses('if (typeof process !== "undefined") {}').length).toBe(1);
		expect(nodeUses('const fs = require("fs");').map((h) => h.what)).toEqual(['require(']);
		expect(nodeUses("import { readFileSync } from 'node:fs';").map((h) => h.what)).toEqual(['an import from node:']);
		expect(nodeUses('const p = await import("node:path");').map((h) => h.what)).toEqual(['an import from node:']);
		expect(nodeUses('\n\nprocess.exit(1);').map((h) => h.line)).toEqual([3]);
	});

	it('passes vault.process, words in comments and strings, and names that only contain the word', () => {
		expect(nodeUses('await this.app.vault.process(file, (t) => t);')).toEqual([]);
		expect(nodeUses('// process the list, then require( a check\n/* node:fs */')).toEqual([]);
		expect(nodeUses('const m = "process.exit and require(\'x\') and node:fs";')).toEqual([]);
		expect(nodeUses('const m = `we process ${n} items`;')).toEqual([]);
		expect(nodeUses('const processed = 1; const reprocess = 2; processAll(); const x = { process: 1 };')).toEqual([]);
		expect(nodeUses('const re = /process|require\\(/;')).toEqual([]);
	});

	it('finds a use inside a template expression', () => {
		expect(nodeUses('const m = `x ${process.env.X}`;').map((h) => h.what)).toEqual(['the global process']);
	});
});

describe('no file under src/ uses Node (rule 0.7, §3.5 item 1)', () => {
	const files = tsFiles('src');

	it('there are files to scan (the scan is not empty)', () => {
		expect(files.length).toBeGreaterThan(100);
		expect(files).toContain('src/layout/index.ts');
		expect(files).toContain('src/obsidian/tree-view.ts');
	});

	it('the scanner read every file whole: the brackets of the code of each file balance', () => {
		expect(files.filter((f) => !balanced(codeOf(read(f))))).toEqual([]);
	});

	it('no process, no require( and no node: import in any file of src/', () => {
		const bad: string[] = [];
		for (const f of files) for (const h of nodeUses(read(f))) bad.push(`${f}:${h.line} ${h.what}`);
		expect(bad).toEqual([]);
	});
});
