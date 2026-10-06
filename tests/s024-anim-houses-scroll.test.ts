import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { HousesWindow } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed } from './acceptance/tree-view-fakes';
import { click, stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.4, area S024-anim. "Add house" in the Houses window draws the whole window again
 * (`build`). The Titles window keeps the scroll position of its body over such a redraw; the Houses
 * window does not. The list jumps to the top, then the focus call scrolls the new row into view:
 * this is one cause of the stutter while the keyboard slides in (D115).
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

function body(n: number): string {
	const lines = ['houses:'];
	for (let i = 1; i <= n; i++) lines.push(`  - id: h${i}`, `    name: House ${i}`);
	lines.push('', 'people:', '  - id: a', '    name: A', '    house: h1');
	return `${lines.join('\n')}\n`;
}

// 0.2.5 (D134): the window is a list and an edit page. A page opens at the top, and Back puts the list at its place again.
describe('Houses window keeps the scroll position of its list', () => {
	it('a page opens at the top, and Back puts the list at the scrollTop that it had; Add house opens its page at the top too', async () => {
		const handle = writingHandle(body(12));
		const e = await embed(handle.body, { handle });
		dispatch(e.el.querySelector('.dynasty-houses-button')!, 'click');
		await settle();
		const win = openModals.find((m) => (m as unknown) instanceof HousesWindow) as unknown as { contentEl: FEl };
		expect(win).toBeDefined();
		const before = win.contentEl.querySelector('.dynasty-sheet-body')!;
		before.scrollTop = 420;
		await click(win.contentEl.querySelector('button.dynasty-lw-row'));
		const after = win.contentEl.querySelector('.dynasty-sheet-body')!;
		expect(after).not.toBe(before);
		expect(after.scrollTop).toBe(0);
		await click(win.contentEl.querySelector('button[data-focus="back"]'));
		expect(win.contentEl.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(420);
		win.contentEl.querySelector('.dynasty-sheet-body')!.scrollTop = 420;
		await click(win.contentEl.querySelector('.dynasty-house-add'));
		expect(win.contentEl.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(0);
	});
});
