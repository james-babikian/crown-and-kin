/*
 * The bar of focus mode (D246, F2): while a focus shows, a row at the top of the tree says "Focus on <person>" and has the link "Clear focus" at the right.
 * It has the look and the place of the relation finder's result bar (`.dynasty-result` in styles/18-more-list-finder-bar.css), so the tree view keeps the
 * tree clear of it with the code it has for that bar. The tree view decides when the bar shows and what a tap does; this file only builds the elements.
 */

/** What the bar says and does. The texts come from `FOCUS_UI`. */
export interface FocusBarOptions {
	/** The sentence, for example "Focus on Maud Valmont". */
	sentence: string;
	/** The words of the link. */
	clear: string;
	/** The accessible name of the link. */
	clearLabel: string;
	/** True in the full-screen view of a phone, where the bar is one row with a 44 px link. */
	phone: boolean;
	/** Called with true when the link was pressed by the keyboard (no pointer click). */
	onClear: (byKeyboard: boolean) => void;
}

/** Counts the bars so that each sentence has its own id for the group's label. */
let barIds = 0;

/** Builds the bar in `viewport`, before `before` (the canvas), so Tab reaches it after the toolbar and before the cards. Returns the bar. */
export function buildFocusBar(viewport: HTMLElement, before: HTMLElement, o: FocusBarOptions): HTMLElement {
	// Named by its sentence, not aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
	const id = `dynasty-focus-bar-${++barIds}`;
	const bar = viewport.createDiv({ cls: ['dynasty-result', 'dynasty-focus-bar', ...(o.phone ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
	viewport.insertBefore(bar, before);
	bar.createDiv({ cls: ['dynasty-result-text', 'dynasty-focus-bar-text'], text: o.sentence, attr: { id } });
	const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
	const clear = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', 'dynasty-focus-bar-clear'], text: o.clear, attr: { type: 'button', 'aria-label': o.clearLabel } });
	clear.addEventListener('click', (e) => o.onClear(!e.detail));
	return bar;
}
