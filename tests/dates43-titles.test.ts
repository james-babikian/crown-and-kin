import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { parseCalendarBlock } from '../src/core/calendar-block';
import { compileCalendars } from '../src/core/dates';
import { closePluginModals } from '../src/view/plugin-modals';
import { SUCCESSION_UI as T } from '../src/render/ui-text';
import { FEl, clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { ctl, lineRows, notes, openWin, page } from './r027-window-support';
import { eraNote } from './support/calendar-vault';
import { findBlocks } from '../src/core/block-locate';

/*
 * Step 4.3 of WP-4 (the architecture notes §5.7): the Titles window reads dates through the dates of its tree. The sentences of the line name the year as it is written, the year
 * field takes text, the label of a ruler follows a calendar date, and the notes for a death date with no year and for a date warning show.
 */

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
const dates = () => reader;

/** A title with one holder, written in the era calendar; Bran is the heir. */
function body(extra = '', people = ''): string {
	return [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		'    succession: eldest-child',
		...(extra ? extra.split('\n').map((l) => `    ${l}`) : []),
		'    holders:',
		'      - {person: aldric, from: Qinglong Emperor 3, to: Qinglong Emperor 9}',
		'people:',
		'  - {id: aldric, name: Aldric Valmont, sex: m, born: Qinglong Emperor 1}',
		'  - {id: bran, name: Bran Valmont, sex: m, born: Qinglong Emperor 2, parents: [aldric]}',
		people,
		'',
	]
		.filter((l) => l !== '')
		.join('\n');
}

describe('the Titles window with a calendar', () => {
	it('names the year of the line as it is written, not as a number of the plugin', () => {
		const o = openWin(body(), { dates });
		const p = page(o, 'crown');
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe('After Aldric in Qinglong Emperor 9');
		expect(lineRows(p)).toEqual(['1stBran Valmont']);
	});

	it('does the same for a line with no holder: the sentence names the text of the year field', () => {
		const late = body('year: Qinglong Emperor 1').replace('from: Qinglong Emperor 3, to: Qinglong Emperor 9', 'from: Qinglong Emperor 5');
		const o = openWin(late, { dates });
		const p = page(o, 'crown');
		expect(p.querySelector('.dynasty-succ-msg')?.getText()).toBe(T.noRuler('Qinglong Emperor 1'));
	});

	it('the year field takes text (no digit pad on a phone) and holds the text as written', () => {
		const o = openWin(body('year: Qinglong Emperor 9'), { dates });
		const p = page(o, 'crown');
		const year = ctl(p, 'year')!.querySelector('input')!;
		expect(year.getAttribute('inputmode')).toBe('text');
		expect(year.value).toBe('Qinglong Emperor 9');
	});

	it('without a calendar the same text gives no year: the line shows no holder at that year and no date note', () => {
		const o = openWin(body(), { dates: () => compileCalendars([], true) });
		const p = page(o, 'crown');
		expect(p.querySelector('.dynasty-succ-heading')).not.toBeNull();
		expect(notes(p, 'date-warning')).toEqual([]);
	});

	it('shows a note for a death date with no year, under the person who is out of the line only for it', () => {
		const people = '  - {id: cara, name: Cara Valmont, sex: f, born: Qinglong Emperor 3, died: of a fever, parents: [aldric]}';
		const o = openWin(body('', people), { dates });
		const p = page(o, 'crown');
		const found = notes(p, 'died-no-year');
		expect(found.length).toBeGreaterThan(0);
		expect(found[0]).toContain('The plugin cannot read a year in the death date of Cara Valmont.');
		expect(found[0]).toContain('Qinglong Emperor 9');
		expect(lineRows(p).join(' ')).not.toContain('Cara');
	});

	it('shows a note for a date warning that the line met (a year 0 of an era)', () => {
		const o = openWin(body().replace('from: Qinglong Emperor 3', 'from: Qinglong Emperor 0'), { dates });
		const p = page(o, 'crown');
		const found = notes(p, 'date-warning');
		expect(found.join(' ')).toContain('A cycle or an era has no Year 0');
	});

	it('the label of the ruler reads the start year of a holder through the calendar', () => {
		const two = [
			'titles:',
			'  - id: crown',
			'    name: Crown',
			'    succession: eldest-child',
			'    year: Qinglong Emperor 5',
			'    holders:',
			'      - {person: aldric, from: Qinglong Emperor 3, as: Aldric I}',
			'      - {person: aldric, from: Qinglong Emperor 8, as: Aldric II}',
			'people:',
			'  - {id: aldric, name: Aldric Valmont, sex: m}',
			'  - {id: bran, name: Bran Valmont, sex: m, parents: [aldric]}',
			'',
		].join('\n');
		const o = openWin(two, { dates });
		const p = page(o, 'crown');
		// In year 5 of the era the second reign (year 8) has not begun: the label is the first one. With the plain reader the start texts have no year and the later label wins.
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe('After Aldric I in Qinglong Emperor 5');
		const plain = page(openWin(two, { dates: () => compileCalendars([], true) }), 'crown');
		expect(plain.querySelector('.dynasty-succ-heading')!.getText()).not.toBe('After Aldric I in Qinglong Emperor 5');
	});
});

void FEl;
