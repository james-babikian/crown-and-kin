/*
 * The frame of the two small forms that look like the edit sheet and share its commit model: the holder form and the partnership
 * editor. Save writes and the form stays open with a message if the write fails; Cancel discards; any other way to close with
 * changes asks "Discard changes?" (spec §6.3). `holder-form.ts` and `union-edit.ts` extend it.
 */

import { Modal } from 'obsidian';
import { holdLayoutOnPress } from '../render/dom/press-hold';
import { SHEET } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from '../view/plugin-modals';
import { revealFocused } from './sheet-parts';
import { confirmBox } from './window-parts';
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
		this.cleanup.push(phoneLayout(this, () => revealFocused(this.modalEl, this.contentEl)), ignoreGhostClick(this), trackModal(this, () => this.finish()), holdLayoutOnPress(this.modalEl));
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus.
		const reveal = () => revealFocused(this.modalEl, this.contentEl, 300);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
	}

	protected finish(): void {
		this.closing = true;
		this.close();
	}

	/** O-14: what the shell needs so that the left button asks the question that Esc asks when a typed change would be lost (`buildShell({ discard })`). */
	protected discardOption(): { dirty: () => boolean; ask: () => void } {
		return { dirty: () => this.dirty(), ask: () => this.close() };
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
		const box = confirmBox(this.modalEl, {
			title: SHEET.discardTitle,
			text: [this.discardText()],
			buttons: [
				{
					label: SHEET.keepEditing,
					cls: 'dynasty-sheet-keep',
					run: () => {
						box.layer.remove();
						this.confirmEl = null;
					},
				},
				{ label: SHEET.discard, cls: ['mod-warning', 'dynasty-sheet-discard'], run: () => this.finish() },
			],
		});
		this.confirmEl = box.layer;
	}

	override onClose(): void {
		for (const c of this.cleanup.splice(0)) c();
		this.shell?.dispose();
		this.shell = null;
		this.contentEl.empty();
	}
}
