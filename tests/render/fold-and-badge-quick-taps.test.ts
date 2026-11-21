import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanZoom } from '../../src/render/dom/pan-zoom';
import { treeBounds } from '../../src/render/view-math';
import { FEl, clock, dispatch, pointer, resetDom, runFrame } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Design gate of WP-touch (0.5.7 step 7): the press-target list of `pan-zoom.ts` (TARGETS) is not the list of tap targets of the scene. A tap on a fold button or a
 * focus badge tap area counts as a tap on the background, so two quick taps zoom. A new shared target list must fix this, not copy it.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

function make(): { vp: FEl; hitsParent: FEl; pz: PanZoom } {
	const vp = new FEl('div', { cls: 'dynasty-viewport' });
	const canvas = vp.createDiv({ cls: 'dynasty-canvas' });
	const svg = canvas.createSvg('svg', { cls: 'dynasty-svg' });
	const scene = svg.createSvg('g', { cls: 'dynasty-scene' });
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: scene as unknown as SVGGElement,
		wrapper: canvas as unknown as HTMLElement,
		bounds: treeBounds(4000, 2000),
		fontPx: 16,
		interactive: true,
		mode: 'full',
		onSettle: () => undefined,
		guard: (fn: () => void) => fn(),
	} as never);
	pz.resize({ w: 800, h: 600 });
	pz.setView({ scale: 1, cx: 2000, cy: 1000 });
	runFrame();
	return { vp, hitsParent: scene, pz };
}

describe('the target list of the pan code against the tap targets of the scene', () => {
	for (const [group, cls] of [['dynasty-tag-hits', 'dynasty-fold-hit'], ['dynasty-badge-hits', 'dynasty-focus-badge-hit']] as const) {
		it(`two quick taps on .${cls} do not zoom the tree`, () => {
			const m = make();
			const target = m.hitsParent.createSvg('g', { cls: group }).createSvg('rect', { cls });
			const before = m.pz.view!;
			for (let i = 0; i < 2; i++) {
				dispatch(target, 'pointerdown', pointer('touch', 5, 300, 200));
				dispatch(target, 'pointerup', pointer('touch', 5, 300, 200));
				clock.now += 100;
			}
			expect(m.pz.view!.scale).toBe(before.scale);
		});
	}
});
