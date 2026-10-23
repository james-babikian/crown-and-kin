/*
 * The set-up that `v112-obsidian-ids` and `r112-review-d-id-window` share for the small Id window of the Houses window (D110): a click that
 * waits, the sample note of three houses, and `openHouses`, which opens the real Houses window on the fakes. The `vi.mock` calls and the
 * `answers` list stay in each test file, because `vi.mock` is lifted to the top of the file.
 */

import { expect, vi } from 'vitest';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { FEl, dispatch, settle } from '../acceptance/fake-dom';
import { openModals } from '../acceptance/fake-obsidian';
import { embed } from '../acceptance/tree-view-fakes';
import { undoStackHandle } from './writing-handle';

/** The fake DOM has no `:not(:disabled)` (the sheet puts the focus back with it): drop it from the selector. Undone by `vi.restoreAllMocks()`. */
export function patchDisabledSelector(): void {
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
}

/** A click that waits until the windows have settled. */
export const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};

/** Three houses, four people (one with a house that is not listed) and one partnership. */
export const HOUSES_BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8c2f39"
  - id: orsini
    name: House Orsini
  - id: thorne
    name: House Thorne

people:
  - id: aldric
    name: Aldric Valmont
    house: valmont # the head
  - id: isolde
    name: Isolde Orsini
    house: orsini
  - id: lucan
    name: Lucan Orsini
    house: orsini
  - name: Nobody
    house: ghost

unions:
  - partners: [aldric, isolde]
`;

export const housesWindows = () => openModals.filter((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow[];

/** Opens the Houses window of an embed on the sample note (or another body). */
export async function openHouses(body = HOUSES_BODY, handle: ReturnType<typeof undoStackHandle> = undoStackHandle(body)) {
	const e = await embed(handle.body, { handle });
	const button = e.el.querySelector('.dynasty-houses-button')!;
	button.focus();
	dispatch(button, 'click');
	await settle();
	const win = housesWindows()[0];
	expect(win).toBeDefined();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { ...e, handle, win, content, modal };
}
