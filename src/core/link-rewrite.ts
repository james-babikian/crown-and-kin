/*
 * Link maintenance (spec §6.9, D6, §13.0 item 3). The core only reads and rewrites link text; the
 * plugin resolves targets against the vault and passes the old → new map. The values it handles
 * are a person's `link` and `portrait` and a house's `arms`. A link is read in the forms the
 * renderer opens (`linkTarget` in `src/render/tree-info.ts`): `[[Note#Heading|Alias]]`,
 * `[Alias](Note.md#Heading)`, `[Alias](<Note.md>)` and a bare `Note#Heading`, each with an
 * optional `!`. `parsePictureLink` is shared with `pictures.ts`, so a rename and the picture lookup
 * read a picture link the same way.
 */

import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar, type Node, type YAMLMap } from 'yaml';
import type { EditResult, RewriteLinksOp } from './edit';
import { closesBalanced } from './link-text';
import { parseBody } from './parse';
import { pictureFormat } from './pictures';
import { curlyParts, isMap as isRawMap, linkValue, type Raw, type RawMap } from './tolerate';
import { section } from './yaml-list';
import { clone, doubleQuoted, findPair, finish, layoutOf, refuse, renderScalar, setPairValue, sourceText, type Parsed, type Patch, type Step } from './yaml-patch';

/** A link's text split around its target: `head + written target + tail` is the whole text. */
export interface LinkParts {
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

/**
 * Splits a link value into its parts, or null when it names no target (for example `[[]]` or
 * `#heading`). A text that matches no link form is a bare target. A Markdown destination runs to
 * the last `)` if its parentheses are balanced; the angle form runs to the last `>` before it.
 */
export function parseLink(v: string): LinkParts | null {
	const wiki = /^(\s*!?\[\[)([^\]]*)(\]\]\s*)$/.exec(v);
	if (wiki) return split(wiki[1], wiki[2], wiki[3], /[|#]/, 'wiki');
	const md = /^(\s*!?\[[^\]]*\]\()([\s\S]*)(\)\s*)$/.exec(v);
	if (md) {
		const angle = /^(\s*<)([\s\S]*)(>\s*)$/.exec(md[2]);
		if (angle) return split(md[1] + angle[1], angle[2], angle[3] + md[3], /#/, 'md-angle');
		if (closesBalanced(md[2])) return split(md[1], md[2], md[3], /#/, 'md');
	}
	return split('', v, '', /#/, 'bare');
}

/**
 * `parseLink` for a picture value (`portrait`, `arms`; contract rule 4): a bare value may also start
 * with "!", which goes to the head, so `!Pictures/x.png` names `Pictures/x.png`. A bare `link` keeps
 * its "!", as the renderer opens it.
 */
export function parsePictureLink(v: string): LinkParts | null {
	const parts = parseLink(v);
	const bang = parts?.kind === 'bare' ? /^(\s*!)([\s\S]*)$/.exec(v) : null;
	return bang ? split(bang[1], bang[2], '', /#/, 'bare') : parts;
}

/** The link parser of a field: pictures read a bare leading "!" as an embed mark. */
const parserFor = (key: string) => (key === 'link' ? parseLink : parsePictureLink);

/**
 * The form of a link target used for comparison and for `RewriteLinksOp.map` keys: backslashes
 * become `/`, a trailing `.md` is removed, and the text is lower case.
 */
export type NormaliseTarget = (target: string) => string;

/** Implements `NormaliseTarget`. */
export const normaliseTarget: NormaliseTarget = (target) => (typeof target === 'string' ? target.replace(/\\/g, '/').toLowerCase().replace(/\.md$/, '') : '');

/**
 * The key `rewrite-links` matches a target and a map key by: the file the target names, lower case
 * with `/`. A shown picture extension names the picture; any other target names a note, so ".md" is
 * added when it is not written. Unlike `normaliseTarget`, the note "x.png.md" and the picture
 * "x.png" never share a key (the rule of `extensionAgrees` in `rename-links.ts`).
 */
export function matchKey(target: string): string {
	if (typeof target !== 'string') return '';
	const path = target.replace(/\\/g, '/').toLowerCase();
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot > 0 && pictureFormat(name.slice(dot + 1)).kind === 'supported') return path;
	return path.endsWith('.md') ? path : `${path}.md`;
}

/** The keys `linkTargets` and `rewrite-links` read in each list section (spec §6.9, §13.0 item 3). */
const LINK_FIELDS: Record<'houses' | 'people', readonly string[]> = { houses: ['arms'], people: ['link', 'portrait'] };

/**
 * The link targets of every person `link`, person `portrait` and house `arms` in a tree body, in
 * text order, without `[[`, `]]`, `#heading` and `|alias` (for example `folder/Old`, `Old.md` or
 * `arms.png`). Web addresses are listed too. Every written form counts: a quoted "[[Old]]", a plain
 * string, the unquoted [[Old]] that YAML reads as a nested flow sequence (spec §4.1 tolerate) and
 * an unquoted ![[x.png]] (contract A3). Returns [] when the body does not parse. Never throws.
 */
export type LinkTargets = (body: string) => string[];

/** Implements `LinkTargets`. */
export const linkTargets: LinkTargets = (body) => {
	try {
		if (typeof body !== 'string') return [];
		const parsed = parseBody(body);
		if (!parsed.ok || !isRawMap(parsed.data)) return [];
		const out: string[] = [];
		// The data keeps the written key order, so this is text order: sections, items, then keys.
		for (const [name, items] of Object.entries(parsed.data)) {
			const keys = name === 'houses' || name === 'people' ? LINK_FIELDS[name] : undefined;
			if (!keys || !Array.isArray(items)) continue;
			items.forEach((item: Raw, index) => {
				if (!isRawMap(item)) return;
				for (const [key, v] of Object.entries(item)) {
					if (!keys.includes(key)) continue;
					const text = linkValue(v, () => sourceText(parsed.doc, body, [name, index, key]));
					const parts = text === undefined ? null : parserFor(key)(text);
					if (parts) out.push(parts.target);
				}
			});
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
function rewritten(v: string, map: Map<string, string>, read: typeof parseLink): string | null | 'refused' {
	const parts = read(v);
	if (!parts) return null;
	let target = map.get(matchKey(parts.target));
	if (target === undefined) return null;
	// `Old.md` stays `New.md`: the old text named the extension, so the new one does too.
	if (/\.md$/i.test(parts.target) && !/\.md$/i.test(target)) target += '.md';
	const text = parts.head + (parts.kind === 'md' ? encode(target) : target) + parts.tail;
	const back = read(text);
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

/** The patch and the new data for one `link`, `portrait` or `arms` value, or null if it does not change. */
function linkPatch(p: Parsed, item: YAMLMap, key: string, map: Map<string, string>): { patch: Patch; raw: Raw } | null | 'refused' {
	const src = p.src;
	const pair = findPair(item, key);
	if (!pair || !src.hasValue(pair)) return null;
	const node = pair.value as Node;
	const flow = !!item.flow;
	if (isScalar(node)) {
		if (typeof node.value !== 'string') return null;
		// A value in curly quote marks (D103) is rewritten inside the marks, and the marks stay as the owner typed them.
		const curly = curlyParts(node.value);
		const text = rewritten(curly ? curly.inner : node.value, map, parserFor(key));
		if (text === 'refused') return text;
		if (text === null || text === (curly ? curly.inner : node.value)) return null;
		const written = curly ? curly.open + text + curly.close : text;
		return { patch: setPairValue(src, item, pair, { scalar: written, old: node, text: false }, layoutOf(src)), raw: written };
	}
	const inner = nestedInner(node);
	if (!inner) return null;
	const text = rewritten(`[[${inner.value as string}]]`, map, parserFor(key));
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

/**
 * Rewrites every person `link` and `portrait` and every house `arms` whose target moved, leaving
 * the rest of the body unchanged (spec §6.9, §13.0 item 3). `changed` counts values.
 */
export function rewriteLinks(first: Parsed, data: RawMap, op: RewriteLinksOp): EditResult {
	const unchanged: EditResult = { ok: true, body: first.src.text, created: [], changed: 0 };
	if (!op.map || typeof op.map !== 'object' || Array.isArray(op.map)) return refuse('bad-value', 'The link map is not a map.');
	const map = new Map<string, string>();
	for (const [k, v] of Object.entries(op.map)) {
		if (typeof v !== 'string' || v.trim() === '') return refuse('bad-value', 'A new link target is empty.');
		const key = matchKey(k);
		if (!map.has(key)) map.set(key, v.trim());
	}
	if (map.size === 0) return unchanged;

	// An item written as an alias shares the item it points to: that item is patched once.
	const resolve = (item: unknown) => (isAlias(item) ? item.resolve(first.src.doc) : item);
	const expected = clone(data) as RawMap;
	const patches: Patch[] = [];
	for (const name of ['houses', 'people'] as const) {
		const s = section(first, name);
		if (!s) continue;
		const changes = new Map<YAMLMap, Map<string, Raw>>();
		for (const item of s.seq.items) {
			const node = resolve(item);
			if (!isMap(node) || changes.has(node)) continue;
			const values = new Map<string, Raw>();
			changes.set(node, values);
			for (const key of LINK_FIELDS[name]) {
				const c = linkPatch(first, node, key, map);
				if (c === 'refused') return refuse('bad-value', 'A new link target cannot be written as a link.');
				if (!c) continue;
				patches.push(c.patch);
				values.set(key, c.raw);
			}
		}
		const items = Array.isArray(expected[name]) ? (expected[name] as Raw[]) : [];
		s.seq.items.forEach((item, k) => {
			const node = resolve(item);
			const values = isMap(node) ? changes.get(node) : undefined;
			const raw = items[k];
			if (!values || !isRawMap(raw)) return;
			for (const [key, v] of values) raw[key] = clone(v);
		});
	}
	if (patches.length === 0) return unchanged;
	// Computed on the first parse, so one step.
	const step: Step = () => patches;
	const r = finish(first, [step], expected, []);
	return r.ok ? { ...r, changed: patches.length } : r;
}
