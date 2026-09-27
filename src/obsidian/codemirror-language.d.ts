// Obsidian provides @codemirror/language at run time (esbuild keeps @codemirror/* external),
// but it is not a dependency of this project. These are the two functions the plugin uses.
declare module '@codemirror/language' {
	import type { EditorState } from '@codemirror/state';
	import type { EditorView } from '@codemirror/view';

	/** How far the Markdown parser has read the document so far; `live-preview.ts` compares this to the viewport. */
	export function syntaxTree(state: EditorState): { length: number };
	/** Asks the parser to read further, up to `upto`, within `timeout` ms; returns whether it reached `upto`. */
	export function forceParsing(view: EditorView, upto?: number, timeout?: number): boolean;
}
