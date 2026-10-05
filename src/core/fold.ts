/*
 * One pure function that makes two texts comparable for search (D100): it ignores case, accents
 * and the look of quote marks. Find, the person picker and the picture search fold the query and
 * the text they look in with `foldForMatch`, and never change stored or shown text. The letter map
 * that has no accent form (Þ, Æ, Ø, Ð, ß and so on) is shared with `slugify` in `id-gen.ts`, so ids
 * and search agree on what "ø" is.
 */

/** Letters that Unicode does not split into a base letter and a mark, with the plain letters for them. */
const LETTER_MAP: ReadonlyArray<readonly [RegExp, string]> = [
	[/[Þþ]/g, 'th'],
	[/[Ææ]/g, 'ae'],
	[/[Øø]/g, 'o'],
	[/[ßẞ]/g, 'ss'],
	[/[Łł]/g, 'l'],
	[/[ÐðĐđ]/g, 'd'],
	[/[Œœ]/g, 'oe'],
	[/[Ħħ]/g, 'h'],
	[/ı/g, 'i'],
];

/** Replaces the letters that have no accent form with plain letters ("Þórr" gives "thórr"). Keeps case. */
export function foldLetters(s: string): string {
	let out = s;
	for (const [from, to] of LETTER_MAP) out = out.replace(from, to);
	return out;
}

/** The combining marks that NFKD leaves behind. */
export const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** ASCII with no grave sign (U+0060, a quote look-alike). */
const PLAIN_ASCII = /^[\x00-\x5f\x61-\x7f]*$/;

/** Single quote look-alikes: curly, modifier letter, prime, grave and acute. */
const SINGLE_QUOTES = /[‘’ʼ′`´]/g;
/** Double quote look-alikes: curly, low, double prime and angle quotes. */
const DOUBLE_QUOTES = /[“”„″«»]/g;

/** The most rounds of folding. Two are enough for every character found; the third proves it. */
const MAX_ROUNDS = 3;

/** One round of the fold. */
function foldRound(s: string): string {
	// Quotes first: NFKD turns the acute sign (U+00B4) into a space and a mark.
	// Lower-case before the map, so capital sharp s (ẞ) reaches the map as ß.
	const quoted = s.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').toLowerCase();
	return foldLetters(quoted).normalize('NFKD').replace(COMBINING_MARKS, '');
}

/**
 * The form of `s` to compare in a search: quote look-alikes become ' and ", accents go, the letter
 * map applies, and case goes. Running it again on its result changes nothing.
 */
export function foldForMatch(s: string): string {
	// Plain ASCII without the grave sign needs only lower-case; most paths are like this, and a search of 10 000 pictures folds each path once.
	if (PLAIN_ASCII.test(s)) return s.toLowerCase();
	// A map letter with an accent (Ǣ) or a letter that NFKD splits into a quote (ŉ) only shows after a round, so repeat until the text is stable.
	let current = s;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const next = foldRound(current);
		if (next === current) return next;
		// Most accented text is plain ASCII after one round; this skips the proof round.
		if (PLAIN_ASCII.test(next)) return next.toLowerCase();
		current = next;
	}
	return current;
}
