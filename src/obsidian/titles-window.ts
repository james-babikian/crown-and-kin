/*
 * The Titles window (spec §13.4, §13.0 item 6; D49, D52, D55): the titles of one tree with their
 * holder lists, and the "Name for a man" (D66), "Name for a woman" (D65), "Name of the list" (D64) of each title and the button "Change ID" (§13.17 rule 5, D109, D110; the small window is `id-window.ts`). Like the Houses window it is a draft: Save writes every change in one `batch` (one
 * undo step), Cancel writes nothing, and any other way to close with changes asks first. The window
 * opens from the More list on the computer and in the full-screen view, never from the static phone
 * preview (`tree-view.ts`). The draft logic is in `titles-draft.ts`, the holder form in
 * `holder-form.ts`, and "Make a note with this table" in `table-note.ts`.
 */

import { Modal, Notice, setIcon, type App } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { Op } from '../core/edit';
import { normBody } from '../core/block-match';
import { parseBody, readTree } from '../core/parse';
import { newTitleId } from '../core/title-ops';
import { describeDeleteTitle, describeTitleIdChange } from '../core/titles';
import { HOUSES, ID_UI, REMOVE, SHEET, TITLES_UI, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { holderForm } from './holder-form';
import { danglingIds, draftId, idChanged, idFromName, idProblemFor, idProblems, idRefusalText, isIdOp, reasonText, type IdReason } from './id-draft';
import { idNewNameNote, idNote, idOpenButton, type IdRowView } from './id-field';
import { openIdWindow } from './id-window';
import { phoneLayout } from './modal-layout';
import { pickPerson } from './person-picker';
import { trackModal } from './plugin-modals';
import { freshOrStale, nameDialog, onWriteFailed, revealFocused, showErrorLine } from './sheet-parts';
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
}

/** The modal that lists a tree's titles and edits them and their holders (spec §13.4). */
export class TitlesWindow extends Modal {
	private data: LoadedTitles;
	private rows: TitleRow[];
	/** The titles whose holders show. */
	private readonly shownHolders = new Set<string>();
	private keys = 0;
	private saving = false;
	private closing = false;
	private confirmEl: HTMLElement | null = null;
	private confirmFrom: string | null = null;
	private errorEl: HTMLElement | null = null;
	private error = '';
	/** The Id parts (button and note) of the rows on screen now, by row key. */
	private idViews = new Map<string, IdRowView[]>();
	/** The batch that is being written had id ops: a refusal of `id-taken` or `bad-value` is about an id. */
	private sentIds = false;
	/** A picker or the holder form is open over the window. */
	private busy = false;
	/** True while the small ID window is open, so a second "Change ID" opens no second window. */
	private idWindowOpen = false;
	private readonly cleanup: (() => void)[] = [];

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
		super(app);
		this.data = data;
		this.rows = titleRows(data.g, () => this.nextKey());
	}

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-titles');
		this.cleanup.push(phoneLayout(this, () => revealFocused(this.modalEl, this.contentEl)), trackModal(this, () => this.finish()));
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus (C1).
		const reveal = () => revealFocused(this.modalEl, this.contentEl, 300);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
		this.build();
		// Keyboard users start at the top of the window, not in the note below it.
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	override onClose(): void {
		// The focused control goes with the window: let go of it first, so the focus can go back to More.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		if (active && this.modalEl.contains(active)) active.blur();
		for (const c of this.cleanup.splice(0)) c();
		this.contentEl.empty();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
	}

	/** Esc, the X button, a press outside and Android back all come here (spec §6.3 commit model). */
	override close(): void {
		if (this.closing) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.hideConfirm();
			return;
		}
		if (this.isDirty()) {
			this.askDiscard(() => this.finish());
			return;
		}
		this.finish();
	}

	private finish(): void {
		this.closing = true;
		this.close();
	}

	private nextKey(): string {
		return `t${this.keys++}`;
	}

	/** True if the draft has an unsaved change. */
	isDirty(): boolean {
		return draftChanged(this.rows);
	}

	// ---------- building the window ----------

	/** Draws the window again from the draft; `focus` names the control that gets the focus. */
	private build(focus: string | null = null): void {
		const el = this.contentEl;
		// A control that had the focus keeps it, so the focus never leaves the window.
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		const had = active && el.contains(active) ? active.getAttribute('data-focus') : null;
		focus ??= had;
		const top = el.querySelector<HTMLElement>('.dynasty-sheet-body')?.scrollTop ?? 0;
		el.empty();
		this.idViews = new Map();
		this.hideConfirm(false);
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: TITLES_UI.title }));
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		const cancel = actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: SHEET.cancel, attr: { type: 'button', 'data-focus': 'cancel' } });
		cancel.addEventListener('click', () => this.finish());
		const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button', 'data-focus': 'save' } });
		save.addEventListener('click', () => void this.save());

		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-sheet-hint', text: TITLES_UI.intro });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.setText(this.error);
		this.errorEl.toggle(this.error !== '');
		const list = body.createDiv({ cls: 'dynasty-title-list' });
		const shown = this.rows.filter((t) => !t.deleted);
		if (!shown.length) list.createDiv({ cls: 'dynasty-title-none', text: TITLES_UI.none });
		const problems = idProblems('title', this.rows.map(titleIdRow), this.data.dangling);
		for (const t of shown) this.titleRow(list, t, problems.get(t.key));
		const add = body.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-title-add'], text: TITLES_UI.add, attr: { type: 'button', 'data-focus': 'add' } });
		add.addEventListener('click', () => this.guard(() => this.addTitle()));
		body.scrollTop = top;
		if (focus) el.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus({ preventScroll: false });
	}

	private label(t: TitleRow): string {
		return t.name.trim() || TITLES_UI.newTitle;
	}

	private listLabel(t: TitleRow): string {
		return listName(t) || TITLES_UI.newTitle;
	}

	private titleRow(list: HTMLElement, t: TitleRow, problem?: IdReason): void {
		const box = list.createDiv({ cls: 'dynasty-title-box', attr: { 'data-title': t.id ?? t.key } });
		const row = box.createDiv({ cls: 'dynasty-title-row' });
		const name = row.createEl('input', { cls: 'dynasty-sheet-input', attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': TITLES_UI.nameLabel, 'data-focus': `name:${t.key}` } });
		name.value = t.name;
		const views: IdRowView[] = [];
		// The note of a new id sits under the name (D110); the grid puts it there.
		if (t.id !== null && idChanged(titleIdRow(t))) {
			views.push(
				idNote(row, {
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
		// A new row is marked when its name gives the ID that a changed row has taken (owner decision "3-both").
		if (t.id === null) views.push(idNewNameNote(row, { key: t.key, problem: problem ? reasonText(problem) : '' }));
		row.createDiv({ cls: 'dynasty-title-count', text: TITLES_UI.count(t.holders.length) });
		const open = this.shownHolders.has(t.key);
		const toggle = row.createEl('button', {
			cls: ['dynasty-sheet-action', 'dynasty-title-toggle'],
			text: open ? TITLES_UI.hideHolders : TITLES_UI.showHolders,
			attr: { type: 'button', 'aria-expanded': String(open), 'aria-label': open ? TITLES_UI.hideHoldersLabel(this.label(t)) : TITLES_UI.showHoldersLabel(this.label(t)), 'data-focus': `toggle:${t.key}` },
		});
		toggle.addEventListener('click', () =>
			this.guard(() => {
				if (open) this.shownHolders.delete(t.key);
				else this.shownHolders.add(t.key);
				this.build(`toggle:${t.key}`);
			}),
		);
		// Only a saved title has an id to change; a new title gets its id when it is saved (§6.8).
		if (t.id !== null) views.push(idOpenButton(row, { key: t.key, item: this.label(t), onOpen: () => this.guard(() => this.changeId(t)) }));
		this.idViews.set(t.key, views);
		const del = row.createEl('button', { cls: ['dynasty-sheet-action', 'dynasty-title-delete'], text: TITLES_UI.delete, attr: { type: 'button', 'aria-label': TITLES_UI.deleteLabel(this.label(t)), 'data-focus': `delete:${t.key}` } });
		del.addEventListener('click', () => this.guard(() => this.askDelete(t)));
		// The text fields share one grid, so their inputs line up.
		const fields = box.createDiv({ cls: 'dynasty-title-fields' });
		// D66: the male form, before the female form (as in the text of the note).
		const maleField = fields.createEl('label', { cls: ['dynasty-title-field', 'dynasty-title-male'], attr: { 'data-field': 'male-name' } });
		maleField.createSpan({ cls: 'dynasty-sheet-label', text: TITLES_UI.maleLabel });
		const male = maleField.createEl('input', {
			cls: 'dynasty-sheet-input',
			attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', placeholder: TITLES_UI.malePlaceholder, 'aria-label': TITLES_UI.maleAria(this.label(t)), 'data-focus': `male-name:${t.key}` },
		});
		male.value = t.maleName;
		// D65: the female form. A label element, so a press on its text also puts the cursor in the field.
		const femaleField = fields.createEl('label', { cls: ['dynasty-title-field', 'dynasty-title-female'], attr: { 'data-field': 'female-name' } });
		femaleField.createSpan({ cls: 'dynasty-sheet-label', text: TITLES_UI.femaleLabel });
		const female = femaleField.createEl('input', {
			cls: 'dynasty-sheet-input',
			attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', placeholder: TITLES_UI.femalePlaceholder, 'aria-label': TITLES_UI.femaleAria(this.label(t)), 'data-focus': `female-name:${t.key}` },
		});
		female.value = t.femaleName;
		// D64: the plural.
		const field = fields.createEl('label', { cls: ['dynasty-title-field', 'dynasty-title-plural'], attr: { 'data-field': 'plural' } });
		field.createSpan({ cls: 'dynasty-sheet-label', text: TITLES_UI.pluralLabel });
		const plural = field.createEl('input', {
			cls: 'dynasty-sheet-input',
			attr: { type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', placeholder: TITLES_UI.pluralPlaceholder, 'aria-label': TITLES_UI.pluralAria(this.label(t)), 'data-focus': `plural:${t.key}` },
		});
		plural.value = t.plural;
		let heading: HTMLElement | null = null;
		// The heading of an open holder list shows the draft's list name at once.
		const follow = () => {
			heading?.setText(this.listLabel(t));
			plural.setAttribute('aria-label', TITLES_UI.pluralAria(this.label(t)));
			male.setAttribute('aria-label', TITLES_UI.maleAria(this.label(t)));
			female.setAttribute('aria-label', TITLES_UI.femaleAria(this.label(t)));
			for (const v of this.idViews.get(t.key) ?? []) v.setItem(this.label(t));
			// A new title's name can change the id that it would get.
			this.refreshIdProblems();
			this.clearError();
		};
		name.addEventListener('input', () => {
			t.name = name.value;
			follow();
		});
		plural.addEventListener('input', () => {
			t.plural = plural.value;
			follow();
		});
		male.addEventListener('input', () => {
			t.maleName = male.value;
			this.clearError();
		});
		female.addEventListener('input', () => {
			t.femaleName = female.value;
			this.clearError();
		});
		if (!open) return;
		const panel = box.createDiv({ cls: 'dynasty-holder-panel' });
		heading = panel.createDiv({ cls: 'dynasty-sheet-section-title dynasty-holder-heading', text: this.listLabel(t) });
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
	}

	// ---------- the small ID window (spec §13.17 rule 5, D110) ----------

	/** "Change ID": the small window; "Use this ID" puts the id into the draft of the row. */
	private changeId(t: TitleRow): void {
		// Focus can leave the small window by Tab, and a screen reader can activate the button below it.
		if (this.idWindowOpen) return;
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

	/** Shows the reason in the note of each row whose draft id is refused, without drawing the window again. */
	private refreshIdProblems(): void {
		const problems = idProblems('title', this.rows.map(titleIdRow), this.data.dangling);
		for (const [key, views] of this.idViews) {
			const why = problems.get(key);
			for (const v of views) v.setProblem(why ? reasonText(why) : '');
		}
	}

	private holderRow(list: HTMLElement, t: TitleRow, h: HolderRow, i: number): void {
		const text = holderText(this.data.g, h.values);
		const row = list.createDiv({ cls: text.inTree ? 'dynasty-holder-row' : ['dynasty-holder-row', 'is-not-in-tree'], attr: { 'data-holder': h.key } });
		if (h.values.person !== undefined) row.setAttribute('data-person', h.values.person);
		const words = row.createDiv({ cls: 'dynasty-holder-text' });
		if (text.inTree) {
			const person = h.values.person!;
			const name = words.createEl('button', { cls: 'dynasty-holder-name', text: text.ruler, attr: { type: 'button', 'aria-label': TITLES_UI.showCardLabel(text.ruler), 'data-focus': `name:${h.key}` } });
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

	private addTitle(): void {
		const key = this.nextKey();
		this.rows.push({ key, id: null, name: '', baseName: null, plural: '', basePlural: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		this.shownHolders.add(key);
		this.clearError();
		this.build(`name:${key}`);
	}

	/** The control that takes the focus after a title goes: the next title's Delete, else Add title. */
	private focusAfter(t: TitleRow): string {
		const shown = this.rows.filter((x) => !x.deleted || x === t);
		const next = shown[shown.indexOf(t) + 1];
		return next ? `delete:${next.key}` : 'add';
	}

	/** Delete (spec §13.4): a saved title asks first, with the number of its holders and of the cards that change. */
	private askDelete(t: TitleRow): void {
		const after = this.focusAfter(t);
		const drop = () => {
			if (t.id === null) this.rows.splice(this.rows.indexOf(t), 1);
			else t.deleted = true;
			this.shownHolders.delete(t.key);
			this.build(after);
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
					this.shownHolders.add(t.key);
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

	private refocus(focus: string): void {
		if (!this.closing) this.contentEl.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
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

	private askDiscard(then: () => void): void {
		this.showConfirm(SHEET.discardTitle, [TITLES_UI.discardText], null, [
			{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: () => this.hideConfirm() },
			{ label: SHEET.discard, cls: 'mod-warning dynasty-sheet-discard', run: then },
		]);
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

	// ---------- questions over the window ----------

	private showConfirm(title: string, text: string[], from: string | null, buttons: { label: string; cls: string; run: () => void }[]): void {
		this.hideConfirm(false);
		// Without a named control, the focus goes back to the one that had it, else to Save (it must stay in the window).
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		this.confirmFrom = from ?? (active && this.contentEl.contains(active) ? active.getAttribute('data-focus') : null) ?? 'save';
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		const titleEl = box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: title });
		const titleId = `dynasty-titles-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of text) box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		let first: HTMLElement | null = null;
		for (const b of buttons) {
			const el = row.createEl('button', { cls: b.cls.split(' '), text: b.label, attr: { type: 'button' } });
			el.addEventListener('click', () => this.guard(b.run));
			first ??= el;
		}
		first?.focus();
	}

	private hideConfirm(refocus = true): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		if (had && refocus && this.confirmFrom) this.refocus(this.confirmFrom);
		this.confirmFrom = null;
	}

	// ---------- writes ----------

	/** True if the window shows the handle's current body; otherwise the stale message and false (spec §6.1). */
	private fresh(): boolean {
		return freshOrStale(this.o.handle, this.data.body, (body) => this.stale(body));
	}

	/** Save. `asked` is the ID change that the owner just answered: the answer runs Save again on the draft as it is then (C4). */
	private async save(asked: string | null = null): Promise<void> {
		if (this.saving || this.busy) return;
		const empty = emptyNames(this.rows)[0];
		if (empty) {
			this.showError(TITLES_UI.needName);
			this.refocus(`name:${empty.key}`);
			return;
		}
		if (!draftChanged(this.rows)) {
			this.finish();
			return;
		}
		if (!this.fresh()) return;
		const problems = idProblems('title', this.rows.map(titleIdRow), this.data.dangling);
		// The focus goes to a saved row: a new row has no "Change ID" button, and the saved row that it conflicts with is marked too.
		const bad = this.rows.find((t) => t.id !== null && problems.has(t.key));
		if (bad) {
			// D113 item 3: the reason shows once, in the row (its note and red edge); the top line shows nothing for an ID.
			this.clearError();
			this.refreshIdProblems();
			this.refocus(`id-open:${bad.key}`);
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
			this.askIds(changed, () => void this.save(what));
			return;
		}
		await this.commit(ops);
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
	private async commit(ops: Op[]): Promise<void> {
		if (this.saving) return;
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

	/** Shows the block's new titles, with the owner's changes on top (`rebase`). */
	private reload(body: string): void {
		const l = loadTitles(body);
		if (l.kind !== 'ok') {
			this.refused(l.kind === 'blocked' ? WRITE_TEXT.blocked : HOUSES.invalid);
			return;
		}
		this.data = l.data;
		this.rows = rebase(this.rows, titleRows(l.data.g, () => this.nextKey()));
		for (const k of [...this.shownHolders]) if (!this.rows.some((t) => t.key === k)) this.shownHolders.delete(k);
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
			console.error('Dynasty Tree: the Titles window failed', e);
		}
	}
}
