import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import type { CardLabel } from '../../src/core/titles';
import { cardText, geometryFor, type CardText } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, illegitimateSigns, layoutKey, layoutTree } from '../../src/layout/index';
import type { CardSize, Geometry, LaidOut, LayoutSettings, Rect } from '../../src/layout/model';
import type { PictureSlot, setPicture, setSlotProblem } from '../../src/render/dom/pictures';
import type { LegendHouse } from '../../src/render/legend';
import { BADGE_TEXT_CUT_EM, buildLegend, buildScene, type Scene, type SceneOptions } from '../../src/render/dom/scene';
import { tallCardsFor } from '../../src/render/dom/tall-cards';
import { FEl, installDom } from './fake-dom';
import { allFixtures } from './load';
import { block14, graphOf, layoutPictures, livePictureSlotsOf, smallTextWidthOf, treeOf, type PictureBox, type PictureSettings } from './m9-support';

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
const LINE_HEIGHT: Record<CardSize, number> = { normal: 1.2, compact: 1.1 };
/** D78 (C1): the size of the arms and the portrait, in px. */
const sizeOf = (geo: Geometry) => 1.25 * LINE_HEIGHT[geo.cardSize] * geo.fontPx;
const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];

const lay = (g: FamilyGraph, settings: LayoutSettings, geo: Geometry): LaidOut => layoutTree(g, geo, settings, FONT);

function scene(laid: LaidOut, g: FamilyGraph, extra: Partial<SceneOptions> = {}): { root: FEl; scene: Scene & { pictures: PictureSlot[] } } {
	const root = new FEl('g');
	const s = buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...extra });
	return { root, scene: s as Scene & { pictures: PictureSlot[] } };
}

const cardEl = (root: FEl, id: string) => all(root).find((e) => e.hasClass('dynasty-card') && e.getAttribute('data-person') === id)!;
const textOf = (root: FEl, id: string, cls: string) =>
	all(cardEl(root, id))
		.filter((e) => e.hasClass(cls))
		.map((e) => e.getText());

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
	const GEO = geometryFor(16, 'normal');

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
	const M8_KEYS: Record<string, string> = {
		'01': 'vqpl6rig4r',
		'02': '1dgbdwqwl2s',
		'03': 'hst7d6wcuh',
		'04': 'gut0d428x9',
		'05': '2aex8zqvu7m',
		'06': 'qjkqok44r6',
		'07': '1w5kjv5z1sv',
		'07b': '23ggd529gmd',
		'08': 'xbwtd7av2w',
		'09': '1nh1w6g6ky9',
		'10': '15b569nbni5',
		'11': '20m1fqqe8j0',
		'12': '2exsds7q22b',
		'13': 'mvaaezmi78',
		'14': '1c8oiandeq5',
		'15': 'ir844oqabf',
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

describe('D78 (C1, C2): the arms box on a Full card', () => {
	for (const size of ['normal', 'compact'] as const) {
		for (const mark of [false, true]) {
			it(`${size} cards, ${mark ? 'with' : 'without'} a relation text line: ${size === 'normal' ? '1.25 × 1.5 em' : '5/6 × 1.375 em by 1.375 em'}, right edge at the text's right edge, centred on the first name text line`, () => {
				clearLayoutCache();
				const g = graphOf(sample(mark));
				const geo = geometryFor(16, size);
				const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: mark, ...SETS } as PictureSettings, geo);
				const { scene: s } = scene(laid, g);
				const s1 = sizeOf(laid.layout.geometry);
				for (const id of ['a', 'b']) {
					const box = laid.layout.persons.get(id)!;
					const t = cardText(laid.layout.geometry, box.tallName, box.tallTitle);
					const slot = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'full' && x.person === id)!;
					expect(slot, id).toBeDefined();
					expect(slot.house).toBe('v');
					const want: Rect = { x: box.x + t.padX + t.textW - (5 / 6) * s1, y: box.y + t.nameBaseline - 0.35 * geo.fontPx - s1 / 2, w: (5 / 6) * s1, h: s1 };
					for (const k of ['x', 'y', 'w', 'h'] as const) expect(slot.rect[k], `${id} ${k}`).toBeCloseTo(want[k], 6);
				}
				// Cards of a house with no arms have no arms slot.
				expect(s.pictures.filter((x) => x.kind === 'arms' && (x.person === 'c' || x.person === 'd'))).toEqual([]);
			});
		}
	}

	it('normal cards at 16 px: the numbers of D78 (20 × 24 px; the name 24.8 px narrower)', () => {
		const geo = geometryFor(16, 'normal');
		expect(sizeOf(geo)).toBeCloseTo(24, 9);
		expect((5 / 6) * sizeOf(geo) + 0.3 * 16).toBeCloseTo(1.55 * 16, 9);
	});

	it('a two-line name: the box stays centred on the first name text line', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS, tallCards: ['a'] } as PictureSettings, geo);
		const { scene: s } = scene(laid, g);
		const box = laid.layout.persons.get('a')!;
		expect(box.tallName).toBe(true);
		const t = cardText(laid.layout.geometry, true, false);
		const slot = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'full' && x.person === 'a')!;
		expect(slot.rect.y + slot.rect.h / 2).toBeCloseTo(box.y + t.nameBaseline - 0.35 * 16, 6);
	});

	it('sideways with a `+` badge in the card: the arms move left by the badge cut; the portrait does not', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'normal', ...SETS } as PictureSettings, geo);
		const { scene: s } = scene(laid, g, { badges: { hidden: new Map([['a', 2]]), label: () => 'More' } });
		const box = laid.layout.persons.get('a')!;
		const t = cardText(laid.layout.geometry);
		const cut = BADGE_TEXT_CUT_EM * 16;
		const arms = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'full' && x.person === 'a')!;
		expect(arms.rect.x + arms.rect.w).toBeCloseTo(box.x + t.padX + t.textW - cut, 6);
		const portrait = s.pictures.find((x) => x.kind === 'portrait' && x.person === 'a')!;
		expect(portrait.rect.x + portrait.rect.w).toBeCloseTo(box.x + t.padX + t.textW, 6);
		// Without a badge, nothing moves.
		const b = laid.layout.persons.get('b')!;
		const armsB = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'full' && x.person === 'b')!;
		expect(armsB.rect.x + armsB.rect.w).toBeCloseTo(b.x + t.padX + t.textW, 6);
	});
});

describe('D78 (C2): the name narrows by the arms box and a 0.3 em gap; the D14 sign moves left; the title does not narrow', () => {
	it('the Full name ends before the arms (normal cards: 158 − 24.8 = 133.2 px), also with the D14 sign (107.2 px)', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geo);
		const { root } = scene(laid, g);
		const [nameA] = textOf(root, 'a', 'dynasty-card-name');
		expect(nameA).toMatch(/…$/);
		expect(measure(nameA)).toBeLessThanOrEqual(133.2);
		expect(measure(nameA)).toBeGreaterThan(133.2 - 20);
		expect(illegitimateSigns(g, laid.edges).has('b')).toBe(true);
		const [nameB] = textOf(root, 'b', 'dynasty-card-name');
		expect(measure(nameB)).toBeLessThanOrEqual(107.2);
		expect(measure(nameB)).toBeGreaterThan(107.2 - 20);
		// No arms: the same 14 characters fit.
		const plainLaid = lay(g, DEFAULT_LAYOUT_SETTINGS, geo);
		const { root: plain } = scene(plainLaid, g);
		expect(textOf(plain, 'a', 'dynasty-card-name')).toEqual(['Aldric Valmont']);
	});

	it('the D14 sign moves left by the arms box and the gap (24.8 px at 16 px)', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geo);
		const { root } = scene(laid, g);
		const box = laid.layout.persons.get('b')!;
		const t = cardText(laid.layout.geometry);
		const full = all(cardEl(root, 'b')).find((e) => e.hasClass('dynasty-card-full'))!;
		const sign = all(full).find((e) => e.hasClass('dynasty-sign'))!;
		expect(Number(sign.getAttribute('x1'))).toBeCloseTo(box.x + t.sign.x1 - 24.8, 6);
		expect(Number(sign.getAttribute('x2'))).toBeCloseTo(box.x + t.sign.x2 - 24.8, 6);
	});

	it('the title keeps its full width on a card with arms (no portrait)', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['v'] } as PictureSettings, geometryFor(16, 'normal'));
		const { root } = scene(laid, g);
		expect(textOf(root, 'a', 'dynasty-card-title')).toEqual(['Duke of Valmont']);
	});

	it('tallCardsFor (9th parameter): the name lines are measured with the narrower width (D37, §13.9)', () => {
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const tall = tallCardsFor;
		const m = (s: string) => measure(s);
		// Bastien (150 px) needs two text lines already because of the D14 sign (132 px).
		expect(tall(g, geo, false, FONTS, m, undefined, new Set(['b']))?.tall).toEqual(['b']);
		expect(tall(g, geo, false, FONTS, m, undefined, new Set(['b']), undefined, new Set())?.tall).toEqual(['b']);
		// Aldric (140 px) and the others (150 px) fit in 158 px, not in 133.2 px. Only the people given get the narrower width.
		expect(tall(g, geo, false, FONTS, m, undefined, new Set(['b']), undefined, new Set(['a']))?.tall).toEqual(['a', 'b']);
		expect(tall(g, geo, false, FONTS, m, undefined, new Set(['b']), undefined, new Set(['a', 'b', 'c', 'd']))?.tall).toEqual(['a', 'b', 'c', 'd']);
	});
});

describe('G2, C4, B7: the arms at the Compact level of detail', () => {
	it('1.5 × 1.8 em at the right of the card, centred on its height, in the group `dynasty-card-compact-arms`', () => {
		clearLayoutCache();
		const g = graphOf(sample(true));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...SETS } as PictureSettings, geo);
		const { scene: s } = scene(laid, g);
		for (const id of ['a', 'b']) {
			const box = laid.layout.persons.get(id)!;
			const slot = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'compact' && x.person === id)!;
			expect(slot, id).toBeDefined();
			const want = { x: box.x + box.w - 0.5 * 16 - 1.5 * 16, y: box.y + box.h / 2 - 0.9 * 16, w: 24, h: 28.8 };
			for (const k of ['x', 'y', 'w', 'h'] as const) expect(slot.rect[k], `${id} ${k}`).toBeCloseTo(want[k], 6);
			const group = (slot.el as unknown as FEl).closest('.dynasty-card-compact-arms');
			expect(group, id).not.toBeNull();
		}
	});

	it('the Compact name ends 0.3 em before the arms; with the D14 sign, 0.5 em before the sign', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geo);
		const { root, scene: s } = scene(laid, g);
		const compactName = (id: string) => all(cardEl(root, id)).find((e) => e.hasClass('dynasty-card-compact'))!;
		const a = compactName('a');
		const armsA = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'compact' && x.person === 'a')!;
		const room = armsA.rect.x - 0.3 * 16 - Number(a.getAttribute('x'));
		expect(measure(a.getText())).toBeLessThanOrEqual(room + 1e-6);
		const b = compactName('b');
		const armsB = s.pictures.find((x) => x.kind === 'arms' && x.lod === 'compact' && x.person === 'b')!;
		const sign = all(cardEl(root, 'b')).find((e) => e.hasClass('dynasty-card-compact-sign'))!;
		const line = all(sign).find((e) => e.hasClass('dynasty-sign'))!;
		const signRight = Math.max(Number(line.getAttribute('x1')), Number(line.getAttribute('x2')));
		const signLeft = Math.min(Number(line.getAttribute('x1')), Number(line.getAttribute('x2')));
		expect(signRight).toBeCloseTo(armsB.rect.x - 0.3 * 16, 6);
		expect(measure(b.getText())).toBeLessThanOrEqual(signLeft - 0.5 * 16 - Number(b.getAttribute('x')) + 1e-6);
	});
});

describe('D76, D78 (C3): the portrait circle, lower right, bottom at the bottom of the text block', () => {
	const blockH = (geo: Geometry, tallName: boolean, tallTitle: boolean) => {
		const lh = LINE_HEIGHT[geo.cardSize];
		return (tallName ? 2 : 1) * lh * geo.fontPx + ((geo.relationLine ? 3 : 2) + (tallTitle ? 1 : 0)) * lh * 0.85 * geo.fontPx;
	};

	for (const size of ['normal', 'compact'] as const) {
		for (const mark of [false, true]) {
			for (const [tallName, tallTitle] of [
				[false, false],
				[true, false],
				[false, true],
				[true, true],
			] as const) {
				it(`${size}, ${mark ? 'relation line' : 'no relation line'}, ${tallName ? 'two-line name' : 'one-line name'}, ${tallTitle ? 'two-line title' : 'one-line title'}`, () => {
					clearLayoutCache();
					const g = graphOf(sample(mark));
					const geo = geometryFor(16, size);
					const settings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine: mark, ...SETS, ...(tallName ? { tallCards: ['a'] } : {}), ...(tallTitle ? { tallTitles: ['a'] } : {}) };
					const laid = lay(g, settings as PictureSettings, geo);
					const { scene: s } = scene(laid, g);
					const box = laid.layout.persons.get('a')!;
					const drawn = laid.layout.geometry;
					const t = cardText(drawn, box.tallName, box.tallTitle);
					const d = sizeOf(drawn);
					const bottom = (box.h + blockH(drawn, tallName, tallTitle)) / 2;
					const slot = s.pictures.find((x) => x.kind === 'portrait' && x.person === 'a')!;
					expect(slot.lod).toBe('full');
					const want = { x: box.x + t.padX + t.textW - d, y: box.y + bottom - d, w: d, h: d };
					for (const k of ['x', 'y', 'w', 'h'] as const) expect(slot.rect[k], k).toBeCloseTo(want[k], 6);
					expect((slot.frame as unknown as FEl | undefined)?.hasClass('dynasty-portrait-frame')).toBe(true);
					// The contract's `textBottom` (C3) is the same place.
					expect((t as CardText & { textBottom?: number }).textBottom).toBeCloseTo(bottom, 6);
				});
			}
		}
	}

	it('S1: the slots of a card come in card order: Full arms, portrait, Compact arms; buildScene makes no <image>', () => {
		clearLayoutCache();
		const g = graphOf(sample(true));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...SETS } as PictureSettings, geometryFor(16, 'normal'));
		const { root, scene: s } = scene(laid, g);
		const order = [...laid.layout.persons.keys()];
		const got = s.pictures.map((x) => `${x.person}:${x.kind}:${x.lod}`);
		const want = order.flatMap((id) => [...(['a', 'b'].includes(id) ? [`${id}:arms:full`] : []), ...(['a', 'c'].includes(id) ? [`${id}:portrait:full`] : []), ...(['a', 'b'].includes(id) ? [`${id}:arms:compact`] : [])]);
		expect(got).toEqual(want);
		expect(all(root).filter((e) => e.tag === 'image')).toEqual([]);
		for (const x of s.pictures.filter((p) => p.lod === 'full')) expect((x.el as unknown as FEl).closest('.dynasty-card-full'), x.person).not.toBeNull();
	});

	it('the setting off (no portraits in the sets): no portrait and no room for one (spec §13.7 acceptance)', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['v'] } as PictureSettings, geometryFor(16, 'normal'));
		const { root, scene: s } = scene(laid, g);
		expect(s.pictures.filter((x) => x.kind === 'portrait')).toEqual([]);
		expect(all(root).filter((e) => e.hasClass('dynasty-portrait-frame'))).toEqual([]);
		expect(textOf(root, 'a', 'dynasty-card-dates')).toEqual(['c. 1102–c. 1161']);
		expect(textOf(root, 'c', 'dynasty-card-title')).toEqual(['Lady of Thornby']);
	});
});

describe('G3, D76, D77: text lines beside the portrait are narrower by the portrait and 0.25 em; the name never narrows', () => {
	it('smallTextWidth: only a line box that overlaps the circle by more than 0.5 px is narrower (relation line: dates and relation)', async () => {
		const smallTextWidth = await smallTextWidthOf();
		clearLayoutCache();
		const g = graphOf(sample(true));
		const geo = geometryFor(16, 'normal');
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...SETS } as PictureSettings, geo);
		const drawn = laid.layout.geometry;
		const t = cardText(drawn);
		const d = sizeOf(drawn);
		const bottom = (drawn.cardH + 1.2 * 16 + 3 * 1.2 * 0.85 * 16) / 2;
		const portrait: Rect = { x: t.padX + t.textW - d, y: bottom - d, w: d, h: d };
		const narrow = t.textW - d - 0.25 * 16;
		expect(smallTextWidth(drawn, t, t.titleBaseline, portrait)).toBeCloseTo(t.textW, 9);
		expect(smallTextWidth(drawn, t, t.datesBaseline, portrait)).toBeCloseTo(narrow, 9);
		expect(smallTextWidth(drawn, t, t.relationBaseline!, portrait)).toBeCloseTo(narrow, 9);
		expect(smallTextWidth(drawn, t, t.datesBaseline, undefined)).toBeCloseTo(t.textW, 9);
		// The 0.5 px rule: a line box that only touches the circle keeps its width.
		const smallLine = 1.2 * 0.85 * 16;
		const lineTop = t.titleBaseline - 0.35 * 0.85 * 16 - smallLine / 2;
		const touching: Rect = { ...portrait, y: lineTop + smallLine - 0.4 };
		const over: Rect = { ...portrait, y: lineTop + smallLine - 0.6 };
		expect(smallTextWidth(drawn, t, t.titleBaseline, touching)).toBeCloseTo(t.textW, 9);
		expect(smallTextWidth(drawn, t, t.titleBaseline, over)).toBeCloseTo(narrow, 9);
	});

	it('a tree with a mark: the dates and the relation text are cut; the name and the title keep their width', () => {
		clearLayoutCache();
		const g = graphOf(sample(true));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true, ...SETS } as PictureSettings, geometryFor(16, 'normal'));
		const relations = new Map([
			['a', { text: 'You', lower: 'you' }],
			['c', { text: 'Great-grandson', lower: 'great-grandson' }],
			['d', { text: 'Great-grandson', lower: 'great-grandson' }],
		]);
		const { root } = scene(laid, g, { relations, me: 'a' });
		// Narrow width 158 − 24 − 4 = 130 px.
		const [dates] = textOf(root, 'a', 'dynasty-card-dates');
		expect(dates).toMatch(/…$/);
		expect(measure(dates)).toBeLessThanOrEqual(130);
		expect(textOf(root, 'a', 'dynasty-card-title')).toEqual(['Duke of Valmont']);
		const [rel] = textOf(root, 'c', 'dynasty-card-relation');
		expect(rel).toMatch(/…$/);
		expect(measure(rel)).toBeLessThanOrEqual(130);
		expect(textOf(root, 'c', 'dynasty-card-title')).toEqual(['Lady of Thornby']);
		// Dorian has no portrait: the same texts keep their width.
		expect(textOf(root, 'd', 'dynasty-card-relation')).toEqual(['Great-grandson']);
		expect(textOf(root, 'd', 'dynasty-card-dates')).toEqual(['c. 1128–c. 1180']);
	});

	it('D77, a tree with no mark: the card keeps its size; the title and the dates beside the portrait are cut with "…"', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const geo = geometryFor(16, 'normal');
		const plain = lay(g, DEFAULT_LAYOUT_SETTINGS, geo);
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geo);
		expect(laid.layout.persons.get('a')!.h).toBe(plain.layout.persons.get('a')!.h);
		const { root } = scene(laid, g);
		for (const id of ['a', 'c']) {
			const [title] = textOf(root, id, 'dynasty-card-title');
			const [dates] = textOf(root, id, 'dynasty-card-dates');
			for (const s of [title, dates]) {
				expect(s, id).toMatch(/…$/);
				expect(measure(s), id).toBeLessThanOrEqual(130);
			}
		}
		expect(textOf(root, 'd', 'dynasty-card-title')).toEqual(['Lord of Thornby']);
		expect(textOf(root, 'd', 'dynasty-card-dates')).toEqual(['c. 1128–c. 1180']);
		// The name never narrows because of a portrait (Clarice's house has no arms).
		expect(textOf(root, 'c', 'dynasty-card-name')).toEqual(['Clarice Thornes']);
	});

	it('D77: a card with no title has its dates on the title line, beside the portrait', () => {
		clearLayoutCache();
		const body = sample(false).replace('    title: Lady of Thornby\n', '');
		const g = graphOf(body);
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geometryFor(16, 'normal'));
		const { root } = scene(laid, g);
		const [dates] = textOf(root, 'c', 'dynasty-card-dates');
		expect(dates).toMatch(/…$/);
		expect(measure(dates)).toBeLessThanOrEqual(130);
	});

	it('a two-line title: the break is made at the normal width, then the second text line beside the portrait is cut', () => {
		clearLayoutCache();
		const g = graphOf(sample(false));
		const labels = new Map<string, CardLabel>(g.people.map((p) => [p.id, { holdings: [], selected: false, name: p.name, ...(p.title ? { title: p.title } : {}) }]));
		labels.set('a', { holdings: [], selected: false, name: 'Aldric Valmont', title: 'Duke of Valmont', reign: '(r. 1102–1161)' });
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS, tallTitles: ['a'] } as PictureSettings, geometryFor(16, 'normal'));
		const { root } = scene(laid, g, { labels });
		const titles = textOf(root, 'a', 'dynasty-card-title');
		expect(titles.length).toBe(2);
		expect(titles[0]).toBe('Duke of Valmont');
		expect(titles[1]).toMatch(/^\(r\. .*…$/);
		expect(measure(titles[1])).toBeLessThanOrEqual(130);
		// The portrait never adds a text line: the same labels with no portrait give the same two lines, uncut.
		const plain = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, arms: ['v'], tallTitles: ['a'] } as PictureSettings, geometryFor(16, 'normal'));
		expect(textOf(scene(plain, g, { labels }).root, 'a', 'dynasty-card-title')).toEqual(['Duke of Valmont', '(r. 1102–1161)']);
	});

	it('compact card size: the circle is 1.375 em; the narrow width is textW − 1.375 em − 0.25 em', async () => {
		const smallTextWidth = await smallTextWidthOf();
		const geo = geometryFor(16, 'compact');
		const t = cardText(geo);
		const d = 1.375 * 16;
		const bottom = (geo.cardH + 1.1 * 16 + 2 * 1.1 * 0.85 * 16) / 2;
		const portrait: Rect = { x: t.padX + t.textW - d, y: bottom - d, w: d, h: d };
		expect(smallTextWidth(geo, t, t.datesBaseline, portrait)).toBeCloseTo(t.textW - d - 4, 9);
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
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, ...SETS } as PictureSettings, geometryFor(16, 'normal'));
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

describe('S4: the legend lists the houses after the line styles (spec §13.6 "Legend")', () => {
	it('a "Houses" title, then one row per house in the given order: colour strip, arms slot, name; the rows are not buttons', () => {
		const list = new FEl('div');
		const houses: LegendHouse[] = [
			{ id: 'valmont', name: 'House Valmont', color: '#8b1e3f', arms: true },
			{ id: 'thorne', name: 'House Thorne', color: '#7a2e6b', arms: false },
			{ id: 'nocolour', name: 'House Grey', arms: true },
		];
		const result = (buildLegend as unknown as (l: FEl, h?: readonly LegendHouse[]) => { arms: Map<string, FEl> })(list, houses);
		const els = all(list);
		const part = els.find((e) => e.hasClass('dynasty-legend-houses'))!;
		expect(part).toBeDefined();
		expect(part.getText()).toContain('Houses');
		const rows = els.filter((e) => e.hasClass('dynasty-legend-house'));
		expect(rows.map((row) => row.getText())).toEqual(['House Valmont', 'House Thorne', 'House Grey']);
		// Line rows come first.
		const firstLine = els.findIndex((e) => e.hasClass('dynasty-legend-row'));
		expect(firstLine).toBeGreaterThanOrEqual(0);
		expect(firstLine).toBeLessThan(els.indexOf(part));
		const strip = all(rows[0]).find((e) => e.hasClass('dynasty-legend-strip'))!;
		expect(strip).toBeDefined();
		expect(strip.styleProps.get('--dynasty-house-color') ?? rows[0].styleProps.get('--dynasty-house-color')).toBe('#8b1e3f');
		expect([...result.arms.keys()].sort()).toEqual(['nocolour', 'valmont']);
		for (const [, el] of result.arms) expect(el.hasClass('dynasty-legend-arms')).toBe(true);
		for (const row of rows) {
			expect(row.getAttribute('role')).toBeNull();
			expect(row.getAttribute('tabindex')).toBeNull();
		}
	});

	it('the line rows are the same as without houses (M8)', () => {
		const a = new FEl('div');
		const b = new FEl('div');
		buildLegend(a as unknown as HTMLElement);
		(buildLegend as unknown as (l: FEl, h?: readonly LegendHouse[]) => void)(b, [{ id: 'valmont', name: 'House Valmont', color: '#8b1e3f', arms: false }]);
		const shape = (el: FEl) => all(el).map((e) => `${e.tag}.${[...e.classes].join('.')}:${e.text}`);
		expect(shape(b).slice(0, shape(a).length)).toEqual(shape(a));
		expect(shape(b).length).toBeGreaterThan(shape(a).length);
	});
});
