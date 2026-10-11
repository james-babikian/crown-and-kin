import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { SETTINGS_UI } from '../src/render/ui-text';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle } from './acceptance/tree-view-fakes';

/*
 * 0.2.8 look round, fix round F3 (person window, Find, picture picker, crop tool, texts). The DOM is checked in the fake DOM; the style rules are
 * read from the chunks in `styles/` (the join, `styles.css`, is made by the supervisor).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const chunk = (name: string) => readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector text is exactly `selector`. */
function rule(css: string, selector: string): string {
	const at = css.indexOf(`${selector} {`);
	expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0);
	return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

// Ann is marked. Bob is her child, Cid is his child, Dora is Bob's partner. All have years, so a row always has a second text line.
const BODY = [
	'options:',
	'  me: a',
	'people:',
	'  - id: a',
	'    name: Ann',
	'    born: 1100',
	'  - id: b',
	'    name: Bob',
	'    born: 1130',
	'    parents: [a]',
	'  - id: c',
	'    name: Cid',
	'    born: 1160',
	'    parents: [b]',
	'  - id: d',
	'    name: Dora',
	'    born: 1135',
	'unions:',
	'  - {partners: [b, d], type: marriage}',
	'',
].join('\n');

function open(id: string): FEl {
	const sheet = EditSheet.create({} as never, { handle: fakeHandle('n.md', BODY) as never, personId: id, sourcePath: 'n.md' })!;
	sheet.open();
	return (sheet as unknown as { contentEl: FEl }).contentEl;
}

const subOf = (content: FEl, attr: string, id: string) => content.querySelectorAll('.dynasty-family-row').find((r) => r.getAttribute(attr) === id)!.querySelector('.dynasty-row-sub')!;

describe('D215: the Family rows name no relation outside the window of the marked person', () => {
	it('the window of the marked person: a child row keeps the relation word before the years', () => {
		const sub = subOf(open('a'), 'data-child', 'b');
		expect(sub.querySelector('i')).not.toBeNull();
		expect(sub.getText()).toContain('1130');
	});

	it('the window of another person: a parent, a partner and a child row show the years only', () => {
		const content = open('b');
		expect(subOf(content, 'data-child', 'c').querySelector('i')).toBeNull();
		expect(subOf(content, 'data-child', 'c').getText()).toBe('b. 1160');
		expect(subOf(content, 'data-parent', 'a').querySelector('i')).toBeNull();
		expect(subOf(content, 'data-parent', 'a').getText().replace(/^You/, '')).toMatch(/1100/);
		expect(content.querySelector('.dynasty-family-row[data-partner="d"] .dynasty-row-sub')!.querySelector('i')).toBeNull();
	});

	it('the marked person keeps the name "You" in bold in any window', () => {
		const sub = subOf(open('b'), 'data-parent', 'a');
		expect(sub.querySelector('b')!.getText()).toBe('You');
	});

	it('the screen-reader name of a child row holds no relation word', () => {
		const row = open('b').querySelectorAll('.dynasty-family-row').find((r) => r.getAttribute('data-child') === 'c')!;
		expect(row.getAttribute('aria-label')).toBe('Cid. Open this person.');
	});
});

describe('D209 item 6: the text of "Arms on cards"', () => {
	it('ends with the three sentences of the clarity-editor', () => {
		expect(SETTINGS_UI.armsOnCardsDesc.endsWith('The list in a note on a phone does not follow this setting. In that list, only the person at the top shows arms. Those arms are the personal arms of the person, or else the arms of the house.')).toBe(true);
	});
});

describe('F3 styles', () => {
	it('item 1: the crop tool keeps its dark surface where the phone sheet and a theme rule would paint the page colour', () => {
		const css = chunk('24-crop-tool.css');
		const body = rule(css, '.modal-container .modal.dynasty-sheet.dynasty-crop.dynasty-crop');
		expect(body).toMatch(/background:\s*black !important/);
		expect(body).toMatch(/color:\s*white !important/);
		expect(body).toMatch(/backdrop-filter:\s*none !important/);
	});

	it('item 2: the link and the grey text of the picture picker use the tokens that reach 4.5:1', () => {
		const css = chunk('13-person-picker.css');
		expect(css).toMatch(/\.dynasty-picture-device \.dynasty-picture-name,\s*\.modal\.dynasty-picture-picker \.dynasty-picture-device \.dynasty-picture-plus\s*\{\s*color:\s*var\(--dynasty-link\)/);
		expect(rule(css, '.modal.dynasty-picture-picker .dynasty-picture-count')).toContain('color: var(--dynasty-muted)');
		expect(css).toMatch(/\.dynasty-picture-folder,[^{]*\{\s*color:\s*var\(--dynasty-muted\)/);
	});

	it('item 3: the grey line of the selected Find row moves toward the text colour', () => {
		const css = chunk('13-person-picker.css');
		expect(css).toContain('.dynasty-picker .suggestion-item.is-selected .dynasty-picker-sub');
		expect(css).toMatch(/color-mix\(in srgb, var\(--text-normal\) \d+%, var\(--dynasty-muted\)\)/);
	});

	it('items 4 and 5: the window and the Find prompt are opaque on a computer and on a phone, (the `rgb(from …)` check is in review-r028-g2c-css.test.ts)', () => {
		const sheet = chunk('10-edit-sheet.css');
		const picker = chunk('13-person-picker.css');
		expect(rule(sheet, '.modal-container .modal.dynasty-sheet.dynasty-sheet')).toContain('background: var(--background-primary)');
		expect(rule(picker, '.modal-container .prompt.dynasty-picker.dynasty-picker')).toContain('background: var(--background-primary)');
	});

	it('item 6: on a phone the type chip and the links in the relation line are 44 px high boxes', () => {
		const css = chunk('10-edit-sheet.css');
		const chip = rule(css, '.dynasty-sheet.is-phone .dynasty-chip-select');
		expect(chip).toContain('height: 44px');
		expect(rule(css, '.dynasty-sheet.is-phone .dynasty-chip-select select.dynasty-family-select')).toContain('min-height: 44px');
		// The look stays: the border of 32 px is drawn inside.
		expect(rule(css, '.dynasty-sheet.is-phone .dynasty-chip-select::before')).toContain('inset: 6px 0');
		expect(rule(css, '.dynasty-sheet.is-phone .dynasty-head-rel .dynasty-link')).toContain('min-height: 44px');
	});

	it('item 7: the end controls of a Family row grow with the chip, so the chip never covers the text line', () => {
		const css = chunk('11-sheet-family.css');
		expect(rule(css, '.dynasty-family-row:is([data-parent], [data-partner]) > .dynasty-family-controls')).toMatch(/flex:\s*0 0 auto[\s\S]*min-width:\s*var\(--dynasty-family-end\)/);
		expect(rule(css, '.dynasty-family-row > .dynasty-row-text')).toContain('padding-right');
	});
});
