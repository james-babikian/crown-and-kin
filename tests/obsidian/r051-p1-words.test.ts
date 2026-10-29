import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { pickPerson } from '../../src/obsidian/person-picker';
import { CALENDAR_WINDOW_UI as T } from '../../src/render/calendar-text';
import { TITLES_UI } from '../../src/render/ui-text';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { openWindow } from '../support/calendar-window-app';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D319 item 3: the clearer words. The first row of the holder picker shows the typed name (spec §13.4); "Remove this calendar" has a quiet line that says what changes (spec §14 rule 16).
 * D319 item 1 in the real Calendars window: a help text that shows at the press stays until the click.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

describe('the first row of the holder picker', () => {
	it('the text names the typed holder, in curly marks; an empty query keeps the old row', () => {
		expect(TITLES_UI.notInTreeRow('')).toBe('A holder who is not in the tree');
		expect(TITLES_UI.notInTreeRow('  ')).toBe('A holder who is not in the tree');
		expect(TITLES_UI.notInTreeRow(' Isolde ')).toBe('A holder who is not in the tree: “Isolde”');
	});

	it('the picker draws that text in its first row', () => {
		const r = parseDynasty('people:\n  - {id: a, name: Aldric}\n');
		if (!r.ok) throw new Error('does not parse');
		void pickPerson({} as never, deriveFamilies(r.tree), new Set(), 'Type', 'Find', true, null, TITLES_UI.notInTreeRow);
		const picker = openModals[openModals.length - 1] as unknown as { renderSuggestion(item: unknown, el: FEl): void };
		const el = new FEl('div');
		picker.renderSuggestion({ kind: 'new', text: 'Isolde' }, el);
		expect(el.querySelector('.dynasty-picker-name')!.getText()).toBe('A holder who is not in the tree: “Isolde”');
	});
});

const NOTE = '```kin-calendar\ncalendars:\n  - name: Long Count\n    kind: cycles\n    length: 60\n    start: 1\n    formats: ["{year}y{cycle}c"]\n```\n';

describe('the Calendars window', () => {
	it('"Remove this calendar" has a quiet line that says what changes, and the button points to it', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const button = c.querySelector('.dynasty-cal-remove-cal')!;
		const note = c.querySelector('.dynasty-cal-remove-note')!;
		expect(note.getText()).toBe(T.removeNote);
		expect(note.hasClass('dynasty-sheet-hint')).toBe(true);
		expect(button.getAttribute('aria-describedby')).toBe(note.getAttribute('id'));
	});

	it('a help text that shows at the press on Remove stays until the click (the first tap hits)', async () => {
		const o = await openWindow({ 'Calendars.md': NOTE });
		const c = o.win.contentEl;
		const hint = c.querySelector('.dynasty-sheet-hint.is-on-focus')!;
		Object.assign(hint, { offsetParent: c });
		const remove = c.querySelector('.dynasty-cal-remove-cal')!;
		dispatch(remove, 'pointerdown');
		expect(hint.hasClass('is-held')).toBe(true);
		dispatch(remove, 'click');
		expect(hint.hasClass('is-held')).toBe(false);
	});
});
