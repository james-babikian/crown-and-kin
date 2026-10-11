import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { SETTINGS_UI, FLOW } from '../src/render/ui-text';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow } from '../src/obsidian/houses-window';
import { pickPerson } from '../src/obsidian/person-picker';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './acceptance/tree-view-fakes';
import { openPage } from './lw-support';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Version 0.2.3, work package "phone" (search round findings P4, P5, C1 and the house page of D113 item 4): the names of
 * the windows, the name of the search field, the reveal of a focused field in the scrolling windows, and the house page
 * with and without the generation. The close slide (P1) and the CSS are proved in `v113-phone-close-slide.test.ts` and
 * in the real Obsidian (`s113 ...`, `v113 phone ...`).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});


const BODY = [
	'houses:',
	'  - {id: valmont, name: House Valmont}',
	'titles:',
	'  - {id: duke, name: Duke}',
	'people:',
	'  - {id: a, name: Aldric Valmont, house: valmont, born: "1102", died: "1160", title: Duke of Valmont}',
	'  - {id: b, name: Bran Valmont, house: valmont, born: "1130", parents: [a]}',
	'',
].join('\n');

const graph = () => {
	const p = parseDynasty(BODY);
	if (!p.ok) throw new Error('bad body');
	return deriveFamilies(p.tree);
};

/** The element that the window's aria-labelledby points to, with its text. */
function titleOf(modal: FEl): { id: string; text: string } {
	const id = modal.getAttribute('aria-labelledby') ?? '';
	const el = modal.all().find((e) => e.getAttribute('id') === id);
	return { id, text: el?.getText() ?? '' };
}

describe('P5: every window of the plugin is a dialog with a name', () => {
	const expectDialog = (modal: FEl, title: string) => {
		expect(modal.getAttribute('role')).toBe('dialog');
		expect(modal.getAttribute('aria-modal')).toBe('true');
		const t = titleOf(modal);
		expect(t.id).not.toBe('');
		expect(t.text).toBe(title);
	};

	it('the edit sheet, the Houses window and the Titles window', () => {
		const sheet = EditSheet.create({} as never, { handle: writingHandle(BODY) as never, personId: 'b', sourcePath: 'n.md' })!;
		sheet.open();
		expectDialog((sheet as unknown as { modalEl: FEl }).modalEl, (sheet as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-title')!.getText());
		const houses = HousesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		houses.open();
		expectDialog((houses as unknown as { modalEl: FEl }).modalEl, 'Houses');
		const titles = TitlesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		titles.open();
		expectDialog((titles as unknown as { modalEl: FEl }).modalEl, 'Titles');
	});

	it('two windows get two different title ids', () => {
		const a = HousesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		a.open();
		const b = TitlesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		b.open();
		const ids = [a, b].map((w) => (w as unknown as { modalEl: FEl }).modalEl.getAttribute('aria-labelledby'));
		expect(ids[0]).not.toBe(ids[1]);
	});

	it('every title of a window in src/obsidian goes through nameDialog (a guard for the windows that need a store or a file)', () => {
		const bad: string[] = [];
		for (const f of readdirSync(new URL('../src/obsidian/', import.meta.url))) {
			if (!f.endsWith('.ts') || f === 'sheet-parts.ts') continue;
			const text = readFileSync(new URL(`../src/obsidian/${f}`, import.meta.url), 'utf8');
			for (const line of text.split('\n')) if (line.includes("cls: 'dynasty-sheet-title'") && !line.includes('nameDialog(')) bad.push(`${f}: ${line.trim()}`);
		}
		expect(bad).toEqual([]);
	});
});

describe('P4: the search field of a person list has a name', () => {
	it('aria-label "Find a person", and no spell check (D101)', () => {
		void pickPerson(fakeApp() as never, graph(), new Set(), 'Type the name of the parent', 'Add parent');
		const picker = openModals[openModals.length - 1] as unknown as { inputEl: FEl };
		expect(picker.inputEl.getAttribute('aria-label')).toBe(FLOW.pickerSearchLabel);
		expect(FLOW.pickerSearchLabel).toBe('Find a person');
		expect(picker.inputEl.getAttribute('spellcheck')).toBe('false');
	});
});

describe('C1: a field in the scrolling body is brought into view when it gets the focus', () => {
	/** The call of scrollIntoView for a field after the focus, once the 300 ms of the keyboard have passed. */
	function reveals(modal: FEl, field: FEl): number {
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		field.focus();
		dispatch(field, 'focusin');
		expect(modal.contains(fakeDoc.activeElement)).toBe(true);
		runTimers(400);
		return spy.mock.calls.length;
	}

	it('the house name field of the Houses window', () => {
		const win = HousesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const page = openPage((win as unknown as { contentEl: FEl }).contentEl, 'valmont');
		expect(reveals(modal, page.querySelector('.dynasty-house-name textarea')!)).toBeGreaterThan(0);
	});

	it('the title name field of the Titles window', () => {
		const win = TitlesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const page = openPage((win as unknown as { contentEl: FEl }).contentEl, 'duke');
		expect(reveals(modal, page.querySelector('.dynasty-title-name textarea')!)).toBeGreaterThan(0);
	});

	it('a window that has closed does nothing when the timer runs', () => {
		const win = HousesWindow.create(fakeApp() as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md' })!;
		win.open();
		const field = openPage((win as unknown as { contentEl: FEl }).contentEl, 'valmont').querySelector('.dynasty-house-name textarea')!;
		field.focus();
		dispatch(field, 'focusin');
		// The first close leaves the page; the second closes the window.
		win.close();
		win.close();
		expect(openModals.includes(win as never)).toBe(false);
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		expect(() => runTimers(400)).not.toThrow();
		expect(spy).not.toHaveBeenCalled();
	});

	it('the new-house name field of the edit sheet has no spell check (D101)', () => {
		const sheet = EditSheet.create({} as never, { handle: writingHandle(BODY) as never, personId: 'b', sourcePath: 'n.md' })!;
		sheet.open();
		const modal = (sheet as unknown as { modalEl: FEl }).modalEl;
		expect(modal.querySelector('[data-field="new-house-name"] input')!.getAttribute('spellcheck')).toBe('false');
	});
});

describe('the texts of the setting', () => {
	it('the name and the description are short sentences', () => {
		expect(SETTINGS_UI.houseGeneration).toBe('Show generation on the house page');
		for (const s of SETTINGS_UI.houseGenerationDesc.split('. ')) expect(s.split(' ').length).toBeLessThanOrEqual(20);
	});
});
