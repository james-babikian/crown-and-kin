import { describe, expect, it } from 'vitest';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { LEGEND_ORDER, legendLineOrder } from '../../src/render/legend-text';
import { savedExtent, savedLegend, savedScale, type SavedParts } from '../../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg, type SvgOptions } from '../../src/render/svg-string';
import { fixtureSource } from '../acceptance/load';
import { graphOf, layoutPictures } from '../acceptance/picture-sample-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D338 point 7: the legend row "Illegitimate child (no dashed line)" (the card sign) stands directly under the row "Illegitimate child", in the order helper
 * and in the legend of a saved picture. The window legend is pinned in legend-two-groups.test.ts.
 */

useFakeDom({ css: true });

describe('legendLineOrder', () => {
	it('puts the sign directly after "Illegitimate child"', () => {
		const order = legendLineOrder(LEGEND_ORDER, true);
		expect(order[order.indexOf('illegitimate') + 1]).toBe('sign');
		expect(order.filter((k) => k !== 'sign')).toEqual(LEGEND_ORDER);
	});

	it('with no sign, it changes nothing', () => {
		expect(legendLineOrder(['marriage', 'descent'], false)).toEqual(['marriage', 'descent']);
	});

	it('a picture with no "Illegitimate child" row puts the sign where that row would stand: after the child line, before the adoptive line', () => {
		expect(legendLineOrder(['marriage', 'descent', 'adoptive', 'begetter'], true)).toEqual(['marriage', 'descent', 'sign', 'adoptive', 'begetter']);
		expect(legendLineOrder([], true)).toEqual(['sign']);
		expect(legendLineOrder(['adoptive'], true)).toEqual(['sign', 'adoptive']);
	});
});

describe('the legend of a saved picture', () => {
	it('draws the sign row directly after the row "Illegitimate child", or after the child line when that row is not drawn', async () => {
		const { pictureSets } = await layoutPictures();
		clearLayoutCache();
		const g = graphOf(fixtureSource('06'));
		const geo = cardForm(geometryFor(16), 'down');
		const laid = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true) } as LayoutSettings, 'test');
		// The rows are those of the legend object, so a made one gives the cases: a picture with the row, and one without it.
		const real = savedLegend(g, laid);
		for (const kinds of [['descent', 'illegitimate', 'adoptive', 'begetter'], ['marriage', 'descent', 'adoptive']] as const) {
			const legend = { ...real, kinds: [...kinds], sign: true };
			const fonts = { text: 'serif', ui: 'sans', bold: '700' };
			const measure = (s: string) => [...s].length * 8;
			const extent = savedExtent(laid, legend, 'Sixty people', 16, measure, fonts);
			const saved: SavedParts = { heading: 'Sixty people', legend, pictures: new Map(), scale: savedScale(extent, 16, 'svg').scale };
			const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, saved, measure, fonts } as SvgOptions);
			const items = [...svg.matchAll(/data-item="(legend-(?:line:[\w-]+|sign))"/g)].map((m) => m[1]);
			expect(items.filter((i) => i !== 'legend-sign')).toEqual(legend.kinds.map((k) => `legend-line:${k}`));
			const before = items[items.indexOf('legend-sign') - 1];
			expect(before, kinds.join()).toBe(legend.kinds.includes('illegitimate') ? 'legend-line:illegitimate' : 'legend-line:descent');
		}
	});
});
