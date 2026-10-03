/*
 * The parts of the Id change that both the Houses window and the Titles window draw (spec §13.17
 * rule 5, D109, D110): the small button "Change id" and the grey note "New id: …" with its button
 * "Keep old id" on a row of the list, and the Id field (a labelled text field, the button "Make id
 * from the name" and the line that says why the draft id is refused) inside the small Id window
 * (`id-window.ts`). The draft logic is in `id-draft.ts`.
 */

import { ID_UI } from '../render/ui-text';

/** What a window gives the Id field of the small window. */
export interface IdFieldOptions {
	/** The row's key: it makes the `data-focus` names `id:<key>` and `make-id:<key>`. */
	key: string;
	/** The name of the house or title, for the accessible names. */
	item: string;
	value: string;
	/** The reason the draft is refused now, or an empty text. */
	problem: string;
	onInput: (value: string) => void;
	onMake: () => void;
	/** Enter in the field. */
	onEnter?: () => void;
}

/** What a window changes in a field that is on screen, without drawing the window again. */
export interface IdFieldView {
	input: HTMLInputElement;
	setItem: (item: string) => void;
	setValue: (value: string) => void;
	setProblem: (text: string) => void;
}

/** Adds the Id row to `parent` and returns the handles that keep it up to date. */
export function idField(parent: HTMLElement, o: IdFieldOptions): IdFieldView {
	const row = parent.createDiv({ cls: 'dynasty-id-row', attr: { 'data-id-row': o.key } });
	const field = row.createEl('label', { cls: 'dynasty-id-field' });
	field.createSpan({ cls: 'dynasty-sheet-label', text: ID_UI.label });
	const problemId = `dynasty-id-problem-${o.key}-${Math.random().toString(36).slice(2, 8)}`;
	const input = field.createEl('input', {
		cls: ['dynasty-sheet-input', 'dynasty-id-input'],
		attr: { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': ID_UI.aria(o.item), 'aria-describedby': problemId, 'data-focus': `id:${o.key}` },
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
		cls: ['dynasty-sheet-action', 'dynasty-id-make'],
		text: ID_UI.make,
		attr: { type: 'button', 'aria-label': ID_UI.makeAria(o.item), 'data-focus': `make-id:${o.key}` },
	});
	make.addEventListener('click', () => o.onMake());
	const problem = row.createDiv({ cls: 'dynasty-id-problem', attr: { id: problemId, 'aria-live': 'polite' } });
	const show = (text: string) => {
		problem.setText(text);
		problem.toggle(text !== '');
		if (text === '') input.removeAttribute('aria-invalid');
		else input.setAttribute('aria-invalid', 'true');
	};
	show(o.problem);
	return {
		input,
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

/** What a window changes on the Id parts of a list row that is on screen. */
export interface IdRowView {
	setItem: (item: string) => void;
	setProblem: (text: string) => void;
}

/** The small button "Change id" of a saved row: it opens the small Id window. At least 44 px high (CSS). */
export function idOpenButton(parent: HTMLElement, o: { key: string; item: string; onOpen: () => void }): IdRowView {
	const b = parent.createEl('button', {
		cls: ['dynasty-sheet-action', 'dynasty-id-open'],
		text: ID_UI.open,
		attr: { type: 'button', 'aria-label': ID_UI.openAria(o.item), 'data-focus': `id-open:${o.key}` },
	});
	b.addEventListener('click', () => o.onOpen());
	return {
		setItem: (item) => b.setAttribute('aria-label', ID_UI.openAria(item)),
		setProblem: () => undefined,
	};
}

/**
 * The note of a row whose id waits for Save: "New id: …" and the button "Keep old id". `problem` is the
 * reason the draft is refused now (a draft can be refused after it was accepted, when another row
 * or a new row's name changes); it shows in red in the same line.
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
	};
	show(o.problem);
	return {
		setItem: (item) => keep.setAttribute('aria-label', ID_UI.keepOldAria(item)),
		setProblem: show,
	};
}
