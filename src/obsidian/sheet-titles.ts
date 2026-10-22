/*
 * The Titles section of the edit sheet (spec §13.4, §13.3, §13.5; D54, D62, D63), after Family:
 * the person's titles, one row for each holder entry (number and reign) with Edit and Remove;
 * "Show on the card" or "On the card" when the card could show another title; Add title (the titles
 * of the tree, then "New title…"), then the holder form. Each title shows by the name that the card
 * uses for this person (D65: the female form for `sex: f`). Like the relationship actions, each action
 * writes at once with the sheet's unsaved draft, in one write (one undo step). `edit-sheet.ts` builds
 * the section through `TitlesHost`.
 */

import type { App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { Op } from '../core/edit';
import { newTitleId } from '../core/title-ops';
import { quotedSobriquet } from '../core/sobriquet';
import { cardLabels, entryReign, rulerName, titleNameFor, type Holding } from '../core/titles';
import { entryReignText, reignOf, type DatesRead } from '../render/tree-info';
import type { Holder, Person } from '../core/types';
import { TITLES_UI, WINDOW_UI, WRITE_TEXT } from '../render/ui-text';
import { choose } from './choice-modal';
import { holderForm } from './holder-form';
import { addFields, changedFields, refOf, valuesOf } from '../view/titles-draft';
import { buildRow, textButton } from './window-parts';

/** What the Titles section needs from the edit sheet. */
export interface TitlesHost {
	app: App;
	/** The sheet's data now (it changes after each write). */
	data(): { body: string; g: FamilyGraph; person: Person };
	readOnly: boolean;
	/** The person's title text in the draft: "New title…" starts with it (spec §13.4). */
	draftTitle(): string;
	/** The draft can be written and the sheet shows the handle's body; else the sheet shows why. */
	ready(): boolean;
	/** Writes `ops` with the draft, in one write; resolves to true when written. */
	write(ops: Op[]): Promise<boolean>;
	/** The same, then a Notice with Undo that says `text`. */
	writeRemoval(ops: Op[], text: string): Promise<boolean>;
	/** The message of the last failed write, for the holder form. */
	lastError(): string;
	/** A sheet button (44 px, spec §7.5) that runs `run` unless the sheet is saving. */
	button(parent: HTMLElement, text: string, cls: string, run: () => void, label?: string, icon?: string): HTMLButtonElement;
}

const NEW_TITLE = '\u0000new-title';

/**
 * One holder entry as the sheet shows it: "Gareth I, 1158–1163", or "No number and no dates". D122: the sobriquet
 * of the person follows the ruler text in curly marks ("Gareth I “the Wise”, 1158–1163"); an entry with no
 * number has no ruler text, so it shows no sobriquet either.
 */
export function entryText(entry: Holder, personName: string, sobriquet?: string, dates?: DatesRead): string {
	const ruler = entry.number !== undefined ? `${rulerName(entry, personName)} ${entry.number}` : undefined;
	const named = ruler !== undefined && sobriquet !== undefined ? `${ruler} ${quotedSobriquet(sobriquet)}` : ruler;
	const parts = [named, (dates ? entryReignText(entry, dates, 'shown') : entryReign(entry))].filter((x): x is string => !!x);
	return parts.length ? parts.join(', ') : TITLES_UI.entryNone;
}

/**
 * The title whose name the card shows (D62, D63), or undefined when the card shows the written
 * `title` text (or no title).
 */
export function titleOnCard(g: FamilyGraph, person: Person): string | undefined {
	const label = cardLabels(g).get(person.id);
	if (!label?.shown) return undefined;
	if (label.selected) return label.shown.title.id;
	return person.title === undefined ? label.shown.title.id : undefined;
}

/** The line under the title of the closed Titles section: the first title with its reign, and how many more (contract C). */
export function titlesSummary(host: TitlesHost): string {
	const { g, person } = host.data();
	const holdings = cardLabels(g).get(person.id)?.holdings ?? [];
	const first = holdings[0];
	if (!first) return WINDOW_UI.noTitles;
	const reign = reignOf(first.entries, g.dates, 'shown')?.replace(/^\(|\)$/g, '');
	const parts = [titleNameFor(first.title, person), reign, holdings.length > 1 ? WINDOW_UI.andMore(holdings.length - 1) : undefined];
	return parts.filter((x): x is string => !!x).join(' · ');
}

/** Builds the body of the Titles section into `parent`: one row for each holder entry, then Add title. */
export function titlesBody(parent: HTMLElement, host: TitlesHost): void {
	const { g, person } = host.data();
	const holdings = cardLabels(g).get(person.id)?.holdings ?? [];
	const rows = parent.createDiv({ cls: 'dynasty-rows' });
	if (!holdings.length) rows.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-family-empty'], text: TITLES_UI.noneHeld });
	// §13.4: only when the card could show another title than the one it shows.
	const choice = holdings.length >= 2 || (person.title !== undefined && holdings.length >= 1);
	const onCard = titleOnCard(g, person);
	for (const h of holdings) holdingRows(rows, host, h, choice, onCard);
	if (host.readOnly) return;
	const row = parent.createDiv({ cls: 'dynasty-actions' });
	host.button(row, TITLES_UI.addTitle, 'dynasty-add-title', () => void addTitle(host), undefined, 'plus');
}

function holdingRows(list: HTMLElement, host: TitlesHost, h: Holding, choice: boolean, onCard: string | undefined): void {
	const { person } = host.data();
	const title = h.title;
	// D65: the form that the card uses, so the sheet and the card say the same.
	const shownName = titleNameFor(title, person);
	const group = list.createDiv({ cls: ['dynasty-rows', 'dynasty-family-group', 'dynasty-title-holding'], attr: { 'data-title': title.id } });
	h.entries.forEach((entry, i) => {
		const text = entryText(entry, person.name, person.sobriquet, host.data().g.dates);
		const r = buildRow(group, {
			cls: ['dynasty-family-row', 'dynasty-title-entry', ...(i === 0 ? ['dynasty-title-holding-head'] : [])],
			attr: { 'data-index': String(entry.index) },
		});
		// The name of a title of the world: the name look of the Family rows (D218 rules 1 to 3).
		r.title.addClass('dynasty-family-name');
		r.title.createSpan({ cls: 'dynasty-title-holding-name', text: shownName });
		// The tag belongs to the title, so the first row of it carries it.
		if (choice && i === 0 && onCard === title.id) r.title.createSpan({ cls: ['dynasty-tag', 'dynasty-title-on-card'], text: TITLES_UI.onCard });
		r.sub.addClass('dynasty-family-detail');
		const ruler = entry.number !== undefined ? `${rulerName(entry, person.name)} ${entry.number}` : undefined;
		const sub = [ruler, entryReignText(entry, host.data().g.dates, 'shown')].filter((x): x is string => !!x).join(' · ');
		r.sub.setText(sub || TITLES_UI.entryNone);
		if (host.readOnly) return;
		const controls = r.actions();
		controls.addClass('dynasty-family-controls');
		if (choice && i === 0 && onCard !== title.id) textButton(controls, ['dynasty-link', 'dynasty-show-on-card'], TITLES_UI.showOnCard, () => void showOnCard(host, title.id), { label: TITLES_UI.showOnCardLabel(shownName), focus: 'dynasty-show-on-card' });
		textButton(controls, ['dynasty-link', 'dynasty-edit-holder'], TITLES_UI.edit, () => editEntry(host, title.id, shownName, entry), { label: TITLES_UI.entryEditLabel(shownName, text), focus: 'dynasty-edit-holder' });
		textButton(controls, ['dynasty-link', 'dynasty-remove-holder'], TITLES_UI.remove, () => void removeEntry(host, title.id, shownName, entry), { label: TITLES_UI.entryRemoveLabel(shownName, text), focus: 'dynasty-remove-holder' });
	});
}

/**
 * "Show on the card" (D62): writes or removes `card-title`, with the draft. The draft's Title text
 * goes into the same write, so it decides, not the saved `title`: with a Title text only a written
 * `card-title` shows the title (D63); without one, the first title shows by default, so selecting it
 * removes `card-title` (the rule of `cardTitleOp`, applied to the draft).
 */
async function showOnCard(host: TitlesHost, titleId: string): Promise<void> {
	if (!host.ready()) return;
	const { g, person } = host.data();
	const first = cardLabels(g).get(person.id)?.holdings[0]?.title.id;
	const remove = host.draftTitle() === '' && first === titleId;
	const op: Op = { kind: 'set-person-fields', id: person.id, fields: { 'card-title': remove ? null : titleId } };
	await host.write([op]);
}

function editEntry(host: TitlesHost, titleId: string, titleName: string, entry: Holder): void {
	if (!host.ready()) return;
	const { person } = host.data();
	const before = valuesOf(entry);
	holderForm(host.app, {
		heading: TITLES_UI.formEdit,
		context: `${person.name}: ${titleName}`,
		values: before,
		personName: person.name,
		save: async (v) => {
			const fields = changedFields(before, v);
			if (!Object.keys(fields).length) return null;
			const ok = await host.write([{ kind: 'edit-holder', holder: refOf(titleId, entry), fields }]);
			return ok ? null : host.lastError() || WRITE_TEXT.refused;
		},
	});
}

async function removeEntry(host: TitlesHost, titleId: string, titleName: string, entry: Holder): Promise<void> {
	if (!host.ready()) return;
	const { person } = host.data();
	await host.writeRemoval([{ kind: 'remove-holder', holder: refOf(titleId, entry) }], TITLES_UI.removed(person.name, titleName));
}

/** Add title (D54, spec §13.4): the titles of the tree and "New title…", then the holder form; the new holder goes at the end. */
async function addTitle(host: TitlesHost): Promise<void> {
	if (!host.ready()) return;
	const { g, person } = host.data();
	const picked = await choose(host.app, {
		title: TITLES_UI.addTitle,
		text: [TITLES_UI.addTitleText(person.name)],
		choices: [...(g.titles ?? []).map((t) => ({ value: t.id, label: t.name })), { value: NEW_TITLE, label: TITLES_UI.newTitleChoice, detail: TITLES_UI.newTitleDetail }],
		name: 'add-title',
	});
	if (picked === null) return;
	const isNew = picked === NEW_TITLE;
	const existing = isNew ? undefined : g.titles.find((t) => t.id === picked);
	holderForm(host.app, {
		heading: TITLES_UI.formNew,
		context: existing ? `${person.name}: ${titleNameFor(existing, person)}` : person.name,
		values: { person: person.id },
		personName: person.name,
		...(isNew ? { titleName: host.draftTitle() } : {}),
		save: async (v, titleName) => {
			const fields = addFields(v);
			let ops: Op[];
			if (isNew) {
				const name = (titleName ?? '').trim();
				// The id from the name, unused in the body that this write changes (§6.8).
				const id = newTitleId(host.data().body, name);
				ops = [
					{ kind: 'add-title', id, name },
					{ kind: 'add-holder', title: id, fields },
				];
			} else ops = [{ kind: 'add-holder', title: picked, fields }];
			const ok = await host.write(ops);
			return ok ? null : host.lastError() || WRITE_TEXT.refused;
		},
	});
}
