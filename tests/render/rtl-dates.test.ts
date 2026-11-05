import { describe, expect, it } from 'vitest';
import { compileCalendars } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardLabels } from '../../src/core/titles';
import { cardText, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { CALENDAR_WINDOW_UI } from '../../src/render/calendar-text';
import { carryIsolates, closeIsolates, truncateClosed } from '../../src/render/bidi-controls';
import { hasRtlDate, isolateDate, isolateDatesIn, marksForSvg } from '../../src/render/date-bidi';
import { fitCardText, pickReign } from '../../src/render/date-fit';
import { buildScene } from '../../src/render/dom/scene';
import { tallTitlesFor } from '../../src/render/dom/tall-cards';
import { titleLines } from '../../src/render/name-lines';
import { renderSvg, textWidth } from '../../src/render/svg-string';
import { truncate } from '../../src/render/view-math';
import { dateLine, dateLineShown, headTitle, isolateReign, reignShown, reignOf, shownReign, shownReignIsolated, shownYears, titleWithNames } from '../../src/render/tree-info';
import { FEl } from '../acceptance/fake-dom';
import { list } from '../dates-support/names';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';
import { visual, withoutControls } from './bidi-reference';

/*
 * Right-to-left dates everywhere. A date with an Arabic or Hebrew word turns a range or a reign round in a left-to-right line. Each place that shows a date or a
 * reign puts such a date in a first-strong isolate. The proof is the reference bidi algorithm of the tests (`visual`): the text as drawn must show the dates in the order
 * in which they are written. All people are made up.
 */

useFakeDom({ css: true });

const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const LRM = String.fromCharCode(0x200e);
const ARABIC = 'حوالي 1108';
const HEBREW = 'בערך 1105';
const TREE = `
titles:
  - id: qadi
    name: Qadi
    holders:
      - {person: a, from: "${ARABIC}", to: 1170}
      - {person: b, from: "${HEBREW}"}
people:
  - {id: a, name: Ann, born: "${ARABIC}", died: 1170}
  - {id: b, name: Bo, born: "${HEBREW}", died: 1170}
  - {id: c, name: Cy, born: 1100, died: 1170}
  - {id: d, name: Di, born: "${ARABIC}"}
  - {id: e, name: Ed, died: "${ARABIC}"}
  - {id: f, name: Fay, born: 1100, died: yes}
`;
const { g } = build(TREE);
const person = (id: string) => g.byId.get(id)!;
const labels = cardLabels(g);
/** What `visual` gives for an Arabic word: the letters in the order from left to right on the screen. */
const shownLtr = (word: string) => [...word].reverse().join('');
const ARABIC_SEEN = `1108 ${shownLtr('حوالي')}`;
const HEBREW_SEEN = `1105 ${shownLtr('בערך')}`;

describe('the helpers', () => {
	it('isolateDate wraps a date with a right-to-left letter or an Arabic-Indic digit, and no other', () => {
		expect(isolateDate(ARABIC)).toBe(FSI + ARABIC + PDI);
		expect(isolateDate('١١٣٣')).toBe(FSI + '١١٣٣' + PDI);
		expect(isolateDate('1108')).toBe('1108');
		expect(isolateDate('۱۱۳۳')).toBe('۱۱۳۳');
		expect(isolateDate('११३३')).toBe('११३३');
		expect(hasRtlDate('b. 1108')).toBe(false);
	});

	it('isolateDatesIn isolates the dates in the order they stand and leaves a date that is not there', () => {
		expect(isolateDatesIn(`(r. ${ARABIC}–1170, from ${HEBREW})`, [ARABIC, '1170', HEBREW])).toBe(`(r. ${FSI}${ARABIC}${PDI}–1170, from ${FSI}${HEBREW}${PDI})`);
		expect(isolateDatesIn('(r. 1100–1170)', ['1100', '1170'])).toBe('(r. 1100–1170)');
		expect(isolateDatesIn(`(r. ${ARABIC})`, ['missing'])).toBe(`(r. ${ARABIC})`);
	});
});

describe('the dates line', () => {
	it('is the same string as dateLine once the controls are taken out, in every form', () => {
		for (const id of 'abcdef') expect(withoutControls(dateLineShown(person(id), g.dates) ?? ''), id).toBe(dateLine(person(id), g.dates) ?? '');
	});

	it('is the same string as dateLine when no date has a right-to-left letter', () => {
		for (const id of 'cf') expect(dateLineShown(person(id), g.dates)).toBe(dateLine(person(id), g.dates));
	});

	it('shows the dates in the written order; with no isolate the range would read "1170 – 1108 حوالي"', () => {
		const plain = visual(dateLine(person('a'), g.dates)!, 0);
		expect(plain.startsWith('1170'), `the plain text: ${plain}`).toBe(true);
		const now = visual(dateLineShown(person('a'), g.dates)!, 0);
		expect(now.startsWith(ARABIC_SEEN), now).toBe(true);
		expect(now.endsWith('1170'), now).toBe(true);
		const heb = visual(dateLineShown(person('b'), g.dates)!, 0);
		expect(heb.startsWith(HEBREW_SEEN), heb).toBe(true);
		expect(heb.endsWith('1170'), heb).toBe(true);
	});

	it('keeps b. and d. in order', () => {
		expect(visual(dateLineShown(person('d'), g.dates)!, 0)).toBe(`b. ${ARABIC_SEEN}`);
		expect(visual(dateLineShown(person('e'), g.dates)!, 0)).toBe(`d. ${ARABIC_SEEN}`);
	});
});

describe('the reign', () => {
	const label = labels.get('a')!;

	it('the isolated reign is the reign text with only the controls added', () => {
		expect(withoutControls(shownReignIsolated(label, g.dates, 'shown') ?? '')).toBe(shownReign(label, g.dates, 'shown'));
		expect(shownReignIsolated(label, g.dates, 'shown')).toContain(FSI + ARABIC + PDI);
	});

	it('shows the reign in the written order', () => {
		const plain = visual(shownReign(label, g.dates, 'shown')!, 0);
		expect(plain, 'the reign with no isolate').not.toBe(`(r. ${ARABIC_SEEN}–1170)`);
		expect(visual(shownReignIsolated(label, g.dates, 'shown')!, 0)).toBe(`(r. ${ARABIC_SEEN}–1170)`);
	});

	it('isolateReign serves the windows: the entries of a holding', () => {
		const entries = labels.get('b')!.holdings[0].entries;
		const text = reignOf(entries, g.dates, 'shown')!;
		expect(withoutControls(isolateReign(text, entries, g.dates)!)).toBe(text);
		expect(isolateReign(text, entries, g.dates)).toContain(FSI + HEBREW + PDI);
		expect(isolateReign('(r. 1100–1170)', [], g.dates)).toBe('(r. 1100–1170)');
		expect(isolateReign(undefined, [], g.dates)).toBeUndefined();
	});

	it('headTitle (the person window) and titleWithNames (the house page) isolate the reign', () => {
		expect(headTitle(label, 'Qadi', g.dates)).toContain(FSI + ARABIC + PDI);
	});

	it('with a name list of right-to-left names, the names of the years come isolated into the reign of the card and the house page', () => {
		const parsed = parseDynasty(`titles:
  - {id: t, name: Qadi, holders: [{person: a, from: 1273, to: 1280}]}
people:
  - {id: a, name: Ann, born: 1273, died: 1280}
`);
		if (!parsed.ok) throw new Error('bad tree');
		const names = list({ names: [{ name: 'الجمل', short: 'جمل' }, { name: 'الثور', short: 'ثور' }], show: 'short' });
		const named = deriveFamilies(parsed.tree, { dates: compileCalendars([], true, [], [names]) });
		const text = titleWithNames(named, 'a', 'x');
		expect(text).toContain(`${FSI}1273 جمل${PDI}`);
		const line = dateLineShown(named.byId.get('a')!, named.dates)!;
		expect(withoutControls(line)).toBe(dateLine(named.byId.get('a')!, named.dates));
		expect(line.startsWith(`${FSI}1273 جمل${PDI}`)).toBe(true);
	});
});

describe('the rows of the house page', () => {
	it('shownYears isolates each date and the range keeps its order', () => {
		const y = shownYears(ARABIC, '1170', g.dates);
		expect(y.born).toBe(FSI + ARABIC + PDI);
		expect(y.died).toBe('1170');
		expect(visual(y.range!, 0)).toBe(`${ARABIC_SEEN}–1170`);
		expect(shownYears('1100', '1170', g.dates)).toEqual({ born: '1100', died: '1170', range: '1100–1170' });
	});
});

describe('the Calendars window', () => {
	it('the known date stands before "=" in the written order', () => {
		const plain = visual(`${ARABIC} = 1108.`, 0);
		expect(plain.startsWith(ARABIC_SEEN), `the text with no isolate: ${plain}`).toBe(false);
		expect(visual(CALENDAR_WINDOW_UI.knownBack(ARABIC, 1108, 'Sa', 7), 0).startsWith(`${ARABIC_SEEN} = `)).toBe(true);
		expect(CALENDAR_WINDOW_UI.knownBack('1108', 1108, 'Sa', 7).startsWith('1108 = ')).toBe(true);
	});
});

// The card: the live scene and the saved picture draw the same text, and the text they measure is the text they draw.
const measure = (s: string, font: string) => [...withoutControls(s)].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const fonts = { text: 'serif', ui: 'sans', bold: '700' };
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('the card', () => {
	clearLayoutCache();
	const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
	const root = new FEl('g');
	buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: () => null, labels });
	const liveTexts = (cls: string) => all(root).filter((e) => e.hasClass(cls)).map((e) => e.getText());
	const svg = renderSvg(g, laid.layout, laid.edges, { measure, fonts, labels });
	const saved = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

	it('the live card draws the dates line in the written order', () => {
		const texts = liveTexts('dynasty-card-dates');
		// SVG text: the isolates become left-to-right marks (WebKit ignores an isolate there).
		expect(texts).toContain(marksForSvg(dateLineShown(person('a'), g.dates), true));
		expect(texts.some((t) => visual(t, 0).startsWith(ARABIC_SEEN))).toBe(true);
		for (const t of texts) expect(/[⁦-⁩]/.test(t), t).toBe(false);
	});

	it('the live card and the saved picture draw the reign in the written order and the same text', () => {
		// A thin measure, so that the whole reign fits one text line of the card and is not cut.
		const thin = (t: string, font: string) => measure(t, font) / 4;
		const wideRoot = new FEl('g');
		buildScene(wideRoot as unknown as SVGGElement, g, laid, { fonts, measure: thin, link: () => null, labels });
		const titles = all(wideRoot).filter((e) => e.hasClass('dynasty-card-title')).map((e) => e.getText());
		expect(titles.some((t) => visual(t, 0).includes(`(r. ${ARABIC_SEEN}–1170)`)), titles.join(' | ')).toBe(true);
		const wideSvg = [...renderSvg(g, laid.layout, laid.edges, { measure: thin, fonts, labels }).matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
		for (const t of titles.filter(hasRtlDate)) expect(wideSvg, t).toContain(t);
	});

	it('the saved picture draws the same dates and the same cut reign as the live card', () => {
		const live = [...liveTexts('dynasty-card-dates'), ...liveTexts('dynasty-card-title')].filter(hasRtlDate);
		expect(live.length).toBeGreaterThan(2);
		for (const t of live) expect(saved, t).toContain(t);
	});

	it('the string that is measured is the string that is drawn (a cut keeps its start and ends with …)', () => {
		const drawn = marksForSvg(dateLineShown(person('a'), g.dates), true)!;
		const small = (s: string) => measure(s, '12px');
		const fitted = fitCardText(drawn, undefined, small(drawn) - 6, small, false);
		expect(fitted.endsWith('…')).toBe(true);
		expect(drawn.startsWith(fitted.slice(0, -1))).toBe(true);
		expect(small(fitted)).toBeLessThanOrEqual(small(drawn) - 6);
		expect(fitCardText(drawn, undefined, small(drawn) + 1, small, false)).toBe(drawn);
	});
});

describe('the two-line title decision', () => {
	it('measures the reign as the card draws it, controls and all', () => {
		const geo = geometryFor(16);
		const all = (t: string) => [...t].length * 6;
		const label = labels.get('a')!;
		const drawn = marksForSvg(reignShown(label, label.reign, g.dates, 'none'));
		const w = cardText(geo).textW;
		// A width where the isolate characters alone decide between one and two text lines.
		const need = all(`${label.title} ${drawn}`);
		const plain = all(`${label.title} ${label.reign}`);
		expect(need).toBeGreaterThan(plain);
		const narrow = (t: string) => all(t) * (w / (need - 1));
		expect(titleLines(label.title, drawn, w, narrow).length).toBe(2);
		expect(tallTitlesFor(g, labels, geo, true, narrow)).toContain('a');
	});
});

// Native digits. The bidi algorithm counts the Arabic-Indic digits as Arabic numbers (AN): two dates of them with a dash between are one right-to-left run, so a range reads
// backwards. The extended Arabic-Indic digits are European numbers (EN), and the digits of the other scripts are neutral here: they keep their place in a left-to-right line.
const DIGIT_SETS: [string, string, string, boolean][] = [
	['Arabic-Indic', '١١٣٣', '١١٧٠', true],
	['extended Arabic-Indic', '۱۱۳۳', '۱۱۷۰', false],
	['Devanagari', '११३३', '११७०', false],
	['Thai', '๑๑๓๓', '๑๑๗๐', false],
	['Latin', '1133', '1170', false],
];

describe.each(DIGIT_SETS)('a range of %s digits', (_name, born, died, needsIsolate) => {
	const digits = build(`
titles:
  - {id: qadi, name: Qadi, holders: [{person: a, from: "${born}", to: "${died}"}]}
people:
  - {id: a, name: Ann, born: "${born}", died: "${died}"}
`).g;
	const ann = digits.byId.get('a')!;
	const order = (text: string) => {
		const v = visual(text, 0);
		return v.indexOf(born) - v.indexOf(died);
	};

	it('reads backwards with no isolate only when the algorithm counts the digits as Arabic numbers', () => {
		expect(order(dateLine(ann, digits.dates)!) > 0).toBe(needsIsolate);
	});

	it('keeps the born date left of the died date on the dates line', () => {
		expect(order(dateLineShown(ann, digits.dates)!)).toBeLessThan(0);
	});

	it('keeps the from date left of the until date in the reign', () => {
		const label = cardLabels(digits).get('a')!;
		expect(order(shownReignIsolated(label, digits.dates, 'shown')!)).toBeLessThan(0);
		expect(order(reignShown(label, label.reign, digits.dates, 'none')!)).toBeLessThan(0);
	});

	it('keeps the born date left of the died date in the range of the house page', () => {
		expect(order(shownYears(born, died, digits.dates).range!)).toBeLessThan(0);
	});

	it('adds isolate controls to the dates line exactly when they are needed', () => {
		const line = dateLineShown(ann, digits.dates)!;
		expect(line.includes(FSI)).toBe(needsIsolate);
		expect(withoutControls(line)).toBe(dateLine(ann, digits.dates));
		if (!needsIsolate) expect(line).toBe(dateLine(ann, digits.dates));
	});
});

describe('isolates stay paired when a drawn text is cut or broken', () => {
	const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length;
	const balanced = (s: string) => count(s, FSI) === count(s, PDI);
	const per = (s: string) => [...s].length * 6;
	const label = labels.get('a')!;
	const reign = shownReignIsolated(label, g.dates, 'shown')!;

	it('the cut of a dates line inside an isolate closes it before the ellipsis', () => {
		const drawn = dateLineShown(person('a'), g.dates)!;
		const cut = fitCardText(drawn, undefined, per(FSI + 'حوا') + per('…') + per(PDI), per, false);
		expect(cut.endsWith(`${PDI}…`), JSON.stringify(cut)).toBe(true);
		expect(balanced(cut)).toBe(true);
		expect(per(cut)).toBeLessThanOrEqual(per(FSI + 'حوا') + per('…') + per(PDI));
	});

	it('a cut that leaves nothing in the isolate drops the opener', () => {
		const drawn = dateLineShown(person('a'), g.dates)!;
		const cut = fitCardText(drawn, undefined, per('…'), per, false);
		expect(cut).toBe('…');
	});

	it('a cut after the last isolate is the plain cut', () => {
		const text = `${FSI}${ARABIC}${PDI}–1170`;
		expect(fitCardText(text, undefined, per(text) - 6, per, false)).toBe(`${FSI}${ARABIC}${PDI}–11…`);
		expect(fitCardText('1100–1170', undefined, 6 * 8, per, false)).toBe('1100–11…');
	});

	it('the named dates line takes the same closed cut', () => {
		const drawn = dateLineShown(person('a'), g.dates)!;
		const cut = fitCardText(drawn, ARABIC, per(FSI + 'حوا') + per('…') + per(PDI), per, false);
		expect(balanced(cut), JSON.stringify(cut)).toBe(true);
	});

	it('a title broken in the middle of a reign date closes the isolate on the first text line and opens it on the second', () => {
		const lines = titleLines('Qadi', reign, 100, per);
		expect(lines.length).toBe(2);
		for (const l of lines) expect(balanced(l), JSON.stringify(lines)).toBe(true);
		expect(lines[1].startsWith(FSI), JSON.stringify(lines)).toBe(true);
		expect(withoutControls(lines.join(' '))).toBe(withoutControls(`Qadi ${reign}`));
	});

	it('a reign with no title that is cut keeps its isolates paired', () => {
		const lines = titleLines(undefined, reign, per(`(r. ${FSI}حوا`) + per('…'), per);
		expect(lines.length).toBe(1);
		expect(balanced(lines[0]), JSON.stringify(lines)).toBe(true);
	});

	it('a title that fits whole or in two clean text lines is not changed', () => {
		expect(titleLines('Qadi', reign, per(`Qadi ${reign}`), per)).toEqual([`Qadi ${reign}`]);
		expect(titleLines('Qadi', reign, per(reign), per)).toEqual(['Qadi', reign]);
	});

	it('the pick of the reign with names accepts a text line that carries the closing and opening controls', () => {
		// Nothing is cut, so the named reign is kept even if the break had to add controls.
		expect(pickReign('Qadi', reign, '(r. 1100–1170)', 100, per, true)).toBe(reign);
	});

	it('every text of the live card and of the saved picture is paired when the room is narrow', () => {
		const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
		// A wide measure, so that every dates line and every reign is cut.
		const wide = (s: string, font: string) => [...withoutControls(s)].length * 1.4 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure: wide, link: () => null, labels });
		const live = all(root).filter((e) => e.hasClass('dynasty-card-dates') || e.hasClass('dynasty-card-title')).map((e) => e.getText());
		const svg = [...renderSvg(g, laid.layout, laid.edges, { measure: wide, fonts, labels }).matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
		const cut = live.filter((t) => t.includes(LRM) && t.endsWith('…'));
		expect(cut.length).toBeGreaterThan(0);
		// A card text holds marks and no isolate, so nothing can stay open.
		for (const t of [...live, ...svg]) expect(count(t, FSI) + count(t, PDI), t).toBe(0);
	});

	it('the headless cut of a saved picture with no measure keeps its isolates paired', () => {
		const laid = layoutTree(g, geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
		const svg = [...renderSvg(g, laid.layout, laid.edges, { labels }).matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
		expect(svg.some((t) => t.includes(LRM))).toBe(true);
		for (const t of svg) expect(count(t, FSI) + count(t, PDI), t).toBe(0);
	});
});

describe('the isolate helpers of a cut', () => {
	const per = (s: string) => [...s].length * 6;

	it('closeIsolates closes every open isolate and returns a closed text as it is', () => {
		expect(closeIsolates(`a${FSI}b`)).toBe(`a${FSI}b${PDI}`);
		expect(closeIsolates(`a${FSI}b…`)).toBe(`a${FSI}b${PDI}…`);
		expect(closeIsolates(`a${FSI}${FSI}b`)).toBe(`a${FSI}${FSI}b${PDI}${PDI}`);
		expect(closeIsolates(`a${FSI}b${PDI}c`)).toBe(`a${FSI}b${PDI}c`);
		expect(closeIsolates(`a${FSI}`)).toBe('a');
		expect(closeIsolates(`a${FSI}…`)).toBe('a…');
		expect(closeIsolates('plain…')).toBe('plain…');
	});

	it('carryIsolates closes a line that leaves an isolate open and opens it on the next line', () => {
		expect(carryIsolates([`a ${FSI}b`, `c${PDI} d`])).toEqual([`a ${FSI}b${PDI}`, `${FSI}c${PDI} d`]);
		expect(carryIsolates(['a b', 'c d'])).toEqual(['a b', 'c d']);
	});

	it('truncateClosed cuts a text with no isolate exactly as truncate cuts it', () => {
		for (const text of ['1100–1170', 'Qadi (r. 1100–1170)', 'x']) for (const w of [0, 6, 18, 60, 200]) expect(truncateClosed(text, w, per)).toBe(truncate(text, w, per));
	});

	it('truncateClosed measures the text that it returns', () => {
		const text = `(r. ${FSI}${ARABIC}${PDI}–1170)`;
		for (const w of [18, 36, 60, 90, 120]) {
			const cut = truncateClosed(text, w, per);
			expect(per(cut), JSON.stringify(cut)).toBeLessThanOrEqual(w);
		}
	});
});

describe('the approximate width of a text', () => {
	it('gives the isolate controls and the direction marks no width', () => {
		const marks = String.fromCharCode(0x200e) + String.fromCharCode(0x200f);
		expect(textWidth(FSI + 'x' + PDI, 12)).toBe(textWidth('x', 12));
		expect(textWidth(String.fromCharCode(0x2066) + 'x' + String.fromCharCode(0x2067) + marks, 12)).toBe(textWidth('x', 12));
	});
});
