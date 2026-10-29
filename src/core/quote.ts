/*
 * The one helper for quote marks in the plugin's own texts (D99). Texts use curly quote marks and
 * the curly apostrophe. The text in the user's notes is never changed, and the YAML example that
 * the user types stays straight, so those do not use this file.
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
