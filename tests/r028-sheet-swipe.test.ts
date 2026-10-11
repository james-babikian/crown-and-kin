import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { DEFAULT_SETTINGS } from '../src/obsidian/settings';
import { SWIPE_SETTLE_MS } from '../src/render/dom/sheet-swipe';
import { FEl, clock, device, dispatch, fakeDoc, flushFrames, installDom, pointer, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHost, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * 0.2.8, D220: the phone sheets (More, Line styles) close with a swipe down. Synthetic pointer events on the fakes: the sheet follows the finger through
 * `--dynasty-sheet-pull`, closes past 100 px, 30 % of its height or a flick faster than 0.5 px/ms, and else moves back.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const TREE = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;

const press = async (root: FEl, sel: string) => {
	dispatch(root.querySelector(sel)!, 'click', { button: 0, detail: 1 });
	await settle();
	resizeAll();
	flushFrames();
};

async function moreSheet(host = fakeHost()) {
	phone();
	const { root } = await openFullScreen(TREE, { host });
	await press(root, '.dynasty-more');
	return { root, sheet: root.querySelector('.dynasty-popover-more')!, opener: root.querySelector('.dynasty-more')! };
}

async function legendSheet() {
	const { root } = await moreSheet();
	await press(root, '.dynasty-more-legend');
	return { root, sheet: root.querySelector('.dynasty-popover-legend')!, opener: root.querySelector('.dynasty-more')! };
}

/** One finger: down at y0, then moves by `dys` (each after `gap` ms), then up. Returns the events so a test can look at them. */
function swipe(target: FEl, dys: number[], o: { type?: 'touch' | 'mouse'; gap?: number; x?: number; y0?: number; hold?: number; id?: number } = {}) {
	const type = o.type ?? 'touch';
	const id = o.id ?? 1;
	const x = o.x ?? 200;
	const y0 = o.y0 ?? 500;
	const at = (dy: number) => pointer(type, id, x, y0 + dy);
	dispatch(target, 'pointerdown', at(0));
	let moves = 0;
	let last = 0;
	for (const dy of dys) {
		clock.now += o.gap ?? 16;
		dispatch(target, 'pointermove', at(dy));
		moves++;
		last = dy;
	}
	clock.now += o.hold ?? 0;
	dispatch(target, 'pointerup', at(last));
	return moves;
}

const pull = (sheet: FEl) => sheet.style.getPropertyValue('--dynasty-sheet-pull');
const steps = (to: number, n = 8) => Array.from({ length: n }, (_, i) => Math.round((to * (i + 1)) / n));

describe('D220: a swipe down closes a phone sheet', () => {
	it('a pull from the grip past 100 px closes the sheet and the cover, and the focus goes back to the opener', async () => {
		const { root, sheet, opener } = await moreSheet();
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(130), { gap: 60 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
		expect(root.querySelector('.dynasty-cover')).toBeNull();
		expect(fakeDoc.activeElement).toBe(opener);
	});

	it('the sheet follows the finger with the pull property, and has the class that makes the transform only while it moves', async () => {
		const { sheet } = await moreSheet();
		expect(sheet.hasClass('is-pulled')).toBe(false);
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		dispatch(grip, 'pointerdown', pointer('touch', 1, 200, 500));
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 540));
		expect(sheet.hasClass('is-pulled')).toBe(true);
		expect(pull(sheet)).toBe('40px');
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 470));
		// Above the start the sheet stays where it is: it never moves up.
		expect(pull(sheet)).toBe('0px');
		expect(sheet.captured.has(1)).toBe(true);
	});

	it('a short slow pull moves the sheet back, and it stays open', async () => {
		const { root, sheet } = await moreSheet();
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(60), { gap: 100, hold: 300 });
		expect(pull(sheet)).toBe('0px');
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(sheet.hasClass('is-settling')).toBe(false);
		expect(pull(sheet)).toBe('');
	});

	it('a pull of more than 30 % of the sheet height closes it, though it is under 100 px', async () => {
		const { root, sheet } = await moreSheet();
		sheet.offsetHeight = 200;
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(70), { gap: 100, hold: 300 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('a fast flick closes the sheet, though the pull is short', async () => {
		const { root, sheet } = await moreSheet();
		// 60 px in 48 ms is 1.25 px/ms.
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(60, 3), { gap: 16 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('a finger that stops before it lifts has no speed: the short pull moves back', async () => {
		const { root, sheet } = await moreSheet();
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(60, 3), { gap: 16, hold: 500 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
	});

	it('closing waits for the move out; with a finger-lift the sheet first goes down', async () => {
		const { root, sheet } = await moreSheet();
		sheet.offsetHeight = 500;
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(130), { gap: 60 });
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
		expect(sheet.hasClass('is-settling')).toBe(true);
		expect(pull(sheet)).toBe('500px');
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('a swipe that starts on the title row of the Line styles sheet closes it', async () => {
		const { root, sheet } = await legendSheet();
		sheet.scrollTop = 120;
		swipe(sheet.querySelector('.dynasty-sheet-head .dynasty-popover-title')!, steps(130), { gap: 60 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
	});

	it('a swipe in the list at its top moves the sheet', async () => {
		const { root, sheet } = await legendSheet();
		sheet.scrollTop = 0;
		swipe(sheet.querySelector('.dynasty-legend-row')!, steps(130), { gap: 60 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
	});

	it('a swipe in a list that is scrolled down is the list\'s: the sheet does not move', async () => {
		const { root, sheet } = await legendSheet();
		sheet.scrollTop = 80;
		const row = sheet.querySelector('.dynasty-legend-row')!;
		dispatch(row, 'pointerdown', pointer('touch', 1, 200, 400));
		for (const dy of steps(200)) {
			clock.now += 16;
			dispatch(row, 'pointermove', pointer('touch', 1, 200, 400 + dy));
			expect(sheet.hasClass('is-pulled')).toBe(false);
		}
		dispatch(row, 'pointerup', pointer('touch', 1, 200, 600));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-legend')).toBe(sheet);
		expect(pull(sheet)).toBe('');
	});

	it('a swipe up or sideways at the top of the list is the list\'s too', async () => {
		const { root, sheet } = await legendSheet();
		const row = sheet.querySelector('.dynasty-legend-row')!;
		swipe(row, steps(-150), { gap: 60 });
		expect(sheet.hasClass('is-pulled')).toBe(false);
		// Sideways: the x moves more than the y.
		dispatch(row, 'pointerdown', pointer('touch', 2, 100, 400));
		dispatch(row, 'pointermove', pointer('touch', 2, 260, 430));
		dispatch(row, 'pointermove', pointer('touch', 2, 300, 700));
		dispatch(row, 'pointerup', pointer('touch', 2, 300, 700));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-legend')).toBe(sheet);
	});

	it('a mouse drag does nothing', async () => {
		const { root, sheet } = await moreSheet();
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(300), { type: 'mouse', gap: 16 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
		expect(sheet.hasClass('is-pulled')).toBe(false);
	});

	it('a tap on a row, or a pull under the slop, is not a swipe', async () => {
		const { sheet } = await moreSheet();
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		swipe(grip, [2, 4], { gap: 16 });
		expect(sheet.hasClass('is-pulled')).toBe(false);
	});

	it('a second finger drops the swipe', async () => {
		const { root, sheet } = await moreSheet();
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		dispatch(grip, 'pointerdown', pointer('touch', 1, 200, 500));
		dispatch(grip, 'pointerdown', pointer('touch', 2, 100, 500, false));
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 700));
		dispatch(grip, 'pointerup', pointer('touch', 1, 200, 700));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
	});

	it('a cancelled touch (the browser took the pan) moves the sheet back and never closes it', async () => {
		const { root, sheet } = await moreSheet();
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		dispatch(grip, 'pointerdown', pointer('touch', 1, 200, 500));
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 700));
		dispatch(grip, 'pointercancel', pointer('touch', 1, 200, 700));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
		expect(sheet.hasClass('is-pulled')).toBe(false);
	});

	it('a swipe that ends on a button does not press it', async () => {
		const { root, sheet } = await legendSheet();
		const close = sheet.querySelector('.dynasty-sheet-close')!;
		// A short pull that starts on Close and snaps back: the click that follows must not close the sheet.
		swipe(close, steps(40), { gap: 100, hold: 300 });
		dispatch(close, 'click', { button: 0, detail: 1 });
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-legend')).toBe(sheet);
		// After a moment a real tap works again.
		runTimers(1000);
		dispatch(close, 'click', { button: 0, detail: 1 });
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
	});

	it('the touchmove of a pull is cancelled so the page does not scroll; a touchmove with no pull is not', async () => {
		const { sheet } = await moreSheet();
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		dispatch(grip, 'pointerdown', pointer('touch', 1, 200, 500));
		expect(dispatch(grip, 'touchmove', { cancelable: true }).defaultPrevented).toBe(false);
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 540));
		expect(dispatch(grip, 'touchmove', { cancelable: true }).defaultPrevented).toBe(true);
	});

	it('Close, a tap on the cover and Escape still work', async () => {
		const a = await legendSheet();
		await press(a.root, '.dynasty-popover-legend .dynasty-sheet-close');
		expect(a.root.querySelector('.dynasty-popover-legend')).toBeNull();
		resetDom();
		const b = await moreSheet();
		dispatch(b.root.querySelector('.dynasty-cover')!, 'click', {});
		expect(b.root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('the plugin setting Reduce movement "On": the sheet closes and moves back at once, with no class for a transition', async () => {
		const host = fakeHost({ ...DEFAULT_SETTINGS, reduceMotion: 'on' });
		const { root, sheet } = await moreSheet(host);
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(60), { gap: 100, hold: 300 });
		expect(sheet.hasClass('is-settling')).toBe(false);
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(root.querySelector('.dynasty-popover-more')).toBe(sheet);
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(130), { gap: 60 });
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('the device setting counts with "Follow the device"; "Off" overrides it', async () => {
		device.reduceMotion = true;
		const a = await moreSheet();
		swipe(a.sheet.querySelector('.dynasty-sheet-grip')!, steps(130), { gap: 60 });
		expect(a.root.querySelector('.dynasty-popover-more')).toBeNull();
		resetDom();
		device.reduceMotion = true;
		const b = await moreSheet(fakeHost({ ...DEFAULT_SETTINGS, reduceMotion: 'off' }));
		swipe(b.sheet.querySelector('.dynasty-sheet-grip')!, steps(130), { gap: 60 });
		expect(b.root.querySelector('.dynasty-popover-more')).toBe(b.sheet);
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(b.root.querySelector('.dynasty-popover-more')).toBeNull();
	});

	it('a sheet that closes in the middle of a move leaves no timer or class behind', async () => {
		const { root, sheet } = await moreSheet();
		const grip = sheet.querySelector('.dynasty-sheet-grip')!;
		dispatch(grip, 'pointerdown', pointer('touch', 1, 200, 500));
		dispatch(grip, 'pointermove', pointer('touch', 1, 200, 560));
		dispatch(root.querySelector('.dynasty-cover')!, 'click', {});
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
		expect(() => runTimers(2000)).not.toThrow();
	});
});
