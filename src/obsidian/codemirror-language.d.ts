// Obsidian provides @codemirror/language at run time (esbuild keeps @codemirror/* external),
// but it is not a dependency of this project. These are the two functions the plugin uses.
declare module '@codemirror/language' {
	import type { EditorState } from '@codemirror/state';
	import type { EditorView } from '@codemirror/view';

	export function syntaxTree(state: EditorState): { length: number };
	export function forceParsing(view: EditorView, upto?: number, timeout?: number): boolean;
}
