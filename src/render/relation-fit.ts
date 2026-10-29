/*
 * The fit of the relation text on a drawn card (D268). When the whole text does not fit the card, the card tries
 * three short forms in a fixed order and stops at the first one that fits: cousin degrees as numerals, removals as numbers,
 * "great-great-" as "2nd great-". If even the shortest form is too wide, the text is cut as before (D40, D176 5), and the cut never
 * ends at the end of a word. Pure; the live scene (`dom/scene.ts`) and the saved picture (`svg-string.ts`) each call it with their
 * own measure. Only the drawn card uses it: the person window, the screen-reader label, the phone list and Find keep the whole text.
 */
import { splitMaybe } from './tree-info';
import { graphemes, truncateWithMaybe } from './view-math';

const DEGREES: Readonly<Record<string, string>> = {
	first: '1st',
	second: '2nd',
	third: '3rd',
	fourth: '4th',
	fifth: '5th',
	sixth: '6th',
	seventh: '7th',
	eighth: '8th',
	ninth: '9th',
	tenth: '10th',
};

/** The multiplication sign of a short removal ("1× removed"). */
export const TIMES_SIGN = '×';

/** The first form: "First cousin" becomes "1st cousin" (first to tenth; the plugin already writes 11th and on as numerals). */
export function shortenDegree(word: string): string {
	return word.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) cousin\b/i, (_m, d: string) => `${DEGREES[d.toLowerCase()]} cousin`);
}

/** The second form: "once removed" becomes "1× removed", "twice removed" "2× removed", "5 times removed" "5× removed". The word "removed" stays. */
export function shortenRemoval(word: string): string {
	return word
		.replace(/\bonce removed\b/, `1${TIMES_SIGN} removed`)
		.replace(/\btwice removed\b/, `2${TIMES_SIGN} removed`)
		.replace(/\b(\d+) times removed\b/, `$1${TIMES_SIGN} removed`);
}

/** The third form: "great-great-" becomes "2nd great-", and "Half-great-great-uncle" becomes "Half 2nd great-uncle", the plugin's own spelling from the third great on. */
export function shortenGreats(word: string): string {
	return word.replace(/\b(half)-great-great-/i, '$1 2nd great-').replace(/great-great-/i, '2nd great-');
}

/** The forms of a relation word in the order they are tried: the word, then the first form, then the first and second, then all three. A form that equals the one before it is left out. */
export function relationForms(word: string): string[] {
	const forms = [word];
	for (const rule of [shortenDegree, shortenRemoval, shortenGreats]) {
		const next = rule(forms[forms.length - 1]);
		if (next !== forms[forms.length - 1]) forms.push(next);
	}
	return forms;
}

/** Where a cut may not end: before a space or an apostrophe the visible part would be a complete word or possessive. */
const WORD_END = /[ '’]/;

/**
 * Moves the cut of `out` (a cut of `whole`, ending in "…" or "… ?") left until it cannot read as a complete, different relation.
 * Three rules. (1) The next character of `whole` is not a space or an apostrophe, and the kept part does not end in an apostrophe: a lone
 * apostrophe is one pixel wide, so "great-granddaughter'…" would read as the complete relation "great-granddaughter". (2) Digits at the end
 * of the kept part are dropped when the text goes on with a digit or a letter: "half 1…" would read as "1st" when the text says "10th".
 * (3) A "N×" stays whole ("1st cousin 1×…"): cutting before it would leave the complete, wrong relation "1st cousin".
 */
function cutInsideWord(whole: string, out: string): string {
	const tail = out.endsWith('… ?') ? '… ?' : out.endsWith('…') ? '…' : '';
	if (!tail) return out;
	let kept = out.slice(0, out.length - tail.length);
	if (!whole.startsWith(kept)) return out;
	const moveLeft = (from: string): string => {
		let k = from;
		while (k && ((WORD_END.test(whole.charAt(k.length)) && !k.endsWith(TIMES_SIGN)) || /['’]$/.test(k))) {
			const chars = graphemes(k);
			chars.pop();
			k = chars.join('').trimEnd();
		}
		return k;
	};
	kept = moveLeft(kept);
	if (/(^| )\d+$/.test(kept) && /[a-z0-9]/i.test(whole.charAt(kept.length))) kept = moveLeft(kept.replace(/\d+$/, '').trimEnd());
	return kept + tail;
}

/**
 * The text a drawn card shows for a relation `word` and its maybe `suffix` (', maybe full' or ''), in `maxW` px by `measure`. The whole text if it fits;
 * else the first of the short forms (see `relationForms`) that fits with the suffix; else the shortest form, cut as before (the suffix becomes " ?"),
 * inside a word. The suffix is never changed by a short form.
 */
export function fitRelation(word: string, suffix: string, maxW: number, measure: (s: string) => number): string {
	const forms = relationForms(word);
	for (const form of forms) {
		if (measure(form + suffix) <= maxW) return form + suffix;
	}
	const shortest = forms[forms.length - 1];
	return cutInsideWord(shortest + suffix, truncateWithMaybe(shortest, suffix, maxW, measure));
}

/** `fitRelation` for a whole card relation text, which may end in a maybe suffix (the suffix is split off with `splitMaybe`). */
export function fitRelationText(text: string, maxW: number, measure: (s: string) => number): string {
	const { word, suffix } = splitMaybe(text);
	return fitRelation(word, suffix, maxW, measure);
}
