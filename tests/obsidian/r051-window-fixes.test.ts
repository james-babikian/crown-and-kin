import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { openUnionEditor, type UnionValues } from '../../src/obsidian/union-edit';
import { UNION_EDIT } from '../../src/render/ui-text';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, device, dispatch, fakeDoc, fireMediaChange, resetDom, resizeAll, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { sample12 } from '../acceptance/relations-support';
import { desktop, openFullScreen, phone, tabletDevice } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Window repairs for a narrow window (D316): (B) the bar of the full-screen view in a window under 600 px that has the wide set of buttons wraps and Close does not stick over More;
 * (C) the link Remove of a name list ends above the fields; the cross of a window keeps its icon in a 44 px box on a tablet; the partnership window has the two names as its
 * title on every device. The real positions are proved in the harness step `r051 window`; these tests pin the code and the style rules that make them.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const css = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8');
/** The body of every rule whose selector text contains `selector` (a rule inside an at-rule too). */
const bodies = (selector: string): string[] => {
	const out: string[] = [];
	let from = 0;
	for (;;) {
		const at = css.indexOf(selector, from);
		if (at < 0) return out;
		const open = css.indexOf('{', at);
		out.push(css.slice(open + 1, css.indexOf('}', open)));
		from = open;
	}
};

describe('(B) the bar of the full-screen view in a narrow window', () => {
	const F12 = sample12().source;
	const toolClasses = (root: FEl) => root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);

	it('a tablet in a window under 600 px has the wide set of buttons and the class that the styles need', async () => {
		tabletDevice();
		// The screen is a tablet's; the window is a Slide Over window.
		device.screenWidth = 820;
		device.screenHeight = 1180;
		device.width = 375;
		device.height = 900;
		const v = await openFullScreen(F12);
		expect((v.modal.modalEl as unknown as FEl).hasClass('is-phone')).toBe(true);
		const bar = v.root.querySelector('.dynasty-toolbar')!;
		expect(bar.hasClass('has-wide-set')).toBe(true);
		const tools = toolClasses(v.root);
		expect(tools).toContain('dynasty-fit');
		expect(tools).toContain('dynasty-titles-button');
		expect(tools[tools.length - 1]).toBe('dynasty-close');
	});

	it('a phone has its own set of six buttons and not the class', async () => {
		phone();
		const v = await openFullScreen(F12);
		const bar = v.root.querySelector('.dynasty-toolbar')!;
		expect(bar.hasClass('has-wide-set')).toBe(false);
		expect(toolClasses(v.root)).not.toContain('dynasty-fit');
	});

	it('a computer has the class too; the styles name is-phone, so only a narrow window changes', async () => {
		desktop();
		const v = await openFullScreen(F12);
		expect(v.root.querySelector('.dynasty-toolbar')!.hasClass('has-wide-set')).toBe(true);
	});

	it('the rules wrap the bar and put Close in the flow, for is-phone and is-phone-side together', () => {
		// The twin rule of the side bar: each rule names is-phone-side on the line before (tests/obsidian/r031-side-bar.test.ts).
		expect(css).toContain('.modal.dynasty-fullscreen.is-phone-side .dynasty-full .dynasty-toolbar.has-wide-set,\n.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar.has-wide-set {');
		expect(css).toContain('.modal.dynasty-fullscreen.is-phone-side .dynasty-full .dynasty-toolbar.has-wide-set .dynasty-close,\n.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar.has-wide-set .dynasty-close {');
		const bar = bodies('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar.has-wide-set {').join('\n');
		expect(bar).toContain('flex-wrap: wrap');
		expect(bar).toContain('height: auto');
		expect(bar).toContain('overflow: visible');
		expect(bar).toContain('min-height: calc(52px + env(safe-area-inset-bottom))');
		const close = bodies('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar.has-wide-set .dynasty-close {').join('\n');
		expect(close).toContain('position: relative');
		expect(close).toContain('margin-left: auto');
		expect(close).not.toContain('sticky');
	});

	it('the problem list stands above the real height of the bar, not above a fixed one-row or two-row size', () => {
		const rule = bodies('.dynasty-popover:not(.is-anchored):not(.is-sheet) {').join('\n');
		expect(rule).toContain('bottom: calc(var(--dynasty-bar-h, calc(52px + env(safe-area-inset-bottom))) + var(--size-4-2))');
		expect(rule).toContain('max-height: calc(100% - var(--dynasty-bar-h, calc(52px + env(safe-area-inset-bottom))) - 4 * var(--size-4-2))');
		expect(css).not.toContain('@container (max-width: 487px)');
	});

	it('a bar that changes height with no resize (the problem badge comes) sets the reserve and the inset again', async () => {
		tabletDevice();
		device.screenWidth = 820;
		device.screenHeight = 1180;
		device.width = 375;
		device.height = 900;
		const v = await openFullScreen(F12);
		const bar = v.root.querySelector('.dynasty-toolbar')! as unknown as { offsetTop: number; offsetHeight: number };
		const vp = v.vp as unknown as FEl & { clientHeight: number };
		const view = [...v.views][0] as unknown as { insetBottom: number };
		vp.clientHeight = 800;
		// One row: 52 px, at the bottom.
		bar.offsetTop = 748;
		bar.offsetHeight = 52;
		resizeAll();
		expect(vp.style.getPropertyValue('--dynasty-bar-h')).toBe('52px');
		expect(view.insetBottom).toBe(56);
		// The badge came and the bar wraps into two rows: no resize of the window happened.
		bar.offsetTop = 704;
		bar.offsetHeight = 96;
		resizeAll();
		expect(vp.style.getPropertyValue('--dynasty-bar-h')).toBe('96px');
		expect(view.insetBottom).toBe(100);
		// The bar is at the top (a computer window): no reserve is kept.
		bar.offsetTop = 0;
		bar.offsetHeight = 44;
		resizeAll();
		expect(vp.style.getPropertyValue('--dynasty-bar-h')).toBe('');
	});
});

describe('(C) Remove of a name list (0.5.1 repair: at the end of the list)', () => {
	it('no rule raises the label line or takes Remove out of the flow any more', () => {
		expect(css).not.toContain('--dynasty-cal-label-min');
		expect(css).not.toContain('--dynasty-cal-remove-top');
		expect(css).not.toContain('--dynasty-cal-remove-h');
		expect(css).not.toContain('dynasty-cal-list-head');
		expect(css).not.toMatch(/button\.dynasty-cal-remove-list\s*\{[^}]*position:\s*absolute/);
	});

	it('the link is a quiet link at the left, as "Remove this calendar", with a touch area of 44 px where a finger touches', () => {
		expect(css).toMatch(/\.dynasty-sheet button\.dynasty-cal-remove-list,\s*\.dynasty-sheet button\.dynasty-cal-remove-cal\s*\{[^}]*align-self:\s*flex-start/);
		expect(css).toMatch(/@media \(pointer: coarse\) \{[^@]*\.dynasty-sheet button\.dynasty-cal-remove-list,[^}]*min-height:\s*44px/);
		expect(css).toMatch(/\.dynasty-sheet\.is-phone button\.dynasty-cal-remove-list,[^}]*min-height:\s*44px/);
	});
});

describe('the cross of a window on a tablet', () => {
	it('keeps its icon: no shrink in the flex box, and no padding of Obsidian\'s tablet rule', () => {
		const icon = bodies('.dynasty-icon-btn .svg-icon {')[0];
		expect(icon).toContain('width: 17px');
		expect(icon).toContain('flex: none');
		const pad = bodies('.dynasty-sheet button.dynasty-icon-btn.dynasty-icon-btn {')[0];
		expect(pad).toContain('padding: 0');
	});

	it('the box of an icon button is 44 px on a touch screen', () => {
		expect(css).toMatch(/@media \(pointer: coarse\) \{[^@]*\.dynasty-icon-btn \{\s*width: 44px;\s*height: 44px;/);
	});
});

describe('the title of the partnership window (D316)', () => {
	const initial: UnionValues = { type: 'marriage', start: '', end: '', endedBy: '' };
	const open = () => {
		openUnionEditor({} as never, 'Aldric Valmont', 'Isolde Orsini', initial, async () => null);
		const modal = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
		return modal;
	};

	it('a computer window has the two names as its first text line and as its hidden title', () => {
		desktop();
		const m = open();
		const title = m.contentEl.querySelector('.dynasty-sheet-title')!;
		expect(title.getText()).toBe('Aldric Valmont and Isolde Orsini');
		expect(title.hasClass('dynasty-sr-only')).toBe(true);
		expect(m.contentEl.querySelector('.dynasty-choice-text')!.getText()).toBe('Aldric Valmont and Isolde Orsini');
	});

	it('a phone window has the same two names in the bar, shown at once, and not a second time under it', () => {
		phone();
		fireMediaChange();
		const m = open();
		expect(m.modalEl.hasClass('is-phone')).toBe(true);
		const title = m.contentEl.querySelector('.dynasty-bar-title')!;
		expect(title.getText()).toBe('Aldric Valmont and Isolde Orsini');
		expect(m.contentEl.querySelector('.dynasty-bar')!.hasClass('is-titled')).toBe(true);
		expect(m.contentEl.querySelector('.dynasty-choice-text')).toBeNull();
	});

	it('the window is named by that title for a screen reader on both', () => {
		for (const set of [desktop, phone]) {
			resetDom();
			resetObsidian();
			set();
			fireMediaChange();
			const m = open();
			const id = m.modalEl.getAttribute('aria-labelledby');
			expect(id).toBeTruthy();
			// The fake DOM has no `#id` selector.
			// The name is the hidden purpose, then the two names: "Edit partnership, Aldric Valmont and Isolde Orsini".
			const ids = (id ?? '').split(' ');
			expect(ids.length).toBe(2);
			const text = ids.map((i) => m.contentEl.querySelectorAll('[id]').find((e) => e.getAttribute('id') === i)?.getText());
			expect(text).toEqual([UNION_EDIT.purpose, 'Aldric Valmont and Isolde Orsini']);
			expect(m.modalEl.getAttribute('aria-label')).toBeNull();
			expect(m.contentEl.querySelectorAll('[id]').find((e) => e.getAttribute('id') === ids[0])?.hasClass('dynasty-sr-only')).toBe(true);
		}
	});

	it('the text table keeps "Edit partnership" as the hidden purpose, not as a title', () => {
		expect(UNION_EDIT.purpose).toBe('Edit partnership');
		expect(Object.keys(UNION_EDIT)).not.toContain('title');
	});

	it('a long pair wraps to three text lines at most on a phone, with an ellipsis, between Cancel and Save', () => {
		const rule = bodies('.dynasty-union-edit .dynasty-bar .dynasty-bar-title {')[0];
		expect(rule).toContain('-webkit-line-clamp: 3');
		expect(rule).toContain('white-space: normal');
		expect(rule).toContain('overflow-wrap: anywhere');
		// The bar already gives the title the grid column between the two buttons, with `overflow: hidden`.
		expect(bodies('.dynasty-bar .dynasty-bar-title {')[0]).toContain('overflow: hidden');
	});
});

describe('the partnership window opens with no field focused (0.5.1)', () => {
	const initial: UnionValues = { type: 'marriage', start: '', end: '', endedBy: '' };

	it('the window has the focus and its type list never gets it, so an iPad does not open the list by itself', () => {
		const focus = vi.spyOn(FEl.prototype, 'focus');
		openUnionEditor({} as never, 'Aldric Valmont', 'Isolde Orsini', initial, async () => null);
		const m = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
		runTimers(300);
		expect(fakeDoc.activeElement).toBe(m.modalEl);
		expect(m.modalEl.getAttribute('aria-labelledby')).toBeTruthy();
		expect(focus.mock.contexts.some((c) => (c as FEl).tag === 'select')).toBe(false);
	});

	it('the window does not take the focus after the user pressed in it', () => {
		openUnionEditor({} as never, 'Aldric Valmont', 'Isolde Orsini', initial, async () => null);
		const m = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
		const start = m.contentEl.querySelector('input')!;
		dispatch(m.modalEl, 'pointerdown');
		start.focus();
		runTimers(300);
		expect(fakeDoc.activeElement).toBe(start);
	});
});
