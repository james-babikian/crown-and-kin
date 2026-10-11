// 0.2.6 WP3 "fit": a change of the level of detail must restyle few elements. Proof on sample tree 07b (phone, 4x CPU): one class swap on the root
// restyled about 3 000 of 6 000 elements (108 ms) because every level rule was a descendant selector on a part of a card. The fix has three parts that this
// file guards:
// 1. A card keeps its bar, Full group, Compact name, sign and arms in one body group, and the Overview rules name that group.
// 2. `Scene.setDetail(false)` takes the body groups out of the document and `setDetail(true)` puts them back (lazy: through the fill, near the view first).
// 3. The tap areas of the open fold buttons are in one group, so one rule hides them.
// The pictures do not change: a scene with detail on is the scene before the fix, apart from the body group.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { buildScene, type Scene, type SceneFolds, type SceneOptions } from '../src/render/dom/scene';
import { FEl, installDom } from './acceptance/fake-dom';
import { block15, comments15, graphOf } from './acceptance/m10-support';
import { serial } from './acceptance/m11-support';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

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
const EMPTY = { x: -1e7, y: -1e7, w: 1, h: 1 };

describe('R026 fit: the body group of a card', () => {
	it('every card has one body group, the last child of the card, with the bar, the Full group and the Compact name', () => {
		const { root } = draw('none', false);
		const cards = cardsOf(root);
		expect(cards.length).toBeGreaterThan(10);
		for (const c of cards) {
			const bodies = c.children.filter((e) => e.hasClass('dynasty-card-body'));
			expect(bodies).toHaveLength(1);
			expect(c.children[c.children.length - 1]).toBe(bodies[0]);
			const names = bodies[0].children.map((e) => [...e.classes][0]);
			expect(names.slice(0, 3)).toEqual(['dynasty-card-ribbon', 'dynasty-card-full', 'dynasty-card-compact']);
			// The bg rect stays outside: the Overview level draws it, in the house colour.
			expect(c.children.some((e) => e.hasClass('dynasty-card-bg'))).toBe(true);
		}
	});

	it('setDetail(false) takes every body group out, setDetail(true) puts the same elements back: the scene is the same as before', () => {
		const { scene, root } = draw('none', false);
		const before = serial(root);
		const n = bodiesIn(root).length;
		expect(n).toBe(cardsOf(root).length);
		scene.setDetail(false);
		expect(bodiesIn(root)).toHaveLength(0);
		scene.setDetail(false);
		scene.setDetail(true);
		expect(bodiesIn(root)).toHaveLength(n);
		expect(serial(root)).toBe(before);
	});

	it('a lazy scene: setDetail(true) makes the groups wait for the fill, the near ones come first, and a full fill gives the eager scene', () => {
		const eager = draw('none', false);
		const lazy = draw('none', true);
		lazy.scene.fill.fillAll();
		const cards = cardsOf(lazy.root).length;
		expect(bodiesIn(lazy.root)).toHaveLength(cards);
		lazy.scene.setDetail(false);
		expect(bodiesIn(lazy.root)).toHaveLength(0);
		expect(lazy.scene.fill.pending).toBe(0);
		lazy.scene.setDetail(true);
		// Nothing is in the document yet: every card waits for the fill.
		expect(bodiesIn(lazy.root)).toHaveLength(0);
		expect(lazy.scene.fill.pending).toBeGreaterThanOrEqual(cards);
		lazy.scene.fill.fillNear(EMPTY);
		expect(bodiesIn(lazy.root)).toHaveLength(0);
		lazy.scene.fill.fillChunk(WHOLE, 5);
		expect(bodiesIn(lazy.root).length).toBeGreaterThanOrEqual(5);
		expect(bodiesIn(lazy.root).length).toBeLessThan(cards);
		lazy.scene.fill.fillAll();
		expect(bodiesIn(lazy.root)).toHaveLength(cards);
		expect(lazy.scene.fill.pending).toBe(0);
		for (const f of lazy.scene.folds) f.fill();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('a lazy card that fills while detail is off keeps its group out until detail is on again, and no group is made twice', () => {
		const eager = draw('none', false);
		const lazy = draw('none', true);
		lazy.scene.setDetail(false);
		lazy.scene.fill.fillAll();
		expect(bodiesIn(lazy.root)).toHaveLength(0);
		lazy.scene.setDetail(true);
		lazy.scene.setDetail(false);
		lazy.scene.setDetail(true);
		lazy.scene.fill.fillAll();
		expect(lazy.scene.fill.pending).toBe(0);
		expect(bodiesIn(lazy.root)).toHaveLength(cardsOf(lazy.root).length);
		for (const f of lazy.scene.folds) f.fill();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('fillPerson brings the group of that card only, also after a level change', () => {
		const lazy = draw('none', true);
		lazy.scene.fill.fillAll();
		lazy.scene.setDetail(false);
		lazy.scene.setDetail(true);
		const id = [...lazy.scene.cards.keys()][3];
		lazy.scene.fill.fillPerson(id);
		const card = lazy.scene.cards.get(id) as unknown as FEl;
		expect(card.children.filter((e) => e.hasClass('dynasty-card-body'))).toHaveLength(1);
		expect(bodiesIn(lazy.root)).toHaveLength(1);
	});
});

describe('R026 fit: the tap areas of the open fold buttons', () => {
	it('an open button has its tap area in the group `dynasty-fold-hits-open`, a "+ N" sign in the tap-area layer itself; the group is the last child of the layer', () => {
		for (const lazy of [false, true]) {
			const { scene, root } = draw('A', lazy);
			if (lazy) for (const f of scene.folds) f.fill();
			const group = all(root).find((e) => e.hasClass('dynasty-fold-hits-open'))!;
			const layer = all(root).find((e) => e.hasClass('dynasty-tag-hits'))!;
			expect(group.parentElement).toBe(layer);
			expect(layer.children[layer.children.length - 1]).toBe(group);
			expect(scene.folds.some((f) => !f.control.folded)).toBe(true);
			expect(scene.folds.some((f) => f.control.folded)).toBe(true);
			for (const f of scene.folds) {
				const hit = f.hit as unknown as FEl;
				expect(hit.parentElement, f.control.key).toBe(f.control.folded ? layer : group);
			}
		}
	});
});

describe('R026 fit: styles.css names few elements at a level change', () => {
	const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
	const rules = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => ({ selectors: m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim()), text: m[0] }));
	/** The last compound of each selector of a rule that starts with the level class `lod`: the element that the browser must restyle on a class change. */
	const subjects = (lod: string) =>
		new Set(
			rules
				.flatMap((r) => r.selectors)
				.filter((s) => s.startsWith(`.dynasty-lod-${lod} `))
				.map((s) => s.split(/\s+|>/).filter(Boolean).pop()!),
		);

	it('the Overview level names only the body group, the bg rect, the tag pills, the fold parts and the crown tap area', () => {
		expect([...subjects('overview')].sort()).toEqual(
			[
				'.dynasty-card-bg',
				'.dynasty-card-body',
				'.dynasty-card-crown-hit',
				'.dynasty-fold-hits-open',
				'.dynasty-fold-pill',
				'.dynasty-fold-pill-big',
				'.dynasty-fold-text',
				'.dynasty-fold-text.is-sideways',
				'.dynasty-fold.is-open',
				'.dynasty-tag-compact',
				'.dynasty-tag-full',
				'.dynasty-tag-sign',
			].sort(),
		);
	});

	it('no rule of the Overview level names a part inside the body group (they would restyle every card again)', () => {
		const inside = ['.dynasty-card-full', '.dynasty-card-compact', '.dynasty-card-ribbon', '.dynasty-card-compact-sign', '.dynasty-card-compact-arms'];
		for (const s of subjects('overview')) expect(inside, s).not.toContain(s);
	});

	it('the Compact level still hides the Full group and shows the Compact name (the groups stay in the document at that level)', () => {
		expect(css).toMatch(/\.dynasty-lod-compact \.dynasty-card-full \{\s*display: none;/);
		expect(css).toMatch(/\.dynasty-lod-compact \.dynasty-card-compact \{\s*display: inline;/);
	});
});
