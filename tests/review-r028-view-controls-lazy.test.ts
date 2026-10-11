import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import { buildScene, type SceneOptions } from '../src/render/dom/scene';
import { cardLabels, needsLabels } from '../src/core/titles';
import { FEl, installDom } from './acceptance/fake-dom';
import { fixtureSource } from './acceptance/load';
import { serial } from './acceptance/m11-support';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
	g.createSvg = (tag: string, o?: unknown) => new FEl(tag, typeof o === 'string' ? { cls: o } : (o as never));
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const ROUNDEL = cardForm(geometryFor(16), 'down');
const SIDE = cardForm(geometryFor(16), 'sideways');

function rng(seed: number) {
	let s = seed >>> 0;
	return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function setup(seed: number, geo: typeof ROUNDEL, o: { show: boolean; plate: boolean }) {
	const parsed = parseDynasty(fixtureSource('06'));
	if (!parsed.ok) throw new Error('parse');
	const g: FamilyGraph = deriveFamilies({
		...parsed.tree,
		houses: parsed.tree.houses.map((h) => ({ ...h, arms: `[[${h.id}.png]]` })),
		people: parsed.tree.people.map((p, i) => ({ ...p, ...(i % 4 === 0 ? { portrait: `[[${p.id}.png]]` } : {}) })),
	});
	const ids = g.people.map((p) => p.id);
	const me = ids[3];
	const heirs = o.show ? [ids[5], ids[9], ids[14]] : [];
	const branches = o.show ? [ids[20]] : [];
	const ordinals = new Map<string, string>([...heirs.map((h, i) => [h, ['1st', '2nd', '3rd'][i]] as const), ...branches.map((b) => [b, '?'] as const)]);
	clearLayoutCache();
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(g, true), ...(o.plate ? { relationLine: true } : { youTab: me }), ...(o.show ? { ordinalCards: [...ordinals.keys()] } : {}) };
	const laid = layoutTree(g, geo, settings, 'test');
	const opts: SceneOptions = {
		fonts: FONTS,
		measure,
		link: () => null,
		me,
		relations: new Map(ids.slice(0, 12).map((id) => [id, { text: 'Cousin', lower: 'cousin' }])),
		...(o.show ? { heirs, ordinals } : {}),
		...(needsLabels(g) ? { labels: cardLabels(g) } : {}),
	};
	return { g, laid, opts, ids, rand: rng(seed) };
}

describe('lazy scene equals eager scene after any order of fills and detail changes', () => {
	for (const [gname, geo] of [['roundel', ROUNDEL], ['sideways', SIDE]] as const) {
		for (const show of [false, true]) {
			for (const plate of [false, true]) {
				for (let seed = 1; seed <= 6; seed++) {
					it(`${gname} show=${show} plate=${plate} seed ${seed}`, () => {
						const a = setup(seed, geo, { show, plate });
						const eagerRoot = new FEl('g');
						const eager = buildScene(eagerRoot as unknown as SVGGElement, a.g, a.laid, { ...a.opts });
						const lazyRoot = new FEl('g');
						const lazy = buildScene(lazyRoot as unknown as SVGGElement, a.g, a.laid, { ...a.opts, lazyCards: true });
						const r = a.rand;
						const W = a.laid.layout.width;
						const H = a.laid.layout.height;
						let detail = true;
						for (let step = 0; step < 14; step++) {
							const k = Math.floor(r() * 5);
							if (k === 0) {
								const x = r() * W;
								const y = r() * H;
								lazy.fill.fillNear({ x: x - 300, y: y - 300, w: 600, h: 600 });
							} else if (k === 1) lazy.fill.fillPerson(a.ids[Math.floor(r() * a.ids.length)]);
							else if (k === 2) lazy.fill.fillChunk({ x: r() * W, y: r() * H, w: 500, h: 500 }, 1 + Math.floor(r() * 10));
							else {
								detail = !detail;
								lazy.setDetail(detail);
								eager.setDetail(detail);
							}
						}
						if (!detail) {
							lazy.setDetail(true);
							eager.setDetail(true);
						}
						lazy.fill.fillAll();
						expect(lazy.fill.pending).toBe(0);
						expect(serial(lazyRoot)).toBe(serial(eagerRoot));
					});
				}
			}
		}
	}
});
