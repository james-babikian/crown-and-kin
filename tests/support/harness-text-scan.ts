// Reads harness source files as text (no Obsidian) and finds two kinds of stale expectation against the plugin text tables:
// a table function used without a call, and a literal that looks like plugin text but matches no current text. See
// An internal test for the rules and the allow-list.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** One stale expectation: where it is, what it is and why it is flagged. */
export interface Finding {
	file: string;
	line: number;
	kind: 'function-not-called' | 'stale-text';
	text: string;
	detail: string;
}

/** The text tables as loaded modules, by the file name without the folder and the extension (for example `ui-text`). */
export type TextModules = Record<string, Record<string, unknown>>;

/** Every plugin text that can be found by running the text tables: fixed strings and the shape of the template functions. */
export interface TextCorpus {
	strings: string[];
	/** A template function's output with the argument places cut out: the fixed pieces in order. */
	patterns: string[][];
	/** The number of exported functions that no argument guess could run (their texts are not in the corpus). */
	unrunnable: number;
}

/** A documented exception: a literal that is not plugin text, or a flagged use that is correct. */
export interface AllowEntry {
	text: string;
	reason: string;
}

const MARK_OPEN = '⟦';
const MARK_CLOSE = '⟧';
const NUMBER_MARK = 8888;
const MARK_SPLIT = new RegExp(`${MARK_OPEN}\\d+${MARK_CLOSE}|${NUMBER_MARK}`);
const MAX_DEPTH = 5;

function collectStrings(value: unknown, into: string[], depth = 0): void {
	if (typeof value === 'string') into.push(value);
	else if (depth > 4 || value === null || typeof value !== 'object') return;
	else if (Array.isArray(value)) for (const v of value) collectStrings(v, into, depth + 1);
	else for (const v of Object.values(value)) collectStrings(v, into, depth + 1);
}

/** Runs a template function with several argument guesses and returns every string it made (a branch on a number needs a number). */
function runFunction(fn: (...a: never[]) => unknown): string[] | null {
	const strings = [1, 2, 3, 4].map((i) => `${MARK_OPEN}${i}${MARK_CLOSE}`);
	const guesses: unknown[][] = [
		strings,
		[NUMBER_MARK, NUMBER_MARK, NUMBER_MARK],
		[1, 1, 1],
		[2, 2, 2],
		[0, 0, 0],
		[strings, strings],
		[strings[0], NUMBER_MARK, NUMBER_MARK],
		[strings[0], 1, 2],
		[NUMBER_MARK, strings[0], strings[1]],
	];
	const out: string[] = [];
	for (const args of guesses) {
		try {
			collectStrings((fn as (...a: unknown[]) => unknown)(...args), out);
		} catch {
			// The next guess may fit the arguments better.
		}
	}
	return out.length > 0 ? out : null;
}

function walkValue(value: unknown, corpus: TextCorpus, seen: Set<unknown>, depth: number): void {
	if (typeof value === 'string') {
		corpus.strings.push(value);
		return;
	}
	if (depth > MAX_DEPTH || value === null || seen.has(value)) return;
	if (typeof value === 'function') {
		seen.add(value);
		const out = runFunction(value as (...a: never[]) => unknown);
		if (!out) {
			corpus.unrunnable++;
			return;
		}
		for (const s of out) corpus.patterns.push(s.split(MARK_SPLIT));
		return;
	}
	if (typeof value !== 'object') return;
	seen.add(value);
	for (const v of Object.values(value)) walkValue(v, corpus, seen, depth + 1);
}

/** Every string and template piece in a source text. It reaches the texts of functions that no argument guess can run. */
function sourceFragments(source: string): string[] {
	const sf = ts.createSourceFile('table.ts', source, ts.ScriptTarget.ES2020, false);
	const out: string[] = [];
	const visit = (n: ts.Node): void => {
		if (ts.isImportDeclaration(n)) return;
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
		else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((x) => x.literal.text));
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out.filter((x) => x.length >= 3);
}

/** Builds the corpus from the loaded text-table modules and, when given, the source text of the tables (name -> text). */
export function buildCorpus(modules: TextModules, sources: Record<string, string> = {}): TextCorpus {
	const corpus: TextCorpus = { strings: [], patterns: [], unrunnable: 0 };
	const seen = new Set<unknown>();
	for (const mod of Object.values(modules)) walkValue(mod, corpus, seen, 0);
	for (const src of Object.values(sources)) corpus.strings.push(...sourceFragments(src));
	return corpus;
}

/** The harness source files of a folder, by name (only `.ts` files in the folder itself). */
export function readHarnessFiles(dir: string): Record<string, string> {
	const files: Record<string, string> = {};
	for (const name of readdirSync(dir).sort()) {
		if (name.endsWith('.ts')) files[name] = readFileSync(join(dir, name), 'utf8');
	}
	return files;
}

// ---- text tables as the harness sees them -------------------------------------------------------------------------------

const TABLE_FILE = /(^|\/)(src\/(render\/(.+-text|ui-text|tree-info)|core\/(messages|refusal-text)))$/;

/** True when an import path (as written in a harness file) names one of the text-table modules. */
export function isTextTablePath(spec: string): boolean {
	const clean = spec.replace(/^(\.\.\/)+/, 'src/').replace(/^.*?(src\/)/, 'src/');
	return TABLE_FILE.test(clean);
}

function tableKey(spec: string): string {
	return spec.slice(spec.lastIndexOf('/') + 1);
}

interface FileFacts {
	/** Local name -> the module key and the exported name it came from. */
	imports: Map<string, { mod: string; name: string }>;
	/** Local name -> the one initializer expression of a `const` of that name (null when two differ). */
	consts: Map<string, ts.Expression | null>;
}

function gatherFacts(sf: ts.SourceFile): FileFacts {
	const imports = new Map<string, { mod: string; name: string }>();
	const consts = new Map<string, ts.Expression | null>();
	const visit = (n: ts.Node, parent: ts.Node): void => {
		if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isTextTablePath(n.moduleSpecifier.text)) {
			const bindings = n.importClause?.namedBindings;
			if (bindings && ts.isNamedImports(bindings)) {
				for (const el of bindings.elements) imports.set(el.name.text, { mod: tableKey(n.moduleSpecifier.text), name: (el.propertyName ?? el.name).text });
			}
		} else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isVariableDeclarationList(parent) && (parent.flags & ts.NodeFlags.Const) !== 0) {
			consts.set(n.name.text, consts.has(n.name.text) ? null : n.initializer);
		}
		ts.forEachChild(n, (c) => visit(c, n));
	};
	visit(sf, sf);
	return { imports, consts };
}

const NOT_FOUND = Symbol('not found');

function resolve(node: ts.Expression, facts: FileFacts, modules: TextModules, depth = 0): unknown {
	if (depth > 6) return NOT_FOUND;
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return resolve(node.expression, facts, modules, depth + 1);
	if (ts.isIdentifier(node)) {
		const imp = facts.imports.get(node.text);
		if (imp) {
			const mod = modules[imp.mod];
			return mod && imp.name in mod ? mod[imp.name] : NOT_FOUND;
		}
		const init = facts.consts.get(node.text);
		return init ? resolve(init, facts, modules, depth + 1) : NOT_FOUND;
	}
	if (ts.isPropertyAccessExpression(node) || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))) {
		const base = resolve(node.expression, facts, modules, depth + 1);
		const name = ts.isPropertyAccessExpression(node) ? node.name.text : (node.argumentExpression as ts.StringLiteral).text;
		if (base === NOT_FOUND || base === null || (typeof base !== 'object' && typeof base !== 'function')) return NOT_FOUND;
		return name in (base as object) ? (base as Record<string, unknown>)[name] : NOT_FOUND;
	}
	return NOT_FOUND;
}

// ---- rule 1: a table function used without a call ----------------------------------------------------------------------

const COMPARE_OR_JOIN = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.PlusToken]);

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
	return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function functionUsedAsText(parent: ts.Node): boolean {
	if (ts.isTemplateSpan(parent)) return true;
	return ts.isBinaryExpression(parent) && COMPARE_OR_JOIN.has(parent.operatorToken.kind);
}

// ---- rule 2: a literal that looks like plugin text but matches no current text -----------------------------------------

/** The pieces of a literal: one piece for a plain string, the fixed pieces between the `${}` holes for a template. */
function literalPieces(node: ts.Node): string[] | null {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
	if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
	return null;
}

const TEXT_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'toBe', 'toEqual', 'toContain']);

/** True when a node stands where the harness compares a literal with what the page shows. */
function inExpectation(node: ts.Node, parent: ts.Node): boolean {
	if (ts.isBinaryExpression(parent)) {
		const k = parent.operatorToken.kind;
		return k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
	}
	if (ts.isCallExpression(parent) && parent.arguments[0] === node && ts.isPropertyAccessExpression(parent.expression)) return TEXT_METHODS.has(parent.expression.name.text);
	if (ts.isCaseClause(parent)) return true;
	return false;
}

const CONNECTORS = new Set(['of', 'the', 'de', 'del', 'la', 'le', 'von', 'van', 'and']);

/**
 * True for a person or house name: two or more words that each start with a capital letter and go on in small letters, a Roman numeral
 * or a number, with a joining word such as "of" only between them. The plugin writes its own texts in sentence case, so an acronym ("ID") or
 * a mark ("?") means the text is not a name.
 */
export function isNameLike(piece: string): boolean {
	const words = piece.split(' ').filter((w) => w !== '');
	if (words.length < 2 || CONNECTORS.has(words[0]) || CONNECTORS.has(words[words.length - 1])) return false;
	return words.every((w) => CONNECTORS.has(w) || /^(?:[IVX]+|\d+)$/.test(w) || /^[A-Z\u00c0-\u024f][a-z\u00e0-\u024f'\u2019-]+$/.test(w));
}

/** True for a code token (a trace name, a file name): one word with a capital letter inside it, a "::" path or a file extension. */
function isCodeToken(piece: string): boolean {
	return !/\s/.test(piece) && (/[a-z][A-Z]/.test(piece) || piece.includes('::') || /\.[a-z]{2,4}$/.test(piece));
}

/** A literal is a candidate when a reader would take it for words of the plugin: it starts like a sentence or a label and is neither a name nor code. */
function looksLikePluginText(piece: string): boolean {
	const t = piece.trim();
	if (t.length < 4) return false;
	if (!/^[“"‘']?[A-Z][a-z]/.test(t)) return false;
	if (isCodeToken(t) || isNameLike(t)) return false;
	return /[a-z]/.test(t);
}

function minimalFragment(piece: string): string {
	return piece.replace(/\s+/g, ' ').trim();
}

interface PreparedCorpus {
	haystack: string;
	patterns: { parts: string[]; whole: RegExp | null; head: string; tail: string }[];
}

function escapeRegExp(x: string): string {
	return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const prepared = new WeakMap<TextCorpus, PreparedCorpus>();

function prepare(corpus: TextCorpus): PreparedCorpus {
	const known = prepared.get(corpus);
	if (known) return known;
	const strings = corpus.strings.map(minimalFragment);
	const lettersOf = (x: string): number => x.replace(/[^A-Za-z]/g, '').length;
	const patterns = corpus.patterns.map((raw) => {
		const parts = raw.map(minimalFragment);
		const fixed = lettersOf(parts.join(''));
		const whole = fixed < 4 ? null : new RegExp('^' + parts.map((x) => escapeRegExp(x).replace(/\d+/g, '\\d+')).join('.*?') + '$');
		// A literal can be the start or the end of an instance ("After Aldric" of "After <name> now").
		const open = parts.length >= 2;
		return { parts, whole, head: open && lettersOf(parts[0]) >= 4 ? parts[0] : '', tail: open && lettersOf(parts[parts.length - 1]) >= 4 ? parts[parts.length - 1] : '' };
	});
	const result = { haystack: [...strings, ...patterns.flatMap((x) => x.parts)].join('\n'), patterns };
	prepared.set(corpus, result);
	return result;
}

/** True when the literal text is found in the corpus: as a piece of a text, as a text inside it, or as the shape of a template. */
export function inCorpus(piece: string, corpus: TextCorpus): boolean {
	const p = minimalFragment(piece);
	if (p === '') return true;
	const c = prepare(corpus);
	if (c.haystack.includes(p)) return true;
	for (const pat of c.patterns) {

		if (pat.whole?.test(p)) return true;
		if (pat.head && p.startsWith(pat.head)) return true;
		if (pat.tail && p.endsWith(pat.tail)) return true;
	}
	return false;
}

/** Returns the text of a literal piece when it looks like plugin text and `known` does not find it. A text with a comma or a colon also passes when each part of it is found. */
function staleFragment(piece: string, known: (frag: string) => boolean): string | null {
	if (piece.includes('[[') || piece.includes(']]') || !looksLikePluginText(piece)) return null;
	const frag = minimalFragment(piece);
	if (known(frag)) return null;
	if (/[,:]/.test(frag)) {
		const parts = frag.split(/[,:]/).map(minimalFragment);
		if (parts.every((x) => !looksLikePluginText(x) || known(x))) return null;
	}
	return frag;
}

/** Options of a scan: the loaded tables, the corpus, text that is not plugin text, and the sample-tree text. */
export interface ScanOptions {
	modules: TextModules;
	corpus: TextCorpus;
	allow: readonly AllowEntry[];
	/** All text of the sample trees and special-case notes: a literal found here is data, not plugin text. */
	data: string;
}

/** Scans one harness source and returns its findings. */
export function scanSource(file: string, source: string, opts: ScanOptions): Finding[] {
	const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, false);
	const facts = gatherFacts(sf);
	const findings: Finding[] = [];
	const allowed = new Set(opts.allow.map((a) => minimalFragment(a.text)));
	const known = (frag: string): boolean => allowed.has(frag) || opts.data.includes(frag) || inCorpus(frag, opts.corpus);
	const hasTables = facts.imports.size > 0;

	const visit = (n: ts.Node, parent: ts.Node): void => {
		// Rule 1 looks only at the outermost access of a chain such as `T.sub.name`.
		const outer = (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && !((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === n);
		if (hasTables && outer && functionUsedAsText(parent)) {
			const value = resolve(n as ts.Expression, facts, opts.modules);
			if (typeof value === 'function') {
				findings.push({ file, line: lineOf(sf, n), kind: 'function-not-called', text: n.getText(sf), detail: 'a text-table function is used as text; call it' });
			}
		}
		// Rule 2.
		const pieces = literalPieces(n);
		if (pieces && inExpectation(n, parent)) {
			for (const piece of pieces.flatMap((x) => x.split(/[|·]/))) {
				const frag = staleFragment(piece, known);
				if (frag) findings.push({ file, line: lineOf(sf, n), kind: 'stale-text', text: frag, detail: 'looks like plugin text but matches no current text-table value' });
			}
		}
		ts.forEachChild(n, (c) => visit(c, n));
	};
	visit(sf, sf);
	return findings;
}

/** Scans every file of a folder (name -> source) and returns all findings in file order. */
export function scanFiles(files: Record<string, string>, opts: ScanOptions): Finding[] {
	return Object.entries(files).flatMap(([name, src]) => scanSource(name, src, opts));
}
