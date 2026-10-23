// Scratch test (r112-jump-probe): the small Id window must not slide on a phone.
//
// Why: on a phone Obsidian's Modal.open() and Modal.close() (app.js, `Platform.isPhone`) run `animateOpen()` and
// `animateClose()`. Both slide `.modal` by its own height with an inline `transform: translateY(h - 1 px)` and an inline
// `transition`, as a bottom sheet. The small Id window is a TOP sheet, so the slide shows as a jump to the middle of the
// screen (open: first frame at y = h - 1, then up to 0 in about 100 ms; close: from 0 down to y = h - 1 in about 100 ms).
// An inline style loses only to `!important`, so the window needs a phone-only rule with `transform: none !important` and
// `transition: none !important`. The harness step `v112 jump platform` proves the effect in a real Obsidian.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from '../acceptance/m11-support';

const rules = cssRules(readFileSync('styles.css', 'utf8'));

describe('the small Id window on a phone (styles.css)', () => {
	const mine = rules.filter((r) => r.selectors.some((s) => s.includes('.dynasty-id-window') && s.includes('.is-phone') && !s.includes(':not(.is-phone)') && !/\.dynasty-sheet-body|\.dynasty-id-/.test(s.replace('.dynasty-id-window', ''))));

	it('has a phone-only rule that stops the slide of Obsidian\'s open and close animation (transform and transition, !important)', () => {
		const stop = mine.find((r) => /(^|;|\s)transform:\s*none\s*!important/.test(r.body) && /(^|;|\s)transition:\s*none\s*!important/.test(r.body));
		expect(stop, 'no rule with transform: none !important and transition: none !important for .dynasty-id-window.is-phone').toBeDefined();
	});

	it('does not stop the slide of the other windows (the full-height sheets slide from the bottom, as Obsidian does)', () => {
		const wide = rules.filter((r) => /transform:\s*none\s*!important/.test(r.body) && r.selectors.some((s) => /\.dynasty-sheet\.is-phone\b|\.modal\.is-phone\b/.test(s) && !s.includes('dynasty-id-window')));
		expect(wide).toEqual([]);
	});
});
