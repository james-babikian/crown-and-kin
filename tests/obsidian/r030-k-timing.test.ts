import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPEN_GAP_MS } from '../../src/obsidian/tree-view';
import { clock, flushFrames } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { PARSE_MS, call, resetTimingWorld, setup } from '../support/open-timing';

// WP-K K.3 (spec §7.7): "Show render timing" reports the wait of the user: from the first call of the code-block processor for a block to the
// first drawn tree they see, across the re-renders of one open, with the parts summed. The fake host here keeps the opens as the plugin does.

useFakeDom({ window: true });

beforeEach(() => resetTimingWorld());

afterEach(() => vi.restoreAllMocks());

describe('K.3: the render timing is the wait of the user', () => {
	it('a first tree that Obsidian replaces before it is seen: the second tree reports the wait from the first call, with the parts of both renders', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		// Obsidian renders the note again before the first frame: the first view and its element go.
		first.view.unload();
		(first.el as unknown as { isConnected: boolean }).isConnected = false;
		// The main thread is busy for 3 s with other work of the note.
		clock.now += 3000;
		await call(host);
		flushFrames();
		const [t1, t2] = host.recorded;
		expect(host.recorded.length).toBe(2);
		// The first render reached no frame the user sees.
		expect(t1.interactiveMs).toBeUndefined();
		expect(t1.parseMs).toBe(PARSE_MS);
		// The second one reports both parses and a clock that started at the first call (10 000), not at its own render.
		expect(t2.parseMs).toBe(2 * PARSE_MS);
		expect(t2.totalMs).toBe(t2.parseMs + t2.layoutMs + t2.drawMs);
		expect(t2.interactiveMs!).toBeGreaterThanOrEqual(PARSE_MS + 3000 + PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 3000 + PARSE_MS + 200);
		// The text of the command has the long wait, not the short render of the cache.
		expect(t2.interactiveMs! - t2.totalMs).toBeGreaterThanOrEqual(3000);
	});

	it('one render and one call: the same numbers as before (the parts are its own, the clock starts at the call)', async () => {
		const host = setup();
		clock.now = 50_000;
		await call(host);
		flushFrames();
		expect(host.recorded.length).toBe(1);
		const [t] = host.recorded;
		expect(t.parseMs).toBe(PARSE_MS);
		expect(t.totalMs).toBe(t.parseMs + t.layoutMs + t.drawMs);
		expect(t.interactiveMs!).toBeGreaterThanOrEqual(t.totalMs);
		expect(t.interactiveMs!).toBeLessThan(t.totalMs + 200);
	});

	it('once a tree was seen, the next call of the processor is a new open: its own parts, its own clock', async () => {
		const host = setup();
		clock.now = 10_000;
		await call(host);
		flushFrames();
		expect(host.opens.size).toBe(0);
		clock.now += 20_000;
		await call(host);
		flushFrames();
		const [, t2] = host.recorded;
		expect(t2.parseMs).toBe(PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});

	it('an open that shows no tree for longer than the gap is not continued by a later call', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		first.view.unload();
		(first.el as unknown as { isConnected: boolean }).isConnected = false;
		clock.now += OPEN_GAP_MS + 5000;
		await call(host);
		flushFrames();
		const t2 = host.recorded[1];
		expect(t2.parseMs).toBe(PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});

	it('a block that does not parse shows no tree: it ends the open, and the next good render starts a new wait', async () => {
		const host = setup();
		clock.now = 10_000;
		await call(host, 'n.md', 'people: [');
		expect(host.recorded.length).toBe(0);
		expect(host.opens.size).toBe(0);
		clock.now += 5000;
		await call(host);
		flushFrames();
		expect(host.recorded[0].interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});

	it('a host with no list of opens (the plugin before WP-K, a unit fake) still reports each render on its own', async () => {
		const host = setup();
		(host as { opens?: unknown }).opens = undefined;
		clock.now = 10_000;
		await call(host);
		flushFrames();
		const [t] = host.recorded;
		expect(t.parseMs).toBe(PARSE_MS);
		expect(t.interactiveMs).toBeDefined();
	});
});
