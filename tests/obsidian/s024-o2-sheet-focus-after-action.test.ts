import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FEl, clock, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { click, stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Search round 0.2.4, area O, finding O2: the edit sheet builds its whole form again after an action that writes
 * and keeps the sheet open (Pin focus here, This is me, Hide descendants, Remove parent ...). The button that was
 * pressed goes with the old form, and a browser then puts the focus on the page body. Only `moveSibling` gives
 * the focus back. A keyboard user is then outside the dialog.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n');

function open() {
	const h = writingHandle(BODY);
	const s = EditSheet.create({} as never, { handle: h as never, personId: 'b', sourcePath: 'n.md' })!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	return { h, s, modal };
}

describe('O2: focus after a relationship action that rebuilds the sheet', () => {
	for (const cls of ['dynasty-pin', 'dynasty-mark-me', 'dynasty-remove-parent']) {
		it(`.${cls}: the focus stays inside the sheet`, async () => {
			const { h, modal } = open();
			const button = modal.querySelector(`.${cls}`);
			expect(button).not.toBeNull();
			button!.focus();
			expect(fakeDoc.activeElement).toBe(button);
			await click(button);
			// The action wrote, and the sheet is still open.
			expect(h.ops.length).toBe(1);
			expect(modal.querySelector('.dynasty-sheet-body')).not.toBeNull();
			// The pressed button is not in the sheet any more (or the focus moved to a control that is).
			const active = fakeDoc.activeElement;
			expect(active !== null && modal.contains(active)).toBe(true);
		});
	}

	// Control: the one action that gives the focus back (`moveSibling`) passes with the same harness.
	it('control: Move later keeps the focus in the sheet', async () => {
		const body = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', '  - id: c', '    name: Cora', '    parents: [a]', '  - id: d', '    name: Dag', '    parents: [a]', ''].join('\n');
		const h = writingHandle(body);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'c', sourcePath: 'n.md' })!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		const button = modal.querySelector('.dynasty-move-later');
		expect(button).not.toBeNull();
		button!.focus();
		await click(button);
		expect(h.ops.length).toBe(1);
		const active = fakeDoc.activeElement;
		expect(active !== null && modal.contains(active)).toBe(true);
	});
});
