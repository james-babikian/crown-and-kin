// The one fix round of WP-6 steps 2 and 3, the real windows on a fake vault: the head reign of the person window, the refusals on their own text lines, the labels that follow a
// typed name, the note about a marker that follows the draft, the test line with the plain-year lists of another note, and the reason of a refused write.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { compileCalendars } from '../../src/core/dates';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { CALENDAR_WINDOW_UI as T } from '../../src/render/calendar-text';
import { writeCalendars } from '../../src/view/calendar-write';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { cycles, list } from '../dates-support/names';
import { control, openWindow, saveWindow, typeInto } from '../support/calendar-window-app';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const NOTE = `\`\`\`kin-calendar
calendars:
  - name: Long Count
    kind: cycles
    length: 60
    start: 1
    formats: ["{cycle}.{year} {planet}", "{year}y{cycle}c"]
    lists:
      - name: Planets
        marker: planet
        names: [Saturn, Jupiter]
        known: {year: 1, index: 0}
        show: short
\`\`\`
`;

describe('item 2: the head of the person window shows the names of the years in the reign', () => {
	it('"(r. 22.13 Sa\u2009–\u200922.14 Ju)" in the head, the text of the title as written in the tree text', () => {
		const body = [
			'titles:', '  - id: crown', '    name: Crown', '    holders:', '      - {person: aldric, number: II, from: "22.13", to: "22.14"}',
			'people:', '  - {id: aldric, name: Aldric, sex: m, born: "22.10", died: "22.14"}', '',
		].join('\n');
		const h = fakeHandle('Tree.md', body) as FakeHandle & { ops: Op[] };
		h.write.mockImplementation((async (op: Op) => {
			const r = applyOp(h.body, op);
			return r.ok ? { ok: true, body: r.body, created: r.created, effects: [] } : { ok: false, code: 'refused', refusal: r };
		}) as never);
		const reader = compileCalendars([cycles('C', ['{cycle}.{year} {planet}', '{cycle}.{year}'], [list()])], true);
		const sheet = EditSheet.create({} as never, { handle: h as never, personId: 'aldric', sourcePath: 'Tree.md', dates: () => reader })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		const meta = content.querySelector('.dynasty-head-meta')!.getText().replace(/\u2060/g, '').replace(/\u00a0/g, ' ').replace(/\u202f/g, '\u2009');
		expect(meta).toContain('(r. 22.13 Sa\u2009–\u200922.14 Ju)');
		expect(meta).toContain('22.10 Ve\u2009–\u200922.14 Ju');
		expect(h.body).toContain('from: "22.13"');
	});
});

describe('item 7: the Calendars window', () => {
	it('shows one line at the top that counts the errors, and each error once under its field (D278)', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const key = c.querySelector('.dynasty-cal-list')!.getAttribute('data-list')!;
		typeInto(c, `list-${key}-name`, '');
		typeInto(c, `list-${key}-names`, '');
		await saveWindow(c);
		expect(o.notes.get('Calendars.md')).toBe(NOTE);
		const box = c.querySelector('.dynasty-sheet-error[role="alert"]')!;
		const errors = c.querySelectorAll('.dynasty-cal-sections [data-refusal]').length;
		expect(errors).toBeGreaterThanOrEqual(2);
		expect(box.children).toHaveLength(1);
		expect(box.querySelector('[data-error-summary]')!.getText()).toBe(`Correct the ${errors} errors in the open sections.`);
		expect(box.querySelectorAll('[data-error-line]')).toHaveLength(0);
	});
	it('shows "Correct the error in the open section." for one error', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const cal = c.querySelector('[data-calendar]')!.getAttribute('data-calendar')!;
		typeInto(c, `${cal}-name`, '');
		await saveWindow(c);
		const box = c.querySelector('.dynasty-sheet-error[role="alert"]')!;
		expect(box.querySelector('[data-error-summary]')!.getText()).toBe('Correct the error in the open section.');
		expect(c.querySelectorAll('.dynasty-cal-sections [data-refusal]')).toHaveLength(1);
	});
	it('the labels of the section, of "Remove this calendar" and of the list "Remove" follow a typed name', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const cal = c.querySelector('[data-calendar]')!.getAttribute('data-calendar')!;
		const body = () => c.querySelector(`[data-calendar="${cal}"]`)!;
		typeInto(c, `${cal}-name`, 'The Far Count');
		expect(body().getAttribute('aria-label')).toBe('The Far Count');
		expect(c.querySelector('.dynasty-cal-remove-cal')!.getAttribute('aria-label')).toBe(T.removeCalendar('The Far Count'));
		expect(T.removeCalendar('The Far Count')).toBe('Remove this calendar: The Far Count');
		const key = c.querySelector('.dynasty-cal-list')!.getAttribute('data-list')!;
		typeInto(c, `list-${key}-name`, 'Moons');
		expect(c.querySelector('.dynasty-cal-remove-list')!.getAttribute('aria-label')).toBe('Remove this list: Moons');
		typeInto(c, `${cal}-name`, '');
		expect(body().getAttribute('aria-label')).toBe(T.kindCycles);
		expect(c.querySelector('.dynasty-cal-remove-cal')!.getAttribute('aria-label')).toBe('Remove this calendar: without a name');
	});
	it('the note about a marker that no list has follows every change of a format', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const cal = c.querySelector('[data-calendar]')!.getAttribute('data-calendar')!;
		const issues = () => c.querySelectorAll('[data-issue]').map((i) => i.getText());
		expect(issues()).toEqual([]);
		typeInto(c, `${cal}-formats`, '{cycle}.{year} {star}');
		expect(issues()).toHaveLength(1);
		expect(issues()[0]).toContain('{star}');
		expect(issues()[0]).toContain('The plugin reads such dates without the name, and it does not check a name.');
		typeInto(c, `${cal}-formats`, '{cycle}.{year}');
		expect(issues()).toEqual([]);
	});
});

// D289 and D270 item 3: a tree uses one note, so the window reads the plain-year lists of the note it shows and never those of another note (the old test took the name from a list of B.md).
describe('item 9: "Test a date" reads with the plain-year lists of the note of the window only', () => {
	it('a plain year gets no name from a list in another note', async () => {
		const other = `\`\`\`kin-calendar
plain:
  lists:
    - name: Animals
      names: [Rat, Ox, Tiger]
      known: {year: 1273, index: 1}
      show: short
\`\`\`
`;
		const o = await openWindow({ 'A.md': NOTE, 'B.md': other });
		const c = o.win.contentEl;
		const input = control(c, 'test:all');
		input.value = '1274';
		dispatch(input, 'input');
		expect(c.querySelector('[data-readout]')?.getText() ?? '').not.toContain('Tiger');
	});
});

describe('item 7: the reason of a refused write', () => {
	it('writeCalendars keeps the sentence of the core, and no other reason', () => {
		const body = findBlocks(NOTE, 'kin-calendar')[0].body;
		const out = writeCalendars(NOTE, [body], [{ block: 0, ops: [{ kind: 'edit-list', calendar: 0, list: 9, fields: { show: 'full' } }] }]);
		expect(out).toEqual({ ok: false, code: 'rejected', reason: 'The calendar has no name list at this place. Edit the note text.' });
		expect(T.cannotSaveBecause('The calendar has no name list at this place. Edit the note text.')).toBe(
			'The plugin cannot save the calendars. The calendar has no name list at this place. Edit the note text. Your changes stay in this window.',
		);
	});
});
