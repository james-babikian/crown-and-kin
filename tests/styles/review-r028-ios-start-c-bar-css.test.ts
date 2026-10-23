import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Review r028-ios-start, cause (c): the "Open note" chip is drawn over the words "Read only".
 * updateEditUi (tree-view.ts) puts a button `.dynasty-tool.dynasty-open-source` with an icon and the text "Open note" next to the label
 * `.dynasty-read-only-label`. The bar rule `.dynasty-toolbar .dynasty-tool` (styles.css:816-838) gives EVERY tool `flex: none; width: 44px; min-width: 44px;
 * justify-content: center; overflow: visible`. Only `.dynasty-tool-main` (Add person) and the warning badge set `width: auto`. The chip has no such rule
 * (styles.css:1235 only sets `white-space: nowrap` on its text), so the text of ~70 px runs out of a 44 px box on both sides (centred) and covers the label
 * that stands before it in the bar (BAR_ORDER: read-only-label, then open-source). jsdom has no layout, so the test reads the cascade from the style sheet.
 */

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of every top-level rule whose selector list has a selector that ends in the class (no media queries). */
function declarationsFor(cls: string, prop: string): string[] {
	const out: string[] = [];
	// Rules inside @media blocks are skipped on purpose: the bar of a phone list is not inside one.
	const flat = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
	for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = m[1].split(',').map((s) => s.trim());
		if (!selectors.some((s) => new RegExp(`${cls.replace('.', '\\.')}(?![\\w-])$`).test(s))) continue;
		const d = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(m[2]);
		if (d) out.push(`${m[1].trim()} => ${prop}: ${d[1].trim()}`);
	}
	return out;
}

describe('r028-ios-start (c): the "Open note" chip has room for its text', () => {
	it('control: the base rule of a bar tool is a fixed 44 px box (so a tool with a word must override it)', () => {
		expect(declarationsFor('.dynasty-tool', 'width')).toContain('.dynasty-toolbar .dynasty-tool => width: 44px');
	});

	it('the chip `.dynasty-open-source` (icon + the text "Open note") sets a width of auto, as Add person and the badge do', () => {
		expect(declarationsFor('.dynasty-tool-main', 'width')).toContain('.dynasty-toolbar .dynasty-tool.dynasty-tool-main => width: auto');
		expect(declarationsFor('.dynasty-open-source', 'width')).toEqual(expect.arrayContaining([expect.stringMatching(/width: auto$/)]));
	});
});
