import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { PanZoom } from '../src/render/dom/pan-zoom';
import { transformFor, treeBounds, type Size, type View } from '../src/render/view-math';
import { FEl, clock, dispatch, installDom, pointer, resetDom, runFrame, wheel } from './acceptance/fake-dom';

/*
 * The real PanZoom on the fake DOM. D235: no view change slides; `setView` and the double tap show the new view in the next frame, with one write of the scene.
 * D222 (0.3 WP-A, A.5): a drag or a wheel pan keeps a small tree between the bars of the full-screen view.
 */

let frameNo = 0;
/** One frame of the fake window; `frameNo` says which one, so that a test can say "the frame after". */
function step(n = 1): void {
	for (let i = 0; i < n; i++) {
		frameNo++;
		runFrame();
	}
}

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	frameNo = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const BIG = treeBounds(4000, 2000);
const PHONE: Size = { w: 390, h: 844 };
const FREE = { top: 47, bottom: 98 };

interface Made {
	vp: FEl;
	scene: FEl;
	pz: PanZoom;
	fills: number[];
	settles: { view: View; byUser: boolean }[];
	writes: number[];
}

/** A full-screen pan and zoom on a tree of `bounds`, with the view at `start`. `fills` and `writes` hold the frame number of each fill and scene write. */
function make(o: { bounds?: ReturnType<typeof treeBounds>; size?: Size; start?: View; free?: boolean } = {}): Made {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const scene = canvas.createSvg('svg', { cls: 'dynasty-svg' }).createSvg('g', { cls: 'dynasty-scene' });
	const fills: number[] = [];
	const settles: { view: View; byUser: boolean }[] = [];
	const writes: number[] = [];
	const set = scene.setAttribute.bind(scene);
	scene.setAttribute = (name: string, value: string) => {
		if (name === 'transform') writes.push(frameNo);
		return set(name, value);
	};
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: o.bounds ?? BIG,
		fontPx: 16,
		interactive: true,
		mode: 'full',
		onSettle: (view: View, byUser: boolean) => settles.push({ view, byUser }),
		onFill: () => fills.push(frameNo),
		...(o.free ? { freeArea: () => FREE } : {}),
		guard: (fn: () => void) => fn(),
	} as never);
	pz.resize(o.size ?? { w: 800, h: 600 });
	pz.setView(o.start ?? { scale: 1, cx: 2000, cy: 1000 });
	step(3);
	fills.length = settles.length = writes.length = 0;
	return { vp, scene, pz, fills, settles, writes };
}

describe('D235: a view change does not slide', () => {
	it('setView sets the view and settles at once; the next frame writes the scene once, at the target', () => {
		const m = make();
		const from = m.pz.view!;
		const to = { ...from, cx: from.cx + 600 };
		expect(m.pz.setView(to, { byUser: true })).toBeUndefined();
		expect(m.pz.view).toEqual(to);
		expect(m.settles).toEqual([{ view: to, byUser: true }]);
		expect(m.pz.busy).toBe(false);
		step(1);
		expect(m.writes).toHaveLength(1);
		expect(m.scene.getAttribute('transform')).toBe(transformFor(to, { w: 800, h: 600 }));
		// No later frame writes the scene again.
		step(40);
		expect(m.writes).toHaveLength(1);
	});

	it('a zoom out (Fit) and a move of three view widths are also at their target in the first frame', () => {
		const m = make();
		const far = { scale: 1, cx: m.pz.view!.cx - 2400, cy: m.pz.view!.cy };
		m.pz.setView(far);
		step(1);
		expect(m.pz.view).toEqual(far);
		const fit = { scale: 0.2, cx: 2000, cy: 1000 };
		m.pz.setView(fit, { byUser: true });
		step(1);
		expect(m.pz.view).toEqual(fit);
		expect(m.writes).toHaveLength(2);
	});

	it('the double tap on the empty background zooms at once: the view is the target in the same frame as the second tap, with no animation frames', () => {
		const m = make();
		const before = m.pz.view!;
		for (let i = 0; i < 2; i++) {
			dispatch(m.vp, 'pointerdown', pointer('touch', 5, 300, 200));
			dispatch(m.vp, 'pointerup', pointer('touch', 5, 300, 200));
			clock.now += 100;
		}
		const after = m.pz.view!;
		expect(after.scale).toBeGreaterThan(before.scale);
		expect(m.settles).toHaveLength(1);
		expect(m.settles[0]).toEqual({ view: after, byUser: true });
		step(1);
		expect(m.writes).toHaveLength(1);
		step(40);
		expect(m.pz.view).toEqual(after);
		expect(m.writes).toHaveLength(1);
	});

	it('a press does not change the view (nothing to stop), and a pending frame still writes the target', () => {
		const m = make();
		const to = { ...m.pz.view!, cx: 1500 };
		m.pz.setView(to);
		dispatch(m.vp, 'pointerdown', pointer('touch', 1, 100, 100));
		step(1);
		expect(m.pz.view).toEqual(to);
		expect(m.settles).toHaveLength(1);
	});
});


describe('A.5: a drag or a wheel pan keeps a small tree between the bars', () => {
	const bounds = treeBounds(160, 64);
	const start: View = { scale: 0.875, cx: 80, cy: 32 + (FREE.bottom - FREE.top) / 2 / 0.875 };

	/** The bounds on screen for the current view. */
	const box = (m: Made) => {
		const v = m.pz.view!;
		const left = PHONE.w / 2 + (bounds.x - v.cx) * v.scale;
		const top = PHONE.h / 2 + (bounds.y - v.cy) * v.scale;
		return { left, top, right: left + bounds.w * v.scale, bottom: top + bounds.h * v.scale };
	};

	function dragBy(m: Made, dx: number, dy: number): void {
		dispatch(m.vp, 'pointerdown', pointer('touch', 7, 200, 400));
		for (let i = 1; i <= 10; i++) {
			dispatch(m.vp, 'pointermove', pointer('touch', 7, 200 + (dx * i) / 10, 400 + (dy * i) / 10));
			step();
		}
		dispatch(m.vp, 'pointerup', pointer('touch', 7, 200 + dx, 400 + dy));
		step(3);
	}

	it('stops the tree at each edge of the free area and not beyond (within 1 px)', () => {
		const m = make({ bounds, size: PHONE, start, free: true });
		const cases: [number, number][] = [[-1000, 0], [1000, 0], [0, -1500], [0, 1500], [900, 1500], [-900, -1500]];
		for (const [dx, dy] of cases) {
			dragBy(m, dx, dy);
			const b = box(m);
			expect(b.left).toBeGreaterThanOrEqual(-1);
			expect(b.right).toBeLessThanOrEqual(PHONE.w + 1);
			expect(b.top).toBeGreaterThanOrEqual(FREE.top - 1);
			expect(b.bottom).toBeLessThanOrEqual(PHONE.h - FREE.bottom + 1);
		}
		// A drag far to the bottom right takes the tree against the bottom right corner of the free area; a drag the other way, against the top left.
		dragBy(m, 900, 1500);
		const b = box(m);
		expect(Math.abs(b.right - PHONE.w)).toBeLessThanOrEqual(1);
		expect(Math.abs(b.bottom - (PHONE.h - FREE.bottom))).toBeLessThanOrEqual(1);
		dragBy(m, -1900, -3000);
		const c = box(m);
		expect(Math.abs(c.left)).toBeLessThanOrEqual(1);
		expect(Math.abs(c.top - FREE.top)).toBeLessThanOrEqual(1);
	});

	it('does the same for a wheel pan', () => {
		const m = make({ bounds, size: PHONE, start, free: true });
		for (let i = 0; i < 20; i++) {
			dispatch(m.vp, 'wheel', wheel(-200, -400));
			step();
		}
		const b = box(m);
		expect(Math.abs(b.right - PHONE.w)).toBeLessThanOrEqual(1);
		expect(Math.abs(b.bottom - (PHONE.h - FREE.bottom))).toBeLessThanOrEqual(1);
		for (let i = 0; i < 40; i++) {
			dispatch(m.vp, 'wheel', wheel(200, 400));
			step();
		}
		const c = box(m);
		expect(Math.abs(c.left)).toBeLessThanOrEqual(1);
		expect(Math.abs(c.top - FREE.top)).toBeLessThanOrEqual(1);
	});

	it('without the free area (0.2.8) the limit is the centre of the screen over the bounds, not the edge of the free area', () => {
		const m = make({ bounds, size: PHONE, start });
		dragBy(m, -1000, 0);
		expect(box(m).right).toBeCloseTo(PHONE.w / 2, 6);
		dragBy(m, 2000, 0);
		expect(box(m).left).toBeCloseTo(PHONE.w / 2, 6);
	});

	it('a tree larger than the free area keeps the 0.2.8 limits in that axis', () => {
		const tall = treeBounds(160, 3000);
		const m = make({ bounds: tall, size: PHONE, start: { scale: 0.875, cx: 80, cy: 400 }, free: true });
		dragBy(m, 0, 4000);
		// The view centre goes to the top edge of the bounds, as in 0.2.8.
		expect(m.pz.view!.cy).toBeCloseTo(tall.y, 6);
		dragBy(m, 0, -9000);
		expect(m.pz.view!.cy).toBeCloseTo(tall.y + tall.h, 6);
	});

	it('a view that starts outside the limits (after a pinch) does not jump back at the first move', () => {
		const m = make({ bounds, size: PHONE, start: { scale: 0.875, cx: 5000, cy: 32 }, free: true });
		const before = m.pz.view!;
		dragBy(m, 0, 20);
		expect(m.pz.view!.cx).toBeCloseTo(before.cx, 6);
	});
});
