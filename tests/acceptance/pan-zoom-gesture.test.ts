import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));

import { GESTURE_CLASS, PanZoom } from '../../src/render/dom/pan-zoom';
import { fitView, treeBounds, type View } from '../../src/render/view-math';
import { fixtureSource } from './load';
import { layOut } from './pipeline';
import { FEl, clock, dispatch, flushFrames, installDom, pointer, resetDom, runFrame, runTimers, wheel } from './fake-dom';

/*
 * Full-screen pan and zoom with the gesture wrapper (spec §7.2 touch gestures, §7.6 pan/zoom
 * rendering, D19: during a two-finger zoom the tree moves as one picture and fills empty space
 * about 4 times per second). Adopted from the WP5.3 review (scratch/review-5.3, 7861544).
 * The real PanZoom runs on the fake DOM; what the screen shows is read from the DOM: the scene
 * transform, then the wrapper transform while the gesture class is on.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const BOUNDS = treeBounds(4000, 2000);
const SIZE = { w: 800, h: 600 };

function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function make(mode: 'full' | 'embed' = 'full') {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const settled: { view: View; byUser: boolean }[] = [];
	const fills: View[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: BOUNDS,
		fontPx: 16,
		interactive: true,
		mode,
		onSettle: (view, byUser) => settled.push({ view, byUser }),
		onFill: (v) => fills.push(v),
		guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 0.5, cx: 2000, cy: 1000 });
	flushFrames();
	return { vp, canvas, svg, scene, pz, settled, fills };
}

/** The view that the screen shows: the scene transform, then the wrapper transform when its class is on. */
function onScreen(scene: FEl, canvas: FEl): View {
	const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(scene.getAttribute('transform') ?? '');
	if (!m) throw new Error('no scene transform');
	let [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (canvas.hasClass(GESTURE_CLASS)) {
		const w = /matrix\(([-\d.e]+), 0, 0, ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(canvas.style.getPropertyValue('--dynasty-gesture-transform'));
		if (!w) throw new Error('wrapper class without a matrix');
		const k = Number(w[1]);
		tx = k * tx + Number(w[3]);
		ty = k * ty + Number(w[4]);
		s = k * s;
	}
	return { scale: s, cx: (SIZE.w / 2 - tx) / s, cy: (SIZE.h / 2 - ty) / s };
}

describe('Gesture wrapper state (§7.2, §7.6, D19)', () => {
	it('fuzz: after random touch input and all fingers up, the scene shows the view with no wrapper and the last settle is that view', () => {
		for (let seed = 1; seed <= 300; seed++) {
			resetDom();
			const next = rng(seed);
			const { vp, canvas, scene, pz, settled } = make();
			const bg = vp.children[0].children[0];
			const down = new Map<number, { x: number; y: number }>();
			let id = 1;
			for (let step = 0; step < 60; step++) {
				const r = next();
				const x = 100 + next() * 600;
				const y = 100 + next() * 400;
				if (r < 0.2 && down.size < 3) {
					const pid = id++;
					down.set(pid, { x, y });
					dispatch(bg, 'pointerdown', pointer('touch', pid, x, y, down.size === 1));
				} else if (r < 0.55 && down.size) {
					const pid = [...down.keys()][Math.floor(next() * down.size)];
					down.set(pid, { x, y });
					dispatch(bg, 'pointermove', pointer('touch', pid, x, y));
				} else if (r < 0.65 && down.size) {
					const pid = [...down.keys()][Math.floor(next() * down.size)];
					down.delete(pid);
					const kind = next();
					dispatch(kind < 0.6 ? bg : vp, kind < 0.6 ? 'pointerup' : kind < 0.8 ? 'pointercancel' : 'lostpointercapture', pointer('touch', pid, x, y));
				} else if (r < 0.85) runFrame();
				else if (r < 0.9) runTimers(100 + next() * 300);
				else if (r < 0.93) pz.setView({ scale: 0.2 + next(), cx: next() * 4000, cy: next() * 2000 }, { byUser: true });
				else if (r < 0.95) dispatch(bg, 'wheel', wheel(next() * 50 - 25, next() * 50 - 25));
				else runFrame();
			}
			for (const pid of [...down.keys()]) dispatch(bg, 'pointerup', pointer('touch', pid, 1, 1));
			flushFrames();
			runTimers();
			flushFrames();
			const ctx = `seed ${seed}`;
			expect(canvas.hasClass(GESTURE_CLASS), ctx).toBe(false);
			const shown = onScreen(scene, canvas);
			expect(shown.scale, ctx).toBeCloseTo(pz.view!.scale, 3);
			expect(shown.cx * shown.scale, ctx).toBeCloseTo(pz.view!.cx * pz.view!.scale, 1);
			expect(shown.cy * shown.scale, ctx).toBeCloseTo(pz.view!.cy * pz.view!.scale, 1);
			expect(settled[settled.length - 1]?.view, ctx).toEqual(pz.view);
		}
	});

	it('fuzz: after every frame of a gesture, the screen (scene then wrapper) shows the current view', () => {
		for (let seed = 1; seed <= 200; seed++) {
			resetDom();
			const next = rng(seed * 7);
			const { vp, canvas, scene, pz } = make();
			const bg = vp.children[0].children[0];
			dispatch(bg, 'pointerdown', pointer('touch', 1, 300, 300));
			dispatch(bg, 'pointerdown', pointer('touch', 2, 500, 300, false));
			for (let f = 0; f < 40; f++) {
				dispatch(bg, 'pointermove', pointer('touch', 1, 100 + next() * 300, 100 + next() * 400));
				dispatch(bg, 'pointermove', pointer('touch', 2, 400 + next() * 300, 100 + next() * 400, false));
				if (next() < 0.2) runTimers(next() * 300);
				runFrame();
				const v = pz.view!;
				const shown = onScreen(scene, canvas);
				const ctx = `seed ${seed} frame ${f}`;
				// transformFor rounds the scale to 3 decimals (pre-existing); allow that much here.
				expect(Math.abs(shown.scale / v.scale - 1), ctx).toBeLessThan(0.01);
			}
		}
	});
});

describe('The tree point under the fingers stays put (§7.2, §7.6, D19)', () => {
	it('sample tree 7 on a phone: a pinch in from Fit does not make the tree point under the fingers jump when the fingers lift', () => {
		const { layout } = layOut(fixtureSource('07'));
		const bounds = treeBounds(layout.width, layout.height);
		const size = { w: 390, h: 844 };
		let worst = { jump: 0, ratio: 0, during: 0, after: 0 };
		// Fingers 20 px apart at (340, 400), spread to 22 ... 120 px: pinch in 1.1x ... 6x.
		for (let half = 11; half <= 60; half++) {
			resetDom();
			const vp = new FEl('div', { cls: 'dynasty-viewport' });
			vp.clientWidth = size.w;
			vp.clientHeight = size.h;
			const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
			const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
			const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
			const pz = new PanZoom({
				viewport: vp as unknown as HTMLElement,
				scene: scene as unknown as SVGGElement,
				wrapper: canvas as unknown as HTMLElement,
				bounds,
				fontPx: 16,
				interactive: true,
				mode: 'full',
				onSettle: () => {},
				guard: (fn) => fn(),
			});
			pz.resize(size);
			const fit = fitView(bounds, size);
			pz.setView(fit);
			flushFrames();
			/** Screen x of tree x `px`, from the DOM: the scene transform, then the wrapper transform if on. */
			const screenX = (px: number) => {
				const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(scene.getAttribute('transform')!)!;
				let x = Number(m[3]) * px + Number(m[1]);
				if (canvas.hasClass(GESTURE_CLASS)) {
					const w = /matrix\(([-\d.e]+), 0, 0, ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(canvas.style.getPropertyValue('--dynasty-gesture-transform'))!;
					x = Number(w[1]) * x + Number(w[3]);
				}
				return x;
			};
			dispatch(svg, 'pointerdown', pointer('touch', 1, 330, 400));
			dispatch(svg, 'pointerdown', pointer('touch', 2, 350, 400, false));
			// The tree point under the finger midpoint (340, 400) at the start.
			const px = fit.cx + (340 - size.w / 2) / fit.scale;
			dispatch(svg, 'pointermove', pointer('touch', 1, 340 - half, 400));
			dispatch(svg, 'pointermove', pointer('touch', 2, 340 + half, 400, false));
			runFrame();
			expect(canvas.hasClass(GESTURE_CLASS)).toBe(true);
			const during = screenX(px);
			dispatch(svg, 'pointerup', pointer('touch', 1, 340 - half, 400));
			dispatch(svg, 'pointerup', pointer('touch', 2, 340 + half, 400, false));
			flushFrames();
			expect(canvas.hasClass(GESTURE_CLASS)).toBe(false);
			const after = screenX(px);
			const jump = Math.abs(after - during);
			if (jump > worst.jump) worst = { jump: Math.round(jump * 10) / 10, ratio: half / 10, during: Math.round(during * 10) / 10, after: Math.round(after * 10) / 10 };
		}
		// The picture must not move under still fingers when they lift (spec §7.6: the gesture is smooth).
		expect(worst.jump, JSON.stringify(worst)).toBeLessThan(1);
	});

	it('sample tree 7 on a phone: a D19 fill under resting fingers does not move the tree point under them', () => {
		const { layout } = layOut(fixtureSource('07'));
		const bounds = treeBounds(layout.width, layout.height);
		const size = { w: 390, h: 844 };
		let worst = { jump: 0, start: 0 };
		for (let i = 0; i < 40; i++) {
			resetDom();
			const vp = new FEl('div', { cls: 'dynasty-viewport' });
			vp.clientWidth = size.w;
			vp.clientHeight = size.h;
			const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
			const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
			const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
			const pz = new PanZoom({
				viewport: vp as unknown as HTMLElement,
				scene: scene as unknown as SVGGElement,
				wrapper: canvas as unknown as HTMLElement,
				bounds,
				fontPx: 16,
				interactive: true,
				mode: 'full',
				onSettle: () => {},
				guard: (fn) => fn(),
			});
			pz.resize(size);
			const fit = fitView(bounds, size);
			// Start zoomed in a little, somewhere right of the tree centre, and pinch out.
			const start = { scale: fit.scale * (1.5 + i * 0.05), cx: fit.cx + 4000, cy: fit.cy };
			pz.setView(start);
			flushFrames();
			const screenX = (px: number) => {
				const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(scene.getAttribute('transform')!)!;
				let x = Number(m[3]) * px + Number(m[1]);
				if (canvas.hasClass(GESTURE_CLASS)) {
					const w = /matrix\(([-\d.e]+), 0, 0, ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(canvas.style.getPropertyValue('--dynasty-gesture-transform'))!;
					x = Number(w[1]) * x + Number(w[3]);
				}
				return x;
			};
			const px = start.cx;
			dispatch(svg, 'pointerdown', pointer('touch', 1, 145, 422));
			dispatch(svg, 'pointerdown', pointer('touch', 2, 245, 422, false));
			runTimers(1000); // the last drawing is old: the first pinch-out frame fills
			dispatch(svg, 'pointermove', pointer('touch', 1, 150, 422));
			dispatch(svg, 'pointermove', pointer('touch', 2, 240, 422, false));
			runFrame();
			// A further pinch out: wrapped, with empty space at the edges; then the fingers rest.
			dispatch(svg, 'pointermove', pointer('touch', 1, 160, 422));
			dispatch(svg, 'pointermove', pointer('touch', 2, 230, 422, false));
			runFrame();
			expect(canvas.hasClass(GESTURE_CLASS)).toBe(true);
			const before = screenX(px);
			runTimers(300); // the fill timer comes due while the fingers rest
			runFrame();
			const after = screenX(px);
			const jump = Math.abs(after - before);
			if (jump > worst.jump) worst = { jump: Math.round(jump * 10) / 10, start: start.scale };
		}
		expect(worst.jump, JSON.stringify(worst)).toBeLessThan(1);
	});
});
