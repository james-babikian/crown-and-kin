import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import * as generations from '../src/core/generations';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { FIRST_LIMIT, SECOND_LIMIT, clearStops } from '../src/obsidian/large-tree';
import { TreeView } from '../src/obsidian/tree-view';
import { clearLayoutCache } from '../src/layout/index';
import { FEl, clock, dispatch, flushFrames, installDom, resetDom, resizeAll, settle, fakeWin } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

// G2 review of WP-G (branch r030/g-large-tree). Every test below FAILS on that branch and shows one defect. The helpers are those of tests/r030-g-large-tree.test.ts.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearLayoutCache();
	clearStops();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const flat = (n: number, options = ''): string => `${options ? `options:\n${options}` : ''}people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;
const bar = (root: FEl) => root.querySelector('.dynasty-large-bar');
const drawBtn = (root: FEl) => root.querySelector('.dynasty-large-draw');
const treeDrawn = (root: FEl) => !!root.querySelector('.dynasty-scene');
const click = (el: FEl, detail = 1) => dispatch(el, 'click', { button: 0, clientX: 10, clientY: 10, detail });

function sized(root: FEl): void {
	const vp = root.querySelector('.dynasty-viewport');
	if (vp && !vp.clientWidth) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	flushFrames();
}

async function afterTap(root: FEl): Promise<void> {
	flushFrames();
	await settle();
	sized(root);
}

async function mount(source: string, o: { host?: Host; handle?: FakeHandle | null } = {}) {
	const host = o.host ?? fakeHost();
	const handle = o.handle ?? null;
	const registry: Record<string, () => unknown> = handle
		? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false }
		: { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	const el = new FEl('div');
	const info = { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	sized(el);
	return { el, view, host };
}

// G2 review of WP-G: each test below must FAIL on r030/g-large-tree and shows one defect.

describe('G2-1: the bar has no aria-label (Obsidian shows it as a tooltip on hover)', () => {
	it('a bar named by its text (aria-labelledby), never by an aria-label', async () => {
		desktop();
		const { el } = await mount(flat(FIRST_LIMIT + 1), { handle: fakeHandle('n.md', flat(FIRST_LIMIT + 1)) });
		expect(bar(el)!.getAttribute('aria-label')).toBeNull();
		expect(bar(el)!.getAttribute('aria-labelledby')).toBeTruthy();
	});
});

describe('G2-2: the 15 s budget must not count the wait for the two frames after the tap', () => {
	it('a tap, then a page that was hidden for 20 s before its frames ran, still draws the tree', async () => {
		desktop();
		const source = flat(FIRST_LIMIT + 1);
		const first = await mount(source, { handle: fakeHandle('n.md', source) });
		click(drawBtn(first.el)!);
		// The page goes to the background (a phone locks, a tab is hidden): `requestAnimationFrame` does not run. It runs again 20 s later.
		clock.now += 20_000;
		const gen = vi.spyOn(generations, 'computeGenerations');
		await afterTap(first.el);
		expect(gen).toHaveBeenCalled();
		expect(treeDrawn(first.el)).toBe(true);
	});
});

describe('G2-3: a retired view (the plugin is turned off) has a dead button that says the tree is being drawn', () => {
	it('a tap on "Draw the tree" of a retired view shows no "draws the tree now" text and does not set the memory', async () => {
		desktop();
		const source = flat(FIRST_LIMIT + 1);
		const handle = fakeHandle('n.md', source);
		const e = await mount(source, { handle });
		e.view.retire();
		const b = drawBtn(e.el);
		expect(b).not.toBeNull();
		click(b!);
		flushFrames();
		await settle();
		// The tree can never draw (the view is unloaded), so the page must not claim that it does.
		expect(e.el.querySelector('.dynasty-large-live')?.getText() ?? '').toBe('');
		expect(handle.state.largeTapped).toBeUndefined();
	});
});

describe('G2-4: a pin with a large `generations` draws a whole very large tree: no bar, no time budget', () => {
	/** One person with `k` children and `generations: 2`: the "focus family" is the whole tree. */
	const star = (k: number): string => `options:\n  focus: r\n  generations: 2\npeople:\n  - {id: r, name: R}\n${Array.from({ length: k }, (_, i) => `  - {id: c${i}, name: C${i}, parents: [r]}`).join('\n')}\n`;

	it('5 100 people all inside the family of the pinned person: the second limit still holds', async () => {
		desktop();
		const source = star(SECOND_LIMIT + 100);
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(treeDrawn(el)).toBe(false);
		expect(bar(el)!.getAttribute('data-dynasty-large')).toBe('top');
	});
});
