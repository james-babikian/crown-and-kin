import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HousesWindow } from '../../src/obsidian/houses-window';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, device, dispatch, dispatchWindow, fakeDoc, resetDom, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { click, stripNotDisabled, writingHandle } from '../support/windows-sheets-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.4 phone-B, M1 to M3 (D124 phone animation item 1, spec §13.19 rule 4): the Houses window keeps its scroll place over
 * "Add house" (the proof is tests/obsidian/houses-window-scroll-position.test.ts), and it scrolls to the new field ONCE, after the keyboard
 * has settled, not at each step of the keyboard's slide. With "Reduce movement" on (`options.reduced`) the scroll jumps at once.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	device.coarse = true;
	device.width = 390;
	device.height = 844;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});

function body(n: number): string {
	const lines = ['houses:'];
	for (let i = 1; i <= n; i++) lines.push(`  - id: h${i}`, `    name: House ${i}`);
	lines.push('', 'people:', '  - id: a', '    name: A', '    house: h1');
	return `${lines.join('\n')}\n`;
}

/** Opens the window, taps Add house, taps the new name field, and returns it. */
async function addHouse(reduced?: () => boolean) {
	const handle = writingHandle(body(12));
	const win = HousesWindow.create({} as never, { handle: handle as never, ...(reduced ? { reduced } : {}) })!;
	win.open();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	// The window has finished taking the focus (0 and 120 ms); a later focus is the user's.
	runTimers(200);
	await click(content.querySelector('.dynasty-house-add'));
	// D320: the new page opens with no field focused; the user taps the name field, and the keyboard opens then.
	expect(fakeDoc.activeElement!.getAttribute('data-focus')).toBe('back');
	const input = content.querySelectorAll('textarea, input').find((f) => (f.getAttribute('data-focus') ?? '').startsWith('name:'))!;
	input.focus();
	expect(fakeDoc.activeElement).toBe(input);
	return { win, content, input };
}

const scrolls = () => vi.spyOn(FEl.prototype, 'scrollIntoView');

/** The argument of the first call of a spy on a method that the fake declares with no parameter. */
const firstArg = (spy: { mock: { calls: unknown[][] } }): unknown => spy.mock.calls[0]![0];
/** The argument of the last focus call that the window made on its Back button (the new page; the test's own tap on the field comes after). */
const backFocusArg = (spy: { mock: { calls: unknown[][]; contexts: unknown[] } }): unknown => {
	const at = spy.mock.contexts.map((c) => (c as FEl).getAttribute('data-focus')).lastIndexOf('back');
	return spy.mock.calls[at]![0];
};

describe('the Houses window scrolls once, after the keyboard has settled', () => {
	it('six steps of the keyboard slide cause no scroll, then one scroll to the new field', async () => {
		const spy = scrolls();
		const { input } = await addHouse();
		spy.mockClear();
		// The keyboard slides in: the window follows each step (a layout), 25 ms apart.
		for (let i = 0; i < 6; i++) {
			dispatchWindow('resize');
			runTimers(25);
		}
		expect(spy).not.toHaveBeenCalled();
		runTimers(400);
		expect(spy).toHaveBeenCalledTimes(1);
		// The whole field scrolls, so the hint that shows on focus is in view with the control (R05 look repair 1).
		expect(spy.mock.contexts[0]).toBe(input.closest('.dynasty-sheet-field') ?? input);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'auto' });
		// Nothing more later.
		runTimers(2000);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('a focus change with no keyboard step scrolls once, 300 ms later (as before)', async () => {
		const spy = scrolls();
		const { content, input } = await addHouse();
		spy.mockClear();
		dispatch(input, 'focusin');
		runTimers(299);
		expect(spy).not.toHaveBeenCalled();
		runTimers(2);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(content.contains(spy.mock.contexts[0] as FEl)).toBe(true);
	});

	it('the focus of the new page does not scroll by itself on a phone (the one scroll waits for the keyboard)', async () => {
		const focus = vi.spyOn(FEl.prototype, 'focus');
		await addHouse();
		expect(backFocusArg(focus)).toEqual({ preventScroll: true });
	});

	it('on a computer the focus scrolls at once, as before', async () => {
		device.width = 1280;
		const focus = vi.spyOn(FEl.prototype, 'focus');
		await addHouse();
		expect(backFocusArg(focus)).toEqual({ preventScroll: false });
	});

	it('the timer goes with the window: a close before it fires scrolls nothing', async () => {
		const spy = scrolls();
		const { win, input } = await addHouse();
		spy.mockClear();
		dispatch(input, 'focusin');
		(win as unknown as { onClose(): void }).onClose();
		runTimers(2000);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('with "Reduce movement" on the scroll jumps at once', () => {
	it('reduced: behavior instant', async () => {
		const spy = scrolls();
		const { input } = await addHouse(() => true);
		spy.mockClear();
		dispatch(input, 'focusin');
		runTimers(400);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'instant' });
	});

	it('the function is asked when the scroll runs, not when the window opens', async () => {
		const spy = scrolls();
		let reduced = false;
		const { input } = await addHouse(() => reduced);
		spy.mockClear();
		reduced = true;
		dispatch(input, 'focusin');
		runTimers(400);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'instant' });
	});

	it('no option: the default is not reduced', async () => {
		const spy = scrolls();
		const { input } = await addHouse();
		spy.mockClear();
		dispatch(input, 'focusin');
		runTimers(400);
		expect(firstArg(spy)).toEqual({ block: 'nearest', behavior: 'auto' });
	});
});

describe('the scroll place is kept over every redraw of the window', () => {
	it('a redraw by a colour choice keeps the scrollTop of the page, and Back puts the list at its place again (D134)', async () => {
		const handle = writingHandle(body(12));
		const win = HousesWindow.create({} as never, { handle: handle as never })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		content.querySelector('.dynasty-sheet-body')!.scrollTop = 310;
		await click(content.querySelector('button.dynasty-lw-row'));
		const before = content.querySelector('.dynasty-sheet-body')!;
		expect(before.scrollTop).toBe(0);
		before.scrollTop = 120;
		await click(content.querySelector('.dynasty-house-colour'));
		await settle();
		const after = content.querySelector('.dynasty-sheet-body')!;
		// G5 0.4 fix 2, item 9: a colour choice changes the swatches in place and draws nothing again, so the page is the same element.
		expect(after).toBe(before);
		expect(after.scrollTop).toBe(120);
		await click(content.querySelector('button[data-focus="back"]'));
		expect(content.querySelector('.dynasty-sheet-body')!.scrollTop).toBe(310);
	});
});
