/*
 * 0.2.8 P4 (contract C, G.5, G.13, G.15; D203): the new card in the live scene and the saved picture. The old tests of the card DOM were updated one by one;
 * these are the new rules: the shrinking Compact name, the arms patch and the owner of an arms slot, the badge on the corner arc, the square fold chip,
 * the heir ring in the shell, the foot hairline of a sideways card, the dead rows of the legend, and the grapheme splitter.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cardLabels } from '../src/core/titles';
import { COMPACT_NAME_MIN_EM, buildLegend, buildScene, type SceneOptions } from '../src/render/dom/scene';
import { RIBBON, cardForm, footSpan, geometryFor, ribbonWidth } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { legendRows } from '../src/render/legend';
import { savedLegend } from '../src/render/saved-picture';
import { graphemes, foldHit } from '../src/render/view-math';
import { FEl, installDom } from './acceptance/fake-dom';
import { build } from './helpers';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const withClass = (el: FEl, cls: string) => all(el).filter((e) => e.hasClass(cls));
const num = (el: FEl, k: string) => Number(el.getAttribute(k));

const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100}',
	'  - {id: b, name: Bartholomew Alexander Fitzgerald-Montgomery, house: v, parents: [a]}',
	'  - {id: c, name: Cedric, house: v, parents: [a]}',
	'',
].join('\n');
const ROUNDEL = cardForm(geometryFor(16), 'down');
const TEXT = cardForm(geometryFor(16), 'sideways');

function laidOf(geo: Geometry, over: Partial<LayoutSettings> = {}, src = SRC) {
	const g = build(src).g;
	g.byId.get('c')!.arms = '[[c.png]]';
	clearLayoutCache();
	const sideways = geo.form === 'text';
	const laid: LaidOut = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
	return { g, laid };
}
function sceneOf(laid: LaidOut, g: ReturnType<typeof laidOf>['g'], extra: Partial<SceneOptions> = {}) {
	const root = new FEl('g');
	const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels: cardLabels(g), ...extra });
	return { root, scene };
}
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;

describe('D203: the Compact name shrinks before it is cut', () => {
	it('a name that fits at 1.5 em has no custom size; a longer one takes a size between 1.05 em and 1.5 em; one that does not fit at 1.05 em is cut there', () => {
		const { g, laid } = laidOf(ROUNDEL, { arms: [] });
		const { root } = sceneOf(laid, g);
		const compact = (id: string) => withClass(card(root, id), 'dynasty-card-compact')[0];
		expect(compact('c').styleProps.has('--dynasty-compact-em')).toBe(false);
		expect(compact('c').getText()).toBe('Cedric');
		const long = compact('b');
		expect(long.getText().endsWith('…')).toBe(true);
		expect(Number(long.styleProps.get('--dynasty-compact-em'))).toBeCloseTo(COMPACT_NAME_MIN_EM, 6);
		// A name that needs a little less than the room at 1.5 em shrinks and stays whole.
		const g2 = build(SRC.replace('Bartholomew Alexander Fitzgerald-Montgomery', 'Bartholomew Alex')).g;
		clearLayoutCache();
		const laid2 = layoutTree(g2, ROUNDEL, { ...DEFAULT_LAYOUT_SETTINGS }, 'test');
		const mid = withClass(card(sceneOf(laid2, g2).root, 'b'), 'dynasty-card-compact')[0];
		const em = Number(mid.styleProps.get('--dynasty-compact-em'));
		expect(mid.getText()).toBe('Bartholomew Alex');
		expect(em).toBeGreaterThanOrEqual(COMPACT_NAME_MIN_EM);
		expect(em).toBeLessThan(1.5);
	});
});

describe('G.5, I05: the arms of a card', () => {
	it('an arms slot has an owner and a gap width (D219: no patch; the gap path comes with the picture): the person for personal arms, else the house', () => {
		const { g, laid } = laidOf(ROUNDEL, { personalArms: ['c'], armsOnCards: 'all' });
		const { root, scene } = sceneOf(laid, g);
		const slots = scene.pictures.filter((s) => s.kind === 'arms' && s.lod === 'full');
		const byPerson = new Map(slots.map((s) => [s.person, s]));
		expect(byPerson.get('c')!.owner).toEqual({ person: 'c' });
		expect(byPerson.get('a')!.owner).toEqual({ house: 'v' });
		// The old reader's field stays for a person with a house.
		expect(byPerson.get('c')!.house).toBe('v');
		for (const id of ['a', 'c']) {
			const group = withClass(card(root, id), 'dynasty-arms')[0];
			expect(group.children).toHaveLength(0);
		}
	});

	it('the arms stand 0.55 em from the ring (0.3 em further than in 0.2.7)', () => {
		const { g, laid } = laidOf(ROUNDEL, { armsOnCards: 'all', portraits: ['a'] });
		const slot = sceneOf(laid, g).scene.pictures.find((s) => s.kind === 'arms' && s.person === 'a')!;
		const box = laid.layout.persons.get('a')!;
		const geo = laid.layout.geometry;
		const axis = geo.cardW / 2;
		expect(slot.rect.x - box.x).toBeCloseTo(axis + (1 + 0.15) * 16 + 0.55 * 16, 6);
	});
});

describe('I01: the badge on the corner arc', () => {
	it('its centre is on the middle of the arc of the corner and moves when the theme radius becomes known; its tap square is 3 em', () => {
		const { g, laid } = laidOf(ROUNDEL, {});
		const root = new FEl('g');
		const scene = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, badges: { hidden: new Map([['b', 2]]), label: () => 'x' } });
		const box = laid.layout.persons.get('b')!;
		const badge = scene.badges[0];
		const r = 0.55 * 16;
		// Radius 4 (the fallback while the scene is outside the document): no inset.
		expect(badge.mark.x + r).toBeCloseTo(box.x + box.w, 6);
		scene.setCornerRadius(8);
		const c = 8 - 8 / Math.SQRT2;
		expect(badge.mark.x + r).toBeCloseTo(box.x + box.w - c, 6);
		expect(badge.mark.y + r).toBeCloseTo(box.y + c, 6);
		expect(num(badge.hit as unknown as FEl, 'width')).toBeCloseTo(3 * 16, 6);
		expect(num(badge.hit as unknown as FEl, 'height')).toBeCloseTo(3 * 16, 6);
	});

	it('the tap area of a fold control is at least 3 em, whatever the zoom', () => {
		const visible = { x: 0, y: 0, w: 15.2, h: 15.2 };
		const hit = foldHit(visible, 4, 16);
		expect(hit.w).toBeCloseTo(48, 6);
		expect(foldHit(visible, 0.5, 16).w).toBeCloseTo(88, 6);
		// Without an em the rule of 0.2.7 stays.
		expect(foldHit(visible, 4).w).toBeCloseTo(15.2, 6);
	});
});

describe('I35, D212 (heir-outline): the heir has one outline and no second ring', () => {
	it('an heir card has no ring rect, only its bg (the border is styled), and the lazy and the eager scene agree', () => {
		const { g, laid } = laidOf(ROUNDEL, {});
		const eager = sceneOf(laid, g, { heirs: ['b'] }).root;
		const lazy = new FEl('g');
		const s = buildScene(lazy as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, labels: cardLabels(g), heirs: ['b'], lazyCards: true });
		const kids = (root: FEl) => card(root, 'b').children.map((e) => [...e.classes][0]);
		expect(kids(lazy)[0]).toBe('dynasty-card-bg');
		s.fill.fillAll();
		expect(kids(lazy)).toEqual(kids(eager));
		expect(withClass(card(eager, 'b'), 'dynasty-heir-ring')).toHaveLength(0);
		expect(card(eager, 'b').hasClass('dynasty-heir')).toBe(true);
		expect(card(eager, 'c').hasClass('dynasty-heir')).toBe(false);
	});
});

describe('C: the sideways card', () => {
	it('the foot hairline starts 0.35 em after the ribbon and ends 0.35 em before the edge', () => {
		const span = footSpan(TEXT, 180);
		expect(span.x0).toBe(ribbonWidth(TEXT) + Math.round(RIBBON.footGapEm * 16));
		expect(span.x1).toBe(180 - Math.round(RIBBON.footGapEm * 16));
		expect(footSpan(ROUNDEL, 180, 1)).toEqual({ x0: 1, x1: 179 });
		expect(ribbonWidth(geometryFor(8))).toBe(3);
		expect(ribbonWidth(geometryFor(16))).toBe(5);
	});
});

describe('I19: the dead signs in the legend', () => {
	it('the live legend has the line styles, the sign row and the two dead rows, and no house rows', () => {
		const list = new FEl('div');
		buildLegend(list as unknown as HTMLElement);
		const rows = list.children.filter((c) => c.hasClass('dynasty-legend-row'));
		expect(all(list).filter((e) => e.hasClass('dynasty-legend-label')).map((e) => e.getText())).toContain('Dead. The year of death is not known.');
		expect(rows).toHaveLength(legendRows().length);
		expect(all(list).some((e) => e.hasClass('dynasty-legend-houses'))).toBe(false);
		const dagger = all(list).filter((e) => e.hasClass('dynasty-legend-dagger')).map((e) => e.getText());
		expect(dagger).toEqual(['b. 1131 †', 'b. 1131 †?']);
	});

	it('the saved legend lists a dead sign only when a drawn date text has one (dateLine of P1 prints it)', () => {
		const { g, laid } = laidOf(ROUNDEL, {});
		expect(savedLegend(g, laid).dead).toBeUndefined();
	});
});

describe('T-X2-01: the letters of a text', () => {
	it('plain text is split by character with no segmenter; a flag, a joined emoji and a letter with a mark are one piece each', () => {
		expect(graphemes('Aldric')).toEqual([...'Aldric']);
		expect(graphemes('é')).toEqual(['é']);
		expect(graphemes('🇳🇴🇸🇪')).toEqual(['🇳🇴', '🇸🇪']);
		expect(graphemes('a👨‍👩‍👧‍👦b')).toEqual(['a', '👨‍👩‍👧‍👦', 'b']);
		expect(graphemes('éx')).toEqual(['é', 'x']);
		expect(graphemes('')).toEqual([]);
	});

	it('a space that a mark follows is still a space, so a name breaks there', () => {
		const parts = graphemes('ab ️cd');
		expect(parts).toEqual(['a', 'b', ' ', '️', 'c', 'd']);
	});

	it('without Intl.Segmenter the text is split by code point (the splitter is made on the first need and kept)', async () => {
		vi.resetModules();
		vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
		try {
			const fresh = await import('../src/render/view-math');
			expect(fresh.graphemes('🇳🇴')).toEqual(['🇳', '🇴']);
			expect(fresh.graphemes('abc')).toEqual(['a', 'b', 'c']);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
