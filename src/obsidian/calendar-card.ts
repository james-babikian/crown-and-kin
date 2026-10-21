/*
 * One calendar of the Calendars window (spec §14 rules 1, 3 and 6): the card with its name, formats, length, start ("Same year as" entry form), eras, the
 * refusals and warnings that belong to it, and its test line. The window owns the draft (`view/calendar-draft.ts`); the card changes the draft in place and tells the
 * window (`changed`), which works the draft out again and calls the `update` functions that the card registered, so a key press never rebuilds a field and never
 * takes the focus away. A new structure (an added or removed calendar or era) is a new draw by the window.
 */

import type { Calendar, DateReader } from '../core/dates';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { startReadback, type CalendarDraft, type Checked, type EraDraft, type StartDraft } from '../view/calendar-draft';
import { testField } from './calendar-parts';
import { sheetField, endEntryOnEnter } from './sheet-parts';
import { textButton } from './window-parts';

/** What a card needs of its window. */
export interface CardHost {
	/** The draft as worked out now. */
	checked(): Checked;
	/** A field of the draft changed: the window works the draft out again and calls every `update`. */
	changed(): void;
	/** A calendar or era was added or removed: the window draws the cards again; `focus` names the control that gets the focus. */
	redraw(focus?: string): void;
	/** A function that writes the dynamic parts of the card (readbacks, messages, the test line) again. */
	register(update: () => void): void;
	/** The reader of the whole set, for the test line. */
	reader(): DateReader;
	removeCalendar(key: number): void;
	addEra(key: number): void;
	removeEra(key: number, era: number): void;
}

/** Where the refusals of one field show: the calendar they belong to, the name of the field (`Checked.refusals`) and the fields that this card shows next to their refusal. */
interface FieldError {
	key: number;
	field: string;
	shown: Set<string>;
}

interface FieldOptions {
	/** The refusals of this field show right under it, and the control is marked invalid. */
	error?: FieldError;
	placeholder?: string;
	hint?: string;
	area?: boolean;
	numeric?: boolean;
	wide?: boolean;
	/** The refusals stand in this box (a row of fields shows them under the whole row), not under the field. */
	errorIn?: HTMLElement;
	/** Fills the line of the label, at the right of it (the Remove link of an era). */
	labelEnd?: (line: HTMLElement) => void;
	/** An `aria-describedby` id of a hint that stands outside the field (the hint under the row of the start). */
	describedBy?: string;
}

/** The refusals of one field, in red under it (as the ID window does); the control gets `aria-invalid` while there is one. */
function fieldErrors(row: HTMLElement, input: HTMLElement, host: CardHost, e: FieldError): void {
	e.shown.add(e.field);
	const id = `${input.id}-error`;
	const box = row.createDiv({ cls: ['dynasty-sheet-error', 'dynasty-cal-field-error'], attr: { id, 'aria-live': 'polite' } });
	host.register(() => {
		box.empty();
		const mine = host.checked().refusals.filter((r) => r.key === e.key && r.field === e.field);
		for (const r of mine) box.createDiv({ text: r.text, attr: { 'data-refusal': '' } });
		box.toggle(mine.length > 0);
		if (mine.length) input.setAttribute('aria-invalid', 'true');
		else input.removeAttribute('aria-invalid');
		const described = (input.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== id);
		input.setAttribute('aria-describedby', [...described, ...(mine.length ? [id] : [])].join(' '));
	});
}

/** One labelled text field that writes into the draft as the user types. */
function field(parent: HTMLElement, host: CardHost, name: string, label: string, value: string, set: (v: string) => void, o: FieldOptions = {}): HTMLInputElement | HTMLTextAreaElement {
	const { row, id } = sheetField(parent, label, name, 'dynasty-cal');
	if (o.wide) row.addClass('is-wide');
	const labelEl = row.querySelector('label');
	if (o.labelEnd && labelEl) {
		const line = row.createDiv({ cls: 'dynasty-cal-labelrow' });
		row.insertBefore(line, labelEl);
		line.appendChild(labelEl);
		o.labelEnd(line);
	}
	// Plain attribute names (no spread), so the colour rule of eslint.config.mjs can check them; null writes no attribute.
	const extra = { placeholder: o.placeholder ?? null, inputmode: o.numeric ? 'numeric' : null };
	const input = o.area
		? row.createEl('textarea', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, rows: 2, spellcheck: 'false', autocapitalize: 'off', placeholder: extra.placeholder, 'data-focus': `cal:${name}` } })
		: row.createEl('input', { cls: ['dynasty-sheet-input', 'dynasty-input'], attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', inputmode: extra.inputmode, placeholder: extra.placeholder, 'data-focus': `cal:${name}` } });
	input.value = value;
	if (o.hint) {
		const hintId = `${id}-hint`;
		row.createDiv({ cls: 'dynasty-sheet-hint', text: o.hint, attr: { id: hintId } });
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

/**
 * The "Start" part, in the order that the help text names the fields: the readback, then Cycle, Year, "=" and "Same year as" on one row, then the hint.
 * The refusals of the row stand under the hint, so a long refusal does not lift the other fields of the row.
 */
function startForm(parent: HTMLElement, host: CardHost, s: StartDraft, o: { name: string; cycles: boolean; result: string; calendar: () => Calendar | undefined; error: FieldError }): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-start', attr: { 'data-start': o.name } });
	box.createDiv({ cls: 'dynasty-cal-subhead', text: T.startLabel, attr: { role: 'heading', 'aria-level': '4' } });
	const back = box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-readback'], attr: { 'aria-live': 'polite', 'data-readback': o.name } });
	host.register(() => back.setText(startReadback(host.checked().starts.get(o.result), o.calendar(), s.saved)));
	const hintId = `dynasty-cal-start-hint-${o.name}`;
	const row = box.createDiv({ cls: ['dynasty-cal-start-row', o.cycles ? 'has-cycle' : 'is-era'] });
	const described = { describedBy: hintId };
	if (o.cycles) field(row, host, `${o.name}-cycle`, T.cycleLabel, s.cycle, (v) => (s.cycle = v), { numeric: true, ...described });
	field(row, host, `${o.name}-year`, T.yearLabel, s.year, (v) => (s.year = v), { numeric: true, ...described });
	row.createDiv({ cls: 'dynasty-cal-equals', text: '=', attr: { 'aria-hidden': 'true' } });
	box.createDiv({ cls: 'dynasty-sheet-hint', text: o.cycles ? T.exampleHintCycles : T.exampleHintEras, attr: { id: hintId } });
	field(row, host, `${o.name}-same`, T.sameAsLabel, s.same, (v) => (s.same = v), { placeholder: T.sameAsPlaceholder, wide: true, error: o.error, errorIn: box, ...described });
}

/** One era of an era calendar: its name, its start and its optional length. */
function eraRow(parent: HTMLElement, host: CardHost, d: CalendarDraft, e: EraDraft, i: number, shown: Set<string>): void {
	const at = (field: string): FieldError => ({ key: d.key, field: `era:${e.key}:${field}`, shown });
	const box = parent.createDiv({ cls: 'dynasty-cal-era', attr: { 'data-era': String(e.key) } });
	const remove = (line: HTMLElement) => textButton(line, ['dynasty-link', 'dynasty-cal-remove'], T.remove, () => host.removeEra(d.key, i), { label: T.removeEra(e.name), focus: `cal:era-remove:${e.key}` });
	field(box, host, `era-${e.key}-name`, T.eraName, e.name, (v) => (e.name = v), { error: at('name'), labelEnd: remove });
	startForm(box, host, e.start, { name: `era-${e.key}`, cycles: false, result: `e${e.key}`, calendar: () => host.checked().byKey.get(d.key), error: at('start') });
	field(box, host, `era-${e.key}-length`, T.lengthOptional, e.length, (v) => (e.length = v), { numeric: true, hint: T.lengthHintEras, error: at('length') });
}

/** The refusals and warnings of one calendar, in place under its fields. */
function messages(parent: HTMLElement, host: CardHost, d: CalendarDraft, shown: ReadonlySet<string>): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-messages', attr: { 'aria-live': 'polite' } });
	host.register(() => {
		box.empty();
		const c = host.checked();
		// A refusal of a field that the card shows stands under that field; the others stand here.
		for (const r of c.refusals) if (r.key === d.key && !(r.field !== undefined && shown.has(r.field))) box.createDiv({ cls: 'dynasty-sheet-error', text: r.text, attr: { 'data-refusal': '' } });
		// A warning has the quiet note look of the Titles window (`is-warning`): the text colour at the small size.
		for (const w of c.warnings) if (w.key === d.key) box.createDiv({ cls: ['dynasty-sheet-hint', 'is-warning'], text: w.text, attr: { 'data-warning': '' } });
	});
}

/** The fields of a cycle calendar: the length and the start. */
function cycleFields(parent: HTMLElement, host: CardHost, d: CalendarDraft, calendar: () => Calendar | undefined, shown: Set<string>): void {
	field(parent, host, `${d.key}-length`, T.lengthLabel, d.length, (v) => (d.length = v), { numeric: true, hint: T.lengthHintCycles, error: { key: d.key, field: 'length', shown } });
	startForm(parent, host, d.start, { name: `${d.key}`, cycles: true, result: `c${d.key}`, calendar, error: { key: d.key, field: 'start', shown } });
}

/** The eras of an era calendar, and the button that adds one. */
function eraFields(parent: HTMLElement, host: CardHost, d: CalendarDraft, shown: Set<string>): void {
	parent.createDiv({ cls: 'dynasty-cal-subhead', text: T.erasLabel, attr: { role: 'heading', 'aria-level': '4' } });
	d.eras.forEach((e, i) => eraRow(parent, host, d, e, i, shown));
	textButton(parent, ['dynasty-btn', 'dynasty-cal-add-era'], T.addEra, () => host.addEra(d.key), { icon: 'plus', focus: `cal:add-era:${d.key}` });
}

/** Draws one calendar of the draft into `parent`. */
export function drawCalendar(parent: HTMLElement, host: CardHost, d: CalendarDraft): void {
	const card = parent.createDiv({ cls: 'dynasty-cal-card', attr: { 'data-calendar': String(d.key), role: 'group', 'aria-label': d.name || (d.kind === 'cycles' ? T.kindCycles : T.kindEras) } });
	const head = card.createDiv({ cls: 'dynasty-cal-head' });
	head.createEl('b', { cls: 'dynasty-cal-kind', text: d.kind === 'cycles' ? T.kindCycles : T.kindEras });
	textButton(head, ['dynasty-link', 'dynasty-cal-remove'], T.remove, () => host.removeCalendar(d.key), { label: T.removeCalendar(d.name), focus: `cal:remove:${d.key}` });
	const grid = card.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
	const cycles = d.kind === 'cycles';
	const shown = new Set<string>();
	field(grid, host, `${d.key}-name`, T.nameLabel, d.name, (v) => (d.name = v), { wide: true, error: { key: d.key, field: 'name', shown } });
	field(grid, host, `${d.key}-formats`, T.formatsLabel, d.formats, (v) => (d.formats = v), {
		area: true,
		wide: true,
		error: { key: d.key, field: 'formats', shown },
		placeholder: cycles ? T.formatsPlaceholderCycles : T.formatsPlaceholderEras,
		hint: cycles ? T.formatsHintCycles : T.formatsHintEras,
	});
	// The calendar as worked out, for the example that the start shows back.
	const calendar = () => host.checked().byKey.get(d.key);
	if (cycles) cycleFields(card, host, d, calendar, shown);
	else eraFields(card, host, d, shown);
	messages(card, host, d, shown);
	const test = testField(card, String(d.key), () => host.reader());
	host.register(test.update);
}
