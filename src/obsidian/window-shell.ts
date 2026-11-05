/*
 * The shell of the window family. Every plugin window draws its frame through `buildShell`: on a computer one scrolling body and a footer with
 * Cancel and Save (a hairline over the footer only while the body scrolls); on a phone a bar with Cancel, the title and
 * Save, where the title fades in when the header has scrolled away. A second page puts "‹ Name" in place of Cancel on a
 * phone and a back link above the header on a computer. The shell makes the frame only; the windows keep their own
 * draft, questions and writes. The class names `dynasty-sheet-title`, `-cancel`, `-save`, `-actions` and `-body` stay
 * from the old sheet, so a window keeps its tests and its `data-focus` names.
 *
 * The shell also holds the rules that every window shares: a window that has no header of its own shows its title on a computer in the
 * title role (D330 O-32); the left button reads Close once the window wrote something (O-13) and asks "Discard changes?" when a typed change
 * would be lost (O-14); on a computer Ctrl+Enter (Cmd+Enter on a Mac) saves and the Save button shows the keys (O-15).
 */

import { setIcon } from 'obsidian';
import { SHEET } from '../render/ui-text';
import { clearWindowError, saveKeysFor, windowError } from './sheet-parts';

/** The title role of a window title (`styles/01-base.css`): `tool` for the plugin's own windows ("Titles", "Calendars"), `name` for the name of a person or a couple. */
export type TitleRole = 'tool' | 'name';

/** What a window gives its shell. */
interface ShellOptions {
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	/** The name of the dialog (the title of the phone bar). */
	title: string;
	/**
	 * A computer window with no header of its own shows its title as the first line, in this role. Without it the title is for a screen reader
	 * only (the window draws a header with the name, or a heading of its own). A phone bar is not changed by it.
	 */
	titleRole?: TitleRole;
	/** The title of the phone bar shows at once (a list page, a small window), not only after the header scrolled away. */
	titled?: boolean;
	/** The label of the left button; "Cancel" by default ("Close" for a window that has nothing to save, or that already wrote something). */
	cancelLabel?: string;
	/** The label of the right button; null: no Save button. */
	saveLabel?: string | null;
	onCancel: () => void;
	onSave?: () => void;
	/**
	 * O-14: the left button asks the same question as Esc when a typed change would be lost. `dirty` says so; `ask` is the window's own Esc
	 * path (its `close()`, which shows "Discard changes?"). Without it the left button runs `onCancel` at once.
	 */
	discard?: { dirty: () => boolean; ask: () => void };
	/**
	 * O-15: Ctrl+Enter (Cmd+Enter on a Mac) presses the right button on a computer, and the button shows the keys. The default is on when the right
	 * button reads "Save"; `false` turns it off. A phone and a tablet never have it.
	 */
	saveKeys?: boolean;
	/** More class names and the `data-focus` names of the two buttons, for a window whose tests and focus rules name them (the ID window). */
	buttons?: { cancel?: { cls?: string[]; focus?: string }; save?: { cls?: string[]; focus?: string } };
	/** A second action next to Save: "Save and add another child". It stands left in the footer, on a second row of the phone bar. */
	extra?: { text: string; focus: string; run: () => void };
}

/** The parts of a drawn shell. */
export interface Shell {
	body: HTMLElement;
	/** The phone bar (null on a computer). */
	bar: HTMLElement | null;
	/** The footer (null on a phone). */
	foot: HTMLElement | null;
	titleEl: HTMLElement;
	cancel: HTMLButtonElement;
	save: HTMLButtonElement | null;
	extra: HTMLButtonElement | null;
	/** Sets the name of the dialog and the title of the phone bar; `always`: the bar shows it before the header scrolls away. */
	setTitle(text: string, always?: boolean): void;
	/** O-13: the label of the left button: `SHEET.close` once the window wrote something, `SHEET.cancel` while it only edits. A phone back link keeps its own label. */
	setCancelLabel(text: string): void;
	/** The label of the right button, for the time a write runs ("Wait"); the keys come back with the plain "Save". */
	setSaveLabel(text: string): void;
	/** A second page: the way back, with the name of the earlier page. Null: no way back (Cancel again). */
	setBack(label: string | null, aria: string, run: () => void): void;
	/** An error about the whole window, under the header of the body (ruling 4). `after` names the header when it is not the first `.dynasty-head`. */
	windowError(text: string, after?: HTMLElement | null): HTMLElement;
	/** Takes that error away. */
	clearWindowError(): void;
	/** Reads again whether the body scrolls (the footer line). */
	checkOverflow(): void;
	/** Lets go of the observers and the key listener. */
	dispose(): void;
}

/** The scroll distance after which the phone bar shows its title and its line (56 px). */
const BAR_SCROLL = 56;

/** O-13: the label of the left button for what the window did: it edits (Cancel), it wrote something (Close) or it only shows (Close). */
export function cancelLabelFor(state: 'edit' | 'wrote' | 'show'): string {
	return state === 'edit' ? SHEET.cancel : SHEET.close;
}

/** The parts that each frame (bar or footer) makes. */
interface Frame {
	body: HTMLElement;
	bar: HTMLElement | null;
	foot: HTMLElement | null;
	titleEl: HTMLElement;
	cancel: HTMLButtonElement;
	save: HTMLButtonElement | null;
	extra: HTMLButtonElement | null;
}


/** What the left button does now: its label, and the way back that a phone shows in its place on a second page. */
interface CancelState {
	text: string;
	back: (() => void) | null;
}

/** Makes a button of the shell that runs `run` on a click. */
function makeButton(parent: HTMLElement, cls: string[], text: string, focus: string, run: () => void): HTMLButtonElement {
	const b = parent.createEl('button', { cls, text, attr: { type: 'button', 'data-focus': focus } });
	b.addEventListener('click', () => run());
	return b;
}

/** The frame of a phone: a bar with Cancel, the title and Save, and the body under it. */
function phoneFrame(o: ShellOptions, cancelText: string, press: () => void): Frame {
	const bar = o.contentEl.createDiv({ cls: ['dynasty-sheet-header', 'dynasty-bar'] });
	const cancel = makeButton(bar, ['dynasty-sheet-cancel', 'dynasty-bar-btn', ...(o.buttons?.cancel?.cls ?? [])], cancelText, o.buttons?.cancel?.focus ?? 'cancel', press);
	const titleEl = bar.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-bar-title'], text: o.title });
	let save: HTMLButtonElement | null = null;
	if (o.saveLabel !== null && o.onSave) save = makeButton(bar, ['mod-cta', 'dynasty-sheet-save', 'dynasty-bar-btn', 'is-main', ...(o.buttons?.save?.cls ?? [])], o.saveLabel ?? SHEET.save, o.buttons?.save?.focus ?? 'save', o.onSave);
	else bar.createSpan();
	const extra = o.extra ? makeButton(bar, ['dynasty-sheet-save-another', 'dynasty-bar-extra'], o.extra.text, o.extra.focus, o.extra.run) : null;
	const body = o.contentEl.createDiv({ cls: 'dynasty-sheet-body' });
	bar.toggleClass('is-titled', !!o.titled);
	return { body, bar, foot: null, titleEl, cancel, save, extra };
}

/** The frame of a computer: the title (visible only when the window asks for it), the body and the footer. */
function computerFrame(o: ShellOptions, cancelText: string, press: () => void): Frame {
	// A window that draws a header of its own keeps the title for a screen reader; a window with none shows it in its role (O-32).
	const role = o.titleRole;
	const titleEl = role
		? o.contentEl.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-title', role === 'name' ? 'is-name' : 'is-tool'], text: o.title })
		: o.contentEl.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-sr-only'], text: o.title });
	const body = o.contentEl.createDiv({ cls: 'dynasty-sheet-body' });
	const foot = o.contentEl.createDiv({ cls: ['dynasty-sheet-actions', 'dynasty-foot'] });
	const extra = o.extra ? makeButton(foot.createDiv({ cls: 'dynasty-foot-left' }), ['dynasty-sheet-save-another'], o.extra.text, o.extra.focus, o.extra.run) : null;
	const cancel = makeButton(foot, ['dynasty-sheet-cancel', ...(o.buttons?.cancel?.cls ?? [])], cancelText, o.buttons?.cancel?.focus ?? 'cancel', press);
	let save: HTMLButtonElement | null = null;
	if (o.saveLabel !== null && o.onSave) save = makeButton(foot, ['mod-cta', 'dynasty-sheet-save', ...(o.buttons?.save?.cls ?? [])], o.saveLabel ?? SHEET.save, o.buttons?.save?.focus ?? 'save', o.onSave);
	return { body, bar: null, foot, titleEl, cancel, save, extra };
}

/** O-14: the left button asks the window's own "Discard changes?" question when a typed change would be lost; otherwise it runs `onCancel`. */
function askOrCancel(o: ShellOptions): void {
	let ask = false;
	try {
		ask = o.discard?.dirty() ?? false;
	} catch (e) {
		console.error('Crown and Kin: the window could not tell whether it has changes', e);
	}
	if (ask) o.discard?.ask();
	else o.onCancel();
}

/**
 * O-15: the quiet key text beside "Save". The accessible name is the visible text (WCAG 2.5.3, axe label-content-name-mismatch),
 * so the key text stays in the name and a separate attribute announces the shortcut.
 */
function showSaveKeys(save: HTMLButtonElement, keys: string): void {
	save.appendText(' ');
	save.createSpan({ cls: 'dynasty-save-keys', text: keys });
	save.setAttribute('aria-keyshortcuts', keys === SHEET.saveKeysCmd ? 'Meta+Enter' : 'Control+Enter');
}

/**
 * O-15: Ctrl+Enter (Cmd+Enter on a Mac) presses the Save button of a computer window. Nothing happens while a question stands over the window,
 * while an input method accepts its text, or while the button is off. Returns the function that removes the listener.
 */
function bindSaveKey(modalEl: HTMLElement, save: HTMLButtonElement): () => void {
	const key = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing || e.keyCode === 229) return;
		e.preventDefault();
		if (save.disabled || !save.isConnected || modalEl.querySelector('.dynasty-sheet-confirm')) return;
		save.click();
	};
	modalEl.addEventListener('keydown', key);
	return () => modalEl.removeEventListener('keydown', key);
}

/** Watches the body: the title of the phone bar after a scroll, and on a computer the footer line (whether the body scrolls). Returns the clean-ups. */
function watchBody(modalEl: HTMLElement, f: Frame, checkOverflow: () => void): (() => void)[] {
	const { body, bar } = f;
	const cleanup: (() => void)[] = [];
	if (bar) {
		const onScroll = () => bar.toggleClass('is-scrolled', body.scrollTop > BAR_SCROLL);
		body.addEventListener('scroll', onScroll);
		cleanup.push(() => body.removeEventListener('scroll', onScroll));
		return cleanup;
	}
	const win = modalEl.win;
	const Observer = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	if (typeof Observer === 'function') {
		const ro = new Observer(() => checkOverflow());
		ro.observe(body);
		cleanup.push(() => ro.disconnect());
	}
	// A section that opens moves the content, not the box of the body: look again when its change has ended.
	body.addEventListener('transitionend', checkOverflow);
	cleanup.push(() => body.removeEventListener('transitionend', checkOverflow));
	(win.requestAnimationFrame ?? ((fn: () => void) => fn()))(() => checkOverflow());
	return cleanup;
}

/** A second page: on a phone the left button becomes "‹ Name"; on a computer a back link stands at the top of the body. */
function backControl(f: Frame, o: ShellOptions, st: CancelState): Shell['setBack'] {
	const { body, bar, cancel } = f;
	return (label, aria, run) => {
		if (bar) {
			cancel.empty();
			st.back = label !== null ? run : null;
			// The focus name of the way back is the same on a phone and on a computer.
			cancel.setAttribute('data-focus', label !== null ? 'back' : (o.buttons?.cancel?.focus ?? 'cancel'));
			if (label !== null) {
				setIcon(cancel.createSpan({ cls: 'dynasty-bar-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-left');
				cancel.createSpan({ text: label });
				cancel.setAttribute('aria-label', aria);
				cancel.addClass('is-back');
			} else {
				cancel.setText(st.text);
				cancel.removeAttribute('aria-label');
				cancel.removeClass('is-back');
			}
			return;
		}
		body.querySelector('.dynasty-back')?.remove();
		if (label === null) return;
		const back = body.createDiv({ cls: 'dynasty-back-row' });
		const b = back.createEl('button', { cls: 'dynasty-back', attr: { type: 'button', 'aria-label': aria, 'data-focus': 'back' } });
		setIcon(b.createSpan({ cls: 'dynasty-back-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-left');
		b.createSpan({ text: label });
		b.addEventListener('click', () => run());
		body.prepend(back);
	};
}

/** Draws the frame of a window into `contentEl` (which the caller has emptied) and returns its parts. */
export function buildShell(o: ShellOptions): Shell {
	const { contentEl, modalEl } = o;
	const phone = modalEl.hasClass('is-phone');
	contentEl.addClass('dynasty-sheet-content');
	modalEl.toggleClass('is-bar', phone);
	const st: CancelState = { text: o.cancelLabel ?? SHEET.cancel, back: null };
	const press = (): void => (st.back ? st.back() : askOrCancel(o));
	const f = phone ? phoneFrame(o, st.text, press) : computerFrame(o, st.text, press);
	const { body, bar, save } = f;

	const saveText = o.saveLabel ?? SHEET.save;
	const keys = save && !phone && (o.saveKeys ?? saveText === SHEET.save) ? saveKeysFor(modalEl.win) : null;
	if (save && keys) showSaveKeys(save, keys);
	const checkOverflow = () => modalEl.toggleClass('has-overflow', body.scrollHeight > body.clientHeight + 2);
	const cleanup = watchBody(modalEl, f, checkOverflow);
	if (save && keys) cleanup.push(bindSaveKey(modalEl, save));

	return {
		...f,
		setTitle(text, always = false) {
			f.titleEl.setText(text);
			bar?.toggleClass('is-titled', always);
		},
		setCancelLabel(text) {
			st.text = text;
			// A phone back link shows the earlier page; the label comes back with Cancel.
			if (!st.back) f.cancel.setText(text);
		},
		setSaveLabel(text) {
			if (!save) return;
			save.setText(text);
			save.removeAttribute('aria-keyshortcuts');
			if (keys && text === saveText) showSaveKeys(save, keys);
		},
		setBack: backControl(f, o, st),
		windowError: (text, after) => windowError(body, text, after),
		clearWindowError: () => clearWindowError(body),
		checkOverflow,
		dispose() {
			for (const c of cleanup.splice(0)) c();
		},
	};
}
