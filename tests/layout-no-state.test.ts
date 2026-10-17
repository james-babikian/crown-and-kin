// Scan test `layout-no-state` (the architecture notes §4.2.7, the decision notes "0.3.1", invariant I7): the layout keeps no state between two calls. Two trees laid out in
// one process must give what each gives alone, so a module may hold no `let` or `var`, no `Map`, `Set`, array or object that a function writes to, and no
// counter. The allow-list has exactly three entries: the cache in `src/layout/index.ts` (keyed by tree and settings, bounded), the `WeakMap` memo in
// `src/layout/geometry.ts` (keyed by a geometry object, so it lives only as long as that object) and the `WeakMap` of the generations in `src/layout/index.ts`
// (keyed by a graph object, WP-E2 P5 by the supervisor's ruling; it lives only as long as that graph). Slot tables and settings objects are `readonly`
// (`as const` or `Readonly<...>`), so a function cannot write to them.
import { describe, expect, it } from 'vitest';
import { balanced, codeOf, read, topLevel, tsFiles } from './support/scan';

/** A finding of the scan. */
interface Finding {
	kind: 'mutable binding' | 'written container' | 'table not readonly';
	name: string;
	line: number;
}

const WRITES = String.raw`(?:\s*\.\s*(?:set|add|push|pop|shift|unshift|splice|sort|reverse|fill|delete|clear|copyWithin)\s*\(|\s*\[[^\]]*\]\s*(?:=(?!=)|\+=|-=|\+\+|--)|\s*\.\s*[\w$]+\s*(?:=(?![=>])|\+=|-=|\+\+|--))`;

/** True when a function in one of `codes` writes to the value named `name` (a method that changes it, an element or a property that is set). */
function isWritten(name: string, codes: string[]): boolean {
	const n = name.replace(/\$/g, '\\$');
	const forward = new RegExp(String.raw`(?<![\w$.])${n}${WRITES}`);
	const backward = new RegExp(String.raw`(?:\+\+|--)\s*${n}\s*[.\[]`);
	return codes.some((c) => forward.test(c) || backward.test(c));
}

/**
 * The module state of a file: top-level `let`/`var`; top-level containers (`new Map`, `Set`, `WeakMap`, `WeakSet`, an array or an object literal) that a function
 * in `codes` writes to; and top-level array or object literals that are not readonly (no `as const`, no `Readonly` or `readonly` in the type).
 * `codes` is the code of every file that can write to an exported name (the other scanned files).
 */
export function moduleState(text: string, codes: string[] = []): Finding[] {
	const code = codeOf(text);
	const all = [code, ...codes];
	const out: Finding[] = [];
	for (const s of topLevel(code)) {
		const mutable = /^(?:export\s+)?(?:let|var)\s+([\w$]+)/.exec(s.text);
		if (mutable) {
			out.push({ kind: 'mutable binding', name: mutable[1], line: s.line });
			continue;
		}
		const decl = /^(?:export\s+)?const\s+([\w$]+)\s*(:[^=]*?)?=(?![=>])\s*([\s\S]*)$/.exec(s.text);
		if (!decl) continue;
		const [, name, type = '', init] = decl;
		const isTable = /^[[{]/.test(init);
		const isContainer = isTable || /^new\s+(?:Map|Set|WeakMap|WeakSet|Array)\b/.test(init) || /^(?:Array\.from|Object\.create)\s*\(/.test(init);
		if (!isContainer) continue;
		if (isWritten(name, all)) out.push({ kind: 'written container', name, line: s.line });
		else if (isTable && !/\bas\s+const\s*;?$/.test(init.trim()) && !/\b[Rr]eadonly\b/.test(type)) out.push({ kind: 'table not readonly', name, line: s.line });
	}
	return out;
}

describe('the scan finds what it should (self-test)', () => {
	const kinds = (src: string, others: string[] = []) => moduleState(src, others).map((f) => `${f.kind}: ${f.name}`);

	it('finds a top-level let and var, also exported', () => {
		expect(kinds('let counter = 0;\nexport function next() { return counter++; }')).toEqual(['mutable binding: counter']);
		expect(kinds('export var seen = false;')).toEqual(['mutable binding: seen']);
	});

	it('finds a container that a function writes to, in the file or in another file', () => {
		expect(kinds('const memo = new Map<string, number>();\nexport function f(k: string) { memo.set(k, 1); }')).toEqual(['written container: memo']);
		expect(kinds('const list: number[] = [];\nfunction f() { list.push(1); }')).toEqual(['written container: list']);
		expect(kinds('const slots = {};\nfunction f(k: string) { slots[k] = 1; }')).toEqual(['written container: slots']);
		expect(kinds('const cfg = { a: 1 };\nfunction f() { cfg.a = 2; }')).toEqual(['written container: cfg']);
		expect(kinds('export const shared = new Set<string>();', [codeOf('import { shared } from "./a"; function f() { shared.add("x"); }')])).toEqual(['written container: shared']);
	});

	it('finds a table that is not readonly, and passes one that is', () => {
		expect(kinds('const SLOTS = [0, 1, 2];')).toEqual(['table not readonly: SLOTS']);
		expect(kinds('const RULE: Rule = { a: 1, b: 2 };')).toEqual(['table not readonly: RULE']);
		expect(kinds('const SLOTS = [0, 1, 2] as const;')).toEqual([]);
		expect(kinds('const SLOTS: readonly number[] = [0, 1];')).toEqual([]);
		expect(kinds('const RULE: Readonly<Rule> = { a: 1 };')).toEqual([]);
		expect(kinds('export const EM = {\n\ta: 1,\n\tb: 2,\n} as const;')).toEqual([]);
	});

	it('passes a function, a read-only lookup, a local variable and words in comments and strings', () => {
		expect(kinds('const f = (x: number) => { return x; };\nfunction g() { let n = 0; n++; const m = new Map(); m.set(1, 2); return n; }')).toEqual([]);
		expect(kinds('const BY_NAME = new Map([["a", 1]]);\nfunction f(k: string) { return BY_NAME.get(k); }')).toEqual([]);
		expect(kinds('// let counter = 0;\nconst s = "let x = 1; const memo = new Map();";')).toEqual([]);
		expect(kinds('const T = [1, 2] as const;\nfunction f() { const T2 = [...T]; T2.push(3); return T2; }')).toEqual([]);
	});
});

/** The files of the scan: all of `src/layout` and the walk. */
function scanFiles(): string[] {
	return [...tsFiles('src/layout'), 'src/core/order.ts'];
}

/** The allow-list of §3.5 item 1 (and the WP-E2 P5 ruling): exactly these three, nothing else. */
const ALLOWED = ['src/layout/geometry.ts clearAnswers', 'src/layout/index.ts cache', 'src/layout/index.ts generationsByGraph'];

describe('no module state in the layout (I7, §3.5 items 1 and 3)', () => {
	const files = scanFiles();
	const codes = files.map((f) => codeOf(read(f)));
	const findings = files.flatMap((f, i) => moduleState(read(f), codes.filter((_, j) => j !== i)).map((x) => ({ ...x, file: f })));

	it('there are files to scan, and the new pipeline is among them', () => {
		expect(files.length).toBeGreaterThan(20);
		for (const f of ['src/layout/geometry.ts', 'src/layout/index.ts', 'src/layout/pipeline.ts', 'src/layout/plan.ts', 'src/layout/route.ts', 'src/layout/lanes.ts', 'src/layout/place.ts']) expect(files).toContain(f);
		expect(files).not.toContain('src/layout/lines.ts');
	});

	it('the scanner read every file whole: the brackets of the code of each file balance', () => {
		expect(files.filter((_, i) => !balanced(codes[i]))).toEqual([]);
	});

	it('no top-level let or var (a counter, a flag, a last value)', () => {
		expect(findings.filter((f) => f.kind === 'mutable binding').map((f) => `${f.file}:${f.line} ${f.name}`)).toEqual([]);
	});

	it('the only containers a function writes to are the three of the allow-list: the cache and the generations WeakMap of index.ts and the WeakMap of geometry.ts', () => {
		expect(findings.filter((f) => f.kind === 'written container').map((f) => `${f.file} ${f.name}`).sort()).toEqual(ALLOWED);
	});

	it('every slot table and settings object is readonly (as const, Readonly or readonly)', () => {
		expect(findings.filter((f) => f.kind === 'table not readonly').map((f) => `${f.file}:${f.line} ${f.name}`)).toEqual([]);
	});

	// `layout.ts` keeps `DEFAULT_FAR_RULE`, `DEFAULT_LAYOUT_SETTINGS`, `NEVER_FAR_RULE` (§2.3); §12 item 1 makes them readonly (`Readonly<...>`).
	it('the settings objects of layout.ts are readonly (DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE)', () => {
		const names = ['DEFAULT_FAR_RULE', 'DEFAULT_LAYOUT_SETTINGS', 'NEVER_FAR_RULE'];
		const found = moduleState(read('src/layout/layout.ts'), codes);
		expect(found.filter((f) => names.includes(f.name)).map((f) => `${f.name}: ${f.kind}`)).toEqual([]);
		// The scan must have looked at the three (a rename must not make this pass by accident).
		for (const n of names) expect(read('src/layout/layout.ts')).toMatch(new RegExp(`export const ${n}\\b`));
	});
});
