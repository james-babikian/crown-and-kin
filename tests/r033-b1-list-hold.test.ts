import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHost, phone, sheets } from './acceptance/tree-view-fakes';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * r033 B1 (WP-2, supervisor ruling): rung 4 of the phone list start chain moves the list only after a Save that closes the window. An in-place write
 * of an open person window keeps the list where it is, also when the window then closes with Cancel; the person edited last (D20) still follows every write.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
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

async function openWindow(el: FEl, personId: string) {
	dispatch(el.querySelector(`.dynasty-list-row[data-person="${personId}"] .dynasty-list-edit`)!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	expect(sheets()).toHaveLength(1);
	return (sheets()[0] as unknown as { modalEl: FEl }).modalEl;
}

const redraw = async () => {
	await settle();
	await settle();
	resizeAll();
	flushFrames();
};

describe('B1: the list after a Save and after in-place writes', () => {
	it('a Save that closes the window moves the list to the saved person (rung 4, unchanged)', async () => {
		const { el, handle } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		const name = modal.querySelector('[data-field="title"] input')!;
		name.value = 'Duke';
		dispatch(name, 'input');
		dispatch(modal.querySelector('.dynasty-sheet-save')!, 'click');
		await redraw();
		expect(handle.state.lastSaved).toBe('roderick');
		expect([centre(el), from(el)]).toEqual(['roderick', 'edited']);
		expect(handle.state.listHold).toBe(false);
	});

	it('an in-place write, then Cancel: the list stays, the hold ends with the window, the person edited last follows', async () => {
		const { el, handle } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await redraw();
		expect(handle.state.listHold).toBe(true);
		expect(centre(el)).toBe('aldric');
		dispatch(modal.querySelector('.dynasty-sheet-cancel')!, 'click');
		await redraw();
		expect(sheets()).toHaveLength(0);
		expect(handle.state.listHold).toBe(false);
		expect(handle.state.lastEdited).toBe('roderick');
		expect(centre(el)).toBe('aldric');
	});

	it('Remove parent (also an in-place write) keeps the list', async () => {
		const { el, handle } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		dispatch(modal.querySelector('.dynasty-remove-parent')!, 'click');
		await redraw();
		expect(handle.ops.map((o) => o.kind)).toEqual(['remove-parent']);
		expect(centre(el)).toBe('aldric');
	});

	it('a Save after in-place writes moves the list to the saved person', async () => {
		const { el } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await redraw();
		const title = modal.querySelector('[data-field="title"] input')!;
		title.value = 'Duke';
		dispatch(title, 'input');
		dispatch(modal.querySelector('.dynasty-sheet-save')!, 'click');
		await redraw();
		expect([centre(el), from(el)]).toEqual(['roderick', 'edited']);
	});

	it('"This is me" moves the list to the marked person even after an in-place write in the same window (rung 3)', async () => {
		const { el } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await redraw();
		dispatch(modal.querySelector('.dynasty-mark-me')!, 'click');
		await redraw();
		expect([centre(el), from(el)]).toEqual(['roderick', 'me']);
	});
	it('fix round: after Cancel the hold lasts one draw; a tap on a name then moves the list as usual', async () => {
		const { el, handle } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		dispatch(modal.querySelector('.dynasty-remove-parent')!, 'click');
		await redraw();
		dispatch(modal.querySelector('.dynasty-sheet-cancel')!, 'click');
		await redraw();
		expect(centre(el)).toBe('aldric');
		// No draw came between the close and the tap: the tap must not be swallowed by the kept start.
		dispatch(el.querySelector('.dynasty-list-row[data-person="isolde"] .dynasty-list-go')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await redraw();
		expect(centre(el)).toBe('isolde');
		expect(handle.state.listHold).toBe(false);
	});

	it('fix round: a Save after in-place writes leaves nothing kept; the list stays on the saved person at the next draw', async () => {
		const { el, handle } = await open(PEOPLE);
		const modal = await openWindow(el, 'roderick');
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await redraw();
		const title = modal.querySelector('[data-field="title"] input')!;
		title.value = 'Duke';
		dispatch(title, 'input');
		dispatch(modal.querySelector('.dynasty-sheet-save')!, 'click');
		await redraw();
		expect(handle.state.listKeep ?? 0).toBe(0);
		handle.change(`${handle.body}# note
`);
		await redraw();
		expect([centre(el), from(el)]).toEqual(['roderick', 'edited']);
	});
});
