/*
 * Small DOM parts that the Calendars window and the `kin-calendar` block share (spec §14 rule 6): the test line, a field where the user writes a date and sees
 * how the plugin reads it with the calendars as they are now. Built with `createEl` and `setText` only; the colours come from the style sheet.
 */

import type { DateReader } from '../core/dates';
import { CALENDAR_WINDOW_UI as T } from '../render/calendar-text';
import { testLine } from '../view/calendar-draft';
import { sheetField } from './sheet-parts';

/** What `testField` gives back: the function that reads the field again (the calendars changed) and the input. */
export interface TestField {
	input: HTMLInputElement;
	/** Writes the line again from the field, with the reader that `reader()` gives now. */
	update(): void;
}

/**
 * The field "Test a date" and the grey line under it. The line follows the text while the user types (the window is a place to try a format, so it does not
 * wait for the focus to leave); `reader` is asked at each change, because the draft of the window changes the calendars.
 */
export function testField(parent: HTMLElement, name: string, reader: () => DateReader): TestField {
	const { row, id } = sheetField(parent, T.testLabel, `test-${name}`, 'dynasty-cal');
	row.addClass('dynasty-cal-test');
	const input = row.createEl('input', {
		cls: ['dynasty-sheet-input', 'dynasty-input'],
		attr: { id, type: 'text', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: T.testPlaceholder, 'data-focus': `test:${name}` },
	});
	const line = row.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-date-line'], attr: { id: `${id}-readout`, 'aria-live': 'polite', 'data-readout': '' } });
	input.setAttribute('aria-describedby', `${id}-readout`);
	const update = (): void => {
		try {
			line.setText(testLine(reader(), input.value));
		} catch (e) {
			console.error('Crown and Kin: cannot read the test date', e);
			line.setText('');
		}
	};
	input.addEventListener('input', update);
	return { input, update };
}
