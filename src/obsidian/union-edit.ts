/*
 * Edit of one partnership: type, start, end and, for a marriage, "Ended by" (spec §6.3 Partners, Edit; D306, D310). It looks like the
 * edit sheet and has the same commit model: Save writes (through the sheet, with the sheet's
 * draft), and the editor stays open with the message if the write fails; Cancel discards; any
 * other way to close with changes asks "Discard changes?".
 */

import { setIcon, type App } from 'obsidian';
import { ENDED_BY, isUnionType, readEndedBy, UNION_TYPES } from '../core/types';
import { SHEET, UNION_EDIT, UNION_TYPE_TEXT } from '../render/ui-text';
import { buildShell } from './window-shell';
import { nameDialog, sheetField } from './sheet-parts';
import { SmallFormModal } from './small-form';

/** The editable fields of one partnership. */
export interface UnionValues {
	type: string;
	start: string;
	end: string;
	/** The value of the "Ended by" choice: '' (not known), a known value, or the text as written in the note. */
	endedBy: string;
}

/**
 * The choice that shows a written `ended-by`: a known value or an alias (`divorced`, `annulled`) in any letter case is its value, so the
 * choice shows "Divorce" and no extra raw choice; text with no meaning stays as written; none is ''. The note keeps its own text,
 * because a pick that means the same value writes nothing (`edit-sheet-writes.ts`).
 */
export function endedByChoice(raw: string | undefined | null): string {
	return readEndedBy(raw) ?? (raw ?? '').trim();
}

/** D310: "Ended by" shows for a marriage and for a type word of the tree's own (drawn as a marriage); not for a betrothal, a concubinage or an affair. */
export const showsEndedBy = (type: string): boolean => type === 'marriage' || !isUnionType(type);

/** Writes the values; resolves to null after a successful write, or to the message to show. */
export type UnionSave = (v: UnionValues) => Promise<string | null>;

const same = (a: UnionValues, b: UnionValues) => a.type === b.type && a.start.trim() === b.start.trim() && a.end.trim() === b.end.trim() && a.endedBy === b.endedBy;

class UnionEditModal extends SmallFormModal {
	private readonly values: UnionValues;
	private readonly initial: UnionValues;
	private endedRow: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly pair: string,
		initial: UnionValues,
		private readonly save: UnionSave,
	) {
		super(app);
		// A known value or an alias in another letter case is the known choice, so Save does not rewrite it (RULES §9 item 4).
		this.initial = { ...initial, endedBy: endedByChoice(initial.endedBy) };
		this.values = { ...this.initial };
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
		sel.addEventListener('change', () => {
			this.values.type = sel.value;
			this.endedRow?.toggle(showsEndedBy(this.values.type));
		});
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
		this.endedByField(field);
		sel.focus();
	}

	/** The "Ended by" choice. A hidden choice keeps what the note has: hiding never changes the value (D310). */
	private endedByField(field: (label: string, name: string) => { row: HTMLElement; id: string }): void {
		const e = field(UNION_EDIT.ended.label, 'union-ended-by');
		this.endedRow = e.row;
		const wrap = e.row.createDiv({ cls: 'dynasty-select' });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id: e.id, 'aria-describedby': `${e.id}-hint` } });
		setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
		const choices: string[] = ['', ...ENDED_BY];
		// A value that the window does not offer stays selectable, so Save never removes or changes it by itself.
		if (!choices.includes(this.values.endedBy)) choices.push(this.values.endedBy);
		for (const v of choices) sel.createEl('option', { text: v === '' ? UNION_EDIT.ended.none : (Object.prototype.hasOwnProperty.call(UNION_EDIT.ended.values, v) ? UNION_EDIT.ended.values[v] : v), attr: { value: v } });
		sel.value = this.values.endedBy;
		sel.addEventListener('change', () => (this.values.endedBy = sel.value));
		e.row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: UNION_EDIT.ended.hint, attr: { id: `${e.id}-hint` } });
		e.row.toggle(showsEndedBy(this.values.type));
	}

	/** What Save writes: the values, with the value of a hidden "Ended by" taken from the note. */
	private current(): UnionValues {
		return { ...this.values, endedBy: showsEndedBy(this.values.type) ? this.values.endedBy : this.initial.endedBy };
	}

	private async write(): Promise<void> {
		if (this.saving) return;
		if (same(this.current(), this.initial)) {
			this.finish();
			return;
		}
		this.saving = true;
		this.modalEl.addClass('is-saving');
		try {
			const message = await this.save({ ...this.current(), start: this.values.start.trim(), end: this.values.end.trim() });
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
		return !same(this.current(), this.initial);
	}

	protected discardText(): string {
		return UNION_EDIT.discardText;
	}

}

/** Opens the editor; it calls `save` on Save and stays open until a save succeeds or the user cancels. */
export function openUnionEditor(app: App, a: string, b: string, initial: UnionValues, save: UnionSave): void {
	new UnionEditModal(app, UNION_EDIT.of(a, b), initial, save).open();
}
