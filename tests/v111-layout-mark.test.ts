import { beforeAll, describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { armsPlace, cardText, drawnGeometry, geometryFor, portraitBox, signBelowRing, tallExtra, MARK_CLEAR_PX } from '../src/layout/geometry';
import { illegitimateSigns } from '../src/layout/illegitimate-sign';
import { DEFAULT_LAYOUT_SETTINGS, armsCards, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { buildScene } from '../src/render/dom/scene';
import { tallCardsFor } from '../src/render/dom/tall-cards';
import { DEFAULT_LIGHT, ME_LOOK, ME_RING_INNER } from '../src/render/styles';
import { approxMeasure, renderSvg } from '../src/render/svg-string';
import { FEl, installDom } from './acceptance/fake-dom';

// WP 0.2.1-WP2, D96: on the "This is me" card the arms box, the portrait and the D14 sign keep a gap of
// at least 1.5 px to the inner edge of the mark's ring; every other card is drawn as before.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (s: string) => [...s].length * 8;
const URI = 'data:image/png;base64,AAAA';
const SIZES = ['normal', 'compact'] as const;
const NOTE_FONTS = [12, 14, 16, 18, 20];
const EPS = 1e-9;

// Two cards with the same data: `m` is marked, `o` is not. Both have arms, a portrait and the D14 sign. The names are short, so no name needs a second text line (only D129 makes a card taller).
const SOURCE = `houses:
  - {id: v, name: House V, color: "#8b1e3f", arms: "[[v.png]]"}
people:
  - {id: m, name: Me Val, house: v, illegitimate: true, portrait: "[[m.png]]"}
  - {id: o, name: Other Val, house: v, illegitimate: true, portrait: "[[o.png]]"}
`;

function graph(): FamilyGraph {
	const r = parseDynasty(SOURCE);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

/** The layout the tree view makes: a first pass for the signs, then `tallCardsFor` (marked person `m`) and the layout with the tall cards (D129: the marked, signed Compact card is one text line higher). */
function lay(g: FamilyGraph, font: number, size: 'normal' | 'compact', relationLine: boolean): LaidOut {
	clearLayoutCache();
	const geo = geometryFor(font, size);
	const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, relationLine, ...pictureSets(g, true) };
	const first = layoutTree(g, geo, settings, 'test');
	const sets = pictureSets(g, true);
	const tall = tallCardsFor(g, drawnGeometry(geo, settings), FONTS, measure, illegitimateSigns(g, first.edges), undefined, armsCards(g, sets.arms), undefined, {
		marked: 'm',
		portraits: new Set(sets.portraits),
	});
	return layoutTree(g, geo, { ...settings, tallCards: tall?.tall ?? [], longNames: tall?.long ?? [] }, 'test');
}

/** The cases every test below walks through. */
const CASES = SIZES.flatMap((size) => NOTE_FONTS.flatMap((font) => [false, true].map((relationLine) => ({ size, font, relationLine }))));
const label = (c: (typeof CASES)[number]) => `${c.size} card, ${c.font} px${c.relationLine ? ', relation line' : ''}`;

interface Rel {
	x: number;
	y: number;
	w: number;
	h: number;
}
interface Parts {
	arms: Rel[];
	portrait?: Rel;
	/** Top edge of every D14 sign's stroke (Full and Compact), card-relative. */
	signTops: number[];
	boxH: number;
}

/** Top corner of a flat-ended stroke from (x1, y1) to (x2, y2) at 45 degrees. */
const strokeTop = (y1: number, y2: number, width: number) => Math.min(y1, y2) - width / (2 * Math.SQRT2);

function sceneParts(g: FamilyGraph, laid: LaidOut, id: string, me: string | undefined): Parts {
	const s = buildScene(new FEl('g') as unknown as SVGGElement, g, laid, { fonts: FONTS, measure, link: () => null, ...(me ? { me } : {}) });
	const box = laid.layout.persons.get(id)!;
	const rel = (r: Rel) => ({ x: r.x - box.x, y: r.y - box.y, w: r.w, h: r.h });
	const mine = s.pictures.filter((p) => p.person === id);
	const card = s.cards.get(id) as unknown as FEl;
	const signs = card.all().filter((e) => e.tag === 'line' && e.hasClass('dynasty-sign'));
	return {
		arms: mine.filter((p) => p.kind === 'arms').map((p) => rel(p.rect)),
		portrait: mine.filter((p) => p.kind === 'portrait').map((p) => rel(p.rect))[0],
		signTops: signs.map((e) => strokeTop(Number(e.getAttribute('y1')), Number(e.getAttribute('y2')), Number(e.getAttribute('stroke-width'))) - box.y),
		boxH: box.h,
	};
}

/** The headless drawing's arms, portrait and sign of the cards in drawing order; `which` picks the card. */
function svgParts(g: FamilyGraph, laid: LaidOut, me: string | undefined): { arms: Rel[]; portrait: Rel[]; signs: { y1: number; y2: number; width: number }[]; ids: string[] } {
	const pictures = new Map<string, string | 'missing' | null>([['arms:v', URI], ['portrait:m', URI], ['portrait:o', URI]]);
	const svg = renderSvg(g, laid.layout, laid.edges, { palette: DEFAULT_LIGHT, dark: false, measure: approxMeasure, fonts: FONTS, pictures, ...(me ? { me } : {}) });
	const num = (tag: string, name: string) => Number(new RegExp(` ${name}="([^"]+)"`).exec(tag)![1]);
	const images = [...svg.matchAll(/<image [^>]*>/g)].map((m) => m[0]);
	const rect = (tag: string): Rel => ({ x: num(tag, 'x'), y: num(tag, 'y'), w: num(tag, 'width'), h: num(tag, 'height') });
	const lines = [...svg.matchAll(/<line [^>]*stroke-dasharray[^>]*>/g)].map((m) => m[0]);
	return {
		arms: images.filter((t) => t.includes('meet')).map(rect),
		portrait: images.filter((t) => t.includes('slice')).map(rect),
		signs: lines.map((t) => ({ y1: num(t, 'y1'), y2: num(t, 'y2'), width: num(t, 'stroke-width') })),
		ids: [...laid.layout.persons.keys()],
	};
}

describe('D96 geometry', () => {
	it('the ring edge is taken from ME_LOOK: half the border and the whole ring', () => {
		expect(ME_RING_INNER).toBe(ME_LOOK.border / 2 + ME_LOOK.ring);
		expect(MARK_CLEAR_PX).toBe(1.5);
	});

	it.each(CASES.map((c) => [label(c), c] as const))('armsPlace with a ring: both boxes start at least 1.5 px below it (%s)', (_n, c) => {
		const geo = { ...geometryFor(c.font, c.size), ...(c.relationLine ? { relationLine: true } : {}) };
		const t = cardText(geo);
		const place = armsPlace(geo, t, geo.cardH, ME_RING_INNER);
		const plain = armsPlace(geo, t, geo.cardH);
		expect(place.full.y - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		expect(place.compact.y - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		// 0.2.4 (D117): the Full box ends at the bottom of the text block, so the ring only ever moves it up, never down.
		expect(place.full.y).toBeLessThanOrEqual(plain.full.y);
		expect(geo.cardH - ME_RING_INNER - (place.full.y + place.full.h)).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		expect({ ...place, full: { ...place.full, y: 0 }, compact: { ...place.compact, y: 0 } }).toEqual({ ...plain, full: { ...plain.full, y: 0 }, compact: { ...plain.compact, y: 0 } });
	});

	it('without a ring nothing moves: the places of D117 at the lower right, and the Compact arms centred (D78)', () => {
		const geo = geometryFor(16, 'normal');
		const t = cardText(geo);
		const place = armsPlace(geo, t, geo.cardH);
		expect(place.full.y + place.full.h).toBeCloseTo(t.textBottom, 9);
		expect(place.full.x + place.full.w).toBeCloseTo(t.padX + t.textW, 9);
		expect(place.compact.y).toBeCloseTo(geo.cardH / 2 - 14.4, 9);
		expect(portraitBox(geo, t).y + 24).toBeCloseTo(t.textBottom, 9);
		expect(signBelowRing(t.sign, 0)).toEqual(t.sign);
	});

	it('a gap that is wide enough already is left alone', () => {
		const geo = geometryFor(16, 'normal');
		const t = cardText(geo);
		// A ring that ends 1 px inside the edge leaves a wide gap already; the arms stay where they are.
		expect(armsPlace(geo, t, geo.cardH, 1).full).toEqual(armsPlace(geo, t, geo.cardH).full);
		expect(portraitBox(geo, t, { boxH: geo.cardH, ring: ME_RING_INNER })).toEqual(portraitBox(geo, t));
		// The sign sits 1.6 px higher with the smaller name (D117): a ring that ends 2 px inside the edge leaves it alone.
		expect(signBelowRing(t.sign, 2)).toEqual(t.sign);
	});

	it('the arms box is left of the portrait at the same bottom, and the two never overlap (D117)', () => {
		const geo = geometryFor(16, 'normal');
		const t = cardText(geo);
		const portrait = portraitBox(geo, t);
		const place = armsPlace(geo, t, geo.cardH, undefined, portrait);
		expect(place.full.y + place.full.h).toBeCloseTo(portrait.y + portrait.h, 9);
		expect(place.full.x + place.full.w).toBeLessThan(portrait.x);
		expect(portrait.x - (place.full.x + place.full.w)).toBeCloseTo(0.3 * 16, 9);
	});

	it('the Compact card at 16 px really needs the move (the owner picture)', () => {
		const geo = geometryFor(16, 'compact');
		const t = cardText(geo);
		const sign = t.sign;
		expect(strokeTop(sign.y1, sign.y2, sign.width) - ME_RING_INNER).toBeLessThan(MARK_CLEAR_PX);
		const moved = signBelowRing(sign, ME_RING_INNER);
		expect(strokeTop(moved.y1, moved.y2, moved.width) - ME_RING_INNER).toBeCloseTo(MARK_CLEAR_PX, 9);
		// The sign only moves down, and keeps its length and slope.
		expect(moved.y2 - moved.y1).toBeCloseTo(sign.y2 - sign.y1, 9);
		expect([moved.x1, moved.x2]).toEqual([sign.x1, sign.x2]);
	});
});

describe('D96 live drawing (the scene)', () => {
	const g = graph();
	it.each(CASES.map((c) => [label(c), c] as const))('D129: the marked, signed Compact card is one text line higher than the card that is not marked; a Normal card is not (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		const mine = laid.layout.persons.get('m')!.h;
		const other = laid.layout.persons.get('o')!.h;
		expect(mine - other).toBe(c.size === 'compact' ? tallExtra(laid.layout.geometry) : 0);
	});

	it.each(CASES.map((c) => [label(c), c] as const))('the marked card keeps 1.5 px clear of the ring (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		const p = sceneParts(g, laid, 'm', 'm');
		expect(p.arms).toHaveLength(2);
		for (const a of p.arms) expect(a.y - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		expect(p.boxH - ME_RING_INNER - (p.portrait!.y + p.portrait!.h)).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		expect(p.signTops).toHaveLength(2);
		for (const top of p.signTops) expect(top - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
	});

	it.each(CASES.map((c) => [label(c), c] as const))('a card that is not marked is drawn exactly as when no card is marked (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		expect(sceneParts(g, laid, 'o', 'm')).toEqual(sceneParts(g, laid, 'o', undefined));
		const t = cardText(laid.layout.geometry);
		// ... and the arms sit at the lower right, ending where the portrait ends (D117, spec §13.6).
		const parts = sceneParts(g, laid, 'o', 'm');
		expect(parts.arms[0].y + parts.arms[0].h).toBeCloseTo(t.textBottom, 9);
		expect(parts.arms[0].y + parts.arms[0].h).toBeCloseTo(parts.portrait!.y + parts.portrait!.h, 9);
	});
});

describe('D96 headless drawing (svg-string)', () => {
	const g = graph();
	it.each(CASES.map((c) => [label(c), c] as const))('the marked card keeps 1.5 px clear of the ring (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		const box = laid.layout.persons.get('m')!;
		const parts = svgParts(g, laid, 'm');
		const at = laid.layout.persons.size && [...laid.layout.persons.keys()].indexOf('m');
		expect(parts.arms[at].y - box.y - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		const p = parts.portrait[at];
		expect(box.h - ME_RING_INNER - (p.y + p.h - box.y)).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
		const s = parts.signs[at];
		expect(strokeTop(s.y1, s.y2, s.width) - box.y - ME_RING_INNER).toBeGreaterThanOrEqual(MARK_CLEAR_PX - EPS);
	});

	it.each(CASES.map((c) => [label(c), c] as const))('the live drawing and the headless drawing put the pictures in the same place (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		const box = laid.layout.persons.get('m')!;
		const live = sceneParts(g, laid, 'm', 'm');
		const parts = svgParts(g, laid, 'm');
		const at = [...laid.layout.persons.keys()].indexOf('m');
		const a = parts.arms[at];
		expect(a.y - box.y).toBeCloseTo(live.arms[0].y, 9);
		expect(parts.portrait[at].y - box.y).toBeCloseTo(live.portrait!.y, 9);
		const s = parts.signs[at];
		expect(strokeTop(s.y1, s.y2, s.width) - box.y).toBeCloseTo(live.signTops[0], 9);
	});

	it.each(CASES.map((c) => [label(c), c] as const))('the card that is not marked is drawn as when no card is marked (%s)', (_n, c) => {
		const laid = lay(g, c.font, c.size, c.relationLine);
		const at = [...laid.layout.persons.keys()].indexOf('o');
		const marked = svgParts(g, laid, 'm');
		const none = svgParts(g, laid, undefined);
		expect(marked.arms[at]).toEqual(none.arms[at]);
		expect(marked.portrait[at]).toEqual(none.portrait[at]);
		expect(marked.signs[at]).toEqual(none.signs[at]);
	});
});
