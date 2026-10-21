import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { TreeView, type OpenTime } from '../src/obsidian/tree-view';
import { clearRelationCache } from '../src/view/relation-cache';
import type { RenderTiming } from '../src/render/tree-info';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, fakeHost } from './acceptance/tree-view-fakes';

// WP-K K.3 (spec §7.7): "Show render timing" reports the wait of the user: from the first call of the code-block processor for a block to the
// first drawn tree they see, across the re-renders of one open, with the parts summed. The fake host here keeps the opens as the plugin does.

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
/** The time the parse takes in the fake (the clock is fixed, so the code under test takes no time of its own). */
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
	return { host, handle };
}

/** One call of the code-block processor: a new view for the block, rendered but with its frames not yet run. */
async function call(host: ReturnType<typeof setup>['host'], source = SOURCE) {
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
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

describe('G2 K.3', () => {
	it('a view that is closed before it drew anything does not make the next open of the block (30 s later) look 30 s slow', async () => {
		const { host } = setup();
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
		const { host } = setup();
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
