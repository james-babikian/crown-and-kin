import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { problemsPopupLine } from '../../src/render/ui-text';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, fakeDoc, flushFrames, pointer, resetDom, resizeAll, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fullViews, openFullScreen, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.5.2: how the small problem pop-up of the phone list in a note opens, closes and finds room (fake DOM; the real geometry is in problem-panel-in-note.test.ts, in Chrome).
 * In a note on a phone with a finger the triangle opens a small pop-up under the bar: a text line and the button "Show in full screen". The button opens the full-screen view
 * with its problem list (a sheet from the bottom) open. The full-screen view keeps its sheet; a computer keeps the menu next to the badge. Made-up names only.
 */

useFakeDom({ window: true });

/** The fake document keeps no listeners; these tests record them, so that a press anywhere reaches the ones that a popover set. */
type DocListener = (e: unknown) => void;
const onDoc = new Map<string, Set<DocListener>>();
const fire = (type: string, target: FEl, init: Record<string, unknown> = {}) => {
	const out = { stopped: false, prevented: false };
	const e = { type, target, ...init, stopPropagation: () => void (out.stopped = true), preventDefault: () => void (out.prevented = true) };
	for (const fn of [...(onDoc.get(type) ?? [])]) fn(e);
	return out;
};

beforeEach(() => {
	onDoc.clear();
	vi.spyOn(fakeDoc, 'addEventListener').mockImplementation(((type: string, fn: DocListener) => void onDoc.set(type, (onDoc.get(type) ?? new Set()).add(fn))) as never);
	vi.spyOn(fakeDoc, 'removeEventListener').mockImplementation(((type: string, fn: DocListener) => void onDoc.get(type)?.delete(fn)) as never);
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	vi.restoreAllMocks();
});

const WARN = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann, nobody]}
`;

const click = (target: FEl) => dispatch(target, 'click', { button: 0, detail: 1, pointerType: 'touch' });
const tap = (target: FEl, x = 20, y = 20, id = 1) => {
	fire('pointerdown', target, pointer('touch', id, x, y));
	fire('pointerup', target, pointer('touch', id, x, y));
};

async function openNote() {
	phone();
	const e = await embed(WARN, { host: fakeHost(), handle: fakeHandle('n.md', WARN) });
	const badge = e.el.querySelector('.dynasty-warning-badge')!;
	return { ...e, badge, panel: () => e.el.querySelector('.dynasty-popover') };
}

describe('the small problem pop-up of the phone list in a note, with a finger', () => {
	it('is a panel under the bar: no sheet, no grip, no cover, no long list; a text line with the count and one button', async () => {
		const { el, badge } = await openNote();
		click(badge);
		const pop = el.querySelector('.dynasty-popover')!;
		expect(pop.hasClass('is-panel')).toBe(true);
		expect(pop.hasClass('is-sheet')).toBe(false);
		expect(pop.hasClass('is-anchored')).toBe(false);
		expect(pop.querySelector('.dynasty-sheet-grip')).toBeNull();
		expect(el.querySelector('.dynasty-cover')).toBeNull();
		expect(pop.querySelector('.dynasty-problems-list')).toBeNull();
		expect(pop.querySelector('.dynasty-problem-button')).toBeNull();
		expect(pop.querySelector('.dynasty-sheet-close')).toBeNull();
		expect(pop.querySelectorAll('button')).toHaveLength(1);
		expect(pop.querySelector('.dynasty-problems-summary')!.getText()).toBe('This tree has 1 problem.');
		const button = pop.querySelector('button')!;
		expect(button.getText()).toBe('Show in full screen');
		expect(button.hasClass('dynasty-btn')).toBe(true);
		expect(button.hasClass('mod-cta')).toBe(false);
		expect(pop.style.getPropertyValue('--dynasty-pop-y')).not.toBe('');
	});

	it('the count line says "problem" for one problem and "problems" for more; the accessible name of the triangle is unchanged', async () => {
		const { el, badge } = await openNote();
		expect(badge.getAttribute('aria-label')).toBe('This tree has 1 problem. Show the problem.');
		expect(problemsPopupLine(1)).toBe('This tree has 1 problem.');
		expect(problemsPopupLine(3)).toBe('This tree has 3 problems.');
		expect(problemsPopupLine(16)).toBe('This tree has 16 problems.');
		click(badge);
		expect(el.querySelector('.dynasty-problems-summary')!.getText()).toBe(problemsPopupLine(1));
	});

	it('"Show in full screen" closes the pop-up and opens the full-screen view with its problem list open as a sheet from the bottom', async () => {
		const { el, badge, panel } = await openNote();
		click(badge);
		expect(fullViews()).toHaveLength(0);
		click(el.querySelector('.dynasty-problems-full')!);
		expect(panel()).toBeNull();
		await settle();
		resizeAll();
		flushFrames();
		expect(fullViews()).toHaveLength(1);
		const full = fullViews()[0].containerEl as unknown as FEl;
		const pop = full.querySelector('.dynasty-popover')!;
		expect(pop).not.toBeNull();
		expect(pop.hasClass('is-sheet')).toBe(true);
		expect(pop.hasClass('is-panel')).toBe(false);
		expect(pop.querySelector('.dynasty-sheet-grip')).not.toBeNull();
		expect(full.querySelector('.dynasty-cover')).not.toBeNull();
		expect(pop.querySelector('.dynasty-problem-button')).not.toBeNull();
		expect(pop.querySelector('.dynasty-problems-title')!.getText()).toBe('1 problem in this tree');
	});

	it('Expand opens the full-screen view with no list; the list comes only from the button of the pop-up', async () => {
		const { el } = await openNote();
		click(el.querySelector('.dynasty-expand')!);
		await settle();
		resizeAll();
		flushFrames();
		expect(fullViews()).toHaveLength(1);
		expect((fullViews()[0].containerEl as unknown as FEl).querySelector('.dynasty-popover')).toBeNull();
	});

	it('a key press on the triangle moves the focus to the button; Escape closes the pop-up and the focus goes back to the triangle', async () => {
		const { el, badge, panel } = await openNote();
		dispatch(badge, 'click', { button: 0, detail: 0 });
		const button = el.querySelector('.dynasty-problems-full')!;
		expect(fakeDoc.activeElement).toBe(button);
		const key = dispatch(button, 'keydown', { key: 'Escape' });
		expect(panel()).toBeNull();
		expect(key.defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).toBe(badge);
	});

	it('a touch tap on the triangle leaves the focus where it is', async () => {
		const { el, badge } = await openNote();
		fakeDoc.activeElement = null;
		click(badge);
		expect(fakeDoc.activeElement).not.toBe(el.querySelector('.dynasty-problems-full'));
	});

	it('a second tap on the badge closes it', async () => {
		const { badge, panel } = await openNote();
		click(badge);
		tap(badge);
		click(badge);
		expect(panel()).toBeNull();
	});

	it('a tap outside closes it, and the focus goes back to the badge', async () => {
		const { el, badge, panel } = await openNote();
		click(badge);
		tap(el.querySelector('.dynasty-list-row') ?? el);
		expect(panel()).toBeNull();
		expect(fakeDoc.activeElement).toBe(badge);
	});

	it('a press outside that ends far from where it began (a scroll of the note), or in a cancel, leaves it open', async () => {
		const { el, panel } = await openNote();
		const row = (el.querySelector('.dynasty-list-row') ?? el) as FEl;
		click(el.querySelector('.dynasty-warning-badge')!);
		fire('pointerdown', row, pointer('touch', 1, 100, 300));
		fire('pointerup', row, pointer('touch', 1, 100, 200));
		expect(panel()).not.toBeNull();
		fire('pointerdown', row, pointer('touch', 2, 100, 300));
		fire('pointercancel', row, pointer('touch', 2, 100, 250));
		fire('pointerup', row, pointer('touch', 2, 100, 250));
		expect(panel()).not.toBeNull();
	});

	it('the tap that closes it does not act on what lies under it: its click is stopped once, and a later click goes through', async () => {
		const { el, badge, panel } = await openNote();
		click(badge);
		const row = (el.querySelector('.dynasty-list-row') ?? el) as FEl;
		tap(row);
		expect(panel()).toBeNull();
		// The document hears the click first (capture), so a stop there keeps it from the row.
		const first = fire('click', row);
		expect(first.stopped).toBe(true);
		expect(first.prevented).toBe(true);
		// The next tap is a normal one.
		expect(fire('click', row).stopped).toBe(false);
	});

	it('the closing tap that gets no click leaves no listener after 400 ms', async () => {
		const { el, badge } = await openNote();
		click(badge);
		tap((el.querySelector('.dynasty-list-row') ?? el) as FEl);
		runTimers(500);
		expect(fire('click', el).stopped).toBe(false);
	});

	it('a scroll that leaves the pop-up open, and the button, swallow nothing', async () => {
		const { el, badge } = await openNote();
		click(badge);
		const row = (el.querySelector('.dynasty-list-row') ?? el) as FEl;
		fire('pointerdown', row, pointer('touch', 1, 100, 300));
		fire('pointerup', row, pointer('touch', 1, 100, 200));
		expect(fire('click', row).stopped).toBe(false);
		click(el.querySelector('.dynasty-problems-full')!);
		expect(fire('click', row).stopped).toBe(false);
	});

	it('the tap on the badge that closes it is not swallowed', async () => {
		const { badge } = await openNote();
		click(badge);
		tap(badge);
		expect(fire('click', badge).stopped).toBe(false);
	});

	it('a tap inside the panel leaves it open', async () => {
		const { el, panel } = await openNote();
		click(el.querySelector('.dynasty-warning-badge')!);
		tap(el.querySelector('.dynasty-problems-hint') ?? (panel() as FEl));
		expect(panel()).not.toBeNull();
	});

	it('leaves no listener behind after it closes: a later outside tap does nothing', async () => {
		const { el, badge, panel } = await openNote();
		click(badge);
		click(el.querySelector('.dynasty-problems-full')!);
		fakeDoc.activeElement = null;
		tap(el);
		expect(panel()).toBeNull();
		expect(fakeDoc.activeElement).toBeNull();
	});
});

describe('the room under the bar', () => {
	/** A note on a phone whose scroll area is the element of the block; the bar stands `barAt` px from the top of the screen before any scroll. */
	async function open(barAt: number, content: number) {
		phone();
		const e = await embed(WARN, { host: fakeHost(), handle: fakeHandle('n.md', WARN) });
		const leaf = new FEl('div', { cls: 'workspace-leaf-content' });
		leaf.createDiv({ cls: 'view-header' });
		leaf.children.push(e.el);
		e.el.parentElement = leaf;
		const area = e.el;
		area.clientHeight = 844;
		const top = () => barAt - area.scrollTop;
		const rect = (t: number, h: number) => ({ left: 0, right: 390, top: t, bottom: t + h, width: 390, height: h, x: 0, y: t, toJSON: () => ({}) });
		vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
			if (this.classes.has('view-header')) return rect(0, 104);
			if (this.classes.has('dynasty-toolbar')) return rect(top(), 48);
			if (this.classes.has('dynasty-list-viewport')) return rect(top(), 293);
			return rect(0, 844);
		});
		// The pop-up is made after the rectangles above; its content height is the number given.
		const make = FEl.prototype.createEl;
		vi.spyOn(FEl.prototype, 'createEl').mockImplementation(function (this: FEl, ...args: Parameters<FEl['createEl']>) {
			const c = make.apply(this, args);
			if (c.classes.has('dynasty-popover')) {
				c.scrollHeight = content;
				c.offsetHeight = content;
			}
			return c;
		});
		const before = globalThis.getComputedStyle;
		globalThis.getComputedStyle = ((x: FEl) => ({ overflowY: x === area ? 'auto' : 'visible' })) as unknown as typeof getComputedStyle;
		click(e.el.querySelector('.dynasty-warning-badge')!);
		globalThis.getComputedStyle = before;
		const pop = e.el.querySelector('.dynasty-popover')!;
		return { pop, area, host: e.el.querySelector('.dynasty-list-viewport') as FEl, y: () => Number.parseInt(pop.style.getPropertyValue('--dynasty-pop-y'), 10), cap: () => pop.style.getPropertyValue('--dynasty-pop-room') };
	}

	const need = (r: Awaited<ReturnType<typeof open>>) => r.host.style.getPropertyValue('--dynasty-pop-need');

	it('enough room under the bar: the note does not scroll and the pop-up opens 4 px under the bar, with no cap on its height', async () => {
		const r = await open(300, 110);
		expect(r.area.scrollTop).toBe(0);
		expect(r.y()).toBe(48 + 4);
		expect(r.cap()).toBe('');
	});

	it('while it is open the box has a minimum height that holds the whole pop-up and 8 px more; it is taken away when the pop-up closes', async () => {
		const r = await open(300, 110);
		expect(r.host.hasClass('has-pop-panel')).toBe(true);
		expect(need(r)).toBe(`${48 + 4 + 110 + 8}px`);
		click(r.pop.querySelector('.dynasty-problems-full')!);
		expect(r.host.hasClass('has-pop-panel')).toBe(false);
		expect(need(r)).toBe('');
	});

	it('little room under the bar: the note scrolls first so that the bar stands under the header (104 + 8 px), then the pop-up opens under the bar', async () => {
		const r = await open(800, 110);
		expect(r.area.scrollTop).toBe(800 - 112);
		expect(r.y()).toBe(48 + 4);
		expect(r.cap()).toBe('');
	});

	it('little room but the pop-up fits where it is: the note does not scroll', async () => {
		// The bar ends at 748, the pop-up starts at 752 and needs 110 px: it ends at 862, but the screen ends at 836 - so it does not fit; a bar at 690 does.
		const r = await open(690, 80);
		expect(r.area.scrollTop).toBe(0);
	});

	it('a bar that already stands under the header is not scrolled up or down by the pop-up', async () => {
		const r = await open(112, 110);
		expect(r.area.scrollTop).toBe(0);
	});
});

describe('the other places keep their lists', () => {
	it('the full-screen view on a phone still opens the problem list as a sheet from the bottom, with a grip and a cover', async () => {
		phone();
		const { root } = await openFullScreen(WARN);
		dispatch(root.querySelector('.dynasty-warning-badge')!, 'click', { button: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
		const pop = root.querySelector('.dynasty-popover')!;
		expect(pop.hasClass('is-sheet')).toBe(true);
		expect(pop.hasClass('is-panel')).toBe(false);
		expect(pop.querySelector('.dynasty-sheet-grip')).not.toBeNull();
		expect(root.querySelector('.dynasty-cover')).not.toBeNull();
	});

	it('a computer keeps the menu next to the badge: anchored, no sheet and no panel', async () => {
		desktop();
		const e = await embed(WARN, { host: fakeHost(), handle: fakeHandle('n.md', WARN) });
		click(e.el.querySelector('.dynasty-warning-badge')!);
		const pop = e.el.querySelector('.dynasty-popover')!;
		expect(pop.hasClass('is-anchored')).toBe(true);
		expect(pop.hasClass('is-sheet')).toBe(false);
		expect(pop.hasClass('is-panel')).toBe(false);
		expect(e.el.querySelector('.dynasty-cover')).toBeNull();
	});
});
