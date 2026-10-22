/*
 * Edit of one partnership: type, start and end (spec §6.3 Partners, Edit). It looks like the
 * edit sheet and has the same commit model: Save writes (through the sheet, with the sheet's
 * draft), and the editor stays open with the message if the write fails; Cancel discards; any
 * other way to close with changes asks "Discard changes?".
 */

import { setIcon, type App } from 'obsidian';
import { UNION_TYPES } from '../core/types';
import { SHEET, UNION_EDIT, UNION_TYPE_TEXT } from '../render/ui-text';
import { buildShell } from './window-shell';
import { nameDialog, sheetField } from './sheet-parts';
import { SmallFormModal } from './small-form';

/** The editable fields of one partnership. */
export interface UnionValues {
	type: string;
	start: string;
	end: string;
}

/** Writes the values; resolves to null after a successful write, or to the message to show. */
export type UnionSave = (v: UnionValues) => Promise<string | null>;

const same = (a: UnionValues, b: UnionValues) => a.type === b.type && a.start.trim() === b.start.trim() && a.end.trim() === b.end.trim();

class UnionEditModal extends SmallFormModal {
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
		this.openFrame('dynasty-union-edit');
		const el = this.contentEl;
		const shell = buildShell({ modalEl: this.modalEl, contentEl: el, title: UNION_EDIT.title, titled: true, onCancel: () => this.finish(), onSave: () => void this.write() });
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		const body = shell.body;
		body.createDiv({ cls: 'dynasty-choice-text', text: this.pair });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		const field = (label: string, name: string) => sheetField(body, label, name, 'dynasty-union');
		const t = field(UNION_EDIT.type, 'union-type');
		const wrap = t.row.createDiv({ cls: 'dynasty-select' });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id: t.id } });
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		const types: string[] = [...UNION_TYPES];
		// An unknown type stays selectable, so Save never changes it by itself.
		if (!types.includes(this.values.type)) types.push(this.values.type);
		for (const v of types) sel.createEl('option', { text: UNION_TYPE_TEXT[v] ?? SHEET.sexOther(v), attr: { value: v } });
		sel.value = this.values.type;
		sel.addEventListener('change', () => (this.values.type = sel.value));
		for (const key of ['start', 'end'] as const) {
			const f = field(UNION_EDIT[key], `union-${key}`);
			// Free text (fictional calendars): never a numeric keyboard (spec §7.4).
			const input = f.row.createEl('input', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id: f.id, type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' } });
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
			console.error('Crown and Kin: cannot save the partnership', e);
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	protected dirty(): boolean {
		return !same(this.values, this.initial);
	}

	protected discardText(): string {
		return UNION_EDIT.discardText;
	}

}

/** Opens the editor; it calls `save` on Save and stays open until a save succeeds or the user cancels. */
export function openUnionEditor(app: App, a: string, b: string, initial: UnionValues, save: UnionSave): void {
	new UnionEditModal(app, UNION_EDIT.of(a, b), initial, save).open();
}
