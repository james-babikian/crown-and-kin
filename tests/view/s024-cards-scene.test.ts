import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { cardLabels, type CardLabel } from '../../src/core/titles';
import { cardText, geometryFor, nameCountOf, tallExtra } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LaidOut, LayoutSettings } from '../../src/layout/model';
import { measuredLayout } from '../../src/view/measured-layout';
import { parseBreakList } from '../../src/render/break-words';
import { BADGE_RADIUS_EM, buildScene, relationFont, type Scene, type SceneOptions } from '../../src/render/dom/scene';
import { tallCardsFor } from '../../src/render/dom/tall-cards';
import { cardNameLines, runsText } from '../../src/render/name-lines';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { approxMeasure, renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { sampleSources } from '../acceptance/m11-support';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

// 0.2.4 (D117, D119, D122, D125, D126; contract 1.4, 4.1 to 4.3, 6.1): what the live scene and the headless picture draw on a card.

useFakeDom({ css: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** Every character is 0.55 em wide: 7.48 px at 13.6 px. */
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const WHOLE = geometryFor(16);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

function graph(src: string): FamilyGraph {
	return build(src).g;
}
function lay(g: FamilyGraph, settings: LayoutSettings = DEFAULT_LAYOUT_SETTINGS, geo = WHOLE): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geo, { ...settings, ...pictureSets(g, true) } as LayoutSettings, 'test');
}
function scene(laid: LaidOut, g: FamilyGraph, extra: Partial<SceneOptions> = {}): { root: FEl; scene: Scene } {
	const root = new FEl('g');
	return { root, scene: buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra }) };
}
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const nameEls = (root: FEl, id: string) => all(card(root, id)).filter((e) => e.hasClass('dynasty-card-name'));
const nameLinesOf = (root: FEl, id: string) => nameEls(root, id).map((e) => e.getText());
const label = (name: string, extra: Partial<CardLabel> = {}): CardLabel => ({ holdings: [], selected: false, name, ...extra }) as CardLabel;

describe('the sobriquet on the card (D122)', () => {
	const g = graph('people:\n  - {id: a, name: Aldric II}\n  - {id: b, name: Bo}\n');
	const labels = new Map([['a', label('Aldric II', { sobriquet: 'the Wise' })], ['b', label('Bo')]]);

	it('the name text holds the name and one tspan with the class `dynasty-card-sob`, made with createSvg: class only, no style attribute', () => {
		const { root } = scene(lay(g), g, { labels });
		const [name] = nameEls(root, 'a');
		expect(name.getText()).toBe('Aldric II “the Wise”');
		const spans = name.children.filter((c) => c.tag === 'tspan');
		expect(spans).toHaveLength(1);
		expect(spans[0].hasClass('dynasty-card-sob')).toBe(true);
		expect(spans[0].getText()).toBe('“the Wise”');
		expect(spans[0].attrs.has('style')).toBe(false);
		expect(spans[0].attrs.size).toBe(0);
		// A card without a sobriquet has no tspan.
		expect(nameEls(root, 'b')[0].children).toHaveLength(0);
	});

	it('the Compact level and the screen-reader label show no sobriquet', () => {
		const { root } = scene(lay(g), g, { labels });
		const compact = all(card(root, 'a')).find((e) => e.hasClass('dynasty-card-compact'))!;
		expect(compact.getText()).toBe('Aldric II');
		expect(card(root, 'a').getAttribute('aria-label')).not.toContain('Wise');
	});

	it('it follows the regnal name from the label ("Roderick II"), and the Person.sobriquet when the label has none', () => {
		const g2 = graph('people:\n  - {id: a, name: Roderick}\n');
		(g2.byId.get('a') as { sobriquet?: string }).sobriquet = 'the Bold';
		const labels2 = new Map([['a', label('Roderick II')]]);
		const tall = tallCardsFor(g2, WHOLE, FONTS, measure, undefined, labels2)!;
		// 22 characters of 7.48 px do not fit 158 px on one line: the person's own sobriquet makes the card taller, and shows whole on line 2.
		const { root } = scene(lay(g2, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall.tall } as LayoutSettings), g2, { labels: labels2 });
		expect(nameLinesOf(root, 'a')).toEqual(['Roderick II', '“the Bold”']);
		// A layout made without the sobriquet shows the name and drops the sobriquet (D127): the tree view lays out again with it.
		expect(nameLinesOf(scene(lay(g2), g2, { labels: labels2 }).root, 'a')).toEqual(['Roderick II…']);
	});

	it('it moves whole to the next text line, in a card the layout made taller for it', () => {
		const g3 = graph('people:\n  - {id: a, name: Placeholder}\n');
		const long = new Map([['a', label('Aldrimonalot Fitz', { sobriquet: 'the Wise' })]]);
		// 17 characters = 127 px fit one line; with the sobriquet (10 more characters) the name needs a second text line.
		const tall = tallCardsFor(g3, WHOLE, FONTS, measure, undefined, long)!;
		expect(tall.tall).toEqual(['a']);
		const laid = lay(g3, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall.tall } as LayoutSettings);
		const { root } = scene(laid, g3, { labels: long });
		expect(nameLinesOf(root, 'a')).toEqual(['Aldrimonalot Fitz', '“the Wise”']);
		expect(nameEls(root, 'a')[1].children.map((c) => c.getText())).toEqual(['“the Wise”']);
	});

	it('a sobriquet that does not fit three text lines is dropped completely (D127)', () => {
		const g3 = graph('people:\n  - {id: a, name: Placeholder}\n');
		const long = new Map([['a', label('Alexandrovichs Bartholomewson Cadwalladerson Wolfgangsenal', { sobriquet: 'the Wise' })]]);
		const tall = tallCardsFor(g3, WHOLE, FONTS, measure, undefined, long)!;
		const laid = lay(g3, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall.tall, longNames: tall.long } as LayoutSettings);
		const { root } = scene(laid, g3, { labels: long });
		const lines = nameLinesOf(root, 'a');
		expect(lines).toHaveLength(3);
		expect(lines.join(' ')).not.toContain('“');
		expect(nameEls(root, 'a').every((e) => e.children.length === 0)).toBe(true);
	});
});

describe('card text: sizes, weights and the word "You" (D117)', () => {
	it('relationFont: "You" is bold and italic with the bold weight of the page; other relation texts are italic regular', () => {
		expect(relationFont(13.6, 'serif', true, '600')).toBe('italic 600 13.6px serif');
		expect(relationFont(13.6, 'serif', true)).toBe('italic 700 13.6px serif');
		expect(relationFont(13.6, 'serif', false, '600')).toBe('italic 400 13.6px serif');
	});

	it('the whole marked card draws "You" through the relation text, measured with `relationFont`', () => {
		const g = graph('options:\n  me: a\npeople:\n  - {id: a, name: Aldric, born: 1100}\n');
		const seen = new Set<string>();
		const spy = (s: string, font: string) => (seen.add(font), measure(s, font));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true } as LayoutSettings);
		const { root } = scene(laid, g, { measure: spy, me: 'a', relations: new Map([['a', { text: 'You', lower: 'you' }]]) });
		expect(all(card(root, 'a')).filter((e) => e.hasClass('dynasty-card-relation')).map((e) => e.getText())).toEqual(['You']);
		expect(seen.has('italic 700 13.6px serif')).toBe(true);
		expect(seen.has('700 13.6px serif')).toBe(true);
	});
});

describe('the "+" badge on the corner of the card, in every layout (D117 4)', () => {
	for (const orientation of ['down', 'sideways'] as const) {
		it(`${orientation}: the centre of the badge is the card's top right corner; no in-card badge`, () => {
			const g = graph('people:\n  - {id: a, name: Aldric}\n  - {id: b, name: Bo, parents: [a]}\n');
			const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...(orientation === 'sideways' ? { orientation } : {}) } as LayoutSettings);
			const { scene: s } = scene(laid, g, { badges: { hidden: new Map([['a', 2], ['b', 1]]), label: () => 'More' } });
			expect(s.badges).toHaveLength(2);
			for (const b of s.badges) {
				const box = laid.layout.persons.get(b.person)!;
				expect(b.mark.x + b.mark.w / 2).toBeCloseTo(box.x + box.w, 9);
				expect(b.mark.y + b.mark.h / 2).toBeCloseTo(box.y, 9);
				expect(b.mark.w).toBeCloseTo(2 * BADGE_RADIUS_EM * 16, 9);
			}
		});
	}

	it('the name and the D14 sign do not give way to the badge (they ended 1.2 em before it in a sideways card of 0.2.3)', () => {
		const g = graph('people:\n  - {id: a, name: Aldric Valmont Fitzgerald, illegitimate: true}\n');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' } as LayoutSettings);
		const without = scene(laid, g);
		const withBadge = scene(laid, g, { badges: { hidden: new Map([['a', 2]]), label: () => 'More' } });
		const strip = (root: FEl) => all(card(root, 'a')).map((e) => [e.tag, [...e.attrs].join(','), e.getText()].join('|'));
		expect(strip(withBadge.root)).toEqual(strip(without.root));
	});
});

// The live scene and the headless picture must draw the same text lines (spec §13.9 "The headless SVG ... show the same text lines as the view").
describe('the scene and the headless picture draw the same name text lines', () => {
	/** The name text lines of a card in the SVG string, by the font size and weight attributes of the name. */
	function svgNames(svg: string, size: number): string[] {
		const out: string[] = [];
		for (const m of svg.matchAll(/<text [^>]*font-size="([\d.]+)"[^>]*font-weight="700"[^>]*>(.*?)<\/text>/g)) {
			if (Math.abs(Number(m[1]) - size) < 1e-9) out.push(m[2].replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, (e) => (e === '&quot;' ? '"' : e)));
		}
		return out;
	}

	it('sample tree 07b and a long-name tree: every card, with sobriquets, labels and the owner list', () => {
		const g = graph(
			[
				'houses:',
				'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
				'people:',
				'  - {id: a, name: Placeholder, house: v}',
				'  - {id: b, name: Bo, parents: [a]}',
				'  - {id: c, name: Placeholder, parents: [a], house: v}',
				'  - {id: d, name: Placeholder, parents: [b]}',
				'',
			].join('\n'),
		);
		(g.byId.get('a') as { name: string }).name = 'Alexandrovichsmarinovichalexandrovichs';
		(g.byId.get('c') as { name: string }).name = 'Aldrimonalot Fitzgerald Bartholomewson Cadwalladerson';
		(g.byId.get('d') as { name: string }).name = 'Maximilian Valheim';
		const labels = new Map([
			['a', label('Alexandrovichsmarinovichalexandrovichs')],
			['b', label('Bo', { sobriquet: 'the Wise' })],
			['c', label('Aldrimonalot Fitzgerald Bartholomewson Cadwalladerson', { sobriquet: 'the Magnificent Defender of the North' })],
			['d', label('Maximilian Valheim', { sobriquet: 'the Fair' })],
		]);
		const breaks = parseBreakList('Alexandrov-ic-hsmarinovichalexandro-vichs');
		const real = (s: string, font: string) => approxMeasure(s, font);
		const opts = { fonts: { text: 'sans-serif', ui: 'sans-serif', bold: '700' }, measure: real, labels, breaks };
		const plan = measuredLayout(g, WHOLE, DEFAULT_LAYOUT_SETTINGS, { fonts: opts.fonts, measure: real, labels, showDates: true, showPortraits: true });
		const { root } = scene(plan.laid, g, opts);
		const svg = renderSvg(g, plan.laid.layout, plan.laid.edges, { palette: DEFAULT_LIGHT, ...opts });
		const live: string[] = [];
		for (const id of plan.laid.layout.persons.keys()) live.push(...nameLinesOf(root, id).filter((l) => l !== ''));
		const headless = svgNames(svg, cardText(plan.laid.layout.geometry).nameSize);
		expect(headless).toEqual(live);
		// The sobriquet shows in a regular tspan in the picture.
		expect(svg).toContain('<tspan font-weight="400">“the Wise”</tspan>');
	});

	it('every sample tree: the scene draws as many non-empty text lines as the layout made room for', () => {
		const bad: string[] = [];
		for (const s of sampleSources()) {
			const parsed = build(s.source);
			const g = parsed.g;
			const labels = cardLabels(g);
			const fonts = { text: 'sans-serif', ui: 'sans-serif', bold: '600' };
			const plan = measuredLayout(g, WHOLE, DEFAULT_LAYOUT_SETTINGS, { fonts, measure: approxMeasure, labels, showDates: true, showPortraits: true });
			const { root } = scene(plan.laid, g, { fonts, measure: approxMeasure, labels });
			for (const [id, box] of plan.laid.layout.persons) {
				const lines = nameLinesOf(root, id).filter((l) => l !== '');
				const slots = nameCountOf(box);
				if (lines.length !== slots && g.byId.get(id)!.name) bad.push(`${s.id} ${id}: ${lines.length} lines, ${slots} slots`);
			}
		}
		expect(bad.slice(0, 8), `${bad.length} mismatches`).toEqual([]);
	}, 60000);

	it('cardNameLines gives the lines the scene draws (one function for the layout, the scene and the picture)', () => {
		const g = graph('people:\n  - {id: a, name: Aldric Valmont}\n');
		const t = cardText(WHOLE);
		const lines = cardNameLines('Aldric Valmont', 'the Wise', { full: t.textW, last: t.textW, only: t.textW }, (s, sob) => measure(s, sob ? `400 ${t.nameSize}px serif` : `700 ${t.nameSize}px serif`), 3).map(runsText);
		const plan = tallCardsFor(g, WHOLE, FONTS, measure, undefined, new Map([['a', label('Aldric Valmont', { sobriquet: 'the Wise' })]]))!;
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: plan.tall } as LayoutSettings);
		const { root } = scene(laid, g, { labels: new Map([['a', label('Aldric Valmont', { sobriquet: 'the Wise' })]]) });
		expect(nameLinesOf(root, 'a')).toEqual(lines);
	});
});

describe('a card that the layout made taller shows at most its text lines (a name that needs more is cut by `last`)', () => {
	it('the card height steps by `tallExtra` per name slot', () => {
		const g = graph('people:\n  - {id: a, name: Aldric}\n');
		const heights = [[], ['a']].map((tall) => lay(g, { ...DEFAULT_LAYOUT_SETTINGS, tallCards: tall } as LayoutSettings, WHOLE).layout.persons.get('a')!.h);
		expect(heights[1] - heights[0]).toBe(tallExtra(WHOLE));
	});
});
