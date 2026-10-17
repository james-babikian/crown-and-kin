/*
 * The one bridge from the old block word to the new one (0.3.1, WP-R, D167). Until 0.3.0 a tree was a `dynasty` code block;
 * from 0.3.1 it is a `kin` block and the plugin does not read the old word. The frozen notes of old versions
 * (`tests/old-trees/**`) and the whole-note goldens recorded before the rename (`tests/golden/*.md`) are never edited, so
 * the tests that read them change the word in memory here: the fence word, and the word in inline code that names it.
 * Everything else in the text stays byte for byte, so the old format is still proven.
 */

/** A fence line that opens a `dynasty` block, in a callout (`>`), a list item or both; group 1 is all before the word. */
const OLD_FENCE = /^([ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*(?:`{3,}|~{3,})[ \t]*)dynasty(?=[ \t\r]|$)/gm;

/** The note `text` with every old block word `dynasty` changed to `kin`. */
export function oldTag(text: string): string {
	return text.replace(OLD_FENCE, '$1kin').replace(/`dynasty`/g, '`kin`');
}
