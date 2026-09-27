import { SuggestModal, prepareFuzzySearch, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { Person } from '../core/types';
import { dateLine } from '../render/svg-string';
import { FLOW } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from './plugin-modals';

/*
 * The person picker (spec §6.6): live fuzzy filtering over name, title and dates; each row shows
 * the house colour, name, title and dates; the first row creates a new person with the typed text
 * (not in Find, spec §6.10). People in `exclude` are never offered.
 */

export type Picked = { kind: 'person'; id: string } | { kind: 'new'; name: string };

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: Person };

function isColour(value: string | undefined): value is string {
	if (!value) return false;
	try {
		return CSS.supports('color', value);
	} catch {
		return false;
	}
}

// Defined on first use: tests that mock `obsidian` without SuggestModal can still load the sheet.
function definePicker() {
	return class PersonPicker extends SuggestModal<Item> {
		private chosen = false;
		private readonly cleanup: (() => void)[] = [];
		private readonly people: Person[];

		constructor(
			app: App,
			private readonly g: FamilyGraph,
			exclude: Set<string>,
			placeholder: string,
			private readonly title: string,
			private readonly allowNew: boolean,
			private readonly done: (p: Picked | null) => void,
		) {
			super(app);
			this.people = g.people.filter((p) => !exclude.has(p.id));
			this.setPlaceholder(placeholder);
			this.emptyStateText = FLOW.pickerEmpty;
			// Find lists every person of a large tree (spec §6.10).
			this.limit = Math.max(200, this.people.length + 1);
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
			const scored: { person: Person; score: number }[] = [];
			for (const person of this.people) {
				const r = match([person.name, person.title ?? '', dateLine(person) ?? ''].join(' '));
				if (r) scored.push({ person, score: r.score });
			}
			scored.sort((a, b) => b.score - a.score || a.person.index - b.person.index);
			return [...first, ...scored.map(({ person }): Item => ({ kind: 'person', person }))];
		}

		renderSuggestion(item: Item, el: HTMLElement): void {
			el.addClass('dynasty-picker-row');
			if (item.kind === 'new') {
				el.addClass('dynasty-picker-new');
				el.createSpan({ cls: 'dynasty-picker-swatch is-new', text: '+' });
				el.createSpan({ cls: 'dynasty-picker-name', text: FLOW.createNew(item.text) });
				return;
			}
			const p = item.person;
			el.setAttribute('data-person', p.id);
			const swatch = el.createSpan({ cls: 'dynasty-picker-swatch' });
			const colour = p.house ? this.g.houses.get(p.house)?.color : undefined;
			if (isColour(colour)) swatch.style.setProperty('--dynasty-house-color', colour);
			else swatch.addClass('is-none');
			const text = el.createDiv({ cls: 'dynasty-picker-text' });
			text.createDiv({ cls: 'dynasty-picker-name', text: p.name });
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

/** Opens the picker; resolves to the chosen person, "create new" with the typed text, or null. */
export function pickPerson(app: App, g: FamilyGraph, exclude: Set<string>, placeholder: string, title: string, allowNew = true): Promise<Picked | null> {
	return new Promise((resolve) => {
		let settled = false;
		Picker ??= definePicker();
		new Picker(app, g, exclude, placeholder, title, allowNew, (p) => {
			if (settled) return;
			settled = true;
			resolve(p);
		}).open();
	});
}
