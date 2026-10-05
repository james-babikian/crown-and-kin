/**
 * Splits a long name onto up to three text lines instead of truncating it to one (D29, D37, D81),
 * and a title text line with a reign onto up to two (D61, spec §13.3). `cardNameLines` (0.2.4) breaks
 * a card name with its sobriquet: at spaces first, then at a hyphen with a syllable rule or the user's list
 * of break places (D117, D118), and cuts the sobriquet first (D122, D127). `render/dom/tall-cards.ts` calls
 * it to find the tall cards; `render/dom/scene.ts` and `render/svg-string.ts` call it to draw the text lines
 * at the baselines `layout/geometry.ts`'s `cardText(geo, names, tallTitle)` gives, so all three agree.
 * `nameLines` and `titleLines` stay for title text lines. Every search here is a binary search that
 * starts at the short end, so the cost of a very long name does not grow with its square (finding L5).
 */
import type { NameLineCount, NameRoom } from '../layout/model';
import { listKey, type BreakList } from './break-words';
import { truncate } from './view-math';

/**
 * The largest `k` in `[0, n)` for which `fits(k)` is true, when `fits` is true up to some `k` and false after it (-1 when
 * `fits(0)` is false). It probes 1, 3, 7, ... from the start and then halves, so the text it measures stays near the
 * answer, not near the end of a very long text.
 */
function lastFitting(n: number, fits: (k: number) => boolean): number {
	if (n <= 0 || !fits(0)) return -1;
	let lo = 0;
	let hi = n;
	let step = 1;
	while (lo + step < hi) {
		if (fits(lo + step)) {
			lo += step;
			step *= 2;
		} else {
			hi = lo + step;
			break;
		}
	}
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (fits(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * Splits a name for a card (D29, D81): one text line if `measure(name) <= width`, else up to
 * `maxLines` (default 3). Each text line but the last is the longest start of the rest that ends at
 * a space and fits; a word longer than `width` breaks inside the word. The last allowed text line
 * takes the rest and ends with "…" if it is still too wide. `width` is the free text width of the
 * card after the D14 sign. With `maxLines` 2 the result is the D37 result. Pure.
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
		const spaces: number[] = [];
		for (let i = 1; i < chars.length; i++) if (chars[i] === ' ') spaces.push(i);
		// Last space first: the longest text line that fits (found from the short end, so a long name is not measured at every space).
		const first = (i: number) => chars.slice(0, spaces[i]).join('').trimEnd();
		const k = lastFitting(spaces.length, (i) => {
			const s = first(i);
			return s !== '' && measure(s) <= width;
		});
		if (k >= 0) {
			out.push(first(k));
			rest = chars.slice(spaces[k] + 1).join('').trimStart();
			continue;
		}
		// No usable space: fill the text line character by character (at least one, so the name always moves on).
		const n = Math.max(1, lastFitting(chars.length, (m) => m === 0 || measure(chars.slice(0, m + 1).join('')) <= width) + 1);
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

// ---------------------------------------------------------------------------------------------
// 0.2.4 (D117, D118, D122, D125, D127): the card name with a sobriquet.

/** A piece of a name text line: the name (bold) or the sobriquet (regular). */
export interface NameRun {
	text: string;
	sob: boolean;
}

/** The width of a piece of a name text line; `sob` is true for the sobriquet (regular weight). */
export type NameMeasure = (text: string, sob: boolean) => number;

const VOWELS = 'aeiouyAEIOUYàáâäåæèéêëìíîïòóôöøùúûü';
const isVowel = (c: string | undefined) => !!c && VOWELS.includes(c);
const DIGRAPHS = ['ng', 'th', 'ch', 'sh', 'ph', 'gh', 'ck', 'qu', 'wh'];

/**
 * Code-point indices `k` (over the NFC form of the word) where a word may take a hyphen: the left part has `k >= 2` letters and the
 * right part has `len - k >= 2`. A vowel, a consonant and a vowel break before the consonant; two consonants between vowels
 * break between them, except a digraph. The rule knows Latin letters only (spec §13.19 rule 2). Example: "Longnamunda" gives [6, 9].
 */
export function syllableBreaks(word: string): number[] {
	const c = Array.from(word.normalize('NFC'));
	const out: number[] = [];
	for (let k = 2; k <= c.length - 2; k++) {
		const a = c[k - 1];
		const b = c[k];
		if (!/\p{L}/u.test(a) || !/\p{L}/u.test(b)) continue;
		if (isVowel(a) && !isVowel(b) && isVowel(c[k + 1])) out.push(k);
		else if (!isVowel(a) && !isVowel(b) && isVowel(c[k - 2]) && isVowel(c[k + 1]) && !DIGRAPHS.includes((a + b).toLowerCase())) out.push(k);
	}
	return out;
}

/**
 * The break places of one word part (a name part with no hyphen of its own): the user's places when the part is in the list and
 * has the length that the entry was written for, else `syllableBreaks`. Indices are code points of the NFC form of the part.
 */
export function breakPlaces(part: string, user?: BreakList): number[] {
	const nfc = part.normalize('NFC');
	const entry = user?.get(listKey(nfc));
	if (entry && entry.length === Array.from(nfc).length) return [...entry.places];
	return syllableBreaks(nfc);
}

/** A place where a token may end a text line. `at` is the code-point index where the right piece starts; `add` says that a hyphen is added to the left piece. */
interface Cand {
	at: number;
	add: boolean;
}

/** All places of a word (NFC code points): after each own hyphen (not at its very start or end), and the places of each part between own hyphens. */
function candidatesOf(cps: readonly string[], user?: BreakList): Cand[] {
	const out: Cand[] = [];
	let start = 0;
	for (let i = 0; i <= cps.length; i++) {
		if (i < cps.length && cps[i] !== '-') continue;
		if (i > start) for (const k of breakPlaces(cps.slice(start, i).join(''), user)) out.push({ at: start + k, add: true });
		// A hyphen at index 0 would leave a text line that holds only "-"; one at the end leaves nothing for the next text line.
		if (i < cps.length && i > 0 && i + 1 < cps.length) out.push({ at: i + 1, add: false });
		start = i + 1;
	}
	return out;
}

/** The pieces of a word, split at every place and own hyphen, without added hyphens: `breakWord('Longnamunda')` is `['Longna', 'mun', 'da']`. */
export function breakWord(word: string, user?: BreakList): string[] {
	const cps = Array.from(word.normalize('NFC'));
	const out: string[] = [];
	let from = 0;
	for (const c of candidatesOf(cps, user)) {
		out.push(cps.slice(from, c.at).join(''));
		from = c.at;
	}
	out.push(cps.slice(from).join(''));
	return out;
}

interface Tok {
	text: string;
	sob: boolean;
	/** The places of this piece of a word, when they are known: a piece cut off a word keeps the places of the original, shifted. */
	cands?: Cand[];
}

/** Cuts a name text line to `width` with "…" at the end (the regular part at the end goes first), keeping the longest start that fits. */
export function fitRuns(runs: readonly NameRun[], width: number, measure: NameMeasure): NameRun[] {
	const widthOf = (rs: readonly NameRun[]) => rs.reduce((a, r) => a + measure(r.text, r.sob), 0);
	if (widthOf(runs) <= width) return runs.map((r) => ({ ...r }));
	const chars = runs.flatMap((r) => Array.from(r.text).map((ch) => ({ ch, sob: r.sob })));
	const build = (n: number): NameRun[] => {
		const out: NameRun[] = [];
		const body = chars.slice(0, n);
		while (body.length && body[body.length - 1].ch === ' ') body.pop();
		for (const c of [...body, { ch: '…', sob: body.length ? body[body.length - 1].sob : false }]) {
			const last = out[out.length - 1];
			if (last && last.sob === c.sob) last.text += c.ch;
			else out.push({ text: c.ch, sob: c.sob });
		}
		return out;
	};
	const n = lastFitting(chars.length + 1, (k) => widthOf(build(k)) <= width);
	return build(Math.max(0, n));
}

/** The text of a name line from its pieces. */
export const runsText = (runs: readonly NameRun[]) => runs.map((r) => r.text).join('');

/**
 * The text lines of a card name (D117, D122, D125, D127): `maxLines` at most (default 3). The name breaks at spaces; a word
 * wider than a text line breaks with a hyphen (`breakToken`). The sobriquet follows the name as one token in curly marks that
 * the function adds: it moves whole to the next text line and never breaks. `room` is a `NameRoom` (rule A): the text lines
 * before the last use `full`, the final text line uses `last`, and a name that stays on one line uses `only`; a plain number is all three.
 * When the name does not fit the lines, the sobriquet goes first, completely: if the whole name fits, a "…" follows its last word when
 * it fits there; else the last text line keeps the longest run of whole words with "…", and only a first word that is too wide (together with the "…") is cut inside.
 * A person with no name text shows no sobriquet. Pure; the work is near the line widths, not the length of the name.
 */
export function cardNameLines(name: string, sobriquet: string | undefined, room: number | NameRoom, measure: NameMeasure, maxLines: NameLineCount = 3, breaks?: BreakList): NameRun[][] {
	const r: NameRoom = typeof room === 'number' ? { full: room, last: room, only: room } : room;
	// Words end at a space only (as `nameLines` did): another white space character, a no-break space for one, stays inside its word.
	const words = name.trim().split(/ +/).filter(Boolean);
	if (!words.length) return [[]];
	const toks: Tok[] = words.map((text) => ({ text, sob: false }));
	const sob = sobriquet?.trim().replace(/\s+/g, ' ');
	if (sob) toks.push({ text: `“${sob}”`, sob: true });

	const runsOf = (line: readonly Tok[]): NameRun[] => {
		const runs: NameRun[] = [];
		for (const t of line) {
			const last = runs[runs.length - 1];
			if (last && last.sob === t.sob) last.text += ` ${t.text}`;
			else {
				// The space between a bold part and a regular part belongs to the bold part.
				if (last) last.text += ' ';
				runs.push({ text: t.text, sob: t.sob });
			}
		}
		return runs;
	};
	const widthOf = (runs: readonly NameRun[]) => runs.reduce((a, run) => a + measure(run.text, run.sob), 0);
	/** How many tokens from the start of `list` fit on one text line of `room`; it stops at the first one that does not. */
	const grow = (list: readonly Tok[], width: number): number => {
		let j = 0;
		while (j < list.length && widthOf(runsOf(list.slice(0, j + 1))) <= width) j++;
		return j;
	};
	const dotted = (list: readonly Tok[]): NameRun[] => {
		const runs = runsOf(list);
		runs[runs.length - 1].text += '…';
		return runs;
	};

	/**
	 * Breaks the first token of a fresh text line at a hyphen (spec §13.19 rule 2): at its last own hyphen whose start fits, else
	 * at the last place of the first part that fits with a hyphen added (the first place if none fits). Undefined: no place.
	 */
	const breakToken = (tok: Tok, width: number): { head: Tok; rest: Tok } | undefined => {
		if (tok.sob) return undefined;
		const cps = Array.from(tok.text.normalize('NFC'));
		const cands = tok.cands ?? candidatesOf(cps, breaks);
		const prefix = (c: Cand) => cps.slice(0, c.at).join('') + (c.add ? '-' : '');
		const fitsAt = (list: readonly Cand[]) => (i: number) => measure(prefix(list[i]), false) <= width;
		const own = cands.filter((c) => !c.add);
		let pick: Cand | undefined;
		const o = lastFitting(own.length, fitsAt(own));
		if (o >= 0) pick = own[o];
		else {
			// The first part that does not fit is the text before the first own hyphen, or the whole word.
			const end = own.length ? own[0].at - 1 : cps.length;
			const places = cands.filter((c) => c.add && c.at < end);
			const s = lastFitting(places.length, fitsAt(places));
			pick = s >= 0 ? places[s] : places[0];
		}
		if (!pick) return undefined;
		const at = pick.at;
		const shifted = cands.filter((c) => c.at > at).map((c) => ({ at: c.at - at, add: c.add }));
		return { head: { text: prefix(pick), sob: false }, rest: { text: cps.slice(at).join(''), sob: false, cands: shifted } };
	};

	/** The names of the final text line, cut with "…": the longest run of whole tokens that fits with the "…", else a cut inside the first. */
	const cutNames = (names: readonly Tok[]): NameRun[] => {
		let best = 0;
		while (best < names.length && widthOf(dotted(names.slice(0, best + 1))) <= r.last) best++;
		if (best) return dotted(names.slice(0, best));
		// The first word fits only without the "…": when more words follow, shorten it so that the "…" shows what is missing.
		const first = runsOf(names.slice(0, 1));
		if (names.length === 1) return fitRuns(first, r.last, measure);
		return fitRuns([{ text: `${runsText(first)}…`, sob: false }], r.last, measure);
	};

	/** The final text line from the rest that did not fit the room `last` (rules C and D). */
	const finalLine = (rest: readonly Tok[]): NameRun[] => {
		const names = rest.filter((t) => !t.sob);
		if (names.length === rest.length) return cutNames(rest);
		// The sobriquet is the last token. Alone on its text line it is cut with "…" (rule C).
		if (!names.length) return fitRuns(runsOf(rest), r.last, measure);
		// Else it goes completely (D127): a "…" follows the last whole name word if it fits there, else nothing.
		if (grow(names, r.last) === names.length) return widthOf(dotted(names)) <= r.last ? dotted(names) : runsOf(names);
		return cutNames(names);
	};

	const lines: NameRun[][] = [];
	let rest: Tok[] = toks;
	for (;;) {
		const slot = lines.length + 1;
		if (slot === 1 && grow(rest, r.only) === rest.length) {
			lines.push(runsOf(rest));
			break;
		}
		if (grow(rest, r.last) === rest.length) {
			lines.push(runsOf(rest));
			break;
		}
		if (slot >= maxLines) {
			lines.push(finalLine(rest));
			break;
		}
		let j = grow(rest, r.full);
		if (j === rest.length) {
			// All of it fits `full` but not `last`: it may not end here, so the last token goes to the next text line.
			if (rest.length > 1) j = rest.length - 1;
			else {
				const broken = breakToken(rest[0], r.full);
				if (!broken) {
					lines.push(finalLine(rest));
					break;
				}
				lines.push([{ text: broken.head.text, sob: false }]);
				rest = [broken.rest];
				continue;
			}
		}
		if (j === 0) {
			// The first token alone is too wide for the text line: a hyphen, or a cut with "…" when it has no place (never inside the word).
			const broken = breakToken(rest[0], r.full);
			if (!broken) {
				if (rest[0].sob) {
					lines.push(finalLine(rest));
					break;
				}
				// A word that ends the name is the final text line, so it meets the room `last` (or `only`): arms box, portrait.
				const room = rest.length > 1 ? r.full : slot === 1 ? r.only : r.last;
				lines.push(fitRuns(runsOf(rest.slice(0, 1)), room, measure));
				rest = rest.slice(1);
			} else {
				lines.push(fitRuns([{ text: broken.head.text, sob: false }], r.full, measure));
				rest = [broken.rest, ...rest.slice(1)];
			}
			if (!rest.length) break;
			continue;
		}
		lines.push(runsOf(rest.slice(0, j)));
		rest = rest.slice(j);
	}
	return lines;
}
