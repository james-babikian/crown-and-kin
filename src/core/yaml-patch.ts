/*
 * Edits go through the parsed `yaml` Document (spec §3, §6.2), but are written as text patches
 * at the node ranges the Document reports: re-stringifying the Document would reformat
 * untouched lines (`[a, b]` becomes `[ a, b ]`, long lines fold). Every edit is checked by
 * parsing the new body and comparing it with the old data plus exactly the intended change;
 * if anything else differs, the edit is refused instead of written.
 */

import { isAlias, isMap, isPair, isScalar, isSeq, Lexer, parseDocument, Parser, Scalar, type Document, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import type { EditRefusal, EditResult, FieldValue, PersonField } from './edit';
import { parseBody } from './parse';
import { cropValue, sameCropText } from './portrait-crop';
import { bool, isEmpty, linkValue, str, unwrapCurlyKeys, type Raw, type RawMap } from './tolerate';
import { REFUSAL_TEXT } from './refusal-text';
import { normaliseSobriquet } from './sobriquet';

/** §4.1 and §13.0 field order; a new key goes after the nearest earlier key that is present. */
export const PERSON_ORDER = ['id', 'name', 'sobriquet', 'title', 'card-title', 'house', 'sex', 'born', 'died', 'parents', 'placement', 'illegitimate', 'childless', 'union', 'link', 'portrait', 'portrait-crop', 'notes'];
/** §4.1 and §13.0 order of the `options` keys. */
export const OPTION_ORDER = ['start', 'focus', 'me', 'generations', 'height'];
/** §4.1 and §13.0 order of the top-level sections. */
export const TOP_ORDER = ['options', 'houses', 'titles', 'people', 'unions'];

/** The person fields that hold a yes or no: `illegitimate` and `childless` (M.5). */
export const isBooleanField = (field: string): boolean => field === 'illegitimate' || field === 'childless';

/**
 * Fields read as text whatever YAML would type them as (spec §3, §6.8): a new `1103` is written
 * plain. Other fields are quoted when the core schema would see a number, boolean or null.
 */
export const TEXT_FIELDS = new Set(['id', 'house', 'card-title', 'born', 'died', 'union', 'start', 'focus', 'me', 'end']);

/** The person fields `personValue` and `sameValue` handle. */
export const PERSON_FIELDS: readonly PersonField[] = ['name', 'sobriquet', 'title', 'card-title', 'house', 'sex', 'born', 'died', 'illegitimate', 'childless', 'link', 'portrait', 'portrait-crop', 'notes', 'placement'];

/**
 * Picture keys (spec §13.0 item 3): always written in double quotes, whatever the text is, so a
 * written link never depends on what plain YAML would make of it.
 */
export const QUOTED_FIELDS: ReadonlySet<string> = new Set(['portrait', 'portrait-crop', 'arms']);

/** The failure case of an `EditResult`. */
export type Refusal = Extract<EditResult, { ok: false }>;
/** Builds a `Refusal` with this code and, optionally, a detail for the user. */
export const refuse = (code: EditRefusal, detail?: string): Refusal => (detail ? { ok: false, code, detail } : { ok: false, code });

// ---------------------------------------------------------------------------------------------
// Scalar rendering

/** How a scalar is being written: in flow or block style, whether it is a text field, and the indentation for a block scalar. */
export interface ScalarContext {
	flow: boolean;
	text: boolean;
	/** Indentation for the lines of a block scalar. */
	indent: string;
}

const PRINTABLE = /^[\t\n\x20-\x7e\x85\xa0-퟿-�\u{10000}-\u{10ffff}]*$/u;

/** Writes `v` as a double-quoted YAML scalar, escaping every character that needs it. */
export function doubleQuoted(v: string): string {
	let out = '"';
	for (const ch of v) {
		const c = ch.codePointAt(0)!;
		if (ch === '"') out += '\\"';
		else if (ch === '\\') out += '\\\\';
		else if (ch === '\n') out += '\\n';
		else if (ch === '\t') out += '\\t';
		else if (ch === '\r') out += '\\r';
		else if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || c === 0xfeff || (c >= 0xd800 && c <= 0xdfff))
			out += c <= 0xff ? `\\x${c.toString(16).padStart(2, '0')}` : `\\u${c.toString(16).padStart(4, '0')}`;
		else out += ch;
	}
	return out + '"';
}

/** Writes `v` as a block literal scalar (`|`) indented to `indent`, or null if `v` cannot be one. */
export function literal(v: string, indent: string): string | null {
	if (v === '' || !PRINTABLE.test(v)) return null;
	const chomp = v.endsWith('\n\n') ? '+' : v.endsWith('\n') ? '' : '-';
	const content = chomp === '-' ? v : v.slice(0, -1);
	return `|${chomp}` + content.split('\n').map((l) => (l === '' ? '\n' : `\n${indent}${l}`)).join('');
}

/**
 * True if `rendered` in this context reads back as exactly `value` in our reader (failsafe) and
 * in the YAML 1.2 core schema. For text fields the core value only has to print as the same text
 * (spec §3 reads them "as strings, whatever YAML typed them as"): `1103` stays plain, `0042` and
 * `null` do not.
 */
function readsBack(rendered: string, value: string, ctx: ScalarContext): boolean {
	const snippet = ctx.flow ? `{k: ${rendered}}\n` : `k: ${rendered}\n`;
	try {
		const safe = parseDocument(snippet, { schema: 'failsafe', logLevel: 'silent' });
		if (safe.errors.length || (safe.toJS() as RawMap)?.k !== value) return false;
		const core = parseDocument(snippet, { schema: 'core', logLevel: 'silent' });
		if (core.errors.length) return false;
		const read = (core.toJS() as RawMap)?.k;
		if (read === value) return true;
		return ctx.text && (typeof read === 'number' || typeof read === 'boolean') && String(read) === value;
	} catch {
		return false;
	}
}

/**
 * The text for a written value (formatting rule in `edit.ts`): the old node's style if it can
 * hold the value, else plain if plain reads back the same, else double quotes.
 */
export function renderScalar(value: string, old: Node | null | undefined, ctx: ScalarContext): string {
	const candidates: (string | null)[] = [];
	const type = isScalar(old) ? old.type : undefined;
	const oneLine = !value.includes('\n') && !value.includes('\r');
	if (type === Scalar.QUOTE_SINGLE && oneLine && PRINTABLE.test(value)) candidates.push(`'${value.replace(/'/g, "''")}'`);
	if (type === Scalar.QUOTE_DOUBLE) candidates.push(doubleQuoted(value));
	if (type === Scalar.BLOCK_LITERAL && !ctx.flow) candidates.push(literal(value, ctx.indent));
	if (type === Scalar.BLOCK_FOLDED && !ctx.flow && oneLine && value !== '') candidates.push(`>-\n${ctx.indent}${value}`);
	if (oneLine && value !== '' && value === value.trim() && PRINTABLE.test(value)) candidates.push(value);
	for (const c of candidates) if (c !== null && !hasFenceLine(c) && readsBack(c, value, ctx)) return c;
	return doubleQuoted(value);
}

/**
 * A written line that Markdown could read as a code fence would end the `dynasty` block and spill
 * the rest of the tree into the note (CommonMark allows up to 3 spaces before a closing fence).
 */
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const hasFenceLine = (text: string) => text.split('\n').some((l, n) => n > 0 && FENCE_LINE.test(l));

// ---------------------------------------------------------------------------------------------
// Text positions

/** One text replacement: `text` replaces the range `[start, end)` in the body. */
export interface Patch {
	start: number;
	end: number;
	text: string;
	/** For a removed key: the span of its own lines, whose comments may go with it. */
	allow?: [number, number];
	/** Part of a move: comments may change order, but none may be lost. */
	reorder?: boolean;
	/** Comments this patch leaves on purpose in place of the ones in `allow` (the rest of a comment it cut). */
	writes?: string[];
	/** Set by `mergeRemovals` when two removals overlapped and became this one. */
	joined?: boolean;
}

/** One parsed body, plus helpers for finding the line and column bounds of its nodes. */
export class Source {
	readonly eol: '\n' | '\r\n';

	constructor(
		readonly text: string,
		readonly doc: Document,
	) {
		const nl = text.indexOf('\n');
		this.eol = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
	}

	/** Start of the line holding `pos`. */
	lineStart(pos: number): number {
		return this.text.lastIndexOf('\n', pos - 1) + 1;
	}

	/** End of the line holding `pos`, before its line break. */
	lineEnd(pos: number): number {
		const nl = this.text.indexOf('\n', pos);
		if (nl === -1) return this.text.length;
		return nl > 0 && this.text[nl - 1] === '\r' ? nl - 1 : nl;
	}

	/** Column of `pos` on its line, 0-based. */
	column(pos: number): number {
		return pos - this.lineStart(pos);
	}

	/** Only whitespace before `pos` on its line; false for a key after a list dash (`- title: T`). */
	startsLine(pos: number): boolean {
		return this.text.slice(this.lineStart(pos), pos).trim() === '';
	}

	/** End of a node's own text, before a trailing line break (block scalars and block collections include one). */
	nodeEnd(node: Node): number {
		let e = node.range![1];
		// Lines that start before this point are text of a block scalar, even when they hold only
		// spaces: the scalar's own range says so.
		const floor = this.scalarEnd(node);
		// A block collection that ends with a comment line, or an empty value with a comment, reports
		// an end after the next line's indentation. That indentation is not the node's text.
		const ls = this.lineStart(e);
		if (ls > node.range![0] && ls < e && ls >= floor && this.text.slice(ls, e).trim() === '') e = ls;
		if (e > node.range![0] && this.text[e - 1] === '\n') {
			e--;
			if (e > node.range![0] && this.text[e - 1] === '\r') e--;
			// Blank lines after such a comment are inside the range too (not in a `|+` scalar: they are its text).
			if (!this.keepsBlankLines(node)) {
				for (let b = this.lineStart(e); b > node.range![0] && b >= floor && this.text.slice(b, e).trim() === ''; b = this.lineStart(e)) {
					e = b - 1;
					if (e > node.range![0] && this.text[e - 1] === '\r') e--;
				}
			}
		}
		return e;
	}

	/** The last value of a block node, found through the last entries of its block collections. */
	private lastLeaf(node: Node): unknown {
		let n: unknown = node;
		while ((isMap(n) || isSeq(n)) && !n.flow && n.items.length) {
			const last = n.items[n.items.length - 1] as unknown;
			n = isPair(last) ? last.value : last;
		}
		return n;
	}

	/** End of the block scalar that is the node's last value, or -1 when the node does not end with one. */
	private scalarEnd(node: Node): number {
		const n = this.lastLeaf(node);
		return isScalar(n) && n.range && (n.type === Scalar.BLOCK_LITERAL || n.type === Scalar.BLOCK_FOLDED) ? n.range[1] : -1;
	}

	/** True if the last value in the node is a block scalar (`|` or `>`). */
	endsWithBlockScalar(node: Node): boolean {
		return this.scalarEnd(node) >= 0;
	}

	/** True if the last value in the node is a block scalar with keep chomping (`|+`), whose blank lines are its text. */
	keepsBlankLines(node: Node): boolean {
		const n = this.lastLeaf(node);
		if (!isScalar(n) || !n.range || (n.type !== Scalar.BLOCK_LITERAL && n.type !== Scalar.BLOCK_FOLDED)) return false;
		return /^[|>][^\s#]*\+/.test(this.text.slice(n.range[0], n.range[0] + 8));
	}

	/**
	 * Pulls `end` (a line end) back over the whole-line comments at the end of the node that sit at
	 * or left of `col`. The range of a nested collection includes them, but they belong to what
	 * comes next. Comments deeper than `col` stay with the node.
	 */
	private beforeShallowComments(node: Node, end: number, col: number): number {
		const floor = this.scalarEnd(node);
		const run: { ls: number; le: number; comment: boolean; indent: number }[] = [];
		for (let le = end; ; ) {
			const ls = this.lineStart(le);
			if (ls <= node.range![0] || ls < floor) break;
			const raw = this.text.slice(ls, le);
			const line = raw.trim();
			if (line !== '' && !line.startsWith('#')) break;
			run.unshift({ ls, le, comment: line !== '', indent: raw.length - raw.trimStart().length });
			le = ls - 1;
			if (le > 0 && this.text[le - 1] === '\r') le--;
		}
		const k = run.findIndex((l) => l.comment && l.indent <= col);
		if (k < 0) return end;
		// Blank lines before the cut comment go with the cut text: they separate it from the node.
		let j = k - 1;
		while (j >= 0 && !run[j].comment) j--;
		if (j >= 0) return run[j].le;
		const ls0 = run[0].ls - 1;
		return ls0 > 0 && this.text[ls0 - 1] === '\r' ? ls0 - 1 : ls0;
	}

	/** Position just after the `:` of a pair (the key is a simple plain key). */
	colonEnd(pair: Pair): number {
		const keyEnd = (pair.key as Node).range![1];
		const colon = this.text.indexOf(':', keyEnd);
		return colon === -1 ? keyEnd : colon + 1;
	}

	/** True if the pair's value node holds a written value, rather than being empty (`key:` with nothing after it). */
	hasValue(pair: Pair): boolean {
		const v = pair.value as Node | null;
		return !!v && !!v.range && v.range[1] > v.range[0];
	}

	/** End of a pair's value text (or of its colon if the value is empty). */
	pairEnd(pair: Pair): number {
		return this.hasValue(pair) ? this.nodeEnd(pair.value as Node) : this.colonEnd(pair);
	}

	/** End of a node's last line, with any trailing comment, before the line break. */
	nodeLineEnd(node: Node, ownerCol?: number): number {
		const e = this.nodeEnd(node);
		// A node that ended with a line break ends exactly there (a `|+` scalar's blank lines are its content).
		const end = e < node.range![1] ? e : this.lineEnd(Math.max(e - 1, node.range![0]));
		// With `ownerCol`, comments at or left of that column are not the node's (see `beforeShallowComments`).
		return ownerCol === undefined ? end : this.beforeShallowComments(node, end, ownerCol);
	}

	/**
	 * The line after which a new key can follow a block pair: its last line, with any trailing comment.
	 * With `ownCol` (the column of the pair's key), comments at or left of it are not part of the pair.
	 */
	pairLineEnd(pair: Pair, ownCol?: number): number {
		return this.hasValue(pair) ? this.nodeLineEnd(pair.value as Node, ownCol) : this.lineEnd(this.colonEnd(pair));
	}

	/**
	 * Start of the comment lines directly above `lineStart`, so they stay with that line. `floor`
	 * is where the previous entry ends: a block scalar line starting with `#` above it is text.
	 */
	withCommentsAbove(lineStart: number, floor: number): number {
		let at = lineStart;
		while (at > 0) {
			const prevStart = this.lineStart(at - 1);
			if (prevStart <= floor || !this.text.slice(prevStart, at).trim().startsWith('#')) break;
			at = prevStart;
		}
		return at;
	}
}

const keyOf = (pair: Pair): string | undefined => (isScalar(pair.key) ? str(pair.key.value) : undefined);

/** The pair of `map` with this key, or undefined. */
export function findPair(map: YAMLMap, key: string): Pair | undefined {
	return (map.items as Pair[]).find((p) => keyOf(p) === key);
}

const rankIn = (order: string[], key: string | undefined) => (key === undefined ? -1 : order.indexOf(key));

/** Indentation habits read from a body, so lines a patch adds match the ones already there. */
export interface Layout {
	/** Columns from a key to the items of its nested map. */
	mapIndent: number;
	/** Columns from a key to the dashes of its block list. */
	seqIndent: number;
	/** Columns from a dash to the keys of a map item. */
	itemIndent: number;
}

/** Reads the indentation habits of a body's top-level lists and maps. */
export function layoutOf(src: Source): Layout {
	const layout: Layout = { mapIndent: 2, seqIndent: 2, itemIndent: 2 };
	const top = src.doc.contents;
	if (!isMap(top) || top.flow) return layout;
	let seqSeen = false;
	let mapSeen = false;
	for (const pair of top.items as Pair[]) {
		const v = pair.value;
		const keyCol = src.column((pair.key as Node).range![0]);
		if (isSeq(v) && !v.flow && v.range && !seqSeen) {
			seqSeen = true;
			layout.seqIndent = Math.max(0, src.column(v.range[0]) - keyCol);
			const first = v.items[0];
			if (isMap(first) && !first.flow && first.range && first.items.length) {
				const k = (first.items[0] as Pair).key as Node;
				layout.itemIndent = Math.max(1, src.column(k.range![0]) - src.column(v.range[0]));
			}
		} else if (isMap(v) && !v.flow && v.range && !mapSeen) {
			mapSeen = true;
			layout.mapIndent = Math.max(1, src.column(v.range[0]) - keyCol);
		}
	}
	return layout;
}

/**
 * Lines of a new block list item under a key: the dash, then the item's keys the same number of
 * columns after it as in the existing items (`-   key` is written by some tools, so not always 2).
 */
export function itemBlock(layout: Layout, block: string[]): string[] {
	const pad = ' '.repeat(layout.seqIndent);
	const itemPad = ' '.repeat(layout.seqIndent + layout.itemIndent);
	return block.map((l, n) => (n === 0 ? `${pad}-${' '.repeat(Math.max(1, layout.itemIndent - 1))}${l}` : itemPad + l));
}

/** A value to write under a key: a scalar, or block lines (relative, first line at the key's child indentation). */
export type NewValue = { scalar: string; old?: Node | null; text: boolean } | { block: string[]; flow: string } | { raw: string };

function scalarText(src: Source, value: Extract<NewValue, { scalar: string }>, flow: boolean, keyCol: number, layout: Layout): string {
	let indent = ' '.repeat(keyCol + layout.mapIndent);
	// A block scalar keeps its own indentation.
	if (isScalar(value.old) && value.old.range && (value.old.type === Scalar.BLOCK_LITERAL || value.old.type === Scalar.BLOCK_FOLDED)) {
		const m = /\n([ ]+)\S/.exec(src.text.slice(value.old.range[0], value.old.range[1]));
		if (m && m[1].length > keyCol) indent = m[1];
	}
	return renderScalar(value.scalar, value.old, { flow, text: value.text, indent });
}

/** Text after `key:` for a new value in a block map whose keys sit at `keyCol`. */
function valueAfterKey(src: Source, value: NewValue, flow: boolean, keyCol: number, layout: Layout): string {
	if ('raw' in value) return ' ' + value.raw;
	if ('scalar' in value) return ' ' + scalarText(src, value, flow, keyCol, layout);
	if (flow) return ' ' + value.flow;
	return value.block.map((l) => '\n' + ' '.repeat(keyCol) + l).join('');
}

// ---------------------------------------------------------------------------------------------
// Map and list patches

/** Changes the value of an existing pair. */
export function setPairValue(src: Source, map: YAMLMap, pair: Pair, value: NewValue, layout: Layout): Patch {
	const keyCol = src.column((pair.key as Node).range![0]);
	const flow = !!map.flow;
	if (!src.hasValue(pair) || !('scalar' in value)) {
		// Empty value (`options:`), or a structure replacing whatever was there.
		const at = src.colonEnd(pair);
		const end = src.hasValue(pair) ? src.nodeEnd(pair.value as Node) : at;
		if ('scalar' in value || 'raw' in value || flow) return { start: at, end, text: valueAfterKey(src, value, flow, keyCol, layout) };
		// Block lines go after any comment on the key's line.
		const lineEnd = src.lineEnd(at);
		return { start: src.hasValue(pair) ? at : lineEnd, end: src.hasValue(pair) ? end : lineEnd, text: valueAfterKey(src, value, false, keyCol, layout) };
	}
	const node = pair.value as Node;
	let text = scalarText(src, value, flow, keyCol, layout);
	// The comment on the header line of a block scalar (`notes: |- # keep`) is inside the node's
	// range, so the new text must carry it on its first line.
	const block = isScalar(node) && (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED);
	const header = block ? /^[|>][^\s#]*([ \t]+#[^\r\n]*)/.exec(src.text.slice(node.range![0], src.lineEnd(node.range![0]))) : null;
	if (header) text = text.replace(/^[^\n]*/, (first) => first + header[1]);
	return { start: node.range![0], end: src.nodeEnd(node), text };
}

/**
 * Adds `key` to a map: directly before the first key there that comes later in `order` (above
 * the full-line comments attached to it), or else after the map's last entry. Unknown keys have
 * no place in the order, so they never decide the position. Top-level sections get a blank
 * line between them.
 */
export function addPair(src: Source, map: YAMLMap, key: string, value: NewValue, order: string[], layout: Layout): Patch {
	const pairs = map.items as Pair[];
	const rank = rankIn(order, key);
	const nextIndex = pairs.findIndex((p) => rankIn(order, keyOf(p)) > rank);
	const next = nextIndex >= 0 ? pairs[nextIndex] : undefined;
	const last = pairs[pairs.length - 1];
	if (map.flow) {
		const pair = `${key}:${valueAfterKey(src, value, true, 0, layout)}`;
		if (next) return insertAt((next.key as Node).range![0], `${pair}, `);
		if (last) return insertAt(src.pairEnd(last), `, ${pair}`);
		return insertAt(src.text.indexOf('{', map.range![0]) + 1, pair);
	}
	const keyCol = src.column((pairs[0].key as Node).range![0]);
	const line = `${key}:${valueAfterKey(src, value, false, keyCol, layout)}`;
	const isTop = map === src.doc.contents;
	if (next) {
		const keyStart = (next.key as Node).range![0];
		// The key after a list dash (`- title: T`): the new key takes the dash line.
		if (!src.startsLine(keyStart)) return insertAt(keyStart, line + '\n' + ' '.repeat(keyCol));
		// Above a map's first key there is only its parent's key or dash line, which is not a
		// comment, so the walk stops there. The map's range starts at that key, not at its comments.
		const floor = nextIndex > 0 ? src.pairLineEnd(pairs[nextIndex - 1]) : -1;
		const at = src.withCommentsAbove(src.lineStart(keyStart), floor);
		return insertAt(at, ' '.repeat(keyCol) + line + '\n' + (isTop ? '\n' : ''));
	}
	return insertAt(src.pairLineEnd(last), (isTop ? '\n' : '') + '\n' + ' '.repeat(keyCol) + line);
}

/** Removes a pair and only its own lines. */
export function removePair(src: Source, map: YAMLMap, pair: Pair): Patch {
	const pairs = map.items as Pair[];
	const i = pairs.indexOf(pair);
	const keyStart = (pair.key as Node).range![0];
	const text = src.text;
	if (map.flow) {
		const end = src.pairEnd(pair);
		const own: [number, number] = [keyStart, end];
		// The pair and the comma after it; the last pair takes the comma before it instead. Comments
		// between pairs are never inside the span.
		const after = /^[ \t]*,[ \t]*/.exec(text.slice(end));
		// A pair alone on its lines goes with them, so no line of spaces stays.
		const wholeLine = (cut: number): Patch => {
			const ls = src.lineStart(keyStart);
			const le = src.lineEnd(cut);
			if (text.slice(ls, keyStart).trim() !== '' || text.slice(cut, le).trim() !== '' || le >= text.length) return { start: keyStart, end: cut, text: '', allow: own };
			return { start: ls, end: text.indexOf('\n', le) + 1, text: '', allow: own };
		};
		if (after && i < pairs.length - 1) return wholeLine(end + after[0].length);
		const before = /,[ \t\r\n]*$/.exec(text.slice(0, keyStart));
		if (before && i > 0) return { start: before.index, end, text: '', allow: own };
		return wholeLine(end);
	}
	// Comments after the value that sit at or left of the key belong to what follows (the next key or item).
	const end = src.pairLineEnd(pair, src.column(keyStart));
	if (!src.startsLine(keyStart)) {
		// The key follows a dash (`- title: T`): what comes next (a key or a comment) moves up onto
		// the dash line.
		const rest = /^\s*/.exec(text.slice(end))![0];
		const nextAt = end + rest.length;
		if (i < pairs.length - 1 && nextAt < text.length && src.column(nextAt) >= src.column(keyStart)) {
			return { start: keyStart, end: nextAt, text: '', allow: [keyStart, end] };
		}
		return { start: keyStart, end, text: '', allow: [keyStart, end] };
	}
	const start = src.lineStart(keyStart);
	if (end < src.text.length) {
		let after = src.text.indexOf('\n', end) + 1;
		// A block scalar right before the key would swallow what is left under the key's lines.
		const prevValue = i > 0 && src.hasValue(pairs[i - 1]) ? (pairs[i - 1].value as Node) : null;
		if (prevValue && src.endsWithBlockScalar(prevValue)) return removeAfterBlockScalar(src, start, end, after, src.column(keyStart), src.keepsBlankLines(prevValue));
		// A top-level section at the start, after a blank line or after a comment line takes its
		// trailing blank lines too, so the body neither starts with a blank line nor gets two in a
		// row. After another section's last line the blank line stays to keep the sections apart.
		const prevLine = start === 0 ? '' : src.text.slice(src.lineStart(start - 1), start).trim();
		if (map === src.doc.contents && (prevLine === '' || prevLine.startsWith('#'))) {
			for (let m = /^[ \t]*\r?\n/.exec(src.text.slice(after)); m && after < src.text.length; m = /^[ \t]*\r?\n/.exec(src.text.slice(after))) after += m[0].length;
		}
		return { start, end: after, text: '', allow: [start, end] };
	}
	// The last line of the body: take the line break before it instead, and for a last top-level
	// section the blank lines that kept it apart.
	let before = start > 0 ? (start >= 2 && src.text[start - 2] === '\r' ? start - 2 : start - 1) : start;
	if (map === src.doc.contents) {
		for (let m = /\r?\n[ \t]*$/.exec(src.text.slice(0, before)); m && m.index > 0; m = /\r?\n[ \t]*$/.exec(src.text.slice(0, before))) before = m.index;
	}
	return { start: before, end, text: '', allow: [start, end] };
}

/**
 * Removes a block pair whose previous pair ends with a block scalar. Comment lines indented deeper
 * than the key (and blank lines before them) would join the scalar's text once the key is gone, so
 * the comments move to the key's column, which ends the scalar. Blank lines right after the key
 * would join a `|+` scalar, which keeps every blank line, so they go with the key.
 */
function removeAfterBlockScalar(src: Source, start: number, end: number, after: number, keyCol: number, keep: boolean): Patch {
	const text = src.text;
	const lines: { start: number; end: number; comment: boolean }[] = [];
	for (let at = after; at < text.length; ) {
		const nl = text.indexOf('\n', at);
		const next = nl === -1 ? text.length : nl + 1;
		const raw = text.slice(at, nl === -1 ? text.length : nl).replace(/\r$/, '');
		const t = raw.trim();
		if (t !== '' && !(t.startsWith('#') && raw.length - raw.trimStart().length > keyCol)) break;
		lines.push({ start: at, end: next, comment: t !== '' });
		at = next;
	}
	let last = lines.length - 1;
	while (last >= 0 && !lines[last].comment) last--;
	const allow: [number, number] = [start, end];
	if (last < 0) return { start, end: keep && lines.length ? lines[lines.length - 1].end : after, text: '', allow };
	// Blank lines after the last deeper comment stay: they follow a comment that already ends the scalar.
	const run = lines.slice(0, last + 1);
	const from = keep ? run.findIndex((l) => l.comment) : 0;
	const moved = run.slice(from).map((l) => (l.comment ? ' '.repeat(keyCol) + text.slice(l.start, l.end).trimStart() : text.slice(l.start, l.end)));
	return { start, end: run[last].end, text: moved.join(''), allow };
}

/**
 * Appends an item to a list. `block` lines are relative to the dash; `flow` is the one-line form.
 * `end` is where the last item's own text ends in a block list (`itemEnd`, with the comments it owns);
 * by default the end of its last line.
 */
export function appendItem(src: Source, seq: YAMLSeq, block: string[], flow: string, end?: number): Patch {
	const items = seq.items as Node[];
	if (seq.flow) {
		const last = items[items.length - 1];
		if (last?.range) return insertAt(src.nodeEnd(last), `, ${flow}`);
		return insertAt(src.text.indexOf('[', seq.range![0]) + 1, flow);
	}
	const last = items[items.length - 1];
	const dashCol = src.column(seq.range![0]);
	const at = end ?? src.nodeLineEnd(last);
	// Items written as one-line flow maps get a new one-line item.
	if (isMap(last) && last.flow) return insertAt(at, '\n' + ' '.repeat(dashCol) + '- ' + flow);
	let itemCol = dashCol + 2;
	if (isMap(last) && last.items.length) itemCol = src.column(((last.items[0] as Pair).key as Node).range![0]);
	const lines = block.map((l, n) => (n === 0 ? ' '.repeat(dashCol) + '-' + ' '.repeat(Math.max(1, itemCol - dashCol - 1)) + l : ' '.repeat(itemCol) + l));
	return insertAt(at, lines.map((l) => '\n' + l).join(''));
}

/** A patch that inserts `text` at `at` without removing anything. */
export const insertAt = (at: number, text: string): Patch => ({ start: at, end: at, text });

// ---------------------------------------------------------------------------------------------
// Checks

function deepEqual(a: Raw, b: Raw): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((x, i) => deepEqual(x, b[i]));
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as RawMap)[k], (b as RawMap)[k]));
}

/** A deep copy of a raw YAML value, safe for an op to mutate while building its expected data. */
export const clone = (v: Raw): Raw => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** One parsed body: its `Source` and the raw data `toJS` gave for it. */
export type Parsed = { src: Source; data: Raw };

/** A value's text as written (comments after it left out), for `linkValue`; undefined when there is no node. */
export function sourceText(doc: Document, text: string, path: (string | number)[]): string | undefined {
	try {
		const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
		return node?.range ? text.slice(node.range[0], node.range[1]) : undefined;
	} catch {
		return undefined;
	}
}

/** Parses a body into a `Parsed`, or a `Refusal` if it does not parse. */
export function parse(body: string): Parsed | Refusal {
	const parsed = parseBody(body);
	if (!parsed.ok) return refuse('invalid-yaml', parsed.error.detail ?? parsed.error.code);
	return { src: new Source(body, parsed.doc), data: parsed.data };
}

/** True if `v` is a `Refusal`. */
export const isRefusal = (v: unknown): v is Refusal => typeof v === 'object' && v !== null && (v as Refusal).ok === false;

// ---------------------------------------------------------------------------------------------
// Steps: one change each, on a fresh parse of the current text

/** A step gives one patch, or several computed on the same parse (applied together, in order for equal positions). */
export type Step = (p: Parsed) => Patch | Patch[] | null | Refusal;

/** The detail text used when two patches computed in one step would overlap. */
export const OVERLAP = 'Patches overlap.';
const LEXER_ONLY = new Set(['\x02', '\x18', '\x1f']);

/** Every comment of a body, with its offset. Comment-like text in scalars is not a comment. */
export function commentsOf(text: string): { offset: number; text: string }[] {
	const out: { offset: number; text: string }[] = [];
	let offset = 0;
	let exact = true;
	for (const token of new Lexer().lex(text)) {
		// The lexer adds a few one-character markers that are not in the text.
		if (LEXER_ONLY.has(token)) continue;
		if (token.startsWith('#')) {
			if (!text.startsWith(token, offset)) exact = false;
			out.push({ offset, text: token.trimEnd() });
		}
		offset += token.length;
	}
	if (exact) return out;
	const walked: { offset: number; text: string }[] = [];
	const walk = (v: unknown): void => {
		if (!v || typeof v !== 'object') return;
		if (Array.isArray(v)) return v.forEach(walk);
		const t = v as { type?: unknown; offset?: unknown; source?: unknown };
		if (t.type === 'comment' && typeof t.offset === 'number' && typeof t.source === 'string') {
			walked.push({ offset: t.offset, text: t.source.trimEnd() });
			return;
		}
		for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
	};
	for (const token of new Parser().parse(text)) walk(token);
	return walked.sort((a, b) => a.offset - b.offset);
}

/**
 * Two removals may share a line break (a removed key right above a removed last item, which
 * takes the break before it). Removed text is removed either way, so they become one patch.
 */
export function mergeRemovals(patches: Patch[]): Patch[] {
	const removals = patches.filter((p) => p.text === '' && p.end > p.start).sort((a, b) => a.start - b.start);
	if (removals.length < 2) return patches;
	const merged: Patch[] = [];
	for (const p of removals) {
		const last = merged[merged.length - 1];
		if (!last || p.start >= last.end) {
			merged.push({ ...p });
			continue;
		}
		last.end = Math.max(last.end, p.end);
		last.joined = true;
		const allow = [last.allow ?? [last.start, last.start], p.allow ?? [p.start, p.start]];
		last.allow = [Math.min(allow[0][0], allow[1][0]), Math.max(allow[0][1], allow[1][1])];
	}
	return [...patches.filter((p) => !(p.text === '' && p.end > p.start)), ...merged];
}

/** Applies patches computed on one parse; null if they overlap. */
function applyPatches(src: Source, patches: Patch[]): string | null {
	const order = patches.map((p, n) => ({ p, n })).sort((a, b) => b.p.start - a.p.start || b.p.end - a.p.end || b.n - a.n);
	let text = src.text;
	for (let k = 0; k < order.length; k++) {
		const cur = order[k].p;
		const prev = order[k - 1]?.p;
		if (prev && (cur.end > prev.start || (cur.start === prev.start && cur.end > cur.start && prev.end > prev.start))) return null;
		const insert = src.eol === '\r\n' ? cur.text.replace(/\r?\n/g, '\r\n') : cur.text;
		text = text.slice(0, cur.start) + insert + text.slice(cur.end);
	}
	return text;
}

/** `first` is the parse of `body` the op was checked with; the first step reuses it (a large tree parses in tens of ms). */
export function run(body: string, steps: Step[], first: Parsed): string | Refusal {
	let text = body;
	for (const [n, step] of steps.entries()) {
		const p = n === 0 ? first : parse(text);
		if (isRefusal(p)) return p;
		const result = step(p);
		if (isRefusal(result)) return result;
		const patches = mergeRemovals(result === null ? [] : Array.isArray(result) ? result : [result]);
		if (patches.length === 0) continue;
		// Removals that merged into one up to the end of a body with no final line break: the line
		// break before them goes too, so the body does not gain one.
		for (const pt of patches) {
			const t = p.src.text;
			// Two removals of neighbouring pairs of a flow map can join into whole lines without their
			// line break (each alone took a different one): the break goes too, so no empty line stays.
			if (pt.joined && pt.text === '' && (pt.start === 0 || t[pt.start - 1] === '\n') && t[pt.end - 1] !== '\n' && (t[pt.end] === '\n' || (t[pt.end] === '\r' && t[pt.end + 1] === '\n'))) {
				pt.end += t[pt.end] === '\r' ? 2 : 1;
				continue;
			}
			if (pt.text !== '' || pt.end !== t.length || t.endsWith('\n') || pt.start === 0 || t[pt.start - 1] !== '\n' || t[pt.start] === '\n' || t[pt.start] === '\r') continue;
			pt.start -= pt.start >= 2 && t[pt.start - 2] === '\r' ? 2 : 1;
		}
		const next = applyPatches(p.src, patches);
		if (next === null) return refuse('bad-value', OVERLAP);
		// The data check cannot see comments: every comment must survive, except those on the
		// lines of a removed key or item. A move keeps every comment but changes their order.
		let kept = commentsOf(text)
			.filter((c) => !patches.some((pt) => pt.allow && c.offset >= pt.allow[0] && c.offset < pt.allow[1]))
			.map((c) => c.text);
		let now = commentsOf(next).map((c) => c.text);
		for (const w of patches.flatMap((pt) => pt.writes ?? [])) {
			const at = now.indexOf(w);
			if (at >= 0) now.splice(at, 1);
		}
		if (patches.some((pt) => pt.reorder)) {
			kept = kept.sort();
			now = now.sort();
		}
		if (kept.length !== now.length || kept.some((c, i) => c !== now[i])) {
			return refuse('bad-value', REFUSAL_TEXT.commentWouldChange);
		}
		text = next;
	}
	return text;
}

/** The top-level map, or null for an empty body. */
export function topMap(p: Parsed): YAMLMap | null | Refusal {
	const top = p.src.doc.contents;
	if (top === null || (isScalar(top) && isEmpty(top.value))) return null;
	if (!isMap(top)) return refuse('invalid-yaml', 'The top level is not a map.');
	return top;
}

/** Adds a top-level section, creating the top-level map in an empty body. */
export function addSection(p: Parsed, key: string, value: Extract<NewValue, { block: string[] }>): Patch | Refusal {
	const top = topMap(p);
	if (isRefusal(top)) return top;
	const layout = layoutOf(p.src);
	if (top) return addPair(p.src, top, key, value, TOP_ORDER, layout);
	const text = p.src.text;
	const section = `${key}:` + value.block.map((l) => '\n' + l).join('');
	if (text.trim() === '') return { start: 0, end: text.length, text: section };
	// A body of comments only: the section goes after them, and a final line break stays last.
	return insertAt(text.length, text.endsWith('\n') ? section + '\n' : '\n' + section);
}

// ---------------------------------------------------------------------------------------------
// Shared by the ops

/** Checks and normalises one person field's new value, or refuses it (spec §4.1). */
export function personValue(field: PersonField, value: FieldValue): { write: string | null } | Refusal {
	if (isBooleanField(field)) {
		if (value === null || value === false) return { write: null };
		if (value === true) return { write: 'true' };
		return refuse('bad-value', `${field} must be true, false or null.`);
	}
	// Callers outside TypeScript can pass anything (spec §8: refuse, never throw).
	if (value !== null && typeof value !== 'string') return refuse('bad-value', `${field} must be text.`);
	if (field === 'name') {
		if (value === null || value.trim() === '') return refuse('bad-value', REFUSAL_TEXT.personName);
		return { write: value };
	}
	if (value === null || value.trim() === '') return { write: null };
	return { write: value };
}

/**
 * True if the model would read the same value either way, so nothing needs writing. `written` gives
 * the value's source text: `parse.ts` reads an unquoted [[x,y]] as that text, so it is compared so here.
 */
export function sameValue(field: PersonField, raw: Raw, write: string | null, written?: () => string | undefined): boolean {
	if (isBooleanField(field)) return bool(raw) === (write === 'true');
	// Two parts are the same when their numbers agree at 4 decimals, whatever the source text (spec §13.13).
	if (field === 'portrait-crop') return sameCropText(cropValue(raw), write === null ? undefined : write);
	// The model unwraps a pair of marks around a sobriquet, so the old and the new text are compared the way the model reads them.
	if (field === 'sobriquet') return normaliseSobriquet(str(raw)) === normaliseSobriquet(write === null ? undefined : str(write));
	const read = field === 'link' || field === 'portrait' ? linkValue(raw, written) : str(raw);
	return read === (write === null ? undefined : str(write));
}

/** The person item at `index` in the parsed body's `people` list, or a refusal. */
export function personNode(p: Parsed, index: number): YAMLMap | Refusal {
	const top = topMap(p);
	if (isRefusal(top)) return top;
	const people = top?.get('people', true);
	const item = isSeq(people) ? people.items[index] : undefined;
	if (isAlias(item)) return refuse('bad-value', 'This person is written as a YAML alias. Edit the note text.');
	if (!isMap(item)) return refuse('unknown-person');
	return item;
}

/** Runs the steps and accepts the new body only if it reads back as exactly the expected data. */
export function finish(first: Parsed, steps: Step[], expected: RawMap, created: string[]): EditResult {
	if (steps.length === 0) return { ok: true, body: first.src.text, created };
	const out = run(first.src.text, steps, first);
	if (isRefusal(out)) return out;
	const check = parseBody(out);
	// The new body is read with the curly pairs taken off structural values (D103), so the expected data is too.
	unwrapCurlyKeys(expected);
	if (!check.ok || !deepEqual(isEmpty(check.data) ? {} : check.data, expected)) {
		return refuse('bad-value', REFUSAL_TEXT.otherValuesWouldChange);
	}
	remember(out, check.data);
	return { ok: true, body: out, created };
}

/**
 * The raw data of the bodies parsed during the current write, so the once-per-write cleanup
 * (`cleanCardTitles`) does not parse a large tree again (a parse of sample tree 7 takes about
 * 25 ms). Read only: every op clones the data before it changes it. `applyOp` clears it after each
 * write, so a large tree's data is not kept after the write.
 */
const recent: { body: string; data: Raw }[] = [];

/** Keeps the raw data of a parsed body for `recall`. */
export function remember(body: string, data: Raw): void {
	recent.unshift({ body, data });
	if (recent.length > 4) recent.length = 4;
}

/** The raw data of `body` if it was parsed last, else undefined. Do not change it. */
export function recall(body: string): Raw | undefined {
	return recent.find((r) => r.body === body)?.data;
}

/** Clears the data kept for `recall`; `applyOp` calls it at the end of every write. */
export function forget(): void {
	recent.length = 0;
}

/**
 * Runs several changes computed on one parse as one step. If two of them touch the same text, it
 * runs them again as one step each, each on a fresh parse.
 */
export function finishTogether(first: Parsed, steps: Step[], expected: RawMap, created: string[]): EditResult {
	if (steps.length < 2) return finish(first, steps, expected, created);
	const together: Step = (p) => {
		const patches: Patch[] = [];
		for (const step of steps) {
			const r = step(p);
			if (isRefusal(r)) return r;
			if (r) patches.push(...(Array.isArray(r) ? r : [r]));
		}
		return patches;
	};
	const r = finish(first, [together], expected, created);
	return !r.ok && r.detail === OVERLAP ? finish(first, steps, expected, created) : r;
}
