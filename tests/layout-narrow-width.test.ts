import { describe, expect, it } from 'vitest';
import { cardText, geometryFor, narrowWidth, sidewaysGeometry } from '../src/layout/geometry';
import { clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { renderSvg } from '../src/render/svg-string';
import { build, fixture } from './helpers';

// WP5.5c: the narrow sideways card width follows the note box (`LayoutSettings.narrowCardW`).

const GEO = geometryFor(16, 'normal');
const FAR = { maxCardWidths: 3, maxGenerations: 1 };
const narrow = (w?: number): LayoutSettings => ({ sweeps: 4, far: FAR, orientation: 'sideways', sidewaysCards: 'narrow', narrowCardW: w });

describe('narrow card width', () => {
	it('is clamped to 8 em to 10.25 em, and 10.25 em when absent or not a number', () => {
		expect(narrowWidth(GEO)).toBe(164);
		expect(narrowWidth(GEO, 200)).toBe(164);
		expect(narrowWidth(GEO, 100)).toBe(128);
		expect(narrowWidth(GEO, 150)).toBe(150);
		for (const bad of [NaN, Infinity, -Infinity]) expect(narrowWidth(GEO, bad)).toBe(164);
		// The bounds follow the font.
		const f24 = geometryFor(24, 'normal');
		expect([narrowWidth(f24, 1), narrowWidth(f24, 1000)]).toEqual([192, 246]);
	});

	it('is rounded to 0.5 px, and the geometry uses exactly that width', () => {
		expect(narrowWidth(GEO, 150.2)).toBe(150);
		expect(narrowWidth(GEO, 150.3)).toBe(150.5);
		expect(sidewaysGeometry(GEO, 'narrow', 150.3).cardW).toBe(150.5);
		// Normal sideways cards ignore it; compact cards are never widened by it.
		expect(sidewaysGeometry(GEO, 'normal', 150).cardW).toBe(GEO.cardW);
		const compact = geometryFor(16, 'compact');
		expect(sidewaysGeometry(compact, 'narrow', 160).cardW).toBe(compact.cardW);
		expect(sidewaysGeometry(compact, 'narrow', 130).cardW).toBe(130);
	});

	it('the layout draws cards at that width', () => {
		const { g } = build(fixture('06'));
		clearLayoutCache();
		const { layout } = layoutTree(g, GEO, narrow(151.1), 'x');
		expect(layout.geometry.cardW).toBe(151);
		for (const b of layout.persons.values()) expect(b.w).toBe(151);
	});

	it('the cache key holds the width as the layout uses it', () => {
		const { g } = build(fixture('01'));
		const key = (s: LayoutSettings) => layoutKey(g, GEO, s, 'x');
		// Widths that round alike, or clamp alike, share a key; others do not.
		expect(key(narrow(150.1))).toBe(key(narrow(150.2)));
		expect(key(narrow(150.1))).not.toBe(key(narrow(150.4)));
		expect(key(narrow(300))).toBe(key(narrow()));
		expect(key(narrow(10))).toBe(key(narrow(128)));
		expect(key(narrow(NaN))).toBe(key(narrow()));
		// Ignored unless sideways and narrow.
		expect(key({ sweeps: 4, far: FAR, orientation: 'sideways', sidewaysCards: 'normal', narrowCardW: 140 })).toBe(key({ sweeps: 4, far: FAR, orientation: 'sideways' }));
		expect(key({ sweeps: 4, far: FAR, narrowCardW: 140, sidewaysCards: 'narrow' })).toBe(key({ sweeps: 4, far: FAR }));
	});

	it('down is unchanged by it', () => {
		for (const f of ['02', '06', '07']) {
			const { g } = build(fixture(f));
			clearLayoutCache();
			const plain = layoutTree(g, GEO, { sweeps: 4, far: FAR }, 'x');
			clearLayoutCache();
			const withW = layoutTree(g, GEO, { sweeps: 4, far: FAR, sidewaysCards: 'narrow', narrowCardW: 130 }, 'x');
			expect(JSON.stringify(withW, (_, v) => (v instanceof Map ? [...v] : v))).toBe(JSON.stringify(plain, (_, v) => (v instanceof Map ? [...v] : v)));
		}
	});

	it('names on the narrowest cards still end with an ellipsis inside the card', () => {
		const src = 'people:\n  - {id: a, name: Aldebrandine Valmont-Castellane of the Western Marches, title: Duchess of the Long Western Marches}\n';
		const { g } = build(src);
		clearLayoutCache();
		const laid = layoutTree(g, GEO, narrow(128), 'x');
		const t = cardText(laid.layout.geometry);
		expect(laid.layout.geometry.cardW).toBe(128);
		expect(t.textW).toBe(128 - t.padX - 0.5 * GEO.fontPx);
		const svg = renderSvg(g, laid.layout, laid.edges, { margin: 0 });
		const name = svg.match(/font-weight="600"[^>]*>([^<]*)</)![1];
		expect(name.endsWith('…')).toBe(true);
		expect(name.length).toBeLessThan('Aldebrandine Valmont-Castellane of the Western Marches'.length);
	});
});
