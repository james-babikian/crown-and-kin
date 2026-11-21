import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockViews } from '../../src/obsidian/block-views';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { FINDER_UI, SUCCESSION_UI } from '../../src/render/ui-text';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHost, openFullScreen, phone } from '../acceptance/tree-view-fakes';
import { BODY_16 } from '../support/titles-window-support';
import { noteHandle } from '../support/writing-handle';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The bars of the temporary views as one owned part (review step 11): the relation finder's result bar, the Show view's bar, their Close,
 * the Options menu of the phone and the rules of the line's people. The cases read the view through `peek` (old chain members or the new
 * `view.finder`), so the same cases ran on the code before the move.
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const DUKE = 'duke-of-carrowmere';
const FIRST = 'bertram-carrow';
const SECOND = 'dunstan-carrow';

interface Inside {
	focusDue: string | null;
	finder?: { linePeople(): string[] | null };
	linePeopleNow?(): string[] | null;
	port: unknown;
}
const peek = (v: unknown) => {
	const x = v as Inside;
	return { linePeople: () => (x.finder ? x.finder.linePeople() : x.linePeopleNow!()), focusDue: () => x.focusDue };
};

async function redrawn(): Promise<void> {
	await settle();
	resizeAll();
	flushFrames();
}

async function desk() {
	desktop();
	const handle = noteHandle(BODY_16);
	const e = await embed(BODY_16, { host: fakeHost(), handle });
	return { ...e, handle, root: e.el, st: handle.state };
}

const click = async (root: FEl, sel: string) => {
	dispatch(root.querySelector(sel)!, 'click', { button: 0, detail: 1 });
	await redrawn();
};

describe('the relation finder bar on a computer', () => {
	it('the bar is a group named by its sentence, with Show the steps and Close', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const bar = e.root.querySelector('.dynasty-result')!;
		const text = bar.querySelector('.dynasty-result-text')!;
		expect(bar.getAttribute('role')).toBe('group');
		expect(text.getAttribute('id')).toMatch(/^dynasty-result-\d+$/);
		expect(bar.getAttribute('aria-labelledby')).toBe(text.getAttribute('id'));
		expect(text.getAttribute('role')).toBe('status');
		expect(text.getText().length).toBeGreaterThan(0);
		expect(bar.hasClass('dynasty-result-phone')).toBe(false);
		const close = bar.querySelector('.dynasty-result-close')!;
		expect(close.getText()).toBe(FINDER_UI.close);
		expect(close.getAttribute('aria-label')).toBe(FINDER_UI.closeLabel);
		expect(bar.querySelector('.dynasty-result-steps-button')!.getText()).toBe(FINDER_UI.showSteps);
		// The bar comes before the cards in the Tab order.
		const viewport = e.root.querySelector('.dynasty-viewport')!;
		const kids = viewport.children;
		expect(kids.indexOf(bar as never)).toBeLessThan(kids.indexOf(viewport.querySelector('.dynasty-canvas') as never));
	});

	it('Show the steps changes only the bar: the steps list opens and the tree is not laid out again', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const renders = e.host.renders;
		await click(e.root, '.dynasty-result-steps-button');
		expect(e.st.finder?.steps).toBe(true);
		expect(e.root.querySelector('.dynasty-result-steps-button')!.getText()).toBe(FINDER_UI.hideSteps);
		expect(e.root.querySelector('.dynasty-result-steps-button')!.getAttribute('aria-expanded')).toBe('true');
		expect(e.host.renders).toBe(renders);
	});

	it('Close: the block state loses the result, the focus is asked for More, and the views draw once', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const seen: (string | null)[] = [];
		const redraw = vi.spyOn(BlockViews.prototype, 'finderRedraw').mockImplementation(function (this: BlockViews<never>) {
			seen.push(peek(e.view).focusDue());
		});
		await click(e.root, '.dynasty-result-close');
		expect(e.st.finder).toBeNull();
		expect(redraw).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['.dynasty-more']);
	});

	it('Show in the whole tree changes the result in the block state and asks its button for the focus', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const seen: (string | null)[] = [];
		const redraw = vi.spyOn(BlockViews.prototype, 'finderRedraw').mockImplementation(function () {
			seen.push(peek(e.view).focusDue());
		});
		await click(e.root, '.dynasty-result-whole');
		expect(e.st.finder?.whole).toBe(true);
		expect(redraw).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['.dynasty-result-whole']);
	});

	it('the people the folds must show are the finder line, and none without one', async () => {
		const e = await desk();
		expect(peek(e.view).linePeople()).toBeNull();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const people = peek(e.view).linePeople();
		expect(people).toContain(FIRST);
		expect(people).toContain(SECOND);
	});
});

describe('the Show view bar on a computer', () => {
	it('the bar is a group named by its sentence, with a Close that ends the view and asks the focus for More', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showSuccession(DUKE, e.view);
		await redrawn();
		const bar = e.root.querySelector('.dynasty-succession-bar')!;
		const text = bar.querySelector('.dynasty-succession-text')!;
		expect(bar.getAttribute('role')).toBe('group');
		expect(bar.getAttribute('aria-labelledby')).toBe(text.getAttribute('id'));
		expect(bar.querySelector('.dynasty-succession-close')!.getAttribute('aria-label')).toBe(SUCCESSION_UI.barCloseLabel);
		expect(peek(e.view).linePeople()!.length).toBeGreaterThan(1);
		const seen: (string | null)[] = [];
		const redraw = vi.spyOn(BlockViews.prototype, 'successionRedraw').mockImplementation(function () {
			seen.push(peek(e.view).focusDue());
		});
		await click(e.root, '.dynasty-succession-close');
		expect(e.st.succession).toBeNull();
		expect(redraw).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['.dynasty-more']);
	});

	it('the result bars have different ids, one for each bar made', async () => {
		const e = await desk();
		BlockViews.of(e.host as never, e.st).showFinder(FIRST, SECOND, e.view);
		await redrawn();
		const a = e.root.querySelector('.dynasty-result-text')!.getAttribute('id');
		BlockViews.of(e.host as never, e.st).showSuccession(DUKE, e.view);
		await redrawn();
		const b = e.root.querySelector('.dynasty-succession-text')!.getAttribute('id');
		expect(a).not.toBe(b);
	});
});

describe('the bars on a phone', () => {
	it('the finder bar has Options and an X of at least 44 px tap area; Options opens the actions as rows', async () => {
		phone();
		const o = await openFullScreen(BODY_16);
		const st = o.handle!.state;
		BlockViews.of(o.host as never, st).showFinder(FIRST, SECOND, null);
		await redrawn();
		const root = o.root;
		const bar = root.querySelector('.dynasty-result')!;
		expect(bar.hasClass('dynasty-result-phone')).toBe(true);
		const options = bar.querySelector('.dynasty-result-options')!;
		expect(options.getAttribute('aria-haspopup')).toBe('true');
		expect(options.getAttribute('aria-expanded')).toBe('false');
		const x = bar.querySelector('.dynasty-result-close')!;
		expect(x.hasClass('dynasty-bar-x')).toBe(true);
		expect(x.hasClass('clickable-icon')).toBe(true);
		expect(x.getText()).toBe('');
		expect(x.getAttribute('aria-label')).toBe(FINDER_UI.closeLabel);
		dispatch(options, 'click', { button: 0, detail: 1 });
		await redrawn();
		expect(options.getAttribute('aria-expanded')).toBe('true');
		const rows = root.querySelectorAll('.dynasty-popover-item .dynasty-more-text').map((r) => r.getText());
		expect(rows).toContain(FINDER_UI.showSteps);
		expect(rows).toContain(FINDER_UI.whole);
	});

	it('the Show view bar on a phone has the look and the X of the finder bar', async () => {
		phone();
		const o = await openFullScreen(BODY_16);
		const st = o.handle!.state;
		BlockViews.of(o.host as never, st).showSuccession(DUKE, null);
		await redrawn();
		const bar = o.root.querySelector('.dynasty-succession-bar')!;
		expect(bar.hasClass('dynasty-result-phone')).toBe(true);
		expect(bar.querySelector('.dynasty-succession-close')!.hasClass('dynasty-bar-x')).toBe(true);
	});

	it('a Show view whose title is gone ends when the phone list draws', async () => {
		phone();
		const handle = noteHandle(BODY_16);
		const e = await embed(BODY_16, { host: fakeHost(), handle });
		handle.state.succession = { title: 'no-such-title' };
		BlockViews.of(e.host as never, handle.state).redrawState();
		await redrawn();
		expect(handle.state.succession).toBeNull();
	});
});

describe('the finder bars on their own, with a port of fakes', () => {
	async function made(over: Record<string, unknown> = {}) {
		const { FinderBars } = await import('../../src/obsidian/finder-bars');
		const { newBlockState } = await import('../../src/view/block-state');
		const st = newBlockState();
		const calls: string[] = [];
		const port = {
			view: {},
			host: { app: {}, views: new Set() },
			unloaded: false,
			full: null,
			coarse: false,
			phone: false,
			listMode: false,
			whole: null,
			settings: {},
			meId: null,
			finderDrawn: null,
			successionDrawn: null,
			focusDue: null as string | null,
			ensureState: () => (calls.push('ensureState'), st),
			pickerContext: () => ({}),
			guard: (fn: () => void) => fn(),
			refocusTool: (s: string) => void calls.push(`refocus ${s}`),
			menu: { kind: () => 'desktop', popover: () => null, place: () => ({ opts: {} }), item: () => ({}) },
			...over,
		};
		return { bars: new FinderBars(port as never), port, st, calls };
	}

	it('close ends the result, asks for the focus on More and makes one redraw', async () => {
		const { bars, port, st } = await made();
		st.finder = { first: 'a', second: 'b', index: 0, whole: false, steps: false };
		const redraw = vi.spyOn(BlockViews.prototype, 'finderRedraw').mockImplementation(() => undefined);
		bars.close();
		expect([st.finder, port.focusDue, redraw.mock.calls.length]).toEqual([null, '.dynasty-more', 1]);
	});

	it('closeSuccession asks for More, and for Find in the phone list', async () => {
		const redraw = vi.spyOn(BlockViews.prototype, 'successionRedraw').mockImplementation(() => undefined);
		const a = await made();
		a.st.succession = { title: 't' };
		a.bars.closeSuccession();
		expect([a.st.succession, a.port.focusDue]).toEqual([null, '.dynasty-more']);
		const b = await made({ listMode: true });
		b.bars.closeSuccession();
		expect(b.port.focusDue).toBe('.dynasty-list-find');
		expect(redraw).toHaveBeenCalledTimes(2);
	});

	it('linePeople: the Show view first, then the finder line, else null', async () => {
		expect((await made()).bars.linePeople()).toBeNull();
		expect((await made({ finderDrawn: { line: { people: ['a', 'b'] } } })).bars.linePeople()).toEqual(['a', 'b']);
		expect((await made({ finderDrawn: { line: { people: ['a'] } } })).bars.linePeople()).toEqual(['a']);
		const show = { ruler: 'r', heirs: ['h1'], branches: ['b1'] };
		expect((await made({ successionDrawn: show, finderDrawn: { line: { people: ['a'] } } })).bars.linePeople()).toEqual(['r', 'h1', 'b1']);
	});

	it('showViewFor gives no view and does nothing with no Show view; a gone title ends it', async () => {
		const { bars, st } = await made({ settings: { successionLength: 3, oldAge: 70, youngDeathAge: 5 } });
		const { deriveFamilies } = await import('../../src/core/derive');
		const { parseDynasty } = await import('../../src/core/parse');
		const parsed = parseDynasty('people:\n  - {id: a, name: A}\n');
		if (!parsed.ok) throw new Error('parse');
		const whole = deriveFamilies(parsed.tree);
		expect(bars.showViewFor(st, whole)).toBeNull();
		st.succession = { title: 'gone' };
		expect(bars.showViewFor(st, whole)).toBeNull();
		expect(st.succession).toBeNull();
	});

	it('start does nothing before a tree is known, and a view that is gone makes no call', async () => {
		const a = await made();
		await a.bars.start();
		expect(a.calls).toEqual([]);
		const b = await made({ unloaded: true, whole: {} });
		await b.bars.start();
		expect(b.calls).toEqual([]);
	});
});
