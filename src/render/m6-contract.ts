/**
 * Milestone 6 contract (frozen by the supervisor; change only through the supervisor).
 * WP6.2 implements `NameLines` (in `src/render/`) and tests `HOUSE_PALETTE` contrast; WP6.3 uses
 * the palette in the Houses window (D32).
 */

/**
 * Splits a name for a card (D29). One text line if `measure(name) <= width`. Otherwise two text
 * lines, broken at the last space that lets line 1 fit; line 2 ends with "…" if it is still too
 * wide. A name with no usable space: line 1 is the widest prefix that fits, line 2 the rest (with
 * "…" if needed). `width` is the free text width of the card after the D14 sign and, in
 * `sideways`, the `+` badge room (1.2 em). Pure.
 */
export type NameLines = (name: string, width: number, measure: (text: string) => number) => [string] | [string, string];

/** D32: the 12 house colours offered in the Houses window, in this order. Names are in `ui-text.ts`. */
export const HOUSE_PALETTE = [
	'#8c2041',
	'#c62828',
	'#d87620',
	'#af8d22',
	'#7c8b2a',
	'#2e7d32',
	'#00897b',
	'#3a8fd6',
	'#1e4f8b',
	'#6d209c',
	'#795548',
	'#78909c',
] as const;
