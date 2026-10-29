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
 * A row is the name, a second text line "relation · years · title", and at the right the round portrait when the person
 * has one (D213: no initials, no house ring, no empty circle). On a phone the picker is a full-screen sheet; the field and Cancel share the top row (D212).
 * D237: the list builds at most `PICKER_PAGE` people at once; the next page is added to the same list when the reader scrolls near its end.
 */

import { SuggestModal, prepareFuzzySearch, type App } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import { foldForMatch } from '../core/fold';
import { quotedSobriquet } from '../core/sobriquet';
import { cardLabels, needsLabels, pickerSuffix, searchNames, type CardLabel } from '../core/titles';
import type { Person } from '../core/types';
import { cardLabel, dateLine, dateLineShown } from '../render/tree-info';
import { WINDOW_UI } from '../render/ui-text';
import type { RelationOptions } from '../core/relations';
import type { PictureStore } from './picture-store';
import { relationsFor, validMe, type CardLookup, type CardRelation } from '../view/relation-cache';
import { RowPictures, personLead } from './window-parts';
import { FINDER_UI, FLOW } from '../render/ui-text';
import { ignoreGhostClick, phoneLayout } from './modal-layout';
import { trackModal } from '../view/plugin-modals';
import { nameDialog } from './sheet-parts';

/** What the picker may use for its rows: the picture store (portraits), the tree's note, the marked person and the relation options (the second text line). */
export interface PickerContext {
	pictures?: PictureStore;
	sourcePath?: string;
	/** The marked person: the second text line then starts with the relation word. Absent: the `you` of the picker, else no word. */
	me?: string | null;
	relationOptions?: RelationOptions;
	/** The block of the tree view that asks (relation-cache.ts): the relation words come from the lookup of this block. */
	relationBlock?: string;
}

/** What the picker resolved to: a person already in the tree, or a new one by the typed name. */
export type Picked = { kind: 'person'; id: string } | { kind: 'new'; name: string };

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: Person };

/** D237: the people a list builds at once, and the people that each scroll to the end adds. */
export const PICKER_PAGE = 200;
/** The scroll position that adds the next page: this many heights of the list before its end, so the new rows exist before the reader sees them. */
const NEAR_END = 2;

/**
 * Obsidian's row list inside `SuggestModal` (not in the public typings): the keyboard moves over `suggestions`, and `addSuggestion` adds one row at the end.
 * Why a private field: the public API has no way to add rows to a list that is already drawn, and drawing the whole list again for each page costs
 * the reader's selected row and scroll position on a list of thousands of people. If a later Obsidian version removes or renames `chooser` (or
 * its members), every use below checks for it first. The picker then draws the list again with one more page (`loadMore`), as it did before
 * D237, and the keyboard and the search work as they do in any other picker; only the scroll position is less smooth.
 */
interface Chooser {
	values: unknown[] | null;
	suggestions: HTMLElement[];
	selectedItem: number;
	addSuggestion?(value: Item): void;
	setSelectedItem?(index: number, evt: Event | null): void;
}

/** The people of a list of items, in order, without the marked person (the row of that person has no relation word). */
function wordIds(items: Item[], you: string | null): string[] {
	return items.flatMap((i) => (i.kind === 'person' && i.person.id !== you ? [i.person.id] : []));
}

/** The rows whose relation words are worked out at once, in `getSuggestions` (about a screenful, and a little more for a scroll). */
export const FIRST_ROWS = 20;
/** The rows whose words are worked out in one idle step after that. */
export const IDLE_CHUNK = 50;
/** An idle step waits at most this long when the browser stays busy; where there is no idle callback (Safari), it is the plain delay. */
const IDLE_MS = 300;

/** Runs `fn` in idle time, or after `IDLE_MS` where the browser has no idle callback; gives a function that cancels it. */
function whenIdle(fn: () => void): () => void {
	const g = window as unknown as { requestIdleCallback?: (f: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
	if (g.requestIdleCallback && g.cancelIdleCallback) {
		const id = g.requestIdleCallback(fn, { timeout: IDLE_MS });
		return () => g.cancelIdleCallback!(id);
	}
	const id = window.setTimeout(fn, IDLE_MS);
	return () => window.clearTimeout(id);
}

// Defined on first use: tests that mock `obsidian` without SuggestModal can still load the sheet.
function definePicker() {
	return class PersonPicker extends SuggestModal<Item> {
		private chosen = false;
		private readonly cleanup: (() => void)[] = [];
		private readonly people: Person[];
		/** Spec §13.5: the card labels, for the ruler names; empty for a tree with no titles. */
		private readonly labels: ReadonlyMap<string, CardLabel>;
		/** The portraits of the rows; released when the picker closes. */
		private readonly rowPictures: RowPictures;
		/** The relation words to the marked person, or null for no word. */
		private words: CardLookup | null | undefined;
		/** The people of the rows whose words are not yet worked out, in the order of the rows; the idle steps take them in chunks. */
		private queue: string[] = [];
		/** The redraw of the second text line of each shown row that had no word when it drew. */
		private pending = new Map<string, (() => void)[]>();
		private stopFill: (() => void) | null = null;
		/** Set by `onClose`: a late scroll or idle step must not start work on a picker that is gone. */
		private closed = false;
		/** True while the fallback of `loadMore` puts the selected row back, so `onSelectedChange` does not add a page again. */
		private restoring = false;
		/** D237: every item of the last list (the new-person row first, then the people), of which only the first `built` have rows. */
		private pool: Item[] = [];
		private built = 0;
		/** The items the next `getSuggestions` hands to Obsidian; it grows only where `addSuggestion` is missing (see `loadMore`). */
		private window = 0;
		private lastQuery: string | null = null;

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
			// D237: `getSuggestions` hands over the pages, so Obsidian must not cut the list again (its default limit is 100).
			this.limit = Number.MAX_SAFE_INTEGER;
			this.window = this.firstWindow();
		}

		/** The items of the first list: the new-person row (when there is one) and one page of people. */
		private firstWindow(): number {
			return (this.allowNew ? 1 : 0) + PICKER_PAGE;
		}

		/** The marked person's row, "You: NAME" (spec §13.2). */
		private isYou(p: Person): boolean {
			return p.id === this.you;
		}

		override onOpen(): void {
			void super.onOpen();
			this.modalEl.addClass('dynasty-picker');
			// A placeholder is not a name for a screen reader.
			this.inputEl.setAttribute('aria-label', FLOW.pickerSearchLabel);
			// D101: no curly marks and no corrections in a name that the user types.
			this.inputEl.setAttribute('spellcheck', 'false');
			this.inputEl.setAttribute('autocapitalize', 'off');
			this.inputEl.setAttribute('autocorrect', 'off');
			this.cleanup.push(phoneLayout(this), ignoreGhostClick(this), trackModal(this, () => this.close()));
			// D237: a scroll does not bubble, so the listener stands on the list itself.
			const list = this.resultContainerEl;
			const onScroll = () => {
				if (list.scrollHeight - list.scrollTop - list.clientHeight < list.clientHeight * NEAR_END) this.loadMore();
			};
			list.addEventListener('scroll', onScroll, { passive: true });
			this.cleanup.push(() => list.removeEventListener('scroll', onScroll));
			// A heading with the title, as on the sheets (a phone keeps it for a screen reader only). A phone has no Esc key, so there Cancel
			// stands at the right of the grey pill, outside it, as in an iOS search bar; a computer hides it.
			const head = createDiv({ cls: 'dynasty-picker-head' });
			nameDialog(this.modalEl, head.createDiv({ cls: 'dynasty-sheet-title', text: this.title }));
			const cancel = createEl('button', { cls: 'dynasty-picker-cancel', text: FLOW.cancel, attr: { type: 'button' } });
			cancel.addEventListener('click', () => this.close());
			const field = this.inputEl.parentElement;
			// A sibling of the pill, not a child: the stylesheet puts both in one row of the prompt.
			if (field?.parentElement === this.modalEl) this.modalEl.insertBefore(cancel, field.nextElementSibling);
			else this.modalEl.appendChild(cancel);
			this.modalEl.prepend(head);
		}

		override onClose(): void {
			super.onClose();
			this.closed = true;
			this.stopWords();
			this.rowPictures.release();
			for (const c of this.cleanup.splice(0)) c();
			// SuggestModal closes before it calls onChooseSuggestion: wait one turn to tell a choice from a cancel.
			window.setTimeout(() => {
				if (!this.chosen) this.done(null);
			}, 0);
		}

		getSuggestions(query: string): Item[] {
			// A new text starts again at the first page; the same text (the fallback of `loadMore`) keeps the pages it has.
			if (query !== this.lastQuery) {
				this.lastQuery = query;
				this.window = this.firstWindow();
			}
			this.pool = this.suggest(query);
			const out = this.pool.slice(0, this.window);
			this.built = out.length;
			this.fillWords(out);
			return out;
		}

		/**
		 * D237: adds the next page of the list. Each row goes to the end of Obsidian's own list, so the selected row, the keyboard and the
		 * scroll position stay as they are. Where that list has no `addSuggestion` (an Obsidian that changed), the list is built again with
		 * one more page and the scroll position is put back; that costs more but loses nothing. `showSelected` (a key press) also keeps the
		 * selected row in view; a scroll keeps the reader's position.
		 */
		loadMore(showSelected = false): void {
			if (this.closed || this.built >= this.pool.length) return;
			const next = this.pool.slice(this.built, this.built + PICKER_PAGE);
			const chooser = (this as unknown as { chooser?: Chooser }).chooser;
			if (chooser?.addSuggestion && chooser.values) {
				for (const item of next) chooser.addSuggestion(item);
				this.built += next.length;
				this.queueWords(wordIds(next, this.you));
				return;
			}
			const list = this.resultContainerEl;
			const top = list.scrollTop;
			const selected = chooser?.selectedItem ?? 0;
			this.window = this.built + next.length;
			// The rebuild selects the first row; the reader's row must stay selected (and in view), as with `addSuggestion`.
			this.restoring = true;
			try {
				// `onInput` is private too. If it is gone, the picker keeps the rows it has: the reader can still type to search.
				(this as unknown as { onInput?(): void }).onInput?.();
				list.scrollTop = top;
				if (chooser && chooser.suggestions.length > 0) {
					const at = Math.min(selected, chooser.suggestions.length - 1);
					if (chooser.setSelectedItem) chooser.setSelectedItem(at, null);
					else chooser.selectedItem = at;
					if (showSelected) chooser.suggestions[at]?.scrollIntoView?.({ block: 'nearest' });
				}
			} finally {
				this.restoring = false;
			}
		}

		/** Obsidian calls this when the selected row changes. Near the last row, the next page is added, so the arrow key does not wrap to the top while rows are missing. */
		onSelectedChange(): void {
			const chooser = (this as unknown as { chooser?: Chooser }).chooser;
			if (!this.restoring && chooser && chooser.selectedItem >= this.built - 10) this.loadMore(true);
		}

		/**
		 * The words of the first rows come from one request, and the words of the later rows are worked out in idle steps, so the first
		 * picker on a large marked tree does not wait for the whole tree. A row draws without a word until then.
		 * D237: only the rows that exist get words; `loadMore` queues the people of each new page.
		 */
		private fillWords(out: Item[]): void {
			this.stopWords();
			const words = this.wordsOf();
			if (!words) return;
			const ids = wordIds(out, this.you);
			words.getMany(ids.slice(0, FIRST_ROWS));
			this.queueWords(ids.slice(FIRST_ROWS));
		}

		/** Puts people on the queue of the idle fill (not those with a word already) and starts the fill when it is not running. */
		private queueWords(ids: string[]): void {
			const words = this.wordsOf();
			if (this.closed || !words) return;
			this.queue.push(...ids.filter((id) => !words.known(id)));
			if (!this.stopFill) this.schedule();
		}

		private schedule(): void {
			if (this.queue.length) this.stopFill = whenIdle(() => this.fillStep());
		}

		private fillStep(): void {
			this.stopFill = null;
			if (this.closed) return;
			const words = this.wordsOf();
			if (!words) return;
			const chunk = this.queue.splice(0, IDLE_CHUNK);
			words.getMany(chunk);
			for (const id of chunk) {
				for (const redraw of this.pending.get(id) ?? []) redraw();
				this.pending.delete(id);
			}
			this.schedule();
		}

		/** Ends the idle steps (a new list, or the picker closes). */
		private stopWords(): void {
			this.stopFill?.();
			this.stopFill = null;
			this.queue = [];
			this.pending.clear();
		}

		private suggest(query: string): Item[] {
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
				const r = match(foldForMatch([person.name, person.sobriquet ?? '', person.title ?? '', dateLine(person, this.g.dates, { names: 'none' }) ?? '', ...extra].join(' ')));
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
			// D218 rule 4: the relation word is italic, as on the cards and in the window rows; the rest of the text line is plain.
			const rest = WINDOW_UI.findRowSub('', dateLineShown(p, this.g.dates) ?? '', label?.title ?? p.title ?? '');
			let sub: HTMLElement | null = null;
			const paintSub = () => {
				sub?.remove();
				sub = null;
				const word = you ? '' : (this.relationOf(p.id)?.text ?? '');
				if (!word && !rest) return;
				sub = text.createDiv({ cls: 'dynasty-picker-sub', ...(word ? {} : { text: rest }) });
				if (word) sub.createEl('i', { text: word });
				// A span, not loose text: the order of the nodes stays the same for a reader that walks the children.
				if (word && rest) sub.createSpan({ text: ` · ${rest}` });
			};
			paintSub();
			// The portrait stands after the text, at the right, so the names line up with or without one (D213).
			const lead = personLead(el, { name: p.name, ...(p.portrait ? { portrait: p.portrait } : {}), ...(p.portraitCrop ? { portraitCrop: p.portraitCrop } : {}) }, this.rowPictures, 36);
			lead?.addClass('dynasty-picker-swatch');
			// The visible lines hold "maybe full" and "·"; a screen reader gets the sentence the cards use. A hidden
			// text, not aria-label: Obsidian shows an aria-label as a tooltip over the row.
			text.setAttribute('aria-hidden', 'true');
			const spoken = () => cardLabel(p, you ? 'you' : this.relationOf(p.id)?.lower, label, undefined, this.g.dates);
			const sr = el.createSpan({ cls: 'dynasty-sr-only', text: spoken() });
			// A row of a person whose word is not worked out yet gets it in place when its idle step has run.
			const words = this.wordsOf();
			if (!you && words && !words.known(p.id)) {
				const redraw = () => {
					paintSub();
					sr.setText(spoken());
				};
				this.pending.set(p.id, [...(this.pending.get(p.id) ?? []), redraw]);
			}
		}

		/** The relation of a person to the marked person (the card texts), or undefined. It never works one out: the render must stay cheap. */
		private relationOf(id: string): CardRelation | undefined {
			return this.wordsOf()?.peek(id);
		}

		/** The relation words of the whole tree to the marked person, or null with no valid mark. */
		private wordsOf(): CardLookup | null {
			if (this.words === undefined) {
				const me = this.ctx.me !== undefined ? this.ctx.me : this.you;
				const valid = me ? validMe(this.g, me) : null;
				this.words = valid ? relationsFor(this.g, valid, this.ctx.relationOptions, this.ctx.relationBlock).cards : null;
			}
			return this.words;
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
