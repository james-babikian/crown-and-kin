/*
 * Live Preview draws a code block only after the editor's Markdown parser has read the block's
 * closing fence, and the parser stops a little below the visible part of the note. A tall tree
 * (sample trees 6 and 7) therefore stayed as source text until the user scrolled to its end
 * (the decision notes). When a kin block is visible but not yet parsed to its end, this asks the
 * parser to read to the end of the block, and the block is drawn at once. The scan of the note for blocks waits
 * until the user stops typing (WP-H2, P3), because it costs a few ms for each key press in a note of 1 MB.
 */

/* global require -- Obsidian's module loader gives `require` to the bundle (see `languageModule`) */

import type { Extension } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { findBlocks } from '../core/block-locate';

/** The two functions of @codemirror/language that this file uses. */
interface Language {
	forceParsing: (view: EditorView, upto?: number, timeout?: number) => boolean;
	syntaxTree: (state: EditorView['state']) => { length: number };
}

/** null: the module is missing or changed, so this feature stays off; undefined: not tried yet. */
let language: Language | null | undefined;

/**
 * Obsidian provides @codemirror/language at run time, and a later Obsidian version may change it. It is loaded here, inside a
 * `try`, and not with an import at the top of the file: a missing or changed module then turns off only this feature
 * (the Live Preview help) and not the whole plugin. The tests give the module with `useLanguage`.
 */
function languageModule(): Language | null {
	if (language !== undefined) return language;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- a top-level import would fail the load of the whole plugin
		const m = require('@codemirror/language') as Partial<Language>;
		language = typeof m.forceParsing === 'function' && typeof m.syntaxTree === 'function' ? (m as Language) : null;
	} catch (e) {
		console.error('Crown and Kin: Live Preview help is off, because the editor module is missing', e);
		language = null;
	}
	return language;
}

/** For the tests: use this module instead of @codemirror/language (null: act as if it is missing). */
export function useLanguage(m: Language | null): void {
	language = m;
}

const PARSE_BUDGET_MS = 150;
const MAX_TRIES = 40;
/** The quiet time after the last text change before the note is scanned for blocks. */
export const TYPING_WAIT_MS = 200;
/** The user event of the plugin's own writes (`block-handle.ts` `applyToEditor`). */
const PLUGIN_EVENT = 'input.crown-and-kin';

/**
 * The update holds a keyboard change by the user: text typed, pasted or dropped ("input" and its kinds, such as "input.type"
 * and "input.paste") or deleted ("delete" and its kinds). Undo and redo are single steps, so they scan at once. The plugin's
 * own writes carry "input.crown-and-kin" (`block-handle.ts`); they are not typing, so they scan at once too.
 */
function isTyping(u: ViewUpdate): boolean {
	return u.transactions.some((tr) => (tr.isUserEvent('input') && !tr.isUserEvent(PLUGIN_EVENT)) || tr.isUserEvent('delete'));
}

/** The view plugin class; exported for the test. */
export class TallBlockParser {
	private ranges: { from: number; to: number }[] | null = null;
	private timer = 0;
	private tries = 0;

	constructor(private readonly view: EditorView) {
		this.schedule(0);
	}

	update(u: ViewUpdate): void {
		if (u.docChanged) {
			this.ranges = null;
			// Only the user's typing waits: each key press restarts the wait, so typing never scans. A change that the plugin or
			// Obsidian makes (a write to the note, a note switch) happens once, so it scans at once.
			this.schedule(isTyping(u) ? TYPING_WAIT_MS : 0);
		} else if (u.viewportChanged) this.schedule(0);
	}

	private schedule(delay: number): void {
		if (this.timer) window.clearTimeout(this.timer);
		// Dispatching from inside an update is not allowed; wait for the next task.
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			try {
				this.run();
			} catch (e) {
				console.error('Crown and Kin: cannot prepare the tree in Live Preview', e);
			}
		}, delay);
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
		const lang = languageModule();
		if (!lang) return;
		const parsed = lang.syntaxTree(this.view.state).length;
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
		if (lang.forceParsing(this.view, need, PARSE_BUDGET_MS)) {
			this.tries = 0;
			return;
		}
		// Very long notes can need more than one budget; continue in later tasks.
		if (++this.tries < MAX_TRIES) this.schedule(0);
	}

	destroy(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = 0;
	}
}

/**
 * The CodeMirror view plugin, registered by `main.ts`, that forces tall kin blocks to parse fully; null if the editor modules are
 * missing or changed (the plugin then starts without it).
 */
export function tallBlockParser(): Extension | null {
	// The editor module reads `document.documentElement` when it loads. A run with no page (the tests) has no editor to help.
	if (typeof document === 'undefined' || !document.documentElement) return null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- see `languageModule`
		const view = require('@codemirror/view') as typeof import('@codemirror/view');
		return view.ViewPlugin.fromClass(TallBlockParser);
	} catch (e) {
		console.error('Crown and Kin: Live Preview help is off, because the editor module is missing', e);
		return null;
	}
}
