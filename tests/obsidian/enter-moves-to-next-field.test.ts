import { beforeEach, describe, expect, it } from 'vitest';

import { endEntryOnEnter } from '../../src/obsidian/sheet-parts';
import { FEl, device, dispatch, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Enter in a one-line field: on a computer the focus goes to the next field and nothing is saved; the last field lets go of the focus;
 * on a phone or a tablet the field lets go of the focus (the keyboard closes). Ctrl or Cmd with Enter is the Save key, not this.
 */

useFakeDom({ window: true });

beforeEach(() => resetDom());

/** A window body with three one-line fields; `endEntryOnEnter` is on the first two. */
function body() {
	const content = new FEl('div', { cls: 'dynasty-sheet-content' });
	const sheetBody = content.createDiv('dynasty-sheet-body');
	const make = (type = 'text') => sheetBody.createDiv('dynasty-sheet-field').createEl('input', { attr: { type } });
	const a = make();
	const b = make();
	const c = make();
	endEntryOnEnter(a as never);
	endEntryOnEnter(b as never);
	return { content, sheetBody, a, b, c, make };
}

const enter = (el: FEl, init: Record<string, unknown> = {}) => dispatch(el, 'keydown', { key: 'Enter', ...init });

describe('Enter in a one-line field on a computer', () => {
	it('moves the focus to the next field and does not save', () => {
		const { a, b, c } = body();
		a.focus();
		expect(enter(a).defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).toBe(b);
		enter(b);
		expect(fakeDoc.activeElement).toBe(c);
	});

	it('skips a field that Tab does not reach: off, hidden, out of the order, or without a box (a closed section)', () => {
		const { a, b, c, make, sheetBody } = body();
		b.disabled = true;
		a.focus();
		enter(a);
		expect(fakeDoc.activeElement).toBe(c);
		b.disabled = false;

		const gap = sheetBody.createDiv('dynasty-sheet-field');
		const hidden = gap.createEl('input', { attr: { type: 'hidden' } });
		const loose = gap.createEl('input', { attr: { tabindex: '-1' } });
		const boxless = gap.createEl('input');
		(boxless as unknown as { getClientRects: () => unknown[] }).getClientRects = () => [];
		void hidden;
		void loose;
		const last = make();
		c.focus();
		endEntryOnEnter(c as never);
		enter(c);
		expect(fakeDoc.activeElement).toBe(last);
	});

	it('lets go of the focus in the last field', () => {
		const { c } = body();
		endEntryOnEnter(c as never);
		c.focus();
		enter(c);
		expect(fakeDoc.activeElement).toBeNull();
	});

	it('stays out of the way of an input method and of the Save key', () => {
		const { a, b } = body();
		a.focus();
		expect(enter(a, { isComposing: true }).defaultPrevented).toBe(false);
		expect(enter(a, { keyCode: 229 }).defaultPrevented).toBe(false);
		expect(enter(a, { ctrlKey: true }).defaultPrevented).toBe(false);
		expect(enter(a, { metaKey: true }).defaultPrevented).toBe(false);
		expect(dispatch(a, 'keydown', { key: 'a' }).defaultPrevented).toBe(false);
		expect(fakeDoc.activeElement).toBe(a);
		void b;
	});

	it('works in a window with no body class around the field: it lets go of the focus', () => {
		const lone = new FEl('input');
		endEntryOnEnter(lone as never);
		lone.focus();
		enter(lone);
		expect(fakeDoc.activeElement).toBeNull();
	});
});

describe('Enter in a one-line field on a phone or a tablet', () => {
	it('lets go of the focus and does not move it', () => {
		device.coarse = true;
		const { a } = body();
		a.focus();
		expect(enter(a).defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).toBeNull();
	});
});
