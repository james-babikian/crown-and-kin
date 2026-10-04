import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import { contrastRatio } from '../src/render/dom/theme-read';
import { DEFAULT_DARK, DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';

// The live CSS draws the empty and the dashed "missing file" portrait frame with --text-muted (the decision notes: M9 G5 clean-up,
// "--text-faint is under 3:1 on the card"). The headless drawing (spike, saved picture) still uses textFaint.
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const SRC = `people:\n  - {id: a, name: Aldric, portrait: "[[a.png]]"}\n`;

function frameOf(pic: string | 'missing' | null, palette = DEFAULT_LIGHT, dark = false) {
	const r = parseDynasty(SRC);
	if (!r.ok) throw new Error('parse');
	const g = deriveFamilies(r.tree);
	clearLayoutCache();
	const laid = layoutTree(g, geometryFor(16, 'normal'), { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 }, ...pictureSets(g, true) }, 'x');
	const svg = renderSvg(g, laid.layout, laid.edges, { palette, dark, measure: approxMeasure, fonts: FONTS, pictures: new Map([['portrait:a', pic]]) });
	const circle = /<circle [^>]*stroke-width="1"[^>]*\/>/.exec(svg)![0];
	return { circle, stroke: /stroke="(#[0-9a-f]{6})"/.exec(circle)![1], fill: /fill="(#[0-9a-f]{6}|none)"/.exec(circle)![1] };
}

describe('s113-b headless portrait frame contrast', () => {
	for (const [name, palette, dark] of [['light', DEFAULT_LIGHT, false], ['dark', DEFAULT_DARK, true]] as const) {
		it(`${name}: the empty frame is at least 3:1 on the card (as the live --text-muted frame)`, () => {
			const f = frameOf(null, palette, dark);
			expect(contrastRatio(hex(f.stroke), hex(palette.cardFill))).toBeGreaterThanOrEqual(3);
		});
		it(`${name}: the dashed frame of a missing file is at least 3:1 on its grey fill`, () => {
			const f = frameOf('missing', palette, dark);
			expect(contrastRatio(hex(f.stroke), hex(palette.cardBorder))).toBeGreaterThanOrEqual(3);
		});
	}
});
