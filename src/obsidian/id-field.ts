/*
 * The parts of the ID change that both the Houses window and the Titles window draw (spec §13.17
 * rule 5, D109, D110, D113): the note "New ID: …" with its button "Keep old ID" on a row of the
 * list, and the ID field (a label above a text field, the line that says why the draft ID is refused, the link "Make ID from the name"
 * and the help) inside the small ID window (`id-window.ts`). The button
 * "Change ID" is part of the window page (`list-window.ts`). The draft logic is in `id-draft.ts`.
 */

import { ID_UI } from '../render/ui-text';
import { clearFieldError, fieldError, sheetField } from './sheet-parts';

/** What a window gives the ID field of the small window. */
interface IdFieldOptions {
	/** The row's key: it makes the `data-focus` names `id:<key>` and `make-id:<key>`. */
	key: string;
	/** The name of the house or title, for the accessible names. */
	item: string;
	value: string;
	/** The visible label above the field; the text of `ID_UI.label` when it is not set. The accessible name of the field stays `ID_UI.aria(item)`. */
	label?: string;
	/** The reason the draft is refused now, or an empty text. */
	problem: string;
	/** The help text: it stands under the link "Make ID from the name". */
	hint?: string;
	onInput: (value: string) => void;
	onMake: () => void;
	/** Enter in the field. */
	onEnter?: () => void;
}

/** What a window changes in a field that is on screen, without drawing the window again. */
interface IdFieldView {
	input: HTMLInputElement;
	/** The visible label above the field. */
	labelEl: HTMLElement;
	setItem: (item: string) => void;
	setValue: (value: string) => void;
	setProblem: (text: string) => void;
}

/** Adds the ID row to `parent` and returns the handles that keep it up to date. */
export function idField(parent: HTMLElement, o: IdFieldOptions): IdFieldView {
	const row = parent.createDiv({ cls: 'dynasty-id-row', attr: { 'data-id-row': o.key } });
	// D330 O-11: the label stands above a normal field, as in every window. Under the field: the error (when there is one), the link, the help.
	const { row: field, id: inputId } = sheetField(row, o.label ?? ID_UI.label, 'id', 'dynasty-id');
	field.addClass('dynasty-id-field');
	const hintId = `${inputId}-hint`;
	const input = field.createEl('input', {
		cls: ['dynasty-sheet-input', 'dynasty-id-input'],
		attr: { id: inputId, type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': ID_UI.aria(o.item), 'aria-describedby': o.hint ? hintId : null, 'data-focus': `id:${o.key}` },
	});
	input.value = o.value;
	input.addEventListener('input', () => o.onInput(input.value));
	input.addEventListener('keydown', (e) => {
		// A repeat is the key still held down from the press that opened the window; it must not use the id.
		if (e.key !== 'Enter' || e.isComposing || e.repeat) return;
		e.preventDefault();
		o.onEnter?.();
	});
	const make = row.createEl('button', {
		cls: ['dynasty-link', 'dynasty-id-make'],
		text: ID_UI.make,
		attr: { type: 'button', 'aria-label': ID_UI.makeAria(o.item), 'data-focus': `make-id:${o.key}` },
	});
	make.addEventListener('click', () => o.onMake());
	if (o.hint) row.createDiv({ cls: 'dynasty-sheet-hint', text: o.hint, attr: { id: hintId } });
	// The reason that the id is refused stands right under the field with the error edge; the field keeps the focus (it is typing).
	const show = (text: string) => {
		if (text === '') clearFieldError(input);
		else fieldError(input, text, { focus: false }).addClass('dynasty-id-problem');
	};
	show(o.problem);
	return {
		input,
		labelEl: field.querySelector<HTMLElement>('.dynasty-sheet-label')!,
		setItem: (item) => {
			input.setAttribute('aria-label', ID_UI.aria(item));
			make.setAttribute('aria-label', ID_UI.makeAria(item));
		},
		setValue: (value) => {
			input.value = value;
		},
		setProblem: show,
	};
}

/** What a window changes on the ID parts of a list row that is on screen. */
export interface IdRowView {
	setItem: (item: string) => void;
	setProblem: (text: string) => void;
}

/**
 * The note of a row whose ID waits for Save: "New ID: …" and the button "Keep old ID". `problem` is the
 * reason the draft is refused now (a draft can be refused after it was accepted, when another row
 * or a new row's name changes). It shows once, in red in the same line, and the row gets a red edge
 * (D113 item 3); a refused Save shows no other message for it.
 */
export function idNote(parent: HTMLElement, o: { key: string; item: string; id: string; problem: string; onKeepOld: () => void }): IdRowView {
	const note = parent.createDiv({ cls: 'dynasty-id-new', attr: { 'data-id-new': o.key } });
	note.createSpan({ cls: 'dynasty-id-new-text', text: ID_UI.newId(o.id) });
	const keep = note.createEl('button', {
		cls: ['dynasty-sheet-action', 'dynasty-id-old'],
		text: ID_UI.keepOld,
		attr: { type: 'button', 'aria-label': ID_UI.keepOldAria(o.item), 'data-focus': `id-old:${o.key}` },
	});
	keep.addEventListener('click', () => o.onKeepOld());
	// After the button, so the reason has its own line under the note and the button.
	const problem = note.createSpan({ cls: 'dynasty-id-new-problem', attr: { role: 'status' } });
	const show = (reason: string) => {
		problem.setText(reason);
		problem.toggle(reason !== '');
		parent.toggleClass('has-id-problem', reason !== '');
	};
	show(o.problem);
	return {
		setItem: (item) => keep.setAttribute('aria-label', ID_UI.keepOldAria(item)),
		setProblem: show,
	};
}

/**
 * The note of a new row (not saved yet) whose name gives an ID that a changed row has taken (owner
 * decision "3-both"). It is the same note as the one of the changed row, without "New ID" and the button:
 * the reason in red text in the same place, and the same red edge on the row. It is empty and hidden
 * until a reason comes, because the name can change while the user types.
 */
export function idNewNameNote(parent: HTMLElement, o: { key: string; problem: string }): IdRowView {
	const note = parent.createDiv({ cls: 'dynasty-id-new', attr: { 'data-id-new-name': o.key } });
	const problem = note.createSpan({ cls: 'dynasty-id-new-problem', attr: { role: 'status' } });
	const show = (reason: string) => {
		problem.setText(reason);
		note.toggle(reason !== '');
		parent.toggleClass('has-id-problem', reason !== '');
	};
	show(o.problem);
	return {
		setItem: () => undefined,
		setProblem: show,
	};
}
