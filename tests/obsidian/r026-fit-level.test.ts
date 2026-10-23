// 0.2.6 WP3 "fit": the tree view takes the card detail out of the document at the Overview level and brings it back near the view, then everywhere in
// idle time, when the level changes again (see r026-fit-detail.test.ts for the scene). The fake DOM stands in for the browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEl, clock, dispatch, flushFrames, resetDom, runTimers, settle, wheel } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { block15 } from '../acceptance/m10-support';
import { desktop, embed, fakeHandle, fullViews } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true, css: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	delete (window as unknown as Record<string, unknown>).requestIdleCallback;
	vi.restoreAllMocks();
});

const SOURCE = block15(0);
const bodies = (el: FEl) => el.querySelectorAll('.dynasty-card-body').length;
const cards = (el: FEl) => el.querySelectorAll('.dynasty-card').length;
/** The settle of a wheel zoom is a timer of the fake window. */
const afterWheel = () => {
	clock.now += 1000;
	runTimers();
	flushFrames();
};
const lodOf = (view: unknown) => (view as { lod: string | null }).lod;

/** Turns the wheel (Ctrl, so it zooms) until the level is `want`; false if it never comes. */
function zoomTo(view: unknown, vp: FEl, want: string, dy: number): boolean {
	for (let i = 0; i < 40 && lodOf(view) !== want; i++) {
		dispatch(vp, 'wheel', { ...wheel(0, dy), ctrlKey: true });
		flushFrames();
	}
	return lodOf(view) === want;
}

describe('R026 fit: the card detail at the level of detail', () => {
	it('a zoom out to the Overview level takes every body group out of the document, a zoom in brings them back near the view first and all in idle time', async () => {
		let idle: ((d: { timeRemaining(): number }) => void)[] = [];
		(window as unknown as Record<string, unknown>).requestIdleCallback = (fn: (d: { timeRemaining(): number }) => void) => {
			idle.push(fn);
			return idle.length;
		};
		// The chain starts two frames after a settle, so frames and idle callbacks alternate for a fixed number of rounds.
		const runIdle = () => {
			for (let i = 0; i < 80; i++) {
				flushFrames();
				const todo = idle;
				idle = [];
				for (const fn of todo) fn({ timeRemaining: () => 50 });
			}
		};
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		runIdle();
		const n = cards(el);
		expect(n).toBeGreaterThan(10);
		expect(bodies(el)).toBe(n);
		expect(zoomTo(view, vp, 'overview', 250)).toBe(true);
		afterWheel();
		clock.now += 2000;
		flushFrames();
		runIdle();
		expect(bodies(el)).toBe(0);
		// The cards are still there with their bg rect: a press on a card at the Overview level still hits it.
		expect(cards(el)).toBe(n);
		expect(el.querySelectorAll('.dynasty-card-bg').length).toBe(n);
		expect(zoomTo(view, vp, 'full', -250)).toBe(true);
		// Just after the zoom the cards near the view are back and the rest wait for the idle chain.
		expect(bodies(el)).toBeGreaterThan(0);
		expect(bodies(el)).toBeLessThan(n);
		afterWheel();
		clock.now += 2000;
		flushFrames();
		runIdle();
		expect(bodies(el)).toBe(n);
		expect(lodOf(view)).toBe('full');
	});

	it('a card that is asked for at the Overview level (the sheet, the focus) does not put its group back until the level changes', async () => {
		(window as unknown as Record<string, unknown>).requestIdleCallback = () => 0;
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		expect(zoomTo(view, vp, 'overview', 250)).toBe(true);
		afterWheel();
		(view as unknown as { fillPerson(id: string): void }).fillPerson(el.querySelector('.dynasty-card')!.getAttribute('data-person')!);
		(view as unknown as { scene: { fill: { fillAll(): number } } }).scene.fill.fillAll();
		expect(bodies(el)).toBe(0);
	});
});
