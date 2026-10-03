/* eslint-disable @typescript-eslint/no-unused-vars -- scratch proof file of the review round: it keeps helpers it does not use now */
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers for each step of a sheet flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { describeHouseIdChange } from '../src/core/house-ops';
import { nextPersonId } from '../src/core/id-gen';
import { parseBody, parseDynasty, readTree } from '../src/core/parse';
import { applyOp, newPersonId } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { HousesWindow, houseOps, loadHouses, rowsOf } from '../src/obsidian/houses-window';
import { danglingIds, idFromName, idOps, idProblemFor, idProblems, idRefusalText, type IdRow } from '../src/obsidian/id-draft';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { draftChanged, rebase, titleIdRow, titleRows, windowOps, withHolderIds } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { HOUSES, ID_UI, REMOVE, SHEET, TITLES_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * Version 1.1.2, WP3 (spec §13.17): the numbered person id at the four places that make one, the Id
 * line of the edit sheet (D106), and the Id change of the Houses window and the Titles window (D109, D110).
 * The real windows run on the fakes; the handle's write applies the op with the real `applyOp`.
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
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	// The fake DOM has no `:not(:disabled)` (the sheet puts the focus back with it).
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

type Writing = FakeHandle & { ops: Op[] };

/** A handle whose writes apply the op to its body, with a one-step undo, as the real handle does. */
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

const housesWindows = () => openModals.filter((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow[];

async function openHouses(body = HOUSES_BODY, handle: Writing = writingHandle(body)) {
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

const houseRow = (content: FEl, id: string) => content.querySelector(`.dynasty-house-row[data-house="${id}"]`)!;
const saveOf = (content: FEl) => content.querySelector('.dynasty-sheet-save')!;
const confirmOf = (modal: FEl) => modal.querySelector('.dynasty-sheet-confirm');
const confirmLines = (modal: FEl) => confirmOf(modal)!.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText());

/** The modal on top: the small Id window when one is open. */
const topModal = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
const fieldOf = (w: FEl) => w.querySelector('.dynasty-id-input')!;
const useOf = (w: FEl) => w.querySelector('.dynasty-id-use')!;
const problemOf = (w: FEl) => w.querySelector('.dynasty-id-problem')!.getText();

/** Taps "Change id" of a row and returns the small window. */
async function openIdOf(row: FEl): Promise<FEl> {
	await click(row.querySelector('.dynasty-id-open'));
	const w = topModal();
	expect(w.hasClass('dynasty-id-window')).toBe(true);
	return w;
}

/** Types an id into the small window of a row and taps "Use this id". */
async function setId(row: FEl, value: string): Promise<void> {
	const w = await openIdOf(row);
	type(fieldOf(w), value);
	await click(useOf(w));
}

const noteOf = (row: FEl) => row.querySelector('.dynasty-id-new');


const TITLES_BODY = `titles:
  - id: duke
    name: Duke
    holders:
      - {person: a, number: I}
      - {person: b, number: II}
  - id: baron
    name: Baron
people:
  - id: a
    name: Aldric
    card-title: duke
  - id: b
    name: Bran
    card-title: duke
  - id: c
    name: Cora
    card-title: lost
`;

const titlesWindows = () => openModals.filter((m) => (m as unknown) instanceof TitlesWindow) as unknown as TitlesWindow[];

async function openTitles(body = TITLES_BODY, handle: Writing = writingHandle(body)) {
	const host = fakeHost() as Host;
	const { el } = await embed(handle.body, { handle, host });
	await click(el.querySelector('.dynasty-more'));
	await click(el.querySelector('.dynasty-more-titles'));
	const win = titlesWindows()[0];
	expect(win).toBeDefined();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { handle, win, content, modal };
}

const titleBox = (content: FEl, id: string) => content.querySelector(`.dynasty-title-box[data-title="${id}"]`)!;


import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.env.R112D_OUT ?? 'out-review-d';
mkdirSync(OUT, { recursive: true });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function ser(e: FEl): string {
	const attrs: string[] = [];
	const cls = [...e.classes].join(' ');
	if (cls) attrs.push(`class="${esc(cls)}"`);
	for (const [k, v] of e.attrs) attrs.push(`${k}="${esc(v)}"`);
	if (e.hidden) attrs.push('style="display:none"');
	const st = [...e.styleProps].map(([k, v]) => `${k}:${v}`).join(';');
	if (st) attrs.push(`data-style="${esc(st)}"`);
	if (e.tag === 'input' && e.value) attrs.push(`value="${esc(e.value)}"`);
	if (e.disabled) attrs.push('disabled');
	if (e.tag === 'input') return `<input ${attrs.join(' ')}>`;
	return `<${e.tag} ${attrs.join(' ')}>${esc(e.text)}${e.children.map(ser).join('')}</${e.tag}>`;
}
const dump = (name: string, container: FEl) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ html: ser(container), styles: [...container.all()].filter((x) => x.styleProps.size).map((x) => [...x.styleProps]) }));

/*
 * Layout probe (not a test): with R112D_DUMP=1 it writes the real DOM of the Houses window, the Titles window
 * and the small Id window as JSON; `tests/r112-review-d-layout-probe.mjs` renders it in Chrome.
 */
describe.skipIf(!process.env.R112D_DUMP)('dump', () => {
	it('houses', async () => {
		const body = HOUSES_BODY.replace('name: House Thorne', 'name: House of Thorne and Valmont and the Long Name of the Mountain Kings');
		const { content, win, modal } = await openHouses(body);
		dump('houses-plain', (win as unknown as { containerEl: FEl }).containerEl);
		await setId(houseRow(content, 'valmont'), 'crown');
		await setId(houseRow(content, 'thorne'), 'a-very-long-house-identifier-that-keeps-going-and-going-for-sixty-characters');
		await click(content.querySelector('.dynasty-house-add'));
		dump('houses-pending', (win as unknown as { containerEl: FEl }).containerEl);
		await click(houseRow(content, 'orsini').querySelector('.dynasty-house-delete'));
		await click(modal.querySelector('.dynasty-house-keep'));
		dump('houses-deleted', (win as unknown as { containerEl: FEl }).containerEl);
		const w = await openIdOf(houseRow(content, 'valmont'));
		type(fieldOf(w), 'thorne-xx');
		type(fieldOf(w), 'thorne');
		const m = openModals[openModals.length - 1] as unknown as { containerEl: FEl };
		dump('idwin', m.containerEl);
	});
	it('titles', async () => {
		const { content, win } = await openTitles();
		await setId(titleBox(content, 'duke'), 'a-very-long-title-identifier-that-keeps-going-and-going-for-sixty-characters');
		dump('titles-pending', (win as unknown as { containerEl: FEl }).containerEl);
	});
});
