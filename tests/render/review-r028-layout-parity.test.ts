/*
 * Search round 0.2.8, area A3 (layout): the saved picture against the live scene.
 * Each test fails on the base commit and its name says why.
 */
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { buildScene } from '../../src/render/dom/scene';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 7;
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

const SRC = `people:
  - {id: a, name: Alpha, sex: m}
  - {id: b, name: Beta, sex: f}
  - {id: c, name: Gamma, parents: [a, {id: b, type: rumoured}]}
unions:
  - {partners: [a, b]}
`;

function graph(src: string) {
	const parsed = parseDynasty(src);
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
}

describe('saved picture against the live scene: the rumoured-parent "?" marker', () => {
	for (const font of [12, 24]) {
		it(`the saved marker at note font ${font} px has the live size (r = 0.5 em, "?" = 0.7 em), not a fixed 8 px / 11 px`, () => {
			clearLayoutCache();
			const g = graph(SRC);
			const geo = cardForm(geometryFor(font), 'down');
			const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS }, 'x');
			const root = new FEl('g');
			buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			const marker = all(root).find((e) => e.hasClass('dynasty-rumour-marker'))!;
			const liveR = Number(all(marker).find((e) => e.tag === 'circle')!.getAttribute('r'));
			const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT });
			const m = /<circle cx="[^"]+" cy="[^"]+" r="([\d.]+)" fill="[^"]+" stroke="[^"]+"\/>\s*<text [^>]*font-size="([\d.]+)"[^>]*>\?<\/text>/.exec(svg);
			expect(m, 'saved marker present').not.toBeNull();
			expect(liveR).toBeCloseTo(0.5 * font, 6);
			expect(Number(m![1])).toBeCloseTo(liveR, 6);
			expect(Number(m![2])).toBeCloseTo(0.7 * font, 6);
		});
	}
});
