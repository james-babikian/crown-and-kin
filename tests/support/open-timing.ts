/*
 * The set-up that the four tests of "Show render timing" share (`g2-k-timing`, `g2b-k-timing`, `r030-k-timing`, `r030-k-fix-timing`; spec §7.7):
 * a fake host that keeps the opens as the plugin does, with a parse that takes 700 ms on the fake clock, and a call of the code-block
 * processor for one block. The clock is fixed, so the code under test takes no time of its own.
 */

import { vi } from 'vitest';
import { parseDynasty } from '../../src/core/parse';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView, type OpenTime } from '../../src/obsidian/tree-view';
import type { RenderTiming } from '../../src/render/tree-info';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, fakeHost } from '../acceptance/tree-view-fakes';

export const SOURCE = 'people:\n  - {id: a, name: Ann}\n  - {id: b, name: Bob, parents: [a]}\n';
/** The time the parse takes in the fake (the clock is fixed, so the code under test takes no time of its own). */
export const PARSE_MS = 700;

/** The `beforeEach` of the four tests: a clean fake world, and `performance.now` on the fake clock. */
export function resetTimingWorld(): void {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
}

/** A fake host that keeps the opens and the recorded timings; its parse moves the fake clock by `PARSE_MS`. */
export function setup() {
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

/** A new view for a block, made but not loaded: the call of the code-block processor. */
export function make(host: ReturnType<typeof setup>, path = 'n.md', source = SOURCE) {
	const el = new FEl('div');
	const ctx = { sourcePath: path, getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text: '' }), addChild: () => {} };
	return { el, view: new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never) };
}

/** One call of the processor: a view for the block, rendered but with its frames not yet run. */
export async function call(host: ReturnType<typeof setup>, path = 'n.md', source = SOURCE) {
	const { el, view } = make(host, path, source);
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
