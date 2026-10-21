import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { SWIPE_SETTLE_MS, attachSheetSwipe } from '../src/render/dom/sheet-swipe';
import { FEl, clock, dispatch, flushFrames, installDom, pointer, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * The fix round after the iPhone test of 0.3.2 (spec §0 D262, test 6m). A swipe that closes a phone sheet is one slide down: the sheet keeps `is-pulled` and
 * its pull (off the screen) until its owner has taken it away, because Obsidian slides a phone modal out from the transform it has. The reset comes with the
 * function that takes the swipe away. The move back of a short pull still resets at once.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const steps = (to: number, n = 8) => Array.from({ length: n }, (_, i) => Math.round((to * (i + 1)) / n));
const pull = (el: FEl) => el.style.getPropertyValue('--dynasty-sheet-pull');
const px = (el: FEl) => parseFloat(pull(el));

/** One finger on `target`: down at y 500, the moves `dys` (each after `gap` ms), up at the last move. */
function swipe(target: FEl, dys: number[], gap = 60, hold = 0) {
	dispatch(target, 'pointerdown', pointer('touch', 1, 200, 500));
	let last = 0;
	for (const dy of dys) {
		clock.now += gap;
		dispatch(target, 'pointermove', pointer('touch', 1, 200, 500 + dy));
		last = dy;
	}
	clock.now += hold;
	dispatch(target, 'pointerup', pointer('touch', 1, 200, 500 + last));
}

/** A bare sheet with the swipe on it; `close` notes what the sheet looked like when its owner was asked to close it. */
function bareSheet(reduced = false) {
	const sheet = new FEl('div');
	sheet.offsetHeight = 400;
	const atClose: { pulled: boolean; settling: boolean; pull: string }[] = [];
	const detach = attachSheetSwipe(sheet as never, {
		close: () => atClose.push({ pulled: sheet.hasClass('is-pulled'), settling: sheet.hasClass('is-settling'), pull: pull(sheet) }),
		reduced: () => reduced,
	});
	return { sheet, atClose, detach };
}

describe('D262: a swipe close keeps the sheet off the screen until it is gone', () => {
	it('after a closing release the sheet keeps is-pulled and a pull of at least the release offset, also when close() runs', () => {
		const { sheet, atClose } = bareSheet();
		swipe(sheet, steps(130));
		expect(sheet.hasClass('is-pulled')).toBe(true);
		expect(px(sheet)).toBeGreaterThanOrEqual(130);
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose).toHaveLength(1);
		// The sheet height (400 px) is more than the pull: the sheet is fully off the screen when Obsidian starts its own slide.
		expect(atClose[0]).toEqual({ pulled: true, settling: false, pull: '400px' });
		// The owner has not taken the sheet away yet: nothing brings it back up.
		expect(sheet.hasClass('is-pulled')).toBe(true);
		expect(pull(sheet)).toBe('400px');
	});

	it('a pull longer than the sheet keeps the longer pull', () => {
		const { sheet, atClose } = bareSheet();
		sheet.offsetHeight = 100;
		swipe(sheet, steps(160));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose[0]?.pull).toBe('160px');
	});

	it('the reset comes with the detach: no class and no pull are left', () => {
		const { sheet, detach } = bareSheet();
		swipe(sheet, steps(130));
		runTimers(SWIPE_SETTLE_MS + 20);
		detach();
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(sheet.hasClass('is-settling')).toBe(false);
		expect(pull(sheet)).toBe('');
	});

	it('a detach during the move out stops it: close() never runs and the sheet is reset', () => {
		const { sheet, atClose, detach } = bareSheet();
		swipe(sheet, steps(130));
		detach();
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose).toHaveLength(0);
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(pull(sheet)).toBe('');
	});

	it('a new touch while the sheet slides out does not bring it back, and close() runs one time', () => {
		const { sheet, atClose } = bareSheet();
		swipe(sheet, steps(130));
		clock.now += 50;
		dispatch(sheet, 'pointerdown', pointer('touch', 2, 200, 300));
		expect(sheet.hasClass('is-pulled')).toBe(true);
		expect(pull(sheet)).toBe('400px');
		dispatch(sheet, 'pointermove', pointer('touch', 2, 200, 320));
		dispatch(sheet, 'pointerup', pointer('touch', 2, 200, 320));
		expect(pull(sheet)).toBe('400px');
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose).toHaveLength(1);
	});

	it('with reduced movement it closes at once, with the sheet already off the screen (no jump to the top first)', () => {
		const { sheet, atClose } = bareSheet(true);
		swipe(sheet, steps(130));
		expect(atClose).toEqual([{ pulled: true, settling: false, pull: '400px' }]);
	});

	it('the move back of a short slow pull is unchanged: the sheet is reset when it is back', () => {
		const { sheet, atClose } = bareSheet();
		swipe(sheet, steps(40), 100, 300);
		expect(sheet.hasClass('is-settling')).toBe(true);
		expect(pull(sheet)).toBe('0px');
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose).toHaveLength(0);
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(sheet.hasClass('is-settling')).toBe(false);
		expect(pull(sheet)).toBe('');
		// And the sheet takes a new swipe.
		swipe(sheet, steps(130));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(atClose).toHaveLength(1);
	});

	it('with reduced movement the move back is at once and leaves nothing', () => {
		const { sheet } = bareSheet(true);
		swipe(sheet, steps(40), 100, 300);
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(pull(sheet)).toBe('');
	});
});

describe('D262: the phone popover sheets (More, Line styles) after a swipe close', () => {
	it('the sheet and its cover are removed, and the removed sheet keeps no class and no pull', async () => {
		phone();
		const { root } = await openFullScreen(`people:\n  - {id: ann, name: Ann Valmont, born: 1100}\n`);
		dispatch(root.querySelector('.dynasty-more')!, 'click', { button: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
		const sheet = root.querySelector('.dynasty-popover-more')!;
		swipe(sheet.querySelector('.dynasty-sheet-grip')!, steps(130));
		runTimers(SWIPE_SETTLE_MS + 20);
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
		expect(root.querySelector('.dynasty-cover')).toBeNull();
		expect(sheet.hasClass('is-pulled')).toBe(false);
		expect(sheet.hasClass('is-settling')).toBe(false);
		expect(pull(sheet)).toBe('');
		// A new sheet opens at rest.
		dispatch(root.querySelector('.dynasty-more')!, 'click', { button: 0, detail: 1 });
		await settle();
		const again = root.querySelector('.dynasty-popover-more')!;
		expect(again).not.toBe(sheet);
		expect(again.hasClass('is-pulled')).toBe(false);
		expect(pull(again)).toBe('');
	});
});
