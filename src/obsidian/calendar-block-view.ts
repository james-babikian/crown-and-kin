/*
 * The `kin-calendar` block in a note (spec §14 rule 2): the calendars of the block as small tables, each with a test line and an Edit button that opens the
 * Calendars window on this note. A block that cannot be read shows its message in place of the tables. Nothing here changes the note; the window does. Plugin versions
 * before calendars show the block as plain code.
 */

import { MarkdownRenderChild, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { parseCalendarBlock } from '../core/calendar-block';
import { formatInternalYear, isUsableList, type Calendar, type DateReader, type NameList } from '../core/dates';
import { issueText } from '../core/messages';
import { CALENDAR_BLOCK_UI as T, CALENDAR_WINDOW_UI as W } from '../render/calendar-text';
import type { CalendarIndex } from '../view/calendar-index';
import { compileCapped } from '../view/calendar-reader';
import { testField } from './calendar-parts';
import { openCalendars } from './calendar-window';
import { textButton } from './window-parts';

/** The events that the block keeps from the editor, as the tree view does (spec §7.2): in Live Preview a click would else switch the block to its source text. */
const STOPPED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'];

/** One row of a table: a label and the text beside it (`lines` more than one stand under each other). */
function row(table: HTMLElement, label: string, lines: readonly string[]): void {
	const tr = table.createEl('tr');
	tr.createEl('th', { text: label, attr: { scope: 'row' } });
	const td = tr.createEl('td');
	for (const line of lines) td.createDiv({ text: line });
}

/** The table of the eras of an era calendar. */
function eraTable(parent: HTMLElement, c: Calendar & { kind: { type: 'eras' } }): void {
	const table = parent.createEl('table', { cls: 'dynasty-cal-table dynasty-cal-eras' });
	const head = table.createEl('tr');
	for (const h of [T.era, T.start, T.length]) head.createEl('th', { text: h, attr: { scope: 'col' } });
	for (const e of c.kind.eras) {
		const tr = table.createEl('tr');
		tr.createEl('td', { text: e.name });
		tr.createEl('td', { text: Number.isFinite(e.start) ? formatInternalYear(e.start) : '' });
		tr.createEl('td', { text: e.length === undefined ? T.noLength : String(e.length) });
	}
}

/** The rows of the name lists of a calendar or of the plain years: the name (with the marker), the first names with their short forms, and the known year. A list that cannot be used has no row. */
function listRows(table: HTMLElement, lists: readonly NameList[]): void {
	lists.forEach((l, i) => {
		// A list that the plugin cannot use has no row: its problem shows as a message above the tables.
		if (!isUsableList(l, i)) return;
		row(table, T.nameList, [T.listMarker(l.name, l.marker), T.listNames(l.names), T.listKnown(l.known.year, l.names[l.known.index].name)]);
	});
}

/** True when at least one list can be used (so a table of rows is worth drawing). */
const anyUsable = (lists: readonly NameList[] | undefined): lists is readonly NameList[] => !!lists?.some((l, i) => isUsableList(l, i));

/** Draws one calendar: its name and Edit button, its table and its test line. */
function drawCalendar(parent: HTMLElement, c: Calendar, edit: () => void, reader: DateReader): void {
	const box = parent.createDiv({ cls: 'dynasty-cal-block', attr: { role: 'group', 'aria-label': c.name } });
	const head = box.createDiv({ cls: 'dynasty-cal-head' });
	// The kind stands after the name, so the table has no row for it.
	const title = head.createDiv({ cls: 'dynasty-cal-block-title' });
	title.createEl('b', { text: c.name });
	const kind = c.kind.type === 'cycles' ? W.kindCycles : W.kindEras;
	title.createSpan({ cls: 'dynasty-cal-block-kind', text: c.name ? ` · ${kind}` : kind });
	textButton(head, ['dynasty-btn', 'dynasty-cal-edit'], T.edit, edit, { label: T.editLabel(c.name) });
	const table = box.createEl('table', { cls: 'dynasty-cal-table' });
	row(table, T.formats, c.formats.length ? c.formats : [T.noFormats]);
	if (c.kind.type === 'cycles') {
		row(table, T.length, [String(c.kind.length)]);
		row(table, T.start, [formatInternalYear(c.kind.start)]);
		listRows(table, c.lists ?? []);
	} else {
		eraTable(box, c as Calendar & { kind: { type: 'eras' } });
		if (anyUsable(c.lists)) listRows(box.createEl('table', { cls: 'dynasty-cal-table' }), c.lists);
	}
	testField(box, `${c.id}`, () => reader);
}

/** The child that draws a `kin-calendar` block and removes it with the note. */
class CalendarBlock extends MarkdownRenderChild {
	constructor(
		private readonly app: App,
		private readonly index: CalendarIndex,
		el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
	) {
		super(el);
	}

	override onload(): void {
		for (const type of STOPPED_EVENTS) this.registerDomEvent(this.containerEl, type as keyof HTMLElementEventMap, (e) => e.stopPropagation(), { passive: true });
		try {
			this.draw();
		} catch (e) {
			console.error('Crown and Kin: cannot show the calendar block', e);
			this.containerEl.empty();
			this.containerEl.createDiv({ cls: 'dynasty-cal-block-error', text: T.error });
		}
	}

	private draw(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass('dynasty-cal-view');
		const path = this.ctx.sourcePath;
		const { calendars, issues, plain } = parseCalendarBlock(this.source, path, 0);
		for (const issue of issues) el.createDiv({ cls: 'dynasty-cal-block-error', text: issueText(issue) });
		// A date that a calendar of this block reads: the test line uses the calendars of the block as they are written, with the plain-year name lists.
		const reader = compileCapped(calendars, true, [], plain ?? []);
		const edit = () => void this.index.reload(path).then(() => openCalendars(this.app, this.index, { treePath: path, link: undefined, note: path }));
		for (const c of calendars) drawCalendar(el, c, edit, reader);
		if (anyUsable(plain)) {
			const box = el.createDiv({ cls: 'dynasty-cal-block', attr: { role: 'group', 'aria-label': T.plainYears } });
			box.createDiv({ cls: 'dynasty-cal-block-title' }).createEl('b', { text: T.plainYears });
			listRows(box.createEl('table', { cls: 'dynasty-cal-table' }), plain);
			if (!calendars.length) textButton(box, ['dynasty-btn', 'dynasty-cal-edit'], T.edit, edit, { label: T.editLabel(path) });
		}
		if (!calendars.length && !issues.length && !anyUsable(plain)) {
			el.createDiv({ cls: 'dynasty-sheet-none', text: T.empty });
			textButton(el, ['dynasty-btn', 'dynasty-cal-edit'], T.edit, edit, { label: T.editLabel(path) });
		}
	}
}

/** The code block processor of `kin-calendar`. Nothing may throw into Obsidian (spec §8). */
export function calendarBlockProcessor(app: App, index: CalendarIndex): (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
	return (source, el, ctx) => {
		try {
			ctx.addChild(new CalendarBlock(app, index, el, source, ctx));
		} catch (e) {
			console.error('Crown and Kin: cannot show the calendar block', e);
		}
	};
}
