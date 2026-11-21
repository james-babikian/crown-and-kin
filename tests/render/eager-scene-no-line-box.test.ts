// An eager scene (Save as a picture, the headless renderer) never needs a line's box, so `pathBox` runs only for a lazy scene.
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/render/view-math', async (orig) => {
	const real = await orig<typeof import('../../src/render/view-math')>();
	return { ...real, pathBox: (...a: Parameters<typeof real.pathBox>) => (calls.n++, real.pathBox(...a)) };
});

import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../../src/layout/index';
import { buildScene, type SceneOptions } from '../../src/render/dom/scene';
import { FEl } from '../acceptance/fake-dom';
import { block15, graphOf } from '../acceptance/fold-note-crop-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

describe('the work of an eager scene', () => {
	it('an eager scene computes no line box (pathBox is called 0 times)', () => {
		clearLayoutCache();
		const g = graphOf(block15(0));
		const laid = layoutTree(g, geometryFor(16), DEFAULT_LAYOUT_SETTINGS, 'font');
		const opts = { fonts: { text: 'serif', ui: 'sans', bold: '600' }, measure: (s: string) => [...s].length * 10, link: () => null } as SceneOptions;
		calls.n = 0;
		buildScene(new FEl('g') as unknown as SVGGElement, g, laid, opts);
		expect(calls.n).toBe(0);
	});
});
