/*
 * The bottom layer of the edit sheet (0.3.3, WP-1 A1; split out of `edit-sheet.ts` with no change of behaviour). `EditSheet` is a chain of classes, one file for each
 * part of the window, and the chain is listed in `edit-sheet.ts`. This first class holds the options of a sheet, the state of one window (every field), its
 * open and close, the test for unsaved changes, the list of fields that changed, and the messages and questions over the sheet. The draft logic that needs no
 * window is in `view/sheet-draft.ts`. The `abstract` methods at the end are implemented by the layers above.
 */

import { Modal, Notice, type App } from 'obsidian';
import type { DatesFor } from '../view/calendar-index';
import type { FieldValue, Op, PersonField } from '../core/edit';
import type { PersonFolds } from '../core/folds';
import { sameCropText } from '../core/portrait-crop';
import { NEW_SHEET, SHEET, WRITE_TEXT } from '../render/ui-text';
import type { Handle, Written } from './block-handle';
import type { ViewKind } from '../view/block-state';
import type { ParentLink, PartnerLink } from '../core/family-query';
import type { RelationOptions } from '../core/relations';
import type { FlowHost, NewRelation } from './family-flows';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import type { PictureCopy, PictureStore } from './picture-store';
import { showErrorLine } from './sheet-parts';
import type { RelationView } from './sheet-relation';
import type { TitlesHost } from './sheet-titles';
import type { Shell } from './window-shell';
import type { SectionsView } from './window-sections';
import { RowPictures } from './window-parts';
import { trackModal } from '../view/plugin-modals';
import { TEXT_FIELDS, NEW_HOUSE, blankHouse, type Draft, type Loaded } from '../view/sheet-draft';

/** What the tree view gives the sheet for Hide descendants, Show descendants and the unfold after a write (F12, F15). */
export interface SheetFolds {
	/** 'live': a view that folds. 'preview': the static touch preview, which never shows folds (D85). */
	mode: 'live' | 'preview';
	/** The keys for this person now; in 'preview' computed without the fold state. */
	state(personId: string): PersonFolds;
	/** Folds every key of `state(id).open`; keeps the person's card in place. In 'preview': adds them to the block's folds and opens the full-screen view on the person. */
	hide(personId: string): void;
	/** Opens every key of `state(id).folded`; keeps the person's card in place. Not called in 'preview'. */
	show(personId: string): void;
	/** After each ok write: the sheet's person and the people the write added. */
	written(ids: readonly string[]): void;
}

export interface SheetBase {
	handle: Handle;
	/** The name typed in the picker before "Create a new person". */
	initialName?: string;
	/** The sheet that started this one: its draft is written with the new person, and it shows the result. */
	parentSheet?: EditSheetBase;
	sourcePath: string;
	/** Runs just before a write, so the tree view can keep its view (spec §5.5). */
	beforeWrite?: () => void;
	/** Opened by a touch or pen tap: the click the browser makes from that tap must not close the sheet. */
	fromTap?: boolean;
	/** Opens a note for the tree view: the full-screen view closes first (spec §7.1). */
	openNote?: (open: () => Promise<void>) => void;
	/**
	 * Focus mode of the tree view (spec §5.6): Focus here; `pinning` ends the D21 own focus of the
	 * full-screen views before a pin write and returns the way back; `changed` redraws after a failed
	 * pin write, keeping those own focuses.
	 */
	focus?: { here(id: string): void; changed(): void; pinning?(): () => void };
	/**
	 * The relation finder of the tree view (spec §13.2): shows `second` as a relative of `first`. In
	 * the static phone preview it opens the full-screen view with the result (D1).
	 */
	finder?: { show(first: string, second: string): void };
	/**
	 * Fold a branch (spec §13.10): given by the tree view when it can fold or is a static
	 * touch preview. Absent in a sheet with no tree view (tests).
	 */
	folds?: SheetFolds;
	/** The kind of view that opened the sheet: the saved person is shown there (§5.5). */
	place?: ViewKind;
	/** Spec §14 rule 9: the date reader for the calendar link of the block; absent: plain years. */
	dates?: DatesFor;
	/** The plugin's picture store (M9 contract O3): the portrait picture and the picker's preview. */
	pictures?: PictureStore;
	/** D174: the sibling setting of the plugin, so the sheet names the relation as the cards do. Absent: the defaults. */
	relationOptions?: RelationOptions;
}

/** A sheet for a person of the tree. */
export type PersonSheetOptions = SheetBase & { personId: string; newPerson?: undefined };

/** A sheet for a new, unsaved person and how they join the tree (spec §6.3 "New people are drafts"). */
export type NewSheetOptions = SheetBase & { newPerson: NewRelation; personId?: undefined };

/** How the sheet was opened: for a person already in the tree, or for a new one. */
export type SheetOptions = PersonSheetOptions | NewSheetOptions;

/** A write of a relationship action; `withFields`: it also saved field changes of the draft. */
export type DraftWritten = Written & { withFields: boolean };

/**
 * D267: the text line of the window after an action that writes at once (Add child, Add partner, Add parent, "This is me"). `written`: the body the action
 * wrote, which Undo needs to find unchanged; null after Undo (the line then says what the Undo did and has no button). `was`: the id of the window's person
 * before the write, which Undo gives back to the window if the write gave the person their first id. `depth`: the number of writes on the undo stack of the
 * handle when the line was shown. The handle undoes its last write; if the depth is another one, a later write stands above the one the line names, and
 * the same body is not proof (a pin set and removed brings the body back).
 */
export interface SheetChange {
	text: string;
	written: string | null;
	was: string;
	depth: number | null;
}

export interface ConfirmSpec {
	title: string;
	text: string[];
	confirm: string;
	confirmCls: string;
	keep?: string;
	onConfirm: () => void;
}

/** A tree with this many people or more draws for a noticeable time after a write, so the sheet shows its sign first (F6). */
export const SLOW_SAVE_PEOPLE = 300;

/** Contract C (Q6H A): the round portrait of the header is 64 px across. */
export const SHEET_PORTRAIT_PX = 64;

/** The state of one edit window and its messages. Never made by itself: `EditSheet` is the whole chain. */
export abstract class EditSheetBase extends Modal {
	data: Loaded;
	protected base: Draft;
	protected draft: Draft;
	protected newHouse = blankHouse();
	/** Partnership type of a new partner (spec §6.4: default marriage). */
	protected unionType: string = 'marriage';
	protected saving = false;
	protected closing = false;
	/** `onClose` ran: a write that ends later must not draw the sheet again, which would start a portrait copy that nobody releases (C6). */
	protected closed = false;
	/** The person left the tree while the sheet was open: the sheet shows the draft but cannot save it. */
	protected gone = false;
	protected confirmEl: HTMLElement | null = null;
	/** The control that had the focus when a question opened; the focus goes back to it when the question closes (C3). */
	protected confirmFrom: HTMLElement | null = null;
	protected errorEl: HTMLElement | null = null;
	protected statusEl: HTMLElement | null = null;
	protected bodyEl: HTMLElement | null = null;
	/** The text line under the header for a problem with the portrait, and what the round portrait showed last (so a repaint that changes nothing leaves it alone). */
	protected problemEl: HTMLElement | null = null;
	protected portraitKey = '';
	/** The parent type of the last relationship write, for the text of a `limit` refusal. */
	protected limitType: string | undefined;
	protected status = '';
	/** The last message a failed write showed; the partnership editor shows it too. */
	protected lastError = '';
	/** The sheet is on screen (an Undo from a Notice reloads it only then). */
	protected shown = false;
	/** How a new person joins the tree; can change when a related person or partnership goes away. */
	protected rel: NewRelation | null;
	/** Why the new person cannot be saved as they are, shown in the relation box. */
	protected relNote: string | null = null;
	protected relBlocked = false;
	/** Names of the related people when the sheet opened, for the message if one leaves the tree. */
	protected readonly relNames = new Map<string, string>();
	protected readonly cleanup: (() => void)[] = [];
	/**
	 * Spec §13.7: the portrait copy on screen (not kept by the store) and the link it shows. `path` is
	 * the file of the link; `waiting` is true when the file changed while its copy was made (the next
	 * change event of the store starts a new copy).
	 */
	protected portrait: { link: string; crop: string; path: string | null; copy: PictureCopy | null; problem: string | null; missing: boolean; loading: boolean; waiting: boolean } | null = null;
	protected portraitAbort: AbortController | null = null;
	/** The round portrait button of the header: a copy that arrives changes only this. */
	protected portraitFrame: HTMLElement | null = null;
	/** D209 item 5: the text link "Add portrait" in the row of "Open all"; shown while the header has no picture. */
	protected addPortraitEl: HTMLElement | null = null;
	/** Gives the hidden names of the parent type chips their ids. */
	protected static chipCounter = 0;
	/**
	 * The parent link that each parent-type select shows now. A change of a parent type updates the page in place (r032: a native
	 * select that is destroyed under the finger can keep its phone menu open), so the one listener of a select reads its link here.
	 */
	protected parentSelects = new WeakMap<HTMLElement, ParentLink>();
	/** The text block of the header that holds the relation text lines, and a text of the relation that it shows (to draw it again only when it changes). */
	protected relHost: HTMLElement | null = null;
	protected relSig = '';
	/** The frame of the window (Cancel, Save, the scrolling body) and its sections, drawn again with the form. */
	protected shell: Shell | null = null;
	protected sections: SectionsView | null = null;
	/** The pictures of the rows and of the small arms marks of the header; released when the form is drawn again and when the window closes. */
	protected rowPictures: RowPictures | null = null;
	/** Contract C: the header draws the name, the detail line and the personal arms; these follow the draft. */
	protected head: { paint(): void; arms(): void } | null = null;
	/** What the form showed last: a window that crosses 600 px (a turn, a resize) draws again, because the frame differs. */
	protected builtPhone = false;
	/** G.7: the people the user came from by a child row, the nearest last. */
	protected readonly trail: string[] = [];
	/** What the relation line shows for this build (null: nothing). */
	protected relView: RelationView | null = null;
	/** Spec §13.11: the slot in the Actions list for Make a note, what it shows now, and the busy flag of the flow (N2). */
	protected noteSlot: HTMLElement | null = null;
	protected noteKey = '';
	protected noteBusy = false;
	/** D267: the text line below Details, and the element that shows it in this build. */
	protected change: SheetChange | null = null;
	protected changeEl: HTMLElement | null = null;
	/** An Undo of the text line runs now: a second tap does nothing. */
	protected changeBusy = false;
	/** B1: this window wrote in place and set `listHold` on the block, so it ends the hold when it closes (and its last write has ended). */
	protected holdsList = false;
	/** Called when the same-name question goes away without a choice; it settles the question as Cancel. */
	protected dismissQuestion: (() => void) | null = null;

	protected constructor(
		app: App,
		protected readonly o: SheetOptions,
		loaded: Loaded,
	) {
		super(app);
		this.data = loaded;
		this.rel = o.newPerson ? { ...o.newPerson } : null;
		this.base = this.baseOf(loaded);
		this.draft = { ...this.base, name: o.initialName ?? this.base.name };
		for (const id of this.relIds()) this.relNames.set(id, this.name(id));
		this.checkRelation();
	}

	/** Takes data that was read again: the saved draft is the new base, and the new-house form is blank. */
	protected take(data: Loaded): void {
		this.data = data;
		this.base = this.baseOf(data);
		this.draft = { ...this.base };
		this.newHouse = blankHouse();
	}

	get isNew(): boolean {
		return this.o.newPerson !== undefined;
	}

	get readOnly(): boolean {
		return this.gone || this.data.blocking.length > 0;
	}

	protected name(id: string): string {
		return this.data.g.byId.get(id)?.name || id;
	}

	/** Builds the form and gives the focus to the name field (a new person) or the modal itself. */
	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		if (this.isNew) this.modalEl.addClass('is-new');
		if (this.o.fromTap) this.cleanup.push(ignoreGhostClick(this));
		// On a phone the visible area shrinks when the keyboard opens; the header stays in it (spec §7.4).
		this.cleanup.push(
			phoneLayout(this, () => {
				this.relLayout();
				this.revealFocused();
			}),
		);
		this.cleanup.push(trackModal(this, () => this.finish()));
		const store = this.o.pictures;
		if (store) this.cleanup.push(store.onChange((paths) => this.portraitFilesChanged(paths)));
		this.shown = true;
		this.build();
		if (this.isNew) this.focusNameAfterOpen();
		else {
			if (!this.modalEl.contains(this.modalEl.doc?.activeElement ?? null)) {
				// On a phone the sheet can open with the focus left on the page, so a Tab key would reach the tree below it.
				this.modalEl.setAttribute('tabindex', '-1');
				this.modalEl.focus({ preventScroll: true });
			}
			// F7: a computer has a keyboard, so the window starts in Name, as for a new person. A phone would open its keyboard.
			if (this.startsInName()) this.focusNameAfterOpen();
		}
	}

	/** True if a saved person's window starts with the focus in Name: not a read-only window, not a phone, not a touch screen (spec §7: the pointer and the width decide, not `Platform`). */
	protected startsInName(): boolean {
		if (this.readOnly || this.gone || this.modalEl.hasClass('is-phone')) return false;
		const win = this.modalEl.win ?? window;
		return win.matchMedia?.('(pointer: coarse)')?.matches !== true;
	}

	protected focusNameAfterOpen(): void {
		this.focusName();
		// Why: after `onOpen` returns, Obsidian moves the focus to the first control of the window when the device has a
		// physical keyboard (a computer). That control is "Open all" or "Add portrait or arms". A phone has no such step.
		void Promise.resolve().then(() => {
			if (!this.shown || this.closing) return;
			const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
			const typing = !!active && this.contentEl.contains(active) && active.matches('input, textarea, select');
			if (!typing) this.focusName();
		});
	}

	/** The one guard of every button, link and row of the window: nothing runs while a write runs, and a failing action never leaves an exception (spec §8). */
	protected press(run: () => void): void {
		if (this.saving) return;
		try {
			run();
		} catch (e) {
			console.error('Crown and Kin: the sheet action failed', e);
		}
	}

	/** Runs the cleanup functions `onOpen` registered and empties the modal. */
	override onClose(): void {
		this.shown = false;
		this.closed = true;
		// A write that still runs ends the hold when it ends (`write`): the redraw it causes comes after the window.
		if (!this.saving) this.endHold();
		this.settleQuestion();
		for (const c of this.cleanup.splice(0)) c();
		// O7: the sheet's portrait copy is released when the sheet closes.
		this.dropPortrait();
		this.portraitFrame = null;
		this.addPortraitEl = null;
		this.shell?.dispose();
		this.shell = null;
		this.sections = null;
		this.rowPictures?.release();
		this.rowPictures = null;
		this.head = null;
		this.contentEl.empty();
	}

	/** Esc, the X button, a press outside and Android back all come here (spec §6.3). */
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
			this.showConfirm({
				title: SHEET.discardTitle,
				text: [this.isNew ? NEW_SHEET.discardText : SHEET.discardText],
				confirm: SHEET.discard,
				confirmCls: 'dynasty-sheet-discard',
				keep: SHEET.keepEditing,
				onConfirm: () => this.finish(),
			});
			return;
		}
		this.finish();
	}

	protected finish(): void {
		this.closing = true;
		this.close();
	}

	protected isDirty(): boolean {
		if (this.readOnly) return false;
		return Object.keys(this.changedFields()).length > 0 || this.draft.house === NEW_HOUSE;
	}

	protected changedFields(): Partial<Record<PersonField, FieldValue>> {
		const out: Partial<Record<PersonField, FieldValue>> = {};
		for (const f of TEXT_FIELDS) {
			const now = this.draft[f].trim();
			if (now !== this.base[f].trim()) out[f] = now === '' ? null : now;
		}
		for (const f of ['sex', 'placement'] as const) {
			if (this.draft[f] !== this.base[f]) out[f] = this.draft[f] === '' ? null : this.draft[f];
		}
		if (this.draft.house !== this.base.house && this.draft.house !== NEW_HOUSE) out.house = this.draft.house === '' ? null : this.draft.house;
		if (this.draft.illegitimate !== this.base.illegitimate) out.illegitimate = this.draft.illegitimate;
		if (this.draft.childless !== this.base.childless) out.childless = this.draft.childless;
		// Spec §13.7: Select portrait and Remove portrait are draft edits; Save writes them with the other fields.
		const portrait = this.draft.portrait.trim();
		if (portrait !== this.base.portrait.trim()) out.portrait = portrait === '' ? null : portrait;
		// Spec §13.13, D91: the part follows the picture. A changed part is written (or removed); a part that is kept while
		// the link text changes to the same file is written again, so the core rule that a new picture drops its part keeps it.
		// 0.2.8 contract A.1: Select personal arms and Remove personal arms are draft edits too.
		const arms = this.draft.arms.trim();
		if (arms !== this.base.arms.trim()) out.arms = arms === '' ? null : arms;
		const crop = this.draft.portraitCrop.trim();
		if (!sameCropText(crop, this.base.portraitCrop.trim())) out['portrait-crop'] = crop === '' ? null : crop;
		else if (out.portrait !== undefined && out.portrait !== null && crop !== '') out['portrait-crop'] = crop;
		return out;
	}

	/** Settles the same-name question as Cancel, if one waits. */
	protected settleQuestion(): void {
		const d = this.dismissQuestion;
		this.dismissQuestion = null;
		d?.();
	}

	// ---------- messages ----------

	protected focusName(): void {
		this.contentEl.querySelector<HTMLInputElement>('[data-field="name"] input')?.focus();
	}

	protected revealFocused(delay = 0): void {
		const run = () => {
			const a = this.modalEl.doc.activeElement as HTMLElement | null;
			if (a && this.contentEl.contains(a) && a.matches('input, select, textarea')) a.scrollIntoView({ block: 'nearest' });
		};
		if (delay) (this.modalEl.win ?? window).setTimeout(run, delay);
		else run();
	}

	protected showError(text: string): void {
		this.lastError = text;
		showErrorLine(this.errorEl, text);
	}

	protected clearError(): void {
		this.errorEl?.hide();
		if (this.status) {
			this.status = '';
			this.statusEl?.hide();
		}
	}

	/** A question over the sheet ("Discard changes?", a delete) until the user chooses. */
	protected showConfirm(c: ConfirmSpec): void {
		this.hideConfirm();
		this.rememberFocus();
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		const titleEl = box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: c.title });
		// The question has a name, like the questions of the Houses and Titles windows.
		const titleId = `dynasty-sheet-confirm-${Math.random().toString(36).slice(2, 8)}`;
		titleEl.setAttribute('id', titleId);
		layer.setAttribute('aria-labelledby', titleId);
		for (const t of c.text) box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		const keep = row.createEl('button', { cls: 'dynasty-sheet-keep', text: c.keep ?? SHEET.keepEditing, attr: { type: 'button' } });
		const go = row.createEl('button', { cls: ['mod-warning', c.confirmCls], text: c.confirm, attr: { type: 'button' } });
		keep.addEventListener('click', () => this.hideConfirm());
		go.addEventListener('click', () => {
			this.hideConfirm();
			c.onConfirm();
		});
		keep.focus();
	}

	protected hideConfirm(): void {
		const had = this.confirmEl !== null;
		this.confirmEl?.remove();
		this.confirmEl = null;
		this.settleQuestion();
		if (had) this.focusBack();
	}

	/** Notes the control that has the focus now, so a question that closes with no choice can give it back. */
	protected rememberFocus(): void {
		const active = this.modalEl.doc?.activeElement as HTMLElement | null | undefined;
		this.confirmFrom = active && this.contentEl.contains(active) ? active : null;
	}

	/** The focus must stay in the sheet when a question goes: the focused button goes with it (C3). */
	protected focusBack(): void {
		const from = this.confirmFrom;
		this.confirmFrom = null;
		if (this.closing || !this.shown) return;
		if (from && this.contentEl.contains(from) && !(from as HTMLButtonElement).disabled) {
			from.focus();
			return;
		}
		this.modalEl.setAttribute('tabindex', '-1');
		this.modalEl.focus({ preventScroll: true });
	}

	/** Spec §6.1 stale write: a Notice, the new data in the sheet, and the draft kept with a message that says so. */
	protected stale(body: string): void {
		new Notice(WRITE_TEXT.staleWindow);
		this.reload(body);
		if (!this.readOnly) this.showError(WRITE_TEXT.staleWindow);
	}

	/** The person is not in the tree now: keep the sheet open, read-only, with the draft to copy (§8). */
	protected markGone(): void {
		this.lastError = WRITE_TEXT.personGone;
		new Notice(WRITE_TEXT.personGone);
		this.gone = true;
		this.build();
	}

	/** The write did not happen: say so in a Notice and in the sheet, and keep the draft. */
	protected refused(text: string): void {
		new Notice(text);
		this.showError(text);
	}

	// The layers above implement these; the chain of layers is listed in `edit-sheet.ts`.
	protected abstract actionsBody(body: HTMLElement, me: string | null): void;
	abstract afterWrite(body: string, ids?: ReadonlyMap<string, string>): void;
	protected abstract baseOf(l: Loaded): Draft;
	protected abstract build(): void;
	protected abstract checkRelation(): void;
	protected abstract confirmDelete(): void;
	protected abstract confirmRemovePartnership(link: PartnerLink): void;
	protected abstract dropPortrait(): void;
	protected abstract editPartnership(link: PartnerLink): void;
	protected abstract familyBody(body: HTMLElement): void;
	protected abstract flowHost(): FlowHost;
	protected abstract fresh(): boolean;
	protected abstract goBackTo(): void;
	protected abstract idLine(parent: HTMLElement): void;
	protected abstract leaveFor(then: () => void): void;
	protected abstract makeRelationView(): RelationView | null;
	protected abstract me(): string | null;
	protected abstract moveSibling(direction: 'earlier' | 'later'): Promise<void>;
	protected abstract openNew(rel: NewRelation, name?: string): void;
	/** D267: shows the text line with Undo for a write that just ended; `withFields`: the write also saved field changes of this window. */
	protected abstract endHold(): void;
	abstract announce(text: string, written: string, was: string, withFields: boolean): void;
	protected abstract paintChange(reveal?: boolean): void;
	protected abstract undoChange(): Promise<void>;
	abstract pendingOps(): Op[] | null;
	protected abstract portraitFilesChanged(paths: readonly string[]): void;
	protected abstract relIds(): string[];
	protected abstract relLayout(): void;
	protected abstract relationSig(): string;
	abstract reload(body: string, id?: string): void;
	protected abstract removeParent(link: ParentLink): Promise<void>;
	protected abstract removedNotice(text: string, out: DraftWritten, was: string, undone?: string): void;
	protected abstract save(another?: boolean): Promise<void>;
	protected abstract shownName(): string;
	protected abstract titlesHost(): TitlesHost;
	protected abstract updateNoteButton(): void;
	protected abstract writeWithDraft(ops: Op[], highlight?: string | null, show?: 'build' | 'in-place'): Promise<DraftWritten | null>;
}
