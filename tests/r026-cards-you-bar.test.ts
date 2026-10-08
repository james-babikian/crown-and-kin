// 0.2.6 WP3 (D176 1): the house colour bar of the marked card lies inside the thick border. Marked card only: the bar is a path that
// starts at the inner border edge and follows the inner corners; other cards keep the plain rect. Saved picture and live scene.
import { beforeAll, describe, expect, it } from 'vitest';
import { cardLabels } from '../src/core/titles';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LayoutSettings } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { DEFAULT_DARK, DEFAULT_LIGHT, ME_LOOK } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import { markedBarPath } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

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

describe('markedBarPath', () => {
	it('starts at the inner border edge, ends at the bar width and has a square inner edge', () => {
		// Left edge x = 10 + 1.5; inner radius = 6 - 1.5; the bar ends at x = 10 + 10 with a straight edge.
		expect(markedBarPath(10, 20, 40, 10, 3, 6)).toBe('M16 21.5H20V58.5H16A4.5 4.5 0 0 1 11.5 54V26A4.5 4.5 0 0 1 16 21.5Z');
	});
	it('makes a closed shape', () => {
		expect(markedBarPath(0, 0, 50, 8, 3, 4)).toMatch(/Z$/);
	});
});

describe('D176 (1): the saved picture', () => {
	for (const [name, geo, over] of FORMS) {
		for (const dark of [false, true]) {
			it(`${name}, ${dark ? 'dark' : 'light'}: the marked bar is a path inside the border; the other card keeps its rect`, () => {
				const { g, laid, labels } = laidOf(geo, over);
				const svg = renderSvg(g, laid.layout, laid.edges, { palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT, dark, measure, fonts: FONTS, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
				const box = laid.layout.persons.get('c')!;
				const half = ME_LOOK.border / 2;
				const m = /<path d="M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+ ?A[^"]*" fill="[^"]+"\/>/.exec(svg);
				expect(m, 'a bar path').not.toBeNull();
				// The path begins at the top edge, just inside the border, and ends at the bottom edge, just inside the border.
				expect(Number(m![2])).toBeCloseTo(box.y + half);
				expect(Number(m![4])).toBeCloseTo(box.y + box.h - half);
				expect(Number(m![3])).toBeCloseTo(box.x + laid.layout.geometry.fontPx * 0.5);
				const other = laid.layout.persons.get('d')!;
				expect(svg).toContain(`<rect x="${other.x}" y="${other.y}" width="${geo.fontPx * 0.5}" height="${other.h}" rx="3"`);
				// The marked card has no bar rect at its own position.
				expect(svg).not.toContain(`<rect x="${box.x}" y="${box.y}" width="${geo.fontPx * 0.5}"`);
			});
		}
	}
	it('a tree with no mark has no bar path', () => {
		const { g, laid, labels } = laidOf(FORMS[0][1], FORMS[0][2]);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure, fonts: FONTS, labels });
		expect(svg).not.toMatch(/<path d="M[\d.]+ [\d.]+H[\d.]+V[\d.]+H[\d.]+A/);
	});
});

describe('D176 (1): the live scene', () => {
	const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
	for (const [name, geo, over] of FORMS) {
		it(`${name}: the strip of the marked card is a path with the class dynasty-card-strip; other strips are rects`, () => {
			const { g, laid, labels } = laidOf(geo, over);
			const root = new FEl('g');
			buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
			const strips = all(root).filter((e) => e.hasClass('dynasty-card-strip'));
			expect(strips.map((e) => e.tag).sort()).toEqual(['path', 'rect', 'rect']);
			const path = strips.find((e) => e.tag === 'path')!;
			const box = laid.layout.persons.get('c')!;
			expect(path.getAttribute('d')).toBe(markedBarPath(box.x, box.y, box.h, laid.layout.geometry.fontPx * 0.5, ME_LOOK.border, 4));
		});
	}
});

describe('0.2.6 radius repair: the theme radius that is known after the scene is built', () => {
	const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
	it('setCornerRadius draws the marked bar again with the new radius; the option sets the first radius', () => {
		const [, geo, over] = FORMS[0]!;
		const { g, laid, labels } = laidOf(geo, over);
		const box = laid.layout.persons.get('c')!;
		const stripW = laid.layout.geometry.fontPx * 0.5;
		const barD = (root: FEl) => all(root).find((e) => e.hasClass('dynasty-card-strip') && e.tag === 'path')!.getAttribute('d');
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', ...(over.relationLine ? { relations: RELATIONS } : {}) });
		expect(barD(root)).toBe(markedBarPath(box.x, box.y, box.h, stripW, ME_LOOK.border, 4));
		scene.setCornerRadius(8);
		expect(barD(root)).toBe(markedBarPath(box.x, box.y, box.h, stripW, ME_LOOK.border, 8));
		expect(barD(root)).not.toBe(markedBarPath(box.x, box.y, box.h, stripW, ME_LOOK.border, 4));
		const root2 = new FEl('g');
		buildScene(root2 as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels, me: 'c', cornerRadius: 8, ...(over.relationLine ? { relations: RELATIONS } : {}) });
		expect(barD(root2)).toBe(barD(root));
	});
});
