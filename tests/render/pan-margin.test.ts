// D366: on the wrapped path of the full-screen view the drawn picture has a margin; a lift inside it writes no <g> and keeps the wrapper transform. Every other
// way to change the view writes the <g> and the screen shows the view by it. Blink and a note keep the picture of the screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GESTURE_CLASS, MARGIN_CLASS, PanZoom, covers } from '../../src/render/dom/pan-zoom';
import { transformFor, treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, fakeWin, flushFrames, pointer, resetDom, runFrame, wheel } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { showsView } from '../support/pan-screen';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	vi.restoreAllMocks();
	delete (fakeWin as { devicePixelRatio?: number }).devicePixelRatio;
});

/** These tests pin the rule of the third drag test (D366); an internal test covers the other rules and the default. */
const DRAG_MARGIN = 0.5;
const SIZE = { w: 390, h: 760 };
const MX = Math.round(SIZE.w * DRAG_MARGIN);
const MY = Math.round(SIZE.h * DRAG_MARGIN);
const BIG = { w: SIZE.w + 2 * MX, h: SIZE.h + 2 * MY };

function make(o: { wrap?: boolean; mode?: 'full' | 'embed' } = {}) {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const settled: View[] = [];
	const fills: View[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(4000, 2000), fontPx: 16, interactive: true, mode: o.mode ?? 'full',
		onSettle: (v) => settled.push(v), onFill: (v) => fills.push(v), wrapDrag: () => o.wrap ?? true, marginRule: () => DRAG_MARGIN, guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 1, cx: 2000, cy: 1000 });
	flushFrames();
	const writes = () => scene.getAttribute('transform');
	return { vp, canvas, svg, scene, pz, settled, fills, writes };
}
type R = ReturnType<typeof make>;

/** A one-finger drag by (`dx`, `dy`) in `steps` frames; the finger stays down. */
function pan(r: R, dx: number, dy: number, steps = 5): void {
	dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
	for (let i = 1; i <= steps; i++) {
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 200 + (dx * i) / steps, 400 + (dy * i) / steps));
		runFrame();
	}
}
const lift = (r: R, x = 0, y = 0) => {
	dispatch(r.svg, 'pointerup', pointer('touch', 1, x, y));
	flushFrames();
};
const matrixOf = (r: R) => r.canvas.style.getPropertyValue('--dynasty-gesture-transform');

describe('the margin of the drawn picture', () => {
	it('the <svg> is larger by half a screen on each side (rule 0.5) and the <g> is written for that size, so the screen shows the same as without the margin', () => {
		const r = make();
		expect(r.canvas.hasClass(MARGIN_CLASS)).toBe(true);
		for (const k of ['left', 'right']) expect(r.svg.style.getPropertyValue(`--dynasty-margin-${k}`)).toBe(`${MX}px`);
		for (const k of ['top', 'bottom']) expect(r.svg.style.getPropertyValue(`--dynasty-margin-${k}`)).toBe(`${MY}px`);
		// The properties do not inherit (01-base.css), so they must stand on the <svg> that the margin rule styles, not on the wrapper.
		expect(r.canvas.style.getPropertyValue('--dynasty-margin-left')).toBe('');
		expect(r.writes()).toBe(transformFor(r.pz.view!, BIG));
		showsView(r, SIZE);
	});

	it('a drag that is not wrapped, Blink, has no margin and writes for the size of the screen (no change)', () => {
		const r = make({ wrap: false });
		expect(r.canvas.hasClass(MARGIN_CLASS)).toBe(false);
		expect(r.svg.style.getPropertyValue('--dynasty-margin-left')).toBe('');
		expect(r.writes()).toBe(transformFor(r.pz.view!, SIZE));
	});

	it('a note (embed) has no margin even when the path is on: its bars lie above the tree', () => {
		const r = make({ mode: 'embed' });
		expect(r.canvas.hasClass(MARGIN_CLASS)).toBe(false);
		expect(r.writes()).toBe(transformFor(r.pz.view!, SIZE));
	});

	it('covers counts the margin: a view half a screen away is covered by the large picture and not by the small one', () => {
		const d: View = { scale: 1, cx: 2000, cy: 1000 };
		const moved: View = { scale: 1, cx: 2000 + MX - 1, cy: 1000 };
		expect(covers(d, moved, SIZE)).toBe(false);
		expect(covers(d, moved, SIZE, BIG)).toBe(true);
		expect(covers(d, { ...moved, cx: 2000 + MX + 2 }, SIZE, BIG)).toBe(false);
	});
});

describe('a wrapped drag with a margin', () => {
	it('writes no <g> while the drag stays inside the margin, also when the last drawing is old', () => {
		const r = make();
		clock.now += 5000;
		const first = r.writes();
		pan(r, -(MX - 20), -(MY - 20), 40);
		expect(r.writes()).toBe(first);
		expect(r.fills.length).toBe(0);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		showsView(r, SIZE);
	});

	it('a drag past the margin draws the real view, and the picture is drawn again around it', () => {
		const r = make();
		clock.now += 5000;
		const first = r.writes();
		pan(r, -(MX + 60), 0, 10);
		expect(r.writes()).not.toBe(first);
		expect(r.fills.length).toBe(1);
		showsView(r, SIZE);
		// The margin starts again from the new picture.
		const second = r.writes();
		pan(r, -(MX - 40), 0, 10);
		expect(r.writes()).toBe(second);
	});

	it('the lift inside the margin writes no <g>, keeps the class, and still calls the settle with the view', () => {
		const r = make();
		const first = r.writes();
		const settles = r.settled.length;
		pan(r, -120, -80, 8);
		lift(r, 80, 320);
		expect(r.writes()).toBe(first);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		expect(r.settled.length).toBe(settles + 1);
		expect(r.settled[r.settled.length - 1]).toEqual(r.pz.view);
		showsView(r, SIZE);
	});

	it('the lift past the margin writes the <g> and takes the wrapper away', () => {
		const r = make();
		clock.now += 5000;
		pan(r, -(MX + 400), 0, 2);
		lift(r);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.writes()).toBe(transformFor(r.pz.view!, BIG));
		showsView(r, SIZE);
	});

	it('the view moves to a whole device pixel at the lift: the wrapper move is a whole number of device pixels', () => {
		(fakeWin as { devicePixelRatio?: number }).devicePixelRatio = 3;
		const r = make();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 200 - 40.37, 400 - 11.21));
		runFrame();
		lift(r);
		const m = /matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)/.exec(matrixOf(r));
		expect(m).not.toBeNull();
		for (const n of [Number(m![1]), Number(m![2])]) expect(Math.abs(n * 3 - Math.round(n * 3))).toBeLessThan(0.01);
		showsView(r, SIZE);
	});

	it('a second drag goes on from the kept transform and the picture shows the view at each step', () => {
		const r = make();
		const first = r.writes();
		pan(r, -100, 0);
		lift(r, 100, 400);
		pan(r, -60, 0);
		expect(r.writes()).toBe(first);
		showsView(r, SIZE);
		lift(r, 140, 400);
		showsView(r, SIZE);
	});
});

describe('what ends the kept transform', () => {
	const held = () => {
		const r = make();
		pan(r, -120, -60);
		lift(r, 80, 340);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		return r;
	};

	it('a view the plugin sets (Fit, Find, the reveal after an edit) writes the <g> at the new view and clears the wrapper', () => {
		const r = held();
		r.pz.setView({ scale: 1.5, cx: 1500, cy: 900 });
		flushFrames();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.writes()).toBe(transformFor({ scale: 1.5, cx: 1500, cy: 900 }, BIG));
		showsView(r, SIZE);
	});

	it('a wheel pan writes the <g> and clears the wrapper', () => {
		const r = held();
		dispatch(r.svg, 'wheel', wheel(0, 40));
		flushFrames();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		showsView(r, SIZE);
	});

	it('a pinch that starts from the kept transform shows the view at each frame and ends with the <g> written', () => {
		const r = held();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
		dispatch(r.svg, 'pointerdown', pointer('touch', 2, 100, 300, false));
		dispatch(r.svg, 'pointermove', pointer('touch', 2, 60, 260, false));
		runFrame();
		showsView(r, SIZE);
		dispatch(r.svg, 'pointerup', pointer('touch', 2, 60, 260, false));
		dispatch(r.svg, 'pointerup', pointer('touch', 1, 200, 400));
		flushFrames();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		showsView(r, SIZE);
	});

	it('a new size writes the <g> for the new margin; the same size writes nothing', () => {
		const r = held();
		const t = r.writes();
		r.pz.resize(SIZE);
		flushFrames();
		expect(r.writes()).toBe(t);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		r.pz.resize({ w: 760, h: 390 });
		flushFrames();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.svg.style.getPropertyValue('--dynasty-margin-left')).toBe(`${Math.round(760 * DRAG_MARGIN)}px`);
		showsView(r, { w: 760, h: 390 });
	});

	it('a drag that is not wrapped any more (the switch turned off) starts from the kept transform and writes the <g>', () => {
		let wrap = true;
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
		const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
		const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
		const pz = new PanZoom({
			viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
			bounds: treeBounds(4000, 2000), fontPx: 16, interactive: true, mode: 'full', onSettle: () => {}, wrapDrag: () => wrap, marginRule: () => DRAG_MARGIN, guard: (fn) => fn(),
		});
		pz.resize(SIZE);
		pz.setView({ scale: 1, cx: 2000, cy: 1000 });
		flushFrames();
		const r = { vp, canvas, svg, scene, pz } as unknown as R;
		pan(r, -100, 0);
		lift(r, 100, 400);
		wrap = false;
		pan(r, -30, 0);
		lift(r, 70, 400);
		expect(canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(canvas.hasClass(MARGIN_CLASS)).toBe(false);
		expect(scene.getAttribute('transform')).toBe(transformFor(pz.view!, SIZE));
	});

	it('destroy leaves no class', () => {
		const r = held();
		r.pz.destroy();
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
	});
});
