// 0.3 B.5 (T1, old iOS): the plugin bundle has no regular-expression lookbehind, except the three known tokens of the `yaml` package.
//
// Why: Safari before iOS 16.4 cannot parse a lookbehind ("(?<=" or "(?<!") in a regular-expression literal. A literal that does not parse stops the
// whole script, so the plugin would not load at all. The `yaml` package writes three lookbehinds inside `new RegExp("...")` strings, in a try block with
// a fallback (`resolve-flow-scalar`, `stringifyString`). Safari throws a SyntaxError only when that line runs, and the package catches it. So those three
// are safe, and any other lookbehind in the bundle (ours or from a new dependency) is a fault.
//
// The test builds the plugin in memory with the esbuild API and the options of the production build (it does not read the git-ignored main.js), so it
// sees the code of today's source and dependencies. The source scan in an internal test stays; this one also covers the dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** A lookbehind token in the bundle text, with where it stands. */
interface Token {
	/** The group, written the same way in every build: real line breaks and tabs become `\n` and `\t`. */
	text: string;
	/** True when the token stands in a string that `new RegExp(` has just opened (a quote, a backtick, no other quote in between). */
	inRegExpString: boolean;
}

const norm = (s: string) => s.replace(/\n/g, '\\n').replace(/\t/g, '\\t');

/** Every lookbehind token of a script, found as text. The three known ones are the only ones that may stand. */
function lookbehinds(code: string): Token[] {
	const out: Token[] = [];
	for (const m of code.matchAll(/\(\?<[=!]/g)) {
		const at = m.index ?? 0;
		const before = code.slice(Math.max(0, at - 40), at);
		const open = before.lastIndexOf('new RegExp(');
		const between = open < 0 ? null : before.slice(open + 'new RegExp('.length);
		out.push({
			text: norm(code.slice(at, at + 12)),
			inRegExpString: between !== null && /^["'`][^"'`]*$/.test(between),
		});
	}
	return out;
}

/** The three lookbehinds of the `yaml` package (first twelve characters of each token, in the normal form). */
const KNOWN = ['(?<!\\n))\\n+(', '(?<![ \\t])[ \\t', '(?<![ \\t])[ \\t'];

function unknown(tokens: Token[]): Token[] {
	const left = [...KNOWN];
	return tokens.filter((t) => {
		const i = t.inRegExpString ? left.findIndex((k) => t.text.startsWith(k.slice(0, 11))) : -1;
		if (i < 0) return true;
		left.splice(i, 1);
		return false;
	});
}

describe('the scanner itself', () => {
	it('finds a lookbehind in a literal and in a string, and tells the two places apart', () => {
		const t = lookbehinds('const a = /(?<=x)y/; const b = new RegExp("(?<![ \\t])[ \\t]+$");');
		expect(t.map((x) => x.inRegExpString)).toEqual([false, true]);
	});

	it('names a lookbehind in a literal, and a known text outside new RegExp, as unknown', () => {
		expect(unknown(lookbehinds('const a = /(?<![ \\t])[ \\t]+$/;'))).toHaveLength(1);
		expect(unknown(lookbehinds('new RegExp(`(^|(?<!\n))\n+(?!\n|$)`,"g"); new RegExp("(?<![ \\t])[ \\t]+$"); new RegExp("^[ \\t]+|(?<![ \\t])[ \\t]+$","g");'))).toEqual([]);
	});

	it('a fourth lookbehind is unknown, also inside new RegExp', () => {
		const code = 'new RegExp("(?<![ \\t])[ \\t]+$"); new RegExp("(?<![ \\t])[ \\t]+$"); new RegExp("(?<!\\n))\\n+("); new RegExp("(?<=a)b");';
		expect(unknown(lookbehinds(code)).map((t) => t.text)).toEqual(['(?<=a)b");']);
	});
});

describe('the production bundle', () => {
	it('uses the options of esbuild.config.mjs (the test copy cannot drift from them)', () => {
		const config = readFileSync(root('esbuild.config.mjs'), 'utf8');
		for (const line of ["entryPoints: ['src/obsidian/main.ts']", 'bundle: true', "format: 'cjs'", "target: 'es2020'", 'minify: prod', 'treeShaking: true']) expect(config).toContain(line);
	});

	it('has no lookbehind except the three known tokens of the yaml package', async () => {
		const result = await esbuild.build({
			entryPoints: [root('src/obsidian/main.ts')],
			bundle: true,
			external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
			format: 'cjs',
			target: 'es2020',
			logLevel: 'silent',
			sourcemap: false,
			treeShaking: true,
			define: { __DYNASTY_HARNESS__: 'false' },
			minify: true,
			outfile: root('main.js'),
			write: false,
		});
		const code = result.outputFiles[0]!.text;
		expect(code.length).toBeGreaterThan(100_000);
		const tokens = lookbehinds(code);
		expect(unknown(tokens).map((t) => t.text), 'lookbehind tokens that are not the three known ones').toEqual([]);
		expect(tokens, 'the three known tokens are still in the bundle (if the yaml package dropped them, shorten KNOWN)').toHaveLength(3);
	}, 60_000);
});
