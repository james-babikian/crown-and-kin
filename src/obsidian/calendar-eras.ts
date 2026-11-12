/*
 * The eras of an era calendar in the Calendars window (D342): one text field "Eras", one era on each text line ("Reign of Aldric, 1100", or "Reign of Aldric,
 * 1100 to 1139"), the refusals of its text lines under it, a help text that always shows (so nothing moves when the focus leaves the field), and a quiet reading
 * list: one text line for each era, "Reign of Aldric 1 = year 1100" and at the right "to 1139" or "no end". The draft reads the text lines (`view/calendar-draft.ts`);
 * the list follows every key press. There is no "Add era" and no "Remove": the user types or deletes a text line.
 */

import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { nameRun } from '../render/dom/name-span';
import { eraId, type CalendarDraft } from '../view/calendar-draft';
import { eraReadings } from '../view/calendar-era-lines';
import { field, type CardHost } from './calendar-parts';

/** The height of the field in text lines: one more than its text lines, at least 3 and at most 10 (as "Names in order"). */
const rowsFor = (text: string): number => Math.min(10, Math.max(3, text.split('\n').length + 1));

/** Writes the reading list again: the eras that the draft reads, in the order of their text lines; a text line with a refusal has no entry. */
function paintReadings(list: HTMLElement, host: CardHost, d: CalendarDraft): void {
	list.empty();
	const checked = host.checked();
	const calendar = checked.byKey.get(d.key);
	if (calendar?.kind.type !== 'eras') return;
	const readings = eraReadings(calendar.kind.eras);
	d.eras.forEach((e, i) => {
		const r = readings[i];
		if (!r || checked.starts.get(eraId(d, e))?.ok === false) return;
		const row = list.createDiv({ cls: 'dynasty-cal-era-read', attr: { 'data-era-line': String(e.line) } });
		const first = row.createSpan({ cls: 'dynasty-cal-era-first' });
		nameRun(first, r.name).appendText(r.name);
		if (!Number.isSafeInteger(r.start)) {
			first.appendText(` · ${T.eraUnreadable}`);
			return;
		}
		first.appendText(` ${T.eraFirst(r.start)}`);
		row.createSpan({ cls: 'dynasty-cal-era-end', text: r.end !== undefined ? T.eraEnd(r.end) : T.eraNoEnd });
	});
	list.toggle(list.children.length > 0);
}

/** Draws the eras of an era calendar into `parent`: the text field, its refusals, its help and the reading list. `shown` tells the card that the refusals of `eras` have their place here. */
export function drawEras(parent: HTMLElement, host: CardHost, d: CalendarDraft, shown: Set<string>): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-eras-box', attr: { 'data-eras': String(d.key) } });
	const under = box.createDiv({ cls: 'dynasty-cal-under' });
	const hintId = `dynasty-cal-${d.key}-eras-hint`;
	const input = field(box, host, `${d.key}-eras`, T.erasLabel, d.erasText, (v) => (d.erasText = v), {
		area: true,
		rows: rowsFor(d.erasText),
		wide: true,
		placeholder: T.erasPlaceholder,
		describedBy: hintId,
		error: { key: d.key, field: 'eras', shown },
		errorIn: under,
	});
	// The refusals stand right under the field: `field` drew the field after the box of the refusals, so the box moves to the end.
	box.appendChild(under);
	box.createDiv({ cls: 'dynasty-sheet-hint', text: T.erasHint, attr: { id: hintId } });
	const list = box.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-cal-era-list'], attr: { 'data-era-list': String(d.key) } });
	host.register(() => {
		const rows = String(rowsFor(d.erasText));
		if (input.getAttribute('rows') !== rows) input.setAttribute('rows', rows);
		paintReadings(list, host, d);
	});
}
