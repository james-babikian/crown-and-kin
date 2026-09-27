/*
 * Edit of one partnership: type, start and end (spec §6.3 Partners, Edit). It looks like the
 * edit sheet and has the same commit model: Save writes (through the sheet, with the sheet's
 * draft), and the editor stays open with the message if the write fails; Cancel discards; any
 * other way to close with changes asks "Discard changes?".
 */

import { Modal, type App } from 'obsidian';
import { UNION_TYPES } from '../core/types';
import { SHEET, UNION_EDIT, UNION_TYPE_TEXT } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { sheetField } from './sheet-parts';

/** The editable fields of one partnership. */
export interface UnionValues {
	type: string;
	start: string;
	end: string;
}

/** Writes the values; resolves to null after a successful write, or to the message to show. */
export type UnionSave = (v: UnionValues) => Promise<string | null>;

const same = (a: UnionValues, b: UnionValues) => a.type === b.type && a.start.trim() === b.start.trim() && a.end.trim() === b.end.trim();

class UnionEditModal extends Modal {
	private closing = false;
	private saving = false;
	private confirmEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private readonly cleanup: (() => void)[] = [];
	private readonly values: UnionValues;

	constructor(
		app: App,
		private readonly pair: string,
		private readonly initial: UnionValues,
		private readonly save: UnionSave,
	) {
		super(app);
		this.values = { ...initial };
	}

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-union-edit');
		this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.finish()));
		const el = this.contentEl;
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		header.createDiv({ cls: 'dynasty-sheet-title', text: UNION_EDIT.title });
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: SHEET.cancel, attr: { type: 'button' } }).addEventListener('click', () => this.finish());
		const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button' } });
		save.addEventListener('click', () => void this.write());
		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-choice-text', text: this.pair });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		const field = (label: string, name: string) => sheetField(body, label, name, 'dynasty-union');
		const t = field(UNION_EDIT.type, 'union-type');
		const sel = t.row.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input'], attr: { id: t.id } });
		const types: string[] = [...UNION_TYPES];
		// An unknown type stays selectable, so Save never changes it by itself.
		if (!types.includes(this.values.type)) types.push(this.values.type);
		for (const v of types) sel.createEl('option', { text: UNION_TYPE_TEXT[v] ?? SHEET.sexOther(v), attr: { value: v } });
		sel.value = this.values.type;
		sel.addEventListener('change', () => (this.values.type = sel.value));
		for (const key of ['start', 'end'] as const) {
			const f = field(UNION_EDIT[key], `union-${key}`);
			// Free text (fictional calendars): never a numeric keyboard (spec §7.4).
			const input = f.row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id: f.id, type: 'text', autocomplete: 'off', spellcheck: 'false' } });
			input.value = this.values[key];
			input.addEventListener('input', () => {
				this.values[key] = input.value;
				this.errorEl?.hide();
			});
		}
		sel.focus();
	}

	private async write(): Promise<void> {
		if (this.saving) return;
		if (same(this.values, this.initial)) {
			this.finish();
			return;
		}
		this.saving = true;
		this.modalEl.addClass('is-saving');
		try {
			const message = await this.save({ type: this.values.type, start: this.values.start.trim(), end: this.values.end.trim() });
			if (message === null) {
				this.finish();
				return;
			}
			this.errorEl?.setText(message);
			this.errorEl?.show();
		} catch (e) {
			console.error('Dynasty Tree: cannot save the partnership', e);
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	private finish(): void {
		this.closing = true;
		this.close();
	}

	/** Esc, the X button and a press outside: with changes, ask first (spec §6.3). */
	override close(): void {
		if (this.closing || same(this.values, this.initial)) {
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
		box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: UNION_EDIT.discardText });
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
		this.contentEl.empty();
	}
}

/** Opens the editor; it calls `save` on Save and stays open until a save succeeds or the user cancels. */
export function editUnion(app: App, a: string, b: string, initial: UnionValues, save: UnionSave): void {
	new UnionEditModal(app, UNION_EDIT.of(a, b), initial, save).open();
}
