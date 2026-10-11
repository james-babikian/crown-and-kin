import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { openIdWindow } from '../src/obsidian/id-window';
import { SaveWindow } from '../src/obsidian/save-picture';
import { WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle } from './acceptance/tree-view-fakes';

/*
 * G5 fix round of 0.2.8 (plugin faults P2 to P6). P1 (the first view of the Show view) is in `r027-show-pure.test.ts`. The style rules are read from the
 * chunks in `styles/`; what a browser lays out is for the harness (see the report of the round).
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

describe('P2: the window "Save as a picture" is in the window family', () => {
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
		expect(bar.children.map((c) => c.getText())).toEqual(['Cancel', 'Save as a picture', 'Save']);
		expect(modal.hasClass('is-bar')).toBe(true);
		expect(content.querySelector('.dynasty-sheet-body')!.querySelectorAll('.dynasty-save-kind')).toHaveLength(2);
		// The old markup had its own header and no frame of the family.
		expect(content.querySelector('.dynasty-sheet-header.dynasty-bar')).not.toBeNull();
	});

	it('a computer: the footer has Cancel and Save, and the title is for a screen reader only', () => {
		const { content } = open(false);
		expect(content.querySelector('.dynasty-bar')).toBeNull();
		const foot = content.querySelector('.dynasty-foot')!;
		expect(foot.querySelectorAll('button').map((b) => b.getText())).toEqual(['Cancel', 'Save']);
		expect(content.querySelector('.dynasty-sheet-title')!.hasClass('dynasty-sr-only')).toBe(true);
	});

	it('keeps its behaviour: PNG is the default, a choice and Save call back, Cancel closes without a save', () => {
		for (const phone of [true, false]) {
			const a = open(phone);
			const save = a.content.querySelector('.dynasty-save-button')!;
			expect(save.getText()).toBe('Save');
			expect(a.content.querySelector('.dynasty-save-kind[data-kind="png"]')!.getAttribute('aria-checked')).toBe('true');
			dispatch(a.content.querySelector('.dynasty-save-kind[data-kind="svg"]')!, 'click');
			dispatch(save, 'click');
			expect(a.saved).toEqual(['svg']);
			resetObsidian();
			const b = open(phone);
			dispatch(b.content.querySelector('.dynasty-sheet-cancel')!, 'click');
			expect(b.saved).toEqual([]);
		}
	});
});

describe('P3: a Family row names the relation word that it shows', () => {
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
	});

	it('the window of the marked person: the label holds the visible name and the visible word, in that order', () => {
		const row = childRow(openFor('a'), 'b');
		const word = row.querySelector('.dynasty-row-sub')!.querySelector('i')!.getText();
		expect(word.length).toBeGreaterThan(0);
		const label = row.getAttribute('aria-label')!;
		expect(label).toBe(`Bob, ${word}. Open this person.`);
		expect(label.indexOf('Bob')).toBeLessThan(label.indexOf(word));
	});

	it('the window of another person shows no word (D215), so the label keeps the name only', () => {
		const row = childRow(openFor('b'), 'c');
		expect(row.querySelector('.dynasty-row-sub')!.querySelector('i')).toBeNull();
		expect(row.getAttribute('aria-label')).toBe('Cid. Open this person.');
	});
});

describe('P4: the hidden measure of a drop-down does not widen the settings tab', () => {
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

describe('P5: the pencil icon of a small row does not pull a second margin', () => {
	it('the icon inside the 44 px pencil button has no negative margin; the large row keeps its own', () => {
		const css = chunk('31-phone-list.css');
		expect(rule(css, '.dynasty-list button.dynasty-list-edit:not(.dynasty-list-whole) .dynasty-list-edit-icon')).toMatch(/margin-right:\s*0\b/);
		expect(rule(css, '.dynasty-list-edit-icon')).toMatch(/margin-right:\s*-8px/);
	});
});

describe('P6: nothing in the plugin moves the focus out of the Id field after it opens', () => {
	it('the field keeps the focus through the frames and timers that follow the open', () => {
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
		expect(field?.hasClass('dynasty-id-input')).toBe(true);
		flushFrames();
		runTimers();
		expect(fakeDoc.activeElement).toBe(field);
	});
});
