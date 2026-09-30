/*
 * The Titles section of the edit sheet (spec §13.4, §13.3, §13.5; D54, D62, D63), between the fields
 * and Family: the person's titles, each with its holder entries (number and reign), Edit and Remove;
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
import { cardLabels, entryReign, rulerName, titleNameFor, type Holding } from '../core/titles';
import type { Holder, Person } from '../core/types';
import { TITLES_UI, WRITE_TEXT } from '../render/ui-text';
import { choose } from './choice-modal';
import { holderForm } from './holder-form';
import { addFields, changedFields, refOf, valuesOf } from './titles-draft';

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
	button(parent: HTMLElement, text: string, cls: string, run: () => void, label?: string): HTMLButtonElement;
}

const NEW_TITLE = '\u0000new-title';

/** One holder entry as the sheet shows it: "Gareth I, 1158–1163", or "No number and no dates". */
export function entryText(entry: Holder, personName: string): string {
	const parts = [entry.number !== undefined ? `${rulerName(entry, personName)} ${entry.number}` : undefined, entryReign(entry)].filter((x): x is string => !!x);
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

/** Builds the Titles section into `parent`. */
export function titlesSection(parent: HTMLElement, host: TitlesHost): void {
	const { g, person } = host.data();
	const sec = parent.createDiv({ cls: 'dynasty-sheet-section dynasty-titles-section' });
	sec.createDiv({ cls: 'dynasty-sheet-section-title', text: TITLES_UI.heading });
	const holdings = cardLabels(g).get(person.id)?.holdings ?? [];
	if (!holdings.length) sec.createDiv({ cls: 'dynasty-family-empty', text: TITLES_UI.noneHeld });
	// §13.4: only when the card could show another title than the one it shows.
	const choice = holdings.length >= 2 || (person.title !== undefined && holdings.length >= 1);
	const onCard = titleOnCard(g, person);
	for (const h of holdings) holdingGroup(sec, host, h, choice, onCard);
	if (host.readOnly) return;
	const row = sec.createDiv({ cls: 'dynasty-family-buttons' });
	host.button(row, TITLES_UI.addTitle, 'dynasty-add-title', () => void addTitle(host));
}

function holdingGroup(sec: HTMLElement, host: TitlesHost, h: Holding, choice: boolean, onCard: string | undefined): void {
	const { person } = host.data();
	const title = h.title;
	// D65: the form that the card uses, so the sheet and the card say the same.
	const shownName = titleNameFor(title, person);
	const group = sec.createDiv({ cls: 'dynasty-family-group dynasty-title-holding', attr: { 'data-title': title.id } });
	const head = group.createDiv({ cls: 'dynasty-family-row dynasty-title-holding-head' });
	head.createDiv({ cls: 'dynasty-family-name dynasty-title-holding-name', text: shownName });
	if (choice) {
		const controls = head.createDiv({ cls: 'dynasty-family-controls' });
		if (onCard === title.id) controls.createDiv({ cls: 'dynasty-title-on-card', text: TITLES_UI.onCard });
		else if (!host.readOnly) host.button(controls, TITLES_UI.showOnCard, 'dynasty-show-on-card', () => void showOnCard(host, title.id), TITLES_UI.showOnCardLabel(shownName));
	}
	for (const entry of h.entries) {
		const text = entryText(entry, person.name);
		const row = group.createDiv({ cls: 'dynasty-family-row dynasty-title-entry', attr: { 'data-index': String(entry.index) } });
		row.createDiv({ cls: 'dynasty-family-name dynasty-family-detail', text });
		if (host.readOnly) continue;
		const controls = row.createDiv({ cls: 'dynasty-family-controls' });
		host.button(controls, TITLES_UI.edit, 'dynasty-edit-holder', () => editEntry(host, title.id, shownName, entry), TITLES_UI.entryEditLabel(shownName, text));
		host.button(controls, TITLES_UI.remove, 'dynasty-remove-holder', () => void removeEntry(host, title.id, shownName, entry), TITLES_UI.entryRemoveLabel(shownName, text));
	}
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
