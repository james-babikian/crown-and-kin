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
import { HOUSES, HOUSE_PAGE_UI, ID_UI, PICTURES_UI, SHEET, WIN_LIST_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
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

	it('shows the colour square through the house colour property only, the arms box and the number of people', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		await settle();
		const valmont = rowOf(content, 'valmont');
		expect(valmont.querySelector('.dynasty-lw-swatch')!.style.getPropertyValue('--dynasty-house-color')).toBe(P[0]);
		expect(rowOf(content, 'thorne').querySelector('.dynasty-lw-swatch')!.hasClass('is-none')).toBe(true);
		expect(valmont.querySelector('.dynasty-lw-armsbox')!.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		expect(rowOf(content, 'thorne').querySelector('.dynasty-lw-armsbox')!.hasClass('is-empty')).toBe(true);
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
		for (const c of ['dynasty-sheet-action', 'dynasty-lw-add', 'dynasty-house-add']) expect(add.hasClass(c)).toBe(true);
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
		expect(field(content).value).toBe('House Orsini');
		expect(field(content).getAttribute('data-focus')).toBe('name:h1');
		expect(field(content).getAttribute('aria-label')).toBe(HOUSES.nameLabel);
		expect(page.querySelector('label.dynasty-house-name')).not.toBeNull();
	});

	it('shows the number of people, the intro hint and the whole palette with no toggle', () => {
		const { content } = open();
		const page = openPage(content, 'orsini');
		expect(page.querySelector('.dynasty-house-count')!.getText()).toBe(HOUSES.count(2));
		expect(page.querySelector('.dynasty-sheet-hint')!.getText()).toBe(HOUSES.intro);
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
		expect(last.hasClass('dynasty-lw-actions')).toBe(true);
		expect(last.querySelector('.dynasty-sheet-label')!.getText()).toBe(WIN_LIST_UI.otherActions);
		const buttons = last.querySelectorAll('button');
		expect(buttons.map((b) => b.getText())).toEqual([ID_UI.open, HOUSES.delete]);
		expect(buttons[0]!.hasClass('dynasty-id-open')).toBe(true);
		expect(buttons[0]!.getAttribute('aria-label')).toBe(ID_UI.openAria('House Orsini'));
		expect(buttons[1]!.hasClass('dynasty-house-delete')).toBe(true);
		expect(buttons[1]!.hasClass('mod-warning')).toBe(true);
		expect(buttons[1]!.getAttribute('aria-label')).toBe(HOUSES.deleteLabel('House Orsini'));
	});

	it('shows the People button of a saved house only when the tree view gives the option, and a new house has no Change ID and no People', () => {
		const a = open();
		expect(openPage(a.content, 'orsini').querySelector('.dynasty-house-people')).toBeNull();
		a.win.close();
		const b = open({ people: { show: () => undefined, openNote: () => undefined } });
		const page = openPage(b.content, 'orsini');
		const people = page.querySelector('.dynasty-house-people')!;
		expect(people.getText()).toBe(HOUSE_PAGE_UI.people);
		expect(people.getAttribute('aria-label')).toBe(HOUSE_PAGE_UI.peopleLabel('House Orsini'));
		backToList(b.content);
		click(b.content.querySelector('button[data-focus="add"]'));
		const fresh = pageOf(b.content);
		expect(fresh.querySelector('.dynasty-house-people')).toBeNull();
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
		expect(box.getAttribute('aria-label')).toBe(PICTURES_UI.armsLabel('House Valmont'));
		expect(box.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		expect(page.querySelector('.dynasty-house-arms-colour')!.getAttribute('data-colour')).toBe('#ffffff');
		expect(page.querySelector('.dynasty-house-remove-arms')).not.toBeNull();
		expect(page.querySelector('.dynasty-house-select-arms')).not.toBeNull();
		const labels = page.querySelectorAll('.dynasty-house-palette .dynasty-sheet-label').map((l) => l.getText());
		expect(labels).toEqual([PICTURES_UI.armsHeading, 'Colour of House Valmont', PICTURES_UI.coloursFromArms, PICTURES_UI.houseColours]);
	});

	it('shows the text that says the colours of the arms are unknown when the plugin cannot read the pixels', async () => {
		const { store } = fakeStore({ pixels: null });
		const { content } = open({ pictures: store });
		const page = openPage(content, 'valmont');
		await settle();
		expect(page.querySelector('.dynasty-house-arms-none')!.getText()).toBe(PICTURES_UI.noArmsColours);
		expect(page.querySelectorAll('.dynasty-house-colour')).toHaveLength(12);
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

	it('Save with no change closes the window and writes nothing', async () => {
		const { content, handle } = open();
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
		await click(pageOf(content).querySelector('.dynasty-house-select-arms'));
		await settle();
		expect(pageOf(content).querySelector('button.dynasty-house-arms')!.querySelector('img')).not.toBeNull();
		backToList(content);
		await settle();
		expect(rowOf(content, 'thorne').querySelector('.dynasty-lw-armsbox')!.querySelector('img')).not.toBeNull();
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'thorne', arms: '[[thorne.png]]' }] });
	});

	it('the arms box of the page opens the picker too, and Remove arms takes the arms out of the draft', async () => {
		const { store } = fakeStore();
		const { content, handle } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		picks.push({ kind: 'remove' });
		await click(pageOf(content).querySelector('button.dynasty-house-arms'));
		expect(pageOf(content).querySelector('button.dynasty-house-arms')!.hasClass('is-empty')).toBe(true);
		expect(pageOf(content).querySelector('.dynasty-house-remove-arms')).toBeNull();
		await save(content);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', arms: null }] });
	});

	it('the Remove arms button keeps the focus in the window', async () => {
		const { store } = fakeStore();
		const { content } = open({ pictures: store });
		openPage(content, 'valmont');
		await settle();
		await click(pageOf(content).querySelector('.dynasty-house-remove-arms'));
		expect(active()).toBe('select-arms:h0');
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

describe('People opens the house page (spec §13.12, D.3.8 leaveThen)', () => {
	function peopleApp() {
		return {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
	}

	function withPeople() {
		const shown: string[] = [];
		const handle = writingHandle(twelve());
		const closed: string[] = [];
		const win = HousesWindow.create(peopleApp() as never, {
			handle: handle as never,
			sourcePath: 'n.md',
			onClosed: () => closed.push('closed'),
			people: { show: (id: string) => shown.push(id), openNote: () => undefined },
		})!;
		win.open();
		const o = win as unknown as { contentEl: FEl; modalEl: FEl };
		return { win, shown, handle, closed, content: o.contentEl, modal: o.modalEl };
	}

	const housePage = () => openModals[openModals.length - 1] as unknown as { contentEl: FEl };

	it('a tap on a name with no changes closes the house page and the window, then shows the card', async () => {
		const { content, shown, closed } = withPeople();
		openPage(content, 'orsini');
		await click(pageOf(content).querySelector('.dynasty-house-people'));
		expect(openModals).toHaveLength(2);
		dispatch(housePage().contentEl.querySelectorAll('.dynasty-hp-row')[0]!, 'click');
		await settle();
		expect(shown).toHaveLength(1);
		expect(openModals).toHaveLength(0);
		expect(closed).toEqual(['closed']);
	});

	it('with a changed draft the question shows; Keep editing shows the LIST, drops the card, and Esc then asks Discard changes', async () => {
		const { content, modal, shown, win } = withPeople();
		openPage(content, 'orsini');
		type(field(content), 'House Orsini Changed');
		await click(pageOf(content).querySelector('.dynasty-house-people'));
		dispatch(housePage().contentEl.querySelectorAll('.dynasty-hp-row')[0]!, 'click');
		await settle();
		expect(confirmOf(modal)).not.toBeNull();
		expect(backButton(content)).toBeNull();
		await click(confirmOf(modal)!.querySelector('.dynasty-sheet-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(backButton(content)).toBeNull();
		expect(names(content)).toContain('House Orsini Changed');
		expect(shown).toEqual([]);
		win.close();
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(shown).toEqual([]);
	});

	it('with a changed draft, Discard changes shows the card', async () => {
		const { content, modal, shown } = withPeople();
		openPage(content, 'orsini');
		type(field(content), 'House Orsini Changed');
		await click(pageOf(content).querySelector('.dynasty-house-people'));
		dispatch(housePage().contentEl.querySelectorAll('.dynasty-hp-row')[0]!, 'click');
		await settle();
		await click(confirmOf(modal)!.querySelector('.dynasty-sheet-discard'));
		expect(shown).toHaveLength(1);
		expect(openModals).toHaveLength(0);
	});

	it('the focus goes back to People when the house page closes without a choice', async () => {
		const { content } = withPeople();
		openPage(content, 'orsini');
		await click(pageOf(content).querySelector('.dynasty-house-people'));
		(housePage() as unknown as { close(): void }).close();
		await settle();
		expect(active()).toBe('people:h1');
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
