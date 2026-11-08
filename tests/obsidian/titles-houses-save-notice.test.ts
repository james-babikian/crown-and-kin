import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => ({ ...(await import('../acceptance/fake-obsidian')) }));

import { HousesWindow } from '../../src/obsidian/houses-window';
import { closePluginModals } from '../../src/view/plugin-modals';
import { HOUSES, REMOVE, SUCCESSION_UI, TITLES_UI } from '../../src/render/ui-text';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { BODY_16, openWin, page } from '../support/titles-window-support';
import { openPage, pageOf } from '../support/lw-support';
import { click, stripNotDisabled, type, writingHandle } from '../support/windows-sheets-support';
import { useFakeDom } from '../support/fake-dom-setup';

// D334 Q4: Save in the Titles window and the Houses window closes the window, then a Notice with Undo names the change.
useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const save = (content: FEl) => click(content.querySelector('button[data-focus="save"]'));
const undoButton = () => noticeList[noticeList.length - 1]?.messageEl.querySelector('.dynasty-undo-button') ?? null;

describe('the Titles window after Save', () => {
	it('shows a Notice with Undo that names a new title, and Undo restores the note', async () => {
		const o = openWin();
		await click(o.content.querySelector('button.dynasty-lw-add'));
		type(o.content.querySelector('.dynasty-title-name textarea')!, 'Margrave of the Reach');
		await save(o.content);
		expect(openModals).not.toContain(o.win);
		expect(notices).toEqual([TITLES_UI.saved(['Margrave of the Reach'])]);
		expect(undoButton()?.getText()).toBe(REMOVE.undo);
		await click(undoButton());
		expect(o.handle.body).toBe(BODY_16);
	});

	it('names a changed title by its new name', async () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		type(p.querySelector('.dynasty-title-name textarea')!, 'Grand Duke of Carrowmere');
		await save(o.content);
		expect(notices).toEqual([TITLES_UI.saved(['Grand Duke of Carrowmere'])]);
		expect(undoButton()).not.toBeNull();
	});

	it('shows nothing when Save writes nothing', async () => {
		const o = openWin();
		page(o, 'duke-of-carrowmere');
		await save(o.content);
		expect(notices).toEqual([]);
		expect(o.handle.write).not.toHaveBeenCalled();
	});
});

describe('"Save and show" in the Line section of a new title', () => {
	it('stands under the note, saves the title and shows its line by the new id', async () => {
		const o = openWin();
		await click(o.content.querySelector('button.dynasty-lw-add'));
		const p = o.content.querySelector('.dynasty-lw-page')!;
		type(p.querySelector('.dynasty-title-name textarea')!, 'Margrave of the Reach');
		const button = p.querySelector('[data-section="line"] button.dynasty-succ-save-show')!;
		expect(button.getText()).toBe(SUCCESSION_UI.saveAndShow);
		expect(p.querySelector('[data-section="line"] [data-msg="new-title"]')!.getText()).toBe(SUCCESSION_UI.newTitleLine);
		// D338 point 4: the sentence and the button share one row, with the sentence at the left, as in a saved title.
		const note = p.querySelector('[data-section="line"] [data-msg="new-title"]')!;
		expect(note.parentElement).toBe(button.parentElement);
		expect(note.parentElement!.hasClass('dynasty-line-head')).toBe(true);
		expect(note.parentElement!.children).toEqual([note, button]);
		await click(button);
		expect(o.handle.body).toContain('Margrave of the Reach');
		expect(o.lines).toEqual(['margrave-of-the-reach']);
		expect(notices).toEqual([TITLES_UI.saved(['Margrave of the Reach'])]);
	});

	it('asks for a name first and shows no line when the name is empty', async () => {
		const o = openWin();
		await click(o.content.querySelector('button.dynasty-lw-add'));
		await click(o.content.querySelector('.dynasty-lw-page button.dynasty-succ-save-show'));
		expect(o.lines).toEqual([]);
		expect(o.handle.write).not.toHaveBeenCalled();
		expect(o.content.querySelector('.dynasty-field-error, .dynasty-sheet-field-error')).not.toBeNull();
	});
});

describe('the Houses window after Save', () => {
	const BODY = 'houses:\n  - id: valmont\n    name: House Valmont\n  - id: orsini\n    name: House Orsini\npeople:\n  - id: aldric\n    name: Aldric Valmont\n    house: valmont\n';
	function openHouses() {
		const handle = writingHandle(BODY);
		const win = HousesWindow.create(fakeApp() as never, { handle: handle as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		return { win, content, handle };
	}

	it('shows a Notice with Undo that names a new house', async () => {
		const { win, content, handle } = openHouses();
		await click(content.querySelector('button.dynasty-lw-add'));
		type(pageOf(content).querySelector('textarea.dynasty-lw-field')!, 'House Thorne');
		await save(content);
		expect(openModals).not.toContain(win);
		expect(notices).toEqual([HOUSES.saved(['House Thorne'])]);
		await click(undoButton());
		expect(handle.body).toBe(BODY);
	});

	it('names a changed house, and says how many when there are several', async () => {
		const { content } = openHouses();
		openPage(content, 'valmont');
		type(pageOf(content).querySelector('textarea.dynasty-lw-field')!, 'House Valmont of the North');
		await save(content);
		expect(notices).toEqual([HOUSES.saved(['House Valmont of the North'])]);
	});

	it('shows nothing when Save writes nothing', async () => {
		const { content, handle } = openHouses();
		openPage(content, 'valmont');
		await save(content);
		expect(notices).toEqual([]);
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('the saved texts', () => {
	it('say the title or the house for one item and the count for several', () => {
		expect(TITLES_UI.saved(['Duke of Testmark'])).toBe('The plugin saved the title Duke of Testmark.');
		expect(TITLES_UI.saved(['A', 'B', 'C'])).toBe('The plugin saved 3 titles.');
		expect(HOUSES.saved(['House Valmont'])).toBe('The plugin saved House Valmont.');
		expect(HOUSES.saved(['house valmont'])).toBe('The plugin saved house valmont.');
		expect(HOUSES.saved(['Valmont'])).toBe('The plugin saved the house Valmont.');
		expect(HOUSES.saved(['A', 'B'])).toBe('The plugin saved 2 houses.');
	});
});
