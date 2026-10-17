// Source scanner of the scan tests of the card-and-line build (the architecture notes §4.2.7): `layout-no-node`, `layout-no-clock`, `layout-no-state`,
// `layout-bounded`. It reads files of `src/` as text and gives the CODE of each: comments, strings, template text and regular-expression
// literals are blanked out (same length, same line breaks), so a word in a comment or in a message never counts. `topLevel` splits the code
// into its top-level statements (brace depth 0), which is what the module-state scan needs. No parser is used on purpose: the scan must run on
// any file of `src/`, also one that does not compile yet.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The root of the repository (the folder above `tests/`). `SCAN_ROOT` points the scans at another tree (an export of another branch) to prove that they pass there too. */
export const ROOT = process.env.SCAN_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** Every `.ts` file under a folder of the repository (`src/layout`), recursive, as repository-relative paths with `/`, sorted. */
export function tsFiles(dir: string): string[] {
	const out: string[] = [];
	const walk = (rel: string) => {
		for (const name of readdirSync(join(ROOT, rel)).sort()) {
			const p = `${rel}/${name}`;
			if (statSync(join(ROOT, p)).isDirectory()) walk(p);
			else if (name.endsWith('.ts')) out.push(p);
		}
	};
	walk(dir);
	return out;
}

/** True when a file of the repository exists. */
export function exists(rel: string): boolean {
	try {
		return statSync(join(ROOT, rel)).isFile();
	} catch {
		return false;
	}
}

/** The text of a repository file. */
export const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// After one of these a "/" starts a regular expression and not a division.
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);

/**
 * The code of a TypeScript text: comments, string contents, template text and regex literals become spaces; line breaks and length stay.
 * With `keepStrings` the contents of '...' and "..." strings stay (to read the module name of an import).
 */
export function codeOf(text: string, keepStrings = false): string {
	const out: string[] = [];
	// A stack for templates: each `${` pushes the brace depth at which its code ends.
	const braces: number[] = [];
	let depth = 0;
	let i = 0;
	let last = ''; // last significant code character
	let lastWord = '';
	let wordOpen = false;
	const blank = (c: string) => (c === '\n' ? '\n' : ' ');
	const template = (opening: boolean) => {
		// Inside the text of a template literal, up to the closing backtick or a `${`. `opening`: the backtick that opens it is still to be read.
		if (opening) {
			out.push(' ');
			i++;
		}
		while (i < text.length) {
			const c = text[i];
			if (c === '\\') {
				out.push(' ', blank(text[i + 1] ?? ' '));
				i += 2;
			} else if (c === '`') {
				out.push(' ');
				i++;
				return;
			} else if (c === '$' && text[i + 1] === '{') {
				out.push('$', '{');
				i += 2;
				braces.push(depth);
				depth++;
				last = '{';
				return;
			} else {
				out.push(blank(c));
				i++;
			}
		}
	};
	while (i < text.length) {
		const c = text[i];
		const n = text[i + 1];
		if (c === '/' && n === '/') {
			while (i < text.length && text[i] !== '\n') {
				out.push(' ');
				i++;
			}
		} else if (c === '/' && n === '*') {
			const end = text.indexOf('*/', i + 2);
			const stop = end < 0 ? text.length : end + 2;
			for (; i < stop; i++) out.push(blank(text[i]));
		} else if (c === "'" || c === '"') {
			out.push(c);
			i++;
			while (i < text.length && text[i] !== c && text[i] !== '\n') {
				if (text[i] === '\\') {
					out.push(keepStrings ? '\\' : ' ');
					i++;
				}
				out.push(keepStrings ? (text[i] ?? ' ') : blank(text[i] ?? ' '));
				i++;
			}
			out.push(c);
			i++;
			last = c;
			lastWord = '';
			wordOpen = false;
		} else if (c === '`') {
			template(true);
			last = '`';
			lastWord = '';
			wordOpen = false;
		} else if (c === '/' && (REGEX_AFTER.has(last) || last === '' || REGEX_AFTER_WORD.has(lastWord))) {
			// A regular expression literal: up to the closing "/" outside a [] class, then its flags.
			out.push('/');
			i++;
			let inClass = false;
			while (i < text.length && text[i] !== '\n') {
				const d = text[i];
				if (d === '\\') {
					out.push(' ', blank(text[i + 1] ?? ' '));
					i += 2;
					continue;
				}
				if (d === '[') inClass = true;
				else if (d === ']') inClass = false;
				else if (d === '/' && !inClass) break;
				out.push(' ');
				i++;
			}
			out.push('/');
			i++;
			while (i < text.length && /[a-z]/.test(text[i])) {
				out.push(text[i]);
				i++;
			}
			last = '/';
			lastWord = '';
			wordOpen = false;
		} else {
			if (c === '{') depth++;
			else if (c === '}') {
				depth--;
				if (braces.length && braces[braces.length - 1] === depth) {
					// The end of a `${ ... }`: back into the template text.
					braces.pop();
					out.push('}');
					i++;
					template(false);
					last = '`';
					lastWord = '';
					wordOpen = false;
					continue;
				}
			}
			out.push(c);
			i++;
			if (/\s/.test(c)) {
				wordOpen = false;
				continue;
			}
			if (/[\w$]/.test(c)) {
				lastWord = wordOpen ? lastWord + c : c;
				wordOpen = true;
			} else {
				lastWord = '';
				wordOpen = false;
			}
			last = c;
		}
	}
	return out.join('');
}

/** The 1-based line of an offset. */
export function lineOf(text: string, offset: number): number {
	let n = 1;
	for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') n++;
	return n;
}

/** One top-level statement of a file (code only): its text, and the line where it starts. */
export interface Statement {
	text: string;
	line: number;
}

const BLOCK_STATEMENT = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\b|class\b|abstract\s+class\b|interface\b|enum\b|namespace\b|const\s+enum\b|if\b|for\b|while\b|do\b|try\b|switch\b)/;

/** The statements at brace depth 0 of `code` (a result of `codeOf`). A block ends a function, class, interface or enum; anything else ends at its ";". */
export function topLevel(code: string): Statement[] {
	const out: Statement[] = [];
	let depth = 0;
	let start = -1;
	const push = (end: number) => {
		const text = code.slice(start, end).trim();
		if (text) out.push({ text, line: lineOf(code, start + code.slice(start).search(/\S/)) });
		start = -1;
	};
	for (let i = 0; i < code.length; i++) {
		const c = code[i];
		if (start < 0 && !/\s/.test(c)) start = i;
		if (c === '{' || c === '(' || c === '[') depth++;
		else if (c === '}' || c === ')' || c === ']') {
			depth--;
			if (c === '}' && depth === 0 && start >= 0 && BLOCK_STATEMENT.test(code.slice(start, i + 1).trimStart())) {
				// `if (x) {} else {}`: keep going while an `else` follows.
				if (!/^\s*else\b/.test(code.slice(i + 1, i + 12)) && !/^\s*(catch|finally)\b/.test(code.slice(i + 1, i + 12))) push(i + 1);
			}
		} else if (c === ';' && depth === 0 && start >= 0) push(i + 1);
	}
	if (start >= 0) push(code.length);
	return out;
}

/**
 * True when the brackets of `code` balance. A scanner that lost its place in a file (a quote taken for a regex, a template that never closed) leaves code
 * where strings should be, or the other way round, and then the brackets do not balance. The scan tests check this on every file they read.
 */
export function balanced(code: string): boolean {
	const stack: string[] = [];
	const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
	for (const c of code) {
		if (c === '(' || c === '[' || c === '{') stack.push(c);
		else if (c in pairs && stack.pop() !== pairs[c]) return false;
	}
	return stack.length === 0;
}
