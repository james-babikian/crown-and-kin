import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { PanZoom } from '../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, installDom, pointer, resetDom, runFrame, runTimers, wheel } from './acceptance/fake-dom';

/* M11 fix round (B1): `onFill` runs during a wheel zoom and an animation when the view leaves the last filled rectangle; never on a plain pan. */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SIZE = { w: 800, h: 600 };

function make() {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const scene = canvas.createSvg('svg', { cls: 'dynasty-svg' }).createSvg('g', { cls: 'dynasty-scene' });
	const fills: View[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(4000, 2000),
		fontPx: 16,
		interactive: true,
		mode: 'full',
		onSettle: () => {},
		onFill: (v: View) => fills.push(v),
		guard: (fn: () => void) => fn(),
	} as never);
	pz.resize(SIZE);
	pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
	flushFrames();
	runTimers();
	return { vp, pz, fills };
}

describe('B1: onFill outside a pinch', () => {
	it('a wheel zoom out calls it, at most once per frame; a zoom in that stays inside the filled rectangle does not', () => {
		const { vp, fills } = make();
		fills.length = 0;
		dispatch(vp, 'wheel', { ...wheel(0, 250), ctrlKey: true });
		flushFrames();
		expect(fills).toHaveLength(1);
		dispatch(vp, 'wheel', { ...wheel(0, -250), ctrlKey: true });
		flushFrames();
		expect(fills).toHaveLength(1);
	});

	it('an animation to a wider view calls it', () => {
		const { pz, fills } = make();
		fills.length = 0;
		pz.setView({ scale: 0.25, cx: 2000, cy: 1000 }, { animate: true });
		for (let i = 0; i < 30; i++) {
			clock.now += 16;
			runFrame();
		}
		expect(fills.length).toBeGreaterThan(0);
	});

	it('a plain drag pan never calls it', () => {
		const { vp, fills } = make();
		fills.length = 0;
		dispatch(vp, 'pointerdown', pointer('mouse', 1, 400, 300));
		for (let i = 1; i <= 20; i++) {
			dispatch(vp, 'pointermove', pointer('mouse', 1, 400 - i * 20, 300));
			flushFrames();
		}
		dispatch(vp, 'pointerup', pointer('mouse', 1, 0, 300));
		flushFrames();
		expect(fills).toEqual([]);
	});
});
