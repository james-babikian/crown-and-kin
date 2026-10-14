import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { TreeView, type OpenTime } from '../src/obsidian/tree-view';
import type { RenderTiming } from '../src/render/tree-info';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, runFrame, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, fakeHost } from './acceptance/tree-view-fakes';

// G2b scratch proofs (WP-K second G2): the two ends of the open rules in tree-view.ts.

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

function make(host: ReturnType<typeof setup>) {
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
	return { el, view: new TreeView(host as never, el as unknown as HTMLElement, SOURCE, { kind: 'embed', ctx } as never) };
}

async function call(host: ReturnType<typeof setup>) {
	const { el, view } = make(host);
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
