/*
 * The words and small readers of the succession keys on a title (contract 0.2.7, sections A, B.1, J.7, K.5): the rule
 * names, the year reader and its formatter, the ordinal word, the "is this person dead" test and the partner choice of
 * "holds the title through the spouse" (0.2.8). It is a leaf: it imports nothing from
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

const PLAIN = /^\d{1,15}$/;
const WHOLE = /^(-?)(\d{1,15})$/;
const BC = /(?:^|\D)(\d{1,15})(?!\d)\s*B\.?\s*C\.?(?:\s*E\.?)?(?![A-Za-z0-9])/i;
const BC_BEFORE = /(?:^|[^A-Za-z])B\.?\s*C\.?(?:\s*E\.?)?(?![A-Za-z])\s*(\d{1,15})(?!\d)/i;
const AD_AFTER = /(?:^|[^A-Za-z])(?:A\.?\s*D\.?|C\.?\s*E\.?)(?![A-Za-z])\s*(\d{1,15})(?!\d)/i;
const AD_BEFORE = /(?:^|\D)(\d{1,15})(?!\d)\s*(?:A\.?\s*D\.?|C\.?\s*E\.?)(?![A-Za-z0-9])/i;
// No lookbehind: iOS before 16.4 cannot parse one.
const THREE_OR_FOUR = /(?:^|\D)(\d{3,4})(?!\d)/g;
// "BP" (before present) right after a number: a count of years back from now, which has no place on the line (rule 8).
const BP_AFTER = /^\s*B\.?\s*P\.?(?![A-Za-z0-9])/i;

// S1 (0.2.8): a grouped number has groups of exactly 3 digits joined by a comma, a space, a no-break space (U+00A0, U+202F)
// or a thin space (U+2009). A text that is wholly one, with an optional prefix and an optional era mark, is one number.
const GROUPED = '\\d{1,3}(?:[,\\u00a0\\u202f\\u2009 ]\\d{3})+';
const ERA = '(?:B\\.?\\s*C\\.?(?:\\s*E\\.?)?|A\\.?\\s*D\\.?|C\\.?\\s*E\\.?)';
const GROUPED_WHOLE = new RegExp(`^(?:(?:c\\.|ca\\.|about|circa|~)\\s*)?(?:(${ERA})\\s*(${GROUPED})|(${GROUPED})(?:\\s*(${ERA}))?)$`, 'i');
// A grouped number inside a longer text: its groups are fragments and never a year.
const GROUPED_ANY = new RegExp(`(?:^|\\D)${GROUPED}(?!\\d)`);
// A whole text that is a grouped number with a wrong group ("1,2500") or one that uses a dot as the thousands mark ("1.250").
const FRAGMENT_WHOLE = /^(?:\d{1,3}\.\d{3}|\d{1,3}(?:,\d{3})*,\d{4,})$/;
// One stray space around the comma ("1, 250", "1 ,250") is the same mistake, but only when the whole text is the number:
// in "Jan 5, 624" the comma follows a day.
const STRAY_WHOLE = new RegExp(`^(?:(?:c\\.|ca\\.|about|circa|~)\\s*)?(?:${ERA}\\s*)?\\d{1,3} ?, ?\\d{3}(?:\\s*${ERA})?$`, 'i');

const NON_ASCII = /[^\x00-\x7f]/;
const DECIMAL = /\p{Nd}/u;
const DECIMAL_ALL = /\p{Nd}/gu;

/**
 * Rule 8: every Unicode decimal digit reads as 0 to 9. The digits of a script come in one run of ten code points in the
 * order 0 to 9 (the 50 mathematical digits are five runs in a row), so the place in the run of consecutive digits, modulo
 * ten, is the value.
 */
function asciiDigits(text: string): string {
	if (!NON_ASCII.test(text)) return text;
	return text.replace(DECIMAL_ALL, (ch) => {
		const cp = ch.codePointAt(0)!;
		if (cp < 128) return ch;
		let k = 0;
		while (DECIMAL.test(String.fromCodePoint(cp - k - 1))) k++;
		return String(k % 10);
	});
}

/** A magnitude with its sign as an internal year (rule 8): there is no year 0, so n BC is 1 - n; a written zero is 0 with the flag. */
function internal(n: number, bc: boolean): { year: number; zero?: true } | undefined {
	if (!Number.isSafeInteger(n)) return undefined;
	if (n === 0) return { year: 0, zero: true };
	return { year: bc ? 1 - n : n };
}

/**
 * K.5: the year in a free text, as an internal year (rule 8). A whole number ("12", "-200"), a grouped number ("1,250"),
 * a number with BC, BCE or AD, CE ("200 BC" and "BC 200" are -199), else the first run of three or four digits with no
 * digit beside it ("12 May 1203") that is not followed by BP. Undefined when there is none, and for a fragment of a grouped
 * number ("1.250", "1,2500", "1, 250"). It can return 0 and negative numbers, so callers test `!== undefined`. `text` has
 * ASCII digits already. (This is the year of `readPlain`; `yearOf` gives it too.)
 */
function plainYear(text: string): { year: number; zero?: true } | undefined {
	const t = text.trim().replace(/−/g, '-');
	if (t === '') return undefined;
	let m = WHOLE.exec(t);
	if (m) return internal(Number(m[2]), m[1] === '-');
	const g = GROUPED_WHOLE.exec(t);
	if (g) {
		const digits = (g[2] ?? g[3]).replace(/\D/g, '');
		if (digits.length > 15) return undefined;
		const era = (g[1] ?? g[4] ?? '').replace(/[.\s]/g, '').toUpperCase();
		return internal(Number(digits), era.startsWith('B'));
	}
	if (FRAGMENT_WHOLE.test(t) || STRAY_WHOLE.test(t) || GROUPED_ANY.test(t)) return undefined;
	m = BC.exec(t) ?? BC_BEFORE.exec(t);
	if (m) return internal(Number(m[1]), true);
	m = AD_AFTER.exec(t) ?? AD_BEFORE.exec(t);
	if (m) return internal(Number(m[1]), false);
	for (THREE_OR_FOUR.lastIndex = 0; (m = THREE_OR_FOUR.exec(t)); ) {
		if (!BP_AFTER.test(t.slice(THREE_OR_FOUR.lastIndex))) return internal(Number(m[1]), false);
	}
	return undefined;
}

// A prefix that makes a year approximate (spec section 14 rule 4); `about` and `circa` are whole words, and `c.` needs a space or a digit after it ("C.E. 200" is an era mark).
const APPROX = /^(?:(?:c|ca)\.(?=[\s\d])|~|(?:about|circa)(?![a-z]))/i;
// An old double date: four digits, a slash and the last one or two digits of the next year ("1700/01", "1799/00").
// Nothing like a further date part may follow (`1203/04/12` is a year, a month and a day).
// Old Style / New Style dual dating ended by 1800, so a later "1905/06" is a year and a month or a season, not a dual date.
const DUAL_LAST = 1800;
const DUAL = /(?:^|\D)(\d{4})\/(\d{1,2})(?!\d)(?![/.-]\d)/;

/** What the plain reader found: the year of `yearOf`, and flags for the cases that spec section 14 rule 8 treats in a special way. */
export interface PlainRead {
	year?: number;
	/** The text starts with `c.`, `ca.`, `~`, `about` or `circa`; the year is the same. */
	approx?: true;
	/** The text is a written zero (`0`, `-0`, `0 BC`): the year is 0, which is 1 BC, and the plain reader warns. */
	zero?: true;
	/** The text is an old double date ("1700/01"); the year is the later one. */
	dual?: true;
}

/**
 * The plain-year reader with its flags (spec section 14 rule 8). Years are internal: there is no year 0, so 1 BC is 0 and
 * AD 1 is 1. Never throws.
 */
export function readPlain(text: string | undefined): PlainRead {
	if (typeof text !== 'string') return {};
	const out: PlainRead = {};
	// The common case (a plain year) skips the clean-up below.
	if (PLAIN.test(text)) {
		out.year = Number(text);
		if (out.year === 0) out.zero = true;
		return out;
	}
	const t = asciiDigits(text);
	const r = plainYear(t);
	if (r === undefined) return out;
	out.year = r.year;
	if (r.zero) out.zero = true;
	if (APPROX.test(t.trim())) out.approx = true;
	if (t.includes('/')) {
		const m = DUAL.exec(t);
		if (m) {
			const first = Number(m[1]);
			const next = first + 1;
			const tail = m[2].length === 1 ? next % 10 : next % 100;
			if (Number(m[2]) === tail && first === r.year && first <= DUAL_LAST) {
				out.year = next;
				out.dual = true;
			}
		}
	}
	return out;
}

/** K.5: the year in a free text, as `readPlain` reads it. */
export function yearOf(text: string | undefined): number | undefined {
	return readPlain(text).year;
}

/** F-KIN-06: a year as the succession texts show it. An internal year of 0 or less shows as "(1 - y) BC" ("225 BC"), every other year as a plain number. */
export function formatYear(n: number): string {
	return n <= 0 ? `${1 - n} BC` : String(n);
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

// ---------- Holding the title through the spouse (0.2.8 contract A.2, D195) ----------

/** The facts the partner choice reads. `validate.ts` and `succession.ts` each build one, from the same rules (spec §13.21 rule 13a). */
export interface SpouseWorld {
	/** Every partner of `id`, one entry for each union (the type is `implicit` for a union that only shared children make). */
	partners(id: string): readonly { id: string; type: string }[];
	/** The parents of `id` through a birth or adoptive link, whatever the switches of a title say. */
	claimParents(id: string): readonly string[];
	/** True when a person has this id. */
	exists(id: string): boolean;
}

/** The result of the partner choice: the spouse S, or why the key is ignored. */
export type SpouseResult =
	| { ok: true; id: string }
	| { ok: false; why: 'no-partner' | 'no-marriage' | 'self' }
	| { ok: false; why: 'no-claim' | 'several-claims'; candidates: string[] }
	| { ok: false; why: 'unknown-person' | 'not-partner'; ref: string };

/** Union types that never give the automatic choice: jure uxoris needs a marriage (D195 Q4, gate vet). A named id may still be any partner. */
const NOT_AUTOMATIC: readonly string[] = ['concubinage', 'affair', 'betrothal'];

/**
 * D195, rule 13a: the spouse S of the holder `x`. `key` is `true` for the tick box or the id of the spouse as written;
 * `holders` are the persons of all holder entries of the title. An id names any partner (any union type, implicit
 * included). With `true`, one candidate is S; with several, S is the one candidate who is linked to another holder
 * (the same person, a descendant or an ancestor over birth and adoptive links, whatever the switches say).
 */
export function resolveSpouse(w: SpouseWorld, x: string, key: true | string, holders: readonly string[]): SpouseResult {
	const all = w.partners(x);
	if (typeof key === 'string') {
		if (!w.exists(key)) return { ok: false, why: 'unknown-person', ref: key };
		if (key === x) return { ok: false, why: 'self' };
		return all.some((p) => p.id === key) ? { ok: true, id: key } : { ok: false, why: 'not-partner', ref: key };
	}
	const candidates: string[] = [];
	for (const p of all) if (p.id !== x && !NOT_AUTOMATIC.includes(p.type) && !candidates.includes(p.id)) candidates.push(p.id);
	// A holder whose partners are all betrothals, concubines or affairs has partners but no marriage to choose from.
	if (candidates.length === 0) return { ok: false, why: all.some((p) => p.id !== x) ? 'no-marriage' : 'no-partner' };
	if (candidates.length === 1) return { ok: true, id: candidates[0] };
	const others = [...new Set(holders.filter((h) => h !== x))];
	const above = new Map<string, Set<string>>();
	// Everyone above `id` over claim links, the person included.
	const ancestorsOf = (id: string): Set<string> => {
		let set = above.get(id);
		if (set) return set;
		set = new Set([id]);
		for (const stack = [id]; stack.length; ) {
			for (const q of w.claimParents(stack.pop()!)) {
				if (set.has(q)) continue;
				set.add(q);
				stack.push(q);
			}
		}
		above.set(id, set);
		return set;
	};
	const linked = candidates.filter((q) => others.some((h) => ancestorsOf(q).has(h) || ancestorsOf(h).has(q)));
	if (linked.length === 1) return { ok: true, id: linked[0] };
	return linked.length === 0 ? { ok: false, why: 'no-claim', candidates } : { ok: false, why: 'several-claims', candidates: linked };
}
