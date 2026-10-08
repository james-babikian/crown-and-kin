import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { parseDynasty } from '../../src/core/parse';
import { createParseCache } from '../../src/core/parse-cache';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle, wheel } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { block15 } from './m10-support';
import { desktop, embed, fakeHandle, fakeHost, fullViews } from './tree-view-fakes';

/* Review of M11 area B (speed work): each test states one defect; they wait for the B1, B2 fixes. Run: npx vitest run tests/acceptance/m11-review-speed.test.ts */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	// Idle time never comes in these tests, so only the near fill counts.
	(globalThis as Record<string, unknown>).requestIdleCallback = () => 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	delete (globalThis as Record<string, unknown>).requestIdleCallback;
	vi.restoreAllMocks();
});

const SOURCE = block15(0);
/** At the Overview level the cards draw no detail and their groups are out of the document (R026 fit), so the level itself says the cards are not empty. */
const contentOf = (card: FEl, overview: boolean) => overview || card.querySelector('.dynasty-card-full') !== null;

interface Internals {
	panZoom: { view: { scale: number; cx: number; cy: number }; size: { w: number; h: number } };
	laid: { layout: { persons: Map<string, { x: number; y: number; w: number; h: number }> } };
}

/** Ids of the cards that meet the visible part of the view and have no content. */
function emptyOnScreen(view: unknown, el: FEl): string[] {
	const { panZoom: pz, laid } = view as Internals;
	const v = pz.view;
	const x0 = v.cx - pz.size.w / 2 / v.scale;
	const x1 = v.cx + pz.size.w / 2 / v.scale;
	const y0 = v.cy - pz.size.h / 2 / v.scale;
	const y1 = v.cy + pz.size.h / 2 / v.scale;
	const out: string[] = [];
	const overview = (view as unknown as { lod: string | null }).lod === 'overview';
	for (const card of el.querySelectorAll('.dynasty-card')) {
		const id = card.getAttribute('data-person')!;
		const b = laid.layout.persons.get(id)!;
		if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0 && !contentOf(card, overview)) out.push(id);
	}
	return out;
}

describe('review M11 B', () => {
	it('sanity: after the first view no card on screen is empty', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		expect(emptyOnScreen(view, el)).toEqual([]);
	});

	it('a Ctrl+wheel zoom out shows cards with content while the wheel turns (no empty card on screen before the 180 ms settle)', async () => {
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		const before = (view as unknown as Internals).panZoom.view.scale;
		for (let i = 0; i < 8; i++) {
			dispatch(vp, 'wheel', { ...wheel(0, 250), ctrlKey: true });
			flushFrames();
		}
		expect((view as unknown as Internals).panZoom.view.scale).toBeLessThan(before);
		// The settle timer (180 ms) has not run: this is what the user sees while the wheel turns.
		expect(emptyOnScreen(view, el)).toEqual([]);
	});

	it('a larger box with the same view fills the cards that now show', async () => {
		const { view, el, vp } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await settle();
		clock.now += 2000;
		flushFrames();
		vp.clientWidth = 2400;
		vp.clientHeight = 1800;
		resizeAll();
		flushFrames();
		expect(emptyOnScreen(view, el)).toEqual([]);
	});
});

describe('review M11 B: parse cache', () => {
	it('a render leaves the cached tree equal to a fresh parse', async () => {
		const host = fakeHost();
		const cache = createParseCache();
		(host as unknown as { parseCache: unknown }).parseCache = cache;
		await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE), host });
		expect(cache.get('n.md', SOURCE)).toEqual(parseDynasty(SOURCE));
	});

});

