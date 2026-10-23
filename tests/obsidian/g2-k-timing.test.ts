import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, flushFrames } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
import { PARSE_MS, SOURCE, call, resetTimingWorld, setup } from '../support/open-timing';

// WP-K K.3 (spec §7.7): "Show render timing" reports the wait of the user: from the first call of the code-block processor for a block to the
// first drawn tree they see, across the re-renders of one open, with the parts summed. The fake host here keeps the opens as the plugin does.

useFakeDom({ window: true });

beforeEach(() => resetTimingWorld());

afterEach(() => vi.restoreAllMocks());

describe('G2 K.3', () => {
	it('a view that is closed before it drew anything does not make the next open of the block (30 s later) look 30 s slow', async () => {
		const host = setup();
		clock.now = 10_000;
		// The processor runs, the user leaves the note at once: the view is unloaded before its first render.
		const el0 = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
		const gone = new TreeView(host as never, el0 as unknown as HTMLElement, SOURCE, { kind: 'embed', ctx } as never);
		gone.unload();
		// 30 s later the user opens the note again; the tree shows in well under a second.
		clock.now += 30_000;
		await call(host);
		flushFrames();
		const t = host.recorded[0];
		console.log('ready after', t.interactiveMs, 'ms; parse', t.parseMs, 'ms');
		expect(t.interactiveMs!).toBeLessThan(PARSE_MS + 1000);
	});

	it('a first tree that was replaced before it was seen: a user who opens the note again 30 s later has a new wait', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		first.view.unload();
		(first.el as unknown as { isConnected: boolean }).isConnected = false;
		clock.now += 30_000;
		await call(host);
		flushFrames();
		const t2 = host.recorded[1];
		console.log('ready after', t2.interactiveMs, 'parse', t2.parseMs);
		expect(t2.parseMs).toBe(PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 1000);
	});
});
