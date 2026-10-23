// Spec §14 rule 15 (WP-6 step 2): the names of the years on the drawn card (live scene and saved picture, each with its own measure, also at a
// refit), the cut in three steps (names, no names, "…"), the reign on a card, the legend of the saved picture, and the phone list rows.
import { describe, expect, it } from 'vitest';

import { compileCalendars, type DateReader, type NameList } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardLabels } from '../../src/core/titles';
import { cardForm, cardText, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { pickReign, fitNamed } from '../../src/render/date-fit';
import { buildScene } from '../../src/render/dom/scene';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { titleLines } from '../../src/render/name-lines';
import { shownReign } from '../../src/render/tree-info';
import { savedLegend } from '../../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg, textWidth } from '../../src/render/svg-string';
import { listData, listWord } from '../../src/view/phone-list';
import { FEl } from '../acceptance/fake-dom';
import { setIcon } from '../acceptance/fake-obsidian';
import { cycles, list } from '../dates-support/names';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const planets = (over: Partial<NameList> = {}) => list(over);
const reader = (lists: NameList[] = [planets()]): DateReader => compileCalendars([cycles('C', ['{cycle}.{year} {planet}', '{cycle}.{year}'], lists)], true);

const SRC = [
	'options:', '  me: c', 'titles:', '  - id: crown', '    name: Duke', '    holders:', '      - {person: c, from: "22.13", to: "22.14"}',
	'people:', '  - {id: a, name: Aldric, born: "22.10", died: "22.12"}', '  - {id: c, name: Cedric, born: "22.13", died: "22.14", parents: [a]}', '  - {id: d, name: Dora, born: "1131", parents: [a]}', '',
].join('\n');

function laid(dates: DateReader, src = SRC) {
	const parsed = parseDynasty(src);
	if (!parsed.ok) throw new Error('does not parse');
	const g = deriveFamilies(parsed.tree, { dates });
	clearLayoutCache();
	const geo = cardForm(geometryFor(12), 'down');
	const l = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS } as LayoutSettings, 'test');
	return { g, l, labels: cardLabels(g), geo };
}

/** The room of the small text lines of the card, and the font size they are measured with. */
const small = (geo: ReturnType<typeof laid>['geo']) => {
	const t = cardText(geo);
	return { textW: t.textW, px: t.smallSize };
};
/** A measure of `k` em for a character: a text of `n` characters is `n * k * px` wide. */
const wide = (k: number) => (s: string, font: string) => [...s].length * k * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
/** The `k` at which a text of `n` characters is just as wide as the room. */
const kFor = (geo: ReturnType<typeof laid>['geo'], n: number) => small(geo).textW / (n * small(geo).px);

// `nb` keeps a reign on one text line: no-break spaces and a word joiner after the dash.
const JOINERS = new RegExp(String.fromCharCode(0x2060), 'g');
const NBSP = new RegExp(String.fromCharCode(0xa0), 'g');
const NARROW = new RegExp(String.fromCharCode(0x202f), 'g');
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const textsOf = (root: FEl, cls: string) => all(root).filter((e) => e.hasClass(cls)).map((e) => e.getText());
// A range with names has a thin space (U+2009) on each side of its dash (D278); a plain range keeps the plain dash.
const THIN = String.fromCharCode(0x2009);
const NAMED = `22.13 Sa${THIN}–${THIN}22.14 Ju`;
const PLAIN = '22.13–22.14';

describe('§14 rule 15: the live scene cuts in three steps, also at a refit', () => {
	const scene = (k: () => number, dates = reader()) => {
		const { g, l, labels, geo } = laid(dates);
		const root = new FEl('g');
		const measure = (s: string, font: string) => wide(k())(s, font);
		const s = buildScene(root as unknown as SVGGElement, g, l, { fonts: FONTS, measure, link: () => null, labels, me: 'c' });
		return { root, s, geo, g };
	};
	const dateOf = (root: FEl) => {
		const all2 = textsOf(root, 'dynasty-card-dates');
		return all2.find((t) => t.includes('22.1') && t.includes('–') && !t.startsWith('22.10')) ?? all2.join('|');
	};

	it('draws the names while the whole text fits, the text as written when only that fits, and a cut text when nothing fits', () => {
		const { geo } = laid(reader());
		let k = kFor(geo, NAMED.length) * 0.95;
		const { root, s } = scene(() => k);
		const first = dateOf(root);
		// Between the two widths: the named text (17 characters) is too wide and the written text (11 characters) fits.
		k = kFor(geo, 14);
		s.refit();
		const second = dateOf(root);
		// Too narrow for both: the written text is cut with "…" (never the named text).
		k = kFor(geo, 6);
		s.refit();
		const third = dateOf(root);
		// Wide again: the names come back.
		k = kFor(geo, NAMED.length) * 0.95;
		s.refit();
		expect({ first, second, fourth: dateOf(root) }).toEqual({ first: NAMED, second: PLAIN, fourth: NAMED });
		expect(third.endsWith('…'), third).toBe(true);
		expect(third.startsWith('22.1'), third).toBe(true);
		expect(third.includes('Sa'), third).toBe(false);
	});

	it('a person with a single date gets the name after "b."', () => {
		const { root } = scene(() => 0.3);
		expect(textsOf(root, 'dynasty-card-dates')).toContain('b. 1131');
		expect(textsOf(root, 'dynasty-card-dates').some((t) => t === 'b. 1131 Mo' || t === 'b. 1131')).toBe(true);
	});

	it('a tree with no list draws the text as written', () => {
		const { root } = scene(() => 0.3, reader([]));
		expect(textsOf(root, 'dynasty-card-dates')).toEqual(['22.10–22.12', PLAIN, 'b. 1131']);
	});

	it('the screen-reader label of the card has the full names and is not cut, whatever the width', () => {
		const { root } = scene(() => kFor(laid(reader()).geo, 6));
		const card = all(root).find((e) => e.getAttribute('data-person') === 'c')!;
		expect(card.getAttribute('aria-label')).toContain(`22.13 Saturn${THIN}–${THIN}22.14 Jupiter`);
		expect(card.getAttribute('aria-label')).toContain(`(r. 22.13 Saturn${THIN}–${THIN}22.14 Jupiter)`);
	});

	it('the reign on the card takes the names while the title and the reign fit the text line, else the reign as written', () => {
		const { geo } = laid(reader());
		let k = kFor(geo, `Duke (r. 22.13 Sa${THIN}–${THIN}22.14 Ju)`.length) * 0.95;
		const { root, s } = scene(() => k);
		const title = () => textsOf(root, 'dynasty-card-title').find((t) => t.startsWith('Duke'));
		const first = title();
		k = kFor(geo, 'Duke (r. 22.13–22.14)'.length) * 0.98;
		s.refit();
		const second = title();
		k = kFor(geo, 8);
		s.refit();
		const third = title();
		expect({ first, second }).toEqual({ first: `Duke (r. 22.13 Sa${THIN}–${THIN}22.14 Ju)`, second: 'Duke (r. 22.13–22.14)' });
		expect(third?.endsWith('…'), third).toBe(true);
		expect(third?.includes('Sa')).toBe(false);
	});
});

describe('§14 rule 15: the saved picture cuts in three steps with its own measure', () => {
	const svg = (measure: ((s: string, font: string) => number) | undefined, dates = reader(), saved = true) => {
		const { g, l, labels } = laid(dates);
		return renderSvg(g, l.layout, l.edges, {
			palette: DEFAULT_LIGHT, dark: false, measure, fonts: FONTS, labels, me: 'c',
			...(saved ? { saved: { heading: 'T', legend: savedLegend(g, l), pictures: new Map(), scale: 1 } } : {}),
		});
	};
	// The date lines of all cards, in the order of the cards (every card of the sample has one); the one of Cedric is picked by his place.
	const dates = (out: string) => {
		const texts = [...out.matchAll(new RegExp(`fill="${DEFAULT_LIGHT.dates}">([^<]*)<`, 'g'))].map((m) => m[1]).filter((t) => (/\d/.test(t) || t.endsWith('…')) && !t.startsWith('Duke'));
		return [texts[[...laid(reader()).l.layout.persons.keys()].indexOf('c')]];
	};
	const geo = laid(reader()).geo;

	it('draws the names when the whole text fits, the written text when only that fits, a cut text when nothing fits', () => {
		expect(dates(svg(wide(kFor(geo, NAMED.length) * 0.95)))).toEqual([NAMED]);
		expect(dates(svg(wide(kFor(geo, 14))))).toEqual([PLAIN]);
		const cut = dates(svg(wide(kFor(geo, 6))));
		expect(cut).toHaveLength(1);
		expect(cut[0].endsWith('…') && !cut[0].includes('Sa'), cut[0]).toBe(true);
	});

	it('the headless measure and a measured one are two measures: each picks its own', () => {
		const headless = dates(svg(undefined));
		const huge = dates(svg(wide(1.5)));
		expect(headless).toHaveLength(1);
		expect(huge).toHaveLength(1);
		expect(huge[0].endsWith('…'), huge[0]).toBe(true);
		expect(headless[0].length).toBeGreaterThanOrEqual(PLAIN.length - 1);
	});

	it('the live view picture (not saved) cuts the same way', () => {
		expect(dates(svg(wide(kFor(geo, 14)), reader(), false))).toEqual([PLAIN]);
		expect(dates(svg(wide(kFor(geo, NAMED.length) * 0.95), reader(), false))).toEqual([NAMED]);
	});

	it('the reign in the picture takes the names while it fits', () => {
		const title = (out: string) => [...out.matchAll(/>(Duke[^<]*)</g)].map((m) => m[1]);
		expect(title(svg(wide(kFor(geo, `Duke (r. 22.13 Sa${THIN}–${THIN}22.14 Ju)`.length) * 0.95)))).toEqual([`Duke (r. 22.13 Sa${THIN}–${THIN}22.14 Ju)`]);
		expect(title(svg(wide(kFor(geo, 'Duke (r. 22.13–22.14)'.length) * 0.98)))).toEqual(['Duke (r. 22.13–22.14)']);
	});

	it('the legend looks for the sign only, so a name never makes a sign', () => {
		const { g, l } = laid(reader());
		expect(savedLegend(g, l).dead).toBeUndefined();
		const dead = deriveFamilies((parseDynasty(SRC.replace('died: "22.12"', 'died: yes')) as { ok: true; tree: never }).tree, { dates: reader() });
		const laidDead = layoutTree(dead, cardForm(geometryFor(12), 'down'), { ...DEFAULT_LAYOUT_SETTINGS } as LayoutSettings, 'dead');
		expect(savedLegend(dead, laidDead).dead).toEqual(['dead']);
	});
});

describe('the cut helpers', () => {
	const m = (s: string) => [...s].length * 10;
	const cut = (s: string) => (m(s) <= 50 ? s : `${s.slice(0, 4)}…`);

	it('fitNamed: names, then the written text, then a cut of the written text', () => {
		expect(fitNamed('ab Sa', 'ab', 50, m, cut)).toBe('ab Sa');
		expect(fitNamed('abcd Sa', 'abcd', 50, m, cut)).toBe('abcd');
		expect(fitNamed('abcdefgh Sa', 'abcdefgh', 50, m, cut)).toBe('abcd…');
		expect(fitNamed('abcdefgh', 'abcdefgh', 50, m, cut)).toBe('abcd…');
	});

	it('pickReign: the reign with names only if every text line holds and nothing is cut', () => {
		const w = (s: string) => [...s].length * 10;
		expect(pickReign('Duke', '(r. 1 Sa)', '(r. 1)', 200, w, false)).toBe('(r. 1 Sa)');
		expect(pickReign('Duke', '(r. 1 Sa)', '(r. 1)', 100, w, false)).toBe('(r. 1)');
		// Two text lines: the title on the first, the longer reign on the second.
		expect(pickReign('Duke', '(r. 123 Sa)', '(r. 123)', 120, w, true)).toBe('(r. 123 Sa)');
		expect(titleLines('Duke', '(r. 123 Sa)', 120, w)).toEqual(['Duke', '(r. 123 Sa)']);
		// Two text lines are not enough for the names: the written reign.
		expect(pickReign('Duke of Valmont and Orsini', '(r. 1200 Sa–1210 Ju)', '(r. 1200–1210)', 120, w, true)).toBe('(r. 1200–1210)');
		// No reign, or no names: the reign is what it is.
		expect(pickReign('Duke', undefined, undefined, 100, w, true)).toBeUndefined();
		expect(pickReign('Duke', '(r. 1 Sa)', undefined, 100, w, true)).toBeUndefined();
		expect(pickReign('Duke', '(r. 1)', '(r. 1)', 100, w, true)).toBe('(r. 1)');
	});
});

describe('§14 rule 15: the rows of the phone list', () => {
	const make = (dates: DateReader, showDates = true) => {
		const { g } = laid(dates);
		const parent = new FEl('div', { cls: 'dynasty-viewport' });
		const spec: PhoneListSpec = {
			g, data: listData(g, 'c'), me: 'c', showDates, editable: false,
			word: (id) => listWord(id, { me: 'c', showRelations: false, cards: new Map() }),
			icon: setIcon as unknown as PhoneListSpec['icon'], pictures: () => undefined, onGo: () => undefined, onEdit: () => undefined,
		};
		const res = buildPhoneList(parent as unknown as HTMLElement, spec);
		return res.list as unknown as FEl;
	};
	const years = (listEl: FEl, id: string) => listEl.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-years`)?.getText();

	it('shows the names after the dates, and the reign of the hero row with names', () => {
		const el = make(reader());
		expect(years(el, 'c')).toBe(NAMED);
		expect(years(el, 'a')).toBe(`22.10 Ve${THIN}–${THIN}22.12 Mo`);
		// The reign never breaks (G.2): a word joiner sits after the dash.
		expect(el.querySelector('.dynasty-hero-title')?.getText().replace(JOINERS, '').replace(NBSP, ' ').replace(NARROW, THIN)).toContain(`Duke (r. 22.13 Sa${THIN}–${THIN}22.14 Ju)`);
	});

	it('shows the text as written with no list, and nothing when dates are off', () => {
		const el = make(reader([]));
		expect(years(el, 'c')).toBe(PLAIN);
		expect(el.querySelector('.dynasty-hero-title')?.getText().replace(JOINERS, '').replace(NBSP, ' ')).toContain('Duke (r. 22.13–22.14)');
		expect(years(make(reader(), false), 'c')).toBeUndefined();
	});
});

describe('the layout', () => {
	it('keeps the same card width with and without names (the layout does not look at the date text)', () => {
		const a = laid(reader());
		const b = laid(reader([]));
		const widths = (x: ReturnType<typeof laid>) => [...x.l.layout.persons.values()].map((p) => [p.id, p.x, p.w, p.h]);
		expect(widths(a)).toEqual(widths(b));
		expect(textWidth('22.13 Sa', 13.6)).toBeGreaterThan(textWidth('22.13', 13.6));
	});
});

describe('D278 item 3: a range with a word of its own ("c.") has the thin spaces, a plain range has not, in both renderers', () => {
	// No list: the only reason for the spaces is the word. The reign has a word too.
	const WORD = SRC.replace('born: "22.13", died: "22.14"', 'born: "c. 1131", died: "1160"').replace('from: "22.13", to: "22.14"', 'from: "c. 1131", to: "1160"');
	const SPACED = `c. 1131${THIN}–${THIN}1160`;
	const plainTree = SRC.replace('born: "22.13", died: "22.14"', 'born: "1131", died: "1160"');
	const live = (src: string, k: number) => {
		const { g, l, labels } = laid(reader([]), src);
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, l, { fonts: FONTS, measure: wide(k), link: () => null, labels, me: 'c' });
		return textsOf(root, 'dynasty-card-dates');
	};
	const saved = (src: string, k: number) => {
		const { g, l, labels } = laid(reader([]), src);
		const out = renderSvg(g, l.layout, l.edges, { palette: DEFAULT_LIGHT, dark: false, measure: wide(k), fonts: FONTS, labels, me: 'c' });
		return [...out.matchAll(new RegExp(`fill="${DEFAULT_LIGHT.dates}">([^<]*)<`, 'g'))].map((m) => m[1]);
	};

	it('the live card and the saved picture draw the spaced range', () => {
		expect(live(WORD, 0.3)).toContain(SPACED);
		expect(saved(WORD, 0.3)).toContain(SPACED);
	});

	it('a plain range keeps the plain dash in both', () => {
		expect(live(plainTree, 0.3)).toContain('1131–1160');
		expect(saved(plainTree, 0.3)).toContain('1131–1160');
		expect(live(plainTree, 0.3).join('')).not.toContain(THIN);
		expect(saved(plainTree, 0.3).join('')).not.toContain(THIN);
	});

	it('the cut measures the spaced text: a width that holds the plain text but not the spaced one cuts it', () => {
		const { geo } = laid(reader([]), WORD);
		const just = (n: number) => kFor(geo, n);
		// The spaced text is two characters longer than the plain one: at the width of the plain one it does not fit, so the live card cuts it.
		const cut = live(WORD, just('c. 1131–1160'.length) * 0.99);
		expect(cut.some((t) => t.startsWith('c. 1131') && t.endsWith('…')), cut.join('|')).toBe(true);
		expect(live(WORD, just(SPACED.length) * 0.95)).toContain(SPACED);
		expect(saved(WORD, just(SPACED.length) * 0.95)).toContain(SPACED);
	});

	it('the reign with a word has the spaced dash, a plain reign has not', () => {
		const { g, labels } = laid(reader([]), WORD);
		expect(shownReign(labels.get('c'), g.dates, 'shown')).toBe(`(r. ${SPACED})`);
		expect(shownReign(laid(reader([]), plainTree).labels.get('c'), g.dates, 'shown')).toBe('(r. 22.13–22.14)');
	});
	it('the phone list shows the spaced range, and the plain range with the plain dash', () => {
		const rows = (src: string) => {
			const { g } = laid(reader([]), src);
			const parent = new FEl('div', { cls: 'dynasty-viewport' });
			const spec: PhoneListSpec = {
				g, data: listData(g, 'c'), me: 'c', showDates: true, editable: false,
				word: (id) => listWord(id, { me: 'c', showRelations: false, cards: new Map() }),
				icon: setIcon as unknown as PhoneListSpec['icon'], pictures: () => undefined, onGo: () => undefined, onEdit: () => undefined,
			};
			const el = buildPhoneList(parent as unknown as HTMLElement, spec).list as unknown as FEl;
			return el.querySelector('.dynasty-list-row[data-person="c"] .dynasty-list-years')?.getText();
		};
		expect(rows(WORD)).toBe(SPACED);
		expect(rows(plainTree)).toBe('1131–1160');
	});
});
