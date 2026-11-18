import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dragMovesWrapper, isIosWebKit, PAN_WRAPPER_ATTR, panWrapperOverride, STANDING_LAYER_MAX_PEOPLE } from '../../src/obsidian/move-layer';
import { FILL_MS, GESTURE_CLASS, PanZoom, type MarginRule } from '../../src/render/dom/pan-zoom';
import { treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, pointer, resetDom, runFrame, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { showsView } from '../support/pan-screen';

/*
 * D365 (1): a one-finger drag of a large tree on iOS moves the HTML wrapper and writes the scene <g> when the drag ends or empty space shows.
 * The owner's example: 500 cards keep today's path, 501 take the wrapper path; the harness switch overrides both.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SIZE = { w: 390, h: 760 };

/** `rule`: the margin rule; absent, the release rule (`range`). The fill tests take 0.5, so that empty space shows within a short drag. */
function fullScreen(wrapDrag: boolean, rule?: MarginRule) {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const settled: View[] = [];
	const fills: View[] = [];
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(4000, 2000),
		fontPx: 16,
		interactive: true,
		mode: 'full',
		onSettle: (v) => settled.push(v),
		onFill: (v) => fills.push(v),
		wrapDrag: () => wrapDrag,
		...(rule === undefined ? {} : { marginRule: () => rule }),
		guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 1, cx: 2000, cy: 1000 });
	flushFrames();
	return { canvas, svg, scene, pz, settled, fills };
}

/** A drag of `steps` moves, one frame each; returns the scene transforms written by the frames. */
function drag(r: ReturnType<typeof fullScreen>, steps: number, stepPx = 6): string[] {
	dispatch(r.svg, 'pointerdown', pointer('touch', 1, 200, 400));
	const seen: string[] = [];
	for (let i = 1; i <= steps; i++) {
		dispatch(r.svg, 'pointermove', pointer('touch', 1, 200 - i * stepPx, 400 - i * (stepPx / 2)));
		runFrame();
		seen.push(r.scene.getAttribute('transform') ?? '');
	}
	return seen;
}

describe('which drag moves the wrapper', () => {
	it('500 cards take today\'s path and 501 take the wrapper path, on iOS only', () => {
		expect(dragMovesWrapper(STANDING_LAYER_MAX_PEOPLE, true)).toBe(false);
		expect(dragMovesWrapper(STANDING_LAYER_MAX_PEOPLE + 1, true)).toBe(true);
		expect(dragMovesWrapper(1000, true)).toBe(true);
		expect(dragMovesWrapper(1000, false)).toBe(false);
		expect(dragMovesWrapper(0, true)).toBe(false);
	});

	it('the harness switch decides alone: on for a small tree on Blink, off for a large tree on iOS', () => {
		expect(dragMovesWrapper(10, false, 'on')).toBe(true);
		expect(dragMovesWrapper(5000, true, 'off')).toBe(false);
		expect(dragMovesWrapper(5000, true, null)).toBe(true);
	});
});

describe('what the tree view reads from the page', () => {
	const win = (coarse: boolean, callout: boolean) => ({ matchMedia: () => ({ matches: coarse }), CSS: { supports: () => callout } }) as unknown as Window;
	const doc = (v: string | null) => ({ documentElement: { getAttribute: (n: string) => (n === PAN_WRAPPER_ATTR ? v : null) } }) as unknown as Document;

	it('iOS WebKit is a coarse pointer with -webkit-touch-callout; a computer or a Blink phone is not', () => {
		expect(isIosWebKit(win(true, true))).toBe(true);
		expect(isIosWebKit(win(true, false))).toBe(false);
		expect(isIosWebKit(win(false, true))).toBe(false);
		expect(isIosWebKit({} as Window)).toBe(false);
	});

	it('the harness attribute reads on, off or nothing', () => {
		expect(panWrapperOverride(doc('on'))).toBe('on');
		expect(panWrapperOverride(doc('off'))).toBe('off');
		expect(panWrapperOverride(doc('yes'))).toBeNull();
		expect(panWrapperOverride(doc(null))).toBeNull();
	});
});

describe('a wrapped drag', () => {
	it('moves the wrapper and keeps the scene <g> as drawn while the strip is small and the last drawing is young', () => {
		const r = fullScreen(true);
		const before = r.scene.getAttribute('transform');
		const seen = drag(r, 8);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		expect(r.canvas.style.getPropertyValue('--dynasty-gesture-transform')).toMatch(/^matrix\(/);
		expect(new Set(seen)).toEqual(new Set([before]));
		expect(r.fills.length).toBe(0);
	});

	it('draws the real view while empty space shows, at most once in FILL_MS, and calls onFill each time (rule 0.5)', () => {
		const r = fullScreen(true, 0.5);
		clock.now += 1000;
		const writes: string[] = [r.scene.getAttribute('transform') ?? ''];
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, 300, 400));
		// The picture has a margin of half a screen (rule 0.5, D366), so the strip shows only after 195 px: 16 px a frame crosses it in 12 frames.
		for (let i = 1; i <= 60; i++) {
			dispatch(r.svg, 'pointermove', pointer('touch', 1, 300 - i * 16, 400));
			runFrame();
			const t = r.scene.getAttribute('transform') ?? '';
			if (writes[writes.length - 1] !== t) writes.push(t);
		}
		// 60 frames of 16 ms is 960 ms: the first frame past the margin fills (the drawing is old), then one fill each FILL_MS.
		expect(writes.length).toBeGreaterThanOrEqual(3);
		expect(writes.length).toBeLessThanOrEqual(1 + Math.ceil(960 / FILL_MS));
		expect(r.fills.length).toBe(writes.length - 1);
	});

	it('at the lift inside the margin the <g> is not written and the wrapper keeps the view; the settle still gets the view of the fingers', () => {
		const plain = fullScreen(false);
		const wrapped = fullScreen(true);
		const first = wrapped.scene.getAttribute('transform');
		for (const r of [plain, wrapped]) {
			drag(r, 25);
			dispatch(r.svg, 'pointerup', pointer('touch', 1, 50, 325));
			runFrame();
			runFrame();
		}
		// 150 px across and 75 px down: inside the margin of the release rule, so no write at any frame or at the lift.
		expect(wrapped.scene.getAttribute('transform')).toBe(first);
		expect(wrapped.canvas.hasClass(GESTURE_CLASS)).toBe(true);
		expect(wrapped.canvas.style.getPropertyValue('--dynasty-gesture-transform')).toMatch(/^matrix\(1, 0, 0, 1, /);
		showsView(wrapped, SIZE);
		expect(wrapped.settled.length).toBe(plain.settled.length);
		const [a, b] = [wrapped.settled[wrapped.settled.length - 1], plain.settled[plain.settled.length - 1]];
		expect(Math.abs(a.cx - b.cx)).toBeLessThanOrEqual(1);
		expect(Math.abs(a.cy - b.cy)).toBeLessThanOrEqual(1);
		expect(a.scale).toBe(b.scale);
	});

	it('a drag that rests with empty space on screen still fills on time (rule 0.5)', () => {
		const r = fullScreen(true, 0.5);
		// Past the margin of 195 px at the second step; the drawing is young, so the fill waits for its time.
		drag(r, 2, 120);
		const fillsBefore = r.fills.length;
		runTimers(FILL_MS + 20);
		runFrame();
		expect(r.fills.length).toBeGreaterThan(fillsBefore);
	});

	it('a drag with wrapDrag false writes the scene transform in each frame and never touches the wrapper (today\'s path)', () => {
		const r = fullScreen(false);
		const seen = drag(r, 20);
		expect(new Set(seen).size).toBeGreaterThanOrEqual(19);
		expect(r.canvas.hasClass(GESTURE_CLASS)).toBe(false);
		expect(r.canvas.style.getPropertyValue('--dynasty-gesture-transform')).toBe('');
		expect(r.fills.length).toBe(0);
	});
});
