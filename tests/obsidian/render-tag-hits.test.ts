import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The fakes load main.ts, which pulls in the Live Preview extension; its CodeMirror parts are not needed here.

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { FEl, clock, dispatch, pointer, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { FAR, desktop, embed, fakeHandle, fullViews, sheets, tabletDevice } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP4.3 (G5, sample tree 6 at Fit): a far-couple tag's 44 px tap area covered a whole small card,
 * so a press on the card jumped to the partner. The tap areas now lie below the cards; the pills
 * stay above them.
 */

useFakeDom();

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const childIndex = (scene: FEl, cls: string) => scene.children.findIndex((c) => c.hasClass(cls));

describe('Far-couple tag tap areas and cards', () => {
	it('draws the tap areas before the cards and the pills after them', async () => {
		desktop();
		const { el } = await embed(FAR, { handle: fakeHandle('n.md', FAR) });
		const scene = el.querySelector('.dynasty-scene')!;
		const hits = childIndex(scene, 'dynasty-tag-hits');
		const cards = childIndex(scene, 'dynasty-cards');
		const tags = childIndex(scene, 'dynasty-tags');
		expect(hits).toBeGreaterThanOrEqual(0);
		expect(hits).toBeLessThan(cards);
		expect(cards).toBeLessThan(tags);
		// Every tag has one tap area, named by the same person, and no tap area is inside a tag.
		const tagEls = el.querySelectorAll('.dynasty-tag');
		const hitEls = el.querySelectorAll('.dynasty-tag-hit');
		expect(hitEls.map((h) => h.getAttribute('data-person')).sort()).toEqual(tagEls.map((t) => t.getAttribute('data-person')).sort());
		for (const h of hitEls) expect(h.closest('.dynasty-tag')).toBeNull();
	});

	it('a tap on a tap area still acts as the tag: a static touch embed opens the full-screen view (D17)', async () => {
		tabletDevice();
		const { el } = await embed(FAR);
		const hit = el.querySelectorAll('.dynasty-tag-hit').find((h) => h.getAttribute('data-person') !== 'aldo')!;
		dispatch(hit, 'pointerdown', pointer('touch', 1, 20, 20));
		dispatch(hit, 'pointerup', pointer('touch', 1, 20, 20));
		dispatch(hit, 'click', { button: 0, clientX: 20, clientY: 20 });
		await settle();
		expect(fullViews()).toHaveLength(1);
		expect(sheets()).toHaveLength(0);
	});
});
