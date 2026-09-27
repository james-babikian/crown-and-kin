/*
 * Link maintenance (spec §6.9, D6). The core only reads and rewrites link text; the plugin
 * resolves targets against the vault and passes the old → new map. A link is read in the forms
 * the renderer opens (`linkTarget` in `src/render/tree-info.ts`): `[[Note#Heading|Alias]]`,
 * `[Alias](Note.md#Heading)`, `[Alias](<Note.md>)` and a bare `Note#Heading`, each with an
 * optional `!`.
 */

import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar, type Node, type YAMLMap } from 'yaml';
import type { EditResult, RewriteLinksOp } from './edit';
import { parseBody, readTree } from './parse';
import type { Raw, RawMap } from './tolerate';
import { section } from './yaml-list';
import { clone, doubleQuoted, findPair, finish, layoutOf, refuse, renderScalar, setPairValue, type Parsed, type Patch, type Step } from './yaml-patch';

/** A link's text split around its target: `head + written target + tail` is the whole text. */
interface LinkParts {
	head: string;
	/** The target as Obsidian resolves it: trimmed, and percent-decoded in a Markdown link. */
	target: string;
	tail: string;
	kind: 'wiki' | 'md' | 'md-angle' | 'bare';
}

function decode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** Percent-encodes what a Markdown link destination cannot hold as written (the rename search looks for this form too). */
export const encode = (s: string) => s.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** The target is the text up to the first of `cut`; whitespace around it goes to head and tail. */
function split(head: string, text: string, tail: string, cut: RegExp, kind: LinkParts['kind']): LinkParts | null {
	const at = text.search(cut);
	const path = at < 0 ? text : text.slice(0, at);
	const rest = at < 0 ? '' : text.slice(at);
	const lead = /^\s*/.exec(path)![0];
	const core = path.trim();
	const target = kind === 'md' ? decode(core).trim() : core;
	if (target === '') return null;
	return { head: head + lead, target, tail: path.slice(lead.length + core.length) + rest + tail, kind };
}

function parseLink(v: string): LinkParts | null {
	const wiki = /^(\s*!?\[\[)([^\]]*)(\]\]\s*)$/.exec(v);
	if (wiki) return split(wiki[1], wiki[2], wiki[3], /[|#]/, 'wiki');
	const md = /^(\s*!?\[[^\]]*\]\()([^)]*)(\)\s*)$/.exec(v);
	if (md) {
		const angle = /^(\s*<)([^>]*)(>\s*)$/.exec(md[2]);
		if (angle) return split(md[1] + angle[1], angle[2], angle[3] + md[3], /#/, 'md-angle');
		return split(md[1], md[2], md[3], /#/, 'md');
	}
	return split('', v, '', /#/, 'bare');
}

/**
 * The form of a link target used for comparison and for `RewriteLinksOp.map` keys: backslashes
 * become `/`, a trailing `.md` is removed, and the text is lower case.
 */
export type NormaliseTarget = (target: string) => string;

/** Implements `NormaliseTarget`. */
export const normaliseTarget: NormaliseTarget = (target) => (typeof target === 'string' ? target.replace(/\\/g, '/').toLowerCase().replace(/\.md$/, '') : '');

/**
 * The link targets of every person `link` in a tree body, in document order, without `[[`, `]]`,
 * `#heading` and `|alias` (for example `folder/Old` or `Old.md`). Every written form counts: a
 * quoted "[[Old]]", a plain string, and the unquoted [[Old]] that YAML reads as a nested flow
 * sequence (spec §4.1 tolerate). Returns [] when the body does not parse. Never throws.
 */
export type LinkTargets = (body: string) => string[];

/** Implements `LinkTargets`. */
export const linkTargets: LinkTargets = (body) => {
	try {
		if (typeof body !== 'string') return [];
		const parsed = parseBody(body);
		if (!parsed.ok) return [];
		const out: string[] = [];
		for (const p of readTree(parsed.doc, parsed.data, body).people) {
			const parts = p.link === undefined ? null : parseLink(p.link);
			if (parts) out.push(parts.target);
		}
		return out;
	} catch {
		return [];
	}
};

/**
 * The link text with its target replaced; null if the map has no entry for it, 'refused' if the
 * new target cannot be written in that form (a `|` or `]` would change what the link means).
 */
function rewritten(v: string, map: Map<string, string>): string | null | 'refused' {
	const parts = parseLink(v);
	if (!parts) return null;
	let target = map.get(normaliseTarget(parts.target));
	if (target === undefined) return null;
	// `Old.md` stays `New.md`: the old text named the extension, so the new one does too.
	if (/\.md$/i.test(parts.target) && !/\.md$/i.test(target)) target += '.md';
	const text = parts.head + (parts.kind === 'md' ? encode(target) : target) + parts.tail;
	const back = parseLink(text);
	return back?.kind === parts.kind && back.target === target ? text : 'refused';
}

/** The unquoted `[[Note]]`, which YAML reads as a list in a list, holding exactly `inner`. */
function nestedReadsBack(text: string, inner: string, flow: boolean): boolean {
	const snippet = flow ? `{k: ${text}}\n` : `k: ${text}\n`;
	try {
		for (const schema of ['failsafe', 'core'] as const) {
			const doc = parseDocument(snippet, { schema, logLevel: 'silent' });
			if (doc.errors.length) return false;
			const k = (doc.toJS() as RawMap | null)?.k;
			if (!Array.isArray(k) || k.length !== 1 || !Array.isArray(k[0]) || k[0].length !== 1) return false;
			const read: Raw = k[0][0];
			if (schema === 'failsafe' ? read !== inner : String(read) !== inner) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** The inner scalar of an unquoted `[[Note]]` value. */
function nestedInner(node: Node): Scalar | null {
	if (!isSeq(node) || node.items.length !== 1) return null;
	const mid = node.items[0];
	if (!isSeq(mid) || mid.items.length !== 1) return null;
	const inner = mid.items[0];
	return isScalar(inner) && typeof inner.value === 'string' ? inner : null;
}

/** The patch and the new data for one `link` value, or null if it does not change. */
function linkPatch(p: Parsed, item: YAMLMap, map: Map<string, string>): { patch: Patch; raw: Raw } | null | 'refused' {
	const src = p.src;
	const pair = findPair(item, 'link');
	if (!pair || !src.hasValue(pair)) return null;
	const node = pair.value as Node;
	const flow = !!item.flow;
	if (isScalar(node)) {
		if (typeof node.value !== 'string') return null;
		const text = rewritten(node.value, map);
		if (text === 'refused') return text;
		if (text === null || text === node.value) return null;
		return { patch: setPairValue(src, item, pair, { scalar: text, old: node, text: false }, layoutOf(src)), raw: text };
	}
	const inner = nestedInner(node);
	if (!inner) return null;
	const text = rewritten(`[[${inner.value as string}]]`, map);
	if (text === 'refused') return text;
	if (text === null || text === `[[${inner.value as string}]]`) return null;
	const newInner = text.slice(2, -2);
	const nested =
		inner.type === Scalar.QUOTE_DOUBLE ? `[[${doubleQuoted(newInner)}]]` : inner.type === Scalar.QUOTE_SINGLE ? `[['${newInner.replace(/'/g, "''")}']]` : `[[${newInner}]]`;
	const range = { start: node.range![0], end: src.nodeEnd(node) };
	if (nestedReadsBack(nested, newInner, flow)) return { patch: { ...range, text: nested }, raw: [[newInner]] };
	// The nested form cannot hold the new text (for example a comma): the value-quoting rule (spec §3) applies.
	return { patch: { ...range, text: renderScalar(text, null, { flow, text: false, indent: '' }) }, raw: text };
}

/** Rewrites every person `link` whose target moved, leaving the rest of the body unchanged (spec §6.9). */
export function rewriteLinks(first: Parsed, data: RawMap, op: RewriteLinksOp): EditResult {
	const unchanged: EditResult = { ok: true, body: first.src.text, created: [], changed: 0 };
	if (!op.map || typeof op.map !== 'object' || Array.isArray(op.map)) return refuse('bad-value', 'The link map is not a map.');
	const map = new Map<string, string>();
	for (const [k, v] of Object.entries(op.map)) {
		if (typeof v !== 'string' || v.trim() === '') return refuse('bad-value', 'A new link target is empty.');
		const key = normaliseTarget(k);
		if (!map.has(key)) map.set(key, v.trim());
	}
	const s = section(first, 'people');
	if (!s || map.size === 0) return unchanged;

	// A person written as an alias shares the item it points to: that item is patched once.
	const resolve = (item: unknown) => (isAlias(item) ? item.resolve(first.src.doc) : item);
	const changes = new Map<YAMLMap, { patch: Patch; raw: Raw }>();
	for (const item of s.seq.items) {
		const node = resolve(item);
		if (!isMap(node) || changes.has(node)) continue;
		const c = linkPatch(first, node, map);
		if (c === 'refused') return refuse('bad-value', 'A new link target cannot be written as a link.');
		if (c) changes.set(node, c);
	}
	if (changes.size === 0) return unchanged;

	const expected = clone(data) as RawMap;
	const people = Array.isArray(expected.people) ? (expected.people as Raw[]) : [];
	s.seq.items.forEach((item, k) => {
		const node = resolve(item);
		const c = isMap(node) ? changes.get(node) : undefined;
		const person = people[k];
		if (c && person && typeof person === 'object' && !Array.isArray(person)) (person as RawMap).link = clone(c.raw);
	});
	// Computed on the first parse, so one step.
	const step: Step = () => [...changes.values()].map((c) => c.patch);
	const r = finish(first, [step], expected, []);
	return r.ok ? { ...r, changed: changes.size } : r;
}
