/*
 * The body of one calendar section of the Calendars window (spec §14 rules 1, 3, 6 and 16): the name, formats, length, start ("Same year as" entry
 * form), eras, name lists, the refusals and warnings that belong to the calendar, and "Remove this calendar". The window owns the draft (`view/calendar-draft.ts`); the
 * body changes the draft in place and tells the window (`changed`), which works the draft out again and calls the `update` functions that the body registered, so a
 * key press never rebuilds a field and never takes the focus away. A new structure (an added or removed calendar, era or list) is a new draw by the window.
 */

import type { Calendar } from '../core/dates';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { drawMark } from '../render/dom/marks';
import { PLAIN_KEY, startReadback, type CalendarDraft, type EraDraft, type ListDraft, type StartDraft } from '../view/calendar-draft';
import { drawLists } from './calendar-list';
import { field, type CardHost, type FieldError } from './calendar-parts';
import { textButton } from './window-parts';

/**
 * The "Start" part, in the order that the help text names the fields: the readback, then Cycle, Year, "=" and "Same year as" on one row, then the hint.
 * The refusals of the row stand under the hint, so a long refusal does not lift the other fields of the row.
 */
function startForm(parent: HTMLElement, host: CardHost, s: StartDraft, o: { name: string; cycles: boolean; result: string; calendar: () => Calendar | undefined; error: FieldError }): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-start', attr: { 'data-start': o.name } });
	box.createDiv({ cls: 'dynasty-cal-subhead', text: T.startLabel, attr: { role: 'heading', 'aria-level': '4' } });
	const back = box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-readback'], attr: { 'aria-live': 'polite', 'data-readback': o.name } });
	host.register(() => {
		back.empty();
		// A calendar that counts from year 1 beside other years gets the short warning in place of the help (D278); the long sentence stays in the problem list of the tree.
		const warn = host.checked().noAnchor.has(o.result);
		back.toggleClass('is-warning', warn);
		back.toggleClass('dynasty-marked', warn);
		if (warn) {
			drawMark(back, 'warning');
			back.createSpan({ text: T.startNoAnchor });
		} else back.setText(startReadback(host.checked().starts.get(o.result), o.calendar(), s.saved));
	});
	const hintId = `dynasty-cal-start-hint-${o.name}`;
	const row = box.createDiv({ cls: ['dynasty-cal-start-row', o.cycles ? 'has-cycle' : 'is-era'] });
	const described = { describedBy: hintId };
	if (o.cycles) field(row, host, `${o.name}-cycle`, T.cycleLabel, s.cycle, (v) => (s.cycle = v), { numeric: true, ...described });
	field(row, host, `${o.name}-year`, T.yearLabel, s.year, (v) => (s.year = v), { numeric: true, ...described });
	row.createDiv({ cls: 'dynasty-cal-equals', text: '=', attr: { 'aria-hidden': 'true' } });
	box.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: o.cycles ? T.exampleHintCycles : T.exampleHintEras, attr: { id: hintId } });
	field(row, host, `${o.name}-same`, T.sameAsLabel, s.same, (v) => (s.same = v), { placeholder: T.sameAsPlaceholder, wide: true, error: o.error, errorIn: box, ...described });
}

/** One era of an era calendar: its name, its start and its optional length. */
function eraRow(parent: HTMLElement, host: CardHost, d: CalendarDraft, e: EraDraft, i: number, shown: Set<string>): void {
	const at = (field: string): FieldError => ({ key: d.key, field: `era:${e.key}:${field}`, shown });
	const box = parent.createDiv({ cls: 'dynasty-cal-era', attr: { 'data-era': String(e.key) } });
	const remove = (line: HTMLElement) => {
		const button = textButton(line, ['dynasty-link', 'dynasty-cal-remove'], T.remove, () => host.removeEra(d.key, i), { label: T.removeEra(e.name), focus: `cal:era-remove:${e.key}` });
		// The label follows the name while the user types it.
		host.register(() => button.setAttribute('aria-label', T.removeEra(e.name)));
	};
	field(box, host, `era-${e.key}-name`, T.eraName, e.name, (v) => (e.name = v), { error: at('name'), labelEnd: remove });
	startForm(box, host, e.start, { name: `era-${e.key}`, cycles: false, result: `e${e.key}`, calendar: () => host.checked().byKey.get(d.key), error: at('start') });
	field(box, host, `era-${e.key}-length`, T.lengthOptional, e.length, (v) => (e.length = v), { numeric: true, half: true, hint: T.lengthHintEras, error: at('length') });
}

/** The refusals and warnings of one calendar (or of the plain years), in place under its fields. */
export function messages(parent: HTMLElement, host: CardHost, key: number, shown: ReadonlySet<string>): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-messages', attr: { 'aria-live': 'polite' } });
	host.register(() => {
		box.empty();
		const c = host.checked();
		// A refusal of a field that the card shows stands under that field; the others stand here.
		for (const r of c.refusals) if (r.key === key && !(r.field !== undefined && shown.has(r.field))) box.createDiv({ cls: 'dynasty-sheet-error', text: r.text, attr: { 'data-refusal': '' } });
		// A warning has the quiet note look of the Titles window (`is-warning`): the text colour at the small size.
		for (const w of c.warnings) if (w.key === key) box.createDiv({ cls: ['dynasty-sheet-hint', 'is-warning'], text: w.text, attr: { 'data-warning': '' } });
	});
}

/** The fields of a cycle calendar: the length and the start. */
function cycleFields(parent: HTMLElement, host: CardHost, d: CalendarDraft, calendar: () => Calendar | undefined, shown: Set<string>): void {
	field(parent, host, `${d.key}-length`, T.lengthLabel, d.length, (v) => (d.length = v), { numeric: true, half: true, hint: T.lengthHintCycles, error: { key: d.key, field: 'length', shown } });
	startForm(parent, host, d.start, { name: `${d.key}`, cycles: true, result: `c${d.key}`, calendar, error: { key: d.key, field: 'start', shown } });
}

/** The eras of an era calendar, and the link that adds one after the last. */
function eraFields(parent: HTMLElement, host: CardHost, d: CalendarDraft, shown: Set<string>): void {
	parent.createDiv({ cls: 'dynasty-cal-subhead', text: T.erasLabel, attr: { role: 'heading', 'aria-level': '4' } });
	d.eras.forEach((e, i) => eraRow(parent, host, d, e, i, shown));
	textButton(parent, ['dynasty-link', 'dynasty-cal-add-link', 'dynasty-cal-add-era'], T.addEra, () => host.addEra(d.key), { icon: 'plus', focus: `cal:add-era:${d.key}` });
}

/**
 * Draws the fields of one calendar into the body of its section, in this order (spec §14 rule 16): Name, Formats, Length (cycles), Start (cycles) or Eras (eras),
 * Name lists, the messages of the calendar, and "Remove this calendar" as a quiet link at the end. A calendar that the draft added shows its help texts at once.
 */
export function drawCalendarBody(body: HTMLElement, host: CardHost, d: CalendarDraft): void {
	if (d.at === null) body.addClass('is-new');
	body.setAttribute('role', 'group');
	const bodyLabel = () => d.name.trim() || (d.kind === 'cycles' ? T.kindCycles : T.kindEras);
	body.setAttribute('aria-label', bodyLabel());
	body.setAttribute('data-calendar', String(d.key));
	const cycles = d.kind === 'cycles';
	const shown = new Set<string>();
	const grid = body.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
	field(grid, host, `${d.key}-name`, T.nameLabel, d.name, (v) => (d.name = v), { wide: true, error: { key: d.key, field: 'name', shown }, placeholder: cycles ? T.namePlaceholderCycles : T.namePlaceholderEras });
	field(grid, host, `${d.key}-formats`, T.formatsLabel, d.formats, (v) => (d.formats = v), {
		area: true,
		wide: true,
		error: { key: d.key, field: 'formats', shown },
		placeholder: cycles ? T.formatsPlaceholderCycles : T.formatsPlaceholderEras,
		hint: cycles ? T.formatsHintCycles : T.formatsHintEras,
	});
	// The calendar as worked out, for the example that the start shows back.
	const calendar = () => host.checked().byKey.get(d.key);
	if (cycles) cycleFields(body, host, d, calendar, shown);
	else eraFields(body, host, d, shown);
	drawLists(body, host, { key: d.key, plain: false, lists: d.lists, shown });
	messages(body, host, d.key, shown);
	const removeCal = textButton(body, ['dynasty-link', 'dynasty-cal-remove-cal'], T.removeThisCalendar, () => host.removeCalendar(d.key), { label: T.removeCalendar(d.name.trim()), focus: `cal:remove:${d.key}` });
	const noteId = `dynasty-cal-${d.key}-remove-note`;
	body.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-remove-note'], text: T.removeNote, attr: { id: noteId } });
	removeCal.setAttribute('aria-describedby', noteId);
	// The names for a screen reader follow the name while the user types it.
	host.register(() => {
		body.setAttribute('aria-label', bodyLabel());
		removeCal.setAttribute('aria-label', T.removeCalendar(d.name.trim()));
	});
}

/** The body of the section "Plain years" (spec §14 rule 16): the hint, the name lists, and the messages of the plain years. */
export function drawPlainBody(body: HTMLElement, host: CardHost, lists: ListDraft[]): void {
	body.setAttribute('data-calendar', 'plain');
	body.createDiv({ cls: 'dynasty-sheet-hint', text: T.plainHint });
	const shown = new Set<string>();
	drawLists(body, host, { key: PLAIN_KEY, plain: true, lists, shown });
	messages(body, host, PLAIN_KEY, shown);
}
