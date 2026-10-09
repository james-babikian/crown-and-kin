/*
 * The words and small readers of the succession keys on a title (contract 0.2.7, sections A, B.1, J.7, K.5): the rule
 * names, the year reader, the ordinal word and the "is this person dead" test. It is a leaf: it imports nothing from
 * the other core files, so `parse.ts`, `validate.ts`, `messages.ts`, the engine in `succession.ts` and the Titles
 * window can all use it without a cycle.
 */

/** The succession rules a title can name (the order in which the sort of heirs is made). */
export const SUCCESSION_RULES = ['eldest-child', 'youngest-child', 'siblings-first', 'nearest-relative', 'born-in-reign'] as const;
/** One of `SUCCESSION_RULES`. */
export type SuccessionRule = (typeof SUCCESSION_RULES)[number];

/** The values of `inherit`: who can inherit. The two "in-house" forms run two passes in the engine. */
export const INHERIT_RULES = ['men-only', 'men-first-in-house', 'men-first', 'no-preference', 'women-first', 'women-first-in-house', 'women-only'] as const;
/** One of `INHERIT_RULES`. */
export type InheritRule = (typeof INHERIT_RULES)[number];

/** The values of `inherit-through`: through whom a claim passes (K.1). */
export const INHERIT_THROUGH = ['men', 'women', 'anyone'] as const;
/** One of `INHERIT_THROUGH`. */
export type InheritThrough = (typeof INHERIT_THROUGH)[number];

/** The values of `inherit-illegitimate`. */
export const INHERIT_ILLEGITIMATE = ['no', 'after', 'equal'] as const;
/** One of `INHERIT_ILLEGITIMATE`. */
export type InheritIllegitimate = (typeof INHERIT_ILLEGITIMATE)[number];

/** Old and short names that are read as a current value (spec §8: tolerated, kept as written). */
const OLD_RULES: Readonly<Record<string, SuccessionRule>> = {
	primogeniture: 'eldest-child',
	ultimogeniture: 'youngest-child',
	'brothers-first': 'siblings-first',
	seniority: 'siblings-first',
	'agnatic-seniority': 'siblings-first',
	proximity: 'nearest-relative',
	'proximity-of-blood': 'nearest-relative',
	porphyrogeniture: 'born-in-reign',
};
const OLD_INHERIT: Readonly<Record<string, InheritRule>> = {
	'male-only': 'men-only',
	'semi-salic': 'men-first-in-house',
	'reverse-semi-salic': 'women-first-in-house',
	'male-first': 'men-first',
	'male-preference': 'men-first',
	none: 'no-preference',
	any: 'no-preference',
	'female-first': 'women-first',
	'female-preference': 'women-first',
	'female-only': 'women-only',
};
const OLD_THROUGH: Readonly<Record<string, InheritThrough>> = { male: 'men', female: 'women', any: 'anyone' };

/** A written text as a member of `list`, or through the `old` names; values compare after trim and lower case. */
function readWord<T extends string>(list: readonly T[], old: Readonly<Record<string, T>>, v: string | undefined): T | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim().toLowerCase();
	if ((list as readonly string[]).includes(t)) return t as T;
	return Object.prototype.hasOwnProperty.call(old, t) ? old[t] : undefined;
}

/** A.1: a written `succession` value as a rule (old names included), or undefined. */
export function readRule(v: string | undefined): SuccessionRule | undefined {
	return readWord(SUCCESSION_RULES, OLD_RULES, v);
}

/** A.1: a written `inherit` value as a rule (old names included), or undefined. */
export function readInherit(v: string | undefined): InheritRule | undefined {
	return readWord(INHERIT_RULES, OLD_INHERIT, v);
}

/** K.1: a written `inherit-through` value (old forms `male`, `female`, `any` included), or undefined. */
export function readThrough(v: string | undefined): InheritThrough | undefined {
	return readWord(INHERIT_THROUGH, OLD_THROUGH, v);
}

/**
 * A.1: a written `inherit-illegitimate` value. `no` and `false` are `no`; `after` and `equal` as written; every value
 * that the person key `illegitimate` reads as true (`true`, `yes`) is `after`. Any other text is undefined.
 */
export function readIllegitimate(v: string | undefined): InheritIllegitimate | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim().toLowerCase();
	if (t === 'no' || t === 'false') return 'no';
	if (t === 'after' || t === 'equal') return t;
	return t === 'true' || t === 'yes' ? 'after' : undefined;
}

/** True if `n` is a whole number that a year can be (the regular expressions below allow 15 digits). */
const safe = (n: number) => (Number.isSafeInteger(n) ? (n === 0 ? 0 : n) : undefined);

const PLAIN = /^\d{1,15}$/;
const WHOLE = /^(-?)(\d{1,15})$/;
const BC = /(?:^|\D)(\d{1,15})(?!\d)\s*B\.?\s*C\.?(?:\s*E\.?)?(?![A-Za-z0-9])/i;
const AD_AFTER = /(?:^|[^A-Za-z])(?:A\.?\s*D\.?|C\.?\s*E\.?)(?![A-Za-z])\s*(\d{1,15})(?!\d)/i;
const AD_BEFORE = /(?:^|\D)(\d{1,15})(?!\d)\s*(?:A\.?\s*D\.?|C\.?\s*E\.?)(?![A-Za-z0-9])/i;
// No lookbehind: iOS before 16.4 cannot parse one.
const THREE_OR_FOUR = /(?:^|\D)(\d{3,4})(?!\d)/;

/**
 * K.5: the year in a free text. A whole number ("12", "-200"), a number with BC, BCE or AD, CE ("200 BC" is -200), else
 * the first run of three or four digits with no digit beside it ("12 May 1203"). Undefined when there is none. It can
 * return 0 and negative numbers, so callers test `!== undefined`.
 */
export function yearOf(text: string | undefined): number | undefined {
	if (typeof text !== 'string') return undefined;
	// The common case (a plain year) skips the clean-up below.
	if (PLAIN.test(text)) return Number(text);
	const t = text.trim().replace(/−/g, '-');
	if (t === '') return undefined;
	let m = WHOLE.exec(t);
	if (m) return safe(Number(m[2]) * (m[1] === '-' ? -1 : 1));
	m = BC.exec(t);
	if (m) return safe(-Number(m[1]));
	m = AD_AFTER.exec(t) ?? AD_BEFORE.exec(t);
	if (m) return safe(Number(m[1]));
	m = THREE_OR_FOUR.exec(t);
	return m ? safe(Number(m[1])) : undefined;
}

/** "1st", "2nd", "3rd", "4th", … "11th", "12th", "13th", … "21st". */
export function ordinal(n: number): string {
	const last2 = Math.abs(n) % 100;
	const last = last2 % 10;
	const suffix = last2 >= 11 && last2 <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
	return `${n}${suffix}`;
}

/** J.7: a `died` text that means "not dead". */
const ALIVE_WORDS: readonly string[] = ['false', 'no', 'alive', 'living', 'never'];
/** J.7: a `died` text that is a doubt, not a date; the plugin counts the person as dead and warns (`died-doubtful`). */
export const DOUBTFUL_DIED: readonly string[] = ['?', 'unknown', 'maybe', 'perhaps', 'possibly', 'uncertain'];

/** J.7: false when `died` is absent or one of the words that mean alive; true for every other text. */
export function isDead(person: { died?: string }): boolean {
	const d = person.died;
	if (typeof d !== 'string') return false;
	const t = d.trim().toLowerCase();
	return t !== '' && !ALIVE_WORDS.includes(t);
}
