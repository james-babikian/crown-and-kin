import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearLayoutCache } from '../../src/layout/index';
import { clearStops } from '../../src/view/large-tree';
import { ADD_UI, PHONE_LIST_UI } from '../../src/render/ui-text';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle } from '../acceptance/tree-view-fakes';
import { BODY_16 } from '../support/r027-window-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.5 repair (D313, ledger B-0001). The "Add person" button of the computer row shows the words "Add person". WCAG 2.5.3:
 * its spoken name starts with the visible words. "Fails on the old code": the old name was "Add a person to the tree".
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearLayoutCache();
	clearStops();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

describe('B-0001: the spoken name of the Add person button', () => {
	it('the text', () => {
		expect(ADD_UI.addPerson).toBe('Add person: add a person to the tree');
		expect(PHONE_LIST_UI.addPersonLabel).toBe(ADD_UI.addPerson);
	});

	it('on the computer row, the name starts with the visible words', async () => {
		desktop();
		const { el } = await embed(BODY_16, { handle: fakeHandle('n.md', BODY_16) });
		const button = el.querySelector('.dynasty-add-person')!;
		const visible = button.querySelector('.dynasty-tool-text')!.getText();
		expect(visible).toBe('Add person');
		expect(button.getAttribute('aria-label')!.startsWith(`${visible}: `)).toBe(true);
	});
});
