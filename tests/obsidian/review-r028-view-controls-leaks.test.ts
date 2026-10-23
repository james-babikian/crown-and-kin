import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { clock, dispatch, flushFrames, resetDom, settle, windowListenerCount } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, phone } from '../acceptance/tree-view-fakes';
import { FAR } from '../acceptance/tree-view-fakes';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

describe('listeners', () => {
	for (const [name, mode] of [['desktop', desktop], ['phone', phone]] as const) {
		it(`${name}: redraws and popovers add no window listener; unload removes all`, async () => {
			mode();
			const base = windowListenerCount();
			const host = fakeHost(DEFAULT_SETTINGS);
			const { el, view } = await embed(FAR, { host, handle: fakeHandle('n.md', FAR) });
			flushFrames();
			const afterLoad = windowListenerCount();
			for (let i = 0; i < 20; i++) {
				(view as never as { syncFocus(): void }).syncFocus();
				flushFrames();
				await settle();
				const more = el.querySelector('.dynasty-more') ?? el.querySelector('.dynasty-legend-button');
				if (more) {
					dispatch(more, 'click', { button: 0, detail: 1 });
					dispatch(more, 'click', { button: 0, detail: 1 });
				}
			}
			expect(windowListenerCount()).toBe(afterLoad);
			(view as never as { unload(): void }).unload();
			expect(windowListenerCount()).toBe(base);
		});
	}
	it('full screen view: close removes its window listeners', async () => {
		desktop();
		const base = windowListenerCount();
		const { modal } = await openFullScreen(FAR);
		modal.close();
		await settle();
		expect(windowListenerCount()).toBe(base);
	});
});

import { runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';
describe('after unload', () => {
	for (const [name, mode] of [['desktop', desktop], ['phone', phone]] as const) {
		it(`${name}: nothing runs or throws after unload`, async () => {
			mode();
			const errors: unknown[][] = [];
			vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
			const host = fakeHost(DEFAULT_SETTINGS);
			(host as unknown as { pictures: unknown }).pictures = {
				resolve: () => ({ ok: true, file: { path: 'a.png', name: 'a.png' }, format: 'png' }),
				check: async () => null,
				acquire: async () => ({ url: 'blob:x', w: 1, h: 1, release: () => {} }),
				onChange: () => () => {},
				peek: () => null,
			};
			const src = 'houses:\n  - {id: va, name: V, arms: "[[a.png]]"}\npeople:\n  - {id: a, name: A, house: va, portrait: "[[a.png]]"}\n  - {id: b, name: B, parents: [a]}\n';
			const { view } = await embed(src, { host, handle: fakeHandle('n.md', src) });
			(view as never as { unload(): void }).unload();
			flushFrames();
			runTimers(20000);
			await settle();
			flushFrames();
			runTimers(20000);
			expect(errors).toEqual([]);
		});
	}
});

describe('picture copies', () => {
	for (const [name, mode] of [['desktop', desktop], ['phone', phone]] as const) {
		it(`${name}: every copy that the store gave is released after redraws and unload`, async () => {
			mode();
			let held = 0;
			let made = 0;
			const delays: (() => void)[] = [];
			const store = {
				resolve: () => ({ ok: true, file: { path: 'a.png', name: 'a.png' }, format: 'png' }),
				check: async () => null,
				acquire: (_f: unknown, _b: unknown, signal?: AbortSignal) =>
					new Promise((res) => {
						delays.push(() => {
							if (signal?.aborted) return res(null);
							made++;
							held++;
							let done = false;
							res({ url: 'blob:x', w: 1, h: 1, release: () => { if (!done) { done = true; held--; } } });
						});
					}),
				onChange: () => () => {},
				peek: () => null,
			};
			const host = fakeHost(DEFAULT_SETTINGS);
			(host as unknown as { pictures: unknown }).pictures = store;
			const src = 'houses:\n  - {id: va, name: V, arms: "[[a.png]]"}\npeople:\n  - {id: a, name: A, house: va, portrait: "[[a.png]]"}\n  - {id: b, name: B, parents: [a], house: va}\n';
			const { view } = await embed(src, { host, handle: fakeHandle('n.md', src) });
			for (let i = 0; i < 5; i++) {
				flushFrames();
				runTimers(2000);
				await settle();
				for (const d of delays.splice(0)) d();
				(view as never as { syncFocus(): void }).syncFocus();
				await settle();
				flushFrames();
				runTimers(2000);
			}
			for (const d of delays.splice(0)) d();
			await settle();
			(view as never as { unload(): void }).unload();
			for (const d of delays.splice(0)) d();
			await settle();
			expect({ made: made > 0, held }).toEqual({ made: true, held: 0 });
		});
	}
});
