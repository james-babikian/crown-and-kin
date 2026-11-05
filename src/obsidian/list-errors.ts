/*
 * The errors of a list window (the Titles and Houses windows), under the one rule of D330 CX-11: an error about the whole window stands under the header, and an
 * error about one field stands under that field and gives it the error edge. Both survive a new draw of the window, which makes every element again.
 */

import { clearFieldError, fieldError } from './sheet-parts';
import type { Shell } from './window-shell';

/** What the errors need from their window. */
interface ErrorHost {
	shell(): Shell | null;
	root(): HTMLElement;
}

/** Holds the error of the window and the error of one field, and shows and takes away both. */
export class ListErrors {
	/** The text of the error about the whole window; empty when there is none. */
	text = '';
	private field: { focus: string; text: string } | null = null;

	constructor(private readonly host: ErrorHost) {}

	/** Shows `text` under the header and keeps it for the next draw. */
	show(text: string): void {
		this.text = text;
		this.host.shell()?.windowError(text);
	}

	/** Shows `text` under the field named `focus` (its `data-focus`) and keeps it for the next draw. */
	showField(focus: string, text: string): void {
		this.field = { focus, text };
		this.reapply(true);
	}

	/** Draws both errors again after a new draw of the window; `focus` moves the focus to the field. */
	reapply(focus: boolean): void {
		if (this.text) this.host.shell()?.windowError(this.text);
		const el = this.fieldEl();
		if (this.field && el) fieldError(el, this.field.text, { focus });
	}

	/** Takes both errors away; the text goes too, so a hidden line never keeps an old message that a screen reader can read. */
	clear(): void {
		const el = this.fieldEl();
		this.text = '';
		this.field = null;
		this.host.shell()?.clearWindowError();
		if (el) clearFieldError(el);
	}

	private fieldEl(): HTMLElement | null {
		return this.field ? this.host.root().querySelector<HTMLElement>(`[data-focus="${this.field.focus}"]`) : null;
	}
}
