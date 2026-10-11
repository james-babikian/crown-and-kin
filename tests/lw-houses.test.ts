import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers of the picture picker (the picker has its own tests).
const picks: unknown[] = [];
vi.mock('../src/obsidian/picture-picker', async (orig) => ({ ...(await orig<Record<string, unknown>>()), pickPicture: async () => picks.shift() ?? { kind: 'cancel' } }));

import { TFile as VaultFile } from 'obsidian';
import { parseDynasty } from '../src/core/parse';
import { HousesWindow, type HousesOptions } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import type { PictureCopy, PictureStore } from '../src/obsidian/picture-store';
import { HOUSE_PALETTE } from '../src/render/styles';
import { HOUSES, HOUSE_PAGE_UI, ID_UI, PICTURES_UI, WIN_LIST_UI, WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { lastMenu, noticeList, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './acceptance/tree-view-fakes';
import { backButton, backToList, listRows, openPage, pageOf, press, rowNames, rowOf, rowTexts, searchBox, searchFor } from './lw-support';
import { click, stripNotDisabled, type, writingHandle, type Writing } from './s113-c-support';

/*
 * The Houses window as a searchable list with an edit page (the 0.2.5 contract D.3, D134, D138). The real window runs on
 * the fakes. The window stays a draft: one Save writes every house in one write, Cancel writes nothing, closing with
 * changes asks first. Names in this file are made up.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	picks.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const NAMES = ['Valmont', 'Orsini', 'Thorne', 'Ashby', 'Brandt', 'Calder', 'Delmar', 'Ember', 'Falke', 'Garrow', 'Harlan', 'Ivory'];
const P = HOUSE_PALETTE;

/** Twelve houses; Valmont has arms and a colour, Orsini has two people, Thorne none. */
function twelve(): string {
	const lines = ['houses:'];
	NAMES.forEach((n, i) => {
		lines.push(`  - id: ${n.toLowerCase()}`, `    name: House ${n}`);
		if (i === 0) lines.push(`    color: "${P[0]}"`, '    arms: "[[valmont-arms.png]]"');
		if (i === 1) lines.push(`    color: "${P[8]}"`);
	});
	lines.push('', 'people:');
	lines.push('  - id: aldric', '    name: Aldric Valmont', '    house: valmont');
	lines.push('  - id: isolde', '    name: Isolde Orsini', '    house: orsini');
	lines.push('  - id: lucan', '    name: Lucan Orsini', '    house: orsini', '');
	return lines.join('\n');
}

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const vaultFile = (path: string): VaultFile => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1)), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
};

/** A picture store of fakes: every link with "valmont" or "thorne" in it has a file; `pixels` give one white colour. */
function fakeStore(o: { pixels?: Uint8ClampedArray | null } = {}) {
	const listeners = new Set<(p: readonly string[]) => void>();
	const released: string[] = [];
	let n = 0;
	const state = { acquired: 0, nullFirst: false };
	const store = {
		resolve: (link: string) => (/valmont|thorne/.test(link) ? { ok: true, file: vaultFile(`Pictures/${/valmont/.test(link) ? 'valmont-arms' : 'thorne'}.png`), format: 'png' } : { ok: false }),
		acquire: async () => {
			state.acquired++;
			if (state.nullFirst && state.acquired === 1) return null;
			const url = `blob:c${n++}`;
			return { url, w: 40, h: 40, release: () => released.push(url) } satisfies PictureCopy;
		},
		transient: async () => null,
		pixels: async () => (o.pixels === undefined ? new Uint8ClampedArray(64 * 64 * 4).fill(255) : o.pixels),
		onChange: (fn: (p: readonly string[]) => void) => (listeners.add(fn), () => listeners.delete(fn)),
		listeners,
		changed: (p: readonly string[]) => listeners.forEach((fn) => fn(p)),
		invalidate() {},
		clear() {},
	};
	return { store: store as unknown as PictureStore & { listeners: Set<unknown>; changed(p: readonly string[]): void }, released, state };
}

interface Opened {
	win: HousesWindow;
	content: FEl;
	modal: FEl;
	handle: Writing;
}

function open(o: { body?: string; handle?: Writing } & Partial<HousesOptions> = {}): Opened {
	const { body, handle: given, ...options } = o;
	const handle = given ?? writingHandle(body ?? twelve());
	const win = HousesWindow.create(fakeApp() as never, { handle: handle as never, sourcePath: 'n.md', ...options })!;
	win.open();
	const inner = win as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, content: inner.contentEl, modal: inner.modalEl, handle };
}

const active = (): string | null => fakeDoc.activeElement?.getAttribute('data-focus') ?? null;
const save = (content: FEl) => click(content.querySelector('button[data-focus="save"]'));
const names = (content: FEl) => rowNames(content);
const field = (content: FEl) => pageOf(content).querySelector('textarea.dynasty-lw-field')!;
const confirmOf = (modal: FEl) => modal.querySelector('.dynasty-sheet-confirm');

describe('open: a list of the houses (D134)', () => {
	it('opens on the list, never on a page, with 12 rows in tree order and no text field inside the list', () => {
		const { content, modal } = open();
		expect(names(content)).toEqual(NAMES.map((n) => `House ${n}`));
		expect(content.querySelector('.dynasty-lw-page')).toBeNull();
		expect(backButton(content)).toBeNull();
		expect(content.querySelector('ul.dynasty-lw-list')!.querySelectorAll('input, textarea')).toHaveLength(0);
		for (const c of ['dynasty-sheet', 'dynasty-houses', 'dynasty-lw']) expect(modal.hasClass(c)).toBe(true);
		expect(fakeDoc.activeElement).toBe(modal);
	});

	it('draws each house as a list item with one row button: no role, no accessible name, the id as data', () => {
		const { content } = open();
		const list = content.querySelector('ul.dynasty-lw-list')!;
		const items = list.querySelectorAll(':scope > li');
		expect(items).toHaveLength(12);
		for (const li of items) expect(li.querySelectorAll(':scope > button.dynasty-lw-row')).toHaveLength(1);
		const first = listRows(content)[0]!;
		expect(first.getAttribute('role')).toBeNull();
		expect(first.getAttribute('aria-label')).toBeNull();
		expect(first.getAttribute('data-house')).toBe('valmont');
		expect(first.getAttribute('data-focus')).toBe('row:h0');
	});

	it('shows the house colour as a dot before the count, through the house colour property only; the arms box only for a house with arms (D213, D214)', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		await settle();
		const valmont = rowOf(content, 'valmont');
		// The colour is the dot in the second text line; the lead is the arms, and a house with no arms has no lead at all.
		const dot = valmont.querySelector('.dynasty-lw-dot')!;
		expect(dot.style.getPropertyValue('--dynasty-house-color')).toBe(P[0]);
		expect(dot.getAttribute('aria-hidden')).toBe('true');
		expect(valmont.querySelector('.dynasty-lw-armsbox')!.style.getPropertyValue('--dynasty-house-color')).toBe('');
		expect(valmont.querySelector('.dynasty-lw-armsbox')!.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		// A house with no colour written has no dot; a house with no arms has no box, no swatch and no lead.
		const thorne = rowOf(content, 'thorne');
		expect(thorne.querySelector('.dynasty-lw-dot')).toBeNull();
		expect(thorne.querySelector('.dynasty-lw-armsbox')).toBeNull();
		expect(thorne.querySelector('.dynasty-row-lead')).toBeNull();
		expect(rowOf(content, 'orsini').querySelector('.dynasty-lw-dot')!.style.getPropertyValue('--dynasty-house-color')).toBe(P[8]);
		expect(rowTexts(content)[0]).toBe(`House Valmont | ${HOUSES.count(1)}`);
		expect(rowTexts(content)[1]).toBe(`House Orsini | ${HOUSES.count(2)}`);
		expect(rowTexts(content)[2]).toBe(`House Thorne | ${HOUSES.count(0)}`);
	});

	it('puts the Add house button beside the search box in the fixed bar', () => {
		const { content } = open();
		const bar = content.querySelector('.dynasty-lw-bar')!;
		expect(bar.children[0]!.hasClass('dynasty-lw-searchwrap')).toBe(true);
		const add = bar.children[1]!;
		expect(add.getText()).toBe(HOUSES.add);
		for (const c of ['dynasty-btn', 'dynasty-lw-add', 'dynasty-house-add']) expect(add.hasClass(c)).toBe(true);
		expect(add.getAttribute('data-focus')).toBe('add');
		expect(searchBox(content).getAttribute('placeholder')).toBe(WIN_LIST_UI.searchHouses);
		// The old intro hint is on the page, not on the list.
		expect(content.getText()).not.toContain(HOUSES.intro);
	});

	it('shows one line for a tree with no houses', () => {
		const { content } = open({ body: 'people:\n  - id: a\n    name: A\n' });
		expect(content.querySelectorAll('li.dynasty-lw-none').map((e) => e.getText())).toEqual([HOUSES.none]);
	});

	it('gives a Notice and no window when the tree text has an error', () => {
		expect(HousesWindow.create({} as never, { handle: writingHandle('people:\n  - id: a\n    name: A\n  - id: a\n    name: B\n') as never })).toBeNull();
		expect(notices.length).toBe(1);
	});
});

describe('search (D.3.3)', () => {
	it('finds a house by words of its name in any order, and counts the matches', () => {
		const { content } = open();
		searchFor(content, 'ORSINI house');
		expect(names(content)).toEqual(['House Orsini']);
		expect(content.querySelector('.dynasty-lw-count')!.getText()).toBe(WIN_LIST_UI.matchHouses(1, 12));
		searchFor(content, '');
		expect(names(content)).toHaveLength(12);
		expect(content.querySelector('.dynasty-lw-count')!.getText()).toBe('');
	});

	it('finds a house by the name of a person and shows the reason', () => {
		const { content } = open();
		searchFor(content, 'lucan');
		expect(names(content)).toEqual(['House Orsini']);
		expect(rowTexts(content)[0]).toContain(WIN_LIST_UI.person('Lucan Orsini'));
	});

	it('finds a house by its ID and shows the reason when the name does not match', () => {
		const { content } = open({ body: ['houses:', '  - id: crown-line', '    name: Old Line', ''].join('\n') });
		searchFor(content, 'crown');
		expect(names(content)).toEqual(['Old Line']);
		expect(rowTexts(content)[0]).toContain(WIN_LIST_UI.id('crown-line'));
	});

	it('searches the draft: a new name is found, and the saved ID still finds the house with the reason', () => {
		const { content } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Zephyr');
		backToList(content);
		searchFor(content, 'zephyr');
		expect(names(content)).toEqual(['House Zephyr']);
		searchFor(content, 'thorne');
		expect(names(content)).toEqual(['House Zephyr']);
		expect(rowTexts(content)[0]).toContain(WIN_LIST_UI.id('thorne'));
	});

	it('says so when no house matches, with the query in curly marks and no count line', () => {
		const { content } = open();
		searchFor(content, ' nobody ');
		expect(content.querySelectorAll('li.dynasty-lw-none').map((e) => e.getText())).toEqual([WIN_LIST_UI.noResultHouses('nobody')]);
		expect(content.querySelector('.dynasty-lw-count')!.getText()).toBe('');
	});

	it('keeps the same search box while the user types, and keeps the query when a page opens and Back returns', () => {
		const { content } = open();
		const box = searchBox(content);
		searchFor(content, 'or');
		searchFor(content, 'ors');
		expect(searchBox(content)).toBe(box);
		openPage(content, 'orsini');
		backToList(content);
		expect(searchBox(content).value).toBe('ors');
		expect(names(content)).toEqual(['House Orsini']);
	});

	it('moves with the arrow keys, and Home and End are left to the search box', () => {
		const { content } = open();
		const box = searchBox(content);
		const home = press(box, 'Home');
		expect(home.defaultPrevented).toBe(false);
		expect(press(box, 'ArrowDown').defaultPrevented).toBe(true);
		expect(active()).toBe('row:h0');
	});
});

describe('the edit page (D.3.6, D.3.7)', () => {
	it('opens on a tap, with the focus on Back, the Back bar and a region named for the house', () => {
		const { content } = open();
		const page = openPage(content, 'orsini');
		expect(active()).toBe('back');
		expect(page.getAttribute('data-house')).toBe('orsini');
		expect(page.getAttribute('role')).toBe('region');
		expect(page.getAttribute('aria-label')).toBe(WIN_LIST_UI.editPage('House Orsini'));
		expect(content.querySelector('.dynasty-lw-back-name')!.getText()).toBe('House Orsini');
		expect(content.querySelector('.dynasty-lw-bar')).toBeNull();
		// The way back is a link above the header (G.7).
		expect(content.querySelector('.dynasty-back')!.getText()).toBe(HOUSES.title);
		expect(field(content).value).toBe('House Orsini');
		expect(field(content).getAttribute('data-focus')).toBe('name:h1');
		expect(field(content).getAttribute('aria-label')).toBe(HOUSES.nameLabel);
		expect(page.querySelector('label.dynasty-house-name')).not.toBeNull();
	});

	it('shows the number of people once, in the summary of the closed People section and not in the header (D216 item 2), and the whole palette with no toggle', () => {
		const { content } = open();
		const page = openPage(content, 'orsini');
		expect(page.querySelector('.dynasty-lw-pagemeta')).toBeNull();
		expect(page.querySelector('[data-section="people"] .dynasty-section-sum')!.getText()).toBe(WINDOW_UI.sumPeopleHeader(2, 1));
		expect(page.querySelector('.dynasty-house-count')).toBeNull();
		expect(page.getText()).not.toContain(HOUSES.intro);
		expect(page.querySelectorAll('section.dynasty-section').map((x) => x.getAttribute('data-section'))).toEqual(['details', 'people', 'more']);
		expect(page.querySelector('.dynasty-house-palette')).not.toBeNull();
		expect(page.querySelectorAll('.dynasty-house-colour')).toHaveLength(12);
		expect(page.querySelector('.dynasty-house-colour[data-colour="' + P[8] + '"]')!.getAttribute('aria-pressed')).toBe('true');
		expect(page.querySelector('input[type="color"]')).not.toBeNull();
		expect(page.querySelector('.dynasty-house-swatch')).toBeNull();
	});

	it('puts Other actions last, with Change ID before Delete, and the right names', () => {
		const { content } = open();
		const page = openPage(content, 'orsini');
		const last = page.children[page.children.length - 1]!;
		expect(last.getAttribute('data-section')).toBe('more');
		expect(last.querySelector('.dynasty-section-title')!.getText()).toBe(WINDOW_UI.sectionOther);
		// D218 item 6: a list of commands previews nothing, so the closed section has no summary.
		expect(last.querySelector('.dynasty-section-sum')!.getText()).toBe('');
		const buttons = last.querySelectorAll('.dynasty-lw-actions-row button');
		expect(buttons.map((b) => b.querySelector('.dynasty-row-title')!.getText())).toEqual([ID_UI.open, HOUSES.delete]);
		expect(buttons[0]!.hasClass('dynasty-id-open')).toBe(true);
		expect(buttons[0]!.getAttribute('aria-label')).toBe(ID_UI.openAria('House Orsini'));
		expect(buttons[1]!.hasClass('dynasty-house-delete')).toBe(true);
		expect(buttons[1]!.hasClass('mod-warning')).toBe(true);
		expect(buttons[1]!.getAttribute('aria-label')).toBe(HOUSES.deleteLabel('House Orsini'));
	});

	it('shows the button "Make a note with this table" of a saved house only when the tree view gives the option, and a new house has no Change ID and no People', () => {
		const a = open();
		expect(openPage(a.content, 'orsini').querySelector('.dynasty-hp-make-note')).toBeNull();
		a.win.close();
		const b = open({ people: { show: () => undefined, openNote: () => undefined } });
		const page = openPage(b.content, 'orsini');
		const note = page.querySelector('.dynasty-hp-make-note')!;
		expect(note.getText()).toBe(HOUSE_PAGE_UI.makeNote);
		expect(note.getAttribute('aria-label')).toBe(HOUSE_PAGE_UI.makeNoteLabel('House Orsini'));
		backToList(b.content);
		click(b.content.querySelector('button[data-focus="add"]'));
		const fresh = pageOf(b.content);
		expect(fresh.querySelector('[data-section="people"]')).toBeNull();
		expect(fresh.querySelector('.dynasty-hp-make-note')).toBeNull();
		expect(fresh.querySelector('.dynasty-id-open')).toBeNull();
		expect(fresh.querySelector('.dynasty-house-delete')).not.toBeNull();
	});

	it('Back, Esc and the Back bar return to the list with the focus on the row just left', () => {
		const { content, modal, win } = open();
		openPage(content, 'ashby');
		backToList(content);
		expect(active()).toBe('row:h3');
		openPage(content, 'ashby');
		win.close();
		expect(backButton(content)).toBeNull();
		expect(active()).toBe('row:h3');
		expect(confirmOf(modal)).toBeNull();
	});

	it('shows the arms of the house in a box that opens the picker, with the arms colours of D68 and the 12 house colours', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		const page = openPage(content, 'valmont');
		await settle();
		const box = page.querySelector('button.dynasty-house-arms')!;
		expect(box.getAttribute('data-focus')).toBe('arms:h0');
		expect(box.getAttribute('aria-label')).toBe(PICTURES_UI.armsButtonLabel('House Valmont'));
		expect(box.getAttribute('aria-haspopup')).toBe('menu');
		expect(box.hasClass('is-add')).toBe(false);
		expect(box.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		const fromArms = page.querySelector('.dynasty-house-arms-colour')!;
		expect(fromArms.getAttribute('data-colour')).toBe('#ffffff');
		// The colours of the arms are round swatches like the house colours (a small dot is drawn by the style sheet).
		expect(fromArms.hasClass('dynasty-swatch')).toBe(true);
		// A tap on the arms opens the short menu: Select arms, and Remove arms because the house has arms.
		click(box);
		expect(lastMenu()!.items.filter((i) => i !== 'sep').map((i) => (i as { title: string }).title)).toEqual([PICTURES_UI.selectArms, PICTURES_UI.removeArms]);
		// One label "Colour" for the whole choice (arms-colours): no label over the colours of the arms, none over the house colours.
		const labels = page.querySelectorAll('.dynasty-house-palette .dynasty-sheet-label').map((l) => l.getText());
		expect(labels).toEqual([WINDOW_UI.colour]);
		// The colours of the arms come after the twelve house colours and the swatch "Other colour".
		const palette = page.querySelector('.dynasty-house-palette')!;
		const groups = palette.querySelectorAll(':scope > .dynasty-swatches');
		expect(groups).toHaveLength(2);
		expect(groups[0]!.querySelectorAll('.dynasty-house-colour')).toHaveLength(12);
		expect(groups[1]!.hasClass('dynasty-house-arms-colours')).toBe(true);
	});

	it('shows no colours of the arms, and no text and no empty box, when the plugin cannot read the pixels (arms-colours)', async () => {
		const { store } = fakeStore({ pixels: null });
		const { content } = open({ pictures: store });
		const page = openPage(content, 'valmont');
		await settle();
		expect(page.querySelector('.dynasty-house-arms-none')).toBeNull();
		expect(page.querySelectorAll('.dynasty-house-arms-colour')).toHaveLength(0);
		expect(page.querySelector('.dynasty-house-arms-colours')!.children).toHaveLength(0);
		expect(page.querySelectorAll('.dynasty-house-colour')).toHaveLength(12);
	});

	it('shows the colours of the arms only after the picture is read, and no label or box before (arms-colours)', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		const page = openPage(content, 'valmont');
		// Before the pixels arrive the group is there but empty and marked as loading, so the style sheet shows nothing.
		const group = page.querySelector('.dynasty-house-arms-colours')!;
		expect(group.hasClass('is-loading')).toBe(true);
		expect(group.children).toHaveLength(0);
		await settle();
		expect(group.hasClass('is-loading')).toBe(false);
		expect(group.children.length).toBeGreaterThan(0);
	});

	it('a house with no arms has no group of arms colours', () => {
		const { content } = open();
		const page = openPage(content, 'thorne');
		expect(page.querySelector('.dynasty-house-arms-colours')).toBeNull();
	});
});

describe('the draft: edit, Save, Cancel and close (D.3.8)', () => {
	it('shows a change in the list at once with the tag Changed, and the Back bar follows the name', () => {
		const { content } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Thornwood');
		expect(content.querySelector('.dynasty-lw-back-name')!.getText()).toBe('House Thornwood');
		expect(pageOf(content).getAttribute('aria-label')).toBe(WIN_LIST_UI.editPage('House Thornwood'));
		backToList(content);
		expect(rowTexts(content)[2]).toBe(`House Thornwood | ${WIN_LIST_UI.stateChanged} | ${HOUSES.count(0)}`);
	});

	it('writes two edits, a new colour and a new house in ONE write', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Thornwood');
		await click(pageOf(content).querySelector(`.dynasty-house-colour[data-colour="${P[2]}"]`));
		backToList(content);
		openPage(content, 'ashby');
		type(field(content), 'House Ashford');
		backToList(content);
		await click(content.querySelector('button[data-focus="add"]'));
		type(field(content), 'House Newcomer');
		await save(content);
		expect(handle.write).toHaveBeenCalledTimes(1);
		const op = handle.ops[0]!;
		expect(op.kind).toBe('batch');
		expect((op as { ops: unknown[] }).ops).toHaveLength(3);
		const t = parseDynasty(handle.body);
		if (!t.ok) throw new Error('parse');
		const byId = Object.fromEntries(t.tree.houses.map((h) => [h.id, h]));
		expect(byId.thorne!.name).toBe('House Thornwood');
		expect(byId.thorne!.color).toBe(P[2]);
		expect(byId.ashby!.name).toBe('House Ashford');
		expect(t.tree.houses.some((h) => h.name === 'House Newcomer')).toBe(true);
		expect(openModals).toHaveLength(0);
	});

	it('Cancel writes nothing and closes at once, also with changes', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Changed');
		await click(content.querySelector('button[data-focus="cancel"]'));
		expect(handle.write).not.toHaveBeenCalled();
		expect(openModals).toHaveLength(0);
	});

	it('Save with no change closes the window and writes nothing (from a page: the list has Close only)', async () => {
		const { content, handle } = open();
		expect(content.querySelector('button[data-focus="save"]')).toBeNull();
		openPage(content, 'thorne');
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(openModals).toHaveLength(0);
	});

	it('Esc goes: a question, then a page, then the discard question, then the window', async () => {
		const { content, modal, win, handle } = open();
		openPage(content, 'orsini');
		type(field(content), 'House Changed');
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		expect(confirmOf(modal)).not.toBeNull();
		// A question over the page closes first.
		win.close();
		expect(confirmOf(modal)).toBeNull();
		expect(backButton(content)).not.toBeNull();
		win.close();
		expect(backButton(content)).toBeNull();
		win.close();
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-text')!.getText()).toBe(HOUSES.discardText);
		click(confirmOf(modal)!.querySelector('.dynasty-sheet-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(openModals).toHaveLength(1);
		win.close();
		click(confirmOf(modal)!.querySelector('.dynasty-sheet-discard'));
		expect(openModals).toHaveLength(0);
		expect(handle.write).not.toHaveBeenCalled();
	});

	it('closes with no question when nothing changed, also after a search and a page', () => {
		const { content, win } = open();
		searchFor(content, 'a');
		openPage(content, 'ashby');
		win.close();
		win.close();
		expect(openModals).toHaveLength(0);
	});

	it('keeps the draft through the search, a page and Back', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Kept');
		backToList(content);
		searchFor(content, 'kept');
		openPage(content, 'thorne');
		backToList(content);
		searchFor(content, '');
		await save(content);
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(handle.body).toContain('name: House Kept');
	});

	it('never lets a failed step escape: a throw in the page leaves the window open', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { content, win } = open();
		const w = win as unknown as { renderPage(): void };
		w.renderPage = () => {
			throw new Error('page failed');
		};
		expect(() => dispatch(rowOf(content, 'thorne'), 'click')).not.toThrow();
		expect(err).toHaveBeenCalled();
		expect(openModals).toHaveLength(1);
	});
});

describe('colours (D32, D68)', () => {
	it('a house colour on the page goes into the draft, keeps the focus on the colour and is written as one colour', async () => {
		const { content, handle } = open();
		const page = openPage(content, 'thorne');
		await click(page.querySelector(`.dynasty-house-colour[data-colour="${P[3]}"]`));
		expect(active()).toBe(`colour:h2:${P[3]}`);
		expect(pageOf(content).querySelector(`.dynasty-house-colour[data-colour="${P[3]}"]`)!.getAttribute('aria-pressed')).toBe('true');
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'thorne', color: P[3] }] });
	});

	it('Other colour writes #rrggbb', async () => {
		const { content, handle } = open();
		const page = openPage(content, 'thorne');
		const input = page.querySelector('input[type="color"]')!;
		input.value = '#12ab34';
		dispatch(input, 'change');
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'thorne', color: '#12ab34' }] });
	});

	it('a colour of the arms is written like a house colour', async () => {
		const { store } = fakeStore();
		const { content, handle } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		await click(pageOf(content).querySelector('.dynasty-house-arms-colour'));
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', color: '#ffffff' }] });
	});

	it('a new house takes the first house colour that no house uses', async () => {
		const { content } = open();
		await click(content.querySelector('button[data-focus="add"]'));
		const chosen = pageOf(content).querySelectorAll('.dynasty-house-colour').filter((b) => b.getAttribute('aria-pressed') === 'true');
		expect(chosen.map((b) => b.getAttribute('data-colour'))).toEqual([P[1]]);
	});
});

describe('arms in the draft (spec §13.6)', () => {
	it('Select arms puts the chosen link into the draft, the row box follows, and Save writes it', async () => {
		const { store } = fakeStore();
		const { content, handle } = open({ pictures: store });
		openPage(content, 'thorne');
		picks.push({ kind: 'choose', link: '[[thorne.png]]' });
		// A house with no arms has no button in the header; the text link "Add arms" stands at the left of "Open all" (D216 item 1). A tap opens the picker at once, with no menu.
		const head = pageOf(content).querySelector('button.dynasty-house-arms')!;
		expect(head.hasClass('is-add')).toBe(true);
		expect(head.getText()).toBe('');
		expect(head.querySelector('img')).toBeNull();
		const add = pageOf(content).querySelector('.dynasty-openall .dynasty-add-arms')!;
		expect(add.getText()).toBe('Add arms');
		expect(add.getAttribute('aria-haspopup')).toBeNull();
		expect(add.parentElement!.children[0]).toBe(add);
		await click(add);
		await settle();
		expect(pageOf(content).querySelector('button.dynasty-house-arms')!.querySelector('img')).not.toBeNull();
		backToList(content);
		await settle();
		expect(rowOf(content, 'thorne').querySelector('.dynasty-lw-armsbox')!.querySelector('img')).not.toBeNull();
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'thorne', arms: '[[thorne.png]]' }] });
	});

	it('the picker answers "remove" too, and Remove arms of the menu takes the arms out of the draft', async () => {
		const { store } = fakeStore();
		const { content, handle } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		picks.push({ kind: 'remove' });
		await click(pageOf(content).querySelector('button.dynasty-house-arms'));
		lastMenu()!.item(PICTURES_UI.selectArms)!.click();
		await settle();
		// With the arms gone the header has no button, and the text link "Add arms" shows in the "Open all" row, not an empty ring or initials.
		expect(pageOf(content).querySelector('button.dynasty-house-arms')!.hasClass('is-add')).toBe(true);
		expect(pageOf(content).querySelector('.dynasty-openall .dynasty-add-arms')!.getText()).toBe('Add arms');
		expect(pageOf(content).querySelector('.dynasty-openall .dynasty-add-arms')!.getAttribute('style') ?? '').not.toContain('display: none');
		// A tap on it opens the picker (it answers "cancel" now), not a menu.
		const menu = lastMenu();
		await click(pageOf(content).querySelector('.dynasty-openall .dynasty-add-arms'));
		expect(lastMenu()).toBe(menu);
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', arms: null }] });
	});

	it('Remove arms of the menu moves the focus to the link "Add arms", which takes the place of the button', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		await click(pageOf(content).querySelector('button.dynasty-house-arms'));
		lastMenu()!.item(PICTURES_UI.removeArms)!.click();
		expect(active()).toBe('add-arms:h0');
	});

	it('a change of the picture files redraws the box of the row and of the page (store.onChange)', async () => {
		const { store, state } = fakeStore();
		state.nullFirst = true;
		const { content, win } = open({ pictures: store });
		await settle();
		// The first copy was dropped because the file changed: the box waits for the change event.
		const box = () => rowOf(content, 'valmont').querySelector('.dynasty-lw-armsbox')!;
		expect(box().querySelector('img')).toBeNull();
		expect(box().hasClass('is-empty')).toBe(false);
		expect(box().hasClass('is-loading')).toBe(true);
		store.changed(['Pictures/valmont-arms.png']);
		await settle();
		expect(box().querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		win.close();
		expect(store.listeners.size).toBe(0);
	});

	it('closing the window releases its arms copies', async () => {
		const { store, released } = fakeStore();
		const { win } = open({ pictures: store });
		await settle();
		win.close();
		expect(released).toHaveLength(1);
	});
});

describe('Add (D.3.4)', () => {
	it('clears the query, opens the page of the new house with the focus on its name, and the row shows New', async () => {
		const { content } = open();
		searchFor(content, 'orsini');
		await click(content.querySelector('button[data-focus="add"]'));
		expect(active()).toBe('name:h12');
		expect(backButton(content)).not.toBeNull();
		expect(content.querySelector('.dynasty-lw-back-name')!.getText()).toBe(HOUSES.newHouse);
		backToList(content);
		expect(searchBox(content).value).toBe('');
		const rows = rowTexts(content);
		expect(rows[rows.length - 1]).toBe(`${HOUSES.newHouse} | ${WIN_LIST_UI.stateNew} | ${HOUSES.count(0)}`);
	});

	it('Save refuses a new house with no name: its page opens, the error shows and the focus goes to its name', async () => {
		const { content, handle } = open();
		await click(content.querySelector('button[data-focus="add"]'));
		backToList(content);
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(pageOf(content).getAttribute('data-house')).toBe('h12');
		const error = content.querySelector('.dynasty-sheet-error')!;
		expect(error.getText()).toBe(HOUSES.needName);
		expect(active()).toBe('name:h12');
		type(field(content), 'House Fresh');
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
	});

	it('Save refuses an old house whose name is empty, on the page of that house', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), '   ');
		backToList(content);
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(pageOf(content).getAttribute('data-house')).toBe('thorne');
		expect(active()).toBe('name:h2');
	});
});

describe('Delete (D32, D113, D.3.7)', () => {
	it('removes a new house at once, with no question, shows the list and puts the focus on Add when it was last', async () => {
		const { content, modal } = open();
		await click(content.querySelector('button[data-focus="add"]'));
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		expect(confirmOf(modal)).toBeNull();
		expect(backButton(content)).toBeNull();
		expect(names(content)).toHaveLength(12);
		// The row before it takes the focus; with no row left, Add does.
		expect(active()).toBe('row:h11');
	});

	it('puts the focus on Add when the last house goes', async () => {
		const { content } = open({ body: ['houses:', '  - id: only', '    name: House Only', ''].join('\n') });
		openPage(content, 'only');
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		expect(names(content)).toEqual([]);
		expect(active()).toBe('add');
	});

	it('marks a house with no people at once, without a question, and the focus goes to the row that took its place', async () => {
		const { content, modal, handle } = open();
		openPage(content, 'thorne');
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		expect(confirmOf(modal)).toBeNull();
		expect(names(content)).not.toContain('House Thorne');
		expect(active()).toBe('row:h3');
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'delete-house', id: 'thorne', people: 'clear' }] });
		expect(notices[notices.length - 1]).toBe(HOUSES.deleted(['House Thorne']));
	});

	it('asks what happens to the people, with the number only, and Cancel keeps the house and the page', async () => {
		const { content, modal } = open();
		openPage(content, 'orsini');
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		const layer = confirmOf(modal)!;
		expect(layer.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(HOUSES.confirmTitle('House Orsini'));
		expect(layer.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText())).toEqual([HOUSES.confirmPeople(2), HOUSES.confirmAsk(2)]);
		expect(layer.querySelector('.dynasty-house-clear')).not.toBeNull();
		expect(layer.querySelector('.dynasty-house-keep')).not.toBeNull();
		await click(layer.querySelector('.dynasty-sheet-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(backButton(content)).not.toBeNull();
		expect(active()).toBe('delete:h1');
	});

	for (const how of ['clear', 'keep'] as const) {
		it(`"${how}": the house goes from the list and Save writes delete-house with people ${how}, with an Undo Notice`, async () => {
			const { content, modal, handle } = open();
			openPage(content, 'orsini');
			await click(pageOf(content).querySelector('.dynasty-house-delete'));
			await click(confirmOf(modal)!.querySelector(`.dynasty-house-${how}`));
			expect(backButton(content)).toBeNull();
			expect(names(content)).not.toContain('House Orsini');
			expect(active()).toBe('row:h2');
			await save(content);
			expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'delete-house', id: 'orsini', people: how }] });
			const undo = noticeList[noticeList.length - 1]!;
			expect(notices[notices.length - 1]).toContain(HOUSES.deleted(['House Orsini']));
			await click(undo.messageEl.querySelector('.dynasty-undo-button'));
			expect(handle.body).toBe(twelve());
		});
	}

	it('asks again at Save for a house with no people that has people after a reload (D32), and Cancel keeps the house', async () => {
		const { content, modal, handle } = open();
		openPage(content, 'thorne');
		await click(pageOf(content).querySelector('.dynasty-house-delete'));
		// The note changes outside the window: Thorne now has a person.
		handle.body = `${handle.body}  - id: wren\n    name: Wren Thorne\n    house: thorne\n`;
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(HOUSES.stale);
		await save(content);
		const layer = confirmOf(modal)!;
		expect(layer.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(HOUSES.confirmTitle('House Thorne'));
		await click(layer.querySelector('.dynasty-sheet-keep'));
		expect(names(content)).toContain('House Thorne');
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('Change ID (D109, D110, D.3.7)', () => {
	it('opens the small window once, "Use this ID" puts the new ID into the draft, and the page shows the note', async () => {
		const { content } = open();
		openPage(content, 'valmont');
		const button = pageOf(content).querySelector('.dynasty-id-open')!;
		dispatch(button, 'click', { detail: 1 });
		dispatch(button, 'click', { detail: 1 });
		await settle();
		const small = openModals.filter((m) => (m as unknown as { modalEl: FEl }).modalEl.hasClass('dynasty-id-window'));
		expect(small).toHaveLength(1);
		const idWin = (small[0] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'valmont-line');
		await click(idWin.querySelector('.dynasty-id-use'));
		expect(openModals).toHaveLength(1);
		expect(pageOf(content).getAttribute('data-house')).toBe('valmont');
		expect(pageOf(content).querySelector('.dynasty-id-new-text')!.getText()).toBe(ID_UI.newId('valmont-line'));
		expect(active()).toBe('id-open:h0');
		backToList(content);
		expect(rowTexts(content)[0]).toContain(WIN_LIST_UI.stateChanged);
	});

	it('Cancel of the small window returns the focus to Change ID', async () => {
		const { content } = open();
		openPage(content, 'valmont');
		await click(pageOf(content).querySelector('.dynasty-id-open'));
		const small = openModals[openModals.length - 1] as unknown as { close(): void };
		small.close();
		await settle();
		expect(active()).toBe('id-open:h0');
	});

	it('Save asks "Change the ID?", then writes the ID change and the edits in ONE write, ID first', async () => {
		const { content, modal, handle } = open();
		openPage(content, 'valmont');
		await click(pageOf(content).querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		type(field(content), 'House Valmont of the North');
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(ID_UI.confirmTitle(1));
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(handle.ops[0]).toEqual({
			kind: 'batch',
			ops: [
				{ kind: 'set-house-id', id: 'valmont', newId: 'house-valmont' },
				{ kind: 'edit-house', id: 'house-valmont', name: 'House Valmont of the North' },
			],
		});
	});

	it('"Do not change" in the question keeps the window and the page', async () => {
		const { content, modal, handle } = open();
		openPage(content, 'valmont');
		await click(pageOf(content).querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		await save(content);
		await click(confirmOf(modal)!.querySelector('.dynasty-id-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(handle.write).not.toHaveBeenCalled();
		expect(backButton(content)).not.toBeNull();
	});

	it('Keep old ID drops the new ID from the draft', async () => {
		const { content } = open();
		openPage(content, 'valmont');
		await click(pageOf(content).querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		await click(pageOf(content).querySelector('.dynasty-id-old'));
		expect(pageOf(content).querySelector('.dynasty-id-new')).toBeNull();
		expect(active()).toBe('id-open:h0');
	});

	it('Save with a refused ID opens the page of the FIRST saved house with the problem, shows the reason once and focuses Change ID', async () => {
		const { content, handle } = open();
		const useId = async (key: string, value: string) => {
			openPage(content, key);
			await click(pageOf(content).querySelector('.dynasty-id-open'));
			const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
			type(idWin.querySelector('.dynasty-id-input')!, value);
			await click(idWin.querySelector('.dynasty-id-use'));
			backToList(content);
		};
		await useId('ashby', 'tmp-a');
		await useId('brandt', 'tmp-b');
		// Two new houses whose names give those IDs: the saved rows are refused after their small windows have closed.
		for (const name of ['Tmp B', 'Tmp A']) {
			await click(content.querySelector('button[data-focus="add"]'));
			type(field(content), name);
			backToList(content);
		}
		expect(rowTexts(content).filter((t) => t.includes(WIN_LIST_UI.stateCheckId))).toHaveLength(4);
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(pageOf(content).getAttribute('data-house')).toBe('ashby');
		expect(active()).toBe('id-open:h3');
		expect(pageOf(content).querySelector('.dynasty-id-new-problem')!.getText()).not.toBe('');
		expect(pageOf(content).hasClass('has-id-problem')).toBe(true);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
	});
});

describe('stale write and reload (spec §6.1)', () => {
	it('keeps the draft and the open page when the note changed and the house still exists', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Mine');
		handle.body = handle.body.replace('House Ashby', 'House Ashby Changed');
		await save(content);
		expect(handle.write).not.toHaveBeenCalled();
		expect(pageOf(content).getAttribute('data-house')).toBe('thorne');
		expect(field(content).value).toBe('House Mine');
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(HOUSES.stale);
		backToList(content);
		expect(names(content)).toContain('House Ashby Changed');
	});

	it('shows the list when the open house is gone after the reload', async () => {
		const { content, handle } = open();
		openPage(content, 'ashby');
		type(field(content), 'House Mine');
		backToList(content);
		openPage(content, 'thorne');
		handle.body = handle.body.replace(/  - id: thorne\n {4}name: House Thorne\n/, '');
		await save(content);
		expect(backButton(content)).toBeNull();
		expect(names(content)).not.toContain('House Thorne');
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(HOUSES.stale);
	});

	it('shows the failure text and keeps the window when the write is refused', async () => {
		const { content, handle } = open();
		openPage(content, 'thorne');
		type(field(content), 'House Mine');
		handle.write.mockImplementation((async () => ({ ok: false, code: 'missing' })) as never);
		await save(content);
		expect(openModals).toHaveLength(1);
		expect(backButton(content)).not.toBeNull();
		expect(notices[notices.length - 1]).toBe(HOUSES.missing);
	});
});

describe('the People section (D202, G.10; replaces the house page window)', () => {
	function peopleApp() {
		return {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(async (path: string) => ({ path, name: path, basename: path.replace(/\.md$/, '') })), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
	}

	function withPeople(body = twelve()) {
		const app = peopleApp();
		const opened: (() => Promise<void>)[] = [];
		const handle = writingHandle(body);
		const closed: string[] = [];
		const win = HousesWindow.create(app as never, {
			handle: handle as never,
			sourcePath: 'n.md',
			onClosed: () => closed.push('closed'),
			people: { show: () => undefined, openNote: (open) => void opened.push(open) },
		})!;
		win.open();
		const o = win as unknown as { contentEl: FEl; modalEl: FEl };
		return { win, app, opened, handle, closed, content: o.contentEl, modal: o.modalEl };
	}

	/** A house with ten people, so that the section has more than its eight rows. */
	function crowded(): string {
		const lines = ['houses:', '  - id: crowd', '    name: House Crowd', '', 'people:'];
		for (let i = 0; i < 10; i++) lines.push(`  - id: p${i}`, `    name: Person ${i} Crowd`, '    house: crowd', '    born: ' + String(1100 + i));
		lines.push('');
		return lines.join('\n');
	}

	it('shows the people of the saved house as rows (a tap shows the card when the tree view gives a way), with the generation and the years', () => {
		const { content } = withPeople();
		const page = openPage(content, 'orsini');
		const section = page.querySelector('[data-section="people"]')!;
		const rows = section.querySelectorAll('.dynasty-hp-row');
		expect(rows.map((r) => r.querySelector('.dynasty-hp-name')!.getText())).toEqual(['Isolde Orsini', 'Lucan Orsini']);
		expect(rows.every((r) => r.tag === 'button')).toBe(true);
		expect(rows[0]!.querySelector('.dynasty-row-sub')!.getText()).toBe(WINDOW_UI.personRowSub(1, '', ''));
		expect(section.querySelector('.dynasty-section-sum')!.getText()).toBe(WINDOW_UI.sumPeopleHeader(2, 1));
	});

	it('draws a plain full-width row: the bold name, the second text line, no chevron, no portrait box and no picture at all (people-rows, D213)', () => {
		const { content } = withPeople();
		const page = openPage(content, 'orsini');
		const rows = page.querySelector('[data-section="people"]')!.querySelectorAll('.dynasty-hp-row');
		for (const r of rows) {
			expect(r.querySelector('.dynasty-row-chev'), 'no chevron').toBeNull();
			expect(r.querySelector('.dynasty-row-lead'), 'no lead').toBeNull();
			expect(r.querySelector('b.dynasty-hp-name')).not.toBeNull();
		}
		// The row has its name from its two text lines; there is no floating label (aria-label) on it.
		expect(rows[0]!.getAttribute('aria-label')).toBeNull();
		expect(rows[0]!.getAttribute('aria-labelledby')).toBeTruthy();
	});

	it('shows eight rows, then "and N more", and the summary of the closed section with the count and the generations (D216 item 2)', () => {
		const { content } = withPeople(crowded());
		const page = openPage(content, 'crowd');
		const section = page.querySelector('[data-section="people"]')!;
		expect(section.querySelectorAll('.dynasty-hp-row')).toHaveLength(8);
		expect(section.querySelector('.dynasty-hp-more')!.getText()).toBe(WINDOW_UI.andMore(2));
		expect(section.querySelector('.dynasty-section-sum')!.getText()).toBe(WINDOW_UI.sumPeopleHeader(10, 1));
		expect(page.querySelector('.dynasty-lw-pagemeta')).toBeNull();
	});

	it('makes a note with the table, then closes the window and opens the note', async () => {
		const { content, app, opened, closed } = withPeople();
		openPage(content, 'orsini');
		await click(pageOf(content).querySelector('.dynasty-hp-make-note'));
		await settle();
		expect(app.vault.create).toHaveBeenCalledTimes(1);
		expect(notices[notices.length - 1]).toContain(HOUSE_PAGE_UI.noteMade('House Orsini').slice(0, 20));
		expect(opened).toHaveLength(1);
		expect(openModals).toHaveLength(0);
		expect(closed).toEqual(['closed']);
	});

	it('with a changed draft the question shows first; Keep editing keeps the window and drops the note action', async () => {
		const { content, modal, opened } = withPeople();
		openPage(content, 'orsini');
		type(field(content), 'House Orsini Changed');
		await click(pageOf(content).querySelector('.dynasty-hp-make-note'));
		await settle();
		expect(confirmOf(modal)).not.toBeNull();
		await click(confirmOf(modal)!.querySelector('.dynasty-sheet-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(opened).toEqual([]);
		expect(openModals).toHaveLength(1);
		expect(names(content)).toContain('House Orsini Changed');
	});
});

describe('texts and the speed of the list', () => {
	it('names the window and its search for a screen reader', () => {
		const { modal } = open();
		expect(modal.getAttribute('role')).toBe('dialog');
		expect(modal.getAttribute('aria-modal')).toBe('true');
	});

	it('draws 100 houses and filters them again for every key without redrawing the bar', () => {
		const lines = ['houses:'];
		for (let i = 0; i < 100; i++) lines.push(`  - id: house-${i}`, `    name: House Number ${i}`);
		const { content } = open({ body: `${lines.join('\n')}\n` });
		expect(listRows(content)).toHaveLength(100);
		const bar = content.querySelector('.dynasty-lw-bar')!;
		searchFor(content, 'number 77');
		expect(names(content)).toEqual(['House Number 77']);
		expect(content.querySelector('.dynasty-lw-bar')).toBe(bar);
		runTimers(100);
	});
});

describe('the house page after the typography round (D216 items 1 and 2, D218 items 6 and 11)', () => {
	/** The "Open all" row of the open page and the link "Add arms" in it. */
	const rowOfPage = (content: FEl) => pageOf(content).querySelector('.dynasty-openall')!;
	const linkOf = (content: FEl) => rowOfPage(content).querySelector('.dynasty-add-arms')!;

	it('puts the link "Add arms" first in the "Open all" row, where "Add portrait" stands in the person window, and keeps it a tap target of the same kind', () => {
		const { content } = open();
		openPage(content, 'thorne');
		const link = linkOf(content);
		expect(rowOfPage(content).children[0]).toBe(link);
		expect(rowOfPage(content).children[1]!.hasClass('dynasty-openall-button')).toBe(true);
		expect(link.tag).toBe('button');
		expect(link.getText()).toBe(WINDOW_UI.addArms);
		expect(link.hidden).toBe(false);
		// The look is the one of "Add portrait" (10-edit-sheet.css): the same two classes.
		expect(link.hasClass('dynasty-link')).toBe(true);
		expect(link.hasClass('dynasty-add-portrait')).toBe(true);
		expect(link.getAttribute('data-focus')).toBe('add-arms:h2');
	});

	it('hides the link while the house has arms to show, and shows it for arms that cannot show', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		expect(linkOf(content).hidden).toBe(true);
		expect(pageOf(content).querySelector('button.dynasty-house-arms')!.hasClass('is-add')).toBe(false);
		// The same page without a picture store: the arms cannot be found, so the link shows.
		backToList(content);
		const none = open();
		openPage(none.content, 'valmont');
		expect(linkOf(none.content).hidden).toBe(false);
		expect(pageOf(none.content).querySelector('button.dynasty-house-arms')!.hasClass('is-add')).toBe(true);
	});

	it('shows the link on the page of a new house too, and keeps the line "New house" under its name', async () => {
		const { content } = open();
		await click(content.querySelector('button[data-focus="add"]'));
		expect(linkOf(content).hidden).toBe(false);
		expect(pageOf(content).querySelector('.dynasty-lw-pagemeta')!.getText()).toBe(HOUSES.newHouse);
	});

	it('moves the focus to the arms button after the link chose arms, and back to the link when they are removed', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		openPage(content, 'thorne');
		picks.push({ kind: 'choose', link: '[[thorne.png]]' });
		await click(linkOf(content));
		await settle();
		expect(active()).toBe('arms:h2');
		expect(linkOf(content).hidden).toBe(true);
		picks.push({ kind: 'remove' });
		await click(pageOf(content).querySelector('button.dynasty-house-arms'));
		lastMenu()!.item(PICTURES_UI.selectArms)!.click();
		await settle();
		expect(linkOf(content).hidden).toBe(false);
		expect(active()).toBe('add-arms:h2');
	});

	it('has no header line for a saved house; the count of the people and the generations is the summary of the closed People section', () => {
		const { content } = open();
		const page = openPage(content, 'orsini');
		expect(page.querySelector('.dynasty-lw-pagehead .dynasty-head-meta')).toBeNull();
		expect(page.querySelector('[data-section="people"] .dynasty-section-sum')!.getText()).toBe('2 people in 1 generation');
		// A house with no people says so in the same place.
		expect(openPageSummary(content, 'thorne')).toBe('No people');
	});

	/** The summary of the People section of a house: the page of another house opens first. */
	function openPageSummary(content: FEl, key: string): string {
		backToList(content);
		return openPage(content, key).querySelector('[data-section="people"] .dynasty-section-sum')!.getText();
	}

	it('keeps the title on the name line of a People row (11B), with the generation and the years on the text line', () => {
		const body = ['houses:', '  - id: orsini', '    name: House Orsini', 'titles:', '  - id: duke', '    name: Duke of Orsini', '    holders:', '      - {person: isolde}', 'people:', '  - id: isolde', '    name: Isolde Orsini', '    house: orsini', '    born: 1100', ''].join('\n');
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const win = HousesWindow.create(app as never, { handle: writingHandle(body) as never, sourcePath: 'n.md', people: { show: () => undefined, openNote: () => undefined } })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const row = openPage(content, 'orsini').querySelector('.dynasty-hp-row')!;
		expect(row.querySelector('.dynasty-row-title .dynasty-hp-name')!.getText()).toBe('Isolde Orsini');
		expect(row.querySelector('.dynasty-row-title .dynasty-sob')!.getText()).toContain('Duke of Orsini');
		expect(row.querySelector('.dynasty-row-sub')!.getText()).not.toContain('Duke');
	});
});
