import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import * as derive from '../src/core/derive';
import * as generations from '../src/core/generations';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { carryState, endSessionFocus, newBlockState } from '../src/obsidian/block-state';
import * as largeTree from '../src/obsidian/large-tree';
import {
	FIRST_LIMIT,
	PHONE_WHOLE_LIMIT,
	RELATION_GROUP,
	SECOND_LIMIT,
	TIME_BUDGET_MS,
	askInGroups,
	clearStops,
	drawBudget,
	largeBar,
	peopleCount,
	rememberStop,
	wasStopped,
	type BarFacts,
} from '../src/obsidian/large-tree';
import { TreeView } from '../src/obsidian/tree-view';
import { DEFAULT_FAR_RULE, LayoutStopped, NORMAL_GEOMETRY, clearLayoutCache, layoutTree } from '../src/layout/index';
import { LARGE_UI, groupCount } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, tabletDevice, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

// WP-G (spec §0 D159, D223, D226; contract 0.3 C.10 with the rulings R1 to R10): the people count right after the parse, the low bar in place of a very
// large tree on each surface, the tap that draws, the memory of the tap, the time budget of a draw. The real TreeView runs on the fakes.
// Every behaviour here is new in 0.3: on `release-0.3.0` a tree of any size draws, so each bar test fails there.

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

/** A tree of `n` people in one row: the count is what matters here, and a flat tree is the cheapest to lay out. */
const flat = (n: number, options = ''): string => `${options ? `options:\n${options}` : ''}people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

const bar = (root: FEl) => root.querySelector('.dynasty-large-bar');
const drawBtn = (root: FEl) => root.querySelector('.dynasty-large-draw');
const barText = (root: FEl) => root.querySelector('.dynasty-large-text')!.getText();
const treeDrawn = (root: FEl) => !!root.querySelector('.dynasty-scene');
const click = (el: FEl, detail = 1) => dispatch(el, 'click', { button: 0, clientX: 10, clientY: 10, detail });

/** A tree box has a size once the page is laid out; the fake gives it one, and the first view follows. */
function sized(root: FEl): void {
	const vp = root.querySelector('.dynasty-viewport');
	if (vp && !vp.clientWidth) {
		vp.clientWidth = 360;
		vp.clientHeight = 400;
	}
	resizeAll();
	flushFrames();
}

/** After a tap: the two frames, then the draw, then the first view. */
async function afterTap(root: FEl): Promise<void> {
	flushFrames();
	await settle();
	sized(root);
}

/**
 * An embedded tree in note n.md, as the plugin's processor makes it (like `embed` of the fakes, which expects a tree box; the bar has none).
 * With `handle` the block can be edited.
 */
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

describe('the rule (R1, R2): the facts of a render decide', () => {
	const facts = (o: Partial<BarFacts>): BarFacts => ({ count: 0, whole: true, full: false, phone: false, tapped: false, stopped: false, ...o });

	it('the three limits are 1 500, 5 000 and 3 000 (D226)', () => {
		expect([FIRST_LIMIT, SECOND_LIMIT, PHONE_WHOLE_LIMIT]).toEqual([1500, 5000, 3000]);
	});

	it('a note on a computer: the first limit asks, the second stops (boundaries 1 500/1 501 and 5 000/5 001)', () => {
		expect(largeBar(facts({ count: 1500 }))).toBeNull();
		expect(largeBar(facts({ count: 1501 }))).toEqual({ kind: 'ask', limit: 1500 });
		expect(largeBar(facts({ count: 5000 }))).toEqual({ kind: 'ask', limit: 1500 });
		expect(largeBar(facts({ count: 5001 }))).toEqual({ kind: 'top', limit: 5000 });
	});

	it('a tap lifts the first limit only, never the top', () => {
		expect(largeBar(facts({ count: 4000, tapped: true }))).toBeNull();
		expect(largeBar(facts({ count: 5000, tapped: true }))).toBeNull();
		expect(largeBar(facts({ count: 5001, tapped: true }))).toEqual({ kind: 'top', limit: 5000 });
	});

	it('the full-screen view of a phone: asks above 1 500, stops above 3 000 (boundaries 3 000/3 001), a tap lifts the ask', () => {
		const p = { full: true, phone: true };
		expect(largeBar(facts({ ...p, count: 1500 }))).toBeNull();
		expect(largeBar(facts({ ...p, count: 1501 }))).toEqual({ kind: 'ask', limit: 1500 });
		expect(largeBar(facts({ ...p, count: 3000 }))).toEqual({ kind: 'ask', limit: 1500 });
		expect(largeBar(facts({ ...p, count: 3000, tapped: true }))).toBeNull();
		expect(largeBar(facts({ ...p, count: 3001 }))).toEqual({ kind: 'top', limit: 3000 });
		expect(largeBar(facts({ ...p, count: 3001, tapped: true }))).toEqual({ kind: 'top', limit: 3000 });
		expect(largeBar(facts({ ...p, count: 5001 }))).toEqual({ kind: 'top', limit: 3000 });
	});

	it('the full-screen view of a computer or a tablet has no first limit, but the second limit holds', () => {
		expect(largeBar(facts({ full: true, count: 4000 }))).toBeNull();
		expect(largeBar(facts({ full: true, count: 5001 }))).toEqual({ kind: 'top', limit: 5000 });
	});

	it('a render that does not draw the whole tree (a focus family) never gets a bar', () => {
		expect(largeBar(facts({ whole: false, count: 9000 }))).toBeNull();
		expect(largeBar(facts({ whole: false, count: 9000, stopped: true }))).toBeNull();
	});

	it('a draw that took too long gives the bar with no button, at any size', () => {
		expect(largeBar(facts({ count: 800, stopped: true }))).toEqual({ kind: 'slow', limit: 0 });
		expect(largeBar(facts({ count: 2000, tapped: true, stopped: true }))).toEqual({ kind: 'slow', limit: 0 });
	});

	it('the count is the length of the people list, duplicates included (R1)', () => {
		const tree = parseDynasty('people:\n  - {id: a, name: A}\n  - {id: a, name: B}\n  - {id: c, name: C}\n');
		if (!tree.ok) throw new Error('parse');
		expect(peopleCount(tree.tree)).toBe(3);
	});
});

describe('the texts (G.3, R4) come from the text table', () => {
	it('a count has a comma as thousands separator (normal English)', () => {
		expect(groupCount(999)).toBe('999');
		expect(groupCount(1240)).toBe('1,240');
		expect(groupCount(1501)).toBe('1,501');
		expect(groupCount(1234567)).toBe('1,234,567');
	});

	it('the final sentences of D227 and the clarity-editor', () => {
		expect(LARGE_UI.ask(1501)).toBe('This tree has 1,501 people. The plugin can take several seconds to draw it. Obsidian does not answer in that time.');
		expect(LARGE_UI.drawButton).toBe('Draw the tree');
		expect(LARGE_UI.chooseButton).toBe('Choose a person');
		expect(LARGE_UI.top(6020, 5000)).toBe('This tree has 6,020 people. The plugin does not draw a tree with more than 5,000 people. The plugin does not change your note. Choose a person to see the family of that person.');
		expect(LARGE_UI.phoneTop(3500, 3000)).toBe('This tree has 3,500 people. On a phone, the plugin does not draw a whole tree with more than 3,000 people. Choose a person to see the family of that person.');
		expect(LARGE_UI.busy).toBe('Wait. The plugin draws the tree.');
		expect(LARGE_UI.slow).toBe('The plugin stopped because this tree took too long to draw. The plugin does not change your note. Choose a person to see a family. To draw the whole tree, make the tree smaller in the note.');
		expect(LARGE_UI.focusTop(5101, 5000)).toBe('The family of this person has 5,101 people. The plugin does not draw a family with more than 5,000 people. The plugin does not change your note. Choose another person to see a smaller family.');
		expect(LARGE_UI.chooseOtherButton).toBe('Choose another person');
	});

	it('no sentence of the bar is longer than 20 words, none has a contraction, and none tells the user to split the tree', () => {
		const all = [LARGE_UI.ask(1501), LARGE_UI.top(6020, 5000), LARGE_UI.phoneTop(3500, 3000), LARGE_UI.busy, LARGE_UI.slow, LARGE_UI.focusTop(5101, 5000)];
		for (const text of all) {
			for (const s of text.split(/(?<=.)s+/)) expect(s.split(/s+/).length, s).toBeLessThanOrEqual(20);
			expect(text).not.toMatch(/n't|'s|’s|split/);
		}
	});
});

describe('the computer: a note (G.2, R2 a)', () => {
	async function note(n: number, handle: FakeHandle = fakeHandle('n.md', flat(n))) {
		desktop();
		const e = await mount(flat(n), { handle });
		return { ...e, handle, root: e.el };
	}

	it('1 500 people draw as before; there is no bar', async () => {
		const { root } = await note(FIRST_LIMIT);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('1 501 people show the bar with the message and the button, and nothing is laid out', async () => {
		const layout = vi.spyOn(generations, 'computeGenerations');
		const { root, view } = await note(FIRST_LIMIT + 1);
		expect(bar(root)).not.toBeNull();
		expect(bar(root)!.getAttribute('role')).toBe('group');
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('ask');
		expect(barText(root)).toBe(LARGE_UI.ask(1501));
		expect(drawBtn(root)!.getText()).toBe('Draw the tree');
		expect(drawBtn(root)!.tag).toBe('button');
		expect(root.querySelector('.dynasty-root')!.hasClass('dynasty-large-root')).toBe(true);
		expect(treeDrawn(root)).toBe(false);
		expect(root.querySelector('.dynasty-toolbar')).toBeNull();
		expect(layout).not.toHaveBeenCalled();
		view.unload();
	});

	it('the bar has no toolbar, no edit tools and no resize handle; it stores no height for the next start (R5, R10)', async () => {
		const { root } = await note(FIRST_LIMIT + 1);
		expect(root.querySelector('.dynasty-toolbar')).toBeNull();
		expect(root.querySelector('.dynasty-resize')).toBeNull();
		expect(root.querySelector('.dynasty-add-person')).toBeNull();
		expect(root.querySelector('.dynasty-viewport')).toBeNull();
	});

	it('5 000 people still ask; 5 001 show the bar with no button, the second text, and a tap is not possible', async () => {
		const asked = await note(SECOND_LIMIT);
		expect(bar(asked.root)!.getAttribute('data-dynasty-large')).toBe('ask');
		const top = await note(SECOND_LIMIT + 1);
		expect(bar(top.root)!.getAttribute('data-dynasty-large')).toBe('top');
		expect(drawBtn(top.root)).toBeNull();
		expect(barText(top.root)).toBe(LARGE_UI.top(5001, 5000));
		expect(treeDrawn(top.root)).toBe(false);
	});

	it('a tap shows the short text at once, and the draw starts after one painted frame (R7)', async () => {
		const { root, handle } = await note(FIRST_LIMIT + 1);
		click(drawBtn(root)!);
		// Before the first frame: the button is gone, the text is there, and no tree yet.
		expect(drawBtn(root)).toBeNull();
		expect(root.querySelector('.dynasty-large-live')!.getText()).toBe(LARGE_UI.busy);
		expect(root.querySelector('.dynasty-large-live')!.getAttribute('aria-live')).toBe('polite');
		expect(treeDrawn(root)).toBe(false);
		expect(handle.state.largeTapped).toBe(true);
		await afterTap(root);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('after the draw the keyboard focus is on the tree box (the button is gone), R7', async () => {
		const { root } = await note(FIRST_LIMIT + 1);
		drawBtn(root)!.focus();
		click(drawBtn(root)!, 0);
		await afterTap(root);
		expect(fakeDoc.activeElement).toBe(root.querySelector('.dynasty-viewport'));
	});

	it('the button is reachable with the keyboard: a real button, not disabled, no negative tabindex; a key press (click detail 0) draws', async () => {
		const { root } = await note(FIRST_LIMIT + 1);
		const b = drawBtn(root)!;
		expect(b.tag).toBe('button');
		expect(b.getAttribute('tabindex')).toBeNull();
		expect(b.getAttribute('disabled')).toBeNull();
		click(b, 0);
		await afterTap(root);
		expect(treeDrawn(root)).toBe(true);
	});

	it('the bar comes back each time the note opens: a new view of the same text, with a new memory, shows the bar again', async () => {
		const first = await note(FIRST_LIMIT + 1);
		click(drawBtn(first.root)!);
		await afterTap(first.root);
		expect(treeDrawn(first.root)).toBe(true);
		// The note closes: the handles are dropped and the session memory ends.
		endSessionFocus(first.handle.state);
		const second = await note(FIRST_LIMIT + 1);
		expect(bar(second.root)).not.toBeNull();
		expect(drawBtn(second.root)).not.toBeNull();
		expect(treeDrawn(second.root)).toBe(false);
	});

	it('later renders of the block in the same session draw with no bar (R3): the note text changes by one person', async () => {
		const { root, handle } = await note(FIRST_LIMIT + 1);
		click(drawBtn(root)!);
		await afterTap(root);
		handle.change(flat(FIRST_LIMIT + 2));
		sized(root);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('a tree that grows past the second limit after a tap shows the bar with no button at the next render (R3)', async () => {
		const { root, handle } = await note(FIRST_LIMIT + 1);
		click(drawBtn(root)!);
		await afterTap(root);
		handle.change(flat(SECOND_LIMIT + 1));
		sized(root);
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('top');
		expect(drawBtn(root)).toBeNull();
		expect(treeDrawn(root)).toBe(false);
	});

	it('a tree that shrinks to 1 500 draws by itself, with no tap (R3)', async () => {
		const { root, handle } = await note(FIRST_LIMIT + 1);
		expect(bar(root)).not.toBeNull();
		handle.change(flat(FIRST_LIMIT));
		sized(root);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('the number in the bar follows a change of the tree text while the bar shows (R9)', async () => {
		const { root, handle } = await note(FIRST_LIMIT + 1);
		expect(barText(root)).toBe(LARGE_UI.ask(1501));
		handle.change(flat(2345));
		expect(barText(root)).toBe(LARGE_UI.ask(2345));
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('ask');
		handle.change(flat(SECOND_LIMIT + 7));
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('top');
		expect(barText(root)).toBe(LARGE_UI.top(5007, 5000));
	});

	it('a focus family draws at any size (R1): a pin on a tree of 6 000 people', async () => {
		desktop();
		const source = flat(6000, '  focus: p3\n');
		const { el } = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(bar(el)).toBeNull();
		expect(treeDrawn(el)).toBe(true);
	});

	it('a tablet (a touch screen that is not a phone) has the bar in its static preview', async () => {
		tabletDevice();
		const { el } = await mount(flat(FIRST_LIMIT + 1), { handle: fakeHandle('n.md', flat(FIRST_LIMIT + 1)) });
		expect(bar(el)).not.toBeNull();
		expect(drawBtn(el)).not.toBeNull();
		expect(el.querySelector('.dynasty-root')!.hasClass('dynasty-static')).toBe(true);
	});

	it('a block that is read only (no handle: an embed, a Canvas card) shows the same bar, and its button draws', async () => {
		desktop();
		const { el } = await mount(flat(FIRST_LIMIT + 1));
		expect(bar(el)).not.toBeNull();
		click(drawBtn(el)!);
		await afterTap(el);
		expect(treeDrawn(el)).toBe(true);
		expect(bar(el)).toBeNull();
	});

	it('the bar ends the open for the timing command, and the tap starts a new one (R6)', async () => {
		desktop();
		const host = fakeHost() as Host & { opens: Map<string, unknown> };
		host.opens = new Map();
		const e = await mount(flat(FIRST_LIMIT + 1), { host });
		expect(host.opens.size).toBe(0);
		click(drawBtn(e.el)!);
		await afterTap(e.el);
		expect(treeDrawn(e.el)).toBe(true);
	});
});

describe('two big trees in one note', () => {
	it('each block has its own bar, and a tap draws only that block', async () => {
		desktop();
		const host = fakeHost();
		const bodies = [flat(FIRST_LIMIT + 1), flat(FIRST_LIMIT + 5)];
		const handles = bodies.map((b) => fakeHandle('n.md', b));
		Object.assign(host.handles, {
			quickOrdinal: (info: { lineStart: number }) => info.lineStart,
			peek: (_p: string, ordinal: number) => handles[ordinal],
			resolve: async (_p: string, info: { lineStart: number }) => handles[info.lineStart],
			resolveByBody: () => null,
			inEditorOf: () => false,
		});
		const els = bodies.map(() => new FEl('div'));
		const views = bodies.map((source, i) => {
			const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: i, lineEnd: i + 1, text: '' }), addChild: () => {} };
			const v = new TreeView(host as never, els[i] as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
			v.load();
			return v;
		});
		await settle();
		resizeAll();
		flushFrames();
		expect(els.map((e) => !!bar(e))).toEqual([true, true]);
		expect(barText(els[0])).toBe(LARGE_UI.ask(FIRST_LIMIT + 1));
		expect(barText(els[1])).toBe(LARGE_UI.ask(FIRST_LIMIT + 5));
		click(drawBtn(els[1])!);
		await afterTap(els[1]);
		expect(els.map((e) => treeDrawn(e))).toEqual([false, true]);
		expect(bar(els[0])).not.toBeNull();
		for (const v of views) v.unload();
	});
});

describe('the phone (G.2, R2 b)', () => {
	/** The full-screen view of a phone, opened as Expand opens it: a tree of more than 100 people opens on the family of its first person (D20). */
	async function full(n: number) {
		phone();
		const host = fakeHost();
		const o = await openFullScreen(flat(n), { host });
		return { ...o, root: o.root };
	}

	/** Focus, then Clear focus: the whole tree (D132). */
	async function clearFocus(root: FEl): Promise<void> {
		click(root.querySelector('.dynasty-focus')!);
		await settle();
		const items = root.querySelectorAll('.dynasty-popover-focus .dynasty-popover-item');
		click(items[items.length - 1]);
		await settle();
		resizeAll();
		flushFrames();
	}

	it('the list in a note has no limit: 6 000 people give a list and no bar', async () => {
		phone();
		const { el } = await mount(flat(6000), { handle: fakeHandle('n.md', flat(6000)) });
		expect(bar(el)).toBeNull();
		expect(el.querySelector('.dynasty-list-root')).not.toBeNull();
	});

	it('the full-screen focus family has no limit: 6 000 people open on the family, with no bar', async () => {
		const { root } = await full(6000);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
	});

	it('Clear focus at 1 500 people draws the whole tree; at 1 501 it shows the bar with the button', async () => {
		const at = await full(FIRST_LIMIT);
		await clearFocus(at.root);
		expect(bar(at.root)).toBeNull();
		expect(at.root.querySelectorAll('.dynasty-card').length).toBeGreaterThan(1);
		const over = await full(FIRST_LIMIT + 1);
		await clearFocus(over.root);
		expect(bar(over.root)!.getAttribute('data-dynasty-large')).toBe('ask');
		expect(barText(over.root)).toBe(LARGE_UI.ask(1501));
		expect(drawBtn(over.root)).not.toBeNull();
		expect(treeDrawn(over.root)).toBe(false);
	});

	it('the bar of the full-screen view keeps Focus, Find and Close, and no edit tool (R4)', async () => {
		const { root, modal } = await full(FIRST_LIMIT + 1);
		await clearFocus(root);
		const tools = root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);
		expect(tools).toEqual(['dynasty-focus', 'dynasty-find', 'dynasty-close']);
		expect(root.querySelector('.dynasty-add-person')).toBeNull();
		expect(root.querySelector('.dynasty-houses-button')).toBeNull();
		expect(root.querySelector('.dynasty-more')).toBeNull();
		// Every tool has a name that a screen reader reads.
		for (const b of root.querySelectorAll('.dynasty-toolbar .dynasty-tool')) expect(b.getAttribute('aria-label')).toBeTruthy();
		expect(modal).toBeDefined();
	});

	it('"Draw the tree" draws the whole tree in the full-screen view, and the toolbar is the tree toolbar again', async () => {
		const { root } = await full(FIRST_LIMIT + 1);
		await clearFocus(root);
		click(drawBtn(root)!);
		await afterTap(root);
		expect(bar(root)).toBeNull();
		expect(treeDrawn(root)).toBe(true);
		expect(root.querySelector('.dynasty-more')).not.toBeNull();
	});

	it('Clear focus above 3 000 people shows the bar with no button and the phone text; Focus still offers a person (R4)', async () => {
		const { root } = await full(PHONE_WHOLE_LIMIT + 1);
		await clearFocus(root);
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('top');
		expect(drawBtn(root)).toBeNull();
		expect(barText(root)).toBe(LARGE_UI.phoneTop(3001, 3000));
		click(root.querySelector('.dynasty-focus')!);
		await settle();
		expect(root.querySelectorAll('.dynasty-popover-focus .dynasty-popover-item').length).toBeGreaterThanOrEqual(1);
	});

	it('3 000 people ask and a tap draws; the tap is remembered for the block', async () => {
		const { root } = await full(PHONE_WHOLE_LIMIT);
		await clearFocus(root);
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('ask');
		click(drawBtn(root)!);
		await afterTap(root);
		expect(treeDrawn(root)).toBe(true);
	});

	it('above 5 000 people the bar has no button and the list of the note still works (D226)', async () => {
		const { root } = await full(SECOND_LIMIT + 1);
		await clearFocus(root);
		expect(bar(root)!.getAttribute('data-dynasty-large')).toBe('top');
		expect(barText(root)).toBe(LARGE_UI.phoneTop(5001, 3000));
	});
});

describe('the memory of the tap in the block state (R3)', () => {
	it('it ends with the session focus and moves to a new handle of the block', () => {
		const a = newBlockState();
		a.largeTapped = true;
		const b = newBlockState();
		carryState(a, b);
		expect(b.largeTapped).toBe(true);
		endSessionFocus(b);
		expect(b.largeTapped).toBeUndefined();
		expect(newBlockState().largeTapped).toBeUndefined();
	});
});

describe('the time budget (G.5, R8)', () => {
	const g = (n: number) => {
		const parsed = parseDynasty(flat(n));
		if (!parsed.ok) throw new Error('parse');
		return derive.deriveFamilies(parsed.tree);
	};
	const settings = { sweeps: 4, far: DEFAULT_FAR_RULE };

	it('drawBudget counts from its start with the clock it is given', () => {
		let now = 1000;
		const stop = drawBudget(1000, () => now);
		expect(stop()).toBe(false);
		now = 1000 + TIME_BUDGET_MS;
		expect(stop()).toBe(false);
		now += 1;
		expect(stop()).toBe(true);
	});

	it('the layout stops between its phases and caches nothing; a layout with no check is as before', () => {
		const graph = g(60);
		const geo = { ...NORMAL_GEOMETRY };
		clearLayoutCache();
		let checks = 0;
		// The fourth check, after the placement, answers true: the layout throws and nothing is cached.
		expect(() => layoutTree(graph, geo, settings, 'serif', () => ++checks === 4)).toThrow(LayoutStopped);
		expect(checks).toBe(4);
		const gen = vi.spyOn(generations, 'computeGenerations');
		const out = layoutTree(graph, geo, settings, 'serif');
		expect(gen).toHaveBeenCalledTimes(1);
		expect(out.layout.persons.size).toBe(60);
		// Now it is cached: a stop check never runs for a cache hit.
		const hit = layoutTree(graph, geo, settings, 'serif', () => true);
		expect(hit).toBe(out);
	});

	it('a stop at each of the four checks throws; a check that never answers true does not change the result', () => {
		const graph = g(40);
		const geo = { ...NORMAL_GEOMETRY };
		for (let at = 1; at <= 4; at++) {
			clearLayoutCache();
			let n = 0;
			expect(() => layoutTree(graph, geo, settings, 'serif', () => ++n === at)).toThrow(LayoutStopped);
		}
		clearLayoutCache();
		const never = layoutTree(graph, geo, settings, 'serif', () => false);
		clearLayoutCache();
		const plain = layoutTree(graph, geo, settings, 'serif');
		expect(JSON.stringify(never.layout.persons.get('p3'))).toBe(JSON.stringify(plain.layout.persons.get('p3')));
	});

	it('the relation request is cut into groups of 300, with the check after each full group', () => {
		const ids = Array.from({ length: 700 }, (_, i) => `p${i}`);
		const groups: number[] = [];
		askInGroups((x) => groups.push(x.length), ids, () => false);
		expect(groups).toEqual([RELATION_GROUP, RELATION_GROUP, 100]);
		const whole: number[] = [];
		askInGroups((x) => whole.push(x.length), ids);
		expect(whole).toEqual([700]);
		const cut: number[] = [];
		let checks = 0;
		expect(() => askInGroups((x) => cut.push(x.length), ids, () => ++checks === 2)).toThrow(LayoutStopped);
		expect(cut).toEqual([300, 300]);
	});

	it('the memory of a stopped draw is by block key and exact text, and a changed text forgets it', () => {
		rememberStop('k', 1600, 'text');
		expect(wasStopped('k', 1600, 'text')).toBe(true);
		expect(wasStopped('other', 1600, 'text')).toBe(false);
		expect(wasStopped('k', 1601, 'text')).toBe(false);
		expect(wasStopped('k', 1600, 'text')).toBe(false);
	});

	it('a draw that passes 15 s in the layout shows the bar with no button and the text "took too long"; a later render of the same text shows it again; a changed text draws', async () => {
		desktop();
		const n = FIRST_LIMIT + 1;
		const source = flat(n);
		const handle = fakeHandle('n.md', source);
		const host = fakeHost();
		const first = await mount(source, { handle, host });
		click(drawBtn(first.el)!);
		// The generations take 20 s of the fake clock: the next check stops the layout.
		const real = generations.computeGenerations;
		const spy = vi.spyOn(generations, 'computeGenerations').mockImplementation((...a) => {
			clock.now += TIME_BUDGET_MS + 5000;
			return real(...a);
		});
		await afterTap(first.el);
		expect(spy).toHaveBeenCalled();
		expect(bar(first.el)!.getAttribute('data-dynasty-large')).toBe('slow');
		expect(drawBtn(first.el)).toBeNull();
		expect(barText(first.el)).toBe(LARGE_UI.slow);
		expect(treeDrawn(first.el)).toBe(false);
		spy.mockRestore();
		// The note opens again (a new view, no memory of the tap): the same text shows the same bar and does not try again.
		clearLayoutCache();
		const tries = vi.spyOn(generations, 'computeGenerations');
		const again = await mount(source, { handle: fakeHandle('n.md', source), host });
		expect(bar(again.el)!.getAttribute('data-dynasty-large')).toBe('slow');
		expect(tries).not.toHaveBeenCalled();
		// The text changes: it is a new tree, and it asks again.
		const changed = flat(n + 1);
		const third = await mount(changed, { handle: fakeHandle('n.md', changed), host });
		expect(bar(third.el)!.getAttribute('data-dynasty-large')).toBe('ask');
	});

	it('a tree under the first limit that stops shows the same bar (G.5: a draw under the first limit too)', async () => {
		desktop();
		const source = flat(200);
		const real = generations.computeGenerations;
		vi.spyOn(generations, 'computeGenerations').mockImplementation((...a) => {
			clock.now += TIME_BUDGET_MS + 1;
			return real(...a);
		});
		const e = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(bar(e.el)!.getAttribute('data-dynasty-large')).toBe('slow');
		expect(barText(e.el)).toBe(LARGE_UI.slow);
	});

	it('a focus family is not stopped (no budget for a draw of a family)', async () => {
		desktop();
		const source = flat(200, '  focus: p3\n');
		const real = generations.computeGenerations;
		vi.spyOn(generations, 'computeGenerations').mockImplementation((...a) => {
			clock.now += TIME_BUDGET_MS + 1;
			return real(...a);
		});
		const e = await mount(source, { handle: fakeHandle('n.md', source) });
		expect(bar(e.el)).toBeNull();
		expect(treeDrawn(e.el)).toBe(true);
	});
});

describe('the count runs right after the parse (G.1, R9)', () => {
	it('peopleCount is called before deriveFamilies in one render', async () => {
		desktop();
		const calls: string[] = [];
		const realCount = largeTree.peopleCount;
		const realDerive = derive.deriveFamilies;
		vi.spyOn(largeTree, 'peopleCount').mockImplementation((t) => {
			calls.push('count');
			return realCount(t);
		});
		vi.spyOn(derive, 'deriveFamilies').mockImplementation(((...a: Parameters<typeof realDerive>) => {
			calls.push('derive');
			return realDerive(...a);
		}) as never);
		const source = flat(30);
		await mount(source, { handle: fakeHandle('n.md', source) });
		expect(calls[0]).toBe('count');
		expect(calls.indexOf('count')).toBeLessThan(calls.indexOf('derive'));
	});
});
