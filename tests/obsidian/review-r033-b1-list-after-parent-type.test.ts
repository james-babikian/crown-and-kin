import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHost, phone, sheets } from '../acceptance/tree-view-fakes';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * r033 B1 (WP-2): the phone list behind the person window after a parent-type change. The first version of this file proves the cause (kept here as history): the window writes with
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
const from = (el: FEl) => el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-list-from');

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

async function changeFirstParentType(el: FEl, personId: string, to: string) {
	const edit = el.querySelector(`.dynasty-list-row[data-person="${personId}"] .dynasty-list-edit`)!;
	dispatch(edit, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	expect(sheets()).toHaveLength(1);
	const modal = (sheets()[0] as unknown as { modalEl: FEl }).modalEl;
	const sel = modal.querySelector('select.dynasty-family-select')!;
	sel.value = to;
	dispatch(sel, 'change');
	await settle();
	await settle();
	resizeAll();
	flushFrames();
}

describe('B1: the list behind the person window after a parent-type change', () => {
	it('keeps its person (no pin, no mark, no tap on a name)', async () => {
		const { el, handle } = await open(PEOPLE);
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		await changeFirstParentType(el, 'roderick', 'adoptive');
		expect(handle.ops, 'the write happened').toHaveLength(1);
		expect(handle.ops[0].kind).toBe('set-parent-type');
		// The list is still the family of Aldric that the reader looked at (before B1 it moved to the person edited, then to the data's own start).
		expect(centre(el)).toBe('aldric');
	});

	it('same, when the window opens from a row after a tap on a name: the session choice holds (control)', async () => {
		const { el } = await open(PEOPLE);
		dispatch(el.querySelector('.dynasty-list-row[data-person="roderick"] .dynasty-list-go')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		resizeAll();
		flushFrames();
		expect(centre(el)).toBe('roderick');
		await changeFirstParentType(el, 'lena', 'ward').catch(() => undefined);
		expect(centre(el)).toBe('roderick');
	});

	it('the cause is gone: the window still sets the person edited last (D20), but the list start chain does not read it (rung 4 is the last Save)', async () => {
		const { el, handle } = await open(PEOPLE);
		expect(handle.state.lastEdited).toBeNull();
		await changeFirstParentType(el, 'roderick', 'adoptive');
		expect(handle.state.lastEdited, 'D20: the computer first view still follows every write').toBe('roderick');
		expect(handle.state.lastSaved ?? null, 'an in-place write is not a Save').toBeNull();
		expect(from(el)).toBe('oldest');
	});

	it('control: with a mark (rung 3) the list stays on its person', async () => {
		const { el } = await open(`options:
  me: aldric
${PEOPLE}`);
		expect([centre(el), from(el)]).toEqual(['aldric', 'me']);
		await changeFirstParentType(el, 'roderick', 'adoptive');
		expect(centre(el)).toBe('aldric');
	});
});
