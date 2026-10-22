// G2 review of names step 2 (render + view), finding: the Houses window person row shows the reign in its title as written, with no name of the year (spec §14 rule 15).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => ({ ...(await import('./acceptance/fake-obsidian')) }));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { compileCalendars, type DateReader } from '../src/core/dates';
import { HousesWindow } from '../src/obsidian/houses-window';
import { FEl, clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { cycles, list } from './dates-support/names';
import { openPage } from './lw-support';
import { stripNotDisabled, writingHandle } from './s113-c-support';
import { closePluginModals } from '../src/view/plugin-modals';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
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

const reader: DateReader = compileCalendars([cycles('C', ['{cycle}.{year} {planet}', '{cycle}.{year}'], [list()])], true);
const BODY = [
	'houses:', '  - {id: orsini, name: House Orsini}',
	'titles:', '  - id: crown', '    name: Crown', '    holders:', '      - {person: aldric, number: II, from: "22.13", to: "22.14"}',
	'people:', '  - {id: aldric, name: Aldric Orsini, house: orsini, born: "22.10", died: "22.14", sex: m}', '',
].join('\n');

describe('§14 rule 15: the Houses window row', () => {
	it('shows the names of the years in the reign of the title, as it does in the dates', () => {
		const handle = writingHandle(BODY);
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const win = HousesWindow.create(app as never, { handle: handle as never, sourcePath: 'n.md', onClosed: () => undefined, people: { show: () => undefined, openNote: () => undefined }, dates: () => reader })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const row = openPage(content, 'orsini').querySelector('[data-section="people"]')!.querySelector('.dynasty-hp-row')!;
		expect(row.querySelector('.dynasty-row-sub')!.getText()).toContain('22.10 Ve\u2009–\u200922.14 Ju');
		// nb() puts no-break spaces and a word joiner in the reign; the test looks at the letters only.
		const letters = row.querySelector('.dynasty-hp-name')!.parentElement!.getText().replace(/⁠/g, '').replace(/ /g, ' ').replace(/\u202f/g, '\u2009');
		expect(letters).toContain('(r. 22.13 Sa\u2009–\u200922.14 Ju)');
	});
});
