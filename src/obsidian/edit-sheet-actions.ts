/*
 * The Actions section of the edit sheet (spec §6.3, §13.11): focus, pin, the mark, folds, Make a note with its same-name question, the relation
 * finder, the id line, and the hosts that the Titles section and the add flows use. Fifth layer of the chain listed in `edit-sheet.ts`.
 */

import { Notice, type TFile } from 'obsidian';
import { FAMILY, FINDER_UI, FOCUS_UI, FOLD_UI, ME_UI, NOTE_UI, SHEET } from '../render/ui-text';
import type { Op } from '../core/edit';
import { andList } from '../core/messages';
import { CHANGE_UI } from '../render/change-text';
import { linkedNotePath, personNoteName } from '../core/note-make';
import { makePersonNote, openMadeNote, type MakeNoteMode, type MakePersonNoteOutcome, type SameNameAnswer } from './make-note';
import type { FlowHost } from './family-flows';
import { pickPerson, type PickerContext } from './person-picker';
import type { TitlesHost } from './sheet-titles';
import { EditSheetFamily } from './edit-sheet-family';
import type { DraftWritten, SheetBase } from './edit-sheet-base';
import { unwritten } from '../view/sheet-draft';

/** The Actions section and the hosts of the add flows and the Titles section. */
export abstract class EditSheetActions extends EditSheetFamily {
	/** The Actions section (spec §6.3); `me` is the marked person (spec §13.1), or null. Delete and the ID line stand last. */
	protected actionsBody(body: HTMLElement, me: string | null): void {
		const list = body.createDiv({ cls: ['dynasty-rows', 'dynasty-actions-list'] });
		const p = this.data.person;
		const focus = this.o.focus;
		if (focus && !this.gone) this.actionRow(list, 'crosshair', FOCUS_UI.focusHere, 'dynasty-focus-here', () => this.leaveFor(() => focus.here(p.id)), FOCUS_UI.focusHereLabel(p.name));
		if (!this.readOnly) {
			// D18: one pin per tree; the pinned person's sheet offers to remove it.
			if (this.data.tree.options.focus === p.id) this.actionRow(list, 'pin', FOCUS_UI.unpin, 'dynasty-unpin', () => void this.pin(false), FOCUS_UI.unpinLabel(p.name));
			else this.actionRow(list, 'pin', FOCUS_UI.pin, 'dynasty-pin', () => void this.pin(true), FOCUS_UI.pinLabel(p.name));
			// Spec §13.1: one mark per tree; the marked person's sheet offers to remove it.
			if (me === p.id) this.actionRow(list, 'user-check', ME_UI.unmark, 'dynasty-unmark-me', () => void this.markMe(false), ME_UI.unmarkLabel(p.name));
			else this.actionRow(list, 'user-check', ME_UI.mark, 'dynasty-mark-me', () => void this.markMe(true), ME_UI.markLabel(p.name));
		}
		// Spec §13.10: Hide descendants and Show descendants write nothing, so they are in a read-only tree too; not for a new person.
		const folds = this.o.folds;
		if (folds && !this.isNew && !this.gone) {
			const state = folds.state(p.id);
			if (state.open.length) this.actionRow(list, 'fold-vertical', FOLD_UI.hideDescendants, 'dynasty-hide-descendants', () => this.leaveFor(() => folds.hide(p.id)), FOLD_UI.hideDescendantsLabel(p.name));
			if (state.folded.length) this.actionRow(list, 'fold-vertical', FOLD_UI.showDescendants, 'dynasty-show-descendants', () => this.leaveFor(() => folds.show(p.id)), FOLD_UI.showDescendantsLabel(p.name));
		}
		const finder = this.o.finder;
		if (finder && !this.gone) this.actionRow(list, 'git-branch', ME_UI.showRelationTo, 'dynasty-relation-to', () => void this.relationTo(finder), ME_UI.showRelationToLabel(p.name));
		// Spec §13.11: Make a note / Make the linked note, before Open link.
		if (!this.readOnly) {
			this.noteSlot = list.createDiv({ cls: 'dynasty-note-slot' });
			this.updateNoteButton();
		}
		// D218 item 9: "Open linked note" stands in the row under the header (`openNoteLink`), not here.
		if (!this.readOnly) this.actionRow(list, 'trash-2', FAMILY.deletePerson, 'dynasty-delete-person', () => this.confirmDelete(), undefined, true);
		this.idLine(body);
	}

	// ---------- Make a note (spec §13.11) ----------

	/** N1: which button the draft offers, or null. Not in a read-only sheet, a gone person or a new person. */
	protected noteMode(): MakeNoteMode | null {
		if (this.readOnly || this.isNew) return null;
		const link = this.draft.link.trim();
		if (link === '') return 'new';
		const lp = linkedNotePath(link);
		if (!lp) return null;
		const dest = this.app.metadataCache.getFirstLinkpathDest(lp.path.replace(/\.md$/i, ''), this.o.sourcePath);
		return dest ? null : 'linked';
	}

	/** Shows, changes or removes the button when the draft name or link changes; it keeps the button when nothing changed. */
	protected updateNoteButton(): void {
		const slot = this.noteSlot;
		if (!slot) return;
		const mode = this.noteMode();
		const name = this.draft.name.trim() || this.data.person.name || SHEET.unnamed;
		const key = mode ? `${mode}|${name}` : '';
		if (key === this.noteKey) return;
		this.noteKey = key;
		slot.empty();
		if (!mode) return;
		const text = mode === 'new' ? NOTE_UI.make : NOTE_UI.makeLinked;
		const label = mode === 'new' ? NOTE_UI.makeLabel(name) : NOTE_UI.makeLinkedLabel(name);
		this.actionRow(slot, 'file-text', text, 'dynasty-make-note', () => void this.makeNoteFlow(mode), label);
	}

	/** N2, N3: the flow, then what the sheet shows for its result. A busy flag covers the whole flow. */
	protected async makeNoteFlow(mode: MakeNoteMode): Promise<void> {
		if (this.noteBusy || this.saving || this.readOnly || this.isNew) return;
		this.noteBusy = true;
		const p = this.data.person;
		const wanted = mode === 'linked' ? (linkedNotePath(this.draft.link.trim())?.name ?? '') : personNoteName({ name: this.draft.name });
		try {
			const out = await makePersonNote({
				app: this.app,
				mode,
				personId: p.id,
				name: this.draft.name,
				link: this.draft.link.trim(),
				sourcePath: this.o.sourcePath,
				loadedBody: this.data.body,
				ready: () => this.pendingOps() !== null && this.fresh(),
				alive: () => this.shown && !this.gone && !this.closing,
				handle: this.o.handle,
				ask: (name, free) => this.askSameName(name, free),
				write: (link) => this.writeWithDraft([{ kind: 'set-person-fields', id: p.id, fields: { link } }]),
			});
			this.afterNote(out, mode, wanted, p.id);
		} catch (e) {
			console.error('Crown and Kin: cannot make the note', e);
			new Notice(NOTE_UI.cannot(wanted));
		} finally {
			this.noteBusy = false;
		}
	}

	/** The Notices and the next step for the result of the flow (N2 steps 6 and 7). */
	protected afterNote(out: MakePersonNoteOutcome, mode: MakeNoteMode, wanted: string, was: string): void {
		const open = (file: TFile) => {
			const go = () => openMadeNote(this.app, file);
			if (this.o.openNote) this.o.openNote(go);
			else void go().catch((e) => console.error('Crown and Kin: cannot open the note', e));
		};
		switch (out.kind) {
			case 'made':
			case 'linked-existing': {
				if (out.written) {
					this.noteNotice(out.kind === 'made' ? NOTE_UI.made(out.file.basename) : NOTE_UI.linkedTo(out.file.basename), out.written as DraftWritten, out.file.basename, was);
					this.finish();
					open(out.file);
				} else if (mode === 'linked') this.leaveFor(() => open(out.file));
				return;
			}
			case 'made-linked':
				new Notice(NOTE_UI.madeOnly(out.file.basename));
				// The tree is not written in this mode, so unsaved changes are asked about before the sheet closes.
				this.leaveFor(() => open(out.file));
				return;
			case 'link-not-added':
				new Notice(NOTE_UI.linkNotAdded(out.file.basename));
				return;
			case 'failed':
				new Notice(NOTE_UI.cannot(wanted));
				return;
			case 'stale':
				this.stale(this.o.handle.body);
				return;
			default:
				return;
		}
	}

	/** N4: the success Notice with Undo. Undo reverts the whole write; the note stays in the vault. */
	protected noteNotice(text: string, out: DraftWritten, name: string, was: string): void {
		// One Notice after Undo: the note text replaces the generic one (spec §13.11).
		this.removedNotice(text, out, was, NOTE_UI.undone(name));
	}

	/** The same-name question (N2 step 2): resolves with the choice, and with Cancel if the question goes away. */
	protected askSameName(name: string, free: string): Promise<SameNameAnswer> {
		return new Promise((resolve) => {
			this.hideConfirm();
			this.rememberFocus();
			let settled = false;
			const settle = (answer: SameNameAnswer) => {
				if (settled) return;
				settled = true;
				this.dismissQuestion = null;
				resolve(answer);
			};
			const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
			this.confirmEl = layer;
			this.dismissQuestion = () => settle('cancel');
			const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
			box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: NOTE_UI.askTitle(name) });
			const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
			const choice = (text: string, cls: string, answer: SameNameAnswer) => {
				const b = row.createEl('button', { cls, text, attr: { type: 'button' } });
				b.addEventListener('click', () => {
					settle(answer);
					this.hideConfirm();
				});
				return b;
			};
			const cancel = choice(NOTE_UI.askCancel, 'dynasty-sheet-keep', 'cancel');
			choice(NOTE_UI.askLink, 'dynasty-note-ask-link', 'link');
			choice(NOTE_UI.askNew(free), 'dynasty-note-ask-new', 'new');
			cancel.focus();
		});
	}

	/** Closes the sheet, then runs `then`; with unsaved changes, only after "Discard changes?". */
	protected leaveFor(then: () => void): void {
		const go = () => {
			this.finish();
			then();
		};
		if (this.isDirty()) this.showConfirm({ title: SHEET.discardTitle, text: [SHEET.discardText], confirm: SHEET.discard, confirmCls: 'dynasty-sheet-discard', keep: SHEET.keepEditing, onConfirm: go });
		else go();
	}

	/**
	 * Pin focus here / Remove pin (D18): writes or removes `options.focus`, with the draft in the same
	 * write like the other actions. Both end the session focus, so every view shows the new pin, or
	 * after Remove pin the default. The sheet stays open and shows the other button.
	 */
	protected async pin(on: boolean): Promise<void> {
		const h = this.o.handle;
		const before = h.state.focus;
		// Before the write: the redraw that follows it can run before the write returns.
		h.state.focus = null;
		const restoreOwn = this.o.focus?.pinning?.() ?? (() => undefined);
		// A pin moves the list (D18): an earlier in-place write of this window must not hold it.
		const held = h.state.listHold;
		h.state.listHold = false;
		// Not an edit of the person (no highlight, no last edited person): after Remove pin a phone opens on the start person again (D20).
		const out = await this.writeWithDraft([{ kind: 'set-option', key: 'focus', value: on ? this.data.person.id : null }], null);
		if (out) return;
		// Nothing was written: the views show what they showed before.
		if (h.state.focus === null) h.state.focus = before;
		h.state.listHold = held;
		restoreOwn();
		this.o.focus?.changed();
	}

	/**
	 * This is me / Remove "This is me" (spec §13.1): writes or removes `options.me`, with the draft in
	 * the same write (§6.3). It moves the mark from anyone else (one line). Not an edit of the person:
	 * no highlight, no last edited person. The sheet stays open and shows the other button.
	 */
	protected async markMe(on: boolean): Promise<void> {
		const h = this.o.handle;
		// A mark moves the list (rung 3): an earlier in-place write of this window must not hold it.
		const held = h.state.listHold;
		h.state.listHold = false;
		const was = this.data.person.id;
		const out = await this.writeWithDraft([{ kind: 'set-option', key: 'me', value: on ? this.data.person.id : null }], null);
		if (!out) {
			h.state.listHold = held;
			return;
		}
		// D267: the name after the write is the saved name, also when the same write saved a new one.
		const name = this.data.person.name || SHEET.unnamed;
		this.announce(on ? CHANGE_UI.markedMe(name) : CHANGE_UI.unmarkedMe(name), out.body, was, out.withFields);
	}

	/**
	 * D267: the text of the line after an Add flow that wrote at once, from the ops it wrote: Add parent and Add child write `add-parent`
	 * (the person of this window is the child or the parent), Add partner writes `add-union`. Null for any other write. The names are read
	 * before the write, while the ids of the ops are the ones the tree has now.
	 */
	protected changeText(ops: readonly Op[]): ((effects: readonly string[]) => string) | null {
		const me = this.data.person.id;
		const parents = ops.filter((op): op is Extract<Op, { kind: 'add-parent' }> => op.kind === 'add-parent');
		if (parents.length) {
			const first = parents[0];
			if (first.child === me) {
				const parent = this.name(first.parent);
				const child = this.name(me);
				const plain = CHANGE_UI.addedParent(parent, child, first.type);
				// The marriage is between the new parent and the first parent of the same type that the person has now (`addParent` in relationship-ops).
				const otherId = this.data.g.byId.get(me)?.parents.find((l) => l.type === first.type && l.id !== first.parent)?.id;
				const other = otherId === undefined ? null : this.name(otherId);
				return (effects) => (other !== null && effects.includes('auto-union') ? CHANGE_UI.addedParentAndMarriage(parent, child, first.type, other) : plain);
			}
			if (parents.some((op) => op.parent === me)) {
				const text = CHANGE_UI.addedChild(this.name(first.child), andList(parents.map((op) => this.name(op.parent))), first.type);
				return () => text;
			}
			// Add child with another parent who is the only one to add: this person holds the link already, and the line names the parent who was added.
			if (parents.length === 1) {
				const text = CHANGE_UI.addedParent(this.name(first.parent), this.name(first.child), first.type);
				return () => text;
			}
		}
		const union = ops.find((op): op is Extract<Op, { kind: 'add-union' }> => op.kind === 'add-union');
		if (union) {
			const other = union.partners.find((id) => id !== me);
			if (other) {
				const text = CHANGE_UI.addedPartner(this.name(other), this.name(me));
				return () => text;
			}
		}
		return null;
	}

	/**
	 * Show the relation to… (spec §13.2): the picker with every other person and no "Create" row, the
	 * marked person first. The picked person is the first person of the finder, this person the second.
	 */
	protected async relationTo(finder: NonNullable<SheetBase['finder']>): Promise<void> {
		const p = this.data.person;
		const me = this.me();
		const picked = await pickPerson(this.app, this.data.g, new Set([p.id]), FINDER_UI.placeholder, FINDER_UI.otherTitle, false, me !== p.id ? me : null, null, this.pickerContext());
		if (picked?.kind !== 'person' || !this.shown) return;
		this.leaveFor(() => finder.show(picked.id, p.id));
	}

	/**
	 * D106: "Id: p12", a small grey text line at the very end of the body. Only for a person whose id is
	 * written in the tree text: a person with no id has only the `~N` name that the tree gives them.
	 */
	protected idLine(parent: HTMLElement): void {
		const id = this.data.person.id;
		if (this.gone || !this.data.g.byId.has(id) || unwritten(this.data, id)) return;
		parent.createDiv({ cls: ['dynasty-sheet-id', 'dynasty-id'], text: SHEET.idLine(id) });
	}

	/** What the Titles section (spec §13.4) uses of the sheet: its data, its draft and its writes. */
	protected titlesHost(): TitlesHost {
		return {
			app: this.app,
			data: () => ({ body: this.data.body, g: this.data.g, person: this.data.person }),
			readOnly: this.readOnly,
			draftTitle: () => this.draft.title.trim(),
			ready: () => this.pendingOps() !== null && this.fresh(),
			write: async (ops) => !!(await this.writeWithDraft(ops)),
			writeRemoval: async (ops, text) => {
				const was = this.data.person.id;
				const out = await this.writeWithDraft(ops);
				if (out) this.removedNotice(text, out, was);
				return !!out;
			},
			lastError: () => this.lastError,
			button: (parent, text, cls, run, label, icon) => this.button(parent, text, cls, run, label, icon),
		};
	}

	protected flowHost(): FlowHost {
		const fam = this.data.fam!;
		return {
			app: this.app,
			g: this.data.g,
			person: this.data.person,
			fam,
			name: (id) => this.name(id),
			ready: () => this.pendingOps() !== null && this.fresh(),
			commit: async (ops, highlight) => {
				const text = this.changeText(ops);
				const was = this.data.person.id;
				const out = await this.writeWithDraft(ops, highlight);
				// D267: the window stays open, so it says what the action changed.
				if (out && text) this.announce(text(out.effects), out.body, was, out.withFields);
				return out;
			},
			openNew: (rel, name) => this.openNew(rel, name),
			// D211: the lists of Add parent, Add child and Add partner name no relation, unless this window is about the marked person: the words say "to You", and in the window of another person they would be read as relations to that person.
			picker: () => ({ ...this.pickerContext(), ...(this.me() === this.data.person.id ? {} : { me: null }) }),
		};
	}

	/** The rows of the person picker: portraits, the marked person for the relation word, and the relation settings. */
	protected pickerContext(): PickerContext {
		const me = this.me();
		return { ...(this.o.pictures ? { pictures: this.o.pictures } : {}), sourcePath: this.o.sourcePath, me, ...(this.o.relationOptions ? { relationOptions: this.o.relationOptions } : {}), ...(this.o.relationBlock ? { relationBlock: this.o.relationBlock } : {}) };
	}
}
