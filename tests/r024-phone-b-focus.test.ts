import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, clock, fakeDoc, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { click, stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * 0.2.4 phone-B, O2 (D124 fault 7; the proof is tests/s024-o2-sheet-focus-after-action.test.ts): the edit sheet draws its
 * form again after an action that writes, and a control that had the focus goes with the old form. The new form gives the
 * focus back to the same control (same key and place, never a disabled one), or to the sheet itself, so a keyboard user
 * stays inside the dialog. Made-up names only.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => vi.restoreAllMocks());

const BODY = ['people:', '  - id: mara', '    name: Mara', '  - id: roland', '    name: Roland', '  - id: edda', '    name: Edda', '    parents: [mara, roland]', ''].join('\n');

/** F7: a computer window moves the focus to Name in a microtask after the open; the tests start after that step. */
async function open(personId = 'edda') {
	const h = writingHandle(BODY);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	await settle();
	return { h, s, modal };
}

const inside = (modal: FEl) => fakeDoc.activeElement !== null && modal.contains(fakeDoc.activeElement);

describe('O2: the focus after the sheet is drawn again', () => {
	it('Remove parent: the focus goes to the Remove button of the next parent, not to the page', async () => {
		const { h, modal } = await open();
		const buttons = modal.querySelectorAll('.dynasty-remove-parent');
		expect(buttons).toHaveLength(2);
		buttons[0]!.focus();
		await click(buttons[0]);
		expect(h.ops).toHaveLength(1);
		const rest = modal.querySelectorAll('.dynasty-remove-parent');
		expect(rest).toHaveLength(1);
		expect(fakeDoc.activeElement).toBe(rest[0]);
	});

	it('Remove parent on the last button of the list: the focus stays on the one that is left', async () => {
		const { modal } = await open();
		const buttons = modal.querySelectorAll('.dynasty-remove-parent');
		buttons[1]!.focus();
		await click(buttons[1]);
		const rest = modal.querySelectorAll('.dynasty-remove-parent');
		expect(rest).toHaveLength(1);
		expect(fakeDoc.activeElement).toBe(rest[0]);
	});

	it('a button that is gone (Pin becomes Unpin): the focus goes to the sheet', async () => {
		const { modal } = await open();
		const pin = modal.querySelector('.dynasty-pin')!;
		pin.focus();
		await click(pin);
		expect(modal.querySelector('.dynasty-pin')).toBeNull();
		expect(fakeDoc.activeElement).toBe(modal);
		expect(modal.getAttribute('tabindex')).toBe('-1');
	});

	it('a field that had the focus when a write changed the sheet gets it again, with its caret', async () => {
		const { h, s, modal } = await open();
		const set = vi.fn();
		(FEl.prototype as unknown as { setSelectionRange: unknown }).setSelectionRange = set;
		const old = modal.querySelector('[data-field="born"] input')!;
		Object.assign(old, { selectionStart: 2, selectionEnd: 4 });
		old.focus();
		const body = h.body.replace('name: Roland', 'name: Roland II');
		h.body = body;
		s.reload(body);
		const now = modal.querySelector('[data-field="born"] input')!;
		expect(now).not.toBe(old);
		expect(fakeDoc.activeElement).toBe(now);
		expect(set).toHaveBeenCalledWith(2, 4);
		delete (FEl.prototype as unknown as { setSelectionRange?: unknown }).setSelectionRange;
	});

	it('the new control gets the focus without a scroll (the scroll place is kept)', async () => {
		const { modal } = await open();
		const buttons = modal.querySelectorAll('.dynasty-remove-parent');
		buttons[0]!.focus();
		const focus = vi.spyOn(FEl.prototype, 'focus');
		await click(buttons[0]);
		const calls = focus.mock.calls as unknown[][];
		expect(calls[calls.length - 1]![0]).toEqual({ preventScroll: true });
	});

	it('a sheet that does not have the focus does not take it', async () => {
		const { h, s } = await open();
		fakeDoc.activeElement = null;
		const body = h.body.replace('name: Roland', 'name: Roland II');
		h.body = body;
		s.reload(body);
		expect(fakeDoc.activeElement).toBeNull();
	});

	it('the focus stays inside the dialog after the sheet was drawn again by a write, for every keyed action button', async () => {
		const { modal } = await open();
		for (const cls of ['dynasty-mark-me']) {
			const b = modal.querySelector(`.${cls}`)!;
			b.focus();
			await click(b);
			expect(inside(modal)).toBe(true);
		}
	});
});
