// G2 review of WP-4 step 4.3: the Titles window sentences with a calendar year. Failing proofs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { findBlocks } from '../src/core/block-locate';
import { parseCalendarBlock } from '../src/core/calendar-block';
import { compileCalendars } from '../src/core/dates';
import { closePluginModals } from '../src/view/plugin-modals';
import { clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { openWin, page } from './r027-window-support';
import { eraNote } from './support/calendar-vault';

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

const calendars = parseCalendarBlock(findBlocks(eraNote('Reign names', 'Qinglong Emperor', 130), 'kin-calendar')[0].body, 'Calendars.md', 0).calendars;
const reader = compileCalendars(calendars, true);

const NO_HOLDER = [
	'titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    year: Qinglong Emperor 1',
	'    holders:', '      - {person: aldric, from: Qinglong Emperor 5}',
	'people:', '  - {id: aldric, name: Aldric Valmont, sex: m}', '  - {id: bran, name: Bran Valmont, sex: m, parents: [aldric]}', '',
].join('\n');

describe('the sentence for a screen reader names the year as it is written', () => {
	it('the live summary of a line with no holder says the same year as the visible sentence', () => {
		const p = page(openWin(NO_HOLDER, { dates: () => reader }), 'crown');
		const visible = p.querySelector('.dynasty-succ-msg')?.getText();
		const live = p.querySelector('[data-succ="summary"]')?.getText();
		expect(visible).toContain('Qinglong Emperor 1');
		expect(live).toBe(visible);
	});
});

import { PLAIN_READER } from '../src/core/dates';
import { dateReadout } from '../src/render/date-readout';

describe('the grey line before the calendar index is ready', () => {
	it('does not say "No year found" for a date that a calendar would read (the reader is only not ready yet)', () => {
		const pending = compileCalendars([], false);
		const text = 'Qinglong Emperor 3';
		expect(pending.ready).toBe(false);
		// A plain reader with no calendar at all (a ready vault with none) may say so; a reader that is not ready must stay silent.
		// ruling 4.3 fix: the reader says it is not ready, as the third argument; a ReadDate alone cannot tell a pending reader from a ready one with no calendar.
		expect(dateReadout(text, pending.read(text), pending.ready)).toBe('');
		void PLAIN_READER;
	});
});
