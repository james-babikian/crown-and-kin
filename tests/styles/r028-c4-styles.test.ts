import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.8 look round, package C4 (the Titles and Houses windows): the rules of the style chunks that the pictures of D212, D213 and D214
 * were made with. The chunks are read directly, so the tests do not depend on the joined `styles.css`.
 */

const chunk = (name: string): string => readFileSync(new URL(`../../styles/${name}`, import.meta.url), 'utf8');
const TITLES = chunk('20-titles-holders.css');
const HOUSES = chunk('21-houses-pictures.css');
const NOTE = chunk('25-make-note-house-page.css');
const LW = chunk('35-list-windows.css');

interface Rule {
	selectors: string[];
	body: string;
	media: string | null;
}

/** The rules of a chunk: the selector list and the body; a rule inside an `@media`, `@container` or `@supports` block carries its condition. */
function rulesOf(css: string): Rule[] {
	const out: Rule[] = [];
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const walk = (src: string, media: string | null): void => {
		let i = 0;
		while (i < src.length) {
			const open = src.indexOf('{', i);
			if (open < 0) return;
			const head = src.slice(i, open).trim();
			let depth = 1;
			let j = open + 1;
			while (j < src.length && depth > 0) {
				if (src[j] === '{') depth++;
				else if (src[j] === '}') depth--;
				j++;
			}
			const inner = src.slice(open + 1, j - 1);
			if (head.startsWith('@media') || head.startsWith('@container') || head.startsWith('@supports')) walk(inner, head);
			else out.push({ selectors: head.split(',').map((s) => s.trim()), body: inner, media });
			i = j;
		}
	};
	walk(text, null);
	return out;
}

const find = (css: string, selector: string, media: string | null = null): Rule => {
	const rule = rulesOf(css).find((r) => r.media === media && r.selectors.includes(selector));
	if (!rule) throw new Error(`no rule for ${selector}`);
	return rule;
};

describe('quiet controls (quiet-controls)', () => {
	it('every rule of these chunks that names a button has the .dynasty-sheet prefix, so the theme button style cannot outrank it', () => {
		const names = /(^|[\s>+~(])button(?![\w-])/;
		for (const [file, css] of [['20', TITLES], ['21', HOUSES], ['25', NOTE], ['35', LW]] as const) {
			for (const rule of rulesOf(css)) {
				for (const s of rule.selectors) if (names.test(s)) expect(s, `${file}: ${s}`).toContain('.dynasty-sheet');
			}
		}
	});

	it('the arms button of a house page, a row of the list and the holder name have no box, no border and no fill', () => {
		for (const [css, selector] of [[HOUSES, '.dynasty-sheet button.dynasty-house-arms'], [LW, '.dynasty-sheet.dynasty-lw button.dynasty-lw-row'], [TITLES, '.dynasty-sheet button.dynasty-holder-name']] as const) {
			const body = find(css, selector).body;
			expect(body, selector).toMatch(/border:\s*0/);
			expect(body, selector).toMatch(/background:\s*(none|transparent)/);
			expect(body, selector).toMatch(/box-shadow:\s*none/);
		}
	});
});

describe('quiet help texts (window-hints)', () => {
	it('the Titles and Houses windows use the window names, so chunk 20 keeps no scoped rule for the two tree names', () => {
		expect(TITLES).not.toContain('dynasty-hint');
		expect(TITLES).not.toContain('dynasty-empty');
		for (const file of ['obsidian/titles-window', 'obsidian/houses-window', 'obsidian/list-window', 'view/list-search', 'obsidian/succession-section', 'obsidian/holder-form']) {
			const src = readFileSync(new URL(`../../src/${file}.ts`, import.meta.url), 'utf8');
			expect(src, file).not.toMatch(/'dynasty-hint'|'dynasty-empty'/);
		}
	});

	it('turns the floating labels off in the windows, and keeps them for the buttons that have no text', () => {
		expect(find(TITLES, '.dynasty-lw').body).toMatch(/--no-tooltip:\s*true/);
		const keep = rulesOf(TITLES).find((r) => r.selectors.includes('.dynasty-lw .dynasty-icon-btn'))!;
		expect(keep.body).toMatch(/--no-tooltip:\s*false/);
		expect(keep.selectors).toContain('.dynasty-lw .dynasty-lw-clear');
	});
});

describe('the lists (list-window-height, lw-phone-header, titles-arms-lead, D214)', () => {
	it('the window is as tall as its content on a computer, with a minimum, and has no fixed height', () => {
		const body = find(LW, '.modal.dynasty-sheet.dynasty-lw:not(.is-phone)').body;
		expect(body).toMatch(/height:\s*auto/);
		expect(body).toMatch(/min-height:\s*320px/);
		expect(body).not.toMatch(/(^|[^-])height:\s*min\(/);
	});

	it('the picture stands after the text in a row of these windows, and the icon lead of an action row stays first', () => {
		expect(find(LW, '.dynasty-lw .dynasty-row > .dynasty-row-text').body).toMatch(/order:\s*1/);
		expect(find(LW, '.dynasty-lw .dynasty-row > .dynasty-row-lead').body).toMatch(/order:\s*2/);
		expect(find(LW, '.dynasty-lw .dynasty-row > .dynasty-row-lead.is-icon').body).toMatch(/order:\s*0/);
		expect(find(LW, '.dynasty-lw .dynasty-row > :not(.dynasty-ord):not(.dynasty-row-text):not(.dynasty-row-lead)').body).toMatch(/order:\s*3/);
	});

	it('the house colour is a small dot, set only through the custom property, and there is no colour disc or empty box left', () => {
		const dot = find(LW, '.dynasty-lw .dynasty-lw-dot').body;
		expect(dot).toMatch(/width:\s*8px/);
		expect(dot).toContain('var(--dynasty-house-color)');
		expect(LW).not.toContain('dynasty-lw-swatch');
		expect(HOUSES).not.toMatch(/\.dynasty-lw-armsbox\.is-empty::before/);
		expect(find(LW, '.dynasty-lw .dynasty-row-lead.dynasty-lw-armsbox.is-empty').body).toMatch(/display:\s*none/);
	});

	it('the page header has the name at the left and the arms at the right, and no crown', () => {
		expect(find(LW, '.dynasty-lw .dynasty-lw-pagehead').body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
		expect(find(LW, '.dynasty-lw .dynasty-lw-pagehead > .dynasty-head-text').body).toMatch(/grid-column:\s*1/);
		expect(find(LW, '.dynasty-lw .dynasty-lw-pagehead > .dynasty-row-lead').body).toMatch(/grid-column:\s*2/);
		expect(LW).not.toContain('is-head-arms .svg-icon');
	});
});

describe('the house page (arms-colours, people-rows, Add arms)', () => {
	it('a house with no arms has no button in the header and no dashed circle; the link "Add arms" is in the "Open all" row and takes its look from "Add portrait" (D216 item 1)', () => {
		expect(HOUSES).not.toMatch(/\.dynasty-house-arms\.is-empty::before/);
		expect(find(HOUSES, '.dynasty-sheet button.dynasty-house-arms.is-add').body).toMatch(/display:\s*none/);
		// The link has no look of its own here: a second set of sizes would drift away from the one of "Add portrait".
		expect(HOUSES).not.toContain('.dynasty-add-arms');
	});

	it('the colours of the arms are not shown while they load or when they are empty, are marked with a dot, and stand under a thin divider', () => {
		const group = rulesOf(HOUSES).find((r) => r.selectors.includes('.dynasty-house-arms-colours:empty'))!;
		expect(group.selectors).toContain('.dynasty-house-arms-colours.is-loading');
		expect(group.body).toMatch(/display:\s*none/);
		expect(find(HOUSES, '.dynasty-house-arms-colours').body).toMatch(/border-top:\s*1px solid/);
		const dot = find(HOUSES, '.dynasty-sheet button.dynasty-house-arms-colour::after').body;
		expect(dot).toMatch(/width:\s*10px/);
		expect(HOUSES).not.toContain('dynasty-house-arms-title');
		expect(HOUSES).not.toContain('dynasty-house-arms-none');
	});

	it('the People rows are not shaped by the table of the old house page window', () => {
		for (const rule of rulesOf(NOTE)) {
			for (const s of rule.selectors) {
				if (/\.dynasty-hp-(head|row|cell|lead|chevron|name|title|gen|born|died)\b/.test(s)) expect(s, s).toContain('.dynasty-hp-table');
			}
		}
	});
});

describe('the succession notes and the holder form (quiet-warnings, holder-form)', () => {
	it('a note is a quiet roman text line with no sign (D218 item 4); a warning is in the text colour', () => {
		const note = find(TITLES, '.dynasty-succ-note').body;
		expect(note).toMatch(/font-style:\s*normal/);
		expect(note).toMatch(/display:\s*block/);
		expect(find(TITLES, '.dynasty-succ-note.is-warning').body).toContain('var(--text-normal)');
		expect(TITLES).not.toContain('dynasty-succ-note-icon');
	});

	it('the choices of the rules are dropdowns on every device: no column of buttons is left in the style sheet', () => {
		expect(TITLES).not.toContain('dynasty-succ-choice');
	});

	it('the head of the holder form is in the Title role of the other windows (semibold, text font), and the preview is a quiet text line', () => {
		const head = find(TITLES, '.modal.dynasty-holder-form .dynasty-holder-context').body;
		expect(head).toContain('var(--dynasty-type-title)');
		expect(head).toMatch(/font-weight:\s*var\(--font-semibold\)/);
		expect(head).toContain('var(--font-text)');
		expect(TITLES).not.toContain('.modal.dynasty-holder-form.is-phone .dynasty-holder-context');
		const preview = find(TITLES, '.modal.dynasty-holder-form .dynasty-holder-preview').body;
		expect(preview).toMatch(/background:\s*none/);
		expect(preview).toMatch(/padding:\s*0/);
		expect(find(TITLES, '.modal.dynasty-holder-form .dynasty-holder-tick').body).toMatch(/gap:\s*9px/);
	});

	it('does not draw a "?" disc for a holder who is not in the tree', () => {
		expect(TITLES).not.toContain('is-unknown');
	});
});

describe('fix round F4', () => {
	it('on a phone the holder name button has a tap area of 44 px by an invisible extension', () => {
		expect(find(TITLES, '.dynasty-sheet.is-phone button.dynasty-holder-name').body).toMatch(/position:\s*relative/);
		const ext = find(TITLES, '.dynasty-sheet.is-phone button.dynasty-holder-name::after').body;
		expect(ext).toMatch(/height:\s*44px/);
		expect(ext).toMatch(/margin-top:\s*-22px/);
	});

	it('every color-mix() of these chunks stands inside @supports, after a plain declaration', () => {
		for (const css of [TITLES, HOUSES, NOTE, LW]) {
			for (const rule of rulesOf(css)) {
				if (!rule.body.includes('color-mix(')) continue;
				expect(rule.media, rule.selectors.join(',')).toMatch(/^@supports/);
			}
		}
		const plain = find(LW, 'body.theme-dark .dynasty-lw .dynasty-lw-dot');
		expect(plain.body).toContain('var(--dynasty-house-color)');
		expect(plain.body).not.toContain('color-mix');
	});
});
