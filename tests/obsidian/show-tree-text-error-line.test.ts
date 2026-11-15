import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HandleRegistry } from '../../src/obsidian/block-handle';
import { TreeView } from '../../src/obsidian/tree-view';
import { BLOCK_UI } from '../../src/render/ui-text';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, runTimers, settle } from '../acceptance/fake-dom';
import { MarkdownView, TFile, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, phone, type FakeHandle, type Host } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D346 item 5, D350 ("Errors open the text line"): the button "Show the tree text" of the error box puts the cursor on the
 * text line that the box names, scrolled into view. With no text line in the error, and from the More list of a drawn tree,
 * the cursor goes to the start of the block text as before (D176 item 2).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const FENCE = '```';
// The owner's example: a tree text whose 5th text line has an error (a wrong indent).
const FIFTH = ['people:', '  - id: aldric', '    name: Aldric', '    sex: m', '   name: Thea'].join('\n');
const GOOD = ['people:', '  - {id: a, name: Aldric, sex: m}', '  - {id: b, name: Bea, sex: f, parents: [a]}'].join('\n');

/** An editor on `text` whose positions count lines and columns as CodeMirror does. */
function fakeEditor(text: string) {
	return {
		getValue: () => text,
		offsetToPos: (o: number) => {
			const before = text.slice(0, o).split('\n');
			return { line: before.length - 1, ch: before[before.length - 1].length };
		},
		setCursor: vi.fn(),
		scrollIntoView: vi.fn(),
		focus: vi.fn(),
	};
}

/** A registry on a fake app whose note `n.md` holds `note`, open in `mode`. */
function registryOn(note: string, mode: 'preview' | 'source' = 'source') {
	const file = new TFile('n.md');
	const editor = fakeEditor(note);
	let current = mode;
	const leaf: { view: unknown; openFile: ReturnType<typeof vi.fn> } = { view: null, openFile: vi.fn() };
	const view = Object.assign(new MarkdownView(), {
		file,
		leaf,
		editor,
		getMode: () => current,
		getState: () => ({ file: 'n.md', mode: current }),
		setState: vi.fn(async (s: { mode: 'preview' | 'source' }) => {
			current = s.mode;
		}),
	});
	leaf.view = view;
	const ws = { getActiveViewOfType: () => view, getLeavesOfType: () => [leaf], getLeaf: vi.fn(() => leaf), revealLeaf: vi.fn(async () => {}) };
	const app = { vault: { getAbstractFileByPath: () => file }, workspace: ws };
	return { reg: new HandleRegistry(app as never), editor };
}

const lastCursor = (editor: ReturnType<typeof fakeEditor>) => editor.setCursor.mock.calls[editor.setCursor.mock.calls.length - 1]![0] as { line: number; ch: number };

const press = async (el: FEl | null) => {
	dispatch(el!, 'click', { button: 0, detail: 1 });
	await settle();
	resizeAll();
	flushFrames();
};

/** A tree in note n.md, as the code-block processor makes it, that can be edited; it may be an error box (no viewport). */
async function embedText(body: string, host: Host, handle: FakeHandle) {
	const inEditorOf = (): boolean => false;
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf });
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: body.split('\n').length + 1, text: '' }), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, body, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport');
	if (vp) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	flushFrames();
	return { el, view };
}

/** A tree in note n.md whose block text is `body`, with a real `showSource` on an editor of `note`. */
async function openTree(body: string, note: string) {
	const host = fakeHost();
	const handle = fakeHandle('n.md', body);
	const e = await embedText(body, host, handle);
	const { reg, editor } = registryOn(note);
	const showSource = vi.fn((path: string, ordinal: number, line?: number) => reg.showSource(path, ordinal, line));
	Object.assign(host.handles, { showSource });
	return { ...e, showSource, editor };
}

describe('"Show the tree text" in the error box goes to the text line that the box names', () => {
	it('D350 example: the 5th text line has an error, the cursor goes to that text line', async () => {
		desktop();
		const note = ['Intro', '', `${FENCE}kin`, FIFTH, FENCE, ''].join('\n');
		const { el, showSource, editor } = await openTree(FIFTH, note);
		expect(el.querySelector('.dynasty-error-detail')!.getText().startsWith('Text line 5 of the tree text has an error.')).toBe(true);
		const button = el.querySelector('.dynasty-error-button')!;
		expect(button.getText()).toBe(BLOCK_UI.showText);
		await press(button);
		expect(showSource).toHaveBeenCalledWith('n.md', 0, 5);
		// The fence is note line 2, so text line 5 of the tree text is note line 7.
		expect(lastCursor(editor)).toEqual({ line: 7, ch: 0 });
		expect(editor.scrollIntoView).toHaveBeenLastCalledWith({ from: { line: 7, ch: 0 }, to: { line: 7, ch: 0 } }, true);
		expect(editor.focus).toHaveBeenCalled();
	});

	it('a block inside a callout: the cursor stands on that text line after the quote marks', async () => {
		phone();
		const note = ['> [!note] The tree', `> ${FENCE}kin`, ...FIFTH.split('\n').map((l) => `> ${l}`), `> ${FENCE}`, ''].join('\n');
		const { el, editor } = await openTree(FIFTH, note);
		await press(el.querySelector('.dynasty-error-button'));
		expect(lastCursor(editor)).toEqual({ line: 6, ch: 2 });
	});

	it('an error with no text line: the cursor goes to the start of the block text', async () => {
		desktop();
		const body = ['- a', '- b'].join('\n');
		const note = ['Intro', `${FENCE}kin`, body, FENCE].join('\n');
		const { el, showSource, editor } = await openTree(body, note);
		expect(el.querySelector('.dynasty-error-button')).not.toBeNull();
		await press(el.querySelector('.dynasty-error-button'));
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
		expect(lastCursor(editor)).toEqual({ line: 2, ch: 0 });
	});

	it('a drawn tree: the item of the More list goes to the start of the block text, as before', async () => {
		desktop();
		const note = ['Intro', `${FENCE}kin`, GOOD, FENCE].join('\n');
		const { el, showSource, editor } = await openTree(GOOD, note);
		expect(el.querySelector('.dynasty-error-button')).toBeNull();
		await press(el.querySelector('.dynasty-more'));
		await press(el.querySelector('.dynasty-more-text-source'));
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
		expect(lastCursor(editor)).toEqual({ line: 2, ch: 0 });
	});
});

describe('HandleRegistry.showSource with a text line', () => {
	it('a note in Reading view: both cursor moves (now and after 120 ms) go to the text line', async () => {
		const note = ['---', 'title: Valmont', '---', `${FENCE}kin`, FIFTH, FENCE, ''].join('\n');
		const { reg, editor } = registryOn(note, 'preview');
		expect(await reg.showSource('n.md', 0, 5)).toBe(true);
		expect(lastCursor(editor)).toEqual({ line: 8, ch: 0 });
		runTimers(130);
		expect(editor.setCursor).toHaveBeenCalledTimes(2);
		expect(lastCursor(editor)).toEqual({ line: 8, ch: 0 });
	});

	it('a block inside a list item: the cursor stands after the list indent', async () => {
		const note = ['- The tree:', '', `  ${FENCE}kin`, ...FIFTH.split('\n').map((l) => `  ${l}`), `  ${FENCE}`].join('\n');
		const { reg, editor } = registryOn(note);
		expect(await reg.showSource('n.md', 0, 5)).toBe(true);
		expect(lastCursor(editor)).toEqual({ line: 7, ch: 2 });
	});

	it('a text line past the block (the note changed): the last text line of the block', async () => {
		const note = [`${FENCE}kin`, 'people:', '  - id: a', FENCE, 'After'].join('\n');
		const { reg, editor } = registryOn(note);
		expect(await reg.showSource('n.md', 0, 9)).toBe(true);
		expect(lastCursor(editor)).toEqual({ line: 2, ch: 0 });
	});
});
