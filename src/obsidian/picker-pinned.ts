/*
 * The row "A holder who is not in the tree" of the holder picker stays under the list, always in view (D334 Q7). The picker is Obsidian's
 * `SuggestModal`, whose list scrolls, so the row moves out of the list into a foot under it: a third row of the prompt grid on a phone, a row under the
 * scrolling list on a computer. It is still one of the rows of Obsidian's chooser, so the arrow keys and Enter reach it in the same order as before; only
 * the click must be handled here, because Obsidian listens for clicks on the list itself.
 */

/** Where the row goes and what a tap on it does. */
export interface Pin {
	/** The prompt (the modal element). */
	modalEl: HTMLElement;
	/** Obsidian's scrolling list; the foot stands right after it. */
	listEl: HTMLElement;
	/** Closes the picker with the row chosen. */
	choose: () => void;
}

/** The foot under the list, made on first use; null where the list has no parent (a test that has no prompt). */
function footOf(pin: Pin): HTMLElement | null {
	const parent = pin.listEl.parentElement;
	if (!parent) return null;
	let foot = parent.querySelector<HTMLElement>('.dynasty-picker-pinned');
	if (!foot) {
		foot = createDiv({ cls: 'dynasty-picker-pinned' });
		parent.insertBefore(foot, pin.listEl.nextSibling);
		pin.modalEl.addClass('has-pinned-row');
	}
	return foot;
}

/** Paints the row of a person who is not in the tree. With a `pin`, the row moves into the foot and a tap on it chooses it. */
export function paintNewRow(el: HTMLElement, text: string, pin: Pin | null): void {
	el.addClass('dynasty-picker-new');
	el.createSpan({ cls: 'dynasty-picker-swatch is-new', text: '+' });
	el.createSpan({ cls: 'dynasty-picker-name', text });
	const foot = pin ? footOf(pin) : null;
	if (!pin || !foot) return;
	foot.empty();
	foot.appendChild(el);
	el.addEventListener('click', () => pin.choose());
}

/** What the foot needs of the picker: its elements, and the two calls that choose a row (Obsidian closes a picker first, then calls `onChooseSuggestion`). */
export interface PinHost<T> {
	modalEl: HTMLElement;
	resultContainerEl: HTMLElement;
	close(): void;
	onChooseSuggestion(item: T): void;
}

/** The pin of the row `item` when `on` (the picker has its own row text: the holder picker), else null: the row stays in the list. */
export function pinFor<T>(on: boolean, host: PinHost<T>, item: T): Pin | null {
	return on ? { modalEl: host.modalEl, listEl: host.resultContainerEl, choose: () => (host.close(), host.onChooseSuggestion(item)) } : null;
}

/**
 * A list of more than one page does not hold the row in its first page (the row is last when the typed text matches people). The foot still shows it,
 * on its own; the page that holds it replaces it. `out` is the first page, `pool` the whole list.
 */
export function pinMissing<T extends { kind: string }>(pool: readonly T[], out: readonly T[], newRow: ((typed: string) => string) | null, host: PinHost<T>): void {
	const row = pool.find((i) => i.kind === 'new') as (T & { text: string }) | undefined;
	if (!row || !newRow || out.includes(row)) return;
	const el = createDiv({ cls: ['suggestion-item', 'dynasty-picker-row'] });
	paintNewRow(el, newRow(row.text), pinFor(true, host, row));
}
