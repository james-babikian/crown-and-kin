// G2 review of r04/g5-fix2: proof tests for the findings (scratch branch only).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TreeViewBase } from '../../src/obsidian/tree-view-base';
import { undoNotice } from '../../src/obsidian/undo-notice';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { writingHandle } from '../support/s113-c-support';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	closePluginModals();
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - id: a', '    name: Aldric', ''].join('\n');

describe('G2 finding 1: the Undo notice of a removal blocks the focus return to the card', () => {
	it('Remove partnership in the person window, then Esc within 10 s: the redrawn card gets the focus back', () => {
		// The person window stays open after Remove partnership / Remove parent and shows the Undo notice (edit-sheet-writes.ts removedNotice).
		undoNotice('Removed the partnership.', writingHandle(BODY) as never, BODY);
		// The window then closes; the redraw of the write replaced the card, so the focus is on nothing.
		const viewport = fakeDoc.body.createDiv();
		const card = viewport.createDiv({ cls: 'dynasty-card', attr: { 'data-person': 'a' } });
		const host = { views: new Set([{ unloaded: false, viewport }]) } as never;
		fakeDoc.activeElement = null;
		// Step 2 is the last look (600 ms after the close); the notice lasts 10 s.
		TreeViewBase.refocusAfterRedraw(host, () => true, (vp) => vp.querySelector<HTMLElement>('.dynasty-card'), true, 2);
		expect(fakeDoc.activeElement).toBe(card as unknown as FEl);
	});
});
