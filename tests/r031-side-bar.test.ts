import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { isPhoneDevice, isPhoneSideways } from '../src/obsidian/focus-mode';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { FEl, clock, device, dispatchWindow, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { sample12 } from './acceptance/relations-support';
import { desktop, openFullScreen, phone, phoneOnSide, tabletDevice } from './acceptance/tree-view-fakes';

/*
 * 0.3.1, D242: a phone held sideways gets the bottom bar of a phone held upright. One test ("phone held sideways") sets the class
 * `is-phone-side` on the full-screen window; the stylesheet gives that class every rule of `is-phone`. Tablets and computers do not change.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

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

const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
const win = (innerWidth: number, innerHeight: number, screen?: [number, number]) => ({ innerWidth, innerHeight, screen: screen ? { width: screen[0], height: screen[1] } : null });

describe('D242: the test "a phone held sideways" (pure)', () => {
	it('a phone on its side is sideways; the same phone upright is not', () => {
		expect(isPhoneSideways(true, win(844, 390, [844, 390]))).toBe(true);
		expect(isPhoneSideways(true, win(390, 844, [390, 844]))).toBe(false);
		// A real phone keeps its screen size when it turns, or reports the turned size: both count.
		expect(isPhoneSideways(true, win(844, 390, [390, 844]))).toBe(true);
		expect(isPhoneSideways(true, win(667, 375, [667, 375]))).toBe(true);
	});

	it('needs a coarse pointer: a narrow, wide computer window is not a phone', () => {
		expect(isPhoneSideways(false, win(844, 390, [1920, 1080]))).toBe(false);
		expect(isPhoneSideways(false, win(844, 390))).toBe(false);
	});

	it('a tablet is not a phone, held either way, also in a narrow window of a split view', () => {
		expect(isPhoneSideways(true, win(1180, 820, [1180, 820]))).toBe(false);
		expect(isPhoneSideways(true, win(820, 1180, [820, 1180]))).toBe(false);
		// The window is under 600 px high but the screen is a tablet's: the screen decides, as it does for the button set.
		expect(isPhoneSideways(true, win(1000, 500, [1180, 820]))).toBe(false);
	});

	it('a phone held upright with its keyboard open is not sideways (the keyboard makes the window lower, never wider)', () => {
		expect(isPhoneSideways(true, win(390, 300, [390, 844]))).toBe(false);
		// With the keyboard open on its side the window is lower but still wider than the short side.
		expect(isPhoneSideways(true, win(844, 160, [390, 844]))).toBe(true);
	});

	it('a square window and an unknown screen follow the window', () => {
		expect(isPhoneSideways(true, win(390, 390, [390, 844]))).toBe(false);
		expect(isPhoneSideways(true, win(700, 390))).toBe(true);
		expect(isPhoneSideways(true, win(390, 700))).toBe(false);
	});

	it('agrees with the phone test of the button set (isPhoneDevice) for every sideways window', () => {
		for (const [w, h, s] of [
			[844, 390, [844, 390]],
			[932, 430, [932, 430]],
			[1024, 768, [1024, 768]],
			[1180, 820, [1180, 820]],
			[1366, 600, [1366, 1024]],
			[640, 360, [640, 360]],
		] as const) {
			for (const coarse of [true, false]) {
				const win_ = win(w, h, [s[0], s[1]]);
				if (isPhoneSideways(coarse, win_)) expect(isPhoneDevice(coarse, win_), `${w}x${h}`).toBe(true);
			}
		}
	});
});

describe('D242: the class on the full-screen window', () => {
	const F12 = sample12().source;
	const classes = (modal: { modalEl: unknown }) => ({ phone: (modal.modalEl as FEl).hasClass('is-phone'), side: (modal.modalEl as FEl).hasClass('is-phone-side') });
	const tools = (root: FEl) => root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);

	it('a phone on its side has is-phone-side and not is-phone, with the button set of the upright phone', async () => {
		phone();
		const up = await openFullScreen(F12);
		expect(classes(up.modal)).toEqual({ phone: true, side: false });
		const upright = tools(up.root);
		up.modal.close();
		FullScreenModal.openViews.clear();
		phoneOnSide();
		const side = await openFullScreen(F12);
		expect(classes(side.modal)).toEqual({ phone: false, side: true });
		expect(tools(side.root)).toEqual(upright);
		expect(upright[upright.length - 1]).toBe('dynasty-close');
	});

	it('a tablet and a computer have neither class', async () => {
		tabletDevice();
		device.width = 1180;
		device.height = 820;
		const t = await openFullScreen(F12);
		expect(classes(t.modal)).toEqual({ phone: false, side: false });
		t.modal.close();
		FullScreenModal.openViews.clear();
		desktop();
		const d = await openFullScreen(F12);
		expect(classes(d.modal)).toEqual({ phone: false, side: false });
	});

	it('turning the phone switches the class at once, with the same window and the same tree', async () => {
		phone();
		const v = await openFullScreen(F12);
		const box = v.root.querySelector('.dynasty-fullscreen-tree');
		expect(classes(v.modal)).toEqual({ phone: true, side: false });
		for (const [w, h, want] of [
			[844, 390, { phone: false, side: true }],
			[390, 844, { phone: true, side: false }],
			[844, 390, { phone: false, side: true }],
		] as const) {
			device.width = w;
			device.height = h;
			dispatchWindow('resize');
			expect(classes(v.modal)).toEqual(want);
			expect(v.root.querySelector('.dynasty-fullscreen-tree')).toBe(box);
			expect(FullScreenModal.openViews.has(v.modal)).toBe(true);
		}
	});

	it('a phone upright with its keyboard open keeps the upright look', async () => {
		phone();
		const v = await openFullScreen(F12);
		device.screenWidth = 390;
		device.screenHeight = 844;
		device.height = 300;
		dispatchWindow('resize');
		expect(classes(v.modal)).toEqual({ phone: true, side: false });
	});

	it('the tree measures its free area again when the bar changes edge', async () => {
		phoneOnSide();
		const v = await openFullScreen(F12);
		const tree = (v.modal as unknown as { tree: { barMoved(): void } }).tree;
		const spy = vi.spyOn(tree, 'barMoved');
		device.width = 390;
		device.height = 844;
		dispatchWindow('resize');
		expect(spy).toHaveBeenCalledTimes(1);
		// No change of class, no call.
		dispatchWindow('resize');
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe('D242: styles.css', () => {
	const sheet = css.split('\n');

	it('every rule of the full-screen bar for is-phone also names is-phone-side, in the same rule', () => {
		const phoneLines = sheet.map((l, i) => [l, i] as const).filter(([l]) => /^\.modal\.dynasty-fullscreen\.is-phone /.test(l));
		expect(phoneLines.length).toBeGreaterThanOrEqual(9);
		for (const [l, i] of phoneLines) {
			expect(sheet[i - 1], l).toBe(l.replace('.is-phone ', '.is-phone-side ').replace(/ \{$/, ','));
		}
	});

	it('the sideways rules put the bar at the bottom, over the safe area, with one row', () => {
		const rule = (sel: string) => {
			const i = css.indexOf(`${sel},\n`);
			expect(i, sel).toBeGreaterThanOrEqual(0);
			return css.slice(i, css.indexOf('}', i));
		};
		const bar = rule('.modal.dynasty-fullscreen.is-phone-side .dynasty-full .dynasty-toolbar');
		expect(bar).toContain('bottom: 0');
		expect(bar).toContain('height: calc(52px + env(safe-area-inset-bottom))');
		expect(bar).toContain('env(safe-area-inset-left)');
		expect(bar).toContain('env(safe-area-inset-right)');
		expect(css).toMatch(/\.is-phone-side \.dynasty-full \.dynasty-toolbar \.dynasty-close,\n\.modal\.dynasty-fullscreen\.is-phone \.dynasty-full \.dynasty-toolbar \.dynasty-close \{[^}]*position: sticky/);
	});

	it('a sheet, the problem list and the result bar keep clear of the notch at the sides', () => {
		expect(css).toMatch(/\.dynasty-popover\.is-sheet \{[^}]*padding: 6px max\(12px, env\(safe-area-inset-right, 0px\)\)[^}]*max\(12px, env\(safe-area-inset-left, 0px\)\)/);
		// `width: auto` lets left and right set the width; `max-content` made a long problem text wider than the screen (found in 0.3.1 on a phone upright too).
		expect(css).toMatch(/is-phone \.dynasty-full \.dynasty-popover:not\(\.is-anchored\):not\(\.is-sheet\) \{[^}]*width: auto;[^}]*max-width: none/);
		expect(css).toMatch(/is-phone \.dynasty-full \.dynasty-popover:not\(\.is-anchored\):not\(\.is-sheet\) \{[^}]*left: max\(var\(--size-4-2\), env\(safe-area-inset-left\)\);[^}]*right: max\(var\(--size-4-2\), env\(safe-area-inset-right\)\)/);
		expect(css).toMatch(/is-phone \.dynasty-full \.dynasty-result \{[^}]*padding: 4px max\(0px, env\(safe-area-inset-right\)\) 4px max\(16px, env\(safe-area-inset-left\)\)/);
	});
});
