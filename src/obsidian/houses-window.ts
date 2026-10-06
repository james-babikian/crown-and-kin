/*
 * The Houses window (spec §6.10, §13.16 rule 5, D32, D36, D134, D138; arms §13.6, D67–D69): the houses of one
 * tree as a searchable list with an edit page. The list shows the colour square, the arms, the name and the
 * number of people of each house. A tap on a house opens its page in the same window: the name, People, the
 * arms, the colours and, at the end, Change ID and Delete under "Other actions". The window shell
 * (`list-window.ts`) draws the list, the search, the Back bar and the close rules; this file gives the houses,
 * the page and the save. Like the edit sheet the window is a draft: Save writes every change in one write
 * (one undo step), Cancel writes nothing, and any other way to close asks first. A colour comes from the colours
 * of the arms (D68, the exact colours), the 12 house colours (D32) or from the system colour window ("Other
 * colour"). Arms come from the picture picker. Deleting a house that people have asks whether to remove the
 * house from them or keep it (D32); after Save, a Notice with Undo says so. Each saved house also has the
 * button "Change ID" (spec §13.17 rule 5, D109, D110): it opens a small window (`id-window.ts`) whose "Use this
 * ID" puts the id into the draft of the house; Save changes the id and the `house` value of every person who
 * has it, after one question, in the same write.
 */

import { Notice, setIcon, type App } from 'obsidian';
import { armsColours } from '../core/arms-colours';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { Op } from '../core/edit';
import { describeHouseIdChange } from '../core/house-ops';
import { parseBody, parseDynasty } from '../core/parse';
import { HOUSE_PALETTE } from '../render/styles';
import { HOUSES, HOUSE_COLOUR_NAMES, HOUSE_PAGE_UI, ID_UI, PICTURES_UI, REMOVE, WIN_LIST_UI, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { openHousePage } from './house-page-window';
import { danglingIds, draftId, idChanged, idFromName, idOps, idProblemFor, idProblems, idRefusalText, isIdOp, reasonText, type IdRow } from './id-draft';
import { idNewNameNote, idNote, type IdRowView } from './id-field';
import { openIdWindow } from './id-window';
import { ListEditWindow, type ListRowView } from './list-window';
import { matchesAll } from './list-search';
import { currentPictureOf, pickPicture } from './picture-picker';
import { ARMS_PIXELS, type PictureCopy, type PictureStore } from './picture-store';
import { freshOrStale, onWriteFailed } from './sheet-parts';
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
	/** D126: true when movement is reduced; the window then scrolls at once. The tree view passes it; the default is `() => false`. */
	reduced?: () => boolean;
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

/** The modal that lists a tree's houses and edits their names, colours and arms (spec §6.10). */
export class HousesWindow extends ListEditWindow {
	private data: LoadedHouses;
	private rows: HouseRow[];
	private keys = 0;
	/** The batch that is being written had id ops: a refusal of `id-taken` or `bad-value` is about an id. */
	private sentIds = false;
	/** Spec §13.6: the arms pictures of the window by link (a copy, a problem, or still loading). */
	private readonly copies = new Map<string, PictureCopy | 'problem' | 'loading'>();
	/**
	 * The copy request of each link that runs now. A link that is 'loading' with no request here got
	 * null (its file changed during the copy) and waits for the store's change event (O3).
	 */
	private readonly asks = new Map<string, object>();
	/** The arms boxes of the rows on the list now, by row key. */
	private listBoxes = new Map<string, HTMLElement>();
	/** The arms box button of the open page. */
	private pageBox: HTMLElement | null = null;
	/** D68: the colours of each arms link, null when the plugin cannot read them. */
	private readonly colours = new Map<string, string[] | null | 'loading'>();
	/** The "Colours from the arms" group of the open page. */
	private armsGroup: { key: string; el: HTMLElement } | null = null;
	/** The ID note of the open page (it follows the name and the id problems without a new draw). */
	private noteViews: IdRowView[] = [];
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
		super(app, 'houses', 'dynasty-houses');
		this.data = data;
		this.rows = rowsOf(data, () => this.nextKey());
	}

	// ---------- what the shell asks ----------

	protected override opened(): void {
		this.shown = true;
		const store = this.o.pictures;
		if (store) this.cleanup.push(store.onChange((paths) => this.guard(() => this.armsFilesChanged(paths))));
	}

	protected override reduced(): boolean {
		return this.o.reduced?.() ?? false;
	}

	/** A question closed with no answer: the card of the People button is not shown after all. */
	protected override dropWaiting(): void {
		this.afterClose = null;
	}

	/** Runs the clean-up of the window: it lets go of its arms copies and hands the focus back to the caller. */
	protected released(): void {
		this.shown = false;
		// The window lets go of its arms copies: the store may forget them now.
		for (const c of this.copies.values()) if (typeof c === 'object') c.release();
		this.copies.clear();
		this.asks.clear();
		this.listBoxes.clear();
		this.pageBox = null;
		this.armsGroup = null;
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

	private nextKey(): string {
		return `h${this.keys++}`;
	}

	/** True if the draft has an unsaved change (an edit, a delete or a new house). */
	isDirty(): boolean {
		return houseOps(this.rows).length > 0;
	}

	protected discardText(): string {
		return HOUSES.discardText;
	}

	private label(r: HouseRow): string {
		return r.name.trim() || HOUSES.newHouse;
	}

	private rowByKey(key: string): HouseRow | undefined {
		return this.rows.find((r) => r.key === key);
	}

	private peopleOf(r: HouseRow): string[] {
		return r.id === null ? [] : (this.data.houses.find((h) => h.id === r.id)?.people ?? []);
	}

	protected labelOf(key: string): string {
		const r = this.rowByKey(key);
		return r ? this.label(r) : HOUSES.newHouse;
	}

	protected isSaved(key: string): boolean {
		return (this.rowByKey(key)?.id ?? null) !== null;
	}

	// ---------- the list ----------

	protected rowViews(): ListRowView[] {
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		return this.rows
			.filter((r) => !r.deleted)
			.map((r) => ({
				key: r.key,
				id: r.id,
				name: this.label(r),
				summary: HOUSES.count(this.peopleOf(r).length),
				// A refused ID comes before "New": the owner must fix it before Save.
				state: problems.has(r.key) ? 'check-id' : r.id === null ? 'new' : houseOps([r]).length > 0 ? 'changed' : '',
				colour: r.colour,
				arms: armsOf(r.arms),
			}));
	}

	/** The text of a house that a search looks in is the draft: the name, the saved id and the people (D134). */
	protected matchReason(key: string, words: readonly string[]): string | null {
		const r = this.rowByKey(key);
		if (!r) return null;
		const people = this.peopleOf(r);
		if (!matchesAll(words, [r.name, r.id ?? '', ...people])) return null;
		if (matchesAll(words, [r.name])) return '';
		const who = people.find((p) => words.some((w) => matchesAll([w], [p])));
		if (who) return WIN_LIST_UI.person(who);
		return r.id ? WIN_LIST_UI.id(r.id) : '';
	}

	protected override renderList(): void {
		this.listBoxes = new Map();
		super.renderList();
	}

	protected override build(focus: string | null = null): void {
		this.listBoxes = new Map();
		this.pageBox = null;
		this.armsGroup = null;
		this.noteViews = [];
		super.build(focus);
	}

	/** The arms box of a row is the picture of the house, or an empty dashed box (spec §13.6). */
	protected override rowArms(box: HTMLElement, view: ListRowView): void {
		this.listBoxes.set(view.key, box);
		this.showArms(box, view.arms ?? null);
	}

	// ---------- the edit page (spec §6.10, D.3.6) ----------

	protected renderPage(page: HTMLElement, key: string): void {
		const r = this.rowByKey(key);
		if (!r) return;
		this.textField(page, {
			cls: 'dynasty-house-name',
			label: HOUSES.nameLabel,
			value: r.name,
			aria: HOUSES.nameLabel,
			focus: `name:${r.key}`,
			onInput: (value) => {
				r.name = value;
				for (const v of this.noteViews) v.setItem(this.label(r));
				this.updateBackName(key);
				// A new house's name can change the id that it would get.
				this.refreshIdProblems();
			},
		});
		const meta = page.createDiv({ cls: 'dynasty-lw-meta' });
		meta.createDiv({ cls: 'dynasty-house-count', text: HOUSES.count(this.peopleOf(r).length) });
		// H1: only a saved house has a page; a house that is new in the draft has none.
		if (this.o.people && r.id !== null) {
			const people = meta.createEl('button', {
				cls: ['dynasty-sheet-action', 'dynasty-house-people'],
				text: HOUSE_PAGE_UI.people,
				attr: { type: 'button', 'aria-label': HOUSE_PAGE_UI.peopleLabel(this.savedName(r.id) ?? this.label(r)), 'data-focus': `people:${r.key}` },
			});
			const id = r.id;
			people.addEventListener('click', () => this.guard(() => this.openPeople(id, `people:${r.key}`)));
		}
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		const problem = problems.get(r.key);
		this.noteViews = [];
		if (r.id !== null && idChanged(idRow(r))) {
			this.noteViews.push(
				idNote(page, {
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
		// A new house is marked when its name gives the ID that a changed house has taken (owner decision "3-both").
		if (r.id === null) this.noteViews.push(idNewNameNote(page, { key: r.key, problem: problem ? reasonText(problem) : '' }));
		page.createDiv({ cls: 'dynasty-sheet-hint', text: HOUSES.intro });
		this.palette(page, r);
		this.otherActions(page, key, 'dynasty-house-delete', (name) => HOUSES.deleteLabel(name));
	}

	/** The name of a saved house, as the page shows it (the name, else the id). */
	private savedName(id: string): string | null {
		const h = this.data.houses.find((x) => x.id === id);
		return h ? h.name.trim() || h.id : null;
	}

	/** Shows the reason in the note of the open page when its draft id is refused, without drawing the page again. */
	private refreshIdProblems(): void {
		if (this.page === null) return;
		const why = idProblems('house', this.rows.map(idRow), this.data.dangling).get(this.page);
		for (const v of this.noteViews) v.setProblem(why ? reasonText(why) : '');
	}

	// ---------- the small ID window (spec §13.17 rule 5, D110) ----------

	/** "Change ID": the small window; "Use this ID" puts the id into the draft of the house. */
	protected changeId(key: string): void {
		const r = this.rowByKey(key);
		// Focus can leave the small window by Tab, and a screen reader can activate the button below it.
		if (!r || this.idWindowOpen) return;
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
					else this.refocus(from);
				});
			},
		});
	}

	// ---------- the house page (spec §13.12) ----------

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
			// An open edit page would take the first close and drop the action. `goBack` draws the list again too: after
			// "Keep editing" the window must show the list, or Esc would go back one more step and not ask.
			if (this.page !== null) this.goBack();
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
	 * The arms box of the page (about 40 px high): the arms picture, or an empty dashed box for a house
	 * with no arms or arms that cannot show. A tap opens the picture picker; the box is at least 44 × 44 px
	 * (spec §7.5, B8).
	 */
	private armsBox(parent: HTMLElement, r: HouseRow): void {
		const b = parent.createEl('button', {
			cls: 'dynasty-house-arms',
			attr: { type: 'button', 'aria-label': PICTURES_UI.armsLabel(this.label(r)), 'data-focus': `arms:${r.key}` },
		});
		b.addEventListener('click', () => this.guard(() => void this.selectArms(r, `arms:${r.key}`)));
		this.pageBox = b;
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

	/** Shows the state of `link` in every arms box that has it: the rows of the list and the box of the open page. */
	private redrawArms(link: string): void {
		for (const row of this.rows) {
			if (armsOf(row.arms) !== link) continue;
			const box = this.listBoxes.get(row.key);
			if (box) this.showArms(box, link);
			if (this.page === row.key && this.pageBox) this.showArms(this.pageBox, link);
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
		const r = g ? this.rowByKey(g.key) : undefined;
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
				const r = g ? this.rowByKey(g.key) : undefined;
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
	 * D32: the arms box, Select arms and Remove arms, then the 12 house colours and "Other colour" (the system
	 * colour window). Spec §13.6: with arms, the colours of the arms come before the label "House colours". The
	 * palette is always on the page; it has no toggle.
	 */
	private palette(page: HTMLElement, r: HouseRow): void {
		const box = page.createDiv({ cls: 'dynasty-house-palette', attr: { 'data-house': r.id ?? r.key } });
		const arms = armsOf(r.arms);
		const armsPart = box.createDiv({ cls: 'dynasty-house-arms-part' });
		armsPart.createDiv({ cls: 'dynasty-sheet-label', text: PICTURES_UI.armsHeading });
		const armsButtons = armsPart.createDiv({ cls: 'dynasty-house-arms-buttons' });
		this.armsBox(armsButtons, r);
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

	// ---------- add and delete ----------

	protected addItem(): string {
		const key = this.nextKey();
		this.rows.push({ key, id: null, name: '', colour: firstFreeColour(this.rows), arms: null, base: null, deleted: null });
		this.clearError();
		return key;
	}

	protected askDelete(key: string): void {
		const r = this.rowByKey(key);
		if (!r) return;
		const people = this.peopleOf(r);
		const drop = (how: 'clear' | 'keep', asked: boolean) => {
			if (r.id === null) this.rows.splice(this.rows.indexOf(r), 1);
			else {
				r.deleted = how;
				r.asked = asked;
			}
			this.afterDelete(key);
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

	// ---------- writes ----------

	/** True if the window shows the handle's current body; otherwise the stale message and false (spec §6.1). */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	/** Opens the page of `key` (unless it is open) and gives the focus to `focus`. */
	private showPage(key: string, focus: string): void {
		if (this.page === key) this.refocus(focus);
		else this.openPage(key, focus);
	}

	/**
	 * Save. `asked` is the ID change that the owner just answered ("Change the ID?"): the answer runs Save again
	 * on the draft as it is then, so an edit made behind the question is written, and a different ID change
	 * is asked again (C4).
	 */
	protected async save(asked: string | null = null): Promise<void> {
		if (this.saving) return;
		const empty = this.rows.find((r) => !r.deleted && r.name.trim() === '' && (r.id === null || r.name.trim() !== r.base?.name));
		if (empty) {
			// The error is set first: the page that opens draws it, and the page that is open shows it at once.
			this.showError(HOUSES.needName);
			this.showPage(empty.key, `name:${empty.key}`);
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
		// The focus goes to a saved house: a new house has no "Change ID" button, and the saved house that it conflicts with is marked too.
		const bad = this.rows.find((r) => r.id !== null && !r.deleted && problems.has(r.key));
		if (bad) {
			// D113 item 3: the reason shows once, in the note of the page; the top line shows nothing for an ID.
			// An earlier "the tree changed under the window" message stays: this refusal does not answer it.
			if (this.error !== HOUSES.stale) this.clearError();
			this.showPage(bad.key, `id-open:${bad.key}`);
			this.refreshIdProblems();
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
	 * other values are the new ones. A house that is gone leaves the draft; new houses stay. The open page
	 * stays when its house is still there; else the list shows.
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
		if (this.page !== null && !this.rows.some((r) => r.key === this.page)) this.page = null;
		this.build();
	}
}
