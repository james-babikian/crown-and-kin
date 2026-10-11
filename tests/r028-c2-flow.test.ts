import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { PanZoom } from '../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, installDom, resetDom, wheel } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, openFullScreen } from './acceptance/tree-view-fakes';

/*
 * 0.2.8 (D212 bars-in-flow, package C2): in a note the toolbar and the banner stand above the tree, in the flow of the box, and the pan and zoom code works in
 * the drawing area below them. The full-screen view keeps its bars over the tree.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `people:
  - {id: a, name: Ann, born: 1100}
  - {id: b, name: Bob, parents: [a], born: 1130}
`;

describe('the pan and zoom frame', () => {
	function make(frameTop?: () => number) {
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
		const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
		const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
		const settled: View[] = [];
		const pz = new PanZoom({
			viewport: vp as unknown as HTMLElement,
			scene: scene as unknown as SVGGElement,
			wrapper: canvas as unknown as HTMLElement,
			...(frameTop ? { frameTop } : {}),
			bounds: treeBounds(4000, 2000),
			fontPx: 16,
			interactive: true,
			mode: 'embed',
			onSettle: (v) => settled.push(v),
			guard: (fn) => fn(),
		});
		pz.resize({ w: 800, h: 600 });
		pz.setView({ scale: 1, cx: 2000, cy: 1000 });
		flushFrames();
		return { vp, pz };
	}

	// A zoom with the control key held, at the middle of the drawing area, leaves the view's centre where it is.
	const zoomAtMiddle = (vp: FEl, clientY: number) => dispatch(vp, 'wheel', { ...wheel(0, -100, 400, clientY), ctrlKey: true, target: vp });

	it('reads a pointer position from the top of the drawing area, below the bars', () => {
		const { vp, pz } = make(() => 100);
		// The middle of the drawing area is at 100 + 300 px from the top of the box.
		zoomAtMiddle(vp, 400);
		flushFrames();
		expect(pz.view!.cy).toBeCloseTo(1000, 6);
		expect(pz.view!.cx).toBeCloseTo(2000, 6);
		expect(pz.view!.scale).toBeGreaterThan(1);
	});

	it('without bars the top of the drawing area is the top of the box (the full-screen view)', () => {
		const { vp, pz } = make();
		zoomAtMiddle(vp, 300);
		flushFrames();
		expect(pz.view!.cy).toBeCloseTo(1000, 6);
		const flat = make(() => 0);
		zoomAtMiddle(flat.vp, 300);
		flushFrames();
		expect(flat.pz.view!.cy).toBeCloseTo(1000, 6);
	});

	it('a wrong frame would move the centre (the same press with no band moves it)', () => {
		const { vp, pz } = make();
		zoomAtMiddle(vp, 400);
		flushFrames();
		expect(Math.abs(pz.view!.cy - 1000)).toBeGreaterThan(1);
	});

	it('takes a band that is not a number as 0', () => {
		const { vp, pz } = make(() => Number.NaN);
		zoomAtMiddle(vp, 300);
		flushFrames();
		expect(pz.view!.cy).toBeCloseTo(1000, 6);
	});
});

describe('the tree view in a note and in the full-screen view', () => {
	it('puts the class is-flow on the box in a note, and measures no band to keep free', async () => {
		desktop();
		const { el, view } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		const vp = el.querySelector('.dynasty-viewport')!;
		expect(vp.hasClass('is-flow')).toBe(true);
		const v = view as unknown as { insetTop: number; insetBottom: number; barBox: unknown };
		expect(v.insetTop).toBe(0);
		expect(v.insetBottom).toBe(0);
		expect(v.barBox).toBeNull();
	});

	it('the drawing area starts at the foot of the last bar and is that much shorter than the box', async () => {
		desktop();
		const { el, view } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		const vp = el.querySelector('.dynasty-viewport')!;
		const bar = vp.querySelector('.dynasty-toolbar')!;
		Object.assign(bar, { offsetTop: 0, offsetHeight: 44 });
		const v = view as unknown as { frameTop(vp?: unknown): number };
		expect(v.frameTop()).toBe(44);
		// A banner under the toolbar takes more.
		const result = vp.createDiv({ cls: 'dynasty-result' });
		Object.assign(result, { offsetTop: 44, offsetHeight: 52 });
		expect(v.frameTop()).toBe(96);
	});

	it('keeps the bars over the tree in the full-screen view', async () => {
		desktop();
		const { root } = await openFullScreen(SRC);
		const vp = root.querySelector('.dynasty-viewport')!;
		expect(vp.hasClass('is-flow')).toBe(false);
	});
});
