/*
 * The shell of the window family. Every plugin window draws its frame through `buildShell`: on a computer one scrolling body and a footer with
 * Cancel and Save (a hairline over the footer only while the body scrolls); on a phone a bar with Cancel, the title and
 * Save, where the title fades in when the header has scrolled away. A second page puts "‹ Name" in place of Cancel on a
 * phone and a back link above the header on a computer. The shell makes the frame only; the windows keep their own
 * draft, questions and writes. The class names `dynasty-sheet-title`, `-cancel`, `-save`, `-actions` and `-body` stay
 * from the old sheet, so a window keeps its tests and its `data-focus` names.
 */

import { setIcon } from 'obsidian';
import { SHEET } from '../render/ui-text';

/** What a window gives its shell. */
export interface ShellOptions {
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	/** The name of the dialog (the title of the phone bar). */
	title: string;
	/** The title of the phone bar shows at once (a list page, a small window), not only after the header scrolled away. */
	titled?: boolean;
	/** The label of the left button; "Cancel" by default ("Close" for a window that has nothing to save). */
	cancelLabel?: string;
	/** The label of the right button; null: no Save button. */
	saveLabel?: string | null;
	onCancel: () => void;
	onSave?: () => void;
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
	/** A second page: the way back, with the name of the earlier page. Null: no way back (Cancel again). */
	setBack(label: string | null, aria: string, run: () => void): void;
	/** Reads again whether the body scrolls (the footer line). */
	checkOverflow(): void;
	/** Lets go of the observers. */
	dispose(): void;
}

/** The scroll distance after which the phone bar shows its title and its line (56 px). */
const BAR_SCROLL = 56;

/** Draws the frame of a window into `contentEl` (which the caller has emptied) and returns its parts. */
export function buildShell(o: ShellOptions): Shell {
	const { contentEl, modalEl } = o;
	const phone = modalEl.hasClass('is-phone');
	contentEl.addClass('dynasty-sheet-content');
	modalEl.toggleClass('is-bar', phone);
	let titleEl: HTMLElement;
	let bar: HTMLElement | null = null;
	let foot: HTMLElement | null = null;
	let cancel: HTMLButtonElement;
	let save: HTMLButtonElement | null = null;
	let extra: HTMLButtonElement | null = null;
	const cancelText = o.cancelLabel ?? SHEET.cancel;
	// On a phone the left button is the way back on a second page.
	let cancelRun = o.onCancel;
	const make = (parent: HTMLElement, cls: string[], text: string, focus: string, run: () => void): HTMLButtonElement => {
		const b = parent.createEl('button', { cls, text, attr: { type: 'button', 'data-focus': focus } });
		b.addEventListener('click', () => run());
		return b;
	};
	let body: HTMLElement;
	if (phone) {
		bar = contentEl.createDiv({ cls: ['dynasty-sheet-header', 'dynasty-bar'] });
		cancel = make(bar, ['dynasty-sheet-cancel', 'dynasty-bar-btn', ...(o.buttons?.cancel?.cls ?? [])], cancelText, o.buttons?.cancel?.focus ?? 'cancel', () => cancelRun());
		titleEl = bar.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-bar-title'], text: o.title });
		if (o.saveLabel !== null && o.onSave) save = make(bar, ['mod-cta', 'dynasty-sheet-save', 'dynasty-bar-btn', 'is-main', ...(o.buttons?.save?.cls ?? [])], o.saveLabel ?? SHEET.save, o.buttons?.save?.focus ?? 'save', o.onSave);
		else bar.createSpan();
		if (o.extra) extra = make(bar, ['dynasty-sheet-save-another', 'dynasty-bar-extra'], o.extra.text, o.extra.focus, o.extra.run);
		body = contentEl.createDiv({ cls: 'dynasty-sheet-body' });
		bar.toggleClass('is-titled', !!o.titled);
	} else {
		// A computer window has no visible title: its first heading is the header of the page. The name is for a screen reader.
		titleEl = contentEl.createDiv({ cls: ['dynasty-sheet-title', 'dynasty-sr-only'], text: o.title });
		body = contentEl.createDiv({ cls: 'dynasty-sheet-body' });
		foot = contentEl.createDiv({ cls: ['dynasty-sheet-actions', 'dynasty-foot'] });
		if (o.extra) {
			const left = foot.createDiv({ cls: 'dynasty-foot-left' });
			extra = make(left, ['dynasty-sheet-save-another'], o.extra.text, o.extra.focus, o.extra.run);
		}
		cancel = make(foot, ['dynasty-sheet-cancel', ...(o.buttons?.cancel?.cls ?? [])], cancelText, o.buttons?.cancel?.focus ?? 'cancel', o.onCancel);
		if (o.saveLabel !== null && o.onSave) save = make(foot, ['mod-cta', 'dynasty-sheet-save', ...(o.buttons?.save?.cls ?? [])], o.saveLabel ?? SHEET.save, o.buttons?.save?.focus ?? 'save', o.onSave);
	}

	const checkOverflow = () => {
		modalEl.toggleClass('has-overflow', body.scrollHeight > body.clientHeight + 2);
	};
	const onScroll = () => bar?.toggleClass('is-scrolled', body.scrollTop > BAR_SCROLL);
	const cleanup: (() => void)[] = [];
	if (phone) {
		body.addEventListener('scroll', onScroll);
		cleanup.push(() => body.removeEventListener('scroll', onScroll));
	} else {
		const win = modalEl.win ?? window;
		const Observer = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (typeof Observer === 'function') {
			const ro = new Observer(() => checkOverflow());
			ro.observe(body);
			cleanup.push(() => ro.disconnect());
		}
		// A section that opens moves the content, not the box of the body: look again when its change has ended.
		body.addEventListener('transitionend', checkOverflow);
		cleanup.push(() => body.removeEventListener('transitionend', checkOverflow));
		(win.requestAnimationFrame ?? ((f: () => void) => f()))(() => checkOverflow());
	}

	return {
		body,
		bar,
		foot,
		titleEl,
		cancel,
		save,
		extra,
		setTitle(text, always = false) {
			titleEl.setText(text);
			bar?.toggleClass('is-titled', always);
		},
		setBack(label, aria, run) {
			if (bar) {
				cancel.empty();
				cancelRun = label !== null ? run : o.onCancel;
				// The focus name of the way back is the same on a phone and on a computer.
				cancel.setAttribute('data-focus', label !== null ? 'back' : (o.buttons?.cancel?.focus ?? 'cancel'));
				if (label !== null) {
					setIcon(cancel.createSpan({ cls: 'dynasty-bar-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-left');
					cancel.createSpan({ text: label });
					cancel.setAttribute('aria-label', aria);
					cancel.addClass('is-back');
				} else {
					cancel.setText(cancelText);
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
		},
		checkOverflow,
		dispose() {
			for (const c of cleanup.splice(0)) c();
		},
	};
}
