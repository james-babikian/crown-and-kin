/*
 * Finds `kin` fenced code blocks the way CommonMark reads fences (spec §6.1), without a
 * full Markdown parser. Containers are blockquotes and callouts (`>` markers) and list items
 * (tracked by their content column). Every fence, whatever its language, is tracked, so a
 * `kin` example inside a longer or different fence is content and not a block. The language is
 * a parameter (default `kin`; the calendar notes use `kin-calendar`, spec §14 rule 2), and the
 * blocks are numbered for each language on its own.
 */

/** The fence language of a tree block. */
export const KIN_LANGUAGE = 'kin';
/** The fence language of a calendar block (spec §14 rule 2). */
export const CALENDAR_LANGUAGE = 'kin-calendar';

/** One fenced code block of the wanted language found in a note: its position, body and container prefix. */
export interface LocatedBlock {
	/** Index of this block among the blocks of the same language in the note, from 0, in text order. */
	ordinal: number;
	/**
	 * 0-based line numbers of the opening and closing fence lines. `closeLine` is null for a block
	 * with no closing fence: it runs to the end of its container (the callout or list item), or to
	 * the end of the note at the top level (CommonMark).
	 */
	openLine: number;
	closeLine: number | null;
	/** Offsets into the note text of the first body character and one past the last (the body lines only, without the fence lines). */
	bodyStart: number;
	bodyEnd: number;
	/**
	 * The container prefix of every body line, for example `"> "`, `">"`, `"> > "`, or the
	 * indentation of a list item (spaces or tabs, as written; spaces for the columns taken when a list marker splits a tab). The body is parsed with this prefix
	 * removed. The opening fence line may carry a different prefix (the list marker in a fence
	 * written on the list-item line); fence lines are never rewritten.
	 */
	prefix: string;
	/** The body with the prefix removed from each line, lines joined with `\n`. */
	body: string;
	/** The note's line ending; a write keeps it. */
	eol: '\n' | '\r\n';
}

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

/**
 * Removes up to `cols` columns of indentation. A tab that goes past them is split, as CommonMark
 * does: its remaining columns stay as spaces, and `removed` gets spaces for the columns taken, so
 * a line written as `removed` + text reads back as that text.
 */
function stripColumns(s: string, cols: number): { removed: string; rest: string } {
	let col = 0;
	let i = 0;
	for (; i < s.length && col < cols; i++) {
		const next = s[i] === ' ' ? col + 1 : s[i] === '\t' ? col + 4 - (col % 4) : -1;
		if (next < 0) break;
		if (next > cols) return { removed: s.slice(0, i) + ' '.repeat(cols - col), rest: ' '.repeat(next - cols) + s.slice(i + 1) };
		col = next;
	}
	return { removed: s.slice(0, i), rest: s.slice(i) };
}

const OPEN = /^(`{3,}|~{3,})(.*)$/;
const CLOSE = /^(`{3,}|~{3,})[ \t]*$/;
const LIST_MARKER = /^([-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
/** Three or more of `-`, `*` or `_` (the same one), spaces between: a thematic break, which CommonMark reads before a list item. */
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// The deepest nesting of quote markers that one list marker line may open; deeper lines are read as plain text.
const MAX_QUOTE_DEPTH = 64;

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
const isLanguage = (info: string, language: string) => info.split(/[ \t]/, 1)[0] === language;

/** The line after YAML front matter, or 0. Fences inside front matter are not Markdown. */
function afterFrontMatter(lines: Line[]): number {
	// A byte order mark before the first `---` does not stop front matter (T-X4-01).
	if (lines.length === 0 || lines[0].text.replace(/^﻿/, '').trimEnd() !== '---') return 0;
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
	/**
	 * The list items outside a quote that a marker line opened ("- > ..."): a line of the fence below must stand
	 * at least `need` columns in, after `depth` quote markers, or the item and the fence have ended.
	 */
	guards: { depth: number; need: number }[];
}

/**
 * Tracks list items between lines so a fence knows its container. Lazy continuation lines are
 * not modelled: a less indented line closes the list item, which only matters for fences
 * indented 4 or more.
 */
class ListStack {
	/**
	 * One frame for each quote depth that a marker line opened ("- > x" opens depth 1 inside the list item of depth 0).
	 * The last frame is the current one. A later line with fewer quote markers goes back to the frame of its depth, so
	 * the list items that held the quote still hold the lines below it.
	 */
	private frames: { depth: number; columns: number[] }[] = [{ depth: 0, columns: [] }];

	private get columns(): number[] {
		return this.frames[this.frames.length - 1].columns;
	}

	/** Reads one line outside a fence; returns the fence it opens, if any. */
	scan(line: string): Opening | null {
		const q = stripQuotes(line, Infinity);
		while (this.frames.length > 1 && this.frames[this.frames.length - 1].depth > q.depth) this.frames.pop();
		// A line that starts a quote (or a quote of another depth) with no frame of that depth ends the list items before it.
		if (this.frames[this.frames.length - 1].depth !== q.depth) this.frames = [{ depth: q.depth, columns: [] }];
		else this.dropEndedItems(line, q.depth);
		return this.scanContent(q.rest, q.depth);
	}

	/**
	 * A line that continues a quote from a marker line must still stand inside the list item that holds the quote: its
	 * quote marker is indented to the item's content column. If not ("- > a" then "> b"), the item has ended and the
	 * quote is a new one; every frame goes, as if the line had started a quote.
	 */
	private dropEndedItems(line: string, depth: number): void {
		for (let k = this.frames.length - 1; k >= 1; k--) {
			const parent = this.frames[k - 1];
			const rest = stripQuotes(line, parent.depth).rest;
			const need = parent.columns[parent.columns.length - 1] ?? 0;
			if (indentation(rest).cols >= need) continue;
			this.frames = [{ depth, columns: [] }];
			return;
		}
	}

	/** The line after its leading quote markers; `depth` is the number of quote markers in front of it. */
	private scanContent(s: string, depth: number): Opening | null {
		if (s.trim() === '') return null;
		let ind = indentation(s);
		while (this.columns.length && this.columns[this.columns.length - 1] > ind.cols) this.columns.pop();
		let marker = false;
		for (;;) {
			const m = LIST_MARKER.exec(s.slice(ind.chars));
			const top = this.columns[this.columns.length - 1] ?? 0;
			if (ind.cols - top > 3) break;
			if (THEMATIC_BREAK.test(s.slice(ind.chars))) return null;
			if (!m) break;
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
		// A callout opened after a list marker on the same line ("- > - item"): the lines below start with the quote
		// marker, so the list items inside it are counted from that marker. The `>` must be at most 3 columns past the
		// item's content column; further right it is indented code (CommonMark).
		const lead = marker ? indentation(s, ind.chars, ind.cols).cols - ind.cols : 4;
		const inner = marker && lead <= 3 && ind.cols - (this.columns[this.columns.length - 1] ?? 0) <= 3 ? stripQuotes(s.slice(ind.chars), Infinity) : null;
		// A line with more quote markers than any real note has is read as plain text: the scan of a hostile line stays
		// shallow, so it can never overflow the call stack (spec §8: nothing may throw).
		if (inner && inner.depth > 0 && depth + inner.depth > MAX_QUOTE_DEPTH) return null;
		if (inner && inner.depth > 0) {
			// The outer frame keeps its list columns for the lines that go back to its depth.
			this.frames.push({ depth: depth + inner.depth, columns: [] });
			// A fence on this same line has no prefix to copy from the lines below: it stays unread, as before.
			this.scanContent(inner.rest, depth + inner.depth);
			return null;
		}
		const container = this.columns[this.columns.length - 1] ?? 0;
		if (ind.cols - container > 3) return null;
		const fence = openingFence(s.slice(ind.chars));
		if (!fence) return null;
		const guards = this.frames.slice(0, -1).map((f) => ({ depth: f.depth, need: f.columns[f.columns.length - 1] ?? 0 }));
		return { fence, depth, container, column: ind.cols, indent: marker ? null : s.slice(0, ind.chars), guards };
	}
}

/** All blocks of one language (default `kin`) in a note, in text order. Fences inside longer fences are skipped (§6.1). */
export type FindBlocks = (text: string, language?: string) => LocatedBlock[];

/** Implements `FindBlocks`. */
export const findBlocks: FindBlocks = (text, language = KIN_LANGUAGE) => {
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
		const { fence, depth, container, column, guards } = open;
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
			if (!blank && guards.some((g) => indentation(stripQuotes(lines[j].text, g.depth).rest).cols < g.need)) break;
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
		if (isLanguage(fence.info, language)) {
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

const normalise = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n$/, '');

/**
 * Ordinal of the block that Obsidian rendered, from `getSectionInfo(el)` (0-based `lineStart` and
 * `lineEnd`) and the processor's `source`. For a block inside a callout or list, Obsidian may
 * report the whole container's lines, and one container can hold several blocks: take the blocks
 * whose opening fence lies in [lineStart, lineEnd]; if there is one, return it; if there are
 * several, return the one whose `body` equals `source` (line endings normalised, trailing newline
 * ignored). Null if there is none or the match is ambiguous (the view is then read-only).
 */
export type OrdinalForSection = (text: string, lineStart: number, lineEnd: number, source: string, language?: string) => number | null;

/** Implements `OrdinalForSection`. */
export const ordinalForSection: OrdinalForSection = (text, lineStart, lineEnd, source, language = KIN_LANGUAGE) => {
	const inside = findBlocks(text, language).filter((b) => b.openLine >= lineStart && b.openLine <= lineEnd);
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

/**
 * Puts a new body back into the note text: re-adds the prefix on every body line, keeps the
 * fence lines and the rest of the note byte for byte, and uses the note's line ending.
 */
export type ReplaceBody = (text: string, block: LocatedBlock, newBody: string) => string;

/** Implements `ReplaceBody`. */
export const replaceBody: ReplaceBody = (text, block, newBody) => {
	const next = newBody.replace(/\r\n?/g, '\n').split('\n');
	// After a bare ">", CommonMark reads a line's first space or tab as part of the marker.
	const bare = block.prefix.endsWith('>');
	const withPrefix = (l: string) => (l === '' ? block.prefix.trimEnd() : bare && (l[0] === ' ' || l[0] === '\t') ? `${block.prefix} ${l}` : block.prefix + l);
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
	// `swap`: one break of a kept line, taken in place of its own (see below).
	const build = (fresh: string, swap?: { k: number; br: string }) =>
		pieces.map((p, k) => (k === pieces.length - 1 ? p.line : p.line + (swap?.k === k ? swap.br : (p.after ?? fresh)))).join('');
	const before = text.slice(0, block.bodyStart);
	const after = text.slice(block.bodyEnd);
	const countBreaks = (s: string) => s.match(/\r\n|\r|\n/g)?.length ?? 0;
	// A new line's break that sits next to an empty line can join with it: a lone CR before an empty line that ends
	// with LF reads as one CRLF, and a line is lost. Take another break for the new lines then (the rest keeps its bytes).
	const wanted = countBreaks(before) + pieces.length - 1 + countBreaks(after);
	const first = build(near);
	const ok = (out: string) => countBreaks(before + out + after) === wanted;
	if (ok(first)) return before + first + after;
	const choices = [...new Set([block.eol, '\n', '\r', '\r\n'])];
	for (const fresh of choices) {
		const out = build(fresh);
		if (fresh !== near && ok(out)) return before + out + after;
	}
	// Still a line lost: a kept line's lone CR next to an empty line, or an LF behind it. Give that one break (inside
	// the body, so no byte outside it changes) another form; if none helps, the text stays wrong and the write is refused.
	for (let k = 0; k < pieces.length - 1; k++) {
		if (pieces[k].line !== '' && pieces[k + 1].line !== '') continue;
		for (const br of choices) {
			for (const fresh of choices) {
				const out = build(fresh, { k, br });
				if (ok(out)) return before + out + after;
			}
		}
	}
	return before + first + after;
};
