// D367: with a margin wider than one screen (rules 3 and range), a wrapped press fills the content near the view before the screen leaves half of the
// band of the last fill (`leftFill` in `apply`), and writes no <g> for it. Rules 0.5 (the rule of the third drag test) and 1 never fill ahead: their drawn
// picture lies inside the band of a fill. The release rule is range (D367).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanZoom, type MarginRule } from '../../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, pointer, resetDom, runFrame, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SIZE = { w: 390, h: 844 };

/** A press that moves `dx` px to the left in `steps` frames: the fills ahead (with the view of each), the D19 fills, and the <g> writes of the press. */
function press(rule: MarginRule, dx: number, steps = 40): { ahead: View[]; fills: number; writes: number } {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const ahead: View[] = [];
	let fills = 0;
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(10972, 7795), fontPx: 16, interactive: true, mode: 'full', onSettle: () => {},
		onFill: (v, isAhead) => (isAhead ? ahead.push(v) : fills++), wrapDrag: () => true, marginRule: () => rule, guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 1, cx: 2000, cy: 3900 });
	flushFrames();
	runTimers(500);
	let writes = 0;
	const set = scene.setAttribute.bind(scene);
	scene.setAttribute = (k: string, v: string | number | boolean | null) => {
		if (k === 'transform') writes++;
		set(k, v);
	};
	dispatch(svg, 'pointerdown', pointer('touch', 1, 380, 400));
	for (let i = 1; i <= steps; i++) {
		dispatch(svg, 'pointermove', pointer('touch', 1, 380 - (dx * i) / steps, 400));
		runFrame();
	}
	const during = writes;
	dispatch(svg, 'pointerup', pointer('touch', 1, 380 - dx, 400));
	flushFrames();
	pz.destroy();
	return { ahead, fills, writes: during };
}

describe('the fill ahead of a wrapped press', () => {
	it('rules 0.5 and 1: no fill ahead in a press of 1,000 px', () => {
		expect(press(0.5, 1000).ahead).toHaveLength(0);
		expect(press(1, 1000).ahead).toHaveLength(0);
	});

	it('rule 3: a fill ahead about every half screen of travel, no <g> write, and the screen never leaves the band of the last fill', () => {
		const r = press(3, 1000);
		expect(r.writes).toBe(0);
		expect(r.fills).toBe(0);
		// 1,000 px at a trigger of half a screen (195 px): 5 fills.
		expect(r.ahead.length).toBeGreaterThanOrEqual(4);
		expect(r.ahead.length).toBeLessThanOrEqual(6);
		let last = 2000;
		for (const v of r.ahead) {
			expect(v.cx - last).toBeLessThanOrEqual(195 + 25 + 1e-6);
			last = v.cx;
		}
		expect(2000 + 1000 - last).toBeLessThanOrEqual(195 + 25 + 1e-6);
	});

	it('range: the same, also far past three screens', () => {
		const r = press('range', 3000, 100);
		expect(r.writes).toBe(0);
		expect(r.ahead.length).toBeGreaterThanOrEqual(14);
	});
});
