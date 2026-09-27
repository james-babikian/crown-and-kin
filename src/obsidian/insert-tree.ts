/*
 * The command Insert family tree (spec §5.9, D34): an empty `dynasty` block with a help comment at
 * the cursor. The note then shows "Add first person". The text is planned by a pure function, so the
 * prefixes of callouts and list items have tests.
 */

import type { Editor } from 'obsidian';
import { INSERT_UI } from '../render/ui-text';

/** The text and cursor position `planInsert` produces. */
export interface InsertPlan {
	/** Replaces the whole text lines from the selection's first line to its last line. */
	text: string;
	/** Where the cursor goes, relative to the first replaced line: the line after the closing fence. */
	cursor: { line: number; ch: number };
}

// Callout and quote markers (`> `, `> > `), each with up to 3 spaces before it.
const QUOTES = /^(?:[ \t]{0,3}>[ \t]?)*/;
// A list item marker after the quotes: its content starts after the marker and the spaces after it.
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

/** Columns of leading white space, with tabs to the next multiple of 4 (CommonMark). */
function columns(ws: string): number {
	let c = 0;
	for (const ch of ws) c = ch === '\t' ? c + 4 - (c % 4) : c + 1;
	return c;
}

/**
 * The prefix of the lines of a block that sits in the line's container: the quote markers, then
 * the indentation of a list item's content. Only lists and callouts are containers: a plain line
 * indented by 4 spaces continues a paragraph, and an indented fence there would be an indented
 * code block (CommonMark), not a tree.
 */
export function containerPrefix(line: string): { first: string; rest: string } {
	const written = QUOTES.exec(line)?.[0] ?? '';
	const after = line.slice(written.length);
	// "> " with one space, also where the note wrote ">" alone, as the plugin writes callout lines.
	const quotes = written ? `${written.trimEnd()} ` : '';
	const list = LIST.exec(after);
	if (list) {
		// Five or more spaces after a marker start an indented code block (CommonMark): the content column is one space after the marker.
		const gap = columns(list[3]);
		const width = columns(list[1]) + list[2].length + (gap >= 1 && gap <= 4 ? gap : 1);
		return { first: `${quotes}${list[1]}${list[2]}${' '.repeat(width - columns(list[1]) - list[2].length)}`, rest: quotes + ' '.repeat(width) };
	}
	return { first: quotes, rest: quotes };
}

// A fence line after its container prefix: the fence characters and the rest of the line.
const FENCE = /^((?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/;

/** A fenced block around the cursor, as `fenceAround` finds it. */
export interface FenceAround {
	/** The line of the opening fence. */
	open: number;
	/** The prefix of the opening fence line. */
	openPrefix: string;
	/** The line of the closing fence; null if the block runs to the end of the note. */
	close: number | null;
	/** The prefix of the closing fence line ('' if there is none). */
	prefix: string;
}

/**
 * The fenced block (any language) that holds `line`, also on its fence lines. Null when `line` is
 * outside every fenced block.
 */
export function fenceAround(lines: string[], line: number): FenceAround | null {
	let open: { char: string; len: number; start: number; prefix: string } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const m = FENCE.exec(lines[i]);
		if (!open) {
			// A backtick fence has no backtick in its info string (CommonMark).
			if (m && !(m[2][0] === '`' && m[3].includes('`'))) open = { char: m[2][0], len: m[2].length, start: i, prefix: m[1] };
			else if (i >= line) return null;
			continue;
		}
		if (m && m[2][0] === open.char && m[2].length >= open.len && m[3].trim() === '') {
			if (line >= open.start && line <= i) return { open: open.start, openPrefix: open.prefix, close: i, prefix: m[1] };
			open = null;
			if (i >= line) return null;
		}
	}
	return open && line >= open.start ? { open: open.start, openPrefix: open.prefix, close: null, prefix: '' } : null;
}

/**
 * The line that closes the note properties (`---` or `...`) if `line` is in them; else null. The
 * properties start on the note's first line with `---`.
 */
export function propertiesEnd(lines: string[], line: number): number | null {
	if (lines.length < 2 || lines[0].trimEnd() !== '---') return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trimEnd() !== '---' && lines[i].trimEnd() !== '...') continue;
		return line <= i ? i : null;
	}
	return null;
}

/** The container prefix of a fence line with its list marker as spaces: the prefix of the lines after it. */
const markerAsSpaces = (prefix: string) => prefix.replace(/(?:[-*+]|\d{1,9}[.)])[ \t]+$/, (m) => ' '.repeat(m.length));

/**
 * Plans the insert. `head` is the first line's text before the selection, `tail` the last line's
 * text after it. The fence starts on its own line in the container of the cursor's line; text
 * before the cursor stays on its line with a blank line after it, and text after the cursor
 * moves to the line after the block's blank line. The cursor goes to the line after the closing
 * fence, so Live Preview draws the block at once.
 */
export function planInsert(head: string, tail: string): InsertPlan {
	const p = containerPrefix(head);
	const blank = p.rest.trimEnd();
	// Only markers (or nothing) before the cursor: the fence takes the cursor's line, after them.
	const onLine = head.trimEnd() === p.first.trimEnd();
	const lines: string[] = [];
	if (onLine) lines.push(`${p.first}\`\`\`dynasty`);
	else lines.push(head.trimEnd(), blank, `${p.rest}\`\`\`dynasty`);
	lines.push(`${p.rest}# ${INSERT_UI.hint}`, `${p.rest}\`\`\``, blank);
	const cursor = { line: lines.length - 1, ch: blank.length };
	const rest = tail.trim();
	if (rest) lines.push(`${p.rest}${tail.trimStart()}`);
	return { text: lines.join('\n'), cursor };
}

/**
 * Runs the command in an editor: one change, so one Ctrl/Cmd+Z undoes it. A selection is replaced.
 * With the cursor in a fenced block (a tree, a code block), the new tree goes after that block, in
 * the same container, and the block does not change; a block that never closes gets the tree above
 * it. With the cursor in the note properties, the tree goes after them.
 */
export function insertTree(editor: Editor): void {
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	const lines: string[] = [];
	for (let i = 0; i < editor.lineCount(); i++) lines.push(editor.getLine(i));
	const props = propertiesEnd(lines, from.line);
	if (props !== null) {
		const end = { line: props, ch: lines[props].length };
		const text = ['', '```dynasty', `# ${INSERT_UI.hint}`, '```', ''].join('\n');
		editor.transaction({ changes: [{ from: end, to: end, text }], selection: { from: { line: props + 4, ch: 0 } } });
		return;
	}
	const around = fenceAround(lines, from.line) ?? fenceAround(lines, to.line);
	if (around) {
		if (around.close === null) {
			// After the block, the tree would be code of that block and its closing fence would close it.
			const rest = markerAsSpaces(around.openPrefix);
			const blank = rest.trimEnd();
			const text = [`${around.openPrefix}\`\`\`dynasty`, `${rest}# ${INSERT_UI.hint}`, `${rest}\`\`\``, blank, ''].join('\n');
			const start = { line: around.open, ch: 0 };
			editor.transaction({ changes: [{ from: start, to: start, text }], selection: { from: { line: around.open + 3, ch: blank.length } } });
			return;
		}
		const at = around.close;
		const end = { line: at, ch: lines[at].length };
		// The block's own container: quote markers and list indentation, as its closing fence has them.
		const pre = markerAsSpaces(around.prefix);
		const blank = pre.trimEnd();
		const text = ['', blank, `${pre}\`\`\`dynasty`, `${pre}# ${INSERT_UI.hint}`, `${pre}\`\`\``, blank].join('\n');
		editor.transaction({ changes: [{ from: end, to: end, text }], selection: { from: { line: at + 5, ch: blank.length } } });
		return;
	}
	const first = editor.getLine(from.line);
	const last = editor.getLine(to.line);
	const plan = planInsert(first.slice(0, from.ch), last.slice(to.ch));
	const start = { line: from.line, ch: 0 };
	const end = { line: to.line, ch: last.length };
	const cursor = { line: from.line + plan.cursor.line, ch: plan.cursor.ch };
	editor.transaction({ changes: [{ from: start, to: end, text: plan.text }], selection: { from: cursor } });
}
