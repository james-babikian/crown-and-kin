/*
 * Small pieces shared by the sheet-style windows (the edit sheet, the Houses window, the
 * partnership editor): a labelled form row, the stale check before a write, turning a failed
 * write into the window's own message, the one rule for an error (under its field, or under the header), the
 * keys of a window on a computer, and a safe house colour for CSS.
 */

import { normBody } from '../core/block-match';
import type { EditResult } from '../core/edit';
import { isColour } from '../render/colour-check';
import { watchMarks } from '../render/dom/name-marks';
import { mediaMatches } from '../render/dom/page-reads';
import { SHEET } from '../render/ui-text';
import type { Handle, HandleWriteOutcome } from './block-handle';
import { revealTarget } from './modal-layout';

// The windows of the list family make their refusal Notices with it.
export { noticeText } from '../render/dom/name-marks';

/** A value CSS can draw (a house colour can be any CSS colour, spec §4.1); `#rrggbb` where CSS cannot say. */
export const drawableColour = isColour;

/** `prefix` and a short random tail: the id of an element that another element points to (a label, a hint, a title). */
export function uniqueId(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Makes a window a dialog that a screen reader can name: role, aria-modal and aria-labelledby (its title). Returns the
 * title so a call can wrap the line that makes it. A window that draws its title again calls this again.
 */
export function nameDialog(modalEl: HTMLElement, title: HTMLElement): HTMLElement {
	const id = uniqueId('dynasty-dialog-title');
	title.setAttribute('id', id);
	modalEl.setAttribute('role', 'dialog');
	modalEl.setAttribute('aria-modal', 'true');
	modalEl.setAttribute('aria-labelledby', id);
	// Every window names its dialog here: the names in its texts become isolate spans (D322).
	watchMarks(modalEl);
	return title;
}

/**
 * Scrolls the focused field of a window, with its hint, into the visible part, above the keyboard. A browser does this only for
 * its own scroller and only some of the time; the field sits inside `.dynasty-sheet-body`, which scrolls. `delay` waits
 * for the keyboard to finish opening.
 */
export function revealFocused(modalEl: HTMLElement, contentEl: HTMLElement, delay = 0): void {
	const run = () => {
		const a = modalEl.doc.activeElement as HTMLElement | null;
		if (a && contentEl.contains(a) && a.matches('input, select, textarea')) revealTarget(a, modalEl).scrollIntoView({ block: 'nearest' });
	};
	if (delay) modalEl.win.setTimeout(run, delay);
	else run();
}

/** A labelled row of a sheet form; `id` joins the label to the control that the caller adds to `row`. */
export function sheetField(parent: HTMLElement, label: string, name: string, idPrefix = 'dynasty-sheet'): { row: HTMLElement; id: string } {
	const row = parent.createDiv({ cls: 'dynasty-sheet-field', attr: { 'data-field': name } });
	const id = uniqueId(`${idPrefix}-${name}`);
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

/** True when the first pointer is a mouse or a trackpad. A touch screen (a phone or a tablet) has no window keys (spec §7). */
export function onComputer(win: Window): boolean {
	return !mediaMatches(win, '(pointer: coarse)');
}

/** True on an Apple computer, where the shown key is Cmd. Only the label of a key uses it; the shortcut takes either key. */
function appleKeyboard(win: Window): boolean {
	try {
		return /Mac/i.test((win as { navigator?: { platform?: string } }).navigator?.platform ?? '');
	} catch {
		return false;
	}
}

/** O-15: the keys that save a window, as `SHEET.saveKeysCtrl` or `SHEET.saveKeysCmd`; null on a phone or a tablet, which show no keys. */
export function saveKeysFor(win: Window): string | null {
	if (!onComputer(win)) return null;
	return appleKeyboard(win) ? SHEET.saveKeysCmd : SHEET.saveKeysCtrl;
}

/** True for a field that Tab can reach now: on, shown, not taken out of the Tab order, and not in a closed section (those are hidden, not removed). */
function reachable(el: HTMLElement): boolean {
	if ((el as HTMLInputElement).disabled || el.getAttribute('tabindex') === '-1' || el.getAttribute('type') === 'hidden') return false;
	if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
	try {
		const win = el.win;
		return typeof win.getComputedStyle !== 'function' || win.getComputedStyle(el).visibility !== 'hidden';
	} catch {
		return true;
	}
}

/** The next field after `input` in its window body, or null when it is the last one. */
function nextField(input: HTMLElement): HTMLElement | null {
	const scope = input.closest<HTMLElement>('.dynasty-sheet-body') ?? input.closest<HTMLElement>('.dynasty-sheet-content');
	if (!scope) return null;
	const all = Array.from(scope.querySelectorAll<HTMLElement>('input, select, textarea'));
	return all.slice(all.indexOf(input) + 1).find(reachable) ?? null;
}

/**
 * F7, O-15: Enter in a single-line field ends the entry and never saves. On a computer the focus goes to the next field (the last field
 * lets go of it); on a phone or a tablet the field loses the focus, so the keyboard closes. An input method uses Enter to accept its
 * text (keyCode 229): that press is left alone. Ctrl or Cmd with Enter is the Save key of the window and is left to it.
 */
export function endEntryOnEnter(input: HTMLInputElement): void {
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey) return;
		e.preventDefault();
		const next = onComputer(input.win) ? nextField(input) : null;
		if (next) next.focus();
		else input.blur();
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
	el.scrollIntoView({ block: 'nearest' });
}

// ---------- the one rule for an error: under its field, or under the header ----------

/** The error text under each field that has one, so that a second error on the same field changes the first. */
const FIELD_ERRORS = new WeakMap<HTMLElement, HTMLElement>();

/** Adds or removes one id in the space-separated `aria-describedby` list of `field`; the other ids stay. */
function describeBy(field: HTMLElement, id: string, on: boolean): void {
	const ids = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t !== '' && t !== id);
	if (on) ids.push(id);
	if (ids.length > 0) field.setAttribute('aria-describedby', ids.join(' '));
	else field.removeAttribute('aria-describedby');
}

/** The element after which the error of a field stands: the field, or the box that holds it in its row (a select with its chevron). */
function errorAnchor(field: HTMLElement): HTMLElement {
	const row = field.closest<HTMLElement>('.dynasty-sheet-field');
	let anchor = field;
	while (row && anchor.parentElement && anchor.parentElement !== row) anchor = anchor.parentElement;
	return anchor;
}

/** Puts `el` into the child list of `parent` directly after `anchor`. */
function insertAfter(parent: HTMLElement, el: HTMLElement, anchor: HTMLElement): void {
	const kids = Array.from(parent.children) as HTMLElement[];
	parent.insertBefore(el, kids[kids.indexOf(anchor) + 1] ?? null);
}

/**
 * An error about one field: `text` stands directly under the field (semibold, in the error colour), the field gets `aria-invalid` (the error edge
 * comes from `styles/01-base.css`) and `aria-describedby` to the text, and, unless `focus` is false, takes the focus so a screen reader reads it.
 * The header does not move. Returns the text element. A second call on the same field changes the text. `clearFieldError` takes it away.
 */
export function fieldError(field: HTMLElement, text: string, o: { focus?: boolean } = {}): HTMLElement {
	const old = FIELD_ERRORS.get(field);
	let el = old;
	if (!el || !el.parentElement) {
		// The window took the old line away (its row was drawn again): its id must not stay in the list.
		if (old) describeBy(field, old.getAttribute('id') ?? '', false);
		el = createDiv({ cls: ['dynasty-sheet-error', 'dynasty-field-error'], attr: { role: 'alert', id: uniqueId('dynasty-field-error') } });
		const anchor = errorAnchor(field);
		if (anchor.parentElement) insertAfter(anchor.parentElement, el, anchor);
		FIELD_ERRORS.set(field, el);
	}
	el.setText(text);
	el.show();
	field.setAttribute('aria-invalid', 'true');
	describeBy(field, el.getAttribute('id') ?? '', true);
	if (o.focus !== false) {
		field.focus({ preventScroll: true });
		revealTarget(field).scrollIntoView({ block: 'nearest' });
	}
	return el;
}

/** Takes the error away from one field: the text, `aria-invalid` and the `aria-describedby` entry. A field with no error stays as it is. */
export function clearFieldError(field: HTMLElement): void {
	const el = FIELD_ERRORS.get(field);
	FIELD_ERRORS.delete(field);
	field.removeAttribute('aria-invalid');
	if (!el) return;
	describeBy(field, el.getAttribute('id') ?? '', false);
	el.remove();
}

/**
 * An error about the whole window: `text` stands under the header in `host` (the body of the window), or at its top when there is no header.
 * `after` names the header when it is not the first `.dynasty-head`. The header does not move. A window has one such line; a second call
 * changes its text. Returns the line.
 */
export function windowError(host: HTMLElement, text: string, after?: HTMLElement | null): HTMLElement {
	let el = host.querySelector<HTMLElement>('.dynasty-window-error');
	if (!el) {
		el = createDiv({ cls: ['dynasty-sheet-error', 'dynasty-window-error'], attr: { role: 'alert' } });
		const head = after ?? host.querySelector<HTMLElement>('.dynasty-head');
		if (head?.parentElement) insertAfter(head.parentElement, el, head);
		else host.prepend(el);
	}
	showErrorLine(el, text);
	return el;
}

/** Takes the error about the whole window away. */
export function clearWindowError(host: HTMLElement): void {
	host.querySelector<HTMLElement>('.dynasty-window-error')?.remove();
}
