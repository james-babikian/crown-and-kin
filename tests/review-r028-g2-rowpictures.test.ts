import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { RowPictures } from '../src/obsidian/window-parts';
import { FEl, fakeWin, installDom } from './acceptance/fake-dom';
import { settle } from './acceptance/fake-dom';

/*
 * G2 review of 0.2.8 wave 2: the pictures of window rows. Run: npx vitest run tests/review-r028-g2-rowpictures.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

describe('RowPictures', () => {
	it('a request that still waits is cancelled when the window closes (a picker over 300 people asks 300 times)', async () => {
		const signals: (AbortSignal | undefined)[] = [];
		const store = {
			resolve: (l: string) => ({ ok: true, file: { path: l, name: l }, format: 'png' }),
			acquire: (_f: unknown, _b: unknown, signal?: AbortSignal) => {
				signals.push(signal);
				return new Promise(() => {});
			},
		};
		const pics = new RowPictures(store as never, 'n.md');
		for (let i = 0; i < 300; i++) pics.show(new FEl('span') as never, `p${i}.png`, { px: 36, fit: 'portrait' });
		await settle();
		pics.release();
		// The store skips a queued decode only when its signal is aborted; without a signal 300 decodes still run after the picker has closed.
		expect({ asked: signals.length, aborted: signals.filter((s) => s?.aborted).length }).toEqual({ asked: 300, aborted: 300 });
	});
});

describe('the list of the Titles window with a search box', () => {
	it('typing 20 times in the search box does not hold 20 copies of each arms picture until the window closes', async () => {
		const { TitlesWindow } = await import('../src/obsidian/titles-window');
		const { writingHandle } = await import('./s113-c-support');
		const { fakeHost } = await import('./acceptance/tree-view-fakes');
		const { dispatch } = await import('./acceptance/fake-dom');
		let held = 0;
		const store = {
			resolve: (l: string) => ({ ok: true, file: { path: l.replace(/[[\]]/g, ''), name: l }, format: 'png' }),
			acquire: async () => {
				held++;
				let done = false;
				return { url: 'blob:x', w: 1, h: 1, release: () => { if (!done) { done = true; held--; } } };
			},
		};
		const body = 'houses:\n  - {id: va, name: V, arms: "[[a.png]]"}\ntitles:\n  - {id: t1, name: One, holders: [{person: a}]}\n  - {id: t2, name: Two, holders: [{person: a}]}\npeople:\n  - {id: a, name: Aldric, house: va}\n';
		const win = TitlesWindow.create(fakeHost().app as never, { handle: writingHandle(body) as never, sourcePath: 'n.md', pictures: store as never })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		await settle();
		const box = content.querySelector('input.dynasty-lw-search')!;
		for (let i = 0; i < 20; i++) {
			box.value = i % 2 ? 'o' : 'on';
			dispatch(box, 'input');
			await settle();
		}
		// Two rows show at most; each shows one picture.
		expect(held).toBeLessThanOrEqual(2);
	});
});
