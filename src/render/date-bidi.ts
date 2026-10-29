/*
 * The text direction of dates. A date that holds a right-to-left letter ("حوالي 1108", an Arabic or Hebrew month, a name of a year) or an Arabic-Indic digit ("١١٣٣",
 * which the bidi algorithm counts as an Arabic number, class AN) turns a range round in a left-to-right line: "1108 حوالي – 1170" would read "1170 – 1108 حوالي", and
 * "١١٣٣–١١٧٠" would read "١١٧٠–١١٣٣". Each such date therefore goes in a first-strong isolate of its own, so the parts of a date line, a range or a reign keep the
 * order in which they are written. The isolate has no width and sets no `direction` (that would flip `text-anchor`), so the cards and the saved picture draw the same
 * text and measure it the same way. A date of Latin or other digits only, and one of the extended Arabic-Indic digits ("۱۱۳۳", European numbers to the algorithm),
 * comes back unchanged. When a cut or a line break falls inside an isolate, the isolate closes on the cut line and opens again on the next one. Pure; shared by the
 * person window, the pickers and the other windows. The card and the saved picture (SVG text, where WebKit ignores an isolate) turn the isolates into
 * left-to-right marks (`marksForSvg`).
 */
import { BIDI_FSI, BIDI_LRM, BIDI_PDI } from './bidi-controls';
import { needsBidiIsolate } from './name-lines';

/** An extended Arabic-Indic digit (U+06F0 to U+06F9): a European number to the bidi algorithm. */
const isExtendedDigit = (ch: string) => ch >= String.fromCharCode(0x6f0) && ch <= String.fromCharCode(0x6f9);

/**
 * True when `text` has a character that is strong right to left or an Arabic-Indic digit (class AN), that is, when a date in it needs an isolate. A combining mark goes
 * with its letter and the extended Arabic-Indic digits are European numbers (EN), which keep their place in a left-to-right line. Every other character of the
 * right-to-left blocks counts, so a rare weak sign there only gives an isolate that is not needed (it draws the same).
 */
export function hasRtlDate(text: string): boolean {
	if (!needsBidiIsolate(text)) return false;
	for (const ch of text) if (needsBidiIsolate(ch) && !/\p{M}/u.test(ch) && !isExtendedDigit(ch)) return true;
	return false;
}

/** One date in a first-strong isolate when it needs one (`hasRtlDate`); any other date unchanged. */
export function isolateDate(text: string): string {
	return hasRtlDate(text) ? BIDI_FSI + text + BIDI_PDI : text;
}

/**
 * `text` with each of `dates` (in the order they stand in `text`) isolated. A date that is not found keeps the search where it was, so a text that does not hold
 * a date is not changed. Used for a reign, where the dates stand between "(r. ", the dash, ", " and the words "from" and "until".
 */
export function isolateDatesIn(text: string, dates: readonly string[]): string {
	if (!hasRtlDate(text)) return text;
	let out = '';
	let at = 0;
	for (const d of dates) {
		if (!d || !hasRtlDate(d)) continue;
		const i = text.indexOf(d, at);
		if (i < 0) continue;
		out += text.slice(at, i) + BIDI_FSI + d + BIDI_PDI;
		at = i + d.length;
	}
	return out + text.slice(at);
}

/** Both ends of an isolate: the places that get a left-to-right mark in an SVG text. */
const ISOLATE_ENDS = new RegExp(`[${BIDI_FSI}${BIDI_PDI}]+`, 'g');

/**
 * `text` (a date line or a reign, as `dateLineShown` and `reignShown` give it) for an SVG `<text>`: each isolate end becomes a left-to-right mark. WebKit ignores the
 * isolates in an SVG text (seen on an iPhone: "1170–1108 حوالي"), but every engine knows the mark. A mark is a strong left-to-right letter with no width, so each date
 * part (the word and the years of a date, the dash of a range, "b. ", "d. ", "(r. ", ", ") is a run of its own between two such letters and keeps the order in
 * which it is written. `wholeLine` puts a mark at the start and at the end of the text, as a date line has it. A text with no isolate comes back as it is, so a
 * Latin date draws byte for byte as before. The mark has no pairing, so a cut or a break never leaves one unpaired.
 */
export function marksForSvg(text: string, wholeLine?: boolean): string;
export function marksForSvg(text: string | undefined, wholeLine?: boolean): string | undefined;
export function marksForSvg(text: string | undefined, wholeLine = false): string | undefined {
	if (text === undefined || !text.includes(BIDI_FSI)) return text;
	let out = text.replace(ISOLATE_ENDS, BIDI_LRM);
	if (wholeLine) out = (out.startsWith(BIDI_LRM) ? '' : BIDI_LRM) + out + (out.endsWith(BIDI_LRM) ? '' : BIDI_LRM);
	return out;
}
