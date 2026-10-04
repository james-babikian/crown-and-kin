/**
 * Splits a long name onto up to three text lines instead of truncating it to one (D29, D37, D81),
 * and a title text line with a reign onto up to two (D61, spec §13.3). The main caller is
 * `render/dom/tall-cards.ts`, which uses `nameLines` and `titleLines` to find the tall cards.
 * `render/dom/scene.ts` and `render/svg-string.ts` then draw the text lines at the baselines
 * `layout/geometry.ts`'s `cardText(geo, names, tallTitle)` gives.
 */
import { truncate } from './view-math';

/**
 * Splits a name for a card (D29, D81): one text line if `measure(name) <= width`, else up to
 * `maxLines` (default 3). Each text line but the last is the longest start of the rest that ends at
 * a space and fits; a word longer than `width` breaks inside the word. The last allowed text line
 * takes the rest and ends with "…" if it is still too wide. `width` is the free text width of the
 * card after the D14 sign, the arms and, in `sideways`, the `+` badge room (1.2 em). With
 * `maxLines` 2 the result is the D37 result. Pure.
 */
export type NameLines = (name: string, width: number, measure: (text: string) => number, maxLines?: 2 | 3) => string[];

/** D29, D81: a name on one, two or three text lines; see `NameLines`. */
export const nameLines: NameLines = (name, width, measure, maxLines = 3) => {
	// Trimmed first: outer spaces must not make a name that fits take two text lines.
	let rest = name.trim();
	const out: string[] = [];
	for (;;) {
		if (measure(rest) <= width) return [...out, rest];
		if (out.length >= maxLines - 1) return [...out, truncate(rest, width, measure)];
		const chars = Array.from(rest);
		let at = -1;
		// Last space first: the longest text line that fits.
		for (let i = chars.length - 1; i > 0; i--) {
			if (chars[i] !== ' ') continue;
			const first = chars.slice(0, i).join('').trimEnd();
			if (first && measure(first) <= width) {
				at = i;
				break;
			}
		}
		if (at > 0) {
			out.push(chars.slice(0, at).join('').trimEnd());
			rest = chars.slice(at + 1).join('').trimStart();
			continue;
		}
		// No usable space: fill the text line character by character (at least one, so the name always moves on).
		let n = 1;
		while (n < chars.length && measure(chars.slice(0, n + 1).join('')) <= width) n++;
		out.push(chars.slice(0, n).join('').trimEnd());
		rest = chars.slice(n).join('').trimStart();
	}
};

/**
 * The text lines of a title text line (spec §13.3, D61). `reign` is the §13.3 parenthetical
 * ("(r. 1131–1160)"), or undefined when there is none or "Show dates on cards" is off. No reign: one
 * text line, cut with "…" (the §5.2 rule). With a reign: `${title} ${reign}` on one text line if it
 * fits; else two, broken before the reign if the title fits on line 1 and the reign on line 2, else at
 * the last space that fits (the `nameLines` rule); the second text line ends with "…" if it is still
 * too wide. A reign with no
 * title: the reign alone, on one text line. No title and no reign: no text line.
 */
export type TitleLines = (title: string | undefined, reign: string | undefined, width: number, measure: (s: string) => number) => string[];

/** D61: a title text line, with the reign after it, on one or two text lines; see `TitleLines`. */
export const titleLines: TitleLines = (title, reign, width, measure) => {
	// Without a reign the title is cut exactly as a 0.1 title text line is.
	if (!reign?.trim()) return title ? [truncate(title, width, measure)] : [];
	const tail = reign.trim();
	const head = title?.trim() ?? '';
	if (!head) return [truncate(tail, width, measure)];
	const full = `${head} ${tail}`;
	if (measure(full) <= width) return [full];
	if (measure(head) <= width && measure(tail) <= width) return [head, tail];
	// A reign too wide for line 2 alone must not start there: the last-space break keeps more of it on the card.
	return nameLines(full, width, measure, 2);
};
