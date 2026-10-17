/*
 * Small pieces shared by the sheet-style windows (the edit sheet, the Houses window, the
 * partnership editor): a labelled form row, the stale check before a write, turning a failed
 * write into the window's own message, and a safe house colour for CSS.
 */

import { normBody } from '../core/block-match';
import type { EditResult } from '../core/edit';
import { isColour } from '../render/colour-check';
import type { Handle, HandleWriteOutcome } from './block-handle';

/** A value CSS can draw (a house colour can be any CSS colour, spec §4.1); `#rrggbb` where CSS cannot say. */
export const drawableColour = isColour;

/**
 * Makes a window a dialog that a screen reader can name: role, aria-modal and aria-labelledby (its title). Returns the
 * title so a call can wrap the line that makes it. A window that draws its title again calls this again.
 */
export function nameDialog(modalEl: HTMLElement, title: HTMLElement): HTMLElement {
	const id = `dynasty-dialog-title-${Math.random().toString(36).slice(2, 8)}`;
	title.setAttribute('id', id);
	modalEl.setAttribute('role', 'dialog');
	modalEl.setAttribute('aria-modal', 'true');
	modalEl.setAttribute('aria-labelledby', id);
	return title;
}

/**
 * Scrolls the focused field of a window into the visible part, above the keyboard (C1). A browser does this only for
 * its own scroller and only some of the time; the field sits inside `.dynasty-sheet-body`, which scrolls. `delay` waits
 * for the keyboard to finish opening.
 */
export function revealFocused(modalEl: HTMLElement, contentEl: HTMLElement, delay = 0): void {
	const run = () => {
		const a = modalEl.doc.activeElement as HTMLElement | null;
		if (a && contentEl.contains(a) && a.matches('input, select, textarea')) a.scrollIntoView({ block: 'nearest' });
	};
	if (delay) (modalEl.win ?? window).setTimeout(run, delay);
	else run();
}

/** A labelled row of a sheet form; `id` joins the label to the control that the caller adds to `row`. */
export function sheetField(parent: HTMLElement, label: string, name: string, idPrefix = 'dynasty-sheet'): { row: HTMLElement; id: string } {
	const row = parent.createDiv({ cls: 'dynasty-sheet-field', attr: { 'data-field': name } });
	const id = `${idPrefix}-${name}-${Math.random().toString(36).slice(2, 8)}`;
	row.createEl('label', { cls: 'dynasty-sheet-label', text: label, attr: { for: id } });
	return { row, id };
}

/** True if a window that shows the body `shown` shows the handle's current body; otherwise calls `stale` and returns false (spec §6.1). */
export function freshOrStale(h: Pick<Handle, 'body'>, shown: string, stale: (body: string) => void): boolean {
	if (normBody(h.body) === normBody(shown)) return true;
	stale(h.body);
	return false;
}

/** Sends a failed write to the window's reaction for it; the detail of a refusal goes to the console. */
export function onWriteFailed(
	out: Exclude<HandleWriteOutcome, { ok: true }>,
	on: { stale(): void; missing(): void; refused(code: Extract<EditResult, { ok: false }>['code']): void },
): void {
	if (out.code !== 'refused') {
		if (out.code === 'stale') on.stale();
		else on.missing();
		return;
	}
	if (out.refusal.detail) console.warn('Crown and Kin: the edit was refused:', out.refusal.detail);
	on.refused(out.refusal.code);
}

/**
 * F7: Enter in a single-line field ends the entry (the field loses the focus, so a phone keyboard closes) and never saves.
 * An input method uses Enter to accept its text (keyCode 229): that press is left alone.
 */
export function endEntryOnEnter(input: HTMLInputElement): void {
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
		e.preventDefault();
		input.blur();
	});
}

/**
 * Resolves after the browser has painted what the caller changed just before (one frame). A frame callback runs before the paint, so the
 * timer inside it runs after the paint. `maxMs` ends the wait if frames are paused (a hidden window), so a write is never held for long.
 */
export function afterPaint(win: Pick<Window, 'requestAnimationFrame' | 'setTimeout' | 'clearTimeout'>, maxMs = 100): Promise<void> {
	return new Promise((resolve) => {
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			win.clearTimeout(limit);
			resolve();
		};
		const limit = win.setTimeout(finish, maxMs);
		win.requestAnimationFrame(() => win.setTimeout(finish, 0));
	});
}

/** Shows `text` in the error line of a window (a `role="alert"` element) and scrolls it into view. */
export function showErrorLine(el: HTMLElement | null, text: string): void {
	if (!el) return;
	el.setText(text);
	el.show();
	el.scrollIntoView?.({ block: 'nearest' });
}
