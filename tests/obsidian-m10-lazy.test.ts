import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { block15, comments15 } from './acceptance/m10-support';
import { desktop, embed, fakeHandle, fullViews } from './acceptance/tree-view-fakes';

/*
 * M10 speed fix: an open fold control is first an empty shell (group, Tab stop, name) and gets its
 * drawing and tap area near the view at settle, on focus, and in idle chunks. Signs stay eager.
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

const F = comments15();
const SOURCE = block15(0);
const key = (name: string) => F.folds.get(name)!.key;
const handleWith = (...names: string[]) => {
	const handle = fakeHandle('n.md', SOURCE);
	const set = (handle.state as { folds: Set<string> }).folds;
	set.clear();
	for (const n of names) set.add(key(n));
	return handle;
};
interface Ref {
	control: { key: string; folded: boolean; spot: { x: number; y: number } };
	el: FEl;
	hit?: FEl;
	filled: boolean;
	mark: { x: number; y: number; w: number; h: number };
}
const scene = (view: unknown) => (view as { scene: { folds: Ref[] } }).scene.folds;
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};
const runIdle = () => {
	// One chunk with little time left still fills at least one control.
	const fn = idle.shift();
	fn?.({ timeRemaining: () => 0 });
	return !!fn;
};

describe('lazy fold controls in the tree view', () => {
	it('an open control is a shell with its Tab stop and name; a sign is complete', async () => {
		const { view, el } = await embed(SOURCE, { handle: handleWith('A') });
		const refs = scene(view);
		const open = refs.filter((r) => !r.control.folded);
		const signs = refs.filter((r) => r.control.folded);
		expect(open.length).toBeGreaterThan(5);
		expect(signs.length).toBeGreaterThan(0);
		for (const r of signs) {
			expect(r.filled).toBe(true);
			expect(r.hit).toBeDefined();
			expect(r.el.querySelector('.dynasty-fold-text')).not.toBeNull();
		}
		for (const r of refs) {
			expect(r.el.getAttribute('tabindex')).toBe('0');
			expect(r.el.getAttribute('role')).toBe('button');
			expect(r.el.getAttribute('aria-label')).toBeTruthy();
		}
		// Every control is in the note, and the tab order is the order of the shells.
		expect(el.querySelectorAll('.dynasty-fold').length).toBe(refs.length);
	});

	it('the controls near the view are filled at settle, with their tap areas placed', async () => {
		const { view, el } = await embed(SOURCE, { handle: handleWith() });
		await run();
		const filled = scene(view).filter((r) => r.filled);
		expect(filled.length).toBeGreaterThan(0);
		for (const r of filled) {
			expect(el.querySelectorAll('.dynasty-fold-hit').length).toBeGreaterThan(0);
			expect(r.hit).toBeDefined();
			expect(Number(r.hit!.getAttribute('width'))).toBeGreaterThan(0);
		}
	});

	it('a focus on a shell fills it before the view moves to it', async () => {
		const { view } = await embed(SOURCE, { handle: handleWith() });
		await run();
		const shell = scene(view).find((r) => !r.filled);
		if (!shell) return; // every control was near the view: nothing to test
		expect(shell.el.querySelector('.dynasty-fold-button')).toBeNull();
		dispatch(shell.el, 'focus');
		expect(shell.filled).toBe(true);
		expect(shell.el.querySelector('.dynasty-fold-button')).not.toBeNull();
		expect(shell.el.querySelector('.dynasty-fold-minus')).not.toBeNull();
		expect(shell.el.querySelector('title')).not.toBeNull();
		expect(shell.hit).toBeDefined();
	});

	it('the idle chunks fill every control, and a press on a filled control still folds', async () => {
		const handle = handleWith();
		const { view, el } = await embed(SOURCE, { handle });
		await run();
		for (let i = 0; i < 500 && runIdle(); i++);
		const refs = scene(view);
		expect(refs.every((r) => r.filled)).toBe(true);
		expect(el.querySelectorAll('.dynasty-fold-hit').length).toBe(refs.length);
		const open = refs.find((r) => !r.control.folded)!;
		dispatch(open.hit!, 'click', { button: 0 });
		await run();
		expect(el.querySelector('.dynasty-fold.is-folded')).not.toBeNull();
	});

	it('a redraw starts no second idle chain and old chains stop at the old scene', async () => {
		const handle = handleWith();
		const { view } = await embed(SOURCE, { handle });
		await run();
		const first = idle.length;
		expect(first).toBeLessThanOrEqual(1);
		const old = scene(view);
		dispatch(old.find((r) => !r.control.folded)!.el, 'click', { button: 0 });
		await run();
		const now = scene(view);
		expect(now).not.toBe(old);
		expect(idle.length).toBeLessThanOrEqual(2);
		while (runIdle());
		expect(old.some((r) => !r.filled)).toBe(true);
		expect(now.every((r) => r.filled)).toBe(true);
	});
});
