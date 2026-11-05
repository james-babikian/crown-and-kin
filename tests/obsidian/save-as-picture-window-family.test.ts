import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { openIdWindow } from '../../src/obsidian/id-window';
import { SaveWindow } from '../../src/obsidian/save-picture';
import { SAVE_UI, WINDOW_UI } from '../../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeDoc, flushFrames, resetDom, runTimers } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G5 fix round of 0.2.8 (plugin faults P2 to P6). P1 (the first view of the Show view) is in `succession-drawn.test.ts`. The style rules are read from the
 * chunks in `styles/`; what a browser lays out is for the harness (see the report of the round).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const chunk = (name: string) => readFileSync(fileURLToPath(new URL(`../../styles/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first rule whose selector text is exactly `selector`. */
function rule(css: string, selector: string): string {
	const at = css.indexOf(`${selector} {`);
	expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0);
	return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('the window "Save as picture" is in the window family', () => {
	function open(phone: boolean) {
		device.width = phone ? 390 : 1280;
		const saved: string[] = [];
		const win = new SaveWindow({} as never, { save: (k) => void saved.push(k) });
		(win as unknown as { scope: { register: () => void } }).scope = { register: () => undefined };
		win.open();
		return { win, saved, modal: (win as unknown as { modalEl: FEl }).modalEl, content: (win as unknown as { contentEl: FEl }).contentEl };
	}

	it('a phone: a bar with Cancel, the title and Save; the two kinds are in the body', () => {
		const { content, modal } = open(true);
		const bar = content.querySelector('.dynasty-bar')!;
		expect(bar).not.toBeNull();
		expect(bar.children.map((c) => c.getText())).toEqual(['Cancel', 'Save as picture', 'Save']);
		expect(modal.hasClass('is-bar')).toBe(true);
		expect(content.querySelector('.dynasty-sheet-body')!.querySelectorAll('.dynasty-save-kind')).toHaveLength(2);
		// D330 O-06: the title stands in the bar only; the body has no second title.
		expect(content.querySelector('.dynasty-title')).toBeNull();
		// The old markup had its own header and no frame of the family.
		expect(content.querySelector('.dynasty-sheet-header.dynasty-bar')).not.toBeNull();
	});

	it('a computer: the footer has Cancel and Save, and the title shows in the tool role (D330 O-06)', () => {
		const { content } = open(false);
		expect(content.querySelector('.dynasty-bar')).toBeNull();
		const foot = content.querySelector('.dynasty-foot')!;
		expect(foot.querySelectorAll('button').map((b) => b.getText())).toEqual(['Cancel', 'Save Ctrl+Enter']);
		const title = content.querySelector('.dynasty-sheet-title')!;
		expect(title.getText()).toBe(SAVE_UI.title);
		expect(title.hasClass('dynasty-sr-only')).toBe(false);
		expect(title.hasClass('dynasty-title')).toBe(true);
		expect(title.hasClass('is-tool')).toBe(true);
	});

	it('D330 O-06: the two kinds are native radios of one group, each with one hint line, and the first is selected', () => {
		const { content } = open(false);
		const rows = content.querySelectorAll('.dynasty-save-kind');
		expect(rows.map((r) => r.tag)).toEqual(['label', 'label']);
		const radios = rows.map((r) => r.querySelector('input')!);
		expect(radios.map((r) => r.getAttribute('type'))).toEqual(['radio', 'radio']);
		expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
		expect(radios.map((r) => r.checked)).toEqual([true, false]);
		expect(rows.map((r) => r.querySelector('.dynasty-save-kind-label')!.getText())).toEqual([SAVE_UI.png, SAVE_UI.svg]);
		expect(rows.map((r) => r.querySelector('.dynasty-save-kind-hint')!.getText())).toEqual([SAVE_UI.pngDetail, SAVE_UI.svgDetail]);
		// No boxed card and no button is left of the old choice.
		expect(content.querySelector('.dynasty-choice-option')).toBeNull();
		expect(content.querySelector('.dynasty-save-kinds')!.querySelector('button')).toBeNull();
	});

	it('D330 O-06: the style has no box round a choice, a 44 px row and the focus recipe on the radio', () => {
		const css = chunk('23-legend-save.css');
		expect(rule(css, '.dynasty-save-kind')).toMatch(/min-height:\s*44px/);
		expect(rule(css, '.dynasty-save-kind')).not.toMatch(/border|box-shadow/);
		const focus = rule(css, '.dynasty-save-kind .dynasty-save-radio:focus-visible');
		expect(focus).toMatch(/outline:\s*var\(--dynasty-focus-outline\)/);
		expect(focus).toMatch(/outline-offset:\s*var\(--dynasty-focus-offset\)/);
		expect(focus).toMatch(/box-shadow:\s*var\(--dynasty-focus-shadow\)/);
		expect(css).not.toMatch(/dynasty-save-kind\.is-selected|dynasty-save-kind::before/);
	});

	it('keeps its behaviour: PNG is the default, a choice and Save call back, Cancel closes without a save', () => {
		for (const phone of [true, false]) {
			const a = open(phone);
			const save = a.content.querySelector('.dynasty-save-button')!;
			expect(save.getText()).toBe(phone ? 'Save' : 'Save Ctrl+Enter');
			expect(a.content.querySelector('.dynasty-save-kind[data-kind="png"] input')!.checked).toBe(true);
			// A native radio fires `change` when its row is chosen; the other radio of the group is then cleared by the browser.
			const svg = a.content.querySelector('.dynasty-save-kind[data-kind="svg"] input')!;
			svg.checked = true;
			dispatch(svg, 'change');
			dispatch(save, 'click');
			expect(a.saved).toEqual(['svg']);
			resetObsidian();
			const b = open(phone);
			dispatch(b.content.querySelector('.dynasty-sheet-cancel')!, 'click');
			expect(b.saved).toEqual([]);
		}
	});
});

describe('a Family row names the relation word that it shows', () => {
	const BODY = ['options:', '  me: a', 'people:', '  - {id: a, name: Ann, born: 1100}', '  - {id: b, name: Bob, born: 1130, parents: [a]}', '  - {id: c, name: Cid, born: 1160, parents: [b]}', ''].join('\n');
	const openFor = (id: string): FEl => {
		const sheet = EditSheet.create({} as never, { handle: fakeHandle('n.md', BODY) as never, personId: id, sourcePath: 'n.md' })!;
		sheet.open();
		return (sheet as unknown as { contentEl: FEl }).contentEl;
	};
	const childRow = (content: FEl, id: string) => content.querySelectorAll('.dynasty-family-row').find((r) => r.getAttribute('data-child') === id)!;

	it('the label is built from the name and the word', () => {
		expect(WINDOW_UI.openPersonLabel('Gwen', 'Daughter')).toBe('Gwen, Daughter. Open this person.');
		expect(WINDOW_UI.openPersonLabel('Gwen')).toBe('Gwen. Open this person.');
		// B-0003 (D313): the years follow, as the row shows them.
		expect(WINDOW_UI.openPersonLabel('Gwen', 'Daughter', 'b. 1131')).toBe('Gwen, Daughter, b. 1131. Open this person.');
		expect(WINDOW_UI.openPersonLabel('Roderick Valmont', undefined, 'b. 1131')).toBe('Roderick Valmont, b. 1131. Open this person.');
	});

	it('the window of the marked person: the label holds the visible name, the visible word and the years, in that order', () => {
		const row = childRow(openFor('a'), 'b');
		const word = row.querySelector('.dynasty-row-sub')!.querySelector('i')!.getText();
		expect(word.length).toBeGreaterThan(0);
		const label = row.getAttribute('aria-label')!;
		expect(label).toBe(`Bob, ${word}, b. 1130. Open this person.`);
		expect(label.indexOf('Bob')).toBeLessThan(label.indexOf(word));
		expect(label.indexOf(word)).toBeLessThan(label.indexOf('b. 1130'));
	});

	it('the window of another person shows no word (D215), so the label holds the name and the years', () => {
		const row = childRow(openFor('b'), 'c');
		expect(row.querySelector('.dynasty-row-sub')!.querySelector('i')).toBeNull();
		expect(row.getAttribute('aria-label')).toBe('Cid, b. 1160. Open this person.');
	});

	it('B-0003: the label holds the whole visible text of the row, name first and the second text line after it', () => {
		const row = childRow(openFor('b'), 'c');
		// How axe reads the visible text of a button: the pieces joined with no separator, then punctuation dropped.
		const curate = (t: string) => t.replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
		const visible = row.querySelector('.dynasty-family-name')!.getText() + row.querySelector('.dynasty-row-sub')!.getText();
		expect(visible).toBe('Cid b. 1160');
		expect(curate(row.getAttribute('aria-label')!)).toContain(curate(visible));
	});

	it('B-0003: a child with no year keeps the label of before', () => {
		const body = ['options:', '  me: a', 'people:', '  - {id: a, name: Ann}', '  - {id: b, name: Bob, parents: [a]}', ''].join('\n');
		const sheet = EditSheet.create({} as never, { handle: fakeHandle('n.md', body) as never, personId: 'a', sourcePath: 'n.md' })!;
		sheet.open();
		const row = childRow((sheet as unknown as { contentEl: FEl }).contentEl, 'b');
		const word = row.querySelector('.dynasty-row-sub')!.querySelector('i')!.getText();
		expect(row.getAttribute('aria-label')).toBe(`Bob, ${word}. Open this person.`);
	});

	it('B-0003: a sobriquet is part of the visible name, so the label holds it too', () => {
		const body = ['options:', '  me: a', 'people:', '  - {id: a, name: Ann, born: 1100}', '  - {id: b, name: Bob, sobriquet: the Bold, born: 1130, parents: [a]}', ''].join('\n');
		const sheetA = EditSheet.create({} as never, { handle: fakeHandle('n.md', body) as never, personId: 'a', sourcePath: 'n.md' })!;
		sheetA.open();
		const row = childRow((sheetA as unknown as { contentEl: FEl }).contentEl, 'b');
		const shown = row.querySelector('.dynasty-family-name')!.getText().trim();
		expect(shown).toContain('the Bold');
		expect(row.getAttribute('aria-label')!.startsWith(`${shown.split(/\s+/).join(' ')}, `)).toBe(true);
	});
});

describe('the hidden measure of a drop-down does not widen the settings tab', () => {
	it('the clone of the drop-down ends at the left edge of its box (G5b: `fixed` held only while the clone was narrower than the window), so it adds nothing to the scroll area', () => {
		const css = chunk('17-windows.css');
		const body = rule(css, '.dynasty-settings select.dropdown.is-measuring');
		expect(body).toMatch(/position:\s*absolute/);
		expect(body).toMatch(/right:\s*100%/);
		expect(body).not.toMatch(/position:\s*fixed/);
		// Its width is not capped: Obsidian reads it to size the visible drop-down.
		expect(body).not.toMatch(/(?<!-)width\s*:/);
		expect(body).not.toMatch(/max-width|overflow/);
	});
});

describe('the pencil stands on the grid of the bar: 8 px inside the block, with no negative margin at the right', () => {
	it('neither the pencil button nor the icon inside it has a margin; the pencil box of the large row takes 8 px of the gap before it', () => {
		const css = chunk('31-phone-list.css');
		expect(rule(css, '.dynasty-list button.dynasty-list-edit:not(.dynasty-list-whole)')).not.toMatch(/margin/);
		expect(rule(css, '.dynasty-list-edit-icon')).not.toMatch(/margin/);
		expect(rule(css, '.dynasty-list-whole > .dynasty-list-edit-icon')).toMatch(/margin-left:\s*calc\(-1 \* var\(--dynasty-space-2\)\)/);
	});
});

describe('the Id window opens with no field focused, and nothing in the plugin moves the focus into a field after it opens', () => {
	it('the window keeps the focus through the frames and timers that follow the open', () => {
		device.width = 390;
		device.coarse = true;
		let field: FEl | null = null;
		openIdWindow({} as never, {
			kind: 'house',
			item: 'House Valmont',
			key: 'valmont',
			value: 'valmont',
			check: () => null,
			make: () => 'valmont',
			use: () => undefined,
			closed: () => undefined,
		});
		field = fakeDoc.activeElement;
		expect(field?.hasClass('dynasty-id-window')).toBe(true);
		flushFrames();
		runTimers();
		expect(fakeDoc.activeElement).toBe(field);
	});
});
