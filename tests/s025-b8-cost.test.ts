// 0.2.5 WP-B8: the live scene of the Roundel card makes fewer elements, with the same picture. The first view of a large tree costs about
// 36 us at 4x CPU for each element (create and style, also for an element that is hidden), so the number of elements per card is the cost that this
// file guards:
// 1. A card with nothing to draw makes only the elements it needs (no empty group).
// 2. The footer plate has no group around its path and its line.
// 3. The focus ring is made by `fillPerson` and `fillAll`, not when a card is filled (it shows only for the keyboard focus and the highlight).
// 4. The Compact level shows the pictures of the Full group (one set of elements), and styles.css hides the other children of that group.
// The saved picture (`svg-string.ts`) is a different renderer and is not touched; the golden hashes prove it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene, type Scene, type SceneOptions } from '../src/render/dom/scene';
import { FEl, installDom } from './acceptance/fake-dom';
import { serial } from './acceptance/m11-support';
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

// a: arms and portrait; b: arms only; c: portrait only (marked); d: no picture, no house.
const SRC = [
	'houses:',
	'  - {id: v, name: V, color: "#8b1e3f", arms: "[[v.png]]"}',
	'  - {id: w, name: W, color: "#1e5a8b"}',
	'options:',
	'  me: c',
	'people:',
	'  - {id: a, name: Aldric, house: v, born: 1100, died: 1160, title: Duke, portrait: "[[a.png]]"}',
	'  - {id: b, name: Bertram, house: v, illegitimate: true}',
	'  - {id: c, name: Cedric, house: w, born: 1130, parents: [a], portrait: "[[c.png]]"}',
	'  - {id: d, name: Dora, parents: [a]}',
	'',
].join('\n');
const g: FamilyGraph = build(SRC).g;
const RELATIONS = new Map([
	['b', { text: 'Half-brother', lower: 'half-brother' }],
	['c', { text: 'You', lower: 'you' }],
	['d', { text: 'Half-sister', lower: 'half-sister' }],
]);
const ROUNDEL = cardForm(geometryFor(12), 'down');
const TEXT = cardForm(geometryFor(12), 'sideways');

function lay(geo: Geometry, over: Partial<LayoutSettings> = {}): LaidOut {
	clearLayoutCache();
	const sideways = geo.form === 'text';
	return layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, ...(sideways ? { orientation: 'sideways' as const } : {}), ...pictureSets(g, true), ...over } as LayoutSettings, 'test');
}
function scene(laid: LaidOut, extra: Partial<SceneOptions> = {}): { root: FEl; scene: Scene } {
	const root = new FEl('g');
	return { root, scene: buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra }) };
}
const card = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;

describe('B8 1: the elements of a card that has nothing to draw', () => {
	it('a card with no picture, no plate and no tab makes exactly: ring, bg, strip, the Full group with its name, the Compact name', () => {
		const { root } = scene(lay(ROUNDEL));
		const kids = card(root, 'd').children.map((e) => [...e.classes]);
		// R026 fit: the bar, the Full group and the Compact name are in one body group (one element for the Overview level to hide); the picture is the same.
		expect(kids).toEqual([['dynasty-card-ring'], ['dynasty-card-bg'], ['dynasty-card-body']]);
		const body = card(root, 'd').children[2];
		expect(body.children.map((e) => [...e.classes])).toEqual([['dynasty-card-ribbon'], ['dynasty-card-full'], ['dynasty-card-compact']]);
		expect(body.children[1].children.map((e) => [...e.classes])).toEqual([['dynasty-card-name']]);
	});

	it('a filled lazy scene is the eager scene, byte for byte, with and without the group', () => {
		const laid = lay(ROUNDEL, { relationLine: true });
		const eager = scene(laid, { relations: RELATIONS, me: 'c' });
		const lazy = scene(laid, { relations: RELATIONS, me: 'c', lazyCards: true });
		lazy.scene.fill.fillAll();
		expect(serial(lazy.root)).toBe(serial(eager.root));
	});

	it('the picture slots do not change: Full and Compact for every picture of a and b, Full and Compact portrait for a and c', () => {
		const { scene: s } = scene(lay(ROUNDEL));
		const key = (p: { person: string; kind: string; lod: string }) => `${p.person}:${p.kind}:${p.lod}`;
		expect(s.pictures.map(key).sort()).toEqual(['a:arms:compact', 'a:arms:full', 'a:portrait:compact', 'a:portrait:full', 'b:arms:compact', 'b:arms:full', 'c:portrait:compact', 'c:portrait:full']);
	});
});

describe('B8 2: the foot hairline has no group around it', () => {
	it('a card with a relation word has the hairline as a child of the Full group, the first one, and no group (0.2.8: the plate path is gone)', () => {
		for (const geo of [ROUNDEL, TEXT]) {
			const { root } = scene(lay(geo, { relationLine: true }), { relations: RELATIONS, me: 'c' });
			for (const id of ['b', 'c', 'd']) {
				const full = card(root, id).children.find((e) => e.hasClass('dynasty-card-body'))!.children.find((e) => e.hasClass('dynasty-card-full'))!;
				expect(withClass(card(root, id), 'dynasty-r1-plate-group'), id).toHaveLength(0);
				const kids = full.children.filter((e) => e.hasClass('dynasty-card-foot-line'));
				expect(kids.map((e) => e.tag), id).toEqual(['line']);
				// The line is made first, so the relation word lies over it.
				expect(full.children.indexOf(kids[0]), id).toBe(0);
			}
			expect(withClass(card(root, 'a'), 'dynasty-card-foot-line')).toHaveLength(0);
		}
	});
});

describe('B8 3: the focus ring is made when a person is asked for, not when a card is filled', () => {
	const WHOLE = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
	const ringsOf = (root: FEl) => withClass(root, 'dynasty-card-ring');

	it('fillNear, fillChunk and the idle fill make no ring; the card has all its other content', () => {
		const lazy = scene(lay(ROUNDEL), { lazyCards: true });
		lazy.scene.fill.fillNear(WHOLE);
		expect(lazy.scene.fill.pending).toBe(0);
		expect(ringsOf(lazy.root)).toHaveLength(0);
		for (const e of withClass(lazy.root, 'dynasty-card')) expect([...e.children[0].classes]).toEqual(['dynasty-card-bg']);
		const chunked = scene(lay(ROUNDEL), { lazyCards: true });
		chunked.scene.fill.fillChunk(WHOLE, 100);
		expect(ringsOf(chunked.root)).toHaveLength(0);
	});

	it('fillPerson makes the ring of that person, as the first child of the card, once', () => {
		const lazy = scene(lay(ROUNDEL), { lazyCards: true });
		lazy.scene.fill.fillNear(WHOLE);
		expect(lazy.scene.fill.fillPerson('b')).toBe(true);
		expect(lazy.scene.fill.fillPerson('b')).toBe(true);
		expect(ringsOf(lazy.root)).toHaveLength(1);
		expect([...card(lazy.root, 'b').children[0].classes]).toEqual(['dynasty-card-ring']);
		expect([...card(lazy.root, 'b').children[1].classes]).toEqual(['dynasty-card-bg']);
		expect(ringsOf(card(lazy.root, 'a'))).toHaveLength(0);
	});

	it('fillPerson of a card that is not filled yet fills it and makes its ring, in the eager order', () => {
		const eager = scene(lay(ROUNDEL));
		const lazy = scene(lay(ROUNDEL), { lazyCards: true });
		lazy.scene.fill.fillPerson('d');
		expect(serial(card(lazy.root, 'd'))).toBe(serial(card(eager.root, 'd')));
	});

	it('fillAll makes every ring, and then the lazy scene is the eager scene byte for byte', () => {
		for (const geo of [ROUNDEL, TEXT]) {
			const laid = lay(geo, { relationLine: true });
			const eager = scene(laid, { relations: RELATIONS, me: 'c' });
			const lazy = scene(laid, { relations: RELATIONS, me: 'c', lazyCards: true });
			lazy.scene.fill.fillNear(WHOLE);
			lazy.scene.fill.fillAll();
			expect(ringsOf(lazy.root)).toHaveLength(4);
			expect(serial(lazy.root)).toBe(serial(eager.root));
		}
	});

	it('an eager scene makes the ring with the card, as before', () => {
		expect(ringsOf(scene(lay(ROUNDEL)).root)).toHaveLength(4);
	});
});

describe('B8 4: the Compact level shows the pictures of the Full group (one set of elements, not two)', () => {
	const raw = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
	const block = raw.slice(raw.indexOf('/* roundel: card */'), raw.indexOf('/* C: phone list */')).replace(/\/\*[\s\S]*?\*\//g, '');
	/** The declarations of the rule whose selector list is exactly `selectors` (in any order). */
	const ruleOf = (selectors: string[]): Record<string, string> | undefined => {
		for (const m of block.matchAll(/(?:^|\})\s*([^{}]+)\{([^}]*)\}/g)) {
			const list = m[1].split(',').map((x) => x.trim()).sort();
			if (list.length === selectors.length && list.every((x, i) => x === [...selectors].sort()[i])) {
				return Object.fromEntries(m[2].split(';').map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as const).filter(([k]) => k));
			}
		}
		return undefined;
	};

	it('a card makes one arms group and one portrait group, both in the Full group, and no Compact picture group', () => {
		const { root } = scene(lay(ROUNDEL, { relationLine: true }), { relations: RELATIONS, me: 'c' });
		expect(withClass(root, 'dynasty-r1-compact-pics')).toHaveLength(0);
		for (const [id, arms, portrait] of [['a', 1, 1], ['b', 1, 0], ['c', 0, 1], ['d', 0, 0]] as const) {
			expect(withClass(card(root, id), 'dynasty-arms'), `${id} arms`).toHaveLength(arms);
			expect(withClass(card(root, id), 'dynasty-portrait'), `${id} portrait`).toHaveLength(portrait);
			for (const e of [...withClass(card(root, id), 'dynasty-arms'), ...withClass(card(root, id), 'dynasty-portrait')]) expect(e.parentElement!.hasClass('dynasty-card-full')).toBe(true);
		}
	});

	it('each picture keeps its Full and its Compact slot, in the old order; the two slots share the element and the frame', () => {
		const { scene: s } = scene(lay(ROUNDEL));
		const of = (id: string) => s.pictures.filter((p) => p.person === id);
		expect(of('a').map((p) => `${p.kind}:${p.lod}`)).toEqual(['arms:full', 'portrait:full', 'arms:compact', 'portrait:compact']);
		for (const id of ['a', 'b', 'c']) {
			for (const kind of ['arms', 'portrait']) {
				const [full, compact] = of(id).filter((p) => p.kind === kind);
				if (!full) continue;
				expect(compact.lod).toBe('compact');
				expect(compact.el).toBe(full.el);
				expect(compact.frame).toBe(full.frame);
				expect(compact.rect).toEqual(full.rect);
			}
		}
	});

	it('styles.css shows the Full group of a Roundel card at the Compact level and hides what the Compact level does not draw', () => {
		const show = ruleOf(['.dynasty-lod-compact .dynasty-card-r1 .dynasty-card-full']);
		expect(show?.display).toBe('inline');
		const hide = block.match(/(?:^|\})\s*((?:\.dynasty-lod-compact \.dynasty-card-r1 \.dynasty-card-full > [^,{]+,?\s*)+)\{\s*display:\s*none;?\s*\}/m);
		expect(hide, 'a rule that hides the other children').not.toBeNull();
		const hidden = new Set(hide![1].split(',').map((x) => x.trim().replace('.dynasty-lod-compact .dynasty-card-r1 .dynasty-card-full > .', '')));
		// Every other child that a Roundel card puts in its Full group has a class in that list: a new kind of child cannot show at the Compact level by mistake.
		for (const [over, extra] of [[{ relationLine: true }, { relations: RELATIONS, me: 'c' }], [{ youTab: 'c' }, { me: 'c' }]] as [Partial<LayoutSettings>, Partial<SceneOptions>][]) {
			const labels = new Map([['a', { holdings: [], selected: false, name: 'Aldric', sobriquet: 'the Old', title: 'Duke', reign: '1100 to 1160' } as never]]);
			const { root } = scene(lay(ROUNDEL, over), { ...extra, labels });
			for (const full of withClass(root, 'dynasty-card-full')) {
				for (const kid of full.children) {
					if (kid.hasClass('dynasty-arms') || kid.hasClass('dynasty-portrait')) continue;
					expect([...kid.classes].some((c) => hidden.has(c)), `${[...kid.classes]} in the Full group`).toBe(true);
				}
			}
		}
	});
});
