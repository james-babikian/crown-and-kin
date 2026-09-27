import type { FindBlocks, LocateBlock, LocatedBlock, OrdinalForSection, ReplaceBody } from './block';

/*
 * Finds `dynasty` fenced code blocks the way CommonMark reads fences (spec §6.1), without a
 * full Markdown parser. Containers are blockquotes and callouts (`>` markers) and list items
 * (tracked by their content column). Every fence, whatever its language, is tracked, so a
 * `dynasty` example inside a longer or different fence is content and not a block.
 */

interface Line {
	start: number;
	/** One past the last character, without the line ending. */
	end: number;
	text: string;
}

/** Line breaks as CodeMirror counts them, so line numbers match Obsidian's: `\r\n`, `\n` and a lone `\r`. */
const BREAK = /\r\n|\r|\n/g;

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	BREAK.lastIndex = 0;
	for (let m = BREAK.exec(text); m; m = BREAK.exec(text)) {
		lines.push({ start, end: m.index, text: text.slice(start, m.index) });
		start = m.index + m[0].length;
	}
	lines.push({ start, end: text.length, text: text.slice(start) });
	return lines;
}

function lineEnding(text: string): '\n' | '\r\n' {
	const nl = text.indexOf('\n');
	return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
}

const endsWithBreak = (s: string) => s.endsWith('\n') || s.endsWith('\r');

const QUOTE_MARKER = /^[ \t]*>[ \t]?/;

/** Removes up to `max` blockquote markers. `depth` is how many were there; `marks` is the text removed. */
function stripQuotes(line: string, max: number): { depth: number; marks: string; rest: string } {
	let rest = line;
	let depth = 0;
	while (depth < max) {
		const m = QUOTE_MARKER.exec(rest);
		if (!m) break;
		rest = rest.slice(m[0].length);
		depth++;
	}
	return { depth, marks: line.slice(0, line.length - rest.length), rest };
}

/** Columns of leading whitespace (tabs to the next multiple of 4), and how many characters they take. */
function indentation(s: string, from = 0, startCol = 0): { cols: number; chars: number } {
	let col = startCol;
	let i = from;
	for (; i < s.length; i++) {
		if (s[i] === ' ') col++;
		else if (s[i] === '\t') col += 4 - (col % 4);
		else break;
	}
	return { cols: col, chars: i };
}

/** Removes up to `cols` columns of indentation; a tab that would go past them stays. */
function stripColumns(s: string, cols: number): { removed: string; rest: string } {
	let col = 0;
	let i = 0;
	for (; i < s.length && col < cols; i++) {
		const next = s[i] === ' ' ? col + 1 : s[i] === '\t' ? col + 4 - (col % 4) : -1;
		if (next < 0 || next > cols) break;
		col = next;
	}
	return { removed: s.slice(0, i), rest: s.slice(i) };
}

const OPEN = /^(`{3,}|~{3,})(.*)$/;
const CLOSE = /^(`{3,}|~{3,})[ \t]*$/;
const LIST_MARKER = /^([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;

interface Fence {
	char: string;
	length: number;
	info: string;
}

function openingFence(s: string): Fence | null {
	const m = OPEN.exec(s);
	if (!m) return null;
	const info = m[2].trim();
	// A backtick fence's info string cannot hold a backtick (CommonMark); "```a`" is inline code.
	if (m[1][0] === '`' && info.includes('`')) return null;
	return { char: m[1][0], length: m[1].length, info };
}

/** Obsidian keys code-block processors by the first word of the info string, case-sensitive. */
const isDynasty = (info: string) => info.split(/[ \t]/, 1)[0] === 'dynasty';

/** The line after YAML front matter, or 0. Fences inside front matter are not Markdown. */
function afterFrontMatter(lines: Line[]): number {
	if (lines.length === 0 || lines[0].text.trimEnd() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) {
		const t = lines[i].text.trimEnd();
		if (t === '---' || t === '...') return i + 1;
	}
	return 0;
}

interface Opening {
	fence: Fence;
	depth: number;
	/** Content column of the innermost list item holding the fence (0 outside lists). */
	container: number;
	/** Column of the fence characters. */
	column: number;
	/** Whitespace before the fence on its line, when no list marker precedes it. */
	indent: string | null;
}

/**
 * Tracks list items between lines so a fence knows its container. Lazy continuation lines are
 * not modelled: a less indented line closes the list item, which only matters for fences
 * indented 4 or more.
 */
class ListStack {
	private columns: number[] = [];
	private depth = 0;

	/** Reads one line outside a fence; returns the fence it opens, if any. */
	scan(line: string): Opening | null {
		const q = stripQuotes(line, Infinity);
		if (q.depth !== this.depth) {
			this.columns = [];
			this.depth = q.depth;
		}
		const s = q.rest;
		if (s.trim() === '') return null;
		let ind = indentation(s);
		while (this.columns.length && this.columns[this.columns.length - 1] > ind.cols) this.columns.pop();
		let marker = false;
		for (;;) {
			const m = LIST_MARKER.exec(s.slice(ind.chars));
			const top = this.columns[this.columns.length - 1] ?? 0;
			if (!m || ind.cols - top > 3) break;
			const afterMarker = ind.chars + m[0].length;
			const markerEnd = ind.cols + m[0].length;
			const gap = indentation(s, afterMarker, markerEnd);
			// 1–4 columns after the marker set the content column; more starts indented code inside it.
			const content = gap.chars === s.length || gap.cols - markerEnd > 4 ? markerEnd + 1 : gap.cols;
			this.columns.push(content);
			marker = true;
			if (gap.chars === s.length) return null;
			ind = gap.cols - markerEnd > 4 ? { cols: content, chars: afterMarker + 1 } : gap;
		}
		const container = this.columns[this.columns.length - 1] ?? 0;
		if (ind.cols - container > 3) return null;
		const fence = openingFence(s.slice(ind.chars));
		if (!fence) return null;
		return { fence, depth: q.depth, container, column: ind.cols, indent: marker ? null : s.slice(0, ind.chars) };
	}
}

export const findBlocks: FindBlocks = (text) => {
	const blocks: LocatedBlock[] = [];
	if (typeof text !== 'string') return blocks;
	const lines = splitLines(text);
	const eol = lineEnding(text);
	const lists = new ListStack();
	let i = afterFrontMatter(lines);
	while (i < lines.length) {
		const open = lists.scan(lines[i].text);
		if (!open) {
			i++;
			continue;
		}
		const { fence, depth, container, column } = open;
		let closeLine: number | null = null;
		let j = i + 1;
		for (; j < lines.length; j++) {
			const q = stripQuotes(lines[j].text, depth);
			// A line without the fence's quote markers ends the blockquote, and the fence with it.
			if (q.depth < depth) break;
			const blank = q.rest.trim() === '';
			const ind = indentation(q.rest);
			// A less indented line ends the list item, and the fence with it.
			if (!blank && ind.cols < container) break;
			if (!blank && ind.cols - container <= 3) {
				const m = CLOSE.exec(q.rest.slice(ind.chars));
				if (m && m[1][0] === fence.char && m[1].length >= fence.length) {
					closeLine = j;
					break;
				}
			}
		}
		let bodyLast = (closeLine ?? j) - 1;
		// An unclosed block at the end of a note that ends with a line break: that break ends the
		// last body line; it does not start an extra empty one.
		if (closeLine === null && j === lines.length && bodyLast > i && endsWithBreak(text)) bodyLast--;
		if (isDynasty(fence.info)) {
			let prefix: string | null = null;
			const body: string[] = [];
			for (let k = i + 1; k <= bodyLast; k++) {
				const q = stripQuotes(lines[k].text, depth);
				const cut = stripColumns(q.rest, column);
				body.push(cut.rest);
				if (prefix === null && q.rest.trim() !== '') prefix = q.marks + cut.removed;
			}
			// No text line to copy the prefix from: take it from the fence line.
			prefix ??= stripQuotes(lines[i].text, depth).marks + (open.indent ?? ' '.repeat(column));
			const empty = bodyLast < i + 1;
			const bodyStart = empty ? (closeLine !== null ? lines[closeLine].start : lines[i].end) : lines[i + 1].start;
			blocks.push({
				ordinal: blocks.length,
				openLine: i,
				closeLine,
				bodyStart,
				bodyEnd: empty ? bodyStart : lines[bodyLast].end,
				prefix,
				body: body.join('\n'),
				eol,
			});
		}
		i = closeLine !== null ? closeLine + 1 : j;
	}
	return blocks;
};

export const locateBlock: LocateBlock = (text, ordinal) => findBlocks(text)[ordinal] ?? null;

const normalise = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n$/, '');

export const ordinalForSection: OrdinalForSection = (text, lineStart, lineEnd, source) => {
	const inside = findBlocks(text).filter((b) => b.openLine >= lineStart && b.openLine <= lineEnd);
	if (inside.length === 1) return inside[0].ordinal;
	if (inside.length === 0 || typeof source !== 'string') return null;
	const wanted = normalise(source);
	const same = inside.filter((b) => normalise(b.body) === wanted);
	return same.length === 1 ? same[0].ordinal : null;
};

/**
 * True when the block has no body lines at all, not even an empty one. An unclosed block's
 * body starts on the line after the fence, so there its start follows a line break.
 */
function hasNoBodyLines(text: string, block: LocatedBlock): boolean {
	if (block.closeLine !== null) return block.closeLine === block.openLine + 1;
	return block.bodyStart === 0 || !endsWithBreak(text.slice(block.bodyStart - 1, block.bodyStart));
}

export const replaceBody: ReplaceBody = (text, block, newBody) => {
	const next = newBody.replace(/\r\n?/g, '\n').split('\n');
	const withPrefix = (l: string) => (l === '' ? block.prefix.trimEnd() : block.prefix + l);
	// The fence line's own ending, for new lines with no neighbour (a note can mix endings).
	const fenceBreak = /(\r\n|\r|\n)$/.exec(text.slice(0, block.bodyStart))?.[1] ?? /^(\r\n|\r|\n)/.exec(text.slice(block.bodyEnd))?.[1] ?? block.eol;
	if (hasNoBodyLines(text, block)) {
		if (newBody === '') return text;
		const inserted = next.map(withPrefix).join(fenceBreak);
		// An unclosed block with no body lines: the body goes on new lines right after the fence.
		if (block.closeLine === null) return text.slice(0, block.bodyStart) + fenceBreak + inserted + text.slice(block.bodyEnd);
		return text.slice(0, block.bodyStart) + inserted + fenceBreak + text.slice(block.bodyStart);
	}
	// Lines the new body shares with the old one at the start and the end keep their exact bytes
	// and their own line endings (for example a blank callout line written as ">" rather than "> ").
	const raw = text.slice(block.bodyStart, block.bodyEnd);
	const rawLines = raw.split(/\r\n|\r|\n/);
	const breaks = raw.match(/\r\n|\r|\n/g) ?? [];
	const old = block.body.split('\n');
	let head = 0;
	while (head < old.length && head < next.length && old[head] === next[head]) head++;
	let tail = 0;
	while (tail < old.length - head && tail < next.length - head && old[old.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
	const near = (head > 0 ? breaks[head - 1] : undefined) ?? breaks[0] ?? fenceBreak;
	const pieces: { line: string; after?: string }[] = [
		...rawLines.slice(0, head).map((line, k) => ({ line, after: breaks[k] })),
		...next.slice(head, next.length - tail).map((l) => ({ line: withPrefix(l) })),
		...rawLines.slice(rawLines.length - tail).map((line, k) => ({ line, after: breaks[rawLines.length - tail + k] })),
	];
	const out = pieces.map((p, k) => (k === pieces.length - 1 ? p.line : p.line + (p.after ?? near))).join('');
	return text.slice(0, block.bodyStart) + out + text.slice(block.bodyEnd);
};
