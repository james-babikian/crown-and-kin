/*
 * Live Preview draws a code block only after the editor's Markdown parser has read the block's
 * closing fence, and the parser stops a little below the visible part of the note. A tall tree
 * (sample trees 6 and 7) therefore stayed as source text until the user scrolled to its end
 * (the decision notes). When a dynasty block is visible but not yet parsed to its end, this asks the
 * parser to read to the end of the block, and the block is drawn at once.
 */

import { forceParsing, syntaxTree } from '@codemirror/language';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { findBlocks } from '../core/block-locate';

const PARSE_BUDGET_MS = 150;
const MAX_TRIES = 40;

class TallBlockParser {
	private ranges: { from: number; to: number }[] | null = null;
	private timer = 0;
	private tries = 0;

	constructor(private readonly view: EditorView) {
		this.schedule();
	}

	update(u: ViewUpdate): void {
		if (u.docChanged) this.ranges = null;
		if (u.docChanged || u.viewportChanged) this.schedule();
	}

	private schedule(): void {
		if (this.timer) return;
		// Dispatching from inside an update is not allowed; wait for the next task.
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			try {
				this.run();
			} catch (e) {
				console.error('Dynasty Tree: cannot prepare the tree in Live Preview', e);
			}
		}, 0);
	}

	private blockRanges(): { from: number; to: number }[] {
		if (this.ranges) return this.ranges;
		const doc = this.view.state.doc;
		// The editor's text uses LF line ends, so block offsets are editor positions.
		this.ranges = findBlocks(doc.toString()).map((b) => ({
			from: doc.line(b.openLine + 1).from,
			to: b.closeLine === null ? doc.lineAt(Math.min(b.bodyEnd, doc.length)).to : doc.line(b.closeLine + 1).to,
		}));
		return this.ranges;
	}

	private run(): void {
		if (typeof forceParsing !== 'function' || typeof syntaxTree !== 'function') return;
		const parsed = syntaxTree(this.view.state).length;
		// Short notes are parsed to the end at once; only long ones need the scan below.
		if (parsed >= this.view.state.doc.length) return;
		const { from, to } = this.view.viewport;
		let need = 0;
		for (const r of this.blockRanges()) {
			if (r.from <= to && r.to >= from && r.to > parsed) need = Math.max(need, r.to);
		}
		if (!need) {
			this.tries = 0;
			return;
		}
		if (forceParsing(this.view, need, PARSE_BUDGET_MS)) {
			this.tries = 0;
			return;
		}
		// Very long notes can need more than one budget; continue in later tasks.
		if (++this.tries < MAX_TRIES) this.schedule();
	}

	destroy(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = 0;
	}
}

/** The CodeMirror view plugin, registered by `main.ts`, that forces tall dynasty blocks to parse fully. */
export const tallBlockParser = ViewPlugin.fromClass(TallBlockParser);
