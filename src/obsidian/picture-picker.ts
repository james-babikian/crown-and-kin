/*
 * The picture picker (spec §13.6 "Picture picker", D69; §13.14 picture list, D92 to D95; M9 contract O6
 * and B2). A window with a search bar and the vault's pictures that the plugin
 * can show, as a folder view (the current picture's folders open, "In use" on its row) or, while the
 * search field has a word, as a flat list. Each picture row has a small preview from the picture store.
 * When the caller's draft has a picture (`PickPictureOptions.remove`), the list starts with a Remove row
 * ("Remove arms" or "Remove portrait", D97); the picker then answers `remove` as well as `choose` and
 * `cancel`. Its next row, "Add a picture from this device", opens the device's file choice; the plugin checks the
 * file's format and size, copies it into Obsidian's attachment folder for the tree's note at once (not
 * part of a draft or of undo) and selects it. The picker gives the link text to write (`pictureLink`),
 * in a `PickResult`. The Houses window (arms) and the edit sheet (portrait) open it. The rules of the rows, the
 * keys and the taps are in `core/picture-list.ts`; this file only draws them.
 *
 * Rules of the view:
 * - Test seams. `pickPicture(app, options)` opens the picker. `createRowPreviews({ store, scroller, rows })`
 *   makes the preview loader, so a test drives it with a fake store, a fake scroller and a list of rows
 *   without a modal. `currentPictureOf` and `isTouchFirst` are exported too.
 * - Current picture. `PickPictureOptions.current` is a resolved file, never link text.
 *   `currentPictureOf(store, link, sourcePath)` returns `store.resolve(link, sourcePath).file` when the
 *   result is `ok`, else null. The Houses window passes the link of the row being edited from its draft
 *   (trimmed); the edit sheet passes its draft portrait (trimmed). The picker never writes `current`.
 * - Layout (D102). Header (title, Cancel, Select), then the search bar, then the sheet body with the list.
 *   The search field is in the bar, which never scrolls; only the sheet body scrolls, on the phone and on the
 *   computer. `pickerScroller(modalEl)` returns it. A field inside the scroller made iOS scroll the whole
 *   scroller when the keyboard opened, and the field left the view.
 * - Open. The list shows its top with the device row visible. Nothing calls `scrollIntoView` at open. The
 *   plugin sets `scrollTop = 0` at open, at `PICKER_TOP_MS` and on the first `visualViewport` resize, and
 *   stops as soon as the owner scrolls, presses a key, types or touches the window. Only Arrow keys and
 *   typing keep the cursor row in view; a tap, a folder open or close and a preview load never scroll.
 * - Keyboard focus (D95). On a touch-first device (`isTouchFirst`: `(pointer: coarse)` in the picker's own
 *   window) the search field gets no focus at open and no timer focuses it later. Elsewhere the field gets
 *   the focus at open and refocus timers run until the owner presses a key or a pointer.
 * - Rows. Each row is at least 44 px high, with `content-visibility: auto`, so a list of 2 000
 *   rows is cheap. Order: the device row, folders, then the root's pictures. A folder row has a chevron,
 *   the folder icon, the name and the count, indented for each depth by the CSS. `role="tree"` in
 *   the folder view; in the search the list is a `listbox` of `option`s. A folder row's label is
 *   `PICKER_UI.openFolder(path)` or `closeFolder(path)`. The current picture has the "In use" mark in both
 *   lists. The keys and taps are the reducers of `core/picture-list.ts`; a search with no match shows
 *   `noMatch`; more than `PICKER_SEARCH_LIMIT` matches show `PICKER_UI.more`. The keys are heard on the
 *   modal (capture), except on the Select and Cancel buttons; an IME key is ignored.
 * - Row previews. Each picture row starts with a `PREVIEW_BOX_PX` square that keeps the picture's own
 *   proportions. The copy comes from `store.acquire(file, PREVIEW_BOX, signal)`.
 *   a. The picker opens with names and empty boxes; the first `acquire` starts after the list is drawn.
 *   b. A row loads when `previewNear` is true, in `previewOrder`, at most `PREVIEW_LOADS` at once. This is
 *      checked after open, after each scroll (one animation frame), after a folder change and a search.
 *   c. A load is cancelled, and its copy released, when its row leaves the near range or is removed, or the
 *      picker closes. At close no copy is held.
 *   d. A problem result leaves a solid frame (`is-problem`), a missing file a dashed frame (`is-missing`);
 *      no text. A `null` result leaves the box empty and the next `update()` asks again if the row is near.
 *   e. A copy that arrives after its row was removed, left the near range, belongs to another request or
 *      arrives after `dispose()` is released at once.
 *   f. The `<img>` has `alt=""` and takes no pointer events.
 * - Add from this device (D69): `finish(link)` with the link of the copied file; Cancel or Esc during the
 *   copy writes no file (`closed`).
 */

import { Modal, Notice, setIcon, type App, type TFile } from 'obsidian';
import {
	buildPictureTree,
	openSetFor,
	pickerKey,
	pickerRows,
	pickerSwitch,
	pickerTap,
	previewOrder,
	rowKey,
	searchRows,
	toggleFolder,
	PICKER_SEARCH_LIMIT,
	type PickerAction,
	type PickerKey,
	type PickerRow,
	type PickerState,
	type PictureFileLike,
	type PictureTree,
} from '../core/picture-list';
import { folderOf } from '../core/link-text';
import { judgeHeader, readPictureHeader, type PictureProblem, type SupportedFormat } from '../core/pictures';
import { PICKER_UI, PICTURES_UI, deviceNotice } from '../render/ui-text';
import { NO_READ_BYTES, NO_READ_BYTES_COARSE, isShownPictureExtension, type CopyBox, type PictureCopy, type PictureStore } from './picture-store';
import { phoneLayout } from './modal-layout';
import { trackModal } from '../view/plugin-modals';
import { freePath } from './save-picture';
import { nameDialog } from './sheet-parts';
import { buildShell, type Shell } from './window-shell';
/** The preview box of a picture, in CSS px: a thumbnail in a grid of pictures (D212 picker-grid; D93 had a 32 px box in a row). */
export const PREVIEW_BOX_PX = 72;
/** The copy box of a row preview: the picture's own proportions, never cut. */
export const PREVIEW_BOX: CopyBox = { w: PREVIEW_BOX_PX, h: PREVIEW_BOX_PX, fit: 'meet' };
/** The most row previews that load at one time. */
export const PREVIEW_LOADS = 4;
/** The times, in ms, at which the scroller is put back to the top after open. */
export const PICKER_TOP_MS: readonly number[] = [0, 60, 200];

/** The part of a `TFile` that the picker reads from `current`; a test passes a plain object. */
export interface CurrentFileLike extends PictureFileLike {
	stat: { ctime: number; mtime: number; size: number };
}

/** One picture row as the preview loader sees it. */
export interface PreviewRowRef {
	/** The row's identity (`PickerRowKey`). */
	key: string;
	/** The picture to load. */
	file: TFile;
	/** The thumbnail box: the loader puts the `<img>` here and takes it away. */
	box: HTMLElement;
}

/** What `createRowPreviews` gets. */
export interface RowPreviewsOptions {
	/** The store; without it the boxes stay empty and nothing loads. */
	store: PictureStore | undefined;
	/** The element whose client rect is the visible part of the list. */
	scroller: HTMLElement;
	/** The picture rows now shown (called at each `update`). */
	rows: () => readonly PreviewRowRef[];
}

/** What the picker asks of its preview loader. */
export interface RowPreviews {
	/** Re-evaluates which rows are near (after open, scroll, open/close of a folder, a search change); a row that answered `null` asks again here. */
	update(): void;
	/** The rows were replaced: cancel and release what belongs to rows that are gone. */
	rowsChanged(): void;
	/** The picker closed: cancel every load and release every copy. */
	dispose(): void;
	/** For the harness and the tests. */
	readonly loading: number;
	readonly held: number;
}

/** What opens the picker. */
export interface PickPictureOptions {
	/** The tree's note: links are made from it, and a device picture goes to its attachment folder. */
	sourcePath: string;
	/** For the row previews; without it the rows show empty boxes. */
	store?: PictureStore;
	/** The window title, for example "Select the arms of House Valmont". */
	title: string;
	/** The short title of the bar of a phone window ("Portrait", "Arms"), so the long heading does not stand twice. Absent: `title`. */
	barTitle?: string;
	/** A quiet text line under the title (one for a portrait and one for personal arms). */
	hint?: string;
	/** The current picture as a resolved file (`currentPictureOf`), or null or absent for none. The picker only shows it. */
	current?: CurrentFileLike | null;
	/**
	 * D97: the text of the first row ("Remove arms"). The caller sets it only when its draft has a picture
	 * (the draft value is not empty, also when the file is missing); without it the list has no Remove row.
	 */
	remove?: string;
}

/** What the picker answers: a chosen picture (the link text to write), "remove the picture", or no change. */
export type PickResult = { kind: 'choose'; link: string } | { kind: 'remove' } | { kind: 'cancel' };

/** The cursor key of the Remove row; the model of `core/picture-list.ts` does not know this row. */
const REMOVE_KEY = 'remove';

/** The most rows whose position one update reads: a guard for a hidden list, whose rows all report the same place. */
const NEAR_ROWS_MAX = 150;

/**
 * O6: the written link of a vault file, as Obsidian makes it (the owner's link settings), with no
 * leading "!" (spec §13.0 item 3).
 */
export function pictureLink(app: App, file: TFile, sourcePath: string): string {
	return app.fileManager.generateMarkdownLink(file, sourcePath).replace(/^!/, '');
}

/** A file name Obsidian accepts: characters that links or file systems cannot hold become "-". */
export function safePictureName(name: string, format: SupportedFormat): string {
	const ext = format === 'jpeg' ? 'jpg' : format;
	let n = (typeof name === 'string' ? name : '').replace(/[\\/:*?"<>|#^[\]]/g, '-').trim();
	if (!n || n.startsWith('.')) n = `picture${n}`;
	const dot = n.lastIndexOf('.');
	const own = dot > 0 ? n.slice(dot + 1).toLowerCase() : '';
	// A name with no picture extension (a phone can give "image") gets the one of its bytes.
	return isShownPictureExtension(own) ? n : `${n}.${ext}`;
}

/** The folder of a vault path, '' at the top. */

/** The resolved file of a link from the caller's draft, or null; the same `store.resolve` as the cards. Never throws. */
export function currentPictureOf(store: PictureStore | undefined, link: string | null | undefined, sourcePath: string): TFile | null {
	try {
		if (!store || typeof link !== 'string' || link.trim() === '') return null;
		const r = store.resolve(link, sourcePath);
		return r.ok ? r.file : null;
	} catch {
		return null;
	}
}

/** True on a touch-first device, from the picker's own window; a missing or failing `matchMedia` is false. */
export function isTouchFirst(win: Window): boolean {
	try {
		return win.matchMedia?.('(pointer: coarse)')?.matches === true;
	} catch {
		return false;
	}
}

/** The element that scrolls the list: the sheet body, on the phone and on the computer. The search bar is not inside it (D102). */
export function pickerScroller(modalEl: HTMLElement): HTMLElement {
	return modalEl.querySelector<HTMLElement>('.dynasty-sheet-body') ?? modalEl;
}

// ---------- the row previews ----------

interface PreviewEntry {
	key: string;
	file: TFile;
	box: HTMLElement;
	/** 'retry' = the store answered null; only an `update` asks again. */
	state: 'idle' | 'retry' | 'loading' | 'ready' | 'problem';
	/** The identity of the running request: an answer for another request is released at once. */
	load: object | null;
	ctl: AbortController | null;
	copy: PictureCopy | null;
	img: HTMLElement | null;
}

/**
 * makes the preview loader. It has no modal in it, so a test drives it with a fake store and a fake
 * scroller. Rows load in the order of `previewOrder`, at most `PREVIEW_LOADS` at once; a row that leaves
 * the near range or is removed is cancelled and its copy released.
 */
export function createRowPreviews(o: RowPreviewsOptions): RowPreviews {
	const entries = new Map<string, PreviewEntry>();
	let queue: PreviewEntry[] = [];
	let running = 0;
	let held = 0;
	let disposed = false;

	/** Cancels a load, releases the copy and empties the box. */
	const clear = (e: PreviewEntry): void => {
		if (e.state === 'loading') {
			e.ctl?.abort();
			running--;
		}
		if (e.copy) {
			e.copy.release();
			held--;
		}
		e.img?.remove();
		e.box.removeClass('is-problem');
		e.box.removeClass('is-missing');
		e.ctl = null;
		e.load = null;
		e.copy = null;
		e.img = null;
		e.state = 'idle';
	};

	/** The list drew the row again: the picture moves to the new box, so nothing flickers. */
	const rehome = (e: PreviewEntry, box: HTMLElement): void => {
		if (e.box === box) return;
		if (e.img) box.appendChild(e.img);
		if (e.state === 'problem') {
			const missing = e.box.hasClass('is-missing');
			e.box.removeClass('is-problem');
			e.box.removeClass('is-missing');
			box.addClass('is-problem');
			if (missing) box.addClass('is-missing');
		}
		e.box = box;
	};

	const finish = (e: PreviewEntry, load: object, res: PictureCopy | PictureProblem | null): void => {
		const copy = res && 'url' in res ? res : null;
		if (disposed || e.load !== load || entries.get(e.key) !== e) {
			copy?.release();
			return;
		}
		running--;
		e.load = null;
		e.ctl = null;
		if (copy) {
			e.copy = copy;
			held++;
			e.state = 'ready';
			e.img = e.box.createEl('img', { cls: 'dynasty-picture-thumb-img', attr: { src: copy.url, alt: '' } });
		} else if (res) {
			e.state = 'problem';
			e.box.addClass('is-problem');
			// Only a file that is not in the vault gets the dashed frame.
			if ('code' in res && res.code === 'missing-picture') e.box.addClass('is-missing');
		} else {
			e.state = 'retry';
		}
		pump();
	};

	const start = (e: PreviewEntry, store: PictureStore): void => {
		const load = {};
		const ctl = new AbortController();
		e.state = 'loading';
		e.load = load;
		e.ctl = ctl;
		running++;
		let asked: Promise<PictureCopy | PictureProblem | null>;
		try {
			asked = store.acquire(e.file, PREVIEW_BOX, ctl.signal);
		} catch {
			asked = Promise.resolve(null);
		}
		asked.then(
			(r) => finish(e, load, r),
			() => finish(e, load, null),
		);
	};

	const pump = (): void => {
		const store = o.store;
		while (store && !disposed && running < PREVIEW_LOADS && queue.length) {
			const e = queue.shift()!;
			if (entries.get(e.key) === e && e.state === 'idle') start(e, store);
		}
	};

	return {
		update() {
			if (disposed || !o.store) return;
			const rows = o.rows();
			// The rect of the row that holds the box, not of the box: a row that `content-visibility` skips has its
			// remembered size, and asking for the box would make the browser lay the row out again.
			const rectOf = (i: number) => (rows[i].box.parentElement ?? rows[i].box).getBoundingClientRect();
			const view = o.scroller.getBoundingClientRect();
			const band = { top: view.top, bottom: view.bottom };
			const margin = band.bottom - band.top;
			// Rows are in document order, so the first near row is found by a search and only the near rows are read.
			let lo = 0;
			let hi = rows.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (rectOf(mid).bottom >= band.top - margin) hi = mid;
				else lo = mid + 1;
			}
			const at: number[] = [];
			const bands: { top: number; bottom: number }[] = [];
			for (let i = lo; i < rows.length && at.length < NEAR_ROWS_MAX; i++) {
				const r = rectOf(i);
				if (r.top > band.bottom + margin) break;
				at.push(i);
				bands.push({ top: r.top, bottom: r.bottom });
			}
			queue = [];
			const near = new Set<string>();
			for (const k of previewOrder(bands, band)) {
				const ref = rows[at[k]];
				near.add(ref.key);
				let e = entries.get(ref.key);
				if (!e) {
					e = { key: ref.key, file: ref.file, box: ref.box, state: 'idle', load: null, ctl: null, copy: null, img: null };
					entries.set(ref.key, e);
				} else {
					rehome(e, ref.box);
					e.file = ref.file;
				}
				if (e.state === 'retry') e.state = 'idle';
				if (e.state === 'idle') queue.push(e);
			}
			for (const [key, e] of entries) {
				if (near.has(key)) continue;
				clear(e);
				entries.delete(key);
			}
			pump();
		},
		rowsChanged() {
			queue = [];
			const live = new Map(o.rows().map((r) => [r.key, r] as const));
			for (const [key, e] of entries) {
				const ref = live.get(key);
				if (!ref) {
					clear(e);
					entries.delete(key);
				} else {
					rehome(e, ref.box);
					e.file = ref.file;
				}
			}
		},
		dispose() {
			disposed = true;
			queue = [];
			for (const e of entries.values()) clear(e);
			entries.clear();
		},
		get loading() {
			return running;
		},
		get held() {
			return held;
		},
	};
}

// ---------- the window ----------

type PickerTreeRow = PickerRow<TFile>;

const HANDLED_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '];
/** What the owner does that ends the scroll reset. */
const OWNER_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown', 'input'] as const;

class PicturePicker extends Modal {
	private readonly tree: PictureTree<TFile>;
	private openFolders: Set<string>;
	private state: PickerState;
	private rows: PickerTreeRow[] = [];
	private refs: { key: string; file: TFile; box: HTMLElement }[] = [];
	private els: HTMLElement[] = [];
	private index = new Map<string, number>();
	private marked: HTMLElement[] = [];
	private searching = false;
	private chosen = false;
	private busy = false;
	private closed = false;
	private listEl: HTMLElement | null = null;
	private searchEl: HTMLInputElement | null = null;
	private selectEl: HTMLButtonElement | null = null;
	private removeEl: HTMLElement | null = null;
	private fileInput: HTMLInputElement | null = null;
	private scroller: HTMLElement | null = null;
	private previews: RowPreviews | null = null;
	private shell: Shell | null = null;
	/** The owner has scrolled, pressed a key, typed or touched: the plugin leaves the scroll alone. */
	private acted = false;
	/** A key or a pointer: the search field is not given the focus back. */
	private touched = false;
	private frame = 0;
	private readonly timers: number[] = [];
	private readonly cleanup: (() => void)[] = [];

	constructor(
		app: App,
		private readonly o: PickPictureOptions,
		private readonly done: (result: PickResult) => void,
	) {
		super(app);
		let files: TFile[] = [];
		try {
			files = app.vault.getFiles();
		} catch {
			files = [];
		}
		this.tree = buildPictureTree(files, (f) => isShownPictureExtension(f.extension));
		// The current picture counts only if it is a picture in the list.
		const cur = this.o.current && this.tree.entries.has(this.o.current.path) ? this.o.current.path : null;
		this.openFolders = openSetFor(this.tree, cur);
		this.state = { cursor: cur === null ? null : `picture:${cur}`, selected: cur, armed: false };
	}

	private get pickerWin(): Window {
		return this.modalEl.win ?? window;
	}

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-picture-picker');
		this.cleanup.push(phoneLayout(this), trackModal(this, () => this.close()));
		const el = this.contentEl;
		el.empty();
		// The window family (contract C): a bar on a phone, a footer on a computer; Select is the main button.
		const shell = buildShell({
			modalEl: this.modalEl,
			contentEl: el,
			// A phone shows the long heading in the page under the bar; its bar then says only what is picked.
			title: this.modalEl.hasClass('is-phone') && this.o.barTitle ? this.o.barTitle : this.o.title,
			titled: true,
			cancelLabel: PICTURES_UI.cancel,
			saveLabel: PICTURES_UI.select,
			onCancel: () => this.close(),
			onSave: () => this.guard(() => this.chooseSelected()),
			buttons: { save: { cls: ['dynasty-picture-select'] } },
		});
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		this.selectEl = shell.save;
		const body = shell.body;

		// The bar is a sibling of the scroller, not a child: iOS scrolls the scroller that holds the focused field.
		const top = createDiv({ cls: 'dynasty-picture-top' });
		el.insertBefore(top, body);
		const intro = top.createDiv({ cls: 'dynasty-picture-intro' });
		const heading = intro.createDiv({ cls: 'dynasty-picture-heading', text: this.o.title, attr: { id: 'dynasty-picture-heading' } });
		if (this.o.hint) intro.createDiv({ cls: 'dynasty-picture-hint', text: this.o.hint });
		const bar = top.createDiv({ cls: 'dynasty-picture-searchbar' });
		const search = bar.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input', 'dynasty-picture-search'],
			attr: { type: 'search', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: PICTURES_UI.search, 'aria-label': PICTURES_UI.searchLabel, 'aria-controls': 'dynasty-picture-list' },
		});
		this.searchEl = search;
		search.addEventListener('input', () => this.guard(() => this.onSearch()));
		this.listEl = body.createDiv({ cls: 'dynasty-picture-list', attr: { id: 'dynasty-picture-list', 'aria-labelledby': heading.id } });
		// The device's file choice (Photos or Files on an iPhone, D69); hidden, opened by the first row.
		const input = body.createEl('input', { cls: 'dynasty-picture-file', attr: { type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true' } });
		// Hidden as in the M9 iPhone check, where a click from a button opened Photos and Files.
		input.hide();
		input.addEventListener('change', () => {
			const f = input.files?.[0];
			input.value = '';
			if (f) void this.fromDevice(f);
		});
		this.fileInput = input;

		const scroller = pickerScroller(this.modalEl);
		this.scroller = scroller;
		this.previews = createRowPreviews({ store: this.o.store, scroller, rows: () => this.refs });
		this.listen();
		this.guard(() => this.render(false));
		this.keepAtTop();
		// A touch-first device never focuses the search field, so the keyboard stays closed. The focus goes to the window
		// itself, so it is inside the dialog (a screen reader, the Tab key) and no keyboard opens.
		if (!isTouchFirst(this.pickerWin)) this.focusSearch();
		else {
			this.modalEl.setAttribute('tabindex', '-1');
			this.modalEl.focus({ preventScroll: true });
		}
		this.scheduleUpdate();
	}

	override onClose(): void {
		this.closed = true;
		for (const c of this.cleanup.splice(0)) c();
		for (const t of this.timers.splice(0)) this.pickerWin.clearTimeout(t);
		if (this.frame) this.pickerWin.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.previews?.dispose();
		this.previews = null;
		this.shell?.dispose();
		this.shell = null;
		this.contentEl.empty();
		// A promise settles once: a choice already resolved it.
		if (!this.chosen) this.done({ kind: 'cancel' });
	}

	/** A failed step never leaves an exception in Obsidian (spec §8). */
	private guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Crown and Kin: the picture picker failed', e);
		}
	}

	/** The listeners of the window: the owner's actions, the keys and the scroll. */
	private listen(): void {
		const modal = this.modalEl;
		const scroller = this.scroller!;
		const on = (t: HTMLElement, type: string, fn: (e: Event) => void, opts: AddEventListenerOptions) => {
			t.addEventListener(type, fn, opts);
			this.cleanup.push(() => t.removeEventListener(type, fn, opts));
		};
		for (const type of OWNER_EVENTS) on(modal, type, () => (this.acted = true), { capture: true, passive: true });
		for (const type of ['pointerdown', 'keydown']) on(modal, type, () => (this.touched = true), { capture: true, passive: true });
		on(modal, 'keydown', (e) => this.guard(() => this.onKey(e as KeyboardEvent)), { capture: true });
		on(scroller, 'scroll', () => this.scheduleUpdate(), { passive: true });
	}

	/** The list shows its top; nothing scrolls a row into view at open. */
	private keepAtTop(): void {
		const top = () => {
			if (!this.acted && this.scroller) this.scroller.scrollTop = 0;
		};
		top();
		for (const ms of PICKER_TOP_MS) this.timers.push(this.pickerWin.setTimeout(top, ms));
		const vv = this.pickerWin.visualViewport;
		if (vv) {
			const once = () => {
				vv.removeEventListener('resize', once);
				top();
			};
			vv.addEventListener('resize', once);
			this.cleanup.push(() => vv.removeEventListener('resize', once));
		}
	}

	/** The search field takes the focus back from Obsidian until the owner presses a key or a pointer. */
	private focusSearch(): void {
		this.searchEl?.focus({ preventScroll: true });
		for (const ms of [0, 60, 200]) {
			this.timers.push(
				this.pickerWin.setTimeout(() => {
					if (this.touched || !this.searchEl || this.modalEl.doc?.activeElement === this.searchEl) return;
					this.searchEl.focus({ preventScroll: true });
				}, ms),
			);
		}
	}

	/** V6b: one frame after a change, the previews look at what is near. */
	private scheduleUpdate(): void {
		if (this.frame || !this.previews) return;
		this.frame = this.pickerWin.requestAnimationFrame(() => {
			this.frame = 0;
			this.guard(() => this.previews?.update());
		});
	}

	// ---------- the rows ----------

	private onSearch(): void {
		this.render(true);
		this.keepRowInView();
	}

	/** Draws the rows for the search text or the open folders; `switching` keeps the cursor on the selected picture. */
	private render(switching: boolean): void {
		const list = this.listEl;
		if (!list) return;
		const query = this.searchEl?.value ?? '';
		this.searching = query.split(/\s+/).some(Boolean);
		const current = this.o.current?.path ?? null;
		let more = false;
		if (this.searching) {
			const r = searchRows(this.tree, query, current, PICKER_SEARCH_LIMIT);
			this.rows = r.rows;
			more = r.more;
		} else {
			this.rows = pickerRows(this.tree, this.openFolders, current);
		}
		if (switching) this.state = pickerSwitch(this.rows, this.state);
		list.setAttribute('role', this.searching ? 'listbox' : 'tree');
		list.empty();
		this.removeEl = null;
		if (this.o.remove) this.drawRemove(list, this.o.remove);
		this.refs = [];
		this.els = [];
		this.index.clear();
		this.marked = [];
		this.rows.forEach((row, i) => this.drawRow(list, row, i));
		if (this.rows.length === 1) list.createDiv({ cls: 'dynasty-picture-none', text: this.tree.count ? PICTURES_UI.noMatch : PICTURES_UI.noPictures });
		else if (more) list.createDiv({ cls: 'dynasty-picture-none', text: PICKER_UI.more });
		this.previews?.rowsChanged();
		this.mark();
		this.scheduleUpdate();
	}

	/** D97: the Remove row, above the device row. It is not a row of the model, so it has no place in `rows`, `els` or `index`. */
	private drawRemove(list: HTMLElement, label: string): void {
		const el = list.createDiv({ cls: ['dynasty-picture-row', 'dynasty-picture-remove'], attr: { role: this.searching ? 'option' : 'treeitem', id: 'dynasty-picture-row-remove', 'data-remove': 'true' } });
		if (!this.searching) el.setAttribute('aria-level', '1');
		el.createSpan({ cls: 'dynasty-picture-plus', text: '×', attr: { 'aria-hidden': 'true' } });
		const text = el.createDiv({ cls: 'dynasty-picture-text' });
		text.createDiv({ cls: 'dynasty-picture-name', text: label });
		el.addEventListener('click', () => this.guard(() => this.removeChosen()));
		this.removeEl = el;
	}

	private drawRow(list: HTMLElement, row: PickerTreeRow, i: number): void {
		const key = rowKey(row);
		const tree = !this.searching;
		const el = list.createDiv({ cls: 'dynasty-picture-row', attr: { role: tree ? 'treeitem' : 'option', id: `dynasty-picture-row-${i}` } });
		this.els.push(el);
		this.index.set(key, i);
		if (row.kind === 'device') {
			el.addClass('dynasty-picture-device');
			if (tree) el.setAttribute('aria-level', '1');
			el.createSpan({ cls: 'dynasty-picture-plus', text: '+', attr: { 'aria-hidden': 'true' } });
			const text = el.createDiv({ cls: 'dynasty-picture-text' });
			text.createDiv({ cls: 'dynasty-picture-name', text: PICTURES_UI.fromDevice });
			text.createDiv({ cls: 'dynasty-picture-folder', text: PICTURES_UI.fromDeviceDetail });
		} else if (row.kind === 'folder') {
			const label = row.open ? PICKER_UI.closeFolder(row.folder.path) : PICKER_UI.openFolder(row.folder.path);
			el.addClass('dynasty-picture-folder-row');
			el.toggleClass('is-open', row.open);
			el.setAttribute('aria-expanded', String(row.open));
			el.setAttribute('aria-level', String(row.depth + 1));
			el.setAttribute('aria-label', label);
			el.setAttribute('title', label);
			el.setAttribute('data-folder', row.folder.path);
			el.style.setProperty('--dynasty-picker-depth', String(row.depth));
			setIcon(el.createSpan({ cls: 'dynasty-picture-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
			setIcon(el.createSpan({ cls: 'dynasty-picture-folder-icon', attr: { 'aria-hidden': 'true' } }), 'folder');
			el.createSpan({ cls: 'dynasty-picture-folder-name', text: row.folder.name });
			el.createSpan({ cls: 'dynasty-picture-count', text: String(row.folder.count) });
		} else {
			const file = row.entry.file;
			el.setAttribute('data-path', file.path);
			el.setAttribute('title', file.path);
			el.setAttribute('aria-selected', 'false');
			if (tree) {
				el.setAttribute('aria-level', String(row.depth + 1));
				el.style.setProperty('--dynasty-picker-depth', String(row.depth));
				el.createSpan({ cls: 'dynasty-picture-spacer', attr: { 'aria-hidden': 'true' } });
			}
			const box = el.createSpan({ cls: 'dynasty-picture-thumb', attr: { 'aria-hidden': 'true' } });
			const text = el.createDiv({ cls: 'dynasty-picture-text' });
			text.createDiv({ cls: 'dynasty-picture-name', text: file.name });
			if (!tree) text.createDiv({ cls: 'dynasty-picture-folder', text: row.entry.folder || PICTURES_UI.topFolder });
			if (row.inUse) {
				const mark = el.createSpan({ cls: 'dynasty-picture-inuse', attr: { 'aria-label': PICKER_UI.inUseLabel, title: PICKER_UI.inUseLabel } });
				setIcon(mark.createSpan({ cls: 'dynasty-picture-inuse-icon', attr: { 'aria-hidden': 'true' } }), 'check');
				mark.createSpan({ text: PICKER_UI.inUse });
			}
			this.refs.push({ key, file, box });
		}
		el.addEventListener('click', () => this.guard(() => this.onTap(key)));
	}

	/** Marks the selected picture, the cursor row and the Select button from `state`. */
	private mark(): void {
		for (const el of this.marked) {
			el.removeClass('is-selected');
			el.removeClass('is-cursor');
			if (el.getAttribute('aria-selected') === 'true') el.setAttribute('aria-selected', 'false');
		}
		this.marked = [];
		const { cursor, selected } = this.state;
		const selectedAt = selected === null ? undefined : this.index.get(`picture:${selected}`);
		if (selectedAt !== undefined) {
			this.els[selectedAt].addClass('is-selected');
			this.marked.push(this.els[selectedAt]);
		}
		const cursorAt = cursor === null ? undefined : this.index.get(cursor);
		if (cursor === REMOVE_KEY && this.removeEl) {
			this.removeEl.addClass('is-cursor');
			this.marked.push(this.removeEl);
			this.searchEl?.setAttribute('aria-activedescendant', 'dynasty-picture-row-remove');
		} else if (cursorAt !== undefined) {
			const el = this.els[cursorAt];
			el.addClass('is-cursor');
			// A picture row is "selected" for a screen reader when the keys act on it and it is the selected picture.
			if (cursorAt === selectedAt) el.setAttribute('aria-selected', 'true');
			this.marked.push(el);
			this.searchEl?.setAttribute('aria-activedescendant', el.getAttribute('id') ?? '');
		} else {
			this.searchEl?.removeAttribute('aria-activedescendant');
		}
		if (this.selectEl) this.selectEl.disabled = selected === null;
	}

	/** Only the Arrow keys and typing scroll the cursor row into view. */
	private keepRowInView(): void {
		if (this.state.cursor === REMOVE_KEY) {
			this.removeEl?.scrollIntoView?.({ block: 'nearest' });
			return;
		}
		const at = this.state.cursor === null ? undefined : this.index.get(this.state.cursor);
		if (at !== undefined) this.els[at].scrollIntoView?.({ block: 'nearest' });
	}

	// ---------- keys and taps (the rules are the reducers of core/picture-list.ts) ----------

	private onKey(e: KeyboardEvent): void {
		// An IME uses these keys to build text; they are not ours.
		if (e.isComposing || e.keyCode === 229) return;
		if (e.ctrlKey || e.metaKey || e.altKey || !HANDLED_KEYS.includes(e.key)) return;
		// A key on Select or Cancel belongs to that button.
		if ((e.target as HTMLElement | null)?.closest?.('button')) return;
		if (this.removeEl && this.onRemoveKey(e)) return;
		const before = this.state.cursor;
		const step = pickerKey(this.rows, this.state, e.key as PickerKey);
		this.state = step.state;
		if (step.action === 'none') {
			if (this.state.cursor === before) return;
			e.preventDefault();
			this.mark();
			this.keepRowInView();
			return;
		}
		e.preventDefault();
		this.act(step.action);
		if (e.key.startsWith('Arrow')) this.keepRowInView();
	}

	/**
	 * D97: the keys around the Remove row, which sits before the first row of the model. Down from no
	 * cursor, and Up from the first row, land on it; Down from the last row also lands on it. Enter on it
	 * removes. Returns true when the key is dealt with here.
	 */
	private onRemoveKey(e: KeyboardEvent): boolean {
		const { cursor } = this.state;
		const onRemove = cursor === REMOVE_KEY;
		const down = e.key === 'ArrowDown';
		const up = e.key === 'ArrowUp';
		if (onRemove && e.key === 'Enter') {
			e.preventDefault();
			this.removeChosen();
			return true;
		}
		let toRemove = false;
		if (!onRemove && (down || up)) {
			const first = this.rows.length ? rowKey(this.rows[0]) : null;
			const last = this.rows.length ? rowKey(this.rows[this.rows.length - 1]) : null;
			const at = cursor === null ? -1 : this.rows.findIndex((r) => rowKey(r) === cursor);
			toRemove = (down && (at < 0 || cursor === last)) || (up && cursor === first);
		}
		if (toRemove) {
			e.preventDefault();
			this.state = { ...this.state, cursor: REMOVE_KEY };
			this.mark();
			this.keepRowInView();
			return true;
		}
		if (!onRemove) return false;
		if (down || up) {
			// Leave the Remove row: the model starts from "no cursor", so Down gives the first row and Up the last.
			e.preventDefault();
			this.state = pickerKey(this.rows, { ...this.state, cursor: null }, e.key).state;
			this.mark();
			this.keepRowInView();
		}
		// The other keys do nothing on this row, and the search field keeps them (the caret, the space).
		return true;
	}

	private onTap(key: string): void {
		const step = pickerTap(this.rows, this.state, key);
		this.state = step.state;
		if (step.action === 'none') {
			this.mark();
			return;
		}
		this.act(step.action);
	}

	private act(action: PickerAction): void {
		if (action === 'open' || action === 'close' || action === 'toggle') {
			const at = this.state.cursor === null ? undefined : this.index.get(this.state.cursor);
			const row = at === undefined ? undefined : this.rows[at];
			if (row?.kind === 'folder') {
				this.openFolders = toggleFolder(this.openFolders, row.folder.path);
				this.render(false);
			}
		} else if (action === 'choose') {
			this.chooseSelected();
		} else if (action === 'device') {
			if (!this.busy) this.fileInput?.click();
		}
	}

	/** Chooses the selected picture, also when its row is not shown (its folder is closed). */
	private chooseSelected(): void {
		const path = this.state.selected;
		if (path === null || this.busy) return;
		const entry = this.tree.entries.get(path);
		if (entry) this.finish(pictureLink(this.app, entry.file, this.o.sourcePath));
	}

	private finish(link: string): void {
		if (this.chosen) return;
		this.chosen = true;
		this.done({ kind: 'choose', link });
		this.close();
	}

	/** D97: the owner chose "Remove": the caller clears its draft value; nothing is written here. */
	private removeChosen(): void {
		if (this.chosen || this.busy) return;
		this.chosen = true;
		this.done({ kind: 'remove' });
		this.close();
	}

	// ---------- Add a picture from this device (D69, B2) ----------

	private async fromDevice(f: File): Promise<void> {
		if (this.busy || this.chosen) return;
		this.busy = true;
		this.modalEl.addClass('is-saving');
		try {
			// A6: a file this large is too large without a read.
			if (f.size > (isTouchFirst(this.pickerWin) ? NO_READ_BYTES_COARSE : NO_READ_BYTES)) {
				new Notice(deviceNotice({ ok: false, code: 'picture-too-large', file: f.name }));
				return;
			}
			const bytes = await f.arrayBuffer();
			if (this.closed) return;
			const verdict = judgeHeader(readPictureHeader(new Uint8Array(bytes)), f.name);
			if (!verdict.ok) {
				new Notice(deviceNotice(verdict));
				return;
			}
			const name = safePictureName(f.name, verdict.format);
			const path = await freePath(this.app, name, this.o.sourcePath);
			if (this.closed) return;
			const file = await this.app.vault.createBinary(path, bytes);
			new Notice(PICTURES_UI.added(file.name, folderOf(file.path)));
			this.finish(pictureLink(this.app, file, this.o.sourcePath));
		} catch (e) {
			console.error('Crown and Kin: cannot add the picture', e);
			new Notice(PICTURES_UI.addFailed);
		} finally {
			this.busy = false;
			this.modalEl.removeClass('is-saving');
		}
	}
}

/** O6: opens the picture picker; resolves to what the owner did (`choose`, `remove` or `cancel`). Never rejects. */
export function pickPicture(app: App, o: PickPictureOptions): Promise<PickResult> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (v: PickResult) => {
			if (settled) return;
			settled = true;
			resolve(v);
		};
		try {
			new PicturePicker(app, o, done).open();
		} catch (e) {
			console.error('Crown and Kin: cannot open the picture picker', e);
			done({ kind: 'cancel' });
		}
	});
}
