import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GESTURE_CLASS, PanZoom } from '../../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, pointer, resetDom, runFrame, runTimers } from './fake-dom';

/*
 * 0.2.4, phone animation (D124 items 2 to 4, contract 7): the proofs of M5 (Fit and the other animations change the scale of the scene at each
 * frame, so the browser shapes all SVG text again at each frame), M11 (the work at the end of a pan runs inside the pointer-up handler) and
 * the reduced movement of `PanZoom` (D126 1). The real PanZoom runs on the fake DOM.
 */

beforeAll(() => installDom());
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

function make(o: { mode?: 'full' | 'embed'; reduced?: () => boolean; start?: View } = {}): Rig {
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
		...(o.reduced ? { reduced: o.reduced } : {}),
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

const scaleOf = (t: string) => Number(/scale\(([-\d.e]+)\)/.exec(t)![1]);

describe('M5: an animation does not change the scale of the scene at each frame', () => {
	it('a zoom out (Fit): the scene is written once, and the screen shows the current view at every frame', () => {
		const r = make({ start: { scale: 1, cx: 1500, cy: 900 } });
		const to: View = { scale: 0.25, cx: 2000, cy: 1000 };
		r.pz.setView(to, { animate: true, byUser: true });
		const seen: View[] = [];
		for (let i = 0; i < 30; i++) {
			runFrame();
			seen.push(onScreen(r));
		}
		expect(r.writes.length, r.writes.join('\n')).toBeLessThanOrEqual(1);
		// The screen follows the animation: the scale falls from 1 to 0.25 and ends there.
		expect(seen[0].scale).toBeGreaterThan(0.5);
		expect(seen[seen.length - 1].scale).toBeCloseTo(0.25, 2);
		expect(seen[seen.length - 1].cx).toBeCloseTo(2000, 0);
		for (let i = 1; i < seen.length; i++) expect(seen[i].scale).toBeLessThanOrEqual(seen[i - 1].scale + 1e-9);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.pz.view).toEqual(to);
		expect(r.settled).toEqual([{ view: to, byUser: true }]);
	});

	it('a zoom out fills the end view once, at the start, and no frame fills again (a fill at each frame lays the text out again)', () => {
		const r = make({ start: { scale: 1, cx: 1500, cy: 900 } });
		const to: View = { scale: 0.25, cx: 2000, cy: 1000 };
		r.pz.setView(to, { animate: true });
		runFrame();
		expect(r.fills).toEqual([to]);
		flushFrames();
		expect(r.fills).toEqual([to]);
	});

	it('a zoom in: the picture that is drawn covers it, so the scene is written once, at the end', () => {
		const r = make({ start: { scale: 0.25, cx: 2000, cy: 1000 } });
		r.pz.setView({ scale: 1, cx: 1500, cy: 900 }, { animate: true, byUser: true });
		flushFrames();
		expect(r.writes.length).toBeLessThanOrEqual(1);
		expect(onScreen(r).scale).toBeCloseTo(1, 2);
	});

	it('a move at the same scale (Find) writes only moves: no write changes the scale', () => {
		const r = make({ start: { scale: 1, cx: 600, cy: 900 } });
		r.pz.setView({ scale: 1, cx: 3400, cy: 900 }, { animate: true, byUser: true });
		flushFrames();
		expect(r.writes.length).toBeGreaterThan(0);
		for (const w of r.writes) expect(scaleOf(w)).toBe(1);
		expect(onScreen(r).cx).toBeCloseTo(3400, 0);
	});

	it('a zoom out to a view that does not hold the start view still ends on the target, and writes with the scale of its frame', () => {
		const r = make({ start: { scale: 1, cx: 600, cy: 500 } });
		r.pz.setView({ scale: 0.5, cx: 3400, cy: 1500 }, { animate: true });
		flushFrames();
		expect(onScreen(r).scale).toBeCloseTo(0.5, 2);
		expect(onScreen(r).cx).toBeCloseTo(3400, 0);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
	});

	it('fuzz: at every frame of a random animation the screen shows the view of that frame, and at the end the target', () => {
		let a = 7;
		const next = () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
		for (let seed = 0; seed < 120; seed++) {
			resetDom();
			const r = make({ start: { scale: 0.2 + next() * 1.5, cx: next() * 4000, cy: next() * 2000 } });
			const to: View = { scale: 0.2 + next() * 1.5, cx: next() * 4000, cy: next() * 2000 };
			r.pz.setView(to, { animate: true });
			for (let f = 0; f < 40; f++) {
				runFrame();
				const v = r.pz.view!;
				const s = onScreen(r);
				const ctx = `seed ${seed} frame ${f}`;
				expect(Math.abs(s.scale / v.scale - 1), ctx).toBeLessThan(0.01);
				expect(Math.abs(s.cx - v.cx) * v.scale, ctx).toBeLessThan(1.5);
				expect(Math.abs(s.cy - v.cy) * v.scale, ctx).toBeLessThan(1.5);
			}
			expect(r.pz.view!.scale, `seed ${seed}`).toBeCloseTo(to.scale, 6);
			expect(r.canvas.hasClass(GESTURE_CLASS), `seed ${seed}`).toBe(false);
		}
	});

	it('a press in the middle of an animation stops it and shows that view', () => {
		const r = make({ mode: 'full', start: { scale: 1, cx: 1500, cy: 900 } });
		r.pz.setView({ scale: 0.25, cx: 2000, cy: 1000 }, { animate: true, byUser: true });
		for (let i = 0; i < 5; i++) runFrame();
		const mid = r.pz.view!;
		dispatch(r.vp, 'pointerdown', pointer('touch', 1, 400, 300));
		flushFrames();
		expect(r.pz.view).toEqual(mid);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(onScreen(r).scale).toBeCloseTo(mid.scale, 2);
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

describe('D126 (1): PanZoom with reduced movement', () => {
	let frames = 0;
	beforeEach(() => {
		frames = 0;
		const real = fakeWin.requestAnimationFrame;
		vi.spyOn(fakeWin, 'requestAnimationFrame').mockImplementation((cb: () => void) => {
			frames++;
			return real.call(fakeWin, cb);
		});
	});

	it('setView with animate sets the view at once, settles once and asks for one frame only', () => {
		const r = make({ reduced: () => true, start: { scale: 1, cx: 1500, cy: 900 } });
		frames = 0;
		const to: View = { scale: 0.25, cx: 2000, cy: 1000 };
		r.pz.setView(to, { animate: true, byUser: true });
		expect(r.pz.view).toEqual(to);
		expect(r.settled).toEqual([{ view: to, byUser: true }]);
		expect(r.pz.busy).toBe(false);
		runFrame();
		expect(frames).toBe(1);
		expect(r.writes).toHaveLength(1);
		expect(onScreen(r).scale).toBeCloseTo(0.25, 3);
	});

	it('with reduced movement off the same call animates over several frames', () => {
		const r = make({ reduced: () => false, start: { scale: 1, cx: 1500, cy: 900 } });
		frames = 0;
		r.pz.setView({ scale: 0.25, cx: 2000, cy: 1000 }, { animate: true });
		expect(r.pz.busy).toBe(true);
		flushFrames();
		expect(frames).toBeGreaterThan(5);
	});

	it('the function is read when an animation starts', () => {
		let reduced = false;
		const r = make({ reduced: () => reduced, start: { scale: 1, cx: 1500, cy: 900 } });
		r.pz.setView({ scale: 0.5, cx: 1500, cy: 900 }, { animate: true });
		expect(r.pz.busy).toBe(true);
		flushFrames();
		reduced = true;
		r.pz.setView({ scale: 1, cx: 1500, cy: 900 }, { animate: true });
		expect(r.pz.busy).toBe(false);
		expect(r.pz.view!.scale).toBe(1);
	});

	it('without the option nothing changes: the animation runs', () => {
		const r = make({ start: { scale: 1, cx: 1500, cy: 900 } });
		r.pz.setView({ scale: 0.5, cx: 1500, cy: 900 }, { animate: true });
		expect(r.pz.busy).toBe(true);
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
