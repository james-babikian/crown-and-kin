/*
 * List items and their text spans, for the ops that add, move and remove list items.
 *
 * Lines a list item owns (the decision notes "Relationship-op details"): its own lines with their
 * end-of-line comments, the full-line comments right below it indented deeper than its dash,
 * and the full-line comments directly above it at or left of its dash, up to the previous item or
 * a blank line. In a flow list, an end-of-line comment belongs to the item it follows. A move
 * takes all of them; a removal keeps the comments above the item, except for a holder of a title,
 * which goes "with its comments" (spec §13.4).
 */

import { isMap, isScalar, isSeq, type Node, type Pair, type YAMLMap, type YAMLSeq } from 'yaml';
import { isEmpty } from './tolerate';
import {
	addSection, findPair, insertAt, isRefusal, itemBlock, layoutOf, mergeRemovals, refuse, removePair, setPairValue, topMap, type Parsed, type Patch, type Refusal, type Source,
} from './yaml-patch';

/** The position of the item's dash (its own start in a flow list). */
export function dashOf(src: Source, node: Node): number {
	let p = node.range![0] - 1;
	for (;;) {
		while (p >= 0 && /\s/.test(src.text[p])) p--;
		// A hyphen inside a comment (`# see Jean-`) is text, not a dash.
		if (p >= 0 && src.text[p] === '-' && !/(^|[ \t])#/.test(src.text.slice(src.lineStart(p), p))) return p;
		if (p < 0) return node.range![0];
		// Comments between the dash and the item's first text: `- # note`, or lines of their own.
		const start = src.lineStart(p);
		const line = src.text.slice(start, src.lineEnd(p));
		const m = /^[ \t]*(-[ \t]+)?#/.exec(line);
		if (!m) return node.range![0];
		if (m[1]) return start + m[0].indexOf('-');
		p = start - 1;
	}
}

const lineAfter = (src: Source, end: number): [number, number] | null => {
	const nl = src.text.indexOf('\n', end);
	if (nl === -1) return null;
	return [nl + 1, src.lineEnd(nl + 1)];
};

const indentOf = (line: string) => line.length - line.trimStart().length;
const isCommentLine = (line: string) => line.trimStart().startsWith('#');

/**
 * End of an item's own text, before the line break: its last line with any end-of-line comment,
 * then the full-line comments right below it that are indented deeper than its dash.
 */
export function itemEnd(src: Source, seq: YAMLSeq, i: number): number {
	const node = seq.items[i] as Node;
	if (seq.flow) return src.nodeEnd(node);
	const dashCol = src.column(dashOf(src, node));
	// The range of a nested collection includes shallower comment lines; they belong to the next item (see `itemStart`).
	let end = src.nodeLineEnd(node, dashCol);
	for (let next = lineAfter(src, end); next; next = lineAfter(src, end)) {
		const line = src.text.slice(next[0], next[1]);
		if (!isCommentLine(line) || indentOf(line) <= dashCol) break;
		end = next[1];
	}
	return end;
}

/** Start of an item's own lines (from its dash line). */
function ownStart(src: Source, seq: YAMLSeq, i: number): number {
	const node = seq.items[i] as Node;
	return seq.flow ? node.range![0] : src.lineStart(dashOf(src, node));
}

/** Start of an item's text with the comment lines it owns above it: at or left of its dash, up to the previous item or a blank line. */
export function itemStart(src: Source, seq: YAMLSeq, i: number): number {
	if (seq.flow) return ownStart(src, seq, i);
	const dashCol = src.column(dashOf(src, seq.items[i] as Node));
	const floor = i > 0 ? itemEnd(src, seq, i - 1) : -1;
	let at = ownStart(src, seq, i);
	while (at > 0) {
		const prev = src.lineStart(at - 1);
		const line = src.text.slice(prev, src.lineEnd(prev));
		if (prev <= floor || !isCommentLine(line) || indentOf(line) > dashCol) break;
		at = prev;
	}
	return at;
}

/** The end-of-line comment a flow item owns: after it on its line, with at most a comma between. */
export function flowComment(src: Source, seq: YAMLSeq, i: number): { start: number; end: number; gap: number } | null {
	const e = src.nodeEnd(seq.items[i] as Node);
	const m = /^([ \t]*,?)([ \t]*)#/.exec(src.text.slice(e, src.lineEnd(e)));
	if (!m) return null;
	return { start: e + m[0].length - 1, end: src.lineEnd(e), gap: m[1].includes(',') ? e + m[1].length : e };
}

/** Flow items i..j alone on their lines: only spaces before, and at most a comma and a comment after. */
function flowAlone(src: Source, seq: YAMLSeq, i: number, j: number): boolean {
	const s = (seq.items[i] as Node).range![0];
	const e = src.nodeEnd(seq.items[j] as Node);
	return src.text.slice(src.lineStart(s), s).trim() === '' && /^[ \t]*,?[ \t]*(#.*)?$/.test(src.text.slice(e, src.lineEnd(e)));
}

/** Removes flow items i..j. Items alone on their lines go with their lines and end-of-line comments. */
function removeFlowRun(src: Source, seq: YAMLSeq, i: number, j: number): Patch[] {
	const n = seq.items.length;
	const own: [number, number] = [(seq.items[i] as Node).range![0], src.nodeEnd(seq.items[j] as Node)];
	const runItems = Array.from({ length: j - i + 1 }, (_, k) => i + k);
	const lines = runItems.map((k) => {
		const s = src.lineStart((seq.items[k] as Node).range![0]);
		const next = flowAlone(src, seq, k, k) ? lineAfter(src, src.nodeEnd(seq.items[k] as Node)) : null;
		return next ? ({ start: s, end: next[0], text: '', allow: [s, next[0]] } as Patch) : null;
	});
	if (lines.every((l) => l !== null) && (j + 1 < n || i > 0)) {
		// Each item goes with its own line and end-of-line comment; full-line comments between them stay.
		if (j + 1 < n) return lines as Patch[];
		// The last item: the item before it loses its comma.
		const prevEnd = src.nodeEnd(seq.items[i - 1] as Node);
		const comma = /^[ \t]*,/.exec(src.text.slice(prevEnd, src.lineEnd(prevEnd)));
		if (comma) return [...(lines as Patch[]), { start: prevEnd, end: prevEnd + comma[0].length, text: '' }];
	}
	// Items that share lines: only comments on a single removed line may go with them.
	const allow = src.text.slice(own[0], own[1]).includes('\n') ? undefined : own;
	if (j + 1 < n) return [{ start: own[0], end: (seq.items[j + 1] as Node).range![0], text: '', allow }];
	if (i > 0) return [{ start: src.nodeEnd(seq.items[i - 1] as Node), end: own[1], text: '', allow }];
	return [{ start: own[0], end: own[1], text: '', allow }];
}

const blankLine = (src: Source, start: number) => start < src.text.length && src.text.slice(start, src.lineEnd(start)).trim() === '' && lineAfter(src, start) !== null;

/**
 * Patches that remove some items of a list. The caller removes the whole key instead when no
 * item stays. Flow items take the separator after them (the last one takes the one before).
 * `above`: a block item also takes the comment lines it owns above it.
 */
export function removeItems(src: Source, seq: YAMLSeq, remove: Set<number>, above = false): Patch[] {
	const n = seq.items.length;
	const patches: Patch[] = [];
	if (seq.flow) {
		for (let i = 0; i < n; i++) {
			if (!remove.has(i)) continue;
			let j = i;
			while (j + 1 < n && remove.has(j + 1)) j++;
			patches.push(...removeFlowRun(src, seq, i, j));
			i = j;
		}
		return patches;
	}
	for (const i of [...remove].sort((a, b) => a - b)) {
		// The comments above a removed item stay (the decision notes "Relationship-op details").
		const start = above ? itemStart(src, seq, i) : ownStart(src, seq, i);
		const end = itemEnd(src, seq, i);
		const next = lineAfter(src, end);
		if (next) {
			// Between two blank lines, one of them goes too.
			const after = start > 0 && blankLine(src, src.lineStart(start - 1)) && blankLine(src, next[0]) ? lineAfter(src, next[0])![0] : next[0];
			patches.push({ start, end: after, text: '', allow: [start, end] });
		} else {
			// The last line of the body: take the line break before it instead.
			const before = start >= 2 && src.text[start - 2] === '\r' ? start - 2 : Math.max(0, start - 1);
			patches.push({ start: before, end, text: '', allow: [start, end] });
		}
	}
	// Several items removed up to the end of the body: the line break before the first goes too.
	const merged = mergeRemovals(patches);
	for (const pt of merged) {
		if (pt.end === src.text.length && src.text[pt.end - 1] !== '\n' && pt.start > 0 && src.text[pt.start - 1] === '\n') pt.start -= pt.start >= 2 && src.text[pt.start - 2] === '\r' ? 2 : 1;
	}
	return merged;
}

/** Where a new list item goes: right after or right before an existing item, or appended when null. */
export type Where = { after: number } | { before: number } | null;

/** Column of the first key of a block-map item in the list, or two past the dash. */
function itemColumn(src: Source, seq: YAMLSeq, dashCol: number): number {
	for (const it of seq.items) {
		if (isMap(it) && !it.flow && it.items.length) return src.column(((it.items[0] as Pair).key as Node).range![0]);
	}
	return dashCol + 2;
}

/** Inserts a new item into a top-level list section, creating the section if needed. `block` lines are relative to the item's keys. */
export function insertItem(p: Parsed, key: 'people' | 'unions', where: Where, block: string[], flow: string): Patch | Refusal {
	const top = topMap(p);
	if (isRefusal(top)) return top;
	const src = p.src;
	const layout = layoutOf(src);
	const pair = top ? findPair(top, key) : undefined;
	const seq = pair?.value;
	if (isSeq(seq) && (seq.items.length || seq.flow)) {
		if (seq.flow) {
			if (!seq.items.length) return insertAt(src.text.indexOf('[', seq.range![0]) + 1, flow);
			if (where && 'before' in where) return insertAt((seq.items[where.before] as Node).range![0], `${flow}, `);
			return insertAt(src.nodeEnd(seq.items[where ? where.after : seq.items.length - 1] as Node), `, ${flow}`);
		}
		const dashCol = src.column(dashOf(src, seq.items[0] as Node));
		const itemCol = itemColumn(src, seq, dashCol);
		const lines = block.map((l, n) => (n === 0 ? ' '.repeat(dashCol) + '-' + ' '.repeat(Math.max(1, itemCol - dashCol - 1)) + l : ' '.repeat(itemCol) + l));
		if (where && 'before' in where) return insertAt(itemStart(src, seq, where.before), lines.join('\n') + '\n');
		return insertAt(itemEnd(src, seq, where ? where.after : seq.items.length - 1), lines.map((l) => '\n' + l).join(''));
	}
	if (pair && !isSeq(seq) && !(isScalar(seq) && isEmpty(seq.value)) && seq !== null) return refuse('bad-value', `The ${key} section is not a list.`);
	const value = { block: itemBlock(layout, block), flow: `[${flow}]` };
	if (pair && top) return setPairValue(src, top, pair, value, layout);
	return addSection(p, key, value);
}

/** The top-level list and the key that holds it. */
export function section(p: Parsed, key: 'people' | 'unions' | 'houses' | 'titles'): { top: YAMLMap; pair: Pair; seq: YAMLSeq } | null {
	const top = topMap(p);
	if (!top || isRefusal(top)) return null;
	const pair = findPair(top, key);
	return pair && isSeq(pair.value) ? { top, pair, seq: pair.value } : null;
}

/** Removes items from a top-level list, or the whole section when none stays. */
export function removeFromSection(p: Parsed, key: 'people' | 'unions' | 'houses' | 'titles', remove: Set<number>): Patch[] {
	const s = section(p, key);
	if (!s || remove.size === 0) return [];
	if (remove.size >= s.seq.items.length) return [removePair(p.src, s.top, s.pair)];
	return removeItems(p.src, s.seq, remove);
}
