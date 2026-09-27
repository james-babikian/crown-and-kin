import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { SHEET } from '../../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { embed, fakeHandle, type FakeHandle } from './tree-view-fakes';

/*
 * Review of WP6.3 (code-reviewer): proof tests for the Houses window. Each test states the
 * behaviour the spec or the decision notes "M6 design gate" asks for.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const SOURCE = `houses:
  - id: valmont
    name: House Valmont
  - id: thorne
    name: House Thorne

people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
  - id: brand
    name: Brand
`;

function writingHandle(body = SOURCE): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	return h;
}

const housesWindows = () => openModals.filter((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow[];

async function openWindow(handle = writingHandle()) {
	const e = await embed(handle.body, { handle });
	const button = e.el.querySelector('.dynasty-houses-button')!;
	button.focus();
	dispatch(button, 'click');
	await settle();
	const win = housesWindows()[0];
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { handle, win, content, modal };
}

const row = (content: FEl, id: string) => content.querySelector(`.dynasty-house-row[data-house="${id}"]`)!;
const byText = (el: FEl, sel: string, text: string) => el.querySelectorAll(sel).find((b) => b.getText() === text) ?? null;
/** The focus is on a control that is still in the window (not on a removed element, not outside). */
const focusInWindow = (modal: FEl) => fakeDoc.activeElement !== null && modal.contains(fakeDoc.activeElement);

function type(input: FEl, text: string): void {
	input.value = text;
	dispatch(input, 'input');
}

describe('review 6.3: keyboard focus in the Houses window (spec §5.2, the decision notes keyboard DoD)', () => {
	it('"Continue to edit" in the "Discard changes?" question gives the focus back to the window', async () => {
		const { content, modal, win } = await openWindow();
		type(row(content, 'valmont').querySelector('input')!, 'Changed');
		win.close();
		const keep = byText(modal, 'button', SHEET.keepEditing)!;
		expect(fakeDoc.activeElement).toBe(keep);
		dispatch(keep, 'click');
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(focusInWindow(modal)).toBe(true);
	});

	it('Esc in the "Discard changes?" question gives the focus back to the window', async () => {
		const { content, modal, win } = await openWindow();
		type(row(content, 'valmont').querySelector('input')!, 'Changed');
		win.close();
		win.close();
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(focusInWindow(modal)).toBe(true);
	});

	it('after a stale Save the focus stays in the window', async () => {
		const handle = writingHandle();
		const { content, modal } = await openWindow(handle);
		type(row(content, 'valmont').querySelector('input')!, 'My Valmont');
		handle.body = SOURCE.replace('  - id: brand\n    name: Brand\n', '  - id: brand\n    name: Brand the Bold\n');
		const saveButton = content.querySelector('.dynasty-sheet-save')!;
		saveButton.focus();
		dispatch(saveButton, 'click');
		await settle();
		expect(housesWindows()).toHaveLength(1);
		expect(focusInWindow(modal)).toBe(true);
	});
});

describe('review 6.3: a delete with no question, then a stale reload (D32)', () => {
	it('a house deleted when it had no people is not cleared from people who got it meanwhile without the D32 question', async () => {
		const handle = writingHandle();
		const { content, modal } = await openWindow(handle);
		// Thorne has no people: Delete removes it from the draft with no question (D32 asks only for a house with people).
		dispatch(row(content, 'thorne').querySelector('.dynasty-house-delete')!, 'click');
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		// Meanwhile (sync, another pane) Brand gets house Thorne.
		handle.body = SOURCE.replace('  - id: brand\n    name: Brand\n', '  - id: brand\n    name: Brand\n    house: thorne\n');
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		// Stale: the window shows the new tree and asks the user to select Save again (HOUSES.stale).
		expect(handle.write).not.toHaveBeenCalled();
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		// Thorne now has a person: D32 says the user chooses "remove" or "keep" for these people.
		// Either the question shows, or nothing is written until the user has chosen.
		const asked = modal.querySelector('.dynasty-sheet-confirm') !== null;
		const cleared = handle.write.mock.calls.length > 0 && !handle.body.includes('house: thorne');
		expect({ asked, cleared }).toEqual({ asked: true, cleared: false });
	});
});

describe('review 6.3: D30 height on a tablet with the on-screen keyboard open (spec §7.5)', () => {
	it('a tablet keeps options.height when the keyboard makes the window lower than 600 px', async () => {
		// A tablet on its side (touch, 1180 × 820): not a phone, so options.height applies (spec §7.5).
		device.coarse = true;
		device.width = 1180;
		device.height = 820;
		// The screen stays 1180 × 820 when the keyboard opens (the fake screen follows the window unless it is set).
		device.screenWidth = 1180;
		device.screenHeight = 820;
		const body = `options:\n  height: 300\n\n${SOURCE}`;
		const handle = fakeHandle('n.md', body);
		const { el } = await embed(body, { handle });
		const vp = () => el.querySelector('.dynasty-viewport')!;
		expect(vp().styleProps.get('--dynasty-height')).toBe('300px');
		// The on-screen keyboard opens (for example in the edit sheet): the window is 400 px lower.
		device.height = 420;
		// A save in the sheet: the block is drawn again while the keyboard is still open.
		handle.change(body.replace('name: Brand', 'name: Brand the Bold'));
		await settle();
		resizeAll();
		flushFrames();
		expect(vp().styleProps.get('--dynasty-height')).toBe('300px');
	});
});
