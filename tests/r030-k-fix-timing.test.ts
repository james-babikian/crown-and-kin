import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { OPEN_GAP_MS, TreeView, type OpenTime } from '../src/obsidian/tree-view';
import type { RenderTiming } from '../src/render/tree-info';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, runFrame, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, fakeHost } from './acceptance/tree-view-fakes';

// WP-K fix round (spec §7.7): the opens of "Show render timing" are cleaned up. A view that goes before it drew anything, a full-screen view
// with a bad text and a tree that Obsidian takes out of the page before it was seen do not leave a wait behind that a later open would add to.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const SOURCE = 'people:\n  - {id: a, name: Ann}\n  - {id: b, name: Bob, parents: [a]}\n';
const PARSE_MS = 700;

function setup() {
	const host = fakeHost() as ReturnType<typeof fakeHost> & { opens: Map<string, OpenTime>; parseCache: unknown; recorded: RenderTiming[] };
	host.opens = new Map();
	host.recorded = [];
	(host as unknown as { recordTiming(t: RenderTiming): void }).recordTiming = (t) => void host.recorded.push(t);
	host.parseCache = {
		get: (_path: string, text: string) => {
			clock.now += PARSE_MS;
			return parseDynasty(text);
		},
	};
	const handle = fakeHandle('n.md', SOURCE);
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
	return host;
}

function make(host: ReturnType<typeof setup>, path = 'n.md', source = SOURCE) {
	const el = new FEl('div');
	const ctx = { sourcePath: path, getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
	return { el, view: new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never) };
}

/** One call of the processor: a view for the block, rendered but with its frames not yet run. */
async function call(host: ReturnType<typeof setup>, path = 'n.md') {
	const { el, view } = make(host, path);
	view.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport');
	if (vp) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	return { el, view };
}

const keys = (host: { opens: Map<string, OpenTime> }) => [...host.opens.keys()];

describe('G2 K.3 fixes: the opens of "Show render timing"', () => {
	it('a view that is unloaded before it drew anything keeps its open for the gap (its wait counts), and a call after the gap sweeps it', async () => {
		const host = setup();
		clock.now = 10_000;
		const { view } = make(host);
		expect(host.opens.size).toBe(1);
		view.unload();
		// 0.3 second G2, finding 2: Obsidian may replace a view that still waits for its start; the next call continues that wait.
		expect(host.opens.size).toBe(1);
		clock.now += 60_000;
		const later = await call(host, 'other.md');
		expect([...host.opens.values()].every((o) => o.start >= 70_000)).toBe(true);
		later.view.unload();
	});

	it('a view that is unloaded before it drew keeps the open when another live view of the block holds it', async () => {
		const host = setup();
		clock.now = 10_000;
		const a = make(host);
		// The second call of the processor takes the pending open of the first.
		const b = await call(host);
		expect(host.opens.size).toBe(1);
		a.view.unload();
		expect(host.opens.size).toBe(1);
		flushFrames();
		expect(host.recorded[0].interactiveMs!).toBeLessThan(PARSE_MS + 200);
		b.view.unload();
	});

	it('an unseen render that is unloaded keeps its parts for a new call within the gap, and the entry goes when a later call comes after the gap', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host, 'a.md');
		first.view.unload();
		(first.el as unknown as { isConnected: boolean }).isConnected = false;
		expect(keys(host).length).toBe(1);
		// Another note is opened after the gap: the old entry is not continued by anyone, so it is taken out.
		clock.now += OPEN_GAP_MS + 1000;
		await call(host, 'b.md');
		expect(keys(host).some((k) => k.startsWith('a.md'))).toBe(false);
		flushFrames();
	});

	it('the gap is 5 s: a reopen 6 s after an unseen render is a new wait', async () => {
		expect(OPEN_GAP_MS).toBe(5000);
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		first.view.unload();
		(first.el as unknown as { isConnected: boolean }).isConnected = false;
		clock.now += 6000;
		await call(host);
		flushFrames();
		const t2 = host.recorded[1];
		expect(t2.parseMs).toBe(PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});

	it('a full-screen view with a text that does not parse closes and leaves no open', async () => {
		const host = setup();
		const closed: (string | null)[] = [];
		const fullHost = { close: (n: string | null) => void closed.push(n), leave: () => {}, target: null, focus: null };
		const from = { key: 'n.md#0', sourcePath: 'n.md', source: 'people: [', handle: null, peeked: null, readOnly: true };
		const el = new FEl('div');
		const view = new TreeView(host as never, el as unknown as HTMLElement, from.source, { kind: 'full', from, host: fullHost } as never);
		expect(host.opens.size).toBe(1);
		view.load();
		await settle();
		expect(closed.length).toBe(1);
		expect(host.opens.size).toBe(0);
	});

	it('a tree that was in the page at its first frame and gone at the second is seen: it reports its time and ends the open', async () => {
		const host = setup();
		clock.now = 10_000;
		const { el, view } = await call(host);
		let connected = true;
		Object.defineProperty(el, 'isConnected', { get: () => connected, configurable: true });
		const seen = () => (view as unknown as { seenTree: boolean }).seenTree;
		for (let i = 0; i < 100 && host.recorded.length === 0; i++) runFrame();
		for (let i = 0; i < 100 && !seen(); i++) {
			runFrame();
			if (seen()) connected = false;
		}
		flushFrames();
		const t = host.recorded[0];
		expect(seen()).toBe(true);
		expect(t.interactiveMs).toBeDefined();
		expect(host.opens.size).toBe(0);
	});

	it('a tree that was never in the page at a frame is not seen: no time is reported and the next call is a new wait', async () => {
		const host = setup();
		clock.now = 10_000;
		const first = await call(host);
		Object.defineProperty(first.el, 'isConnected', { get: () => false, configurable: true });
		flushFrames();
		const t1 = host.recorded[0];
		expect(t1.interactiveMs).toBeUndefined();
		expect(host.opens.size).toBe(0);
		clock.now += 2000;
		await call(host);
		flushFrames();
		const t2 = host.recorded[host.recorded.length - 1];
		expect(t2.parseMs).toBe(PARSE_MS);
		expect(t2.interactiveMs!).toBeLessThan(PARSE_MS + 200);
	});
});
