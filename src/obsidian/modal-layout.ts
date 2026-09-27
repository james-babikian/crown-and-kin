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

/** Keeps the `is-phone` class and the visible-area size up to date; returns the clean-up. */
export function phoneLayout(modal: Modal, onLayout?: () => void): () => void {
	const el = modal.modalEl;
	const win = el.win ?? window;
	const layout = () => {
		const phone = isPhoneWidth(win);
		el.toggleClass('is-phone', phone);
		const vv = win.visualViewport;
		if (phone && vv) {
			el.style.setProperty('--dynasty-sheet-height', `${Math.round(vv.height)}px`);
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
	return () => {
		win.removeEventListener('resize', layout);
		vv?.removeEventListener('resize', layout);
		vv?.removeEventListener('scroll', layout);
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
