/*
 * The low bar that stands in place of a very large tree (D223, D226, D227; spec §7.7): a small tree icon, the message and one button.
 * Above the first limit the button is "Draw the tree"; a bar that never draws (above the top, or a draw that took too long) has "Choose a person",
 * which opens the person picker and then the family of the chosen person. It is a group with a text that a screen reader reads when it changes;
 * the buttons are plain buttons, so the keyboard reaches them. Colours and sizes come from `styles/36-large-tree.css`. The tree view decides which
 * bar shows (`large-tree.ts`) and what a tap does.
 */

import { setIcon } from 'obsidian';
import { LARGE_UI } from '../render/ui-text';
import type { LargeBar } from '../view/large-tree';

/** The parts of a built bar that the tree view keeps. */
export interface LargeBarParts {
	bar: HTMLElement;
	/** The button of the `ask` bar; null for the others. */
	button: HTMLButtonElement | null;
	/** The button "Choose a person" of the bars that do not draw; null for the `ask` bar. */
	choose: HTMLButtonElement | null;
}

/** What a tap on a button does. */
export interface LargeBarActions {
	onDraw: () => void;
	onChoose: () => void;
}

/** Numbers the bars, for their `aria-labelledby`. */
let barIds = 0;

/** The message of a bar. The phone's full-screen view names the whole tree as the thing that does not draw (spec §7.7). */
export function largeText(bar: LargeBar, count: number, phoneFull: boolean): string {
	if (bar.kind === 'ask') return LARGE_UI.ask(count);
	if (bar.kind === 'slow') return LARGE_UI.slow;
	if (bar.family) return LARGE_UI.focusTop(count, bar.limit);
	return phoneFull ? LARGE_UI.phoneTop(count, bar.limit) : LARGE_UI.top(count, bar.limit);
}

/** Builds the bar in `parent`. */
export function buildLargeBar(parent: HTMLElement, bar: LargeBar, count: number, phoneFull: boolean, actions: LargeBarActions): LargeBarParts {
	// Named by a hidden text, not an aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
	const id = `dynasty-large-${++barIds}`;
	const el = parent.createDiv({ cls: 'dynasty-large-bar', attr: { role: 'group', 'aria-labelledby': id, 'data-dynasty-large': bar.kind } });
	el.createSpan({ cls: 'dynasty-sr-only', text: LARGE_UI.region, attr: { id } });
	setIcon(el.createSpan({ cls: 'dynasty-large-icon', attr: { 'aria-hidden': 'true' } }), 'network');
	el.createDiv({ cls: 'dynasty-large-text', text: largeText(bar, count, phoneFull) });
	const action = el.createDiv({ cls: 'dynasty-large-action' });
	if (bar.kind !== 'ask') {
		const choose = action.createEl('button', { cls: ['dynasty-large-button', 'dynasty-large-choose'], text: bar.family ? LARGE_UI.chooseOtherButton : LARGE_UI.chooseButton, attr: { type: 'button' } });
		choose.addEventListener('click', actions.onChoose);
		return { bar: el, button: null, choose };
	}
	// The live text exists before it has words, so a screen reader announces the words when they come.
	action.createDiv({ cls: 'dynasty-large-live', attr: { 'aria-live': 'polite' } });
	const button = action.createEl('button', { cls: ['dynasty-large-button', 'dynasty-large-draw'], text: LARGE_UI.drawButton, attr: { type: 'button' } });
	button.addEventListener('click', actions.onDraw);
	return { bar: el, button, choose: null };
}

/** A tap: the button gives way to a short text (spec §7.7), so nothing is tapped twice and the user sees that the work starts. */
export function showBusy(parts: LargeBarParts): void {
	parts.button?.remove();
	parts.bar.querySelector<HTMLElement>('.dynasty-large-live')?.setText(LARGE_UI.busy);
}
