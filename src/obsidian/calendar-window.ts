/*
 * The Calendars window (spec §14 rules 1, 3, 6 and 7; D251, D273, D289, D290). It shows the calendars of one calendar note as folding sections, one for each calendar and
 * one for the plain years, with Add (a menu of the two kinds), Remove, the name and folder of the note and "New calendar note", and one "Test a date" field under all
 * sections. It is a draft in the way of the other windows (D112): Save writes the changes in one step, Cancel writes nothing, and any other way to close with changes asks
 * first. A refusal of `checkFormat` or `checkCalendars` is shown in the window, opens the section that holds it, and the window does not save. A tree uses one calendar note, so
 * the window shows one note at a time and reads no other note. Opened from a tree with no key, it shows the first calendar note by name and Save sets the key of the tree to the
 * note shown, even with no change; a line before Save says so. The draft is `view/calendar-draft.ts`, a section body is `calendar-card.ts`, the file work is `calendar-note.ts` and the
 * steps of Save are `calendar-window-save.ts`. A vault with no calendar note gets the note `Calendars` at the root of the vault at the first save with a calendar.
 */

import { Notice, setIcon, type App } from 'obsidian';
import { linkedNotePath } from '../core/note-make';
import type { DateReader } from '../core/dates';
import { issueText, type CodedIssue } from '../core/messages';
import { CALENDAR_UI, CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { markedLine } from '../render/dom/marks';
import { PLAIN_KEY, checkDraft, calendarDraftChanged, draftOf, emptyPlain, markerIssues, newCalendar, newEra, newListDraft, opsOf, type CalendarDraft, type Checked, type ListDraft, type PlainDraft } from '../view/calendar-draft';
import { byNameThenPath, type CalendarIndex } from '../view/calendar-index';
import { listDraftsOf } from '../view/calendar-list-draft';
import { calendarSummary, calendarTitle, listsSummary } from '../view/calendar-summary';
import { drawCalendarBody, drawPlainBody } from './calendar-card';
import type { CalendarTree } from './calendar-link';
import { loadNote, newNoteDefaults, type LoadedNote } from './calendar-note';
import { saveCalendars } from './calendar-window-save';
import { testField, type CardHost } from './calendar-parts';
import { sheetField, showErrorLine, nameDialog } from './sheet-parts';
import { SmallFormModal } from './small-form';
import { showMenu, textButton } from './window-parts';
import { buildShell } from './window-shell';
import { renderSections, type SectionSpec, type SectionsView } from './window-sections';

export type { CalendarTree } from './calendar-link';

/** What opens the window. `tree` is the tree it opens from (null: a note, the Edit button of a block, or a note with no tree); `note` opens on that calendar note. */
export interface CalendarsOptions {
	tree: CalendarTree | null;
	note?: string;
	/** Runs when the window has closed: the focus goes back to the control that opened it. */
	onClosed?: () => void;
}

/** The name of a note for a list: the file name without ".md", and the folder when notes of two folders share a name. */
const noteLabel = (path: string, all: readonly string[]): string => {
	const name = path.replace(/^.*\//, '').replace(/\.md$/i, '');
	return all.filter((p) => p.replace(/^.*\//, '') === path.replace(/^.*\//, '')).length > 1 ? path.replace(/\.md$/i, '') : name;
};

/** The key of the section of a draft calendar, and of the plain years. */
const sectionKey = (key: number): string => (key === PLAIN_KEY ? 'plain' : String(key));

/** The issues of a calendar note that the window shows and goes on with: a name list that cannot be used (spec §14 rule 13). Any other issue stops the window. */
export const isListIssue = (i: { code: string }): boolean => i.code === 'calendar-list-invalid';

class CalendarsWindow extends SmallFormModal {
	private note: LoadedNote | null;
	private drafts: CalendarDraft[];
	private plain: PlainDraft;
	private counter = 0;
	private checkedNow: Checked;
	private readonly updates: (() => void)[] = [];
	/** The place of the sections, the sections as drawn, and the key that keeps the open state of this window and note only. */
	private sectionsEl: HTMLElement | null = null;
	private view: SectionsView | null = null;
	private token: object = {};
	private introEl: HTMLElement | null = null;
	private issuesEl: HTMLElement | null = null;
	/** The two buttons of a window with no calendar. */
	private emptyEl: HTMLElement | null = null;
	private testUpdate: (() => void) | null = null;
	private noteBox: HTMLElement | null = null;
	/** The head: the text line under the title, with the note name, the folder and (at its end) the "New calendar note" link. */
	private metaEl: HTMLElement | null = null;
	/** The choice among the notes of the tree: it is off while the draft has a change, and says why. */
	private noteSelect: HTMLSelectElement | null = null;
	private noteHint: HTMLElement | null = null;
	/** A new note: its name and folder as typed (used while `note` is null). */
	private newName: string;
	private newFolder: string;
	private readonly host: CardHost;
	/** The user pressed Save and the window refused: empty fields show their refusal from then on. */
	private attempted = false;
	/** The line before Save: what Save does to the tree (D289, D290). It follows the name of a new note as typed. */
	private lineEl: HTMLElement | null = null;
	private lineKey = '';

	constructor(
		app: App,
		private readonly index: CalendarIndex,
		private readonly o: CalendarsOptions,
		private readonly paths: readonly string[],
		note: LoadedNote | null,
		/** The notes of the vault are not all known yet and none is listed: the window never says that the vault has no calendar note. */
		private readonly uncertain: boolean,
	) {
		super(app);
		this.note = note;
		const start = this.startOfNew();
		this.newName = start.name;
		this.newFolder = start.folder;
		this.drafts = draftOf(note?.calendars ?? [], () => this.counter++);
		this.plain = this.plainOf(note);
		this.checkedNow = this.check();
		this.host = this.makeHost();
	}

	/** The tree that the window opened from, null when it opened from a note. */
	private get tree(): CalendarTree | null {
		return this.o.tree;
	}

	/** The tree names a calendar note (the key is set): Save never changes it. */
	private get named(): boolean {
		return !!this.tree?.link?.trim();
	}

	/** The note of the tree: where a new note is made near, and what a key is seen from. */
	private get treePath(): string {
		return this.tree?.treePath ?? this.o.note ?? this.app.workspace.getActiveFile()?.path ?? '';
	}

	/** The tree has no key and can take one: Save sets it to the note (D290). */
	private get keyWriter(): CalendarTree['setLink'] {
		return this.tree && !this.named ? this.tree.setLink : null;
	}

	/** The name and folder of the note that a first save makes: the note that the tree names if that note is missing, else `Calendars` at the root of the vault. */
	private startOfNew(): { name: string; folder: string } {
		const link = this.tree?.link?.trim();
		const linked = link && !this.paths.length ? linkedNotePath(link) : null;
		return linked ? { name: linked.name, folder: linked.folder } : newNoteDefaults(this.app);
	}

	private notePath(): string {
		return this.note?.path ?? `${this.newFolder ? `${this.newFolder}/` : ''}${this.newName}.md`;
	}

	/** The plain years of a note as a draft: the lists as read, and the block that holds them. */
	private plainOf(note: LoadedNote | null): PlainDraft {
		return note ? { block: note.plainBlock, saved: note.plain, lists: listDraftsOf(note.plain, undefined, () => this.counter++) } : emptyPlain();
	}

	private check(): Checked {
		return checkDraft(this.drafts, this.notePath(), this.plain);
	}

	/** The lists of a calendar, or of the plain years (`PLAIN_KEY`). */
	private listsOf(key: number): ListDraft[] {
		return key === PLAIN_KEY ? this.plain.lists : (this.drafts.find((d) => d.key === key)?.lists ?? []);
	}

	private makeHost(): CardHost {
		return {
			checked: () => this.checkedNow,
			changed: () => this.refresh(),
			register: (update) => this.updates.push(update),
			reader: (): DateReader => this.checkedNow.reader,
			attempted: () => this.attempted,
			removeCalendar: (key) => {
				this.drafts = this.drafts.filter((d) => d.key !== key);
				this.draw({ focus: this.drafts.length ? 'cal:add' : 'cal:add-cycles' });
			},
			addEra: (key) => {
				const d = this.drafts.find((x) => x.key === key);
				if (!d) return;
				const era = newEra(() => this.counter++);
				d.eras.push(era);
				this.draw({ focus: `cal:era-${era.key}-name` });
			},
			removeEra: (key, era) => {
				this.drafts.find((x) => x.key === key)?.eras.splice(era, 1);
				this.draw({ focus: `cal:add-era:${key}` });
			},
			addList: (key) => {
				const l = newListDraft(() => this.counter++);
				this.listsOf(key).push(l);
				this.draw({ focus: `cal:list-${l.key}-name` });
			},
			removeList: (key, list) => {
				const lists = this.listsOf(key);
				const at = lists.findIndex((l) => l.key === list);
				if (at >= 0) lists.splice(at, 1);
				this.draw({ focus: `cal:add-list:${key}` });
			},
		};
	}

	protected dirty(): boolean {
		return calendarDraftChanged(this.note?.calendars ?? [], this.drafts, this.checkedNow, this.plain);
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
		this.noteBox = body.createDiv({ cls: 'dynasty-cal-note' });
		this.introEl = body.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-intro'] });
		this.issuesEl = body.createDiv({ cls: 'dynasty-cal-issues' });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		this.emptyEl = body.createDiv({ cls: ['dynasty-actions', 'dynasty-cal-add'] });
		textButton(this.emptyEl, ['dynasty-btn', 'dynasty-cal-add-cycles'], T.addCycles, () => this.add('cycles'), { icon: 'plus', focus: 'cal:add-cycles' });
		textButton(this.emptyEl, ['dynasty-btn', 'dynasty-cal-add-eras'], T.addEras, () => this.add('eras'), { icon: 'plus', focus: 'cal:add-eras' });
		this.sectionsEl = body.createDiv({ cls: 'dynasty-cal-sections' });
		// One field under all sections: it reads with the calendars of the draft and the plain-year lists.
		this.testUpdate = testField(body.createDiv({ cls: 'dynasty-cal-testbox' }), 'all', () => this.checkedNow.reader).update;
		this.drawNote();
		this.draw();
		// The window opens with nothing selected: Obsidian puts the focus on the first link after this method, and Enter would start a new note (D278). Esc and Tab still work from the window.
		this.modalEl.setAttribute('tabindex', '-1');
		const clear = (): void => {
			// Only a focus that nobody chose is taken away: on the page, or on the link; a field that the user entered keeps it.
			const now = this.modalEl.doc.activeElement;
			if (!now || now === this.modalEl.doc.body || now === this.metaEl?.querySelector('.dynasty-cal-new-note') || !this.modalEl.contains(now)) this.modalEl.focus({ preventScroll: true });
		};
		clear();
		for (const ms of [0, 120]) (this.modalEl.win ?? window).setTimeout(clear, ms);
	}

	/** The head of the window, as in the person, Titles and Houses windows: the title, a text line with the note, and the link. A phone bar has the title already. */
	private drawHead(body: HTMLElement): void {
		const head = body.createDiv({ cls: ['dynasty-head', 'dynasty-cal-top'] });
		const text = head.createDiv({ cls: 'dynasty-head-text' });
		if (!this.modalEl.hasClass('is-phone')) text.createDiv({ cls: 'dynasty-head-name', text: T.title });
		this.metaEl = text.createDiv({ cls: 'dynasty-head-meta' });
	}

	/** Adds a calendar: its section opens, and the focus goes to Name. */
	private add(kind: 'cycles' | 'eras'): void {
		const d = newCalendar(kind, () => this.counter++);
		this.drafts.push(d);
		this.draw({ focus: `cal:${d.key}-name`, open: [sectionKey(d.key)] });
	}

	/** Works the draft out again and lets every part of the sections show it. */
	private refresh(): void {
		this.errorEl?.hide();
		this.checkedNow = this.check();
		for (const update of this.updates) update();
		this.testUpdate?.();
		this.paintSummaries();
		this.paintIssues();
		if (this.noteSelect) this.noteSelect.disabled = this.dirty();
		this.noteHint?.toggle(!!this.noteSelect?.disabled);
		this.paintLine();
	}

	/** The lines before Save: what Save does to the tree (D289, D290), and (while the notes of the vault are not all known) that the plugin still looks for calendar notes. */
	private saveLines(): string[] {
		const tree = this.tree;
		const note = this.note;
		const draftName = this.newName.trim() || newNoteDefaults(this.app).name;
		const lines: string[] = [];
		if (this.uncertain && note === null) lines.push(CALENDAR_UI.stillLooking);
		if (tree && this.named) {
			if (note === null) lines.push(this.paths.length ? T.treeStillUses(noteLabel(this.paths[0], this.paths)) : T.newNoteHint);
		} else if (tree && !this.keyWriter) {
			lines.push(T.treeReadOnly);
		} else if (tree) {
			if (note !== null) lines.push(T.treeUsesNote(noteLabel(note.path, this.paths)));
			else lines.push(this.uncertain ? T.treeUsesNote(draftName) : T.treeNewNote(draftName));
		} else if (note === null) {
			lines.push(this.paths.length || this.uncertain ? T.newNoteHint : T.noNoteHint);
		}
		return lines;
	}

	/** Draws the lines before Save again when they changed (the name of a new note as typed is in one of them). */
	private paintLine(): void {
		const el = this.lineEl;
		if (!el) return;
		const lines = this.saveLines();
		const key = JSON.stringify(lines);
		if (this.lineKey === key) return;
		this.lineKey = key;
		el.empty();
		for (const line of lines) el.createDiv({ text: line });
	}

	/** The title and the summary line of every section follow the draft. */
	private paintSummaries(): void {
		const view = this.view;
		if (!view) return;
		for (const d of this.drafts) {
			const key = sectionKey(d.key);
			view.setSummary(key, calendarSummary(d));
			const title = view.el(key)?.querySelector('.dynasty-section-title');
			if (title && title.getText() !== calendarTitle(d)) title.setText(calendarTitle(d));
			title?.toggleClass('is-empty', d.name.trim() === '');
		}
		view.setSummary('plain', listsSummary(this.plain.lists));
	}

	/** The sections of the window: one for each calendar, then "Plain years". `was` is how the sections stood before this draw (null: the first draw). */
	private specs(was: ReadonlyMap<string, boolean> | null): SectionSpec[] {
		// A window with exactly one calendar opens it; any other window opens none at the first draw.
		const open = (key: string): boolean => (was ? (was.get(key) ?? false) : this.drafts.length === 1 && key !== 'plain');
		const calendars = this.drafts.map((d): SectionSpec => ({ key: sectionKey(d.key), title: calendarTitle(d), summary: calendarSummary(d), open: open(sectionKey(d.key)), build: (b) => drawCalendarBody(b, this.host, d) }));
		const plain: SectionSpec = { key: 'plain', title: T.plainTitle, summary: listsSummary(this.plain.lists), open: open('plain'), build: (b) => drawPlainBody(b, this.host, this.plain.lists) };
		return [...calendars, plain];
	}

	/** How the sections stand now, by key; null when none were drawn. */
	private openNow(): Map<string, boolean> | null {
		const view = this.view;
		if (!view) return null;
		const keys = [...this.drafts.map((d) => sectionKey(d.key)), 'plain'];
		return new Map(keys.map((k) => [k, view.isOpen(k)]));
	}

	/**
	 * Draws the sections again (a calendar, an era or a list was added or removed, or another note was loaded). The scroll place and the open state stay; `open` names
	 * sections that open (the one just added), and `focus` names the control that gets the focus.
	 */
	private draw(o: { focus?: string; open?: string[] } = {}): void {
		const mount = this.sectionsEl;
		if (!mount) return;
		const was = this.openNow();
		const scroll = this.shell?.body.scrollTop ?? 0;
		mount.empty();
		this.updates.length = 0;
		this.checkedNow = this.check();
		this.paintTop();
		const view = renderSections(mount, 'calendars', this.specs(was), () => this.shell?.checkOverflow(), this.token);
		this.view = view;
		this.addCalendarLink(view);
		for (const key of o.open ?? []) view.open(key);
		for (const update of this.updates) update();
		this.testUpdate?.();
		if (this.shell) this.shell.body.scrollTop = scroll;
		this.shell?.checkOverflow();
		if (o.focus) this.contentEl.querySelector<HTMLElement>(`[data-focus="${o.focus}"]`)?.focus();
	}

	/** The line under the head, the two buttons of a window with no calendar, and the lists that cannot be used. */
	private paintTop(): void {
		const none = this.drafts.length === 0;
		this.introEl?.setText(none ? T.intro : T.introShort);
		this.introEl?.toggleClass('is-long', none);
		this.emptyEl?.toggle(none);
		this.paintIssues();
	}

	/**
	 * The notes about name lists that cannot be used. A list that the note holds with a bad shape stays as the note has it; a marker in a format that no list has is worked
	 * out from the draft, so the note follows every change of a format or a marker.
	 */
	private paintIssues(): void {
		const issues = this.issuesEl;
		if (!issues) return;
		issues.empty();
		const fromNote = (this.note?.issues ?? []).filter((i) => isListIssue(i) && i.params?.why !== 'marker');
		for (const issue of [...fromNote, ...markerIssues(this.drafts, this.notePath()).filter((i) => !this.isError(i))]) issues.createDiv({ cls: ['dynasty-sheet-hint', 'is-warning'], text: issueText(issue), attr: { 'data-issue': '' } });
	}

	/**
	 * True when a note of the window about a marker is also an error of the last Save (the refusal of the format that holds the marker, shown open in its section): the grey
	 * note at the top then hides, so the problem stands once (D278).
	 */
	private isError(issue: CodedIssue): boolean {
		if (!this.attempted) return false;
		const marker = `{${String(issue.params?.marker ?? '')}}`;
		const name = String(issue.params?.calendar ?? '');
		return this.checkedNow.refusals.some((r) => r.field === 'formats' && r.text.includes(marker) && this.drafts.some((d) => d.key === r.key && d.name.trim() === name));
	}

	/** "Add calendar" at the left of the row of "Open all": a link that opens a menu of the two kinds. */
	private addCalendarLink(view: SectionsView): void {
		const row = view.openAllRow;
		if (!row) return;
		const link = textButton(row, ['dynasty-link', 'dynasty-add-calendar'], T.addCalendar, () => this.addMenu(link), { icon: 'plus', focus: 'cal:add' });
		link.setAttribute('aria-haspopup', 'menu');
		row.prepend(link);
	}

	private addMenu(anchor: HTMLElement): void {
		showMenu(anchor, [
			{ label: T.kindCycles, icon: 'rotate-cw', run: () => this.add('cycles') },
			{ label: T.kindEras, icon: 'list', run: () => this.add('eras') },
		]);
	}

	// ---------- the note ----------

	/** The text line under the title (the note, the folder, the link "New calendar note"), and the choice among the notes of the tree; a new note has a name and a folder to type. */
	private drawNote(): void {
		const box = this.noteBox;
		if (!box) return;
		box.empty();
		this.metaEl?.empty();
		this.noteSelect = null;
		this.lineEl = null;
		this.lineKey = '';
		if (this.note === null) return void this.drawNewNote(box);
		const path = this.note.path;
		const folder = T.folder(path.includes('/') ? path.replace(/\/[^/]*$/, '') : '');
		const several = this.paths.length > 1;
		// With a choice of notes, the choice shows the name; the text line has the folder only.
		const meta = this.metaEl;
		if (meta) meta.createSpan({ cls: 'dynasty-cal-meta-text', text: `${several ? folder : `${noteLabel(path, this.paths)} · ${folder}`} · ` });
		if (several) {
			const { row, id } = sheetField(box, T.noteLabel, 'note', 'dynasty-cal');
			const wrap = row.createDiv({ cls: 'dynasty-select' });
			const select = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id, 'data-focus': 'cal:note' } });
			// The wrapper hides the native arrow, so the choice needs our own chevron or it looks like a text field (G5 0.4).
			setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
			for (const p of this.paths) select.createEl('option', { text: noteLabel(p, this.paths), attr: { value: p } });
			select.value = path;
			select.addEventListener('change', () => void this.switchTo(select.value, select));
			select.disabled = this.dirty();
			this.noteSelect = select;
			this.noteHint = row.createDiv({ cls: 'dynasty-sheet-hint', text: T.changesFirst });
			this.noteHint.toggle(select.disabled);
		}
		this.lineEl = box.createDiv({ cls: 'dynasty-sheet-hint' });
		this.paintLine();
		// The link ends the text line (D278): the rarest action takes no text line of its own.
		if (meta) textButton(meta, ['dynasty-link', 'dynasty-cal-new-note'], T.newNote, () => this.newNote(), { focus: 'cal:new-note' });
	}

	/** The fields of a note that the first save makes. */
	private drawNewNote(box: HTMLElement): void {
		this.metaEl?.setText(this.paths.length || this.uncertain ? T.newNote : T.noNoteMeta);
		this.lineEl = box.createDiv({ cls: 'dynasty-sheet-hint' });
		this.paintLine();
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
		this.plain = emptyPlain();
		this.reset();
		this.drawNote();
		this.draw({ focus: 'cal:new-name' });
	}

	/** Shows another calendar note of the tree (only while the draft has no change). */
	private async switchTo(path: string, from: HTMLElement | null): Promise<void> {
		if (this.dirty()) return showErrorLine(this.errorEl, T.changesFirst);
		const loaded = await loadNote(this.app, path);
		if (!loaded || loaded.issues.some((i) => !isListIssue(i))) {
			new Notice(loaded?.issues.find((i) => !isListIssue(i)) ? issueText(loaded.issues.find((i) => !isListIssue(i))!) : T.cannotOpenHere);
			if (from) (from as HTMLSelectElement).value = this.note?.path ?? path;
			return;
		}
		this.note = loaded;
		this.drafts = draftOf(loaded.calendars, () => this.counter++);
		this.plain = this.plainOf(loaded);
		this.reset();
		this.drawNote();
		this.draw();
	}

	/** A new note or another note: the sections start as at the first open, with no open state of the earlier note. */
	private reset(): void {
		this.view = null;
		this.token = {};
		this.attempted = false;
	}

	// ---------- Save ----------

	private async write(): Promise<void> {
		if (this.saving) return;
		this.refresh();
		const checked = this.checkedNow;
		if (checked.refusals.length) {
			this.attempted = true;
			this.refresh();
			this.showRefusals(checked.refusals);
			// The sections that hold a refusal open, so the refusal stands in view next to its field; the window shows the first one.
			for (const r of checked.refusals) if (r.key !== null) this.view?.open(sectionKey(r.key));
			this.contentEl.querySelector<HTMLElement>('.dynasty-cal-sections [data-refusal]')?.scrollIntoView?.({ block: 'nearest' });
			return;
		}
		// A Save with no change still sets the key of a tree that has none (D290); a new note with no calendar makes nothing and sets no key, like Cancel.
		const keyDue = this.keyWriter !== null && this.note !== null;
		if (!this.dirty() && !keyDue) return this.finish();
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

	/**
	 * The refusals at the top of the window (D278): one line that says how many errors to correct. Each error of a section stands once, under its field in that section, which
	 * is open. An error of no section (the whole note) has no place below, so it stands here with its own head.
	 */
	private showRefusals(refusals: readonly { key: number | null; text: string }[]): void {
		const el = this.errorEl;
		if (!el) return;
		el.empty();
		const inSection = (r: { key: number | null }) => r.key !== null && (r.key === PLAIN_KEY || this.drafts.some((d) => d.key === r.key));
		const placed = refusals.filter(inSection);
		const loose = refusals.filter((r) => !inSection(r));
		if (placed.length) markedLine(el, 'alert', T.refusalSummary(placed.length), 'dynasty-cal-refusal-sum').setAttribute('data-error-summary', '');
		if (loose.length) {
			el.createDiv({ text: T.refusalHead(loose.length) });
			for (const r of loose) el.createDiv({ text: r.text, attr: { 'data-error-line': '' } });
		}
		el.show();
		el.scrollIntoView?.({ block: 'nearest' });
	}

	/** Makes the note if it is new, writes the operations, tells the index and sets the key; null when it went well, else the sentence for the window. */
	private async save(checked: Checked): Promise<string | null> {
		const out = await saveCalendars({
			app: this.app,
			index: this.index,
			treePath: this.treePath,
			note: this.note,
			name: this.newName.trim() || newNoteDefaults(this.app).name,
			folder: this.newFolder.trim().replace(/^\/+|\/+$/g, ''),
			planFor: (note) => opsOf(note.calendars, this.drafts, checked, this.plain),
			setLink: this.keyWriter,
			onNote: (note) => (this.note = note),
		});
		if (!out.ok) return out.message;
		new Notice(out.notice);
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

/** How long the window waits for the notes index to find the calendar notes when it knows none, and how often it looks, in ms (D290). */
const WAIT_NOTES_MS = 1000;
const WAIT_STEP_MS = 100;

/** Waits until the index lists a calendar note or says its list is complete, at most `WAIT_NOTES_MS`. */
async function waitForNotes(index: CalendarIndex): Promise<void> {
	for (let waited = 0; waited < WAIT_NOTES_MS && !index.notes().length && !index.notesComplete(); waited += WAIT_STEP_MS) await new Promise<void>((resolve) => window.setTimeout(resolve, WAIT_STEP_MS));
}

/**
 * The notes the window can show and the one it opens on (spec §14 rule 16, the table of the index contract 4.3). A tree that names a note shows that note only, or a new-note draft when it is
 * missing. Any other opening shows the calendar notes of the index: the note asked for, else the first by name, else a new-note draft.
 */
async function notesFor(index: CalendarIndex, o: CalendarsOptions): Promise<{ paths: string[]; target: string | null; uncertain: boolean }> {
	const link = o.tree?.link?.trim();
	if (o.tree && link) {
		const named = index.resolve(link, o.tree.treePath);
		return { paths: named ? [named] : [], target: named, uncertain: false };
	}
	await waitForNotes(index);
	const listed = index.notes();
	const paths = o.note && !listed.includes(o.note) ? [...listed, o.note].sort(byNameThenPath) : listed;
	return { paths, target: o.note && paths.includes(o.note) ? o.note : (paths[0] ?? null), uncertain: !paths.length && !index.notesComplete() };
}

/**
 * Opens the Calendars window: on the calendar note that the tree names, else on the note asked for, else on the first calendar note by name, else on a new note. A note with a block
 * that cannot be read gives its message and no window (the plugin never writes over a block it cannot read).
 */
export async function openCalendars(app: App, index: CalendarIndex, o: CalendarsOptions): Promise<void> {
	try {
		const { paths, target, uncertain } = await notesFor(index, o);
		const note = target === null ? null : await loadNote(app, target);
		// A name list that cannot be used is shown in the window; any other problem of a block stops it (the plugin never writes over a block it cannot read).
		const stop = note?.issues.find((i) => !isListIssue(i));
		if (target !== null && (!note || stop)) {
			new Notice(stop ? issueText(stop) : T.cannotOpen);
			return;
		}
		new CalendarsWindow(app, index, o, paths, note, uncertain).open();
	} catch (e) {
		console.error('Crown and Kin: cannot open the calendars', e);
		new Notice(T.cannotOpen);
	}
}
