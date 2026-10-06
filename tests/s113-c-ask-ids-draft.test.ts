import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../src/core/parse';
import { HousesWindow } from '../src/obsidian/houses-window';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './acceptance/tree-view-fakes';
import { backToList, openPage, pageOf } from './lw-support';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.3, area C. Save of the Houses window with a changed id asks one question and then
 * writes the ops that it computed BEFORE the question (`save()` -> `askIds(changed, go)` -> `commit(ops)`).
 * The question layer is `position: absolute` over the window, but nothing makes the controls behind it
 * inert: Shift+Tab from the first button of the question reaches them. An edit made there is shown in the
 * window, but the answer writes the old ops, and then the window closes: the edit is lost without a word.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
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

const BODY = ['houses:', '  - id: valmont', '    name: House Valmont', '  - id: orsini', '    name: House Orsini', '', 'people:', '  - id: a', '    name: Aldric', '    house: valmont', ''].join('\n');

describe('the question before an id change in the Houses window', () => {
	it('writes the draft that the window shows when the owner answers, not the draft of the moment of Save', async () => {
		const h = writingHandle(BODY);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		// Change the id of House Valmont through the small window.
		await click(openPage(content, 'valmont').querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		// The page of House Orsini stays open behind the question that Save opens.
		backToList(content);
		openPage(content, 'orsini');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(modal.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
		// The owner presses Shift+Tab to a control behind the question and renames House Orsini.
		const orsini = pageOf(content).querySelector('.dynasty-house-name textarea')!;
		type(orsini, 'House Zeta');
		await click(modal.querySelector('.dynasty-id-change'));
		const t = parseDynasty(h.body);
		if (!t.ok) throw new Error('parse');
		const names = Object.fromEntries(t.tree.houses.map((x) => [x.id, x.name]));
		expect(names['house-valmont']).toBe('House Valmont');
		// The window showed "House Zeta" when the owner answered.
		expect(names.orsini).toBe('House Zeta');
	});

	it('the Titles window does the same (titles-window.ts save() -> askIds -> commit(ops))', async () => {
		const body = ['titles:', '  - id: crown', '    name: Crown', '  - id: duchy', '    name: Duchy', 'people:', '  - id: a', '    name: Aldric', '    card-title: crown', ''].join('\n');
		const h = writingHandle(body);
		const win = TitlesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const modal = (win as unknown as { modalEl: FEl }).modalEl;
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await click(openPage(content, 'crown').querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'the-crown');
		await click(idWin.querySelector('.dynasty-id-use'));
		backToList(content);
		openPage(content, 'duchy');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(modal.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
		type(pageOf(content).querySelector('.dynasty-title-name textarea')!, 'Grand Duchy');
		await click(modal.querySelector('.dynasty-id-change'));
		const t = parseDynasty(h.body);
		if (!t.ok) throw new Error('parse');
		const names = Object.fromEntries((t.tree.titles ?? []).map((x) => [x.id, x.name]));
		expect(names['the-crown']).toBe('Crown');
		expect(names.duchy).toBe('Grand Duchy');
	});
});
