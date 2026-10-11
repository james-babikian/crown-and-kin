/*
 * The person picker (spec §6.6): live fuzzy filtering over name, title and dates; each row shows
 * the house colour, name, title and dates; the first row creates a new person with the typed text
 * (not in Find, spec §6.10). People in `exclude` are never offered. The relation finder (spec §13.2)
 * puts the marked person first, as "You: NAME". Spec §13.5: the picker also matches the ruler name
 * with the number of every numbered holder entry ("Aldric II"), and a row shows the ruler name of the
 * shown title after the full name ("Aldric Valmont (Aldric II)"). The Titles window's picker has its
 * own first row, "A holder who is not in the tree". The typed text and the text of each person are
 * folded with `foldForMatch` before they are compared (D100): case, accents and quote look-alikes do not matter.
 * D122: the sobriquet shows after the name in curly marks, and the search matches its text.
 * 0.2.8 contract G.3, G.1: a row is the name, a second text line "relation · years · title", and at the right the round portrait when the person
 * has one (D213: no initials, no house ring, no empty circle). On a phone the picker is a full-screen sheet; the field and Cancel share the top row (D212).
 */

import { SuggestModal, prepareFuzzySearch, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { foldForMatch } from '../core/fold';
import { quotedSobriquet } from '../core/sobriquet';
import { cardLabels, needsLabels, pickerSuffix, searchNames, type CardLabel } from '../core/titles';
import type { Person } from '../core/types';
import { cardLabel, dateLine } from '../render/tree-info';
import { WINDOW_UI } from '../render/ui-text';
import type { RelationOptions } from '../core/relations';
import type { PictureStore } from './picture-store';
import { relationsFor, validMe, type CardRelation } from './relation-cache';
import { RowPictures, personLead } from './window-parts';
import { FINDER_UI, FLOW } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { nameDialog } from './sheet-parts';

/** What the picker may use for its rows: the picture store (portraits), the tree's note, the marked person and the relation options (the second text line). */
export interface PickerContext {
	pictures?: PictureStore;
	sourcePath?: string;
	/** The marked person: the second text line then starts with the relation word. Absent: the `you` of the picker, else no word. */
	me?: string | null;
	relationOptions?: RelationOptions;
}

/** What the picker resolved to: a person already in the tree, or a new one by the typed name. */
export type Picked = { kind: 'person'; id: string } | { kind: 'new'; name: string };

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: Person };

// Defined on first use: tests that mock `obsidian` without SuggestModal can still load the sheet.
function definePicker() {
	return class PersonPicker extends SuggestModal<Item> {
		private chosen = false;
		private readonly cleanup: (() => void)[] = [];
		private readonly people: Person[];
		/** Spec §13.5: the card labels, for the ruler names; empty for a tree with no titles. */
		private readonly labels: ReadonlyMap<string, CardLabel>;
		/** G.1: the portraits of the rows; released when the picker closes. */
		private readonly rowPictures: RowPictures;
		/** The relation words to the marked person, or null for no word. */
		private words: ReadonlyMap<string, CardRelation> | null | undefined;

		constructor(
			app: App,
			private readonly g: FamilyGraph,
			exclude: Set<string>,
			placeholder: string,
			private readonly title: string,
			private readonly allowNew: boolean,
			private readonly done: (p: Picked | null) => void,
			/** The marked person, offered first as "You: NAME" (spec §13.2); null for none. */
			private readonly you: string | null = null,
			/** The text of the first row, when it is not "Create a new person" (the Titles window). */
			private readonly newRow: ((typed: string) => string) | null = null,
			private readonly ctx: PickerContext = {},
		) {
			super(app);
			this.rowPictures = new RowPictures(ctx.pictures, ctx.sourcePath ?? '');
			this.labels = needsLabels(g) ? cardLabels(g) : new Map();
			const people = g.people.filter((p) => !exclude.has(p.id));
			const me = you !== null ? people.find((p) => p.id === you) : undefined;
			this.people = me ? [me, ...people.filter((p) => p !== me)] : people;
			this.setPlaceholder(placeholder);
			this.emptyStateText = FLOW.pickerEmpty;
			// Find lists every person of a large tree (spec §6.10).
			this.limit = Math.max(200, this.people.length + 1);
		}

		/** The marked person's row, "You: NAME" (spec §13.2). */
		private isYou(p: Person): boolean {
			return p.id === this.you;
		}

		override onOpen(): void {
			super.onOpen();
			this.modalEl.addClass('dynasty-picker');
			// A placeholder is not a name for a screen reader (P4).
			this.inputEl.setAttribute('aria-label', FLOW.pickerSearchLabel);
			// D101: no curly marks and no corrections in a name that the owner types.
			this.inputEl.setAttribute('spellcheck', 'false');
			this.inputEl.setAttribute('autocapitalize', 'off');
			this.inputEl.setAttribute('autocorrect', 'off');
			this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.close()));
			// A heading with the title, as on the sheets (a phone keeps it for a screen reader only). A phone has no Esc key, so there Cancel
			// stands in the row of the field; a computer hides it.
			const head = createDiv({ cls: 'dynasty-picker-head' });
			nameDialog(this.modalEl, head.createDiv({ cls: 'dynasty-sheet-title', text: this.title }));
			const cancel = createEl('button', { cls: 'dynasty-picker-cancel', text: FLOW.cancel, attr: { type: 'button' } });
			cancel.addEventListener('click', () => this.close());
			const field = this.inputEl.parentElement;
			if (field) field.appendChild(cancel);
			else head.appendChild(cancel);
			this.modalEl.prepend(head);
		}

		override onClose(): void {
			super.onClose();
			this.rowPictures.release();
			for (const c of this.cleanup.splice(0)) c();
			// SuggestModal closes before it calls onChooseSuggestion: wait one turn to tell a choice from a cancel.
			window.setTimeout(() => {
				if (!this.chosen) this.done(null);
			}, 0);
		}

		getSuggestions(query: string): Item[] {
			const q = query.trim();
			const first: Item[] = this.allowNew ? [{ kind: 'new', text: query }] : [];
			if (!q) return [...first, ...this.people.map((person): Item => ({ kind: 'person', person }))];
			// D100: both sides are folded (case, accents, quote look-alikes), so "d'España" finds "d’España". Only the
			// match changes. The rows show the stored text, and the plugin does not use the match positions: folding
			// can change the length of a text ("Æthelred" is longer), so positions would not fit the shown text.
			const lower = foldForMatch(q);
			if (!lower) return [...first, ...this.people.map((person): Item => ({ kind: 'person', person }))];
			const match = prepareFuzzySearch(lower);
			const scored: { person: Person; score: number; exact: boolean }[] = [];
			for (const person of this.people) {
				const label = this.labels.get(person.id);
				const extra = label ? searchNames(label, person.name) : [];
				// D122: the text of the sobriquet is matched too (without its marks).
				const r = match(foldForMatch([person.name, person.sobriquet ?? '', person.title ?? '', dateLine(person) ?? '', ...extra].join(' ')));
				// "Aldric II" typed in full names one holder entry: that person comes before "Aldric III" (spec §13.5).
				if (r) scored.push({ person, score: r.score, exact: extra.some((n) => foldForMatch(n) === lower) });
			}
			const rank = (s: { person: Person; exact: boolean }) => (this.isYou(s.person) ? 0 : s.exact ? 1 : 2);
			scored.sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.person.index - b.person.index);
			return [...first, ...scored.map(({ person }): Item => ({ kind: 'person', person }))];
		}

		renderSuggestion(item: Item, el: HTMLElement): void {
			el.addClass('dynasty-picker-row');
			if (item.kind === 'new') {
				el.addClass('dynasty-picker-new');
				el.createSpan({ cls: 'dynasty-picker-swatch is-new', text: '+' });
				el.createSpan({ cls: 'dynasty-picker-name', text: this.newRow ? this.newRow(item.text) : FLOW.createNew(item.text) });
				return;
			}
			const p = item.person;
			el.setAttribute('data-person', p.id);
			const text = el.createDiv({ cls: 'dynasty-picker-text' });
			const you = this.isYou(p);
			if (you) el.addClass('dynasty-picker-you');
			const name = text.createDiv({ cls: 'dynasty-picker-name', text: you ? FINDER_UI.you(p.name) : p.name });
			const label = this.labels.get(p.id);
			const suffix = label ? pickerSuffix(label, p.name) : undefined;
			if (suffix) name.createSpan({ cls: 'dynasty-picker-suffix', text: ` ${suffix}` });
			// D122: the sobriquet in curly marks, in regular weight, after the name and the ruler name.
			if (p.sobriquet !== undefined) name.createSpan({ cls: 'dynasty-picker-sob', text: ` ${quotedSobriquet(p.sobriquet)}` });
			// "You: Ann" already says who is marked, so the second text line does not repeat "You".
			const relation = this.relationOf(p.id);
			// D218 rule 4: the relation word is italic, as on the cards and in the window rows; the rest of the text line is plain.
			const word = you ? '' : (relation?.text ?? '');
			const rest = WINDOW_UI.findRowSub('', dateLine(p) ?? '', label?.title ?? p.title ?? '');
			if (word || rest) {
				const sub = text.createDiv({ cls: 'dynasty-picker-sub', ...(word ? {} : { text: rest }) });
				if (word) sub.createEl('i', { text: word });
				// A span, not loose text: the order of the nodes stays the same for a reader that walks the children.
				if (word && rest) sub.createSpan({ text: ` · ${rest}` });
			}
			// The portrait stands after the text, at the right, so the names line up with or without one (D213).
			const lead = personLead(el, { name: p.name, ...(p.portrait ? { portrait: p.portrait } : {}), ...(p.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, this.rowPictures, 36);
			lead?.addClass('dynasty-picker-swatch');
			// The visible lines hold "maybe full" and "·"; a screen reader gets the sentence the cards use. A hidden
			// text, not aria-label: Obsidian shows an aria-label as a tooltip over the row.
			text.setAttribute('aria-hidden', 'true');
			el.createSpan({ cls: 'dynasty-sr-only', text: cardLabel(p, you ? 'you' : relation?.lower, label) });
		}

		/** The relation of a person to the marked person (the card texts), or undefined. Worked out once, from the whole tree. */
		private relationOf(id: string): CardRelation | undefined {
			if (this.words === undefined) {
				const me = this.ctx.me !== undefined ? this.ctx.me : this.you;
				const valid = me ? validMe(this.g, me) : null;
				this.words = valid ? relationsFor(this.g, valid, this.ctx.relationOptions).cards : null;
			}
			return this.words?.get(id);
		}

		onChooseSuggestion(item: Item): void {
			this.chosen = true;
			this.done(item.kind === 'new' ? { kind: 'new', name: item.text.trim() } : { kind: 'person', id: item.person.id });
		}
	};
}

let Picker: ReturnType<typeof definePicker> | null = null;

/**
 * Opens the picker; resolves to the chosen person, "create new" with the typed text, or null. `you`:
 * the marked person, offered first as "You: NAME" (the relation finder, spec §13.2). `newRow`: the
 * text of the first row instead of "Create a new person" (it still resolves to `new`).
 */
export function pickPerson(
	app: App,
	g: FamilyGraph,
	exclude: Set<string>,
	placeholder: string,
	title: string,
	allowNew = true,
	you: string | null = null,
	newRow: ((typed: string) => string) | null = null,
	ctx: PickerContext = {},
): Promise<Picked | null> {
	// A promise settles once: the close after a choice cannot turn the choice into null.
	return new Promise((resolve) => {
		Picker ??= definePicker();
		new Picker(app, g, exclude, placeholder, title, allowNew, resolve, you, newRow, ctx).open();
	});
}
