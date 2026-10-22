/*
 * Reads of the page that the tree view needs (`tree-view-lifecycle.ts`, `tree-view-placement.ts`, `tree-view.ts`; moved out of `tree-view.ts` in WP-4 step 4.3 to keep that file within its size ceiling):
 * the fonts of a block through a probe element, and the safe-area insets from the view's probe element. They read computed styles only.
 */

import { parsePx, type FontState } from '../fonts';
import { usableFamily } from './measure';

/**
 * Reads the fonts with a probe element styled `font-size: var(--font-text-size)`: its computed
 * size is always in px, whatever unit the theme or a snippet uses (rem, calc(), ...). `el` is the
 * block's container, the parent of `.dynasty-root`, so an em value resolves once, exactly as it
 * does for the root; when the block is not in the document yet, the body is used.
 */
export function readFonts(el: HTMLElement): FontState {
	const host = el.isConnected ? el : (el.doc ?? document).body;
	const probe = host.createDiv({ cls: 'dynasty-font-probe' });
	try {
		return fontsOf(probe);
	} finally {
		probe.remove();
	}
}

export function fontsOf(probe: HTMLElement): FontState {
	const cs = getComputedStyle(probe);
	const v = (name: string) => cs.getPropertyValue(name).trim();
	return {
		px: parsePx(cs.fontSize) ?? 16,
		text: usableFamily(cs.fontFamily || 'sans-serif'),
		ui: usableFamily(v('--font-interface') || 'sans-serif'),
		bold: /^\d{3}$/.test(v('--bold-weight')) ? v('--bold-weight') : '600',
	};
}

/** `env(safe-area-inset-top)` in px, read from the view's probe element (spec §7.5). */
export function safeTop(probe: HTMLElement | null): number {
	return probe?.isConnected ? (parsePx(getComputedStyle(probe).paddingTop) ?? 0) : 0;
}

/** `env(safe-area-inset-left)` and `-right` in px (the notch of a phone held sideways, 0.3.1 V1), read from the same probe element. */
export function safeSides(probe: HTMLElement | null): { left: number; right: number } {
	if (!probe?.isConnected) return { left: 0, right: 0 };
	const cs = getComputedStyle(probe);
	return { left: Math.max(0, parsePx(cs.paddingLeft) ?? 0), right: Math.max(0, parsePx(cs.paddingRight) ?? 0) };
}

