import { describe, expect, it } from 'vitest';
import { cardNameLines, isolateLines, runsText, svgNameLines, type NameRun } from '../../src/render/name-lines';
import { T10 } from '../support/same-sex-and-scripts-data';
import { visual } from './bidi-reference';

/*
 * Spec §0 D322 (fixed in 0.5.2): a card name in SVG text was wrapped in FSI and PDI, and WebKit ignores them there, so a name that starts right to left and
 * holds Latin letters read in the other order on an iPhone. `svgNameLines` writes the embedding of the same direction instead, which WebKit honours. These tests
 * prove with the reference of UAX #9 (bidi-reference.ts) that the embedding gives the same order as the isolate, at every break the card can make; the
 * test in WebKit (an internal test) proves the order in the real engine.
 */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const LRI = String.fromCharCode(0x2066);
const LRE = String.fromCharCode(0x202a);
const RLE = String.fromCharCode(0x202b);
const PDF = String.fromCharCode(0x202c);
const measure = (s: string) => [...s.replace(/[\u200e\u200f\u202a-\u202c\u2066-\u2069]/g, '')].length * 8;
const runsOf = (lines: readonly string[]): NameRun[][] => lines.map((text) => [{ text, sob: false }]);
const textsOf = (lines: readonly (readonly NameRun[])[]) => lines.map(runsText);

/** The order that each text line shows: the embedding text and the isolate text, each as its own paragraph on a left-to-right page. */
function bothOrders(lines: readonly (readonly NameRun[])[]): { svg: string[]; isolate: string[] } {
	return { svg: textsOf(svgNameLines(lines)).map((l) => visual(l, 0)), isolate: textsOf(isolateLines(lines)).map((l) => visual(l, 0)) };
}

describe('D322: a name with a right-to-left start in SVG text', () => {
	it.each([
		['ليلى', 'Layla'],
		['كريم', 'Mansour'],
		['نور الدين', 'Zengi'],
		['דוד', 'David'],
		['נור', 'Zengi'],
	])('%s %s: the order with the embedding equals the order with the isolate', (rtl, latin) => {
		const lines = cardNameLines(`${rtl} ${latin}`, undefined, 1000, measure, 3, undefined);
		const [svg] = textsOf(svgNameLines(lines));
		const [iso] = textsOf(isolateLines(lines));
		expect(svg).toBe(`${RLE}${rtl} ${latin}${PDF}`);
		expect(iso).toBe(`${FSI}${rtl} ${latin}${PDI}`);
		// What a browser with isolate support shows: the Latin word at the left of the right-to-left words.
		const want = `${latin} ${visual(rtl, 0)}`;
		expect(visual(iso, 0)).toBe(want);
		expect(visual(svg, 0)).toBe(want);
		// The controls are what changes the order: with none, a browser that ignores them shows the other order.
		expect(visual(`${rtl} ${latin}`, 0)).toBe(`${visual(rtl, 0)} ${latin}`);
	});

	it('a name that starts left to right has the left-to-right embedding, and a right-to-left one the right-to-left embedding', () => {
		expect(textsOf(svgNameLines(runsOf(['Layla ليلى'])))).toEqual([`${LRE}Layla ليلى${PDF}`]);
		expect(textsOf(svgNameLines(runsOf(['ليلى'])))).toEqual([`${RLE}ليلى${PDF}`]);
		expect(textsOf(svgNameLines(runsOf(['123 ليلى Layla'])))).toEqual([`${RLE}123 ليلى Layla${PDF}`]);
	});

	it('a name with a sobriquet keeps its runs and opens and closes the embedding at the ends of the line', () => {
		const lines = cardNameLines('ليلى Layla', 'the Wise', 1000, measure, 3, undefined);
		const out = svgNameLines(lines);
		expect(out).toHaveLength(1);
		expect(out[0].map((r) => r.sob)).toEqual([false, true]);
		expect(out[0][0].text.startsWith(RLE)).toBe(true);
		expect(out[0][1].text.endsWith(`”${PDF}`)).toBe(true);
		expect(visual(runsText(out[0]), 0)).toBe(visual(runsText(isolateLines(lines)[0]), 0));
	});

	it('a name with no right-to-left letter comes back as the same list, and the width is the same', () => {
		const lines = [[{ text: 'Aldric II', sob: false }]];
		expect(svgNameLines(lines)).toBe(lines);
		const rtl = cardNameLines('ليلى Layla', undefined, 1000, measure, 3, undefined);
		expect(measure(runsText(svgNameLines(rtl)[0]))).toBe(measure('ليلى Layla'));
	});

	it('only the isolates change: without the controls each line is the text line the break gave', () => {
		const strip = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202c\u2066-\u2069]/g, '');
		for (const lines of [['نور الدين الثاني (Nur al-Din', 'II)'], ['رحل (Rachel', 'Levi) كهن'], ['ليلى Layla']]) {
			expect(textsOf(svgNameLines(runsOf(lines))).map(strip)).toEqual(lines);
			expect(textsOf(svgNameLines(runsOf(lines))).join('')).not.toMatch(/[\u2066-\u2069]/);
		}
	});
});

describe('D322: wrapped names read in the isolate order with the embeddings', () => {
	const NUR = 'نور الدين الثاني';
	it.each([
		[[`${NUR} (Nur al-Din`, 'II)']],
		[[`${NUR} (Nur`, 'al-Din II)']],
		[['רחל (Rachel', 'Levi) כהן']],
		[['Aldric (نور', 'الدين) Haddad']],
		[['نور (Nur [al-Din', 'II] Haddad)']],
		[['Aldric (نور [Nur', 'al-Din] الثاني)']],
		[['نور (Nur [al-Din] II', 'Haddad)']],
		[['نور الدين', '(Nur al-Din', 'II) Haddad']],
		[['Aldric (نور', 'الدين', 'الثاني) Haddad']],
		[['Aldric (نور [الدين', 'الثاني] Bea)']],
		[[`${NUR} (Nur)`, 'الحداد']],
		[[NUR, '(Nur al-Din II)']],
		[['نور Longna-', 'munda']],
		[['رحل (Rachel) لوي-', 'Haddad']],
		[['Aldric Haddad', '“الحكيم”']],
		[['يوسف الحداد', '“الحكيم”']],
	])('%j', (lines) => {
		const { svg, isolate } = bothOrders(runsOf(lines));
		expect(svg).toEqual(isolate);
	});

	it('every name of sample tree 19, at every break the card can make', () => {
		const tree = T10.find((t) => t.id === '19')!;
		let wrapped = 0;
		for (const { name, sobriquet } of Object.values(tree.people)) {
			for (let room = 2; room <= [...name].length + 12; room++) {
				const lines = cardNameLines(name, sobriquet, room, (s) => [...s].length, 3);
				if (lines.length < 2 || lines.some((l) => runsText(l).endsWith('…'))) continue;
				wrapped++;
				const { svg, isolate } = bothOrders(lines);
				expect(svg, `${name} at ${room}`).toEqual(isolate);
			}
		}
		expect(wrapped).toBeGreaterThan(20);
	});

	it('breaks of mixed names made from pieces of several scripts, brackets and numbers, at every place', () => {
		// A fixed seed: the same 6 000 names each run. About 1 in 40 of the wrapped names holds a bracket pair that the break splits (a phrase). A search over 300 000 names found no difference.
		const pieces = ['نور', 'الدين', 'Nur', 'al-Din', 'דוד', 'David', '(', ')', '[', ']', '12', '“', '١٢', 'x', '-', 'ab-cd', 'أ'];
		let seed = 11;
		const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
		let checked = 0;
		let phrases = 0;
		for (let n = 0; n < 6000; n++) {
			const words: string[] = [];
			const count = 2 + (next() % 7);
			for (let i = 0; i < count; i++) words.push(pieces[(next() >> 4) % pieces.length]);
			const lines = cardNameLines(words.join(' '), undefined, 4 + ((next() >> 4) % 14), (s) => [...s].length, 3);
			if (lines.length < 2) continue;
			checked++;
			if (textsOf(isolateLines(lines)).some((l) => new RegExp(`[${LRI}-${FSI}][^${PDI}]*[${LRI}-${FSI}]`).test(l))) phrases++;
			const { svg, isolate } = bothOrders(lines);
			expect(svg, words.join(' ')).toEqual(isolate);
		}
		expect(checked).toBeGreaterThan(1000);
		expect(phrases).toBeGreaterThan(20);
	});
});
