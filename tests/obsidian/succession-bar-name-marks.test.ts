import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { SUCCESSION_UI } from '../../src/render/ui-text';
import { listData, listWord } from '../../src/view/phone-list';
import { build } from '../support/helpers';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHost } from '../acceptance/tree-view-fakes';
import { BODY_16 } from '../support/titles-window-support';
import { useFakeDom } from '../support/fake-dom-setup';
import { noteHandle } from '../support/writing-handle';

/*
 * `SUCCESSION_UI.bar` puts the title name between FSI and PDI. The Show view bar of the tree in a note and the bar of the phone list must write the sentence
 * with `setNameText`: the tree in a note is not a watched window, and WebKit ignores the two characters in an HTML text (an internal test).
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

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the Show view bar of a tree in a note', () => {
	it('a title name with a right-to-left letter is an isolate span, with no raw mark left in the text', async () => {
		desktop();
		const body = BODY_16.replace('name: Duke of Carrowmere', 'name: أمير Carrowmere');
		const handle = noteHandle(body);
		const host = fakeHost();
		const e = await embed(body, { host, handle });
		TreeView.showSuccession(host as never, handle.state, 'duke-of-carrowmere', e.view);
		await settle();
		resizeAll();
		flushFrames();
		const bar = (e.el as FEl).querySelector('.dynasty-succession-text');
		expect(bar).not.toBeNull();
		const text = bar!.getText();
		expect(text).toContain('Carrowmere');
		expect(/[⁨⁩]/.test(text), JSON.stringify(text)).toBe(false);
	});

	it('the same bar in the phone list (the iPhone view)', () => {
		const { g } = build(['people:', '  - {id: a, name: Aldric, born: 1100}', ''].join(String.fromCharCode(10)));
		const parent = new FEl('div', { cls: 'dynasty-viewport' });
		const spec: PhoneListSpec = {
			g, data: listData(g, 'a'), me: null, showDates: true, editable: true,
			word: (id) => listWord(id, { me: null, showRelations: false, cards: new Map() }),
			icon: setIcon as unknown as PhoneListSpec['icon'], onGo: () => undefined, onEdit: () => undefined,
			bar: { sentence: SUCCESSION_UI.bar('أمير Carrowmere', null), closeLabel: 'Close', onClose: () => undefined },
		} as PhoneListSpec;
		buildPhoneList(parent as unknown as HTMLElement, spec);
		const text = parent.querySelector('.dynasty-succession-text')!.getText();
		expect(/[⁨⁩]/.test(text), JSON.stringify(text)).toBe(false);
	});
});
