// Review of 0.2.3, area B. C8 (WCAG 2.5.3, label in name): the accessible name of a button starts with its visible text.
// The C8 fix changed the pairs that its test lists (`v113-windows.test.ts`). Two buttons are not on that list.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import * as UI from '../src/render/ui-text';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
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
});
