import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { PanZoom } from '../src/render/dom/pan-zoom';
import { treeBounds, type Size, type View } from '../src/render/view-math';
import { FEl, clock, dispatch, installDom, pointer, resetDom, runFrame } from './acceptance/fake-dom';

/*
 * 0.3 WP-A on the real PanZoom and the fake DOM: F4 (the insets are read once at the start of a drag).
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
const FREE = { top: 47, bottom: 98 };

interface Made {
	vp: FEl;
	scene: FEl;
	pz: PanZoom;
	fills: number[];
	writes: number[];
}

/** A full-screen pan and zoom on a tree of `bounds`, with the view at `start`. `fills` and `writes` hold the frame number of each fill and scene write. */
function make(o: { bounds?: ReturnType<typeof treeBounds>; size?: Size; start?: View; free?: boolean; onDragStart?: () => void } = {}): Made {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const scene = canvas.createSvg('svg', { cls: 'dynasty-svg' }).createSvg('g', { cls: 'dynasty-scene' });
	const fills: number[] = [];
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
		onSettle: () => {},
		onFill: () => fills.push(frameNo),
		...(o.free ? { freeArea: () => FREE } : {}),
		...(o.onDragStart ? { onDragStart: o.onDragStart } : {}),
		guard: (fn: () => void) => fn(),
	} as never);
	pz.resize(o.size ?? { w: 800, h: 600 });
	pz.setView(o.start ?? { scale: 1, cx: 2000, cy: 1000 });
	step(3);
	fills.length = writes.length = 0;
	return { vp, scene, pz, fills, writes };
}

describe('G2 review WP-A: PanZoom', () => {
	it('F4: the insets are refreshed once at the start of a drag, never on a move', () => {
		let calls = 0;
		const m = make({ free: true, onDragStart: () => calls++ });
		dispatch(m.vp, 'pointerdown', pointer('touch', 5, 200, 400));
		expect(calls).toBe(1);
		for (let i = 1; i <= 10; i++) dispatch(m.vp, 'pointermove', pointer('touch', 5, 200 + i * 5, 400 + i * 5));
		dispatch(m.vp, 'pointerup', pointer('touch', 5, 250, 450));
		expect(calls).toBe(1);
		dispatch(m.vp, 'pointerdown', pointer('touch', 6, 200, 400));
		expect(calls).toBe(2);
	});
});
