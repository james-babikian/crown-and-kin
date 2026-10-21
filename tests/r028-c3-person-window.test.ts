import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers for each step of a flow; the picker records what it was given.
const answers: unknown[] = [];
const pickerContexts: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({
	pickPerson: async (...args: unknown[]) => {
		pickerContexts.push(args[8]);
		return answers.shift() ?? null;
	},
}));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { SHEET, FAMILY, WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle } from './acceptance/tree-view-fakes';

/*
 * 0.2.8 look round, package C3 (D209 header, D211 pickers, D212 quiet controls and hints, "+ Add" links, D213 rows). The DOM is checked in the fake
 * DOM; the style rules are read from styles.css (the join of the chunks).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	answers.length = 0;
	pickerContexts.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

// Ann is marked. Bob is her child, Cid is his child, and Dora is Bob's partner.
const BODY = ['options:', '  me: a', 'people:', '  - id: a', '    name: Ann', '  - id: b', '    name: Bob', '    parents: [a]', '  - id: c', '    name: Cid', '    parents: [b]', '  - id: d', '    name: Dora', 'unions:', '  - {partners: [b, d], type: marriage}', ''].join('\n');

function open(id: string, body = BODY): { sheet: EditSheet; content: FEl } {
	const sheet = EditSheet.create({} as never, { handle: fakeHandle('n.md', body) as never, personId: id, sourcePath: 'n.md' })!;
	sheet.open();
	return { sheet, content: (sheet as unknown as { contentEl: FEl }).contentEl };
}

describe('the Family section: "+ Add" links at the group headings (D212 family-add-links)', () => {
	it('each of Parents, Partners and Children has a heading row with an Add link; the row of three buttons is gone', () => {
		const { content } = open('b');
		const rows = content.querySelectorAll('.dynasty-sub-row');
		expect(rows).toHaveLength(3);
		expect(content.querySelector('.is-three')).toBeNull();
		const links = rows.map((r) => r.querySelector('.dynasty-add-link')!);
		expect(links.map((l) => l.hasClass('dynasty-link'))).toEqual([true, true, true]);
		// The old class names stay on the links, so a test and the keyboard focus find them as before.
		expect(links.map((l) => ['dynasty-add-parent', 'dynasty-add-partner', 'dynasty-add-child'].some((c) => l.hasClass(c)))).toEqual([true, true, true]);
		expect(rows.map((r) => r.querySelector('.dynasty-sub')!.getText())).toEqual([FAMILY.parents, FAMILY.partners, 'Children']);
	});

	it('the link shows "Add"; a screen reader gets "Add parent" from a hidden text, and the link has no aria-label (no tooltip)', () => {
		const { content } = open('b');
		const link = content.querySelector('.dynasty-add-parent')!;
		const visible = link.querySelectorAll('span').filter((s) => s.getAttribute('aria-hidden') === 'true' && s.getText() === FAMILY.addLink);
		expect(visible).toHaveLength(1);
		expect(link.querySelector('.dynasty-sr-only')!.getText()).toBe(FAMILY.addParent);
		expect(link.getAttribute('aria-label')).toBeNull();
		expect(content.querySelector('.dynasty-add-child .dynasty-sr-only')!.getText()).toBe(FAMILY.addChild);
		expect(content.querySelector('.dynasty-add-partner .dynasty-sr-only')!.getText()).toBe(FAMILY.addPartner);
	});

	it('a tap on a link starts its flow', async () => {
		const { content } = open('b');
		answers.push('birth', 'existing', null);
		dispatch(content.querySelector('.dynasty-add-parent')!, 'click');
		await settle();
		expect(pickerContexts).toHaveLength(1);
	});

	it('the end controls of every person row stand in one box, also when it is empty, so the pictures line up (D214)', () => {
		const { content } = open('b');
		const rows = content.querySelectorAll('.dynasty-family-row');
		const parent = rows.find((r) => r.getAttribute('data-parent') === 'a')!;
		const partner = rows.find((r) => r.getAttribute('data-partner') === 'd')!;
		const child = rows.find((r) => r.getAttribute('data-child') === 'c')!;
		expect(parent.querySelector('.dynasty-family-controls')).not.toBeNull();
		expect(partner.querySelector('.dynasty-family-controls')).not.toBeNull();
		expect(child.querySelector('.dynasty-row-chev')).not.toBeNull();
	});

	it('the type chip is named by a hidden text, not by an aria-label', () => {
		const { content } = open('b');
		const select = content.querySelector('.dynasty-family-select')!;
		expect(select.getAttribute('aria-label')).toBeNull();
		const id = select.getAttribute('aria-labelledby')!;
		const name = content.querySelectorAll('.dynasty-sr-only').find((e) => e.getAttribute('id') === id)!;
		expect(id).toMatch(/^dynasty-chip-\d+$/);
		expect(name.getText()).toBe(FAMILY.parentTypeLabel('Ann'));
	});
});

describe('D211: the lists of Add parent, Add child and Add partner name no relation unless the window is about the marked person', () => {
	it('the window of another person: the picker gets no marked person, so no relation word', async () => {
		const { content } = open('b');
		answers.push('birth', 'existing', null);
		dispatch(content.querySelector('.dynasty-add-parent')!, 'click');
		await settle();
		expect((pickerContexts[0] as { me: string | null }).me).toBeNull();
	});

	it('the window of the marked person: the picker keeps the marked person', async () => {
		const { content } = open('a');
		answers.push('existing', null);
		dispatch(content.querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		expect((pickerContexts[0] as { me: string | null }).me).toBe('a');
	});

	it('Add child in the window of another person: no word either', async () => {
		const { content } = open('c');
		answers.push('existing', null);
		dispatch(content.querySelector('.dynasty-add-child')!, 'click');
		await settle();
		expect((pickerContexts[0] as { me: string | null }).me).toBeNull();
	});
});

describe('D212 window-hints: a window never uses the two names of the tree', () => {
	it('no element of the person window has the class dynasty-hint or dynasty-empty', () => {
		const { content } = open('a');
		expect(content.querySelector('.dynasty-hint')).toBeNull();
		expect(content.querySelector('.dynasty-empty')).toBeNull();
	});

	it('the hints are quiet text lines that show while the field has the focus; an empty list is a plain text line', () => {
		const { content } = open('a');
		// The grey line under Born and Died (0.3.2, spec §14 rule 6) always shows: it is the one hint that is not on focus.
		const hints = content.querySelectorAll('.dynasty-sheet-hint').filter((h) => !h.hasClass('dynasty-date-line'));
		expect(hints.length).toBeGreaterThan(0);
		expect(hints.every((h) => h.hasClass('is-on-focus'))).toBe(true);
		const none = content.querySelectorAll('.dynasty-sheet-none');
		expect(none.map((n) => n.getText())).toContain(FAMILY.noParents);
	});
});

describe('the header (D209 items 3 to 5, D213)', () => {
	it('a person with no portrait has no circle and no initials; the link "Add portrait" stands in the row of "Open all"', () => {
		const { content } = open('a');
		const head = content.querySelector('.dynasty-head')!;
		expect(head.hasClass('dynasty-person-head')).toBe(true);
		expect(head.children[0]!.hasClass('dynasty-head-text')).toBe(true);
		const pic = content.querySelector('.dynasty-pic')!;
		expect(pic.hasClass('is-none')).toBe(true);
		expect(pic.querySelector('.dynasty-mono')).toBeNull();
		const add = content.querySelector('.dynasty-openall .dynasty-add-portrait')!;
		expect(add.getText()).toBe(WINDOW_UI.addPortrait);
		expect(add.hidden).toBe(false);
		// It stands before "Open all".
		const row = content.querySelector('.dynasty-openall')!;
		expect(row.children[0]).toBe(add);
	});

	it('a new person has no "Add portrait" link (a portrait needs a saved person)', async () => {
		const { sheet } = open('a');
		answers.push('birth', 'new');
		dispatch((sheet as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-add-parent')!, 'click');
		await settle();
		const fresh = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		expect(fresh.contentEl.querySelector('.dynasty-add-portrait')).toBeNull();
		expect(fresh.contentEl.querySelector('.dynasty-pic')!.hasClass('is-none')).toBe(true);
	});

	it('the text of a link and of the text button have the plain words', () => {
		expect(WINDOW_UI.addPortrait).toBe('Add portrait or arms');
		expect(FAMILY.addLink).toBe('Add');
		expect(SHEET.save).toBe('Save');
	});
});

// ---------- the style rules ----------

const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits a selector list at the commas that are not inside brackets. */
function selectors(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === '(') depth++;
		else if (list[i] === ')') depth--;
		else if (list[i] === ',' && depth === 0) {
			out.push(list.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(list.slice(start).trim());
	return out;
}

/** The declarations of the first rule whose selector list contains exactly this selector. */
function rule(selector: string): string {
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (selectors(m[1]!).includes(selector)) return m[2]!;
	throw new Error(`no rule for ${selector}`);
}

describe('quiet controls (D212): the window prefix outranks the theme button rule', () => {
	it('the section head, the back link, the icon button, the text link, the portrait and the tappable row are plain on the window', () => {
		const quiet = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => selectors(m[1]!).includes('.dynasty-sheet .dynasty-openall button'));
		expect(quiet).toBeTruthy();
		expect(quiet![1]).toContain('.dynasty-sheet button:is(');
		expect(quiet![2]).toMatch(/border: 0/);
		expect(quiet![2]).toMatch(/background: none/);
		expect(quiet![2]).toMatch(/box-shadow: none/);
	});

	it('the keyboard ring stays on a quiet control', () => {
		const ring = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.includes('.dynasty-section-head') && m[1]!.includes(':focus-visible'));
		expect(ring![2]).toMatch(/box-shadow: 0 0 0 2px var\(--interactive-accent\)/);
	});
});

describe('the header portrait and the rows (D209, D213)', () => {
	it('the portrait has a 64 px circle with a 1 px outline in the line colour and no house ring', () => {
		const pic = rule('.dynasty-pic');
		expect(pic).toMatch(/width: 64px/);
		expect(pic).toMatch(/height: 64px/);
		const outline = rule('.dynasty-sheet button.dynasty-pic.has-picture');
		expect(outline).toMatch(/0 0 0 1px var\(--background-modifier-border\)/);
		expect(outline).not.toMatch(/house-color/);
		expect(rule('.dynasty-pic.is-none')).toMatch(/display: none/);
	});

	it('the person header has two columns: the text, then the portrait at the right', () => {
		expect(rule('.dynasty-person-head')).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto/);
	});

	it('every row has one height: 48 px on a computer, 52 px on a phone; a row lead has no grey fill', () => {
		expect(rule('.dynasty-row')).toMatch(/min-height: 48px/);
		expect(rule('.dynasty-sheet.is-phone .dynasty-row')).toMatch(/min-height: 52px/);
		expect(rule('.dynasty-row-lead')).not.toMatch(/background/);
		expect(rule('.dynasty-row-lead.has-picture:not(.is-arms)')).toMatch(/0 0 0 1px var\(--background-modifier-border\)/);
	});

	it('the end controls of the Family rows have one fixed width', () => {
		expect(css).toMatch(/--dynasty-family-end: 120px/);
		expect(css).toMatch(/--dynasty-family-end: 152px/);
	});

	it('the phone: header name 22 px, detail and relation lines 15 px, ordinals 13 px, chip text 16 px, buttons never split their words', () => {
		// D218: the sizes come from the five roles; their phone values are 22 (title), 15 (text) and 13 px (small).
		expect(rule('.dynasty-head-name')).toContain('font-size: var(--dynasty-type-title)');
		expect(rule('.dynasty-head-rel')).toContain('font-size: var(--dynasty-type-text)');
		expect(rule('.dynasty-row .dynasty-ord')).toContain('font-size: var(--dynasty-type-small)');
		expect(css).toMatch(/--dynasty-type-title: 22px/);
		expect(css).toMatch(/--dynasty-type-text: 15px/);
		expect(css).toMatch(/--dynasty-type-small: 13px/);
		expect(rule('.dynasty-sheet.is-phone .dynasty-chip-select select.dynasty-family-select')).toContain('font-size: max(16px, var(--dynasty-type-control))');
		expect(rule('.dynasty-sheet.is-phone .dynasty-actions .dynasty-btn')).toMatch(/white-space: nowrap/);
	});

	it('a window of the plugin has the plain page background in every theme, on a phone and on a computer (Cupertino)', () => {
		const r = rule('.modal-container .modal.dynasty-sheet.dynasty-sheet');
		expect(r).toMatch(/background: var\(--background-primary\)/);
		expect(r).toMatch(/backdrop-filter: none/);
	});
});

describe('Find (D212, D213)', () => {
	it('a computer Find window is 560 px wide; a phone has the field and Cancel in one row', () => {
		expect(rule('.prompt.dynasty-picker:not(.is-phone)')).toMatch(/width: min\(560px/);
		expect(rule('.dynasty-picker.is-phone .prompt-input-container')).toMatch(/display: flex/);
		expect(rule('.dynasty-picker.is-phone .dynasty-picker-head')).toMatch(/clip-path: inset\(50%\)/);
	});

	it('the portrait of a row has no house ring', () => {
		expect(rule('.dynasty-picker-swatch')).not.toMatch(/house-color/);
		expect(rule('.dynasty-picker-swatch.has-picture')).toMatch(/var\(--background-modifier-border\)/);
	});
});

describe('the picture picker grid and the crop tool (D212)', () => {
	it('pictures stand in a grid of 72 px thumbnails; folders, the device row and Remove are full-width rows', () => {
		expect(rule('.modal.dynasty-picture-picker .dynasty-picture-list')).toMatch(/display: grid/);
		expect(rule('.modal.dynasty-picture-picker .dynasty-picture-thumb')).toMatch(/width: 72px/);
		expect(rule('.modal.dynasty-picture-picker .dynasty-picture-row.dynasty-picture-device')).toMatch(/grid-column: 1 \/ -1/);
	});

	it('the crop window is large and has no inner frame; the slider has a thin track and a round white knob', () => {
		expect(rule('.modal.dynasty-crop:not(.is-phone)')).toMatch(/height: calc\(100vh - 96px\)/);
		expect(rule('.dynasty-crop-area')).not.toMatch(/box-shadow: 0 0 0 1px/);
		expect(rule('.dynasty-crop input.dynasty-crop-slider::-webkit-slider-thumb')).toMatch(/border-radius: 50%/);
	});
});
