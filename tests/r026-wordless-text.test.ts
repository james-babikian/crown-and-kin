// 0.2.6 WP3 (D177 item 10, spec §13.1 B7): a card with no relation word, in a tree that has a mark, keeps its height and centres its text
// in the whole card; no plate. The live scene and the saved picture agree. Cards with a word, the marked card and trees without a mark do not move.
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { cardForm, cardText, centredWithoutWord, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
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
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const SRC = ['houses:', '  - {id: v, name: V, color: "#8b1e3f"}', 'people:', '  - {id: a, name: Aldric, house: v, born: 1100, died: 1160}', '  - {id: b, name: Bertram, house: v, born: 1130, parents: [a]}', '  - {id: z, name: Zora, born: 1140}', ''].join('\n');
const g: FamilyGraph = build(SRC).g;
const RELATIONS = new Map([['a', { text: 'Father', lower: 'father' }], ['b', { text: 'You', lower: 'you' }]]);

const FORMS: [string, Geometry, 'down' | 'sideways'][] = [
	['Roundel', cardForm(geometryFor(12), 'down'), 'down'],
	['text card', cardForm(geometryFor(12), 'sideways'), 'sideways'],
];

function lay(geo: Geometry, orientation: 'down' | 'sideways', relationLine: boolean): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(orientation === 'sideways' ? { orientation: 'sideways' as const } : {}), ...(relationLine ? { relationLine: true } : {}) } as LayoutSettings, 'test');
}
function nameY(laid: LaidOut, id: string, relations: typeof RELATIONS | undefined): { scene: number; svg: number; h: number } {
	const root = new FEl('g');
	buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...(relations ? { relations, me: 'b' } : {}) });
	const card = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
	const name = all(card).find((e) => e.hasClass('dynasty-card-name'))!;
	const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure, fonts: FONTS, ...(relations ? { relations, me: 'b' } : {}) });
	const word = { a: 'Aldric', b: 'Bertram', z: 'Zora' }[id]!;
	const first = /<text x="[^"]*" y="([\d.]+)"/.exec(svg.split('<g>').find((c) => c.includes(word))!)!;
	return { scene: Number(name.getAttribute('y')) - laid.layout.persons.get(id)!.y, svg: Number(first[1]) - laid.layout.persons.get(id)!.y, h: laid.layout.persons.get(id)!.h };
}

describe('D177 (10): a card with no relation word centres its text', () => {
	for (const [name, geo, dir] of FORMS) {
		it(`${name}: the name moves down by half of the empty strip, scene and saved picture agree, the height is kept`, () => {
			const laid = lay(geo, dir, true);
			const plain = lay(geo, dir, false);
			const z = nameY(laid, 'z', RELATIONS);
			const base = cardText(laid.layout.geometry, 1, false, { title: false, dates: true });
			const moved = centredWithoutWord(laid.layout.geometry, base);
			expect(moved.nameBaseline - base.nameBaseline).toBeGreaterThan(5);
			expect(z.scene).toBeCloseTo(moved.nameBaseline, 6);
			expect(z.svg).toBeCloseTo(z.scene, 6);
			// Same height as a card with a word.
			expect(laid.layout.persons.get('z')!.h).toBe(laid.layout.persons.get('a')!.h);
			// The strip is the plate of the Roundel or the text card.
			const strip = base.r1!.plate!.h;
			expect(moved.nameBaseline - base.nameBaseline).toBeCloseTo(strip / 2, 9);
			expect(plain.layout.persons.get('z')!.h).toBeLessThan(laid.layout.persons.get('z')!.h);
		});

		it(`${name}: a card with a word, the marked card and a tree without a mark keep their text`, () => {
			const laid = lay(geo, dir, true);
			const withWord = nameY(laid, 'a', RELATIONS);
			const noMark = nameY(laid, 'a', undefined);
			expect(withWord.scene).toBeCloseTo(noMark.scene, 6);
			expect(withWord.svg).toBeCloseTo(noMark.svg, 6);
			expect(nameY(laid, 'b', RELATIONS).scene).toBeCloseTo(nameY(laid, 'b', undefined).scene, 6);
			// A tree without a mark: the wordless card keeps its old place.
			expect(nameY(laid, 'z', undefined).scene).toBeCloseTo(withWord.scene, 6);
		});
	}

	it('a layout without a relation line does not move the text', () => {
		const geo = cardForm(geometryFor(12), 'down');
		const t = cardText(geo);
		expect(centredWithoutWord(geo, t)).toBe(t);
	});
});
