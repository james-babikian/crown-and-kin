// D352 item 1, a known limit (the decision notes "Known limits are pinned"): in a whole tree whose relation words come late, the shell of a card far
// from the first view carries the label of a person with no relation until the idle queue writes its word; then it carries the eager label.
// A screen reader in browse mode reads that label without a focus event; Tab focus, Find and the sheet write the word first (`late-words-view`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import type { Scene } from '../../src/render/dom/scene';
import { LATE_WORDS_MIN_CARDS } from '../../src/view/late-words';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { FEl, clock, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost } from '../acceptance/tree-view-fakes';
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
});

afterEach(() => {
	TreeView.lateWordsMin = LATE_WORDS_MIN_CARDS;
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const MODEL = genModel(23, { n: 120, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 });
const BODY = toText({ ...MODEL, options: { me: 'p60' } });
/** The same people with no marked person: every card has the label of a person with no relation. */
const PLAIN = toText(MODEL);
const cardEls = (el: FEl) => new Map(el.querySelectorAll('.dynasty-card').map((c) => [c.getAttribute('data-person')!, c]));
const labels = (el: FEl) => new Map([...cardEls(el)].map(([id, c]) => [id, c.getAttribute('aria-label')]));
const hasBody = (card: FEl) => card.children.some((c) => c.hasClass('dynasty-card-body'));

/** The labels of an eager view of `body`: every word before the first frame. */
async function eagerLabels(body: string) {
	TreeView.lateWordsMin = Infinity;
	clearRelationCache();
	const { el } = await embed(body, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', body) });
	TreeView.lateWordsMin = 0;
	clearRelationCache();
	return labels(el);
}

describe('the spoken label of a card whose word is pending (D352 item 1, a known limit)', () => {
	it('a far card has the no-relation label until the queue reaches it, then the eager label', async () => {
		const marked = await eagerLabels(BODY);
		const plain = await eagerLabels(PLAIN);
		const { el, view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const scene = (view as unknown as { scene: Scene }).scene;
		const far = [...cardEls(el)].filter(([, c]) => !hasBody(c)).map(([id]) => id);
		// The pin means something only when some of these cards have a relation.
		expect(far.filter((id) => marked.get(id) !== plain.get(id)).length).toBeGreaterThan(0);
		// The owner accepted this moment (D352 item 1: "a card can show without its relation name for a moment").
		const now = labels(el);
		for (const id of far) expect(now.get(id), id).toBe(plain.get(id));
		for (let i = 0; scene.words.pending > 0 && i < 200; i++) runTimers(20);
		expect(scene.words.pending).toBe(0);
		const after = labels(el);
		for (const id of far) expect(after.get(id), id).toBe(marked.get(id));
	});
});
