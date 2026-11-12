/*
 * The holder form (spec §13.5): Number (placeholder "II"), Ruler name (empty unless the entry has a
 * written ruler name; the default shows as a placeholder, and a hint under the field says so, I15), From and Until, the tick box
 * "Holds the title through the spouse" (D195, off and with a hint when the holder is not a person in the tree),
 * and a live preview ("Ser Gareth Orsini shows as: Gareth I").
 * For a holder who is not in the tree it also asks for the name; for "New title…" in the edit sheet it
 * also asks for the title's name. It looks like the edit sheet and has its commit model: Save hands the
 * values to the caller (the sheet writes them, the Titles window keeps them in its draft), Cancel
 * discards, and any other way to close with changes asks first. `titles-draft.ts` does the logic.
 */

import type { App } from 'obsidian';
import { SHEET, TITLES_UI } from '../render/ui-text';
import { buildShell, cancelLabelFor } from './window-shell';
import { startWithoutFocus } from './modal-layout';
import { clearFieldError, fieldError, nameDialog, sheetField, uniqueId } from './sheet-parts';
import { buildRow, confirmBox, iconLead } from './window-parts';
import { SmallFormModal } from './small-form';
import { guarded } from './start-guard';
import { formResult, formStart, previewParts, rulerHint, type HolderFormFields, type HolderValues } from '../view/titles-draft';

/**
 * O-18: what an existing holder row used to keep in its three-dot menu. The form of an existing holder holds these four actions.
 * The window runs `move` and `remove` on its draft; the form closes itself after each one.
 */
export interface HolderFormActions {
	/** Show the card in the tree; absent for a holder who is not in the tree. */
	show?: () => void;
	/** Move the holder one place up (-1) or down (1); the form is closed after it. */
	move: (dir: -1 | 1) => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
	remove: () => void;
}

/** What the holder form shows and where its values go. */
interface HolderFormSpec {
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
	/** The actions of an existing holder (O-18); absent for a new holder. */
	actions?: HolderFormActions;
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

class HolderFormModal extends SmallFormModal {
	private previewEl: HTMLElement | null = null;
	private contextEl: HTMLElement | null = null;
	private titleInput: HTMLInputElement | null = null;
	private nameInput: HTMLInputElement | null = null;
	private readonly start: HolderFormFields;
	private readonly fields: HolderFormFields;
	private readonly startTitle: string | undefined;
	private titleName: string | undefined;

	constructor(
		app: App,
		private readonly spec: HolderFormSpec,
	) {
		super(app);
		this.start = formStart(spec.values, !!spec.askName);
		this.fields = { ...this.start };
		this.startTitle = spec.titleName;
		this.titleName = spec.titleName;
	}

	override onOpen(): void {
		this.openFrame('dynasty-holder-form');
		const el = this.contentEl;
		const shell = buildShell({
			modalEl: this.modalEl,
			contentEl: el,
			title: this.spec.heading,
			titled: true,
			cancelLabel: cancelLabelFor('edit'),
			// O-14: Cancel asks the question that Esc asks when a typed change would be lost.
			discard: { dirty: () => this.dirty(), ask: () => this.close() },
			onCancel: () => this.finish(),
			onSave: () => void this.write(),
		});
		this.shell = shell;
		nameDialog(this.modalEl, shell.titleEl);
		const body = shell.body;
		this.contextEl = body.createDiv({ cls: ['dynasty-choice-text', 'dynasty-holder-context'], text: this.spec.context });
		if (this.titleName !== undefined) {
			this.titleInput = this.input(body, TITLES_UI.titleName, 'title-name', this.titleName, (v) => (this.titleName = v), { placeholder: TITLES_UI.namePlaceholder });
		}
		let ruler: HTMLInputElement | null = null;
		if (this.fields.name !== undefined) {
			this.nameInput = this.input(
				body,
				TITLES_UI.holderName,
				'holder-name',
				this.fields.name,
				(v) => {
					this.fields.name = v;
					// The empty ruler field shows the holder's name as its hint (§13.5, D131); typed text is never replaced.
					ruler?.setAttribute('placeholder', rulerHint(undefined, v));
				},
				{ placeholder: TITLES_UI.holderNamePlaceholder },
			);
		}
		const row = body.createDiv({ cls: 'dynasty-holder-form-row' });
		this.input(row, TITLES_UI.number, 'number', this.fields.number, (v) => (this.fields.number = v), { placeholder: TITLES_UI.numberPlaceholder });
		ruler = this.input(row, TITLES_UI.ruler, 'ruler', this.fields.ruler, (v) => (this.fields.ruler = v), {
			placeholder: rulerHint(this.spec.personName, this.fields.name),
			hint: TITLES_UI.rulerHint,
		});
		const dates = body.createDiv({ cls: 'dynasty-holder-form-row' });
		// Free text (fictional calendars): never a numeric keyboard (spec §7.4).
		this.input(dates, TITLES_UI.from, 'from', this.fields.from, (v) => (this.fields.from = v));
		this.input(dates, TITLES_UI.until, 'to', this.fields.to, (v) => (this.fields.to = v));
		this.tickBox(body);
		this.previewEl = body.createDiv({ cls: 'dynasty-holder-preview', attr: { 'aria-live': 'polite' } });
		this.updatePreview();
		if (this.spec.actions) this.actionRows(body, this.spec.actions);
		this.cleanup.push(startWithoutFocus(this.modalEl));
	}

	/** The tick box "Holds the title through the spouse" (D195): off with its hint when the holder is not a person in the tree. */
	private tickBox(body: HTMLElement): void {
		const inTree = this.spec.personName !== undefined;
		const field = body.createDiv({ cls: ['dynasty-sheet-field', 'dynasty-holder-tick'], attr: { 'data-field': 'through-spouse' } });
		const row = field.createEl('label', { cls: ['dynasty-sheet-check', 'dynasty-check'] });
		const box = row.createEl('input', { attr: { type: 'checkbox', 'data-focus': 'through-spouse' } });
		box.checked = inTree && this.fields.throughSpouse === true;
		box.disabled = !inTree;
		row.createSpan({ cls: 'dynasty-sheet-label', text: TITLES_UI.holderTickLabel });
		const hintId = uniqueId('dynasty-holder-tick-hint');
		// Under the box, always shown: a person who reads the label needs the meaning, and a name-only entry needs the reason.
		field.createDiv({ cls: ['dynasty-sheet-hint'], text: inTree ? TITLES_UI.holderTickHint : TITLES_UI.holderTickDisabled, attr: { id: hintId } });
		box.setAttribute('aria-describedby', hintId);
		box.addEventListener('change', () => {
			this.fields.throughSpouse = box.checked;
			this.clearErrors();
			this.updatePreview();
		});
	}

	private input(parent: HTMLElement, label: string, name: string, value: string, change: (v: string) => void, o: { placeholder?: string; hint?: string } = {}): HTMLInputElement {
		const { row, id } = sheetField(parent, label, name, 'dynasty-holder');
		// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
		const extra = { placeholder: o.placeholder ?? null };
		// D196 item 1: no capital and no correction in a name that the user types.
		const input = row.createEl('input', {
			cls: ['dynasty-sheet-input', 'dynasty-input'],
			attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: extra.placeholder },
		});
		if (o.hint) {
			const hintId = `${id}-hint`;
			row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: o.hint, attr: { id: hintId } });
			input.setAttribute('aria-describedby', hintId);
		}
		input.value = value;
		input.addEventListener('input', () => {
			change(input.value);
			this.clearErrors();
			this.updatePreview();
		});
		return input;
	}

	/** UX-21: "X shows as: X" says nothing new when the two are equal, so the line goes then. */
	private updatePreview(): void {
		const p = previewParts(this.spec.personName, this.fields, this.spec.values);
		this.previewEl?.setText(p.full ? (p.full === p.shown ? '' : TITLES_UI.preview(p.full, p.shown)) : p.shown);
		this.previewEl?.toggle(this.previewEl.getText() !== '');
	}

	/** Takes the errors of the two name fields and of the whole form away (CX-11). */
	private clearErrors(): void {
		if (this.titleInput) clearFieldError(this.titleInput);
		if (this.nameInput) clearFieldError(this.nameInput);
		this.shell?.clearWindowError();
	}

	/** O-18: Show the card, Move up, Move down and Remove, as rows at the end of the form. */
	private actionRows(body: HTMLElement, a: HolderFormActions): void {
		const rows = body.createDiv({ cls: ['dynasty-rows', 'dynasty-holder-actions'] });
		const row = (icon: string, label: string, focus: string, run: () => void, o: { danger?: boolean; off?: boolean; late?: boolean } = {}): void => {
			const r = buildRow(rows, {
				tap: () => this.act(run, o.late === true),
				cls: ['dynasty-action-row', `dynasty-holder-${focus}`, ...(o.danger ? ['is-danger', 'mod-warning'] : [])],
				attr: { 'data-focus': focus },
				chevron: false,
				lead: (parent) => iconLead(parent, icon),
			});
			r.title.setText(label);
			if (o.off) (r.row as HTMLButtonElement).disabled = true;
		};
		if (a.show) row('eye', TITLES_UI.showCardRow, 'show-card', a.show, { late: true });
		row('arrow-up', TITLES_UI.moveEarlier, 'move-up', () => a.move(-1), { off: !a.canMoveUp });
		row('arrow-down', TITLES_UI.moveLater, 'move-down', () => a.move(1), { off: !a.canMoveDown });
		row('trash-2', TITLES_UI.remove, 'remove', a.remove, { danger: true });
	}

	/** Runs a holder action. A typed change in the form would be lost with it, so the form asks first, as for Esc. */
	private act(run: () => void, late: boolean): void {
		const go = () => {
			// A change of the draft runs before the form closes, so the window draws the new draft. Showing the card runs after it: the window then closes or asks.
			if (!late) run();
			this.finish();
			if (late) run();
		};
		if (!this.dirty()) {
			go();
			return;
		}
		const box = confirmBox(this.modalEl, {
			title: SHEET.discardTitle,
			text: [this.discardText()],
			buttons: [
				{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: () => { box.layer.remove(); this.confirmEl = null; } },
				{ label: SHEET.discard, cls: ['mod-warning', 'dynasty-sheet-discard'], run: go },
			],
		});
		this.confirmEl = box.layer;
	}

	protected dirty(): boolean {
		const f = this.fields;
		const s = this.start;
		const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();
		return !(same(f.number, s.number) && same(f.ruler, s.ruler) && same(f.from, s.from) && same(f.to, s.to) && same(f.name, s.name) && same(this.titleName, this.startTitle) && f.throughSpouse === s.throughSpouse);
	}

	private async write(): Promise<void> {
		if (this.saving) return;
		if (this.titleName !== undefined && this.titleName.trim() === '') {
			if (this.titleInput) fieldError(this.titleInput, TITLES_UI.needTitleName);
			return;
		}
		if (this.fields.name !== undefined && this.fields.name.trim() === '') {
			if (this.nameInput) fieldError(this.nameInput, TITLES_UI.needHolderName);
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
			this.shell?.windowError(message, this.contextEl);
		} catch (e) {
			console.error('Crown and Kin: cannot save the holder', e);
		} finally {
			this.saving = false;
			this.modalEl.removeClass('is-saving');
		}
	}

	protected discardText(): string {
		return TITLES_UI.formDiscardText;
	}

	override onClose(): void {
		super.onClose();
		guarded('cannot return the focus', () => this.spec.closed?.());
	}
}

/** Opens the holder form; it calls `spec.save` on Save and stays open until a save succeeds or the user cancels. */
export function holderForm(app: App, spec: HolderFormSpec): void {
	new HolderFormModal(app, spec).open();
}
