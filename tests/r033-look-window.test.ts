// The look repairs of the Calendars window (spec §0 D278), on the real window with a fake vault: one red line after a Save with errors, the short warning at Start, the window that
// opens with nothing selected, the half-width Length, the height of the names box, the label of the test field, the wrong name on a text line of its own, and the new place of
// "New calendar note". The sizes and the places on the screen are checked in the harness, not here.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { readFileSync } from 'node:fs';
import { CALENDAR_WINDOW_UI as T } from '../src/render/calendar-text';
import { dateReadoutParts } from '../src/render/date-readout';
import { compileCalendars } from '../src/core/dates';
import { FEl, dispatch, fakeDoc, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { cycles, list } from './dates-support/names';
import { control, isOpen, openWindow, saveWindow, typeInto } from './support/calendar-window-app';
import { cycleNote, eraNote } from './support/calendar-vault';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const names = (n: number): string => Array.from({ length: n }, (_, i) => `        - {name: N${i}, short: n${i}}`).join('\n');
/** The Long Count with one name list of `n` names. */
const note = (n: number, format = '"{cycle}.{year} {planet}", "{year} of {cycle}"'): string =>
	`\`\`\`kin-calendar\ncalendars:\n  - name: The Long Count\n    kind: cycles\n    length: 60\n    start: 1\n    formats: [${format}]\n    lists:\n      - name: Planets\n        marker: planet\n        names:\n${names(n)}\n        known: {year: 1273, index: 0}\n        show: short\n\`\`\`\n`;

const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const errorBox = (c: FEl) => c.querySelector('.dynasty-sheet-error[role="alert"]')!;

describe('F1: one red line at the top after a Save with errors', () => {
	it('counts the errors, shows each once under its field, and hides the grey note that is also an error', async () => {
		// A marker that no list has: a grey note first, and an error after Save (the same problem).
		const text = `\`\`\`kin-calendar\ncalendars:\n  - name: Count\n    kind: cycles\n    length: 60\n    start: 1\n    formats: ["{cycle}.{year} {planet}", "{year} of {cycle}"]\n\`\`\`\n`;
		const o = await openWindow({ 'Calendars.md': `${text}\n${eraNote()}` });
		const c = o.win.contentEl;
		expect(c.querySelectorAll('.dynasty-cal-issues [data-issue]')).toHaveLength(1);
		await saveWindow(c);
		expect(errorBox(c).getText()).toBe('Correct the error in the open section.');
		expect(c.querySelectorAll('[data-refusal]')).toHaveLength(1);
		expect(c.querySelectorAll('.dynasty-cal-issues [data-issue]')).toHaveLength(0);
		// The line has a mark, no head of a list and no second line.
		expect(errorBox(c).querySelector('svg.dynasty-mark.is-alert')).not.toBeNull();
		expect(errorBox(c).querySelectorAll('[data-error-line]')).toHaveLength(0);
	});

	it('says how many errors with the plural text', () => {
		expect(T.refusalSummary(1)).toBe('Correct the error in the open section.');
		expect(T.refusalSummary(2)).toBe('Correct the 2 errors in the open sections.');
		expect(T.refusalSummary(5)).toBe('Correct the 5 errors in the open sections.');
	});

	it('opens every section that holds an error, and the errors stand in them', async () => {
		const o = await openWindow({ 'Calendars.md': `${cycleNote('Count')}\n${cycleNote('Other', '{year} of {cycle}')}` });
		const c = o.win.contentEl;
		const keys = c.querySelectorAll('.dynasty-section').map((s) => s.getAttribute('data-section') ?? '');
		for (const key of keys) expect(isOpen(c, key)).toBe(false);
		typeInto(c, `${keys[0]}-length`, '0');
		typeInto(c, `${keys[1]}-length`, '0');
		await saveWindow(c);
		expect(errorBox(c).getText()).toBe('Correct the 2 errors in the open sections.');
		for (const key of keys.slice(0, 2)) {
			expect(isOpen(c, key)).toBe(true);
			expect(c.querySelectorAll(`[data-section="${key}"] [data-refusal]`)).toHaveLength(1);
		}
	});
});

describe('F2: the short warning at Start', () => {
	it('takes the place of the help of Start, and the box of messages of the calendar has no long warning', async () => {
		const o = await openWindow({ 'Calendars.md': `${cycleNote('Count', '{year} of {cycle}')}\n${eraNote()}` });
		const c = o.win.contentEl;
		const first = c.querySelectorAll('.dynasty-section')[0].getAttribute('data-section')!;
		dispatch(c.querySelector(`[data-section="${first}"] .dynasty-section-head`)!, 'click');
		const back = c.querySelector(`[data-section="${first}"] [data-readback]`)!;
		expect(back.getText()).toBe(T.startNoAnchor);
		expect(back.hasClass('is-warning')).toBe(true);
		expect(back.querySelector('svg.dynasty-mark.is-warning')).not.toBeNull();
		expect(c.querySelector(`[data-section="${first}"] .dynasty-cal-messages [data-warning]`)).toBeNull();
		expect(c.querySelector(`[data-section="${first}"]`)!.getText()).not.toContain('has no “Same year as” date that links it');
	});

	it('keeps the usual help when the calendar has a start date, or when it stands alone', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote('Count', '{year} of {cycle}') });
		const c = o.win.contentEl;
		const back = c.querySelector('[data-readback]')!;
		expect(back.hasClass('is-warning')).toBe(false);
		expect(back.getText()).not.toBe(T.startNoAnchor);
		expect(back.querySelector('svg')).toBeNull();
	});

	it('is a text of 25 words or fewer in each sentence', () => {
		for (const s of T.startNoAnchor.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25);
	});
});

describe('F4: the window opens with nothing selected', () => {
	it('puts the focus on the window itself and not on "New calendar note"', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		expect(fakeDoc.activeElement).toBe(o.win.modalEl);
		expect(fakeDoc.activeElement).not.toBe(control(o.win.contentEl, 'cal:new-note'));
		expect(o.win.modalEl.getAttribute('tabindex')).toBe('-1');
	});
});

describe('S1: Length takes half the width', () => {
	it('marks the row of Length of a cycle calendar and of an era as half width', async () => {
		const o = await openWindow({ 'Calendars.md': `${cycleNote('Count')}\n${eraNote()}` });
		const c = o.win.contentEl;
		const inputs = all(c).filter((e) => (e.getAttribute('data-focus') ?? '').endsWith('-length'));
		expect(inputs).toHaveLength(2);
		for (const el of inputs) expect(el.parentElement!.hasClass('is-half'), el.getAttribute('data-focus') ?? '').toBe(true);
		expect(c.querySelectorAll('.dynasty-sheet-field.is-half').length).toBeGreaterThanOrEqual(2);
	});
});

describe('S3: the names box is one text line higher than its names', () => {
	const rowsOf = async (n: number) => {
		const o = await openWindow({ 'Calendars.md': note(n) });
		const area = all(o.win.contentEl).find((e) => e.tag === 'textarea' && (e.getAttribute('data-focus') ?? '').endsWith('-names'))!;
		return Number(area.getAttribute('rows'));
	};
	it('is the number of names plus one, from 3 to 10 text lines', async () => {
		expect(await rowsOf(1)).toBe(3);
		expect(await rowsOf(2)).toBe(3);
		expect(await rowsOf(4)).toBe(5);
		expect(await rowsOf(7)).toBe(8);
		expect(await rowsOf(12)).toBe(10);
	});
});

describe('S2: Remove of a list is in the first row of the list', () => {
	it('stands in the grid of the first row, after the fields, and the style sheet puts it at the right end', async () => {
		const o = await openWindow({ 'Calendars.md': note(2) });
		const remove = o.win.contentEl.querySelector('.dynasty-cal-list .dynasty-cal-remove-list')!;
		expect(remove.parentElement!.hasClass('dynasty-grid')).toBe(true);
		const css = readFileSync('styles/37-calendars.css', 'utf8');
		expect(css).toMatch(/button\.dynasty-cal-remove-list\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0/);
	});
});

describe('S6: the label of the test field', () => {
	it('is "Test a date", and the second sentence is a help that shows while the cursor is in the field', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		const box = c.querySelector('.dynasty-cal-testbox')!;
		expect(box.querySelector('label')!.getText()).toBe('Test a date');
		const hint = box.querySelector('.dynasty-sheet-hint.is-on-focus')!;
		expect(hint.getText()).toBe('The plugin shows the date as a plain year, for example “year 1273”.');
		const input = control(c, 'test:all');
		expect(input.getAttribute('aria-describedby')).toContain(hint.getAttribute('id')!);
	});
});

describe('S4: the wrong name stands on a text line of its own', () => {
	it('shows the reading in grey and the warning in its own line with a mark in the test field', async () => {
		const o = await openWindow({ 'Calendars.md': note(2, '"{cycle}.{year} {planet}"') });
		const c = o.win.contentEl;
		const input = control(c, 'test:all');
		input.value = '22.13 n1';
		dispatch(input, 'input');
		const line = c.querySelector('.dynasty-cal-testbox [data-readout]')!;
		expect(line.querySelector('.dynasty-date-reading')!.getText()).toContain('Cycle 22, Year 13 = year 1273.');
		expect(line.querySelector('.dynasty-date-reading')!.getText()).not.toContain('The date says');
		const warning = line.querySelector('[data-warning]')!;
		expect(warning.getText()).toContain('The date says N1');
		expect(warning.hasClass('dynasty-date-warning')).toBe(true);
		expect(warning.querySelector('svg.dynasty-mark.is-warning')).not.toBeNull();
		// A right name has no warning line.
		input.value = '22.13 n0';
		dispatch(input, 'input');
		expect(line.querySelector('[data-warning]')).toBeNull();
	});

	it('the parts: a wrong name goes to the warning and the reading keeps the rest; the text as one line stays as it was', () => {
		const reader = compileCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list()])], true);
		const text = '22.14 Sa';
		const parts = dateReadoutParts(text, reader.read(text), reader.ready);
		expect(parts.warning).toContain('this year is Jupiter');
		expect(parts.reading).toMatch(/Year 14 = year 1274\.$/);
		expect(dateReadoutParts('22.13 Sa', reader.read('22.13 Sa'), reader.ready).warning).toBe('');
		expect(dateReadoutParts('', undefined).reading).toBe('');
	});
});

describe('N3: "New calendar note" ends the text line under the title', () => {
	it('is the last part of the text line, after the folder', async () => {
		const o = await openWindow({ 'Calendars.md': cycleNote() });
		const meta = o.win.contentEl.querySelector('.dynasty-head-meta')!;
		expect(meta.getText()).toBe(`Calendars · ${T.folder('')} · ${T.newNote}`);
		expect(o.win.contentEl.querySelector('.dynasty-cal-links')).toBeNull();
	});
});

describe('the style sheet', () => {
	const css = readFileSync('styles.css', 'utf8');
	it('has the sizes of the links, the phone rules and no colour value in the new rules (D278)', () => {
		expect(css).toMatch(/button\.dynasty-cal-remove,[^{]*button\.dynasty-cal-add-link,[^{]*button\.dynasty-cal-remove-cal\s*\{\s*font-size:\s*var\(--dynasty-type-control\)/);
		expect(css).toMatch(/\.dynasty-sheet\.is-phone \.dynasty-section:not\(\.is-open\) \.dynasty-section-sum[^{]*\{[^}]*-webkit-line-clamp:\s*2/);
		expect(css).toMatch(/\.dynasty-sheet\.is-phone \.dynasty-cal-add\.dynasty-actions\s*\{[^}]*flex-direction:\s*column/);
		expect(css).toMatch(/\.dynasty-sheet-field\.is-half > input\.dynasty-sheet-input\s*\{[^}]*max-width/);
		const rule = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
		for (const sel of ['.dynasty-date-warning {', '.dynasty-mark.is-warning {', '.dynasty-cal-readback.is-warning {']) expect(rule(sel)).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
	});
});
