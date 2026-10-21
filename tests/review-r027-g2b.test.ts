// Code review G2b of 0.2.7 (WP3 Titles window, WP4 geometry, open branches). Each test is a proof of one finding; each fails on release-0.2.7 (8bf7881).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine } from '../src/core/succession';
import { closePluginModals } from '../src/view/plugin-modals';
import { clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { choose, ctl, lineTexts, openWin, page } from './r027-window-support';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A made-up tree: one title `crown` with `extra` keys, ruler rex from 1100, two children. */
function mini(extra: string): string {
	return [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		...extra.split('\n').map((l) => `    ${l}`),
		'    holders:',
		'      - {person: rex, from: 1100}',
		'people:',
		'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
		'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
		'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
		'',
	].join('\n');
}

describe('finding 1: a value the plugin cannot read cannot be cleared by choosing the value that the list already shows', () => {
	it('phone: the bad rule `succession: salic` shows first in the list, and choosing "None" removes it', () => {
		device.width = 390;
		device.coarse = true;
		const o = openWin(mini('succession: salic'));
		const p = page(o, 'crown');
		expect(ctl(p, 'rule')!.querySelector('select')!.value).toBe('?'); // ruling A: the note has a bad rule, so the unknown value is chosen
		choose(p, 'rule', '');
		// The draft (`titles-draft` test "None removes it") means to remove the key; the window can never send that choice.
		expect(o.win.isDirty(), 'tapping None on a bad rule must remove the key').toBe(true);
	});

	it('phone: the bad `inherit: foo` shows first in the list, and choosing "No preference" replaces it', () => {
		device.width = 390;
		device.coarse = true;
		const o = openWin(mini('succession: eldest-child\ninherit: foo'));
		const p = page(o, 'crown');
		choose(p, 'inherit', 'no-preference');
		expect(o.win.isDirty(), 'tapping No preference on a bad "inherit" must replace the bad text').toBe(true);
	});
});

describe('finding 2: the window computes the line with a year that the tree reader refused (contract A.1: the field stays undefined)', () => {
	it('`year: [1100, 1105]` gives "in 1100" in the window and "now" for the saved title', () => {
		const o = openWin(mini('succession: eldest-child\nyear: [1100, 1105]'));
		const p = page(o, 'crown');
		const r = parseDynasty(mini('succession: eldest-child\nyear: [1100, 1105]'));
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		const saved = successionLine(g, g.titles[0], specOf(g.titles[0]), 5, 110);
		expect(saved.year).toBeNull();
		expect(lineTexts(p)[0], 'the window must show the line that Show will draw').toBe('After Rex now');
	});
});
