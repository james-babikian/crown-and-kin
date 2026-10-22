import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * G2 review of r033/b1-b5: `styles.css` is committed and is the join of the chunks in `styles/` (esbuild.config.mjs `joinStyles`, styles/README.md).
 * The head commit changed `styles/10-edit-sheet.css` (the `.dynasty-sheet-change` rules of B5) but not `styles.css`, which ships with the plugin.
 */
describe('G2 B5: the committed styles.css holds the rules of the chunks', () => {
	it('every chunk rule block for the text line is in styles.css', () => {
		const chunk = readFileSync(new URL('../styles/10-edit-sheet.css', import.meta.url), 'utf8');
		const all = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
		expect(readdirSync(new URL('../styles/', import.meta.url)).length).toBeGreaterThan(5);
		expect(chunk).toContain('.dynasty-sheet-change-undo');
		expect(all).toContain('.dynasty-sheet-change-undo');
	});
});
