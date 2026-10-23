import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The picker answers from a script: the test decides which person the user chooses (or none).
const answers: unknown[] = [];
const asked: unknown[][] = [];
vi.mock('../../src/obsidian/person-picker', () => ({
	pickPerson: async (...a: unknown[]) => {
		asked.push(a);
		return answers.length ? answers.shift() : null;
	},
}));

import * as generations from '../../src/core/generations';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { forgetHeights, lastHeight, rememberHeight } from '../../src/obsidian/block-height';
import { FIRST_LIMIT, PHONE_WHOLE_LIMIT, SECOND_LIMIT, TIME_BUDGET_MS, clearStops, drawnBar } from '../../src/view/large-tree';
import { TreeView } from '../../src/obsidian/tree-view';
import { clearLayoutCache } from '../../src/layout/index';
import { LARGE_UI } from '../../src/render/ui-text';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, type FakeHandle, type Host } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

// WP-G fix round (spec §0 D227 items 2 and 3): the bar that does not draw has the button "Choose a person"; the family of the chosen person shows, and
// the bar shows again if that family passes the top. A focus family above the top shows the bar. The helpers are those of tests/obsidian/r030-g-large-tree.test.ts.

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearLayoutCache();
	clearStops();
	forgetHeights();
	answers.length = 0;
	asked.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;
/** One person r with `k` children: the family of r is the whole tree. */
const star = (k: number, pin = ''): string => `${pin}people:\n  - {id: r, name: R}\n${Array.from({ length: k }, (_, i) => `  - {id: c${i}, name: C${i}, parents: [r]}`).join('\n')}\n`;
const bar = (root: FEl) => root.querySelector('.dynasty-large-bar');
const kind = (root: FEl) => bar(root)?.getAttribute('data-dynasty-large') ?? null;
const chooseBtn = (root: FEl) => root.querySelector('.dynasty-large-choose');
const drawBtn = (root: FEl) => root.querySelector('.dynasty-large-draw');
const barText = (root: FEl) => root.querySelector('.dynasty-large-text')!.getText();
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

/** A tap on "Choose a person", the picker's answer, and the redraw. */
async function choose(root: FEl): Promise<void> {
	click(chooseBtn(root)!);
	await settle();
	flushFrames();
	await settle();
	sized(root);
}

describe('drawnBar: the top holds for the people that a render draws (D227 item 2)', () => {
	it('the second limit on a computer and in a note, the lower top in the full-screen view of a phone', () => {
		expect(drawnBar(SECOND_LIMIT, false, false)).toBeNull();
		expect(drawnBar(SECOND_LIMIT + 1, false, false)).toEqual({ kind: 'top', limit: SECOND_LIMIT });
		expect(drawnBar(PHONE_WHOLE_LIMIT + 1, true, false)).toBeNull();
		expect(drawnBar(PHONE_WHOLE_LIMIT, true, true)).toBeNull();
		expect(drawnBar(PHONE_WHOLE_LIMIT + 1, true, true)).toEqual({ kind: 'top', limit: PHONE_WHOLE_LIMIT });
	});
});

describe('the computer: "Choose a person" on the bar above the second limit', () => {
	it('the button is there, the text names the way on, and the ask bar has no such button', async () => {
		desktop();
		const over = await mount(flat(SECOND_LIMIT + 1), { handle: fakeHandle('n.md', flat(SECOND_LIMIT + 1)) });
		expect(kind(over.el)).toBe('top');
		expect(chooseBtn(over.el)!.getText()).toBe(LARGE_UI.chooseButton);
		expect(barText(over.el)).toBe(LARGE_UI.top(SECOND_LIMIT + 1, SECOND_LIMIT));
		const ask = await mount(flat(FIRST_LIMIT + 1), { handle: fakeHandle('n.md', flat(FIRST_LIMIT + 1)) });
		expect(kind(ask.el)).toBe('ask');
		expect(chooseBtn(ask.el)).toBeNull();
		expect(drawBtn(ask.el)).not.toBeNull();
	});

	it('the picker lists the whole tree, and the family of the chosen person draws in place of the bar; the note is not written', async () => {
		desktop();
		const source = flat(SECOND_LIMIT + 1);
		const handle = fakeHandle('n.md', source);
		const { el, view } = await mount(source, { handle });
		answers.push({ kind: 'person', id: 'p7' });
		await choose(el);
		expect(asked).toHaveLength(1);
		expect(bar(el)).toBeNull();
		expect(treeDrawn(el)).toBe(true);
		expect(el.querySelectorAll('.dynasty-card').length).toBeGreaterThan(0);
		expect((handle as unknown as { writes?: unknown[] }).writes ?? []).toHaveLength(0);
		expect(view).toBeDefined();
	});

	it('no choice (the picker is closed): the bar stays', async () => {
		desktop();
		const source = flat(SECOND_LIMIT + 1);
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		await choose(el);
		expect(asked).toHaveLength(1);
		expect(kind(el)).toBe('top');
		expect(treeDrawn(el)).toBe(false);
	});

	it('a family that itself passes the second limit shows the bar again, with the people of that family', async () => {
		desktop();
		// One person with no relative stands beside the big family.
		const source = `${star(SECOND_LIMIT + 100)}  - {id: z, name: Z}
`;
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(kind(el)).toBe('top');
		answers.push({ kind: 'person', id: 'r' });
		await choose(el);
		expect(kind(el)).toBe('top');
		expect(treeDrawn(el)).toBe(false);
		expect(chooseBtn(el)).not.toBeNull();
		// A person with no relative has a small family: it draws.
		answers.push({ kind: 'person', id: 'z' });
		await choose(el);
		expect(bar(el)).toBeNull();
		expect(treeDrawn(el)).toBe(true);
	});

	it('a pin with a large "generations" on a tree above the second limit shows the bar (the focus family is the whole tree)', async () => {
		desktop();
		const source = star(SECOND_LIMIT + 100, 'options:\n  focus: r\n  generations: 2\n');
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(kind(el)).toBe('top');
		expect(chooseBtn(el)).not.toBeNull();
	});

	it('a retired view: the button opens no picker', async () => {
		desktop();
		const source = flat(SECOND_LIMIT + 1);
		const { el, view } = await mount(source, { handle: fakeHandle('n.md', source) });
		view.retire();
		click(chooseBtn(el)!);
		await settle();
		expect(asked).toHaveLength(0);
	});
});

describe('the bar of a draw that took too long has "Choose a person" (D227 item 3)', () => {
	it('the button is on the bar, and a chosen family draws', async () => {
		desktop();
		const source = flat(FIRST_LIMIT + 1);
		const first = await mount(source, { handle: fakeHandle('n.md', source) });
		const real = generations.computeGenerations;
		vi.spyOn(generations, 'computeGenerations').mockImplementation((...a) => {
			clock.now += TIME_BUDGET_MS + 5000;
			return real(...a);
		});
		click(drawBtn(first.el)!);
		flushFrames();
		await settle();
		sized(first.el);
		expect(kind(first.el)).toBe('slow');
		expect(barText(first.el)).toBe(LARGE_UI.slow);
		expect(chooseBtn(first.el)).not.toBeNull();
		answers.push({ kind: 'person', id: 'p2' });
		await choose(first.el);
		expect(bar(first.el)).toBeNull();
		expect(treeDrawn(first.el)).toBe(true);
	});
});

describe('the phone: "Choose a person" on the bar above the phone top', () => {
	async function full(source: string) {
		phone();
		return openFullScreen(source, { host: fakeHost() });
	}

	async function clearFocus(root: FEl): Promise<void> {
		// D263 B2: while a focus shows, one tap on Focus clears it.
		click(root.querySelector('.dynasty-focus')!);
		await settle();
		resizeAll();
		flushFrames();
	}

	it('above 3 000 people the bar has the button and the phone text; the chosen family draws', async () => {
		const { root } = await full(flat(PHONE_WHOLE_LIMIT + 1));
		await clearFocus(root);
		expect(kind(root)).toBe('top');
		expect(barText(root)).toBe(LARGE_UI.phoneTop(PHONE_WHOLE_LIMIT + 1, PHONE_WHOLE_LIMIT));
		expect(chooseBtn(root)).not.toBeNull();
		answers.push({ kind: 'person', id: 'p9' });
		await choose(root);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('Clear focus after that shows the bar again (the whole tree is above the phone top)', async () => {
		const { root } = await full(flat(PHONE_WHOLE_LIMIT + 1));
		await clearFocus(root);
		answers.push({ kind: 'person', id: 'p9' });
		await choose(root);
		await clearFocus(root);
		expect(kind(root)).toBe('top');
	});

	it('a family above the phone top (between 3 000 and 5 000 people) shows the bar on the phone but draws on a computer', async () => {
		const { root } = await full(star(PHONE_WHOLE_LIMIT + 100));
		await clearFocus(root);
		expect(kind(root)).toBe('top');
		answers.push({ kind: 'person', id: 'r' });
		await choose(root);
		expect(kind(root)).toBe('top');
		desktop();
		const source = star(PHONE_WHOLE_LIMIT + 100);
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(kind(el)).toBe('ask');
	});
});

describe('the remembered height of the note (D227: the note does not jump after a restart)', () => {
	it('the bar forgets the kept height of the block; a drawn tree keeps its own again', async () => {
		desktop();
		const source = flat(SECOND_LIMIT + 1);
		const host = fakeHost();
		const key = `n.md\u0000#0`;
		rememberHeight(host.app as never, key, 420);
		expect(lastHeight(host.app as never, key)).toBe(420);
		await mount(source, { handle: fakeHandle('n.md', source), host });
		expect(lastHeight(host.app as never, key)).toBeNull();
	});
});
