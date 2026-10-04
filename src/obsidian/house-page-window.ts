/*
 * The house page (spec §13.12, D55, D88, D89): a read-only window with the people of
 * one house of the saved tree, in the order of the whole tree, with a button that makes a note from the
 * table. The Houses window and the legend open it. A tap on a row closes the window and asks the tree
 * view to show the card (like Find). The page never reads an unsaved draft and never writes the tree.
 *
 * Behaviour (H1 to H4):
 * - The Houses window (a People button in each row of a saved house) and the house rows of the legend
 *   open it, on the computer and in the full-screen view. The page is read-only, so it also works in a
 *   read-only tree. The static phone preview has no legend button and no Houses window.
 * - Design 4B (D113 item 4). A wide table has a head row and the columns Generation, Name, Title, Born
 *   and Died. When the table is narrower than 34 text widths (a container query in `em`, so a phone, a
 *   narrow window and large text all count) each row is two text lines: name and title, then generation
 *   and dates, with a small chevron at the right that shows that the row opens. The text wraps; nothing is
 *   wider than the window. A row is a button of at least 44 px. A house with no person shows a message and
 *   no table and no note button.
 * - The setting "Show generation on the house page" (default on) takes the Generation column and the
 *   generation of the second text line away. It is read when the page opens (the setting tab cannot be
 *   open at the same time). The note that "Make a note with this table" writes is not changed by it.
 * - A tap on a row closes the window (and the Houses window under it, through its normal close), then
 *   the tree view shows the card as Find does, opening the folds that hide it first.
 * - "Make a note with this table" makes the note with `makeNote`, in the D60 folder with the next free
 *   name, leaves the tree unchanged and does no stale check. The note is a copy.
 * - Close control (D94). Obsidian's own close control (`.modal-close-button` of 1.12, `.modal-header-button`
 *   of 1.13) is hidden by CSS on every device (a hidden control is not in the Tab order); the rule in
 *   `styles.css` comes after the sheet rules so that it wins. The window keeps its own **Close** button, so
 *   it has exactly one visible close control. Esc closes the window (Obsidian's modal scope, through
 *   `trackModal`). At the first open the focus goes to **Close** (`focus({ preventScroll: true })`) with no
 *   refocus timer; a later rebuild (a phone or computer change) refocuses **Close** only if the focus was
 *   inside the window.
 */

import type { FamilyGraph } from '../core/derive';
import { Modal, Notice, type App } from 'obsidian';
import { houseNoteName, housePage, houseTableNote, type HousePage } from '../core/house-page';
import { HOUSE_PAGE_UI } from '../render/ui-text';
import { openMadeNote } from './make-note';
import { phoneLayout } from './modal-layout';
import type { PictureCopy, PictureStore } from './picture-store';
import { trackModal } from './plugin-modals';
import { drawableColour, nameDialog } from './sheet-parts';
import { makeNote } from './table-note';

/** What opens the house page. */
export interface HousePageOptions {
	app: App;
	houseId: string;
	/** The saved tree's graph; the page never reads an unsaved draft. */
	whole: FamilyGraph;
	sourcePath: string;
	pictures?: PictureStore;
	/** Called for a tapped row after the window closed (H3). */
	show: (personId: string) => void;
	/** Opens the made note (H4); the window calls it after makeNote. */
	openNote: (open: () => Promise<void>) => void;
	/** The window has closed; the focus goes back to the button or legend row that opened it. */
	onClosed?: () => void;
	/** The setting "Show generation on the house page", from the tree view; without it the page shows the generation. */
	showGeneration?: () => boolean;
}

/** True if the house page shows the generation: the caller's answer, else on. A failing answer never stops the page. */
function wantsGeneration(o: HousePageOptions): boolean {
	try {
		return o.showGeneration ? o.showGeneration() : true;
	} catch {
		return true;
	}
}

/** The arms box of the page is this high, in CSS px (the same as the Houses window). */
const ARMS_PX = 40;

/** The modal that shows the people of one house. */
export class HousePageWindow extends Modal {
	private readonly cleanup: (() => void)[] = [];
	private page: HousePage;
	private generation = true;
	private shown = false;
	private busy = false;
	private armsCopy: PictureCopy | null = null;
	private armsAsk: object | null = null;
	private closeButton: HTMLButtonElement | null = null;

	/** Null, with a Notice, when the house is not in the tree any more. */
	static create(app: App, o: HousePageOptions): HousePageWindow | null {
		const page = housePage(o.whole, o.houseId);
		if (!page) {
			new Notice(HOUSE_PAGE_UI.none);
			return null;
		}
		return new HousePageWindow(app, o, page);
	}

	private constructor(
		app: App,
		private readonly o: HousePageOptions,
		page: HousePage,
	) {
		super(app);
		// The house name that the Houses window shows: the name, else the id.
		this.page = { ...page, house: { ...page.house, name: page.house.name.trim() || page.house.id } };
	}

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-house-page');
		this.generation = wantsGeneration(this.o);
		this.cleanup.push(phoneLayout(this), trackModal(this, () => this.finish()));
		this.shown = true;
		this.guard(() => this.build());
		// The focus starts on Close, with no timer to move it again (the window has one close control, D94).
		this.closeButton?.focus({ preventScroll: true });
	}

	override onClose(): void {
		this.shown = false;
		this.closeButton = null;
		for (const c of this.cleanup.splice(0)) c();
		this.armsAsk = null;
		this.armsCopy?.release();
		this.armsCopy = null;
		this.contentEl.empty();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
	}

	/** There is nothing to save, so Esc, the X button and a press outside close the window at once. */
	private finish(): void {
		this.close();
	}

	private build(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: this.page.house.name }));
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const close = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-cancel'], text: HOUSE_PAGE_UI.close, attr: { type: 'button', 'aria-label': HOUSE_PAGE_UI.close } });
		this.closeButton = close;
		close.addEventListener('click', () => this.finish());

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		this.summary(body);
		if (this.page.count === 0) {
			body.createDiv({ cls: 'dynasty-hp-none', text: HOUSE_PAGE_UI.none });
			return;
		}
		const note = body.createEl('button', {
			cls: ['dynasty-sheet-action', 'dynasty-hp-make-note'],
			text: HOUSE_PAGE_UI.makeNote,
			attr: { type: 'button', 'aria-label': HOUSE_PAGE_UI.makeNoteLabel(this.page.house.name) },
		});
		note.addEventListener('click', () => this.guard(() => void this.makeNote()));
		this.table(body);
	}

	/** The colour, the arms and the number of people. */
	private summary(body: HTMLElement): void {
		const box = body.createDiv({ cls: 'dynasty-hp-summary' });
		const swatch = box.createSpan({ cls: 'dynasty-hp-swatch' });
		if (drawableColour(this.page.house.color)) swatch.style.setProperty('--dynasty-house-color', this.page.house.color);
		else swatch.addClass('is-none');
		const arms = box.createDiv({ cls: 'dynasty-hp-arms' });
		// C7: a plain div has no role, so a name on it is never announced. A house with arms gets role "img" and a name; a box with no arms gets neither.
		if (this.page.house.arms?.trim()) {
			arms.setAttribute('role', 'img');
			arms.setAttribute('aria-label', HOUSE_PAGE_UI.armsLabel(this.page.house.name));
		}
		this.showArms(arms);
		if (this.page.count > 0) box.createSpan({ cls: 'dynasty-hp-count', text: HOUSE_PAGE_UI.count(this.page.count) });
	}

	/** The arms as a transient copy of the store (about 40 px high); no box content when there are no arms or they cannot show. */
	private showArms(box: HTMLElement): void {
		const link = this.page.house.arms?.trim();
		const store = this.o.pictures;
		const found = link && store ? store.resolve(link, this.o.sourcePath) : null;
		if (!store || !found || !found.ok) {
			box.addClass('is-empty');
			return;
		}
		if (this.armsCopy) {
			box.createEl('img', { cls: 'dynasty-house-arms-img', attr: { src: this.armsCopy.url, alt: '' } });
			return;
		}
		box.addClass('is-loading');
		const ask = {};
		this.armsAsk = ask;
		void store
			.acquire(found.file, { w: ARMS_PX, h: ARMS_PX, fit: 'meet' })
			.then((c) => {
				const copy = c && 'url' in c ? c : null;
				if (!this.shown || this.armsAsk !== ask) {
					copy?.release();
					return;
				}
				this.armsAsk = null;
				box.removeClass('is-loading');
				if (!copy) {
					box.addClass('is-empty');
					return;
				}
				this.armsCopy?.release();
				this.armsCopy = copy;
				box.createEl('img', { cls: 'dynasty-house-arms-img', attr: { src: copy.url, alt: '' } });
			})
			.catch((e) => console.error('Dynasty Tree: cannot show the arms', e));
	}

	/** The head row and one button for each person (at least 44 px high). */
	private table(body: HTMLElement): void {
		const table = body.createDiv({ cls: 'dynasty-hp-table' });
		table.toggleClass('has-no-generation', !this.generation);
		const head = table.createDiv({ cls: 'dynasty-hp-head' });
		for (const [cls, text] of [
			['gen', HOUSE_PAGE_UI.generation],
			['name', HOUSE_PAGE_UI.name],
			['title', HOUSE_PAGE_UI.title],
			['born', HOUSE_PAGE_UI.born],
			['died', HOUSE_PAGE_UI.died],
		] as const) {
			if (cls === 'gen' && !this.generation) continue;
			head.createSpan({ cls: `dynasty-hp-cell dynasty-hp-${cls}`, text });
		}
		const list = table.createDiv({ cls: 'dynasty-hp-rows' });
		for (const r of this.page.rows) {
			const row = list.createEl('button', {
				cls: 'dynasty-hp-row',
				attr: { type: 'button', title: HOUSE_PAGE_UI.rowHint, 'data-person': r.id },
			});
			// The lead ("Generation", "b.", "d.") shows only in the two-line layout; the wide table has column heads.
			if (this.generation) this.cell(row, 'gen', HOUSE_PAGE_UI.lead.generation, String(r.generation));
			this.cell(row, 'name', '', r.name);
			this.cell(row, 'title', '', r.title);
			this.cell(row, 'born', HOUSE_PAGE_UI.lead.born, r.born);
			this.cell(row, 'died', HOUSE_PAGE_UI.lead.died, r.died);
			row.createSpan({ cls: 'dynasty-hp-chevron', attr: { 'aria-hidden': 'true' } });
			row.addEventListener('click', () => this.guard(() => this.pick(r.id)));
		}
	}

	/** One cell of a row. An empty value gives an empty cell with no lead, which the two-line layout hides. */
	private cell(row: HTMLElement, key: string, lead: string, value: string): void {
		const cell = row.createSpan({ cls: `dynasty-hp-cell dynasty-hp-${key}` });
		if (value === '') return;
		if (lead) cell.createSpan({ cls: 'dynasty-hp-lead', text: lead });
		cell.createSpan({ cls: 'dynasty-hp-value', text: value });
	}

	/** H3: the window closes, then the view shows the card. */
	private pick(id: string): void {
		this.finish();
		try {
			this.o.show(id);
		} catch (e) {
			console.error('Dynasty Tree: cannot show the person', e);
		}
	}

	/** H4: a copy of the table as a note; the tree does not change and nothing is asked. */
	private async makeNote(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const name = houseNoteName(this.page.house);
		try {
			const made = await makeNote(this.app, this.o.sourcePath, name, houseTableNote(this.page));
			if (!made.ok) {
				new Notice(HOUSE_PAGE_UI.noteFailed(name));
				return;
			}
			new Notice(HOUSE_PAGE_UI.noteMade(made.name));
			this.finish();
			const file = made.file;
			this.o.openNote(() => openMadeNote(this.app, file));
		} catch (e) {
			console.error('Dynasty Tree: cannot make the house note', e);
			new Notice(HOUSE_PAGE_UI.noteFailed(name));
		} finally {
			this.busy = false;
		}
	}

	/** A failed step never leaves an exception in Obsidian (spec §8). */
	private guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Dynasty Tree: the house page failed', e);
		}
	}
}

/** Opens the house page; never throws. Returns the window, or null when there is no such house. */
export function openHousePage(app: App, o: HousePageOptions): HousePageWindow | null {
	try {
		const win = HousePageWindow.create(app, o);
		win?.open();
		return win;
	} catch (e) {
		console.error('Dynasty Tree: cannot open the house page', e);
		return null;
	}
}
