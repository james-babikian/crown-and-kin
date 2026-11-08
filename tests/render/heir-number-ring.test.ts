/*
 * D334 Q3: the numbered ring of an heir in the Show view. The Full level keeps the word tab; the Compact level (every device) and the Overview level
 * (a computer only) show a small ring with the number. One layer holds all rings, so a level change restyles one element; the tree view writes each
 * ring's place with the zoom (`placeRings`), so the ring keeps its size on the screen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardForm, geometryFor, ordinalTabRect } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { RING_PX, placeRings, ringNumber } from '../../src/render/dom/heir-ring';
import { buildScene } from '../../src/render/dom/scene';
import { FEl } from '../acceptance/fake-dom';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const css = readFileSync('styles.css', 'utf8');
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f"}',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100}',
	'  - {id: b, name: Bertram, parents: [a], born: 1130}',
	'  - {id: c, name: Cedric, parents: [a], born: 1131}',
	'  - {id: d, name: Dora, parents: [a], born: 1140}',
	'',
].join('\n');
const g = build(SRC).g;

function draw(orientation: 'down' | 'sideways', ordinals: Record<string, string>) {
	clearLayoutCache();
	const form = cardForm(geometryFor(16), orientation);
	const laid = layoutTree(g, form, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), ordinalCards: Object.keys(ordinals) } as LayoutSettings, 'test');
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, heirs: ['b', 'c'], ordinals: new Map(Object.entries(ordinals)) });
	return { root, scene, laid };
}
const rule = (sel: string): string => {
	const i = css.indexOf(`\n${sel} {`);
	expect(i, sel).toBeGreaterThanOrEqual(0);
	return css.slice(i, css.indexOf('}', i));
};

describe('the number of a ring', () => {
	it('is the digits of the ordinal, and an open branch has none', () => {
		expect([ringNumber('1st'), ringNumber('2nd'), ringNumber('11th'), ringNumber('21st'), ringNumber('?')]).toEqual(['1', '2', '11', '21', undefined]);
	});
});

describe('the rings in the scene', () => {
	it('each heir has one ring in its own layer after the cards and the tags; the open branch has none; the word tab stays in the card', () => {
		const { root, scene } = draw('down', { b: '1st', c: '2nd', d: '?' });
		expect(scene.rings.map((r) => r.spec.text)).toEqual(['1', '2']);
		const layer = all(root).filter((e) => e.hasClass('dynasty-heir-numbers'));
		expect(layer).toHaveLength(1);
		expect(layer[0].getAttribute('aria-hidden')).toBe('true');
		const kids = root.children.map((e) => [...e.classes][0]);
		expect(kids[kids.length - 1]).toBe('dynasty-heir-numbers');
		expect(kids.indexOf('dynasty-heir-numbers')).toBeGreaterThan(kids.indexOf('dynasty-cards'));
		expect(kids.indexOf('dynasty-heir-numbers')).toBeGreaterThan(kids.indexOf('dynasty-tags'));
		expect(all(root).filter((e) => e.hasClass('dynasty-ordinal-tab-group'))).toHaveLength(3);
		const ring = scene.rings[0].el as unknown as FEl;
		expect(ring.children.map((c) => [...c.classes][0])).toEqual(['dynasty-heir-number-base', 'dynasty-heir-number-rim', 'dynasty-heir-number-text']);
		expect(ring.children[2].textContent).toBe('1');
	});

	it('a tree with no line of succession has no layer and no ring', () => {
		const { root, scene } = draw('down', {});
		expect(scene.rings).toEqual([]);
		expect(all(root).some((e) => e.hasClass('dynasty-heir-numbers'))).toBe(false);
	});

	it('the ring carries no colour value and no house colour', () => {
		const { root } = draw('down', { b: '1st' });
		for (const e of all(root).filter((x) => [...x.classes].some((c) => c.startsWith('dynasty-heir-number')))) {
			for (const k of ['fill', 'stroke', 'style']) expect(e.getAttribute(k), k).toBeNull();
		}
	});
});

describe('the place of a ring', () => {
	it('is written only at the Compact and Overview levels, and again only when the level or the zoom changed', () => {
		const { scene } = draw('down', { b: '1st' });
		const ring = scene.rings[0];
		placeRings(scene.rings, 'full', 1);
		placeRings(scene.rings, null, 1);
		expect(ring.el.getAttribute('transform')).toBeNull();
		placeRings(scene.rings, 'compact', 0.5);
		const first = ring.el.getAttribute('transform');
		expect(first).toMatch(/^translate\(/);
		ring.el.setAttribute('transform', 'x');
		placeRings(scene.rings, 'compact', 0.5);
		expect(ring.el.getAttribute('transform')).toBe('x');
		placeRings(scene.rings, 'compact', 0.25);
		expect(ring.el.getAttribute('transform')).not.toBe('x');
	});

	it('keeps the size on the screen: the scale is one over the zoom, at both levels', () => {
		const { scene } = draw('down', { b: '1st' });
		for (const [lod, zoom] of [['compact', 0.4], ['compact', 0.25], ['overview', 0.12]] as const) {
			scene.rings[0].stamp = '';
			placeRings(scene.rings, lod, zoom);
			const k = Number(/scale\(([^)]+)\)/.exec(scene.rings[0].el.getAttribute('transform')!)![1]);
			expect(k * zoom).toBeCloseTo(1, 6);
		}
	});

	it('Compact: the ring stands with its right corner on the right-bottom corner of the tab on a Roundel card and its left corner on the left-bottom corner on a text card', () => {
		for (const orientation of ['down', 'sideways'] as const) {
			const { scene, laid } = draw(orientation, { b: '1st' });
			const ring = scene.rings[0];
			const box = laid.layout.persons.get('b')!;
			const tab = ordinalTabRect(laid.layout.geometry, !!box.portrait, !!box.arms, 3);
			const zoom = 0.4;
			placeRings(scene.rings, 'compact', zoom);
			const [x, y] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(ring.el.getAttribute('transform')!)!.slice(1).map(Number);
			const k = 1 / zoom;
			const bottom = box.y + tab.y + tab.h;
			expect(y + (RING_PX.h / 2) * k, orientation).toBeCloseTo(bottom, 2);
			if (orientation === 'down') expect(x + (ring.w / 2) * k).toBeCloseTo(box.x + tab.x + tab.w, 2);
			else expect(x - (ring.w / 2) * k).toBeCloseTo(box.x + tab.x, 2);
		}
	});

	it('Overview: the ring stands in the middle of the top edge of the block', () => {
		const { scene, laid } = draw('down', { b: '1st' });
		const box = laid.layout.persons.get('b')!;
		placeRings(scene.rings, 'overview', 0.12);
		const [x, y] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(scene.rings[0].el.getAttribute('transform')!)!.slice(1).map(Number);
		expect(x).toBeCloseTo(box.x + box.w / 2, 2);
		expect(y).toBeCloseTo(box.y, 2);
	});

	it('a ring is 17 px high and wider for two digits', () => {
		expect(RING_PX.h).toBe(17);
		const { scene } = draw('down', { b: '1st', c: '12th' });
		expect(scene.rings[0].w).toBe(RING_PX.h);
		expect(scene.rings[1].w).toBeGreaterThan(scene.rings[0].w);
	});
});

describe('the rules of styles.css for the rings', () => {
	it('the layer is hidden at Full, shown at Compact and at Overview, and the Overview hides it only on a phone device', () => {
		expect(rule('.dynasty-heir-numbers')).toContain('display: none;');
		expect(css).toMatch(/\.dynasty-lod-compact \.dynasty-heir-numbers,\s*\.dynasty-lod-overview \.dynasty-heir-numbers \{\s*display: inline;/);
		expect(css).toMatch(/\.dynasty-root\.is-phone-device \.dynasty-lod-overview \.dynasty-heir-numbers \{\s*display: none;/);
		expect(css).not.toMatch(/is-phone(?:-side)? \.dynasty-lod-overview \.dynasty-heir-numbers|\(max-width: 599px\) \{\s*\.dynasty-lod-overview \.dynasty-heir-numbers/);
	});

	it('the text is 12 px or more (the small role), upright semibold, in the text colour; the pill has the border in the text colour, so colour is never the only sign', () => {
		const text = rule('.dynasty-heir-number-text');
		expect(text).toContain('font-size: var(--dynasty-type-small);');
		expect(text).toContain('font-weight: var(--font-semibold);');
		expect(text).toContain('fill: var(--text-normal);');
		expect(rule('.dynasty-heir-number-rim')).toContain('stroke: var(--text-normal);');
		expect(rule('.dynasty-heir-number-rim')).not.toContain('--dynasty-house-color');
		for (const sel of ['.dynasty-heir-number-base', '.dynasty-heir-number-rim', '.dynasty-heir-number-text']) expect(rule(sel)).toContain('pointer-events: none;');
	});

	it('the small role is never under 12 px on a computer and 13 px on a phone', () => {
		expect(css).toContain('--dynasty-type-small: max(12px, var(--font-ui-smaller));');
		expect(css).toContain('--dynasty-type-small: 13px;');
	});
});
