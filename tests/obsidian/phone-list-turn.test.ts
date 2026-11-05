import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, dispatchWindow, fireMediaChange, flushFrames, resetDom, resizeAll, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone, phoneOnSide } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * iPhone 0.5.2, screenshot 4: after test 3 (the list moved to Roderick) the owner turned the phone; the list showed Aldric, the start person, with its bar under Obsidian's
 * floating header. These tests show what the plugin does on a turn: nothing. The same view is kept, no draw and no scroll happen, and the list stays on Roderick. A new
 * view of the same block (Obsidian draws the block again) also starts on Roderick when it knows its section. Only a new view that Obsidian gives no section at first starts on
 * the start person, and it stays there when the section comes. Made-up people only.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const SRC = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: roderick, name: Roderick, sex: m, born: 1131, parents: [aldric, isolde]}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick]}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;

/** The list inside a leaf with a header of 104 px, the list top at `listTop`. */
async function openUnder(listTop: number) {
	phone();
	const host = fakeHost();
	const handle = fakeHandle('n.md', SRC);
	const e = await embed(SRC, { host, handle });
	const leaf = new FEl('div', { cls: 'workspace-leaf-content' });
	leaf.createDiv({ cls: 'view-header' }).clientHeight = 104;
	leaf.children.push(e.el);
	e.el.parentElement = leaf;
	vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
		const top = this.classes.has('dynasty-list-viewport') ? listTop : 0;
		return { left: 0, top, x: 0, y: top, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: top + this.clientHeight };
	});
	return { ...e, host, handle };
}

async function tapName(el: FEl, id: string): Promise<void> {
	dispatch(el.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-go`)!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	resizeAll();
	flushFrames();
}

/** The phone turns: the window gets its new size and every event that iOS can send for a turn arrives, then the late timer of `orientationchange`. */
async function turnSideways(): Promise<void> {
	phoneOnSide();
	dispatchWindow('resize');
	dispatchWindow('orientationchange');
	fireMediaChange();
	resizeAll();
	runTimers(400);
	flushFrames();
	await settle();
}

const centreOf = (el: FEl) => el.querySelector('.dynasty-list-root')?.getAttribute('data-dynasty-focus') ?? null;

describe('iPhone 0.5.2, screenshot 4: a turn of the phone with the list on Roderick', () => {
	it('keeps the same list: no new draw, no scroll, still on Roderick', async () => {
		const { el, host } = await openUnder(30);
		await tapName(el, 'roderick');
		expect(centreOf(el)).toBe('roderick');
		const rootBefore = el.querySelector('.dynasty-list-root');
		const renders = host.renders;
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		await turnSideways();
		expect(el.querySelector('.dynasty-list-root')).toBe(rootBefore);
		expect(host.renders).toBe(renders);
		expect(scrolled).not.toHaveBeenCalled();
		expect(centreOf(el)).toBe('roderick');
	});

	it('a new view of the same block that knows its section (Obsidian draws the block again) also starts on Roderick, with no scroll', async () => {
		const { el, host, handle } = await openUnder(30);
		await tapName(el, 'roderick');
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		const again = await embed(SRC, { host, handle });
		expect(centreOf(again.el)).toBe('roderick');
		expect(scrolled).not.toHaveBeenCalled();
	});
});

describe('iPhone 0.5.2, screenshot 4: a new view of the block that gets its section late', () => {
	it('starts on the session person (Roderick) once Obsidian tells the section, as the old view did', async () => {
		const { el, host, handle } = await openUnder(30);
		await tapName(el, 'roderick');
		expect(handle.state.focus?.id).toBe('roderick');
		// Obsidian draws the block again; its first answer to getSectionInfo is null (a Reading view can do this, D183), a later one the section.
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		let known = false;
		const info = { lineStart: 0, lineEnd: SRC.split('\n').length + 1, text: '' };
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => (known ? info : null), addChild: () => {} };
		const el2 = new FEl('div');
		const view = new TreeView(host as never, el2 as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		const vp = el2.querySelector('.dynasty-viewport');
		if (vp) {
			vp.clientWidth = 360;
			vp.clientHeight = 400;
		}
		resizeAll();
		flushFrames();
		const first = centreOf(el2);
		known = true;
		runTimers(5_000);
		await settle();
		resizeAll();
		flushFrames();
		await settle();
		const binding = (view as unknown as { binding: { handle: unknown; info: unknown } }).binding;
		// The view now knows its section and holds the block's handle, whose state still names Roderick; the list must follow it.
		expect({ section: binding.info !== null, attached: binding.handle === handle, handleFocus: handle.state.focus?.id }).toEqual({ section: true, attached: true, handleFocus: 'roderick' });
		// No scroll comes from this path either: a new view has no move to show.
		expect(scrolled).not.toHaveBeenCalled();
		expect({ first, after: centreOf(el2) }).toEqual({ first, after: 'roderick' });
	});
});
