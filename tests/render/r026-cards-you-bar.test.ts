// 0.2.6 WP3 (D176 1); 0.2.8 (contract C, G.15): the house ribbon of the marked card lies inside the thick border. Every ribbon is a path with the corners of the card; the marked
// card's path starts at the inner border edge and follows the inner corners. Saved picture (fixed radius) and live scene (theme radius, set again by `setCornerRadius`).
import { describe, expect, it } from 'vitest';
import { cardLabels } from '../../src/core/titles';
import { cardForm, geometryFor, ribbonWidth } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry, LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { DEFAULT_DARK, DEFAULT_LIGHT, ME_LOOK, SAVED_CARD_RADIUS } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { ribbonPath } from '../../src/render/view-math';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100}',
	'  - {id: c, name: Cedric, house: v, born: 1130, parents: [a]}',
	'  - {id: d, name: Dora, house: v, parents: [a]}',
	'',
].join('\n');
const FORMS: [string, Geometry, Partial<LayoutSettings>][] = [
	['Roundel', cardForm(geometryFor(12), 'down'), { relationLine: true }],
	['text card', cardForm(geometryFor(12), 'sideways'), { relationLine: true }],
	['Roundel, no plate', cardForm(geometryFor(12), 'down'), {}],
];
const RELATIONS = new Map([['c', { text: 'You', lower: 'you' }], ['d', { text: 'Sister', lower: 'sister' }]]);

function laidOf(geo: Geometry, over: Partial<LayoutSettings>) {
	const g = build(SRC).g;
	clearLayoutCache();
	const sideways = geo.form === 'text';
	const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
	return { g, laid, labels: cardLabels(g) };
}

/** The ribbon path of a card as the scene and the saved picture make it: on the top edge of a top-to-bottom card, on the left edge of a sideways one. */
function ribbonOf(geo: Geometry, box: { x: number; y: number; w: number; h: number }, marked: boolean, radius: number): string {
	const rib = ribbonWidth(geo);
	const inset = marked ? ME_LOOK.border / 2 : 0;
	const roundel = geo.form !== 'text';
	return ribbonPath(box.x + inset, box.y + inset, roundel ? box.w - 2 * inset : rib, roundel ? rib : box.h - 2 * inset, rib, Math.max(0, radius - inset), roundel ? 'top' : 'left');
}

describe('D176 (1): the saved picture', () => {
	for (const [name, geo, over] of FORMS) {
		for (const dark of [false, true]) {
			it(`${name}, ${dark ? 'dark' : 'light'}: the marked ribbon is a path inside the border; the other card's ribbon is a path at the card's edge`, () => {
				const { g, laid, labels } = laidOf(geo, over);
				const svg = renderSvg(g, laid.layout, laid.edges, { palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT, dark, measure, fonts: FONTS, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
				const drawn = laid.layout.geometry;
				const marked = laid.layout.persons.get('c')!;
				const other = laid.layout.persons.get('d')!;
				expect(svg).toContain(`<path d="${ribbonOf(drawn, marked, true, SAVED_CARD_RADIUS)}" fill="`);
				expect(svg).toContain(`<path d="${ribbonOf(drawn, other, false, SAVED_CARD_RADIUS)}" fill="`);
				// The marked card has no ribbon at its own edge.
				expect(svg).not.toContain(`<path d="${ribbonOf(drawn, marked, false, SAVED_CARD_RADIUS)}" fill="`);
			});
		}
	}
});

describe('D176 (1): the live scene', () => {
	const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
	for (const [name, geo, over] of FORMS) {
		it(`${name}: every ribbon is a path with the class dynasty-card-ribbon; the marked card's lies inside the border`, () => {
			const { g, laid, labels } = laidOf(geo, over);
			const root = new FEl('g');
			buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
			const ribbons = all(root).filter((e) => e.hasClass('dynasty-card-ribbon'));
			expect(ribbons.map((e) => e.tag)).toEqual(['path', 'path', 'path']);
			const drawn = laid.layout.geometry;
			const d = new Set(ribbons.map((e) => e.getAttribute('d')));
			// The theme radius is unknown while the scene is built outside the document: the scene takes 4 px.
			expect(d.has(ribbonOf(drawn, laid.layout.persons.get('c')!, true, 4))).toBe(true);
			expect(d.has(ribbonOf(drawn, laid.layout.persons.get('d')!, false, 4))).toBe(true);
		});
	}
});

describe('0.2.6 radius repair: the theme radius that is known after the scene is built', () => {
	const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
	it('setCornerRadius draws every ribbon again with the new radius; the option sets the first radius', () => {
		const [, geo, over] = FORMS[0]!;
		const { g, laid, labels } = laidOf(geo, over);
		const box = laid.layout.persons.get('c')!;
		const drawn = laid.layout.geometry;
		const ds = (root: FEl) => all(root).filter((e) => e.hasClass('dynasty-card-ribbon')).map((e) => e.getAttribute('d'));
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
		expect(ds(root)).toContain(ribbonOf(drawn, box, true, 4));
		scene.setCornerRadius(8);
		expect(ds(root)).toContain(ribbonOf(drawn, box, true, 8));
		expect(ds(root)).not.toContain(ribbonOf(drawn, box, true, 4));
		const root2 = new FEl('g');
		buildScene(root2 as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', cornerRadius: 8, ...(over.relationLine ? { relations: RELATIONS } : {}) });
		expect(ds(root2)).toEqual(ds(root));
	});
});
