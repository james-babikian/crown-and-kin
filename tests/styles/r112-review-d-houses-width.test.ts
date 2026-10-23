import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Review D, changed in 0.2.8: every window of the family is 620 px wide on the computer, so the name field keeps
 * its room. Obsidian's `.modal` has `max-width: var(--dialog-max-width)`, and on the computer `--dialog-max-width` is `80vw` (app.css),
 * so the rule must lift that cap, or the window is narrower than 620 px in an app window narrower than 775 px.
 */
describe('review D: the width of the windows', () => {
	it('the 620 px rule also lifts the 80vw cap of Obsidian (max-width)', () => {
		const css = readFileSync('styles.css', 'utf8');
		const rule = /\.modal\.dynasty-sheet\s*\{([^}]*)\}/.exec(css);
		expect(rule).not.toBeNull();
		expect(rule![1]).toMatch(/width:\s*min\(620px/);
		expect(rule![1]).toMatch(/max-width\s*:\s*none/);
	});
});
