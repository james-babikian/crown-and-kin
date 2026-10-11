/*
 * The frame of the two small forms that look like the edit sheet and share its commit model: the holder form and the partnership
 * editor. Save writes and the form stays open with a message if the write fails; Cancel discards; any other way to close with
 * changes asks "Discard changes?" (spec §6.3). `holder-form.ts` and `union-edit.ts` extend it.
 */

import { Modal } from 'obsidian';
import { SHEET } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { revealFocused } from './sheet-parts';
import type { Shell } from './window-shell';

/** The modal that both small forms extend: the frame set-up, the close rule with its question, and the clean-up. */
export abstract class SmallFormModal extends Modal {
	protected closing = false;
	protected saving = false;
	protected confirmEl: HTMLElement | null = null;
	protected errorEl: HTMLElement | null = null;
	protected readonly cleanup: (() => void)[] = [];
	protected shell: Shell | null = null;

	/** True if the form has a change that Cancel would lose. */
	protected abstract dirty(): boolean;
	/** The text of the question "Discard changes?". */
	protected abstract discardText(): string;

	/** The classes of the frame, the phone layout, the ghost-click guard and the keyboard reveal. `cls` names the form. */
	protected openFrame(cls: string): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass(cls);
		this.cleanup.push(phoneLayout(this, () => revealFocused(this.modalEl, this.contentEl)), ignoreGhostClick(this), trackModal(this, () => this.finish()));
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus (C1).
		const reveal = () => revealFocused(this.modalEl, this.contentEl, 300);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
	}

	protected finish(): void {
		this.closing = true;
		this.close();
	}

	/** Esc, the X button and a press outside: with changes, ask first (spec §6.3). */
	override close(): void {
		if (this.closing || !this.dirty()) {
			super.close();
			return;
		}
		if (this.confirmEl) {
			this.confirmEl.remove();
			this.confirmEl = null;
			return;
		}
		const layer = this.modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
		this.confirmEl = layer;
		const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
		box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: SHEET.discardTitle });
		box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: this.discardText() });
		const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
		const keep = row.createEl('button', { cls: 'dynasty-sheet-keep', text: SHEET.keepEditing, attr: { type: 'button' } });
		const discard = row.createEl('button', { cls: ['mod-warning', 'dynasty-sheet-discard'], text: SHEET.discard, attr: { type: 'button' } });
		keep.addEventListener('click', () => {
			layer.remove();
			this.confirmEl = null;
		});
		discard.addEventListener('click', () => this.finish());
		keep.focus();
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.shell?.dispose();
		this.shell = null;
		this.contentEl.empty();
	}
}
