import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { HousesWindow } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { ID_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, installDom, resetDom, settle, fakeWin } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { backToList, openPage } from './lw-support';

/*
 * Review round 0.2.2, area B (windows). Each test is the smallest sequence of user actions that shows
 * a defect in the Id change of the Houses window or the Titles window (since D110 the id is typed in the small Id window). The real windows run on the
 * fakes; the handle's write applies the op with the real `applyOp`, like the other tests of the round.
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
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

type Writing = FakeHandle & { ops: Op[] };

function writingHandle(body: string): Writing {
	const h = fakeHandle('n.md', body) as Writing;
	h.ops = [];
	const undo: string[] = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		undo.push(h.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
	}) as never);
	h.undo.mockImplementation((async () => {
		const prev = undo.pop();
		if (prev === undefined) return { ok: false, code: 'empty' };
		h.body = prev;
		return { ok: true, body: prev };
	}) as never);
	return h;
}

const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};

function type(input: FEl, text: string): void {
	input.value = text;
	dispatch(input, 'input');
}

const HOUSES_BODY = `houses:
  - id: valmont
    name: House Valmont
  - id: orsini
    name: House Orsini
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
  - id: isolde
    name: Isolde Orsini
    house: orsini
`;

async function openHouses(handle: Writing = writingHandle(HOUSES_BODY)) {
	const e = await embed(handle.body, { handle });
	const button = e.el.querySelector('.dynasty-houses-button')!;
	button.focus();
	dispatch(button, 'click');
	await settle();
	const win = openModals.find((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow;
	expect(win).toBeDefined();
	return { handle, win, content: (win as unknown as { contentEl: FEl }).contentEl, modal: (win as unknown as { modalEl: FEl }).modalEl };
}

/** Taps "Change id" on the open edit page, types the id into the small window and taps "Use this id" (D110). */
async function setId(page: FEl, value: string): Promise<void> {
	await click(page.querySelector('.dynasty-id-open'));
	const w = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
	type(w.querySelector('.dynasty-id-input')!, value);
	await click(w.querySelector('.dynasty-id-use'));
}

const confirmOf = (modal: FEl) => modal.querySelector('.dynasty-sheet-confirm');

const TITLES_BODY = `titles:
  - id: duke
    name: Duke
    holders:
      - {person: a, number: I}
      - {person: b, number: II}
  - id: baron
    name: Baron
people:
  - {id: a, name: Aldric, card-title: duke}
  - {id: b, name: Bran, card-title: duke}
`;

async function openTitles(handle: Writing) {
	const host = fakeHost() as Host;
	const { el } = await embed(handle.body, { handle, host });
	await click(el.querySelector('.dynasty-more'));
	await click(el.querySelector('.dynasty-more-titles'));
	const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as TitlesWindow;
	expect(win).toBeDefined();
	return { handle, win, content: (win as unknown as { contentEl: FEl }).contentEl, modal: (win as unknown as { modalEl: FEl }).modalEl };
}

describe('R1: the note changes while the id question is open (§13.17 rule 5: a stale body refuses the whole write)', () => {
	it('Houses: Save, the note gets one more person of the house, "Change the id" must not write on the new body', async () => {
		const { content, modal, handle } = await openHouses();
		await setId(openPage(content, 'valmont'), 'crown');
		await click(content.querySelector('.dynasty-sheet-save'));
		// The question says "1 person". Now a sync adds a second person of the house.
		expect(confirmOf(modal)!.querySelectorAll('.dynasty-sheet-confirm-text')[0].getText()).toContain('1 person');
		handle.body = `${handle.body}  - id: lucan\n    name: Lucan Valmont\n    house: valmont\n`;
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		// Expected: the window sees the new body, writes nothing and shows the stale text, so the owner can read the new count.
		expect(handle.ops).toHaveLength(0);
		expect(notices).toContain(WRITE_TEXT.stale);
	});

	it('Titles: Save, the note gets one more person with the title, "Change the id" must not write on the new body', async () => {
		const handle = writingHandle(TITLES_BODY);
		const { content, modal } = await openTitles(handle);
		await setId(openPage(content, 'baron'), 'count');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(confirmOf(modal)).not.toBeNull();
		handle.body = `${handle.body}  - {id: c, name: Cora, card-title: baron}\n`;
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(0);
		expect(notices).toContain(WRITE_TEXT.stale);
	});
});

describe('R2: a refusal of another op in the batch is shown as an id problem', () => {
	it('Titles: an id change of Baron and a holder removal in a title whose holders are a YAML alias show the "cannot change the id" text', async () => {
		const body = `shared: &hs
  - {person: a, number: I}
  - {person: b, number: II}
titles:
  - id: duke
    name: Duke
    holders: *hs
  - id: baron
    name: Baron
people:
  - {id: a, name: Aldric}
  - {id: b, name: Bran}
`;
		const handle = writingHandle(body);
		const { content, modal } = await openTitles(handle);
		// Remove the second holder of Duke (a holder list written as an alias cannot be edited) and also change the id of Baron.
		const duke = openPage(content, 'duke');
		await click(duke.querySelectorAll('.dynasty-holder-remove')[1]);
		backToList(content);
		await setId(openPage(content, 'baron'), 'count');
		await click(content.querySelector('.dynasty-sheet-save'));
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(1);
		// The id change of Baron is fine; the refusal comes from Duke's holder list. The text must not blame an id.
		const shown = content.querySelector('.dynasty-sheet-error')!.getText();
		expect(shown).not.toBe(ID_UI.anchor);
	});
});
