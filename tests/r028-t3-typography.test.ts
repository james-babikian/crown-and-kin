import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.8 typography round, package T3 (D218): the type rules of the toolbar, the banner, the menus, the legend, the empty block, the tip, the
 * hint labels, the Show bar of the list and the phone list, read from their chunks.
 */

const chunk = (name: string): string => readFileSync(new URL(`../styles/${name}.css`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector text is exactly `selector`. */
function decl(css: string, selector: string): Record<string, string> {
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const m = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
	expect(m, selector).not.toBeNull();
	const out: Record<string, string> = {};
	for (const part of m![1].split(';')) {
		const i = part.indexOf(':');
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

const BAR_CHUNKS = ['07-focus-mode', '08-toolbar', '09-read-only-resize', '15-empty-block', '18-more-list-finder-bar', '23-legend-save', '32-focus-list-tip', '34-succession-bar'];

describe('D218 in the toolbar, banner, menus and legend', () => {
	it('uses the five size roles and no fixed pixel size', () => {
		for (const name of BAR_CHUNKS) {
			const css = chunk(name);
			expect(css, name).not.toMatch(/(?<![-\w])font-size:\s*\d+px/);
			expect(css, name).not.toMatch(/font-size:\s*var\(--font-ui-(small|smaller|medium|large)\)/);
		}
	});

	it('uses two weights only: no 500, 600 or 700, no bold token', () => {
		for (const name of BAR_CHUNKS) {
			const css = chunk(name);
			expect(css, name).not.toMatch(/font-weight:\s*(500|600|700|bold|var\(--font-medium\)|var\(--bold-weight)/);
		}
	});

	it('the links of the banner and the menus are regular, and their hover underline is thin and only where there is a hover', () => {
		const css = chunk('08-toolbar');
		expect(decl(css, '.dynasty-result .dynasty-link,\n.dynasty-popover .dynasty-link')['font-weight']).toBe('var(--font-normal)');
		expect(css).toMatch(/@media \(hover: hover\) \{\s*\.dynasty-result \.dynasty-link:hover,\s*\.dynasty-popover \.dynasty-link:hover \{[^}]*text-decoration-thickness: 1px;[^}]*text-underline-offset: 3px;/);
		expect(decl(chunk('18-more-list-finder-bar'), '.dynasty-result-phone .dynasty-result-button.dynasty-result-options')['font-weight']).toBe('var(--font-normal)');
	});

	it('a popover or bar title is a Heading, semibold', () => {
		const css = chunk('08-toolbar');
		expect(decl(css, '.dynasty-popover-title')).toMatchObject({ 'font-size': 'var(--dynasty-type-heading)', 'font-weight': 'var(--font-semibold)' });
		expect(decl(css, '.dynasty-sheet-head .dynasty-popover-title')).not.toHaveProperty('font-size');
	});

	it('a row of the problems list is a row: no dotted underline, no underline at all', () => {
		const css = chunk('08-toolbar');
		expect(css).toMatch(/\n\.dynasty-popover \.dynasty-problem-button \{[^}]*text-decoration: none;/);
		expect(css).not.toMatch(/dotted/);
	});

	it('the banner sentence is Text, its links and the menu items are Control, the legend rows are Text', () => {
		expect(decl(chunk('18-more-list-finder-bar'), '.dynasty-result')['font-size']).toBe('var(--dynasty-type-text)');
		expect(decl(chunk('18-more-list-finder-bar'), '.dynasty-result .dynasty-result-button')['font-size']).toBe('var(--dynasty-type-control)');
		expect(decl(chunk('34-succession-bar'), '.dynasty-list-succession')['font-size']).toBe('var(--dynasty-type-text)');
		expect(decl(chunk('08-toolbar'), '.dynasty-popover .dynasty-popover-item,\n.dynasty-popover .dynasty-problem-button')['font-size']).toBe('var(--dynasty-type-control)');
		expect(decl(chunk('08-toolbar'), '.dynasty-legend-row')['font-size']).toBe('var(--dynasty-type-text)');
	});

	it('the main button of the toolbar and of the empty block is semibold', () => {
		expect(decl(chunk('08-toolbar'), '.dynasty-toolbar .dynasty-tool.dynasty-tool-main')['font-weight']).toBe('var(--font-semibold)');
		expect(decl(chunk('15-empty-block'), '.dynasty-empty .dynasty-add-first')['font-weight']).toBe('var(--font-semibold)');
	});
});

describe('D218 in the phone list', () => {
	const css = chunk('31-phone-list');

	it('names are semibold, never 700 or the theme bold', () => {
		expect(decl(css, '.dynasty-list-name')['font-weight']).toBe('var(--font-semibold)');
		expect(decl(css, '.dynasty-list-hero .dynasty-list-name')['font-weight']).toBe('var(--font-semibold)');
		expect(css).not.toMatch(/font-weight:\s*(500|600|650|700)\b/);
		expect(css).not.toMatch(/--bold-weight/);
	});

	it('the large row name is at least 22 px or 1.375 times the note text, with no letter-spacing', () => {
		const hero = decl(css, '.dynasty-list-hero .dynasty-list-name');
		expect(hero['font-size']).toBe('max(22px, calc(var(--font-text-size) * 1.375))');
		expect(hero['letter-spacing']).toBe('0');
	});

	it('the text line and the title are at least 15 px or 0.88 times the note text, also in the large row (D144)', () => {
		expect(decl(css, '.dynasty-list-meta,\n.dynasty-list-title')['font-size']).toBe('max(15px, calc(var(--font-text-size) * 0.88))');
		expect(css).not.toMatch(/max\(14px/);
		expect(decl(css, '.dynasty-list-hero .dynasty-list-title.dynasty-hero-title')).not.toHaveProperty('font-size');
	});

	it('the headings of the list use the Small role', () => {
		expect(decl(css, '.dynasty-list-head')['font-size']).toBe('var(--dynasty-type-small)');
		expect(decl(css, '.dynasty-list-sub')['font-size']).toBe('var(--dynasty-type-small)');
	});

	it('only the relation word is italic; "You" is semibold and the kind of link has no weight rule (D210)', () => {
		expect(css.match(/font-style:\s*italic/g)).toHaveLength(1);
		expect(decl(css, '.dynasty-list-word,\n.dynasty-list-link')['font-style']).toBe('italic');
		expect(decl(css, '.dynasty-list-word.is-strong')['font-weight']).toBe('var(--font-semibold)');
		expect(css).not.toMatch(/\.dynasty-list-link[^{}]*\{[^}]*font-weight/);
	});
});
