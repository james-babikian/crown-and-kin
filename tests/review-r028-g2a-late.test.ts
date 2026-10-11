import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost } from './acceptance/tree-view-fakes';

/*
 * G2 review of the 0.2.8 part-A repairs: lateResolve and inNoteView. Run: npx vitest run tests/review-r028-g2a-late.test.ts
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

const SRC = 'people:\n  - {id: a, name: Ann, born: 1100}\n';

/** A block with no section info (a callout in Live Preview) inside the ancestors `classes` (outermost first). */
async function block(classes: string[], inEditor: () => boolean) {
	desktop();
	const host = fakeHost();
	const handle = fakeHandle('n.md', SRC);
	Object.assign(host.handles, { quickOrdinal: () => null, peek: () => null, resolve: async () => null, resolveByBody: () => handle, inEditorOf: inEditor });
	let parent = new FEl('div');
	const top = parent;
	for (const c of classes) {
		const n = new FEl('div');
		n.addClass(c);
		parent.appendChild(n);
		parent = n;
	}
	const el = new FEl('div');
	parent.appendChild(el);
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => null, addChild: () => {} };
	const view = new TreeView(host as never, el as never, SRC, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	return { view: view as unknown as { lateTried: boolean; handle: unknown; lateResolve(): void }, top };
}

describe('lateResolve: where the wait for the block place goes on', () => {
	it.each([
		['Live Preview', ['markdown-source-view', 'cm-editor']],
		['Reading view', ['markdown-reading-view', 'markdown-preview-view']],
		['a Live Preview callout in the editor only', ['cm-editor']],
	])('%s: no sure answer yet means the wait goes on', async (_n, classes) => {
		const b = await block(classes, () => false);
		b.view.lateResolve();
		expect(b.view.lateTried).toBe(false);
	});

	it('Live Preview: once the editor holds the block the handle is found', async () => {
		let there = false;
		const b = await block(['markdown-source-view', 'cm-editor'], () => there);
		there = true;
		b.view.lateResolve();
		expect(b.view.lateTried).toBe(true);
		expect(b.view.handle).toBeTruthy();
	});

	it.each([
		['an embed', ['markdown-source-view', 'markdown-embed']],
		['a hover preview', ['hover-popover']],
		['a Canvas card', ['canvas-node']],
		['the side view of another plugin', ['workspace-leaf-content', 'other-plugin-view']],
	])('%s: the wait ends at once', async (_n, classes) => {
		const b = await block(classes, () => false);
		b.view.lateResolve();
		expect(b.view.lateTried).toBe(true);
	});
});
