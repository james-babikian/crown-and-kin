// The focus ring of the Find field on a phone: a class on the pill follows the focus of the field (D382 (3)); no `:has()` in the style sheet.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ SuggestModal: class {}, Modal: class {}, Platform: {}, setIcon: () => undefined }));

const { followFocusRing } = await import('../../src/obsidian/person-picker');

function fake(visible: boolean) {
	const classes = new Set<string>();
	const handlers = new Map<string, () => void>();
	const field = {
		toggleClass: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)),
		removeClass: (c: string) => void classes.delete(c),
	};
	const input = {
		parentElement: field,
		matches: (q: string) => q === ':focus-visible' && visible,
		addEventListener: (n: string, h: () => void) => void handlers.set(n, h),
	};
	followFocusRing(input as unknown as HTMLElement);
	return { classes, fire: (n: string) => handlers.get(n)!() };
}

describe('the focus ring of the Find field', () => {
	it('is on while the field has a visible focus, and off after blur', () => {
		const f = fake(true);
		f.fire('focus');
		expect([...f.classes]).toEqual(['is-input-focus']);
		f.fire('blur');
		expect([...f.classes]).toEqual([]);
	});

	it('stays off when the focus is not visible (a touch)', () => {
		const f = fake(false);
		f.fire('focus');
		expect([...f.classes]).toEqual([]);
	});

	it('the style sheet draws the ring from the class, with no :has() on the field', () => {
		const css = readFileSync('styles/13-person-picker.css', 'utf8');
		expect(css).toMatch(/\.dynasty-picker\.is-phone \.prompt-input-container\.is-input-focus\s*\{\s*outline: 2px solid var\(--background-modifier-border-focus\)/);
		expect(css).not.toContain(':has(> input');
	});
});
