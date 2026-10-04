// Review of 0.2.3, area B. C8 (WCAG 2.5.3, label in name): the accessible name of a button starts with its visible text.
// The C8 fix changed the pairs that its test lists (`v113-windows.test.ts`). Two buttons are not on that list.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import * as UI from '../src/render/ui-text';
import { openHousePage } from '../src/obsidian/house-page-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

describe('RB1: the accessible name of a plugin button starts with its visible text', () => {
	it('the More item "Save as picture" (tree-view.ts item(..., SAVE_UI.more, ..., SAVE_UI.moreLabel)) has a name that starts with other words', () => {
		expect(norm(UI.SAVE_UI.moreLabel), `visible "${UI.SAVE_UI.more}" vs name "${UI.SAVE_UI.moreLabel}"`).toContain(norm(UI.SAVE_UI.more));
	});

	it('the house page row: its name is "Show X in the tree", but the visible text is the generation, the name, the title and the dates', () => {
		const parsed = parseDynasty('houses:\n  - {id: v, name: House Valmont}\npeople:\n  - {id: a, name: Aldric, house: v, title: Duke, born: "1100", died: "1160"}\n');
		if (!parsed.ok) throw new Error('bad body');
		const win = openHousePage({} as never, { app: {} as never, houseId: 'v', whole: deriveFamilies(parsed.tree), sourcePath: 'T.md', show: () => {}, openNote: () => {} })!;
		const row = (win as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-hp-row')!;
		const visible = row.getText();
		// With no aria-label the name is the content of the button.
		const name = row.getAttribute('aria-label') ?? visible;
		expect(norm(name), `visible text "${visible}" vs name "${name}"`).toContain(norm(visible));
	});
});
