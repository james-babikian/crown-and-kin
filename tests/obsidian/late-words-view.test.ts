// D352 item 1 (spec §13.1): in a whole tree of `TreeView.lateWordsMin` cards or more, the view asks the relation words of the cards near the
// first view before the first frame and writes the others in idle chunks, never during a pan or a zoom; a new render and the unload stop the
// queue. Once the queue ended, every card has the eager label and content, and the layout does not change. The tests lower the size limit.
// The owner's answer (2026-11-13, "1 Build in 0.5.5"): "the plugin works out the names of the cards near the screen first. It works out the
// other names a moment later, when you do not pan or zoom."
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { relationCallStats } from '../../src/core/relations';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import type { Scene } from '../../src/render/dom/scene';
import { LATE_WORDS_MIN_CARDS } from '../../src/view/late-words';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { FEl, clock, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { serial } from '../acceptance/picture-list-support';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards } from '../acceptance/tree-view-fakes';
import { genModel, toText } from '../support/family-tree-gen';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	desktop();
	TreeView.lateWordsMin = 0;
});

afterEach(() => {
	TreeView.lateWordsMin = LATE_WORDS_MIN_CARDS;
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const N = 120;
const ME = 'p60';
const BODY = toText({ ...genModel(23, { n: N, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: ME } });

type Inside = { scene: Scene; laid: { layout: { persons: Map<string, unknown> } }; showPerson(id: string): void; render(f: null): void };
const inside = (view: TreeView) => view as unknown as Inside;
const cardEls = (el: FEl) => new Map(el.querySelectorAll('.dynasty-card').map((c) => [c.getAttribute('data-person')!, c]));
const labels = (el: FEl) => new Map([...cardEls(el)].map(([id, c]) => [id, c.getAttribute('aria-label')]));
const hasBody = (card: FEl) => card.children.some((c) => c.hasClass('dynasty-card-body'));

/** The tree as today: every word before the first frame. */
async function eagerView() {
	TreeView.lateWordsMin = Infinity;
	clearRelationCache();
	const r = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
	TreeView.lateWordsMin = 0;
	clearRelationCache();
	return r;
}

/** Runs the idle chunks (a timer here: the fake window has no idle callback) until the queue of `scene` ends. */
function runQueue(scene: Scene): void {
	for (let i = 0; scene.words.pending > 0 && i < 200; i++) runTimers(150);
}

describe('late relation words in the tree view (D352 item 1)', () => {
	it('the first view asks only the words of the cards near it; those cards show their words and eager labels in the first frame', async () => {
		const eager = await eagerView();
		const want = labels(eager.el);
		const start = relationCallStats.calls;
		const { el, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const asked = relationCallStats.calls - start;
		const cards = cardEls(el);
		expect(cards.size).toBe(N);
		const filled = [...cards].filter(([, c]) => hasBody(c));
		expect(filled.length).toBeGreaterThan(0);
		expect(asked).toBeLessThan(N - 1);
		for (const [id, c] of filled) expect(c.getAttribute('aria-label'), id).toBe(want.get(id));
		expect(inside(view).scene.words.pending).toBeGreaterThan(0);
	});

	it('after the queue every card has the eager label, and after a fill the eager content; the layout is the same', async () => {
		const eager = await eagerView();
		fillAllCards(eager.el);
		const { el, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		runQueue(inside(view).scene);
		expect(inside(view).scene.words.pending).toBe(0);
		expect(labels(el)).toEqual(labels(eager.el));
		fillAllCards(el);
		expect(serial(el.querySelector('.dynasty-cards')!)).toBe(serial(eager.el.querySelector('.dynasty-cards')!));
		expect(JSON.stringify([...inside(view).laid.layout.persons])).toBe(JSON.stringify([...inside(eager.view).laid.layout.persons]));
	});

	it('no chunk runs while a wheel zoom or pan runs; the queue goes on after it', async () => {
		const { vp, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const scene = inside(view).scene;
		const before = scene.words.pending;
		for (let i = 0; i < 8; i++) {
			dispatch(vp, 'wheel', { deltaY: 10, deltaMode: 0, ctrlKey: true, clientX: 10, clientY: 10 });
			runTimers(100);
			expect(scene.words.pending).toBe(before);
		}
		runTimers(600);
		expect(scene.words.pending).toBeLessThan(before);
	});

	it('no chunk runs while a press may become a pan', async () => {
		const { vp, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const scene = inside(view).scene;
		const before = scene.words.pending;
		dispatch(vp, 'pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, clientX: 50, clientY: 50 });
		runTimers(2000);
		expect(scene.words.pending).toBe(before);
		dispatch(vp, 'pointerup', { pointerType: 'mouse', pointerId: 1, button: 0, isPrimary: true, clientX: 50, clientY: 50 });
		runTimers(2000);
		expect(scene.words.pending).toBeLessThan(before);
	});

	it('a new render and the unload stop the queue of the old scene', async () => {
		const { view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const old = inside(view).scene;
		const left = old.words.pending;
		inside(view).render(null);
		const fresh = inside(view).scene;
		expect(fresh).not.toBe(old);
		runTimers(3000);
		expect(old.words.pending).toBe(left);
		view.unload();
		const after = fresh.words.pending;
		runTimers(3000);
		expect(fresh.words.pending).toBe(after);
	});

	it('Find (showPerson) on a far card writes its word and eager label before the highlight', async () => {
		const eager = await eagerView();
		const want = labels(eager.el);
		const { el, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const far = [...cardEls(el)].find(([, c]) => !hasBody(c));
		expect(far).toBeDefined();
		const [id, card] = far!;
		inside(view).showPerson(id);
		expect(hasBody(card)).toBe(true);
		expect(card.getAttribute('aria-label')).toBe(want.get(id));
	});

	it('below the size limit every word is asked before the first frame, as before', async () => {
		TreeView.lateWordsMin = LATE_WORDS_MIN_CARDS;
		const start = relationCallStats.calls;
		const { view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		expect(relationCallStats.calls - start).toBe(N - 1);
		expect(inside(view).scene.words.pending).toBe(0);
	});
});
