// The settle of a drag that moves the wrapper (D365 (1), D366): after a cancel, a pinch, a resize, a close or a fast lift, the screen shows the real view, by the scene <g> alone
// or by the <g> and the wrapper transform that a lift inside the margin keeps (D366).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GESTURE_CLASS, PanZoom } from '../../src/render/dom/pan-zoom';
import { treeBounds } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, pointer, resetDom, runFrame, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { showsView } from '../support/pan-screen';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());
const SIZE = { w: 390, h: 760 };

function make() {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const settled: unknown[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(4000, 2000), fontPx: 16, interactive: true, mode: 'full',
		onSettle: (v) => settled.push(v), onFill: () => {}, wrapDrag: () => true, guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 1, cx: 2000, cy: 1000 });
	flushFrames();
	return { vp, canvas, svg, scene, pz, settled };
}
const clean = (r: ReturnType<typeof make>) => showsView(r, SIZE);
const moves = (r: ReturnType<typeof make>, id: number, n: number) => {
	for (let i = 1; i <= n; i++) {
		dispatch(r.svg, 'pointermove', pointer('touch', id, 200 - i * 5, 400 - i * 2, id === 1));
		runFrame();
	}
};

describe('the settle of a drag that moves the wrapper', () => {
	it('pointercancel ends a wrapped drag clean', () => {
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		moves(r, 1, 10);
		dispatch(r.svg, 'pointercancel', pointer('touch', 1, 150, 380));
		flushFrames();
		clean(r);
	});
	it('a second finger turns a wrapped drag into a pinch; both fingers up ends clean', () => {
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		moves(r, 1, 10);
		dispatch(r.svg, 'pointerdown', pointer('touch', 2, 100, 300, false));
		dispatch(r.svg, 'pointermove', pointer('touch', 2, 80, 280, false));
		runFrame();
		dispatch(r.svg, 'pointerup', pointer('touch', 2, 80, 280, false));
		moves(r, 1, 6);
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 100, 300));
		flushFrames();
		clean(r);
	});
	it('a pinch that ends with one finger down: the rest of the drag and its end are clean', () => {
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		dispatch(r.svg, 'pointerdown', pointer('touch', 2, 100, 300, false));
		dispatch(r.svg, 'pointermove', pointer('touch', 2, 60, 280, false));
		runFrame();
		dispatch(r.svg, 'pointerup', pointer('touch', 2, 60, 280, false));
		runFrame();
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 150, 350));
		runFrame();
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 150, 350));
		flushFrames();
		clean(r);
	});
	it('up in the same frame as the move (no frame between)', () => {
		const r = make();
		clock.now += 1000;
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 150, 380));
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 150, 380));
		flushFrames();
		clean(r);
	});
	it('first frame fills, then up with no more move', () => {
		const r = make();
		clock.now += 1000;
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 300, 400));
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 100, 400));
		runFrame();
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 100, 400));
		flushFrames();
		clean(r);
	});
	it('wrapped drag, resize mid-drag, then end', () => {
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		moves(r, 1, 5);
		r.pz.resize({ w: 760, h: 390 });
		moves(r, 1, 5);
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 100, 300));
		flushFrames();
		showsView(r, { w: 760, h: 390 });
	});
	it('destroy mid wrapped drag leaves no class and no pending timers that write', () => {
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		moves(r, 1, 6);
		r.pz.destroy();
		const t = r.scene.getAttribute('transform');
		runTimers(2000);
		runFrame();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.scene.getAttribute('transform')).toBe(t);
	});
	it('a second drag after a wrapped one starts from clean state and settles once', () => {
		const r = make();
		for (let k = 0; k < 2; k++) {
			dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
			moves(r, 1, 6);
			dispatch(r.svg, 'pointerup', pointer('touch', 1, 170, 388));
			flushFrames();
			clean(r);
		}
		expect(r.settled.length).toBe(3);
	});
});
