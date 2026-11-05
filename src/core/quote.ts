/*
 * The helpers for the plugin's own texts: quote marks (D99) and a capital first letter. Texts use
 * curly quote marks and the curly apostrophe. The text in the user's notes is never changed, and
 * the YAML example that the user types stays straight, so those do not use this file.
 */

/** The curly apostrophe, for contractions and possessives in plugin texts. */
export const CURLY_APOSTROPHE = '’';

/** The opening and closing curly double quote marks. */
export const CURLY_OPEN = '“';
/** The closing curly double quote mark. */
export const CURLY_CLOSE = '”';

/** Puts curly double quote marks around `s`: `“s”`. */
export function quote(s: string): string {
	return `${CURLY_OPEN}${s}${CURLY_CLOSE}`;
}

/** Makes the first letter of `s` a capital, for a sentence that starts with a name or a noun. */
export function upperFirst(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
