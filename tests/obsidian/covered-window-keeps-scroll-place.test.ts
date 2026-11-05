import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { phoneLayout } from '../../src/obsidian/modal-layout';
import { dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { Modal, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * A window that closes over another window of the plugin (the partnership window over the person window) leaves that window at the
 * scroll place it has when the close ends: a focus that returns, or a layout that settles, must not move it.
 */

useFakeDom({ window: true });

/** The windows a test opened: all are closed after it, so the next test starts with none open. */
const opened: (() => void)[] = [];

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => {
	for (const stop of opened.splice(0)) stop();
});

/** A window of the plugin with a body that scrolls, opened through `phoneLayout` as the windows do. */
function open() {
	const modal = new Modal({});
	const body = modal.modalEl.createDiv('dynasty-sheet-body');
	const stop = phoneLayout(modal as never);
	opened.push(stop);
	return { modal, body, stop };
}

describe('the scroll place of a covered window', () => {
	it('keeps a move that the covered window made on purpose before the close', () => {
		const below = open();
		below.body.scrollTop = 230;
		const above = open();
		// The covered window shows a new line while the window above is still open.
		below.body.scrollTop = 460;
		above.stop();
		runTimers(500);
		expect(below.body.scrollTop).toBe(460);
	});

	it('holds the place the covered window has at the close against a move that comes after the close', () => {
		const below = open();
		const above = open();
		below.body.scrollTop = 230;
		above.stop();
		below.body.scrollTop = 0;
		runTimers(50);
		expect(below.body.scrollTop).toBe(230);
		below.body.scrollTop = 10;
		runTimers(200);
		expect(below.body.scrollTop).toBe(230);
		// After the short time the covered window is free again.
		below.body.scrollTop = 40;
		runTimers(500);
		expect(below.body.scrollTop).toBe(40);
	});

	it('lets the user scroll: a wheel, a key or a touch ends the holding', () => {
		for (const type of ['wheel', 'keydown', 'pointerdown', 'touchstart']) {
			const below = open();
			const above = open();
			below.body.scrollTop = 230;
			above.stop();
			dispatch(below.modal.modalEl, type);
			below.body.scrollTop = 80;
			runTimers(200);
			expect(below.body.scrollTop).toBe(80);
			below.stop();
		}
	});

	it('leaves a window that closed with the window above it, and a window that has no body to scroll', () => {
		const below = open();
		const picker = new Modal({});
		const pickerStop = phoneLayout(picker as never);
		const above = open();
		above.stop();
		pickerStop();
		below.stop();
		expect(() => runTimers(500)).not.toThrow();
	});

	it('does nothing for the first window, which covers none', () => {
		const first = open();
		first.body.scrollTop = 120;
		first.stop();
		runTimers(500);
		expect(first.body.scrollTop).toBe(120);
	});

	it('forgets a window that closed: the next window covers only what is open', () => {
		const a = open();
		a.body.scrollTop = 50;
		a.stop();
		const b = open();
		const c = open();
		b.body.scrollTop = 70;
		c.stop();
		b.body.scrollTop = 90;
		runTimers(50);
		expect(b.body.scrollTop).toBe(70);
		expect(a.body.scrollTop).toBe(50);
		b.stop();
	});
});
