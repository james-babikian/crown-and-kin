/*
 * Small DOM parts that the Calendars window and the `kin-calendar` block share (spec §14 rule 6): the test line, a field where the user writes a date and sees
 * how the plugin reads it with the calendars as they are now. The Calendars window also builds its calendar sections from the parts here: a labelled text
 * field that writes into the draft as the user types, a choice field, and the help text that shows only while the cursor is in its field (spec §14 rule 16).
 * Built with `createEl` and `setText` only; the colours come from the style sheet.
 */

import { setIcon } from 'obsidian';
import type { DateReader } from '../core/dates';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { paintDateLine } from '../render/dom/date-line';
import { testParts, type Checked } from '../view/calendar-draft';
import { endEntryOnEnter, sheetField } from './sheet-parts';

/** What a card needs of its window. */
export interface CardHost {
	/** The draft as worked out now. */
	checked(): Checked;
	/** A field of the draft changed: the window works the draft out again and calls every `update`. */
	changed(): void;
	/** A function that writes the dynamic parts of the card (readbacks, messages, the test line) again. */
	register(update: () => void): void;
	/** The reader of the whole set, for the test line. */
	reader(): DateReader;
	/** True after the user pressed Save once with a refusal: from then on an empty field shows its refusal (before, a new calendar would start with red text). */
	attempted(): boolean;
	removeCalendar(key: number): void;
	addEra(key: number): void;
	removeEra(key: number, era: number): void;
	/** `key` is the draft key of the calendar, or `PLAIN_KEY` for the plain years. */
	addList(key: number): void;
	removeList(key: number, list: number): void;
}

/** Where the refusals of one field show: the calendar they belong to, the name of the field (`Checked.refusals`) and the fields that this card shows next to their refusal. */
export interface FieldError {
	key: number;
	field: string;
	shown: Set<string>;
}

/** What `field` can add to the plain labelled control. */
export interface FieldOptions {
	/** The refusals of this field show right under it, and the control is marked invalid. */
	error?: FieldError;
	placeholder?: string;
	hint?: string;
	area?: boolean;
	rows?: number;
	numeric?: boolean;
	wide?: boolean;
	/** The control takes half the width of the row (a number of two or three digits); its help and refusals keep the whole width. */
	half?: boolean;
	/** The refusals stand in this box (a row of fields shows them under the whole row), not under the field. */
	errorIn?: HTMLElement;
	/** Fills the line of the label, at the right of it (the Remove link of an era or a name list). */
	labelEnd?: (line: HTMLElement) => void;
	/** An `aria-describedby` id of a hint that stands outside the field (the hint under the row of the start). */
	describedBy?: string;
}

/** The refusals of one field, in red under it (as the ID window does); the control gets `aria-invalid` while there is one. */
export function fieldErrors(row: HTMLElement, input: HTMLElement, host: CardHost, e: FieldError): void {
	e.shown.add(e.field);
	const id = `${input.id}-error`;
	const box = row.createDiv({ cls: ['dynasty-sheet-error', 'dynasty-cal-field-error'], attr: { id, 'aria-live': 'polite' } });
	host.register(() => {
		box.empty();
		// A field that is still empty shows no refusal before the first Save: a calendar or a list that was just added starts with no red text.
		const quiet = !host.attempted() && (input as HTMLInputElement).value.trim() === '';
		const mine = quiet ? [] : host.checked().refusals.filter((r) => r.key === e.key && r.field === e.field);
		for (const r of mine) box.createDiv({ text: r.text, attr: { 'data-refusal': '' } });
		box.toggle(mine.length > 0);
		if (mine.length) input.setAttribute('aria-invalid', 'true');
		else input.removeAttribute('aria-invalid');
		const described = (input.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== id);
		input.setAttribute('aria-describedby', [...described, ...(mine.length ? [id] : [])].join(' '));
	});
}

/** The row of a field, with its label (and the link at the right end of the label, when `labelEnd` is given) and its hint. */
function fieldRow(parent: HTMLElement, name: string, label: string, o: FieldOptions): { row: HTMLElement; id: string } {
	const { row, id } = sheetField(parent, label, name, 'dynasty-cal');
	if (o.wide) row.addClass('is-wide');
	if (o.half) row.addClass('is-half');
	const labelEl = row.querySelector('label');
	if (o.labelEnd && labelEl) {
		const line = row.createDiv({ cls: 'dynasty-cal-labelrow' });
		row.insertBefore(line, labelEl);
		line.appendChild(labelEl);
		o.labelEnd(line);
	}
	return { row, id };
}

/** One labelled text field that writes into the draft as the user types. */
export function field(parent: HTMLElement, host: CardHost, name: string, label: string, value: string, set: (v: string) => void, o: FieldOptions = {}): HTMLInputElement | HTMLTextAreaElement {
	const { row, id } = fieldRow(parent, name, label, o);
	// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
	const extra = { placeholder: o.placeholder ?? null, inputmode: o.numeric ? 'numeric' : null };
	const input = o.area
		? row.createEl('textarea', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, rows: o.rows ?? 2, spellcheck: 'false', autocapitalize: 'off', placeholder: extra.placeholder, 'data-focus': `cal:${name}` } })
		: row.createEl('input', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', inputmode: extra.inputmode, placeholder: extra.placeholder, 'data-focus': `cal:${name}` } });
	input.value = value;
	if (o.hint) {
		const hintId = `${id}-hint`;
		// The help shows while the cursor is in the field (`is-on-focus`, styles/10 and 37), and a screen reader reads it with the field.
		row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: o.hint, attr: { id: hintId } });
		input.setAttribute('aria-describedby', hintId);
	}
	if (o.describedBy) input.setAttribute('aria-describedby', o.describedBy);
	if (o.error) fieldErrors(o.errorIn ?? row, input, host, o.error);
	if (!o.area) endEntryOnEnter(input as HTMLInputElement);
	input.addEventListener('input', () => {
		set(input.value);
		host.changed();
	});
	return input;
}

/** A labelled choice field: `options` are the values and their labels. */
export function selectField(parent: HTMLElement, host: CardHost, name: string, label: string, value: string, options: readonly { value: string; label: string }[], set: (v: string) => void, hint?: string): HTMLSelectElement {
	const { row, id } = fieldRow(parent, name, label, {});
	const wrap = row.createDiv({ cls: 'dynasty-select' });
	const select = wrap.createEl('select', { cls: ['dropdown', 'dynasty-sheet-input', 'dynasty-input'], attr: { id, 'data-focus': `cal:${name}` } });
	setIcon(wrap.createSpan({ cls: 'dynasty-select-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
	for (const o of options) select.createEl('option', { text: o.label, attr: { value: o.value } });
	select.value = value;
	if (hint) {
		const hintId = `${id}-hint`;
		row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: hint, attr: { id: hintId } });
		select.setAttribute('aria-describedby', hintId);
	}
	select.addEventListener('change', () => {
		set(select.value);
		host.changed();
	});
	return select;
}

/** The labels of the choice "Show on cards". */
export const SHOW_OPTIONS = [
	{ value: 'short', label: T.showShort },
	{ value: 'full', label: T.showFull },
	{ value: 'none', label: T.showNone },
] as const;

/** What `testField` gives back: the function that reads the field again (the calendars changed) and the input. */
export interface TestField {
	input: HTMLInputElement;
	/** Writes the line again from the field, with the reader that `reader()` gives now. */
	update: () => void;
}

/**
 * The field "Test a date" and the grey line under it. The line follows the text while the user types (the window is a place to try a format, so it does not
 * wait for the focus to leave); `reader` is asked at each change, because the draft of the window changes the calendars.
 */
export function testField(parent: HTMLElement, name: string, reader: () => DateReader): TestField {
	const { row, id } = sheetField(parent, T.testLabel, `test-${name}`, 'dynasty-cal');
	row.addClass('dynasty-cal-test');
	const input = row.createEl('input', {
		cls: ['dynasty-sheet-input', 'dynasty-input'],
		attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: T.testPlaceholder, 'data-focus': `test:${name}` },
	});
	const line = row.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-date-line'], attr: { id: `${id}-readout`, 'aria-live': 'polite', 'data-readout': '' } });
	// The second sentence of the old label is a help that shows while the cursor is in the field (D278).
	row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: T.testHint, attr: { id: `${id}-hint` } });
	input.setAttribute('aria-describedby', `${id}-readout ${id}-hint`);
	const update = (): void => {
		try {
			paintDateLine(line, testParts(reader(), input.value));
		} catch (e) {
			console.error('Crown and Kin: cannot read the test date', e);
			line.empty();
		}
	};
	input.addEventListener('input', update);
	return { input, update };
}
