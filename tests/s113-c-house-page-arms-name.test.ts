import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { openHousePage } from '../src/obsidian/house-page-window';
import { FEl, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';

/*
 * Search round 0.2.3, area C. The house page gives its arms box (a plain `div`) an `aria-label`. A `div`
 * has no role, and an `aria-label` on a generic element is not announced (ARIA 1.2: naming is prohibited on
 * the generic role). The picture inside has `alt=""`. So the arms have no accessible name. The Houses window
 * names the same box, because there it is a `button`.
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

const BODY = `houses:
  - {id: valmont, name: House Valmont, color: "#8b1a1a", arms: "[[arms.png]]"}
people:
  - {id: aldric, name: Aldric Valmont, house: valmont}
`;

describe('arms box of the house page', () => {
	it('has a role that lets its aria-label work (img or group)', () => {
		const parsed = parseDynasty(BODY);
		if (!parsed.ok) throw new Error('bad body');
		const win = openHousePage({} as never, { app: {} as never, houseId: 'valmont', whole: deriveFamilies(parsed.tree), sourcePath: 'Tree.md', show: () => {}, openNote: () => {} })!;
		const arms = (win as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-hp-arms')!;
		expect(arms.getAttribute('aria-label')).toBeTruthy();
		expect(['img', 'group', 'figure']).toContain(arms.getAttribute('role'));
	});
});
