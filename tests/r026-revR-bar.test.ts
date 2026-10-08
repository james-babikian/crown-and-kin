// Review R (scratch): the marked bar path in the saved picture at small note fonts (stripW = 0.5 em is below the inner corner radius 4.5).
import { describe, expect, it } from 'vitest';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import { build } from './helpers';

const SRC = ['houses:', '  - {id: v, name: V, color: "#8b1e3f"}', 'options:', '  me: c', 'people:', '  - {id: c, name: Cedric, house: v, born: 1130}', ''].join('\n');
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);

describe('R marked bar path', () => {
	for (const px of [8, 10, 11]) {
		it(`saved picture at ${px}px: the bar path does not run back past its own end (H must be >= the M start)`, () => {
			const g = build(SRC).g;
			clearLayoutCache();
			const laid = layoutTree(g, geometryFor(px), { ...DEFAULT_LAYOUT_SETTINGS } as LayoutSettings, 'test');
			const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure, fonts: { text: 'serif', ui: 'sans', bold: '700' }, me: 'c' });
			const d = /<path d="(M[^"]*A[^"]*)" fill="#8b1e3f"/.exec(svg)![1];
			// A corner wider than the strip is cut at the strip's inner edge (`M xe yt V ...`), which never runs back.
			const m = /^M([\d.]+) ([\d.]+)H([\d.]+)/.exec(d);
			if (m) expect(Number(m[3])).toBeGreaterThanOrEqual(Number(m[1]));
			else expect(d).toMatch(/^M[\d.]+ [\d.]+V/);
		});
	}
});
