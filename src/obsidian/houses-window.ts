/*
 * The Houses window (spec §6.10, §13.16 rule 5, D32, D36, D134, D138, arms §13.6, D67–D69, D202): the houses of one
 * tree as a searchable list with an edit page. The list shows the arms or a colour dot, the name and the
 * number of people of each house. A tap on a house opens its page in the same window: the header with the arms (a tap opens the
 * menu Select arms and Remove arms), the section Details (the name and the colour), the section People (the first eight people of
 * the saved house, "and N more", and the button "Make a note with this table"; the old table window is gone) and, at the end, Change ID and
 * Delete under "Other actions". The window shell
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

import { Notice, type App } from 'obsidian';
import { armsColours } from '../core/arms-colours';
import { houseNoteName, housePage, houseTableNote, type HousePage } from '../core/house-page';
import { nb } from '../render/text-join';
import { shownYears, titleWithNames } from '../render/tree-info';
import type { FamilyGraph } from '../core/derive';
import { deriveDated, type DatesFor } from '../view/calendar-index';
import type { Op } from '../core/edit';
import { describeHouseIdChange } from '../core/house-ops';
import { parseBody, parseDynasty } from '../core/parse';
import { HOUSE_PALETTE } from '../render/styles';
import { HOUSES, HOUSE_PAGE_UI, ID_UI, PICTURES_UI, WIN_LIST_UI, WINDOW_UI, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { danglingIds, draftId, idChanged, idFromName, idOps, idProblemFor, idProblems, reasonText, type IdRow } from '../view/id-draft';
import { idNewNameNote, idNote, type IdRowView } from './id-field';
import { openIdWindow } from './id-window';
import { ListEditWindow, findableArms, type ListRowView, type PageHead } from './list-window';
import { openMadeNote } from './make-note';
import { makeNote } from './table-note';
import type { SectionSpec } from './window-sections';
import { buildRow, showMenu, textButton, type MenuEntry } from './window-parts';
import { matchesAll } from '../view/list-search';
import { currentPictureOf, pickPicture } from './picture-picker';
import { ARMS_PIXELS, type PictureCopy, type PictureStore } from './picture-store';
import { freshOrStale } from './sheet-parts';
import { HEX, drawHousePalette, paintHouseColour } from './house-swatches';
import { houseViewItems } from './viewer-sources';

/** D202 (2): the People section shows this many people, then "and N more". */
const PEOPLE_ROWS = 8;

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
export function loadHouses(body: string, dates?: DatesFor): { kind: 'ok'; data: LoadedHouses } | { kind: 'invalid' } | { kind: 'blocked' } {
	const parsed = parseDynasty(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const g = deriveDated(parsed.tree, dates);
	if (g.issues.some((i) => i.level === 'blocking')) return { kind: 'blocked' };
	const seen = new Set<string>();
	const houses: LoadedHouse[] = [];
	for (const h of parsed.tree.houses) {
		// The first house with an id is the one the tree uses (spec §8).
		if (seen.has(h.id)) continue;
		seen.add(h.id);
		const people: string[] = [];
		const ids = new Set<string>();
		for (const p of parsed.tree.people) {
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
	/** Spec §14 rule 9: the date reader for the calendar link of the block; absent: plain years. */
	dates?: DatesFor;
	/** The plugin's picture store; without it the window shows no arms pictures. */
	pictures?: PictureStore;
	/**
	 * Spec §13.12: what the People section needs from the tree view. Without it a row does not open the card and
	 * the section has no button for the note. `show` runs after this window has closed; `openNote` opens the note of the house page.
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
	/** Spec §13.6: the arms pictures of the window by link (a copy, a problem, or still loading). */
	private readonly copies = new Map<string, PictureCopy | 'problem' | 'loading'>();
	/**
	 * The copy request of each link that runs now. A link that is 'loading' with no request here got
	 * null (its file changed during the copy) and waits for the store's change event.
	 */
	private readonly asks = new Map<string, object>();
	/** The arms boxes of the rows on the list now, by row key. */
	private listBoxes = new Map<string, HTMLElement>();
	/** The arms box button of the open page. */
	private pageBox: HTMLElement | null = null;
	/** The link "Add arms" in the "Open all" row of the open page (D216 item 1); it shows only while the house has no arms to show. */
	private addArmsEl: HTMLElement | null = null;
	/** D68: the colours of each arms link, null when the plugin cannot read them. */
	private readonly colours = new Map<string, string[] | null | 'loading'>();
	/** The "Colours from the arms" group of the open page. */
	private armsGroup: { key: string; el: HTMLElement } | null = null;
	/** The ID note of the open page (it follows the name and the id problems without a new draw). */
	private noteViews: IdRowView[] = [];
	private shown = false;
	/** "Make a note with this table" runs once at a time. */
	private tableBusy = false;
/** What runs when the window has really closed (the People button: show a card); dropped if the user keeps editing. */
	private afterClose: (() => void) | null = null;

	/** Null, with a Notice, if the block cannot be edited now. */
	static create(app: App, o: HousesOptions): HousesWindow | null {
		const l = loadHouses(o.handle.body, o.dates);
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
		this.addArmsEl = null;
		this.armsGroup = null;
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Crown and Kin: cannot return the focus', e);
		}
		const after = this.afterClose;
		this.afterClose = null;
		try {
			after?.();
		} catch (e) {
			console.error('Crown and Kin: cannot show the person', e);
		}
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
				// A refused ID comes before "New": the user must fix it before Save.
				state: problems.has(r.key) ? 'check-id' : r.id === null ? 'new' : houseOps([r]).length > 0 ? 'changed' : '',
				colour: r.colour,
				// Only arms that the plugin can find give the row a lead (D213); a house with no arms has none.
				arms: findableArms(this.o.pictures, armsOf(r.arms), this.o.sourcePath ?? ''),
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
		this.addArmsEl = null;
		this.armsGroup = null;
		this.noteViews = [];
		super.build(focus);
	}

	/** The arms box of a row is the picture of the house, at the right of the row; a picture that cannot show takes the box away (spec §13.6, D213). */
	protected override rowArms(box: HTMLElement, view: ListRowView): void {
		this.listBoxes.set(view.key, box);
		this.showArms(box, view.arms ?? null);
	}

	// ---------- the edit page (spec §6.10) ----------

	protected pageHead(key: string): PageHead {
		const r = this.rowByKey(key)!;
		return {
			// The arms button at the right of the header: a tap opens the short menu (Select arms, Remove arms). A house with no arms has no button there; its link "Add arms" stands in the "Open all" row.
			lead: (parent) => this.armsBox(parent, r),
			name: this.label(r),
			// D216 item 2: the count of the people is the summary of the closed People section, not a line of the header. Only a new house has a line.
			...(r.id === null ? { meta: HOUSES.newHouse } : {}),
		};
	}

	protected renderPage(page: HTMLElement, key: string): void {
		const r = this.rowByKey(key);
		if (!r) return;
		const problems = idProblems('house', this.rows.map(idRow), this.data.dangling);
		const problem = problems.get(r.key);
		this.noteViews = [];
		// The note of a new id sits under the header (D110).
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
		const hp = r.id !== null ? housePage(this.data.g, r.id) : null;
		const specs: SectionSpec[] = [
			{
				key: 'details',
				title: WINDOW_UI.sectionDetails,
				summary: this.label(r),
				open: true,
				build: (body) => {
					const field = this.textField(body, {
						cls: 'dynasty-house-name',
						label: HOUSES.nameLabel,
						value: r.name,
						aria: HOUSES.nameLabel,
						focus: `name:${r.key}`,
						onInput: (value) => {
							r.name = value;
							for (const v of this.noteViews) v.setItem(this.label(r));
							this.updateBackName(key);
							this.sections?.setSummary('details', this.label(r));
							// A new house's name can change the id that it would get.
							this.refreshIdProblems();
						},
					});
					void field;
					this.palette(body, r);
				},
			},
		];
		// H1: only a saved house has people; a house that is new in the draft has none.
		if (r.id !== null) {
			// D216 item 2: "N people in M generations".
			const gens = hp ? new Set(hp.rows.map((x) => x.generation)).size : 0;
			specs.push({
				key: 'people',
				title: WINDOW_UI.sectionPeople,
				summary: WINDOW_UI.sumPeopleHeader(hp?.count ?? 0, gens),
				open: false,
				build: (body) => this.peopleBody(body, r, hp),
			});
		}
		specs.push(this.otherActionsSection(key, 'dynasty-house-delete', (name) => HOUSES.deleteLabel(name)));
		const view = this.drawSections(page, 'house', specs, r.id === null);
		this.addArmsLink(view.openAllRow, r);
	}

	/** The People section (D202 (2)): the first eight people of the saved house, "and N more", and the button that makes a note with the table. */
	private peopleBody(body: HTMLElement, r: HouseRow, hp: HousePage | null): void {
		const rows = body.createDiv({ cls: ['dynasty-rows', 'dynasty-hp-rows'] });
		const all = hp?.rows ?? [];
		if (!all.length) rows.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-hp-none'], text: HOUSE_PAGE_UI.none });
		// The page shows plain rows; the tap that shows the card (spec §13.12 H1) stays where the tree view gives a way to do it.
		const generation = this.showGeneration(), show = this.o.people?.show;
		for (const p of all.slice(0, PEOPLE_ROWS)) {
			// A plain full-width row: no chevron, no hairline (people-rows). The tap stays (spec §13.12), as a soft tint under the pointer.
			const row = buildRow(rows, { cls: 'dynasty-hp-row', attr: { 'data-person': p.id }, ...(show ? { tap: () => this.guard(() => this.leaveThen(() => show(p.id))), chevron: false } : {}) });
			// The name in bold, then the title with its reign; the reign never breaks.
			row.title.createEl('b', { cls: 'dynasty-hp-name', text: p.name });
			// The reign shows the names of its years, as a card does; the table note keeps the text as written (spec §14 rule 15).
			if (p.title) row.title.createSpan({ cls: 'dynasty-sob', text: ` · ${nb(titleWithNames(this.data.g, p.id, p.title))}` });
			// A range with a name or a word has a thin space on each side of its dash, as on the card (D278).
			const { born, died, range } = shownYears(p.born, p.died, this.data.g.dates);
			row.sub.setText(generation ? WINDOW_UI.personRowSub(p.generation, born, died, range) : WINDOW_UI.personRowYears(born, died, range));
		}
		if (all.length > PEOPLE_ROWS) body.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-hp-more'], text: WINDOW_UI.andMore(all.length - PEOPLE_ROWS) });
		if (!all.length || !this.o.people || !hp) return;
		const id = r.id!;
		const saved = this.data.houses.find((x) => x.id === id);
		const name = (saved ? saved.name.trim() || saved.id : null) ?? this.label(r);
		textButton(body.createDiv({ cls: 'dynasty-actions' }), ['dynasty-btn', 'dynasty-hp-make-note', 'dynasty-house-people'], HOUSE_PAGE_UI.makeNote, () => this.guard(() => void this.makeTable(hp)), {
			label: HOUSE_PAGE_UI.makeNoteLabel(name),
			focus: `people:${r.key}`,
		});
	}

	/** The setting "Show generation on the house page", read when the page draws; on when the caller gives none. */
	private showGeneration(): boolean {
		try {
			return this.o.showGeneration ? this.o.showGeneration() : true;
		} catch {
			return true;
		}
	}

	/** H4: a note with the table of the people of the saved house; the tree does not change and nothing is asked. */
	private async makeTable(hp: HousePage): Promise<void> {
		if (this.tableBusy) return;
		this.tableBusy = true;
		const name = houseNoteName(hp.house);
		try {
			const made = await makeNote(this.app, this.o.sourcePath ?? '', name, houseTableNote(hp));
			if (!made.ok) {
				new Notice(HOUSE_PAGE_UI.noteFailed(name));
				return;
			}
			new Notice(HOUSE_PAGE_UI.noteMade(made.name));
			const file = made.file;
			const open = this.o.people?.openNote;
			// The note opens after this window has closed (through its normal close, with its question about unsaved changes).
			this.leaveThen(() => open?.(() => openMadeNote(this.app, file)));
		} catch (e) {
			console.error('Crown and Kin: cannot make the house note', e);
			new Notice(HOUSE_PAGE_UI.noteFailed(name));
		} finally {
			this.tableBusy = false;
		}
	}

	/** Closes the window through its normal close, then runs `run`; with a question about unsaved changes the action waits, and "Keep editing" drops it. */
	private leaveThen(run: () => void): void {
		// An open edit page would take the first close and drop the action. `goBack` draws the list again too: after
		// "Keep editing" the window must show the list, or Esc would go back one more step and not ask.
		if (this.page !== null) this.goBack();
		this.afterClose = run;
		this.close();
		// Only a question about unsaved changes keeps the window open with the action waiting.
		if (!this.closing && !this.confirmEl) this.afterClose = null;
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

	// ---------- arms (spec §13.6) ----------

	/**
	 * The arms of the house at the right of the header of the page (about 56 px high). A tap opens the short menu (Select arms, Remove
	 * arms); the box is at least 44 × 44 px (spec §7.5). A house with no arms, or arms that cannot show, has no picture and no
	 * initials: the button is then hidden (`is-add`), and the link "Add arms" in the "Open all" row takes its place (D213, D216 item 1).
	 */
	private armsBox(parent: HTMLElement, r: HouseRow): void {
		const b = parent.createEl('button', { cls: ['dynasty-house-arms', 'dynasty-arms-mark', 'is-house-head'], attr: { type: 'button', 'data-focus': `arms:${r.key}` } });
		// Hidden with no arms, but a tap that still reaches it (a picture that failed while the button had the focus) opens the picker, as the link does.
		b.addEventListener('click', () => this.guard(() => (b.hasClass('is-add') ? void this.selectArms(r) : this.armsMenu(b, r))));
		this.pageBox = b;
		this.showHeadArms(b, r);
	}

	/**
	 * D216 item 1: "Add arms" stands where "Add portrait" stands in the person window, at the left in the "Open all" row. It shares the look of
	 * that link and opens the picture picker at once (there is no menu to show). The sections are drawn after the header, so the row exists
	 * only now; the state of the header button decides if the link shows.
	 */
	private addArmsLink(row: HTMLElement | null, r: HouseRow): void {
		this.addArmsEl = null;
		if (!row) return;
		const link = row.createEl('button', { cls: ['dynasty-link', 'dynasty-add-portrait', 'dynasty-add-arms'], text: WINDOW_UI.addArms, attr: { type: 'button', 'data-focus': `add-arms:${r.key}` } });
		link.addEventListener('click', () => this.guard(() => void this.selectArms(r)));
		row.prepend(link);
		this.addArmsEl = link;
		link.toggle(this.pageBox?.hasClass('is-add') === true);
	}

	/** Fills the header button for the draft of `r`: the arms picture, the loading state, or nothing (then the link "Add arms" shows). */
	private showHeadArms(b: HTMLElement, r: HouseRow): void {
		const link = armsOf(r.arms);
		const state = link ? this.copyFor(link) : 'problem';
		const none = state === 'problem';
		const held = b === b.doc.activeElement;
		b.toggleClass('is-add', none);
		// The button keeps its name while it is hidden, so a control in the tree never has none.
		b.setAttribute('aria-label', PICTURES_UI.armsButtonLabel(this.label(r)));
		if (none) b.removeAttribute('aria-haspopup');
		else b.setAttribute('aria-haspopup', 'menu');
		this.showArms(b, none ? null : link);
		const add = this.addArmsEl;
		if (!add) return;
		add.toggle(none);
		// A hidden button cannot keep the focus: it would drop to the page, outside the window. The link takes its place.
		if (held && none) add.focus({ preventScroll: true });
	}

	/** The focus name of the arms control that is on screen for the draft of `r`: the arms button, or the link "Add arms" when there is no picture. */
	private armsFocus(r: HouseRow): string {
		const link = armsOf(r.arms);
		return (link ? this.copyFor(link) : 'problem') === 'problem' ? `add-arms:${r.key}` : `arms:${r.key}`;
	}

	/** The menu of the arms: View arms (D256), Select arms, and Remove arms when the draft has arms (D97). */
	private armsMenu(anchor: HTMLElement, r: HouseRow): void {
		const items: (MenuEntry | 'sep')[] = [...houseViewItems({ app: this.app, pictures: this.o.pictures, sourcePath: this.o.sourcePath, name: this.label(r), arms: r.arms }, anchor), { icon: 'image', label: PICTURES_UI.selectArms, run: () => void this.selectArms(r) }];
		if (armsOf(r.arms)) {
			items.push({
				icon: 'trash-2',
				label: PICTURES_UI.removeArms,
				warning: true,
				run: () => {
					r.arms = null;
					this.build(this.armsFocus(r));
				},
			});
		}
		showMenu(anchor, items);
	}

	/**
	 * Fills an arms box for `link`: its picture when the copy is ready, else the loading state. With no picture the box is empty and a row
	 * box goes away (`is-empty`).
	 */
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
			.catch((e) => console.error('Crown and Kin: cannot show the arms', e));
		return 'loading';
	}

	/** Shows the state of `link` in every arms box that has it: the rows of the list and the box of the open page. */
	private redrawArms(link: string): void {
		for (const row of this.rows) {
			if (armsOf(row.arms) !== link) continue;
			const box = this.listBoxes.get(row.key);
			if (box) this.showArms(box, link);
			if (this.page === row.key && this.pageBox) this.showHeadArms(this.pageBox, row);
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
	private async selectArms(r: HouseRow): Promise<void> {
		const sourcePath = this.o.sourcePath ?? '';
		// V1: the window's draft value (not the saved one) is the current picture.
		const current = currentPictureOf(this.o.pictures, armsOf(r.arms), sourcePath);
		// D97: the list has a Remove row only when the draft has arms.
		const remove = armsOf(r.arms) ? PICTURES_UI.removeArms : undefined;
		const picked = await pickPicture(this.app, { sourcePath, store: this.o.pictures, title: PICTURES_UI.armsLabel(this.label(r)), barTitle: PICTURES_UI.pickerBarArms, current, remove });
		if (!this.shown) return;
		if (picked.kind === 'choose') {
			r.arms = picked.link;
			this.clearError();
		} else if (picked.kind === 'remove') {
			// The same as the Remove arms button: the draft changes; Save writes it.
			r.arms = null;
		}
		// The control that has the focus depends on the new draft: the arms button, or the link when there are no arms.
		this.build(this.armsFocus(r));
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
					console.error('Crown and Kin: cannot read the colours of the arms', e);
				}
				this.colours.set(link, list);
				const g = this.armsGroup;
				const r = g ? this.rowByKey(g.key) : undefined;
				if (this.shown && g && r && armsOf(r.arms) === link) this.fillArmsColours(g.el, r, link);
			})
			.catch((e) => console.error('Crown and Kin: cannot read the colours of the arms', e));
		return 'loading';
	}

	/**
	 * The colours read from the arms (D68: the exact colours), as round swatches with a small dot. The group stays empty, and so hidden,
	 * while the picture is read and when the plugin cannot read it: no empty box and no text ever shows (arms-colours).
	 */
	private fillArmsColours(group: HTMLElement, r: HouseRow, link: string): void {
		group.empty();
		const list = this.armsColoursFor(link);
		group.toggleClass('is-loading', list === 'loading');
		if (list === 'loading' || list === null) return;
		list.forEach((hex, i) => {
			const chosen = lower(r.colour) === hex;
			const b = group.createEl('button', {
				cls: chosen ? ['dynasty-swatch', 'dynasty-house-arms-colour', 'is-selected'] : ['dynasty-swatch', 'dynasty-house-arms-colour'],
				attr: { type: 'button', 'aria-label': PICTURES_UI.armsColourLabel(i + 1), 'aria-pressed': String(chosen), 'data-colour': hex, 'data-focus': `arms-colour:${r.key}:${hex}` },
			});
			b.style.setProperty('--dynasty-house-color', hex);
			b.addEventListener('click', () => this.guard(() => this.pickColour(r, hex, b)));
		});
	}

	/**
	 * D32: the colour of the house under one label, "Colour": a row of round swatches, the 12 house colours and then the swatch "Other
	 * colour" (the system colour window). The row is a radio group; the current colour has a ring in the text colour inside the swatch,
	 * not colour alone. With arms, a thin divider and the colours of the arms (D68, spec §13.6, D208 item 2) follow, each with a small dot;
	 * they show only after the picture is read. The palette is always on the page; it has no toggle.
	 */
	private palette(body: HTMLElement, r: HouseRow): void {
		const box = body.createDiv({ cls: ['dynasty-house-palette', 'dynasty-sheet-field'], attr: { 'data-house': r.id ?? r.key } });
		const titleId = `dynasty-house-palette-${r.key}-${this.keys}`;
		box.createDiv({ cls: 'dynasty-sheet-label', text: WINDOW_UI.colour, attr: { id: titleId } });
		drawHousePalette(box, { key: r.key, titleId, name: this.label(r), colour: r.colour, pick: (hex, used) => this.pickColour(r, hex, used), guard: (run) => this.guard(run) });
		const arms = armsOf(r.arms);
		if (arms) {
			const group = box.createDiv({ cls: ['dynasty-swatches', 'dynasty-house-colours', 'dynasty-house-arms-colours'], attr: { role: 'group', 'aria-label': PICTURES_UI.coloursFromArms } });
			this.armsGroup = { key: r.key, el: group };
			this.fillArmsColours(group, r, arms);
		}
	}

	/** A swatch was chosen: the draft takes the colour, and the swatches of the page show it in place, with no rebuild. */
	private pickColour(r: HouseRow, hex: string, used: HTMLElement): void {
		r.colour = hex;
		const box = this.contentEl.querySelector<HTMLElement>('.dynasty-house-palette');
		if (box) paintHouseColour(box, r.colour, used);
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
	 * Save. `asked` is the ID change that the user just answered ("Change the ID?"): the answer runs Save again
	 * on the draft as it is then, so an edit made behind the question is written, and a different ID change
	 * is asked again.
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
		this.askIdChange(changed.length, lines, go);
	}

	/** Writes the ops of the draft as one batch (one Undo step) and closes the window when it works. */
	private async commit(ops: Op[]): Promise<void> {
		if (this.saving) return;
		const deleted = this.rows.filter((r) => r.id !== null && r.deleted).map((r) => r.base?.name || r.id!);
		const h = this.o.handle;
		const out = await this.writeBatch(h, ops, this.o.beforeWrite, 'Crown and Kin: cannot save the houses');
		if (!out) return;
		if (!out.ok) {
			this.failed(out);
			return;
		}
		this.finish();
		this.undoAfterWrite(h, out, ops, deleted, HOUSES.deleted);
	}

	private failed(out: Exclude<HandleWriteOutcome, { ok: true }>): void {
		this.failedWrite(out, this.o.handle, (body) => this.stale(body), (code, idText) => {
			// A house that is not in the tree now: the tree changed under the window.
			if (code === 'unknown-house') this.stale(this.o.handle.body);
			else if (idText) this.refused(idText);
			else this.refusedPlainly(code);
		});
	}

	/** Spec §6.1 stale write: a Notice, the new data in the window, and the draft kept with a message that says so. */
	private stale(body: string): void {
		new Notice(WRITE_TEXT.staleWindow);
		this.reload(body);
		this.showError(HOUSES.stale);
	}

	/**
	 * Shows the block's new houses. A house the user changed keeps the user's name or colour; the
	 * other values are the new ones. A house that is gone leaves the draft; new houses stay. The open page
	 * stays when its house is still there; else the list shows.
	 */
	private reload(body: string): void {
		const l = loadHouses(body, this.o.dates);
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
