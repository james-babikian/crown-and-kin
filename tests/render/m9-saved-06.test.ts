/*
 * Spec §13.8 acceptance, "sample tree 6 saves as PNG and as SVG": the saved picture of the sample
 * tree with about 60 people, made the way the save makes it (the saved legend, the extent, the
 * scale for each kind, `renderSvg` with `saved`). The element list of the saved SVG equals the one
 * derived from the drawn scene (the parity method of the sample tree 14 test in
 * `acceptance/m9-saved.test.ts`), for the PNG scale and for the SVG scale, with and without a mark.
 * The PNG-scale SVG keeps the size limits and turns into a PNG of exactly its width and height.
 */

import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { computeRelations } from '../../src/core/relations';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { savedExtent, savedLegend, savedScale, type SavedParts } from '../../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../../src/render/styles';
import { renderSvg, type SvgOptions } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { fixtureSource } from '../acceptance/load';
import { graphOf, layoutPictures } from '../acceptance/m9-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true });

const FONT = 'test';
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 8;
const GEO = cardForm(geometryFor(16), 'down');
const MARK = 'aldric-valmont';
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// ---------- The small XML reader of the sample tree 14 test ----------

interface Node {
	tag: string;
	attrs: Record<string, string>;
	children: Node[];
	text: string;
	parent?: Node;
}

function parseSvg(svg: string): Node {
	const root: Node = { tag: '#root', attrs: {}, children: [], text: '' };
	let at = root;
	const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
	for (const m of svg.matchAll(re)) {
		if (m[5] !== undefined) {
			at.text += m[5];
			continue;
		}
		if (m[1]) {
			at = at.parent ?? root;
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of m[3].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
		const node: Node = { tag: m[2], attrs, children: [], text: '', parent: at };
		at.children.push(node);
		if (!m[4]) at = node;
	}
	return root;
}
const nodes = (n: Node): Node[] => [n, ...n.children.flatMap(nodes)];
const items = (svg: string) => nodes(parseSvg(svg)).flatMap((n) => (n.attrs['data-item'] ? [n.attrs['data-item']] : []));

// ---------- Sample tree 6, drawn and saved ----------

async function saved06(kind: 'png' | 'svg', marked: boolean) {
	const { pictureSets } = await layoutPictures();
	clearLayoutCache();
	const g = graphOf(fixtureSource('06'));
	const sets = pictureSets(g, true);
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, ...(marked ? { relationLine: true } : {}), ...sets } as LayoutSettings;
	const laid = layoutTree(g, GEO, settings, FONT);
	const relations = marked ? new Map([...computeRelations(g, MARK)].map(([id, rels]) => [id, { text: rels[0].text, lower: rels[0].lower }])) : undefined;
	const mark = marked ? { me: MARK } : {};
	const root = new FEl('g');
	buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...(relations ? { relations } : {}), ...mark });
	const legend = savedLegend(g, laid);
	const heading = 'Sixty people';
	const extent = savedExtent(laid, legend, heading, 16, measure, FONTS);
	const scale = savedScale(extent, 16, kind);
	const saved: SavedParts = { heading, legend, pictures: new Map(), scale: scale.scale };
	const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, ...(relations ? { relations } : {}), ...mark, saved, measure, fonts: FONTS } as SvgOptions);
	return { svg, root, saved, extent, scale };
}

/** The element list that the drawn scene gives (P4, B3), as in the sample tree 14 test. */
function sceneItems(root: FEl, saved: SavedParts): string[] {
	const out: string[] = [];
	for (const e of all(root)) {
		if (e.hasClass('dynasty-card')) {
			const id = e.getAttribute('data-person')!;
			out.push(`card:${id}`);
			if (e.hasClass('dynasty-signed')) out.push(`sign:${id}`);
			if (all(e).some((x) => x.hasClass('dynasty-card-relation'))) out.push(`relation:${id}`);
			// 0.2.5 (B.3.11): the Roundel's foot hairline (0.2.8; the plate before) and "You" tab are items too.
			if (all(e).some((x) => x.hasClass('dynasty-card-foot-line'))) out.push(`foot:${id}`);
			if (all(e).some((x) => x.hasClass('dynasty-r1-tab'))) out.push(`tab:${id}`);
		}
		if (e.hasClass('dynasty-line') && e.parentElement?.hasClass('dynasty-lines')) out.push(`line:${[...e.classes].find((c) => c.startsWith('dynasty-line-'))!.slice('dynasty-line-'.length)}`);
		// 0.2.1: a far-couple tag draws its partnership sign in the Full and in the Compact pill; the saved picture has the Full one only.
		if (e.hasClass('dynasty-union-dot') && !e.parentElement?.hasClass('dynasty-tag-compact')) out.push(`union:${[...e.classes].find((c) => c.startsWith('dynasty-union-') && c !== 'dynasty-union-dot')?.slice('dynasty-union-'.length) ?? 'dot'}`);
		if (e.hasClass('dynasty-rumour-marker')) out.push('rumour');
		if (e.hasClass('dynasty-tag')) out.push(`tag:${e.getAttribute('data-person')}`);
	}
	out.push('heading');
	for (const k of saved.legend.kinds) out.push(`legend-line:${k}`);
	if (saved.legend.sign) out.push('legend-sign');
	for (const h of saved.legend.houses) out.push(`legend-house:${h.id}`);
	return out.sort();
}

describe('sample tree 6 saves as PNG and as SVG (spec §13.8 acceptance)', () => {
	for (const kind of ['png', 'svg'] as const) {
		for (const marked of [false, true]) {
			it(`${kind.toUpperCase()}${marked ? ', with a mark' : ''}: the saved SVG has the elements of the drawn scene (P4, B3)`, async () => {
				const s = await saved06(kind, marked);
				const got = items(s.svg).sort();
				expect(got).toEqual(sceneItems(s.root, s.saved));
				expect(got.filter((x) => x.startsWith('card:')).length).toBeGreaterThanOrEqual(55);
				for (const prefix of ['line:', 'union:', 'legend-line:', 'legend-house:']) expect(got.some((x) => x.startsWith(prefix)), prefix).toBe(true);
				if (marked) expect(got.some((x) => x.startsWith('relation:'))).toBe(true);
				// The four houses of the sample tree are in the legend.
				expect(s.saved.legend.houses.map((h) => h.id).sort()).toEqual(['castellane', 'harrow', 'orsini', 'valmont']);
				// The picture is the saved extent at the kind's scale, on a white ground.
				const svgEl = parseSvg(s.svg).children[0];
				const [, , vw, vh] = svgEl.attrs.viewBox.split(/[\s,]+/).map(Number);
				expect(vw).toBeCloseTo(s.extent.w, 0);
				expect(vh).toBeCloseTo(s.extent.h, 0);
				expect(Number(svgEl.attrs.width)).toBe(Math.ceil(vw * s.scale.scale));
				expect(Number(svgEl.attrs.height)).toBe(Math.ceil(vh * s.scale.scale));
				expect(svgEl.children.find((n) => n.tag === 'rect')!.attrs.fill.toLowerCase()).toBe('#ffffff');
			});
		}
	}

	it('PNG: the picture keeps the size limits and turns into a PNG of its width and height (P5)', async () => {
		const s = await saved06('png', true);
		const svgEl = parseSvg(s.svg).children[0];
		const w = Number(svgEl.attrs.width);
		const h = Number(svgEl.attrs.height);
		expect(w * h).toBeLessThanOrEqual(16_000_000);
		expect(Math.max(w, h)).toBeLessThanOrEqual(8192);
		expect(s.scale.small).toBe((16 * s.scale.scale) / 2 < 8);
		const png = new Resvg(s.svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render();
		expect([png.width, png.height]).toEqual([w, h]);
		const bytes = png.asPng();
		expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	});
});
