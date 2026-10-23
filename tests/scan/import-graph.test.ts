// Scan test `import-graph` (the architecture notes §3): the layer rules as a test. It reads the imports of every file in `src/` (comments are blanked by the same
// scanner as `layout-no-node`; a type-only import counts too, because it is still a dependency) and fails on
//   1. an import that goes up the order  obsidian -> view -> render/dom -> render -> layout -> core  (a lower layer never imports a higher one),
//   2. an import of `obsidian` outside `src/obsidian` (the shell is the only place that talks to Obsidian),
//   3. a cycle between files (type-only imports included).
// `src/view` sits between `render/dom` and `obsidian` in the order.
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeOf, read, tsFiles } from '../support/scan';

/** The layers from the lowest to the highest. A file may import its own layer and any layer to its left. */
export const LAYERS = ['core', 'layout', 'render', 'render/dom', 'view', 'obsidian'] as const;
type Layer = (typeof LAYERS)[number];

/** The layer of a repository path (`src/render/dom/scene.ts` is `render/dom`), or null for a path outside the layers. */
export function layerOf(path: string): Layer | null {
	if (path.startsWith('src/render/dom/')) return 'render/dom';
	const m = /^src\/([a-z-]+)\//.exec(path);
	return m && (LAYERS as readonly string[]).includes(m[1]) ? (m[1] as Layer) : null;
}

/** The module names a TypeScript text imports: `import`, `export ... from`, side-effect imports and `import()`. */
export function importsOf(text: string): string[] {
	const code = codeOf(text, true);
	const out: string[] = [];
	// `[^;'"]` keeps a match inside one statement: a name list has no semicolon and no quote.
	for (const m of code.matchAll(/\b(?:import|export)\s+[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/g)) out.push(m[2]);
	for (const m of code.matchAll(/\bimport\s*(['"])([^'"\n]+)\1/g)) out.push(m[2]);
	for (const m of code.matchAll(/\bimport\s*\(\s*(['"])([^'"\n]+)\1/g)) out.push(m[2]);
	return [...new Set(out)];
}

/** The file a relative import names, as a repository path, or null when the file is not in `files`. */
export function resolveImport(from: string, spec: string, files: ReadonlySet<string>): string | null {
	const base = posix.normalize(posix.join(posix.dirname(from), spec));
	for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) if (files.has(candidate)) return candidate;
	return null;
}

/** The import graph of the given files: file -> the files it imports, plus the packages it imports and the relative imports that found no file. */
export interface Graph {
	edges: Map<string, string[]>;
	packages: Map<string, string[]>;
	unresolved: string[];
}

/** Builds the graph from file texts. */
export function buildGraph(texts: ReadonlyMap<string, string>): Graph {
	const files = new Set(texts.keys());
	const edges = new Map<string, string[]>();
	const packages = new Map<string, string[]>();
	const unresolved: string[] = [];
	for (const [file, text] of texts) {
		const to: string[] = [];
		const pk: string[] = [];
		for (const spec of importsOf(text)) {
			if (spec.startsWith('.')) {
				const hit = resolveImport(file, spec, files);
				if (hit) to.push(hit);
				else unresolved.push(`${file} -> ${spec}`);
			} else pk.push(spec);
		}
		edges.set(file, to);
		packages.set(file, pk);
	}
	return { edges, packages, unresolved };
}

/** The imports that go up the layer order, as "from -> to" texts. A file outside the layers is reported too. */
export function upwardImports(g: Graph): string[] {
	const bad: string[] = [];
	for (const [from, tos] of g.edges) {
		const a = layerOf(from);
		if (a === null) bad.push(`${from} is outside the layers`);
		for (const to of tos) {
			const b = layerOf(to);
			if (b === null) bad.push(`${from} -> ${to} (outside the layers)`);
			else if (a !== null && LAYERS.indexOf(b) > LAYERS.indexOf(a)) bad.push(`${from} (${a}) -> ${to} (${b})`);
		}
	}
	return bad;
}

/** The files outside `src/obsidian` that import the `obsidian` package. */
export function obsidianOutsideShell(g: Graph): string[] {
	return [...g.packages].filter(([file, pk]) => pk.includes('obsidian') && layerOf(file) !== 'obsidian').map(([file]) => file);
}

/** The cycles of a graph: each group of files that reach each other (Tarjan), a file that imports itself included, as a path "a -> b -> a". */
export function cycles(g: Graph): string[] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const found: string[][] = [];
	let counter = 0;
	// An explicit stack: the graph has 150 files, but a recursion limit must not decide whether the test can run.
	for (const root of g.edges.keys()) {
		if (index.has(root)) continue;
		const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
		index.set(root, counter);
		low.set(root, counter++);
		stack.push(root);
		onStack.add(root);
		while (work.length) {
			const top = work[work.length - 1];
			const next = g.edges.get(top.v)?.[top.i++];
			if (next !== undefined) {
				if (!index.has(next)) {
					index.set(next, counter);
					low.set(next, counter++);
					stack.push(next);
					onStack.add(next);
					work.push({ v: next, i: 0 });
				} else if (onStack.has(next)) low.set(top.v, Math.min(low.get(top.v)!, index.get(next)!));
				continue;
			}
			work.pop();
			const parent = work[work.length - 1];
			if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(top.v)!));
			if (low.get(top.v) === index.get(top.v)) {
				const group: string[] = [];
				let w: string;
				do {
					w = stack.pop()!;
					onStack.delete(w);
					group.push(w);
				} while (w !== top.v);
				if (group.length > 1 || g.edges.get(top.v)?.includes(top.v)) found.push(group);
			}
		}
	}
	return found.map((group) => {
		const inGroup = new Set(group);
		const start = [...group].sort()[0];
		// Follow the first edge that stays in the group until a file repeats: that is one real cycle through the group.
		const path = [start];
		let at = start;
		for (;;) {
			const to = g.edges.get(at)!.find((t) => inGroup.has(t))!;
			const seen = path.indexOf(to);
			path.push(to);
			if (seen >= 0) return path.slice(seen).join(' -> ');
			at = to;
		}
	});
}

const graphOf = (files: Record<string, string>) => buildGraph(new Map(Object.entries(files)));

describe('the scan finds what it should (self-test)', () => {
	it('reads every form of import', () => {
		const text = [
			"import { a } from './a';",
			"import type { B } from '../b';",
			"import {\n\tc,\n\td,\n} from './c';",
			"export { e } from './e';",
			"export type { F } from './f';",
			"export * from './g';",
			"import './h';",
			"const m = await import('./i');",
			"import x from 'obsidian';",
		].join('\n');
		expect(importsOf(text).sort()).toEqual(['../b', './a', './c', './e', './f', './g', './h', './i', 'obsidian']);
	});

	it('ignores words in comments, and an export that is not a re-export', () => {
		expect(importsOf("// import { a } from './a';\n/* import './b' */\nconst s = 'from';")).toEqual([]);
		expect(importsOf("export const a = 1;\nexport function f() { return 'from'; }")).toEqual([]);
	});

	it('names the layer of a path', () => {
		expect(layerOf('src/core/types.ts')).toBe('core');
		expect(layerOf('src/render/svg-string.ts')).toBe('render');
		expect(layerOf('src/render/dom/scene.ts')).toBe('render/dom');
		expect(layerOf('src/view/focus-mode.ts')).toBe('view');
		expect(layerOf('src/obsidian/main.ts')).toBe('obsidian');
		expect(layerOf('scripts/spike.ts')).toBeNull();
		expect(layerOf('src/other/x.ts')).toBeNull();
	});

	it('fails on an upward import and passes a downward and a sideways one', () => {
		const g = graphOf({
			'src/core/a.ts': "import './b'; import '../layout/l';",
			'src/core/b.ts': '',
			'src/layout/l.ts': "import '../core/a';",
			'src/render/dom/d.ts': "import '../r'; import '../../view/v';",
			'src/render/r.ts': "import './dom/d';",
			'src/view/v.ts': "import '../obsidian/o';",
			'src/obsidian/o.ts': "import '../view/v';",
		});
		expect(upwardImports(g).sort()).toEqual([
			'src/core/a.ts (core) -> src/layout/l.ts (layout)',
			'src/render/dom/d.ts (render/dom) -> src/view/v.ts (view)',
			'src/render/r.ts (render) -> src/render/dom/d.ts (render/dom)',
			'src/view/v.ts (view) -> src/obsidian/o.ts (obsidian)',
		]);
	});

	it('finds an import of obsidian outside the shell', () => {
		const g = graphOf({ 'src/render/dom/w.ts': "import { setIcon } from 'obsidian';", 'src/obsidian/o.ts': "import 'obsidian';", 'src/core/c.ts': "import 'yaml';" });
		expect(obsidianOutsideShell(g)).toEqual(['src/render/dom/w.ts']);
	});

	it('finds a cycle, a longer cycle and a file that imports itself, and passes a diamond', () => {
		expect(cycles(graphOf({ 'src/core/a.ts': "import './b';", 'src/core/b.ts': "import './a';" }))).toEqual(['src/core/a.ts -> src/core/b.ts -> src/core/a.ts']);
		const ring = graphOf({ 'src/core/a.ts': "import './b';", 'src/core/b.ts': "import './c';", 'src/core/c.ts': "import './a';", 'src/core/d.ts': "import './a';" });
		expect(cycles(ring)).toEqual(['src/core/a.ts -> src/core/b.ts -> src/core/c.ts -> src/core/a.ts']);
		expect(cycles(graphOf({ 'src/core/a.ts': "import './a';" }))).toEqual(['src/core/a.ts -> src/core/a.ts']);
		const diamond = graphOf({ 'src/core/a.ts': "import './b'; import './c';", 'src/core/b.ts': "import './d';", 'src/core/c.ts': "import './d';", 'src/core/d.ts': '' });
		expect(cycles(diamond)).toEqual([]);
	});
});

describe('import graph of src/ (the architecture notes §3)', () => {
	const files = tsFiles('src');
	const graph = buildGraph(new Map(files.map((f) => [f, read(f)] as const)));

	it('there are files to scan, and relative imports find their files', () => {
		expect(files.length).toBeGreaterThan(100);
		expect(graph.unresolved).toEqual([]);
	});

	it('no import goes up the order obsidian -> view -> render/dom -> render -> layout -> core', () => {
		expect(upwardImports(graph)).toEqual([]);
	});

	it('only src/obsidian imports obsidian', () => {
		expect(obsidianOutsideShell(graph)).toEqual([]);
	});

	it('no cycle between files', () => {
		expect(cycles(graph)).toEqual([]);
	});

	it('dates.ts (WP-4) imports only the other files of the date reader, hash.ts, succession-keys.ts and the types of types.ts', () => {
		// Names contract (0.3.3, WP-6): the size rule split the name lists, the formats, the number places and the text helpers out of dates.ts.
		expect([...(graph.edges.get('src/core/dates.ts') ?? [])].sort()).toEqual([
			'src/core/date-formats.ts', 'src/core/date-numbers.ts', 'src/core/date-text.ts', 'src/core/hash.ts', 'src/core/name-lists.ts', 'src/core/succession-keys.ts', 'src/core/types.ts',
		]);
		expect(graph.packages.get('src/core/dates.ts')).toEqual([]);
		// The leaves of the plain reader, of the hash and of the text helpers stay leaves; the lists and the formats use only the leaves (and the refusal sentences).
		expect(graph.edges.get('src/core/succession-keys.ts')).toEqual([]);
		expect(graph.edges.get('src/core/hash.ts')).toEqual([]);
		expect(graph.edges.get('src/core/date-text.ts')).toEqual([]);
		expect(graph.edges.get('src/core/date-numbers.ts')).toEqual([]);
		expect([...(graph.edges.get('src/core/name-lists.ts') ?? [])].sort()).toEqual(['src/core/date-text.ts', 'src/core/refusal-text.ts']);
		expect([...(graph.edges.get('src/core/date-formats.ts') ?? [])].sort()).toEqual(['src/core/date-text.ts', 'src/core/name-lists.ts']);
	});
});
