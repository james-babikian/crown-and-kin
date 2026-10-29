/*
 * One pure function that makes two texts comparable for search (D100): it ignores case, accents
 * (every combining mark, also Hebrew and Arabic), the final sigma and the look of quote marks. Find,
 * the person picker and the picture search fold the query and
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

/** The combining marks that NFKD leaves behind: the accents of the Latin, Greek and Cyrillic scripts (the range of the fold of an id). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Every non-spacing mark (Unicode category Mn), for a search: Hebrew points, Arabic vowel signs and the like also go. Spacing marks (Mc) stay, because in the
 * Indic scripts they are part of the letter. An id keeps these marks, so only a search uses this one.
 */
const ALL_MARKS = /\p{Mn}/gu;

/** ASCII with no grave sign (U+0060, a quote look-alike). */
const PLAIN_ASCII = /^[\x00-\x5f\x61-\x7f]*$/;

/** Single quote look-alikes: curly, modifier letter, prime, grave and acute. */
const SINGLE_QUOTES = /[‘’ʼ′`´]/g;
/** Double quote look-alikes: curly, low, double prime and angle quotes. */
const DOUBLE_QUOTES = /[“”„″«»]/g;

/** The most rounds of folding. Two are enough for every character found; the third proves it. */
const MAX_ROUNDS = 3;

/** One round of the fold. `search` is true for a search (every mark goes, the final sigma is the sigma) and false for an id (the range of the accents only). */
function foldRound(s: string, search: boolean): string {
	// Quotes first: NFKD turns the acute sign (U+00B4) into a space and a mark.
	// Lower-case before the map, so capital sharp s (ẞ) reaches the map as ß.
	let lower = s.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').toLowerCase();
	// D100: a capital sigma lower-cases to σ or ς by its place in the word, so a search takes both as one letter.
	if (search) lower = lower.replace(/ς/g, 'σ');
	return foldLetters(lower).normalize('NFKD').replace(search ? ALL_MARKS : COMBINING_MARKS, '');
}

function foldAll(s: string, search: boolean): string {
	// Plain ASCII without the grave sign needs only lower-case; most paths are like this, and a search of 10 000 pictures folds each path once.
	if (PLAIN_ASCII.test(s)) return s.toLowerCase();
	// A map letter with an accent (Ǣ) or a letter that NFKD splits into a quote (ŉ) only shows after a round, so repeat until the text is stable.
	let current = s;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const next = foldRound(current, search);
		if (next === current) return next;
		// Most accented text is plain ASCII after one round; this skips the proof round.
		if (PLAIN_ASCII.test(next)) return next.toLowerCase();
		current = next;
	}
	return current;
}

/**
 * The form of `s` to compare in a search: quote look-alikes become ' and ", every accent and combining mark goes (Hebrew points and Arabic vowel signs too),
 * the final sigma becomes σ, the letter map applies, and case goes. Running it again on its result changes nothing.
 */
export function foldForMatch(s: string): string {
	return foldAll(s, true);
}

/** The fold that `slugify` uses for an id: as `foldForMatch`, but only the accent range goes and the final sigma stays, so an id does not change. */
export function foldForId(s: string): string {
	return foldAll(s, false);
}
