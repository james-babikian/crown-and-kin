// 0.2.7 WP4 geometry (CONTRACT F.2, F.4): what the live scene draws for the Show view of a line of succession: the class `dynasty-heir` set at card
// creation (also in a lazy scene), and the ordinal tab (the rectangle of `ordinalTabRect`, its text, no tap target of its own, `aria-hidden`, Full level
// only). A card with an ordinal has no "You" tab. The fake DOM stands in for a browser, as in `s025-roundel-scene.test.ts`.
import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { ORDINAL_EM, cardForm, geometryFor, ordinalTabRect } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../../src/layout/model';
import { buildScene, type SceneOptions } from '../../src/render/dom/scene';
import { TAB_TEXT_BASE_EM } from '../../src/render/scene-model';
import { FEl } from '../acceptance/fake-dom';
import { serial } from '../acceptance/m11-support';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string, font: string) => [...s].length * 0.55 * Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

// a: portrait and arms (house v); b: arms only; c: portrait only (house w); d: no picture, no house; e: no picture.
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'  - {id: w, name: W, color: "#1e5a8b"}',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, house: v}',
	'  - {id: c, name: Cedric, house: w, parents: [a], portrait: "[[c.png]]"}',
	'  - {id: d, name: Dora, parents: [a]}',
	'  - {id: e, name: Edric, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
function scene(laid: LaidOut, extra: Partial<SceneOptions> = {}) {
	const root = new FEl('g');
	const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra });
	return { root, scene: s };
}
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const withClass = (el: FEl, cls: string) => all(el).filter((e) => e.hasClass(cls));
const num = (el: FEl, k: string) => Number(el.getAttribute(k));
const ORD = new Map([['a', '1st'], ['b', '2nd'], ['c', '20th'], ['d', '3rd']]);

describe('F.2: the class dynasty-heir', () => {
	it('is set at card creation for the heirs given, and for nobody else', () => {
		const { root } = scene(lay(ROUNDEL), { heirs: ['b', 'd'] });
		const heirs = all(root).filter((e) => e.hasClass('dynasty-card') && e.hasClass('dynasty-heir')).map((e) => e.getAttribute('data-person'));
		expect(heirs.sort()).toEqual(['b', 'd']);
	});

	it('no heirs option: no card has the class (a normal scene is unchanged)', () => {
		const { root } = scene(lay(ROUNDEL));
		expect(withClass(root, 'dynasty-heir')).toHaveLength(0);
		const { root: empty } = scene(lay(ROUNDEL), { heirs: [] });
		expect(withClass(empty, 'dynasty-heir')).toHaveLength(0);
	});

	it('a lazy card has the class on its shell before any fill, and the filled lazy scene equals the eager scene byte for byte', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b', 'c'] });
		const opts = { heirs: new Set(['b', 'c']), ordinals: ORD };
		const lazy = scene(laid, { ...opts, lazyCards: true });
		expect(lazy.scene.fill.pending).toBeGreaterThan(0);
		const heirs = all(lazy.root).filter((e) => e.hasClass('dynasty-card') && e.hasClass('dynasty-heir')).map((e) => e.getAttribute('data-person'));
		expect(heirs.sort()).toEqual(['b', 'c']);
		// The tab is content, not shell: it waits for the fill with the rest of the card.
		expect(withClass(lazy.root, 'dynasty-ordinal-tab-group')).toHaveLength(0);
		lazy.scene.fill.fillAll();
		const eager = scene(laid, opts);
		expect(serial(lazy.root)).toBe(serial(eager.root));
		expect(withClass(lazy.root, 'dynasty-ordinal-tab-group')).toHaveLength(2);
	});

	it('is a card class beside the dead and mark classes, not instead of them', () => {
		const { root } = scene(lay(ROUNDEL), { heirs: ['a'], me: 'a' });
		const a = card(root, 'a');
		expect(a.hasClass('dynasty-heir') && a.hasClass('dynasty-deceased') && a.hasClass('dynasty-card-me')).toBe(true);
	});
});

describe('F.4: the ordinal tab', () => {
	it('exists only for a card that is in `TreeLayout.ordinalCards` and has a text in `ordinals`', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b', 'c', 'e'] });
		const { root } = scene(laid, { ordinals: ORD });
		// e has no text; a and d have a text but no room in the layout.
		expect(withClass(root, 'dynasty-ordinal-tab-group')).toHaveLength(2);
		for (const id of ['b', 'c']) expect(withClass(card(root, id), 'dynasty-ordinal-tab-group'), id).toHaveLength(1);
		for (const id of ['a', 'd', 'e']) expect(withClass(card(root, id), 'dynasty-ordinal-tab-group'), id).toHaveLength(0);
	});

	it('no `ordinals` option, or none in the layout: no tab (a normal scene is unchanged)', () => {
		expect(withClass(scene(lay(ROUNDEL, { ordinalCards: ['b'] })).root, 'dynasty-ordinal-tab-group')).toHaveLength(0);
		expect(withClass(scene(lay(ROUNDEL), { ordinals: ORD }).root, 'dynasty-ordinal-tab-group')).toHaveLength(0);
	});

	for (const [name, geo] of [['Roundel', ROUNDEL], ['text card', TEXT]] as const) {
		it(`${name}: the rectangle is \`ordinalTabRect\` for the picture kind of each card, 0.2 em corners, the text centred`, () => {
			const laid = lay(geo, { ordinalCards: ['a', 'b', 'c', 'd'] });
			const { root } = scene(laid, { ordinals: ORD });
			const L = laid.layout;
			for (const id of ['a', 'b', 'c', 'd']) {
				const box = L.persons.get(id)!;
				const text = ORD.get(id)!;
				const portrait = geo.form === 'roundel' && !!box.portrait;
				const arms = geo.form === 'roundel' && !!(box.arms && g.byId.get(id)!.house);
				const r = ordinalTabRect(L.geometry, portrait, arms, text.length);
				const group = withClass(card(root, id), 'dynasty-ordinal-tab-group')[0];
				expect(group, id).toBeDefined();
				const rects = group.children.filter((e) => e.tag === 'rect');
				expect(rects.map((e) => (e.hasClass('dynasty-ordinal-tab-base') ? 'base' : e.hasClass('dynasty-ordinal-tab') ? 'tab' : '?'))).toEqual(['base', 'tab']);
				for (const rect of rects) {
					expect([num(rect, 'x'), num(rect, 'y'), num(rect, 'width'), num(rect, 'height')], `${name} ${id}`).toEqual([box.x + r.x, box.y + r.y, r.w, r.h]);
					expect(num(rect, 'rx')).toBeCloseTo(ORDINAL_EM.corner * 12, 9);
				}
				const word = withClass(group, 'dynasty-ordinal-tab-text')[0];
				expect(word.getText()).toBe(text);
				expect(num(word, 'x')).toBeCloseTo(box.x + r.x + r.w / 2, 9);
				expect(num(word, 'y')).toBeCloseTo(box.y + r.y + r.h / 2 + TAB_TEXT_BASE_EM * 12, 9);
			}
		});
	}

	it('is `aria-hidden`, has no tab stop, no role and no tap target of its own', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b', 'c'] });
		const { root } = scene(laid, { ordinals: ORD });
		for (const group of withClass(root, 'dynasty-ordinal-tab-group')) {
			expect(group.getAttribute('aria-hidden')).toBe('true');
			for (const e of all(group)) {
				expect(e.getAttribute('tabindex'), e.tag).toBeNull();
				expect(e.getAttribute('role'), e.tag).toBeNull();
				expect(e.getAttribute('data-person'), e.tag).toBeNull();
				expect(e.hasClass('dynasty-card-crown-hit') || e.hasClass('dynasty-card-bg')).toBe(false);
			}
		}
	});

	it('a press on the tab is a press on the card: the card\'s crown area spans it', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['d'] });
		const { root } = scene(laid, { ordinals: ORD });
		const box = laid.layout.persons.get('d')!;
		const r = ordinalTabRect(laid.layout.geometry, false, false, 3);
		const [hit] = withClass(card(root, 'd'), 'dynasty-card-crown-hit');
		expect(hit).toBeDefined();
		expect(num(hit, 'x')).toBeLessThanOrEqual(box.x + r.x + 1e-9);
		expect(num(hit, 'x') + num(hit, 'width')).toBeGreaterThanOrEqual(box.x + r.x + r.w - 1e-9);
		expect(num(hit, 'y')).toBeCloseTo(box.y - laid.layout.geometry.reach!, 9);
	});

	it('stands in the Full group of the card, so the Compact and Overview levels do not show it', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['b'] });
		const { root } = scene(laid, { ordinals: ORD });
		const [group] = withClass(root, 'dynasty-ordinal-tab-group');
		expect(withClass(card(root, 'b'), 'dynasty-card-full')[0].children.includes(group)).toBe(true);
	});

	it('replaces the "You" tab of the same card; another card keeps its own "You" tab', () => {
		const same = scene(lay(ROUNDEL, { youTab: 'b', ordinalCards: ['b'] }), { ordinals: ORD, me: 'b' });
		expect(withClass(card(same.root, 'b'), 'dynasty-r1-tab-group')).toHaveLength(0);
		expect(withClass(card(same.root, 'b'), 'dynasty-ordinal-tab-group')).toHaveLength(1);
		const apart = scene(lay(ROUNDEL, { youTab: 'b', ordinalCards: ['c'] }), { ordinals: ORD, me: 'b' });
		expect(withClass(card(apart.root, 'b'), 'dynasty-r1-tab-group')).toHaveLength(1);
		expect(withClass(card(apart.root, 'c'), 'dynasty-ordinal-tab-group')).toHaveLength(1);
		expect(withClass(card(apart.root, 'c'), 'dynasty-r1-tab-group')).toHaveLength(0);
		// An ordinal card with no text in `ordinals` keeps the "You" tab it had.
		const noText = scene(lay(ROUNDEL, { youTab: 'b', ordinalCards: ['b'] }), { ordinals: new Map(), me: 'b' });
		expect(withClass(card(noText.root, 'b'), 'dynasty-r1-tab-group')).toHaveLength(1);
	});

	it('the width follows the length of the text: 2.3 em for "1st", 2.7 em for "20th"', () => {
		const laid = lay(ROUNDEL, { ordinalCards: ['a', 'c'] });
		const { root } = scene(laid, { ordinals: ORD });
		const w = (id: string) => num(withClass(card(root, id), 'dynasty-ordinal-tab')[0], 'width');
		expect(w('a')).toBeCloseTo(2.3 * 12, 9);
		expect(w('c')).toBeCloseTo(2.7 * 12, 9);
	});
});
