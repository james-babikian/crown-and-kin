import { afterEach, describe, expect, it, vi } from 'vitest';

import { HandleRegistry } from '../../src/obsidian/block-handle';
import { MarkdownView, TFile } from '../acceptance/fake-obsidian';

// Review U: HandleRegistry.showSource, second cursor after 120 ms and the order of the checks.

const BLOCK = '```kin\npeople:\n  - {id: a, name: A}\n```\n';
const OLD = 'Intro\n\n' + BLOCK;
const NEW = 'A new line above.\nAnother line above.\n' + OLD;

function setup(text: string, mode: 'preview' | 'source') {
	const file = new TFile('n.md');
	const state = { text, mode };
	const editor = {
		getValue: () => state.text,
		offsetToPos: (o: number) => ({ line: state.text.slice(0, o).split('\n').length - 1, ch: 0 }),
		setCursor: vi.fn(),
		scrollIntoView: vi.fn(),
		focus: vi.fn(),
	};
	const leaf: { view: unknown; openFile: ReturnType<typeof vi.fn> } = { view: null, openFile: vi.fn() };
	const view = Object.assign(new MarkdownView(), {
		file,
		leaf,
		editor,
		getMode: () => state.mode,
		getState: () => ({ file: 'n.md', mode: state.mode }),
		setState: vi.fn(async (s: { mode: 'preview' | 'source' }) => {
			state.mode = s.mode;
		}),
	});
	leaf.view = view;
	const ws = { getActiveViewOfType: () => view, getLeavesOfType: () => [leaf], getLeaf: vi.fn(() => leaf), revealLeaf: vi.fn(async () => {}) };
	const app = { vault: { getAbstractFileByPath: () => file }, workspace: ws };
	return { reg: new HandleRegistry(app as never), editor, view, state };
}

afterEach(() => vi.useRealTimers());

describe('review U: showSource', () => {
	it('the second cursor (120 ms) uses the text of that moment, not the offset of the first call', async () => {
		vi.useFakeTimers();
		const { reg, editor, state } = setup(OLD, 'preview');
		expect(await reg.showSource('n.md', 0)).toBe(true);
		// Reading view can lag behind the file (block-handle.ts "A view in Reading view can lag"): the editor takes the newer text.
		state.text = NEW;
		vi.advanceTimersByTime(130);
		const last = editor.setCursor.mock.calls[editor.setCursor.mock.calls.length - 1]![0] as { line: number };
		// The block body now starts at line 5 (0-based: 2 new lines + "Intro" + blank + fence = line 5).
		expect(last.line).toBe(5);
	});

});
