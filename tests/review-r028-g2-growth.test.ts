import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { clock, dispatch, fakeWin, flushFrames, installDom, resetDom, settle, windowListenerCount, FEl } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, phone, FAR } from './acceptance/tree-view-fakes';

/*
 * G2 review of 0.2.8 wave 2: nothing grows over 20 redraws (observers, window listeners, elements).
 * Run: npx vitest run tests/review-r028-g2-growth.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
const live = new Set<unknown>();
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	live.clear();
	const Base = (globalThis as unknown as { ResizeObserver: new (cb: never) => { observe(): void; disconnect(): void } }).ResizeObserver;
	(globalThis as unknown as Record<string, unknown>).ResizeObserver = class extends Base {
		override observe(): void {
			super.observe();
			live.add(this);
		}
		override disconnect(): void {
			super.disconnect();
			live.delete(this);
		}
	};
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const count = (el: FEl): number => 1 + el.children.reduce((n, c) => n + count(c), 0);

describe('20 redraws', () => {
	for (const [name, mode] of [['desktop', desktop], ['phone', phone]] as const) {
		it(`${name}: observers, window listeners and elements do not grow`, async () => {
			mode();
			const host = fakeHost(DEFAULT_SETTINGS);
			const { el, view } = await embed(FAR, { host, handle: fakeHandle('n.md', FAR) });
			flushFrames();
			const one = async () => {
				(view as never as { syncFocus(): void }).syncFocus();
				(view as never as { render(f: null): void }).render(null);
				flushFrames();
				await settle();
				const more = el.querySelector('.dynasty-more');
				if (more) {
					dispatch(more, 'click', { button: 0, detail: 1 });
					dispatch(more, 'click', { button: 0, detail: 1 });
				}
			};
			await one();
			const base = { obs: live.size, win: windowListenerCount(), els: count(el) };
			for (let i = 0; i < 20; i++) await one();
			expect({ obs: live.size - base.obs, win: windowListenerCount() - base.win, els: count(el) - base.els }).toEqual({ obs: 0, win: 0, els: 0 });
		});
	}
	it('full screen: opening and closing 20 times leaves no observer and no window listener', async () => {
		desktop();
		const base = windowListenerCount();
		await openFullScreen(FAR).then((o) => o.modal.close());
		const obs0 = live.size;
		for (let i = 0; i < 20; i++) {
			const { modal } = await openFullScreen(FAR);
			modal.close();
			await settle();
		}
		expect({ obs: live.size - obs0, win: windowListenerCount() - base }).toEqual({ obs: 0, win: 0 });
	});
});
