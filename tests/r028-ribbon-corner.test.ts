// 0.2.8: the house ribbon and the badge take the card's own corner radius (the computed `rx` of the card bg) in every theme, not a theme variable.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { geometryFor } from '../src/layout/geometry';
import { layoutTree } from '../src/layout/index';
import { buildScene, resetLearnedCornerRadius } from '../src/render/dom/scene';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
});

const g0 = globalThis as Record<string, unknown>;
beforeEach(() => resetLearnedCornerRadius());
afterEach(() => {
	delete g0.getComputedStyle;
});

const GEO = geometryFor(16);
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const fonts = { text: 'serif', ui: 'sans', bold: '700' };
const SRC = `houses:\n  - {id: h, name: House H, color: '#1e4f8b'}\npeople:\n  - {id: a, name: A, house: h}\n  - {id: b, name: B, house: h}`;

const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

function draw(extra: { cornerRadius?: number } = {}) {
	const { g } = build(SRC);
	const laid = layoutTree(g, GEO, { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } }, 'test');
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts, measure, link: () => null, ...extra });
	const ribbons = () => all(root).filter((e) => e.hasClass('dynasty-card-ribbon')).map((e) => e.getAttribute('d'));
	return { scene, ribbons };
}

describe('ribbon corner radius', () => {
	it('draws the ribbons again with the real radius once the card bg is in the document, in one read', () => {
		const known = draw({ cornerRadius: 8 }).ribbons();
		const fallback = draw({ cornerRadius: 4 }).ribbons();
		expect(known[0]).not.toBe(fallback[0]);

		let rx = '';
		let reads = 0;
		g0.getComputedStyle = () => {
			reads++;
			return { rx };
		};
		const { scene, ribbons } = draw();
		// Not in the document yet: the fallback is used.
		expect(ribbons()).toEqual(fallback);
		reads = 0;
		scene.syncCornerRadius();
		expect(ribbons()).toEqual(fallback);

		rx = '8px';
		reads = 0;
		scene.syncCornerRadius();
		expect(reads).toBe(1);
		expect(ribbons()).toEqual(known);
		// Known now: a later fill reads nothing.
		scene.syncCornerRadius();
		expect(reads).toBe(1);
	});

	it('a theme change draws the ribbons again; the same radius changes nothing', () => {
		let rx = '8px';
		g0.getComputedStyle = () => ({ rx });
		const { scene, ribbons } = draw();
		const eight = ribbons();
		expect(eight).toEqual(draw({ cornerRadius: 8 }).ribbons());
		rx = '4px';
		scene.syncCornerRadius(true);
		expect(ribbons()).toEqual(draw({ cornerRadius: 4 }).ribbons());
		rx = '8px';
		scene.syncCornerRadius(true);
		expect(ribbons()).toEqual(eight);
	});

	it('a card radius of 4 px, the fallback, needs no second draw', () => {
		let rx = '';
		g0.getComputedStyle = () => ({ rx });
		const { scene, ribbons } = draw();
		const before = ribbons();
		rx = '4px';
		scene.syncCornerRadius();
		expect(ribbons()).toEqual(before);
	});
	it('a second scene starts with the radius the first learned: no path is rewritten, and a changed theme is still corrected', () => {
		let rx = '8px';
		g0.getComputedStyle = () => ({ rx });
		const first = draw();
		first.scene.syncCornerRadius();
		const eight = first.ribbons();

		const proto = FEl.prototype as unknown as { setAttribute: (n: string, v: string) => void };
		const original = proto.setAttribute;
		let rewrites = 0;
		proto.setAttribute = function (this: FEl, n: string, v: string) {
			if (n === 'd' && this.hasClass('dynasty-card-ribbon')) rewrites++;
			return original.call(this, n, v);
		};
		try {
			rx = '';
			const second = draw();
			expect(second.ribbons()).toEqual(eight);
			rx = '8px';
			second.scene.syncCornerRadius();
			expect(rewrites).toBe(0);

			// A theme with another radius: the guess from the last scene is corrected by the first sync.
			rx = '4px';
			const third = draw();
			third.scene.syncCornerRadius();
			expect(rewrites).toBe(2);
			expect(third.ribbons()).toEqual(draw({ cornerRadius: 4 }).ribbons());
		} finally {
			proto.setAttribute = original;
		}
	});
});
