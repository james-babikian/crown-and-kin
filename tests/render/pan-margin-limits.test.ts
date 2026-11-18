// D366: the device-pixel snap at a held lift keeps the view inside the pan limits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanZoom } from '../../src/render/dom/pan-zoom';
import { panLimits, treeBounds } from '../../src/render/view-math';
import { FEl, clock, dispatch, fakeWin, flushFrames, pointer, resetDom, runFrame } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	vi.restoreAllMocks();
	delete (fakeWin as { devicePixelRatio?: number }).devicePixelRatio;
});

const SIZE = { w: 390, h: 760 };

function make(mode: 'full' | 'embed' = 'full') {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const bounds = treeBounds(4000, 2000);
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds, fontPx: 16, interactive: true, mode, onSettle: () => {}, wrapDrag: () => true, guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	return { vp, canvas, svg, scene, pz, bounds };
}

describe('pan margin: the lift at a pan limit', () => {
	it('the device-pixel snap at the lift never puts the view outside the pan limits', () => {
		const r = make();
		const l = panLimits(r.bounds, 1, SIZE);
		// The picture is drawn 0.7 px inside the left limit; a drag to the left stops at the limit.
		r.pz.setView({ scale: 1, cx: l.x0 + 0.7, cy: 1000 });
		flushFrames();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 220, 400));
		runFrame();
		expect(r.pz.view!.cx).toBe(l.x0);
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 220, 400));
		flushFrames();
		expect(r.pz.view!.cx).toBeGreaterThanOrEqual(l.x0);
	});
});
