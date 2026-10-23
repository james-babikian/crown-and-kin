import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetHeights } from '../../src/obsidian/block-height';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, resetDom, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Review r028-ios-start, cause (b): "Read only" and "Open note" show for a block whose place is only not known YET (D183: never).
 *  b1: Obsidian answers getSectionInfo null at the first call (cold start) and a section later. The view asks once, in the constructor, and never again
 *      (block-binding.ts, readOnly = info === null). In a Reading view lateResolve cannot help (inEditorOf is false). After the 2 s limit the list
 *      is drawn read only, and it stays so.
 *  b2: the section is known, but the first `resolve` of the handle answers null (note not read yet). attach(null) (block-binding.ts) sets readOnly at
 *      once and shows the label and the chip; the retry 250 ms later (RESOLVE_RETRIES_MS) turns them off. That is the 0.5 s of "Read only" that the owner saw.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
	forgetHeights();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;

const readOnlyShown = (el: FEl) => ({ label: !!el.querySelector('.dynasty-read-only-label'), chip: !!el.querySelector('.dynasty-open-source') });

describe('r028-ios-start (b1): the section is not known at the first call and known later', () => {
	it('a list in a Reading view asks again, and is never read only once Obsidian knows the section', async () => {
		phone();
		const h = fakeHandle('n.md', SRC);
		const host = fakeHost();
		Object.assign(host, { startedUp: { ready: () => true, cache: () => true } });
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => h, resolve: async () => h, resolveByBody: () => h, inEditorOf: () => false });
		const el = new FEl('div');
		new FEl('div', { cls: 'markdown-reading-view' }).appendChild(el);
		const known = { v: false };
		const info = { lineStart: 0, lineEnd: 4, text: '' };
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => (known.v ? info : null), addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		// The start wait holds the box while the place is not known.
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		// 300 ms later Obsidian knows the section.
		known.v = true;
		runTimers(3000);
		await settle();
		// Expected: the view found its block (editable: Add person), or at least never said "Read only".
		expect({ ...readOnlyShown(el), addPerson: !!el.querySelector('.dynasty-add-person') }).toEqual({ label: false, chip: false, addPerson: true });
	});
});

describe('r028-ios-start (b2): the section is known, the first resolve of the handle answers null', () => {
	it('shows no "Read only" and no "Open note" while a retry is still to come', async () => {
		phone();
		const h = fakeHandle('n.md', SRC);
		const host = fakeHost();
		Object.assign(host, { startedUp: { ready: () => true, cache: () => true } });
		let calls = 0;
		Object.assign(host.handles, {
			quickOrdinal: () => 0,
			peek: () => null,
			// A cold start: the note is not read yet at the first call (the retry at 250 ms finds it).
			resolve: async () => (++calls === 1 ? null : h),
			resolveByBody: () => null,
			inEditorOf: () => false,
		});
		const el = new FEl('div');
		new FEl('div', { cls: 'markdown-reading-view' }).appendChild(el);
		const info = { lineStart: 0, lineEnd: 4, text: '' };
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		// The first resolve is over and the retry has not run yet: the block is not known YET, and nothing says it cannot be edited.
		expect(calls).toBe(1);
		expect(readOnlyShown(el)).toEqual({ label: false, chip: false });
		// Control: the retry finds the block and the view is editable.
		runTimers(300);
		await settle();
		expect(calls).toBe(2);
		expect(el.querySelector('.dynasty-add-person')).not.toBeNull();
		expect(readOnlyShown(el)).toEqual({ label: false, chip: false });
	});
});
