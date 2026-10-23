import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { bindViewerMotion } from '../../src/obsidian/picture-viewer';
import { FEl, clock, dispatch, fakeDoc, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, type Host } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { card, foreignParent, hostWithPictures, viewIn, viewers } from '../support/viewer-world';

useFakeDom({ window: true });
let unbind: () => void = () => {};
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	unbind = bindViewerMotion(() => 'system');
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	unbind();
	vi.restoreAllMocks();
});

const SRC = [
	'houses:',
	'  - id: valmont',
	'    name: House Valmont',
	'    color: "#8b1e3f"',
	'    arms: "[[valmont-arms.png]]"',
	'people:',
	'  - {id: ann, name: Ann Valmont, house: valmont, portrait: "[[ann.jpg]]", born: 1100}',
	'  - {id: bob, name: Bob Valmont, house: valmont, parents: [ann], born: 1130}',
	'',
].join('\n');

const view = (host: Host, parent: FEl, handle: ReturnType<typeof fakeHandle> | null, src = SRC) => viewIn(host, parent, handle, src);

/*
 * G2 review of r033/b2-c1 (aa892f7f). Each `it` marked (Fn) proves a finding that the fix round closed; the others are controls.
 */

describe('C1: a view that the plugin retired (plugin turned off) keeps no card action', () => {
	it('(F1): after retire(), a click on a card of an editable embed opens no viewer and no window', async () => {
		desktop();
		const { el, v } = await view(hostWithPictures(), new FEl('div'), fakeHandle('n.md', SRC));
		const c = card(el, 'ann');
		v.retire();
		dispatch(c, 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(0);
	});

	it('(F1): after retire(), a click on a card of a tree in an embed opens no viewer', async () => {
		desktop();
		const { el, v } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		const c = card(el, 'ann');
		v.retire();
		dispatch(c, 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(0);
	});

	it('control: before retire(), the same click opens the viewer in the embed', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		dispatch(card(el, 'ann'), 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(1);
	});
});

const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

describe('B2: the Focus button in the bar of a very large tree', () => {
	async function largeFull() {
		phone();
		const o = await openFullScreen(flat(1501), { host: fakeHost() });
		return o.root as FEl;
	}

	it('(F2): Enter on Focus with a focus on clears it and the keyboard focus is on the new Focus button', async () => {
		const root = await largeFull();
		dispatch(root.querySelector('.dynasty-focus')!, 'click', { button: 0, clientX: 0, clientY: 0, detail: 0 });
		await settle();
		resizeAll();
		flushFrames();
		expect(root.querySelector('.dynasty-large-bar')).not.toBeNull();
		expect(fakeDoc.activeElement).toBe(root.querySelector('.dynasty-focus'));
	});

	it('(F3): the Focus button in that bar has no aria-pressed (D263 B2 removed it from every other Focus button)', async () => {
		const root = await largeFull();
		dispatch(root.querySelector('.dynasty-focus')!, 'click', { button: 0, clientX: 0, clientY: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
		expect(root.querySelector('.dynasty-large-bar')).not.toBeNull();
		expect(root.querySelector('.dynasty-focus')!.getAttribute('aria-pressed')).toBeNull();
	});

	it('control: the Focus button of a drawn tree has no aria-pressed, with or without a focus', async () => {
		phone();
		const o = await openFullScreen(flat(20), { host: fakeHost() });
		expect((o.root as FEl).querySelector('.dynasty-focus')!.getAttribute('aria-pressed')).toBeNull();
	});
});
