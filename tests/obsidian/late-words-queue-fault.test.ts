// Spec §8 and D352 item 1: every entry point of the tree view runs inside its safe wrapper (`guard`), as the idle chain of the card content
// does. A fault inside an idle chunk of the late relation words must not escape the idle callback (an uncaught error); the view handles it
// like every other fault.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import type { Scene } from '../../src/render/dom/scene';
import { LATE_WORDS_MIN_CARDS } from '../../src/view/late-words';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { clock, resetDom, runTimers } from '../acceptance/fake-dom';
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
	TreeView.lateWordsMin = 0;
});

afterEach(() => {
	TreeView.lateWordsMin = LATE_WORDS_MIN_CARDS;
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = toText({ ...genModel(23, { n: 120, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: 'p60' } });

describe('a fault in the idle queue of the late words (spec §8)', () => {
	it('does not escape the idle callback of the queue', async () => {
		const { view } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle: fakeHandle('n.md', BODY) });
		const scene = (view as unknown as { scene: Scene }).scene;
		expect(scene.words.pending).toBeGreaterThan(0);
		// Any fault of the word or drawing code inside a chunk (the same code that every fill runs inside `guard`).
		(scene.words as { write: (ids: readonly string[]) => void }).write = () => {
			throw new Error('a fault inside a chunk');
		};
		expect(() => runTimers(3000)).not.toThrow();
	});
});
