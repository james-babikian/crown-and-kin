import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { DEFAULT_SETTINGS } from '../src/view/settings';
import { fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { loadPlugin } from './acceptance/tree-view-fakes';

/*
 * G2 review of the 0.2.8 part-A repairs: redrawViews. Run: npx vitest run tests/review-r028-g2a-redraw.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

describe('a setting change with trees that nobody sees', () => {
	it('the waiting redraws stop when the plugin unloads', async () => {
		const { plugin } = await loadPlugin();
		const calls: string[] = [];
		const views = (plugin as unknown as { views: Set<unknown> }).views;
		for (const n of ['h1', 'h2', 'h3']) views.add({ offScreen: true, onSettingsChange: () => void calls.push(n) });
		await plugin.changeSettings({ showPortraits: !DEFAULT_SETTINGS.showPortraits });
		(plugin as unknown as { unload(): void }).unload();
		await new Promise((r) => setTimeout(r, 30));
		expect(calls).toEqual([]);
	});
});
