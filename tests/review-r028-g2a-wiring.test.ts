import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, sheets } from './acceptance/tree-view-fakes';

/*
 * G2 review of the 0.2.8 part-A repairs: wiring of openPersonOf. Run: npx vitest run tests/review-r028-g2a-wiring.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const SRC = 'people:\n  - {id: a, name: Ann, born: 1100}\n  - {id: b, name: Bob, parents: [a], born: 1130}\n';

/** A view of the same block as `handle`, with its box in `parent` (an embed in another note when `parent` has the class markdown-embed). */
async function viewIn(host: ReturnType<typeof fakeHost>, handle: ReturnType<typeof fakeHandle>, parent: FEl) {
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
	const el = new FEl('div');
	parent.appendChild(el);
	const info = { lineStart: 0, lineEnd: 5, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
	const view = new TreeView(host as never, el as never, SRC, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 360;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
	return view;
}

describe('openPersonOf (a tap on an heir in the Titles window)', () => {
	it('never opens the edit sheet from a view that is a read-only embed in another note', async () => {
		desktop();
		const host = fakeHost();
		const handle = fakeHandle('n.md', SRC);
		const own = await viewIn(host, handle, new FEl('div'));
		const outer = new FEl('div');
		outer.addClass('markdown-embed');
		const foreign = await viewIn(host, handle, outer);
		// The note drew the block again while the Titles window was open: the opening view is gone.
		own.unload();
		expect((foreign as unknown as { peekState(): unknown }).peekState()).toBe(handle.state);
		(TreeView as unknown as { openPersonOf(h: unknown, st: unknown, full: boolean, id: string, own: TreeView | null): void }).openPersonOf(host, handle.state, false, 'b', null);
		await settle();
		expect(sheets().length).toBe(0);
	});
});
