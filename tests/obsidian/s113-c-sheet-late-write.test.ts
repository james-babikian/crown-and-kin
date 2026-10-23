import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeApp } from '../acceptance/tree-view-fakes';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Search round 0.2.3, area C. A write that is still running when the sheet closes (Cancel, or the unload)
 * ends with `afterWrite()`, which draws the sheet again. A closed sheet draws its portrait again too, and
 * `portraitFor()` asks the picture store for a copy that nobody releases (`onClose` ran already).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - id: a', '    name: Aldric', '    portrait: "[[a.png]]"', ''].join('\n');

describe('a write that ends after the sheet closed', () => {
	it('does not start a portrait copy that nobody releases', async () => {
		const h = writingHandle(BODY);
		// The write waits until the test lets it go.
		let go: () => void = () => undefined;
		const gate = new Promise<void>((r) => (go = r));
		const real = h.write.getMockImplementation()!;
		h.write.mockImplementation((async (op: never) => {
			await gate;
			return (real as (o: never) => Promise<unknown>)(op);
		}) as never);
		const released: string[] = [];
		const made: string[] = [];
		const store = {
			resolve: () => ({ ok: true, file: { path: 'a.png', name: 'a.png', extension: 'png', stat: { mtime: 1, size: 1 } }, format: 'png' }),
			transient: async () => {
				made.push('copy');
				return { url: 'blob:x', w: 96, h: 96, release: () => void released.push('copy') };
			},
			acquire: async () => null,
			peek: () => null,
			onChange: () => () => undefined,
		};
		const s = EditSheet.create(fakeApp() as never, { handle: h as never, personId: 'a', sourcePath: 'n.md', pictures: store as never })!;
		s.open();
		await settle();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		expect(made).toHaveLength(1);
		// Pin focus writes at once, and the owner taps Cancel while the write runs.
		dispatch(modal.querySelector('.dynasty-pin')!, 'click');
		await settle();
		dispatch(modal.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(openModals).not.toContain(s);
		go();
		await settle();
		await settle();
		// Every copy that the sheet asked for is released by now.
		expect(made.length).toBe(released.length);
	});
});
