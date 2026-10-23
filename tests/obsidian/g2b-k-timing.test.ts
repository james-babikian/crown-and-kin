import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clock, flushFrames, runFrame } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { PARSE_MS, call, make, resetTimingWorld, setup } from '../support/open-timing';

// G2b scratch proofs (WP-K second G2): the two ends of the open rules in tree-view.ts.

useFakeDom({ window: true });
beforeEach(() => resetTimingWorld());
afterEach(() => vi.restoreAllMocks());

describe('G2b K.3', () => {
	it('a view replaced by Obsidian while it waits for its start (no render yet) must not lose that wait: the next call continues the open', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = make(host); // the first call of the processor; the view waits for the styles and the settings
		clock.now += 1500;
		first.view.unload(); // Obsidian renders the note again
		await call(host);
		flushFrames();
		const t = host.recorded[host.recorded.length - 1];
		// Spec §7.7 / contract C.9 K.3: from the first call of the processor to the first drawn tree. 1500 ms of waiting + the render.
		expect(t.interactiveMs!).toBeGreaterThanOrEqual(1500 + PARSE_MS);
	});

	it('a tree that was seen at its first frame and is unloaded before the second frame does not add the idle time to the next open 4 s later', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		const seen = () => (first.view as unknown as { seenTree: boolean }).seenTree;
		for (let i = 0; i < 100 && !seen(); i++) runFrame();
		expect(seen()).toBe(true);
		first.view.unload();
		clock.now += 4000; // the user looked at the tree for 4 s
		await call(host);
		flushFrames();
		const t2 = host.recorded[host.recorded.length - 1];
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});
});
