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
import { graphemes, truncate } from './view-math';

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
		const chars = graphemes(rest);
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
	const chars = runs.flatMap((r) => graphemes(r.text).map((ch) => ({ ch, sob: r.sob })));
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

/** The bidi controls (Unicode UAX #9): the isolates (left to right, right to left, first strong), the end of an isolate, and the two direction marks. */
const BIDI_LRI = '\u2066';
const BIDI_RLI = '\u2067';
const BIDI_FSI = '\u2068';
const BIDI_PDI = '\u2069';
const BIDI_LRM = '\u200e';
const BIDI_RLM = '\u200f';

/** A letter of a script that is written from right to left (Hebrew, Arabic, Syriac, Thaana and the others, with the presentation forms). */
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1efff}]/u;

/**
 * The release plan T10, fault RTL-1: whether a name needs the bidi isolate. An SVG text has the base direction of the page (left to right), so the closing curly mark of
 * a sobriquet after an Arabic or Hebrew name would stand at the far right. The isolate gives the name its own direction and leaves `direction` and `text-anchor`
 * alone, so the place of the line on the card does not change. A name with no right-to-left letter has none, and draws as before.
 */
const needsBidiIsolate = (text: string): boolean => RTL_LETTER.test(text);

type Dir = 'L' | 'R';
/** How a character counts here: a strong letter, a number, a combining mark (it goes with its letter), or neutral. */
type BidiKind = Dir | 'num' | 'mark' | 'neutral';

const bidiKind = (ch: string): BidiKind => {
	if (/\p{M}/u.test(ch)) return 'mark';
	if (/\p{N}/u.test(ch)) return 'num';
	if (!/\p{L}/u.test(ch)) return 'neutral';
	return RTL_LETTER.test(ch) ? 'R' : 'L';
};

/** The paired brackets of the bidi algorithm (BidiBrackets.txt), the ones a name can hold: opening to closing. */
const BRACKET_CLOSE: Readonly<Record<string, string>> = {
	'(': ')', '[': ']', '{': '}', '（': '）', '［': '］', '｛': '｝', '⟨': '⟩', '⟦': '⟧',
	'〈': '〉', '《': '》', '「': '」', '『': '』', '【': '】', '〔': '〕', '〖': '〗', '〘': '〙', '〚': '〛',
};
const BRACKET_CLOSERS = new Set(Object.values(BRACKET_CLOSE));
/** BD16: the bidi algorithm stops pairing brackets when 63 openings are open. */
const BRACKET_DEPTH = 63;

const openOf = (d: Dir) => (d === 'R' ? BIDI_RLI : BIDI_LRI);
const markOf = (d: Dir | undefined) => (d === 'R' ? BIDI_RLM : d === 'L' ? BIDI_LRM : '');

/** A split bracket pair that is not inside another: from its opening bracket to its closing one (code point indices) and its direction. */
interface Phrase {
	open: number;
	close: number;
	dir: Dir;
}

/** A wrapped name as one list of code points, so that brackets pair and directions resolve across the breaks. */
interface WrappedName {
	cps: { ch: string; line: number; kind: BidiKind }[];
	/** The index of the first code point of each line, and the count at the end. */
	lineStart: number[];
	/** The direction of the whole name: its first strong letter. */
	base: Dir;
	phrases: Phrase[];
	/** The phrase that holds each code point (its brackets included), -1 for none. */
	phraseOf: number[];
	/** Brackets of a split pair inside a phrase, with the direction the whole name gives them. */
	forced: Map<number, Dir>;
}

/** The first strong letter in `[from, to)`. */
function firstStrong(n: Pick<WrappedName, 'cps'>, from: number, to: number): Dir | undefined {
	for (let i = from; i < to; i++) {
		const k = n.cps[i].kind;
		if (k === 'L' || k === 'R') return k;
	}
	return undefined;
}

/** The direction code point i has for a bracket pair (UAX #9 N0 after W2 and W7): a letter by its script; a digit as the letter before it, or right to left. */
function pairDir(n: Pick<WrappedName, 'cps' | 'base'>, i: number): Dir | undefined {
	const k = n.cps[i].kind;
	if (k === 'L' || k === 'R') return k;
	if (k !== 'num') return undefined;
	if (/[\u0660-\u0669\u06f0-\u06f9]/u.test(n.cps[i].ch)) return 'R';
	return firstStrongBefore(n, i) === 'L' ? 'L' : 'R';
}

/** The last strong letter before code point i, else the direction of the name (W7 looks back to the start). A name has at most three short lines, so the walk is short. */
function firstStrongBefore(n: Pick<WrappedName, 'cps' | 'base'>, i: number): Dir {
	for (let k = i - 1; k >= 0; k--) {
		const d = n.cps[k].kind;
		if (d === 'L' || d === 'R') return d;
	}
	return n.base;
}

/** BD16 bracket pairs over the whole name that a break splits, by their opening bracket. */
function splitPairs(n: Pick<WrappedName, 'cps'>): [number, number][] {
	const out: [number, number][] = [];
	const stack: { at: number; close: string }[] = [];
	for (let i = 0; i < n.cps.length; i++) {
		const ch = n.cps[i].ch;
		const close = BRACKET_CLOSE[ch];
		if (close) {
			if (stack.length === BRACKET_DEPTH) break;
			stack.push({ at: i, close });
		} else if (BRACKET_CLOSERS.has(ch)) {
			for (let k = stack.length - 1; k >= 0; k--) {
				if (stack[k].close !== ch) continue;
				if (n.cps[stack[k].at].line !== n.cps[i].line) out.push([stack[k].at, i]);
				stack.length = k;
				break;
			}
		}
	}
	return out.sort((a, b) => a[0] - b[0]);
}

/**
 * UAX #9 N0 for the pair `(o, c)` in the embedding direction `e`: `e` when the pair holds a letter or number of that direction; else, when it holds the other
 * direction, that direction if the strong letter before the pair (from `from` on, else `e`) has it too; else undefined (the pair holds no strong letter).
 */
function bracketDir(n: WrappedName, o: number, c: number, e: Dir, from: number): Dir | undefined {
	let opposite = false;
	for (let i = o + 1; i < c; i++) {
		const d = pairDir(n, i);
		if (d === e) return e;
		if (d) opposite = true;
	}
	if (!opposite) return undefined;
	for (let i = o - 1; i >= from; i--) {
		const d = n.forced.get(i) ?? pairDir(n, i);
		if (d) return d;
	}
	return e;
}

/** The direction of a phrase: the name's when the phrase holds a letter or number of that direction, else that of the first it holds, else the name's. */
function phraseDir(n: WrappedName, o: number, c: number): Dir {
	let other: Dir | undefined;
	for (let i = o + 1; i < c; i++) {
		const d = pairDir(n, i);
		if (d === n.base) return n.base;
		other ??= d;
	}
	return other ?? n.base;
}

/**
 * The phrases and forced brackets. An outermost split pair is a phrase, in the direction of the text round it when it holds a letter of that direction (then the
 * isolate changes nothing on one line), else of the letters it holds. A split pair inside a phrase keeps the direction that the whole name gives its brackets (N0):
 * a mark of that direction on both sides of each bracket acts as the resolved bracket does. A second isolate there would hide its letters from the phrase and change
 * the one-line name.
 */
function findPhrases(n: WrappedName): void {
	for (const [o, c] of splitPairs(n)) {
		const ph = n.phraseOf[o];
		if (ph < 0) {
			n.phrases.push({ open: o, close: c, dir: phraseDir(n, o, c) });
			n.phraseOf.fill(n.phrases.length - 1, o, c + 1);
			continue;
		}
		const d = bracketDir(n, o, c, n.phrases[ph].dir, n.phrases[ph].open + 1);
		if (d) {
			n.forced.set(o, d);
			n.forced.set(c, d);
		}
	}
}

const dirOf = (n: WrappedName, s: number): Dir => (s < 0 ? n.base : n.phrases[s].dir);
/** The phrase that a break after code point i falls inside, or -1. */
const phraseAcross = (n: WrappedName, i: number): number => (i >= 0 && n.phraseOf[i] >= 0 && n.phrases[n.phraseOf[i]].close !== i ? n.phraseOf[i] : -1);

/**
 * The strong letter next to an edge, walking from `from` by `step` in the scope `s` (-1 is the name, else a phrase; a phrase inside the name counts as neutral, as
 * an isolate does). Reaching `limit` gives undefined (no answer on this line), leaving the scope gives its direction, and a number stops the rule. `neutral` says
 * whether a neutral character lies between.
 */
function edgeWalk(n: WrappedName, from: number, step: 1 | -1, s: number, limit: number): { dir: Dir | undefined; neutral: boolean } {
	let neutral = false;
	for (let i = from; i !== limit; i += step) {
		if (i < 0 || i >= n.cps.length) return { dir: dirOf(n, s), neutral };
		if (n.phraseOf[i] !== s) {
			if (s >= 0) return { dir: dirOf(n, s), neutral };
			neutral = true;
			continue;
		}
		const f = n.forced.get(i);
		if (f) return { dir: f, neutral };
		const k = n.cps[i].kind;
		if (k === 'num') return { dir: undefined, neutral };
		if (k === 'neutral') neutral = true;
		else if (k !== 'mark') return { dir: k, neutral };
	}
	return { dir: undefined, neutral };
}

/**
 * The direction marks at the edges of the lines, by line and scope (-1 the name, else a phrase). UAX #9 resolves a neutral run from the letters on both sides of
 * it in the whole name; on its own line the far side is the edge of the line, which has the scope's direction. They differ only when both sides are letters of the
 * other direction; then a mark at the edge gives the run the direction of the whole name. The name and a phrase open across the break are checked each, because
 * the phrase is a neutral of the name.
 */
function edgeMarks(n: WrappedName): { lead: Map<number, Dir>[]; trail: Map<number, Dir>[] } {
	const lines = n.lineStart.length - 1;
	const lead = Array.from({ length: lines }, () => new Map<number, Dir>());
	const trail = Array.from({ length: lines }, () => new Map<number, Dir>());
	const same = (a: Dir | undefined, b: Dir | undefined, s: number) => (a && a === b && a !== dirOf(n, s) ? a : undefined);
	for (let line = 0; line + 1 < lines; line++) {
		const end = n.lineStart[line + 1] - 1;
		const next = n.lineStart[line + 1];
		if (end < n.lineStart[line] || next >= n.lineStart[line + 2]) continue;
		const across = phraseAcross(n, end);
		for (const s of across >= 0 ? [-1, across] : [-1]) {
			const back = edgeWalk(n, end, -1, s, n.lineStart[line] - 1);
			const t = back.neutral ? same(back.dir, edgeWalk(n, next, 1, s, -2).dir, s) : undefined;
			if (t) trail[line].set(s, t);
			const after = edgeWalk(n, next, 1, s, n.lineStart[line + 2]);
			const l = after.neutral ? same(after.dir, edgeWalk(n, end, -1, s, -2).dir, s) : undefined;
			if (l) lead[line + 1].set(s, l);
		}
	}
	return { lead, trail };
}

/** One text line of a wrapped name with its controls: the isolate of the name, a phrase carried from the line before, the phrases, forced brackets and marks. */
function drawLine(n: WrappedName, runs: readonly NameRun[], line: number, lead: Map<number, Dir>, trail: Map<number, Dir>): readonly NameRun[] {
	if (n.lineStart[line] === n.lineStart[line + 1]) return runs;
	let at = n.lineStart[line];
	const carried = phraseAcross(n, at - 1);
	const last = runs.length - 1;
	return runs.map((r, ri) => {
		let text = '';
		if (ri === 0) {
			text = openOf(n.base) + markOf(lead.get(-1));
			if (carried >= 0) text += openOf(n.phrases[carried].dir) + markOf(lead.get(carried));
		}
		for (const ch of r.text) {
			const ph = n.phraseOf[at];
			if (ph >= 0 && n.phrases[ph].open === at) text += openOf(n.phrases[ph].dir);
			const f = markOf(n.forced.get(at));
			text += f + ch + f;
			if (ph >= 0 && n.phrases[ph].close === at) text += BIDI_PDI;
			at++;
		}
		if (ri === last) {
			const open = phraseAcross(n, at - 1);
			if (open >= 0) text += markOf(trail.get(open)) + BIDI_PDI;
			text += markOf(trail.get(-1)) + BIDI_PDI;
		}
		return { ...r, text };
	});
}

/**
 * The text lines of a name with the bidi controls that make each line read as the same name on one line would, split at the break (the release plan T10, fault RTL-1, and
 * the G5 fault 5 of 0.4). A name with no right-to-left letter comes back as the same list. A name on one text line is one first-strong isolate, as before. A wrapped
 * name: every line is an isolate in the direction of the whole name (its first strong letter), not of its own first letter, so "II)" after an Arabic line stays in
 * the order of the name; a bracket pair that the break splits is a phrase (`findPhrases`), so each line shows its piece of the one-line phrase with the same bracket
 * glyph ("(Nur al-Din" then "II)"); and a neutral at the break gets a mark when the whole name gives it the other direction (`edgeMarks`: a hyphen added inside a
 * Latin word in an Arabic name, for one). Both the live card and the saved picture draw the result, so they show the same text. The controls have no width, so the
 * line breaks do not change.
 */
export function isolateLines(lines: readonly (readonly NameRun[])[]): readonly (readonly NameRun[])[] {
	if (!lines.some((runs) => needsBidiIsolate(runsText(runs)))) return lines;
	if (lines.length === 1) {
		const last = lines[0].length - 1;
		return [lines[0].map((r, i) => ({ ...r, text: (i === 0 ? BIDI_FSI : '') + r.text + (i === last ? BIDI_PDI : '') }))];
	}
	const n: WrappedName = { cps: [], lineStart: [], base: 'L', phrases: [], phraseOf: [], forced: new Map() };
	lines.forEach((runs, line) => {
		n.lineStart.push(n.cps.length);
		for (const r of runs) for (const ch of r.text) n.cps.push({ ch, line, kind: bidiKind(ch) });
	});
	n.lineStart.push(n.cps.length);
	n.base = firstStrong(n, 0, n.cps.length) ?? 'L';
	n.phraseOf = new Array<number>(n.cps.length).fill(-1);
	findPhrases(n);
	const { lead, trail } = edgeMarks(n);
	return lines.map((runs, line) => drawLine(n, runs, line, lead[line], trail[line]));
}

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
	const cutNames = (names: readonly Tok[], lastW: number): NameRun[] => {
		let best = 0;
		while (best < names.length && widthOf(dotted(names.slice(0, best + 1))) <= lastW) best++;
		if (best) return dotted(names.slice(0, best));
		// The first word fits only without the "…": when more words follow, shorten it so that the "…" shows what is missing.
		const first = runsOf(names.slice(0, 1));
		if (names.length === 1) return fitRuns(first, lastW, measure);
		return fitRuns([{ text: `${runsText(first)}…`, sob: false }], lastW, measure);
	};

	/** The final text line from the rest that did not fit the room `last` (rules C and D). */
	const finalLine = (rest: readonly Tok[], lastW: number): NameRun[] => {
		const names = rest.filter((t) => !t.sob);
		if (names.length === rest.length) return cutNames(rest, lastW);
		// The sobriquet is the last token. Alone on its text line it is cut with "…" (rule C).
		if (!names.length) return fitRuns(runsOf(rest), lastW, measure);
		// Else it goes completely (D127): a "…" follows the last whole name word if it fits there, else nothing.
		if (grow(names, lastW) === names.length) return widthOf(dotted(names)) <= lastW ? dotted(names) : runsOf(names);
		return cutNames(names, lastW);
	};

	const lines: NameRun[][] = [];
	let rest: Tok[] = toks;
	for (;;) {
		const slot = lines.length + 1;
		// F-LAYOUT-01: a name that stays on the first text line has the room `only`; the room `last` is for a final text line after the first.
		const lastW = slot === 1 ? r.only : r.last;
		if (grow(rest, lastW) === rest.length) {
			lines.push(runsOf(rest));
			break;
		}
		if (slot >= maxLines) {
			lines.push(finalLine(rest, lastW));
			break;
		}
		let j = grow(rest, r.full);
		if (j === rest.length) {
			// All of it fits `full` but not `last`: it may not end here, so the last token goes to the next text line.
			if (rest.length > 1) j = rest.length - 1;
			else {
				const broken = breakToken(rest[0], r.full);
				if (!broken) {
					lines.push(finalLine(rest, lastW));
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
					lines.push(finalLine(rest, lastW));
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
