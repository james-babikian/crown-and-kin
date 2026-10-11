import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../../src/layout/index';
import type { Geometry, LaidOut, LayoutSettings, Rect } from '../../src/layout/model';
import type { PictureSlot, setPicture, setSlotProblem } from '../../src/render/dom/pictures';
import type { LegendHouse } from '../../src/render/legend';
import { buildLegend, buildScene, type Scene, type SceneOptions } from '../../src/render/dom/scene';
import { FEl, installDom } from './fake-dom';
import { allFixtures } from './load';
import { block14, graphOf, layoutPictures, livePictureSlotsOf, treeOf, type PictureBox, type PictureSettings } from './m9-support';

/*
 * Spec §13.6 "Cards" and "Card geometry", §13.7 "Portrait on the card" and "Text beside the
 * portrait", D67, D76, D77, D78, and the M9 obsidian contract L1–L4, G1–G4 as changed by C1–C4,
 * S1–S4, B1, B6 (replaced by C2), B7: the picture sets, the box flags, the cache key, the arms and
 * portrait places, the text widths beside them, the live picture slots and the legend's houses.
 * Measurements use a fixed measure (10 px per character), so the numbers are exact. These tests
 * wait for WP 9.2.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONT = 'test';
const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
/** 10 px per character in every font, so a text of n characters is 10 n px wide. */
const measure = (s: string) => [...s].length * 10;
/** 0.2.6 (D179): the pictures are drawn on the Roundel. */
const ROUNDEL = cardForm(geometryFor(16), 'down');
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

const lay = (g: FamilyGraph, settings: LayoutSettings, geo: Geometry): LaidOut => layoutTree(g, geo, settings, FONT);

function scene(laid: LaidOut, g: FamilyGraph, extra: Partial<SceneOptions> = {}): { root: FEl; scene: Scene & { pictures: PictureSlot[] } } {
	const root = new FEl('g');
	const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra });
	return { root, scene: s as Scene & { pictures: PictureSlot[] } };
}

/** A small tree whose text widths are chosen for the 10 px measure (textW is 158 px on normal cards at 16 px). */
function sample(mark: boolean): string {
	return [
		...(mark ? ['options:', '  me: a', ''] : []),
		'houses:',
		'  - id: v',
		'    name: House V',
		'    color: "#8b1e3f"',
		'    arms: "[[v.png]]"',
		'  - id: t',
		'    name: House T',
		'    color: "#7a2e6b"',
		'people:',
		'  - id: a',
		'    name: Aldric Valmont', // 14 characters: 140 px
		'    title: Duke of Valmont', // 15 characters: 150 px
		'    house: v',
		'    born: c. 1102',
		'    died: c. 1161', // "c. 1102–c. 1161": 150 px
		'    portrait: "[[a.png]]"',
		'  - id: b',
		'    name: Bastien Valmont', // 15 characters, illegitimate with no parents: the D14 sign
		'    house: v',
		'    illegitimate: true',
		'  - id: c',
		'    name: Clarice Thornes', // 15 characters, house with no arms
		'    title: Lady of Thornby', // 15 characters
		'    house: t',
		'    born: c. 1130',
		'    died: c. 1190',
		'    parents: [a]',
		'    portrait: "[[c.png]]"',
		'  - id: d',
		'    name: Dorian Thornesz', // 15 characters, no pictures
		'    title: Lord of Thornby',
		'    house: t',
		'    born: c. 1128',
		'    died: c. 1180',
		'',
	].join('\n');
}

const SETS = { arms: ['v'], portraits: ['a', 'c'] };

describe('L1 pictureSets and L2 armsCards (spec §13.6, §13.7 "Rules")', () => {
	it('sample tree 14: the houses with written arms and the people with a written portrait, sorted; a web address or a missing file counts', async () => {
		const { pictureSets } = await layoutPictures();
		const g = graphOf(block14(0));
		expect(pictureSets(g, true)).toEqual({
			arms: ['ashby', 'castellane', 'drakemoor', 'greymane', 'harrow', 'orsini', 'valmont', 'veyle'],
			portraits: ['adela', 'aldric', 'beatrice', 'cedric', 'darian', 'edmund', 'felicia', 'giselle', 'hugo', 'isolde', 'lisette', 'matteo', 'oswin', 'piers', 'roderick', 'tomas', 'wren'],
		});
	});

	it('"Show portraits on cards" off: no portraits', async () => {
		const { pictureSets } = await layoutPictures();
		expect(pictureSets(graphOf(block14(0)), false).portraits).toEqual([]);
	});

	it('a tree without pictures has empty sets; a focus family keeps every house and only its people', async () => {
		const { pictureSets } = await layoutPictures();
		expect(pictureSets(graphOf(allFixtures().find((f) => f.id === '01')!.source), true)).toEqual({ arms: [], portraits: [] });
		const focus = focusSubgraph(treeOf(block14(0)), 'edmund', 1)!.tree;
		const sets = pictureSets(deriveFamilies(focus), true);
		expect(sets.arms).toEqual(pictureSets(graphOf(block14(0)), true).arms);
		expect(sets.portraits).toEqual(focus.people.filter((p) => (p as { portrait?: string }).portrait).map((p) => p.id).sort());
	});

	it('armsCards: the people whose house is in the graph and in the list', async () => {
		const { armsCards } = await layoutPictures();
		const g = graphOf(block14(0));
		expect([...armsCards(g, ['valmont'])].sort()).toEqual(['aldric', 'bastien', 'edmund', 'oswin', 'roderick', 'wren']);
		expect([...armsCards(g, undefined)]).toEqual([]);
		const withThorne = armsCards(g, ['valmont', 'thorne']);
		expect(withThorne.has('hugo')).toBe(true);
		// A house id that is not a house of the tree (a person's missing house) gives no arms.
		const ghost = graphOf('houses:\n  - id: v\n    name: V\npeople:\n  - id: a\n    name: A\n    house: ghost\n  - id: b\n    name: B\n    house: v\n');
		expect([...armsCards(ghost, ['ghost', 'v'])]).toEqual(['b']);
	});
});

describe('L2 box flags and L3 the cache key (spec §13.6 "Card geometry", §13.7 "Card geometry")', () => {
	const GEO = geometryFor(16);

	it('flags are set exactly when true; no box changes size or place; lines are the same', async () => {
		const { armsCards } = await layoutPictures();
		clearLayoutCache();
		const g = graphOf(block14(0));
		const base: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true };
		const arms = ['harrow', 'valmont'];
		const portraits = ['aldric', 'oswin'];
		const plain = lay(g, base, GEO);
		const pics = lay(g, { ...base, arms, portraits } as PictureSettings, GEO);
		expect(pics).not.toBe(plain);
		const withArms = armsCards(g, arms);
		for (const [id, b] of pics.layout.persons as Map<string, PictureBox>) {
			const p = plain.layout.persons.get(id)!;
			expect({ x: b.x, y: b.y, w: b.w, h: b.h }, id).toEqual({ x: p.x, y: p.y, w: p.w, h: p.h });
			expect('arms' in b, id).toBe(withArms.has(id));
			expect('portrait' in b, id).toBe(portraits.includes(id));
			if (b.arms !== undefined) expect(b.arms).toBe(true);
			if (b.portrait !== undefined) expect(b.portrait).toBe(true);
		}
		expect(pics.layout.rows).toEqual(plain.layout.rows);
		expect(pics.edges).toEqual(plain.edges);
	});

	// Recorded from the M8 build (milestone-9 at a01649a): `layoutKey` of each sample tree with
	// DEFAULT_LAYOUT_SETTINGS at 16 px (a relation line for 14 and 07b). Without pictures the key must not change.
	// 0.2.4: recorded again, because the key hashes the geometry and the card is 61 px high now (was 64).
	// 0.2.6 (D179): recorded again, because the geometry has no `cardSize` field now (the key is a cache key in memory; it is never stored).
	const M8_KEYS: Record<string, string> = {
	'01': '26rdua8jkpx',
	'02': 'oiccpt0myx',
	'03': '2f5qia4arx5',
	'04': '29tq8qb3siu',
	'05': '18yfw8atptg',
	'06': 'pn1kh06q9l',
	'07': '21z9zid1qap',
	'07b': 'jmxs70n8lx',
	'08': '38nj5i53ub',
	'09': '1e1ypoo2sub',
	'10': '1n4f4oh8uja',
	'11': '27osp76dpru',
	'12': '119hgvre1c4',
	'13': '1n0agy2xyvo',
	'14': '17giyycopo2',
	'15': '8zpi4kocop',
	// Sample tree 16 (0.2.7): recorded from the 0.2.6 build; the succession keys do not enter the layout key.
	'16': '37ncghx67d',
	};

	it('with neither set, and with empty sets, the key equals the M8 key', () => {
		for (const f of allFixtures()) {
			const g = graphOf(f.source);
			const s: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: f.id === '14' || f.id === '07b' };
			expect(layoutKey(g, GEO, s, FONT), f.id).toBe(M8_KEYS[f.id]);
			expect(layoutKey(g, GEO, { ...s, arms: [], portraits: [] } as PictureSettings, FONT), f.id).toBe(M8_KEYS[f.id]);
		}
	});

	it('the sets are part of the key, filtered to this graph, without repeats and without order', () => {
		const g = graphOf(block14(0));
		const s: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true };
		const key = (sets: object) => layoutKey(g, GEO, { ...s, ...sets } as PictureSettings, FONT);
		const none = key({});
		expect(key({ arms: ['valmont'] })).not.toBe(none);
		expect(key({ portraits: ['aldric'] })).not.toBe(none);
		expect(key({ arms: ['valmont'] })).not.toBe(key({ portraits: ['valmont'] }));
		expect(key({ arms: ['valmont', 'orsini'] })).toBe(key({ arms: ['orsini', 'valmont', 'valmont'] }));
		expect(key({ portraits: ['oswin', 'aldric'] })).toBe(key({ portraits: ['aldric', 'oswin', 'aldric'] }));
		expect(key({ arms: ['ghost'], portraits: ['nobody'] })).toBe(none);
		expect(key({ arms: ['valmont', 'ghost'] })).toBe(key({ arms: ['valmont'] }));
		expect(key({ arms: ['valmont'] })).not.toBe(key({ arms: ['orsini'] }));
	});
});

// 0.2.6 (D179): the tests of the classic card's pictures (the arms box and the portrait at the lower right, the text lines beside them, the
// Compact arms box) are gone with that card. The places of the Roundel's medallion and arms are tested in `s025-roundel-geometry.test.ts`
// and `s025-roundel-scene.test.ts`; here a Roundel scene gives the slots that the tests below fill.
describe('S1: the slots of a Roundel card come in card order: Full arms, portrait, Compact arms, portrait; buildScene makes no <image>', () => {
	it('the order and the Full group', () => {
		clearLayoutCache();
		const g = graphOf(sample(true));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...SETS } as PictureSettings, ROUNDEL);
		const { root, scene: s } = scene(laid, g);
		const order = [...laid.layout.persons.keys()];
		const got = s.pictures.map((x) => `${x.person}:${x.kind}:${x.lod}`);
		const want = order.flatMap((id) => {
			const arms = ['a', 'b'].includes(id);
			const portrait = ['a', 'c'].includes(id);
			return [...(arms ? [`${id}:arms:full`] : []), ...(portrait ? [`${id}:portrait:full`] : []), ...(arms ? [`${id}:arms:compact`] : []), ...(portrait ? [`${id}:portrait:compact`] : [])];
		});
		expect(got).toEqual(want);
		expect(all(root).filter((e) => e.tag === 'image')).toEqual([]);
		for (const x of s.pictures.filter((p) => p.lod === 'full')) expect((x.el as unknown as FEl).closest('.dynasty-card-full'), x.person).not.toBeNull();
	});

	it('the setting off (no portraits in the sets): no portrait slot and no frame (spec §13.7 acceptance)', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['v'] } as PictureSettings, ROUNDEL);
		const { root, scene: s } = scene(laid, g);
		expect(s.pictures.filter((x) => x.kind === 'portrait')).toEqual([]);
		expect(all(root).filter((e) => e.hasClass('dynasty-portrait-frame'))).toEqual([]);
	});
});

describe('S2, B1: pictures and problems in a slot (render/dom/pictures.ts)', () => {
	const PICTURES_PATH = '../../src/render/dom/pictures';
	const load = async () => {
		const m = (await import(/* @vite-ignore */ PICTURES_PATH).catch((e: unknown) => {
			throw new Error(`src/render/dom/pictures.ts does not exist yet (WP 9.2): ${String(e)}`);
		})) as { setPicture: typeof setPicture; setSlotProblem: typeof setSlotProblem };
		return m;
	};
	const slots = () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, ROUNDEL);
		return scene(laid, g).scene.pictures;
	};

	it('setPicture: one <image class="dynasty-picture"> with the slot rect and "xMidYMid meet"; replaced, then removed with null', async () => {
		const { setPicture } = await load();
		const arms = slots().find((x) => x.kind === 'arms' && x.lod === 'full')!;
		const el = arms.el as unknown as FEl;
		setPicture(arms, 'blob:one');
		const images = () => all(el).filter((e) => e.tag === 'image');
		expect(images().length).toBe(1);
		const img = images()[0];
		expect(img.hasClass('dynasty-picture')).toBe(true);
		expect(img.getAttribute('href')).toBe('blob:one');
		expect(img.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
		for (const [attr, k] of [['x', 'x'], ['y', 'y'], ['width', 'w'], ['height', 'h']] as const) expect(Number(img.getAttribute(attr))).toBeCloseTo(arms.rect[k], 6);
		setPicture(arms, 'blob:two');
		expect(images().map((e) => e.getAttribute('href'))).toEqual(['blob:two']);
		setPicture(arms, null);
		expect(images()).toEqual([]);
	});

	it('a portrait picture goes under its frame', async () => {
		const { setPicture } = await load();
		const portrait = slots().find((x) => x.kind === 'portrait')!;
		setPicture(portrait, 'blob:p');
		const frame = portrait.frame as unknown as FEl;
		const nodes = all(frame.parentElement!);
		const img = nodes.find((e) => e.tag === 'image')!;
		expect(nodes.indexOf(img)).toBeLessThan(nodes.indexOf(frame));
	});

	it('B1: only a missing file gives the dashed frame (`is-missing`); other problems and loading give the solid frame', async () => {
		const { setSlotProblem } = await load();
		const portrait = slots().find((x) => x.kind === 'portrait')!;
		const frame = portrait.frame as unknown as FEl;
		expect(frame.hasClass('is-missing')).toBe(false);
		setSlotProblem(portrait, 'missing');
		expect(frame.hasClass('is-missing')).toBe(true);
		setSlotProblem(portrait, 'other');
		expect(frame.hasClass('is-missing')).toBe(false);
		setSlotProblem(portrait, 'missing');
		setSlotProblem(portrait, null);
		expect(frame.hasClass('is-missing')).toBe(false);
	});
});

describe('S3: livePictureSlots, the slots to fill for a view (spec §13.0 item 3 "Live pictures")', () => {
	const r = (x: number, y: number, w = 10, h = 10): Rect => ({ x, y, w, h });
	const VIEW: Rect = { x: 0, y: 0, w: 100, h: 100 };

	it('only the slots of the shown level: Full gives Full arms and portraits, Compact gives Compact arms, Overview none', async () => {
		const live = await livePictureSlotsOf();
		const slots = [
			{ kind: 'arms', lod: 'full', rect: r(10, 10) },
			{ kind: 'portrait', lod: 'full', rect: r(20, 20) },
			{ kind: 'arms', lod: 'compact', rect: r(30, 30) },
		] as const;
		expect([...live(slots, VIEW, 'full')].sort()).toEqual([0, 1]);
		expect(live(slots, VIEW, 'compact')).toEqual([2]);
		expect(live(slots, VIEW, 'overview')).toEqual([]);
	});

	it('only slots that meet the view grown by half its size on each side', async () => {
		const live = await livePictureSlotsOf();
		const slots = [r(145, 45), r(155, 45), r(-58, -58), r(-65, 45), r(45, 149), r(45, 151)].map((rect) => ({ kind: 'arms' as const, lod: 'full' as const, rect }));
		expect([...live(slots, VIEW, 'full')].sort()).toEqual([0, 2, 4]);
	});

	it('nearest the view centre first, ties in slot order; at most `max` (150 by default)', async () => {
		const live = await livePictureSlotsOf();
		const slots = [r(90, 45), r(45, 45), r(0, 45), r(45, 0), r(45, 90)].map((rect) => ({ kind: 'portrait' as const, lod: 'full' as const, rect }));
		// Slot 1 is at the centre; 0, 2, 3 and 4 are at the same distance.
		expect(live(slots, VIEW, 'full')).toEqual([1, 0, 2, 3, 4]);
		expect(live(slots, VIEW, 'full', 2)).toEqual([1, 0]);
		const many = Array.from({ length: 400 }, (_, i) => ({ kind: 'arms' as const, lod: 'full' as const, rect: r((i % 20) * 5, Math.floor(i / 20) * 5, 4, 4) }));
		const got = live(many, VIEW, 'full');
		expect(got.length).toBe(150);
		expect(new Set(got).size).toBe(150);
	});
});

// 0.2.8 (D196 item 3, contract A.1): the live legend shows the line styles only. The houses are in the Houses window; the saved picture keeps its own house legend.
describe('S4: the live legend has no house rows (0.2.8, D196 item 3)', () => {
	it('a houses argument (the 0.2.7 call) adds no row, no title and no arms slot', () => {
		const list = new FEl('div');
		const houses: LegendHouse[] = [
			{ id: 'valmont', name: 'House Valmont', color: '#8b1e3f', arms: true },
			{ id: 'thorne', name: 'House Thorne', color: '#7a2e6b', arms: false },
		];
		const result = (buildLegend as unknown as (l: FEl, h?: readonly LegendHouse[]) => { arms: Map<string, FEl> })(list, houses);
		const els = all(list);
		expect(els.find((e) => e.hasClass('dynasty-legend-houses'))).toBeUndefined();
		expect(els.filter((e) => e.hasClass('dynasty-legend-house'))).toHaveLength(0);
		expect(result.arms.size).toBe(0);
	});

	it('the rows are the same with and without houses (M8)', () => {
		const a = new FEl('div');
		const b = new FEl('div');
		buildLegend(a as unknown as HTMLElement);
		(buildLegend as unknown as (l: FEl, h?: readonly LegendHouse[]) => void)(b, [{ id: 'valmont', name: 'House Valmont', color: '#8b1e3f', arms: false }]);
		const shape = (el: FEl) => all(el).map((e) => `${e.tag}.${[...e.classes].join('.')}:${e.text}`);
		expect(shape(b)).toEqual(shape(a));
	});
});

