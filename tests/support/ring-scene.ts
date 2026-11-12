/*
 * Draws the Show view of a line of succession into the fake DOM and reads the places of its numbered rings. Not a test file: tests of the rings
 * (`tests/render/heir-ring-*.test.ts`) and the picture script share it. A ring's rectangle is read from the transform that `placeRings` writes, in scene units.
 */
import type { FamilyGraph } from '../../src/core/derive';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { LayoutSettings, Rect } from '../../src/layout/model';
import { RING_PX, placeRings, type HeirRing } from '../../src/render/dom/heir-ring';
import { COMPACT_NAME_EM, buildScene, type Scene } from '../../src/render/dom/scene';
import { successionDrawn } from '../../src/view/succession-view';
import { FEl } from '../acceptance/fake-dom';
import { fixture } from './helpers';

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

/** A ring on the page: its number, its rectangle (scene units) and whether it stands above its place (the Overview level only). */
export interface RingBox {
	id: string;
	text: string;
	rect: Rect;
	lifted: boolean;
}

/** The Show view of one title: the layout, the scene and what it takes to read the rings. */
export interface RingScene {
	g: FamilyGraph;
	laid: ReturnType<typeof layoutTree>;
	scene: Scene;
	root: FEl;
	/** The heirs, in line order: the ring with the number N belongs to the heir N - 1. */
	ids: string[];
	/** Where each heir's Compact name begins (scene units): its first two letters, from the end of the ribbon; the Roundel's centred name is not listed. */
	nameStart: Map<string, Rect>;
	/** Puts the rings for a level, a zoom and a device, and returns their rectangles (`reversed` hands the rings to `placeRings` in the other order). */
	place: (lod: 'compact' | 'overview', scale: number, phone: boolean, reversed?: boolean) => RingBox[];
}

/** Builds the scene of the Show view; undefined when the title has no line. `folds` draws the fold buttons, as the tree view does. */
export function ringScene(g: FamilyGraph, titleId: string, opts: { limit?: number; orientation?: 'down' | 'sideways'; folds?: boolean } = {}): RingScene | undefined {
	const d = successionDrawn(g, titleId, { limit: opts.limit ?? 5, oldAge: 110, youngDeathAge: 0 });
	if (!d) return undefined;
	clearLayoutCache();
	const form = cardForm(geometryFor(16), opts.orientation ?? 'down');
	const ordinalIds = [...d.ordinals.keys()];
	// The sideways tree is turned by the layout setting; the text card is its card form.
	const laid = layoutTree(g, form, { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), ordinalCards: ordinalIds, orientation: opts.orientation ?? 'down', ...(opts.folds ? { foldControls: true } : {}) } as LayoutSettings, 'test');
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, heirs: d.heirs, ordinals: d.ordinals, ...(opts.folds ? { folds: { buttons: true, label: () => 'Fold' } } : {}) });
	const nameStart = new Map<string, Rect>();
	const size = COMPACT_NAME_EM * laid.layout.geometry.fontPx;
	for (const card of all(root).filter((e) => e.hasClass('dynasty-card'))) {
		const compact = all(card).find((e) => e.hasClass('dynasty-card-compact'));
		if (!compact || laid.layout.geometry.form !== 'text') continue;
		nameStart.set(card.getAttribute('data-person')!, { x: Number(compact.getAttribute('x')), y: Number(compact.getAttribute('y')) - 0.75 * size, w: 2 * 0.55 * size, h: size });
	}
	const ids = d.heirs;
	const place = (lod: 'compact' | 'overview', scale: number, phone: boolean, reversed = false): RingBox[] => {
		const rings = reversed ? [...scene.rings].reverse() : scene.rings;
		for (const r of rings) r.stamp = '';
		placeRings(rings, lod, scale, phone);
		return rings.map((r) => boxOf(r, ids, lod === 'overview'));
	};
	return { g, laid, scene, root, ids, nameStart, place };
}

/** The rectangle of a placed ring, in scene units: its transform is `translate(x y) scale(k)` and the ring is `w` by `RING_PX.h` screen px. */
function boxOf(r: HeirRing, heirs: readonly string[], overview: boolean): RingBox {
	const [x, y] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(r.el.getAttribute('transform')!)!.slice(1).map(Number);
	const k = Number(/scale\(([^)]+)\)/.exec(r.el.getAttribute('transform')!)![1]);
	const w = r.w * k;
	const h = RING_PX.h * k;
	return { id: heirs[Number(r.spec.text) - 1], text: r.spec.text, rect: { x: x - w / 2, y: y - h / 2, w, h }, lifted: overview && y < r.spec.top.y - 0.01 };
}

/** True when two rectangles overlap by more than `clear` on both axes (a negative `clear` asks for a gap). */
export function overlaps(a: Rect, b: Rect, clear = 0): boolean {
	return a.x < b.x + b.w - clear && b.x < a.x + a.w - clear && a.y < b.y + b.h - clear && b.y < a.y + a.h - clear;
}

/** Sample tree 07b with the rule "eldest child first" on the Duke of Valmont, as the capture of the 0.5.3 design check made it (a line of 12 gave `v07b12`). */
export const VALMONT_NOTE = fixture('07b').replace('  - id: duke-of-valmont\n    name: Duke of Valmont\n', '  - id: duke-of-valmont\n    name: Duke of Valmont\n    succession: eldest-child\n');
