import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clock, installDom, resetDom, fakeWin, FEl, resizeAll, flushFrames, settle } from './acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from './acceptance/fake-obsidian';
import { fakeHandle, loadPlugin, openSheetOn, sheets, type Host } from './acceptance/tree-view-fakes';

/*
 * Search round 0.2.3, area D: the plugin's life (main.ts onload / onunload).
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

const SRC = 'people:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont\n    parents: [aldric]\n';

/** A tree that the plugin's own code block processor makes, as Obsidian calls it for a note in Reading view. */
async function processed(plugin: Host, fake: FakePlugin) {
	const handle = fakeHandle('n.md', SRC);
	Object.assign(plugin.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
	const el = new FEl('div');
	const children: { load(): void; unload(): void }[] = [];
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 9, text: '' }), addChild: (c: { load(): void; unload(): void }) => (c.load(), children.push(c)) };
	fake.codeBlockProcessors.get('dynasty')!(SRC, el, ctx);
	await settle();
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 360;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
	return { el, children };
}

describe('D3: the plugin is turned off while a tree is on screen', () => {
	it('onunload leaves no tree view of the plugin alive (the view is a child of the note, not of the plugin)', async () => {
		const { plugin, host } = await loadPlugin();
		const { children } = await processed(host, plugin as unknown as FakePlugin);
		expect(children).toHaveLength(1);
		expect(plugin.views.size).toBe(1);
		(plugin as unknown as FakePlugin).unload();
		// Obsidian does not unload the render children of a note when a plugin goes: only the plugin's own cleanups run.
		expect(plugin.views.size).toBe(0);
	});

	it('a card of such a tree does not open an edit sheet after the plugin is off (main.ts says nothing of the plugin writes after it is turned off)', async () => {
		const { plugin, host } = await loadPlugin();
		const { el } = await processed(host, plugin as unknown as FakePlugin);
		(plugin as unknown as FakePlugin).unload();
		const root = el.querySelector('.dynasty-root')!;
		let opened = 0;
		try {
			await openSheetOn(root, 'aldric', 'mouse');
			opened = sheets().length;
		} catch {
			opened = sheets().length;
		}
		expect(opened).toBe(0);
	});
});
