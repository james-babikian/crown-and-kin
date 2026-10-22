// Test round of 0.2.8, target X2 (an internal note section 3), names: many scripts, joiners, zero-width marks, 2 000-character names and sobriquets in curly quotes.
// The answers come from the spec: §13.9 and §13.19 rule 2 (name lines), §5.2 (sobriquet), D100 (search folding), §6.8 (ids), §13.8 (saved picture), §8 (nothing throws).
// Seeds are fixed and printed on failure. R028_DEEP=1 runs more random names.
import { Resvg } from '@resvg/resvg-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { speedTest } from './support/speed-test';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { foldForMatch } from '../src/core/fold';
import { checkNewId, makeIdFromName, slugify, uniqueId } from '../src/core/id-gen';
import { parseDynasty } from '../src/core/parse';
import { normaliseSobriquet } from '../src/core/sobriquet';
import { applyOp } from '../src/core/yaml-edit';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import { buildScene } from '../src/render/dom/scene';
import { tallCardsFor } from '../src/render/dom/tall-cards';
import { cardNameLines, fitRuns, nameLines, runsText, syllableBreaks, titleLines, type NameRun } from '../src/render/name-lines';
import { savedLegend } from '../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { truncate } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { rng } from './r028-gen';

beforeAll(installDom);

const DEEP = process.env.R028_DEEP === '1';

/** Width of one code point in px: marks and joiners take none, wide scripts and emoji 14, the rest 7. Additive, so the oracle below can wrap greedily. */
function cpWidth(ch: string): number {
	if (/[\p{M}\u200b-\u200f\u2060︀-️\ufeff]/u.test(ch)) return 0;
	if (/[⺀-鿿가-힯＀-｠\u{1f300}-\u{1faff}]/u.test(ch)) return 14;
	return 7;
}
const measure = (s: string) => {
	let w = 0;
	for (const ch of s) w += cpWidth(ch);
	return w;
};

/** Names of the target list of an internal note section 3, X2. */
const NAMES: Record<string, string> = {
	arabic: 'محمد بن عبد الله الثالث 3',
	arabicDigits: 'عبد الرحمن 12 بن 2024',
	hebrew: 'דוד בן גוריון 1',
	chinese: '爱新觉罗玄烨康熙皇帝',
	chineseLong: '欧阳'.repeat(30),
	japanese: '徳川家康ひらがなカタカナ',
	devanagari: 'महाराणा प्रताप सिंह',
	thai: 'สมเด็จพระนเรศวรมหาราช',
	cyrillic: 'Иван Васильевич Грозный',
	greek: 'Αλέξανδρος ο Μέγας',
	decomposed: 'Zoë Müller Nguyễn',
	stackedMarks: 'a' + '́'.repeat(40),
	emojiJoiners: '👨\u200d👩\u200d👧\u200d👦 Family 🏳️\u200d🌈 🇳🇴🇸🇪',
	zeroWidth: 'Long\u200bName\u200bWith\u200bZero\u200bWidth\u200bJoined',
	onlyZeroWidth: '\u200b\u200b\u200b',
	a2000: 'A'.repeat(2000),
	words2000: 'Word '.repeat(400),
	cjk2000: '長'.repeat(2000),
	ownHyphens: 'Anne-Marie-Louise-Charlotte-Josephine',
	longWord: 'Supercalifragilisticexpialidocious',
	spaces: 'Roderick   Valmont',
	short: 'Al',
	one: 'X',
	plain: 'Roderick Valmont',
	rtlMarks: '‫עברית‬ Latin \u200fمرحبا\u200e',
	tags: '<b>Bold</b> & "quoted" \'single\'',
};

/** A seeded name from several scripts, 1 to 120 code points. */
function randomName(seed: number): string {
	const rand = rng(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
	const SETS = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'àéîõüçñøæþðłšž', 'абвгдежзийклмнопрстуфхцчшщъыьэюя', 'αβγδεζηθικλμνξοπρστυφχψω', '长安东西南北王李张刘陈', 'ひらがなカタカナ', 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي', 'אבגדהוזחטיכלמנסעפצקרשת', 'กขคงจฉชซญดตทนบปผพมยรลวศสหอ', '👨👩👧🏳️🇳🇴😀', '̣́̈\u200d\u200b็ً'];
	let out = '';
	const words = 1 + Math.floor(rand() * 8);
	for (let w = 0; w < words; w++) {
		const set = Array.from(pick(SETS));
		const len = 1 + Math.floor(rand() * 15);
		let word = '';
		for (let i = 0; i < len; i++) word += pick(set);
		if (rand() < 0.15) word += '-' + pick(set);
		out += (out ? pick([' ', ' ', ' ', '  ']) : '') + word;
	}
	return out;
}

const RANDOM_COUNT = DEEP ? 3000 : 500;
const RANDOM_NAMES = Array.from({ length: RANDOM_COUNT }, (_, i) => ({ seed: 9000 + i, name: randomName(9000 + i) }));
const ALL = [...Object.entries(NAMES).map(([label, name]) => ({ label, name })), ...RANDOM_NAMES.map((r) => ({ label: `random seed ${r.seed}`, name: r.name }))];
/** Widths of a text line in px of this test's measure (7 px a letter, a name letter of the real card is about 7 px). A card gives its name 8.2 to 11.8 em, about 115 to 165 px; 20 and 60 px are only for the test that nothing throws. */
const WIDTHS = [100, 150, 200, 400];

/** The strip of a text for comparison: NFC, and no spaces, hyphens or ellipsis. */
const strip = (s: string) => s.normalize('NFC').replace(/[ \-…]/g, '');

/** The number of text lines a greedy wrap at spaces needs, or undefined when one word is wider than the line (then hyphens or a cut are needed). */
function greedyLines(name: string, width: number): number | undefined {
	const words = name.trim().split(/ +/).filter(Boolean);
	if (words.some((w) => measure(w) > width)) return undefined;
	let lines = 1;
	let cur = '';
	for (const w of words) {
		const t = cur ? `${cur} ${w}` : w;
		if (measure(t) <= width) cur = t;
		else {
			lines++;
			cur = w;
		}
	}
	return lines;
}

/**
 * The rules of §13.9 and §13.19 rule 2 on the text lines of one name: (a) a break between two text lines falls at a space of the name or after a hyphen
 * (no name breaks inside a word without a hyphen); (b) the text lines are the name in order, so that only whole words are lost; (c) a text line that ends
 * with "…" and is not the last one is a single word that was cut; (d) if the end of the name is lost, the last text line ends with "…".
 */
function shapeProblems(name: string, lines: string[]): string[] {
	const bad: string[] = [];
	const nfc = name.normalize('NFC').trim();
	const chars = Array.from(nfc);
	let S = '';
	const wordStart = new Set<number>();
	let after = true;
	for (const ch of chars) {
		if (ch === ' ') {
			after = true;
			continue;
		}
		if (ch === '-') continue;
		if (after) wordStart.add(Array.from(S).length);
		after = false;
		S += ch;
	}
	const Sc = Array.from(S);
	let pos = 0;
	lines.forEach((line, i) => {
		const L = Array.from(strip(line));
		const last = i === lines.length - 1;
		if (Sc.slice(pos, pos + L.length).join('') !== L.join('')) {
			bad.push(`line ${i + 1} "${line}" is not the next part of the name`);
			pos = Sc.length;
			return;
		}
		pos += L.length;
		const norm = line.normalize('NFC');
		if (!last) {
			if (norm.endsWith('…')) {
				if (norm.includes(' ')) bad.push(`line ${i + 1} "${line}" ends with "…" but holds more than one word`);
				// The rest of the cut word is lost: go on at the next word.
				while (pos < Sc.length && !wordStart.has(pos)) pos++;
			} else if (!norm.endsWith('-') && !wordStart.has(pos) && pos < Sc.length) bad.push(`the name breaks inside a word after "${line}" with no hyphen`);
		}
	});
	const lost = pos < Sc.length;
	if (lost && lines.length && !lines[lines.length - 1].endsWith('…')) bad.push(`the end of the name is lost and the last text line "${lines[lines.length - 1]}" has no "…"`);
	return bad;
}

const wordLessCardLines = (name: string, width: number, max: 2 | 3): string[] => cardNameLines(name, undefined, width, (t) => measure(t), max).map(runsText);

describe('X2 (1, 2, 3): name lines for many scripts (spec §13.9, §13.19 rule 2)', () => {
	it('no function throws or loops for any name, width or line limit (widths from 0 to infinite)', () => {
		const problems: string[] = [];
		for (const { label, name } of ALL) {
			for (const width of [0, 1, 5, 20, 60, ...WIDTHS, 100000, Infinity]) {
				for (const max of [2, 3] as const) {
					try {
						nameLines(name, width, measure, max);
						titleLines(name, '(r. 1131–1160)', width, measure);
						cardNameLines(name, 'the Bold', width, (t) => measure(t), max);
						cardNameLines(name, undefined, { full: width, last: width / 2, only: width }, (t) => measure(t), max);
						truncate(name, width, measure);
						fitRuns([{ text: name, sob: false }], width, (t) => measure(t));
					} catch (e) {
						problems.push(`${label} width ${width} max ${max}: THROW ${(e as Error).message}`);
					}
				}
			}
			try {
				syllableBreaks(name.split(' ')[0]);
			} catch (e) {
				problems.push(`${label}: THROW in syllableBreaks ${(e as Error).message}`);
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('a name that fits on three (or two) text lines at its spaces is shown whole, with no "…" and no hyphen (D81, §13.9)', () => {
		const problems: string[] = [];
		let fitted = 0;
		for (const { label, name } of ALL) {
			for (const width of WIDTHS) {
				for (const max of [2, 3] as const) {
					const need = greedyLines(name, width);
					if (need === undefined || need > max) continue;
					fitted++;
					const want = name.trim().split(/ +/).filter(Boolean).join(' ');
					const flat = (lines: string[]) => lines.join(' ').replace(/ +/g, ' ').normalize('NFC');
					// `nameLines` keeps a double space inside a text line and measures it (T-X2-02); the card function collapses it. Only single spaces here.
					const a = nameLines(name.replace(/ {2,}/g, ' '), width, measure, max);
					const b = wordLessCardLines(name, width, max);
					if (flat(a) !== want.normalize('NFC')) problems.push(`nameLines ${label} width ${width} max ${max}: ${JSON.stringify(a)}`);
					if (flat(b) !== want.normalize('NFC')) problems.push(`cardNameLines ${label} width ${width} max ${max}: ${JSON.stringify(b)}`);
					if (b.length > need && need <= max) problems.push(`cardNameLines ${label} width ${width}: ${b.length} text lines where ${need} are enough`);
				}
			}
		}
		expect(fitted).toBeGreaterThan(500);
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('every name: at most the line limit, the lines are the name in order, no break inside a word without a hyphen, a lost end shows "…"', () => {
		const problems: string[] = [];
		for (const { label, name } of ALL) {
			for (const width of WIDTHS) {
				for (const max of [2, 3] as const) {
					const lines = wordLessCardLines(name, width, max);
					if (lines.length > max) problems.push(`${label} width ${width}: ${lines.length} text lines for a limit of ${max}`);
					for (const p of shapeProblems(name, lines)) problems.push(`cardNameLines ${label} width ${width} max ${max}: ${p} ${JSON.stringify(lines)}`);
					const old = nameLines(name, width, measure, max);
					if (old.length > max) problems.push(`nameLines ${label} width ${width}: ${old.length} text lines for a limit of ${max}`);
					if (old.length && !old.slice(0, -1).some((l) => l.endsWith('…'))) {
						const lost = strip(old.join(' ')) !== strip(name.trim());
						if (lost && !old[old.length - 1].endsWith('…')) problems.push(`nameLines ${label} width ${width} max ${max}: text lost with no "…": ${JSON.stringify(old)}`);
					}
				}
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('each text line fits the width (a width of 20 px or more is wider than the "…")', () => {
		const problems: string[] = [];
		for (const { label, name } of ALL) {
			for (const width of WIDTHS) {
				const lines = wordLessCardLines(name, width, 3);
				lines.forEach((l, i) => measure(l) > width + 0.01 && problems.push(`cardNameLines ${label} width ${width} line ${i + 1} "${l}" is ${measure(l)} px`));
				nameLines(name, width, measure, 3).forEach((l, i) => measure(l) > width + 0.01 && problems.push(`nameLines ${label} width ${width} line ${i + 1} "${l}" is ${measure(l)} px`));
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('the sobriquet is one part: whole on a text line, or cut with "…" when it is alone and too wide; no word of the name is dropped for it (D122, D127, D173)', () => {
		const problems: string[] = [];
		const sobs = ['the Bold', 'the Wise and Terrible, Lord of the Marches', '“quoted” inside', 'Ӂ', '長い二つ名', 'a'.repeat(80)];
		for (const { label, name } of ALL.slice(0, 120)) {
			for (const sob of sobs) {
				for (const width of [100, 150, 200]) {
					const runs: NameRun[][] = cardNameLines(name, sob, width, (t) => measure(t), 3);
					const sobRuns = runs.flat().filter((r) => r.sob);
					const full = `“${sob.replace(/\s+/g, ' ').trim()}”`;
					if (sobRuns.length > 1) problems.push(`${label} / "${sob}" width ${width}: the sobriquet is in ${sobRuns.length} pieces`);
					for (const r of sobRuns) if (r.text !== full && !(r.text.endsWith('…') && full.startsWith(r.text.slice(0, -1)))) problems.push(`${label} / "${sob}" width ${width}: the sobriquet shows as "${r.text}"`);
					// D127 1: if the name fits on three text lines alone, none of its words is dropped for the sobriquet.
					if (name.trim() && (greedyLines(name, width) ?? 99) <= 3) {
						const shown = runs.flat().filter((r) => !r.sob).map((r) => r.text).join(' ').replace(/…/g, '');
						const missing = name.trim().split(/ +/).filter((w) => !strip(shown).includes(strip(w)));
						if (missing.length) problems.push(`${label} / "${sob}" width ${width}: the words ${JSON.stringify(missing)} are dropped for the sobriquet`);
					}
				}
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('a person with no name text shows no sobriquet and one empty text line', () => {
		expect(cardNameLines('', 'the Bold', 100, (t) => measure(t))).toEqual([[]]);
		expect(cardNameLines('   ', 'the Bold', 100, (t) => measure(t))).toEqual([[]]);
	});
});

describe('X2 (4): the time of name lines grows about linearly with the length (finding L5; a ratio in one process)', () => {
	const shapes: Record<string, (n: number) => string> = {
		spaces: (n) => 'Word '.repeat(n / 5),
		noSpaces: (n) => 'A'.repeat(n),
		latin: (n) => 'Longnamunda'.repeat(n / 11),
		cjk: (n) => '長'.repeat(n),
		ownHyphens: (n) => 'ab-'.repeat(n / 3),
		zeroWidth: (n) => 'ab\u200b'.repeat(n / 3),
		emoji: (n) => '👨\u200d👩\u200d👧'.repeat(n / 8),
		oneLongWord: (n) => 'x'.repeat(10) + ' ' + 'y'.repeat(n),
	};
	const best = (f: () => void, runs = 5) => {
		let b = Infinity;
		for (let i = 0; i < runs; i++) {
			const t0 = performance.now();
			f();
			b = Math.min(b, performance.now() - t0);
		}
		return b;
	};
	const calls: Record<string, (s: string) => unknown> = {
		nameLines: (s) => nameLines(s, 150, (t) => approxMeasure(t, 'bold 13.6px serif'), 3),
		cardNameLines: (s) => cardNameLines(s, 'the Bold', 150, (t, sob) => approxMeasure(t, sob ? '13.6px serif' : 'bold 13.6px serif'), 3),
		titleLines: (s) => titleLines(s, '(r. 1)', 150, (t) => approxMeasure(t, '13.6px serif')),
	};

	for (const [shape, make] of Object.entries(shapes)) {
		speedTest(`${shape}: 20 000 characters take less than 40 times as long as 2 000 (linear is 10, the square is 100)`, () => {
			const ratios: string[] = [];
			for (const [fn, call] of Object.entries(calls)) {
				const small = make(2000);
				const big = make(20000);
				const a = best(() => call(small));
				const b = best(() => call(big));
				const ratio = b / Math.max(a, 0.05);
				ratios.push(`${fn} ${ratio.toFixed(1)}`);
				expect(ratio, `${shape} ${fn}: ${a.toFixed(2)} ms against ${b.toFixed(2)} ms`).toBeLessThan(40);
			}
			if (DEEP) console.log(`X2 (4) ${shape}: ratios ${ratios.join(', ')}`);
		});
	}
});

describe('X2 (5): the search folding finds a name by its form without accents (D100)', () => {
	const PAIRS: [string, string][] = [
		['Zoë Müller', 'zoe muller'],
		['Nguyễn Văn', 'nguyen van'],
		['Łukasz', 'lukasz'],
		['Þórr', 'thorr'],
		['Ægir', 'aegir'],
		['Søren', 'soren'],
		['Dvořák', 'dvorak'],
		['Gőbel', 'gobel'],
		['İstanbul', 'istanbul'],
		['Straße', 'strasse'],
		['Ångström', 'angstrom'],
		['Đorđe', 'dorde'],
		['Hồ Chí Minh', 'ho chi minh'],
		['Ștefan', 'stefan'],
		['François', 'francois'],
		['Çelik', 'celik'],
		['Œdipe', 'oedipe'],
		['Ħal', 'hal'],
		['Ёлка', 'елка'],
		['Zoë', 'zoe'],
		['O’Brien', "o'brien"],
		['“Bold”', '"bold"'],
		['Ａｌｄｒｉｃ', 'aldric'],
		['ﬃ', 'ffi'],
	];
	it('every accented name contains its hand-written plain form after folding', () => {
		const problems: string[] = [];
		for (const [name, plain] of PAIRS) if (!foldForMatch(name).includes(plain)) problems.push(`${JSON.stringify(name)} folds to ${JSON.stringify(foldForMatch(name))}, not ${JSON.stringify(plain)}`);
		expect(problems).toEqual([]);
	});

	it('the fold is the same for composed and decomposed forms, does not change when it is run again, and never throws (also for lone surrogates and joiners)', () => {
		const problems: string[] = [];
		for (const { label, name } of ALL) {
			const f = foldForMatch(name);
			if (foldForMatch(f) !== f) problems.push(`${label}: not stable`);
			if (foldForMatch(name.normalize('NFD')) !== foldForMatch(name.normalize('NFC'))) problems.push(`${label}: NFC and NFD fold differently`);
		}
		for (const odd of ['\ud800', 'a\udc00b', '\u200d', '�', '\u0000', 'á́́']) expect(() => foldForMatch(odd), JSON.stringify(odd)).not.toThrow();
		expect(problems.slice(0, 5)).toEqual([]);
	});
});

describe('X2 (6): ids made from names are never empty and never repeat (spec §6.8, D104, D188 item 24)', () => {
	it('uniqueId for every name, again and again, gives distinct non-empty ids that checkNewId accepts', () => {
		const taken = new Set<string>();
		const problems: string[] = [];
		for (const { label, name } of ALL) {
			for (let k = 0; k < 3; k++) {
				const id = uniqueId(name, taken);
				if (id === '') problems.push(`${label}: empty id`);
				if (taken.has(id)) problems.push(`${label}: id ${id} is taken`);
				if (checkNewId(id, new Set()) !== null) problems.push(`${label}: checkNewId refuses the made id ${JSON.stringify(id)}`);
				taken.add(id);
			}
		}
		expect(problems.slice(0, 5)).toEqual([]);
	});

	it('a made id for a house or title name is the same kind of id, and never one that a person already writes', () => {
		const taken = new Set(['person', 'person-2', 'title', 'title-2']);
		for (const { name } of ALL.slice(0, 80)) {
			for (const kind of ['house', 'title'] as const) {
				const id = makeIdFromName(kind, name, taken);
				expect(id).not.toBe('');
				expect(taken.has(id)).toBe(false);
			}
		}
	});

	it('add-house and add-person write distinct ids for names in other scripts', () => {
		let body = 'people:\n  - {id: p1, name: First}\n';
		const seen = new Set<string>();
		for (const { label, name } of ALL.slice(0, 40)) {
			const r = applyOp(body, { kind: 'add-house', name });
			expect(r.ok, label).toBe(true);
			if (!r.ok) continue;
			body = r.body;
			for (const id of r.created) {
				expect(id, label).not.toBe('');
				expect(seen.has(id), `${label}: ${id}`).toBe(false);
				seen.add(id);
			}
		}
		const parsed = parseDynasty(body);
		expect(parsed.ok && parsed.tree.houses.length).toBe(40);
	});

	it('I16: ids keep the letters of other writing systems (D188 item 24)', () => {
		expect(slugify('Иван Грозный')).not.toBe('person');
		expect(slugify('محمد')).not.toBe('person');
	});
});

describe('X2 (1): a name written by the editor reads back as it was (spec §3 "exact text", §6.2)', () => {
	const HARD_NAMES = ['plain', 'a: b', 'a #b', '# c', '- d', '[x]', '{x}', '&a', '*a', '!t', '|', '>', '%x', '@x', '`x', '"q"', "'s'", "it's", 'a\nb', 'a\u2028b', 'a\u0085b', 'yes', 'no', '~', 'null', '1e3', '0x10', '0042', '1_000', '.inf', '---', '...', 'a,b', 'ä', 'é', '👨\u200d👩\u200d👧', 'x\u200by', '\u0001ctl', 'a\\b', 'a\rb', '<b>&amp;</b>', ']]>', '? x', ': x', '-x', ...Object.values(NAMES).slice(0, 12)];
	it('set-person-fields name, sobriquet and title: the parsed text is the written text (outer white space is cut by the reader)', () => {
		const problems: string[] = [];
		for (const text of HARD_NAMES) {
			const base = 'people:\n  - {id: a, name: Alpha}\n';
			const r = applyOp(base, { kind: 'set-person-fields', id: 'a', fields: { name: text, title: text, notes: text } });
			if (!r.ok) {
				problems.push(`${JSON.stringify(text)}: refused ${r.code}`);
				continue;
			}
			const p = parseDynasty(r.body);
			if (!p.ok) {
				problems.push(`${JSON.stringify(text)}: the written body does not parse`);
				continue;
			}
			const person = p.tree.people[0];
			// A plain `~` or `null` is "nothing written", so the editor must quote it; the reader gives it back as text.
			for (const [key, got] of [['name', person.name], ['title', person.title], ['notes', person.notes]] as const) {
				if (got !== text.trim()) problems.push(`${key} ${JSON.stringify(text)} is read back as ${JSON.stringify(got)}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it('the sobriquet keeps its text; one pair of curly or straight double marks around it is cut off, nothing else', () => {
		expect(normaliseSobriquet('“the Wise”')).toBe('the Wise');
		expect(normaliseSobriquet('„the Wise“')).toBe('the Wise');
		expect(normaliseSobriquet('"the Wise"')).toBe('the Wise');
		expect(normaliseSobriquet('  the   Wise ')).toBe('the Wise');
		expect(normaliseSobriquet('‘the Wise’')).toBe('‘the Wise’');
		expect(normaliseSobriquet('“”')).toBeUndefined();
		expect(normaliseSobriquet('   ')).toBeUndefined();
		expect(normaliseSobriquet('the “Wise” one')).toBe('the “Wise” one');
		expect(normaliseSobriquet('“a” and “b”')).toBe('“a” and “b”');
	});
});

describe('X2 (7, 1): cards with these names through the layout and the saved picture (spec §13.8, §13.9)', () => {
	/** Tree text with one person for each name; sobriquet and title use the same text for some. */
	function treeOf(names: string[]): string {
		const q = (s: string) => JSON.stringify(s);
		const lines = names.map((n, i) => `  - {id: p${i}, name: ${q(n)}, sobriquet: ${q(i % 3 ? 'the Bold' : n.slice(0, 20))}, title: ${q(i % 4 ? 'Duke' : n.slice(0, 30))}${i ? `, parents: [p${Math.floor((i - 1) / 3)}]` : ''}}`);
		return `people:\n${lines.join('\n')}\n`;
	}
	const graphOf = (text: string): FamilyGraph => {
		const parsed = parseDynasty(text);
		if (!parsed.ok) throw new Error(`hard error ${parsed.error.code}`);
		return deriveFamilies(parsed.tree);
	};
	const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
	const XML_TAGS = new Set(['svg', 'rect', 'path', 'g', 'text', 'tspan', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'defs', 'clipPath', 'image', 'title', 'desc', 'use', 'pattern', 'linearGradient', 'stop', 'mask']);

	it('the tall cards, the layout and the SVG work for every name, and the SVG has only the tags the drawing makes (names are escaped)', () => {
		const names = [...Object.values(NAMES), ...RANDOM_NAMES.slice(0, 60).map((r) => r.name), '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '</text></svg><svg>', '&amp; &lt; &#60;', "'; DROP TABLE people; --"];
		const g = graphOf(treeOf(names));
		const geo = cardForm(geometryFor(16), 'down');
		const tall = tallCardsFor(g, geo, FONTS, approxMeasure, new Set());
		clearLayoutCache();
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall?.tall ?? [], longNames: tall?.long ?? [] }, 'sans-serif');
		expect(laid.layout.persons.size).toBe(names.length);
		for (const mode of ['plain', 'saved'] as const) {
			const svg = renderSvg(g, laid.layout, laid.edges, {
				palette: DEFAULT_LIGHT,
				dark: false,
				measure: approxMeasure,
				fonts: FONTS,
				...(mode === 'saved' ? { saved: { heading: 'Harrow <&> "heading" ]]>', legend: savedLegend(g, laid), pictures: new Map(), scale: 1.5 } } : {}),
			});
			expect(/NaN|Infinity|undefined/.test(svg), `${mode}: NaN, Infinity or undefined`).toBe(false);
			const tags = [...svg.matchAll(/<\/?([A-Za-z][\w:-]*)/g)].map((m) => m[1]);
			const odd = [...new Set(tags.filter((t) => !XML_TAGS.has(t)))];
			expect(odd, `${mode}: tags that a name made`).toEqual([]);
			expect(svg.includes('onerror=') && /<[^>]*onerror=/.test(svg), `${mode}: an event attribute in a tag`).toBe(false);
			// The hostile text appears only as escaped text.
			expect(svg.includes('<script'), `${mode}: raw <script`).toBe(false);
			expect(svg.includes('<img'), `${mode}: raw <img`).toBe(false);
			// Every control character that XML 1.0 forbids is gone.
			expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/.test(svg), `${mode}: a forbidden control character`).toBe(false);
			// A real XML reader accepts the file.
			expect(() => new Resvg(svg, { font: { loadSystemFonts: false } }), `${mode}: the SVG does not load`).not.toThrow();
		}
	});

	it('a card whose name needs three text lines is as tall as the layout says, and a longer name never makes the SVG text wider than the card (the text lines come from the same function)', () => {
		const names = ['Roderick Valmont', 'Roderick Valmont of the Seven Marches and the Northern Reaches', 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ...Array.from({ length: 30 }, (_, i) => RANDOM_NAMES[i].name)];
		const g = graphOf(treeOf(names));
		const geo = cardForm(geometryFor(16), 'down');
		const tall = tallCardsFor(g, geo, FONTS, approxMeasure, new Set());
		clearLayoutCache();
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall?.tall ?? [], longNames: tall?.long ?? [] }, 'sans-serif');
		const plain = laid.layout.persons.get('p0')!;
		for (const id of tall?.long ?? []) expect(laid.layout.persons.get(id)!.h, `${id} has three text lines`).toBeGreaterThanOrEqual(plain.h);
		for (const id of tall?.tall ?? []) expect(laid.layout.persons.get(id)!.tallName, `${id} is marked tall`).toBe(true);
		for (const id of tall?.long ?? []) expect(tall?.tall.includes(id), `${id}: long names are a subset of tall names`).toBe(true);
	});

	it('the live scene and the SVG show the same name text lines for every name (the text lines come from one function)', () => {
		const names = [...Object.values(NAMES).filter((n) => n.trim() && n !== NAMES.tags), ...RANDOM_NAMES.slice(0, 40).map((r) => r.name), 'A & B <C> "D"'];
		const g = graphOf(treeOf(names));
		const geo = cardForm(geometryFor(16), 'down');
		const tall = tallCardsFor(g, geo, FONTS, approxMeasure, new Set());
		clearLayoutCache();
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall?.tall ?? [], longNames: tall?.long ?? [] }, 'sans-serif');
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: approxMeasure, link: () => null });
		const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
		const svg = renderSvg(g, laid.layout, laid.edges, { measure: approxMeasure, fonts: FONTS });
		const esc = (t: string) => t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		// The runs of a name line (bold name, regular sobriquet) are separate pieces in the SVG; the text of the SVG without its tags joins them.
		const svgText = svg.replace(/<[^>]+>/g, '');
		const problems: string[] = [];
		let seen = 0;
		for (const p of g.people) {
			const card = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === p.id);
			if (!card) {
				problems.push(`no card element for ${p.id}`);
				continue;
			}
			for (const line of all(card).filter((e) => e.hasClass('dynasty-card-name')).map((e) => e.getText())) {
				seen++;
				if (line && !svgText.includes(esc(line))) problems.push(`${p.id}: the scene shows "${line}" and the SVG does not`);
			}
		}
		expect(seen).toBeGreaterThan(names.length);
		expect(problems.slice(0, 5)).toEqual([]);
	});
});
