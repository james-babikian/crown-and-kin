import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Fix round of 0.4 part 3, question B of the G2 of part 3: the tap area of a fold control is cut back against the `+` badge discs. A new card corner radius (a theme change)
 * moves the discs with the same layout and zoom, so the next settle must place the fold tap areas again. Before the fix the stamp of a fold tap area did not change, and the
 * area stayed cut for the old disc (seen in Obsidian: it lay 1.5 px over the new disc).
 */

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fullViews } from '../acceptance/tree-view-fakes';
import { openFull, rectOf, sample, upright, type Priv } from '../support/r031-fix3-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
});

interface Inner extends Priv {
	settled(v: { scale: number; cx: number; cy: number }, byUser: boolean): void;
	placeFolds(v: { scale: number; cx: number; cy: number }): void;
	tapAreas: unknown[];
}

describe('fold tap areas after a change of the card corner radius', () => {
	it('the next settle at the same zoom places them again against the new discs', async () => {
		const { view: v } = await openFull(`options:\n  focus: thea-valmont\n\n${sample('07-four-hundred-people.md')}`, upright(16));
		const view = v as Inner;
		const scene = view.scene as unknown as { setCornerRadius(r: number): void; folds: { filled: boolean; hit: { getAttribute(n: string): string | null } | null }[]; badges: unknown[] };
		expect(scene.badges.length).toBeGreaterThan(0);
		const box = view.laid.layout.persons.get('thea-valmont')!;
		const at = { scale: 0.26, cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
		scene.setCornerRadius(2);
		view.settled(at, false);
		const rects = () => scene.folds.filter((f) => f.filled && f.hit).map((f) => JSON.stringify(rectOf(f.hit!)));
		expect(rects().length).toBeGreaterThan(0);
		scene.setCornerRadius(20);
		view.settled(at, false);
		const settled = rects();
		// What a placement of every control with the discs as they are now gives.
		view.placeFolds(at);
		expect(settled).toEqual(rects());
	});
});
