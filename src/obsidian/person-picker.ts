/*
 * The person picker (spec §6.6): live fuzzy filtering over name, title and dates; each row shows
 * the house colour, name, title and dates; the first row creates a new person with the typed text
 * (not in Find, spec §6.10). People in `exclude` are never offered. The relation finder (spec §13.2)
 * puts the marked person first, as "You: NAME". Spec §13.5: the picker also matches the ruler name
 * with the number of every numbered holder entry ("Aldric II"), and a row shows the ruler name of the
 * shown title after the full name ("Aldric Valmont (Aldric II)"). The Titles window's picker has its
 * own first row, "A holder who is not in the tree".
 */

import { SuggestModal, prepareFuzzySearch, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { cardLabels, pickerSuffix, searchNames, type CardLabel } from '../core/titles';
import type { Person } from '../core/types';
import { dateLine } from '../render/tree-info';
import { FINDER_UI, FLOW } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';
import { drawableColour } from './sheet-parts';

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
		) {
			super(app);
			this.labels = (g.titles?.length ?? 0) > 0 ? cardLabels(g) : new Map();
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
			this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.close()));
			// A heading with the title, as on the sheets; a phone has no Esc key, so there it also has Cancel.
			const head = createDiv({ cls: 'dynasty-picker-head' });
			head.createDiv({ cls: 'dynasty-sheet-title', text: this.title });
			const cancel = head.createEl('button', { cls: 'dynasty-picker-cancel', text: FLOW.cancel, attr: { type: 'button' } });
			cancel.addEventListener('click', () => this.close());
			this.modalEl.prepend(head);
		}

		override onClose(): void {
			super.onClose();
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
			const match = prepareFuzzySearch(q);
			const scored: { person: Person; score: number; exact: boolean }[] = [];
			const lower = q.toLowerCase();
			for (const person of this.people) {
				const label = this.labels.get(person.id);
				const extra = label ? searchNames(label, person.name) : [];
				const r = match([person.name, person.title ?? '', dateLine(person) ?? '', ...extra].join(' '));
				// "Aldric II" typed in full names one holder entry: that person comes before "Aldric III" (spec §13.5).
				if (r) scored.push({ person, score: r.score, exact: extra.some((n) => n.toLowerCase() === lower) });
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
			const swatch = el.createSpan({ cls: 'dynasty-picker-swatch' });
			const colour = p.house ? this.g.houses.get(p.house)?.color : undefined;
			if (drawableColour(colour)) swatch.style.setProperty('--dynasty-house-color', colour);
			else swatch.addClass('is-none');
			const text = el.createDiv({ cls: 'dynasty-picker-text' });
			const you = this.isYou(p);
			if (you) el.addClass('dynasty-picker-you');
			const name = text.createDiv({ cls: 'dynasty-picker-name', text: you ? FINDER_UI.you(p.name) : p.name });
			const label = this.labels.get(p.id);
			const suffix = label ? pickerSuffix(label, p.name) : undefined;
			if (suffix) name.createSpan({ cls: 'dynasty-picker-suffix', text: ` ${suffix}` });
			const sub = [p.title, dateLine(p)].filter(Boolean).join(' · ');
			if (sub) text.createDiv({ cls: 'dynasty-picker-sub', text: sub });
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
): Promise<Picked | null> {
	// A promise settles once: the close after a choice cannot turn the choice into null.
	return new Promise((resolve) => {
		Picker ??= definePicker();
		new Picker(app, g, exclude, placeholder, title, allowNew, resolve, you, newRow).open();
	});
}
