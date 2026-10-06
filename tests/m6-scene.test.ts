import { beforeAll, describe, expect, it } from 'vitest';
import { cardText, geometryFor } from '../src/layout/geometry';
import { layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { buildLegend, buildScene } from '../src/render/dom/scene';
import { LEGEND_ORDER } from '../src/render/tree-info';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

// WP6.2 in the Obsidian renderer: D26 union signs, D27 house strip class, D29 two-line names, the D25 legend.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const GEO = geometryFor(16, 'normal');
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const fonts = { text: 'serif', ui: 'sans', bold: '700' };

function scene(src: string, settings: LayoutSettings) {
	const { g } = build(src);
	const laid = layoutTree(g, GEO, settings, 'test');
	const root = new FEl('g');
	const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: (p) => (p.id === 'a' ? { linktext: 'A note', resolved: true } : null) });
	return { g, laid, root, s };
}

const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

describe('scene: D26 union signs', () => {
	it('each marker takes its shape class; the implicit union has no sign (D38)', () => {
		const src = `people:
  - {id: a, name: A, sex: m}
${['b', 'c', 'd', 'e', 'f'].map((x) => `  - {id: ${x}, name: ${x.toUpperCase()}, sex: f}\n  - {id: k${x}, name: K${x}, parents: [a, ${x}]}`).join('\n')}
unions:
  - {partners: [a, b]}
  - {partners: [a, c], type: betrothal}
  - {partners: [a, d], type: concubinage}
  - {partners: [a, e], type: affair}
`;
		const { root } = scene(src, { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } });
		const markers = all(root).filter((e) => [...e.classes].some((c) => c.startsWith('dynasty-union')));
		const kinds = markers.map((e) => [...e.classes].filter((c) => c !== 'dynasty-union-dot').join(' ') || 'dot').sort();
		expect(kinds).toEqual(['dot', 'dynasty-union-diamond', 'dynasty-union-open-triangle', 'dynasty-union-ring'].sort());
		for (const e of markers) expect(e.attrs.has('fill') || e.attrs.has('stroke')).toBe(false);
		expect(markers.find((e) => e.hasClass('dynasty-union-diamond'))!.tag).toBe('path');
		// D38: the affair's open triangle, point up; the betrothal ring 0.6 × unionSize.
		const tri = markers.find((e) => e.hasClass('dynasty-union-open-triangle'))!;
		expect(tri.tag).toBe('path');
		expect(tri.getAttribute('d')).toMatch(/^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+Z$/);
		expect(Number(markers.find((e) => e.hasClass('dynasty-union-ring'))!.getAttribute('r'))).toBeCloseTo(0.6 * GEO.unionSize, 6);
	});
});

describe('scene: D27 and D29 cards', () => {
	const src = `houses:\n  - {id: h, name: House H, color: '#1e4f8b'}\npeople:\n  - {id: a, name: Bartholomew Aldric Penhallow, house: h, born: '1100', title: Lord}\n  - {id: b, name: Bo}`;
	const settings: LayoutSettings = { sweeps: 4, far: { maxCardWidths: 3, maxGenerations: 1 }, orientation: 'sideways', tallCards: ['a'] };

	it('a card with a house colour gets dynasty-has-house; the strip is 0.5 em wide and as tall as the card', () => {
		const { root, laid } = scene(src, settings);
		const cards = all(root).filter((e) => e.hasClass('dynasty-card'));
		const a = cards.find((c) => c.getAttribute('data-person') === 'a')!;
		const b = cards.find((c) => c.getAttribute('data-person') === 'b')!;
		expect(a.hasClass('dynasty-has-house')).toBe(true);
		expect(b.hasClass('dynasty-has-house')).toBe(false);
		const strip = all(a).find((e) => e.hasClass('dynasty-card-strip'))!;
		expect(Number(strip.getAttribute('width'))).toBe(8);
		expect(Number(strip.getAttribute('height'))).toBe(laid.layout.persons.get('a')!.h);
	});

	it('a tall card draws the name on two text lines at the tall baselines; both lines are the link', () => {
		const { root, laid, s } = scene(src, settings);
		const box = laid.layout.persons.get('a')!;
		const t = cardText(laid.layout.geometry, true);
		const a = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === 'a')!;
		const names = all(a).filter((e) => e.hasClass('dynasty-card-name'));
		expect(names).toHaveLength(2);
		expect(names.map((n) => Number(n.getAttribute('y')))).toEqual([box.y + t.nameBaseline, box.y + t.name2Baseline!]);
		expect(names[0].text.startsWith('Bartholomew')).toBe(true);
		expect(names[1].text.length).toBeGreaterThan(0);
		expect([...s.links.values()]).toEqual(['A note', 'A note']);
		const title = all(a).find((e) => e.hasClass('dynasty-card-title'))!;
		const dates = all(a).find((e) => e.hasClass('dynasty-card-dates'))!;
		expect(Number(title.getAttribute('y'))).toBe(box.y + t.titleBaseline);
		expect(Number(dates.getAttribute('y'))).toBe(box.y + t.datesBaseline);
		// The Compact name stays one text line, centred in the taller card.
		const compact = all(a).find((e) => e.hasClass('dynasty-card-compact'))!;
		expect(Number(compact.getAttribute('y'))).toBeCloseTo(box.y + box.h / 2 + 0.35 * 1.5 * 16, 6);
		// A refit keeps both text lines.
		s.refit();
		expect(names[1].text.length).toBeGreaterThan(0);
	});

	it('a one-line card is drawn as before', () => {
		const { root, laid } = scene(src, settings);
		const b = all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === 'b')!;
		const names = all(b).filter((e) => e.hasClass('dynasty-card-name'));
		expect(names).toHaveLength(1);
		expect(Number(names[0].getAttribute('y'))).toBe(laid.layout.persons.get('b')!.y + cardText(laid.layout.geometry).nameBaseline);
	});
});

describe('scene: D25 legend', () => {
	it('one row per line kind and the sign row; each sample has its line class and no colour attribute', () => {
		const list = new FEl('div');
		buildLegend(list as unknown as HTMLElement);
		const rows = list.children.filter((c) => c.hasClass('dynasty-legend-row'));
		expect(rows).toHaveLength(LEGEND_ORDER.length + 1);
		expect(rows[rows.length - 1].hasClass('dynasty-legend-sign')).toBe(true);
		LEGEND_ORDER.forEach((kind, i) => {
			expect(all(rows[i]).some((e) => e.hasClass(`dynasty-line-${kind}`)), kind).toBe(true);
			for (const e of all(rows[i])) for (const k of ['fill', 'stroke', 'style']) expect(e.attrs.has(k), `${kind} ${e.tag} ${k}`).toBe(false);
		});
	});
});
