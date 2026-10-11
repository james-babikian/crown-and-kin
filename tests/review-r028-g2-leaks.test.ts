import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow } from '../src/obsidian/houses-window';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { resetOpenSections } from '../src/obsidian/window-sections';
import { clock, device, dispatch, fakeWin, installDom, resetDom, runTimers, windowListenerCount, FEl } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_13 } from './acceptance/titles-support';
import { fakeHost } from './acceptance/tree-view-fakes';
import { writingHandle } from './s113-c-support';

/*
 * G2 review of 0.2.8 wave 2: windows release their window listeners and observers on close.
 * Run: npx vitest run tests/review-r028-g2-leaks.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

/** Observers made and not yet disconnected. */
const live = new Set<unknown>();
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	resetOpenSections();
	live.clear();
	const Base = (globalThis as unknown as { ResizeObserver: new (cb: never) => { observe(): void; disconnect(): void } }).ResizeObserver;
	(globalThis as unknown as Record<string, unknown>).ResizeObserver = class extends Base {
		constructor(cb: never) {
			super(cb);
			this.alive = false;
		}
		alive: boolean;
		override observe(): void {
			super.observe();
			this.alive = true;
			live.add(this);
		}
		override disconnect(): void {
			super.disconnect();
			live.delete(this);
		}
	};
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

describe('open and close 20 times', () => {
	for (const phone of [false, true]) {
		const where = phone ? 'phone' : 'computer';
		it(`${where}: the Titles window leaves no window listener and no observer`, () => {
			device.coarse = phone;
			device.width = phone ? 390 : 1280;
			let base = 0;
			let baseObs = 0;
			for (let i = 0; i < 20; i++) {
				if (i === 1) {
					base = windowListenerCount();
					baseObs = live.size;
				}
				const host = fakeHost();
				const win = TitlesWindow.create(host.app as never, { handle: writingHandle(BODY_13) as never, sourcePath: 'n.md' })!;
				win.open();
				const content = (win as unknown as { contentEl: FEl }).contentEl;
				dispatch(content.querySelector('button.dynasty-lw-row')!, 'click');
				win.close();
				win.close();
				runTimers(1000);
			}
			expect({ listeners: windowListenerCount() - base, observers: live.size - baseObs }).toEqual({ listeners: 0, observers: 0 });
		});
		it(`${where}: the Houses window leaves no window listener and no observer`, () => {
			device.coarse = phone;
			device.width = phone ? 390 : 1280;
			let base = 0;
			let baseObs = 0;
			for (let i = 0; i < 20; i++) {
				if (i === 1) {
					base = windowListenerCount();
					baseObs = live.size;
				}
				const host = fakeHost();
				const win = HousesWindow.create(host.app as never, { handle: writingHandle(BODY_13) as never, sourcePath: 'n.md' } as never)!;
				win.open();
				const content = (win as unknown as { contentEl: FEl }).contentEl;
				const row = content.querySelector('button.dynasty-lw-row');
				if (row) dispatch(row, 'click');
				win.close();
				win.close();
				runTimers(1000);
			}
			expect({ listeners: windowListenerCount() - base, observers: live.size - baseObs }).toEqual({ listeners: 0, observers: 0 });
		});
		it(`${where}: the person window leaves no window listener and no observer`, () => {
			device.coarse = phone;
			device.width = phone ? 390 : 1280;
			let base = 0;
			let baseObs = 0;
			for (let i = 0; i < 20; i++) {
				if (i === 1) {
					base = windowListenerCount();
					baseObs = live.size;
				}
				const host = fakeHost();
				const sheet = EditSheet.create(host.app as never, { handle: writingHandle(BODY_13) as never, personId: 'aldric', sourcePath: 'n.md' } as never)!;
				sheet.open();
				sheet.close();
				runTimers(1000);
			}
			expect({ listeners: windowListenerCount() - base, observers: live.size - baseObs }).toEqual({ listeners: 0, observers: 0 });
		});
	}
});
