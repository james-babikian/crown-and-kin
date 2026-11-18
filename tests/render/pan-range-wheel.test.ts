// G2 review of WP-R3a-size: under `range`, a zoom in that is not a wrapped gesture (a wheel or trackpad zoom on an iPad, which the wrapped path takes too, since
// `isIosWebKit` is true on iPadOS) draws the <g> in every frame, and each frame needs a larger margin, so each frame also writes a new box of the <svg>: the
// second whole-tree text layout that the fixed box is there to avoid. Under 0.5 the box stays for the whole zoom. Repaired: the box grows only at a draw at
// rest or at a fill of a wrapped gesture.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanZoom, type MarginRule } from '../../src/render/dom/pan-zoom';
import { treeBounds } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, resetDom, runFrame, runTimers, wheel } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

function boxWritesInWheelZoom(rule: MarginRule): { frames: number; boxWrites: number } {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(10972, 7795), fontPx: 16, interactive: true, mode: 'full', onSettle: () => {}, wrapDrag: () => true, marginRule: () => rule, guard: (fn) => fn(),
	});
	pz.resize({ w: 820, h: 1180 });
	pz.setView({ scale: 0.2, cx: 5000, cy: 3800 });
	flushFrames();
	runTimers(500);
	let boxWrites = 0;
	const set = svg.style.setProperty;
	svg.style.setProperty = (k: string, v: string) => {
		if (k === '--dynasty-margin-left') boxWrites++;
		set(k, v);
	};
	let frames = 0;
	for (let i = 0; i < 10; i++) {
		dispatch(vp, 'wheel', { ...wheel(0, -40, 410, 590), ctrlKey: true });
		runFrame();
		frames++;
	}
	runTimers(500);
	return { frames, boxWrites };
}

describe('range: a wheel zoom in keeps the box of the <svg>', () => {
	it('0.5: no new box in a wheel zoom of 10 frames', () => {
		expect(boxWritesInWheelZoom(0.5).boxWrites).toBe(0);
	});

	it('range: at most one new box in a wheel zoom of 10 frames', () => {
		expect(boxWritesInWheelZoom('range').boxWrites).toBeLessThanOrEqual(1);
	});
});
