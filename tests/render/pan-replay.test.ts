// D367: "a computer test that drags as you do". Press sequences of the owner's iPhone drag test (one finger, many fast presses) replayed through the real
// PanZoom at 390 × 844 on the pan limits of the 1,000-person study tree (10,972 × 7,795 px at zoom 1, sideways, font 16: the tree of
// An internal script), on the wrapped path with each margin rule. Each press counts its <g> writes: in the moves, at the first move, and at the
// lift. A move is one frame (16 ms); between two presses the finger is up for 350 ms (the median of the third iPhone test). The release rule (`DRAG_MARGIN`,
// `range` since the fourth iPhone test) is replayed as the tree view asks it: with no rule of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAG_MARGIN, PanZoom, RANGE_CAP_PX, type MarginRule } from '../../src/render/dom/pan-zoom';
import { panLimits, treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, pointer, resetDom, runFrame, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { showsView } from '../support/pan-screen';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SIZE = { w: 390, h: 844 };
const BOUNDS = treeBounds(10972, 7795);
/** The opening view: zoom 1, near the left end of the tree, at its middle height; the owner drags across the tree from there. */
const START: View = { scale: 1, cx: BOUNDS.x + 1200, cy: BOUNDS.y + BOUNDS.h / 2 };

interface Press {
	dx: number;
	dy: number;
	moves: number;
}

interface Count {
	during: number;
	first: number;
	lift: number;
}

/** `rule` null: no rule of its own, so `PanZoom` takes the release rule `DRAG_MARGIN`. */
function make(rule: MarginRule | null) {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	let writes = 0;
	const set = scene.setAttribute.bind(scene);
	scene.setAttribute = (k: string, v: string | number | boolean | null) => {
		if (k === 'transform') writes++;
		set(k, v);
	};
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement, scene: scene as unknown as SVGGElement, wrapper: canvas as unknown as HTMLElement,
		bounds: BOUNDS, fontPx: 16, interactive: true, mode: 'full', onSettle: () => {}, wrapDrag: () => true, ...(rule === null ? {} : { marginRule: () => rule }), guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView(START);
	flushFrames();
	runTimers(2000);
	return { canvas, svg, scene, pz, writes: () => writes };
}

/** Replays `presses` (each from the middle of the screen) and returns the <g> writes of each press. */
function replay(rule: MarginRule | null, presses: readonly Press[]): { counts: Count[]; r: ReturnType<typeof make> } {
	const r = make(rule);
	const counts: Count[] = [];
	const at = { x: 195, y: 422 };
	for (const p of presses) {
		const w0 = r.writes();
		dispatch(r.svg, 'pointerdown', pointer('touch', 1, at.x, at.y));
		let first = -1;
		for (let i = 1; i <= p.moves; i++) {
			dispatch(r.svg, 'pointermove', pointer('touch', 1, at.x + (p.dx * i) / p.moves, at.y + (p.dy * i) / p.moves));
			runFrame();
			if (first < 0) first = r.writes() - w0;
		}
		const w1 = r.writes();
		dispatch(r.svg, 'pointerup', pointer('touch', 1, at.x + p.dx, at.y + p.dy));
		flushFrames();
		counts.push({ during: w1 - w0, first, lift: r.writes() - w1 });
		runTimers(350);
	}
	return { counts, r };
}

const times = (n: number, p: Press | ((i: number) => Press)): Press[] => Array.from({ length: n }, (_, i) => (typeof p === 'function' ? p(i) : p));

/** The four gestures of the owner (20 presses each). The finger moves left, so the view moves right, into the tree. */
const GESTURES = {
	'one direction, 250 px': times(20, { dx: -250, dy: 0, moves: 10 }),
	'back and forth, 250 px': times(20, (i) => ({ dx: i % 2 ? 250 : -250, dy: 0, moves: 10 })),
	'diagonal, 250 px': times(20, { dx: -177, dy: -177, moves: 10 }),
	'fast short presses, 120 ms': times(20, { dx: -150, dy: 0, moves: 7 }),
} as const;
type Gesture = keyof typeof GESTURES;

const total = (c: Count[]) => c.reduce((s, x) => s + x.during + x.lift, 0);

/**
 * The <g> writes of the 20 presses of each gesture, for each rule (in the moves and at the lifts). 0.5 is the margin of the third iPhone test (65 of 73 presses
 * wrote once): one write in each 250 px press, and 5 more at a lift, where a press crossed the margin a second time less than `FILL_MS` after its fill, so the
 * lift draws. `range` writes none: the 20 presses stay inside the cap. The counts are exact: a change of the margin code that writes more fails here.
 */
const BUDGET: Record<string, Record<Gesture, number>> = {
	'0.5': { 'one direction, 250 px': 25, 'back and forth, 250 px': 20, 'diagonal, 250 px': 16, 'fast short presses, 120 ms': 14 },
	'1': { 'one direction, 250 px': 12, 'back and forth, 250 px': 0, 'diagonal, 250 px': 8, 'fast short presses, 120 ms': 7 },
	'3': { 'one direction, 250 px': 4, 'back and forth, 250 px': 0, 'diagonal, 250 px': 2, 'fast short presses, 120 ms': 2 },
	range: { 'one direction, 250 px': 0, 'back and forth, 250 px': 0, 'diagonal, 250 px': 0, 'fast short presses, 120 ms': 0 },
};

/** Of those, the writes at a lift: only 0.5 in one direction has any. */
const AT_LIFT: Partial<Record<string, Partial<Record<Gesture, number>>>> = { '0.5': { 'one direction, 250 px': 5 } };

describe('replay of many fast one-finger presses at 390 × 844 on the 1,000-person tree', () => {
	it('the pans of the replay stay inside the pan limits and inside the range cap, so the range budget of 0 is fair', () => {
		const lim = panLimits(BOUNDS, 1, SIZE);
		expect(START.cx + 20 * 250).toBeLessThan(lim.x1);
		expect(20 * 250).toBeLessThan(RANGE_CAP_PX);
	});

	for (const rule of [0.5, 1, 3, 'range'] as const) {
		for (const g of Object.keys(GESTURES) as Gesture[]) {
			const lift = AT_LIFT[String(rule)]?.[g] ?? 0;
			it(`${rule}, ${g}: ${BUDGET[String(rule)][g]} <g> writes in 20 presses (${lift} at a lift), never two in the moves of one press, and the screen shows the view`, () => {
				const { counts, r } = replay(rule, GESTURES[g]);
				expect(total(counts)).toBe(BUDGET[String(rule)][g]);
				expect(counts.reduce((s, c) => s + c.lift, 0)).toBe(lift);
				expect(Math.max(...counts.map((c) => c.during))).toBeLessThanOrEqual(1);
				if (rule === 'range') expect(counts.every((c) => c.first === 0)).toBe(true);
				showsView(r, SIZE);
			});
		}
	}

	it('the release rule is range, so a release drag writes no <g> in any of the four gestures: 0 writes in 20 presses each, none at a first move or a lift', () => {
		expect(DRAG_MARGIN).toBe('range');
		for (const g of Object.keys(GESTURES) as Gesture[]) {
			const { counts, r } = replay(null, GESTURES[g]);
			expect([g, total(counts)]).toEqual([g, 0]);
			expect(counts.every((c) => c.during === 0 && c.first === 0 && c.lift === 0)).toBe(true);
			showsView(r, SIZE);
		}
	});

	it('range: a press after a held lift writes nothing at its first move, also after 20 presses in one direction', () => {
		const { counts, r } = replay('range', GESTURES['one direction, 250 px']);
		expect(counts.map((c) => c.first)).toEqual(new Array(20).fill(0));
		expect(r.pz.view!.cx).toBeCloseTo(START.cx + 5000, 6);
	});

	it('range: one direction past the cap writes one fill for each cap of travel, and none at a lift', () => {
		const { counts } = replay('range', times(40, { dx: -250, dy: 0, moves: 10 }));
		// 40 × 250 = 10,000 px: the picture of the start reaches RANGE_CAP_PX to the right, so one fill comes after it.
		expect(total(counts)).toBe(1);
		expect(counts.every((c) => c.lift === 0)).toBe(true);
	});
});
