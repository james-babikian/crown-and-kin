/*
 * The number places of a date format (spec section 14 rule 4): digits, digits with an ordinal suffix, English number words and ordinal words from 1 to 99,
 * and Roman numerals, and the second number of a range ("3rd to 5th"). Pure, with no import: `dates.ts` reads the places of every format with it.
 */

const ONES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const ONES_ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const TENS_ORD = ['twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

/** Number words and ordinal words from 1 to 99 (rule 4; "zero" and "one hundred" are not values), longest first, by first letter. */
const WORDS: ReadonlyMap<string, readonly (readonly [string, number])[]> = (() => {
	const all: [string, number][] = [];
	ONES.forEach((w, i) => all.push([w, i + 1]));
	ONES_ORD.forEach((w, i) => all.push([w, i + 1]));
	TENS.forEach((w, i) => all.push([w, 20 + 10 * i]));
	TENS_ORD.forEach((w, i) => all.push([w, 20 + 10 * i]));
	TENS.forEach((tens, ti) => {
		for (let u = 1; u <= 9; u++) {
			for (const sep of ['-', ' ']) {
				all.push([`${tens}${sep}${ONES[u - 1]}`, 20 + 10 * ti + u]);
				all.push([`${tens}${sep}${ONES_ORD[u - 1]}`, 20 + 10 * ti + u]);
			}
		}
	});
	all.sort((a, b) => b[0].length - a[0].length);
	const byChar = new Map<string, [string, number][]>();
	for (const entry of all) {
		const list = byChar.get(entry[0][0]);
		if (list) list.push(entry);
		else byChar.set(entry[0][0], [entry]);
	}
	return byChar;
})();

// A Roman numeral from 1 (I) to 3999 (MMMCMXCIX), in lower case because the text is folded.
const ROMAN = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
const ROMAN_VALUE: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(s: string): number {
	let total = 0;
	for (let i = 0; i < s.length; i++) {
		const v = ROMAN_VALUE[s[i]];
		total += i + 1 < s.length && v < ROMAN_VALUE[s[i + 1]] ? -v : v;
	}
	return total;
}

const ORDINAL_SUFFIX = ['st', 'nd', 'rd', 'th'];
/** A digit run longer than this is no value (it could not be a safe whole number in a sum). */
const MAX_DIGITS = 15;

export interface Candidate {
	end: number;
	value: number;
}

/** Rule 4: every way a number place can read the text from `p`: digits, digits with an ordinal suffix, words, Roman numerals; longest first. */
export function numberCandidates(t: string, p: number): Candidate[] {
	const out: Candidate[] = [];
	let q = p;
	while (q < t.length && t.charCodeAt(q) >= 48 && t.charCodeAt(q) <= 57) q++;
	if (q > p && q - p <= MAX_DIGITS) {
		if (ORDINAL_SUFFIX.includes(t.slice(q, q + 2))) out.push({ end: q + 2, value: Number(t.slice(p, q)) });
		for (let e = q; e > p; e--) out.push({ end: e, value: Number(t.slice(p, e)) });
	} else if (q === p) {
		const words = WORDS.get(t[p]);
		if (words) for (const [w, v] of words) if (t.startsWith(w, p)) out.push({ end: p + w.length, value: v });
		let r = p;
		while (r < t.length && 'ivxlcdm'.includes(t[r])) r++;
		for (let e = r; e > p; e--) {
			const s = t.slice(p, e);
			if (ROMAN.test(s)) out.push({ end: e, value: romanValue(s) });
		}
		out.sort((a, b) => b.end - a.end);
	}
	return out;
}

const RANGE_JOIN = /\s*[-–—]\s*|\s+(?:to|until|through|and)\s+(?:the\s+)?/y;

/** The ways to read the second number of a range ("3rd to 5th", "3-5", "3rd and 5th") that follows a first number which ends at `p`. */
export function rangeEnds(t: string, p: number): Candidate[] {
	RANGE_JOIN.lastIndex = p;
	const join = RANGE_JOIN.exec(t);
	return join ? numberCandidates(t, p + join[0].length) : [];
}
