import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { findBlocks } from '../src/core/block-locate';
import { calendarBlockProcessor } from '../src/obsidian/calendar-block-view';
import { createCalendarIndex } from '../src/view/calendar-index';
import { FEl, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp } from './support/calendar-window-app';
import { fakeVault } from './support/calendar-vault';

/*
 * Spec §14 rule 13 (WP-6 step 3): the `kin-calendar` block in a note shows its name lists as rows of the table, the plain years as a box of their own, and a note with only the key
 * `plain` as a calendar note. The test line of the block reads with the plain-year lists.
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

const render = (source: string): FEl => {
	const { app, notes } = fakeApp({ 'Calendars.md': source });
	const el = new FEl('div');
	const added: { onload?: () => void }[] = [];
	const index = createCalendarIndex(fakeVault(Object.fromEntries(notes)), { pause: async () => undefined });
	calendarBlockProcessor(app as never, index)(findBlocks(source, 'kin-calendar')[0].body, el as never, { sourcePath: 'Calendars.md', addChild: (c: { onload?: () => void }) => added.push(c) } as never);
	added[0].onload?.();
	return el;
};

const BLOCK = `\`\`\`kin-calendar
calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1
    formats: ["{cycle}.{year} {planet}"]
    lists:
      - name: Planets
        marker: planet
        names: [{name: Saturn, short: Sa}, {name: Jupiter, short: Ju}, {name: Mars}, {name: Sun}]
        known: {year: 1273, index: 0}
        show: short
plain:
  lists:
    - name: Animals
      names: [Rat, Ox]
      known: {year: 1273, index: 1}
\`\`\`
`;

describe('the block with name lists', () => {
	it('shows a list as a row with its name and marker, its first names and its known year; the plain years have a box', () => {
		const el = render(BLOCK);
		const rows = el.querySelectorAll('.dynasty-cal-table tr');
		const list = rows.find((r) => r.querySelector('th')?.getText() === 'Name list')!;
		const lines = list.querySelector('td')!.querySelectorAll('div').map((d) => d.getText());
		expect(lines).toEqual(['Planets, marker {planet}', 'Saturn (Sa), Jupiter (Ju), Mars and 1 more', 'Known year: year 1273 = Saturn']);
		const plain = el.querySelectorAll('.dynasty-cal-block').find((b) => b.getAttribute('aria-label') === 'Plain years')!;
		expect(plain.querySelector('td')!.querySelectorAll('div').map((d) => d.getText())).toEqual(['Animals', 'Rat, Ox', 'Known year: year 1273 = Ox']);
	});

	it('the test line of the block names the year with the plain-year lists, and a note with only plain is not empty', () => {
		const el = render(BLOCK);
		const input = el.querySelector('.dynasty-cal-test input')!;
		input.value = '1274';
		dispatch(input, 'input');
		expect(el.querySelector('[data-readout]')?.getText()).toBe('Animals: Rat.');
		const only = render('```kin-calendar\nplain:\n  lists:\n    - name: Animals\n      names: [Rat, Ox]\n      known: {year: 1273, index: 1}\n```\n');
		expect(only.getText()).not.toContain('has no calendar yet');
		expect(only.querySelector('.dynasty-cal-edit')).not.toBeNull();
	});

	it('a list that cannot be used shows its issue and no row', () => {
		const el = render(BLOCK.replace('known: {year: 1273, index: 0}', 'known: {year: 1273, index: 9}'));
		expect(el.querySelector('.dynasty-cal-block-error')?.getText()).toContain('cannot be used');
		// Only the list of the plain years has a row.
		expect(el.querySelectorAll('.dynasty-cal-table th').filter((t) => t.getText() === 'Name list')).toHaveLength(1);
		expect(el.getText()).not.toContain('Planets ·');
	});
});
