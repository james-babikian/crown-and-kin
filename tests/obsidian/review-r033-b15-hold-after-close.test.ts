import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHost, phone, sheets } from '../acceptance/tree-view-fakes';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * (copied header of the cause proof) r033 B1 (WP-2): the phone list behind the person window after a parent-type change. The first version of this file proves the cause (kept here as history): the window writes with
 * `highlight = the window's person`; `EditSheet.write` sets `state.lastEdited` to that person BEFORE the write; the note-change
 * redraw of the list runs `listStart`, whose chain is session, pin, mark, EDITED, oldest. With no pin, mark or session choice,
 * the list under the open window moves from the family the user was reading to the family of the person being edited.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const PEOPLE = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: roderick, name: Roderick, sex: m, born: 1131, parents: [aldric, isolde]}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick]}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;

const centre = (el: FEl) => el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus');

/** A handle that, like the real one, tells its views (`notify`) in the same step as a write. */
async function open(src: string) {
	phone();
	const handle = writingHandle(src);
	const write = handle.write.getMockImplementation()!;
	handle.write.mockImplementation((async (op: never) => {
		const out = (await (write as (o: never) => Promise<{ ok: boolean; body?: string }>)(op)) as { ok: boolean; body?: string };
		if (out.ok) handle.change(out.body!);
		return out;
	}) as never);
	const e = await embed(src, { host: fakeHost(), handle });
	return { ...e, handle };
}

describe('G2 B1: the hold after the window', () => {
	it('Remove parent changes the oldest person with a child; after Cancel the next redraw of the list must not move it (ruling: the list stays also when the window closes with Cancel)', async () => {
		const { el, handle } = await open(PEOPLE);
		expect(centre(el)).toBe('aldric');
		dispatch(el.querySelector('.dynasty-list-row[data-person="roderick"] .dynasty-list-edit')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		const modal = (sheets()[0] as unknown as { modalEl: FEl }).modalEl;
		dispatch(modal.querySelector('.dynasty-remove-parent')!, 'click');
		await settle();
		await settle();
		expect(centre(el)).toBe('aldric');
		dispatch(modal.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(sheets()).toHaveLength(0);
		expect(centre(el)).toBe('aldric');
		// Any later redraw of the view (the note changed elsewhere in the same block, a sync, a setting): the hold is gone.
		handle.change(`${handle.body}# note
`);
		await settle();
		resizeAll();
		flushFrames();
		expect(centre(el)).toBe('aldric');
	});

	it('the window is closed while an in-place write still runs: the redraw that the write causes must not move the list (the hold ended with the window, the write ends after it)', async () => {
		const { el, handle } = await open(PEOPLE);
		expect(centre(el)).toBe('aldric');
		dispatch(el.querySelector('.dynasty-list-row[data-person="roderick"] .dynasty-list-edit')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		const modal = (sheets()[0] as unknown as { modalEl: FEl }).modalEl;
		// The write is slow, as on a large tree: the user taps Cancel before it ends.
		const write = handle.write.getMockImplementation()!;
		let release: () => void = () => undefined;
		const gate = new Promise<void>((r) => (release = r));
		handle.write.mockImplementation((async (op: never) => {
			await gate;
			return (write as (o: never) => Promise<unknown>)(op);
		}) as never);
		dispatch(modal.querySelector('.dynasty-remove-parent')!, 'click');
		await settle();
		dispatch(modal.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(sheets()).toHaveLength(0);
		release();
		await settle();
		await settle();
		resizeAll();
		flushFrames();
		expect(handle.ops.map((o) => o.kind)).toEqual(['remove-parent']);
		expect(centre(el)).toBe('aldric');
	});
});
