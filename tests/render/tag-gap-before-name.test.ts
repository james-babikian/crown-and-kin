import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LaidOut, LayoutSettings } from '../../src/layout/model';
import { TAG_COMPACT_FONT_EM, TAG_FONT_EM, buildScene } from '../../src/render/dom/scene';
import { DEFAULT_LIGHT, TAG_SIGN_GAP_EM, UNION_MARKS, fullTagPill, tagMarkGap, tagMarkSlot, type UnionShape } from '../../src/render/styles';
import { SAVED_SIGN_EM, approxMeasure, renderSvg, textWidth } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

// 0.2.2 (D108, spec §13.17 rule 4): in a far-couple tag the gap G from the right edge of the partnership sign to the
// start of the name is the same for the dot, the ring, the diamond and the open triangle. It was the dot's gap of 0.2.1; since D353 4 Now it is
// the fixed gap before every name (0.3 text sizes), and the ⚭ and the partnership sign keep their old spacing (one space of the font and the
// dot's old gap on the sign's left), so the gap after the ⚭ does not grow where a sign follows it.

useFakeDom({ css: true });

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
		it(`at ${fontPx} px: G is equal within 0.01 px, is the fixed gap of 0.3 text sizes, and the ⚭ and the sign keep their old spacing`, () => {
			const gaps: number[] = [];
			for (const [type, shape] of SHAPES) {
				const g = graph(type);
				const laid = lay(g, fontPx);
				const geo = laid.layout.geometry;
				const tagFont = TAG_FONT_EM * geo.fontPx;
				const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
				const i = svg.indexOf('⚭</text>');
				const chunk = svg.slice(svg.lastIndexOf('<rect', i), svg.indexOf('Zelda</text>', i));
				const rect = /<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/.exec(chunk)!;
				const signX = Number(/<text x="([-\d.]+)"[^>]*>⚭<\/text>/.exec(chunk)![1]);
				const mark = /<(circle|path) ([^>]*)\/>/.exec(chunk)!;
				const attr = Object.fromEntries([...mark[2]!.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
				const name = Number(/<text x="([-\d.]+)" y="[-\d.]+" font-size="[-\d.]+"[^>]*>$/.exec(chunk.slice(chunk.lastIndexOf('<text')))![1]);
				const e = edges(shape, attr);
				const gap = name - e.right;
				gaps.push(gap);
				// D353 4 Now: the fixed gap of 0.3 text sizes. A path is written with two decimals, so its edge can be 0.005 px off.
				expect(Math.abs(gap - TAG_SIGN_GAP_EM * tagFont), shape).toBeLessThan(0.01);
				expect(Math.abs(gap - tagMarkGap(tagFont)), shape).toBeLessThan(0.01);
				// The ⚭ and the sign keep their old spacing: after the ⚭ (0.82 text sizes wide), one space of the tag font and the dot's gap of 0.2.1
				// (half of the slot of 1.1 text sizes minus the dot's radius).
				const pad = fullTagPill(geo, 0).h / 2;
				expect(signX, shape).toBeCloseTo(Number(rect[1]) + pad, 9);
				expect(Math.abs(e.left - (signX + SAVED_SIGN_EM * tagFont) - (textWidth(' ', tagFont) + (0.55 - 0.2) * tagFont)), shape).toBeLessThan(0.01);
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

	it('the tag of a childless far couple at 16 px is drawn byte for byte as recorded', () => {
		const g = graph('marriage');
		const laid = lay(g, 16);
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
		const i = svg.indexOf('⚭</text>');
		const chunk = svg.slice(svg.lastIndexOf('<rect', i), svg.indexOf('Zelda</text>', i) + 'Zelda</text>'.length);
		// First recorded from the 0.2.1 build (the pill's edge is the line colour since 0.2.8, D212; every y 6 px higher since 0.2.4, D117). Recorded again for
		// D353 2 A: the text is 0.85 em (13.6 px) in the pill of the layout band (y 219 to 237, 18 px), so every part is larger by the text size;
		// D353 4 Now: the ⚭ takes its width in Segoe UI Symbol (0.82 text sizes), then one space of the font and the dot's old gap before the dot,
		// and the fixed gap of 0.3 text sizes between the dot and the name.
		expect(chunk).toBe(
			'<rect x="49.244" y="219" width="81.512" height="18" rx="9" fill="#fafafa" stroke="#5c5c5c" stroke-width="1"/>\n' +
				'<text x="58.244" y="232.76" font-size="17" font-family="Segoe UI Symbol, DejaVu Sans, sans-serif" fill="#5c5c5c">⚭</text>\n' +
				'<circle cx="80.956" cy="228" r="2.72" fill="#5c5c5c"/>\n' +
				'<text x="87.756" y="232.76" font-size="13.6" fill="#5c5c5c">Zelda</text>',
		);
	});

	it('D353 4 Now: the saved picture leaves the same fixed gap before the name in every font, after the ⚭ (its width in the symbol font) or after the sign', () => {
		const g = graph('marriage', 'Zelda');
		const kid = parseDynasty(source('marriage').replace('unions:', '  - {id: k, name: Kid, parents: [x, z]}\nunions:'));
		if (!kid.ok) throw new Error('parse');
		for (const graphOf of [g, deriveFamilies(kid.tree)]) {
			const laid = lay(graphOf, 16);
			const tagFont = TAG_FONT_EM * 16;
			for (const ui of ['sans', 'Alegreya Sans', 'Segoe UI']) {
				const svg = renderSvg(graphOf, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: { ...FONTS, ui } });
				const i = svg.indexOf('⚭</text>');
				const sign = Number(/<text x="([-\d.]+)"[^>]*>⚭<\/text>$/.exec(svg.slice(svg.lastIndexOf('<text', i), i + '⚭</text>'.length))![1]);
				const name = Number(/<text x="([-\d.]+)"[^>]*>Zelda<\/text>/.exec(svg.slice(i))![1]);
				const dot = /<circle cx="([-\d.]+)" cy="[-\d.]+" r="([-\d.]+)"/.exec(svg.slice(i));
				// With the sign (a childless couple), the gap stands between the sign and the name; without it, after the ⚭.
				const before = graphOf === g ? Number(dot![1]) + Number(dot![2]) : sign + SAVED_SIGN_EM * tagFont;
				expect(name - before, ui).toBeCloseTo(TAG_SIGN_GAP_EM * tagFont, 2);
			}
		}
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
			it(`${measureName}, ${fontPx} px: G is equal within 0.5 px, is the fixed gap, and the sign clears the marriage sign`, () => {
				for (const [level, em] of [
					['dynasty-tag-full', TAG_FONT_EM],
					['dynasty-tag-compact', TAG_COMPACT_FONT_EM],
				] as const) {
					const gaps: number[] = [];
					for (const [type, shape] of SHAPES) {
						const g = graph(type);
						const laid = lay(g, fontPx);
						const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
						// D377 step 8: the hidden tag pills make their text when their level first shows.
						s.showLevel('compact');
						s.showLevel('overview');
						const el = s.tags.find((t) => t.tag.person === 'x')!.el as unknown as FEl;
						const part = el.all().find((e) => e.classes.has(level))!;
						const mark = part.all().find((e) => e.classes.has('dynasty-tag-mark'))!;
						const textEl = part.all().find((e) => e.classes.has('dynasty-tag-text'))!;
						const pill = part.all().find((e) => e.classes.has('dynasty-tag-pill'))!;
						// The ⚭ starts at the text's x; the name is a tspan with its own exact x after the ⚭ and the sign (`tagPillParts`).
						const nameEl = textEl.all().find((e) => e.classes.has('dynasty-tag-name'))!;
						expect(nameEl.textContent, shape).toBe('Zelda');
						expect(textEl.textContent, shape).toBe('⚭Zelda');
						const textStart = Number(textEl.getAttribute('x'));
						const nameStart = Number(nameEl.getAttribute('x'));
						const e = edges(shape, { cx: mark.getAttribute('cx') ?? undefined, r: mark.getAttribute('r') ?? undefined, d: mark.getAttribute('d') ?? undefined });
						const gap = nameStart - e.right;
						gaps.push(gap);
						// G is the fixed gap before the name (D353 4 Now, 0.3 of the text size of this level).
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
			// D377 step 8: the hidden tag pills make their text when their level first shows.
			s.showLevel('compact');
			s.showLevel('overview');
			// x's tag names Zelda and is cut; z's tag names Xavier whole.
			for (const [person, level] of ['x', 'z'].flatMap((who) => ['dynasty-tag-full', 'dynasty-tag-compact'].map((lv) => [who, lv] as const))) {
				const el = s.tags.find((t) => t.tag.person === person)!.el as unknown as FEl;
				const part = el.all().find((e) => e.classes.has(level))!;
				const pill = part.all().find((e) => e.classes.has('dynasty-tag-pill'))!;
				const textEl = part.all().find((e) => e.classes.has('dynasty-tag-text'))!;
				expect(Number(pill.getAttribute('width')), `${level} ${shape}`).toBeLessThanOrEqual(zone + 1e-6);
				const mark = part.all().find((e) => e.classes.has('dynasty-tag-mark'))!;
				const nameEl = textEl.all().find((e) => e.classes.has('dynasty-tag-name'))!;
				const name = nameEl.textContent;
				expect(name.endsWith('…'), `${person} ${level} ${shape}`).toBe(person === 'x');
				const nameStart = Number(nameEl.getAttribute('x'));
				const e = edges(shape, { cx: mark.getAttribute('cx') ?? undefined, r: mark.getAttribute('r') ?? undefined, d: mark.getAttribute('d') ?? undefined });
				expect(nameStart - e.right, `${level} ${shape}`).toBeGreaterThan(0);
				// The ⚭, the sign and the cut name all lie in the pill, with its padding at the end.
				const left = Number(pill.getAttribute('x'));
				const pad = Number(pill.getAttribute('height')) / 2;
				expect(Number(textEl.getAttribute('x')), `${level} ${shape}`).toBeCloseTo(left + pad, 6);
				expect(nameStart + measure(name) + pad, `${level} ${shape}`).toBeLessThanOrEqual(left + Number(pill.getAttribute('width')) + 1e-6);
			}
		}
	});
});

describe('D353 4 Now: the live tree leaves a fixed gap after the ⚭, not a space of the font', () => {
	// The owner's words: "a fixed small gap after the sign, the same in every font, on the screen and when you save the tree as a picture."
	it('a tag with no sign: the name starts 0.3 text sizes after the ⚭, with a narrow and a wide space in the font, at Full and Compact', () => {
		const kid = parseDynasty(source('marriage').replace('unions:', '  - {id: k, name: Kid, parents: [x, z]}\nunions:'));
		if (!kid.ok) throw new Error('parse');
		const g = deriveFamilies(kid.tree);
		const laid = lay(g, 16);
		for (const [measureName, measure] of [...MEASURES, ['a wide space', (s: string) => [...s].reduce((n, c) => n + (c === ' ' ? 11 : 7), 0)] as [string, (s: string) => number]]) {
			const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			// D377 step 8: the hidden tag pills make their text when their level first shows.
			s.showLevel('compact');
			s.showLevel('overview');
			const el = s.tags.find((t) => t.tag.person === 'x')!.el as unknown as FEl;
			for (const [level, em] of [['dynasty-tag-full', TAG_FONT_EM], ['dynasty-tag-compact', TAG_COMPACT_FONT_EM]] as const) {
				const textEl = el.all().find((e) => e.classes.has(level))!.all().find((e) => e.classes.has('dynasty-tag-text'))!;
				const nameEl = textEl.all().find((e) => e.classes.has('dynasty-tag-name'))!;
				expect(textEl.textContent, `${measureName} ${level}`).toBe('⚭Zelda');
				const gap = Number(nameEl.getAttribute('x')) - Number(textEl.getAttribute('x')) - measure('⚭');
				expect(gap, `${measureName} ${level}`).toBeCloseTo(TAG_SIGN_GAP_EM * em * 16, 9);
			}
		}
	});

	it('a tag with a sign ("⚭ ● Sybil Harrow"): the ⚭ and the sign keep their old spacing, and the fixed gap stands only between the sign and the name', () => {
		const g = graph('marriage', 'Sybil Harrow');
		const laid = lay(g, 16);
		for (const [measureName, measure] of [...MEASURES, ['a wide space', (s: string) => [...s].reduce((n, c) => n + (c === ' ' ? 11 : 7), 0)] as [string, (s: string) => number]]) {
			const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			// D377 step 8: the hidden tag pills make their text when their level first shows.
			s.showLevel('compact');
			s.showLevel('overview');
			const el = s.tags.find((t) => t.tag.person === 'x')!.el as unknown as FEl;
			for (const [level, em] of [['dynasty-tag-full', TAG_FONT_EM], ['dynasty-tag-compact', TAG_COMPACT_FONT_EM]] as const) {
				const font = em * 16;
				const part = el.all().find((e) => e.classes.has(level))!;
				const textEl = part.all().find((e) => e.classes.has('dynasty-tag-text'))!;
				const nameEl = textEl.all().find((e) => e.classes.has('dynasty-tag-name'))!;
				const mark = part.all().find((e) => e.classes.has('dynasty-tag-mark'))!;
				const e = edges('dot', { cx: mark.getAttribute('cx') ?? undefined, r: mark.getAttribute('r') ?? undefined });
				expect(nameEl.textContent, `${measureName} ${level}`).toBe('Sybil Harrow');
				// The old spacing (before D353 4 Now): one space of the font after the ⚭, then the dot's gap of 0.2.1 (half the 1.1 slot less its radius).
				const afterSign = e.left - Number(textEl.getAttribute('x')) - measure('⚭');
				expect(afterSign, `${measureName} ${level}`).toBeCloseTo(measure('⚭ ') - measure('⚭') + (0.55 - 0.2) * font, 9);
				expect(Number(nameEl.getAttribute('x')) - e.right, `${measureName} ${level}`).toBeCloseTo(TAG_SIGN_GAP_EM * font, 9);
			}
		}
	});
});
