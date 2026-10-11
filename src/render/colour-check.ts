/*
 * One test for "can CSS draw this colour" (a house colour can be any CSS colour, spec §4.1). The tree cards, the phone list and the sheet
 * windows all use it, so a house colour is accepted or refused the same way everywhere.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** True when CSS can draw `value` as a colour; where `CSS.supports` is missing or throws, only `#rrggbb` counts. */
export function isColour(value: string | null | undefined): value is string {
	if (!value) return false;
	try {
		return CSS.supports('color', value);
	} catch {
		return HEX.test(value);
	}
}
