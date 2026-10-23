/**
 * A small reference of the Unicode bidirectional algorithm (UAX #9, rules P2-P3, X1-X10 for isolates, W1-W7, N0-N2, I1-I2, L1, L2 and L4) for the tests of the
 * name text lines. It knows the character classes that names use (Latin, Greek, Hebrew, Arabic, digits, spaces, brackets and common punctuation) and the isolate
 * and mark controls; it has no embeddings or overrides, because the plugin writes none. It is written from the text of UAX #9, not from the plugin's code, so a
 * test can compare what a browser shows with what the plugin means to show. `visualLines` resolves the levels over the whole text and reorders each line on its
 * own, which is what UAX #9 does for a paragraph that wraps.
 */

type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM' | 'WS' | 'ON' | 'LRI' | 'RLI' | 'FSI' | 'PDI';

const CONTROLS = /[\u2066-\u2069\u200e\u200f\u061c]/gu;

/** The bidi class of one code point (UnicodeData.txt, for the ranges a name uses). */
export function bidiClass(ch: string): BidiClass {
	const cp = ch.codePointAt(0)!;
	if (cp === 0x2066) return 'LRI';
	if (cp === 0x2067) return 'RLI';
	if (cp === 0x2068) return 'FSI';
	if (cp === 0x2069) return 'PDI';
	if (cp === 0x200e) return 'L';
	if (cp === 0x200f) return 'R';
	if (cp === 0x061c) return 'AL';
	if (/\p{M}/u.test(ch)) return 'NSM';
	if ((cp >= 0x0660 && cp <= 0x0669) || cp === 0x066b || cp === 0x066c) return 'AN';
	if (cp >= 0x06f0 && cp <= 0x06f9) return 'EN';
	if (cp >= 0x30 && cp <= 0x39) return 'EN';
	if (cp === 0x060c) return 'CS';
	if ((cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0x07c0 && cp <= 0x085f) || (cp >= 0xfb1d && cp <= 0xfb4f)) return 'R';
	if ((cp >= 0x0600 && cp <= 0x07bf) || (cp >= 0x0860 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return 'AL';
	if (/\p{L}/u.test(ch)) return 'L';
	if (ch === ' ') return 'WS';
	if (ch === '+' || ch === '-' || cp === 0x2212) return 'ES';
	if ('#$%°¢£¥€'.includes(ch)) return 'ET';
	if (',.:/\u00a0'.includes(ch)) return 'CS';
	return 'ON';
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}', '⟨': '⟩', '⟦': '⟧', '《': '》', '「': '」', '『': '』', '【': '】', '〔': '〕' };
const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));
/** BidiMirroring.txt for the characters above, both ways, and a few more. */
const MIRROR: Record<string, string> = { '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };
for (const [o, c] of Object.entries(OPEN_TO_CLOSE)) {
	MIRROR[o] = c;
	MIRROR[c] = o;
}

const isIsolateControl = (t: BidiClass) => t === 'LRI' || t === 'RLI' || t === 'FSI' || t === 'PDI';
const isInitiator = (t: BidiClass) => t === 'LRI' || t === 'RLI' || t === 'FSI';
const isNI = (t: BidiClass) => t === 'WS' || t === 'ON' || isIsolateControl(t);
/** The direction a class has for N0 and N1: numbers count as right to left. */
const strongOf = (t: BidiClass): 'L' | 'R' | undefined => (t === 'L' ? 'L' : t === 'R' || t === 'AL' || t === 'EN' || t === 'AN' ? 'R' : undefined);

interface Resolved {
	chars: string[];
	classes: BidiClass[];
	levels: number[];
	para: number;
}

/** Resolves the embedding level of every code point of one paragraph. `para` is 0 (left to right), 1 (right to left) or 'auto' (P2, P3). */
export function resolve(text: string, para: 0 | 1 | 'auto' = 0): Resolved {
	const chars = Array.from(text);
	const n = chars.length;
	const classes = chars.map(bidiClass);

	// BD9: the matching PDI of every isolate initiator.
	const match = new Array<number>(n).fill(-1);
	const opened: number[] = [];
	for (let i = 0; i < n; i++) {
		if (isInitiator(classes[i])) opened.push(i);
		else if (classes[i] === 'PDI' && opened.length) match[opened.pop()!] = i;
	}
	const firstStrong = (from: number, to: number): 0 | 1 | undefined => {
		for (let i = from; i < to; i++) {
			const t = classes[i];
			if (t === 'L') return 0;
			if (t === 'R' || t === 'AL') return 1;
			if (isInitiator(t)) {
				if (match[i] < 0) return undefined;
				i = match[i];
			}
		}
		return undefined;
	};
	const level0 = para === 'auto' ? firstStrong(0, n) ?? 0 : para;

	// X1-X8 for isolates.
	const levels = new Array<number>(n).fill(level0);
	const stack: { level: number; isolate: boolean }[] = [{ level: level0, isolate: false }];
	let overflow = 0;
	let valid = 0;
	for (let i = 0; i < n; i++) {
		const t = classes[i];
		const top = stack[stack.length - 1];
		if (isInitiator(t)) {
			levels[i] = top.level;
			const rtl = t === 'RLI' || (t === 'FSI' && firstStrong(i + 1, match[i] < 0 ? n : match[i]) === 1);
			const next = rtl ? (top.level + 1) | 1 : (top.level + 2) & ~1;
			if (next <= 125 && overflow === 0) {
				valid++;
				stack.push({ level: next, isolate: true });
			} else overflow++;
		} else if (t === 'PDI') {
			if (overflow > 0) overflow--;
			else if (valid > 0) {
				while (!stack[stack.length - 1].isolate) stack.pop();
				stack.pop();
				valid--;
			}
			levels[i] = stack[stack.length - 1].level;
		} else levels[i] = top.level;
	}

	// X10: level runs, then isolating run sequences.
	const runs: [number, number][] = [];
	for (let i = 0; i < n; ) {
		let j = i;
		while (j + 1 < n && levels[j + 1] === levels[i]) j++;
		runs.push([i, j]);
		i = j + 1;
	}
	const runOf = new Array<number>(n);
	runs.forEach(([a, b], r) => {
		for (let i = a; i <= b; i++) runOf[i] = r;
	});
	const matchedPdi = new Set(match.filter((m) => m >= 0));
	const sequences: number[][] = [];
	for (const [a, b] of runs) {
		if (matchedPdi.has(a)) continue;
		const seq: number[] = [];
		let [x, y] = [a, b];
		for (;;) {
			for (let i = x; i <= y; i++) seq.push(i);
			if (!isInitiator(classes[y]) || match[y] < 0) break;
			[x, y] = runs[runOf[match[y]]];
		}
		sequences.push(seq);
	}

	const types = [...classes];
	for (const seq of sequences) {
		const first = seq[0];
		const last = seq[seq.length - 1];
		const level = levels[first];
		const e: 'L' | 'R' = level % 2 ? 'R' : 'L';
		const before = first > 0 ? levels[first - 1] : level0;
		const after = last + 1 < n && !(isInitiator(classes[last]) && match[last] < 0) ? levels[last + 1] : level0;
		const sos: 'L' | 'R' = Math.max(level, before) % 2 ? 'R' : 'L';
		const eos: 'L' | 'R' = Math.max(level, isInitiator(classes[last]) && match[last] < 0 ? level0 : after) % 2 ? 'R' : 'L';
		const ts = seq.map((i) => types[i]);
		const len = ts.length;
		// W1
		for (let k = 0; k < len; k++) if (ts[k] === 'NSM') ts[k] = k === 0 ? sos : isIsolateControl(ts[k - 1]) ? 'ON' : ts[k - 1];
		// W2, W3
		for (let k = 0; k < len; k++) {
			if (ts[k] !== 'EN') continue;
			for (let j = k - 1; j >= 0; j--) {
				if (ts[j] === 'AL') ts[k] = 'AN';
				if (ts[j] === 'L' || ts[j] === 'R' || ts[j] === 'AL') break;
			}
		}
		for (let k = 0; k < len; k++) if (ts[k] === 'AL') ts[k] = 'R';
		// W4
		for (let k = 1; k + 1 < len; k++) {
			if (ts[k] === 'ES' && ts[k - 1] === 'EN' && ts[k + 1] === 'EN') ts[k] = 'EN';
			else if (ts[k] === 'CS' && ts[k - 1] === ts[k + 1] && (ts[k - 1] === 'EN' || ts[k - 1] === 'AN')) ts[k] = ts[k - 1];
		}
		// W5
		for (let k = 0; k < len; k++) {
			if (ts[k] !== 'ET') continue;
			let j = k;
			while (j < len && ts[j] === 'ET') j++;
			if ((k > 0 && ts[k - 1] === 'EN') || (j < len && ts[j] === 'EN')) for (let m = k; m < j; m++) ts[m] = 'EN';
			k = j - 1;
		}
		// W6
		for (let k = 0; k < len; k++) if (ts[k] === 'ES' || ts[k] === 'ET' || ts[k] === 'CS') ts[k] = 'ON';
		// W7
		for (let k = 0; k < len; k++) {
			if (ts[k] !== 'EN') continue;
			let s: 'L' | 'R' = sos;
			for (let j = k - 1; j >= 0; j--) {
				if (ts[j] === 'L' || ts[j] === 'R') {
					s = ts[j] as 'L' | 'R';
					break;
				}
			}
			if (s === 'L') ts[k] = 'L';
		}
		// N0: BD16 pairs, in the order of their opening brackets.
		const pairs: [number, number][] = [];
		const open: { k: number; close: string }[] = [];
		for (let k = 0; k < len; k++) {
			const ch = chars[seq[k]];
			if (ts[k] !== 'ON') continue;
			if (OPEN_TO_CLOSE[ch]) {
				if (open.length === 63) break;
				open.push({ k, close: OPEN_TO_CLOSE[ch] });
			} else if (CLOSERS.has(ch)) {
				for (let m = open.length - 1; m >= 0; m--) {
					if (open[m].close !== ch) continue;
					pairs.push([open[m].k, k]);
					open.length = m;
					break;
				}
			}
		}
		pairs.sort((p, q) => p[0] - q[0]);
		for (const [o, c] of pairs) {
			let sameE = false;
			let opposite = false;
			for (let k = o + 1; k < c; k++) {
				const s = strongOf(ts[k]);
				if (s === e) sameE = true;
				else if (s) opposite = true;
			}
			let dir: 'L' | 'R' | undefined;
			if (sameE) dir = e;
			else if (opposite) {
				let ctx: 'L' | 'R' = sos;
				for (let k = o - 1; k >= 0; k--) {
					const s = strongOf(ts[k]);
					if (s) {
						ctx = s;
						break;
					}
				}
				dir = ctx !== e ? ctx : e;
			}
			if (dir) ts[o] = ts[c] = dir;
		}
		// N1, N2
		for (let k = 0; k < len; k++) {
			if (!isNI(ts[k])) continue;
			let j = k;
			while (j < len && isNI(ts[j])) j++;
			const lead = k > 0 ? strongOf(ts[k - 1]) : sos;
			const trail = j < len ? strongOf(ts[j]) : eos;
			const dir = lead && lead === trail ? lead : e;
			for (let m = k; m < j; m++) ts[m] = dir;
			k = j - 1;
		}
		// I1, I2
		seq.forEach((i, k) => {
			const t = ts[k];
			types[i] = t;
			if (level % 2 === 0) levels[i] = t === 'R' ? level + 1 : t === 'AN' || t === 'EN' ? level + 2 : level;
			else levels[i] = t === 'L' || t === 'EN' || t === 'AN' ? level + 1 : level;
		});
	}
	return { chars, classes, levels, para: level0 };
}

/** L1, L2, L4 for the code points `from` to `to` (exclusive) of a resolved paragraph: the visual order, left to right, with the controls taken out. */
function reorder(r: Resolved, from: number, to: number): string {
	const idx: number[] = [];
	for (let i = from; i < to; i++) idx.push(i);
	const lv = idx.map((i) => r.levels[i]);
	// L1: white space and isolate controls at the end of the line go to the paragraph level.
	for (let k = idx.length - 1; k >= 0 && (r.classes[idx[k]] === 'WS' || isIsolateControl(r.classes[idx[k]])); k--) lv[k] = r.para;
	const max = Math.max(0, ...lv);
	const lowestOdd = Math.min(...lv.map((l) => (l % 2 ? l : l + 1)));
	for (let level = max; level >= lowestOdd; level--) {
		for (let k = 0; k < idx.length; k++) {
			if (lv[k] < level) continue;
			let j = k;
			while (j < idx.length && lv[j] >= level) j++;
			idx.splice(k, j - k, ...idx.slice(k, j).reverse());
			lv.splice(k, j - k, ...lv.slice(k, j).reverse());
			k = j - 1;
		}
	}
	return idx
		.map((i, k) => (lv[k] % 2 && MIRROR[r.chars[i]] ? MIRROR[r.chars[i]] : r.chars[i]))
		.join('')
		.replace(CONTROLS, '');
}

/**
 * What a browser shows for `lines` when they are one paragraph that wraps after each item (UAX #9: levels from the whole paragraph, the order line by line).
 * The lines are joined with a space, as the break took one; the space is not shown. `para` is the paragraph direction (0 for an SVG text on a left-to-right page).
 */
export function visualLines(lines: readonly string[], para: 0 | 1 | 'auto' = 0): string[] {
	const r = resolve(lines.join(' '), para);
	const out: string[] = [];
	let at = 0;
	for (const line of lines) {
		const len = Array.from(line).length;
		out.push(reorder(r, at, at + len));
		at += len + 1;
	}
	return out;
}

/** What a browser shows for one paragraph on one line. */
export const visual = (text: string, para: 0 | 1 | 'auto' = 0): string => visualLines([text], para)[0];

/** The text with the bidi controls taken out. */
export const withoutControls = (text: string): string => text.replace(CONTROLS, '');
