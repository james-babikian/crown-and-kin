/*
 * The name lists of one owner in the Calendars window (spec §14 rule 16): a calendar, or the plain years. Each list is a group of fields: the name of the
 * list, the marker (not for the plain years), the names in order as text lines, the known year (a date and the name of that year,
 * with a line that reads them back), and the choice "Show on cards", then the link "Remove this list". "Add name list" stands after the last list. The fields write into the draft as the user types.
 */

import { MAX_LISTS } from '../core/dates';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import type { ListDraft } from '../view/calendar-list-draft';
import { field, selectField, SHOW_OPTIONS, type CardHost, type FieldError } from './calendar-parts';
import { textButton } from './window-parts';

/** What the list editor needs to know about its owner. */
interface ListsOwner {
	/** The draft key of the calendar, or `PLAIN_KEY`. */
	key: number;
	plain: boolean;
	lists: ListDraft[];
	/** The fields that this card shows next to their refusal. */
	shown: Set<string>;
}

/** The line under the known year: what the date and the name give, or why they give nothing. */
function knownLine(host: CardHost, o: ListsOwner, l: ListDraft): string {
	const info = host.checked().knowns.get(l.key);
	if (!info || (l.knownDate.trim() === '' && l.knownName.trim() === '')) return '';
	if (info.year === undefined) return l.knownDate.trim() === '' ? '' : o.plain ? T.knownDateBadPlain : T.knownDateBad;
	if (info.index < 0 || info.name === undefined) return l.knownName.trim() === '' ? '' : T.knownNameBad;
	return o.plain ? T.knownBackPlain(info.year, info.name, info.count) : T.knownBack(l.knownDate.trim(), info.year, info.name, info.count);
}

/** The known year: the date, "=", the name, and the grey line below. The help text shows while the cursor is in one of the fields. */
function knownPart(parent: HTMLElement, host: CardHost, o: ListsOwner, l: ListDraft, at: (f: string) => FieldError): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-start', attr: { 'data-known': String(l.key) } });
	const hintId = `dynasty-cal-known-hint-${l.key}`;
	const row = box.createDiv({ cls: ['dynasty-cal-start-row', 'is-known'] });
	field(row, host, `list-${l.key}-known`, T.knownLabel, l.knownDate, (v) => (l.knownDate = v), { describedBy: hintId });
	row.createDiv({ cls: 'dynasty-cal-equals', text: '=', attr: { 'aria-hidden': 'true' } });
	field(row, host, `list-${l.key}-knownname`, T.knownNameLabel, l.knownName, (v) => (l.knownName = v), { wide: true, error: at('known'), errorIn: box, describedBy: hintId });
	const back = box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-date-line', 'dynasty-cal-readback'], attr: { 'aria-live': 'polite', 'data-readback': `list-${l.key}` } });
	host.register(() => back.setText(knownLine(host, o, l)));
	box.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: T.knownHint, attr: { id: hintId } });
}

/** One name list. */
function listForm(parent: HTMLElement, host: CardHost, o: ListsOwner, l: ListDraft): void {
	const at = (f: string): FieldError => ({ key: o.key, field: `list:${l.key}:${f}`, shown: o.shown });
	const box = parent.createDiv({ cls: 'dynasty-cal-list', attr: { 'data-list': String(l.key) } });
	const top = box.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
	// The plain years have no marker, so the name takes the whole row.
	field(top, host, `list-${l.key}-name`, T.listName, l.name, (v) => (l.name = v), { error: at('name'), wide: o.plain, placeholder: T.listNamePlaceholder });
	if (!o.plain) field(top, host, `list-${l.key}-marker`, T.markerLabel, l.marker, (v) => (l.marker = v), { placeholder: T.markerPlaceholder, hint: T.markerHint, keepTogether: T.markerHintKeep, error: at('marker') });
	// The field is one text line higher than its names (a list of seven shows all seven and one free text line), and not lower than 3 text lines or higher than 10.
	const rows = Math.min(10, Math.max(3, l.names.split('\n').length + 1));
	field(box, host, `list-${l.key}-names`, T.namesLabel, l.names, (v) => (l.names = v), { area: true, rows, wide: true, placeholder: T.namesPlaceholder, hint: T.namesHint, error: at('names') });
	knownPart(box, host, o, l, at);
	const bottom = box.createDiv({ cls: ['dynasty-grid', 'is-stack'] });
	selectField(bottom, host, `list-${l.key}-show`, T.showLabel, l.show, SHOW_OPTIONS, (v) => (l.show = v as ListDraft['show']), T.showHint);
	// At the end of the list, under its last field, away from the fields that a finger taps (a tap on Marker once removed the list).
	const remove = textButton(box, ['dynasty-link', 'dynasty-cal-remove-list'], T.removeThisList, () => host.removeList(o.key, l.key), { label: T.removeList(l.name.trim()), focus: `cal:list-remove:${l.key}` });
	host.register(() => remove.setAttribute('aria-label', T.removeList(l.name.trim())));
}

/** The name lists of an owner and the link "Add name list". */
export function drawLists(parent: HTMLElement, host: CardHost, o: ListsOwner): void {
	parent.createDiv({ cls: 'dynasty-cal-subhead', text: T.listsLabel, attr: { role: 'heading', 'aria-level': '4' } });
	if (o.lists.length === 0) parent.createDiv({ cls: 'dynasty-sheet-none', text: T.noLists });
	for (const l of o.lists) listForm(parent, host, o, l);
	// Four lists are the most (spec §14 rule 14): the link stays away, so the window never offers what it would refuse.
	if (o.lists.length < MAX_LISTS) textButton(parent, ['dynasty-link', 'dynasty-cal-add-link', 'dynasty-cal-add-list'], T.addList, () => host.addList(o.key), { icon: 'plus', focus: `cal:add-list:${o.key}` });
}
