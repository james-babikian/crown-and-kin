import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { TAG_COMPACT_FONT_EM, TAG_FONT_EM, buildScene } from '../src/render/dom/scene';
import { DEFAULT_LIGHT, UNION_MARKS, tagMarkGap, tagMarkSlot, type UnionShape } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';

// 0.2.2 (D108, spec §13.17 rule 4): in a far-couple tag the gap G from the right edge of the partnership sign to the
// start of the name is the same for the dot, the ring, the diamond and the open triangle, and it is the dot's gap of 0.2.1.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const FAR: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, far: { maxCardWidths: 1.5, maxGenerations: 1 } };
const SHAPES: [string, UnionShape][] = [
	['marriage', 'dot'],
	['betrothal', 'ring'],
	['concubinage', 'diamond'],
	['affair', 'open-triangle'],
];

const source = (type: string, name = 'Zelda') => `people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: x, name: Xavier, parents: [a, b]}
  - {id: y, name: Y, parents: [a, b]}
  - {id: z, name: ${name}, parents: [a, b]}
unions:
  - partners: [a, b]
  - {partners: [x, z], type: ${type}}
`;

function graph(type: string, name?: string): FamilyGraph {
	const r = parseDynasty(source(type, name));
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function lay(g: FamilyGraph, fontPx: number): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geometryFor(fontPx), FAR, 'test');
}

/** The largest x in a path's coordinates and the smallest one. */
function xs(d: string): { min: number; max: number } {
	const all = [...d.matchAll(/[ML]([-\d.]+) /g)].map((m) => Number(m[1]));
	return { min: Math.min(...all), max: Math.max(...all) };
}

/** Left and right edge of a drawn sign (its outline included), from the attributes of its element. */
function edges(shape: UnionShape, attr: { cx?: string; r?: string; d?: string }): { left: number; right: number } {
	const half = (UNION_MARKS[shape].stroke ?? 0) / 2;
	if (attr.d !== undefined) {
		const b = xs(attr.d);
		return { left: b.min - half, right: b.max + half };
	}
	const cx = Number(attr.cx);
	const r = Number(attr.r);
	return { left: cx - r - half, right: cx + r + half };
}

describe('the headless drawing: the same gap G before the name for the four shapes (Full text size)', () => {
	for (const fontPx of [12, 16, 22]) {
		it(`at ${fontPx} px: G is equal within 0.01 px, equals the dot's gap of 0.2.1 and the sign clears the marriage sign`, () => {
			const gaps: number[] = [];
			for (const [type, shape] of SHAPES) {
				const g = graph(type);
				const laid = lay(g, fontPx);
				const geo = laid.layout.geometry;
				const tagFont = 0.75 * geo.fontPx;
				const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
				const i = svg.indexOf('⚭</text>');
				const chunk = svg.slice(svg.lastIndexOf('<rect', i), svg.indexOf('Zelda</text>', i));
				const rect = /<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/.exec(chunk)!;
				const mark = /<(circle|path) ([^>]*)\/>/.exec(chunk)!;
				const attr = Object.fromEntries([...mark[2]!.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
				const name = Number(/<text x="([-\d.]+)" y="[-\d.]+" font-size="[-\d.]+"[^>]*>$/.exec(chunk.slice(chunk.lastIndexOf('<text')))![1]);
				const e = edges(shape, attr);
				const gap = name - e.right;
				gaps.push(gap);
				// The dot's gap of 0.2.1: half of the slot of 1.1 text sizes minus the dot's radius.
				// A path is written with two decimals, so its edge can be 0.005 px off.
				expect(Math.abs(gap - (0.55 * tagFont - 0.2 * tagFont)), shape).toBeLessThan(0.01);
				expect(Math.abs(gap - tagMarkGap(tagFont)), shape).toBeLessThan(0.01);
				// No overlap with the marriage sign (it is drawn in the box that ends `1.4 * tagFont` after the padding) and the pill.
				const pad = geo.tagH / 2;
				const markStart = Number(rect[1]) + pad + 1.4 * tagFont;
				expect(e.left, shape).toBeGreaterThanOrEqual(markStart + gap - 0.01);
				expect(e.left, shape).toBeGreaterThan(Number(rect[1]));
				expect(Number(rect[1]) + Number(rect[2]), shape).toBeGreaterThan(name);
			}
			for (const gap of gaps) expect(Math.abs(gap - gaps[0]!)).toBeLessThan(0.01);
		});
	}

	it('a name that is cut with an ellipsis still fits: the pill stays inside its zone, for every shape', () => {
		for (const [type, shape] of SHAPES) {
			const g = graph(type, 'Zelda Bartholomew-Fitzgerald-Montgomery-Wellesley');
			const laid = lay(g, 16);
			const tag = laid.layout.farTags.get('x')!;
			const room = tag.zoneW ?? tag.hit.w;
			const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
			const pills = [...svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)" height="18" rx="9" fill/g)].map((m) => ({ left: Number(m[1]), w: Number(m[2]) }));
			expect(pills.length, shape).toBeGreaterThan(0);
			for (const p of pills) expect(p.w, shape).toBeLessThanOrEqual(Math.max(room, tag.hit.w) + 1e-6);
			const cut = [...svg.matchAll(/>(Zelda[^<]*…|Xavier[^<]*…)<\/text>/g)];
			// The name text is cut with "…" when it does not fit, and the sign's slot is part of what is subtracted.
			expect(cut.length + (svg.includes('Wellesley</text>') ? 1 : 0), shape).toBeGreaterThan(0);
			expect(tagMarkSlot(shape, 12)).toBeGreaterThanOrEqual(tagMarkSlot('dot', 12));
		}
	});

	it('the dot is drawn as in 0.2.1, byte for byte (tag of a childless far couple, 16 px)', () => {
		const g = graph('marriage');
		const laid = lay(g, 16);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
		const i = svg.indexOf('⚭</text>');
		const chunk = svg.slice(svg.lastIndexOf('<rect', i), svg.indexOf('Zelda</text>', i) + 'Zelda</text>'.length);
		// Recorded from the 0.2.1 build (d26fe18); every y is 6 px higher since 0.2.4 (D117: the card is 61 px high, not 64, on each of two rows).
		expect(chunk).toBe(
			'<rect x="51" y="219" width="78" height="18" rx="9" fill="#fafafa" stroke="#5c5c5c" stroke-width="1"/>\n' +
				'<text x="60" y="232.2" font-size="15" font-family="Segoe UI Symbol, DejaVu Sans, sans-serif" fill="#5c5c5c">⚭</text>\n' +
				'<circle cx="83.39999999999999" cy="228" r="2.4000000000000004" fill="#5c5c5c"/>\n' +
				'<text x="90" y="232.2" font-size="12" fill="#5c5c5c">Zelda</text>',
		);
	});
});

// Two measures: letters of one width, and a proportional one where a space is not a multiple of the slot.
const MEASURES: [string, (s: string) => number][] = [
	['7 px for every character', (s) => [...s].length * 7],
	['a narrow space', (s) => [...s].reduce((n, c) => n + (c === ' ' || c === ' ' ? 3.3 : c === '⚭' ? 9 : 6.4), 0)],
];

describe('the live drawing: the same gap G before the name for the four shapes (Full and Compact)', () => {
	for (const [measureName, measure] of MEASURES) {
		for (const fontPx of [14, 16]) {
			it(`${measureName}, ${fontPx} px: G is equal within 0.5 px, is the gap of the dot, and the sign clears the marriage sign`, () => {
				for (const [level, em] of [
					['dynasty-tag-full', TAG_FONT_EM],
					['dynasty-tag-compact', TAG_COMPACT_FONT_EM],
				] as const) {
					const gaps: number[] = [];
					for (const [type, shape] of SHAPES) {
						const g = graph(type);
						const laid = lay(g, fontPx);
						const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
						const el = s.tags.find((t) => t.tag.person === 'x')!.el as unknown as FEl;
						const part = el.all().find((e) => e.classes.has(level))!;
						const mark = part.all().find((e) => e.classes.has('dynasty-tag-mark'))!;
						const textEl = part.all().find((e) => e.classes.has('dynasty-tag-text'))!;
						const pill = part.all().find((e) => e.classes.has('dynasty-tag-pill'))!;
						const label = textEl.text;
						const lead = /^⚭[  ]*/.exec(label)![0];
						expect(label.slice(lead.length), shape).toBe('Zelda');
						const textStart = Number(textEl.getAttribute('x')) - measure(label) / 2;
						const nameStart = textStart + measure(lead);
						const e = edges(shape, { cx: mark.getAttribute('cx') ?? undefined, r: mark.getAttribute('r') ?? undefined, d: mark.getAttribute('d') ?? undefined });
						const gap = nameStart - e.right;
						gaps.push(gap);
						// G is the dot's gap of 0.2.1 (half the slot minus the dot's radius, in the text size of this level).
						expect(gap, `${level} ${shape}`).toBeCloseTo(tagMarkGap(em * laid.layout.geometry.fontPx), 1);
						// The clear room on the left of the sign (after the marriage sign) is at least G.
						expect(e.left - (textStart + measure('⚭')), `${level} ${shape}`).toBeGreaterThanOrEqual(gap - 0.5);
						const left = Number(pill.getAttribute('x'));
						expect(e.left, `${level} ${shape}`).toBeGreaterThan(left);
						expect(nameStart, `${level} ${shape}`).toBeLessThan(left + Number(pill.getAttribute('width')));
					}
					for (const gap of gaps) expect(Math.abs(gap - gaps[0]!), `${level} ${gaps.join(' ')}`).toBeLessThan(0.5);
				}
			});
		}
	}

	it('a cut name still fits: the pill stays inside its zone and the gap stays G, for every shape', () => {
		const measure = MEASURES[0]![1];
		for (const [type, shape] of SHAPES) {
			const g = graph(type, 'Zelda Bartholomew-Fitzgerald-Montgomery-Wellesley');
			const laid = lay(g, 16);
			const tag = laid.layout.farTags.get('x')!;
			const zone = tag.zoneW ?? tag.hit.w;
			const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			const el = s.tags.find((t) => t.tag.person === 'z')!.el as unknown as FEl;
			for (const level of ['dynasty-tag-full', 'dynasty-tag-compact']) {
				const part = el.all().find((e) => e.classes.has(level))!;
				const pill = part.all().find((e) => e.classes.has('dynasty-tag-pill'))!;
				const textEl = part.all().find((e) => e.classes.has('dynasty-tag-text'))!;
				expect(Number(pill.getAttribute('width')), `${level} ${shape}`).toBeLessThanOrEqual(zone + 1e-6);
				const mark = part.all().find((e) => e.classes.has('dynasty-tag-mark'))!;
				const label = textEl.text;
				const lead = /^⚭[  ]*/.exec(label)![0];
				const nameStart = Number(textEl.getAttribute('x')) - measure(label) / 2 + measure(lead);
				const e = edges(shape, { cx: mark.getAttribute('cx') ?? undefined, r: mark.getAttribute('r') ?? undefined, d: mark.getAttribute('d') ?? undefined });
				expect(nameStart - e.right, `${level} ${shape}`).toBeGreaterThan(0);
				// The text, the sign and the room all lie in the pill.
				expect(measure(label) + 2 * (Number(pill.getAttribute('height')) / 2), `${level} ${shape}`).toBeLessThanOrEqual(zone + 1e-6);
			}
		}
	});
});
