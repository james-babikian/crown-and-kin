import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { ListEditWindow, type ListKind, type ListRowView, type PageHead } from '../src/obsidian/list-window';
import { matchesAll } from '../src/obsidian/list-search';
import type { Op } from '../src/core/edit';
import { HOUSES, ID_UI, REMOVE, SHEET, TITLES_UI, WIN_LIST_UI, WINDOW_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, dispatch, dispatchWindow, fakeDoc, fakeWin, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { backButton, backToList, listRows, openPage, pageOf, press, rowNames, rowOf, rowTexts, searchBox, searchFor } from './lw-support';

/*
 * The shell of the Titles window and the Houses window as a list with an edit page (the 0.2.5 contract D.3.1 to
 * D.3.11, D134, D138). A small test window on the fake DOM stands in for the two real windows: it has three
 * titles, a text field and "Other actions" on its page, and records what the shell asks of it.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

interface Item {
	key: string;
	id: string | null;
	name: string;
	holders: string[];
	state?: ListRowView['state'];
	deleted?: boolean;
}

const items = (): Item[] => [
	{ key: 't0', id: 'duke-of-valmont', name: 'Duke of Valmont', holders: ['Roderick Valmont', 'Aldric the Bold'] },
	{ key: 't1', id: 'count-of-espana', name: 'Count of d’España', holders: ['Isolde Orsini'] },
	{ key: 't2', id: 'warden-of-the-marches', name: 'Warden of the Marches', holders: [] },
];

/** The smallest real subclass: the draft is a list of items; the page has one text field and Other actions. */
class TestWindow extends ListEditWindow {
	dirty = false;
	log: string[] = [];
	typed: string[] = [];
	reducedMotion = false;
	/** A throw in the page, to prove that a failed step never escapes. */
	failPage = false;
	private next = 3;

	constructor(
		public list: Item[] = items(),
		kind: ListKind = 'titles',
	) {
		super({} as never, kind, kind === 'titles' ? 'dynasty-titles' : 'dynasty-houses');
	}

	protected rowViews(): ListRowView[] {
		return this.list
			.filter((i) => !i.deleted)
			.map((i) => ({ key: i.key, id: i.id, name: this.labelOf(i.key), summary: `${i.holders.length} holders`, state: i.state ?? (i.id === null ? 'new' : '') }));
	}
	protected matchReason(key: string, words: readonly string[]): string | null {
		const i = this.item(key);
		if (matchesAll(words, [i.name, i.id ?? ''])) return '';
		const who = i.holders.find((h) => matchesAll(words, [h]));
		if (who) return WIN_LIST_UI.holder(who);
		return matchesAll(words, [i.name, ...i.holders]) ? '' : null;
	}
	protected labelOf(key: string): string {
		return this.item(key).name.trim() || TITLES_UI.newTitle;
	}
	protected isSaved(key: string): boolean {
		return this.item(key).id !== null;
	}
	protected pageHead(key: string): PageHead {
		return { lead: () => undefined, name: this.labelOf(key), meta: '' };
	}
	protected renderPage(page: HTMLElement, key: string): void {
		if (this.failPage) throw new Error('page failed');
		const it = this.item(key);
		this.drawSections(page, 'test', [
			{
				key: 'details',
				title: 'Details',
				summary: '',
				open: true,
				build: (body) =>
					this.textField(body, {
						cls: 'dynasty-title-name',
						label: TITLES_UI.nameLabel,
						value: it.name,
						aria: TITLES_UI.nameLabel,
						focus: `name:${key}`,
						onInput: (v) => {
							it.name = v;
							this.dirty = true;
							this.typed.push(v);
							this.updateBackName(key);
						},
					}),
			},
			this.otherActionsSection(key, 'dynasty-title-delete', (n) => TITLES_UI.deleteLabel(n)),
		]);
	}
	protected addItem(): string {
		const key = `t${this.next++}`;
		this.list.push({ key, id: null, name: '', holders: [] });
		return key;
	}
	protected askDelete(key: string): void {
		const it = this.item(key);
		if (it.id === null) {
			it.deleted = true;
			this.afterDelete(key);
			return;
		}
		this.showConfirm('Delete?', ['Sure?'], `delete:${key}`, [
			{ label: 'Keep', cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{
				label: 'Delete it',
				cls: 'mod-warning dynasty-test-delete',
				run: () => {
					it.deleted = true;
					this.afterDelete(key);
				},
			},
		]);
	}
	protected changeId(key: string): void {
		this.log.push(`id:${key}`);
	}
	protected isDirty(): boolean {
		return this.dirty;
	}
	protected async save(): Promise<void> {
		this.log.push('save');
		this.finish();
	}
	protected discardText(): string {
		return TITLES_UI.discardText;
	}
	protected released(): void {
		this.log.push('released');
	}
	protected override reduced(): boolean {
		return this.reducedMotion;
	}
	protected override dropWaiting(): void {
		this.log.push('dropWaiting');
	}

	item(key: string): Item {
		const i = this.list.find((x) => x.key === key);
		if (!i) throw new Error(`no item ${key}`);
		return i;
	}
	// Public doors to what a real window calls.
	get content(): FEl {
		return this.contentEl as unknown as FEl;
	}
	get modal(): FEl {
		return this.modalEl as unknown as FEl;
	}
	get pageKey(): string | null {
		return this.page;
	}
	get queryText(): string {
		return this.query;
	}
	get confirm(): FEl | null {
		return this.confirmEl as unknown as FEl | null;
	}
	get isClosing(): boolean {
		return this.closing;
	}
	doBuild(focus?: string | null): void {
		this.build(focus);
	}
	doOpenPage(key: string, focus?: string): void {
		this.openPage(key, focus);
	}
	doError(text: string): void {
		this.showError(text);
	}
	doRefused(text: string): void {
		this.refused(text);
	}
	doClear(): void {
		this.clearError();
	}
	doConfirm(from: string | null = null): void {
		this.showConfirm('Title?', ['One.', 'Two.'], from, [
			{ label: 'No', cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{ label: 'Yes', cls: 'mod-cta', run: () => this.log.push('yes') },
		]);
	}
	doAskDiscard(then: () => void): void {
		this.askDiscard(then);
	}
	doAfterDelete(key: string): void {
		this.afterDelete(key);
	}
	doGrow(el: FEl): void {
		this.growField(el as unknown as HTMLTextAreaElement);
	}
}

function open(w = new TestWindow()): TestWindow {
	w.open();
	return w;
}

const field = (w: TestWindow): FEl => pageOf(w.content).querySelector('textarea.dynasty-lw-field')!;
const active = (): string | null => fakeDoc.activeElement?.getAttribute('data-focus') ?? null;
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('open: header, bar, list (D.3.1, D.3.2)', () => {
	it('puts the classes on the window and gives the focus to the window itself', () => {
		const w = open();
		for (const c of ['dynasty-sheet', 'dynasty-titles', 'dynasty-lw']) expect(w.modal.hasClass(c)).toBe(true);
		expect(w.modal.getAttribute('tabindex')).toBe('-1');
		expect(fakeDoc.activeElement).toBe(w.modal);
	});

	it('has the header with the title and one button, Close, when the draft has no change, and names the dialog (list-footer-close)', () => {
		const w = open();
		expect(w.content.querySelector('.dynasty-sheet-title')!.getText()).toBe(TITLES_UI.title);
		expect(w.content.querySelector('button[data-focus="cancel"]')!.getText()).toBe(SHEET.close);
		expect(w.content.querySelector('button[data-focus="save"]')).toBeNull();
		expect(w.modal.getAttribute('role')).toBe('dialog');
		expect(w.modal.getAttribute('aria-modal')).toBe('true');
	});

	it('keeps Cancel and Save on the list when the draft has a change, and on every page', () => {
		const w = new TestWindow();
		w.dirty = true;
		open(w);
		expect(w.content.querySelector('button[data-focus="cancel"]')!.getText()).toBe(SHEET.cancel);
		expect(w.content.querySelector('button[data-focus="save"]')!.getText()).toBe(SHEET.save);
		const v = open(new TestWindow());
		openPage(v.content, 't0');
		expect(v.content.querySelector('button[data-focus="save"]')!.getText()).toBe(SHEET.save);
		// Back to a list with no change: Close only again.
		backToList(v.content);
		expect(v.content.querySelector('button[data-focus="save"]')).toBeNull();
	});

	it('shows the Houses title and classes for the houses kind', () => {
		const w = open(new TestWindow(items(), 'houses'));
		expect(w.modal.hasClass('dynasty-houses')).toBe(true);
		expect(w.content.querySelector('.dynasty-sheet-title')!.getText()).toBe(HOUSES.title);
		expect(searchBox(w.content).getAttribute('placeholder')).toBe(WIN_LIST_UI.searchHouses);
		expect(w.content.querySelector('button.dynasty-lw-add')!.hasClass('dynasty-house-add')).toBe(true);
		expect(w.content.querySelector('button.dynasty-lw-add')!.getText()).toBe(HOUSES.add);
	});

	it('has one fixed bar with the search box before the Add button, outside the scrolling body', () => {
		const w = open();
		const bar = w.content.querySelector('.dynasty-lw-bar')!;
		const kids = bar.children;
		expect(kids).toHaveLength(2);
		expect(kids[0]!.hasClass('dynasty-lw-searchwrap')).toBe(true);
		expect(kids[1]!.tag).toBe('button');
		expect(kids[1]!.hasClass('dynasty-lw-add')).toBe(true);
		expect(w.content.querySelector('.dynasty-sheet-body')!.contains(bar)).toBe(false);
		// The header of the list (an icon, the name, the number of items) stands above the bar, also outside the body.
		const top = w.content.querySelector('.dynasty-lw-top')!;
		expect(top.contains(bar)).toBe(true);
		expect(top.querySelector('.dynasty-head-name')!.getText()).toBe(TITLES_UI.title);
		expect(top.querySelector('.dynasty-lw-meta-count')!.getText()).toBe(WINDOW_UI.listMetaTitles(3));
	});

	it('gives the search box its type, name and keyboard settings', () => {
		const w = open();
		const box = searchBox(w.content);
		expect(box.getAttribute('type')).toBe('search');
		expect(box.getAttribute('data-focus')).toBe('search');
		expect(box.getAttribute('placeholder')).toBe(WIN_LIST_UI.searchTitles);
		expect(box.getAttribute('aria-label')).toBe(WIN_LIST_UI.searchTitles);
		for (const a of ['autocomplete', 'autocorrect', 'autocapitalize']) expect(box.getAttribute(a)).toBe('off');
		expect(box.getAttribute('spellcheck')).toBe('false');
		expect(box.getAttribute('enterkeyhint')).toBe('search');
		expect(box.value).toBe('');
	});

	it('gives the Add button its classes, focus name, text and a hidden icon', () => {
		const w = open();
		const add = w.content.querySelector('button.dynasty-lw-add')!;
		for (const c of ['dynasty-btn', 'dynasty-title-add']) expect(add.hasClass(c)).toBe(true);
		expect(add.getAttribute('data-focus')).toBe('add');
		expect(add.getText()).toBe(TITLES_UI.add);
		expect(add.querySelector('.dynasty-btn-icon')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('draws a list of items, each with one row button, in tree order', () => {
		const w = open();
		const list = w.content.querySelector('ul.dynasty-lw-list')!;
		const li = list.querySelectorAll(':scope > li');
		expect(li).toHaveLength(3);
		for (const item of li) expect(item.querySelectorAll(':scope > button.dynasty-lw-row')).toHaveLength(1);
		expect(rowNames(w.content)).toEqual(['Duke of Valmont', 'Count of d’España', 'Warden of the Marches']);
	});

	it('keeps the rows real buttons: no role, no aria-label, the key and the id as data', () => {
		const w = open();
		for (const r of listRows(w.content)) {
			expect(r.tag).toBe('button');
			expect(r.getAttribute('role')).toBeNull();
			expect(r.getAttribute('aria-label')).toBeNull();
			expect(r.getAttribute('type')).toBe('button');
		}
		const first = listRows(w.content)[0]!;
		expect(first.getAttribute('data-focus')).toBe('row:t0');
		expect(first.getAttribute('data-title')).toBe('duke-of-valmont');
		expect(w.content.querySelector('ul.dynasty-lw-list')!.getAttribute('role')).toBe('list');
	});

	it('uses data-house for the houses kind and the key for an item with no id', () => {
		const w = open(new TestWindow([...items(), { key: 'h9', id: null, name: 'House New', holders: [] }], 'houses'));
		expect(rowOf(w.content, 'h9').getAttribute('data-house')).toBe('h9');
		expect(rowOf(w.content, 'h9').getAttribute('data-title')).toBeNull();
		expect(rowOf(w.content, 'duke-of-valmont').getAttribute('data-house')).toBe('duke-of-valmont');
	});

	it('shows name, summary and the state tag of a row', () => {
		const w = open(new TestWindow([{ ...items()[0]!, state: 'changed' }, { ...items()[1]!, state: 'check-id' }, { key: 'n', id: null, name: 'Baron', holders: [] }]));
		const texts = rowTexts(w.content);
		expect(texts[0]).toBe(`Duke of Valmont | ${WIN_LIST_UI.stateChanged} | 2 holders`);
		expect(texts[1]).toBe(`Count of d’España | ${WIN_LIST_UI.stateCheckId} | 1 holders`);
		expect(texts[2]).toBe(`Baron | ${WIN_LIST_UI.stateNew} | 0 holders`);
		const tag = listRows(w.content)[1]!.querySelector('.dynasty-lw-state')!;
		expect(tag.hasClass('is-check-id')).toBe(true);
	});

	it('draws the house colour as a dot in the second text line through the house colour property only, and an arms box only for a row with arms (D213, D214)', () => {
		class Houses extends TestWindow {
			protected override rowViews(): ListRowView[] {
				return [
					{ key: 'a', id: 'a', name: 'House A', summary: '1 person', state: '', colour: '#aa0000', arms: 'x.png' },
					{ key: 'b', id: 'b', name: 'House B', summary: '0 people', state: '', colour: null, arms: null },
				];
			}
			protected override labelOf(key: string): string {
				return `House ${key}`;
			}
			protected override rowArms(box: HTMLElement, v: ListRowView): void {
				box.setAttribute('data-arms', v.arms ?? 'none');
			}
		}
		const w = open(new Houses([{ key: 'a', id: 'a', name: 'A', holders: [] }, { key: 'b', id: 'b', name: 'B', holders: [] }], 'houses'));
		const [a, b] = listRows(w.content);
		// The row with arms has the arms box as its lead, and the box has no colour. The colour is the dot before the count; a row with no arms has no lead at all.
		const boxA = a!.querySelector('.dynasty-lw-armsbox')!;
		expect(boxA.getAttribute('data-arms')).toBe('x.png');
		expect(boxA.style.getPropertyValue('--dynasty-house-color')).toBe('');
		const dotA = a!.querySelector('.dynasty-lw-dot')!;
		expect(dotA.style.getPropertyValue('--dynasty-house-color')).toBe('#aa0000');
		expect(dotA.attrs.get('style')).toBeUndefined();
		expect(dotA.getAttribute('aria-hidden')).toBe('true');
		expect(a!.querySelector('.dynasty-lw-row-sum')!.getText()).toBe('1 person');
		expect(a!.querySelector('.dynasty-lw-swatch')).toBeNull();
		expect(b!.querySelector('.dynasty-lw-armsbox')).toBeNull();
		expect(b!.querySelector('.dynasty-lw-dot')).toBeNull();
		expect(b!.querySelector('.dynasty-row-lead')).toBeNull();
	});

	it('shows no lead at all for a row with no arms: no crown, no swatch, no arms box (D213)', () => {
		const w = open();
		expect(w.content.querySelector('.dynasty-lw-swatch')).toBeNull();
		expect(w.content.querySelector('.dynasty-lw-armsbox')).toBeNull();
		expect(listRows(w.content)[0]!.querySelector('.dynasty-row-lead')).toBeNull();
	});

	it('has the error line (alert, hidden), the count line (status, polite) and the list in the body', () => {
		const w = open();
		const body = w.content.querySelector('.dynasty-sheet-body')!;
		const err = body.querySelector('.dynasty-sheet-error')!;
		expect(err.getAttribute('role')).toBe('alert');
		expect(err.hidden).toBe(true);
		const count = body.querySelector('.dynasty-lw-count')!;
		expect(count.getAttribute('role')).toBe('status');
		expect(count.getAttribute('aria-live')).toBe('polite');
		expect(count.hidden).toBe(true);
		expect(body.querySelector('ul.dynasty-lw-list')).not.toBeNull();
	});

	it('shows one "none" item for an empty tree, also with a query', () => {
		const w = open(new TestWindow([]));
		const none = w.content.querySelectorAll('li.dynasty-lw-none');
		expect(none).toHaveLength(1);
		expect(none[0]!.getText()).toBe(TITLES_UI.none);
		searchFor(w.content, 'duke');
		expect(w.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(TITLES_UI.none);
		expect(w.content.querySelector('.dynasty-lw-count')!.hidden).toBe(true);
	});

	it('shows the houses text for an empty list of houses', () => {
		const w = open(new TestWindow([], 'houses'));
		expect(w.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(HOUSES.none);
	});

	it('does not throw when the first draw fails', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		class Bad extends TestWindow {
			protected override rowViews(): ListRowView[] {
				throw new Error('boom');
			}
		}
		expect(() => open(new Bad())).not.toThrow();
		expect(err).toHaveBeenCalled();
	});
});

describe('search (D.3.3)', () => {
	it('filters at once on every input event and shows the count line', () => {
		const w = open();
		searchFor(w.content, 'duke');
		expect(rowNames(w.content)).toEqual(['Duke of Valmont']);
		const count = w.content.querySelector('.dynasty-lw-count')!;
		expect(count.getText()).toBe(WIN_LIST_UI.matchTitles(1, 3));
		expect(count.hidden).toBe(false);
		searchFor(w.content, 'of');
		expect(count.getText()).toBe(WIN_LIST_UI.matchTitles(3, 3));
		expect(rowNames(w.content)).toHaveLength(3);
	});

	it('uses the houses count text for the houses kind', () => {
		const w = open(new TestWindow(items(), 'houses'));
		searchFor(w.content, 'duke');
		expect(w.content.querySelector('.dynasty-lw-count')!.getText()).toBe(WIN_LIST_UI.matchHouses(1, 3));
	});

	it('folds case, accents and quote look-alikes', () => {
		const w = open();
		searchFor(w.content, 'ESPANA');
		expect(rowNames(w.content)).toEqual(['Count of d’España']);
		searchFor(w.content, "d'espana");
		expect(rowNames(w.content)).toEqual(['Count of d’España']);
	});

	it('keeps the order of the tree and does not rank', () => {
		const w = open();
		searchFor(w.content, 'o');
		expect(rowNames(w.content)).toEqual(['Duke of Valmont', 'Count of d’España', 'Warden of the Marches']);
	});

	it('shows every row for no words: empty, spaces or a lone accent mark', () => {
		const w = open();
		for (const q of ['', '   ', '́']) {
			searchFor(w.content, q);
			expect(rowNames(w.content)).toHaveLength(3);
			expect(w.content.querySelector('.dynasty-lw-count')!.hidden).toBe(true);
		}
	});

	it('shows the no-result text with the trimmed query in curly marks, and no count line', () => {
		const w = open();
		searchFor(w.content, '  zzz  ');
		expect(listRows(w.content)).toHaveLength(0);
		expect(w.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(WIN_LIST_UI.noResultTitles('zzz'));
		expect(w.content.querySelector('li.dynasty-lw-none')!.getText()).toContain('“zzz”');
		expect(w.content.querySelector('.dynasty-lw-count')!.hidden).toBe(true);
	});

	it('uses the houses no-result text for the houses kind', () => {
		const w = open(new TestWindow(items(), 'houses'));
		searchFor(w.content, 'zzz');
		expect(w.content.querySelector('li.dynasty-lw-none')!.getText()).toBe(WIN_LIST_UI.noResultHouses('zzz'));
	});

	it('shows the reason line only when the window gives one', () => {
		const w = open();
		searchFor(w.content, 'duke');
		expect(listRows(w.content)[0]!.querySelector('.dynasty-lw-row-found')).toBeNull();
		searchFor(w.content, 'isolde');
		expect(listRows(w.content)[0]!.querySelector('.dynasty-lw-row-found')!.getText()).toBe(WIN_LIST_UI.holder('Isolde Orsini'));
		expect(rowTexts(w.content)[0]).toContain(WIN_LIST_UI.holder('Isolde Orsini'));
	});

	it('keeps the same search box and the same bar while the user types', () => {
		const w = open();
		const box = searchBox(w.content);
		const bar = w.content.querySelector('.dynasty-lw-bar')!;
		const wrap = w.content.querySelector('.dynasty-lw-searchwrap')!;
		const body = w.content.querySelector('.dynasty-sheet-body')!;
		box.focus();
		for (const q of ['d', 'du', 'duk', 'duke', 'duk', '']) {
			searchFor(w.content, q);
			expect(searchBox(w.content)).toBe(box);
			expect(w.content.querySelector('.dynasty-lw-bar')).toBe(bar);
			expect(w.content.querySelector('.dynasty-lw-searchwrap')).toBe(wrap);
			expect(w.content.querySelector('.dynasty-sheet-body')).toBe(body);
			expect(fakeDoc.activeElement).toBe(box);
		}
	});

	it('replaces the row elements, and the scroll goes to the top', () => {
		const w = open();
		const old = listRows(w.content)[0]!;
		const body = w.content.querySelector('.dynasty-sheet-body')!;
		body.scrollTop = 80;
		searchFor(w.content, 'duke');
		expect(listRows(w.content)[0]).not.toBe(old);
		expect(body.scrollTop).toBe(0);
	});

	it('does not build the window again: no extra header or bar after typing', () => {
		const w = open();
		searchFor(w.content, 'a');
		expect(w.content.querySelectorAll('.dynasty-sheet-title')).toHaveLength(1);
		expect(w.content.querySelectorAll('.dynasty-lw-bar')).toHaveLength(1);
	});

	it('shows a clear button only while the box has text; it empties the query and keeps the focus in the box', () => {
		const w = open();
		const clear = w.content.querySelector('button.dynasty-lw-clear')!;
		expect(clear.hidden).toBe(true);
		expect(clear.getAttribute('aria-label')).toBe(WIN_LIST_UI.clearSearch);
		expect(clear.getAttribute('type')).toBe('button');
		searchFor(w.content, 'duke');
		expect(clear.hidden).toBe(false);
		dispatch(clear, 'click');
		expect(searchBox(w.content).value).toBe('');
		expect(w.queryText).toBe('');
		expect(clear.hidden).toBe(true);
		expect(rowNames(w.content)).toHaveLength(3);
		expect(fakeDoc.activeElement).toBe(searchBox(w.content));
	});

	it('gives the clear button no role of its own inside the list and keeps it in the search wrapper', () => {
		const w = open();
		const clear = w.content.querySelector('button.dynasty-lw-clear')!;
		expect(clear.parentElement!.hasClass('dynasty-lw-searchwrap')).toBe(true);
	});
});

describe('keys (D.3.3)', () => {
	it('moves the focus from the search box to the first row on ArrowDown, and prevents the default', () => {
		const w = open();
		const box = searchBox(w.content);
		box.focus();
		const e = press(box, 'ArrowDown');
		expect(e.defaultPrevented).toBe(true);
		expect(active()).toBe('row:t0');
	});

	it('does not prevent ArrowDown when no row shows', () => {
		const w = open();
		searchFor(w.content, 'zzz');
		const e = press(searchBox(w.content), 'ArrowDown');
		expect(e.defaultPrevented).toBe(false);
		expect(fakeDoc.activeElement).not.toBeNull();
	});

	it('leaves Home, End and every other key alone in the search box', () => {
		const w = open();
		const box = searchBox(w.content);
		box.focus();
		for (const key of ['Home', 'End', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'a', 'Enter', 'Escape', 'Backspace']) {
			const e = press(box, key);
			expect(e.defaultPrevented, key).toBe(false);
			expect(fakeDoc.activeElement, key).toBe(box);
		}
	});

	it('ignores ArrowDown with Ctrl, Meta or Alt, or during a composition', () => {
		const w = open();
		const box = searchBox(w.content);
		box.focus();
		for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
			const e = press(box, 'ArrowDown', init);
			expect(e.defaultPrevented).toBe(false);
			expect(fakeDoc.activeElement).toBe(box);
		}
	});

	it('moves between rows with ArrowDown and ArrowUp, and from the first row up to the search box', () => {
		const w = open();
		const rows = listRows(w.content);
		rows[0]!.focus();
		expect(press(rows[0]!, 'ArrowDown').defaultPrevented).toBe(true);
		expect(active()).toBe('row:t1');
		press(rows[1]!, 'ArrowDown');
		expect(active()).toBe('row:t2');
		const last = press(rows[2]!, 'ArrowDown');
		expect(last.defaultPrevented).toBe(true);
		expect(active()).toBe('row:t2');
		press(rows[2]!, 'ArrowUp');
		expect(active()).toBe('row:t1');
		press(rows[1]!, 'ArrowUp');
		expect(active()).toBe('row:t0');
		expect(press(rows[0]!, 'ArrowUp').defaultPrevented).toBe(true);
		expect(active()).toBe('search');
	});

	it('goes to the first and last row with Home and End on a row', () => {
		const w = open();
		const rows = listRows(w.content);
		rows[1]!.focus();
		expect(press(rows[1]!, 'End').defaultPrevented).toBe(true);
		expect(active()).toBe('row:t2');
		expect(press(rows[2]!, 'Home').defaultPrevented).toBe(true);
		expect(active()).toBe('row:t0');
	});

	it('ignores row keys with Ctrl, Meta or Alt, or during a composition', () => {
		const w = open();
		const rows = listRows(w.content);
		rows[0]!.focus();
		for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
			for (const key of ['ArrowDown', 'End']) {
				expect(press(rows[0]!, key, init).defaultPrevented).toBe(false);
				expect(active()).toBe('row:t0');
			}
		}
	});

	it('does not handle other keys on a row (Enter and Space stay with the button)', () => {
		const w = open();
		const rows = listRows(w.content);
		for (const key of ['Enter', ' ', 'a', 'Escape']) expect(press(rows[0]!, key).defaultPrevented, key).toBe(false);
	});
});

describe('open a page and go back (D.3.4)', () => {
	it('replaces the bar and the list with the Back bar and the page, and focuses Back', () => {
		const w = open();
		openPage(w.content, 'duke-of-valmont');
		expect(w.pageKey).toBe('t0');
		expect(w.content.querySelector('.dynasty-lw-bar')).toBeNull();
		expect(w.content.querySelector('.dynasty-lw-top')).toBeNull();
		expect(w.content.querySelector('ul.dynasty-lw-list')).toBeNull();
		// The way back is a link above the header of the page (G.7).
		expect(w.content.querySelector('.dynasty-sheet-body .dynasty-back')).not.toBeNull();
		expect(active()).toBe('back');
		expect(fakeDoc.activeElement).toBe(backButton(w.content));
	});

	it('opens a page from a keyboard click on the row (Enter and Space send a click)', () => {
		const w = open();
		dispatch(rowOf(w.content, 't1'), 'click');
		expect(w.pageKey).toBe('t1');
	});

	it('gives the Back button an icon, a text, a 44 px class and a long accessible name', () => {
		const w = open();
		openPage(w.content, 't0');
		const back = backButton(w.content)!;
		expect(back.hasClass('dynasty-back')).toBe(true);
		expect(back.getAttribute('aria-label')).toBe(WIN_LIST_UI.backTitles);
		// The link shows the name of the list that the user came from (G.7): "‹ Titles".
		expect(back.getText()).toBe(TITLES_UI.title);
		expect(back.querySelector('.dynasty-back-chevron')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('uses the houses Back name for the houses kind', () => {
		const w = open(new TestWindow(items(), 'houses'));
		openPage(w.content, 't0');
		expect(backButton(w.content)!.getAttribute('aria-label')).toBe(WIN_LIST_UI.backHouses);
	});

	it('shows the item name as a level 2 heading in the header of the page', () => {
		const w = open();
		openPage(w.content, 't1');
		const name = w.content.querySelector('.dynasty-lw-pagehead .dynasty-lw-back-name')!;
		expect(name.getAttribute('role')).toBe('heading');
		expect(name.getAttribute('aria-level')).toBe('2');
		expect(name.getText()).toBe('Count of d’España');
		// The header of the page scrolls with the page (the bar of a phone shows the title when it has scrolled away).
		expect(w.content.querySelector('.dynasty-sheet-body')!.contains(name)).toBe(true);
	});

	it('draws the page as a labelled region with the id or the key as data', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		expect(page.getAttribute('role')).toBe('region');
		expect(page.getAttribute('aria-label')).toBe(WIN_LIST_UI.editPage('Duke of Valmont'));
		expect(page.getAttribute('data-title')).toBe('duke-of-valmont');
		const houses = open(new TestWindow([...items(), { key: 'h9', id: null, name: 'Newhouse', holders: [] }], 'houses'));
		expect(openPage(houses.content, 'h9').getAttribute('data-house')).toBe('h9');
	});

	it('keeps the query across a page and shows the row just left on Back', () => {
		const w = open();
		searchFor(w.content, 'of');
		openPage(w.content, 't1');
		expect(w.queryText).toBe('of');
		backToList(w.content);
		expect(searchBox(w.content).value).toBe('of');
		expect(rowNames(w.content)).toHaveLength(3);
		expect(active()).toBe('row:t1');
		expect(w.content.querySelector('.dynasty-lw-count')!.getText()).toBe(WIN_LIST_UI.matchTitles(3, 3));
	});

	it('puts the focus in the search box when the row left is no longer shown', () => {
		const w = open();
		searchFor(w.content, 'duke');
		openPage(w.content, 't0');
		w.item('t0').name = 'Baron of Valmont';
		w.item('t0').id = 'baron';
		backToList(w.content);
		expect(listRows(w.content)).toHaveLength(0);
		expect(active()).toBe('search');
	});

	it('keeps the scroll position of the list', () => {
		const w = open();
		w.content.querySelector('.dynasty-sheet-body')!.scrollTop = 120;
		openPage(w.content, 't2');
		expect(w.content.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(0);
		backToList(w.content);
		expect(w.content.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(120);
	});

	it('shows the draft in the rows at once when the list is drawn again', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.value = 'Prince of Valmont';
		dispatch(ta, 'input');
		backToList(w.content);
		expect(rowNames(w.content)[0]).toBe('Prince of Valmont');
	});

	it('updates the Back bar name and the region label while the name is typed', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		const ta = field(w);
		ta.value = 'Prince of Valmont';
		dispatch(ta, 'input');
		expect(w.content.querySelector('.dynasty-lw-back-name')!.getText()).toBe('Prince of Valmont');
		expect(page.getAttribute('aria-label')).toBe(WIN_LIST_UI.editPage('Prince of Valmont'));
		const del = page.querySelector('button.dynasty-title-delete')!;
		expect(del.getAttribute('aria-label')).toBe(TITLES_UI.deleteLabel('Prince of Valmont'));
		expect(page.querySelector('button.dynasty-id-open')!.getAttribute('aria-label')).toBe(ID_UI.openAria('Prince of Valmont'));
	});

	it('shows the error line that was set, on the page too, and keeps it through a draw', () => {
		const w = open();
		w.doError('Wrong.');
		expect(w.content.querySelector('.dynasty-sheet-error')!.getText()).toBe('Wrong.');
		openPage(w.content, 't0');
		expect(w.content.querySelector('.dynasty-sheet-error')!.getText()).toBe('Wrong.');
		expect(w.content.querySelector('.dynasty-sheet-error')!.hidden).toBe(false);
	});

	it('opens the page of a key with a named first focus', () => {
		const w = open();
		w.doOpenPage('t0', 'name:t0');
		expect(active()).toBe('name:t0');
	});

	it('opens a page for a title with no name: the label is the new-title text', () => {
		const w = open(new TestWindow([{ key: 'n', id: null, name: '', holders: [] }]));
		expect(rowNames(w.content)).toEqual([TITLES_UI.newTitle]);
		const page = openPage(w.content, 'n');
		expect(page.getAttribute('aria-label')).toBe(WIN_LIST_UI.editPage(TITLES_UI.newTitle));
	});

	it('never lets a failed page escape', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const w = open();
		w.failPage = true;
		expect(() => dispatch(rowOf(w.content, 't0'), 'click')).not.toThrow();
		expect(err).toHaveBeenCalled();
	});
});

describe('Add (D.3.4)', () => {
	it('clears the query, opens the page of the new item and focuses its name field', () => {
		const w = open();
		searchFor(w.content, 'duke');
		dispatch(w.content.querySelector('button.dynasty-lw-add')!, 'click');
		expect(w.queryText).toBe('');
		expect(w.pageKey).toBe('t3');
		expect(active()).toBe('name:t3');
		expect(field(w).getAttribute('data-focus')).toBe('name:t3');
	});

	it('shows the new item in the list as New after Back, with no name text', () => {
		const w = open();
		dispatch(w.content.querySelector('button.dynasty-lw-add')!, 'click');
		backToList(w.content);
		expect(rowTexts(w.content)[3]).toBe(`${TITLES_UI.newTitle} | ${WIN_LIST_UI.stateNew} | 0 holders`);
		expect(searchBox(w.content).value).toBe('');
		expect(active()).toBe('row:t3');
	});
});

describe('the edit page fields (D.3.9 b)', () => {
	it('makes a one-row text area inside a labelled field with the old class', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		const label = page.querySelector('label.dynasty-sheet-field.dynasty-title-name')!;
		expect(label.querySelector('.dynasty-sheet-label')!.getText()).toBe(TITLES_UI.nameLabel);
		const ta = label.querySelector('textarea')!;
		expect(ta.hasClass('dynasty-sheet-input')).toBe(true);
		expect(ta.hasClass('dynasty-lw-field')).toBe(true);
		expect(ta.getAttribute('rows')).toBe('1');
		expect(ta.value).toBe('Duke of Valmont');
		expect(ta.getAttribute('aria-label')).toBe(TITLES_UI.nameLabel);
		expect(ta.getAttribute('data-focus')).toBe('name:t0');
		expect(ta.getAttribute('enterkeyhint')).toBe('done');
		expect(ta.getAttribute('spellcheck')).toBe('false');
		expect(ta.getAttribute('autocomplete')).toBe('off');
	});

	it('writes what is typed into the draft', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.value = 'Duke';
		dispatch(ta, 'input');
		expect(w.typed).toEqual(['Duke']);
	});

	it('prevents Enter and drops the focus, so the keyboard closes', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.focus();
		const e = press(ta, 'Enter');
		expect(e.defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).not.toBe(ta);
	});

	it('leaves Enter alone during an IME composition and keeps the focus', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.focus();
		const composing = press(ta, 'Enter', { isComposing: true });
		expect(composing.defaultPrevented).toBe(false);
		expect(fakeDoc.activeElement).toBe(ta);
		const processed = press(ta, 'Enter', { keyCode: 229 });
		expect(processed.defaultPrevented).toBe(false);
		expect(fakeDoc.activeElement).toBe(ta);
	});

	it('does not touch other keys', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.focus();
		for (const key of ['a', 'Home', 'End', 'ArrowDown', 'Backspace']) expect(press(ta, key).defaultPrevented, key).toBe(false);
		expect(fakeDoc.activeElement).toBe(ta);
	});

	it('replaces a pasted line break with one space before the value goes into the draft', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.value = 'Duke\nof\r\nValmont\rhere';
		dispatch(ta, 'input');
		expect(w.typed).toEqual(['Duke of Valmont here']);
		expect(ta.value).toBe('Duke of Valmont here');
	});

	it('keeps the value exactly as typed otherwise (spaces are not trimmed)', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.value = '  Duke  ';
		dispatch(ta, 'input');
		expect(w.typed).toEqual(['  Duke  ']);
	});

	it('clears the error line when the owner types', () => {
		const w = open();
		openPage(w.content, 't0');
		w.doError('Needs a name.');
		const ta = field(w);
		ta.value = 'x';
		dispatch(ta, 'input');
		expect(w.content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(w.content.querySelector('.dynasty-sheet-error')!.hidden).toBe(true);
	});
});

describe('growField (D.3.9 b)', () => {
	const textarea = (): FEl => {
		const el = new FEl('textarea');
		el.clientHeight = 44;
		el.offsetHeight = 44;
		return el;
	};
	const height = (el: FEl) => el.style.getPropertyValue('--dynasty-lw-field-height');

	it('sets scrollHeight plus the border, and shrinks again when the text is cut', () => {
		const w = open();
		const el = textarea();
		el.scrollHeight = 88;
		el.offsetHeight = 92;
		el.clientHeight = 88;
		w.doGrow(el);
		expect(height(el)).toBe('92px');
		el.scrollHeight = 40;
		el.offsetHeight = 44;
		el.clientHeight = 40;
		w.doGrow(el);
		expect(height(el)).toBe('44px');
	});

	it('removes the property before it reads scrollHeight', () => {
		const w = open();
		const el = textarea();
		const order: string[] = [];
		const remove = el.style.removeProperty;
		el.style.removeProperty = (k: string) => {
			order.push(`remove ${k}`);
			remove(k);
		};
		Object.defineProperty(el, 'scrollHeight', {
			configurable: true,
			get() {
				order.push('read scrollHeight');
				return 60;
			},
		});
		el.style.setProperty('--dynasty-lw-field-height', '300px');
		w.doGrow(el);
		expect(order).toEqual(['remove --dynasty-lw-field-height', 'read scrollHeight']);
		expect(height(el)).toBe('60px');
	});

	it('leaves the property unset when scrollHeight is 0 (not laid out)', () => {
		const w = open();
		const el = textarea();
		el.scrollHeight = 0;
		el.style.setProperty('--dynasty-lw-field-height', '300px');
		w.doGrow(el);
		expect(height(el)).toBe('');
	});

	it('adds no negative border when offsetHeight is smaller than clientHeight', () => {
		const w = open();
		const el = textarea();
		el.scrollHeight = 50;
		el.offsetHeight = 0;
		el.clientHeight = 600;
		w.doGrow(el);
		expect(height(el)).toBe('50px');
	});

	it('runs when the field is put into the page, after each input, and on a layout change', () => {
		const spy = vi.spyOn(ListEditWindow.prototype as unknown as { growField: (el: FEl) => void }, 'growField');
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		expect(spy).toHaveBeenCalledWith(ta);
		spy.mockClear();
		dispatch(ta, 'input');
		expect(spy).toHaveBeenCalledWith(ta);
		spy.mockClear();
		dispatchWindow('resize');
		expect(spy).toHaveBeenCalledWith(ta);
	});

	it('uses the written height when the text is laid out', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		ta.scrollHeight = 70;
		ta.offsetHeight = 74;
		ta.clientHeight = 70;
		dispatch(ta, 'input');
		expect(height(ta)).toBe('74px');
	});
});

describe('Other actions (D.3.7)', () => {
	it('is the last section of the page, with its label, Change ID before Delete', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		const last = page.querySelectorAll('section.dynasty-section')[page.querySelectorAll('section.dynasty-section').length - 1]!;
		expect(last.getAttribute('data-section')).toBe('more');
		expect(last.querySelector('.dynasty-section-title')!.getText()).toBe(WINDOW_UI.sectionOther);
		const buttons = last.querySelectorAll('.dynasty-row-text').map((t) => t.parentElement!);
		expect(buttons.map((b) => b.querySelector('.dynasty-row-title')!.getText())).toEqual([ID_UI.open, TITLES_UI.delete]);
		expect(buttons[0]!.querySelector('.dynasty-row-sub')!.getText()).toBe(ID_UI.hint('title'));
		expect(buttons[0]!.hasClass('dynasty-id-open')).toBe(true);
		expect(buttons[0]!.getAttribute('data-focus')).toBe('id-open:t0');
		expect(buttons[1]!.hasClass('mod-warning')).toBe(true);
		expect(buttons[1]!.hasClass('dynasty-title-delete')).toBe(true);
		expect(buttons[1]!.getAttribute('data-focus')).toBe('delete:t0');
		expect(buttons[1]!.getAttribute('aria-label')).toBe(TITLES_UI.deleteLabel('Duke of Valmont'));
	});

	it('has no Change ID for an item that is not saved', () => {
		const w = open(new TestWindow([{ key: 'n', id: null, name: 'Baron', holders: [] }]));
		const page = openPage(w.content, 'n');
		expect(page.querySelector('button.dynasty-id-open')).toBeNull();
		expect(page.querySelectorAll('.dynasty-lw-actions-row button')).toHaveLength(1);
	});

	it('uses the old houses class and text for the houses kind', () => {
		class Houses extends TestWindow {
			protected override renderPage(page: HTMLElement, key: string): void {
				this.drawSections(page, 'test', [this.otherActionsSection(key, 'dynasty-house-delete', 'Delete this house')]);
			}
		}
		const w = open(new Houses(items(), 'houses'));
		const page = openPage(w.content, 't0');
		const del = page.querySelector('button.dynasty-house-delete')!;
		expect(del.getText()).toBe(HOUSES.delete);
		expect(del.getAttribute('aria-label')).toBe('Delete this house');
	});

	it('asks the window to change the ID and to delete', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		dispatch(page.querySelector('button.dynasty-id-open')!, 'click');
		expect(w.log).toContain('id:t0');
		dispatch(page.querySelector('button.dynasty-title-delete')!, 'click');
		expect(w.confirm).not.toBeNull();
	});
});

describe('delete (D.3.7)', () => {
	it('removes a new item at once, shows the list and focuses the row that took its place', () => {
		const list = [...items(), { key: 'n', id: null, name: 'Baron', holders: [] }];
		const w = open(new TestWindow(list));
		const page = openPage(w.content, 'n');
		dispatch(page.querySelector('button.dynasty-title-delete')!, 'click');
		expect(w.pageKey).toBeNull();
		expect(rowNames(w.content)).toEqual(['Duke of Valmont', 'Count of d’España', 'Warden of the Marches']);
		expect(active()).toBe('row:t2');
	});

	it('focuses the row that took the place of a deleted item, else the row before it, else Add', () => {
		const w = open();
		openPage(w.content, 't1');
		w.item('t1').deleted = true;
		w.doAfterDelete('t1');
		expect(w.pageKey).toBeNull();
		expect(active()).toBe('row:t2');
		openPage(w.content, 't2');
		w.item('t2').deleted = true;
		w.doAfterDelete('t2');
		expect(active()).toBe('row:t0');
		openPage(w.content, 't0');
		w.item('t0').deleted = true;
		w.doAfterDelete('t0');
		expect(rowNames(w.content)).toEqual([]);
		expect(active()).toBe('add');
	});

	it('asks first for a saved item and the answer returns the focus to the same control when kept', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		dispatch(page.querySelector('button.dynasty-title-delete')!, 'click');
		expect(w.confirm!.getAttribute('role')).toBe('alertdialog');
		dispatch(w.confirm!.querySelector('button.dynasty-sheet-keep')!, 'click');
		expect(w.confirm).toBeNull();
		expect(active()).toBe('delete:t0');
	});
});

describe('close rules (D.3.8)', () => {
	it('goes from a page back to the list, then closes the window when nothing changed', () => {
		const w = open();
		openPage(w.content, 't0');
		w.close();
		expect(w.pageKey).toBeNull();
		expect(openModals).toContain(w);
		expect(active()).toBe('row:t0');
		w.close();
		expect(openModals).not.toContain(w);
		expect(w.log).toContain('released');
	});

	it('closes a question first, and the focus returns to the control that had it', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		dispatch(page.querySelector('button.dynasty-title-delete')!, 'click');
		expect(w.confirm).not.toBeNull();
		w.close();
		expect(w.confirm).toBeNull();
		expect(w.pageKey).toBe('t0');
		expect(active()).toBe('delete:t0');
		expect(openModals).toContain(w);
	});

	it('asks "Discard changes?" on the list with a changed draft; Continue to edit keeps the window', () => {
		const w = open();
		w.dirty = true;
		w.close();
		const q = w.confirm!;
		expect(q.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(q.getText()).toContain(TITLES_UI.discardText);
		dispatch(q.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(w.confirm).toBeNull();
		expect(openModals).toContain(w);
		expect(w.log).toContain('dropWaiting');
	});

	it('closes the window on "Discard changes"', () => {
		const w = open();
		w.dirty = true;
		w.close();
		dispatch(w.confirm!.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(openModals).not.toContain(w);
	});

	it('walks the order: question, page, discard question, window', () => {
		const w = open();
		const page = openPage(w.content, 't0');
		w.dirty = true;
		dispatch(page.querySelector('button.dynasty-title-delete')!, 'click');
		w.close();
		expect(w.confirm).toBeNull();
		expect(w.pageKey).toBe('t0');
		w.close();
		expect(w.pageKey).toBeNull();
		expect(w.confirm).toBeNull();
		w.close();
		expect(w.confirm).not.toBeNull();
		expect(openModals).toContain(w);
		w.close();
		expect(w.confirm).toBeNull();
		expect(openModals).toContain(w);
	});

	it('tells the window when a question closes with no answer', () => {
		const w = open();
		w.doConfirm();
		w.log.length = 0;
		w.close();
		expect(w.log).toEqual(['dropWaiting']);
	});

	it('closes at once on Cancel, with a changed draft', () => {
		const w = open();
		w.dirty = true;
		dispatch(w.content.querySelector('button[data-focus="cancel"]')!, 'click');
		expect(openModals).not.toContain(w);
		expect(w.log).not.toContain('save');
	});

	it('runs Save from the list (when it has changes) and from a page', () => {
		const w = new TestWindow();
		w.dirty = true;
		open(w);
		dispatch(w.content.querySelector('button[data-focus="save"]')!, 'click');
		expect(w.log).toEqual(['save', 'released']);
		const v = open(new TestWindow());
		openPage(v.content, 't0');
		dispatch(v.content.querySelector('button[data-focus="save"]')!, 'click');
		expect(v.log).toContain('save');
	});

	it('closes without questions when the plugin closes all windows (finish)', () => {
		const w = open();
		w.dirty = true;
		openPage(w.content, 't0');
		(w as unknown as { finish(): void }).finish();
		expect(w.isClosing).toBe(true);
		expect(openModals).not.toContain(w);
	});

	it('runs the clean-up once, lets go of the window focus and empties the content', () => {
		const w = open();
		const box = searchBox(w.content);
		box.focus();
		w.close();
		expect(w.log.filter((l) => l === 'released')).toHaveLength(1);
		expect(w.content.children).toHaveLength(0);
		expect(fakeDoc.activeElement).toBeNull();
	});

	it('asks the discard question for an action that waits (askDiscard)', () => {
		const w = open();
		const run = vi.fn();
		w.doAskDiscard(run);
		dispatch(w.confirm!.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(run).toHaveBeenCalledOnce();
	});
});

describe('questions, errors and notices', () => {
	it('draws the question over the window with a name, the text and the buttons; the first button has the focus', () => {
		const w = new TestWindow();
		w.dirty = true;
		open(w);
		w.doConfirm('save');
		const layer = w.confirm!;
		expect(layer.getAttribute('role')).toBe('alertdialog');
		expect(layer.getAttribute('aria-modal')).toBe('true');
		const title = layer.querySelector('.dynasty-sheet-confirm-title')!;
		expect(layer.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
		expect(layer.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText())).toEqual(['One.', 'Two.']);
		expect(fakeDoc.activeElement!.getText()).toBe('No');
		dispatch(layer.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(w.confirm).toBeNull();
		expect(active()).toBe('save');
	});

	it('draws a choice button with a label and a detail', () => {
		const w = open();
		(w as unknown as { showConfirm: (...a: unknown[]) => void }).showConfirm('T', ['x'], null, [
			{ label: 'Clear', detail: 'Remove it', cls: 'dynasty-choice', run: () => undefined },
			{ label: 'Cancel', cls: 'dynasty-sheet-keep', run: () => undefined },
		]);
		const choice = w.confirm!.querySelector('.dynasty-choice-options button')!;
		expect(choice.querySelector('.dynasty-choice-label')!.getText()).toBe('Clear');
		expect(choice.querySelector('.dynasty-choice-detail')!.getText()).toBe('Remove it');
	});

	it('returns the focus to the active control, else Save, when no control is named', () => {
		const w = new TestWindow();
		w.dirty = true;
		open(w);
		listRows(w.content)[1]!.focus();
		w.doConfirm();
		dispatch(w.confirm!.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(active()).toBe('row:t1');
		fakeDoc.activeElement = null;
		w.doConfirm();
		dispatch(w.confirm!.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(active()).toBe('save');
	});

	it('shows an error in the alert line and clears the text too', () => {
		const w = open();
		w.doError('Cannot save.');
		const err = w.content.querySelector('.dynasty-sheet-error')!;
		expect(err.getText()).toBe('Cannot save.');
		expect(err.hidden).toBe(false);
		w.doClear();
		expect(err.getText()).toBe('');
		expect(err.hidden).toBe(true);
	});

	it('shows a refused write as a Notice and in the error line', () => {
		const w = open();
		w.doRefused('The note changed.');
		expect(notices).toContain('The note changed.');
		expect(w.content.querySelector('.dynasty-sheet-error')!.getText()).toBe('The note changed.');
	});

	it('draws again with the same page, keeps the focused control and the scroll position', () => {
		const w = open();
		w.doOpenPage('t0', 'name:t0');
		const body = w.content.querySelector('.dynasty-sheet-body')!;
		body.scrollTop = 33;
		w.doBuild();
		expect(active()).toBe('name:t0');
		expect(w.content.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(33);
		expect(w.pageKey).toBe('t0');
	});

	it('does not move the keyboard focus to a control of an old view when the view changes', () => {
		const w = open();
		listRows(w.content)[0]!.focus();
		w.doOpenPage('t0');
		expect(active()).toBe('back');
	});
});

describe('keyboard reveal on a phone (D.3.4, D114)', () => {
	it('scrolls the focused field into view once, after the keyboard settled', () => {
		const w = open();
		openPage(w.content, 't0');
		const ta = field(w);
		const scroll = vi.fn();
		ta.scrollIntoView = scroll;
		ta.focus();
		dispatch(ta, 'focusin');
		expect(scroll).not.toHaveBeenCalled();
		runTimers(400);
		expect(scroll).toHaveBeenCalledTimes(1);
	});

	it('uses the reduced-motion answer of the window for the scroll', () => {
		const w = open();
		w.reducedMotion = true;
		openPage(w.content, 't0');
		const ta = field(w);
		const scroll = vi.fn();
		ta.scrollIntoView = scroll;
		ta.focus();
		dispatch(ta, 'focusin');
		runTimers(400);
		expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
	});

	it('does not keep a timer or a listener after the window closed', () => {
		const w = open();
		openPage(w.content, 't0');
		field(w).focus();
		dispatch(field(w), 'focusin');
		w.close();
		w.close();
		expect(() => runTimers(1000)).not.toThrow();
	});
});

describe('the style block (D.2, D.3.9)', () => {
	const START = '/* ===== list windows (0.2.5, D134) ===== */';
	const END = '/* ===== end list windows ===== */';
	const block = css.slice(css.indexOf(START) + START.length, css.indexOf(END));

	interface Rule {
		head: string;
		selectors: string[];
		body: string;
		media: string | null;
	}

	/** The rules of a block, with the at-rule that holds each one; comments removed. */
	function parseRules(text: string): Rule[] {
		const out: Rule[] = [];
		const stack: string[] = [];
		let buf = '';
		for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, '')) {
			if (ch === '{') {
				stack.push(buf.trim());
				buf = '';
			} else if (ch === '}') {
				const head = stack.pop() ?? '';
				if (!head.startsWith('@')) out.push({ head, selectors: head.split(',').map((x) => x.trim()), body: buf, media: stack.find((x) => x.startsWith('@')) ?? null });
				buf = '';
			} else buf += ch;
		}
		return out;
	}

	const rules = parseRules(block);
	/** The declarations of every rule outside a media block that names the class `cls` in one selector. */
	const declarations = (cls: string): string =>
		rules
			.filter((r) => r.media === null && r.selectors.some((x) => new RegExp(`\.${cls}(?![\w-])`).test(x)))
			.map((r) => r.body)
			.join('\n');

	it('has the two marker lines once, in order, after the markers of B and C', () => {
		expect(css.split(START)).toHaveLength(2);
		expect(css.split(END)).toHaveLength(2);
		expect(css.indexOf(START)).toBeLessThan(css.indexOf(END));
		expect(css.indexOf('/* roundel: card */')).toBeLessThan(css.indexOf(START));
		expect(css.indexOf('/* C: focus list and tooltip */')).toBeLessThan(css.indexOf(START));
		expect(css.slice(css.indexOf(END) + END.length).trim()).toBe('');
	});

	it('has rules, and every selector of the block holds a dynasty-lw class', () => {
		expect(rules.length).toBeGreaterThan(30);
		for (const r of rules) for (const s of r.selectors) expect(s, s).toMatch(/\.dynasty-lw(-[a-z-]+)?(?![\w-])/);
	});

	it('does not set a colour value: the house colour comes only from the custom property', () => {
		expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		expect(block).toContain('var(--dynasty-house-color');
	});

	it('does not hold the holder label rules (they belong to the holder block)', () => {
		expect(block).not.toContain('dynasty-holder-label');
	});

	it('makes the window as tall as its list on the computer, up to the maximum of the sheet, anchored at the top (list-window-height)', () => {
		const rule = rules.find((r) => r.media === null && r.selectors.includes('.modal.dynasty-sheet.dynasty-lw:not(.is-phone)'));
		expect(rule).toBeDefined();
		expect(rule!.body).toContain('height: auto');
		expect(rule!.body).toContain('min-height: 320px');
		expect(rule!.body).not.toContain('900px');
	});

	it('has an own rule for a short window (a phone on its side)', () => {
		const short = rules.filter((r) => r.media === '@media (max-height: 520px)');
		const win = short.find((r) => r.selectors.includes('.modal.dynasty-sheet.dynasty-lw:not(.is-phone)'));
		expect(win).toBeDefined();
		expect(win!.body).toContain('height: calc(100vh - 2 * var(--size-4-2))');
		expect(win!.body).toContain('max-height: calc(100vh - 2 * var(--size-4-2))');
		const top = short.find((r) => r.selectors.some((x) => x.endsWith('.dynasty-lw-top')));
		expect(top).toBeDefined();
		expect(top!.body).toContain('padding-top: var(--size-4-2)');
	});

	it('makes the name fields grow and shrink: a height from the property, 44 px minimum, no resize, no scroll', () => {
		const rule = rules.find((r) => r.media === null && r.selectors.some((x) => x.includes('textarea.dynasty-lw-field')));
		expect(rule).toBeDefined();
		for (const d of ['height: var(--dynasty-lw-field-height, auto)', 'min-height: var(--input-height)', 'resize: none', 'overflow: hidden', 'overflow-wrap: anywhere', 'box-sizing: border-box']) expect(rule!.body, d).toContain(d);
	});

	it('gives every tappable part a hit area of at least 44 px', () => {
		// The Add button and the way back are buttons of the window family: 44 px on a phone and on every touch screen (10-edit-sheet.css).
		expect(css).toMatch(/\.dynasty-sheet\.is-phone \.dynasty-btn \{[^}]*min-height: 44px/);
		expect(css).toMatch(/@media \(pointer: coarse\) \{[^@]*\.dynasty-btn,[^}]*min-height: 44px/);
		const clear = declarations('dynasty-lw-clear');
		expect(clear).toMatch(/width:\s*44px/);
		expect(clear).toMatch(/height:\s*44px/);
		expect(declarations('dynasty-lw-row')).toMatch(/min-height:\s*56px/);
	});

	it('hides the native cancel button of the search box and draws the chevron with CSS', () => {
		expect(block).toContain('::-webkit-search-cancel-button');
		// The chevron of a row is the icon of the row anatomy (`dynasty-row-chev`).
		expect(css).toContain('.dynasty-row-chev');
	});

	it('keeps the focus ring on a row', () => {
		const rule = rules.find((r) => r.selectors.some((x) => x.endsWith('.dynasty-lw-row:focus-visible')));
		expect(rule).toBeDefined();
		expect(rule!.body).toContain('outline: 2px solid var(--text-normal)');
	});

	it('gives the name of the Back bar two text lines at most', () => {
		const d = declarations('dynasty-lw-back-name');
		expect(d).toContain('-webkit-line-clamp: 2');
		expect(d).toContain('overflow: hidden');
	});

	it('puts the two buttons of Other actions in one row on the computer, each full width on a phone', () => {
		// 0.2.8: the section "Other actions" holds two rows, one under the other, on every device.
		expect(declarations('dynasty-lw-actions-row')).toContain('display: grid');
	});

	it('keeps the two width rules of the old windows', () => {
		// 0.2.8: every window of the family is 620 px wide on a computer and top-anchored (10-edit-sheet.css); the old wide rules are gone.
		expect(css).toContain('width: min(620px, calc(100vw - 2 * var(--size-4-4)))');
		expect(css).not.toContain('.modal.dynasty-sheet.dynasty-titles:not(.is-phone)');
	});
});

describe('the texts (WIN_LIST_UI)', () => {
	const sample = (v: unknown): string[] => {
		if (typeof v === 'string') return [v];
		if (typeof v !== 'function') return [];
		const fn = v as (...a: unknown[]) => unknown;
		const out: string[] = [];
		for (const args of [['Aldric'], [1, 1], [1, 3], [0, 3], [2, 2]]) {
			try {
				out.push(String(fn(...args)));
			} catch {
				/* this argument set does not fit */
			}
		}
		return out;
	};
	const texts = Object.values(WIN_LIST_UI).flatMap(sample);

	it('has every entry', () => {
		expect(Object.keys(WIN_LIST_UI).length).toBeGreaterThanOrEqual(15);
		expect(texts.length).toBeGreaterThan(20);
	});

	it('has no straight quote mark', () => {
		for (const t of texts) expect(t, t).not.toMatch(/["']/);
	});

	it('has no -ing word', () => {
		for (const t of texts) expect(t, t).not.toMatch(/\b[A-Za-z]{3,}ing\b/);
	});

	it('uses none of the words that the owner word list forbids', () => {
		const banned = /\b(graph|diagram|chart|node|box|tile|union|edge|path|stroke|layer|rank|partition|family|file|document|commit|fixture|sprint|phase)\b/i;
		for (const t of texts) expect(t, t).not.toMatch(banned);
	});

	it('keeps a sentence short', () => {
		for (const t of texts) expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(20);
	});
});

// P8-24: the save pipeline that the Houses window and the Titles window share (keys, one batch write, the Undo notice, a failed write).
describe('the shared save pipeline', () => {
	class Piped extends TestWindow {
		keyOf = () => this.nextKey();
		write = (handle: never, ops: Op[], before: (() => void) | undefined) => this.writeBatch(handle, ops, before, 'test write');
		undo = (handle: never, ops: Op[], deleted: string[]) => this.undoAfterWrite(handle, { body: 'x' }, ops, deleted, (n) => `Gone: ${n.join(', ')}`);
		fail = (out: never, handle: never, onStale: (b: string) => void, onRefusal: (code: string, idText: string | null) => void) => this.failedWrite(out, handle, onStale, onRefusal as never);
		plain = (code: string) => this.refusedPlainly(code as never);
		sent = () => this.sentIds;
		isSaving = () => this.saving;
	}
	const idOp = { kind: 'set-title-id', id: 'a', to: 'b' } as unknown as Op;
	const textOp = { kind: 'set-title-fields', id: 'a', fields: {} } as unknown as Op;
	const handleOf = (write: () => Promise<unknown>) => ({ body: 'now', write }) as never;

	it('numbers the row keys h0, h1, … for houses and t0, t1, … for titles', () => {
		const h = new Piped([], 'houses');
		expect([h.keyOf(), h.keyOf()]).toEqual(['h0', 'h1']);
		const t = new Piped([], 'titles');
		expect([t.keyOf(), t.keyOf()]).toEqual(['t0', 't1']);
	});

	it('writes the ops as one batch; the window shows that it saves and tells the id ops', async () => {
		const w = new Piped();
		const order: string[] = [];
		const handle = handleOf(async () => {
			order.push(`write saving=${w.isSaving()}`);
			return { ok: true, body: 'next' };
		});
		const out = await w.write(handle, [idOp, textOp], () => order.push('before'));
		expect(out).toEqual({ ok: true, body: 'next' });
		expect(order).toEqual(['before', 'write saving=true']);
		expect(w.sent()).toBe(true);
		expect(w.isSaving()).toBe(false);
		expect(w.modal.hasClass('is-saving')).toBe(false);
		await w.write(handleOf(async () => ({ ok: true, body: 'n' })), [textOp], undefined);
		expect(w.sent()).toBe(false);
	});

	it('a write that throws gives null, the failed text, and the window can save again', async () => {
		const w = new Piped();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const out = await w.write(handleOf(async () => Promise.reject(new Error('disk'))), [textOp], undefined);
		expect(out).toBeNull();
		expect(notices).toContain(HOUSES.failed);
		expect(w.isSaving()).toBe(false);
	});

	it('the Undo notice names a delete, adds the "also" text when more was written, and else counts the id changes', () => {
		const w = new Piped();
		const handle = handleOf(async () => ({ ok: true, body: '' }));
		w.undo(handle, [textOp], ['Duke']);
		w.undo(handle, [textOp, textOp], ['Duke']);
		w.undo(handle, [idOp], []);
		w.undo(handle, [textOp], []);
		expect(notices).toHaveLength(3);
		expect(notices[0]).toBe('Gone: Duke');
		expect(notices[1]).toContain('Gone: Duke');
		expect(notices[1]).toContain(REMOVE.undoAlso);
		expect(notices[2]).toBe(ID_UI.changed(1));
	});

	it('a failed write: stale reloads, missing says so, a refusal gets its code and the id text only after an id op', async () => {
		const w = new Piped();
		const handle = handleOf(async () => ({ ok: true, body: '' }));
		const stale: string[] = [];
		const refusals: [string, string | null][] = [];
		const onRefusal = (code: string, idText: string | null) => refusals.push([code, idText]);
		w.fail({ ok: false, code: 'stale' } as never, handle, (b) => stale.push(b), onRefusal);
		expect(stale).toEqual(['now']);
		w.fail({ ok: false, code: 'missing' } as never, handle, (b) => stale.push(b), onRefusal);
		expect(notices).toContain(HOUSES.missing);
		const taken = { ok: false, code: 'refused', refusal: { code: 'id-taken' } } as never;
		await w.write(handleOf(async () => ({ ok: true, body: '' })), [textOp], undefined);
		w.fail(taken, handle, () => {}, onRefusal);
		await w.write(handleOf(async () => ({ ok: true, body: '' })), [idOp], undefined);
		w.fail(taken, handle, () => {}, onRefusal);
		expect(refusals).toEqual([
			['id-taken', null],
			['id-taken', ID_UI.inUse],
		]);
	});

	it('a refusal with no case of its own: blocked, invalid YAML, or the general text', () => {
		const w = new Piped();
		w.plain('blocked');
		w.plain('invalid-yaml');
		w.plain('unknown-title');
		expect(notices).toEqual([WRITE_TEXT.blocked, HOUSES.invalid, HOUSES.refused]);
	});
});
