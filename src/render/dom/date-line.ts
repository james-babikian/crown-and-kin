/*
 * The grey line under a date field of the person window (spec §14 rule 6): it says how the plugin reads the text of the field. The line has the hint style of the
 * window (`dynasty-sheet-hint`), is empty for an empty field and for a plain year, and changes when the field loses the focus and a short time after the last key
 * (D330 UX-10: a user who stays in the field sees the line too; as the Year field of a title does, §13.21 rule 28). It reads the text that is in the
 * field now (a draft), through the reader that the caller gives. The line stays empty while the reader is not ready (the calendar notes are still being read), and
 * it is painted again when the reader changes. A read that fails shows no line, so the window never breaks (spec §8).
 */

import type { DateReader } from '../../core/dates';
import { dateReadoutParts, type ReadoutParts } from '../date-readout';
import { markedLine } from './marks';
import { afterPress } from './press-hold';

/** The pause after the last key before the line changes: long enough for a word to be typed, short enough that the user sees the reading while still in the field. */
const TYPING_PAUSE_MS = 300;

/**
 * Writes the parts of a date line into `line`: the reading as grey text, with the warning sentence of rule 5 (when there is one) after it on the same text line in the text colour
 * (D348 2 A), and the warning about a wrong written name (when there is one) on a text line of its own, with a warning mark and the text colour (D278). The line is empty, and
 * takes no room, when there is nothing to say. The text of the line is the same with or without the colour, so a screen reader says the same words.
 */
export function paintDateLine(line: HTMLElement, parts: ReadoutParts): void {
	line.empty();
	if (parts.reading !== '' || parts.tail !== '') {
		const reading = line.createDiv({ cls: 'dynasty-date-reading', text: parts.reading });
		if (parts.tail !== '') {
			if (parts.reading !== '') reading.appendText(' ');
			reading.createSpan({ cls: 'dynasty-date-tail', text: parts.tail });
		}
	}
	if (parts.warning !== '') markedLine(line, 'warning', parts.warning, 'dynasty-date-warning').setAttribute('data-warning', '');
}

/**
 * Puts the grey line in `row`, below `input`, and keeps it up to date; returns the function that paints it again. `reader` gives the reader of the tree as it is
 * now. `watch` tells this line when the reader of the tree changes (it returns the function that stops the watch); `release` gets that function, so the window
 * stops the watch when it closes. `skipped` says whether the line of succession skips a date with no year (the tree has one), for the sentence that says so (D330 UX-10).
 */
export function attachDateLine(
	row: HTMLElement,
	input: HTMLInputElement | HTMLTextAreaElement,
	reader: () => DateReader,
	watch?: (repaint: () => void) => () => void,
	release?: (stop: () => void) => void,
	skipped?: () => boolean,
): () => void {
	const id = `${input.id || 'date'}-readout`;
	const line = row.createDiv({ cls: ['dynasty-sheet-hint', 'dynasty-date-line'], attr: { id, 'data-readout': '' } });
	// The field keeps any hint that describes it already; the grey line is one more description.
	input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
	const paint = (): void => {
		try {
			const r = reader();
			paintDateLine(line, dateReadoutParts(input.value, r.read(input.value), r.ready, { succession: skipped?.() === true }));
		} catch (e) {
			console.error('Crown and Kin: cannot read the date', e);
			line.empty();
		}
	};
	// A press on a button below the field is under way when the blur comes: the line changes after the click, so the button does not move.
	input.addEventListener('blur', () => afterPress(input, input, paint));
	// A pause in typing paints the line too. A press on a button below the field holds the change as it does at the blur, so that no button moves under the pointer.
	let timer: number | null = null;
	const stopTimer = (): void => {
		if (timer !== null) input.win.clearTimeout(timer);
		timer = null;
	};
	input.addEventListener('input', () => {
		stopTimer();
		timer = input.win.setTimeout(() => {
			timer = null;
			if (input.isConnected) afterPress(input, input, paint);
		}, TYPING_PAUSE_MS);
	});
	paint();
	if (watch && release) {
		// The sheet draws its fields again now and then: a line that left the page stops its own watch.
		const stop = watch(() => (!input.isConnected ? stop() : paint()));
		release(() => {
			stopTimer();
			stop();
		});
	}
	return paint;
}
