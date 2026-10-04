/*
 * The holder form (spec §13.5): Number (placeholder "II"), Ruler name (filled with the ruler name
 * that the plugin uses), From and Until, and a live preview ("Ser Gareth Orsini shows as: Gareth I").
 * For a holder who is not in the tree it also asks for the name; for "New title…" in the edit sheet it
 * also asks for the title's name. It looks like the edit sheet and has its commit model: Save hands the
 * values to the caller (the sheet writes them, the Titles window keeps them in its draft), Cancel
 * discards, and any other way to close with changes asks first. `titles-draft.ts` does the logic.
 */

import { Modal, type App } from 'obsidian';
import { SHEET, TITLES_UI } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { nameDialog, revealFocused, sheetField, showErrorLine } from './sheet-parts';
import { formResult, formStart, previewParts, rulerOf, type HolderFormFields, type HolderValues } from './titles-draft';

/** What the holder form shows and where its values go. */
export interface HolderFormSpec {
	/** "Edit holder" or "New holder". */
	heading: string;
	/** A line under the heading: the title, and the person when there is one. */
	context: string;
	/** The holder's values at the start (a new holder: only `person`, or a typed `name`). */
	values: HolderValues;
	/** The person's full name when the holder is in the tree; undefined for a holder who is not. */
	personName?: string;
	/** Ask for the name of a holder who is not in the tree. */
	askName?: boolean;
	/** Ask for the name of a new title, with this text first; undefined: no title field. */
	titleName?: string;
	/**
	 * Takes the values (and the new title's name); resolves to null when they are saved, else to the
	 * message the form shows (it stays open with the values).
	 */
	save(values: HolderValues, titleName: string | undefined): Promise<string | null> | string | null;
	/** Runs once when the form has closed, saved or not. */
	closed?(): void;
}

class HolderFormModal extends Modal {
	private closing = false;
	private saving = false;
	private confirmEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private readonly cleanup: (() => void)[] = [];
	private readonly start: HolderFormFields;
	private readonly fields: HolderFormFields;
	private readonly startTitle: string | undefined;
	private titleName: string | undefined;
	/** The ruler name follows the holder's name until the owner types in it; a written `as` counts as typed. */
	private rulerTouched = false;

	constructor(
		app: App,
		private readonly spec: HolderFormSpec,
	) {
		super(app);
		this.start = formStart(spec.values, spec.personName, !!spec.askName);
		this.fields = { ...this.start };
		// A written `as` is the owner's own ruler name: a new holder name must not replace it (§13.5).
		this.rulerTouched = spec.values.as !== undefined;
		this.startTitle = spec.titleName;
		this.titleName = spec.titleName;
	}

	override onOpen(): void {
		this.modalEl.addClass('dynasty-sheet');
		this.modalEl.addClass('dynasty-holder-form');
		this.cleanup.push(phoneLayout(this, () => revealFocused(this.modalEl, this.contentEl)), ignoreGhostClick(this), trackModal(this, () => this.finish()));
		// The keyboard can cover a field in the scrolling body: bring it into view when it gets the focus (C1).
		const reveal = () => revealFocused(this.modalEl, this.contentEl, 300);
		this.contentEl.addEventListener('focusin', reveal);
		this.cleanup.push(() => this.contentEl.removeEventListener('focusin', reveal));
		const el = this.contentEl;
		el.addClass('dynasty-sheet-content');
		const header = el.createDiv({ cls: 'dynasty-sheet-header' });
		nameDialog(this.modalEl, header.createDiv({ cls: 'dynasty-sheet-title', text: this.spec.heading }));
		const actions = header.createDiv({ cls: 'dynasty-sheet-actions' });
		actions.createEl('button', { cls: 'dynasty-sheet-cancel', text: SHEET.cancel, attr: { type: 'button' } }).addEventListener('click', () => this.finish());
		const save = actions.createEl('button', { cls: ['mod-cta', 'dynasty-sheet-save'], text: SHEET.save, attr: { type: 'button' } });
		save.addEventListener('click', () => void this.write());
		const body = el.createDiv({ cls: 'dynasty-sheet-body' });
		body.createDiv({ cls: 'dynasty-choice-text', text: this.spec.context });
		this.errorEl = body.createDiv({ cls: 'dynasty-sheet-error', attr: { role: 'alert' } });
		this.errorEl.hide();
		let first: HTMLInputElement | null = null;
		if (this.titleName !== undefined) {
			first = this.input(body, TITLES_UI.titleName, 'title-name', this.titleName, (v) => (this.titleName = v), { autocapitalize: 'words' });
		}
		let ruler: HTMLInputElement | null = null;
		if (this.fields.name !== undefined) {
			const name = this.input(body, TITLES_UI.holderName, 'holder-name', this.fields.name, (v) => {
				this.fields.name = v;
				// Until the owner types a ruler name, it is the holder's name (§13.5).
				if (!this.rulerTouched && ruler) {
					this.fields.ruler = rulerOf({ name: v.trim() }, undefined);
					ruler.value = this.fields.ruler;
				}
			}, { autocapitalize: 'words' });
			first ??= name;
		}
		const row = body.createDiv({ cls: 'dynasty-holder-form-row' });
		const number = this.input(row, TITLES_UI.number, 'number', this.fields.number, (v) => (this.fields.number = v), { placeholder: TITLES_UI.numberPlaceholder });
		first ??= number;
		ruler = this.input(row, TITLES_UI.ruler, 'ruler', this.fields.ruler, (v) => {
			this.fields.ruler = v;
			this.rulerTouched = true;
		}, { autocapitalize: 'words' });
		const dates = body.createDiv({ cls: 'dynasty-holder-form-row' });
		// Free text (fictional calendars): never a numeric keyboard (spec §7.4).
		this.input(dates, TITLES_UI.from, 'from', this.fields.from, (v) => (this.fields.from = v));
		this.input(dates, TITLES_UI.until, 'to', this.fields.to, (v) => (this.fields.to = v));
		this.previewEl = body.createDiv({ cls: 'dynasty-holder-preview', attr: { 'aria-live': 'polite' } });
		this.updatePreview();
		first?.focus();
	}

	private input(parent: HTMLElement, label: string, name: string, value: string, change: (v: string) => void, o: { placeholder?: string; autocapitalize?: string } = {}): HTMLInputElement {
		const { row, id } = sheetField(parent, label, name, 'dynasty-holder');
		// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
		const extra = { placeholder: o.placeholder ?? null, autocapitalize: o.autocapitalize ?? null };
		const input = row.createEl('input', { cls: 'dynasty-sheet-input', attr: { id, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: extra.placeholder, autocapitalize: extra.autocapitalize } });
		input.value = value;
		input.addEventListener('input', () => {
			change(input.value);
			this.errorEl?.hide();
			this.updatePreview();
		});
		return input;
	}

	private updatePreview(): void {
		const p = previewParts(this.spec.personName, this.fields);
		this.previewEl?.setText(p.full ? TITLES_UI.preview(p.full, p.shown) : p.shown);
	}

	private dirty(): boolean {
		const f = this.fields;
		const s = this.start;
		const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();
		return !(same(f.number, s.number) && same(f.ruler, s.ruler) && same(f.from, s.from) && same(f.to, s.to) && same(f.name, s.name) && same(this.titleName, this.startTitle));
	}

	private async write(): Promise<void> {
		if (this.saving) return;
		if (this.titleName !== undefined && this.titleName.trim() === '') {
			showErrorLine(this.errorEl, TITLES_UI.needTitleName);
			return;
		}
		if (this.fields.name !== undefined && this.fields.name.trim() === '') {
			showErrorLine(this.errorEl, TITLES_UI.needHolderName);
			return;
		}
		const values = formResult(this.spec.values, this.spec.personName, this.fields);
		this.saving = true;
		this.modalEl.addClass('is-saving');
		try {
			const message = await this.spec.save(values, this.titleName?.trim());
			if (message === null) {
				this.finish();
				return;
			}
			showErrorLine(this.errorEl, message);
		} catch (e) {
			console.error('Dynasty Tree: cannot save the holder', e);
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
		box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: TITLES_UI.formDiscardText });
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
		try {
			this.spec.closed?.();
		} catch (e) {
			console.error('Dynasty Tree: cannot return the focus', e);
		}
	}
}

/** Opens the holder form; it calls `spec.save` on Save and stays open until a save succeeds or the owner cancels. */
export function holderForm(app: App, spec: HolderFormSpec): void {
	new HolderFormModal(app, spec).open();
}
