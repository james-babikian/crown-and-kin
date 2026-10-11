/*
 * The shell of the Titles window and the Houses window as a searchable list with an edit page (spec §6.10,
 * §13.4, §13.16 rule 5; D134, D138; 0.2.8 contract C). It draws the frame of the window family (`window-shell.ts`: a footer
 * with Cancel and Save on a computer, a bar on a phone), the header of the list (an icon, the name, the number of items), the
 * fixed search bar with the Add button, the list of rows, the edit page with its back link, the questions over the window and
 * the error line. It also owns the close rules (a question, then a page, then the discard question, then the window), the focus
 * return, the search and the name fields that grow with their text. It never writes to a note: each window
 * (`titles-window.ts`, `houses-window.ts`) gives the rows, the page, the draft and the save pipeline, and
 * extends this class. The window is a draft (§13.0 item 6): the search, a page and Back never change it.
 */

import { Modal, Notice, setIcon, type App } from 'obsidian';
import type { EditResult, Op } from '../core/edit';
import { HOUSES, ID_UI, REMOVE, SHEET, TITLES_UI, WIN_LIST_UI, WINDOW_UI, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { idRefusalText, isIdOp } from './id-draft';
import { type IdRowView } from './id-field';
import { queryWords } from './list-search';
import { phoneLayout, settledReveal } from './modal-layout';
import type { PictureStore } from './picture-store';
import { trackModal } from './plugin-modals';
import { drawableColour, nameDialog, onWriteFailed, showErrorLine } from './sheet-parts';
import { undoNotice } from './undo-notice';
import { renderSections, type SectionSpec, type SectionsView } from './window-sections';
import { buildRow, iconLead, textButton } from './window-parts';
import { buildShell, type Shell } from './window-shell';

/**
 * The link of an arms picture when the picture store can find its file, else null. A row or a header has a picture lead only when
 * this is not null: the data decides, not the load of the picture (D213: no placeholder, no empty box).
 */
export function findableArms(store: PictureStore | undefined, link: string | null | undefined, sourcePath: string): string | null {
	const text = link?.trim();
	if (!store || !text) return null;
	try {
		return store.resolve(text, sourcePath).ok ? text : null;
	} catch {
		return null;
	}
}

/** Why `applyOp` refused an edit. */
type RefusalCode = Extract<EditResult, { ok: false }>['code'];

/** Which window the shell draws: the texts, the old class names and the data attribute follow it. */
export type ListKind = 'titles' | 'houses';

/** What a window tells the list about one item; the list draws one row from it. */
export interface ListRowView {
	/** The key of the item in the draft: it names the row and the page. */
	key: string;
	/** The saved ID, or null for an item that is not saved yet; the row shows `id ?? key` as data. */
	id?: string | null;
	name: string;
	/** The second text line. */
	summary: string;
	state: '' | 'new' | 'changed' | 'check-id';
	/** Houses only: the house colour as written (null: none). The second text line starts with a small dot of it (D214). */
	colour?: string | null;
	/** The link of the arms picture when the row has one that the plugin can find; null or absent: no picture, so no lead at all (D213). The window fills the arms box (`rowArms`). */
	arms?: string | null;
}

/** One button of a question over the window. `detail` makes it a choice with a second text line. */
export interface ConfirmButton {
	label: string;
	detail?: string;
	cls: string;
	run: () => void;
}

/** What a text field of an edit page needs. */
export interface TextFieldOptions {
	/** The old class of the field (for example `dynasty-title-name`): it goes on the label around the text area. */
	cls: string;
	label: string;
	value: string;
	placeholder?: string;
	aria: string;
	focus: string;
	onInput: (value: string) => void;
}

/** What the header of an edit page shows. */
export interface PageHead {
	/** Draws the arms at the right of the header, or the text link that adds them; absent: the header has no picture (D213). */
	lead?: (parent: HTMLElement) => void;
	name: string;
	/** The detail text line under the name; absent: the header has none (a house page: its count is the summary of the People section, D216 item 2). */
	meta?: string;
}

/** The texts and class names that differ between the two windows. */
const KINDS = {
	titles: {
		title: TITLES_UI.title,
		add: TITLES_UI.add,
		addClass: 'dynasty-title-add',
		none: TITLES_UI.none,
		remove: TITLES_UI.delete,
		search: WIN_LIST_UI.searchTitles,
		back: WIN_LIST_UI.backTitles,
		count: WIN_LIST_UI.matchTitles,
		noResult: WIN_LIST_UI.noResultTitles,
		name: 'Titles',
		icon: 'crown',
		meta: WINDOW_UI.listMetaTitles,
		idKind: 'title',
	},
	houses: {
		title: HOUSES.title,
		add: HOUSES.add,
		addClass: 'dynasty-house-add',
		none: HOUSES.none,
		remove: HOUSES.delete,
		search: WIN_LIST_UI.searchHouses,
		back: WIN_LIST_UI.backHouses,
		count: WIN_LIST_UI.matchHouses,
		noResult: WIN_LIST_UI.noResultHouses,
		name: 'Houses',
		icon: 'castle',
		meta: WINDOW_UI.listMetaHouses,
		idKind: 'house',
	},
} as const;


/** The keyboard has settled this many ms after the window stopped following it (as in the older windows). */
const SETTLE_MS = 150;
/** A field that gets the focus is brought into view this many ms later, when the keyboard has opened. */
const FOCUS_REVEAL_MS = 300;

const LINE_BREAKS = /\r\n|\r|\n/g;

/** The modal that both windows extend: the list, the edit page, the questions and the close rules. */
export abstract class ListEditWindow extends Modal {
	/** The key of the item whose edit page shows; null while the list shows. */
	protected page: string | null = null;
	/** The text in the search box. It stays when a page opens and when Back returns. */
	protected query = '';
	/** The scroll position of the list, kept while a page shows. */
	protected listTop = 0;
	protected closing = false;
	protected saving = false;
	/** The count of row keys made so far (see `nextKey`). */
	protected keys = 0;
	/** The batch that is being written had id ops: a refusal of `id-taken` or `bad-value` is about an id. */
	protected sentIds = false;
	/** A picker or a form is open over the window. */
	protected busy = false;
	/** True while the small ID window is open, so a second "Change ID" opens no second window. */
	protected idWindowOpen = false;
	protected error = '';
	protected errorEl: HTMLElement | null = null;
	protected confirmEl: HTMLElement | null = null;
	protected confirmFrom: string | null = null;
	protected readonly cleanup: (() => void)[] = [];
	/** The frame of the window now on screen; a window with a bar or a footer is drawn again when the phone layout changes. */
	protected shell: Shell | null = null;
	/** The sections of the page on screen now (null on the list). */
	protected sections: SectionsView | null = null;

	/** Which view is on screen now (a page key or the list), so a new draw can tell a new view from the same one. */
	private drawn: string | null | undefined = undefined;
	private builtPhone = false;
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	/** The keys of the rows that the list shows now: the order that a delete uses to find the next row. */
	private shownKeys: string[] = [];
	private pageOrder: string[] = [];
	private pageEl: HTMLElement | null = null;
	private headNameEl: HTMLElement | null = null;
	private idView: IdRowView | null = null;
	private deleteEl: HTMLElement | null = null;
	private deleteLabel: string | ((name: string) => string) = '';

	protected constructor(
		app: App,
		protected readonly kind: ListKind,
		private readonly modalClass: 'dynasty-titles' | 'dynasty-houses',
	) {
		super(app);
	}

	// ---------- what each window gives ----------

	/** The not deleted items in the order of the tree text; a new item is last. */
	protected abstract rowViews(): ListRowView[];
	/** Null: the row does not match. An empty text: it matches and needs no reason line. A text: the reason line. */
	protected abstract matchReason(key: string, words: readonly string[]): string | null;
	/** The name of an item, or "New title" / "New house" when it has none. */
	protected abstract labelOf(key: string): string;
	protected abstract isSaved(key: string): boolean;
	/** The header of an edit page: the lead, the name and the detail line. */
	protected abstract pageHead(key: string): PageHead;
	/** Draws the notes, the fields and the sections of the edit page into `page` (the shell has made the page element and the header). */
	protected abstract renderPage(page: HTMLElement, key: string): void;
	/** Adds a new item to the draft and returns its key. */
	protected abstract addItem(): string;
	/** Delete: a new item goes at once; a saved item asks first. Ends with `afterDelete(key)`. */
	protected abstract askDelete(key: string): void;
	protected abstract changeId(key: string): void;
	protected abstract isDirty(): boolean;
	protected abstract save(): Promise<void>;
	/** The text of the question "Discard changes?". */
	protected abstract discardText(): string;
	/** Runs last in `onClose`: the window lets go of what it holds and hands the focus back. */
	protected abstract released(): void;

	// ---------- hooks with a default ----------

	/** Runs in `onOpen` before the first draw: the window registers what it needs (for example a change listener). */
	protected opened(): void {
		/* nothing by default */
	}

	/** Runs at the start of each draw, before the old elements go: the window lets go of the pictures of the old rows. */
	protected beforeBuild(): void {
		/* nothing by default */
	}

	/** The rows of `list` are about to be drawn again: the window lets go of their pictures. */
	protected rowsGone(list: HTMLElement): void {
		void list;
	}

	/** True when the owner asks the system for less motion (D126): the scroll into view then jumps. */
	protected reduced(): boolean {
		return false;
	}

	/** A question closed with no answer or "Continue to edit": the window drops an action that waits for the answer. */
	protected dropWaiting(): void {
		/* nothing by default */
	}

	/** Fills the arms box of a row. The shell has made the box (`.dynasty-lw-armsbox`). */
	protected rowArms(box: HTMLElement, view: ListRowView): void {
		void view;
		box.empty();
	}

	// ---------- open and close ----------

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass(this.modalClass);
		this.modalEl.addClass('dynasty-lw');
		// One scroll after the keyboard has settled, not one at each step of its slide (M1 to M3).
		const settled = settledReveal(this.modalEl, this.contentEl, () => this.reduced());
		this.cleanup.push(
			phoneLayout(this, () => {
				settled.schedule(SETTLE_MS);
				// A turn of the phone changes the width, so the number of text lines of a name changes, and the frame can change (bar or footer).
				this.growFields();
				if (this.shell && this.modalEl.hasClass('is-phone') !== this.builtPhone) this.guard(() => this.build());
			}),
			trackModal(this, () => this.finish()),
			settled.cancel,
		);
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus (C1).
		const reveal = () => settled.schedule(FOCUS_REVEAL_MS);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
		this.guard(() => this.opened());
		this.guard(() => this.build());
		// Keyboard users start at the top of the window; the search box must not take the focus (a phone keyboard would open).
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	override onClose(): void {
		// The focused control goes with the window: let go of it first, so the focus can go back to the button that opened it.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		if (active && this.modalEl.contains(active)) active.blur();
		for (const c of this.cleanup.splice(0)) c();
		this.shell?.dispose();
		this.shell = null;
		this.sections = null;
		this.contentEl.empty();
		this.listEl = null;
		this.countEl = null;
		this.pageEl = null;
		this.headNameEl = null;
		this.guard(() => this.released());
	}

	/** Esc, the X button, a press outside and Android back: a question, then a page, then the discard question, then the window. */
	override close(): void {
		if (this.closing) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.dropWaiting();
			this.hideConfirm();
			return;
		}
		if (this.page !== null) {
			this.goBack();
			return;
		}
		if (this.isDirty()) {
			this.askDiscard(() => this.finish());
			return;
		}
		this.finish();
	}

	/** Closes the window with no question (Cancel, and a plugin that unloads). */
	protected finish(): void {
		this.closing = true;
		this.close();
	}

	// ---------- drawing ----------

	/** Draws the window again from the draft. `focus` names the control (`data-focus`) that gets the focus. */
	protected build(focus: string | null = null): void {
		const el = this.contentEl;
		const sameView = this.drawn === this.page;
		// A control that had the focus keeps it, so the focus never leaves the window; the control of another view is gone.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		const had = sameView && active && el.contains(active) ? active.getAttribute('data-focus') : null;
		focus ??= had;
		const top = sameView ? (el.querySelector<HTMLElement>('.dynasty-sheet-body')?.scrollTop ?? 0) : this.page === null ? this.listTop : 0;
		this.shell?.dispose();
		this.beforeBuild();
		el.empty();
		this.hideConfirm(false);
		this.listEl = null;
		this.countEl = null;
		this.pageEl = null;
		this.headNameEl = null;
		this.idView = null;
		this.deleteEl = null;
		this.sections = null;
		this.builtPhone = this.modalEl.hasClass('is-phone');
		const k = KINDS[this.kind];
		const onList = this.page === null;
		const shell = buildShell({
			modalEl: this.modalEl,
			contentEl: el,
			title: onList ? k.title : this.labelOf(this.page!),
			titled: true,
			// The list has nothing to save, so its only button is Close. With changes in the draft (a page made them) it keeps Cancel and Save.
			...(onList && !this.isDirty() ? { cancelLabel: SHEET.close, saveLabel: null } : {}),
			onCancel: () => this.finish(),
			onSave: () =>
				this.guard(() => {
					this.save().catch((e) => console.error(`Dynasty Tree: the ${k.name} window could not save`, e));
				}),
		});
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		if (onList) this.listTopBar(el, shell);
		else shell.setBack(k.title, k.back, () => this.guard(() => this.goBack()));
		const body = shell.body;
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.setText(this.error);
		this.errorEl.toggle(this.error !== '');
		if (onList) {
			this.countEl = body.createDiv({ cls: 'dynasty-lw-count', attr: { role: 'status', 'aria-live': 'polite' } });
			this.listEl = body.createEl('ul', { cls: 'dynasty-lw-list', attr: { role: 'list' } });
			this.listEl.addEventListener('keydown', (e) => this.onListKey(e));
			this.renderList();
		} else this.drawPage(body, this.page!);
		body.scrollTop = top;
		this.drawn = this.page;
		if (focus) this.focusFirst([focus]);
	}

	/** The header of the list and the fixed search bar with the Add button, above the part that scrolls. */
	private listTopBar(el: HTMLElement, shell: Shell): void {
		const k = KINDS[this.kind];
		const top = createDiv({ cls: 'dynasty-lw-top' });
		el.insertBefore(top, shell.body);
		const count = k.meta(this.rowViews().length);
		// On a phone the bar already says "Titles": the list starts with the search box, and its placeholder has the count.
		const phone = this.modalEl.hasClass('is-phone');
		if (!phone) {
			const head = top.createDiv({ cls: ['dynasty-head', 'dynasty-lw-head'] });
			const lead = head.createSpan({ cls: ['dynasty-row-lead', 'is-icon', 'is-list-icon'], attr: { 'aria-hidden': 'true' } });
			setIcon(lead, k.icon);
			const text = head.createDiv({ cls: 'dynasty-head-text' });
			text.createDiv({ cls: 'dynasty-head-name', text: k.title });
			text.createDiv({ cls: ['dynasty-head-meta', 'dynasty-lw-meta-count'], text: count });
		}
		this.searchBar(top, phone ? WINDOW_UI.searchWithCount(count) : k.search);
	}

	/** The fixed bar of the list: the search box and, beside it, the Add button. */
	private searchBar(el: HTMLElement, placeholder: string): void {
		const k = KINDS[this.kind];
		const bar = el.createDiv({ cls: ['dynasty-lw-bar', 'dynasty-listtools'] });
		const wrap = bar.createDiv({ cls: ['dynasty-lw-searchwrap', 'dynasty-search'] });
		setIcon(wrap.createSpan({ cls: 'dynasty-search-icon', attr: { 'aria-hidden': 'true' } }), 'search');
		const input = wrap.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-lw-search'],
			attr: {
				type: 'search',
				autocomplete: 'off',
				autocorrect: 'off',
				autocapitalize: 'off',
				spellcheck: 'false',
				enterkeyhint: 'search',
				placeholder,
				'aria-label': k.search,
				'data-focus': 'search',
			},
		});
		input.value = this.query;
		const clear = wrap.createEl('button', { cls: 'dynasty-lw-clear', attr: { type: 'button', 'aria-label': WIN_LIST_UI.clearSearch, 'data-focus': 'clear' } });
		setIcon(clear.createSpan({ cls: 'dynasty-lw-clear-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		clear.toggle(this.query !== '');
		// Typing only changes the count line and the list. The bar and the box stay, or the keyboard of a phone would close.
		input.addEventListener('input', () =>
			this.guard(() => {
				this.query = input.value;
				this.listTop = 0;
				clear.toggle(this.query !== '');
				this.renderList();
				const body = this.contentEl.querySelector<HTMLElement>('.dynasty-sheet-body');
				if (body) body.scrollTop = 0;
			}),
		);
		clear.addEventListener('click', () =>
			this.guard(() => {
				input.value = '';
				this.query = '';
				this.listTop = 0;
				clear.toggle(false);
				this.renderList();
				input.focus();
			}),
		);
		// Only ArrowDown. Home and End must move the caret in the text, and every other key is the box's own.
		input.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowDown' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
			const first = this.contentEl.querySelector<HTMLElement>('button.dynasty-lw-row');
			if (!first) return;
			e.preventDefault();
			first.focus();
		});
		textButton(bar, ['dynasty-btn', 'dynasty-lw-add', k.addClass], k.add, () => this.guard(() => this.add()), { icon: 'plus', focus: 'add' });
	}

	private drawPage(body: HTMLElement, key: string): void {
		const ref = this.dataRef(key);
		const page = body.createDiv({ cls: 'dynasty-lw-page', attr: { role: 'region', 'aria-label': WIN_LIST_UI.editPage(this.labelOf(key)) } });
		if (this.kind === 'titles') page.setAttribute('data-title', ref);
		else page.setAttribute('data-house', ref);
		this.pageEl = page;
		const h = this.pageHead(key);
		const head = page.createDiv({ cls: ['dynasty-head', 'dynasty-lw-pagehead'] });
		const text = head.createDiv({ cls: 'dynasty-head-text' });
		this.headNameEl = text.createDiv({ cls: ['dynasty-head-name', 'dynasty-lw-back-name'], text: h.name, attr: { role: 'heading', 'aria-level': '2' } });
		if (h.meta) text.createDiv({ cls: ['dynasty-head-meta', 'dynasty-lw-pagemeta'], text: h.meta });
		// The picture stands at the right of the name, as in the person window (D209, D213).
		h.lead?.(head);
		this.renderPage(page, key);
	}

	/** The saved ID of an item, or its key when it is not saved: the value of `data-title` / `data-house`. */
	protected dataRef(key: string): string {
		return this.rowViews().find((v) => v.key === key)?.id ?? key;
	}

	/** Draws the count line and the rows again, from the draft and the query. It never touches the bar. */
	protected renderList(): void {
		const list = this.listEl;
		const count = this.countEl;
		if (!list || !count || this.page !== null) return;
		const k = KINDS[this.kind];
		const all = this.rowViews();
		const words = queryWords(this.query);
		const reasons = new Map<string, string>();
		const shown = words.length
			? all.filter((v) => {
					const reason = this.matchReason(v.key, words);
					if (reason !== null) reasons.set(v.key, reason);
					return reason !== null;
				})
			: all;
		this.rowsGone(list);
		list.empty();
		this.shownKeys = shown.map((v) => v.key);
		if (!all.length) list.createEl('li', { cls: ['dynasty-lw-none', 'dynasty-sheet-none'], text: k.none });
		else if (!shown.length) list.createEl('li', { cls: ['dynasty-lw-none', 'dynasty-sheet-none'], text: k.noResult(this.query.trim()) });
		for (const v of shown) this.row(list, v, reasons.get(v.key) ?? '');
		const showCount = words.length > 0 && shown.length > 0;
		count.setText(showCount ? k.count(shown.length, all.length) : '');
		count.toggle(showCount);
	}

	private row(list: HTMLElement, v: ListRowView, reason: string): void {
		const li = list.createEl('li', { cls: 'dynasty-lw-item' });
		const ref = v.id ?? v.key;
		const rowAttr: Record<string, string> = { 'data-focus': `row:${v.key}` };
		rowAttr[this.kind === 'titles' ? 'data-title' : 'data-house'] = ref;
		const r = buildRow(li, {
			tap: () => this.guard(() => this.openPage(v.key)),
			cls: 'dynasty-lw-row',
			attr: rowAttr,
			// A row with no arms has no lead at all: no crown, no empty box, no colour disc (D213, D214).
			...(v.arms?.trim()
				? {
						lead: (row: HTMLElement) => {
							const box = row.createSpan({ cls: ['dynasty-row-lead', 'is-arms', 'dynasty-lw-armsbox'], attr: { 'aria-hidden': 'true' } });
							this.rowArms(box, v);
						},
					}
				: {}),
		});
		r.title.createSpan({ cls: 'dynasty-lw-row-name', text: v.name });
		if (v.state) r.title.createSpan({ cls: ['dynasty-lw-state', `is-${v.state}`], text: STATE_TEXT[v.state] });
		r.sub.addClass('dynasty-lw-row-sum');
		// D214: the house colour is a small dot before the count. It reaches the dot only through this property (spec §5.8).
		if (v.colour !== undefined && drawableColour(v.colour)) {
			const dot = r.sub.createSpan({ cls: 'dynasty-lw-dot', attr: { 'aria-hidden': 'true' } });
			dot.style.setProperty('--dynasty-house-color', v.colour);
		}
		r.sub.createSpan({ text: v.summary });
		if (reason) {
			const found = r.sub.parentElement?.createSpan({ cls: ['dynasty-lw-row-found', 'dynasty-row-sub'], text: reason, attr: { id: `${r.sub.id}-found` } });
			// The reason is part of the name of the row, after the two text lines.
			if (found && r.sub.id) r.row.setAttribute('aria-labelledby', `${r.row.getAttribute('aria-labelledby')} ${found.id}`);
		}
	}

	/** ArrowDown, ArrowUp, Home and End on a row move between the rows. Every other key and every target is left alone. */
	private onListKey(e: KeyboardEvent): void {
		if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
		const row = (e.target as HTMLElement).closest('button.dynasty-lw-row');
		const list = this.listEl;
		if (!row || !list) return;
		const rows = Array.from(list.querySelectorAll<HTMLElement>('button.dynasty-lw-row'));
		const at = rows.indexOf(row as HTMLElement);
		let to: HTMLElement | null | undefined;
		if (e.key === 'ArrowDown') to = rows[Math.min(at + 1, rows.length - 1)];
		else if (e.key === 'ArrowUp') to = at > 0 ? rows[at - 1] : this.contentEl.querySelector<HTMLElement>('input.dynasty-lw-search');
		else if (e.key === 'Home') to = rows[0];
		else if (e.key === 'End') to = rows[rows.length - 1];
		else return;
		e.preventDefault();
		to?.focus();
	}

	// ---------- pages ----------

	/** Shows the edit page of an item. Focus: the Back button unless `focus` names a control (on a phone no field takes it, so no keyboard opens). */
	openPage(key: string, focus = 'back'): void {
		if (this.page === null) {
			this.listTop = this.contentEl.querySelector<HTMLElement>('.dynasty-sheet-body')?.scrollTop ?? this.listTop;
			this.pageOrder = this.shownKeys.slice();
		}
		this.page = key;
		this.build(focus);
	}

	/** Back to the list: the query and the scroll stay, and the focus goes to the row just left, else to the search box. */
	goBack(): void {
		const key = this.page;
		if (key === null) return;
		this.page = null;
		this.build(null);
		this.focusFirst([`row:${key}`, 'search']);
	}

	/** The window removed an item from the draft: the list shows, and the focus goes to the row that took its place, else the row before, else Add. */
	protected afterDelete(key: string): void {
		const live = new Set(this.rowViews().map((v) => v.key));
		const at = this.pageOrder.indexOf(key);
		const next = at < 0 ? undefined : this.pageOrder.slice(at + 1).find((k) => live.has(k));
		const before = at < 0 ? undefined : this.pageOrder.slice(0, at).reverse().find((k) => live.has(k));
		this.page = null;
		this.build(null);
		this.focusFirst([next ? `row:${next}` : '', before ? `row:${before}` : '', 'add']);
	}

	/** Add: the page of the new item opens with the focus in its name field. A phone keyboard opens then, as in the older windows. */
	private add(): void {
		const key = this.addItem();
		this.query = '';
		this.error = '';
		this.shownKeys = this.rowViews().map((v) => v.key);
		this.openPage(key, `name:${key}`);
		this.listTop = 0;
	}

	/** The name of the item changed: the heading of the page, the bar title, the label of the page and the names of its buttons follow. */
	protected updateBackName(key: string): void {
		const name = this.labelOf(key);
		this.headNameEl?.setText(name);
		this.shell?.setTitle(name, true);
		this.pageEl?.setAttribute('aria-label', WIN_LIST_UI.editPage(name));
		this.idView?.setItem(name);
		const label = typeof this.deleteLabel === 'function' ? this.deleteLabel(name) : this.deleteLabel;
		if (label) this.deleteEl?.setAttribute('aria-label', label);
	}

	// ---------- parts of a page ----------

	/** Draws the sections of a page (open state kept for each kind of window; a new page keeps it in this window only) and keeps the footer line right when one opens. */
	protected drawSections(page: HTMLElement, kind: string, specs: readonly SectionSpec[], isNew = false): SectionsView {
		const view = renderSections(page, kind, specs, () => this.shell?.checkOverflow(), isNew ? this : undefined);
		this.sections = view;
		return view;
	}

	/** A labelled text field that grows and shrinks with its text, and takes no line break. */
	protected textField(page: HTMLElement, o: TextFieldOptions): HTMLTextAreaElement {
		const field = page.createEl('label', { cls: ['dynasty-sheet-field', o.cls] });
		field.createSpan({ cls: 'dynasty-sheet-label', text: o.label });
		const ta = field.createEl('textarea', {
			cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-lw-field'],
			attr: {
				rows: '1',
				autocomplete: 'off',
				// D196 item 1: a name is not a sentence, so the keyboard adds no capital and no correction.
				autocapitalize: 'off',
				autocorrect: 'off',
				spellcheck: 'false',
				enterkeyhint: 'done',
				placeholder: o.placeholder ?? null,
				'aria-label': o.aria,
				'data-focus': o.focus,
			},
		});
		ta.value = o.value;
		ta.addEventListener('input', () =>
			this.guard(() => {
				// A pasted line break becomes one space, before the value goes into the draft.
				const clean = ta.value.replace(LINE_BREAKS, ' ');
				if (clean !== ta.value) {
					const at = typeof ta.selectionStart === 'number' ? ta.value.slice(0, ta.selectionStart).replace(LINE_BREAKS, ' ').length : null;
					ta.value = clean;
					if (at !== null) ta.setSelectionRange(at, at);
				}
				this.clearError();
				o.onInput(clean);
				this.growField(ta);
			}),
		);
		ta.addEventListener('keydown', (e) => {
			// An IME uses Enter to accept its text (keyCode 229): leave it alone.
			if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			ta.blur();
		});
		this.growField(ta);
		return ta;
	}

	/**
	 * Makes the field as tall as its text. The property goes first: with it set, the field is still as tall as before,
	 * and `scrollHeight` is never smaller than that, so a name cut back to one word would keep the tall field.
	 */
	protected growField(el: HTMLTextAreaElement): void {
		el.style.removeProperty('--dynasty-lw-field-height');
		const h = el.scrollHeight;
		// `scrollHeight` leaves the border out and the box includes it.
		if (h > 0) el.style.setProperty('--dynasty-lw-field-height', `${h + Math.max(0, el.offsetHeight - el.clientHeight)}px`);
	}

	private growFields(): void {
		for (const ta of Array.from(this.contentEl.querySelectorAll<HTMLTextAreaElement>('textarea.dynasty-lw-field'))) this.growField(ta);
	}

	/**
	 * The section "Other actions" of a page: Change ID (a saved item only, with its hint) and Delete, then the ID line. The window
	 * puts it last in its list of sections. `deleteLabel` is the accessible name of Delete. The closed section has no summary: a list of
	 * commands previews nothing (D218 item 6).
	 */
	protected otherActionsSection(key: string, deleteCls: string, deleteLabel: string | ((name: string) => string)): SectionSpec {
		const k = KINDS[this.kind];
		const saved = this.isSaved(key);
		return {
			key: 'more',
			title: WINDOW_UI.sectionOther,
			summary: '',
			open: false,
			build: (body) => {
				const rows = body.createDiv({ cls: 'dynasty-rows dynasty-lw-actions-row' });
				const name = this.labelOf(key);
				if (saved) {
					const r = buildRow(rows, {
						tap: () => this.guard(() => this.changeId(key)),
						cls: ['dynasty-action-row', 'dynasty-id-open'],
						attr: { 'data-focus': `id-open:${key}` },
						label: ID_UI.openAria(name),
						chevron: false,
						lead: (row) => iconLead(row, 'hash'),
					});
					r.title.setText(ID_UI.open);
					r.sub.setText(ID_UI.hint(k.idKind));
					this.idView = {
						setItem: (item) => r.row.setAttribute('aria-label', ID_UI.openAria(item)),
						setProblem: () => undefined,
					};
				} else this.idView = null;
				this.deleteLabel = deleteLabel;
				const label = typeof deleteLabel === 'function' ? deleteLabel(name) : deleteLabel;
				const del = buildRow(rows, {
					tap: () => this.guard(() => this.askDelete(key)),
					cls: ['dynasty-action-row', 'is-danger', 'mod-warning', deleteCls],
					attr: { 'data-focus': `delete:${key}` },
					label,
					chevron: false,
					lead: (row) => iconLead(row, 'trash-2'),
				});
				del.title.setText(k.remove);
				this.deleteEl = del.row;
				const id = this.dataRef(key);
				if (saved) body.createDiv({ cls: ['dynasty-id', 'dynasty-sheet-id'], text: SHEET.idLine(id) });
			},
		};
	}

	// ---------- questions over the window ----------

	/** Draws a question over the window. The first button gets the focus; `from` names the control that gets it back. */
	protected showConfirm(title: string, text: string[], from: string | null, buttons: ConfirmButton[]): void {
		this.hideConfirm(false);
		// Without a named control, the focus goes back to the one that had it, else to Save (it must stay in the window).
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		this.confirmFrom = from ?? (active && this.contentEl.contains(active) ? active.getAttribute('data-focus') : null) ?? 'save';
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		// Title and text scroll if the screen is too low; the buttons below never scroll (D113 item 1).
		const scroll = box.createDiv({ cls: 'dynasty-sheet-confirm-scroll' });
		const titleEl = scroll.createDiv({ cls: 'dynasty-sheet-confirm-title', text: title });
		const titleId = `dynasty-${this.kind}-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of text) scroll.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const choices = buttons.some((b) => b.detail !== undefined) ? box.createDiv({ cls: 'dynasty-choice-options' }) : null;
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		let first: HTMLElement | null = null;
		for (const b of buttons) {
			const el = (b.detail !== undefined && choices ? choices : row).createEl('button', { cls: b.cls.split(' '), attr: { type: 'button' } });
			if (b.detail !== undefined) {
				el.createSpan({ cls: 'dynasty-choice-label', text: b.label });
				el.createSpan({ cls: 'dynasty-choice-detail', text: b.detail });
			} else el.setText(b.label);
			el.addEventListener('click', () => this.guard(b.run));
			first ??= el;
		}
		first?.focus();
	}

	protected hideConfirm(refocus = true): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		if (had && refocus && this.confirmFrom) this.refocus(this.confirmFrom);
		this.confirmFrom = null;
	}

	/** The question "Discard changes?"; `then` runs on "Discard changes". */
	protected askDiscard(then: () => void): void {
		this.showConfirm(SHEET.discardTitle, [this.discardText()], null, [
			{
				label: SHEET.keepEditing,
				cls: 'dynasty-sheet-keep',
				run: () => {
					this.dropWaiting();
					this.hideConfirm();
				},
			},
			{ label: SHEET.discard, cls: 'mod-warning dynasty-sheet-discard', run: then },
		]);
	}

	// ---------- error line, focus, guard ----------

	/** Shows `text` in the error line of the window (and keeps it for the next draw). */
	protected showError(text: string): void {
		this.error = text;
		showErrorLine(this.errorEl, text);
	}

	protected clearError(): void {
		if (!this.error) return;
		this.error = '';
		// The text goes too: a hidden line must not keep an old message that a screen reader or a test can still read.
		this.errorEl?.setText('');
		this.errorEl?.hide();
	}

	/** A refused write: a Notice and the error line. */
	protected refused(text: string): void {
		new Notice(text);
		this.showError(text);
	}

	// ---------- the save pipeline both windows share ----------

	/** The next row key: `h0`, `h1`, … in the Houses window and `t0`, `t1`, … in the Titles window. */
	protected nextKey(): string {
		return `${this.kind === 'houses' ? 'h' : 't'}${this.keys++}`;
	}

	/**
	 * The one question before Save changes an id (C4): `lines` say what changes and how many people. Closing it is Cancel;
	 * the other button runs `go`.
	 */
	protected askIdChange(count: number, lines: string[], go: () => void): void {
		this.showConfirm(ID_UI.confirmTitle(count), [...lines, REMOVE.canUndo], 'save', [
			{ label: ID_UI.keep, cls: 'dynasty-sheet-keep dynasty-id-keep', run: () => this.hideConfirm() },
			{
				label: ID_UI.change(count),
				cls: 'mod-cta dynasty-id-change',
				run: () => {
					this.hideConfirm();
					go();
				},
			},
		]);
	}

	/**
	 * Writes the ops of the draft as one batch (one Undo step, spec §6.1, D8). Gives the outcome, or null when the write threw: the error
	 * line shows then. The caller checks `saving` first. `beforeWrite` is the window's hook, `logText` the console text for a throw.
	 */
	protected async writeBatch(handle: Handle, ops: Op[], beforeWrite: (() => void) | undefined, logText: string): Promise<HandleWriteOutcome | null> {
		this.sentIds = ops.some(isIdOp);
		this.saving = true;
		this.modalEl.addClass('is-saving');
		try {
			beforeWrite?.();
			return await handle.write({ kind: 'batch', ops });
		} catch (e) {
			console.error(logText, e);
			this.refused(HOUSES.failed);
			return null;
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	/**
	 * The Undo notice after a good write: a delete says what went (and "also" when more was written), else an id change says how many.
	 * `deletedText` makes the text of the delete from the names.
	 */
	protected undoAfterWrite(handle: Handle, out: { body: string }, ops: Op[], deleted: string[], deletedText: (names: string[]) => string): void {
		const idCount = ops.filter(isIdOp).length;
		if (deleted.length) {
			const others = ops.length > deleted.length;
			undoNotice(others ? `${deletedText(deleted)} ${REMOVE.undoAlso}` : deletedText(deleted), handle, out.body);
		} else if (idCount) {
			undoNotice(ops.length > idCount ? `${ID_UI.changed(idCount)} ${REMOVE.undoAlso}` : ID_UI.changed(idCount), handle, out.body);
		}
	}

	/**
	 * Sends a failed write to its message. A stale note runs `stale` (the window's reload with its message); a missing note is the same in both windows. A refusal goes to `refusal` with its code
	 * and `idText` (§13.17 rule 5: `id-taken` and `bad-value` of an id op are about the id, never "changed under the window"; null when the
	 * batch had no id op). The window decides the order of its own cases.
	 */
	protected failedWrite(out: Exclude<HandleWriteOutcome, { ok: true }>, handle: Handle, stale: (body: string) => void, refusal: (code: RefusalCode, idText: string | null) => void): void {
		const detail = out.code === 'refused' ? out.refusal.detail : undefined;
		onWriteFailed(out, {
			stale: () => stale(handle.body),
			missing: () => this.refused(HOUSES.missing),
			refused: (code) => refusal(code, this.sentIds ? idRefusalText(code, detail) : null),
		});
	}

	/** The message of a refusal that has no case of its own in the window. */
	protected refusedPlainly(code: RefusalCode): void {
		if (code === 'blocked') this.refused(WRITE_TEXT.blocked);
		else if (code === 'invalid-yaml') this.refused(HOUSES.invalid);
		else this.refused(HOUSES.refused);
	}

	/** Gives the focus to the control with this `data-focus` name, unless the window closes. */
	protected refocus(focus: string): void {
		if (!this.closing) this.contentEl.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
	}

	/** Gives the focus to the first of the named controls that is on screen. */
	private focusFirst(names: string[]): void {
		for (const name of names) {
			if (!name) continue;
			const target = this.contentEl.querySelector<HTMLElement>(`[data-focus="${name}"]`);
			if (!target) continue;
			target.focus({ preventScroll: this.modalEl.hasClass('is-phone') });
			return;
		}
	}

	/** A failed step never leaves an exception in Obsidian (spec §8). */
	protected guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error(`Dynasty Tree: the ${KINDS[this.kind].name} window failed`, e);
		}
	}
}

const STATE_TEXT = { new: WIN_LIST_UI.stateNew, changed: WIN_LIST_UI.stateChanged, 'check-id': WIN_LIST_UI.stateCheckId } as const;
