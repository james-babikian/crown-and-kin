/**
 * Splits a long name onto two text lines instead of truncating it to one (D29, D37). The main
 * caller is `render/dom/tall-cards.ts`, which uses `nameLines` to find the tall cards.
 * `render/dom/scene.ts` and `render/svg-string.ts` then draw the two lines at the baselines
 * `layout/geometry.ts`'s `cardText(geo, true)` gives.
 */
import { truncate } from './view-math';

/**
 * Splits a name for a card (D29). One text line if `measure(name) <= width`. Otherwise two text
 * lines, broken at the last space that lets line 1 fit; line 2 ends with "…" if it is still too
 * wide. A name with no usable space: line 1 is the widest prefix that fits, line 2 the rest (with
 * "…" if needed). `width` is the free text width of the card after the D14 sign and, in
 * `sideways`, the `+` badge room (1.2 em). Pure.
 */
export type NameLines = (name: string, width: number, measure: (text: string) => number) => [string] | [string, string];

/**
 * D29: a name on one text line if it fits, else on two. Line 1 ends at the last space that lets it
 * fit; with no such space it is the widest start of the name that fits, and line 2 carries on
 * where it stopped. Line 2 ends with "…" when it is still too wide.
 */
export const nameLines: NameLines = (name, width, measure) => {
	// Trimmed first: outer spaces must not make a name that fits take two text lines.
	const text = name.trim();
	if (measure(text) <= width) return [text];
	const chars = Array.from(text);
	// Last space first: the longest first text line that fits.
	for (let i = chars.length - 1; i > 0; i--) {
		if (chars[i] !== ' ') continue;
		const first = chars.slice(0, i).join('').trimEnd();
		if (!first || measure(first) > width) continue;
		const rest = chars.slice(i + 1).join('').trimStart();
		if (!rest) break;
		return [first, truncate(rest, width, measure)];
	}
	// No usable space: fill line 1 character by character (at least one, so the name always moves on).
	let n = 1;
	while (n < chars.length && measure(chars.slice(0, n + 1).join('')) <= width) n++;
	const first = chars.slice(0, n).join('').trimEnd();
	const rest = chars.slice(n).join('').trimStart();
	if (!rest) return [truncate(text, width, measure)];
	return [first, truncate(rest, width, measure)];
};
