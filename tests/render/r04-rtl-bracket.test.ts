import { describe, expect, it } from 'vitest';
import type { CardLabel } from '../../src/core/titles';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { cardNameLines, isolateLines, runsText, type NameRun } from '../../src/render/name-lines';
import { renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';
import { T10 } from '../support/r04-t10';
import { bidiClass, visual, visualLines, withoutControls } from './bidi-reference';

/*
 * Version 0.4, G5 fault 5 (an internal study, picture an internal picture): on the card, "نور الدين الثاني (Nur al-Din II)" wrapped into
 * "Nur al-Din) نور الدين الثاني" and "II)". Each text line was its own first-strong isolate, so line 2 ("II)") took the left-to-right direction of its own first
 * letter, and the bracket pair that the break split lost its opening glyph.
 *
 * The rule (isolateLines): every line of a wrapped name is an isolate in the direction of the whole name; an outermost bracket pair that the break splits is a
 * phrase, and each piece of it is an isolate in the phrase's direction (the direction of the text round it if the phrase holds a letter of that direction, else
 * that of the letters it holds); a split pair inside a phrase keeps the direction the whole name gives its brackets; a neutral at the break that the whole name
 * puts between two letters of the other direction gets a mark. The proof uses a reference of the Unicode bidi algorithm (bidi-reference.ts, written from UAX #9),
 * in four checks:
 * 1. the hand-written picture of each line (what the eye sees, left to right);
 * 2. each line, drawn as its own SVG text (a paragraph with the left-to-right page direction), shows what a browser shows when the one-line name, with the
 *    phrases set as isolates, wraps at the same place (UAX #9: levels from the whole name, order line by line);
 * 3. the phrases do not change the one-line name: with and without them it shows the same;
 * 4. only controls are added: without them each line is the text line the break gave.
 */

useFakeDom({ css: true });

const LRI = String.fromCharCode(0x2066);
const RLI = String.fromCharCode(0x2067);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

/** The visual order of a run of right-to-left letters and spaces with no bracket: the code points from the last to the first. */
const rtl = (s: string) => Array.from(s).reverse().join('');

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * The reference wrap: the one-line name in its first-strong isolate, with every outermost bracket pair that a break splits set in an isolate: of the direction of
 * the text round it if the pair holds a letter of that direction, else of the letters it holds. Written for the test from the rule's words, not from the plugin's
 * code. Pairs inside a phrase stay as they are: UAX #9 resolves them from the whole name.
 */
function referenceLines(lines: readonly string[]): string[] {
	const cps = lines.flatMap((l, line) => Array.from(l).map((ch) => ({ ch, line })));
	const before = new Map<number, string>();
	const after = new Map<number, string>();
	const dirAt = (i: number) => {
		const c = bidiClass(cps[i].ch);
		return c === 'L' ? LRI : c === 'R' || c === 'AL' ? RLI : undefined;
	};
	const base = cps.map((_, i) => dirAt(i)).find(Boolean) ?? LRI;
	const stack: { at: number; close: string }[] = [];
	const pairs: [number, number][] = [];
	for (let i = 0; i < cps.length; i++) {
		const close = OPEN[cps[i].ch];
		if (close) stack.push({ at: i, close });
		else if (Object.values(OPEN).includes(cps[i].ch)) {
			const k = stack.map((s) => s.close).lastIndexOf(cps[i].ch);
			if (k >= 0) {
				pairs.push([stack[k].at, i]);
				stack.length = k;
			}
		}
	}
	pairs.sort((p, q) => p[0] - q[0]);
	let outerEnd = -1;
	for (const [o, c] of pairs) {
		if (cps[o].line === cps[c].line || o < outerEnd) continue;
		outerEnd = c;
		const inside: string[] = [];
		for (let i = o + 1; i < c; i++) inside.push(dirAt(i) ?? '');
		const dir = inside.includes(base) ? base : inside.find(Boolean) ?? base;
		before.set(o, dir);
		after.set(c, PDI);
	}
	const out = lines.map(() => '');
	cps.forEach((cp, i) => {
		out[cp.line] += (before.get(i) ?? '') + cp.ch + (after.get(i) ?? '');
	});
	out[0] = FSI + out[0];
	out[out.length - 1] += PDI;
	return out;
}

const runsOf = (lines: readonly string[]): NameRun[][] => lines.map((text) => [{ text, sob: false }]);
const shown = (lines: readonly string[]): string[] => isolateLines(runsOf(lines)).map(runsText);
/** What each SVG text line shows: its own paragraph, left to right (an SVG text on a left-to-right page). */
const drawn = (lines: readonly string[]): string[] => shown(lines).map((l) => visual(l, 0));

/** Checks 2 to 4 for a wrapped name; check 1 is in each test. */
function proves(lines: readonly string[]): void {
	const out = shown(lines);
	expect(out.map(withoutControls), 'only controls added').toEqual([...lines]);
	expect(drawn(lines), `same as the one-line name wrapped: ${lines.join(' | ')}`).toEqual(visualLines(referenceLines(lines), 0));
	const one = lines.join(' ');
	expect(visual(referenceLines([...lines]).join(' '), 0), 'the phrases do not change the one-line name').toBe(visual(FSI + one + PDI, 0));
}

describe('G5 fault 5: a wrapped name reads as the one-line name, split at the break', () => {
	const NUR = 'نور الدين الثاني';

	it('tree 19, "نور الدين الثاني (Nur al-Din II)" broken after "Din" (the picture of the report): "(Nur al-Din" then "II)"', () => {
		const lines = [`${NUR} (Nur al-Din`, 'II)'];
		// The fault, as 0.4 drew it: each line its own first-strong isolate.
		expect(lines.map((l) => visual(FSI + l + PDI, 0))).toEqual([`Nur al-Din) ${rtl(NUR)}`, 'II)']);
		expect(drawn(lines)).toEqual([`(Nur al-Din ${rtl(NUR)}`, 'II)']);
		expect(shown(lines)).toEqual([`${RLI}${NUR} ${LRI}(Nur al-Din${PDI}${PDI}`, `${RLI}${LRI}II)${PDI}${PDI}`]);
		proves(lines);
	});

	it('tree 19, the same name broken after "(Nur" (the spike pictures): "(Nur" then "al-Din II)"', () => {
		const lines = [`${NUR} (Nur`, 'al-Din II)'];
		expect(drawn(lines)).toEqual([`(Nur ${rtl(NUR)}`, 'al-Din II)']);
		proves(lines);
	});

	it('Hebrew with Latin in brackets, broken inside the brackets', () => {
		const lines = ['רחל (Rachel', 'Levi) כהן'];
		expect(drawn(lines)).toEqual([`(Rachel ${rtl('רחל')}`, `${rtl('כהן')} Levi)`]);
		proves(lines);
	});

	it('Latin with Arabic in brackets, broken inside the brackets: each line shows its piece of "(… …)" as on one line', () => {
		const lines = ['Aldric (نور', 'الدين) Haddad'];
		// On one line: "Aldric (" + the Arabic from right to left + ") Haddad".
		expect(visual(FSI + lines.join(' ') + PDI, 0)).toBe(`Aldric (${rtl('نور الدين')}) Haddad`);
		expect(drawn(lines)).toEqual([`Aldric ${rtl('نور')})`, `(${rtl('الدين')} Haddad`]);
		proves(lines);
	});

	it('nested brackets, broken inside both pairs', () => {
		const a = ['نور (Nur [al-Din', 'II] Haddad)'];
		expect(drawn(a)).toEqual([`(Nur [al-Din ${rtl('نور')}`, 'II] Haddad)']);
		proves(a);
		const b = ['Aldric (نور [Nur', 'al-Din] الثاني)'];
		// On one line: "Aldric (" + "نور" + " [Nur al-Din] " + "الثاني" + ")", the Arabic words from right to left inside the left-to-right brackets.
		expect(visual(FSI + b.join(' ') + PDI, 0)).toBe(`Aldric (${rtl('نور')} [Nur al-Din] ${rtl('الثاني')})`);
		expect(drawn(b)).toEqual([`Aldric (${rtl('نور')} [Nur`, `al-Din] ${rtl('الثاني')})`]);
		proves(b);
	});

	it('nested brackets, broken inside the outer pair only, and on three lines', () => {
		proves(['نور (Nur [al-Din] II', 'Haddad)']);
		proves(['نور الدين', '(Nur al-Din', 'II) Haddad']);
		proves(['Aldric (نور', 'الدين', 'الثاني) Haddad']);
	});

	it('a split pair inside a phrase keeps the direction the whole name gives its brackets', () => {
		// The inner pair holds Arabic only and follows an Arabic word, so UAX #9 makes its brackets right to left; alone on line 2, "]" would turn left to right.
		const lines = ['Aldric (نور [الدين', 'الثاني] Bea)'];
		const RLM = String.fromCharCode(0x200f);
		expect(shown(lines)[1]).toContain(`${RLM}]${RLM}`);
		expect(drawn(lines)[1]).toBe(`[${rtl('الثاني')} Bea)`);
		proves(lines);
	});

	it('a break outside the brackets: the pair stays whole on its line and shows as before', () => {
		const after = [`${NUR} (Nur)`, 'الحداد'];
		expect(drawn(after)).toEqual([`(Nur) ${rtl(NUR)}`, rtl('الحداد')]);
		proves(after);
		const before = [NUR, '(Nur al-Din II)'];
		expect(drawn(before)).toEqual([rtl(NUR), '(Nur al-Din II)']);
		proves(before);
	});

	it('a hyphen added inside a Latin word of an Arabic name stays at the end of the Latin piece', () => {
		const lines = ['نور Longna-', 'munda'];
		expect(lines.map((l) => visual(FSI + l + PDI, 0))[0]).toBe(`-Longna ${rtl('نور')}`);
		expect(drawn(lines)).toEqual([`Longna- ${rtl('نور')}`, 'munda']);
		proves(lines);
		// An own hyphen between Hebrew and Latin letters has the name's direction in both, as on one line.
		proves(['רחל (Rachel) לוי-', 'Haddad']);
	});

	it('a Latin name with an Arabic sobriquet on line 2 keeps the curly marks of a left-to-right name', () => {
		const lines = ['Aldric Haddad', '“الحكيم”'];
		expect(drawn(lines)).toEqual(['Aldric Haddad', `“${rtl('الحكيم')}”`]);
		proves(lines);
	});

	it('all-right-to-left wrapped names draw as before; a name that does not wrap keeps its one first-strong isolate', () => {
		for (const lines of [['يوسف الحداد', '“الحكيم”'], ['דוד לוי', 'הצעיר'], ['مُحَمَّد', 'الحداد']]) {
			expect(drawn(lines)).toEqual(lines.map((l) => visual(FSI + l + PDI, 0)));
			proves(lines);
		}
		expect(shown([`${NUR} (Nur al-Din II)`])).toEqual([`${FSI}${NUR} (Nur al-Din II)${PDI}`]);
		const ltr = runsOf(['Aldric (the', 'Wise)']);
		expect(isolateLines(ltr)).toBe(ltr);
	});

	it('every name of sample tree 19, at every break the card can make, reads as the one-line name wrapped', () => {
		const measure = (s: string) => [...s].length;
		const tree = T10.find((t) => t.id === '19')!;
		let wrapped = 0;
		for (const { name, sobriquet } of Object.values(tree.people)) {
			for (let room = 2; room <= [...name].length + 12; room++) {
				const lines = cardNameLines(name, sobriquet, room, measure, 3);
				if (lines.length < 2 || lines.some((l) => runsText(l).endsWith('…'))) continue;
				wrapped++;
				const texts = lines.map(runsText);
				const out = isolateLines(lines);
				expect(out.map((l) => l.map((r) => r.sob)), name).toEqual(lines.map((l) => l.map((r) => r.sob)));
				proves(texts);
			}
		}
		expect(wrapped).toBeGreaterThan(20);
	});
});

describe('G5 fault 5: the live card and the saved picture draw the same wrapped name', () => {
	const NAME = 'نور الدين الثاني (Nur al-Din II)';
	const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

	it.each([
		['after "(Nur"', 8, 'نور الدين الثاني (Nur'],
		['after "Din"', 6.2, 'نور الدين الثاني (Nur al-Din'],
	])('broken %s', (_label, perChar, first) => {
		const measure = (s: string, font: string) => [...s].length * (perChar / 16) * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
		const g = build(`people:\n  - {id: a, name: ${JSON.stringify(NAME)}}\n`).g;
		clearLayoutCache();
		const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), tallCards: ['a'] } as LayoutSettings, 'test');
		const labels = new Map([['a', { holdings: [], selected: false, name: NAME } as CardLabel]]);
		const fonts = { text: 'serif', ui: 'sans', bold: '700' };
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: () => null, labels });
		const live = all(root)
			.filter((e) => e.hasClass('dynasty-card-name'))
			.map((e) => e.getText())
			.filter(Boolean);
		const svg = renderSvg(g, laid.layout, laid.edges, { measure, fonts, labels });
		const saved = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((t) => withoutControls(t) && NAME.includes(withoutControls(t)));
		expect(live.length, live.join(' | ')).toBe(2);
		expect(saved).toEqual(live);
		expect(saved.map(withoutControls).join(' ')).toBe(NAME);
		expect(saved.map(withoutControls)[0], 'the break').toBe(first);
		const [l1, l2] = saved.map((t) => visual(t, 0));
		expect(l1.startsWith('(Nur')).toBe(true);
		expect(l2.endsWith('II)')).toBe(true);
		expect(`${l1}${l2}`.split('(').length - 1).toBe(1);
		expect(`${l1}${l2}`.split(')').length - 1).toBe(1);
	});
});
