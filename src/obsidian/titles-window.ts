/*
 * The Titles window (spec §13.4, §13.0 item 6; D49, D52, D55, D134, D138): the titles of one tree as a searchable
 * list. A tap on a title opens its edit page in the same window: the four name fields (D64, D65, D66), the "Change ID"
 * note (§13.17 rule 5, D109, D110; the small window is `id-window.ts`), the holder list and, at the end, the section
 * "Other actions" with Change ID and Delete. The list, the page, the questions, the close rules and the name fields
 * come from `list-window.ts`; this file gives the rows, the page, the draft and the save pipeline. Like the Houses
 * window it is a draft: Save writes every change in one `batch` (one undo step), Cancel writes nothing, and any
 * other way to close with changes asks first. The window opens from the More list on the computer and in the
 * full-screen view, never from the static phone preview (`tree-view.ts`). The draft logic is in `titles-draft.ts`,
 * the holder form in `holder-form.ts`, and "Make a note with this table" in `table-note.ts`.
 */

import { Notice, setIcon, type App } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { Op } from '../core/edit';
import { normBody } from '../core/block-match';
import { parseBody, readTree } from '../core/parse';
import { quotedSobriquet } from '../core/sobriquet';
import { newTitleId } from '../core/title-ops';
import { describeDeleteTitle, describeTitleIdChange } from '../core/titles';
import { HOUSES, ID_UI, REMOVE, SUCCESSION_UI, TITLES_UI, WIN_LIST_UI, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { holderForm } from './holder-form';
import { danglingIds, draftId, idChanged, idFromName, idProblemFor, idProblems, idRefusalText, isIdOp, reasonText } from './id-draft';
import { idNewNameNote, idNote, type IdRowView } from './id-field';
import { openIdWindow } from './id-window';
import { ListEditWindow, type ListRowView } from './list-window';
import { matchesAll } from './list-search';
import { pickPerson } from './person-picker';
import { freshOrStale, onWriteFailed } from './sheet-parts';
import { successionSection, type SuccessionView } from './succession-section';
import { makeTableNote } from './table-note';
import { draftChanged, emptyNames, holderText, listName, personNameOf, rebase, savedListName, titleIdRow, titleRows, windowOps, withHolderIds, type HolderRow, type HolderValues, type TitleRow } from './titles-draft';
import { undoNotice } from './undo-notice';

/** The tree that the window edits, loaded from one block body. */
export interface LoadedTitles {
	body: string;
	/** The body as plain data: which people have no written id (`withHolderIds`). */
	raw: unknown;
	g: FamilyGraph;
	/** The `card-title` values of people that no title has (§13.17 rule 5): such an id is taken. */
	dangling: string[];
}

/** The titles of a block body, or why the window cannot edit them. */
export function loadTitles(body: string): { kind: 'ok'; data: LoadedTitles } | { kind: 'invalid' } | { kind: 'blocked' } {
	const parsed = parseBody(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const g = deriveFamilies(readTree(parsed.doc, parsed.data, body));
	if (g.issues.some((i) => i.level === 'blocking')) return { kind: 'blocked' };
	return { kind: 'ok', data: { body, raw: parsed.data, g, dangling: danglingIds(parsed.data, 'title') } };
}

/** What opens a `TitlesWindow`. */
export interface TitlesOptions {
	handle: Handle;
	/** The tree's note: the table note's folder can depend on it (D60). */
	sourcePath: string;
	/** Runs just before the write, so the tree view keeps its view (spec §5.5). */
	beforeWrite?: () => void;
	/** Runs when the window has closed: the focus goes back to More (spec §5.2). */
	onClosed?: () => void;
	/** Shows a person's card in the tree the way Find does (spec §13.4); the window has closed. */
	show?: (id: string) => void;
	/** True when the owner asks the system for less motion (D126): a field is then scrolled into view at once. Default: false. */
	reduced?: () => boolean;
	/** Contract 0.2.7 E.4: shows the line of succession of a title in the tree; the window has closed. */
	showLine?: (titleId: string) => void;
	/** Contract 0.2.7 K.10, M.7: the length of the line, the age of the warning and the age for open branches (the settings). Defaults: 5, 110 and 0. */
	succession?: { limit: () => number; oldAge: () => number; youngDeathAge?: () => number };
}

/** The settings of the line when the caller gives none (K.10). */
const DEFAULT_LIMIT = 5;
const DEFAULT_OLD_AGE = 110;

/** The modal that lists a tree's titles and edits them and their holders (spec §13.4). */
export class TitlesWindow extends ListEditWindow {
	private data: LoadedTitles;
	private rows: TitleRow[];
	private keys = 0;
	/** The batch that is being written had id ops: a refusal of `id-taken` or `bad-value` is about an id. */
	private sentIds = false;
	/** The ID notes of the page on screen now. */
	private pageViews: IdRowView[] = [];
	/** The Succession section of the page on screen now (a saved title only). */
	private section: SuccessionView | null = null;

	/** Null, with a Notice, if the block cannot be edited now. */
	static create(app: App, o: TitlesOptions): TitlesWindow | null {
		const l = loadTitles(o.handle.body);
		if (l.kind === 'ok') return new TitlesWindow(app, o, l.data);
		new Notice(l.kind === 'blocked' ? WRITE_TEXT.blocked : TITLES_UI.cannotOpen);
		return null;
	}

	private constructor(
		app: App,
		private readonly o: TitlesOptions,
		data: LoadedTitles,
	) {
		super(app, 'titles', 'dynasty-titles');
		this.data = data;
		this.rows = titleRows(data.g, () => this.nextKey());
	}

	private nextKey(): string {
		return `t${this.keys++}`;
	}

	/** True if the draft has an unsaved change. */
	isDirty(): boolean {
		return draftChanged(this.rows);
	}

	protected discardText(): string {
		return TITLES_UI.discardText;
	}

	protected override reduced(): boolean {
		return this.o.reduced?.() ?? false;
	}

	protected override opened(): void {
		// A turn of the phone or a resize can change the layout; the section then draws its choices as buttons or as dropdowns.
		const win = this.modalEl.win ?? window;
		const relayout = () => this.guard(() => this.section?.relayout());
		win.addEventListener('resize', relayout);
		this.cleanup.push(() => win.removeEventListener('resize', relayout));
	}

	protected released(): void {
		this.section?.dispose();
		this.section = null;
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
	}

	// ---------- the list ----------

	private byKey(key: string): TitleRow | undefined {
		return this.rows.find((t) => t.key === key);
	}

	private label(t: TitleRow): string {
		return t.name.trim() || TITLES_UI.newTitle;
	}

	private listLabel(t: TitleRow): string {
		return listName(t) || TITLES_UI.newTitle;
	}

	protected labelOf(key: string): string {
		const t = this.byKey(key);
		return t ? this.label(t) : TITLES_UI.newTitle;
	}

	protected isSaved(key: string): boolean {
		return this.byKey(key)?.id != null;
	}

	protected rowViews(): ListRowView[] {
		const problems = idProblems('title', this.rows.map(titleIdRow), this.data.dangling);
		return this.rows
			.filter((t) => !t.deleted)
			.map((t) => ({
				key: t.key,
				id: t.id,
				name: this.label(t),
				summary: this.summary(t),
				state: problems.has(t.key) ? 'check-id' : t.id === null ? 'new' : draftChanged([t]) ? 'changed' : '',
			}));
	}

	/** "3 holders · Newest holder: Aldric II": the newest holder is the last one of the draft, named as the holder row names it. */
	private summary(t: TitleRow): string {
		const count = TITLES_UI.count(t.holders.length);
		const last = t.holders[t.holders.length - 1];
		const ruler = last ? holderText(this.data.g, last.values).ruler : '';
		return ruler ? `${count} · ${WIN_LIST_UI.newest(ruler)}` : count;
	}

	/** The texts of a holder that the search looks at (the draft values): ruler text, full name, typed name, sobriquet. */
	private holderTexts(h: HolderRow): { full: string; texts: string[] } {
		const x = holderText(this.data.g, h.values);
		return { full: x.full ?? x.ruler, texts: [x.ruler, x.full ?? '', h.values.name ?? '', x.sobriquet ?? ''] };
	}

	protected matchReason(key: string, words: readonly string[]): string | null {
		const t = this.byKey(key);
		if (!t) return null;
		const own = [t.name, t.plural, t.maleName, t.femaleName];
		const holders = t.holders.map((h) => this.holderTexts(h));
		const id = t.id ?? '';
		if (!matchesAll(words, [...own, id, ...holders.flatMap((h) => h.texts)])) return null;
		// The name forms say it all: no reason line.
		if (matchesAll(words, own)) return '';
		const together = holders.find((h) => matchesAll(words, [...own, ...h.texts]));
		const any = together ?? holders.find((h) => words.some((w) => matchesAll([w], h.texts)));
		if (any) return WIN_LIST_UI.holder(any.full);
		return id ? WIN_LIST_UI.id(id) : '';
	}

	protected addItem(): string {
		const key = this.nextKey();
		this.rows.push({ key, id: null, name: '', baseName: null, plural: '', basePlural: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		return key;
	}

	// ---------- the edit page ----------

	protected renderPage(page: HTMLElement, key: string): void {
		const t = this.byKey(key);
		if (!t) return;
		this.pageViews = [];
		this.section?.dispose();
		this.section = null;
		const problem = idProblems('title', this.rows.map(titleIdRow), this.data.dangling).get(t.key);
		let heading: HTMLElement | null = null;
		// The heading of the holder list and the accessible names show the draft's names at once.
		const follow = () => {
			heading?.setText(this.listLabel(t));
			plural.setAttribute('aria-label', TITLES_UI.pluralAria(this.label(t)));
			male.setAttribute('aria-label', TITLES_UI.maleAria(this.label(t)));
			female.setAttribute('aria-label', TITLES_UI.femaleAria(this.label(t)));
			this.updateBackName(t.key);
			for (const v of this.pageViews) v.setItem(this.label(t));
			// A new title's name can change the id that it would get.
			this.refreshIdProblems();
		};
		this.textField(page, {
			cls: 'dynasty-title-name',
			label: TITLES_UI.nameLabel,
			value: t.name,
			aria: TITLES_UI.nameLabel,
			focus: `name:${t.key}`,
			onInput: (v) => {
				t.name = v;
				follow();
			},
		});
		// D66: the male form, before the female form (as in the text of the note).
		const male = this.textField(page, {
			cls: 'dynasty-title-male',
			label: TITLES_UI.maleLabel,
			value: t.maleName,
			placeholder: TITLES_UI.malePlaceholder,
			aria: TITLES_UI.maleAria(this.label(t)),
			focus: `male-name:${t.key}`,
			onInput: (v) => {
				t.maleName = v;
			},
		});
		male.parentElement?.setAttribute('data-field', 'male-name');
		// D65: the female form.
		const female = this.textField(page, {
			cls: 'dynasty-title-female',
			label: TITLES_UI.femaleLabel,
			value: t.femaleName,
			placeholder: TITLES_UI.femalePlaceholder,
			aria: TITLES_UI.femaleAria(this.label(t)),
			focus: `female-name:${t.key}`,
			onInput: (v) => {
				t.femaleName = v;
			},
		});
		female.parentElement?.setAttribute('data-field', 'female-name');
		// D64: the plural.
		const plural = this.textField(page, {
			cls: 'dynasty-title-plural',
			label: TITLES_UI.pluralLabel,
			value: t.plural,
			placeholder: TITLES_UI.pluralPlaceholder,
			aria: TITLES_UI.pluralAria(this.label(t)),
			focus: `plural:${t.key}`,
			onInput: (v) => {
				t.plural = v;
				follow();
			},
		});
		plural.parentElement?.setAttribute('data-field', 'plural');
		// The note of a new id sits under the fields (D110). The red edge goes on the page.
		if (t.id !== null && idChanged(titleIdRow(t))) {
			this.pageViews.push(
				idNote(page, {
					key: t.key,
					item: this.label(t),
					id: draftId(titleIdRow(t)),
					problem: problem ? reasonText(problem) : '',
					onKeepOld: () =>
						this.guard(() => {
							t.idDraft = t.id!;
							this.clearError();
							this.build(`id-open:${t.key}`);
						}),
				}),
			);
		}
		// A new title is marked when its name gives the ID that a changed title has taken (owner decision "3-both").
		if (t.id === null) this.pageViews.push(idNewNameNote(page, { key: t.key, problem: problem ? reasonText(problem) : '' }));
		const panel = page.createDiv({ cls: 'dynasty-holder-panel' });
		heading = panel.createDiv({ cls: 'dynasty-sheet-section-title dynasty-holder-heading', text: this.listLabel(t) });
		panel.createDiv({ cls: 'dynasty-sheet-hint', text: TITLES_UI.intro });
		panel.createDiv({ cls: 'dynasty-sheet-hint dynasty-holder-count', text: TITLES_UI.count(t.holders.length) });
		const holders = panel.createDiv({ cls: 'dynasty-holder-list' });
		if (!t.holders.length) holders.createDiv({ cls: 'dynasty-holder-none', text: TITLES_UI.noHolders });
		t.holders.forEach((h, i) => this.holderRow(holders, t, h, i));
		const buttons = panel.createDiv({ cls: 'dynasty-holder-panel-buttons' });
		const addHolder = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-add'], text: TITLES_UI.addHolder, attr: { type: 'button', 'aria-label': TITLES_UI.addHolderLabel(this.label(t)), 'data-focus': `add-holder:${t.key}` } });
		addHolder.addEventListener('click', () => this.guard(() => void this.addHolder(t)));
		// The saved list only: a title that is not saved yet has none (spec §13.4).
		if (t.id !== null) {
			const id = t.id;
			const note = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-title-note'], text: TITLES_UI.makeNote, attr: { type: 'button', 'aria-label': TITLES_UI.makeNoteLabel(savedListName(t)), 'data-focus': `note:${t.key}` } });
			note.addEventListener('click', () => this.guard(() => this.askNote(id, `note:${t.key}`)));
		}
		this.successionPart(page, t);
		this.otherActions(page, t.key, 'dynasty-title-delete', (name) => TITLES_UI.deleteLabel(name));
	}

	// ---------- the Succession section (contract 0.2.7 E) ----------

	/** The section after the holder list and before Other actions. A title that is not saved yet shows only the "new title" text. */
	private successionPart(page: HTMLElement, t: TitleRow): void {
		if (t.id === null || !t.succ) {
			const box = page.createDiv({ cls: 'dynasty-succ', attr: { role: 'group', 'aria-label': SUCCESSION_UI.heading, 'data-section': 'succession' } });
			box.createDiv({ cls: 'dynasty-sheet-section-title', text: SUCCESSION_UI.heading });
			box.createDiv({ cls: 'dynasty-sheet-hint', text: SUCCESSION_UI.newTitle, attr: { 'data-hint': 'new-title' } });
			return;
		}
		const settings = this.o.succession;
		this.section = successionSection(page, {
			g: () => this.data.g,
			row: t,
			limit: () => settings?.limit() ?? DEFAULT_LIMIT,
			oldAge: () => settings?.oldAge() ?? DEFAULT_OLD_AGE,
			youngDeathAge: () => settings?.youngDeathAge?.() ?? 0,
			phone: () => this.modalEl.hasClass('is-phone'),
			win: () => this.modalEl.win ?? window,
			edited: () => this.clearError(),
			guard: (fn) => this.guard(fn),
			showCard: (id) => this.showCard(id),
			show: () => this.showLine(t),
			pick: (kind, skip) => this.pickForSection(kind, skip),
		});
	}

	/** The picker of a named heir or an excluded person: no "Create new person" row, and the people in `skip` are not offered. */
	private async pickForSection(kind: 'heir' | 'exclude', skip: ReadonlySet<string>): Promise<string | null> {
		if (this.busy) return null;
		this.busy = true;
		try {
			const picked = await pickPerson(this.app, this.data.g, new Set(skip), SUCCESSION_UI.pickerPlaceholder, kind === 'heir' ? SUCCESSION_UI.heirPickerTitle : SUCCESSION_UI.excludePickerTitle, false);
			return picked?.kind === 'person' && !this.closing ? picked.id : null;
		} finally {
			this.busy = false;
		}
	}

	/** Show (E.4): with no changes the window closes and the tree shows the line; with changes it asks first. */
	private showLine(t: TitleRow): void {
		if (!this.isDirty()) {
			const id = t.id;
			this.finish();
			if (id !== null) this.o.showLine?.(id);
			return;
		}
		this.showConfirm(SUCCESSION_UI.unsavedTitle, [SUCCESSION_UI.unsaved], 'succ-show', [
			{ label: REMOVE.cancel, cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{
				label: SUCCESSION_UI.saveAndShow,
				cls: 'mod-cta dynasty-confirm-show',
				run: () => {
					this.hideConfirm();
					void this.save(null, t.key).catch((e) => console.error('Dynasty Tree: the Titles window could not save', e));
				},
			},
		]);
	}

	private holderRow(list: HTMLElement, t: TitleRow, h: HolderRow, i: number): void {
		const text = holderText(this.data.g, h.values);
		const row = list.createDiv({ cls: text.inTree ? 'dynasty-holder-row' : ['dynasty-holder-row', 'is-not-in-tree'], attr: { 'data-holder': h.key } });
		if (h.values.person !== undefined) row.setAttribute('data-person', h.values.person);
		const words = row.createDiv({ cls: 'dynasty-holder-text' });
		if (text.inTree) {
			const person = h.values.person!;
			const name = words.createEl('button', { cls: 'dynasty-holder-name', attr: { type: 'button', 'aria-label': TITLES_UI.showCardLabel(text.ruler), 'data-focus': `name:${h.key}` } });
			// A button is a flex box in Obsidian, and a flex box drops the space that starts a text item. One inline label around
			// the ruler text and the sobriquet is the only item, so the space before the sobriquet stays (D130 item 8).
			const label = name.createSpan({ cls: 'dynasty-holder-label', text: text.ruler });
			// D122: the sobriquet follows the ruler text on the same text line, in regular weight (the button is semibold).
			if (text.sobriquet !== undefined) label.createSpan({ cls: 'dynasty-picker-sob', text: ` ${quotedSobriquet(text.sobriquet)}` });
			name.addEventListener('click', () => this.guard(() => this.showCard(person)));
		} else words.createDiv({ cls: 'dynasty-holder-name', text: text.ruler });
		if (text.full) words.createDiv({ cls: 'dynasty-holder-full', text: text.full });
		if (text.reign) words.createDiv({ cls: 'dynasty-holder-reign', text: text.reign });
		if (!text.inTree) words.createDiv({ cls: 'dynasty-holder-note', text: TITLES_UI.notInTree });
		const buttons = row.createDiv({ cls: 'dynasty-holder-buttons' });
		const move = (dir: -1 | 1, cls: string, icon: string, label: string, aria: string) => {
			const b = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-move', cls], attr: { type: 'button', 'aria-label': aria, 'data-focus': `${cls}:${h.key}` } });
			setIcon(b.createSpan({ cls: 'dynasty-holder-move-icon' }), icon);
			b.createSpan({ cls: 'dynasty-holder-move-text', text: label });
			const to = i + dir;
			b.disabled = to < 0 || to >= t.holders.length;
			b.addEventListener('click', () =>
				this.guard(() => {
					if (to < 0 || to >= t.holders.length) return;
					[t.holders[i], t.holders[to]] = [t.holders[to], t.holders[i]];
					// The focus stays on the pressed button of the moved holder, or on its other arrow at an end.
					const end = to === 0 || to === t.holders.length - 1;
					this.build(end ? `${dir < 0 ? 'dynasty-holder-later' : 'dynasty-holder-earlier'}:${h.key}` : `${cls}:${h.key}`);
				}),
			);
		};
		move(-1, 'dynasty-holder-earlier', 'arrow-up', TITLES_UI.moveEarlier, TITLES_UI.moveEarlierLabel(text.ruler));
		move(1, 'dynasty-holder-later', 'arrow-down', TITLES_UI.moveLater, TITLES_UI.moveLaterLabel(text.ruler));
		const edit = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-edit'], text: TITLES_UI.edit, attr: { type: 'button', 'aria-label': TITLES_UI.editLabel(text.ruler), 'data-focus': `edit:${h.key}` } });
		edit.addEventListener('click', () => this.guard(() => this.editHolder(t, h)));
		const remove = buttons.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-holder-remove'], text: TITLES_UI.remove, attr: { type: 'button', 'aria-label': TITLES_UI.removeLabel(text.ruler), 'data-focus': `remove:${h.key}` } });
		remove.addEventListener('click', () =>
			this.guard(() => {
				const at = t.holders.indexOf(h);
				if (at < 0) return;
				t.holders.splice(at, 1);
				const next = t.holders[at] ?? t.holders[at - 1];
				this.build(next ? `remove:${next.key}` : `add-holder:${t.key}`);
			}),
		);
	}

	// ---------- Delete and the small ID window (spec §13.17 rule 5, D110) ----------

	/** Delete (spec §13.4): a saved title asks first, with the number of its holders and of the cards that change. */
	protected askDelete(key: string): void {
		const t = this.byKey(key);
		if (!t) return;
		const drop = () => {
			if (t.id === null) this.rows.splice(this.rows.indexOf(t), 1);
			else t.deleted = true;
			this.afterDelete(key);
		};
		if (t.id === null) {
			drop();
			return;
		}
		const d = describeDeleteTitle(this.data.g, t.id);
		const text = [...(d.holders > 0 ? [TITLES_UI.deleteHolders(d.holders)] : []), ...(d.cards > 0 ? [TITLES_UI.deleteCards(d.cards)] : [])];
		this.showConfirm(TITLES_UI.deleteTitle(t.baseName || this.label(t)), text, `delete:${t.key}`, [
			{ label: REMOVE.cancel, cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{ label: TITLES_UI.delete, cls: 'mod-warning dynasty-confirm-delete-title', run: drop },
		]);
	}

	/** "Change ID": the small window; "Use this ID" puts the id into the draft of the title. */
	protected changeId(key: string): void {
		const t = this.byKey(key);
		// Focus can leave the small window by Tab, and a screen reader can activate the button below it.
		if (!t || this.idWindowOpen) return;
		this.idWindowOpen = true;
		const from = `id-open:${t.key}`;
		openIdWindow(this.app, {
			kind: 'title',
			item: this.label(t),
			key: t.key,
			value: t.idDraft ?? t.id ?? '',
			check: (value) => idProblemFor('title', this.rows.map(titleIdRow), titleIdRow(t), value, this.data.dangling),
			make: () => idFromName('title', this.rows.map(titleIdRow), titleIdRow(t), this.data.dangling),
			use: (value) => {
				// The saved id again is no change: the draft goes away.
				t.idDraft = value;
				this.clearError();
			},
			closed: (used) => {
				// Before the guard, so no path leaves the flag set.
				this.idWindowOpen = false;
				this.guard(() => {
					if (this.closing) return;
					if (used) this.build(from);
					else this.refocus(from);
				});
			},
		});
	}

	/** Shows the reason in the note of the open page when its draft id is refused, without drawing the window again. */
	private refreshIdProblems(): void {
		const key = this.page;
		if (key === null) return;
		const why = idProblems('title', this.rows.map(titleIdRow), this.data.dangling).get(key);
		for (const v of this.pageViews) v.setProblem(why ? reasonText(why) : '');
	}

	// ---------- holders ----------

	private editHolder(t: TitleRow, h: HolderRow): void {
		const personName = personNameOf(this.data.g, h.values);
		this.overWindow((done) =>
			holderForm(this.app, {
				heading: TITLES_UI.formEdit,
				context: this.context(t, personName ?? h.values.name),
				values: h.values,
				personName,
				askName: personName === undefined,
				save: (v) => {
					h.values = v;
					return null;
				},
				closed: () => done(`edit:${h.key}`),
			}),
		);
	}

	/** Add holder (spec §13.4): the picker, whose first row is "A holder who is not in the tree", then the holder form. */
	private async addHolder(t: TitleRow): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		let picked: Awaited<ReturnType<typeof pickPerson>> = null;
		try {
			picked = await pickPerson(this.app, this.data.g, new Set(), TITLES_UI.pickerPlaceholder, TITLES_UI.pickerTitle, true, null, () => TITLES_UI.notInTreeRow);
		} finally {
			this.busy = false;
		}
		if (!picked || this.closing) {
			this.refocus(`add-holder:${t.key}`);
			return;
		}
		const values: HolderValues = picked.kind === 'person' ? { person: picked.id } : picked.name ? { name: picked.name } : {};
		const askName = picked.kind === 'new';
		const personName = personNameOf(this.data.g, values);
		this.overWindow((done) =>
			holderForm(this.app, {
				heading: TITLES_UI.formNew,
				context: this.context(t, personName),
				values,
				personName,
				askName,
				save: (v) => {
					const key = this.nextKey();
					t.holders.push({ key, ref: null, base: null, values: v });
					return null;
				},
				closed: () => done(`add-holder:${t.key}`),
			}),
		);
	}

	private context(t: TitleRow, who: string | undefined): string {
		return who ? `${who}: ${this.label(t)}` : this.label(t);
	}

	/** Runs a modal over the window; when it closes, the window draws the draft again with the focus on `focus`. */
	private overWindow(open: (done: (focus: string) => void) => void): void {
		if (this.busy) return;
		this.busy = true;
		open((focus) => {
			this.busy = false;
			if (!this.closing) this.build(focus);
		});
	}

	/** A holder's name (spec §13.4): the window closes and the tree shows the card like Find; with changes, it asks first. */
	private showCard(id: string): void {
		const go = () => {
			this.finish();
			this.o.show?.(id);
		};
		if (this.isDirty()) this.askDiscard(go);
		else go();
	}

	/** Make a note with this table (spec §13.4, D55): with unsaved changes it asks first, and the note has the saved list. */
	private askNote(id: string, from: string): void {
		const make = () => {
			this.hideConfirm();
			void this.makeNote(id, from);
		};
		if (!this.isDirty()) {
			make();
			return;
		}
		this.showConfirm(TITLES_UI.noteTitle, [TITLES_UI.noteText], from, [
			{ label: REMOVE.cancel, cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{ label: TITLES_UI.noteConfirm, cls: 'mod-cta dynasty-confirm-note', run: make },
		]);
	}

	private async makeNote(id: string, from: string): Promise<void> {
		const out = await makeTableNote(this.app, this.o.handle.body, id, this.o.sourcePath);
		new Notice(out.ok ? TITLES_UI.noteMade(out.name) : out.why === 'gone' ? TITLES_UI.noteGone : TITLES_UI.noteFailed);
		this.refocus(from);
	}

	// ---------- writes ----------

	/** True if the window shows the handle's current body; otherwise the stale message and false (spec §6.1). */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	/**
	 * Save. `asked` is the ID change that the owner just answered: the answer runs Save again on the draft as it is then (C4).
	 * `show` is the row key of the title that "Save and show" opens in the tree after a successful write (E.4).
	 */
	protected async save(asked: string | null = null, show: string | null = null): Promise<void> {
		if (this.saving || this.busy) return;
		const empty = emptyNames(this.rows)[0];
		if (empty) {
			// The empty name is on its page: the page opens, the error shows there, and the focus goes to the field.
			this.openPage(empty.key, `name:${empty.key}`);
			this.showError(TITLES_UI.needName);
			return;
		}
		if (!draftChanged(this.rows)) {
			this.finish();
			return;
		}
		if (!this.fresh()) return;
		const problems = idProblems('title', this.rows.map(titleIdRow), this.data.dangling);
		// The page of a saved title opens: a new title has no "Change ID" button, and the saved title that it conflicts with is marked too.
		const bad = this.rows.find((t) => t.id !== null && problems.has(t.key));
		if (bad) {
			// D113 item 3: the reason shows once, on the page (its note and red edge); the top line shows nothing for an ID.
			this.clearError();
			this.openPage(bad.key, `id-open:${bad.key}`);
			return;
		}
		const body = this.data.body;
		// Ids from the names, each one unused also by the ids chosen before it in this Save (§6.8).
		// `draftChanged` is true, so `windowOps` is never empty here.
		const ops = withHolderIds(
			windowOps(this.rows, (name, taken) => newTitleId(body, name, taken)),
			this.data.g,
			this.data.raw,
		);
		const changed = this.rows.filter((t) => idChanged(titleIdRow(t)));
		const what = changed.map((t) => `${t.key}:${t.id}>${draftId(titleIdRow(t))}`).join('|');
		if (changed.length && what !== asked) {
			// The note can change while the question is open (sync, another pane): the answer checks the body again.
			this.askIds(changed, () => void this.save(what, show));
			return;
		}
		await this.commit(ops, show);
	}

	/** The one question before Save changes an id: what changes, and how many people. Closing it is Cancel. */
	private askIds(changed: TitleRow[], go: () => void): void {
		const lines = changed.map((t) => ID_UI.confirmLine(this.label(t), t.id!, draftId(titleIdRow(t)), ID_UI.places(describeTitleIdChange(this.data.g, t.id!).people)));
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
	private async commit(ops: Op[], show: string | null = null): Promise<void> {
		if (this.saving) return;
		// The id the title has after the write, for "Save and show".
		const showRow = show !== null ? this.byKey(show) : undefined;
		const showId = showRow && showRow.id !== null ? (idChanged(titleIdRow(showRow)) ? draftId(titleIdRow(showRow)) : showRow.id) : null;
		const deleted = this.rows.filter((t) => t.id !== null && t.deleted).map((t) => t.baseName || t.id!);
		const idCount = ops.filter(isIdOp).length;
		const h = this.o.handle;
		this.sentIds = idCount > 0;
		this.saving = true;
		this.modalEl.addClass('is-saving');
		let out: HandleWriteOutcome;
		try {
			this.o.beforeWrite?.();
			// One write, so one Undo reverts every change of the window (spec §6.1, D8, §13.0 item 6).
			out = await h.write({ kind: 'batch', ops });
		} catch (e) {
			console.error('Dynasty Tree: cannot save the titles', e);
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
		if (showId !== null) {
			try {
				this.o.showLine?.(showId);
			} catch (e) {
				console.error('Dynasty Tree: cannot show the line of succession', e);
			}
		}
		if (deleted.length) {
			const others = ops.length > deleted.length;
			undoNotice(others ? `${TITLES_UI.deleted(deleted)} ${REMOVE.undoAlso}` : TITLES_UI.deleted(deleted), h, out.body);
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
				if (idText) {
					this.refused(idText);
					return;
				}
				const gone = code === 'unknown-title' || code === 'unknown-holder' || code === 'unknown-person' || code === 'id-taken';
				// A title, holder or person that is not in the tree now: the tree changed under the window.
				// With the same body a reload changes nothing, so the stale message would come back at each Save.
				if (gone && normBody(h.body) !== normBody(this.data.body)) this.stale(h.body);
				else if (code === 'unknown-person') this.refused(TITLES_UI.personGone);
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
		this.showError(TITLES_UI.stale);
	}

	/** Shows the block's new titles, with the owner's changes on top (`rebase`). An open page stays when its title is still there. */
	private reload(body: string): void {
		const l = loadTitles(body);
		if (l.kind !== 'ok') {
			this.refused(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.invalid);
			return;
		}
		this.data = l.data;
		this.rows = rebase(this.rows, titleRows(l.data.g, () => this.nextKey()));
		if (this.page !== null && !this.rows.some((t) => t.key === this.page && !t.deleted)) this.page = null;
		this.build();
	}
}
