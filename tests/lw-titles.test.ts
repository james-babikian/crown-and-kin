import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { holderTable } from '../src/core/titles';
import { TitlesWindow, type TitlesOptions } from '../src/obsidian/titles-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { ID_UI, SHEET, TITLES_UI, WIN_LIST_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_13 } from './acceptance/titles-support';
import { fakeHost } from './acceptance/tree-view-fakes';
import { backButton, backToList, listRows, openPage, pageOf, press, rowNames, rowOf, rowTexts, searchFor } from './lw-support';
import { click, type, writingHandle, type Writing } from './s113-c-support';

/*
 * WP-lw-titles of 0.2.5 (the 0.2.5 contract D.3, D134, D138, D130 item 8): the Titles window as a searchable list with an
 * edit page. The window is a draft: one Save writes every change in one batch, Cancel writes nothing, a close with
 * changes asks first. The tests run the real window on the fake DOM with sample tree 13; the other sample is made up.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const G13 = (() => {
	const r = parseDynasty(BODY_13);
	if (!r.ok) throw new Error('sample 13 does not parse');
	return deriveFamilies(r.tree);
})();

interface Opened {
	win: TitlesWindow;
	handle: Writing;
	content: FEl;
	modal: FEl;
	host: ReturnType<typeof fakeHost>;
	shown: string[];
	closed: { n: number };
}

function openWin(body = BODY_13, extra: Partial<TitlesOptions> = {}): Opened {
	const handle = writingHandle(body);
	const host = fakeHost();
	const shown: string[] = [];
	const closed = { n: 0 };
	const win = TitlesWindow.create(host.app as never, { handle: handle as never, sourcePath: 'n.md', show: (id) => void shown.push(id), onClosed: () => void closed.n++, ...extra })!;
	win.open();
	const w = win as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, handle, content: w.contentEl, modal: w.modalEl, host, shown, closed };
}

const isOpen = (win: TitlesWindow) => openModals.some((m) => (m as unknown) === win);
const active = (): string | null => fakeDoc.activeElement?.getAttribute('data-focus') ?? null;
const field = (page: FEl, cls: string): FEl => page.querySelector(`.${cls} textarea`)!;
const typeIn = (page: FEl, cls: string, text: string) => type(field(page, cls), text);
const save = async (o: Opened) => click(o.content.querySelector('button[data-focus="save"]'));
const question = (o: Opened): FEl | null => o.modal.querySelector('.dynasty-sheet-confirm');
const rowsOf = (o: Opened) => (o.win as unknown as { rows: { key: string; id: string | null; idDraft?: string; name: string }[] }).rows;
const keyOf = (o: Opened, id: string) => rowsOf(o).find((t) => t.id === id)!.key;
const bodyLines = (s: string) => s.split('\n');

/** A small made-up tree: one title, a holder with a sobriquet and one who is not in the tree. */
const SOB = [
	'titles:',
	'  - id: duke',
	'    name: Duke of Quill',
	'    holders:',
	'      - {person: aldric, number: II, as: Aldric}',
	'      - {name: Orso the Old, number: I}',
	'      - {person: bran, from: 1200}',
	'people:',
	'  - {id: aldric, name: Ser Aldric Valmont, sobriquet: the Bold}',
	'  - {id: bran, name: Bran Orsini}',
	'',
].join('\n');

// ---------- the list ----------

describe('open: the list of titles (D.3.1, D.3.2)', () => {
	it('opens on the list, with the classes of both generations and no page', () => {
		const o = openWin();
		for (const c of ['dynasty-sheet', 'dynasty-titles', 'dynasty-lw']) expect(o.modal.hasClass(c)).toBe(true);
		expect(backButton(o.content)).toBeNull();
		expect(o.content.querySelector('.dynasty-lw-page')).toBeNull();
		expect(o.content.querySelector('.dynasty-title-box')).toBeNull();
	});

	it('shows one row for each title of the tree, in tree order, with no text field in the list', () => {
		const o = openWin();
		expect(rowNames(o.content)).toEqual(G13.titles.map((t) => t.name));
		expect(o.content.querySelector('ul.dynasty-lw-list')!.querySelectorAll('input, textarea')).toHaveLength(0);
		const duke = rowOf(o.content, 'duke-of-valmont');
		expect(duke.getAttribute('data-title')).toBe('duke-of-valmont');
	});

	it('puts Add title beside the search box, with the old class', () => {
		const o = openWin();
		const bar = o.content.querySelector('.dynasty-lw-bar')!;
		const add = bar.querySelector('button.dynasty-lw-add')!;
		expect(add.hasClass('dynasty-title-add')).toBe(true);
		expect(add.getText()).toBe(TITLES_UI.add);
		expect(bar.querySelector('input.dynasty-lw-search')!.getAttribute('placeholder')).toBe(WIN_LIST_UI.searchTitles);
	});

	it('shows the number of holders and the newest holder, with no sobriquet', () => {
		const o = openWin(SOB);
		expect(rowTexts(o.content)).toEqual([`Duke of Quill | ${TITLES_UI.count(3)} · ${WIN_LIST_UI.newest('Bran')}`]);
		const only = openWin(['titles:', '  - id: reeve', '    name: Reeve', ''].join('\n'));
		expect(rowTexts(only.content)).toEqual([`Reeve | ${TITLES_UI.count(0)}`]);
	});

	it('names the newest holder by the ruler text, as the holder row does', () => {
		const o = openWin(SOB.replace('{person: bran, from: 1200}', '{person: aldric, number: III, as: Aldric}'));
		expect(rowTexts(o.content)[0]).toBe(`Duke of Quill | ${TITLES_UI.count(3)} · ${WIN_LIST_UI.newest('Aldric III')}`);
	});

	it('tags a new title as New, a changed title as Changed and a refused ID as Check the ID', async () => {
		const o = openWin();
		await click(o.content.querySelector('button[data-focus="add"]'));
		backToList(o.content);
		const king = keyOf(o, 'king-of-the-vale');
		openPage(o.content, 'king-of-the-vale');
		typeIn(pageOf(o.content), 'dynasty-title-plural', 'Kings of the Wide Vale');
		backToList(o.content);
		const tag = (id: string) => rowOf(o.content, id).querySelector('.dynasty-lw-state')?.getText() ?? '';
		expect(tag('king-of-the-vale')).toBe(WIN_LIST_UI.stateChanged);
		expect(tag('duke-of-valmont')).toBe('');
		const fresh = listRows(o.content).find((r) => r.getAttribute('data-title') !== null && !G13.titles.some((t) => t.id === r.getAttribute('data-title')))!;
		expect(fresh.querySelector('.dynasty-lw-state')!.getText()).toBe(WIN_LIST_UI.stateNew);
		rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.idDraft = 'count-of-orsini';
		(o.win as unknown as { build(): void }).build();
		expect(tag('duke-of-valmont')).toBe(WIN_LIST_UI.stateCheckId);
		expect(king).toBeTruthy();
	});

	it('shows the empty-tree text for a tree with no titles', () => {
		const o = openWin('people:\n  - {id: a, name: Aldo}\n');
		expect(o.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(TITLES_UI.none);
	});

	it('returns null with a Notice when the tree text has an error', () => {
		const handle = writingHandle('titles: [\n');
		expect(TitlesWindow.create({} as never, { handle: handle as never, sourcePath: 'n.md' })).toBeNull();
		expect(notices).toContain(TITLES_UI.cannotOpen);
	});
});

// ---------- the search ----------

describe('the search of the list (D.3.3)', () => {
	it('finds a title by the name of a holder and says why in a "Holder" line', () => {
		const o = openWin();
		searchFor(o.content, 'cosimo');
		expect(rowNames(o.content)).toEqual(['Count of Orsini']);
		expect(rowTexts(o.content)[0]).toContain(WIN_LIST_UI.holder('Cosimo Orsini'));
		expect(o.content.querySelector('.dynasty-lw-count')!.getText()).toBe(WIN_LIST_UI.matchTitles(1, G13.titles.length));
	});

	it('finds a title by a holder from the tree: the ruler text or the full name', () => {
		const o = openWin();
		searchFor(o.content, 'aldric ii');
		expect(rowNames(o.content)).toContain('Duke of Valmont');
		const row = rowTexts(o.content).find((t) => t.startsWith('Duke of Valmont'))!;
		expect(row).toContain('Holder: Aldric Valmont');
	});

	it('finds a title by the name of its holder who has a sobriquet, and by the sobriquet', () => {
		const o = openWin(SOB);
		searchFor(o.content, 'bold');
		expect(rowNames(o.content)).toEqual(['Duke of Quill']);
		expect(rowTexts(o.content)[0]).toContain(WIN_LIST_UI.holder('Ser Aldric Valmont'));
	});

	it('gives no reason line when the name matches, and an ID line when only the ID matches', () => {
		const o = openWin();
		searchFor(o.content, 'duke');
		expect(rowTexts(o.content)[0]).not.toContain('Holder:');
		searchFor(o.content, 'duke-of-val');
		expect(rowTexts(o.content)[0]).toContain(WIN_LIST_UI.id('duke-of-valmont'));
	});

	it('matches the draft: a new name, a plural and a male name are found', () => {
		const o = openWin();
		openPage(o.content, 'duke-of-valmont');
		typeIn(pageOf(o.content), 'dynasty-title-male', 'Grand Margrave of Quill');
		backToList(o.content);
		searchFor(o.content, 'quill');
		expect(rowNames(o.content)).toEqual(['Duke of Valmont']);
	});

	it('shows the no-result text with the query in curly marks and no list row', () => {
		const o = openWin();
		searchFor(o.content, 'zzz');
		expect(listRows(o.content)).toHaveLength(0);
		expect(o.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(WIN_LIST_UI.noResultTitles('zzz'));
	});

	it('keeps the query when a page opens and when Back returns', () => {
		const o = openWin();
		searchFor(o.content, 'cosimo');
		openPage(o.content, 'count-of-orsini');
		backToList(o.content);
		expect(o.content.querySelector('input.dynasty-lw-search')!.value).toBe('cosimo');
		expect(rowNames(o.content)).toEqual(['Count of Orsini']);
		expect(active()).toBe('row:' + keyOf(o, 'count-of-orsini'));
	});
});

// ---------- the edit page ----------

describe('the edit page of a title (D.3.5, D.3.7)', () => {
	it('has the four fields, the holder panel, the Succession section (0.2.7) and Other actions, in this order', () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		expect(page.getAttribute('data-title')).toBe('duke-of-valmont');
		expect(page.children.map((c) => (c.hasClass('dynasty-sheet-field') ? [...c.classes].find((x) => /^dynasty-title-/.test(x))! : [...c.classes].find((x) => /^dynasty-(holder-panel|succ|lw-actions)$/.test(x))!))).toEqual([
			'dynasty-title-name',
			'dynasty-title-male',
			'dynasty-title-female',
			'dynasty-title-plural',
			'dynasty-holder-panel',
			'dynasty-succ',
			'dynasty-lw-actions',
		]);
		expect(page.children[page.children.length - 1]!.hasClass('dynasty-lw-actions')).toBe(true);
	});

	it('gives each field its text, placeholder, accessible name and focus name', () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		const key = keyOf(o, 'duke-of-valmont');
		const name = field(page, 'dynasty-title-name');
		expect(name.value).toBe('Duke of Valmont');
		expect(name.getAttribute('aria-label')).toBe(TITLES_UI.nameLabel);
		expect(name.getAttribute('data-focus')).toBe(`name:${key}`);
		expect(page.querySelector('.dynasty-title-name .dynasty-sheet-label')!.getText()).toBe(TITLES_UI.nameLabel);
		const plural = field(page, 'dynasty-title-plural');
		expect(plural.value).toBe('Dukes of Valmont');
		expect(plural.getAttribute('placeholder')).toBe(TITLES_UI.pluralPlaceholder);
		expect(plural.getAttribute('aria-label')).toBe(TITLES_UI.pluralAria('Duke of Valmont'));
		expect(plural.getAttribute('data-focus')).toBe(`plural:${key}`);
		expect(field(page, 'dynasty-title-male').getAttribute('data-focus')).toBe(`male-name:${key}`);
		expect(field(page, 'dynasty-title-female').getAttribute('data-focus')).toBe(`female-name:${key}`);
		expect(page.querySelector('.dynasty-title-male')!.getAttribute('data-field')).toBe('male-name');
		expect(page.querySelector('.dynasty-title-plural')!.getAttribute('data-field')).toBe('plural');
		for (const c of ['dynasty-title-name', 'dynasty-title-male', 'dynasty-title-female', 'dynasty-title-plural']) expect(field(page, c).tag).toBe('textarea');
	});

	it('shows the holders always: no Show holders button; the heading follows the name of the list', () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		expect(page.querySelector('.dynasty-title-toggle')).toBeNull();
		expect(page.querySelectorAll('.dynasty-holder-row')).toHaveLength(7);
		const heading = page.querySelector('.dynasty-holder-heading')!;
		expect(heading.getText()).toBe('Dukes of Valmont');
		typeIn(page, 'dynasty-title-plural', 'Grand Dukes of Valmont');
		expect(heading.getText()).toBe('Grand Dukes of Valmont');
		typeIn(page, 'dynasty-title-plural', '');
		expect(heading.getText()).toBe('Duke of Valmont');
		expect(page.querySelector('.dynasty-holder-panel .dynasty-sheet-hint')!.getText()).toBe(TITLES_UI.intro);
		expect(page.querySelector('.dynasty-holder-count')!.getText()).toBe(TITLES_UI.count(7));
	});

	it('puts Other actions last: Change ID before Delete, and the label above them', () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		const section = page.children[page.children.length - 1]!;
		expect(section.querySelector('.dynasty-sheet-label')!.getText()).toBe(WIN_LIST_UI.otherActions);
		const row = section.querySelector('.dynasty-lw-actions-row')!;
		expect(row.children.map((b) => (b.hasClass('dynasty-id-open') ? 'id' : b.hasClass('dynasty-title-delete') ? 'delete' : '?'))).toEqual(['id', 'delete']);
		expect(row.children[0]!.getAttribute('aria-label')).toBe(ID_UI.openAria('Duke of Valmont'));
		expect(row.children[1]!.getAttribute('aria-label')).toBe(TITLES_UI.deleteLabel('Duke of Valmont'));
		expect(row.children[1]!.hasClass('mod-warning')).toBe(true);
	});

	it('gives a new title no Change ID button, and its name changes the Delete name', async () => {
		const o = openWin();
		await click(o.content.querySelector('button[data-focus="add"]'));
		const page = pageOf(o.content);
		expect(page.querySelector('.dynasty-id-open')).toBeNull();
		typeIn(page, 'dynasty-title-name', 'Warden of the Reach');
		expect(page.querySelector('.dynasty-title-delete')!.getAttribute('aria-label')).toBe(TITLES_UI.deleteLabel('Warden of the Reach'));
		expect(o.content.querySelector('.dynasty-lw-back-name')!.getText()).toBe('Warden of the Reach');
	});

	it('shows the note "New ID" with Keep old ID when the draft ID changed, and the red edge on the page when it is refused', () => {
		const o = openWin();
		const duke = rowsOf(o).find((t) => t.id === 'duke-of-valmont')!;
		duke.idDraft = 'dukes-of-valmont';
		const page = openPage(o.content, 'duke-of-valmont');
		expect(page.querySelector('.dynasty-id-new-text')!.getText()).toBe(ID_UI.newId('dukes-of-valmont'));
		expect(page.hasClass('has-id-problem')).toBe(false);
		duke.idDraft = 'count-of-orsini';
		backToList(o.content);
		const again = openPage(o.content, 'duke-of-valmont');
		expect(again.hasClass('has-id-problem')).toBe(true);
	});

	it('opens a page with the focus on Back, and Add with the focus in the new name field', async () => {
		const o = openWin();
		openPage(o.content, 'duke-of-valmont');
		expect(active()).toBe('back');
		backToList(o.content);
		await click(o.content.querySelector('button[data-focus="add"]'));
		expect(active()).toMatch(/^name:/);
	});
});

describe('the holder rows of the page (D.3.9 c, D130 item 8)', () => {
	it('puts the ruler text and the sobriquet in ONE inline label, so the space before the sobriquet stays', () => {
		const o = openWin(SOB);
		const page = openPage(o.content, 'duke');
		const button = page.querySelectorAll('button.dynasty-holder-name')[0]!;
		expect(button.getText()).toBe('Aldric II “the Bold”');
		const labels = button.querySelectorAll(':scope > .dynasty-holder-label');
		expect(labels).toHaveLength(1);
		expect(button.querySelectorAll(':scope > .dynasty-picker-sob')).toHaveLength(0);
		const label = labels[0]!;
		expect(label.tag).toBe('span');
		expect(label.text).toBe('Aldric II');
		const sob = label.querySelector(':scope > .dynasty-picker-sob')!;
		expect(sob.getText()).toBe(' “the Bold”');
		expect(sob.getText().startsWith(' ')).toBe(true);
	});

	it('keeps the accessible name of the button without the sobriquet, and the label on a holder with no sobriquet', () => {
		const o = openWin(SOB);
		const page = openPage(o.content, 'duke');
		const [first, second] = page.querySelectorAll('button.dynasty-holder-name');
		expect(first!.getAttribute('aria-label')).toBe(TITLES_UI.showCardLabel('Aldric II'));
		expect(second!.getText()).toBe('Bran');
		expect(second!.querySelector('.dynasty-picker-sob')).toBeNull();
		// A holder who is not in the tree is plain text, with no button.
		expect(page.querySelectorAll('div.dynasty-holder-name').map((d) => d.getText())).toEqual(['Orso the Old I']);
	});

	it('has CSS rules for the label that never make it a flex or grid box', () => {
		const rules = [...css.matchAll(/(^|\n)([^{}\n]*\.dynasty-holder-label[^{]*)\{([^}]*)\}/g)];
		expect(rules.length).toBeGreaterThan(0);
		expect(rules.length).toBeLessThanOrEqual(2);
		for (const r of rules) expect(r[3]).not.toMatch(/display\s*:\s*(inline-)?(flex|grid)/);
		expect(rules.some((r) => /overflow-wrap\s*:\s*anywhere/.test(r[3]!))).toBe(true);
		// The rules sit in the holder block, not between the list-window markers.
		const start = css.indexOf('/* ===== list windows (0.2.5, D134) =====');
		const end = css.indexOf('/* ===== end list windows =====');
		expect(start).toBeGreaterThan(0);
		const inside = css.slice(start, end);
		expect(inside).not.toContain('.dynasty-holder-label');
	});
});

// ---------- the draft: Save, Cancel, close ----------

describe('Save writes the whole draft in ONE batch (D.3.8, spec §13.0 item 6)', () => {
	it('two edited titles, a moved holder, a new title and a deleted title make one write and one Undo step', async () => {
		const o = openWin();
		let page = openPage(o.content, 'duke-of-valmont');
		typeIn(page, 'dynasty-title-plural', 'Grand Dukes of Valmont');
		backToList(o.content);
		page = openPage(o.content, 'king-of-the-vale');
		typeIn(page, 'dynasty-title-male', 'High King of the Vale');
		const holders = page.querySelectorAll('.dynasty-holder-row');
		await click(holders[0]!.querySelector('.dynasty-holder-later'));
		backToList(o.content);
		await click(o.content.querySelector('button[data-focus="add"]'));
		typeIn(pageOf(o.content), 'dynasty-title-name', 'Margrave of the Reach');
		backToList(o.content);
		openPage(o.content, 'warden-of-the-marches');
		await click(pageOf(o.content).querySelector('.dynasty-title-delete'));
		await click(question(o)!.querySelector('.dynasty-confirm-delete-title'));
		expect(listRows(o.content).some((r) => r.getAttribute('data-title') === 'warden-of-the-marches')).toBe(false);
		expect(o.handle.ops).toHaveLength(0);
		await save(o);
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.ops[0]!.kind).toBe('batch');
		const after = o.handle.body;
		expect(after).toContain('plural: Grand Dukes of Valmont');
		expect(after).toContain('male-name: High King of the Vale');
		expect(after).toContain('name: Margrave of the Reach');
		expect(after).not.toContain('warden-of-the-marches');
		expect(isOpen(o.win)).toBe(false);
		await o.handle.undo();
		expect(o.handle.body).toBe(BODY_13);
	});

	it('changes only the lines of the edited titles in the note text', async () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		typeIn(page, 'dynasty-title-plural', 'Grand Dukes of Valmont');
		await save(o);
		const before = bodyLines(BODY_13);
		const after = bodyLines(o.handle.body);
		expect(after).toHaveLength(before.length);
		const changed = after.map((l, i) => (l === before[i] ? null : l)).filter((l) => l !== null);
		expect(changed).toEqual(['    plural: Grand Dukes of Valmont']);
	});

	it('writes nothing for Cancel, and closes at once', async () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		typeIn(page, 'dynasty-title-name', 'Grand Duke of Valmont');
		await click(o.content.querySelector('button[data-focus="cancel"]'));
		expect(o.handle.ops).toHaveLength(0);
		expect(isOpen(o.win)).toBe(false);
		expect(question(o)).toBeNull();
	});

	it('closes at once on Save when nothing changed', async () => {
		const o = openWin();
		await save(o);
		expect(o.handle.ops).toHaveLength(0);
		expect(isOpen(o.win)).toBe(false);
	});

	it('Esc goes: question, then page, then the discard question, then the window', async () => {
		const o = openWin();
		openPage(o.content, 'duke-of-valmont');
		typeIn(pageOf(o.content), 'dynasty-title-plural', 'Grand Dukes of Valmont');
		const w = o.win as unknown as { close(): void };
		w.close();
		expect(backButton(o.content)).toBeNull();
		expect(question(o)).toBeNull();
		w.close();
		expect(question(o)!.getText()).toContain(TITLES_UI.discardText);
		w.close();
		expect(question(o)).toBeNull();
		expect(isOpen(o.win)).toBe(true);
		w.close();
		expect(question(o)).not.toBeNull();
		await click(question(o)!.querySelector('.dynasty-sheet-discard'));
		expect(isOpen(o.win)).toBe(false);
		expect(o.handle.ops).toHaveLength(0);
		expect(o.closed.n).toBe(1);
	});

	it('refuses an empty name: the page of that title opens, the error shows and the focus is in its name field', async () => {
		const o = openWin();
		await click(o.content.querySelector('button[data-focus="add"]'));
		backToList(o.content);
		openPage(o.content, 'duke-of-valmont');
		typeIn(pageOf(o.content), 'dynasty-title-plural', 'Grand Dukes of Valmont');
		backToList(o.content);
		await save(o);
		expect(o.handle.ops).toHaveLength(0);
		expect(backButton(o.content)).not.toBeNull();
		expect(o.content.querySelector('.dynasty-sheet-error')!.getText()).toBe(TITLES_UI.needName);
		expect(active()).toMatch(/^name:/);
		expect(field(pageOf(o.content), 'dynasty-title-name').value).toBe('');
		expect(o.content.querySelector('.dynasty-sheet-error')!.hidden).toBe(false);
	});

	it('refuses a taken ID: the page of the bad title opens, shows the reason once and the focus is on Change ID', async () => {
		const o = openWin();
		rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.idDraft = 'count-of-orsini';
		await save(o);
		expect(o.handle.ops).toHaveLength(0);
		const page = pageOf(o.content);
		expect(page.getAttribute('data-title')).toBe('duke-of-valmont');
		expect(active()).toBe(`id-open:${keyOf(o, 'duke-of-valmont')}`);
		expect(page.hasClass('has-id-problem')).toBe(true);
		expect(page.querySelector('.dynasty-id-new-problem')!.getText()).not.toBe('');
		expect(o.content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
	});

	it('asks "Change the ID?" before it writes, and Keep old writes nothing', async () => {
		const o = openWin();
		rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.idDraft = 'dukes-of-valmont';
		await save(o);
		const ask = question(o)!;
		expect(ask.getText()).toContain(ID_UI.confirmTitle(1));
		expect(o.handle.ops).toHaveLength(0);
		await click(ask.querySelector('.dynasty-id-keep'));
		expect(question(o)).toBeNull();
		expect(o.handle.ops).toHaveLength(0);
		expect(isOpen(o.win)).toBe(true);
		await save(o);
		await click(question(o)!.querySelector('.dynasty-id-change'));
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.body).toContain('id: dukes-of-valmont');
		expect(notices.some((n) => n.startsWith(ID_UI.changed(1)))).toBe(true);
		await o.handle.undo();
		expect(o.handle.body).toBe(BODY_13);
	});

	it('keeps the draft and the page when the note changed under the window, and the next Save writes both', async () => {
		const o = openWin();
		const page = openPage(o.content, 'king-of-the-vale');
		typeIn(page, 'dynasty-title-male', 'High King of the Vale');
		o.handle.change(BODY_13.replace('plural: Dukes of Valmont', 'plural: Dukes of the Keep'));
		await save(o);
		expect(o.handle.ops).toHaveLength(0);
		expect(notices).toContain(WRITE_TEXT.stale);
		expect(pageOf(o.content).getAttribute('data-title')).toBe('king-of-the-vale');
		expect(field(pageOf(o.content), 'dynasty-title-male').value).toBe('High King of the Vale');
		expect(o.content.querySelector('.dynasty-sheet-error')!.getText()).toBe(TITLES_UI.stale);
		await save(o);
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.body).toContain('male-name: High King of the Vale');
		expect(o.handle.body).toContain('plural: Dukes of the Keep');
	});

	it('shows the list after a stale reload that removed the title of the open page', async () => {
		const o = openWin();
		const page = openPage(o.content, 'warden-of-the-marches');
		typeIn(page, 'dynasty-title-name', 'Warden of the Far Marches');
		const gone = BODY_13.replace(/  - id: warden-of-the-marches[\s\S]*?(?=  - Baron of Greyfen)/, '');
		expect(gone).not.toBe(BODY_13);
		o.handle.change(gone);
		await save(o);
		expect(notices).toContain(WRITE_TEXT.stale);
		expect(isOpen(o.win)).toBe(true);
		expect(backButton(o.content)).toBeNull();
	});

	it('closes with a question when the draft changed, from the cross button path (finish is not called first)', () => {
		const o = openWin();
		openPage(o.content, 'duke-of-valmont');
		typeIn(pageOf(o.content), 'dynasty-title-name', 'X');
		backToList(o.content);
		(o.win as unknown as { close(): void }).close();
		expect(question(o)!.querySelector('.dynasty-sheet-discard')).not.toBeNull();
		expect(isOpen(o.win)).toBe(true);
	});
});

describe('Change ID: the small ID window opens from the page (D.3.7, §13.17 rule 5)', () => {
	const topModal = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;

	it('"Use this ID" draws the note on the page and puts the focus back on Change ID; Keep old ID removes the note', async () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		await click(page.querySelector('.dynasty-id-open'));
		const small = topModal();
		expect(small.hasClass('dynasty-id-window')).toBe(true);
		type(small.querySelector('.dynasty-id-input')!, 'dukes-of-valmont');
		await click(small.querySelector('.dynasty-id-use'));
		const again = pageOf(o.content);
		expect(again.querySelector('.dynasty-id-new-text')!.getText()).toBe(ID_UI.newId('dukes-of-valmont'));
		expect(active()).toBe(`id-open:${keyOf(o, 'duke-of-valmont')}`);
		expect(o.content.querySelector('.dynasty-lw-row')).toBeNull();
		await click(again.querySelector('.dynasty-id-old'));
		expect(pageOf(o.content).querySelector('.dynasty-id-new')).toBeNull();
	});

	it('opens one small window only, also when the button is tapped again', async () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		const button = page.querySelector('.dynasty-id-open')!;
		dispatch(button, 'click', { detail: 1 });
		dispatch(button, 'click', { detail: 1 });
		expect(openModals.filter((m) => (m as unknown as { modalEl: FEl }).modalEl.hasClass('dynasty-id-window'))).toHaveLength(1);
	});

	it('shows the text of a refused id op in the error line and a Notice, never the stale text', async () => {
		const o = openWin();
		o.handle.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'id-taken' } })) as never);
		rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.idDraft = 'dukes-of-valmont';
		await save(o);
		await click(question(o)!.querySelector('.dynasty-id-change'));
		expect(notices[notices.length - 1]).toBe(ID_UI.inUse);
		expect(notices).not.toContain(WRITE_TEXT.stale);
		expect(o.content.querySelector('.dynasty-sheet-error')!.getText()).toBe(ID_UI.inUse);
		expect(isOpen(o.win)).toBe(true);
	});

	it('asks first when the only change is a pending ID', () => {
		const o = openWin();
		rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.idDraft = 'dukes-of-valmont';
		(o.win as unknown as { close(): void }).close();
		expect(question(o)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(isOpen(o.win)).toBe(true);
	});
});

describe('Delete (D.3.7)', () => {
	it('removes a new title at once with no question; the focus goes to the neighbour row, else Add', async () => {
		const o = openWin();
		await click(o.content.querySelector('button[data-focus="add"]'));
		await click(pageOf(o.content).querySelector('.dynasty-title-delete'));
		expect(question(o)).toBeNull();
		expect(backButton(o.content)).toBeNull();
		expect(rowNames(o.content)).toEqual(G13.titles.map((t) => t.name));
		expect(active()).toBe('row:' + keyOf(o, G13.titles[G13.titles.length - 1]!.id));
	});

	it('asks for a saved title with the holders and the cards, and Cancel keeps the title', async () => {
		const o = openWin();
		openPage(o.content, 'king-of-the-vale');
		await click(pageOf(o.content).querySelector('.dynasty-title-delete'));
		const ask = question(o)!.getText();
		expect(ask).toContain(TITLES_UI.deleteTitle('King of the Vale'));
		expect(ask).toContain(TITLES_UI.deleteHolders(4));
		expect(ask).toContain(TITLES_UI.deleteCards(2));
		await click(question(o)!.querySelector('.dynasty-sheet-keep'));
		expect(question(o)).toBeNull();
		expect(pageOf(o.content).getAttribute('data-title')).toBe('king-of-the-vale');
		expect(active()).toBe(`delete:${keyOf(o, 'king-of-the-vale')}`);
	});

	it('shows the list after the title is deleted and writes it with Save, with an Undo notice', async () => {
		const o = openWin();
		openPage(o.content, 'king-of-the-vale');
		await click(pageOf(o.content).querySelector('.dynasty-title-delete'));
		await click(question(o)!.querySelector('.dynasty-confirm-delete-title'));
		expect(backButton(o.content)).toBeNull();
		expect(rowNames(o.content)).not.toContain('King of the Vale');
		await save(o);
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.body).not.toContain('card-title: king-of-the-vale');
		expect(notices.some((n) => n.startsWith(TITLES_UI.deleted(['King of the Vale'])))).toBe(true);
	});
});

describe('the holder buttons on the page (copied behaviour, D.3.5)', () => {
	it('Move later, Remove and the focus stay on the page; Save writes one batch', async () => {
		const o = openWin();
		const page = openPage(o.content, 'king-of-the-vale');
		const rows = page.querySelectorAll('.dynasty-holder-row');
		expect(rows[0]!.querySelector('.dynasty-holder-earlier')!.disabled).toBe(true);
		expect(rows[2]!.querySelector('.dynasty-holder-later')!.disabled).toBe(true);
		await click(rows[0]!.querySelector('.dynasty-holder-later'));
		expect(pageOf(o.content).querySelectorAll('.dynasty-holder-name').map((n) => n.getText())).toContain('Aldric III');
		expect(backButton(o.content)).not.toBeNull();
		const first = pageOf(o.content).querySelectorAll('.dynasty-holder-row')[0]!;
		await click(first.querySelector('.dynasty-holder-remove'));
		expect(pageOf(o.content).querySelectorAll('.dynasty-holder-row')).toHaveLength(2);
		await save(o);
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.ops[0]!.kind).toBe('batch');
	});

	it('Edit opens the holder form over the window; its Save changes the draft only', async () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		await click(page.querySelectorAll('.dynasty-holder-edit')[2]!);
		const form = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
		expect(form.modalEl.hasClass('dynasty-holder-form')).toBe(true);
		const number = form.contentEl.querySelector('[data-field="number"] input')!;
		type(number, 'I');
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		expect(o.handle.ops).toHaveLength(0);
		expect(pageOf(o.content).querySelectorAll('.dynasty-holder-name')[2]!.getText()).toBe('Roderick I');
		const holderKey = (o.win as unknown as { rows: { id: string | null; holders: { key: string }[] }[] }).rows.find((t) => t.id === 'duke-of-valmont')!.holders[2]!.key;
		expect(active()).toBe(`edit:${holderKey}`);
		await save(o);
		expect(o.handle.body).toContain('{person: roderick, number: I, from: 1150, to: 1158}');
	});

	it('shows the card of a holder: the window closes and the tree gets the person; with changes it asks first', async () => {
		const o = openWin();
		const page = openPage(o.content, 'king-of-the-vale');
		await click(page.querySelectorAll('button.dynasty-holder-name')[0]!);
		expect(o.shown).toEqual(['young-aldric']);
		expect(isOpen(o.win)).toBe(false);

		const d = openWin();
		openPage(d.content, 'king-of-the-vale');
		typeIn(pageOf(d.content), 'dynasty-title-plural', 'Kings');
		await click(pageOf(d.content).querySelectorAll('button.dynasty-holder-name')[0]!);
		expect(d.shown).toEqual([]);
		expect(question(d)!.getText()).toContain(TITLES_UI.discardText);
		await click(question(d)!.querySelector('.dynasty-sheet-keep'));
		expect(d.shown).toEqual([]);
		expect(isOpen(d.win)).toBe(true);
		await click(pageOf(d.content).querySelectorAll('button.dynasty-holder-name')[0]!);
		await click(question(d)!.querySelector('.dynasty-sheet-discard'));
		expect(d.shown).toEqual(['young-aldric']);
		expect(isOpen(d.win)).toBe(false);
		expect(d.handle.ops).toHaveLength(0);
	});
});

describe('Make a note with this table (D55)', () => {
	function withVault(o: Opened) {
		const create = vi.fn(async () => ({}));
		(o.host.app.vault as unknown as Record<string, unknown>).create = create;
		(o.host.app as unknown as Record<string, unknown>).fileManager = { getNewFileParent: () => ({ isRoot: () => true, path: '/', children: [] }) };
		return create;
	}

	it('is on the page of a saved title only, and makes the note at once when the draft is clean', async () => {
		const o = openWin();
		const create = withVault(o);
		const page = openPage(o.content, 'duke-of-valmont');
		await click(page.querySelector('.dynasty-title-note'));
		expect(question(o)).toBeNull();
		expect(create).toHaveBeenCalledWith('Dukes of Valmont.md', holderTable(G13, G13.titles[0]!));
		expect(o.handle.ops).toHaveLength(0);
		backToList(o.content);
		await click(o.content.querySelector('button[data-focus="add"]'));
		expect(pageOf(o.content).querySelector('.dynasty-title-note')).toBeNull();
	});

	it('asks first when the draft has changes, and the note has the saved list', async () => {
		const o = openWin();
		const create = withVault(o);
		const page = openPage(o.content, 'duke-of-valmont');
		await click(page.querySelectorAll('.dynasty-holder-remove')[0]!);
		await click(pageOf(o.content).querySelector('.dynasty-title-note'));
		expect(create).not.toHaveBeenCalled();
		expect(question(o)!.getText()).toContain(TITLES_UI.noteText);
		await click(question(o)!.querySelector('.dynasty-confirm-note'));
		expect(create).toHaveBeenCalledWith('Dukes of Valmont.md', holderTable(G13, G13.titles[0]!));
		expect(isOpen(o.win)).toBe(true);
	});
});

describe('long names (D.3.9 b) and the fields of the page', () => {
	const LONG = 'Hereditary Keeper of the Salt Roads and Warden of the Southern Shore';

	it('keeps the whole long name after Back and in the written note', async () => {
		const o = openWin();
		const page = openPage(o.content, 'warden-of-the-marches');
		expect(LONG).toHaveLength(68);
		typeIn(page, 'dynasty-title-name', LONG);
		backToList(o.content);
		expect(rowNames(o.content)).toContain(LONG);
		openPage(o.content, rowsOf(o).find((t) => t.name === LONG)!.id!);
		expect(field(pageOf(o.content), 'dynasty-title-name').value).toBe(LONG);
		await save(o);
		expect(o.handle.body).toContain(`name: ${LONG}`);
	});

	it('takes no line break: Enter is prevented, and a pasted break becomes a space', () => {
		const o = openWin();
		const page = openPage(o.content, 'duke-of-valmont');
		const name = field(page, 'dynasty-title-name');
		expect(press(name, 'Enter').defaultPrevented).toBe(true);
		type(name, 'Duke of\nValmont');
		expect(name.value).toBe('Duke of Valmont');
		expect(rowsOf(o).find((t) => t.id === 'duke-of-valmont')!.name).toBe('Duke of Valmont');
	});
});

describe('the keyboard reveal (D.7 item 7)', () => {
	const scrolls = () => vi.spyOn(FEl.prototype, 'scrollIntoView');
	/** The argument of the first call of a spy on a method that the fake declares with no parameter. */
	const firstArg = (spy: { mock: { calls: unknown[][] } }): unknown => spy.mock.calls[0]![0];

	it('scrolls a focused field into view once, 300 ms later', () => {
		const o = openWin();
		openPage(o.content, 'duke-of-valmont');
		const spy = scrolls();
		spy.mockClear();
		const input = field(pageOf(o.content), 'dynasty-title-name');
		input.focus();
		dispatch(input, 'focusin');
		runTimers(299);
		expect(spy).not.toHaveBeenCalled();
		runTimers(2);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'auto' });
	});

	it('asks the option `reduced` when the scroll runs: the scroll then jumps at once', () => {
		let reduced = false;
		const o = openWin(BODY_13, { reduced: () => reduced });
		openPage(o.content, 'duke-of-valmont');
		const spy = scrolls();
		spy.mockClear();
		reduced = true;
		const input = field(pageOf(o.content), 'dynasty-title-name');
		input.focus();
		dispatch(input, 'focusin');
		runTimers(400);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'instant' });
	});
});

describe('the window ends cleanly (spec §8)', () => {
	it('hands the focus back (onClosed) once, and a throw in the page never reaches the caller', () => {
		const o = openWin();
		(o.win as unknown as { renderPage(): void }).renderPage = () => {
			throw new Error('page failed');
		};
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(() => openPage(o.content, 'duke-of-valmont')).not.toThrow();
		expect(err).toHaveBeenCalled();
		(o.win as unknown as { finish(): void }).finish();
		expect(o.closed.n).toBe(1);
	});

	it('has a Save and a Cancel button with the standard texts', () => {
		const o = openWin();
		expect(o.content.querySelector('button[data-focus="save"]')!.getText()).toBe(SHEET.save);
		expect(o.content.querySelector('button[data-focus="cancel"]')!.getText()).toBe(SHEET.cancel);
	});
});
