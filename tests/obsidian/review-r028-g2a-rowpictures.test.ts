import { describe, expect, it } from 'vitest';

import { RowPictures } from '../../src/obsidian/window-parts';
import { FEl, settle } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 review of the 0.2.8 part-A repairs: RowPictures. Run: npx vitest run tests/obsidian/review-r028-g2a-rowpictures.test.ts
 */
useFakeDom({ window: true });

/** A watcher that the test drives, and a store whose requests the test settles by hand. */
function rig() {
	const observed = new Set<FEl>();
	const roots: unknown[] = [];
	let cb: (e: { target: FEl; isIntersecting: boolean }[]) => void = () => {};
	class FakeObserver {
		constructor(fn: typeof cb, o: { root: unknown }) {
			cb = fn;
			roots.push(o.root);
		}
		observe(el: FEl) {
			observed.add(el);
		}
		unobserve(el: FEl) {
			observed.delete(el);
		}
		disconnect() {
			observed.clear();
		}
	}
	const view = { IntersectionObserver: FakeObserver, getComputedStyle: (el: FEl) => ({ overflowY: el.hasClass('scroller') ? 'auto' : 'visible' }) };
	const slotIn = (parent: FEl) => {
		const s = parent.createSpan();
		return Object.assign(s, { ownerDocument: { defaultView: view } });
	};
	const pending: { resolve: (c: unknown) => void; signal?: AbortSignal; path: string }[] = [];
	let held = 0;
	const store = {
		resolve: (l: string) => ({ ok: true, file: { path: l, name: l }, format: 'png' }),
		acquire: (f: { path: string }, _b: unknown, signal?: AbortSignal) =>
			new Promise((resolve) => {
				pending.push({ resolve, signal, path: f.path });
			}),
	};
	const give = (i: number) => {
		held++;
		let done = false;
		pending[i].resolve({ url: 'blob:x', w: 1, h: 1, release: () => void (done || ((done = true), held--)) });
	};
	return { observed, roots, store, slotIn, pending, give, held: () => held, show: (el: FEl) => cb([{ target: el, isIntersecting: true }]) };
}

describe('RowPictures with a watcher', () => {
	it('a copy that arrives after release() is let go (the store counts are 0)', async () => {
		const r = rig();
		const root = new FEl('div');
		const pics = new RowPictures(r.store as never, 'n.md');
		const slot = r.slotIn(root);
		pics.show(slot as never, 'a.png', { px: 36, fit: 'portrait' });
		r.show(slot);
		await settle();
		pics.release();
		r.give(0);
		await settle();
		expect(r.held()).toBe(0);
	});

	it('forget() then a late report of the watcher asks for nothing', async () => {
		const r = rig();
		const root = new FEl('div');
		const pics = new RowPictures(r.store as never, 'n.md');
		const slot = r.slotIn(root);
		pics.show(slot as never, 'a.png', { px: 36, fit: 'portrait' });
		pics.forget(root as never);
		r.show(slot);
		await settle();
		expect(r.pending.length).toBe(0);
		expect(r.observed.size).toBe(0);
	});
});
