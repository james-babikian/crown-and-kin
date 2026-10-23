// 0.2.6 WP3 "fit": a change of the level of detail must restyle few elements. Proof on sample tree 07b (phone, 4x CPU): one class swap on the root
// restyled about 3 000 of 6 000 elements (108 ms) because every level rule was a descendant selector on a part of a card. The fix has three parts that this
// file guards:
// 1. A card keeps its bar, Full group, Compact name, sign and arms in one body group, and the Overview rules name that group.
// 2. `Scene.setDetail(false)` takes the body groups out of the document and `setDetail(true)` puts them back (lazy: through the fill, near the view first).
// 3. The tap areas of the open fold buttons are in one group, so one rule hides them.
// The pictures do not change: a scene with detail on is the scene before the fix, apart from the body group.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { buildScene, type Scene, type SceneFolds, type SceneOptions } from '../../src/render/dom/scene';
import { FEl } from '../acceptance/fake-dom';
import { block15, comments15, graphOf } from '../acceptance/m10-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const F = comments15();
const SOURCE = block15(0);
const GEO = geometryFor(16);
const FONTS = { text: 'serif', ui: 'sans', bold: '600' };
const measure = (s: string) => [...s].length * 10;
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const labelOf = (c: { key: string; folded: boolean; count: number }, names: readonly string[]) => `${c.folded ? 'show' : 'hide'}:${c.count}:${names.join('+')}`;
const FOLDS: SceneFolds = { buttons: true, label: labelOf };

/** Sample tree 15 with the fold set `label`, drawn eager or lazy. */
function draw(label: string, lazy: boolean): { scene: Scene; root: FEl; w: number; h: number } {
	const set = F.sets.get(label)!;
	clearLayoutCache();
	const g = graphOf(SOURCE);
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...set.hides].sort(), foldedFamilies: set.folds.map((n) => F.folds.get(n)!.key).sort(), foldControls: true } as LayoutSettings;
	const laid = layoutTree(g, GEO, settings, 'font');
	const root = new FEl('g');
	const options = { fonts: FONTS, measure, link: () => null, folds: lazy ? { ...FOLDS, lazy: true } : FOLDS, ...(lazy ? { lazyCards: true } : {}) } as SceneOptions;
	const scene = buildScene(root as unknown as SVGGElement, g, laid, options);
	return { scene, root, w: laid.layout.width, h: laid.layout.height };
}

const cardsOf = (root: FEl) => all(root).filter((e) => e.hasClass('dynasty-card') && e.tag === 'g');
const bodiesIn = (root: FEl) => all(root).filter((e) => e.hasClass('dynasty-card-body'));
const WHOLE = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };


describe('R (scratch): stale idle chain after setDetail', () => {
	it('a chunk fill at the same view centre still fills the groups that setDetail(true) put back to wait', () => {
		const lazy = draw('none', true);
		const cards = cardsOf(lazy.root).length;
		// The idle chain runs to its end at one view centre (here the whole tree).
		while (lazy.scene.fill.pending > 0) if (lazy.scene.fill.fillChunk(WHOLE, 50) === 0) break;
		expect(bodiesIn(lazy.root)).toHaveLength(cards);
		// The user zooms out to Overview and back in around the same centre.
		lazy.scene.setDetail(false);
		lazy.scene.setDetail(true);
		expect(lazy.scene.fill.pending).toBeGreaterThanOrEqual(cards);
		let guard = 0;
		while (lazy.scene.fill.pending > 0 && guard++ < 1000) lazy.scene.fill.fillChunk(WHOLE, 5);
		// The idle chain makes no progress: the pending work never ends and no body group comes back.
		expect(lazy.scene.fill.pending).toBe(0);
		expect(bodiesIn(lazy.root)).toHaveLength(cards);
	});
});
