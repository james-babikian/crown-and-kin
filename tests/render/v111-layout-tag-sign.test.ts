import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { farTagSigns } from '../../src/layout/far-tag-sign';
import { MIN_HIT, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LaidOut, LayoutSettings } from '../../src/layout/model';
import { buildScene } from '../../src/render/dom/scene';
import { DEFAULT_LIGHT, UNION_MARKS, tagMarkSlot, unionShape, type UnionShape } from '../../src/render/styles';
import { approxMeasure, renderSvg, textWidth } from '../../src/render/svg-string';
import { FEl } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

// WP 0.2.1-WP2, item 2: a far couple with no children has no union dot, so its tag carries the partnership sign.
// A couple with children, a tag for several partners and a near couple are drawn as before.

useFakeDom({ css: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 7;
// Far when the partners are more than 1.5 card widths apart: x and z are siblings with y between them.
const FAR: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, far: { maxCardWidths: 1.5, maxGenerations: 1 } };

const family = (union: string, extra = '') => `people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: x, name: Xavier}
  - {id: y, name: Y}
  - {id: z, name: Zelda}
${extra}unions:
  - partners: [a, b]
  - ${union}
`;

function graph(source: string): FamilyGraph {
	const r = parseDynasty(source.replace('  - {id: x, name: Xavier}', '  - {id: x, name: Xavier, parents: [a, b]}').replace('  - {id: y, name: Y}', '  - {id: y, name: Y, parents: [a, b]}').replace('  - {id: z, name: Zelda}', '  - {id: z, name: Zelda, parents: [a, b]}'));
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function lay(g: FamilyGraph, font = 16): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geometryFor(font), FAR, 'test');
}

const TYPES: [string, string | undefined, UnionShape][] = [
	['marriage', 'marriage', 'dot'],
	['no type (a marriage)', undefined, 'dot'],
	['betrothal', 'betrothal', 'ring'],
	['concubinage', 'concubinage', 'diamond'],
	['affair', 'affair', 'open-triangle'],
	['a type the plugin does not know', 'courtship', 'dot'],
];
const unionOf = (type: string | undefined) => `{partners: [x, z]${type === undefined ? '' : `, type: ${type}`}}`;

describe('which tags carry a sign (farTagSigns)', () => {
	it('a childless far couple: both tags carry the type of the partnership', () => {
		const g = graph(family(unionOf('betrothal')));
		const laid = lay(g);
		expect(laid.layout.farTags.get('x')!.spouses).toEqual(['z']);
		expect(farTagSigns(g, laid.layout, laid.edges)).toEqual(
			new Map([
				['x', 'betrothal'],
				['z', 'betrothal'],
			]),
		);
	});

	it('a far couple with a child has a union dot, so its tags carry no sign', () => {
		const g = graph(family(unionOf('marriage'), '  - {id: k, name: Kid, parents: [x, z]}\n'));
		const laid = lay(g);
		expect(laid.layout.farTags.size).toBeGreaterThan(0);
		expect(laid.edges.markers.some((m) => m.kind === 'union' && m.union === g.unionsOf.get('x')![0])).toBe(true);
		expect(farTagSigns(g, laid.layout, laid.edges).size).toBe(0);
	});

	it('a tag for several partners has no single type, so it carries no sign; each of the partners keeps its own', () => {
		const src = `people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: x, name: Xavier, parents: [a, b]}
  - {id: y, name: Y, parents: [a, b]}
  - {id: z, name: Zelda, parents: [a, b]}
  - {id: v, name: V, parents: [a, b]}
  - {id: w, name: Wilda, parents: [a, b]}
unions:
  - partners: [a, b]
  - {partners: [x, z], type: betrothal}
  - {partners: [x, w], type: affair}
`;
		const r = parseDynasty(src);
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		const laid = lay(g);
		expect(laid.layout.farTags.get('x')!.spouses).toEqual(['z', 'w']);
		expect(farTagSigns(g, laid.layout, laid.edges)).toEqual(
			new Map([
				['z', 'betrothal'],
				['w', 'affair'],
			]),
		);
	});

	it('a near couple has no tag, so nothing is drawn for it', () => {
		const g = graph(family('{partners: [x, y], type: betrothal}'));
		const laid = lay(g);
		expect(laid.layout.farTags.size).toBe(0);
		expect(farTagSigns(g, laid.layout, laid.edges).size).toBe(0);
	});
});

describe('the live tree draws the sign inside the tag, at the Full and the Compact level', () => {
	for (const [name, type, shape] of TYPES) {
		it(`${name}: a ${shape} in both pills, inside the pill, between the marriage sign and the name`, () => {
			const g = graph(family(unionOf(type)));
			const laid = lay(g);
			const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			for (const person of ['x', 'z']) {
				const el = s.tags.find((t) => t.tag.person === person)!.el as unknown as FEl;
				const marks = el.all().filter((e) => e.classes.has('dynasty-tag-mark'));
				expect(marks, person).toHaveLength(2);
				for (const mark of marks) {
					expect(mark.classes.has(`dynasty-union-${shape}`), person).toBe(true);
					const part = mark.parentElement!;
					const pill = part.all().find((e) => e.classes.has('dynasty-tag-pill'))!;
					const left = Number(pill.getAttribute('x'));
					const right = left + Number(pill.getAttribute('width'));
					const cx = mark.tag === 'circle' ? Number(mark.getAttribute('cx')) : Number(/^M([\d.-]+)/.exec(mark.getAttribute('d')!)![1]);
					expect(cx, `${person} ${part.classes.size}`).toBeGreaterThan(left);
					expect(cx).toBeLessThan(right);
				}
				// The overview pill is only the marriage sign.
				const overview = el.all().find((e) => e.classes.has('dynasty-tag-sign'))!;
				expect(overview.all().some((e) => e.classes.has('dynasty-tag-mark'))).toBe(false);
				// The tap area is as before: at least 44 px each way.
				const tag = s.tags.find((t) => t.tag.person === person)!.tag;
				expect(tag.hit.w).toBeGreaterThanOrEqual(MIN_HIT);
				expect(tag.hit.h).toBeGreaterThanOrEqual(MIN_HIT);
			}
		});
	}

	it('the name is moved right by the sign and the pill is wider by about that room; a tag with no sign is drawn as before', () => {
		const withSign = graph(family(unionOf('marriage')));
		const withKid = graph(family(unionOf('marriage'), '  - {id: k, name: Kid, parents: [x, z]}\n'));
		const widthOf = (g: FamilyGraph) => {
			const laid = lay(g);
			const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null });
			const el = s.tags.find((t) => t.tag.person === 'x')!.el as unknown as FEl;
			const full = el.all().find((e) => e.classes.has('dynasty-tag-full'))!;
			const text = full.all().find((e) => e.classes.has('dynasty-tag-text'))!;
			return { w: Number(full.all().find((e) => e.classes.has('dynasty-tag-pill'))!.getAttribute('width')), text: text.text };
		};
		const a = widthOf(withSign);
		const b = widthOf(withKid);
		expect(b.text).toBe('⚭ Zelda');
		expect(a.text.startsWith('⚭')).toBe(true);
		expect(a.text.endsWith('Zelda')).toBe(true);
		expect(a.w).toBeGreaterThan(b.w);
	});
});

describe('the headless drawing', () => {
	const tagMark = (svg: string) => /<text [^>]*>⚭<\/text>\n<(circle|path) ([^>]*)\/>\n<text/.exec(svg);

	for (const [name, type, shape] of TYPES) {
		it(`${name}: a ${shape} sign in the pill`, () => {
			const g = graph(family(unionOf(type)));
			const laid = lay(g);
			const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
			const found = [...svg.matchAll(/<text [^>]*>⚭<\/text>\n<(circle|path) ([^>]*)\/>\n<text/g)];
			expect(found).toHaveLength(2);
			const spec = UNION_MARKS[shape];
			for (const m of found) {
				expect(m[1]).toBe(unionShape('union', type) === 'dot' || shape === 'ring' ? 'circle' : 'path');
				if (spec.stroke) expect(m[2]).toContain(`stroke-width="${spec.stroke}"`);
				else expect(m[2]).toContain(`fill="${DEFAULT_LIGHT.textMuted}"`);
			}
		});
	}

	it('the sign is inside the pill and the name starts after it', () => {
		const g = graph(family(unionOf('betrothal')));
		const laid = lay(g);
		const geo = laid.layout.geometry;
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
		const tag = laid.layout.farTags.get('x')!;
		const tagFont = 0.75 * geo.fontPx;
		const rect = new RegExp(`<rect x="([\\d.]+)" y="[\\d.]+" width="([\\d.]+)" height="${geo.tagH}" rx="${geo.tagH / 2}" fill`);
		const pills = [...svg.matchAll(new RegExp(rect, 'g'))].map((m) => ({ left: Number(m[1]), w: Number(m[2]) }));
		const pill = pills.find((p) => Math.abs(p.left + p.w / 2 - tag.x) < 0.01)!;
		expect(pill).toBeTruthy();
		const label = new RegExp(String.raw`<text x="([\d.]+)" y="[\d.]+" font-size="${tagFont}"[^>]*>Zelda</text>`).exec(svg)!;
		const pad = geo.tagH / 2;
		// 0.2.2 (D108): the room depends on the shape; this tag shows a ring.
		const slot = tagMarkSlot('ring', tagFont);
		expect(Number(label[1])).toBeCloseTo(pill.left + pad + tagFont * 1.4 + slot, 6);
		expect(pill.w).toBeCloseTo(textWidth('Zelda', tagFont) + tagFont * 1.4 + slot + 2 * pad, 6);
		expect(tagMark(svg)).not.toBeNull();
	});

	it('a tag with no sign is drawn exactly as before: the width is the text, the marriage sign and the padding', () => {
		const g = graph(family(unionOf('marriage'), '  - {id: k, name: Kid, parents: [x, z]}\n'));
		const laid = lay(g);
		const geo = laid.layout.geometry;
		const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, measure: approxMeasure, fonts: FONTS });
		expect(tagMark(svg)).toBeNull();
		const tagFont = 0.75 * geo.fontPx;
		const widths = [...svg.matchAll(new RegExp(`<rect x="[\\d.]+" y="[\\d.]+" width="([\\d.]+)" height="${geo.tagH}" rx="${geo.tagH / 2}" fill`, 'g'))].map((m) => Number(m[1]));
		expect(widths.length).toBeGreaterThan(0);
		const expected = [textWidth('Zelda', tagFont), textWidth('Xavier', tagFont)].map((t) => t + tagFont * 1.4 + geo.tagH);
		for (const w of widths) expect(expected.some((e) => Math.abs(e - w) < 1e-6)).toBe(true);
	});
});
