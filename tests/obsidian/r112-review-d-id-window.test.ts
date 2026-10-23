import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted answers for each step of a sheet flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openPage } from '../support/lw-support';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { click, openHouses, patchDisabledSelector } from '../support/id-window';

/*
 * Review D of 0.2.2 (small Id window, D110). The real windows run on the fakes, as in
 * `v112-obsidian-ids.test.ts`; the helpers are in support/id-window.ts.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	patchDisabledSelector();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// 0.2.5 (D134): Change ID is on the edit page of the house, so "the row" is the page that a tap on the row opens.
const houseRow = (content: FEl, id: string) => openPage(content, id);

/** The modal on top: the small Id window when one is open. */
const topModal = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
const fieldOf = (w: FEl) => w.querySelector('.dynasty-id-input')!;

/** Taps "Change id" of a row and returns the small window. */
async function openIdOf(row: FEl): Promise<FEl> {
	await click(row.querySelector('.dynasty-id-open'));
	const w = topModal();
	expect(w.hasClass('dynasty-id-window')).toBe(true);
	return w;
}

describe('review D: the small Id window', () => {
	it('D1: a second activation of "Change id" while the small window is open opens no second small window', async () => {
		// A keyboard user can Tab out of the small window (Obsidian does not trap the focus) onto the button
		// of the window below; a screen reader can also activate it. The Titles window guards the same case with `busy`.
		const { content } = await openHouses();
		const button = houseRow(content, 'valmont').querySelector('.dynasty-id-open')!;
		dispatch(button, 'click', { detail: 1 });
		dispatch(button, 'click', { detail: 1 });
		await settle();
		const small = openModals.filter((m) => (m as unknown as { modalEl: FEl }).modalEl.hasClass('dynasty-id-window'));
		expect(small).toHaveLength(1);
	});

	it('D2: Enter that repeats (key held after it opened the window) does not close the small window with "Use this id"', async () => {
		// A real DOM has `click()`; the fake has none.
		const proto = FEl.prototype as unknown as { click?: () => void };
		proto.click = function (this: FEl) {
			if (!this.disabled) dispatch(this, 'click', { detail: 1 });
		};
		const { content } = await openHouses();
		const w = await openIdOf(houseRow(content, 'valmont'));
		// The press of Enter on "Change id" opened the window and moved the focus into the field; the key is still down.
		dispatch(fieldOf(w), 'keydown', { key: 'Enter', repeat: true });
		await settle();
		try {
			expect(openModals).toHaveLength(2);
		} finally {
			delete proto.click;
		}
	});
});
