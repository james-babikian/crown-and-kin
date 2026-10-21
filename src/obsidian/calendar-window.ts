/*
 * The Calendars window (spec §14 rules 1, 3, 6 and 7; D251). It shows the calendars of one calendar note of the tree, with Add (cycle calendar, era calendar),
 * Change and Remove, the name and folder of the note and "New calendar note", and a test line below each calendar. It is a draft in the way of the other windows
 * (D112): Save writes the changes in one step, Cancel writes nothing, and any other way to close with changes asks first. A refusal of `checkFormat` or
 * `checkCalendars` is shown in the window and the window does not save; a warning (the same format in another calendar note) is shown and the save goes ahead.
 * The draft is `view/calendar-draft.ts`, a card is `calendar-card.ts`, the file work is `calendar-note.ts`. The first save makes the note `Calendars` at the root of the vault.
 */

import { Notice, type App } from 'obsidian';
import { linkedNotePath } from '../core/note-make';
import type { Calendar, DateReader } from '../core/dates';
import { issueText } from '../core/messages';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { checkDraft, draftChanged, draftOf, newCalendar, newEra, opsOf, type CalendarDraft, type Checked } from '../view/calendar-draft';
import type { CalendarIndex } from '../view/calendar-index';
import { drawCalendar, type CardHost } from './calendar-card';
import { loadNote, makeCalendarNote, newNoteDefaults, saveNote, type LoadedNote } from './calendar-note';
import { sheetField, showErrorLine, nameDialog } from './sheet-parts';
import { SmallFormModal } from './small-form';
import { textButton } from './window-parts';
import { buildShell } from './window-shell';

/** What opens the window. */
export interface CalendarsOptions {
	/** The note of the tree: a link in `options.calendar` is read from it. */
	treePath: string;
	/** The `calendar` option of the tree, as written; undefined: the tree uses every calendar note. */
	link: string | undefined;
	/** Open on this calendar note (the Edit button of a block). */
	note?: string;
	/** Runs when the window has closed: the focus goes back to the control that opened it. */
	onClosed?: () => void;
}

/** The name of a note for a list: the file name without ".md", and the folder when notes of two folders share a name. */
const noteLabel = (path: string, all: readonly string[]): string => {
	const name = path.replace(/^.*\//, '').replace(/\.md$/i, '');
	return all.filter((p) => p.replace(/^.*\//, '') === path.replace(/^.*\//, '')).length > 1 ? path.replace(/\.md$/i, '') : name;
};

class CalendarsWindow extends SmallFormModal {
	private note: LoadedNote | null;
	private drafts: CalendarDraft[];
	private counter = 0;
	private checkedNow: Checked;
	private readonly updates: (() => void)[] = [];
	private cards: HTMLElement | null = null;
	private noteBox: HTMLElement | null = null;
	/** The head: the note name and folder under the title, and the "New calendar note" link. */
	private metaEl: HTMLElement | null = null;
	private linksEl: HTMLElement | null = null;
	/** The choice among the notes of the tree: it is off while the draft has a change, and says why. */
	private noteSelect: HTMLSelectElement | null = null;
	private noteHint: HTMLElement | null = null;
	/** A new note: its name and folder as typed (used while `note` is null). */
	private newName: string;
	private newFolder: string;
	private readonly host: CardHost;

	constructor(
		app: App,
		private readonly index: CalendarIndex,
		private readonly o: CalendarsOptions,
		private readonly paths: readonly string[],
		note: LoadedNote | null,
	) {
		super(app);
		this.note = note;
		const start = this.startOfNew();
		this.newName = start.name;
		this.newFolder = start.folder;
		this.drafts = draftOf(note?.calendars ?? [], () => this.counter++);
		this.checkedNow = checkDraft(this.drafts, this.notePath(), this.outside());
		this.host = this.makeHost();
	}

	/** The name and folder of the note that a first save makes: the note that the tree names, else `Calendars` at the root of the vault. */
	private startOfNew(): { name: string; folder: string } {
		const linked = this.o.link ? linkedNotePath(this.o.link) : null;
		return linked ? { name: linked.name, folder: linked.folder } : newNoteDefaults(this.app);
	}

	private notePath(): string {
		return this.note?.path ?? `${this.newFolder ? `${this.newFolder}/` : ''}${this.newName}.md`;
	}

	/** The calendars of the other calendar notes that the tree uses. */
	private outside(): Calendar[] {
		return this.paths.filter((p) => p !== this.note?.path).flatMap((p) => this.index.calendarsOf(p));
	}

	private makeHost(): CardHost {
		return {
			checked: () => this.checkedNow,
			changed: () => this.refresh(),
			redraw: (focus) => this.draw(focus),
			register: (update) => this.updates.push(update),
			reader: (): DateReader => this.checkedNow.reader,
			removeCalendar: (key) => {
				this.drafts = this.drafts.filter((d) => d.key !== key);
				this.draw(`cal:add-cycles`);
			},
			addEra: (key) => {
				const d = this.drafts.find((x) => x.key === key);
				if (!d) return;
				const era = newEra(() => this.counter++);
				d.eras.push(era);
				this.draw(`cal:era-${era.key}-name`);
			},
			removeEra: (key, era) => {
				this.drafts.find((x) => x.key === key)?.eras.splice(era, 1);
				this.draw(`cal:add-era:${key}`);
			},
		};
	}

	protected dirty(): boolean {
		return draftChanged(this.note?.calendars ?? [], this.drafts, this.checkedNow);
	}

	protected discardText(): string {
		return T.discardText;
	}

	override onOpen(): void {
		this.openFrame('dynasty-calendars');
		const shell = buildShell({ modalEl: this.modalEl, contentEl: this.contentEl, title: T.title, titled: true, saveLabel: T.save, onCancel: () => this.finish(), onSave: () => void this.write() });
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		const body = shell.body;
		this.drawHead(body);
		body.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-intro'], text: T.intro });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		this.noteBox = body.createDiv({ cls: 'dynasty-cal-note' });
		this.cards = body.createDiv({ cls: 'dynasty-cal-cards' });
		const add = body.createDiv({ cls: ['dynasty-actions', 'dynasty-cal-add'] });
		textButton(add, ['dynasty-btn', 'dynasty-cal-add-cycles'], T.addCycles, () => this.add('cycles'), { icon: 'plus', focus: 'cal:add-cycles' });
		textButton(add, ['dynasty-btn', 'dynasty-cal-add-eras'], T.addEras, () => this.add('eras'), { icon: 'plus', focus: 'cal:add-eras' });
		this.drawNote();
		this.draw();
	}

	/** The head of the window, as in the person, Titles and Houses windows: the title, a text line with the note, and the link. A phone bar has the title already. */
	private drawHead(body: HTMLElement): void {
		const head = body.createDiv({ cls: ['dynasty-head', 'dynasty-cal-top'] });
		const text = head.createDiv({ cls: 'dynasty-head-text' });
		if (!this.modalEl.hasClass('is-phone')) text.createDiv({ cls: 'dynasty-head-name', text: T.title });
		this.metaEl = text.createDiv({ cls: 'dynasty-head-meta' });
		this.linksEl = text.createDiv({ cls: 'dynasty-cal-links' });
	}

	private add(kind: 'cycles' | 'eras'): void {
		const d = newCalendar(kind, () => this.counter++);
		this.drafts.push(d);
		this.draw(`cal:${d.key}-name`);
	}

	/** Works the draft out again and lets every part of the cards show it. */
	private refresh(): void {
		this.errorEl?.hide();
		this.checkedNow = checkDraft(this.drafts, this.notePath(), this.outside());
		for (const update of this.updates) update();
		if (this.noteSelect) this.noteSelect.disabled = this.dirty();
		this.noteHint?.toggle(!!this.noteSelect?.disabled);
	}

	/** Draws the cards again (a calendar or an era was added or removed); `focus` names the control that gets the focus. */
	private draw(focus?: string): void {
		const cards = this.cards;
		if (!cards) return;
		cards.empty();
		this.updates.length = 0;
		this.checkedNow = checkDraft(this.drafts, this.notePath(), this.outside());
		for (const d of this.drafts) drawCalendar(cards, this.host, d);
		for (const update of this.updates) update();
		if (focus) this.contentEl.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus();
	}

	// ---------- the note ----------

	/** The head line with the note, the link "New calendar note", and the choice among the notes of the tree; a new note has a name and a folder to type. */
	private drawNote(): void {
		const box = this.noteBox;
		if (!box) return;
		box.empty();
		this.metaEl?.empty();
		this.linksEl?.empty();
		this.noteSelect = null;
		if (this.note === null) return void this.drawNewNote(box);
		const path = this.note.path;
		const folder = T.folder(path.includes('/') ? path.replace(/\/[^/]*$/, '') : '');
		const several = this.paths.length > 1;
		// With a choice of notes, the choice shows the name; the text line has the folder only.
		this.metaEl?.setText(several ? folder : `${noteLabel(path, this.paths)} · ${folder}`);
		if (several) {
			const { row, id } = sheetField(box, T.noteLabel, 'note', 'dynasty-cal');
			const wrap = row.createDiv({ cls: 'dynasty-select' });
			const select = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id, 'data-focus': 'cal:note' } });
			for (const p of this.paths) select.createEl('option', { text: noteLabel(p, this.paths), attr: { value: p } });
			select.value = path;
			select.addEventListener('change', () => void this.switchTo(select.value, select));
			select.disabled = this.dirty();
			this.noteSelect = select;
			this.noteHint = row.createDiv({ cls: 'dynasty-sheet-hint', text: T.changesFirst });
			this.noteHint.toggle(select.disabled);
		}
		if (this.linksEl) textButton(this.linksEl, ['dynasty-link', 'dynasty-cal-new-note'], T.newNote, () => this.newNote(), { focus: 'cal:new-note' });
	}

	/** The fields of a note that the first save makes. */
	private drawNewNote(box: HTMLElement): void {
		this.metaEl?.setText(this.paths.length ? T.newNote : T.noNoteMeta);
		box.createDiv({ cls: 'dynasty-sheet-hint', text: this.paths.length ? T.newNoteHint : T.noNoteHint });
		const grid = box.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
		const text = (name: string, label: string, value: string, set: (v: string) => void) => {
			const { row, id } = sheetField(grid, label, name, 'dynasty-cal');
			const input = row.createEl('input', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', 'data-focus': `cal:${name}` } });
			input.value = value;
			input.addEventListener('input', () => {
				set(input.value);
				this.refresh();
			});
		};
		text('new-name', T.newNoteName, this.newName, (v) => (this.newName = v));
		text('new-folder', T.newNoteFolder, this.newFolder, (v) => (this.newFolder = v));
		if (this.paths.length) textButton(box, ['dynasty-btn', 'dynasty-cal-existing-note'], this.paths.length > 1 ? T.noteLabel : noteLabel(this.paths[0], this.paths), () => void this.switchTo(this.paths[0], null), { focus: 'cal:existing-note' });
	}

	/** "New calendar note": the draft starts empty and the save makes the note. */
	private newNote(): void {
		if (this.dirty()) {
			showErrorLine(this.errorEl, T.changesFirst);
			return;
		}
		this.note = null;
		const start = this.startOfNew();
		this.newName = start.name;
		this.newFolder = start.folder;
		this.drafts = [];
		this.drawNote();
		this.draw('cal:new-name');
	}

	/** Shows another calendar note of the tree (only while the draft has no change). */
	private async switchTo(path: string, from: HTMLElement | null): Promise<void> {
		if (this.dirty()) return showErrorLine(this.errorEl, T.changesFirst);
		const loaded = await loadNote(this.app, path);
		if (!loaded || loaded.issues.length) {
			new Notice(loaded?.issues[0] ? issueText(loaded.issues[0]) : T.cannotOpenHere);
			if (from) (from as HTMLSelectElement).value = this.note?.path ?? path;
			return;
		}
		this.note = loaded;
		this.drafts = draftOf(loaded.calendars, () => this.counter++);
		this.drawNote();
		this.draw();
	}

	// ---------- Save ----------

	private async write(): Promise<void> {
		if (this.saving) return;
		this.refresh();
		const checked = this.checkedNow;
		if (checked.refusals.length) {
			showErrorLine(this.errorEl, [T.refusalHead, ...checked.refusals.map((r) => this.refusalLine(r))].join(' '));
			// The refusal stands next to its field in the card: the window shows the first one.
			this.contentEl.querySelector<HTMLElement>('.dynasty-cal-card [data-refusal]')?.scrollIntoView?.({ block: 'nearest' });
			return;
		}
		if (!this.dirty() && this.note !== null) return this.finish();
		this.saving = true;
		this.modalEl.addClass('is-saving');
		try {
			const message = await this.save(checked);
			if (message === null) this.finish();
			else showErrorLine(this.errorEl, message);
		} catch (e) {
			console.error('Crown and Kin: cannot save the calendars', e);
			showErrorLine(this.errorEl, T.cannotSave);
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	/** A refusal for the line at the top of the window: it names its calendar, unless the sentence names it already. */
	private refusalLine(r: { key: number | null; text: string }): string {
		const d = this.drafts.find((x) => x.key === r.key);
		if (!d) return r.text;
		const name = d.name.trim();
		return name !== '' && r.text.includes(`“${name}”`) ? r.text : T.refusalFor(name, r.text);
	}

	/** Makes the note if it is new, writes the operations, tells the index; null when it went well, else the sentence for the window. */
	private async save(checked: Checked): Promise<string | null> {
		let note = this.note;
		let made: string | null = null;
		if (note === null) {
			const folder = this.newFolder.trim().replace(/^\/+|\/+$/g, '');
			const name = this.newName.trim() || newNoteDefaults(this.app).name;
			const file = await makeCalendarNote(this.app, this.o.treePath, name, folder);
			if (!file) return T.cannotMake;
			made = file.name;
			note = await loadNote(this.app, file.path);
			if (!note) return T.cannotSave;
			this.note = note;
		}
		const plan = opsOf(note.calendars, this.drafts, checked);
		const out = plan.length ? await saveNote(this.app, note.path, note.bodies, plan) : { ok: true as const };
		if (!out.ok) {
			if (out.code === 'stale') return T.stale;
			console.error('Crown and Kin: the calendar edit was refused', out.reason);
			return T.cannotSave;
		}
		await this.index.reload(note.path);
		new Notice(made ? T.madeNote(made) : T.saved);
		return null;
	}

	override onClose(): void {
		super.onClose();
		try {
			this.o.onClosed?.();
		} catch (e) {
			console.error('Crown and Kin: cannot return the focus', e);
		}
	}
}

/**
 * Opens the Calendars window for a tree: on the calendar note that the tree names, else on the first calendar note, else on a new note. A note with a block
 * that cannot be read gives its message and no window (the plugin never writes over a block it cannot read).
 */
export async function openCalendars(app: App, index: CalendarIndex, o: CalendarsOptions): Promise<void> {
	try {
		const paths = index.usedNotes(o.treePath, o.link);
		const target = o.note && paths.includes(o.note) ? o.note : (paths[0] ?? null);
		const note = target === null ? null : await loadNote(app, target);
		if (target !== null && (!note || note.issues.length)) {
			new Notice(note?.issues[0] ? issueText(note.issues[0]) : T.cannotOpen);
			return;
		}
		new CalendarsWindow(app, index, o, paths, note).open();
	} catch (e) {
		console.error('Crown and Kin: cannot open the calendars', e);
		new Notice(T.cannotOpen);
	}
}
