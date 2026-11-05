import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetHeights, lastHeight } from '../../src/obsidian/block-height';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.8 P7 round 3 (D183): the height that a cold start keeps is the height of the whole tree root. The root holds the box and, on a
 * computer, the resize handle below it. The handle comes when the block is resolved, often after the first draw, and then the root is
 * taller while the box is not: the kept height must follow, or the placeholder is shorter than the tree and the note jumps.
 */
useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	forgetHeights();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;
const KEY = 'n.md\u0000#0';
const BOX = 500;
const GRIP = 14;

/** The fake DOM has no layout: a tree root is as high as its box, plus the handle when it has one. */
function layoutLikeBrowser(): void {
	const make = FEl.prototype.createEl;
	vi.spyOn(FEl.prototype, 'createEl').mockImplementation(function (this: FEl, tag: string, o?: never) {
		const e = make.call(this, tag, o);
		if (e.hasClass('dynasty-root')) Object.defineProperty(e, 'offsetHeight', { get: () => BOX + (e.querySelector(':scope > .dynasty-resize') ? GRIP : 0) });
		return e;
	} as never);
}

/** A view whose block Obsidian places at once, but whose handle comes later (`give` hands it over), as in a note that has just opened. */
async function lateHandleView(host: ReturnType<typeof fakeHost>) {
	const handle: FakeHandle = fakeHandle('n.md', SRC);
	let give: (h: FakeHandle) => void = () => undefined;
	const later = new Promise<FakeHandle>((res) => (give = res));
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => null, resolve: () => later, resolveByBody: () => null, inEditorOf: () => false });
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 360;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
	// 0.2.8 speed repair: the height of the root is read by an observer of the root, which answers once the page is laid out (a second round of observers here).
	resizeAll();
	return { el, give: async () => { give(handle); await settle(); resizeAll(); flushFrames(); resizeAll(); } };
}

describe('D183: the kept height follows the resize handle that comes after the first draw', () => {
	it('keeps the height of the root with the handle, not the height it had when the handle was missing', async () => {
		desktop();
		layoutLikeBrowser();
		const host = fakeHost(DEFAULT_SETTINGS);
		const { el, give } = await lateHandleView(host);
		expect(el.querySelector('.dynasty-resize')).toBeNull();
		expect(lastHeight(host.app as never, KEY)).toBe(BOX);
		await give();
		expect(el.querySelector('.dynasty-resize')).not.toBeNull();
		expect(lastHeight(host.app as never, KEY)).toBe(BOX + GRIP);
	});

	it('the placeholder of the next start has the height of that root and is a block', async () => {
		desktop();
		layoutLikeBrowser();
		const host = fakeHost(DEFAULT_SETTINGS);
		const first = await lateHandleView(host);
		await first.give();
		expect(lastHeight(host.app as never, KEY)).toBe(BOX + GRIP);
		// The next cold start of the same block: the styles are not in yet.
		const cold = fakeHost(DEFAULT_SETTINGS) as ReturnType<typeof fakeHost> & { startedUp: { ready(): boolean; cache(): boolean } };
		cold.startedUp = { ready: () => false, cache: () => false };
		Object.assign(cold.handles, { quickOrdinal: () => 0, peek: () => null, resolve: async () => null, resolveByBody: () => null, inEditorOf: () => false });
		(cold.app as never as { saveLocalStorage?: unknown }).saveLocalStorage = undefined;
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
		new TreeView(cold as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never).load();
		await settle();
		const box = el.querySelector('.dynasty-placeholder-box')!;
		expect(box.getAttribute('height')).toBe(String(BOX + GRIP));
		// Without the style sheet an inline svg leaves a gap under it (the line box), so the box says "block" in an attribute.
		expect(box.getAttribute('display')).toBe('block');
	});
});
