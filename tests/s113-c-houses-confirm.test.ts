import { readFileSync } from 'node:fs';
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
 * Search round 0.2.3, area C. The delete question of the Houses window (D32) lists every person of the
 * house in one sentence. The question is a layer over the window with no scroll.
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

/** One house with `n` people (a main house of a dynasty), and an empty second house. */
function bigHouseBody(n: number): string {
	const lines = ['houses:', '  - id: valmont', '    name: House Valmont', '  - id: orsini', '    name: House Orsini', '', 'people:'];
	for (let i = 1; i <= n; i++) lines.push(`  - id: p${i}`, `    name: Valmont Person${i}`, '    house: valmont');
	return `${lines.join('\n')}\n`;
}

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
	if (!m) throw new Error(`no CSS rule for ${selector}`);
	return m[1];
}

describe('the delete question of the Houses window with a large house', () => {
	it('the question box can scroll or has a largest height, so the buttons stay reachable', () => {
		const layer = rule('.dynasty-sheet-confirm');
		const box = rule('.dynasty-sheet-confirm-box');
		const modal = rule('.modal.dynasty-sheet');
		// The modal clips what leaves it (the buttons below the box); the question layer is a fixed box.
		expect(modal).toMatch(/overflow:\s*hidden/);
		const canScroll = /overflow(-y)?:\s*(auto|scroll)/.test(layer) || /overflow(-y)?:\s*(auto|scroll)/.test(box);
		const capped = /max-height:/.test(box);
		expect(canScroll || capped).toBe(true);
	});

	it('the question for 400 people gives the number only: a short box on a phone (was: 400 names in one text)', async () => {
		const handle = writingHandle(bigHouseBody(400));
		const e = await embed(handle.body, { handle });
		const button = e.el.querySelector('.dynasty-houses-button')!;
		dispatch(button, 'click');
		await settle();
		const win = openModals.find((m) => (m as unknown) instanceof HousesWindow) as unknown as { modalEl: FEl; contentEl: FEl };
		expect(win).toBeDefined();
		// 0.2.5 (D134): Delete is on the edit page of the house.
		await click(win.contentEl.querySelector('button.dynasty-lw-row[data-house="valmont"]'));
		await click(win.contentEl.querySelector('.dynasty-lw-page .dynasty-house-delete'));
		const layer = win.modalEl.querySelector('.dynasty-sheet-confirm')!;
		const lines = layer.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText());
		const chars = lines.join(' ').length;
		// A phone box is about 340 px wide: about 38 characters in a text line.
		expect(chars / 38).toBeLessThan(30);
		// Adapted for the owner's choice 1C (D113 item 1): the question gives the number only, never the names.
		expect(lines[0]).toBe('400 people have this house.');
		expect(lines.join(' ')).not.toContain('Person1');
	});
});
