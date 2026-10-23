import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { FEl, clock, flushFrames, resetDom, resizeAll } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.8 I43 (D194): a change of the note's text size keeps the zoom and the centre of the view (no new first view).
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `people:
  - {id: a, name: Aldric, born: 1100}
  - {id: b, name: Bera, born: 1102}
  - {id: c, name: Cael, born: 1130, parents: [a, b]}
  - {id: d, name: Dag, born: 1133, parents: [a, b]}
  - {id: e, name: Edda, born: 1160, parents: [c]}
unions:
  - {partners: [a, b], type: marriage}
`;

function screen(root: FEl) {
	const t = root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '';
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t);
	if (!m) throw new Error(`transform ${t}`);
	return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
}

function card(root: FEl, id: string) {
	const bg = root.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`)!;
	return { x: Number(bg.getAttribute('x')), y: Number(bg.getAttribute('y')), w: Number(bg.getAttribute('width')), h: Number(bg.getAttribute('height')) };
}

/** The person whose card centre is nearest the middle of the viewport. */
function centrePerson(root: FEl, w: number, h: number): string {
	const { tx, ty, s } = screen(root);
	let best = { id: '', d: Infinity };
	for (const id of ['a', 'b', 'c', 'd', 'e']) {
		const c = card(root, id);
		const d = Math.hypot(tx + (c.x + c.w / 2) * s - w / 2, ty + (c.y + c.h / 2) * s - h / 2);
		if (d < best.d) best = { id, d };
	}
	return best.id;
}

describe('I43: a text-size change keeps the zoom and the centre', () => {
	it('the scale and the person at the centre stay when the note font grows from 16 px to 20 px', async () => {
		desktop();
		const { el, view } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		const vp = el.querySelector('.dynasty-viewport')!;
		const before = screen(el);
		const who = centrePerson(el, vp.clientWidth, vp.clientHeight);
		const wide = card(el, 'a').w;
		const grown = { fontSize: '20px', fontFamily: 'sans-serif', paddingTop: '0px', getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
		const real = (globalThis as Record<string, unknown>).getComputedStyle;
		(globalThis as Record<string, unknown>).getComputedStyle = () => grown;
		try {
			view.onCssChange();
			// The view drew a new tree box: it has its size once the browser lays it out.
			const now = el.querySelector('.dynasty-viewport')!;
			now.clientWidth = 360;
			now.clientHeight = 400;
			resizeAll();
			flushFrames();
		} finally {
			(globalThis as Record<string, unknown>).getComputedStyle = real;
		}
		const after = screen(el);
		// The cards follow the text size, so the tree was drawn again.
		expect(card(el, 'a').w).toBeGreaterThan(wide);
		expect(after.s).toBeCloseTo(before.s, 6);
		expect(centrePerson(el, vp.clientWidth, vp.clientHeight)).toBe(who);
	});
});
