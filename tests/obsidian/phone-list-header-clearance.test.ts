import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { LIST_HEADER_GAP, listScrollMargin } from '../../src/view/phone-list';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * After a tap on a name the list starts under the header of the note, so that the bar (Back, Find) shows. Obsidian's phone header is fixed over the note, so the old
 * `scrollIntoView` put the bar behind it. The margin is read from the header at run time. Made-up people only; the real header is for the iPhone.
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

/** Opens the list inside a leaf that has a header of the given bottom edge (null: no header). */
async function openUnder(headerBottom: number | null) {
	phone();
	const e = await embed(SRC, { host: fakeHost(), handle: fakeHandle('n.md', SRC) });
	if (headerBottom !== null) {
		const leaf = new FEl('div', { cls: 'workspace-leaf-content' });
		leaf.createDiv({ cls: 'view-header' }).clientHeight = headerBottom;
		leaf.children.push(e.el);
		e.el.parentElement = leaf;
	}
	return e;
}

/** The rectangle of the header and of the list: the header's bottom is its height, the list stands where the test puts it. */
function layout(listTop: number) {
	vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
		const top = this.classes.has('dynasty-list-viewport') ? listTop : 0;
		return { left: 0, top, x: 0, y: top, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: top + this.clientHeight };
	});
}

async function tapName(el: FEl, id: string): Promise<void> {
	dispatch(el.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-go`)!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	resizeAll();
	flushFrames();
}

describe('the scroll margin of the list (pure)', () => {
	it('is the part of the scroll area that the header covers, plus 8 px', () => {
		expect(LIST_HEADER_GAP).toBe(8);
		expect(listScrollMargin(104, 0)).toBe(112);
		expect(listScrollMargin(103.2, 0)).toBe(112);
		expect(listScrollMargin(104, 59)).toBe(45 + 8);
	});

	it('is 0 when there is no header or the header does not cover the scroll area', () => {
		expect(listScrollMargin(null, 0)).toBe(0);
		expect(listScrollMargin(0, 0)).toBe(0);
		expect(listScrollMargin(104, 104)).toBe(0);
		expect(listScrollMargin(104, 130)).toBe(0);
	});
});

describe('the list after a move', () => {
	it('under a header of 104 px, the list top stands 8 px under it: the margin is set and the note scrolls when the top is behind the header', async () => {
		const { el } = await openUnder(104);
		layout(30);
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		await tapName(el, 'roderick');
		const viewport = el.querySelector('.dynasty-list-viewport')!;
		expect(viewport.style.getPropertyValue('--dynasty-list-clear')).toBe('112px');
		expect(scrolled).toHaveBeenCalledTimes(1);
		expect(scrolled.mock.contexts[0]).toBe(viewport);
	});

	it('does not scroll when the list top already stands under the header', async () => {
		const { el } = await openUnder(104);
		layout(200);
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		await tapName(el, 'roderick');
		expect(el.querySelector('.dynasty-list-viewport')!.style.getPropertyValue('--dynasty-list-clear')).toBe('112px');
		expect(scrolled).not.toHaveBeenCalled();
	});

	it('with no header it keeps the old rule: no margin, and a scroll only when the top is above the screen', async () => {
		const { el } = await openUnder(null);
		layout(-50);
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		await tapName(el, 'roderick');
		expect(el.querySelector('.dynasty-list-viewport')!.style.getPropertyValue('--dynasty-list-clear')).toBe('');
		expect(scrolled).toHaveBeenCalledTimes(1);
	});

	it('the style of the list turns the room into the scroll margin of the viewport', () => {
		expect(readFileSync('styles/31-phone-list.css', 'utf8')).toMatch(/\.dynasty-viewport\.dynasty-list-viewport \{[^}]*scroll-margin-top: var\(--dynasty-list-clear, 0\);/);
	});

	it('the top of the list is compared with the top of the scroll area, not with the top of the screen', async () => {
		// The scroll area starts at y 40 (a pane or a theme moves it down); the header ends at 104, so it covers 64 px of the area and the clearance is 72 px.
		const { el } = await openUnder(104);
		const area = el;
		const before = globalThis.getComputedStyle;
		globalThis.getComputedStyle = ((e: FEl) => ({ overflowY: e === area ? 'auto' : 'visible' })) as unknown as typeof getComputedStyle;
		vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
			const top = this.classes.has('dynasty-list-viewport') ? 100 : this === area ? 40 : 0;
			return { left: 0, top, x: 0, y: top, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: top + this.clientHeight };
		});
		try {
			const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
			await tapName(el, 'roderick');
			// 100 - 40 = 60 is under the clearance of 72, so the note scrolls; compared with the screen top (100 > 72) it would not.
			expect(el.querySelector('.dynasty-list-viewport')!.style.getPropertyValue('--dynasty-list-clear')).toBe('72px');
			expect(scrolled).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.getComputedStyle = before;
		}
	});

	it('a draw that is no move does not scroll', async () => {
		const { el } = await openUnder(104);
		layout(-50);
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		resizeAll();
		flushFrames();
		expect(el.querySelector('.dynasty-list-viewport')).not.toBeNull();
		expect(scrolled).not.toHaveBeenCalled();
	});
});
