import { describe, expect, it } from 'vitest';
import { concatStyles } from '../../styles/concat.mjs';

/*
 * 0.2.8 package C2: the look rules of the tree view and the phone list, read from the chunks (not from the generated styles.css, which the supervisor joins).
 */

// Comments are left out, so a word in a comment is not a rule.
const css = (concatStyles() as string).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector text is exactly `selector`. */
function decl(selector: string): Record<string, string> {
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css);
	expect(m, selector).not.toBeNull();
	const out: Record<string, string> = {};
	for (const part of m![1].split(';')) {
		const i = part.indexOf(':');
		if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
	}
	return out;
}

describe('the phone list (D209, D213)', () => {
	it('the large row has a column at the right with a 56 px portrait and the arms (35 px, 56 px alone) under it, 8 px apart', () => {
		expect(decl('.dynasty-hero-col')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '8px' });
		expect(decl('.dynasty-hero-portrait')).toMatchObject({ display: 'block', overflow: 'hidden', 'border-radius': '50%' });
		expect(decl('.dynasty-hero-portrait')).toBeDefined();
		expect(css).toMatch(/\.dynasty-hero-portrait \{[^}]*width: 56px;[^}]*height: 56px;/);
		expect(decl('.dynasty-hero-arms')).toMatchObject({ width: '56px', height: '35px' });
		expect(decl('.dynasty-hero-col.no-portrait .dynasty-hero-arms').height).toBe('56px');
	});

	it('other rows have a 36 px portrait at the right', () => {
		expect(decl('.dynasty-list-portrait')).toMatchObject({ width: '36px', height: '36px' });
	});

	it('a portrait is a circle in every theme: the place clips it and the picture inside has no theme border or radius of its own', () => {
		expect(decl('.dynasty-list-portrait,\n.dynasty-hero-portrait')['border-radius']).toBe('50%');
		const img = decl('.dynasty-list .dynasty-list-portrait > img,\n.dynasty-list .dynasty-hero-portrait > img');
		expect(img).toMatchObject({ border: '0', 'border-radius': '0', 'box-shadow': 'none', 'max-width': 'none', 'object-fit': 'cover' });
		expect(css).not.toMatch(/\.dynasty-list[^{}]*\{[^}]*!important/);
	});

	it('the outline of a portrait shows only with the picture, so a place that waits is no ring', () => {
		const ring = decl('.dynasty-list-portrait.has-picture,\n.dynasty-hero-portrait.has-picture');
		expect(ring['box-shadow']).toBe('0 0 0 1px var(--background-modifier-border)');
	});

	it('has no initials disc of the large row, and no frame', () => {
		expect(css).not.toContain('.dynasty-hero-pic');
		expect(decl('.dynasty-list-me').border).toBe('2px solid transparent');
		expect(decl('.dynasty-list-hero').border).toBe('2px solid transparent');
	});

	it('"You" and a place in the line are semibold in the text colour; the link word is plain italic', () => {
		expect(decl('.dynasty-list-word.is-strong')).toMatchObject({ color: 'var(--text-normal)', 'font-weight': 'var(--font-semibold)' });
		// D210: the kind of link is never bold.
		expect(css).not.toMatch(/\.dynasty-list-link[^{}]*\{[^}]*font-weight/);
		expect(decl('.dynasty-list-word,\n.dynasty-list-link')['font-style']).toBe('italic');
		expect(css).not.toMatch(/\.dynasty-list-me \.dynasty-list-word/);
	});

	it('the heading over the person at the top is hidden from the eye, not from a screen reader', () => {
		const head = decl(".dynasty-list-section[data-section='person'] > .dynasty-list-head");
		expect(head['clip-path']).toBe('inset(50%)');
		expect(head.position).toBe('absolute');
		expect(head.display).toBeUndefined();
	});

	it('the Show bar of the list has its own layer above the buttons of Obsidian and starts where the rows start', () => {
		expect(decl('.dynasty-list-succession')).toMatchObject({ position: 'relative', 'z-index': '1', margin: '0 -8px', padding: '0 0 0 16px' });
	});
});

describe('the sheets and menus (D212)', () => {
	it('a sheet from the bottom and the full-screen view are opaque in every theme', () => {
		const sheet = decl('.dynasty-popover.is-sheet');
		// The relative colour that drops the alpha stands in an @supports block (G2: an engine without it would make the sheet transparent).
		expect(sheet.background).toBe('var(--background-primary)');
		expect(css).toMatch(/@supports \(color: rgb\( from red r g b\)\) \{\s*\.dynasty-popover\.is-sheet \{\s*background: rgb\(from var\(--background-primary\) r g b\);/);
		expect(sheet['backdrop-filter']).toBe('none');
		expect(css).toMatch(/\.modal-container\.dynasty-fullscreen-container \.modal-bg \{[^}]*backdrop-filter: none/);
		expect(css).toMatch(/\.modal-container \.modal\.dynasty-fullscreen \{[^}]*backdrop-filter: none/);
	});

	it('the rows of the More menu start at one left edge, with the icon in a column of 20 px', () => {
		expect(decl('.dynasty-popover .dynasty-popover-item.dynasty-more-item')).toMatchObject({ 'justify-content': 'flex-start', 'text-align': 'left' });
		expect(decl('.dynasty-more-item .dynasty-tool-icon')).toMatchObject({ width: '20px', 'justify-content': 'center' });
	});

	it('the legend is 320 px wide and as tall as its rows, up to the height of the tree', () => {
		expect(decl('.dynasty-popover.dynasty-popover-legend:not(.is-sheet)')).toMatchObject({ width: '320px', 'max-height': 'calc(100% - 52px)' });
		expect(decl('.dynasty-legend-row')['min-height']).toBe('28px');
	});
});

describe('the banner on a phone (D212)', () => {
	it('is one row: no line break before the links, the link Options before the X', () => {
		expect(css).not.toContain('.dynasty-result-phone::after');
		expect(decl('.dynasty-result-phone .dynasty-result-button.dynasty-result-options').order).toBe('2');
		expect(decl('.dynasty-result-phone .dynasty-result-button.dynasty-bar-x').order).toBe('3');
	});
});

describe('the toolbar and the banner in a note (D212 bars-in-flow)', () => {
	it('stand above the drawing area in the flow of the box; the full-screen view is not touched', () => {
		expect(decl('.dynasty-viewport.is-flow')).toMatchObject({ display: 'flex', 'flex-direction': 'column' });
		expect(decl('.dynasty-viewport.is-flow > .dynasty-toolbar,\n.dynasty-viewport.is-flow > .dynasty-result')).toMatchObject({ position: 'relative', flex: 'none' });
		expect(decl('.dynasty-viewport.is-flow > .dynasty-canvas')).toMatchObject({ flex: '1 1 auto', 'min-height': '0', height: 'auto' });
	});
});
