import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, geometryFor, layoutTree } from '../../src/layout/index';
import type { LaidOut, LayoutSettings } from '../../src/layout/model';
import { endSessionFocus, focusKey, newBlockState } from '../../src/obsidian/block-state';
import { buildScene, type Scene, type SceneFolds, type SceneOptions } from '../../src/render/dom/scene';
import type { SavedParts } from '../../src/render/saved-picture';
import type { foldHit as FoldHitFn, keepSpot as KeepSpotFn } from '../../src/render/view-math';
import { renderSvg, type SvgFolds, type SvgOptions } from '../../src/render/svg-string';
import { FEl, dispatch, fakeWin, flushFrames, installDom, resetDom, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { block15, comments15, graphOf, loadModule } from './m10-support';
import { desktop, embed, fakeHandle, openFullScreen, openSheetOn, phone, sheets } from './tree-view-fakes';

/*
 * Spec §13.10 (D83–D85) and the M10 fold rules F6-F10, F14-F16: the fold controls in the
 * scene (buttons, "+ N" signs, hit areas, roles, labels, Tab order), no controls in the static phone
 * preview, `keepSpot` and `foldHit`, the fold state of a block (ends with the note, is not written), the
 * saved picture (signs, no buttons) and the tree view on the fake DOM (a control folds with Enter, the
 * sheet's Hide and Show descendants). The expected people and counts come from the comments of sample
 * tree 15. These tests wait for WP 10.2b (scene, view math, saved picture) and WP 10.3c (block state,
 * tree view, sheet). What cannot run here is listed at the end with the reason.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
});

afterEach(() => vi.restoreAllMocks());

const F = comments15();
const SOURCE = block15(0);
const GEO = geometryFor(16, 'normal');
const EM = 16;
const FONTS = { text: 'serif', ui: 'sans', bold: '600' };
/** 10 px per character in every font. */
const measure = (s: string) => [...s].length * 10;
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

type Settings = LayoutSettings;
type Drawn = { g: ReturnType<typeof graphOf>; laid: LaidOut; scene: Scene; root: FEl };

/** Sample tree 15 folded as the comments say for `label`, laid out with controls and drawn with the scene. */
function draw(label: string, folds: SceneFolds | undefined, more: Partial<SceneOptions> = {}): Drawn {
	const set = F.sets.get(label)!;
	clearLayoutCache();
	const g = graphOf(SOURCE);
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...set.hides].sort(), foldedFamilies: set.folds.map((n) => F.folds.get(n)!.key).sort(), foldControls: true } as Settings;
	const laid = layoutTree(g, GEO, settings, 'font');
	const root = new FEl('g');
	const options = { fonts: FONTS, measure, link: () => null, ...(folds ? { folds } : {}), ...more } as SceneOptions;
	const scene = buildScene(root as unknown as SVGGElement, g, laid, options);
	return { g, laid, scene, root };
}

/** A label function that shows what the scene passed to it. */
const labelOf = (c: { key: string; folded: boolean; count: number }, names: readonly string[]) => `${c.folded ? 'show' : 'hide'}:${c.count}:${names.join('+')}`;
const FOLDS: SceneFolds = { buttons: true, label: labelOf };

describe('F6, F7, F16: the controls in the scene', () => {
	it('every control of the layout is drawn: a group `dynasty-fold` with `is-open` or `is-folded`, and a tap area `dynasty-fold-hit`', () => {
		for (const label of ['none', 'A', 'A+B', 'TWO2+BQ']) {
			const d = draw(label, FOLDS);
			const controls = d.laid.layout as unknown as { folds: { key: string; folded: boolean }[] };
			expect(d.scene.folds.length, label).toBe(controls.folds.length);
			for (const ref of d.scene.folds) {
				expect((ref.el as unknown as FEl).hasClass('dynasty-fold'), `${label} ${ref.control.key}`).toBe(true);
				expect((ref.el as unknown as FEl).hasClass(ref.control.folded ? 'is-folded' : 'is-open'), `${label} ${ref.control.key}`).toBe(true);
				expect((ref.el as unknown as FEl).hasClass(ref.control.folded ? 'is-open' : 'is-folded'), `${label} ${ref.control.key}`).toBe(false);
				expect((ref.hit as unknown as FEl).hasClass('dynasty-fold-hit'), `${label} ${ref.control.key}`).toBe(true);
			}
		}
	});

	it('the open button is a circle 1.2 em across on the spot; the sign is a pill 1.25 em high that starts half its height left of the spot (it grows to the right)', () => {
		const d = draw('A', FOLDS);
		const button = (d.scene.folds).find((r) => !r.control.folded)!;
		expect(button.mark.w).toBeCloseTo(1.2 * EM, 6);
		expect(button.mark.h).toBeCloseTo(1.2 * EM, 6);
		expect(button.mark.x + button.mark.w / 2).toBeCloseTo(button.control.spot.x, 6);
		expect(button.mark.y + button.mark.h / 2).toBeCloseTo(button.control.spot.y, 6);
		const sign = (d.scene.folds).find((r) => r.control.folded)!;
		expect(sign.control.count).toBe(75);
		expect(sign.mark.h).toBeCloseTo(1.25 * EM, 6);
		expect(sign.mark.x).toBeCloseTo(sign.control.spot.x - (1.25 * EM) / 2, 6);
		expect(sign.mark.y + sign.mark.h / 2).toBeCloseTo(sign.control.spot.y, 6);
		// "+ 75" is 4 characters of 10 px; the pill is the text plus 0.9 em wide.
		expect(sign.mark.w).toBeCloseTo(40 + 0.9 * EM, 6);
	});

	it('the sign shows the text "+ N" (the size 0.8 em and the weight 600 are in the styles)', () => {
		const d = draw('A+B', FOLDS);
		const texts = (d.scene.folds).filter((r) => r.control.folded).map((r) => all(r.el as unknown as FEl).filter((e) => e.tag === 'text').map((t) => t.getText()));
		expect(texts.sort()).toEqual([['+ 14'], ['+ 75']]);
	});

	it('the Overview sign is larger: 2 em high, in its own mark (`markOverview`); buttons have none', () => {
		const d = draw('A', FOLDS);
		for (const ref of d.scene.folds) {
			if (!ref.control.folded) {
				expect(ref.markOverview, ref.control.key).toBeUndefined();
				continue;
			}
			expect(ref.markOverview).toBeDefined();
			expect(ref.markOverview!.h).toBeCloseTo(2 * EM, 6);
			expect(ref.markOverview!.x).toBeCloseTo(ref.control.spot.x - EM, 6);
			expect(ref.markOverview!.y + ref.markOverview!.h / 2).toBeCloseTo(ref.control.spot.y, 6);
			expect(ref.markOverview!.w).toBeGreaterThan(ref.mark.w);
		}
	});

	it('each control is a button for keyboard and screen reader: role="button", tabindex="0", the label from `SceneFolds.label` with the names of the parents in order, and the same text as a <title> tooltip', () => {
		const d = draw('A+B', FOLDS);
		for (const ref of d.scene.folds) {
			const el = ref.el as unknown as FEl;
			const names = ref.control.parents.map((id) => d.g.byId.get(id)!.name);
			const want = labelOf(ref.control, names);
			expect(el.getAttribute('role'), want).toBe('button');
			expect(el.getAttribute('tabindex'), want).toBe('0');
			expect(el.getAttribute('aria-label'), want).toBe(want);
			const title = el.children.find((c) => c.tag === 'title');
			expect(title?.getText(), want).toBe(want);
		}
	});

	it('the tap areas lie in the hit layer, below the cards', () => {
		const d = draw('A', FOLDS);
		const order = all(d.root);
		const firstCard = order.findIndex((e) => e.hasClass('dynasty-card'));
		expect(firstCard).toBeGreaterThan(0);
		for (const ref of d.scene.folds) {
			const at = order.indexOf(ref.hit as unknown as FEl);
			expect(at, ref.control.key).toBeGreaterThanOrEqual(0);
			expect(at, ref.control.key).toBeLessThan(firstCard);
			// The hit area is not inside the visible group of the control.
			expect((ref.hit as unknown as FEl).closest('.dynasty-fold')).toBeNull();
		}
	});

	it('Tab order: a control follows the card group of the later of its parents, and comes before the next card', () => {
		const d = draw('A', FOLDS);
		const order = all(d.root);
		const cardIndex = (id: string) => order.findIndex((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id);
		const cardIndexes = order.map((e, i) => (e.hasClass('dynasty-card') ? i : -1)).filter((i) => i >= 0);
		for (const ref of d.scene.folds) {
			const at = order.indexOf(ref.el as unknown as FEl);
			const later = Math.max(...ref.control.parents.map(cardIndex));
			expect(at, ref.control.key).toBeGreaterThan(later);
			const nextCard = cardIndexes.find((i) => i > later);
			if (nextCard !== undefined) expect(at, ref.control.key).toBeLessThan(nextCard);
		}
	});

	it('the "+ N" signs only (a saved picture, D71): no open button is drawn', () => {
		const d = draw('A+B', { buttons: false, label: labelOf });
		const refs = d.scene.folds;
		expect(refs.length).toBe(2);
		expect(refs.every((r) => r.control.folded)).toBe(true);
		expect(all(d.root).filter((e) => e.hasClass('dynasty-fold') && e.hasClass('is-open'))).toEqual([]);
	});
});

describe('F8: the static phone preview has no controls', () => {
	it('without `SceneOptions.folds` no control is drawn, although the layout has them', () => {
		const d = draw('A', undefined);
		expect(d.scene.folds ?? []).toEqual([]);
		expect(all(d.root).filter((e) => e.hasClass('dynasty-fold') || e.hasClass('dynasty-fold-hit'))).toEqual([]);
		expect(all(d.root).some((e) => e.getText().startsWith('+ '))).toBe(false);
	});

	it('a layout without `foldControls` has no controls, whatever the scene is asked', () => {
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const laid = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS } as Settings, 'font');
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, folds: FOLDS } as SceneOptions);
		expect(scene.folds ?? []).toEqual([]);
	});
});

describe('F10 `keepSpot` and F7 `foldHit` (render/view-math.ts)', () => {
	it('keepSpot moves the view so that the new spot shows where the old spot showed; the scale is kept', async () => {
		const { keepSpot } = await loadModule<{ keepSpot: typeof KeepSpotFn }>('../../src/render/view-math', 'src/render/view-math.ts', 'WP 10.2b', ['keepSpot']);
		// The view is the layout point at the centre of the viewport and the zoom. The old spot at (50, 60) lands at the same screen point as the new spot at (80, 90).
		expect(keepSpot({ scale: 2, cx: 100, cy: 200 }, { x: 50, y: 60 }, { x: 80, y: 90 })).toEqual({ scale: 2, cx: 130, cy: 230 });
		expect(keepSpot({ scale: 0.5, cx: 100, cy: 200 }, { x: 80, y: 90 }, { x: 50, y: 60 })).toEqual({ scale: 0.5, cx: 70, cy: 170 });
		// The same spot: nothing moves.
		expect(keepSpot({ scale: 1, cx: 7, cy: 9 }, { x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ scale: 1, cx: 7, cy: 9 });
	});

	it('the screen point of the spot is the same before and after (transformFor)', async () => {
		const { keepSpot } = await loadModule<{ keepSpot: typeof KeepSpotFn }>('../../src/render/view-math', 'src/render/view-math.ts', 'WP 10.2b', ['keepSpot']);
		const view = { scale: 1.5, cx: 400, cy: 300 };
		const from = { x: 380, y: 340 };
		const to = { x: 455, y: 341 };
		const next = keepSpot(view, from, to);
		const screen = (v: typeof view, p: { x: number; y: number }, size = { w: 800, h: 600 }) => ({ x: (p.x - v.cx) * v.scale + size.w / 2, y: (p.y - v.cy) * v.scale + size.h / 2 });
		const before = screen(view, from);
		const after = screen(next, to);
		expect(after.x).toBeCloseTo(before.x, 9);
		expect(after.y).toBeCloseTo(before.y, 9);
	});

	it('foldHit: at least 44 screen px each way (44 / scale layout px), centred on the centre of the visible mark', async () => {
		const { foldHit } = await loadModule<{ foldHit: typeof FoldHitFn }>('../../src/render/view-math', 'src/render/view-math.ts', 'WP 10.2b', ['foldHit']);
		const button = { x: 100 - 9.6, y: 200 - 9.6, w: 19.2, h: 19.2 };
		const one = foldHit(button, 1);
		expect(one).toEqual({ x: 100 - 22, y: 200 - 22, w: 44, h: 44 });
		const half = foldHit(button, 0.5);
		expect(half).toEqual({ x: 100 - 44, y: 200 - 44, w: 88, h: 88 });
		const twice = foldHit(button, 2);
		expect(twice.w).toBeCloseTo(22, 9);
		expect(twice.x + twice.w / 2).toBeCloseTo(100, 9);
		// A sign wider than 44 px: the centre of the pill, each way at least 44.
		const pill = { x: 90, y: 190, w: 54.4, h: 20 };
		const h = foldHit(pill, 1);
		expect(h.w).toBeGreaterThanOrEqual(44);
		expect(h.h).toBeGreaterThanOrEqual(44);
		expect(h.x + h.w / 2).toBeCloseTo(pill.x + pill.w / 2, 9);
		expect(h.y + h.h / 2).toBeCloseTo(pill.y + pill.h / 2, 9);
	});
});

describe('F9: the fold state of a block (D84)', () => {
	it('`newBlockState` has an empty set of folds; `endSessionFocus` (the note closed) empties it; the focus key does not include folds', () => {
		const st = newBlockState() as ReturnType<typeof newBlockState> & { folds: Set<string> };
		expect(st.folds).toBeInstanceOf(Set);
		expect(st.folds.size).toBe(0);
		const before = focusKey(null, 0);
		st.folds.add('["a","b"]');
		st.folds.add('["c"]');
		expect(focusKey(null, 0)).toBe(before);
		endSessionFocus(st);
		expect(st.folds.size).toBe(0);
		// Two blocks do not share their folds.
		const other = newBlockState() as typeof st;
		other.folds.add('["x"]');
		expect(st.folds.size).toBe(0);
	});

	it('the other memory of a block stays when the note closes (the view), as before', () => {
		const st = newBlockState();
		st.view = { scale: 1, cx: 1, cy: 2 };
		endSessionFocus(st);
		expect(st.view).toEqual({ scale: 1, cx: 1, cy: 2 });
	});
});

describe('F14: the saved picture (spec §13.8, D71): "+ N" signs, no open buttons', () => {
	const svg = (label: string, extra: object = {}, saved = true) => {
		const set = F.sets.get(label)!;
		clearLayoutCache();
		const g = graphOf(SOURCE);
		const folded = set.folds.map((n) => F.folds.get(n)!.key).sort();
		const laid = layoutTree(g, GEO, { ...DEFAULT_LAYOUT_SETTINGS, foldHidden: [...set.hides].sort(), foldedFamilies: folded, foldControls: true } as Settings, 'font');
		const parts: SavedParts = { heading: 'Tree', legend: { kinds: [], sign: false, houses: [] }, pictures: new Map(), scale: 1, folds: new Set(folded) };
		const options = { measure: (s: string) => measure(s), fonts: FONTS, ...(saved ? { saved: parts } : { folds: { buttons: true } as SvgFolds }), ...extra } as SvgOptions;
		return { svg: renderSvg(g, laid.layout, laid.edges, options), laid, set };
	};
	const unescape = (t: string) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	const items = (s: string) => [...s.matchAll(/data-item="([^"]+)"/g)].map((m) => unescape(m[1]));

	it('a saved picture has a `fold:<key>` item and the text "+ N" for each folded family, and nothing for an open one', () => {
		const { svg: text, set } = svg('A+B');
		const folds = items(text).filter((i) => i.startsWith('fold:'));
		expect(folds.sort()).toEqual(set.folds.map((n) => `fold:${F.folds.get(n)!.key}`).sort());
		expect(text).toContain('>+ 75</text>');
		expect(text).toContain('>+ 14</text>');
	});

	it('a saved picture with folds that are all open has no fold item at all', () => {
		const { svg: text } = svg('none');
		expect(items(text).filter((i) => i.startsWith('fold:'))).toEqual([]);
		expect(text).not.toMatch(/>\+ \d+</);
	});

	it('the picture shows the cards of the folded tree only', () => {
		const { svg: text, set } = svg('A');
		const cards = items(text).filter((i) => i.startsWith('card:'));
		expect(cards).toHaveLength(96 - set.hides.length);
		expect(cards).not.toContain('card:lucan');
		expect(cards).toContain('card:wanda');
	});

	it('the headless picture of the spike (`folds.buttons` true, not saved) draws the signs and, besides them, the buttons of the open families', () => {
		const withButtons = svg('A', {}, false).svg;
		const signsOnly = svg('A', { folds: { buttons: false } }, false).svg;
		expect(withButtons).toContain('>+ 75</text>');
		expect(signsOnly).toContain('>+ 75</text>');
		expect(withButtons.length).toBeGreaterThan(signsOnly.length);
	});
});

describe('D83–D85 on the tree view (fake DOM): a control folds with Enter, the state lives on the block, nothing is written', () => {
	const A_LABEL = 'Hide the people below Osric Valmont and Mathilde Harrow';
	const A_SIGN = 'Show the 75 hidden people below Osric Valmont and Mathilde Harrow';
	const controlWith = (el: FEl, label: string) => el.querySelectorAll('.dynasty-fold').find((c) => c.getAttribute('aria-label') === label);
	const cardCount = (el: FEl) => el.querySelectorAll('.dynasty-card').length;
	const press = async (c: FEl, key = 'Enter') => {
		dispatch(c, 'keydown', { key, code: key === ' ' ? 'Space' : key });
		await settle();
		flushFrames();
	};

	it('the computer view has a button for each family; the labels are those of spec §13.10; Enter folds, Enter on the sign opens; a fold writes nothing', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		const { el } = await embed(SOURCE, { handle });
		expect(cardCount(el)).toBe(96);
		expect(el.querySelectorAll('.dynasty-fold').length).toBeGreaterThan(15);
		expect(el.querySelectorAll('.dynasty-fold').every((c) => c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0')).toBe(true);
		const button = controlWith(el, A_LABEL)!;
		expect(button).toBeDefined();
		await press(button);
		expect(cardCount(el)).toBe(96 - 75);
		expect((handle.state as unknown as { folds: Set<string> }).folds).toEqual(new Set([F.folds.get('A')!.key]));
		const sign = controlWith(el, A_SIGN)!;
		expect(sign).toBeDefined();
		expect(sign.hasClass('is-folded')).toBe(true);
		expect(controlWith(el, A_LABEL)).toBeUndefined();
		await press(sign, ' ');
		expect(cardCount(el)).toBe(96);
		expect((handle.state as unknown as { folds: Set<string> }).folds.size).toBe(0);
		expect(handle.write).not.toHaveBeenCalled();
		expect(handle.body).toBe(SOURCE);
	});

	it('nested folds are remembered: opening the outer fold shows the branch with the inner fold still folded', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		const { el } = await embed(SOURCE, { handle });
		const nestLabel = 'Hide the people below Hadrian Valmont and Elinor Marlowe';
		await press(controlWith(el, nestLabel)!);
		expect(cardCount(el)).toBe(96 - 38);
		await press(controlWith(el, A_LABEL)!);
		expect(cardCount(el)).toBe(96 - 75);
		await press(controlWith(el, A_SIGN)!);
		// A is open again, NEST is still folded.
		expect(cardCount(el)).toBe(96 - 38);
		expect((handle.state as unknown as { folds: Set<string> }).folds).toEqual(new Set([F.folds.get('NEST')!.key]));
		expect(controlWith(el, 'Show the 38 hidden people below Hadrian Valmont and Elinor Marlowe')).toBeDefined();
	});

	it('a family with a hidden parent has no control; one hidden person has the singular label', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		const { el } = await embed(SOURCE, { handle });
		const cousin = 'Hide the people below Dorian Valmont and Clarice Valmont';
		expect(controlWith(el, cousin)).toBeDefined();
		await press(controlWith(el, A_LABEL)!);
		expect(controlWith(el, cousin)).toBeUndefined();
		// The family of Dorian and Clarice has one child, Lucan: fold it alone after opening A.
		await press(controlWith(el, A_SIGN)!);
		await press(controlWith(el, cousin)!);
		expect(controlWith(el, 'Show the hidden person below Dorian Valmont and Clarice Valmont')).toBeDefined();
	});

	it('the static phone preview shows no button, no sign and never applies a fold', async () => {
		phone();
		const handle = fakeHandle('n.md', SOURCE);
		(handle.state as unknown as { folds: Set<string> }).folds = new Set([F.folds.get('A')!.key]);
		const { el } = await embed(SOURCE, { handle });
		expect(el.querySelectorAll('.dynasty-fold')).toEqual([]);
		expect(el.querySelectorAll('.dynasty-fold-hit')).toEqual([]);
		expect(cardCount(el)).toBe(96);
	});

	it('the full-screen view on a phone has the controls (every device), and folds there stay in the block state', async () => {
		phone();
		const { root, handle } = await openFullScreen(SOURCE);
		const button = controlWith(root, A_LABEL)!;
		expect(button).toBeDefined();
		await press(button);
		expect((handle!.state as unknown as { folds: Set<string> }).folds).toEqual(new Set([F.folds.get('A')!.key]));
		expect(handle!.write).not.toHaveBeenCalled();
	});

	it('the folds end with the parse of a text that no longer has the family; a text that does not parse keeps them', async () => {
		const handle = fakeHandle('n.md', SOURCE);
		const { el } = await embed(SOURCE, { handle });
		const cousin = 'Hide the people below Dorian Valmont and Clarice Valmont';
		await press(controlWith(el, cousin)!);
		const folds = () => (handle.state as unknown as { folds: Set<string> }).folds;
		expect(folds().has(F.folds.get('COUSIN')!.key)).toBe(true);
		// The text does not parse: the folds stay.
		handle.change('people: [unclosed');
		await settle();
		expect(folds().has(F.folds.get('COUSIN')!.key)).toBe(true);
		// The text without Lucan parses: the family has no child, so its fold ends.
		const start = SOURCE.indexOf('  - id: lucan\n');
		const next = SOURCE.indexOf('\n  - id:', start + 1) + 1;
		handle.change(SOURCE.slice(0, start) + SOURCE.slice(next));
		await settle();
		flushFrames();
		expect(folds().has(F.folds.get('COUSIN')!.key)).toBe(false);
	});
});

describe('F15: the edit sheet, Hide descendants and Show descendants', () => {
	const buttons = (sheet: unknown) => (sheet as { contentEl: FEl }).contentEl.querySelectorAll('button');
	const named = (sheet: unknown, text: string) => buttons(sheet).find((b) => b.getText().trim() === text);
	const folds = (h: { state: unknown }) => (h.state as { folds: Set<string> }).folds;
	/** A handle whose block already has these folds (as if the owner had folded them before the view was made). */
	const handleWith = (...names: string[]) => {
		const handle = fakeHandle('n.md', SOURCE);
		(handle.state as unknown as { folds: Set<string> }).folds = new Set(names.map((n) => F.folds.get(n)!.key));
		return handle;
	};
	const click = async (el: FEl) => {
		dispatch(el, 'click', { button: 0 });
		await settle();
		flushFrames();
	};

	it('a person with a folded family and an open one has both buttons', async () => {
		const handle = handleWith('TWO1');
		const { el } = await embed(SOURCE, { handle });
		const sheet = await openSheetOn(el, 'corwin', 'mouse');
		expect(named(sheet, 'Hide descendants')).toBeDefined();
		expect(named(sheet, 'Show descendants')).toBeDefined();
	});

	it('Hide descendants folds every family of the person that has children, leaves the sheet and writes nothing', async () => {
		const handle = handleWith();
		const { el } = await embed(SOURCE, { handle });
		const sheet = await openSheetOn(el, 'corwin', 'mouse');
		expect(named(sheet, 'Show descendants')).toBeUndefined();
		const hide = named(sheet, 'Hide descendants')!;
		expect(hide).toBeDefined();
		await click(hide);
		expect(folds(handle)).toEqual(new Set([F.folds.get('TWO1')!.key, F.folds.get('TWO2')!.key]));
		expect(sheets()).toHaveLength(0);
		expect(handle.write).not.toHaveBeenCalled();
	});

	it('Show descendants opens exactly the folded families of the person; other folds stay', async () => {
		const handle = handleWith('TWO1', 'BQ');
		const { el } = await embed(SOURCE, { handle });
		const sheet = await openSheetOn(el, 'corwin', 'mouse');
		const show = named(sheet, 'Show descendants')!;
		expect(show).toBeDefined();
		await click(show);
		expect(folds(handle)).toEqual(new Set([F.folds.get('BQ')!.key]));
		expect(sheets()).toHaveLength(0);
	});

	it('a person with no child has neither button', async () => {
		const { el } = await embed(SOURCE, { handle: handleWith() });
		const sheet = await openSheetOn(el, 'piers', 'mouse');
		expect(named(sheet, 'Hide descendants')).toBeUndefined();
		expect(named(sheet, 'Show descendants')).toBeUndefined();
	});
});

describe('the label texts of spec §13.10 are in the plugin texts', () => {
	it('"Hide the people below", "Show the hidden person below" and "hidden people below" are in ui-text.ts', () => {
		const text = readFileSync(new URL('../../src/render/ui-text.ts', import.meta.url), 'utf8');
		expect(text).toContain('Hide the people below');
		expect(text).toContain('Show the hidden person below');
		expect(text).toMatch(/hidden people below/);
	});
});

describe('not run here', () => {
	// These need the Obsidian harness (the real Find, the toolbar, the problem list, the relation finder, the edit sheet's write, a real
	// Reading view or Live Preview, real pointers and the CSS of the theme), or the unit of work that does not exist yet. The rules behind
	// them are proved above (`unfoldFor` in m10-fold-core, `keepSpot`, the scene) and the wiring is a harness step of WP 10.3c.
	it.skip('Find, Focus, a far-couple tag on a hidden partner, a problem in the list, a house page row and the finder\'s Show in the tree open only the folds that hide the person, then centre on the person (harness step of 10.3c: needs the real person picker and view)', () => {});
	it.skip('the relation finder shows the line people while the result shows and changes no fold state (harness step of 10.3c: needs the real finder)', () => {});
	it.skip('after an ok write from the sheet (Add child, Add parent, Add spouse) the plugin opens the folds that hide the new people and never before the write is ok (harness step of 10.3c: needs a real vault write)', () => {});
	it.skip('the view keeps the button and the sign at the same screen point when the tree is folded (F10; harness step of 10.3c: needs real layout of the viewport)', () => {});
	it.skip('the "−" buttons are hidden in Overview and the "+ N" sign stays, larger; a hidden control is not in the Tab order (CSS classes of the level of detail: harness and visual-qa)', () => {});
	it.skip('the hit area of a control is cut back where it meets a card, a far-couple tag, a + badge or a D14 sign (F7; needs real pixel geometry: harness and visual-qa)', () => {});
	it.skip('fixtures 7 and 15: a fold or an open draws the new view in under 100 ms (computer) and 300 ms (phone) (G5 timing on the real device)', () => {});
});
