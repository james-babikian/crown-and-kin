import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { closePluginModals } from '../src/obsidian/plugin-modals';
import { resetOpenSections } from '../src/obsidian/window-sections';
import { clock, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_16, openWin, page } from './r027-window-support';

/*
 * G2 review of the 0.2.8 part-A repairs: the Titles window. Run: npx vitest run tests/review-r028-g2a-titles.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	resetOpenSections();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

describe('a tap on an heir with an unsaved draft', () => {
	it('asks first; Keep editing leaves the window and the draft; Discard closes and opens the person', () => {
		const opened: string[] = [];
		const o = openWin(BODY_16, { openPerson: (id) => void opened.push(id) });
		const p = page(o, 'duke-of-carrowmere');
		const name = p.querySelector('[data-field="name"] input, input[data-focus="name"]') ?? p.querySelectorAll('input')[0];
		name.value = `${name.value} X`;
		dispatch(name, 'input');
		expect(o.win.isDirty()).toBe(true);
		dispatch(p.querySelectorAll('.dynasty-succ-item')[1], 'click');
		const confirm = o.modal.querySelector('.dynasty-sheet-confirm');
		expect(confirm).toBeTruthy();
		expect(opened).toEqual([]);
		expect(o.closed.n).toBe(0);
		dispatch(confirm!.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(o.modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(o.win.isDirty()).toBe(true);
		dispatch(o.content.querySelector('.dynasty-lw-page')!.querySelectorAll('.dynasty-succ-item')[1], 'click');
		dispatch(o.modal.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(opened).toEqual(['jasper-carrow']);
		expect(o.closed.n).toBe(1);
	});
});
