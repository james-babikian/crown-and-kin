// Scan test `layout-bounded` (the architecture notes §4.2.7, invariant I8): every loop of the stage files has a bound that is fixed before it starts or named. A `for` over a list
// or a counter is bounded by its head. A `while` is not, so this test LISTS every `while` of the stage files: each must be in the allow-list below with the reason that
// bounds it, each must carry a comment "Bounded: ..." next to it in the code, and no loop may have a constant condition (`while (true)`, `for (;;)`). A new `while` fails
// this test until someone reads it, writes the comment and adds a line to the allow-list. The other half of I8 (the far rounds are at most `unions + 1`, the derive calls
// at most `unions + 2`, no throw on hostile trees) is tested in `layout-invariants`.
import { describe, expect, it } from 'vitest';
import { balanced, codeOf, exists, lineOf, read } from './support/scan';

/** A loop found in a file. */
interface Loop {
	kind: 'while' | 'constant';
	condition: string;
	line: number;
}

/** The text between the bracket that opens at `open` and its closing bracket. */
function between(code: string, open: number): string {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (code[i] === '(') depth++;
		else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
	}
	return code.slice(open + 1);
}

/** The `while` loops of a TypeScript text (also the tail of a `do ... while`), and the loops whose condition is constant. */
export function loopsIn(text: string): Loop[] {
	const code = codeOf(text);
	const out: Loop[] = [];
	for (const m of code.matchAll(/\bwhile\s*\(/g)) {
		const condition = between(code, m.index + m[0].length - 1).replace(/\s+/g, ' ').trim();
		out.push({ kind: /^(true|1|!0)$/.test(condition) ? 'constant' : 'while', condition, line: lineOf(code, m.index) });
	}
	for (const m of code.matchAll(/\bfor\s*\(/g)) {
		const head = between(code, m.index + m[0].length - 1);
		const parts = head.split(';');
		// `for (;;)` and `for (x; ; y)`: no condition at all. (A "for ... of" head has no ";".)
		if (parts.length === 3 && parts[1].trim() === '') out.push({ kind: 'constant', condition: head.replace(/\s+/g, ' ').trim(), line: lineOf(code, m.index) });
	}
	return out;
}

/** True when the loop at `line` has a comment "Bounded: ..." on its line or in the three lines above it. */
export function hasBoundComment(text: string, line: number): boolean {
	const lines = text.split('\n');
	return lines.slice(Math.max(0, line - 4), line).some((l) => /\/\/.*\bBounded\b|\/\*.*\bBounded\b/.test(l));
}

describe('the scan finds what it should (self-test)', () => {
	it('finds a while, a do-while, a constant while and for(;;), with their lines', () => {
		expect(loopsIn('function f() {\n\twhile (a < b) a++;\n}').map((l) => [l.kind, l.condition, l.line])).toEqual([['while', 'a < b', 2]]);
		expect(loopsIn('do { x++; } while (x < n);').map((l) => l.condition)).toEqual(['x < n']);
		expect(loopsIn('while (true) { if (x) break; }').map((l) => l.kind)).toEqual(['constant']);
		expect(loopsIn('for (;;) { break; }').map((l) => l.kind)).toEqual(['constant']);
		expect(loopsIn('for (let i = 0; ; i++) { break; }').map((l) => l.kind)).toEqual(['constant']);
	});

	it('passes a for over a list or with a condition, and words in comments and strings', () => {
		expect(loopsIn('for (const x of xs) {}\nfor (let i = 0; i < n; i++) {}\nfor (; j < d.length; j++) {}')).toEqual([]);
		expect(loopsIn('// while (true) {}\nconst s = "while (x) {}";')).toEqual([]);
	});

	it('finds the nested parentheses of a condition whole', () => {
		expect(loopsIn('while (top > 0 && !(ps[top - 1] / pc[top - 1] <= ps[top])) { top--; }').map((l) => l.condition)).toEqual(['top > 0 && !(ps[top - 1] / pc[top - 1] <= ps[top])']);
	});

	it('knows a bound comment on the line or up to three lines above, and no other', () => {
		const src = '// Bounded: k only grows.\nwhile (k < n) k++;\n';
		expect(hasBoundComment(src, 2)).toBe(true);
		expect(hasBoundComment('// Bounded: ok\n\n\n\nwhile (k < n) k++;\n', 5)).toBe(false);
		expect(hasBoundComment('while (k < n) k++; // Bounded: k grows\n', 1)).toBe(true);
		expect(hasBoundComment('// the loop is fine\nwhile (k < n) k++;\n', 2)).toBe(false);
	});
});

/** The stage files. */
function stageFiles(): string[] {
	return [
		'src/layout/plan-model.ts',
		'src/layout/plan.ts',
		'src/layout/ports.ts',
		'src/layout/place.ts',
		'src/layout/compact.ts',
		'src/layout/lanes.ts',
		'src/layout/route.ts',
		'src/layout/draw.ts',
		'src/layout/pipeline.ts',
		'src/layout/rumour-spot.ts',
		'src/core/order.ts',
	];
}

/**
 * Every `while` of the stage files, with the bound that stops it.
 * A loop that is not here is a finding: read it, write the "Bounded:" comment, add a line.
 */
const ALLOWED: { file: string; condition: string; bound: string }[] = [
	{ file: 'src/layout/plan.ts', condition: 'k > 0 && k < row.length && joined(row[k - 1], row[k])', bound: 'k only grows and stops at row.length' },
	{ file: 'src/layout/compact.ts', condition: 'top > 0', bound: 'every pass spends one unit of the walk budget `cap`' },
	{ file: 'src/layout/compact.ts', condition: 'top > 0 && !(ps[top - 1] / pc[top - 1] <= ps[top] / pc[top])', bound: 'every pass joins two groups, so `top` falls' },
	{ file: 'src/layout/lanes.ts', condition: 'blocked(n, lane)', bound: 'the nets and fixed zones block a fixed number of lanes, so a free lane comes within that many' },
	{ file: 'src/layout/route.ts', condition: 'a < b', bound: 'a binary search: every pass halves [a, b)' },
	{ file: 'src/layout/rumour-spot.ts', condition: 'i < d.length', bound: 'every pass moves i forward (readNumbers)' },
	{ file: 'src/layout/rumour-spot.ts', condition: 'i < d.length', bound: 'every pass reads one command letter and moves i past it' },
];

describe('every loop of the stage files is bounded (I8, §3.5 item 4)', () => {
	const files = stageFiles();
	const found = files.flatMap((f) => loopsIn(read(f)).map((l) => ({ ...l, file: f })));

	it('the stage files exist and the scanner read each whole', () => {
		for (const f of files) expect(exists(f), f).toBe(true);
		expect(files.filter((f) => !balanced(codeOf(read(f))))).toEqual([]);
		// A stage file with no loop at all would be surprising for the three that have some: the scan must see them.
		expect(found.filter((l) => l.kind === 'while').length).toBeGreaterThanOrEqual(ALLOWED.length);
	});

	it('no loop has a constant condition (while (true), for (;;))', () => {
		expect(found.filter((l) => l.kind === 'constant').map((l) => `${l.file}:${l.line} ${l.condition}`)).toEqual([]);
	});

	it('every while is in the allow-list, and every line of the allow-list is a while that is there', () => {
		const have = found.filter((l) => l.kind === 'while').map((l) => `${l.file} :: ${l.condition}`).sort();
		const want = ALLOWED.map((a) => `${a.file} :: ${a.condition}`).sort();
		expect(have).toEqual(want);
	});

	it('every while has a comment "Bounded: ..." on its line or in the three lines above it', () => {
		const bare = found.filter((l) => l.kind === 'while' && !hasBoundComment(read(l.file), l.line));
		expect(bare.map((l) => `${l.file}:${l.line} ${l.condition}`)).toEqual([]);
	});

	it('every line of the allow-list names its bound', () => {
		expect(ALLOWED.filter((a) => a.bound.trim().length < 10)).toEqual([]);
	});
});
