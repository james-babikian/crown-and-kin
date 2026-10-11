import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.8 typography round, package T2b (the Titles and Houses windows): the rules of D218 items 1 to 5 in the chunks 20, 21, 25 and 35. The
 * chunks are read directly, so the tests do not depend on the joined `styles.css`.
 */

const chunk = (name: string): string => readFileSync(new URL(`../styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CHUNKS: [string, string][] = [
	['20-titles-holders.css', chunk('20-titles-holders.css')],
	['21-houses-pictures.css', chunk('21-houses-pictures.css')],
	['25-make-note-house-page.css', chunk('25-make-note-house-page.css')],
	['35-list-windows.css', chunk('35-list-windows.css')],
];

/** The body of the rule whose selector list contains `selector` (the first one, outside a media block or inside it). */
function body(css: string, selector: string): string {
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (m[1]!.split(',').map((x) => x.trim()).includes(selector)) return m[2]!;
	}
	throw new Error(`no rule for ${selector}`);
}

describe('D218 items 2 and 3: five sizes and two weights in the Titles and Houses chunks', () => {
	it('takes every text size from a role, never from a fixed size or from a size variable of Obsidian', () => {
		for (const [file, css] of CHUNKS) {
			for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
				// `inherit` and a relative size do not set a size of their own.
				expect(m[1], `${file}: font-size ${m[1]}`).toMatch(/^(var\(--dynasty-type-(title|heading|control|text|small)\)|inherit|\d+(\.\d+)?em)$/);
			}
		}
	});

	it('uses only the weights normal and semibold: no 500, 600 as a number, 650, 700 or bold', () => {
		for (const [file, css] of CHUNKS) {
			for (const m of css.matchAll(/font-weight:\s*([^;]+);/g)) {
				expect(m[1], `${file}: font-weight ${m[1]}`).toMatch(/^var\(--font-(normal|semibold)\)$/);
			}
		}
	});

	it('draws no letter spacing and no !important', () => {
		for (const [file, css] of CHUNKS) {
			expect(css, file).not.toMatch(/letter-spacing:\s*-/);
			expect(css, file).not.toContain('!important');
		}
	});
});

describe('D218 item 4: italic is for relation words only', () => {
	it('has no italic in these chunks (the relation words are in the chunks of the rows and the cards)', () => {
		for (const [file, css] of CHUNKS) expect(css, file).not.toMatch(/font-style:\s*italic/);
	});

	it('draws a succession note, a named-heir note, a "found by" reason and the open-branch row in quiet roman', () => {
		const [titles, , , lw] = CHUNKS.map(([, css]) => css) as [string, string, string, string];
		for (const selector of ['.dynasty-succ-note', '.dynasty-sheet .dynasty-holder-note', '.dynasty-sheet.dynasty-lw .dynasty-row .dynasty-lw-row-found']) {
			const css = selector.includes('lw-row-found') ? lw : titles;
			const rule = body(css, selector);
			expect(rule, selector).toMatch(/font-style:\s*normal/);
			expect(rule, selector).toContain('var(--dynasty-muted)');
			expect(rule, selector).toContain('var(--dynasty-type-small)');
		}
		const branch = body(titles, '.dynasty-sheet .dynasty-row.is-open-branch .dynasty-row-title');
		expect(branch).toMatch(/font-style:\s*normal/);
		expect(branch).toMatch(/font-weight:\s*var\(--font-normal\)/);
		expect(branch).toContain('var(--dynasty-muted)');
		// A warning keeps the text colour.
		expect(body(titles, '.dynasty-succ-note.is-warning')).toContain('var(--text-normal)');
	});
});

describe('D218 item 1: names and the text line under them in the text font, everything else in the interface font', () => {
	it('puts the name of a title, a house and a holder, and the line under it, in the text font at the Name and Text roles', () => {
		const [titles, houses, , lw] = CHUNKS.map(([, css]) => css) as [string, string, string, string];
		const name = (css: string, selector: string) => {
			const rule = body(css, selector);
			expect(rule, selector).toContain('font-family: var(--font-text)');
			expect(rule, selector).toContain('var(--dynasty-type-heading)');
			expect(rule, selector).toMatch(/font-weight:\s*var\(--font-semibold\)/);
		};
		name(titles, '.dynasty-sheet button.dynasty-holder-name');
		name(titles, '.dynasty-sheet .dynasty-holder-label');
		name(titles, '.dynasty-title-holding-name');
		name(lw, '.dynasty-lw .dynasty-lw-row-name');
		name(houses, '.dynasty-sheet .dynasty-hp-rows .dynasty-hp-row .dynasty-row-title');
		for (const [css, selector] of [[lw, '.dynasty-sheet.dynasty-lw .dynasty-row .dynasty-lw-row-sum'], [houses, '.dynasty-sheet .dynasty-hp-rows .dynasty-hp-row .dynasty-row-sub'], [titles, '.dynasty-sheet .dynasty-holder-row .dynasty-row-sub']] as const) {
			const rule = body(css, selector);
			expect(rule, selector).toContain('font-family: var(--font-text)');
			expect(rule, selector).toContain('var(--dynasty-type-text)');
		}
	});

	it('keeps the title of a People row regular on the name line, and puts the hint of an action row in the interface font', () => {
		const [, houses, , lw] = CHUNKS.map(([, css]) => css) as [string, string, string, string];
		expect(body(houses, '.dynasty-sheet .dynasty-hp-rows .dynasty-hp-row .dynasty-row-title .dynasty-sob')).toMatch(/font-weight:\s*var\(--font-normal\)/);
		expect(body(lw, '.dynasty-sheet.dynasty-lw .dynasty-action-row .dynasty-row-sub')).toContain('font-family: var(--font-interface)');
		expect(body(lw, '.dynasty-lw .dynasty-lw-state')).toContain('font-family: var(--font-interface)');
	});

	it('puts the head of the holder form in the Title role and the text font', () => {
		const rule = body(CHUNKS[0]![1], '.modal.dynasty-holder-form .dynasty-holder-context');
		expect(rule).toContain('var(--dynasty-type-title)');
		expect(rule).toContain('font-family: var(--font-text)');
		expect(rule).toMatch(/letter-spacing:\s*0/);
	});

	it('draws the sub-heading of the line (Small, semibold, quiet grey)', () => {
		const rule = body(CHUNKS[0]![1], '.dynasty-sheet .dynasty-succ-heading');
		expect(rule).toContain('var(--dynasty-type-small)');
		expect(rule).toMatch(/font-weight:\s*var\(--font-semibold\)/);
		expect(rule).toContain('var(--dynasty-muted)');
	});
});

describe('D218 item 5: a name in a row is not a link', () => {
	it('gives a holder name no link colour and no underline at rest, and a thin underline on hover only where a pointer hovers', () => {
		const css = CHUNKS[0]![1];
		const rest = body(css, '.dynasty-sheet button.dynasty-holder-name');
		expect(rest).toContain('color: var(--text-normal)');
		expect(rest).not.toContain('text-decoration');
		expect(body(css, '.dynasty-sheet button.dynasty-holder-name:hover')).not.toContain('text-decoration');
		const at = css.indexOf('@media (hover: hover)');
		expect(at).toBeGreaterThan(0);
		const inside = css.slice(at, css.indexOf('}\n}', at));
		expect(inside).toContain('.dynasty-sheet button.dynasty-holder-name:hover');
		expect(inside).toMatch(/text-decoration-thickness:\s*1px/);
	});
});

describe('D218 item 6: no summary on a closed section that only holds commands', () => {
	it('hides an empty section summary in the list windows', () => {
		expect(body(CHUNKS[3]![1], '.dynasty-lw .dynasty-section-sum:empty')).toMatch(/display:\s*none/);
	});
});
