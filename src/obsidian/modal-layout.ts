/*
 * Phone layout for the plugin's modals (spec §7.4): below 600 px the modal fills the visible
 * area, and follows it when the on-screen keyboard makes it smaller, so a sticky header stays
 * reachable. Every sheet, choice and picker uses this.
 */

import type { Modal } from 'obsidian';
import { PHONE_MAX_WIDTH } from '../render/view-math';

/** The phone layout of the plugin's modals: a window narrower than 600 px (spec §7.4). */
export function isPhoneWidth(win: Window): boolean {
	return win.innerWidth < PHONE_MAX_WIDTH;
}

/** The smallest sheet height that the keyboard may leave; a sheet below this cannot be used. */
const MIN_VISIBLE = 200;

/** Reads a CSS length in px (`301px`, `301`); anything else, a negative number or nothing is 0. */
export function parseKeyboardHeight(raw: string | null | undefined): number {
	const m = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(raw ?? '');
	return m ? parseFloat(m[1]) : 0;
}

/**
 * The height of the visible area for a sheet. On an iPhone the keyboard does not shrink the viewport; Obsidian only sets
 * `--keyboard-height`. A viewport that did shrink already (`shrunk`) has taken that much of the keyboard off, so only the rest counts.
 */
export function visibleHeight(viewport: number, keyboard: number, shrunk: number): number {
	const rest = Math.max(0, keyboard - Math.max(0, shrunk));
	return Math.max(viewport - rest, Math.min(viewport, MIN_VISIBLE));
}

/** The keyboard height that Obsidian's native layer sets on the root element; read from the computed style so a stylesheet rule counts too. */
function readKeyboard(win: Window): number {
	try {
		return parseKeyboardHeight(win.getComputedStyle(win.document.documentElement).getPropertyValue('--keyboard-height'));
	} catch {
		return 0;
	}
}

/**
 * Keeps the `is-phone` class and the visible-area size up to date; returns the clean-up. The keyboard counts
 * from two sources: a smaller viewport, and Obsidian's `--keyboard-height` (the iPhone does not shrink the viewport).
 *
 * Close slide (P1): Obsidian slides a closing window down by its own height, read when `close()` starts, and removes
 * it at the end. If the keyboard goes down during the slide, the window grows with the visible area and the slide
 * no longer takes it off the screen: the lower half pops away at the end. So `close()` first stops the window from
 * following the visible area and makes its box as tall as the tallest visible area seen. The extra room is padding at
 * the bottom, so the content keeps its size and does not reflow; the slide then takes the whole box off the screen.
 */
export function phoneLayout(modal: Modal, onLayout?: () => void, holdAtClose = true): () => void {
	const el = modal.modalEl;
	const win = el.win ?? window;
	// The tallest visible height seen, the height now set, and whether a close has started.
	let tallest = 0;
	let shown = 0;
	let held = false;
	// The keyboard height of the last layout, and the tallest viewport seen (to tell a shrunk viewport from a keyboard that sits on top).
	let keyboard = 0;
	let restViewport = 0;
	const layout = () => {
		if (held) return;
		const phone = isPhoneWidth(win);
		el.toggleClass('is-phone', phone);
		const vv = win.visualViewport;
		keyboard = readKeyboard(win);
		if (phone && vv) {
			const seen = Math.min(vv.height, win.innerHeight);
			restViewport = Math.max(restViewport, seen);
			shown = Math.round(visibleHeight(seen, keyboard, restViewport - seen));
			tallest = Math.max(tallest, shown);
			el.style.setProperty('--dynasty-sheet-height', `${shown}px`);
			el.style.setProperty('--dynasty-sheet-top', `${Math.round(vv.offsetTop)}px`);
		} else {
			el.style.removeProperty('--dynasty-sheet-height');
			el.style.removeProperty('--dynasty-sheet-top');
		}
		onLayout?.();
	};
	layout();
	win.addEventListener('resize', layout);
	const vv = win.visualViewport;
	vv?.addEventListener('resize', layout);
	vv?.addEventListener('scroll', layout);
	// The keyboard height changes on the root element, with no resize event. A change of the inline style or the class
	// shows at once; a stylesheet rule shows at a focus change, so the height is read again then and after the keyboard animation.
	const recheck = () => {
		if (!held && readKeyboard(win) !== keyboard) layout();
	};
	const timers = new Set<number>();
	const onFocusChange = () => {
		recheck();
		for (const ms of [120, 350]) {
			const id = win.setTimeout(() => {
				timers.delete(id);
				recheck();
			}, ms);
			timers.add(id);
		}
	};
	const Observer = (win as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;
	const watcher = Observer ? new Observer(recheck) : null;
	watcher?.observe(win.document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
	win.addEventListener('focusin', onFocusChange);
	win.addEventListener('focusout', onFocusChange);

	const release = () => {
		if (!held) return;
		held = false;
		el.removeClass('is-holding');
		el.style.removeProperty('--dynasty-sheet-extra');
		layout();
	};
	const hold = () => {
		if (held || !el.hasClass('is-phone')) return;
		held = true;
		const extra = tallest - shown;
		if (extra <= 0) return;
		el.style.setProperty('--dynasty-sheet-height', `${tallest}px`);
		el.style.setProperty('--dynasty-sheet-extra', `${extra}px`);
		el.addClass('is-holding');
	};
	// A window with a question about changes calls `close()` and stays open; only a close that Obsidian started (it sets
	// `win` to null) keeps the hold. If `win` is missing, the hold is released: the old behaviour is safer than a frozen window.
	const original = modal.close.bind(modal);
	if (holdAtClose) {
		modal.close = () => {
			hold();
			original();
			if ((modal as { win?: unknown }).win !== null) release();
		};
	}
	return () => {
		win.removeEventListener('resize', layout);
		vv?.removeEventListener('resize', layout);
		vv?.removeEventListener('scroll', layout);
		watcher?.disconnect();
		win.removeEventListener('focusin', onFocusChange);
		win.removeEventListener('focusout', onFocusChange);
		for (const id of timers) win.clearTimeout(id);
		timers.clear();
		Reflect.deleteProperty(modal, 'close');
	};
}

/**
 * A touch or pen tap that opened a modal can also land on the new modal's background as a click,
 * which would close it at once. Ignores such clicks for 500 ms; returns the clean-up.
 */
export function ignoreGhostClick(modal: Modal): () => void {
	const openedAt = performance.now();
	const ghost = (e: MouseEvent) => {
		if (performance.now() - openedAt > 500 || modal.modalEl.contains(e.target as Node)) return;
		e.stopPropagation();
		e.preventDefault();
	};
	modal.containerEl.addEventListener('click', ghost, true);
	return () => modal.containerEl.removeEventListener('click', ghost, true);
}

/**
 * M1 to M3: scrolls the focused field of a window into view ONCE, after the keyboard has settled. The window follows the
 * keyboard step by step while it slides in (`phoneLayout` calls back at each step); a scroll at each step moves the list
 * by a row in a few frames, which looks like a stutter. Each call to `schedule` restarts one timer, so only the last
 * call counts: `delay` ms after the last step the field is brought into view. `reduced` (D126): when it is true the
 * scroll jumps at once even if the page asks for a smooth one.
 */
export function settledReveal(modalEl: HTMLElement, contentEl: HTMLElement, reduced: () => boolean = () => false): { schedule: (delay: number) => void; cancel: () => void } {
	let timer: number | null = null;
	const win = modalEl.win ?? window;
	const run = () => {
		timer = null;
		const a = modalEl.doc.activeElement as HTMLElement | null;
		if (a && contentEl.contains(a) && a.matches('input, select, textarea')) a.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'instant' : 'auto' });
	};
	const cancel = () => {
		if (timer !== null) win.clearTimeout(timer);
		timer = null;
	};
	return {
		schedule(delay: number) {
			cancel();
			timer = win.setTimeout(run, delay);
		},
		cancel,
	};
}

/** The controls of a window that Tab can reach, in their order: buttons and fields that are on, shown and not taken out of the Tab order. */
function tabStops(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')).filter((el) => {
		if ((el as HTMLButtonElement).disabled || el.getAttribute('tabindex') === '-1') return false;
		// A hidden control (Obsidian's X in a sheet, a screen-reader-only text) has no box.
		return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
	});
}

/**
 * Tab and Shift+Tab stay inside a window and go round: from the last control to the first, and from the first back to the last (G5 0.4, WCAG 2.4.3).
 * Without it, Shift+Tab on the first choice of a choice window left the focus where it was. Returns the function that removes the listener.
 */
export function holdTab(modalEl: HTMLElement): () => void {
	const key = (e: KeyboardEvent) => {
		if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
		const stops = tabStops(modalEl);
		if (stops.length === 0) return;
		const active = modalEl.doc?.activeElement ?? null;
		const at = stops.indexOf(active as HTMLElement);
		const to = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at < 0 || at === stops.length - 1 ? 0 : at + 1;
		e.preventDefault();
		stops[to].focus();
	};
	modalEl.addEventListener('keydown', key);
	return () => modalEl.removeEventListener('keydown', key);
}
