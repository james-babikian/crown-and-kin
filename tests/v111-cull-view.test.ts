import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FILL_ALL_EVENT } from '../src/render/dom/scene';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { block15 } from './acceptance/m10-support';
import { desktop, embed, fakeHandle, fullViews, phone } from './acceptance/tree-view-fakes';

/*
 * 0.2.1 WP4 (spec §13.15 rule 4): the tree view builds the lines and partnership signs of a big tree when they come
 * near the view: the first view has the near ones only, the idle chain builds the rest together with the cards, the
 * harness event builds all, and a focus on a far card builds the lines that touch it. The scene itself is tested in
 * `v111-cull-scene`, the cards in `m11-tree-view-lazy`.
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
	(globalThis as Record<string, unknown>).requestIdleCallback = (fn: Idle) => idle.push(fn);
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	delete (globalThis as Record<string, unknown>).requestIdleCallback;
	vi.restoreAllMocks();
});

const SOURCE = block15(0);
const LINES = 'data-dynasty-lines-pending';

interface Fill {
	pending: number;
	pendingLines: number;
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
const drawn = (el: FEl) => el.querySelectorAll('.dynasty-line').length + (el.querySelector('.dynasty-markers')?.children.length ?? 0);

describe('the tree view builds the lines near the view first (rule 4)', () => {
	it('the first view has some of the lines; the root counts the rest', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const left = fill(view).pendingLines;
		expect(left).toBeGreaterThan(0);
		expect(drawn(el)).toBeGreaterThan(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(LINES)).toBe(String(left));
	});

	it('the harness event builds everything: the root says 0 and the drawn count is the whole', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const before = drawn(el);
		const left = fill(view).pendingLines;
		dispatch(el.querySelector('.dynasty-root')!, FILL_ALL_EVENT);
		expect(fill(view).pendingLines).toBe(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(LINES)).toBe('0');
		expect(drawn(el)).toBeGreaterThan(before);
		expect(drawn(el) - before).toBe(left);
	});

	it('the idle chain builds the rest with the cards, and ends with none left', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const start = fill(view).pendingLines;
		let seen = false;
		for (let i = 0; i < 300 && runIdle(); i++) {
			if (fill(view).pending === 0 && fill(view).pendingLines > 0) seen = true;
		}
		expect(start).toBeGreaterThan(0);
		expect(seen).toBe(false);
		expect(fill(view).pendingLines).toBe(0);
		expect(fill(view).pending).toBe(0);
		expect(el.querySelector('.dynasty-root')!.getAttribute(LINES)).toBe('0');
		expect(idle.length).toBe(0);
	});

	it('a focus on a far card builds the lines that touch it', async () => {
		const { view, el } = await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		const shell = el.querySelectorAll('.dynasty-card').find((c) => !contentOf(c))!;
		expect(shell).toBeDefined();
		const before = fill(view).pendingLines;
		dispatch(shell, 'focus');
		expect(contentOf(shell)).toBe(true);
		expect(fill(view).pendingLines).toBeLessThan(before);
	});

	it('a static phone preview starts no idle fill of lines', async () => {
		phone();
		await embed(SOURCE, { handle: fakeHandle('n.md', SOURCE) });
		await run();
		expect(idle.length).toBe(0);
	});
});
