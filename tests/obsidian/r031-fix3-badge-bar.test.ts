import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 0.3.1 third repair round, point 2 (G5 harness failure 7): on a phone held sideways (the tree top to bottom), sample tree 7 pinned on
 * ingrid-orsini opens with the "+" badge circle of Matthias Orsini whole below the focus bar, but the upper part of its 44 px press square
 * under the opaque bar. The rule: in the full-screen view the first view keeps the badge's whole press square out of the top band (the
 * safe area, the bars and 4 px), as V3 does for the circle. D244 (the edited card keeps its place) still wins after an edit.
 */

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clock, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fullViews } from '../acceptance/tree-view-fakes';
import { onScreen, openFull, rectOf, sample, side, upright, type Priv, type Screen } from '../support/r031-fix3-support';
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

const open = async (source: string, s: Screen) => (await openFull(source, s)).view;

/** The badges whose press square shows on the screen at all, with the square and the circle on screen. */
function shownSquares(view: Priv, s: Screen) {
	return (view.scene?.badges ?? [])
		.map((b) => ({ id: b.person, sq: onScreen(view, s, rectOf(b.hit)), mark: onScreen(view, s, b.mark) }))
		.filter((m) => m.sq.right > 0 && m.sq.left < s.w && m.sq.bottom > 0 && m.sq.top < s.h);
}

describe('0.3.1 fix3: the first view keeps the whole press square of a "+" badge out from under the focus bar', () => {
	for (const font of [16, 21]) {
		it(`sample tree 7 pinned on ingrid-orsini, phone held sideways, note font ${font} px: every press square on the screen is below the band (the focus bar and 4 px) or above the screen`, async () => {
			const s = side(font);
			const view = await open(`options:\n  focus: ingrid-orsini\n\n${sample('07-four-hundred-people.md')}`, s);
			expect(view.focusId).toBe('ingrid-orsini');
			expect(view.laid.layout.orientation).toBe('down');
			expect(view.insetTop).toBeGreaterThanOrEqual(52);
			const shown = shownSquares(view, s);
			expect(shown.length).toBeGreaterThan(0);
			for (const m of shown) expect(m.sq.top >= view.insetTop - 0.5 || m.mark.bottom <= 0.5, `square of ${m.id} at ${m.sq.top.toFixed(1)}..${m.sq.bottom.toFixed(1)}, band 0..${view.insetTop}`).toBe(true);
			const me = onScreen(view, s, view.laid.layout.persons.get('ingrid-orsini')!);
			expect(me.top).toBeGreaterThanOrEqual(view.insetTop - 0.5);
			expect(me.bottom).toBeLessThanOrEqual(s.h - view.insetBottom + 0.5);
		});
	}

	for (const font of [16, 21]) {
		it(`sample tree 7 pinned on ingrid-orsini, phone upright with the direction "Like the computer" (the G5 case), note font ${font} px: every press square on the screen is below the band or above the screen`, async () => {
			const s = upright(font);
			const view = (await openFull(`options:
  focus: ingrid-orsini

${sample('07-four-hundred-people.md')}`, s, { phoneDirection: 'down' })).view;
			expect(view.focusId).toBe('ingrid-orsini');
			expect(view.laid.layout.orientation).toBe('down');
			const shown = shownSquares(view, s);
			expect(shown.length).toBeGreaterThan(0);
			for (const m of shown) expect(m.sq.top >= view.insetTop - 0.5 || m.mark.bottom <= 0.5, `square of ${m.id} at ${m.sq.top.toFixed(1)}..${m.sq.bottom.toFixed(1)}, band 0..${view.insetTop}`).toBe(true);
		});
	}

	for (const font of [16, 21, 28]) {
		it(`sample tree 7 upright, focus Rosalind Veyle, note font ${font} px (the V3 case): every press square on the screen is below the band or its badge is above the screen`, async () => {
			const s = upright(font);
			const view = await open(`options:\n  focus: rosalind-veyle\n\n${sample('07-four-hundred-people.md')}`, s);
			expect(view.focusId).toBe('rosalind-veyle');
			const shown = shownSquares(view, s);
			expect(shown.length).toBeGreaterThan(0);
			for (const m of shown) expect(m.sq.top >= view.insetTop - 0.5 || m.mark.bottom <= 0.5, `square of ${m.id} at ${m.sq.top.toFixed(1)}..${m.sq.bottom.toFixed(1)}, band 0..${view.insetTop}`).toBe(true);
		});
	}
});
