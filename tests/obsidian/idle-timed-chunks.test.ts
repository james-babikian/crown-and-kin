import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LATER_FALLBACK_MS, TIMED_CHUNK_MS, TIMED_WAIT_MS, later, whenIdle } from '../../src/view/idle';
import { clock, flushFrames, runTimers, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { block15 } from '../acceptance/fold-note-crop-support';
import { desktop, embed, fakeHandle, fullViews } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D353 item 5: where the browser has no idle callback (Safari), a chunk of the idle chain works for a time budget and
 * waits as long as the words queue; with an idle callback (Chromium) the chunks stay fixed counts.
 */

type Idle = (d: { timeRemaining(): number; timed?: boolean }) => void;
const idle: Idle[] = [];
const win = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (window as unknown as Record<string, unknown>)[k as string], set: (_t, k, v) => ((window as unknown as Record<string, unknown>)[k as string] = v, true), deleteProperty: (_t, k) => delete (window as unknown as Record<string, unknown>)[k as string] });

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	idle.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	delete win.requestIdleCallback;
	vi.restoreAllMocks();
});

describe('the plain-timer path of whenIdle', () => {
	it('waits the short time, measures the budget by the clock and marks the budget timed', () => {
		delete win.requestIdleCallback;
		const left: number[] = [];
		let timed: boolean | undefined;
		whenIdle((d) => {
			left.push(d.timeRemaining());
			clock.now += 3;
			left.push(d.timeRemaining());
			clock.now += 100;
			left.push(d.timeRemaining());
			timed = d.timed;
		}, { timeout: 1500, fallbackMs: TIMED_WAIT_MS });
		runTimers(TIMED_WAIT_MS - 1);
		expect(left.length).toBe(0);
		runTimers(1);
		expect(left).toEqual([TIMED_CHUNK_MS, TIMED_CHUNK_MS - 3, 0]);
		expect(timed).toBe(true);
	});

	it('later keeps its 300 ms plain-timer pause for callers that do not draw cards (the vault index on a phone), and the card chain passes the short wait', () => {
		delete win.requestIdleCallback;
		let plain = false;
		let timed = false;
		later(() => (plain = true));
		later(() => (timed = true), TIMED_WAIT_MS);
		runTimers(TIMED_WAIT_MS);
		expect([plain, timed]).toEqual([false, true]);
		runTimers(LATER_FALLBACK_MS - TIMED_WAIT_MS);
		expect(plain).toBe(true);
	});

	it('the Chromium path passes the browser budget on and does not mark it timed', () => {
		let got: Parameters<Idle>[0] | undefined;
		win.requestIdleCallback = (fn: Idle) => fn((got = { timeRemaining: () => 40 }));
		whenIdle(() => undefined, { timeout: 1, fallbackMs: 1 });
		expect(got?.timed).toBeUndefined();
	});
});

describe('the idle chain of a scene on a timed budget', () => {
	const SOURCE = block15(0);
	const fill = (view: unknown) => (view as { scene: { fill: { pending: number } } }).scene.fill;
	const setup = async () => {
		win.requestIdleCallback = (fn: Idle) => idle.push(fn);
		const { view } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		return view;
	};
	/** Runs chunks until a chunk fills cards; gives the cards that chunk took. `cost` is the ms of clock one `timeRemaining` call stands for. */
	const cardChunk = (view: unknown, cost: number) => {
		for (let i = 0; i < 200; i++) {
			const fn = idle.shift();
			if (!fn) return -1;
			const before = fill(view).pending;
			let spent = 0;
			fn({ timed: true, timeRemaining: () => Math.max(0, TIMED_CHUNK_MS - (spent += cost)) });
			if (fill(view).pending !== before) return before - fill(view).pending;
		}
		return -1;
	};

	it('takes more cards when the cards are cheap, fewer when they cost more, and always at least one group', async () => {
		const cheap = await setup();
		const nCheap = cardChunk(cheap, 0.1);
		for (const m of fullViews()) (m as unknown as { close(): void }).close();
		idle.length = 0;
		const dear = await setup();
		const nDear = cardChunk(dear, 2);
		expect(nDear).toBeGreaterThanOrEqual(5);
		expect(nCheap).toBeGreaterThan(nDear);
		expect(nCheap).not.toBe(25);
	});

	it('a timed chunk keeps asking again while a gesture runs, and fills nothing', async () => {
		const view = await setup();
		const before = fill(view).pending;
		const spy = vi.spyOn(view as unknown as { moving(p: unknown): boolean }, 'moving').mockReturnValue(true);
		for (let i = 0; i < 5; i++) idle.shift()?.({ timed: true, timeRemaining: () => 8 });
		expect(fill(view).pending).toBe(before);
		expect(idle.length).toBe(1);
		spy.mockReturnValue(false);
	});

	it('the order of the fills stays: the chain ends with 0 waiting', async () => {
		const view = await setup();
		for (let i = 0; i < 2000 && idle.length; i++) idle.shift()!({ timed: true, timeRemaining: () => 8 });
		expect(fill(view).pending).toBe(0);
	});
});
