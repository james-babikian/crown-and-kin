/*
 * Link maintenance (spec §6.9, D6, §13.0 item 3). The core only reads and rewrites link text; the
 * plugin resolves targets against the vault and passes the old → new map. The values it handles
 * are a person's `link`, `portrait` and `arms`, a house's `arms` and the option `calendar` (the calendar note of the
 * tree, spec §14 rule 7; it is a note link, read like `link`). A link is read in the forms the
 * renderer opens (see `picture-link.ts`). `parsePictureLink` there is shared with `pictures.ts`, so a
 * rename and the picture lookup read a picture link the same way.
 */

import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar, type Node, type YAMLMap } from 'yaml';
import type { EditResult, RewriteLinksOp } from './edit';
import { parseBody } from './parse';
import { parseLink, parsePictureLink } from './picture-link';
import { pictureFormat } from './pictures';
import { curlyParts, isMap as isRawMap, linkValue, type Raw, type RawMap } from './tolerate';
import { section } from './yaml-list';
import { clone, doubleQuoted, findPair, finish, isRefusal, layoutOf, refuse, renderScalar, setPairValue, sourceText, topMap, type Parsed, type Patch, type Source, type Step } from './yaml-patch';

/** Percent-encodes what a Markdown link destination cannot hold as written (the rename search looks for this form too). */
export const encode = (s: string) => s.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** The link parser of a field: pictures read a bare leading "!" as an embed mark. */
const parserFor = (key: string) => (key === 'link' || key === 'calendar' ? parseLink : parsePictureLink);

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
const LINK_FIELDS: Record<'houses' | 'people', readonly string[]> = { houses: ['arms'], people: ['link', 'portrait', 'arms'] };

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
			if (name === 'options' && isRawMap(items)) {
				// The calendar note of the tree (spec §14 rule 7) is a note link, like a person `link`.
				const text = linkValue(items.calendar, () => sourceText(parsed.doc, body, ['options', 'calendar']));
				const parts = text === undefined ? null : parseLink(text);
				if (parts) out.push(parts.target);
				continue;
			}
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

/**
 * The text inside an unquoted `[[Note]]` value and the style of its scalar. A comma in the name
 * (`[[Smith, John]]`) makes YAML read several items, so then the text as written is the link.
 */
function nestedInner(src: Source, node: Node): { value: string; type: Scalar.Type | undefined } | null {
	if (!isSeq(node) || node.items.length !== 1) return null;
	const mid = node.items[0];
	if (!isSeq(mid) || mid.items.length < 1) return null;
	if (mid.items.length === 1) {
		const inner = mid.items[0];
		return isScalar(inner) && typeof inner.value === 'string' ? { value: inner.value, type: inner.type } : null;
	}
	if (!mid.items.every((x) => isScalar(x) && typeof x.value === 'string')) return null;
	const written = src.text.slice(node.range![0], src.nodeEnd(node)).trim();
	return /^\[\[[^\r\n]*\]\]$/.test(written) ? { value: written.slice(2, -2), type: Scalar.PLAIN } : null;
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
	const inner = nestedInner(src, node);
	if (!inner) return null;
	const text = rewritten(`[[${inner.value}]]`, map, parserFor(key));
	if (text === 'refused') return text;
	if (text === null || text === `[[${inner.value}]]`) return null;
	const newInner = text.slice(2, -2);
	const nested =
		inner.type === Scalar.QUOTE_DOUBLE ? `[[${doubleQuoted(newInner)}]]` : inner.type === Scalar.QUOTE_SINGLE ? `[['${newInner.replace(/'/g, "''")}']]` : `[[${newInner}]]`;
	const range = { start: node.range![0], end: src.nodeEnd(node) };
	if (nestedReadsBack(nested, newInner, flow)) return { patch: { ...range, text: nested }, raw: [[newInner]] };
	// The nested form cannot hold the new text (for example a comma): the value-quoting rule (spec §3) applies.
	return { patch: { ...range, text: renderScalar(text, null, { flow, text: false, indent: '' }) }, raw: text };
}

/** The patch for `options.calendar` (the link to the calendar note of the tree), with the expected data updated; null when it does not change. */
function optionsLink(first: Parsed, expected: RawMap, map: Map<string, string>): Patch | null | 'refused' {
	const top = topMap(first);
	if (!top || isRefusal(top)) return null;
	const node = findPair(top, 'options')?.value;
	if (!isMap(node)) return null;
	const c = linkPatch(first, node, 'calendar', map);
	if (!c || c === 'refused') return c;
	if (isRawMap(expected.options)) expected.options.calendar = clone(c.raw);
	return c.patch;
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
	const calendar = optionsLink(first, expected, map);
	if (calendar === 'refused') return refuse('bad-value', 'A new link target cannot be written as a link.');
	if (calendar) patches.push(calendar);
	if (patches.length === 0) return unchanged;
	// Computed on the first parse, so one step.
	const step: Step = () => patches;
	const r = finish(first, [step], expected, []);
	return r.ok ? { ...r, changed: patches.length } : r;
}
