import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockState } from '../../src/view/block-state';
import { FEl, dispatch, flushFrames, resetDom, resizeAll, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { fixtureSource } from './load';
import { openFullScreen, phone, phoneOnSide } from './tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP-6 (D257) on the tree view with the fake DOM: a focus view on a phone held upright starts with the far families folded ("+ N" signs); one tap on a sign
 * opens one family like a fold of the owner; Clear focus takes out the automatic folds and keeps the owner's own. The rule itself is in `r032-wp6-start-folds.test.ts`.
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const EDMUND = `options:\n  focus: edmund-valmont\n\n${fixtureSource('07')}`;
const signs = (root: FEl) => root.querySelectorAll('.dynasty-fold').filter((c) => c.hasClass('is-folded'));
const buttons = (root: FEl) => root.querySelectorAll('.dynasty-fold').filter((c) => c.hasClass('is-open'));
const cards = (root: FEl) => root.querySelectorAll('.dynasty-card').length;
const signWith = (root: FEl, count: number) => signs(root).find((c) => (c.getAttribute('aria-label') ?? '').includes(`the ${count} hidden`));
const folds = (h: { state: unknown } | null) => (h!.state as BlockState).folds;
const auto = (h: { state: unknown } | null) => (h!.state as BlockState).autoFolds;

async function activate(c: FEl): Promise<void> {
	dispatch(c, 'keydown', { key: 'Enter', code: 'Enter' });
	await settle();
	resizeAll();
	flushFrames();
}

async function clearFocus(root: FEl): Promise<void> {
	dispatch(root.querySelector('.dynasty-focus-bar-clear')!, 'click', { button: 0, clientX: 10, clientY: 10 });
	await settle();
	resizeAll();
	flushFrames();
}

describe('D257 on the tree view: the far families of a focus start folded on a phone held upright', () => {
	it('Edmund Valmont: three signs (+12, +1, +2), the people below them are not drawn, the folds are in the block state apart from the owner\'s', async () => {
		phone();
		const { root, handle } = await openFullScreen(EDMUND);
		expect(signs(root).map((s) => /\+ \d+$/.exec(s.getText())![0]).sort()).toEqual(['+ 1', '+ 12', '+ 2']);
		expect(folds(handle).size).toBe(3);
		expect(auto(handle)?.size).toBe(3);
		const drawn = cards(root);
		// One tap on the "+ 12": the 12 people appear, as for a fold of the owner.
		await activate(signWith(root, 12)!);
		expect(cards(root)).toBe(drawn + 12);
		expect(folds(handle).size).toBe(2);
		expect(auto(handle)?.size).toBe(2);
		// A redraw does not fold the family again.
		resizeAll();
		flushFrames();
		expect(signWith(root, 12)).toBeUndefined();
		expect(cards(root)).toBe(drawn + 12);
	});

	it('Clear focus keeps the folds of the owner and takes out the automatic folds', async () => {
		phone();
		const { root, handle } = await openFullScreen(EDMUND);
		const own = buttons(root)[0];
		expect(own).toBeDefined();
		await activate(own);
		const mine = [...folds(handle)].filter((k) => !auto(handle)!.has(k));
		expect(mine.length).toBe(1);
		await clearFocus(root);
		expect([...folds(handle)]).toEqual(mine);
		expect(auto(handle)?.size).toBe(0);
		expect(signs(root).length).toBe(1);
	});

	it('a phone held on its side (the tree top to bottom) starts nothing', async () => {
		phoneOnSide();
		const { root, handle } = await openFullScreen(EDMUND);
		expect(signs(root).length).toBe(0);
		expect(folds(handle).size).toBe(0);
	});
});
