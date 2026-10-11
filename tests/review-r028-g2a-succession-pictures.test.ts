import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { closePluginModals } from '../src/obsidian/plugin-modals';
import { resetOpenSections } from '../src/obsidian/window-sections';
import { FEl, clock, device, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { choose, openWin, page } from './r027-window-support';

/*
 * G2 review of the 0.2.8 part-A repairs: the pictures of the line of succession. Run: npx vitest run tests/review-r028-g2a-succession-pictures.test.ts
 */
const emptyOriginal = FEl.prototype.empty;
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
	// The fake DOM keeps `isConnected` true for a removed element; a real browser says false. Make the fake say so.
	FEl.prototype.empty = function (this: FEl) {
		const mark = (e: FEl) => {
			e.isConnected = false;
			e.children.forEach(mark);
		};
		this.children.forEach(mark);
		emptyOriginal.call(this);
	};
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	resetOpenSections();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
	FEl.prototype.empty = emptyOriginal;
});

const kids = Array.from({ length: 9 }, (_, i) => `  - {id: k${i}, name: Kid ${i}, parents: [r], born: ${1010 + i}, portrait: "[[k${i}.png]]"}`).join('\n');
const BODY = `houses:\n  - {id: va, name: V}\ntitles:\n  - {id: t1, name: Duke, succession: eldest-child, holders: [{person: r, from: 1000}]}\npeople:\n  - {id: r, name: Ruler, house: va, born: 980}\n${kids}\n`;

describe('the line of succession draws again at each change', () => {
	it("the pictures of rows that left the page go back to the store when the line is drawn again (12 changes: never more than twice the rows shown are held)", async () => {
		let held = 0;
		let peak = 0;
		const store = {
			resolve: (l: string) => ({ ok: true, file: { path: l.replace(/[[\]]/g, ''), name: l }, format: 'png' }),
			acquire: async () => {
				held++;
				peak = Math.max(peak, held);
				let done = false;
				return { url: 'blob:x', w: 1, h: 1, release: () => void (done || ((done = true), held--)) };
			},
			onChange: () => () => {},
		};
		const o = openWin(BODY, { pictures: store as never });
		const p = page(o, 't1');
		for (let i = 0; i < 12; i++) {
			choose(p, 'rule', i % 2 ? 'eldest-child' : 'youngest-child');
			await settle();
		}
		const rows = p.querySelectorAll('.dynasty-succ-item').length;
		expect(rows).toBeGreaterThan(0);
		expect(peak).toBeLessThanOrEqual(rows * 2);
	});
});
