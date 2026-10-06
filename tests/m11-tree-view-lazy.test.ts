import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { createParseCache } from '../src/core/parse-cache';
import { FILL_ALL_EVENT } from '../src/render/dom/scene';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { block15 } from './acceptance/m10-support';
import { TreeView } from '../src/obsidian/tree-view';
import { desktop, embed, fakeHandle, fakeHost, fullViews, tabletDevice } from './acceptance/tree-view-fakes';

/*
 * M11 work package 11.4 (contract S5 to S8): the tree view builds its scene lazily, fills the cards near the
 * first view, the rest in idle chunks, and a card before it gets the focus; the tree is hidden until its first
 * view is written; the read paths share one parse cache. The scene itself is tested in `m11-scene-lazy`.
 */

type Idle = (d: { timeRemaining(): number }) => void;
const idle: Idle[] = [];

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	idle.length = 0;
	// The idle queue is ours, so a test decides when idle time comes.
	(globalThis as Record<string, unknown>).requestIdleCallback = (fn: Idle) => idle.push(fn);
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	delete (globalThis as Record<string, unknown>).requestIdleCallback;
	vi.restoreAllMocks();
});

const SOURCE = block15(0);
const PENDING = 'data-dynasty-cards-pending';

interface Fill {
	pending: number;
	fillAll(): number;
}
const fill = (view: unknown) => (view as { scene: { fill: Fill } }).scene.fill;
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};
const runIdle = () => {
	const fn = idle.shift();
	fn?.({ timeRemaining: () => 0 });
	return !!fn;
};
const contentOf = (card: FEl) => card.querySelector('.dynasty-card-full') !== null;
const cardsOf = (el: FEl) => el.querySelectorAll('.dynasty-card');

describe('the tree view builds lazy cards (S5, S7)', () => {
	it('the first view fills the cards near it and leaves the others as shells; the root counts what waits', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const cards = cardsOf(el);
		const filled = cards.filter(contentOf);
		expect(cards.length).toBeGreaterThan(50);
		expect(filled.length).toBeGreaterThan(0);
		expect(filled.length).toBeLessThan(cards.length);
		const pending = fill(view).pending;
		expect(pending).toBeGreaterThan(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(PENDING)).toBe(String(pending));
		// A shell keeps its Tab stop, name and size.
		const shell = cards.find((c) => !contentOf(c))!;
		expect(shell.getAttribute('tabindex')).toBe('0');
		expect(shell.getAttribute('aria-label')).toBeTruthy();
		expect(shell.querySelector('.dynasty-card-bg')).not.toBeNull();
	});

	it('the tree is hidden until its first view is written, then shown', async () => {
		const host = fakeHost();
		const handle = fakeHandle('n.md', SOURCE);
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 99, text: '' }), addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SOURCE, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		const canvas = el.querySelector('.dynasty-canvas') as unknown as { hidden: boolean };
		// Built and wired, but with no size yet: nothing was drawn, so nothing shows.
		expect(canvas.hidden).toBe(true);
		const vp = el.querySelector('.dynasty-viewport')!;
		vp.clientWidth = 360;
		vp.clientHeight = 400;
		resizeAll();
		flushFrames();
		expect(canvas.hidden).toBe(false);
		expect(el.querySelector('.dynasty-scene')!.getAttribute('transform')).toBeTruthy();
	});

	it('the harness event fills everything at once and the root says 0', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		expect(fill(view).pending).toBeGreaterThan(0);
		dispatch(el.querySelector('.dynasty-root')!, FILL_ALL_EVENT);
		expect(fill(view).pending).toBe(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(PENDING)).toBe('0');
		expect(cardsOf(el).every(contentOf)).toBe(true);
	});

	it('a focus on a shell fills that card before the view moves to it', async () => {
		const { el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const shell = cardsOf(el).find((c) => !contentOf(c))!;
		expect(shell).toBeDefined();
		dispatch(shell, 'focus');
		expect(contentOf(shell)).toBe(true);
	});

	it('the idle chain fills 25 cards at a time, nearest first, until 0 wait; it starts no second chain', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const before = fill(view).pending;
		const filledBefore = cardsOf(el).filter(contentOf).length;
		expect(idle.length).toBe(1);
		// The fold controls go first (and a chunk never mixes the two kinds); the next chunk is 25 cards.
		while (fill(view).pending === before && runIdle());
		expect(fill(view).pending).toBeLessThan(before);
		expect(cardsOf(el).filter(contentOf).length - filledBefore).toBe(25);
		for (let i = 0; i < 200 && runIdle(); i++);
		expect(fill(view).pending).toBe(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(PENDING)).toBe('0');
		expect(idle.length).toBe(0);
	});

	it('a static touch preview (a tablet) starts no idle fill of cards', async () => {
		tabletDevice();
		const { view } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		expect(idle.length).toBe(0);
		expect(fill(view).pending).toBeGreaterThanOrEqual(0);
	});
});

describe('the parse cache (S8)', () => {
	it('the render reads the block through the host cache, and the same text is parsed once', async () => {
		const host = fakeHost();
		const cache = createParseCache({ freeze: true });
		(host as unknown as { parseCache: unknown }).parseCache = cache;
		await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE), host });
		expect(cache.size).toBe(1);
		await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE), host });
		expect(cache.size).toBe(1);
	});
});
