import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* M11 fix round (Obsidian): the style rules that the round changed. */
const css = readFileSync('styles.css', 'utf8');
const rule = (sel: string) => new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('M11 fix: picker preview frame', () => {
	it('a picture that cannot show keeps a solid frame; only a missing file is dashed', () => {
		expect(rule('.dynasty-picture-thumb.is-problem')).not.toMatch(/dashed/);
		expect(rule('.dynasty-picture-thumb.is-missing')).toMatch(/border-style:\s*dashed/);
	});
});

describe('M11 fix: house page header', () => {
	it('the Close button sits at the right edge (no room kept for the hidden X)', () => {
		expect(rule('.dynasty-house-page .dynasty-sheet-header')).toMatch(/padding-right:\s*var\(--size-4-4\)/);
		expect(rule('.dynasty-house-page .dynasty-sheet-actions')).toMatch(/margin-left:\s*auto/);
	});
});
