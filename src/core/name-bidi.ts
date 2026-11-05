/*
 * The text direction of a name inside a sentence (spec §0 D322). A name that starts with a right-to-left letter and also holds Latin letters ("كريم Mansour") reads in
 * one order on the cards: the whole name is one run whose direction its first strong letter sets. In an HTML text the same run is a first-strong isolate (FSI, PDI)
 * around the name. The messages of the problem list are built here in the core, so the helper lives here too; `render/name-bidi.ts` re-exports it. A name with no
 * right-to-left letter comes back unchanged. Pure.
 */

/** A letter of a script that is written from right to left (Hebrew, Arabic, Syriac, Thaana and the others, with the presentation forms). */
export const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/** Whether a name needs its own bidi run: it holds a right-to-left letter. A name with none draws and reads as before. */
export const needsBidiIsolate = (text: string): boolean => RTL_LETTER.test(text);

/** First-strong isolate and its end: they have no width and draw nothing. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

/**
 * `name` in a first-strong isolate when it holds a right-to-left letter; any other name unchanged. Use it for the name argument of a text, never for the whole
 * sentence. A text that is one isolate already (or a list of isolated names) is not wrapped again. The DOM edge turns the pair into an element (`render/dom/name-marks.ts`).
 */
export function isolateName(name: string): string {
	if (!needsBidiIsolate(name) || (name.startsWith(FSI) && name.endsWith(PDI))) return name;
	return FSI + name + PDI;
}
