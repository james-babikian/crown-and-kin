/*
 * The Unicode bidi control characters (UAX #9) that the cards and the windows write, and the two helpers that keep an isolate paired when a text is cut or broken.
 * It stands apart from `name-lines.ts` and `date-bidi.ts` so that both can use it without a loop between them. Pure.
 */

import { truncate } from './view-math';

/** Left-to-right isolate: opens a run that is laid out left to right. */
export const BIDI_LRI = String.fromCharCode(0x2066);
/** Right-to-left isolate: opens a run that is laid out right to left. */
export const BIDI_RLI = String.fromCharCode(0x2067);
/** First-strong isolate: opens a run whose direction its first strong letter sets. */
export const BIDI_FSI = String.fromCharCode(0x2068);
/** Pop directional isolate: closes the last isolate. */
export const BIDI_PDI = String.fromCharCode(0x2069);
/** Left-to-right mark. */
export const BIDI_LRM = String.fromCharCode(0x200e);
/** Right-to-left mark. */
export const BIDI_RLM = String.fromCharCode(0x200f);

/** Matches the four isolate controls and the two direction marks (nothing else): they draw nothing and have no width. */
export const BIDI_CONTROLS = new RegExp(`[${BIDI_LRI}-${BIDI_PDI}${BIDI_LRM}${BIDI_RLM}]`, 'g');

/** `text` without the bidi controls: the words a screen reader says for a text that is drawn with isolates. */
export const withoutBidiControls = (text: string): string => text.replace(BIDI_CONTROLS, '');

/** Every isolate opener: each one that no end follows must be closed when a text is cut. */
const isOpener = (ch: string) => ch === BIDI_FSI || ch === BIDI_LRI || ch === BIDI_RLI;

/** The number of isolates that stay open at the end of `text`. */
function openAtEnd(text: string): number {
	let open = 0;
	for (const ch of text) {
		if (isOpener(ch)) open++;
		else if (ch === BIDI_PDI && open > 0) open--;
	}
	return open;
}

/**
 * `text` with every isolate that is still open at its end closed, so a cut or a broken text line never leaves an opener with no end. The end stands before a final
 * "…" (the mark of the cut belongs to the line, not to the date). An opener that stands last, with nothing in it, is dropped. A text with no opener comes back as it is.
 */
export function closeIsolates(text: string): string {
	let open = openAtEnd(text);
	if (open === 0) return text;
	const ell = text.endsWith('…') ? '…' : '';
	let body = ell ? text.slice(0, -1) : text;
	while (open > 0 && isOpener(body.slice(-1))) {
		body = body.slice(0, -1);
		open--;
	}
	return body + BIDI_PDI.repeat(open) + ell;
}

/**
 * The text lines of a text that was broken inside an isolate: a line that leaves an isolate open closes it, and the next line opens it again. Each line is then a
 * balanced text, so a line reads the date in the same order as the whole text did.
 */
export function carryIsolates(lines: readonly string[]): string[] {
	let carry = 0;
	return lines.map((line) => {
		const own = BIDI_FSI.repeat(carry) + line;
		carry = openAtEnd(own);
		return closeIsolates(own);
	});
}

/**
 * `truncate` for a text that may hold isolates: the cut text is measured with its isolates closed, and it is returned closed, so the text that fits is the text that is
 * drawn. A text with no isolate is cut exactly as `truncate` cuts it.
 */
export function truncateClosed(text: string, maxW: number, measure: (s: string) => number): string {
	if (!text.includes(BIDI_FSI)) return truncate(text, maxW, measure);
	return closeIsolates(truncate(text, maxW, (s) => measure(closeIsolates(s))));
}
