import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Review D: the Houses window is meant to be 720 px wide on the computer (D110), so the name field keeps
 * its room beside four buttons. Obsidian's `.modal` has `max-width: var(--dialog-max-width)`, and on the
 * computer `--dialog-max-width` is `80vw` (app.css). The rule below sets `width` only, so the window is
 * 80vw wide in a window narrower than 900 px. Measured in Chrome with Obsidian's app.css and the real DOM
 * (tests/r112-review-d-layout-probe.mjs), name field width of the first row:
 *   window 600 px: modal 480 px, name 18 px (1.1.1: 87 px)     window 640 px: modal 512, name 18 (1.1.1: 119)
 *   window 700 px: modal 560 px, name 64 px (1.1.1: 167 px)    window 760 px: modal 608, name 112 (1.1.1: 167)
 *   window 900 px: modal 720 px, name 224 px
 */
describe('review D: the Houses window width', () => {
	it('the 720 px rule also lifts the 80vw cap of Obsidian (max-width), or the name field is squeezed in a window of 600 to 900 px', () => {
		const css = readFileSync('styles.css', 'utf8');
		const rule = /\.modal\.dynasty-sheet\.dynasty-houses:not\(\.is-phone\)\s*\{([^}]*)\}/.exec(css);
		expect(rule).not.toBeNull();
		expect(rule![1]).toMatch(/width:\s*min\(720px/);
		expect(rule![1]).toMatch(/max-width\s*:/);
	});
});
