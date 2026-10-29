/*
 * The grey line under a date field of the person window (spec §14 rule 6): it says how the plugin reads the text of the field. The line has the hint style of the
 * window (`dynasty-sheet-hint`), is empty for an empty field and for a plain year, and changes when the field loses the focus. It reads the text that is in the
 * field now (a draft), through the reader that the caller gives. The line stays empty while the reader is not ready (the calendar notes are still being read), and
 * it is painted again when the reader changes. A read that fails shows no line, so the window never breaks (spec §8).
 */

import type { DateReader } from '../../core/dates';
import { dateReadoutParts, type ReadoutParts } from '../date-readout';
import { markedLine } from './marks';
import { afterPress } from './press-hold';

/**
 * Writes the two parts of a date line into `line`: the reading as grey text, and the warning about a wrong written name (when there is one) on a text line of its own, with
 * a warning mark and the text colour (D278). The line is empty, and takes no room, when there is nothing to say.
 */
export function paintDateLine(line: HTMLElement, parts: ReadoutParts): void {
	line.empty();
	if (parts.reading !== '') line.createDiv({ cls: 'dynasty-date-reading', text: parts.reading });
	if (parts.warning !== '') markedLine(line, 'warning', parts.warning, 'dynasty-date-warning').setAttribute('data-warning', '');
}

/**
 * Puts the grey line in `row`, below `input`, and keeps it up to date; returns the function that paints it again. `reader` gives the reader of the tree as it is
 * now. `watch` tells this line when the reader of the tree changes (it returns the function that stops the watch); `release` gets that function, so the window
 * stops the watch when it closes.
 */
export function attachDateLine(
	row: HTMLElement,
	input: HTMLInputElement | HTMLTextAreaElement,
	reader: () => DateReader,
	watch?: (repaint: () => void) => () => void,
	release?: (stop: () => void) => void,
): () => void {
	const id = `${input.id || 'date'}-readout`;
	const line = row.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-date-line'], attr: { id, 'data-readout': '' } });
	// The field keeps any hint that describes it already; the grey line is one more description.
	input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
	const paint = (): void => {
		try {
			const r = reader();
			paintDateLine(line, dateReadoutParts(input.value, r.read(input.value), r.ready));
		} catch (e) {
			console.error('Crown and Kin: cannot read the date', e);
			line.empty();
		}
	};
	// A press on a button below the field is under way when the blur comes: the line changes after the click, so the button does not move.
	input.addEventListener('blur', () => afterPress(input, input, paint));
	paint();
	if (watch && release) {
		// The sheet draws its fields again now and then: a line that left the page stops its own watch.
		const stop = watch(() => (input.isConnected === false ? stop() : paint()));
		release(stop);
	}
	return paint;
}
