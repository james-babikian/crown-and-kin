import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { HandleRegistry } from '../src/obsidian/block-handle';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { BLOCK_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { MarkdownView, TFile, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * 0.2.6, WP3 (D176 item 2): the plugin item "Show the tree text". It is the last item of the More list and, in the list of a
 * tree in a note on a phone, a button of the list bar. The registry method that opens the source is tested on fakes.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const SRC = `people:
  - {id: a, name: Aldric, sex: m}
  - {id: b, name: Bea, sex: f, parents: [a]}
`;

const press = async (el: FEl | null) => {
	dispatch(el!, 'click', { button: 0, detail: 1 });
	await settle();
	resizeAll();
	flushFrames();
};

/** A host whose registry records the calls of `showSource`. */
async function open(o: { editable: boolean }) {
	const handle = o.editable ? fakeHandle('n.md', SRC) : null;
	const host = fakeHost();
	const e = await embed(SRC, { host, handle });
	const showSource = vi.fn(async () => true);
	Object.assign(host.handles, { showSource });
	return { ...e, showSource };
}

describe('the item "Show the tree text" in the More list', () => {
	it('is the last item on the computer and runs showSource for the block', async () => {
		desktop();
		const { el, showSource } = await open({ editable: true });
		await press(el.querySelector('.dynasty-more'));
		const items = el.querySelectorAll('.dynasty-more-item');
		const last = items[items.length - 1];
		expect(last.classes.has('dynasty-more-text-source')).toBe(true);
		expect(last.getText()).toBe(BLOCK_UI.showText);
		expect(last.getAttribute('aria-label')).toBe(BLOCK_UI.showTextLabel);
		await press(last);
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
	});

	it('is the last item in the More list of a phone in the full-screen view, and closes the view first', async () => {
		phone();
		const host = fakeHost();
		const showSource = vi.fn(async () => true);
		Object.assign(host.handles, { showSource });
		const { modal, root } = await openFullScreen(SRC, { host });
		await press(root.querySelector('.dynasty-more'));
		const items = root.querySelectorAll('.dynasty-more-item');
		const last = items[items.length - 1];
		expect(last.classes.has('dynasty-more-text-source')).toBe(true);
		await press(last);
		expect((modal as unknown as { closing: boolean }).closing).toBe(true);
		await settle();
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
	});

	it('is not there when the note cannot be edited', async () => {
		desktop();
		const { el } = await open({ editable: false });
		await press(el.querySelector('.dynasty-more'));
		expect(el.querySelector('.dynasty-more-text-source')).toBeNull();
	});
});

describe('the button "Show the tree text" in the list bar of a phone', () => {
	it('sits next to Add person, with an icon only (D182), and runs showSource', async () => {
		phone();
		const { el, showSource } = await open({ editable: true });
		const bar = el.querySelector('.dynasty-toolbar')!;
		const classes = bar.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);
		expect(classes.slice(0, 2)).toEqual(['dynasty-add-person', 'dynasty-show-text']);
		const b = bar.querySelector('.dynasty-show-text')!;
		expect(b.querySelector('.dynasty-tool-icon')).not.toBeNull();
		expect(b.querySelector('.dynasty-tool-text')).toBeNull();
		expect(b.getAttribute('aria-label')).toBe(BLOCK_UI.showTextLabel);
		await press(b);
		expect(showSource).toHaveBeenCalledWith('n.md', 0);
	});

	it('is not in a list that cannot be edited', async () => {
		phone();
		const { el } = await open({ editable: false });
		expect(el.querySelector('.dynasty-show-text')).toBeNull();
	});

	it('is not in the bar of a tree on the computer (the More list has the item)', async () => {
		desktop();
		const { el } = await open({ editable: true });
		expect(el.querySelector('.dynasty-show-text')).toBeNull();
	});
});

describe('HandleRegistry.showSource', () => {
	const NOTE = 'Intro\n\n```dynasty\npeople:\n  - {id: a, name: A}\n```\n\n```dynasty\npeople:\n  - {id: b, name: B}\n```\n';

	function setup(mode: 'preview' | 'source', text = NOTE) {
		const file = new TFile('n.md');
		const editor = {
			getValue: () => text,
			offsetToPos: (o: number) => ({ line: text.slice(0, o).split('\n').length - 1, ch: 0 }),
			setCursor: vi.fn(),
			scrollIntoView: vi.fn(),
			focus: vi.fn(),
		};
		const leaf: { view: unknown; openFile: ReturnType<typeof vi.fn> } = { view: null, openFile: vi.fn() };
		let current = mode;
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
		const ws = {
			getActiveViewOfType: () => view,
			getLeavesOfType: () => [leaf],
			getLeaf: vi.fn(() => leaf),
			revealLeaf: vi.fn(async () => {}),
		};
		const app = { vault: { getAbstractFileByPath: () => file }, workspace: ws };
		return { reg: new HandleRegistry(app as never), editor, view, ws };
	}

	it('switches Reading view to the editor and puts the cursor at the start of the text of the block', async () => {
		const { reg, view, editor, ws } = setup('preview');
		expect(await reg.showSource('n.md', 1)).toBe(true);
		expect(view.setState).toHaveBeenCalledTimes(1);
		expect(view.setState.mock.calls[0][0]).toMatchObject({ mode: 'source', source: false });
		// The second block: its first text line is line 8.
		expect(editor.setCursor).toHaveBeenCalledWith(expect.objectContaining({ line: 8 }));
		expect(editor.scrollIntoView).toHaveBeenCalled();
		expect(editor.focus).toHaveBeenCalled();
		expect(ws.revealLeaf).toHaveBeenCalled();
	});

	it('keeps an editor that is already open and does not switch the mode', async () => {
		const { reg, view, editor } = setup('source');
		expect(await reg.showSource('n.md', 0)).toBe(true);
		expect(view.setState).not.toHaveBeenCalled();
		expect(editor.setCursor).toHaveBeenCalledWith(expect.objectContaining({ line: 3 }));
	});

	it('returns false when the block is gone', async () => {
		const { reg, editor } = setup('source');
		expect(await reg.showSource('n.md', 5)).toBe(false);
		expect(editor.setCursor).not.toHaveBeenCalled();
	});
});
