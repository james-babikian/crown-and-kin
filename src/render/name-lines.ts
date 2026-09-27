import type { NameLines } from './m6-contract';
import { truncate } from './view-math';

/**
 * D29: a name on one text line if it fits, else on two. Line 1 ends at the last space that lets it
 * fit; with no such space it is the widest start of the name that fits, and line 2 carries on
 * where it stopped. Line 2 ends with "…" when it is still too wide.
 */
export const nameLines: NameLines = (name, width, measure) => {
	if (measure(name) <= width) return [name];
	const text = name.trim();
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
