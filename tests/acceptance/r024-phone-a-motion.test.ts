import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GESTURE_CLASS, PanZoom } from '../../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, fakeWin, flushFrames, pointer, resetDom, runFrame, runTimers } from './fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.4, phone animation (D124 items 2 to 4, contract 7): the proofs of M5 (a change of the scale of the scene at each frame makes the browser shape
 * all SVG text again; since D235 no view change runs over frames) and M11 (the work at the end of a pan runs inside the pointer-up handler). The real
 * PanZoom runs on the fake DOM.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const BOUNDS = treeBounds(4000, 2000);
const SIZE = { w: 800, h: 600 };

interface Rig {
	vp: FEl;
	canvas: FEl;
	scene: FEl;
	pz: PanZoom;
	settled: { view: View; byUser: boolean }[];
	/** The value of every write of the scene's `transform` attribute. */
	writes: string[];
	/** The views `onFill` was called with. */
	fills: View[];
}

function make(o: { mode?: 'full' | 'embed'; start?: View } = {}): Rig {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const scene = canvas.createSvg('svg', { cls: 'dynasty-svg' }).createSvg('g', { cls: 'dynasty-scene' });
	const writes: string[] = [];
	const set = scene.setAttribute.bind(scene);
	scene.setAttribute = (k: string, v: string) => {
		if (k === 'transform') writes.push(v);
		set(k, v);
	};
	const settled: Rig['settled'] = [];
	const fills: View[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: BOUNDS,
		fontPx: 16,
		interactive: true,
		mode: o.mode ?? 'full',
		onSettle: (view, byUser) => settled.push({ view, byUser }),
		onFill: (v) => fills.push(v),
		guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView(o.start ?? { scale: 1, cx: 2000, cy: 1000 });
	flushFrames();
	writes.length = 0;
	settled.length = 0;
	fills.length = 0;
	return { vp, canvas, scene, pz, settled, writes, fills };
}

/** The view that the screen shows: the scene transform, then the wrapper transform while its class is on. */
function onScreen(r: Rig): View {
	const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(r.scene.getAttribute('transform') ?? '');
	if (!m) throw new Error('no scene transform');
	let [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	if (r.canvas.hasClass(GESTURE_CLASS)) {
		const w = /matrix\(([-\d.e]+), 0, 0, ([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\)/.exec(r.canvas.style.getPropertyValue('--dynasty-gesture-transform'));
		if (!w) throw new Error('wrapper class without a matrix');
		const k = Number(w[1]);
		tx = k * tx + Number(w[3]);
		ty = k * ty + Number(w[4]);
		s = k * s;
	}
	return { scale: s, cx: (SIZE.w / 2 - tx) / s, cy: (SIZE.h / 2 - ty) / s };
}

describe('D235: a view change does not slide, so the scene is written once and the text is not shaped again', () => {
	it('a zoom out (Fit), a zoom in and a move (Find): one write in the next frame, at the target, with no wrapper transform', () => {
		for (const [start, to] of [
			[{ scale: 1, cx: 1500, cy: 900 }, { scale: 0.25, cx: 2000, cy: 1000 }],
			[{ scale: 0.25, cx: 2000, cy: 1000 }, { scale: 1, cx: 1500, cy: 900 }],
			[{ scale: 1, cx: 600, cy: 900 }, { scale: 1, cx: 3400, cy: 900 }],
			[{ scale: 1, cx: 600, cy: 500 }, { scale: 0.5, cx: 3400, cy: 1500 }],
		] as [View, View][]) {
			resetDom();
			const r = make({ start });
			r.pz.setView(to, { byUser: true });
			expect(r.pz.view).toEqual(to);
			expect(r.settled).toEqual([{ view: to, byUser: true }]);
			expect(r.pz.busy).toBe(false);
			runFrame();
			expect(r.writes).toHaveLength(1);
			expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
			const s = onScreen(r);
			expect(s.scale).toBeCloseTo(to.scale, 3);
			expect(s.cx).toBeCloseTo(to.cx, 1);
			expect(s.cy).toBeCloseTo(to.cy, 1);
			flushFrames();
			expect(r.writes).toHaveLength(1);
		}
	});

	it('the frame count of a view change is one, also when the call is made twice before the frame', () => {
		const frames: number[] = [];
		const real = fakeWin.requestAnimationFrame;
		vi.spyOn(fakeWin, 'requestAnimationFrame').mockImplementation((cb: () => void) => {
			frames.push(1);
			return real.call(fakeWin, cb);
		});
		const r = make({ start: { scale: 1, cx: 1500, cy: 900 } });
		frames.length = 0;
		r.pz.setView({ scale: 0.5, cx: 2000, cy: 1000 }, { byUser: true });
		r.pz.setView({ scale: 0.25, cx: 2200, cy: 1000 }, { byUser: true });
		expect(frames).toHaveLength(1);
		flushFrames();
		expect(r.writes).toHaveLength(1);
		expect(onScreen(r).scale).toBeCloseTo(0.25, 3);
	});
});

describe('M11: the work at the end of a pan runs in the next frame', () => {
	it('a mouse pan of an embedded tree: the settle does not run inside the pointer-up handler', () => {
		const r = make({ mode: 'embed' });
		dispatch(r.vp, 'pointerdown', pointer('mouse', 1, 400, 300));
		for (let i = 1; i <= 5; i++) {
			dispatch(r.vp, 'pointermove', pointer('mouse', 1, 400 - i * 20, 300));
			runFrame();
		}
		expect(r.settled).toEqual([]);
		dispatch(r.vp, 'pointerup', pointer('mouse', 1, 300, 300));
		expect(r.settled, 'the pointer-up handler must not settle').toEqual([]);
		runFrame();
		expect(r.settled).toHaveLength(1);
		expect(r.settled[0].byUser).toBe(true);
		expect(r.settled[0].view).toEqual(r.pz.view);
	});

	it('a touch pan of the full-screen view, and a pointer cancel: the same', () => {
		for (const [end, type] of [['pointerup', 'up'], ['pointercancel', 'cancel']] as const) {
			resetDom();
			const r = make({ mode: 'full' });
			dispatch(r.vp, 'pointerdown', pointer('touch', 1, 400, 300));
			dispatch(r.vp, 'pointermove', pointer('touch', 1, 300, 250));
			runFrame();
			dispatch(r.vp, end, pointer('touch', 1, 300, 250));
			expect(r.settled, type).toEqual([]);
			runFrame();
			expect(r.settled, type).toHaveLength(1);
		}
	});

	it('the end of a pinch settles in the next frame, not inside the handler', () => {
		const r = make({ mode: 'full' });
		dispatch(r.vp, 'pointerdown', pointer('touch', 1, 300, 300));
		dispatch(r.vp, 'pointerdown', pointer('touch', 2, 500, 300, false));
		dispatch(r.vp, 'pointermove', pointer('touch', 1, 250, 300));
		dispatch(r.vp, 'pointermove', pointer('touch', 2, 550, 300, false));
		runFrame();
		dispatch(r.vp, 'pointerup', pointer('touch', 1, 250, 300));
		dispatch(r.vp, 'pointerup', pointer('touch', 2, 550, 300, false));
		expect(r.settled).toEqual([]);
		flushFrames();
		expect(r.settled).toHaveLength(1);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
	});

	it('a tap that is not a pan never settles; the destroyed view runs no pending settle', () => {
		const r = make({ mode: 'embed' });
		dispatch(r.vp, 'pointerdown', pointer('mouse', 1, 400, 300));
		dispatch(r.vp, 'pointerup', pointer('mouse', 1, 400, 300));
		flushFrames();
		expect(r.settled).toEqual([]);
		dispatch(r.vp, 'pointerdown', pointer('mouse', 1, 400, 300));
		dispatch(r.vp, 'pointermove', pointer('mouse', 1, 300, 300));
		dispatch(r.vp, 'pointerup', pointer('mouse', 1, 300, 300));
		r.pz.destroy();
		flushFrames();
		runTimers();
		expect(r.settled).toEqual([]);
	});

	it('two pans in a row settle once for each, with the last view', () => {
		const r = make({ mode: 'embed' });
		for (let k = 0; k < 2; k++) {
			dispatch(r.vp, 'pointerdown', pointer('mouse', 1, 400, 300));
			dispatch(r.vp, 'pointermove', pointer('mouse', 1, 400 - 40 * (k + 1), 300));
			runFrame();
			dispatch(r.vp, 'pointerup', pointer('mouse', 1, 300, 300));
			runFrame();
		}
		expect(r.settled).toHaveLength(2);
		expect(r.settled[1].view).toEqual(r.pz.view);
	});
});

describe('M7, M8: the highlight pulse (styles.css)', () => {
	const css = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
	const keyframes = (name: string) => new RegExp(`@keyframes ${name}\\s*\\{([^]*?)\\n\\}`).exec(css)?.[1] ?? '';
	const rule = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

	it('the pulse changes opacity only, never a width or a size; there is no other pulse', () => {
		const body = keyframes('dynasty-pulse-ring');
		expect(body).not.toBe('');
		expect(body).toMatch(/opacity/);
		expect(body).not.toMatch(/stroke-width|width|height|transform|r:/);
		expect(css).not.toMatch(/@keyframes dynasty-pulse\s*\{/);
	});

	it('the ring pulses and the accent border does not; the widths are fixed and the ring is 2 px outside the accent', () => {
		const ring = rule('.dynasty-card.dynasty-highlight .dynasty-card-ring');
		const bg = rule('.dynasty-card.dynasty-highlight .dynasty-card-bg');
		const width = (b: string) => Number(/stroke-width:\s*([\d.]+)/.exec(b)?.[1]);
		expect((width(ring) - width(bg)) / 2).toBe(2);
		expect(ring).toContain('animation: dynasty-pulse-ring');
		expect(bg).not.toContain('animation');
	});

	it('the class dynasty-reduce-motion ends the animation, and there is no media query that would override the setting', () => {
		expect(css).toMatch(/\.dynasty-reduce-motion \.dynasty-card\.dynasty-highlight \.dynasty-card-ring\s*\{\s*animation:\s*none;/);
		expect(css).not.toMatch(/@media[^{]*prefers-reduced-motion/);
	});
});
