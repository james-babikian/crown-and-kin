import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import type { Tree } from '../src/core/types';
import { armsPlace, cardText, geometryFor, pictureSize, portraitBox, smallTextWidth } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, armsCards, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene, type Scene } from '../src/render/dom/scene';
import { setLegendArms, setPicture, setSlotProblem } from '../src/render/dom/pictures';
import { legendHouses } from '../src/render/legend';
import { savedExtent, savedFrame, savedLegend, savedScale } from '../src/render/saved-picture';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';

// WP 9.2 (spec §13.6–§13.8, D67–D78; M9 contract L1–L3, G1–G4, S1–S4, P3–P5): picture sets and box
// flags on graphs whose `arms` and `portrait` are set by hand (WP 9.1 reads them from the text), the
// arms and portrait geometry, slots, the legend's houses, and the saved picture's frame and drawing.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 8;
const GEO = geometryFor(16, 'normal');
const URI = 'data:image/png;base64,AAAA';

const SOURCE = `houses:
  - {id: v, name: House V, color: "#8b1e3f"}
  - {id: t, name: House T, color: "#7a2e6b"}
  - {id: u, name: House Unused}
people:
  - {id: a, name: Aldric Valmont, title: Duke of Valmont, house: v, born: '1102', died: '1161'}
  - {id: b, name: Bastien Valmont, house: v, illegitimate: true}
  - {id: c, name: Clarice Thornes, house: t, born: '1130', parents: [a]}
  - {id: d, name: Dorian, house: ghost}
`;

/** The sample graph with `arms` on houses v and u and a portrait on a and c, as WP 9.1 will read them. */
function graph(): FamilyGraph {
	const r = parseDynasty(SOURCE);
	if (!r.ok) throw new Error('parse');
	const tree: Tree = {
		...r.tree,
		houses: r.tree.houses.map((h) => (h.id === 'v' || h.id === 'u' ? { ...h, arms: `[[${h.id}.png]]` } : h)),
		people: r.tree.people.map((p) => (p.id === 'a' || p.id === 'c' ? { ...p, portrait: `[[${p.id}.png]]` } : p)),
	};
	return deriveFamilies(tree);
}

function lay(g: FamilyGraph, settings: LayoutSettings = DEFAULT_LAYOUT_SETTINGS): LaidOut {
	clearLayoutCache();
	return layoutTree(g, GEO, { ...settings, ...pictureSets(g, true) }, 'test');
}

const scene = (g: FamilyGraph, laid: LaidOut): Scene => buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });

describe('picture sets and flags (L1, L2)', () => {
	it('pictureSets reads the written fields, sorted; the setting off gives no portraits', () => {
		const g = graph();
		expect(pictureSets(g, true)).toEqual({ arms: ['u', 'v'], portraits: ['a', 'c'] });
		expect(pictureSets(g, false)).toEqual({ arms: ['u', 'v'], portraits: [] });
	});

	it('armsCards: people of a listed house of the tree; a missing house gives none', () => {
		const g = graph();
		expect([...armsCards(g, ['v', 'u', 'ghost'])].sort()).toEqual(['a', 'b']);
		expect(armsCards(g, []).size).toBe(0);
	});

	it('the flags follow the sets and every box keeps its size and place, in every layout', () => {
		const g = graph();
		for (const settings of [DEFAULT_LAYOUT_SETTINGS, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'narrow' } as LayoutSettings]) {
			clearLayoutCache();
			const plain = layoutTree(g, GEO, settings, 'test');
			const pics = lay(g, settings);
			for (const [id, b] of pics.layout.persons) {
				const p = plain.layout.persons.get(id)!;
				expect([b.x, b.y, b.w, b.h]).toEqual([p.x, p.y, p.w, p.h]);
				expect(b.arms, id).toBe(id === 'a' || id === 'b' ? true : undefined);
				expect(b.portrait, id).toBe(id === 'a' || id === 'c' ? true : undefined);
			}
		}
	});
});

describe('geometry (D78, G2, G3)', () => {
	it('arms and portrait are both 1.25 text lines; the arms are 5/6 of that wide; the Full shift is 1.55 em', () => {
		const t = cardText(GEO);
		expect(pictureSize(GEO)).toBeCloseTo(24, 9);
		const place = armsPlace(GEO, t, GEO.cardH, 0);
		expect(place.full.w).toBeCloseTo(20, 9);
		expect(place.shift).toBeCloseTo(24.8, 9);
		expect(place.compactShift).toBeCloseTo(1.8 * 16, 9);
		expect(place.compact.x + place.compact.w).toBeCloseTo(GEO.cardW - 8, 9);
		const withCut = armsPlace(GEO, t, GEO.cardH, 10);
		expect(withCut.full.x).toBeCloseTo(place.full.x - 10, 9);
		expect(withCut.compact.x).toBeCloseTo(place.compact.x - 10, 9);
	});

	it('the arms (top) and the portrait (bottom) never meet on a card with no relation line', () => {
		for (const size of ['normal', 'compact'] as const) {
			const geo = geometryFor(16, size);
			const t = cardText(geo);
			const arms = armsPlace(geo, t, geo.cardH, 0).full;
			const portrait = portraitBox(geo, t);
			expect(portrait.y - (arms.y + arms.h), size).toBeGreaterThan(0);
			expect(portrait.y + portrait.h).toBeCloseTo(t.textBottom, 9);
		}
	});

	it('the name text line is not beside the portrait; the title narrows only without a relation line (D77)', () => {
		const t = cardText(GEO);
		const p = portraitBox(GEO, t);
		expect(smallTextWidth(GEO, t, t.nameBaseline, p)).toBe(t.textW);
		expect(smallTextWidth(GEO, t, t.titleBaseline, p)).toBeLessThan(t.textW);
		const rel = { ...GEO, cardH: GEO.cardH + 16, relationLine: true };
		const tr = cardText(rel);
		expect(smallTextWidth(rel, tr, tr.titleBaseline, portraitBox(rel, tr))).toBe(tr.textW);
	});
});

describe('slots and the legend (S1, S2, S4)', () => {
	it('a deceased card keeps its class, so the pictures can be muted by styles.css (G4); slots carry the house', () => {
		const g = graph();
		const s = scene(g, lay(g)) as Scene;
		expect(s.pictures.map((x) => `${x.person}:${x.kind}:${x.lod}:${x.house ?? ''}`)).toEqual(['a:arms:full:v', 'a:portrait:full:', 'a:arms:compact:v', 'b:arms:full:v', 'b:arms:compact:v', 'c:portrait:full:']);
		expect((s.cards.get('a') as unknown as FEl).hasClass('dynasty-deceased')).toBe(true);
	});

	it('setPicture marks the slot while it shows a picture; a problem removes the picture', () => {
		const g = graph();
		const slot = scene(g, lay(g)).pictures[1];
		const el = slot.el as unknown as FEl;
		setPicture(slot, 'blob:x');
		expect(el.hasClass('has-picture')).toBe(true);
		setSlotProblem(slot, 'other');
		expect(el.all().some((e) => e.tag === 'image')).toBe(false);
		expect(el.hasClass('has-picture')).toBe(false);
	});

	it('setLegendArms shows one picture or none', () => {
		const el = new FEl('span');
		setLegendArms(el as unknown as HTMLElement, 'blob:a');
		setLegendArms(el as unknown as HTMLElement, 'blob:b');
		expect(el.children.map((c) => c.getAttribute('src'))).toEqual(['blob:b']);
		setLegendArms(el as unknown as HTMLElement, null);
		expect(el.children).toEqual([]);
	});

	it('legendHouses: every house in list order, or only the houses of the given people', () => {
		const g = graph();
		expect(legendHouses(g).map((h) => `${h.id}:${h.arms}`)).toEqual(['v:true', 't:false', 'u:true']);
		expect(legendHouses(g, ['c', 'd']).map((h) => h.id)).toEqual(['t']);
		expect(legendHouses(g).find((h) => h.id === 'u')!.color).toBeUndefined();
	});
});

describe('the saved picture (P3–P5, B4)', () => {
	it('savedLegend lists the drawn kinds in legend order, the sign and the houses of the drawn people', () => {
		const g = graph();
		const laid = lay(g);
		const legend = savedLegend(g, laid);
		expect(legend.kinds).toEqual(['descent']);
		expect(legend.sign).toBe(true);
		expect(legend.houses.map((h) => h.id)).toEqual(['v', 't']);
	});

	it('the frame puts the heading above the tree and the legend below it; a long heading widens the picture', () => {
		const g = graph();
		const laid = lay(g);
		const legend = savedLegend(g, laid);
		const f = savedFrame(laid.layout, legend, 'Tree', 16, measure, FONTS);
		expect(f.heading.y).toBeLessThan(f.tree.y);
		expect(f.legend!.y).toBeGreaterThanOrEqual(f.tree.y + laid.layout.height);
		expect(f.h).toBeGreaterThanOrEqual(f.legend!.y);
		const long = savedExtent(laid, legend, 'x'.repeat(400), 16, measure, FONTS);
		expect(long.w).toBeGreaterThan(400 * 8);
		// With a scale, the heading is cut only where the picture would pass 8192 px.
		const cut = savedFrame(laid.layout, legend, 'x'.repeat(4000), 16, measure, FONTS, 1, (s, w) => s.slice(0, Math.floor(w / 8) - 1) + '…');
		expect(cut.w).toBeLessThanOrEqual(8192 + 1);
		expect(cut.heading.text.endsWith('…')).toBe(true);
	});

	it('savedScale keeps the rounded-up PNG within 16 million px and 8192 px on a side', () => {
		for (const [w, h] of [[4000, 4000], [20000, 900], [1234.5, 987.25]]) {
			const s = savedScale({ w, h }, 16, 'png');
			expect(Math.ceil(w * s.scale) * Math.ceil(h * s.scale)).toBeLessThanOrEqual(16_000_000);
			expect(Math.ceil(w * s.scale)).toBeLessThanOrEqual(8192);
		}
	});

	it('the saved SVG has the frame size, the legend rows and the pictures; without `saved` nothing of it', () => {
		const g = graph();
		const laid = lay(g);
		const legend = savedLegend(g, laid);
		const pictures = new Map<string, string | 'missing' | null>([['arms:v', URI], ['portrait:a', URI], ['portrait:c', 'missing']]);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts: FONTS, saved: { heading: 'Tree', legend, pictures, scale: 2 } });
		const ext = savedExtent(laid, legend, 'Tree', 16, approxMeasure, FONTS);
		expect(svg).toContain(`viewBox="0 0 ${ext.w} ${ext.h}"`);
		expect(svg).toContain(`width="${ext.w * 2}"`);
		for (const item of ['legend-line:descent', 'legend-sign', 'legend-house:v', 'legend-arms:v', 'legend-house:t', 'arms:a', 'arms:b', 'portrait:a', 'frame:c']) expect(svg, item).toContain(`data-item="${item}"`);
		expect(svg).not.toContain('data-item="portrait:c"');
		const plain = renderSvg(g, laid.layout, laid.edges, { pictures });
		expect(plain).not.toContain('data-item');
		expect(plain.match(/<image /g)!.length).toBe(3);
	});
});
