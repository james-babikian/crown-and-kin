import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import type { CardLabel } from '../src/core/titles';
import { cardText, drawnGeometry, geometryFor, relationExtra, relationY, tallExtra, withRelationLine } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import type { LaidOut, LayoutSettings, PersonBox } from '../src/layout/model';
import { buildScene, type SceneOptions } from '../src/render/dom/scene';
import { tallCardsFor, tallTitlesFor, titleMeasure } from '../src/render/dom/tall-cards';
import { titleLines } from '../src/render/name-lines';
import { renderSvg } from '../src/render/svg-string';
import { cardLabel } from '../src/render/tree-info';
import { FEl, installDom } from './acceptance/fake-dom';
import { build, fixture } from './helpers';
import { lineProblems, randomTree } from './random-trees';

// WP8.2 (spec §13.3, §13.5; D37, D58, D61–D63): cards taller for a two-line title text line in every
// layout, the cache key, `cardText` baselines, `titleLines`, `tallTitlesFor`, and the scene and the
// headless SVG drawing card labels. The labels here are hand-made `CardLabel`s (WP8.1 builds the real ones).

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const GEO = geometryFor(16, 'normal');
const SIDE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'normal' };
const NARROW: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'narrow', narrowCardW: 140 };
const VIEWS = [
	['down', DEFAULT_LAYOUT_SETTINGS],
	['sideways', SIDE],
	['sideways narrow', NARROW],
] as const;
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const fonts = { text: 'serif', ui: 'sans', bold: '700' };
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const len = (s: string) => s.length;

const lay = (g: FamilyGraph, settings: LayoutSettings, geo = GEO): LaidOut => {
	clearLayoutCache();
	return layoutTree(g, geo, settings, 'test');
};
const overlaps = (boxes: PersonBox[]) => {
	const bad: string[] = [];
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const [a, b] = [boxes[i], boxes[j]];
			if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`${a.id} overlaps ${b.id}`);
		}
	}
	return bad;
};

const label = (name: string, title?: string, reign?: string): CardLabel => ({ holdings: [], selected: false, name, ...(title !== undefined ? { title } : {}), ...(reign !== undefined ? { reign } : {}) });

describe('D61: a card in tallTitles is one small text line taller, in every layout', () => {
	for (const size of ['normal', 'compact'] as const) {
		for (const [view, settings] of VIEWS) {
			it(`${view}, ${size} cards: own heights (plain, name, title, both), flags only when true, rows and order kept`, () => {
				const { g } = build(fixture('07'));
				const geo = geometryFor(16, size);
				const ids = g.people.map((p) => p.id);
				const tallCards = ids.filter((_, i) => i % 5 === 0 || i % 5 === 1);
				const tallTitles = ids.filter((_, i) => i % 5 === 1 || i % 5 === 2);
				const plain = lay(g, settings, geo);
				const tall = lay(g, { ...settings, tallCards, tallTitles }, geo);
				const cardH = tall.layout.geometry.cardH;
				expect(cardH).toBe(plain.layout.geometry.cardH);
				for (const [id, box] of tall.layout.persons) {
					const name = tallCards.includes(id);
					const title = tallTitles.includes(id);
					expect(box.h, id).toBe(cardH + (name ? tallExtra(geo) : 0) + (title ? relationExtra(geo) : 0));
					expect(box.w, id).toBe(tall.layout.geometry.cardW);
					expect(box.tallName, id).toBe(name ? true : undefined);
					expect(box.tallTitle, id).toBe(title ? true : undefined);
					expect('tallName' in box, id).toBe(name);
					expect('tallTitle' in box, id).toBe(title);
				}
				expect(overlaps([...tall.layout.persons.values()])).toEqual([]);
				expect(lineProblems(g, tall.layout, tall.edges)).toEqual([]);
				// D2: rows and sibling order are the same.
				expect(tall.layout.rows).toEqual(plain.layout.rows);
			});
		}
	}

	it('down: a row starts under the tallest card of the row above it', () => {
		const { g } = build(fixture('03'));
		const row0 = lay(g, DEFAULT_LAYOUT_SETTINGS).layout.rows[0];
		for (const sets of [{ tallTitles: [row0[0]] }, { tallCards: [row0[0]], tallTitles: [row0[0]] }, { tallCards: [row0[0]], tallTitles: [row0[1]] }]) {
			const { layout } = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...sets });
			const bottom = Math.max(...layout.rows[0].map((id) => layout.persons.get(id)!.y + layout.persons.get(id)!.h));
			expect(layout.rowGaps[0].top).toBe(bottom);
			for (const id of layout.rows[1]) expect(layout.persons.get(id)!.y).toBe(layout.rowGaps[0].bottom);
		}
		// Two tall sets on two cards: the row takes the taller card, not the sum.
		const { layout } = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: [row0[0]], tallTitles: [row0[1]] });
		expect(layout.rowGaps[0].top).toBe(GEO.cardH + tallExtra(GEO));
	});

	it('sideways: each card keeps its own height; the next card in the column starts below it', () => {
		const { g } = build(fixture('03'));
		const plain = lay(g, SIDE).layout;
		const col = plain.rows.find((r) => r.length > 2)!;
		const { layout } = lay(g, { ...SIDE, tallTitles: [col[0]] });
		const [a, b] = [layout.persons.get(col[0])!, layout.persons.get(col[1])!];
		expect(a.h).toBe(GEO.cardH + relationExtra(GEO));
		expect(b.h).toBe(GEO.cardH);
		expect(b.y).toBeGreaterThanOrEqual(a.y + a.h + layout.geometry.coupleGap - 0.001);
	});

	it('with the relation line the extras stack on the taller card', () => {
		const { g } = build(fixture('04'));
		const id = g.people[0].id;
		for (const [, settings] of VIEWS) {
			const { layout } = lay(g, { ...settings, relationLine: true, tallCards: [id], tallTitles: [id] });
			expect(layout.persons.get(id)!.h).toBe(GEO.cardH + relationExtra(GEO) + tallExtra(GEO) + relationExtra(GEO));
			expect(layout.geometry.cardH).toBe(drawnGeometry(GEO, { ...settings, relationLine: true }).cardH);
		}
	});

	it('card sizes at 16 px: plain 61, two-line name 77, two-line title 77, both 93; narrow cards the same heights (D117: 3.8 em cards, 16 px per name text line)', () => {
		const { g } = build('people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C}\n  - {id: d, name: D}\n');
		for (const [view, settings] of VIEWS) {
			const { layout } = lay(g, { ...settings, tallCards: ['b', 'd'], tallTitles: ['c', 'd'] });
			const h = (id: string) => layout.persons.get(id)!.h;
			expect([h('a'), h('b'), h('c'), h('d')], view).toEqual([61, 77, 77, 93]);
		}
		expect(lay(g, NARROW).layout.geometry.cardW).toBe(140);
	});

	it('random trees, a third of the people with a tall title and a fifth with a tall name: no line problems, no overlaps', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 25; seed++) {
			const { g } = build(randomTree(seed));
			const tallTitles = g.people.filter((_, i) => i % 3 === 0).map((p) => p.id);
			const tallCards = g.people.filter((_, i) => i % 5 === 0).map((p) => p.id);
			for (const [view, settings] of VIEWS) {
				const { layout, edges } = lay(g, { ...settings, tallCards, tallTitles });
				bad.push(...lineProblems(g, layout, edges).map((p) => `${seed} ${view}: ${p}`));
				bad.push(...overlaps([...layout.persons.values()]).map((p) => `${seed} ${view}: ${p}`));
			}
		}
		expect(bad).toEqual([]);
	});
});

describe('D61: the cache key holds both tall sets', () => {
	const { g } = build(fixture('03'));
	const [a, b] = g.people.map((p) => p.id);

	it('none, empty or unknown ids leave the key and the layout of today', () => {
		const base = layoutKey(g, GEO, DEFAULT_LAYOUT_SETTINGS, 'f');
		for (const tallTitles of [[], ['nobody'], undefined]) {
			expect(layoutKey(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallTitles }, 'f')).toBe(base);
			expect(layoutKey(g, GEO, { ...SIDE, tallTitles }, 'f')).toBe(layoutKey(g, GEO, SIDE, 'f'));
		}
		expect(lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallTitles: [] })).toEqual(lay(g, DEFAULT_LAYOUT_SETTINGS));
	});

	it('sorted and each id once; the two sets are told apart', () => {
		const key = (s: Partial<LayoutSettings>) => layoutKey(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, ...s }, 'f');
		expect(key({ tallTitles: [b, a] })).toBe(key({ tallTitles: [a, b, a] }));
		expect(key({ tallTitles: [a] })).not.toBe(key({}));
		expect(key({ tallTitles: [a] })).not.toBe(key({ tallCards: [a] }));
		expect(key({ tallTitles: [a], tallCards: [b] })).not.toBe(key({ tallTitles: [b], tallCards: [a] }));
		expect(key({ tallTitles: [a], tallCards: [a] })).not.toBe(key({ tallCards: [a] }));
		expect(layoutKey(g, GEO, { ...NARROW, tallTitles: [a] }, 'f')).not.toBe(layoutKey(g, GEO, NARROW, 'f'));
	});

	it('the cache keeps the layouts apart', () => {
		clearLayoutCache();
		const plain = layoutTree(g, GEO, DEFAULT_LAYOUT_SETTINGS, 'f');
		const tall = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, tallTitles: [a] }, 'f');
		expect(tall.layout.persons.get(a)!.h).toBe(GEO.cardH + relationExtra(GEO));
		expect(layoutTree(g, GEO, DEFAULT_LAYOUT_SETTINGS, 'f')).toBe(plain);
	});
});

describe('D61: cardText with a two-line title text line', () => {
	for (const size of ['normal', 'compact'] as const) {
		for (const relation of [false, true]) {
			for (const tallName of [false, true]) {
				it(`${size}${relation ? ', relation line' : ''}${tallName ? ', two-line name' : ''}`, () => {
					const plain = geometryFor(16, size);
					const geo = relation ? withRelationLine(plain, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true }) : plain;
					const lh = size === 'normal' ? 1.2 : 1.1;
					const t = cardText(geo, tallName);
					const tt = cardText(geo, tallName, true);
					const smallLine = lh * tt.smallSize;
					const h = geo.cardH + (tallName ? tallExtra(geo) : 0) + relationExtra(geo);
					expect(t.title2Baseline).toBeUndefined();
					expect(tt.title2Baseline! - tt.titleBaseline).toBeCloseTo(smallLine, 6);
					expect(tt.datesBaseline - tt.title2Baseline!).toBeCloseTo(smallLine, 6);
					if (relation) expect(tt.relationBaseline! - tt.datesBaseline).toBeCloseTo(smallLine, 6);
					else expect(tt.relationBaseline).toBeUndefined();
					expect(tt.name2Baseline === undefined).toBe(!tallName);
					// The block stays centred, up to the rounding of the extra height.
					expect(Math.abs(tt.nameBaseline - t.nameBaseline)).toBeLessThanOrEqual(0.5);
					const last = tt.relationBaseline ?? tt.datesBaseline;
					const top = tt.nameBaseline - (lh * tt.nameSize) / 2 - 0.35 * tt.nameSize;
					const bottom = h - (last - 0.35 * tt.smallSize + smallLine / 2);
					expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
					expect([tt.stripW, tt.padX, tt.textW, tt.nameWithSignW]).toEqual([t.stripW, t.padX, t.textW, t.nameWithSignW]);
				});
			}
		}
	}

	it('with no tall flag cardText is exactly as before', () => {
		expect(cardText(GEO, false, false)).toEqual(cardText(GEO));
		expect(Object.keys(cardText(GEO))).not.toContain('title2Baseline');
		expect(cardText(GEO, true, false)).toEqual(cardText(GEO, true));
	});

	it('relationY counts a two-line title as two text lines', () => {
		const geo = withRelationLine(GEO, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
		const t = cardText(geo, false, true);
		expect(relationY(t, true, true)).toBe(t.relationBaseline);
		expect(relationY(t, true, false)).toBe(t.datesBaseline);
		expect(relationY(t, false, true)).toBe(t.title2Baseline);
		expect(relationY(t, false, false)).toBe(t.titleBaseline);
		expect(relationY(cardText(GEO, false, true), true, true)).toBeUndefined();
	});
});

describe('D61: titleLines (spec §13.3 break rule)', () => {
	it('fits on one text line', () => {
		expect(titleLines('Count', '(r. 1175–1207)', 30, len)).toEqual(['Count (r. 1175–1207)']);
		expect(titleLines('Count', '(r. 1175–1207)', 20, len)).toEqual(['Count (r. 1175–1207)']);
	});

	it('breaks before the reign when the title fits alone', () => {
		expect(titleLines('Duke of Valmont', '(r. 1131–1160)', 20, len)).toEqual(['Duke of Valmont', '(r. 1131–1160)']);
		expect(titleLines('Duke of Valmont', '(r. from 1160)', 15, len)).toEqual(['Duke of Valmont', '(r. from 1160)']);
	});

	it('breaks before the reign only while the reign fits on the second text line (spec §13.3)', () => {
		// The reign exactly fills text line 2: the break stays before "(r.", not at the last space.
		expect(titleLines('Count', '(r. 1131–1140, 1145–1160)', 25, len)).toEqual(['Count', '(r. 1131–1140, 1145–1160)']);
		// One character narrower the reign no longer fits alone: the last-space break keeps all of it.
		expect(titleLines('Count', '(r. 1131–1140, 1145–1160)', 24, len)).toEqual(['Count (r. 1131–1140,', '1145–1160)']);
	});

	it('a long title breaks at the last space that fits', () => {
		expect(titleLines('Grand Duke of Valmont', '(r. 1131–1160)', 18, len)).toEqual(['Grand Duke of', 'Valmont (r. 1131–…']);
		expect(titleLines('Duchess of the Isles', '(r. 1131–1160)', 19, len)).toEqual(['Duchess of the', 'Isles (r. 1131–1160)'.slice(0, 18) + '…']);
		expect(titleLines('Lady of the Isles', '(r. 1131)', 16, len)).toEqual(['Lady of the', 'Isles (r. 1131)']);
	});

	it('text beyond two text lines ends with "…", and every text line fits', () => {
		const lines = titleLines('Grand Duchess of the Western Marches and the Isles', '(r. 1131–1140, from 1145)', 24, len);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe('Grand Duchess of the');
		expect(lines[1].endsWith('…')).toBe(true);
		for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
		// A reign too long for the second text line alone: the last-space break, and only the rest is cut.
		expect(titleLines('Count', '(r. 1131–1140, 1145–1160, from 1170)', 20, len)).toEqual(['Count (r. 1131–1140,', '1145–1160, from 117…']);
	});

	it('dates off (no reign): one text line cut with "…", as a 0.1 title', () => {
		expect(titleLines('Grand Duchess of the Western Marches', undefined, 24, len)).toEqual(['Grand Duchess of the We…']);
		expect(titleLines('Duke', undefined, 24, len)).toEqual(['Duke']);
		expect(titleLines('Duke', '', 24, len)).toEqual(['Duke']);
		expect(titleLines(undefined, undefined, 24, len)).toEqual([]);
		expect(titleLines('', undefined, 24, len)).toEqual([]);
	});

	it('a reign with no title: the reign alone, on one text line', () => {
		expect(titleLines(undefined, '(r. 1131–1160)', 30, len)).toEqual(['(r. 1131–1160)']);
		expect(titleLines('', '(r. 1131–1140, 1145–1160)', 12, len)).toEqual(['(r. 1131–11…']);
	});

	it('outer spaces do not count', () => {
		expect(titleLines('  Count ', ' (r. 1175–1207) ', 20, len)).toEqual(['Count (r. 1175–1207)']);
	});
});

describe('D61: tallTitlesFor and the name measure of tallCardsFor', () => {
	const { g } = build(`people:
  - {id: a, name: Aldric Valmont, title: Lord of the Keep}
  - {id: b, name: Bo}
  - {id: c, name: Cara}
  - {id: d, name: Dora}
  - {id: e, name: Roderick}
`);
	const labels = new Map<string, CardLabel>([
		['a', label('Aldric II', 'Lord of the Keep', '(r. 1131–1160)')],
		['b', label('Bo', 'Count', '(r. 1175)')],
		['c', label('Cara', 'Grand Duchess of the Western Marches', '(r. from 1145)')],
		['d', label('Dora', 'Duchess of the Western Marches and the Isles')],
		['e', label('Roderick Aurelian Castellane the Second', 'Duke', '(r. 1160–1190)')],
	]);
	const small = titleMeasure(GEO, fonts, measure);

	it('lists the people whose title text line has two text lines, sorted; none with dates off', () => {
		expect(tallTitlesFor(g, labels, GEO, true, small)).toEqual(['a', 'c']);
		expect(tallTitlesFor(g, labels, GEO, false, small)).toEqual([]);
		expect(tallTitlesFor(g, new Map(), GEO, true, small)).toEqual([]);
		for (const id of ['a', 'c']) {
			const l = labels.get(id)!;
			expect(titleLines(l.title, l.reign, cardText(GEO).textW, small)).toHaveLength(2);
		}
	});

	it('titleMeasure measures in the small card font', () => {
		expect(small('abcd')).toBe(measure('abcd', `400 ${cardText(GEO).smallSize}px serif`));
	});

	it('tallCardsFor measures the name text line of the label ("Roderick II" decides)', () => {
		expect(tallCardsFor(g, GEO, fonts, measure)?.tall).toEqual([]);
		expect(tallCardsFor(g, GEO, fonts, measure, undefined, labels)?.tall).toEqual(['e']);
		const long = build('people:\n  - {id: x, name: Maximilian Aurelian Castellane}\n').g;
		expect(tallCardsFor(long, GEO, fonts, measure)?.tall).toEqual(['x']);
		expect(tallCardsFor(long, GEO, fonts, measure, undefined, new Map([['x', label('Maximilian II')]]))?.tall).toEqual([]);
	});
});

/** A serialised scene: every element with its tag, classes, attributes and text. */
const dump = (root: FEl) => all(root).map((e) => [e.tag, [...e.classes].join(' '), [...e.attrs].map(([k, v]) => `${k}=${v}`).join(' '), e.text].join('|')).join('\n');

describe('M8: the scene draws card labels', () => {
	const { g } = build(`people:
  - {id: aldric, name: Aldric Valmont, title: Lord of the Keep, sex: m, born: '1102', died: '1160'}
  - {id: isolde, name: Isolde Orsini, sex: f, born: '1106'}
  - {id: rod, name: Roderick Valmont, sex: m, born: '1130', parents: [aldric, isolde]}
  - {id: kit, name: Kit Valmont, sex: m, parents: [aldric, isolde]}
unions:
  - {partners: [aldric, isolde]}
`);
	const labels = new Map<string, CardLabel>([
		['aldric', label('Aldric II', 'Lord of the Keep', '(r. 1131–1160)')],
		['isolde', label('Isolde Orsini')],
		['rod', label('Roderick', 'Duke of Valmont', '(r. from 1160)')],
		['kit', label('Kit IV', 'Count', '(r. 1175)')],
	]);
	const small = titleMeasure(GEO, fonts, measure);
	const tallTitles = tallTitlesFor(g, labels, GEO, true, small);
	const scene = (laid: LaidOut, extra: Partial<SceneOptions> = {}) => {
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: () => null, ...extra });
		return root;
	};
	const cardEl = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
	const texts = (root: FEl, id: string, cls: string) => all(cardEl(root, id)).filter((e) => e.hasClass(cls));

	it('the test labels need two title text lines for Aldric and Roderick only', () => {
		expect(tallTitles).toEqual(['aldric', 'rod']);
	});

	for (const [view, settings] of VIEWS) {
		it(`${view}: name from the label (Full and Compact), the title on its text lines, dates and relation below`, () => {
			const relationLine = view === 'down';
			const drawn = drawnGeometry(GEO, { ...settings, relationLine });
			const laid = lay(g, { ...settings, tallTitles: tallTitlesFor(g, labels, drawn, true, small), relationLine });
			const relations = new Map([['aldric', { text: 'Father', lower: 'father' }]]);
			const root = scene(laid, { labels, relations });
			for (const [id, l] of labels) {
				const box = laid.layout.persons.get(id)!;
				const t = cardText(laid.layout.geometry, box.tallName, box.tallTitle);
				expect(texts(root, id, 'dynasty-card-name').map((e) => e.text), id).toEqual([l.name]);
				// Compact names are 1.5 times larger, so a long one ends with "…".
				const compact = texts(root, id, 'dynasty-card-compact').map((e) => e.text);
				expect(compact, id).toHaveLength(1);
				expect(compact[0] === l.name || (compact[0].endsWith('…') && l.name.startsWith(compact[0].slice(0, -1))), `${id}: ${compact[0]}`).toBe(true);
				const want = titleLines(l.title, l.reign, t.textW, small);
				const title = texts(root, id, 'dynasty-card-title');
				expect(title.map((e) => e.text), id).toEqual(want);
				expect(title.map((e) => Number(e.getAttribute('y'))), id).toEqual([t.titleBaseline, t.title2Baseline].slice(0, want.length).map((y) => box.y + y!));
				const dates = texts(root, id, 'dynasty-card-dates');
				if (dates.length) expect(Number(dates[0].getAttribute('y')), id).toBe(box.y + (want.length ? t.datesBaseline : t.titleBaseline));
			}
			// Narrow cards (D24) are too narrow for "Lord of the Keep" alone: it breaks inside the title.
			expect(texts(root, 'aldric', 'dynasty-card-title').map((e) => e.text)).toEqual(view === 'sideways narrow' ? ['Lord of the', 'Keep (r. 1131–1160)'.slice(0, 14) + '…'] : ['Lord of the Keep', '(r. 1131–1160)']);
			expect(texts(root, 'kit', 'dynasty-card-title').map((e) => e.text)).toEqual(['Count (r. 1175)']);
			expect(texts(root, 'rod', 'dynasty-card-compact')[0].text).toBe('Roderick');
			expect(texts(root, 'aldric', 'dynasty-card-compact')[0].text).toBe('Aldric II');
			if (relationLine) {
				const box = laid.layout.persons.get('aldric')!;
				const rel = texts(root, 'aldric', 'dynasty-card-relation')[0];
				const t = cardText(laid.layout.geometry, false, true);
				expect(Number(rel.getAttribute('y'))).toBe(box.y + t.relationBaseline!);
				expect(t.relationBaseline).toBe(relationY(t, true, true));
			}
		});
	}

	it('the accessible name uses the label: ruler name, title with the reign, dates', () => {
		const root = scene(lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallTitles }), { labels });
		expect(cardEl(root, 'aldric').getAttribute('aria-label')).toBe('Aldric II, Lord of the Keep (r. 1131–1160), 1102–1160');
		expect(cardEl(root, 'isolde').getAttribute('aria-label')).toBe('Isolde Orsini, b. 1106');
		expect(cardLabel(g.byId.get('rod')!, 'son', labels.get('rod'))).toBe('Roderick, Duke of Valmont (r. from 1160), b. 1130, son');
		expect(cardLabel(g.byId.get('aldric')!)).toBe('Aldric Valmont, Lord of the Keep, 1102–1160');
		// The reign stays in the label with dates off, like the dates.
		const off = scene(lay(g, DEFAULT_LAYOUT_SETTINGS), { labels, showDates: false });
		expect(cardEl(off, 'aldric').getAttribute('aria-label')).toBe('Aldric II, Lord of the Keep (r. 1131–1160), 1102–1160');
	});

	it('dates off: no reign on any card, and one title text line', () => {
		expect(tallTitlesFor(g, labels, GEO, false, small)).toEqual([]);
		const root = scene(lay(g, DEFAULT_LAYOUT_SETTINGS), { labels, showDates: false });
		expect(texts(root, 'aldric', 'dynasty-card-title').map((e) => e.text)).toEqual(['Lord of the Keep']);
		expect(texts(root, 'rod', 'dynasty-card-title').map((e) => e.text)).toEqual(['Duke of Valmont']);
		for (const e of all(root)) expect(e.text).not.toContain('(r.');
	});

	it('a card the layout did not make taller shows one title text line, cut with "…"', () => {
		const root = scene(lay(g, DEFAULT_LAYOUT_SETTINGS), { labels });
		const title = texts(root, 'aldric', 'dynasty-card-title');
		expect(title).toHaveLength(1);
		expect(title[0].text.startsWith('Lord of the Keep (r.')).toBe(true);
		expect(title[0].text.endsWith('…')).toBe(true);
		expect(small(title[0].text)).toBeLessThanOrEqual(cardText(GEO).textW);
	});

	it('a two-line name from the label on a tallName box', () => {
		const long = new Map(labels);
		long.set('kit', label('Kit Aurelian Maximilian IV', 'Count', '(r. 1175)'));
		const tallCards = tallCardsFor(g, GEO, fonts, measure, undefined, long)!.tall;
		expect(tallCards).toEqual(['kit']);
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallCards, tallTitles });
		const root = scene(laid, { labels: long });
		const names = texts(root, 'kit', 'dynasty-card-name');
		expect(names.map((e) => e.text)).toEqual(['Kit Aurelian', 'Maximilian IV']);
		const t = cardText(laid.layout.geometry, true);
		expect(names.map((e) => Number(e.getAttribute('y')))).toEqual([t.nameBaseline, t.name2Baseline!].map((y) => laid.layout.persons.get('kit')!.y + y));
		expect(Number(texts(root, 'kit', 'dynasty-card-title')[0].getAttribute('y'))).toBe(laid.layout.persons.get('kit')!.y + t.titleBaseline);
	});

	it('absent labels, or labels that say what the person says, draw exactly the M7 scene', () => {
		for (const src of [fixture('03'), fixture('04')]) {
			const b = build(src).g;
			const laid = lay(b, DEFAULT_LAYOUT_SETTINGS);
			const plain = (b2: FamilyGraph, extra: Partial<SceneOptions> = {}) => {
				const root = new FEl('g');
				buildScene(root as unknown as SVGGElement, b2, laid, { fonts, measure, link: () => null, ...extra });
				return dump(root);
			};
			const same = new Map(b.people.map((p) => [p.id, label(p.name, p.title)]));
			expect(plain(b, { labels: same })).toBe(plain(b));
			expect(plain(b, { labels: new Map() })).toBe(plain(b));
		}
	});
});

describe('M8: the headless SVG draws card labels', () => {
	const { g } = build(`people:
  - {id: aldric, name: Aldric Valmont, title: Lord of the Keep, sex: m, born: '1102', died: '1160'}
  - {id: rod, name: Roderick Valmont, sex: m, born: '1130', parents: [aldric]}
`);
	const labels = new Map<string, CardLabel>([
		['aldric', label('Aldric II', 'Lord of the Keep', '(r. 1131–1160)')],
		['rod', label('Roderick', 'Duke of Valmont', '(r. from 1160)')],
	]);

	it('name, title and reign on two text lines at the tall-title baselines, dates below', () => {
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallTitles: ['aldric', 'rod'] });
		const svg = renderSvg(g, laid.layout, laid.edges, { labels });
		const box = laid.layout.persons.get('aldric')!;
		const t = cardText(laid.layout.geometry, false, true);
		expect(svg).toContain('>Aldric II</text>');
		expect(svg).not.toContain('Aldric Valmont');
		expect(svg).toMatch(new RegExp(`y="${box.y + t.titleBaseline}"[^>]*>Lord of the Keep</text>`));
		expect(svg).toMatch(new RegExp(`y="${box.y + t.title2Baseline!}"[^>]*>\\(r\\. 1131–1160\\)</text>`));
		expect(svg).toContain(`y="${box.y + t.datesBaseline}"`);
		expect(svg).toContain('>1102–1160</text>');
	});

	it('dates off: no reign', () => {
		const laid = lay(g, DEFAULT_LAYOUT_SETTINGS);
		const svg = renderSvg(g, laid.layout, laid.edges, { labels, showDates: false });
		expect(svg).not.toContain('(r.');
		expect(svg).toContain('>Duke of Valmont</text>');
	});

	it('absent labels, or labels that say what the person says, give exactly the M7 SVG', () => {
		for (const id of ['01', '03', '04', '08']) {
			const b = build(fixture(id)).g;
			for (const [, settings] of VIEWS) {
				const laid = lay(b, settings);
				const same = new Map(b.people.map((p) => [p.id, label(p.name, p.title)]));
				const m7 = renderSvg(b, laid.layout, laid.edges);
				expect(renderSvg(b, laid.layout, laid.edges, { labels: same })).toBe(m7);
				expect(renderSvg(b, laid.layout, laid.edges, { labels: new Map() })).toBe(m7);
			}
		}
	});
});
