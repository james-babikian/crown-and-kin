import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanZoom } from '../../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, pointer, resetDom, runFrame, runTimers, wheel } from './fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP 11.0 (spec §13.15 rule 2; `PanZoom` header): the pan-zoom hook
 * `onFirstDraw`. It runs once, right after the first write of the scene transform, in the same task; `onSettle`
 * cannot serve, because it runs inside `setView`, before that write. No pan, pinch, wheel, animation frame or
 * later `setView` calls it. `PanZoomOptions.onFirstDraw` is added by WP 11.2; until then these tests fail.
 * Run: npx vitest run tests/acceptance/m11-first-draw.test.ts
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const BOUNDS = treeBounds(4000, 2000);
const SIZE = { w: 800, h: 600 };

/** A PanZoom with a log of what it calls, and what the scene had at that moment. */
function make(mode: 'full' | 'embed' = 'full') {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const log: string[] = [];
	const first: { view: View; transform: string | null }[] = [];
	const options = {
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: BOUNDS,
		fontPx: 16,
		interactive: true,
		mode,
		onSettle: () => log.push(`settle:${scene.getAttribute('transform') === null ? 'no-transform' : 'transform'}`),
		onFill: () => log.push('fill'),
		onFirstDraw: (view: View) => {
			log.push('first');
			first.push({ view, transform: scene.getAttribute('transform') });
		},
		guard: (fn: () => void) => fn(),
	};
	const pz = new PanZoom(options as never);
	return { vp, canvas, svg, scene, pz, log, first };
}

describe('S5a: onFirstDraw', () => {
	it('is not called by the construction, by resize, or by setView before a frame runs', () => {
		const { pz, log, first } = make();
		pz.resize(SIZE);
		pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
		expect(first).toEqual([]);
		expect(log).toEqual(['settle:no-transform']);
	});

	it('runs once, in the frame that writes the scene transform for the first time, with the view and after the transform', () => {
		const { pz, scene, log, first } = make();
		pz.resize(SIZE);
		const view = { scale: 0.5, cx: 2000, cy: 1000 };
		pz.setView(view);
		runFrame();
		expect(first).toHaveLength(1);
		expect(first[0].view).toEqual(view);
		expect(first[0].transform).not.toBeNull();
		expect(first[0].transform).toBe(scene.getAttribute('transform'));
		// onSettle came first (before the write); the hook came after it.
		expect(log).toEqual(['settle:no-transform', 'first']);
	});

	it('is not called before the viewport has a size: the first write waits for the size', () => {
		const { pz, first } = make();
		pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
		runFrame();
		expect(first).toEqual([]);
		pz.resize(SIZE);
		runFrame();
		expect(first).toHaveLength(1);
	});

	it('is not called again by a later setView, a pan, a wheel zoom, a pinch, an animation or many frames', () => {
		const { vp, svg, pz, first } = make();
		pz.resize(SIZE);
		pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
		flushFrames();
		expect(first).toHaveLength(1);
		pz.setView({ scale: 0.7, cx: 1500, cy: 900 });
		flushFrames();
		dispatch(svg, 'pointerdown', pointer('touch', 1, 300, 300));
		for (let i = 1; i <= 12; i++) {
			dispatch(svg, 'pointermove', pointer('touch', 1, 300 + i * 12, 300 + i * 5));
			runFrame();
		}
		dispatch(svg, 'pointerup', pointer('touch', 1, 444, 360));
		dispatch(svg, 'pointerdown', pointer('touch', 2, 330, 400));
		dispatch(svg, 'pointerdown', pointer('touch', 3, 350, 400, false));
		for (let half = 11; half < 40; half += 4) {
			dispatch(svg, 'pointermove', pointer('touch', 2, 340 - half, 400));
			dispatch(svg, 'pointermove', pointer('touch', 3, 340 + half, 400, false));
			runFrame();
		}
		dispatch(svg, 'pointerup', pointer('touch', 2, 300, 400));
		dispatch(svg, 'pointerup', pointer('touch', 3, 380, 400, false));
		dispatch(vp, 'wheel', wheel(0, -80));
		flushFrames();
		runTimers();
		flushFrames();
		pz.setView({ scale: 0.3, cx: 800, cy: 400 }, { byUser: true });
		flushFrames();
		expect(first).toHaveLength(1);
	});

	it('the static phone preview (mode embed, drawn once) calls it once', () => {
		const { pz, first } = make('embed');
		pz.resize(SIZE);
		pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
		flushFrames();
		expect(first).toHaveLength(1);
	});

	it('a hook that throws is contained by the guard: the scene still has its transform', () => {
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
		const scene = canvas.createSvg('svg', { cls: 'dynasty-svg' }).createSvg('g', { cls: 'dynasty-scene' });
		const errors: unknown[] = [];
		const pz = new PanZoom({
			viewport: vp as unknown as HTMLElement,
			scene: scene as unknown as SVGGElement,
			wrapper: canvas as unknown as HTMLElement,
			bounds: BOUNDS,
			fontPx: 16,
			interactive: true,
			mode: 'full',
			onSettle: () => {},
			onFirstDraw: () => {
				throw new Error('boom');
			},
			guard: (fn: () => void) => {
				try {
					fn();
				} catch (e) {
					errors.push(e);
				}
			},
		} as never);
		pz.resize(SIZE);
		pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
		flushFrames();
		expect(scene.getAttribute('transform')).not.toBeNull();
		expect(errors).toHaveLength(1);
	});
});
