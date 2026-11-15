/*
 * Where "Show the tree text" puts the cursor when the tree text has an error (D346 item 5, D350). The error box names
 * a text line of the tree text (`hardErrorText` in `messages.ts`); these pure functions find that same text line and
 * its place in the note: the start of the tree text on that line, after the quote marks or the list indent of a
 * nested block. The Obsidian layer (`HandleRegistry.showSource`) turns the offset into an editor position.
 */

import type { LocatedBlock } from './block-locate';
import type { HardError } from './messages';

/** The number of text lines in a block body: a last text line that ends with a line break has no empty text line after it. */
function textLines(source: string): number {
	const n = source.split(/\r\n|\r|\n/).length;
	return /[\r\n]$/.test(source) ? n - 1 : n;
}

/**
 * The 1-based text line of the tree text that the error box names, or null when the error names no text line.
 * The clamp is the one of `hardErrorText`: the parser can name the text line after the last (an open bracket), and
 * the box then names the last text line, so the cursor goes where the box says.
 */
export function errorTextLine(error: HardError, source: string): number | null {
	if (error.code !== 'yaml-invalid' || error.line === undefined || !Number.isFinite(error.line)) return null;
	return Math.max(1, Math.min(Math.floor(error.line), textLines(source)));
}

/**
 * The offset in the note `text` of the start of the tree text on body line `line` (1-based) of `block`. A line past
 * the body counts as the last body line, a line before it as the first. The quote marks and the list indent of a nested
 * block stay before the offset, so the cursor stands at the first character of the tree text on that line.
 */
export function bodyLineOffset(text: string, block: LocatedBlock, line: number): number {
	// An empty block can start on its closing fence: no body line to look into.
	if (block.bodyStart === block.bodyEnd) return block.bodyStart;
	const bodyLines = block.body.split('\n');
	const n = Math.max(1, Math.min(Math.floor(line), bodyLines.length));
	// A line break as CodeMirror and `findBlocks` count it; a new pattern for each call, so no state stays between calls.
	const lineBreak = /\r\n|\r|\n/g;
	let start = block.bodyStart;
	lineBreak.lastIndex = start;
	for (let k = 1; k < n; k++) {
		const m = lineBreak.exec(text);
		// The note changed under the block: the start of the block text is the safe place.
		if (!m || m.index >= block.bodyEnd) return block.bodyStart;
		start = m.index + m[0].length;
	}
	lineBreak.lastIndex = start;
	const m = lineBreak.exec(text);
	const end = m ? m.index : text.length;
	const noteLine = text.slice(start, end);
	const bodyLine = bodyLines[n - 1];
	// The body line is the note line without its container prefix. A tab that a list indent split has no such end: the line start then.
	return noteLine.endsWith(bodyLine) ? end - bodyLine.length : start;
}
