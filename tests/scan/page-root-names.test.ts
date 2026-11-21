// Scan test `page-root-names` (rule book "Test hooks in production code"): release code reads no study or test switch from the page root,
// apart from the accepted ones. A snippet or another plugin can set an attribute on `<html>` or `<body>`, so a `data-dynasty-*` name that the
// plugin reads there (or writes there) changes what a user sees. The scan reads every file of `src/` with comments blanked (strings kept)
// and finds the page-root sites: `getAttribute`, `hasAttribute`, `setAttribute`, `removeAttribute`, `toggleAttribute` and `dataset` on a
// `documentElement` or the `body` of a document (also through a local name for it), and `querySelector` on a document with a
// `[data-dynasty-…]` selector. A name given by a constant (`PAN_WRAPPER_ATTR`) is looked up among the string constants of `src/`.
// Also seen: a root from `querySelector('body')` or `closest('html')`, a cast alias, a destructured `body`, a local name for the document, and `attributes.getNamedItem`.
// Attributes on the tree's own root (`data-dynasty-cards-pending` on `.dynasty-root`) are not page-root sites and are not counted.
import { describe, expect, it } from 'vitest';
import { codeOf, read, tsFiles } from '../support/scan';

/** The accepted test hooks of the rule book; the two page-root names are the drag study switches of src/obsidian/move-layer.ts. */
export const ACCEPTED = ['dynasty-fill-all', 'data-dynasty-cards-pending', 'data-dynasty-lines-pending', 'data-dynasty-pan-wrapper', 'data-dynasty-drag-margin'];

const ATTR_CALL = '(?:get|has|set|remove|toggle)Attribute';
// A document: `document`, `doc`, `win.document`, `activeDocument`, `el.ownerDocument`.
const DOC = String.raw`\b(?:[\w$]+\??\.)*\w*[dD]oc(?:ument)?\b`;
// A page root: `document.documentElement`, `doc.documentElement`, `win.document.body`, `activeDocument.body`, `el.ownerDocument.body`, a bare `documentElement`,
// `document.querySelector('body')` and `el.closest('html')`.
const ROOT = String.raw`(?:${DOC}\??\.(?:documentElement|body)\b|\bdocumentElement\b|${DOC}\??\.querySelector\(\s*['"](?:body|html)['"]\s*\)|\b[\w$]+(?:\??\.[\w$]+)*\??\.closest\(\s*['"](?:body|html)['"]\s*\))`;
// What may follow a root in a local name: a type cast, a non-null mark, a fallback is not followed (a known limit: `?? x`).
const ROOT_TAIL = String.raw`(?:\s+as\s+[\w.<>]+|!)?\s*[;\n]`;

/** The string constants of the texts: `const NAME = 'value'` (exported or not), for names given by a constant. */
export function stringConstants(texts: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const text of texts) for (const m of codeOf(text, true).matchAll(/\bconst\s+(\w+)\s*(?::\s*\w+\s*)?=\s*'([^'\n]*)'/g)) out.set(m[1], m[2]);
	return out;
}

/** `dynastyDragMargin` (a `dataset` key) as `data-dynasty-drag-margin`. */
const fromDataset = (key: string): string => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** The attribute names that one text reads or writes on a page root; `consts` resolves a name given by a constant. */
export function pageRootNames(text: string, consts: ReadonlyMap<string, string>): string[] {
	const code = codeOf(text, true);
	const found = new Set<string>();
	const nameOf = (arg: string): string | undefined => {
		const literal = /^\s*['"`]([^'"`]+)['"`]/.exec(arg);
		if (literal) return literal[1];
		const id = /^\s*(\w+)\s*$/.exec(arg);
		return id ? consts.get(id[1]) : undefined;
	};
	// Local names for a page root (`const root = doc.documentElement as HTMLElement;`), for a document (`const d = document;`) and for a destructured
	// root (`const { body } = document;`, `const { body: b } = document;`).
	const aliases = [...code.matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*${ROOT}${ROOT_TAIL}`, 'g'))].map((m) => m[1]);
	const docNames = [...code.matchAll(new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*=\s*${DOC}${ROOT_TAIL}`, 'g'))].map((m) => m[1]);
	for (const m of code.matchAll(new RegExp(String.raw`\b(?:const|let)\s*\{([^}]*)\}\s*=\s*${DOC}${ROOT_TAIL}`, 'g'))) {
		for (const part of m[1].split(',')) {
			const d = /^\s*(documentElement|body)\s*(?::\s*(\w+))?\s*$/.exec(part);
			if (d) aliases.push(d[2] ?? d[1]);
		}
	}
	const docs = [DOC, ...docNames.map((a) => String.raw`\b${a}\b`)].join('|');
	const roots = String.raw`(?:${ROOT}|(?:${docs})\??\.(?:documentElement|body)\b)`;
	const receivers = [roots, ...aliases.map((a) => String.raw`\b${a}\b`)].join('|');
	for (const m of code.matchAll(new RegExp(String.raw`(?:${receivers})\??\.(?:${ATTR_CALL}|attributes\??\.(?:getNamedItem|removeNamedItem))\(([^,)]*)`, 'g'))) {
		const name = nameOf(m[1]);
		if (name !== undefined) found.add(name);
		else found.add(`(unresolved: ${m[1].trim()})`);
	}
	for (const m of code.matchAll(new RegExp(String.raw`(?:${receivers})\??\.dataset(?:\??\.(\w+)|\[\s*['"](\w+)['"]\s*\])`, 'g'))) found.add(fromDataset(m[1] ?? m[2]));
	// A document query for a hook attribute: any element of the page can carry it.
	for (const m of code.matchAll(new RegExp(String.raw`(?:${docs})\??\.querySelector(?:All)?\(\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`)`, 'g'))) {
		for (const a of (m[1] ?? m[2] ?? m[3]).matchAll(/\[(data-dynasty-[\w-]+)/g)) found.add(a[1]);
	}
	return [...found].filter((n) => n.startsWith('data-dynasty-') || n.startsWith('(unresolved')).sort();
}

describe('page-root names that release code reads or writes (accepted test hooks only)', () => {
	it('src/ reads or writes on the page root only the accepted names: the two drag study switches', () => {
		const files = tsFiles('src');
		const consts = stringConstants(files.map(read));
		const sites = files.flatMap((f) => pageRootNames(read(f), consts).map((n) => `${f}: ${n}`));
		expect(sites.filter((s) => !ACCEPTED.includes(s.slice(s.indexOf(': ') + 2)))).toEqual([]);
		// The scan still sees the two switches; if it saw nothing, it would prove nothing.
		expect(sites).toEqual(['src/obsidian/move-layer.ts: data-dynasty-drag-margin', 'src/obsidian/move-layer.ts: data-dynasty-pan-wrapper']);
	});

	it('finds a literal, a constant, a local name, a dataset key and a document query, and not the tree root or a comment', () => {
		const consts = stringConstants(["export const STUDY_ATTR = 'data-dynasty-study';"]);
		const text = [
			"const a = doc.documentElement?.getAttribute('data-dynasty-one');",
			'const b = document.body.hasAttribute(STUDY_ATTR);',
			'const html = win.document.documentElement;',
			"html.setAttribute('data-dynasty-three', 'x');",
			'const d = activeDocument.body.dataset.dynastyFour;',
			"const e = document.querySelector('.x[data-dynasty-five=\"on\"]');",
			"root.setAttribute('data-dynasty-cards-pending', '0');",
			"// doc.documentElement.getAttribute('data-dynasty-comment')",
			"el.ownerDocument.body.style.setProperty('--dynasty-muted', 'x');",
		].join('\n');
		expect(pageRootNames(text, consts)).toEqual(['data-dynasty-five', 'data-dynasty-four', 'data-dynasty-one', 'data-dynasty-study', 'data-dynasty-three']);
	});

	it('reports a name that it cannot resolve, so a new switch through a variable is not missed', () => {
		expect(pageRootNames('const v = document.documentElement.getAttribute(name);', new Map())).toEqual(['(unresolved: name)']);
	});
});

describe('page-root names through other ways to reach the page root', () => {
	// Known limit: a root with a fallback (`const root = a ?? document.body;`) is not an alias.
	const lines = [
		"document.querySelector('body')?.setAttribute('data-dynasty-a', '1');",
		"const html = document.querySelector('html'); html?.getAttribute('data-dynasty-b');",
		"const { body } = document; body.getAttribute('data-dynasty-c');",
		"el.closest('body')?.hasAttribute('data-dynasty-d');",
		"const root = el.ownerDocument.documentElement as HTMLElement; root.dataset.dynastyE;",
		"document.documentElement.attributes.getNamedItem('data-dynasty-f');",
		"const d = document; d.body.getAttribute('data-dynasty-g');",
		"const { documentElement: h } = document;\nh.removeAttribute('data-dynasty-h');",
	];
	for (const line of lines) {
		it(line, () => {
			expect(pageRootNames(line, new Map()).length).toBeGreaterThan(0);
		});
	}
});
