/*
 * Edit of one partnership: type, start, end and, for a marriage, "Ended by" (spec §6.3 Partners, Edit; D306, D310). It looks like the
 * edit sheet and has the same commit model: Save writes (through the sheet, with the sheet's
 * draft), and the editor stays open with the message if the write fails; Cancel and any other
 * way to close with changes ask "Discard changes?".
 */

import { setIcon, type App } from 'obsidian';
import type { PartnerLink } from '../core/family-query';
import { ENDED_BY, isUnionType, readEndedBy, UNION_TYPES } from '../core/types';
import { SHEET, UNION_EDIT, UNION_TYPE_TEXT, partnerDetail } from '../render/ui-text';
import { buildShell } from './window-shell';
import { startWithoutFocus } from './modal-layout';
import { endEntryOnEnter, nameDialog, sheetField, uniqueId } from './sheet-parts';
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

/**
 * D330 UX-03: the detail of a partner row, in every place that lists a partnership (the Family row, the other-parent step, the "already partners" list, the
 * "Partnership of the parents" choice): the type, the dates and, only for a marriage or a type word of the tree's own (`showsEndedBy`) with an `ended-by`
 * that `readEndedBy` reads, "ended by divorce". Another kind, an unknown value, no value and a pair with no recorded partnership (a null type) give no such part.
 */
export function partnerLinkDetail(l: Pick<PartnerLink, 'type' | 'start' | 'end' | 'endedBy'>): string {
	const why = l.type !== null && showsEndedBy(l.type) ? readEndedBy(l.endedBy) : null;
	return partnerDetail(l.type, l.start, l.end, why);
}

/** Writes the values; resolves to null after a successful write, or to the message to show. */
type UnionSave = (v: UnionValues) => Promise<string | null>;

const same = (a: UnionValues, b: UnionValues) => a.type === b.type && a.start.trim() === b.start.trim() && a.end.trim() === b.end.trim() && a.endedBy === b.endedBy;

class UnionEditModal extends SmallFormModal {
	private readonly values: UnionValues;
	private readonly initial: UnionValues;
	private endedRow: HTMLElement | null = null;
	/** The couple's names as the first text line of a computer window; the error about the whole window stands under it. */
	private nameEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly pair: string,
		initial: UnionValues,
		private readonly save: UnionSave,
	) {
		super(app);
		// A known value or an alias in another letter case is the known choice, so Save does not rewrite it.
		this.initial = { ...initial, endedBy: endedByChoice(initial.endedBy) };
		this.values = { ...this.initial };
	}

	override onOpen(): void {
		this.openFrame('dynasty-union-edit');
		const el = this.contentEl;
		// The two names are the title on every device (D316): the bar of a phone shows them, and a computer window shows them as its first text line.
		// O-14: Cancel asks the question that Esc asks when a typed change would be lost.
		const shell = buildShell({ modalEl: this.modalEl, contentEl: el, title: this.pair, titled: true, onCancel: () => this.finish(), onSave: () => void this.write(), discard: this.discardOption() });
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		// CX-18 and D316: the phone bar keeps the two names whole, up to three text lines (`is-wrapping`); no other window does.
		if (shell.bar) shell.titleEl.addClass('dynasty-bar-line', 'is-wrapping');
		// The two names alone do not say what the window is for, so a hidden purpose text goes before them in the name of the dialog.
		const titleId = shell.titleEl.getAttribute('id') ?? '';
		const purposeId = `${titleId}-purpose`;
		el.createSpan({ cls: 'dynasty-sr-only', text: UNION_EDIT.purpose, attr: { id: purposeId } });
		this.modalEl.setAttribute('aria-labelledby', `${purposeId} ${titleId}`);
		const body = shell.body;
		// W-05: the couple's names in the title role of the person window (the text font, the Title size, semibold).
		if (!shell.bar) this.nameEl = body.createDiv({ cls: ['dynasty-choice-text', 'dynasty-union-title', 'dynasty-title', 'is-name'], text: this.pair });
		const field = (label: string, name: string, parent: HTMLElement = body) => sheetField(parent, label, name, 'dynasty-union');
		const t = field(UNION_EDIT.type, 'union-type');
		const wrap = t.row.createDiv({ cls: 'dynasty-select' });
		// O-34: the field says "Kind"; a screen reader hears "Kind of partnership". The name comes from a hidden text: an aria-label would show as a tooltip.
		const nameId = uniqueId(`${t.id}-name`);
		wrap.createSpan({ cls: 'dynasty-sr-only', text: UNION_EDIT.typeLabel, attr: { id: nameId } });
		const sel = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id: t.id, 'aria-labelledby': nameId } });
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
		// W-05: Start and End stand side by side, as Born and Died do in the person window.
		const dates = body.createDiv({ cls: 'dynasty-grid' });
		for (const key of ['start', 'end'] as const) {
			const f = field(UNION_EDIT[key], `union-${key}`, dates);
			// Free text (fictional calendars): never a numeric keyboard (spec §7.4).
			const input = f.row.createEl('input', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id: f.id, type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' } });
			input.value = this.values[key];
			endEntryOnEnter(input);
			input.addEventListener('input', () => {
				this.values[key] = input.value;
				this.shell?.clearWindowError();
			});
		}
		this.endedByField(field);
		// A select that takes the focus in code opens its list by itself on an iPad.
		this.cleanup.push(startWithoutFocus(this.modalEl));
	}

	/** The "Ended by" choice. A hidden choice keeps what the note has: hiding never changes the value (D310). */
	private endedByField(field: (label: string, name: string, parent?: HTMLElement) => { row: HTMLElement; id: string }): void {
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
			// An error about the whole window stands under the header (here: the title), and the header does not move.
			this.shell?.windowError(message, this.nameEl);
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
