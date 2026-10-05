import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../../src/layout/index';
import { cardText, geometryFor, namesOnlyGeometry, portraitBox, roomAt, sidewaysGeometry, tallExtra } from '../../src/layout/geometry';
import type { Geometry, LayoutSettings, PersonBox } from '../../src/layout/model';
import { buildScene, type Scene } from '../../src/render/dom/scene';
import { tallCardsFor } from '../../src/render/dom/tall-cards';
import { cardNameLines, nameLines, runsText, titleLines } from '../../src/render/name-lines';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl, installDom } from './fake-dom';
import { block15, comments15, graphOf } from './m10-support';

/*
 * Spec §13.9 (D81, D82), §5.2, §13.7 "Text beside the portrait" and the M10 name-line rules L1-L5:
 * three name text lines, "…" on the third, the counts (`tall`, `long`), the card heights, the cache
 * key, `cardText` with three name text lines, the SVG and the scene, and the name beside a portrait.
 * Sample tree 15 (block 2) gives the names, chosen by measurement with the headless measure
 * (`approxMeasure`, bold 13.6 px = 0.85 em, D117) with their expected text lines in its comments. These tests wait
 * for WP 10.2a. The D37 cases and `titleLines` (D61) must not change.
 */

beforeAll(installDom);

const three = nameLines;
/** `tallCardsFor` (0.2.4 signature: no `sideways`, no `hidden`) reduced to the two lists these tests read. */
type TallLists = { tall: string[]; long: string[] };
const tallFor = (...args: Parameters<typeof tallCardsFor>): TallLists | undefined => {
	const r = tallCardsFor(...args);
	return r && { tall: r.tall, long: r.long };
};
const textFor = cardText;
type Text3 = ReturnType<typeof cardText>;
type Settings = LayoutSettings;
type Box = PersonBox;

const ELLIPSIS = '…';
/** Every character 10 px wide, the ellipsis too. */
const mono = (text: string) => [...text].length * 10;
/** Narrow and wide letters, as in a proportional font. */
const WIDTHS: Record<string, number> = { i: 4, l: 4, j: 4, ' ': 5, W: 14, M: 14, m: 13, w: 13, [ELLIPSIS]: 12 };
const prop = (text: string) => [...text].reduce((s, c) => s + (WIDTHS[c] ?? 9), 0);

// ---------- A reference of the rules of L1, written from the spec text ----------

/** The longest start of `text` that fits `width` with "…" after it (the D37 rule for the last text line). */
function cut(text: string, width: number, m: (s: string) => number): string {
	if (m(text) <= width) return text;
	const chars = [...text];
	let n = chars.length - 1;
	while (n > 0 && m(chars.slice(0, n).join('').trimEnd() + ELLIPSIS) > width) n--;
	return chars.slice(0, n).join('').trimEnd() + ELLIPSIS;
}

/** L1: each text line but the last takes the longest start of the rest that ends at a space and fits; a word longer than the width breaks inside the word; the last takes the rest, cut with "…". */
function reference(name: string, width: number, m: (s: string) => number, maxLines: number): string[] {
	let rest = name.trim();
	const out: string[] = [];
	for (;;) {
		if (m(rest) <= width) return [...out, rest];
		if (out.length === maxLines - 1) return [...out, cut(rest, width, m)];
		const chars = [...rest];
		let at = -1;
		for (let i = chars.length - 1; i > 0; i--) {
			if (chars[i] !== ' ') continue;
			const first = chars.slice(0, i).join('').trimEnd();
			if (first && m(first) <= width) {
				at = i;
				break;
			}
		}
		if (at > 0) {
			out.push(chars.slice(0, at).join('').trimEnd());
			rest = chars.slice(at + 1).join('').trimStart();
		} else {
			let n = 1;
			while (n < chars.length && m(chars.slice(0, n + 1).join('')) <= width) n++;
			out.push(chars.slice(0, n).join('').trimEnd());
			rest = chars.slice(n).join('').trimStart();
		}
	}
}

/** A small deterministic random number generator (mulberry32). */
function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('L1: `nameLines` with up to three text lines (D81, D82)', () => {
	it('a name that fits is one text line; a name that fits in two is two, as in D37', () => {
		expect(three('Aldric Valmont', 140, mono)).toEqual(['Aldric Valmont']);
		expect(three('Ser Gareth Orsini the Younger', 170, mono)).toEqual(['Ser Gareth Orsini', 'the Younger']);
		expect(three('Anne Marie de la Tour', 120, mono)).toEqual(['Anne Marie', 'de la Tour']);
		expect(three('  Aldric Valmont  ', 140, mono)).toEqual(['Aldric Valmont']);
	});

	it('a name that needs three text lines uses the third, with no "…" (each line is the longest start that ends at a space)', () => {
		// 10 px a character, width 100: "Ser Gareth" (10), "Orsini the" (10), "Younger".
		expect(three('Ser Gareth Orsini the Younger', 100, mono)).toEqual(['Ser Gareth', 'Orsini the', 'Younger']);
		expect(three('Isolde of the Orsini and Harrow', 130, mono)).toEqual(['Isolde of the', 'Orsini and', 'Harrow']);
	});

	it('the third text line ends with "…" when the rest does not fit, at the last place where the text and "…" fit', () => {
		const lines = three('Ser Gareth Orsini the Younger of Valmont Keep', 100, mono);
		expect(lines).toHaveLength(3);
		expect(lines.slice(0, 2)).toEqual(['Ser Gareth', 'Orsini the']);
		// "Younger of Valmont Keep": nine characters and "…" fill 100 px.
		expect(lines[2]).toBe('Younger o…');
		expect(mono(lines[2])).toBeLessThanOrEqual(100);
	});

	it('a word longer than the width breaks inside the word, at the widest start that fits; the next text line starts after the break', () => {
		expect(three('Wenceslausbergwenceslausberg', 150, mono)).toEqual(['Wenceslausbergw', 'enceslausberg']);
		const long = three('Wenceslausbergwenceslausbergwenceslausberg', 150, mono);
		expect(long).toEqual(['Wenceslausbergw', 'enceslausbergwe', 'nceslausberg']);
		const over = three('Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 100, mono);
		expect(over).toEqual(['Aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaa…']);
	});

	it('a break inside a word keeps no leading space on the next text line', () => {
		expect(three('Ab Wenceslausberg Cd', 100, mono)).toEqual(['Ab', 'Wenceslaus', 'berg Cd']);
	});

	it('every text line but the last is the longest start of the rest; all fit the width (any measure)', () => {
		const next = rng(81);
		const words = ['Alexandria', 'of', 'the', 'Valmont-Orsini', 'Wilhelmina', 'de', 'la', 'Tour', 'Ser', 'Gareth', 'Bartholomew', 'II', 'Wmwmwmwm', 'lijlijlij'];
		for (let i = 0; i < 400; i++) {
			const name = Array.from({ length: 1 + Math.floor(next() * 9) }, () => words[Math.floor(next() * words.length)]).join(' ');
			const width = 40 + Math.floor(next() * 200);
			const m = next() < 0.5 ? mono : prop;
			const got = three(name, width, m);
			expect(got, `${name} / ${width}`).toEqual(reference(name, width, m, 3));
			expect(got.length).toBeGreaterThanOrEqual(1);
			expect(got.length).toBeLessThanOrEqual(3);
			for (const line of got) expect(m(line), `${line} of ${name} / ${width}`).toBeLessThanOrEqual(width);
		}
	});

	it('maxLines 2 gives exactly the M9 result (D37); titleLines is unchanged (D61)', () => {
		const next = rng(37);
		const words = ['Alexandria', 'of', 'the', 'Valmont-Orsini', 'Wilhelmina', 'de', 'la', 'Tour', 'Ser', 'Gareth', 'Bartholomew', 'II', 'Wmwmwmwm', 'lijlijlij'];
		for (let i = 0; i < 400; i++) {
			const name = Array.from({ length: 1 + Math.floor(next() * 9) }, () => words[Math.floor(next() * words.length)]).join(' ');
			const width = 40 + Math.floor(next() * 200);
			const m = next() < 0.5 ? mono : prop;
			const got = three(name, width, m, 2);
			expect(got, `${name} / ${width}`).toEqual(reference(name, width, m, 2));
			expect(got.length).toBeLessThanOrEqual(2);
		}
		// A title with a reign on 100 px: two text lines and "…", never three.
		expect(titleLines('Duke of Valmont', '(r. 1131–1160)', 100, mono)).toEqual(['Duke of', 'Valmont (…']);
		expect(titleLines('Duke of Valmont', '(r. 1131–1160)', 400, mono)).toEqual(['Duke of Valmont (r. 1131–1160)']);
		// The title fits, the reign does not: the break is at the last space that fits (the nameLines rule).
		expect(titleLines('Duke', '(r. 1131–1160)', 100, mono)).toEqual(['Duke (r.', '1131–1160)']);
	});

	it('the D37 cases (one and two text lines, no "…") do not change with the default of three', () => {
		for (const [name, width] of [
			['Aldric Valmont', 200],
			['Ser Gareth Orsini the Younger', 170],
			['Anne Marie de la Tour', 120],
			['Aldric Valmont', 139],
			['Isolde of the Orsini', 130],
			['Wenceslausberg', 100],
		] as const) {
			expect(three(name, width, mono), name).toEqual(three(name, width, mono, 2));
		}
	});
});

describe('sample tree 15, block 2: the names chosen by measurement (spec §13.9 acceptance)', () => {
	const facts = comments15().names;
	// 0.2.4 (D117, spec §13.9): the name text is 0.85 em, so the names were chosen again with the card rule (`cardNameLines`) at bold 13.6 px.
	const approx = (s: string) => approxMeasure(s, '600 13.6px x');
	const three = (name: string, width: number, max: 2 | 3 = 3): string[] => cardNameLines(name, undefined, width, (s) => approx(s), max).map(runsText);
	const source = block15(1);
	const g = graphOf(source);
	const nameOf = (id: string) => g.byId.get(id)!.name;

	it('the comments list five names at two widths', () => {
		expect(facts.map((f) => `${f.id}@${f.width}`)).toEqual(
			['short', 'two-lines', 'three-normal', 'three-narrow', 'over-three'].flatMap((id) => [`${id}@158`, `${id}@142`]),
		);
	});

	it('the text lines at the default font (name text 13.6 px), 158 px on a normal card and 142 px on a narrow card, are the ones in the comments', () => {
		for (const f of facts) expect(three(nameOf(f.id), f.width), `${f.id} at ${f.width}`).toEqual(f.lines);
	});

	it('the name chosen for normal cards needs exactly three text lines, with no "…"', () => {
		const lines = three(nameOf('three-normal'), 158);
		expect(lines).toHaveLength(3);
		expect(lines.some((l) => l.endsWith(ELLIPSIS))).toBe(false);
		expect(lines.join(' ')).toBe(nameOf('three-normal'));
	});

	it('the name chosen for the narrow note-preview cards of D24 needs exactly three text lines there, with no "…", and two on a normal card', () => {
		const narrow = three(nameOf('three-narrow'), 142);
		expect(narrow).toHaveLength(3);
		expect(narrow.some((l) => l.endsWith(ELLIPSIS))).toBe(false);
		expect(narrow.join(' ')).toBe(nameOf('three-narrow'));
		expect(three(nameOf('three-narrow'), 158)).toHaveLength(2);
	});

	it('the longer name ends with "…" on the third text line, on both widths', () => {
		for (const width of [158, 142]) {
			const lines = three(nameOf('over-three'), width);
			expect(lines).toHaveLength(3);
			expect(lines[2].endsWith(ELLIPSIS)).toBe(true);
			expect(lines.slice(0, 2).some((l) => l.endsWith(ELLIPSIS))).toBe(false);
			expect(approx(lines[2])).toBeLessThanOrEqual(width);
		}
	});

	it('the D37 names (one and two text lines) do not change: no "…" and the same breaks as with two lines', () => {
		for (const id of ['short', 'two-lines']) for (const width of [158, 142]) expect(three(nameOf(id), width), id).toEqual(three(nameOf(id), width, 2));
	});
});

describe('L2: `tallCardsFor` answers `tall` (2 or 3 text lines) and `long` (3), sorted', () => {
	const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
	const GEO = geometryFor(16, 'normal');
	/** 16 px normal card: the text is 158 px wide, so 15 characters of 10 px fit; with the D14 sign 132 px (13). */
	const m = (s: string) => [...s].length * 10;
	const tree = (people: [string, string, string?][]) =>
		graphOf(['people:', ...people.flatMap(([id, name, more]) => [`  - id: ${id}`, `    name: ${name}`, ...(more ? [`    ${more}`] : [])]), ''].join('\n'));

	it('1, 2 and 3 text lines; a name that needs more than three is long too; both lists are sorted', () => {
		const g = tree([
			['z-long', 'Ser Gareth Orsini the Younger'],
			['a-two', 'Aldric Valmont The Second'],
			['m-one', 'Aldric Valmont'],
			['b-word', 'Wenceslausbergwenceslausberg'],
			['c-over', 'Alamarinalamarinalamarinalamarinalamarinalamarinalamarinalamarin'],
			['d-three', 'Alamarinalamarinalamarinalamarinalamarin'],
			// D117: a word with no break place is never broken inside; it stays on one text line and is cut with "…".
			['e-unbroken', 'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
		]);
		const r = tallFor(g, GEO, FONTS, (s) => m(s))!;
		expect(r.tall).toEqual(['a-two', 'b-word', 'c-over', 'd-three', 'z-long']);
		expect(r.long).toEqual(['b-word', 'c-over', 'd-three', 'z-long']);
		const subset = r.long.every((id) => r.tall.includes(id));
		expect(subset).toBe(true);
	});

	it('the arms box and the "+" badge no longer narrow a name on a whole card (D117); the D14 sign room still does', () => {
		const g = tree([
			['a', 'Aldrimonalotte'], // 14 characters, 140 px
			['b', 'Bbbbbbbbbbbbbb'],
			['c', 'Cccccccccccccc'],
		]);
		expect(tallFor(g, GEO, FONTS, (s) => m(s), new Set())).toEqual({ tall: [], long: [] });
		const withArms = tallFor(g, GEO, FONTS, (s) => m(s), new Set(), undefined, new Set(['a', 'b', 'c']), undefined, { portraits: new Set(['a', 'b', 'c']) })!;
		expect(withArms).toEqual({ tall: [], long: [] });
	});

	it('the name of a names-only card uses the room that the arms box leaves beside its last text line (D125 a): 14 characters need a second text line only with the box', () => {
		const g = tree([['a', 'Aldrimonalotte']]);
		const geo = namesOnlyGeometry(GEO);
		expect(tallFor(g, geo, FONTS, (s) => m(s), new Set())).toEqual({ tall: [], long: [] });
		expect(tallFor(g, geo, FONTS, (s) => m(s), new Set(), undefined, new Set(['a']))).toEqual({ tall: ['a'], long: [] });
	});

	it('the name of the card is measured (D58): the regnal name, with the number', () => {
		const g = tree([['x', 'Maximilian Valm']]); // 15 characters, fits
		expect(tallFor(g, GEO, FONTS, (s) => m(s))).toEqual({ tall: [], long: [] });
		const labels = new Map([['x', { holdings: [], selected: false, name: 'Maximilian Valm II' }]]);
		expect(tallFor(g, GEO, FONTS, (s) => m(s), undefined, labels as never)).toEqual({ tall: ['x'], long: [] });
	});

	it('people in `skip` (hidden by folds) are left out of both lists', () => {
		const g = tree([
			['a', 'Ser Gareth Orsini the Younger'],
			['b', 'Aldric Valmont The Second'],
			['c', 'Aldric Valmont'],
		]);
		expect(tallFor(g, GEO, FONTS, (s) => m(s))).toEqual({ tall: ['a', 'b'], long: ['a'] });
		const skip = new Set(['a']);
		expect(tallFor(g, GEO, FONTS, (s) => m(s), undefined, undefined, undefined, skip)).toEqual({ tall: ['b'], long: [] });
		expect(tallFor(g, GEO, FONTS, (s) => m(s), undefined, undefined, undefined, new Set(['a', 'b']))).toEqual({ tall: [], long: [] });
	});

	it('the D14 two-pass rule: the count without the sign room (n1) and with it (n2)', () => {
		// Width 158 px holds 15 characters (n1); with the sign room 132 px holds 13 (n2).
		// a: "Bartholomewson" (14) breaks at a hyphen in 132 px: n1 = 2 text lines, n2 = 3. c: n1 = 2, n2 = 3 as well. b has no sign.
		const g = tree([
			['a', 'Bartholomewson Alexandrovichs', 'illegitimate: true'],
			['b', 'Cadwallader Dominicusbert'],
			['c', 'Aldric Valmont The Second', 'illegitimate: true'],
		]);
		// No `signed` and n1 differs from n2 for someone: the answer is `undefined` (the caller lays out once and asks again).
		expect(tallFor(g, GEO, FONTS, (s) => m(s))).toBeUndefined();
		// The sign is drawn on a only: a has n2 = 3, c has n1 = 2.
		expect(tallFor(g, GEO, FONTS, (s) => m(s), new Set(['a']))).toEqual({ tall: ['a', 'b', 'c'], long: ['a'] });
		// No sign is drawn: n1 for both.
		expect(tallFor(g, GEO, FONTS, (s) => m(s), new Set())).toEqual({ tall: ['a', 'b', 'c'], long: [] });
		// Both signs are drawn.
		expect(tallFor(g, GEO, FONTS, (s) => m(s), new Set(['a', 'c']))).toEqual({ tall: ['a', 'b', 'c'], long: ['a', 'c'] });
	});

	it('the D14 rule needs no `signed` when n1 = n2', () => {
		const g = tree([
			['a', 'Ser Gareth Orsini the Younger', 'illegitimate: true'], // 3 text lines at 15 and at 13 characters
			['b', 'Bo', 'illegitimate: true'],
		]);
		expect(tallFor(g, GEO, FONTS, (s) => m(s))).toEqual({ tall: ['a'], long: ['a'] });
	});

	it('an illegitimate person with birth parents is never signed (`couldBeSigned`), so no second layout is asked for', () => {
		const g = tree([
			['p', 'Pa'],
			['a', 'Bartholomewson Alexandrovichs', 'illegitimate: true\n    parents: [p]'],
		]);
		expect(tallFor(g, GEO, FONTS, (s) => m(s))).toEqual({ tall: ['a'], long: [] });
	});

	it('sample tree 15, block 2, at the default font: the counts of the comments, on a normal and on a narrow card', () => {
		const facts = comments15().names;
		const g = graphOf(block15(1));
		const fonts = { text: 'Segoe UI, sans-serif', ui: 'Segoe UI, sans-serif', bold: '600' };
		const want = (width: number): TallLists => ({
			tall: facts.filter((f) => f.width === width && f.lines.length > 1).map((f) => f.id).sort(),
			long: facts.filter((f) => f.width === width && f.lines.length === 3).map((f) => f.id).sort(),
		});
		expect(want(158)).toEqual({ tall: ['over-three', 'three-narrow', 'three-normal', 'two-lines'], long: ['over-three', 'three-normal'] });
		expect(want(142)).toEqual({ tall: ['over-three', 'three-narrow', 'three-normal', 'two-lines'], long: ['over-three', 'three-narrow', 'three-normal'] });
		expect(tallFor(g, GEO, fonts, approxMeasure)).toEqual(want(158));
		const narrow: Geometry = sidewaysGeometry(GEO, 'narrow');
		expect(narrow.cardW).toBe(164);
		expect(tallFor(g, narrow, fonts, approxMeasure)).toEqual(want(142));
	});
});

describe('L3: card heights, the box flags and the cache key', () => {
	const GEO = geometryFor(16, 'normal');
	const EXTRA = tallExtra(GEO);
	const source = ['people:', ...['a', 'b', 'c', 'd'].flatMap((id) => [`  - id: ${id}`, `    name: Person ${id}`, ...(id === 'a' ? [] : ['    parents: [a]'])]), ''].join('\n');
	const settings = (extra: object = {}): Settings => ({ ...DEFAULT_LAYOUT_SETTINGS, ...extra }) as Settings;
	const lay = (s: Settings, geo: Geometry = GEO) => layoutTree(graphOf(source), geo, s, 'font');

	it('a card is taller by one tallExtra for each name text line after the first (three lines: two), in a row that shares its top edge', () => {
		clearLayoutCache();
		const laid = lay(settings({ tallCards: ['b', 'c'], longNames: ['c'] }));
		const box = (id: string) => laid.layout.persons.get(id) as Box;
		expect(EXTRA).toBe(16); // D117: one name text line is 0.85 em × 1.2 = 16.3 px, whole px
		expect(box('b').h).toBe(GEO.cardH + EXTRA);
		expect(box('c').h).toBe(GEO.cardH + 2 * EXTRA);
		expect(box('d').h).toBe(GEO.cardH);
		expect(box('a').h).toBe(GEO.cardH);
		// One row for the three children: they share the top edge. (It is the last row, so it has no gap
		// below it; the gap-under-the-tallest rule is tested in tests/layout-m10-name-lines.test.ts.)
		expect(new Set(['b', 'c', 'd'].map((id) => box(id).y)).size).toBe(1);
	});

	it('the flags: `tallName` for two and three text lines, `longName` only for three, and only when true', () => {
		clearLayoutCache();
		const laid = lay(settings({ tallCards: ['b', 'c'], longNames: ['c'] }));
		const box = (id: string) => laid.layout.persons.get(id) as Box;
		expect(box('b').tallName).toBe(true);
		expect(box('c').tallName).toBe(true);
		expect(box('c').longName).toBe(true);
		expect('longName' in box('b')).toBe(false);
		expect('longName' in box('d')).toBe(false);
		expect('tallName' in box('d')).toBe(false);
	});

	it('with no long names the layout is the M9 layout (D37 cases unchanged)', () => {
		clearLayoutCache();
		const a = lay(settings({ tallCards: ['b'] }));
		const b = lay(settings({ tallCards: ['b'], longNames: [] }));
		expect(JSON.stringify([...b.layout.persons])).toBe(JSON.stringify([...a.layout.persons]));
		expect(a.layout.height).toBe(b.layout.height);
	});

	it('sideways (D24): each card keeps its own height; only the long card is taller; widths are the same', () => {
		clearLayoutCache();
		const side = { orientation: 'sideways', sidewaysCards: 'narrow' };
		const base = lay(settings({ ...side }), GEO);
		const laid = lay(settings({ ...side, tallCards: ['b', 'c'], longNames: ['c'] }), GEO);
		const cardH = base.layout.persons.get('a')!.h;
		const box = (id: string) => laid.layout.persons.get(id)!;
		expect(box('a').h).toBe(cardH);
		expect(box('d').h).toBe(cardH);
		expect(box('b').h).toBe(cardH + EXTRA);
		expect(box('c').h).toBe(cardH + 2 * EXTRA);
		for (const id of ['a', 'b', 'c', 'd']) expect(box(id).w, id).toBe(base.layout.persons.get(id)!.w);
	});

	it('the cache key: long names change it; none leaves it as before; order and repeats do not matter', () => {
		const g = graphOf(source);
		const key = (extra: object) => layoutKey(g, GEO, settings({ tallCards: ['b', 'c'], ...extra }), 'font');
		const none = key({});
		expect(key({ longNames: ['c'] })).not.toBe(none);
		expect(key({ longNames: [] })).toBe(none);
		expect(key({ longNames: ['c', 'b'] })).toBe(key({ longNames: ['b', 'c', 'c'] }));
		expect(key({ longNames: ['b'] })).not.toBe(key({ longNames: ['c'] }));
	});
});

describe('L4: `cardText` with one, two or three name text lines', () => {
	const GEO = geometryFor(16, 'normal');
	const pitch = 1.2 * 0.85 * 16; // the line height of the name text line (spec §5.4: 1.2 on normal cards; the name is 0.85 em, D117)

	it('a boolean is still accepted: true = 2, false = 1, absent = 1', () => {
		expect(textFor(GEO, true)).toEqual(textFor(GEO, 2));
		expect(textFor(GEO, false)).toEqual(textFor(GEO, 1));
		expect(textFor(GEO)).toEqual(textFor(GEO, 1));
		expect(textFor(GEO, true, true)).toEqual(textFor(GEO, 2, true));
	});

	it('only three name text lines have a third baseline, one name text line pitch below the second', () => {
		const one = textFor(GEO, 1) as Text3;
		const two = textFor(GEO, 2) as Text3;
		const t3 = textFor(GEO, 3) as Text3;
		expect(one.name3Baseline).toBeUndefined();
		expect(two.name3Baseline).toBeUndefined();
		expect('name3Baseline' in one).toBe(false);
		expect(t3.name2Baseline).toBeDefined();
		expect(t3.name3Baseline).toBeDefined();
		expect(t3.name3Baseline! - t3.name2Baseline!).toBeCloseTo(pitch, 6);
		expect(t3.name2Baseline! - t3.nameBaseline).toBeCloseTo(pitch, 6);
	});

	it('the text block stays centred in the taller card and `textBottom` includes every text line', () => {
		const cardH = (n: number) => GEO.cardH + (n - 1) * tallExtra(GEO);
		const t1 = textFor(GEO, 1) as Text3;
		const t3 = textFor(GEO, 3) as Text3;
		// The third name text line adds a pitch to the block.
		expect(t3.textBottom - t1.textBottom).toBeGreaterThan(2 * pitch - 1);
		expect(t3.textBottom - t1.textBottom).toBeLessThan(2 * pitch + 1);
		expect(t3.textBottom).toBeLessThan(cardH(3));
		// Centred: the space above the first name text line equals the space below the last text line (within the baseline offset of the last line).
		const above = t3.nameBaseline - 0.35 * t3.nameSize - pitch / 2;
		const below = cardH(3) - t3.textBottom;
		expect(Math.abs(above - below)).toBeLessThan(0.5);
		// The title and the dates are one name pitch lower for each added name text line.
		const t2 = textFor(GEO, 2) as Text3;
		expect(t3.titleBaseline - t2.titleBaseline).toBeGreaterThan(pitch - 1);
		expect(t3.titleBaseline - t2.titleBaseline).toBeLessThan(pitch + 1);
		expect(t3.datesBaseline - t3.titleBaseline).toBeCloseTo(t1.datesBaseline - t1.titleBaseline, 6);
	});
});

describe('the scene and the saved SVG draw the third name text line like the second (L4, spec §13.9)', () => {
	const GEO = geometryFor(16, 'normal');
	const FONTS = { text: 'Segoe UI, sans-serif', ui: 'Segoe UI, sans-serif', bold: '600' };
	const facts = comments15().names;
	const g = graphOf(block15(1));
	const idsAt = (width: number, min: number, max: number) => facts.filter((f) => f.width === width && f.lines.length >= min && f.lines.length <= max).map((f) => f.id).sort();

	function laidOut(width: 158 | 142) {
		clearLayoutCache();
		const narrow = width === 142;
		const settings = {
			...DEFAULT_LAYOUT_SETTINGS,
			...(narrow ? { orientation: 'sideways', sidewaysCards: 'narrow' } : {}),
			tallCards: idsAt(width, 2, 3),
			longNames: idsAt(width, 3, 3),
		} as Settings;
		return layoutTree(g, GEO, settings, 'font');
	}

	for (const width of [158, 142] as const) {
		it(`scene, ${width} px: each card shows the text lines of the comments, the third with the same class as the second`, () => {
			const laid = laidOut(width);
			const root = new FEl('g');
			const scene: Scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: approxMeasure, link: () => null });
			expect(scene.cards.size).toBe(7);
			const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
			for (const f of facts.filter((x) => x.width === width)) {
				const card = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === f.id)!;
				const names = all(card).filter((e) => e.hasClass('dynasty-card-name'));
				expect(names.map((e) => e.getText()), f.id).toEqual(f.lines);
				if (f.lines.length === 3) {
					const ys = names.map((e) => Number(e.getAttribute('y')));
					expect(ys[2] - ys[1], f.id).toBeCloseTo(ys[1] - ys[0], 6);
				}
			}
		});

		it(`renderSvg, ${width} px: the same text lines, at the baselines of cardText`, () => {
			const laid = laidOut(width);
			const svg = renderSvg(g, laid.layout, laid.edges, { measure: approxMeasure, fonts: FONTS });
			for (const f of facts.filter((x) => x.width === width)) {
				const box = laid.layout.persons.get(f.id) as Box;
				expect(box.tallName === true, f.id).toBe(f.lines.length > 1);
				expect(box.longName === true, f.id).toBe(f.lines.length === 3);
				for (const line of f.lines) expect(svg, `${f.id}: ${line}`).toContain(`>${line}</text>`);
			}
		});
	}

	it('the accessible name of a card is the full name (L4)', () => {
		const laid = laidOut(158);
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: approxMeasure, link: () => null });
		const card = scene.cards.get('over-three') as unknown as FEl;
		expect(card.getAttribute('aria-label')).toContain(g.byId.get('over-three')!.name);
	});
});

describe('L5: a name text line beside a portrait (spec §13.9, §13.7 D76, D77)', () => {
	const GEO = geometryFor(16, 'normal');
	const lineBox = (t: Text3, line: 1 | 2 | 3) => {
		const baseline = [t.nameBaseline, t.name2Baseline!, t.name3Baseline!][line - 1];
		const height = 1.2 * t.nameSize;
		const top = baseline - 0.35 * t.nameSize - height / 2;
		return { top, bottom: top + height };
	};

	it('the room of a name text line: the text width; less the box and its gap when the line box overlaps the circle by more than 0.5 px (roomAt)', () => {
		const t = textFor(GEO, 3) as Text3;
		const l3 = lineBox(t, 3);
		const portrait = (overlap: number) => [{ r: { x: t.padX + t.textW - 24, y: l3.bottom - overlap, w: 24, h: 24 }, gap: 0.25 * 16 }];
		const at = (line: 1 | 2 | 3, boxes: ReturnType<typeof portrait>) => roomAt(GEO, t, [t.nameBaseline, t.name2Baseline!, t.name3Baseline!][line - 1], t.nameSize, boxes);
		expect(at(3, [])).toBe(t.textW);
		expect(at(3, portrait(5))).toBeCloseTo(t.textW - 24 - 0.25 * 16, 9);
		expect(at(3, portrait(0.6))).toBeCloseTo(t.textW - 24 - 0.25 * 16, 9);
		expect(at(3, portrait(0.4))).toBe(t.textW);
		// A text line above the portrait is not narrowed.
		expect(at(1, portrait(5))).toBe(t.textW);
	});

	it('a portrait does not add a text line or make a card taller: the layout with `portraits` has the same boxes', () => {
		const g = graphOf(['people:', '  - id: a', '    name: Aaa', '  - id: b', '    name: Bbb', '    parents: [a]', ''].join('\n'));
		clearLayoutCache();
		const base = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: ['b'], longNames: ['b'] } as Settings, 'font');
		clearLayoutCache();
		const withPortrait = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: ['b'], longNames: ['b'], portraits: ['b'] } as Settings & { portraits: string[] }, 'font');
		for (const id of ['a', 'b']) {
			const x = base.layout.persons.get(id)!;
			const y = withPortrait.layout.persons.get(id)!;
			expect([y.x, y.y, y.w, y.h], id).toEqual([x.x, x.y, x.w, x.h]);
		}
	});

	it('a card with a portrait: the breaks are made at the normal width, not the narrower one (the portrait never adds a text line)', () => {
		// portraitBox is the M9 circle: 24 px at 16 px, at the lower right of the text block.
		const t = textFor(GEO, 3) as Text3;
		const p = portraitBox(GEO, t);
		expect(p.w).toBe(24);
		expect(p.y + p.h).toBeCloseTo(t.textBottom, 9);
		// The third name text line ends above the circle on a normal card, so it keeps the full width.
		expect(lineBox(t, 3).bottom).toBeLessThan(p.y);
	});
});
