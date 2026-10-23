// 0.2.5 WP-B7 (supervisor ruling 2026-10-05, from the B6 picture review). Two faults of the plate:
// 1. A card of a person with no relation word drew an empty tinted plate. Now it keeps its height but draws no plate; only a card with a
//    relation word (the marked card has "You") draws one.
// 2. The relation word was cut at the 10 em text column although the plate is wider. Now the word may use the plate's inner width, centred
//    on the axis (the text card: from the text's left edge); every other text line keeps its column.
// The scene, the saved picture and `cardText` must agree on both.
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { cardLabels } from '../../src/core/titles';
import { PLATE_INSET_PX, WORD_CLEAR_EM, cardForm, cardText, geometryFor, roundelAxis } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
// 0.55 of the font size for each character, so a word's width is easy to count.
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// a: no relation word; b: a word that fits the column; c: marked; d: a word wider than the column but inside the plate; e: wider than the plate.
const SRC = [
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, born: 1100, died: 1160}',
	'  - {id: b, name: Bertram, parents: [a]}',
	'  - {id: c, name: Cedric, parents: [a]}',
	'  - {id: d, name: Dora, parents: [a]}',
	'  - {id: e, name: Edric, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const labels = cardLabels(g);

/** A word of `n` characters. */
const word = (n: number) => 'W'.repeat(n);
const RELATIONS = new Map([
	['b', { text: 'Half-brother', lower: 'half-brother' }],
	['c', { text: 'You', lower: 'you' }],
	['d', { text: word(22), lower: word(22) }],
	['e', { text: word(24), lower: word(24) }],
]);

const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
function sceneRoot(laid: LaidOut): FEl {
	const root = new FEl('g');
	buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', relations: RELATIONS });
	return root;
}
const cardEl = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const withClass = (el: FEl, cls: string) => all(el).filter((e) => e.hasClass(cls));
function svgOf(laid: LaidOut): string {
	return renderSvg(g, laid.layout, laid.edges, {
		palette: DEFAULT_LIGHT,
		dark: false,
		measure,
		fonts: FONTS,
		labels,
		me: 'c',
		relations: RELATIONS,
		saved: { heading: 'Test', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1 },
	});
}
/** The `<g>` text of one saved card (up to the next card), found by its `data-item`. */
function cardSvg(svg: string, id: string): string {
	const from = svg.indexOf(`data-item="card:${id}"`);
	const next = svg.indexOf('data-item="card:', from + 1);
	return svg.slice(from, next < 0 ? undefined : next);
}
const WORD_TEXT = /<text [^>]*font-style="italic"[^>]*>([^<]*)<\/text>/;

describe('fault 1: a card with no relation word draws no plate', () => {
	for (const [name, geo] of [['Roundel', ROUNDEL], ['text card', TEXT]] as const) {
		it(`${name}: the scene draws a foot hairline on the cards with a word and the marked card, none on the others (0.2.8: the hairline replaces the plate)`, () => {
			const laid = lay(geo, { relationLine: true });
			const root = sceneRoot(laid);
			for (const id of ['b', 'c', 'd', 'e']) expect(withClass(cardEl(root, id), 'dynasty-card-foot-line'), id).toHaveLength(1);
			expect(withClass(cardEl(root, 'a'), 'dynasty-card-foot-line')).toHaveLength(0);
		});

		it(`${name}: the card of a person with no word keeps the height of the others in its row`, () => {
			const laid = lay(geo, { relationLine: true });
			expect(laid.layout.persons.get('a')!.h).toBe(laid.layout.persons.get('b')!.h);
			expect(laid.layout.persons.get('b')!.h).toBe(laid.layout.persons.get('c')!.h);
			expect(laid.layout.geometry.cardH).toBe(geo.form === 'roundel' ? 46 + 12 : 58);
		});

		it(`${name}: the saved picture has a foot hairline exactly where the scene has one`, () => {
			const laid = lay(geo, { relationLine: true });
			const root = sceneRoot(laid);
			const svg = svgOf(laid);
			for (const id of ['a', 'b', 'c', 'd', 'e']) {
				const scene = withClass(cardEl(root, id), 'dynasty-card-foot-line').length;
				const saved = (cardSvg(svg, id).match(/data-item="foot:/g) ?? []).length;
				expect(saved, id).toBe(scene);
			}
		});

		it(`${name}: a lazy card agrees with an eager one (the foot hairline follows the word at the fill)`, () => {
			const laid = lay(geo, { relationLine: true });
			const root = new FEl('g');
			const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', relations: RELATIONS, lazyCards: true });
			s.fill.fillAll();
			expect(withClass(cardEl(root, 'a'), 'dynasty-card-foot-line')).toHaveLength(0);
			expect(withClass(cardEl(root, 'b'), 'dynasty-card-foot-line')).toHaveLength(1);
		});
	}
});

describe('fault 2: the relation word may use the plate\'s inner width', () => {
	it('Roundel: `relationW` is twice the distance from the axis to the plate end, less the clearance; wider than the 10 em column', () => {
		for (const f of [8, 10, 12, 14, 16, 20, 24, 32, 48]) {
			const geo = cardForm({ ...geometryFor(f), relationLine: true }, 'down');
			const t = cardText(geo, 1);
			const clear = WORD_CLEAR_EM * f;
			expect(t.relationW, `f${f}`).toBeCloseTo(2 * (geo.cardW - PLATE_INSET_PX - roundelAxis(geo) - clear) - 0.5 * f, 9); // 0.2.8: the axis moved 0.25 em to the middle; the width stayed
			expect(t.relationW!, `f${f}`).toBeGreaterThan(t.textW);
			// The word, centred on the axis, stays clear of the colour bar and of the card edge (the plate ends 1 px inside the edge).
			const left = roundelAxis(geo) - t.relationW! / 2;
			const right = roundelAxis(geo) + t.relationW! / 2;
			expect(left, `f${f} edge left`).toBeGreaterThanOrEqual(PLATE_INSET_PX + clear - 1e-9);
			expect(geo.cardW - right, `f${f} edge`).toBeGreaterThanOrEqual(PLATE_INSET_PX + clear - 1e-9);
		}
	});

	it('text card: the word starts at `padX` and may reach the plate end less the clearance; wider than the text width', () => {
		for (const f of [8, 12, 16, 24, 48]) {
			const geo = cardForm({ ...geometryFor(f), relationLine: true }, 'sideways');
			const t = cardText(geo, 1);
			expect(t.relationW, `f${f}`).toBeCloseTo(geo.cardW - PLATE_INSET_PX - WORD_CLEAR_EM * f - t.padX, 9);
			expect(t.relationW!, `f${f}`).toBeGreaterThan(t.textW);
			expect(t.padX + t.relationW!, `f${f}`).toBeLessThanOrEqual(geo.cardW - PLATE_INSET_PX - WORD_CLEAR_EM * f + 1e-9);
		}
	});

	it('no plate, no `relationW`; the other text lines keep their column', () => {
		const noPlate = cardText(cardForm(geometryFor(12), 'down'), 1);
		expect(noPlate.relationW).toBeUndefined();
		const withPlate = cardText(cardForm({ ...geometryFor(12), relationLine: true }, 'down'), 1);
		expect(withPlate.textW).toBe(120);
	});

	it('the scene cuts a word at `relationW`, not at the column: 22 characters (123 px) fit at 12 px, 24 (132 px) are cut', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const root = sceneRoot(laid);
		const t = cardText(laid.layout.geometry, 1);
		expect(t.relationW).toBeCloseTo(124, 9);
		expect(withClass(cardEl(root, 'd'), 'dynasty-card-relation')[0].getText()).toBe(word(22));
		const cut = withClass(cardEl(root, 'e'), 'dynasty-card-relation')[0].getText();
		expect(cut.endsWith('…')).toBe(true);
		expect(measure(cut, `italic 400 ${t.smallSize}px serif`)).toBeLessThanOrEqual(t.relationW!);
	});

	it('the saved picture cuts the same words at the same width', () => {
		for (const [geo, form] of [[ROUNDEL, 'Roundel'], [TEXT, 'text card']] as const) {
			const laid = lay(geo, { relationLine: true });
			const root = sceneRoot(laid);
			const svg = svgOf(laid);
			for (const id of ['b', 'c', 'd', 'e']) {
				const want = withClass(cardEl(root, id), 'dynasty-card-relation')[0].getText();
				const got = WORD_TEXT.exec(cardSvg(svg, id))![1];
				expect(got, `${form} ${id}`).toBe(want);
			}
		}
	});

	it('the text card: the word of 24 characters is cut at its own width, and the text above keeps the text width', () => {
		const laid = lay(TEXT, { relationLine: true });
		const root = sceneRoot(laid);
		const t = cardText(laid.layout.geometry, 1);
		const cut = withClass(cardEl(root, 'e'), 'dynasty-card-relation')[0].getText();
		expect(measure(cut, `italic 400 ${t.smallSize}px serif`)).toBeLessThanOrEqual(t.relationW!);
		expect(measure(cut + 'W', `italic 400 ${t.smallSize}px serif`)).toBeGreaterThan(t.relationW!);
	});
});
