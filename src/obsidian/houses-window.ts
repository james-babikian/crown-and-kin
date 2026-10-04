/*
 * The Houses window (spec §6.10, D32, D36; arms §13.6, D67–D69): the houses of one tree with their
 * arms, names and colours. Like the edit sheet it is a draft: Save writes every change in one write
 * (one undo step), Cancel writes nothing, and any other way to close asks first. A colour comes from
 * the colours of the arms (D68, the exact colours), the 12 house colours (D32) or from the system
 * colour window ("Other colour"). Arms come from the picture picker. Deleting a house that people
 * have asks whether to remove the house from them or keep it (D32); after Save, a Notice with Undo
 * says so. Each saved house also has the button "Change ID" (spec §13.17 rule 5, D109, D110): it opens
 * a small window (`id-window.ts`) whose "Use this ID" puts the id into the draft of the row; Save
 * changes the id and the `house` value of every person who has it, after one question, in the same write.
 */

import { Modal, Notice, setIcon, type App } from 'obsidian';
import { armsColours } from '../core/arms-colours';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { Op } from '../core/edit';
import { describeHouseIdChange } from '../core/house-ops';
import { parseBody, parseDynasty } from '../core/parse';
import { HOUSE_PALETTE } from '../render/styles';
import { HOUSES, HOUSE_COLOUR_NAMES, HOUSE_PAGE_UI, ID_UI, PICTURES_UI, REMOVE, SHEET, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { openHousePage } from './house-page-window';
import { danglingIds, draftId, idChanged, idFromName, idOps, idProblemFor, idProblems, idRefusalText, isIdOp, reasonText, type IdReason, type IdRow } from './id-draft';
import { idNewNameNote, idNote, idOpenButton, type IdRowView } from './id-field';
import { openIdWindow } from './id-window';
import { phoneLayout } from './modal-layout';
import { currentPictureOf, pickPicture } from './picture-picker';
import { ARMS_PIXELS, type PictureCopy, type PictureStore } from './picture-store';
import { trackModal } from './plugin-modals';
import { drawableColour, freshOrStale, nameDialog, onWriteFailed, revealFocused, showErrorLine } from './sheet-parts';
import { undoNotice } from './undo-notice';

const HEX = /^#[0-9a-f]{6}$/i;

/** One house as the Houses window shows it: its id, name, colour and the people who have it. */
export interface LoadedHouse {
	id: string;
	name: string;
	/** As written in the tree; null when there is none. */
	colour: string | null;
	/** Spec §13.6: the arms link as written (flattened like `link`); null when there is none. */
	arms: string | null;
	/** Names of the people who have this house, in tree order. */
	people: string[];
}

/** The tree's houses, loaded from one block body. */
export interface LoadedHouses {
	body: string;
	houses: LoadedHouse[];
	/** The `house` values of people that no house has (§13.17 rule 5): such an id is taken. */
	dangling: string[];
	/** The graph of the whole body, for the count in the id question (never a focus view). */
	g: FamilyGraph;
}

/** One house in the draft. `id` null: a house added in this window. */
export interface HouseRow {
	key: string;
	id: string | null;
	/** The id in the draft (§13.17 rule 5, D110): the saved id until "Use this ID"; absent for a house that is new in the draft. */
	idDraft?: string;
	name: string;
	colour: string | null;
	/** Spec §13.6: the arms link of the draft; null for none. */
	arms: string | null;
	base: { name: string; colour: string | null; arms: string | null } | null;
	/** Deleted in the draft, and what happens to its people (D32). */
	deleted: 'clear' | 'keep' | null;
	/** The user chose `deleted` in the D32 question; false for a house that had no people then. */
	asked?: boolean;
}

/** The houses of a block body, or why the window cannot edit them. */
export function loadHouses(body: string): { kind: 'ok'; data: LoadedHouses } | { kind: 'invalid' } | { kind: 'blocked' } {
	const parsed = parseDynasty(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const tree = parsed.tree;
	const g = deriveFamilies(tree);
	if (g.issues.some((i) => i.level === 'blocking')) return { kind: 'blocked' };
	const seen = new Set<string>();
	const houses: LoadedHouse[] = [];
	for (const h of tree.houses) {
		// The first house with an id is the one the tree uses (spec §8, the decision notes "Validation rules").
		if (seen.has(h.id)) continue;
		seen.add(h.id);
		const people: string[] = [];
		const ids = new Set<string>();
		for (const p of tree.people) {
			if (p.house !== h.id || ids.has(p.id)) continue;
			ids.add(p.id);
			people.push(p.name || p.id);
		}
		houses.push({ id: h.id, name: h.name, colour: h.color ?? null, arms: h.arms ?? null, people });
	}
	const raw = parseBody(body);
	return { kind: 'ok', data: { body, houses, dangling: raw.ok ? danglingIds(raw.data, 'house') : [], g } };
}

/** The houses as draft rows; `key` names each row in the window (an id can hold any text, a key cannot). */
export function rowsOf(data: LoadedHouses, key?: () => string): HouseRow[] {
	let n = 0;
	const next = key ?? (() => `h${n++}`);
	return data.houses.map((h) => ({ key: next(), id: h.id, idDraft: h.id, name: h.name, colour: h.colour, arms: h.arms ?? null, base: { name: h.name, colour: h.colour, arms: h.arms ?? null }, deleted: null }));
}

const lower = (c: string | null) => (c === null ? null : c.toLowerCase());
/** An arms link with only white space is no arms. */
const armsOf = (a: string | null | undefined) => (typeof a === 'string' && a.trim() !== '' ? a.trim() : null);

/** D32: a new house takes the first house colour that no house in the draft uses. */
export function firstFreeColour(rows: HouseRow[]): string {
	const used = new Set(rows.filter((r) => !r.deleted).map((r) => lower(r.colour)));
	return HOUSE_PALETTE.find((c) => !used.has(c)) ?? HOUSE_PALETTE[0];
}

/** The row as the Id logic sees it. */
const idRow = (r: HouseRow): IdRow => ({ key: r.key, id: r.id, idDraft: r.idDraft, name: r.name, deleted: r.deleted !== null });

/**
 * The draft as ops, in the order id changes, edits, deletes, new houses (§13.17 rule 5: the id ops
 * come first, so the other ops of a changed row name the new id). Empty if nothing changed.
 */
export function houseOps(rows: HouseRow[]): Op[] {
	const ids = idOps('house', rows.map(idRow));
	const edits: Op[] = [];
	const deletes: Op[] = [];
	const adds: Op[] = [];
	for (const r of rows) {
		if (r.id === null) {
			const arms = armsOf(r.arms);
			if (!r.deleted) adds.push({ kind: 'add-house', name: r.name.trim(), ...(r.colour && HEX.test(r.colour) ? { color: r.colour.toLowerCase() } : {}), ...(arms ? { arms } : {}) });
			continue;
		}
		if (r.deleted) {
			deletes.push({ kind: 'delete-house', id: r.id, people: r.deleted });
			continue;
		}
		const base = r.base!;
		// After its id op the house has its new id.
		const id = idChanged(idRow(r)) ? draftId(idRow(r)) : r.id;
		const name = r.name.trim() !== base.name ? r.name.trim() : undefined;
		const colour = lower(r.colour) !== lower(base.colour) && r.colour && HEX.test(r.colour) ? r.colour.toLowerCase() : undefined;
		// Spec §13.6: Select arms or Remove arms; null removes the key.
		const arms = armsOf(r.arms) !== armsOf(base.arms) ? armsOf(r.arms) : undefined;
		if (name !== undefined || colour !== undefined || arms !== undefined)
			edits.push({ kind: 'edit-house', id, ...(name !== undefined ? { name } : {}), ...(colour !== undefined ? { color: colour } : {}), ...(arms !== undefined ? { arms } : {}) });
	}
	return [...ids, ...edits, ...deletes, ...adds];
}

/** What opens a `HousesWindow`. */
export interface HousesOptions {
	handle: Handle;
	/** Runs just before the write, so the tree view keeps its view (spec §5.5). */
	beforeWrite?: () => void;
	/** Runs when the window has closed: the focus goes back to the Houses button (spec §5.2). */
	onClosed?: () => void;
	/** The tree's note: arms links are found and made from it (spec §13.6). */
	sourcePath?: string;
	/** The plugin's picture store (M9 contract O3); without it the window shows no arms pictures. */
	pictures?: PictureStore;
	/**
	 * Spec §13.12 (H1, H3): what the People button needs from the tree view. Without it the rows have no
	 * People button. `show` runs after this window has closed; `openNote` opens the note of the house page.
	 */
	people?: {
		show: (personId: string) => void;
		openNote: (open: () => Promise<void>) => void;
	};
	/** The setting "Show generation on the house page" (spec §9); on when absent. */
	showGeneration?: () => boolean;
}

/** The arms box of the Houses window is this high, in CSS px (spec §13.6 "about 40 px"). */
export const ARMS_BOX_PX = 40;

/** The modal that lists a tree's houses and edits their names and colours (spec §6.10). */
export class HousesWindow extends Modal {
	private data: LoadedHouses;
	private rows: HouseRow[];
	private openKey: string | null = null;
	private keys = 0;
	private saving = false;
	private closing = false;
	/** True while the small ID window is open, so a second "Change ID" opens no second window. */
	private idWindowOpen = false;
	private confirmEl: HTMLElement | null = null;
	/** Where the focus goes when a question over the window closes. */
	private confirmFrom: string | null = null;
	private errorEl: HTMLElement | null = null;
	private error = '';
	/** The Id parts (button and note) of the rows on screen now, by row key. */
	private idViews = new Map<string, IdRowView[]>();
	/** The batch that is being written had id ops: a refusal of `id-taken` or `bad-value` is about an id. */
	private sentIds = false;
	private readonly cleanup: (() => void)[] = [];
	/** Spec §13.6: the arms pictures of the window by link (a copy, a problem, or still loading). */
	private readonly copies = new Map<string, PictureCopy | 'problem' | 'loading'>();
	/**
	 * The copy request of each link that runs now. A link that is 'loading' with no request here got
	 * null (its file changed during the copy) and waits for the store's change event (O3).
	 */
	private readonly asks = new Map<string, object>();
	/** The arms boxes on screen now, by row key. */
	private armsBoxes = new Map<string, HTMLElement>();
	/** D68: the colours of each arms link, null when the plugin cannot read them. */
	private readonly colours = new Map<string, string[] | null | 'loading'>();
	/** The "Colours from the arms" group of the open palette. */
	private armsGroup: { key: string; el: HTMLElement } | null = null;
	private shown = false;
	/** What runs when the window has really closed (the People button: show a card); dropped if the user keeps editing. */
	private afterClose: (() => void) | null = null;

	/** Null, with a Notice, if the block cannot be edited now. */
	static create(app: App, o: HousesOptions): HousesWindow | null {
		const l = loadHouses(o.handle.body);
		if (l.kind === 'ok') return new HousesWindow(app, o, l.data);
		new Notice(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.cannotOpen);
		return null;
	}

	private constructor(
		app: App,
		private readonly o: HousesOptions,
		data: LoadedHouses,
	) {
		super(app);
		this.data = data;
		this.rows = rowsOf(data, () => this.nextKey());
	}

	/** Builds the window and gives it the keyboard focus. */
	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-houses');
		this.cleanup.push(phoneLayout(this, () => revealFocused(this.modalEl, this.contentEl)), trackModal(this, () => this.finish()));
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus (C1).
		const reveal = () => revealFocused(this.modalEl, this.contentEl, 300);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
		const store = this.o.pictures;
		if (store) this.cleanup.push(store.onChange((paths) => this.guard(() => this.armsFilesChanged(paths))));
		this.shown = true;
		this.build();
		// Keyboard users start at the top of the window, not in the note below it.
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	/** Runs the cleanup functions `onOpen` registered and hands the focus back to the caller. */
	override onClose(): void {
		// The focused control goes with the window: let go of it first, so the focus can go back to the Houses button.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		if (active && this.modalEl.contains(active)) active.blur();
		for (const c of this.cleanup.splice(0)) c();
		this.shown = false;
		// The window lets go of its arms copies: the store may forget them now.
		for (const c of this.copies.values()) if (typeof c === 'object') c.release();
		this.copies.clear();
		this.asks.clear();
		this.armsBoxes.clear();
		this.armsGroup = null;
		this.contentEl.empty();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
		const after = this.afterClose;
		this.afterClose = null;
		try {
			after?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot show the person', e);
		}
	}

	/** Esc, the X button, a press outside and Android back all come here (spec §6.3 commit model). */
	override close(): void {
		if (this.closing) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.afterClose = null;
			this.hideConfirm();
			return;
		}
		if (this.openKey !== null) {
			const key = this.openKey;
			this.openKey = null;
			this.build(`swatch:${key}`);
			return;
		}
		if (this.isDirty()) {
			this.showConfirm(SHEET.discardTitle, [HOUSES.discardText], null, [
				{
					label: SHEET.keepEditing,
					cls: 'dynasty-sheet-keep',
					run: () => {
						this.afterClose = null;
						this.hideConfirm();
					},
				},
				{ label: SHEET.discard, cls: 'mod-warning dynasty-sheet-discard', run: () => this.finish() },
			]);
			return;
		}
		this.finish();
	}

	private nextKey(): string {
		return `h${this.keys++}`;
	}

	private finish(): void {
		this.closing = true;
		this.close();
	}

	/** True if the draft has an unsaved change (an edit, a delete or a new house). */
	isDirty(): boolean {
		return houseOps(this.rows).length > 0;
	}

	// ---------- building the window ----------

	/** Draws the window again from the draft; `focus` names the control that gets the focus. */
	private build(focus: string | null = null): void {
		const el = this.contentEl;
		// A control that had the focus keeps it (for example Save after a stale write), so the focus never leaves the window.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		const had = active && el.contains(active) ? active.getAttribute('data-focus') : null;
		focus ??= had;
		el.empty();
		this.armsBoxes = new Map();
		this.armsGroup = null;
		this.idViews = new Map();
		this.hideConfirm(false);
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: HOUSES.title }));
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const cancel = actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: SHEET.cancel, attr: { type: 'button', 'data-focus': 'cancel' } });
		cancel.addEventListener('click', () => this.finish());
		const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button', 'data-focus': 'save' } });
		save.addEventListener('click', () => void this.save());

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-sheet-hint', text: HOUSES.intro });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.setText(this.error);
		this.errorEl.toggle(this.error !== '');
		const list = body.createDiv({ cls: 'dynasty-house-list' });
		const shown = this.rows.filter((r) => !r.deleted);
		if (!shown.length) list.createDiv({ cls: 'dynasty-house-none', text: HOUSES.none });
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		for (const r of shown) this.row(list, r, problems.get(r.key));
		const add = body.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-add'], text: HOUSES.add, attr: { type: 'button', 'data-focus': 'add' } });
		add.addEventListener('click', () => this.guard(() => this.addHouse()));
		if (focus) el.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
	}

	private label(r: HouseRow): string {
		return r.name.trim() || HOUSES.newHouse;
	}

	private row(list: HTMLElement, r: HouseRow, problem?: IdReason): void {
		const row = list.createDiv({ cls: 'dynasty-house-row', attr: { 'data-house': r.id ?? r.key } });
		const open = this.openKey === r.key;
		const swatch = row.createEl('button', {
			cls: open ? ['dynasty-house-swatch', 'is-open'] : 'dynasty-house-swatch',
			attr: { type: 'button', 'aria-label': HOUSES.swatchLabel(this.label(r)), 'aria-expanded': String(open), 'data-focus': `swatch:${r.key}` },
		});
		// The only colour the plugin writes into the page is a house colour, as a custom property (spec §5.8).
		if (drawableColour(r.colour)) swatch.style.setProperty('--dynasty-house-color', r.colour);
		else swatch.addClass('is-none');
		swatch.addEventListener('click', () =>
			this.guard(() => {
				this.openKey = open ? null : r.key;
				this.build(`swatch:${r.key}`);
			}),
		);
		this.armsBox(row, r);
		const name = row.createEl('input', { cls: 'dynasty-sheet-input', attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': HOUSES.nameLabel, 'data-focus': `name:${r.key}` } });
		name.value = r.name;
		name.addEventListener('input', () => {
			r.name = name.value;
			this.clearError();
			for (const v of this.idViews.get(r.key) ?? []) v.setItem(this.label(r));
			// A new house's name can change the id that it would get.
			this.refreshIdProblems();
		});
		const views: IdRowView[] = [];
		// The note of a new id sits under the name (D110); the grid puts it there.
		if (r.id !== null && idChanged(idRow(r))) {
			views.push(
				idNote(row, {
					key: r.key,
					item: this.label(r),
					id: draftId(idRow(r)),
					problem: problem ? reasonText(problem) : '',
					onKeepOld: () =>
						this.guard(() => {
							r.idDraft = r.id!;
							this.clearError();
							this.build(`id-open:${r.key}`);
						}),
				}),
			);
		}
		// A new row is marked when its name gives the ID that a changed row has taken (owner decision "3-both").
		if (r.id === null) views.push(idNewNameNote(row, { key: r.key, problem: problem ? reasonText(problem) : '' }));
		const n = r.id === null ? 0 : (this.data.houses.find((h) => h.id === r.id)?.people.length ?? 0);
		row.createDiv({ cls: 'dynasty-house-count', text: HOUSES.count(n) });
		// H1: only a saved house has a page; a house that is new in the draft has none.
		if (this.o.people && r.id !== null) {
			const people = row.createEl('button', {
				cls: ['dynasty-sheet-action', 'dynasty-house-people'],
				text: HOUSE_PAGE_UI.people,
				attr: { type: 'button', 'aria-label': HOUSE_PAGE_UI.peopleLabel(this.savedName(r.id) ?? this.label(r)), 'data-focus': `people:${r.key}` },
			});
			const id = r.id;
			people.addEventListener('click', () => this.guard(() => this.openPeople(id, `people:${r.key}`)));
		}
		// Only a saved house has an id to change; a new house gets its id when it is saved (§6.8).
		if (r.id !== null) views.push(idOpenButton(row, { key: r.key, item: this.label(r), onOpen: () => this.guard(() => this.changeId(r)) }));
		this.idViews.set(r.key, views);
		const del = row.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-delete'], text: HOUSES.delete, attr: { type: 'button', 'aria-label': HOUSES.deleteLabel(this.label(r)), 'data-focus': `delete:${r.key}` } });
		del.addEventListener('click', () => this.guard(() => this.askDelete(r)));
		if (open) this.palette(list, r);
	}

	// ---------- the small ID window (spec §13.17 rule 5, D110) ----------

	/** "Change ID": the small window; "Use this ID" puts the id into the draft of the row. */
	private changeId(r: HouseRow): void {
		// Focus can leave the small window by Tab, and a screen reader can activate the button below it.
		if (this.idWindowOpen) return;
		this.idWindowOpen = true;
		const from = `id-open:${r.key}`;
		openIdWindow(this.app, {
			kind: 'house',
			item: this.label(r),
			key: r.key,
			value: r.idDraft ?? r.id ?? '',
			check: (value) => idProblemFor('house', this.rows.map(idRow), idRow(r), value, this.data.dangling),
			make: () => idFromName('house', this.rows.map(idRow), idRow(r), this.data.dangling),
			use: (value) => {
				// The saved id again is no change: the draft goes away.
				r.idDraft = value;
				this.clearError();
			},
			closed: (used) => {
				// Before the guard, so no path leaves the flag set.
				this.idWindowOpen = false;
				this.guard(() => {
					if (!this.shown || this.closing) return;
					if (used) this.build(from);
					else this.contentEl.querySelector<HTMLElement>(`[data-focus="${from}"]`)?.focus();
				});
			},
		});
	}

	/** Shows the reason in the note of each row whose draft id is refused, without drawing the window again. */
	private refreshIdProblems(): void {
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		for (const [key, views] of this.idViews) {
			const why = problems.get(key);
			for (const v of views) v.setProblem(why ? reasonText(why) : '');
		}
	}

	// ---------- the house page (spec §13.12) ----------

	/** The name of a saved house, as the page shows it (the name, else the id). */
	private savedName(id: string): string | null {
		const h = this.data.houses.find((x) => x.id === id);
		return h ? h.name.trim() || h.id : null;
	}

	/**
	 * People: the page of the saved house. The page reads the saved tree, never the draft. A tap on a
	 * name closes the page, then this window through its normal close (with its question about unsaved
	 * changes), then the view shows the card.
	 */
	private openPeople(id: string, focus: string): void {
		const people = this.o.people;
		const parsed = parseDynasty(this.data.body);
		if (!people || !parsed.ok) return;
		const leaveThen = (run: () => void) => {
			// An open colour list would take the first close and drop the action.
			if (this.openKey !== null) {
				const key = this.openKey;
				this.openKey = null;
				this.build(`swatch:${key}`);
			}
			this.afterClose = run;
			this.close();
			// Only a question about unsaved changes keeps the window open with the action waiting.
			if (!this.closing && !this.confirmEl) this.afterClose = null;
		};
		openHousePage(this.app, {
			app: this.app,
			showGeneration: this.o.showGeneration,
			houseId: id,
			whole: deriveFamilies(parsed.tree),
			sourcePath: this.o.sourcePath ?? '',
			pictures: this.o.pictures,
			show: (personId) => leaveThen(() => people.show(personId)),
			openNote: (open) => leaveThen(() => people.openNote(open)),
			onClosed: () => {
				// Back to the People button, unless this window is closing too.
				if (this.shown && !this.closing) this.modalEl.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
			},
		});
	}

	// ---------- arms (spec §13.6) ----------

	/**
	 * The arms box of a row (about 40 px high, before the name): the arms picture, or an empty dashed
	 * box for a house with no arms or arms that cannot show. A tap opens the picture picker; the box is
	 * at least 44 × 44 px (spec §7.5, B8).
	 */
	private armsBox(row: HTMLElement, r: HouseRow): void {
		const b = row.createEl('button', {
			cls: 'dynasty-house-arms',
			attr: { type: 'button', 'aria-label': PICTURES_UI.armsLabel(this.label(r)), 'data-focus': `arms:${r.key}` },
		});
		b.addEventListener('click', () => this.guard(() => void this.selectArms(r, `arms:${r.key}`)));
		this.armsBoxes.set(r.key, b);
		this.showArms(b, armsOf(r.arms));
	}

	/** Fills an arms box for `link`: its picture when the copy is ready, else the loading or empty state. */
	private showArms(b: HTMLElement, link: string | null): void {
		b.empty();
		b.removeClass('is-empty');
		b.removeClass('is-loading');
		const state = link ? this.copyFor(link) : 'problem';
		if (state === 'problem') b.addClass('is-empty');
		else if (state === 'loading') b.addClass('is-loading');
		// The copy has the screen's pixel density; CSS shows it at most 40 px high, with its own proportions (D75).
		else b.createEl('img', { cls: 'dynasty-house-arms-img', attr: { src: state.url, alt: '' } });
	}

	/** The window's copy of an arms picture; starts it when it is not there. */
	private copyFor(link: string): PictureCopy | 'problem' | 'loading' {
		const have = this.copies.get(link);
		if (have) return have;
		const store = this.o.pictures;
		const found = store ? store.resolve(link, this.o.sourcePath ?? '') : null;
		if (!store || !found || !found.ok) {
			this.copies.set(link, 'problem');
			return 'problem';
		}
		this.copies.set(link, 'loading');
		const ask = {};
		this.asks.set(link, ask);
		// O3: the copy for the Houses window is 40 px high; the store makes it sharp for the screen.
		void store
			.acquire(found.file, { w: ARMS_BOX_PX, h: ARMS_BOX_PX, fit: 'meet' })
			.then((c) => {
				const copy = c && 'url' in c ? c : null;
				if (!this.shown || this.asks.get(link) !== ask) {
					copy?.release();
					return;
				}
				this.asks.delete(link);
				// The file changed during the copy: the box shows "loading" until the store's change event.
				if (c === null) return;
				this.copies.set(link, copy ?? 'problem');
				this.redrawArms(link);
			})
			.catch((e) => console.error('Dynasty Tree: cannot show the arms', e));
		return 'loading';
	}

	/** Shows the state of `link` in every arms box that has it. */
	private redrawArms(link: string): void {
		for (const row of this.rows) {
			const box = this.armsBoxes.get(row.key);
			if (box && armsOf(row.arms) === link) this.showArms(box, link);
		}
	}

	/**
	 * O3, O9: picture files changed (main.ts tells the store after its wait). The arms of a changed
	 * file, a link with no file or no picture, and a copy dropped because its file changed are asked
	 * for again; their colours too.
	 */
	private armsFilesChanged(paths: readonly string[]): void {
		const store = this.o.pictures;
		if (!this.shown || !store) return;
		const touched = new Set(paths);
		const again: string[] = [];
		for (const [link, state] of this.copies) {
			const found = store.resolve(link, this.o.sourcePath ?? '');
			const hit = found.ok && touched.has(found.file.path);
			const waiting = state === 'loading' && !this.asks.has(link);
			if (hit || waiting || state === 'problem') again.push(link);
		}
		for (const link of again) {
			const state = this.copies.get(link);
			this.copies.delete(link);
			this.asks.delete(link);
			this.colours.delete(link);
			if (typeof state === 'object') state.release();
			this.redrawArms(link);
		}
		const g = this.armsGroup;
		const r = g ? this.rows.find((x) => x.key === g.key) : undefined;
		const link = r ? armsOf(r.arms) : null;
		if (g && r && link && again.includes(link)) this.fillArmsColours(g.el, r, link);
	}

	/** Select arms (spec §13.6): the picture picker; the chosen link goes into the draft. */
	private async selectArms(r: HouseRow, focus: string): Promise<void> {
		const sourcePath = this.o.sourcePath ?? '';
		// V1: the window's draft value (not the saved one) is the current picture.
		const current = currentPictureOf(this.o.pictures, armsOf(r.arms), sourcePath);
		// D97: the list has a Remove row only when the draft has arms.
		const remove = armsOf(r.arms) ? PICTURES_UI.removeArms : undefined;
		const picked = await pickPicture(this.app, { sourcePath, store: this.o.pictures, title: PICTURES_UI.armsLabel(this.label(r)), current, remove });
		if (!this.shown) return;
		if (picked.kind === 'choose') {
			r.arms = picked.link;
			this.clearError();
		} else if (picked.kind === 'remove') {
			// The same as the Remove arms button: the draft changes; Save writes it.
			r.arms = null;
		}
		this.build(focus);
	}

	/** D68: the colours of the arms, from the store's 64 × 64 pixels; the group fills in when they are ready. */
	private armsColoursFor(link: string): string[] | null | 'loading' {
		const have = this.colours.get(link);
		if (have !== undefined) return have;
		const store = this.o.pictures;
		const found = store ? store.resolve(link, this.o.sourcePath ?? '') : null;
		if (!store || !found || !found.ok) {
			this.colours.set(link, null);
			return null;
		}
		this.colours.set(link, 'loading');
		void store
			.pixels(found.file)
			.then((px) => {
				let list: string[] | null = null;
				try {
					list = px ? armsColours(px, ARMS_PIXELS, ARMS_PIXELS) : null;
				} catch (e) {
					console.error('Dynasty Tree: cannot read the colours of the arms', e);
				}
				this.colours.set(link, list);
				const g = this.armsGroup;
				const r = g ? this.rows.find((x) => x.key === g.key) : undefined;
				if (this.shown && g && r && armsOf(r.arms) === link) this.fillArmsColours(g.el, r, link);
			})
			.catch((e) => console.error('Dynasty Tree: cannot read the colours of the arms', e));
		return 'loading';
	}

	/** The "Colours from the arms" buttons (D68: the exact colours), or the text that says the colours are unknown. */
	private fillArmsColours(group: HTMLElement, r: HouseRow, link: string): void {
		group.empty();
		const list = this.armsColoursFor(link);
		group.toggleClass('is-loading', list === 'loading');
		if (list === 'loading') return;
		if (list === null) {
			group.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-house-arms-none'], text: PICTURES_UI.noArmsColours });
			return;
		}
		list.forEach((hex, i) => {
			const chosen = lower(r.colour) === hex;
			const b = group.createEl('button', {
				cls: chosen ? ['dynasty-house-arms-colour', 'is-selected'] : 'dynasty-house-arms-colour',
				attr: { type: 'button', 'aria-label': PICTURES_UI.armsColourLabel(i + 1), 'aria-pressed': String(chosen), 'data-colour': hex, 'data-focus': `arms-colour:${r.key}:${hex}` },
			});
			b.style.setProperty('--dynasty-house-color', hex);
			if (chosen) setIcon(b, 'check');
			b.addEventListener('click', () =>
				this.guard(() => {
					r.colour = hex;
					this.build(`arms-colour:${r.key}:${hex}`);
				}),
			);
		});
	}

	/**
	 * D32: the 12 house colours and "Other colour" (the system colour window). Spec §13.6: first Select
	 * arms and Remove arms; with arms, the colours of the arms come before the label "House colours".
	 */
	private palette(list: HTMLElement, r: HouseRow): void {
		const box = list.createDiv({ cls: 'dynasty-house-palette', attr: { 'data-house': r.id ?? r.key } });
		const arms = armsOf(r.arms);
		const armsPart = box.createDiv({ cls: 'dynasty-house-arms-part' });
		armsPart.createDiv({ cls: 'dynasty-sheet-label', text: PICTURES_UI.armsHeading });
		const armsButtons = armsPart.createDiv({ cls: 'dynasty-house-arms-buttons' });
		const select = armsButtons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-select-arms'], text: PICTURES_UI.selectArms, attr: { type: 'button', 'data-focus': `select-arms:${r.key}` } });
		select.addEventListener('click', () => this.guard(() => void this.selectArms(r, `select-arms:${r.key}`)));
		if (arms) {
			const remove = armsButtons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-house-remove-arms'], text: PICTURES_UI.removeArms, attr: { type: 'button', 'data-focus': `remove-arms:${r.key}` } });
			remove.addEventListener('click', () =>
				this.guard(() => {
					r.arms = null;
					this.build(`select-arms:${r.key}`);
				}),
			);
		}
		const title = box.createDiv({ cls: 'dynasty-sheet-label', text: HOUSES.paletteTitle(this.label(r)) });
		const titleId = `dynasty-house-palette-${r.key}-${this.keys}`;
		title.setAttribute('id', titleId);
		if (arms) {
			box.createDiv({ cls: ['dynasty-sheet-label', 'dynasty-house-arms-title'], text: PICTURES_UI.coloursFromArms });
			const group = box.createDiv({ cls: ['dynasty-house-colours', 'dynasty-house-arms-colours'], attr: { role: 'group', 'aria-label': PICTURES_UI.coloursFromArms } });
			this.armsGroup = { key: r.key, el: group };
			this.fillArmsColours(group, r, arms);
			box.createDiv({ cls: ['dynasty-sheet-label', 'dynasty-house-palette-title'], text: PICTURES_UI.houseColours });
		}
		const grid = box.createDiv({ cls: 'dynasty-house-colours', attr: { role: 'group', 'aria-labelledby': titleId } });
		HOUSE_PALETTE.forEach((hex, i) => {
			const chosen = lower(r.colour) === hex;
			const b = grid.createEl('button', {
				cls: chosen ? ['dynasty-house-colour', 'is-selected'] : 'dynasty-house-colour',
				attr: { type: 'button', 'aria-label': HOUSE_COLOUR_NAMES[i], 'aria-pressed': String(chosen), 'data-colour': hex, 'data-focus': `colour:${r.key}:${hex}` },
			});
			b.style.setProperty('--dynasty-house-color', hex);
			if (chosen) setIcon(b, 'check');
			b.addEventListener('click', () =>
				this.guard(() => {
					r.colour = hex;
					this.build(`colour:${r.key}:${hex}`);
				}),
			);
		});
		const other = box.createDiv({ cls: 'dynasty-house-other' });
		const id = `${titleId}-other`;
		const input = other.createEl('input', { cls: 'dynasty-sheet-colour', attr: { type: 'color', id, 'data-focus': `other:${r.key}` } });
		input.value = r.colour && HEX.test(r.colour) ? r.colour.toLowerCase() : '#888888';
		other.createEl('label', { cls: 'dynasty-house-other-label', text: HOUSES.otherColour, attr: { for: id } });
		input.addEventListener('change', () =>
			this.guard(() => {
				if (!HEX.test(input.value)) return;
				r.colour = input.value.toLowerCase();
				this.build(`other:${r.key}`);
			}),
		);
	}

	private addHouse(): void {
		const key = this.nextKey();
		this.rows.push({ key, id: null, name: '', colour: firstFreeColour(this.rows), arms: null, base: null, deleted: null });
		this.openKey = null;
		this.clearError();
		this.build(`name:${key}`);
	}

	/** The control that takes the focus after a row goes: the next row's Delete, else Add house. */
	private focusAfter(r: HouseRow): string {
		const shown = this.rows.filter((x) => !x.deleted || x === r);
		const next = shown[shown.indexOf(r) + 1];
		return next ? `delete:${next.key}` : 'add';
	}

	private peopleOf(r: HouseRow): string[] {
		return r.id === null ? [] : (this.data.houses.find((h) => h.id === r.id)?.people ?? []);
	}

	private askDelete(r: HouseRow): void {
		const after = this.focusAfter(r);
		const people = this.peopleOf(r);
		const drop = (how: 'clear' | 'keep', asked: boolean) => {
			if (r.id === null) this.rows.splice(this.rows.indexOf(r), 1);
			else {
				r.deleted = how;
				r.asked = asked;
			}
			if (this.openKey === r.key) this.openKey = null;
			this.build(after);
		};
		if (!people.length) {
			drop('clear', false);
			return;
		}
		this.askPeople(r, people, `delete:${r.key}`, (how) => drop(how, true), () => this.hideConfirm());
	}

	/** The D32 question: what happens to the people of a house that is deleted. */
	private askPeople(r: HouseRow, people: string[], from: string | null, chose: (how: 'clear' | 'keep') => void, cancel: () => void): void {
		const name = r.base?.name || this.label(r);
		// D113 item 1: the question gives the number of people, not their names, so it stays short for a house of 400 people.
		const n = people.length;
		this.showConfirm(HOUSES.confirmTitle(name), [HOUSES.confirmPeople(n), HOUSES.confirmAsk(n)], from, [
			{ label: HOUSES.clearLabel(n), detail: HOUSES.clearDetail(n), cls: 'dynasty-choice-option dynasty-house-clear', run: () => chose('clear') },
			{ label: HOUSES.keepLabel(n), detail: HOUSES.keepDetail(n), cls: 'dynasty-choice-option dynasty-house-keep', run: () => chose('keep') },
			{ label: HOUSES.cancel, cls: 'dynasty-sheet-keep', run: cancel },
		]);
	}

	/**
	 * A house deleted with no question (it had no people) can have people after a reload (sync,
	 * another pane): D32 lets the user choose for them before anything is written. True if it asked.
	 */
	private askAgain(): boolean {
		const r = this.rows.find((x) => x.id !== null && x.deleted && !x.asked && this.peopleOf(x).length > 0);
		if (!r) return false;
		this.askPeople(
			r,
			this.peopleOf(r),
			'save',
			(how) => {
				r.deleted = how;
				r.asked = true;
				this.build('save');
			},
			() => {
				// Cancel keeps the house: it comes back into the list.
				r.deleted = null;
				this.build('save');
			},
		);
		return true;
	}

	// ---------- questions over the window ----------

	private showConfirm(title: string, text: string[], from: string | null, buttons: { label: string; detail?: string; cls: string; run: () => void }[]): void {
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
		const titleId = `dynasty-houses-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of text) scroll.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const options = buttons.filter((b) => b.detail !== undefined);
		const choices = options.length ? box.createDiv({ cls: 'dynasty-choice-options' }) : null;
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

	private hideConfirm(refocus = true): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		if (had && refocus && this.confirmFrom) this.contentEl.querySelector<HTMLElement>(`[data-focus="${this.confirmFrom}"]`)?.focus();
		this.confirmFrom = null;
	}

	// ---------- writes ----------

	/** True if the window shows the handle's current body; otherwise the stale message and false (spec §6.1). */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	/**
	 * Save. `asked` is the ID change that the owner just answered ("Change the ID?"): the answer runs Save again
	 * on the draft as it is then, so an edit made behind the question is written, and a different ID change
	 * is asked again (C4).
	 */
	private async save(asked: string | null = null): Promise<void> {
		if (this.saving) return;
		const empty = this.rows.find((r) => !r.deleted && r.name.trim() === '' && (r.id === null || r.name.trim() !== r.base?.name));
		if (empty) {
			this.showError(HOUSES.needName);
			this.contentEl.querySelector<HTMLElement>(`[data-focus="name:${empty.key}"]`)?.focus();
			return;
		}
		if (this.askAgain()) return;
		const ops = houseOps(this.rows);
		if (!ops.length) {
			this.finish();
			return;
		}
		if (!this.fresh()) return;
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		// The focus goes to a saved row: a new row has no "Change ID" button, and the saved row that it conflicts with is marked too.
		const bad = this.rows.find((r) => r.id !== null && problems.has(r.key));
		if (bad) {
			// D113 item 3: the reason shows once, in the row (its note and red edge); the top line shows nothing for an ID.
			// An earlier "the tree changed under the window" message stays: this refusal does not answer it.
			if (this.error !== HOUSES.stale) this.clearError();
			this.refreshIdProblems();
			this.contentEl.querySelector<HTMLElement>(`[data-focus="id-open:${bad.key}"]`)?.focus();
			return;
		}
		const changed = this.rows.filter((r) => idChanged(idRow(r)));
		const what = changed.map((r) => `${r.key}:${r.id}>${draftId(idRow(r))}`).join('|');
		if (changed.length && what !== asked) {
			// The note can change while the question is open (sync, another pane): the answer checks the body again.
			this.askIds(changed, () => void this.save(what));
			return;
		}
		await this.commit(ops);
	}

	/** The one question before Save changes an id: what changes, and how many people. Closing it is Cancel. */
	private askIds(changed: HouseRow[], go: () => void): void {
		const lines = changed.map((r) => ID_UI.confirmLine(this.label(r), r.id!, draftId(idRow(r)), ID_UI.places(describeHouseIdChange(this.data.g, r.id!).people)));
		this.showConfirm(ID_UI.confirmTitle(changed.length), [...lines, REMOVE.canUndo], 'save', [
			{ label: ID_UI.keep, cls: 'dynasty-sheet-keep dynasty-id-keep', run: () => this.hideConfirm() },
			{
				label: ID_UI.change(changed.length),
				cls: 'mod-cta dynasty-id-change',
				run: () => {
					this.hideConfirm();
					go();
				},
			},
		]);
	}

	/** Writes the ops of the draft as one batch (one Undo step) and closes the window when it works. */
	private async commit(ops: Op[]): Promise<void> {
		if (this.saving) return;
		const deleted = this.rows.filter((r) => r.id !== null && r.deleted).map((r) => r.base?.name || r.id!);
		const idCount = ops.filter(isIdOp).length;
		const h = this.o.handle;
		this.sentIds = idCount > 0;
		this.saving = true;
		this.modalEl.addClass('is-saving');
		let out: HandleWriteOutcome;
		try {
			this.o.beforeWrite?.();
			// One write, so one Undo reverts every change of the window (spec §6.1, D8).
			out = await h.write({ kind: 'batch', ops });
		} catch (e) {
			console.error('Dynasty Tree: cannot save the houses', e);
			this.refused(HOUSES.failed);
			return;
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
		if (!out.ok) {
			this.failed(out);
			return;
		}
		this.finish();
		if (deleted.length) {
			const others = ops.length > deleted.length;
			undoNotice(others ? `${HOUSES.deleted(deleted)} ${REMOVE.undoAlso}` : HOUSES.deleted(deleted), h, out.body);
		} else if (idCount) {
			undoNotice(ops.length > idCount ? `${ID_UI.changed(idCount)} ${REMOVE.undoAlso}` : ID_UI.changed(idCount), h, out.body);
		}
	}

	private failed(out: Exclude<HandleWriteOutcome, { ok: true }>): void {
		const h = this.o.handle;
		const detail = out.code === 'refused' ? out.refusal.detail : undefined;
		onWriteFailed(out, {
			stale: () => this.stale(h.body),
			missing: () => this.refused(HOUSES.missing),
			refused: (code) => {
				// §13.17 rule 5: `id-taken` and `bad-value` of an id op are about the id, never "changed under the window".
				const idText = this.sentIds ? idRefusalText(code, detail) : null;
				// A house that is not in the tree now: the tree changed under the window.
				if (code === 'unknown-house') this.stale(h.body);
				else if (idText) this.refused(idText);
				else if (code === 'blocked') this.refused(WRITE_TEXT.blocked);
				else if (code === 'invalid-yaml') this.refused(HOUSES.invalid);
				else this.refused(HOUSES.refused);
			},
		});
	}

	/** Spec §6.1 stale write: a Notice, the new data in the window, and the draft kept with a message that says so. */
	private stale(body: string): void {
		new Notice(WRITE_TEXT.stale);
		this.reload(body);
		this.showError(HOUSES.stale);
	}

	/**
	 * Shows the block's new houses. A house the user changed keeps the user's name or colour; the
	 * other values are the new ones. A house that is gone leaves the draft; new houses stay.
	 */
	private reload(body: string): void {
		const l = loadHouses(body);
		if (l.kind !== 'ok') {
			this.refused(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.invalid);
			return;
		}
		const old = new Map(this.rows.filter((r) => r.id !== null).map((r) => [r.id!, r]));
		const next = rowsOf(l.data, () => this.nextKey()).map((fresh) => {
			const was = old.get(fresh.id!);
			if (!was) return fresh;
			return {
				...fresh,
				key: was.key,
				// An id the user typed stays; else the row shows the new saved id.
				idDraft: (was.idDraft ?? was.id!).trim() !== was.id ? was.idDraft : fresh.id!,
				name: was.name !== was.base!.name ? was.name : fresh.name,
				colour: lower(was.colour) !== lower(was.base!.colour) ? was.colour : fresh.colour,
				arms: armsOf(was.arms) !== armsOf(was.base!.arms) ? was.arms : fresh.arms,
				deleted: was.deleted,
				asked: was.asked,
			};
		});
		this.data = l.data;
		this.rows = [...next, ...this.rows.filter((r) => r.id === null)];
		if (this.openKey !== null && !this.rows.some((r) => r.key === this.openKey)) this.openKey = null;
		this.build();
	}

	private refused(text: string): void {
		new Notice(text);
		this.showError(text);
	}

	private showError(text: string): void {
		this.error = text;
		showErrorLine(this.errorEl, text);
	}

	private clearError(): void {
		if (!this.error) return;
		this.error = '';
		// The text goes too: a hidden line must not keep an old message that a screen reader or a test can still read.
		this.errorEl?.setText('');
		this.errorEl?.hide();
	}

	/** A failed step never leaves an exception in Obsidian (spec §8). */
	private guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Dynasty Tree: the Houses window failed', e);
		}
	}
}
