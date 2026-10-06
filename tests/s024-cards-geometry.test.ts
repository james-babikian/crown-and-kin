import { describe, expect, it } from 'vitest';
import type { Geometry, NameLineCount } from '../src/layout/model';
import {
	MARKED_SIGNED_BOX_MIN_FONT,
	MARK_CLEAR_PX,
	PICTURE_EM,
	armsPlace,
	boxesClear,
	boxesShown,
	cardBoxes,
	cardText,
	geometryFor,
	nameRoom,
	nameSlots,
	pictureSize,
	portraitBox,
	relationExtra,
	roomAt,
	sidewaysGeometry,
	signBelowRing,
	tallExtra,
	withRelationLine,
} from '../src/layout/geometry';
import { BADGE_RADIUS_EM, signAt } from '../src/render/dom/scene';
import { ME_RING_INNER } from '../src/render/styles';

// 0.2.4 (D117, D119, D125, D126; contract 4.1, 4.2): card sizes, the places of the arms box and the portrait, and the
// checks E3 and E4 over every card kind, name-line count and note font from 8 to 48 px.

type Rect = { x: number; y: number; w: number; h: number };
type Sign = { x1: number; y1: number; x2: number; y2: number; width: number };
const FONTS = Array.from({ length: 41 }, (_, i) => 8 + i);
const LINES: readonly NameLineCount[] = [1, 2, 3];

/** The stroked bar of the D14 sign: its distance to a rectangle, less half its stroke width, sampled every 0.1 px. */
function gapToSign(s: Sign, r: Rect): number {
	const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 0.1));
	let best = Infinity;
	for (let i = 0; i <= n; i++) {
		const x = s.x1 + ((s.x2 - s.x1) * i) / n;
		const y = s.y1 + ((s.y2 - s.y1) * i) / n;
		best = Math.min(best, Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h))));
	}
	return best - s.width / 2;
}

const wholeGeo = (f: number, size: 'normal' | 'compact' = 'normal') => geometryFor(f, size);
const relationGeo = (f: number, size: 'normal' | 'compact' = 'normal') => withRelationLine(geometryFor(f, size), { relationLine: true } as never);

describe('4.1 card sizes and the one text size (D117, D126)', () => {
	it('the card heights are 3.8 em (normal) and 3.35 em (compact), rounded to whole px', () => {
		expect(geometryFor(16, 'normal').cardH).toBe(61);
		expect(geometryFor(12, 'normal').cardH).toBe(46);
		expect(geometryFor(16, 'compact').cardH).toBe(54);
		expect(geometryFor(16, 'normal').cardW).toBe(180);
	});

	it('a card of the normal kind is never higher than the 4 em of 0.2.3, for every font from 8 to 48', () => {
		for (const f of FONTS) expect(geometryFor(f, 'normal').cardH, `font ${f}`).toBeLessThanOrEqual(Math.round(4 * f));
		for (const f of FONTS) expect(geometryFor(f, 'compact').cardH, `font ${f}`).toBeLessThanOrEqual(Math.round(3.5 * f));
	});

	it('the name, title and dates are all 0.85 em; the line height keeps its factor (16.32 px normal, 14.96 px compact at 16 px)', () => {
		for (const size of ['normal', 'compact'] as const) {
			const t = cardText(geometryFor(16, size));
			expect(t.nameSize).toBeCloseTo(13.6, 9);
			expect(t.smallSize).toBeCloseTo(13.6, 9);
		}
		const t = cardText(wholeGeo(16), 2);
		expect(t.name2Baseline! - t.nameBaseline).toBeCloseTo(16.32, 9);
		const c = cardText(wholeGeo(16, 'compact'), 2);
		expect(c.name2Baseline! - c.nameBaseline).toBeCloseTo(14.96, 9);
	});

	it('tallExtra is one 0.85 em text line: 16 px at 16 px, 12 px at 12 px; relationExtra is the same number', () => {
		expect(tallExtra(wholeGeo(16))).toBe(16);
		expect(tallExtra(wholeGeo(12))).toBe(12);
		expect(relationExtra(wholeGeo(16))).toBe(tallExtra(wholeGeo(16)));
	});

	it('the resulting card heights at 16 px: plain 61, with a relation line 77, two-line name 77, three-line name 93, two-line title 77, name and title with relation line 109', () => {
		const plain = wholeGeo(16);
		const rel = relationGeo(16);
		expect([plain.cardH, rel.cardH]).toEqual([61, 77]);
		expect(plain.cardH + tallExtra(plain)).toBe(77);
		expect(plain.cardH + 2 * tallExtra(plain)).toBe(93);
		expect(plain.cardH + relationExtra(plain)).toBe(77);
		expect(rel.cardH + tallExtra(rel) + relationExtra(rel)).toBe(109);
		expect(wholeGeo(12).cardH).toBe(46);
	});

	it('the D14 sign stays level with the middle of the first name text line, x and size unchanged', () => {
		for (const f of [12, 16, 20]) {
			const t = cardText(wholeGeo(f));
			const middle = t.nameBaseline - 0.35 * t.nameSize;
			expect((t.sign.y1 + t.sign.y2) / 2, `font ${f}`).toBeCloseTo(middle, 6);
			expect(t.sign.x1).toBeCloseTo(wholeGeo(f).cardW - 0.5 * f, 9);
			expect(t.sign.x1 - t.sign.x2).toBeCloseTo(1.125 * f, 9);
		}
		// 1.6 px higher than in 0.2.3 at 16 px (the name is smaller): 0.35 * (16 - 13.6) / ... = the middle of the line moved up by the half of 0.35 em difference
		expect(0.35 * (16 - 13.6)).toBeCloseTo(0.84, 2);
	});

	it('textW is 158 px at 16 px and the Compact sign (signAt) is as in 0.2.3: centred on the capitals of the 1.5 em Compact name', () => {
		expect(cardText(wholeGeo(16)).textW).toBe(158);
		const geo = wholeGeo(16);
		const t = cardText(geo);
		const compactBaseline = geo.cardH / 2 + 0.35 * 1.5 * 16;
		const s = signAt(t, 1.5, compactBaseline, t.sign.x1);
		// 0.2.3: top = baseline - 0.35 * f * 1.5 - size / 2 with f the note font.
		expect(s.y1).toBeCloseTo(compactBaseline - 0.35 * 16 * 1.5 - (1.125 * 16 * 1.5) / 2, 9);
	});
});

describe('4.2 the places of the arms box and the portrait (D117)', () => {
	it('the portrait is a square of pictureSize, its right edge at the right edge of the text, its bottom at the text block bottom', () => {
		for (const f of [12, 16, 20]) {
			const geo = wholeGeo(f);
			const t = cardText(geo);
			const p = portraitBox(geo, t);
			expect(p.w).toBeCloseTo(pictureSize(geo), 9);
			expect(p.x + p.w).toBeCloseTo(t.padX + t.textW, 9);
			expect(p.y + p.h).toBeCloseTo(t.textBottom, 9);
		}
	});

	it('the arms box is 5/6 of the portrait wide, ends at the portrait bottom, 0.3 em left of it; with no portrait at the text right edge', () => {
		const geo = wholeGeo(16);
		const t = cardText(geo);
		const p = portraitBox(geo, t);
		const a = armsPlace(geo, t, geo.cardH, undefined, p).full;
		expect(a.w).toBeCloseTo((5 / 6) * p.h, 9);
		expect(a.y + a.h).toBeCloseTo(p.y + p.h, 9);
		expect(p.x - (a.x + a.w)).toBeCloseTo(0.3 * 16, 9);
		const alone = armsPlace(geo, t, geo.cardH).full;
		expect(alone.x + alone.w).toBeCloseTo(t.padX + t.textW, 9);
	});

	it('the two boxes never overlap, for every font, size, name-line count and relation line', () => {
		for (const size of ['normal', 'compact'] as const)
			for (const f of FONTS)
				for (const geo of [wholeGeo(f, size), relationGeo(f, size)])
					for (const lines of LINES) {
						const t = cardText(geo, lines);
						const boxH = geo.cardH + (lines - 1) * tallExtra(geo);
						const cb = cardBoxes(geo, t, boxH, { arms: true, portrait: true });
						expect(cb.arms!.full.x + cb.arms!.full.w, `${size} ${f}`).toBeLessThan(cb.portrait!.x);
					}
	});

	it('the lift of rule B raises both boxes by the same px; with one box that box lifts', () => {
		const geo = relationGeo(16);
		const t = cardText(geo);
		const a = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true });
		const b = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true, lift: 16.32 });
		expect(a.portrait!.y - b.portrait!.y).toBeCloseTo(16.32, 9);
		expect(a.arms!.full.y - b.arms!.full.y).toBeCloseTo(16.32, 9);
		const only = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: false, lift: 10 });
		expect(only.portrait).toBeUndefined();
		expect(only.arms!.full.y).toBeCloseTo(a.arms!.full.y - 10, 9);
	});

	it('the marked card: the boxes end MARK_CLEAR_PX above the inner edge of the ring when the text block comes lower', () => {
		for (const f of [8, 12, 16, 24]) {
			const geo = wholeGeo(f);
			const t = cardText(geo);
			const cb = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true, ring: ME_RING_INNER });
			expect(geo.cardH - ME_RING_INNER - (cb.portrait!.y + cb.portrait!.h), `font ${f}`).toBeGreaterThanOrEqual(MARK_CLEAR_PX - 1e-9);
		}
	});

	it('roomAt: a box narrows the line when their heights overlap by more than 0.5 px; the line ends a gap before the box', () => {
		const geo = wholeGeo(16);
		const t = cardText(geo);
		const p = portraitBox(geo, t);
		const box = { r: p, gap: PICTURE_EM.portraitGap * 16 };
		expect(roomAt(geo, t, t.datesBaseline, t.smallSize, [box])).toBeCloseTo(t.textW - p.w - 4, 9);
		expect(roomAt(geo, t, t.nameBaseline, t.nameSize, [box])).toBe(t.textW);
		expect(roomAt(geo, t, t.datesBaseline, t.smallSize, [])).toBe(t.textW);
	});
});

describe('4.2 nameRoom (D125 a)', () => {
	const boxesOf = (geo: Geometry, t: ReturnType<typeof cardText>, boxH: number, kind: 'shield' | 'portrait' | 'both') => cardBoxes(geo, t, boxH, { arms: kind !== 'portrait', portrait: kind !== 'shield' }).boxes;

	it('a whole card: last, only and full are equal (the boxes sit beside the small text lines)', () => {
		for (const f of [8, 12, 16, 20, 48])
			for (const size of ['normal', 'compact'] as const)
				for (const geo of [wholeGeo(f, size), relationGeo(f, size)])
					for (const kind of ['shield', 'portrait', 'both'] as const) {
						const t = cardText(geo);
						const r = nameRoom(geo, t, false, boxesOf(geo, t, geo.cardH, kind));
						expect(r, `${size} ${f} ${kind}`).toEqual({ full: t.textW, last: t.textW, only: t.textW });
					}
	});

	it('`last` is the same for a card of 1, 2 and 3 name lines (under 0.5 px)', () => {
		for (const f of [8, 12, 16, 20, 48])
			for (const size of ['normal', 'compact'] as const)
				for (const geo of [wholeGeo(f, size), relationGeo(f, size)])
					for (const kind of ['shield', 'portrait', 'both'] as const) {
						const rooms = LINES.map((n) => {
							const t = cardText(geo, n);
							return nameRoom(geo, t, false, boxesOf(geo, t, geo.cardH + (n - 1) * tallExtra(geo), kind)).last;
						});
						expect(Math.max(...rooms) - Math.min(...rooms), `${size} ${f} ${kind}: ${rooms}`).toBeLessThan(0.5);
					}
	});

	it('a signed whole card: full is nameWithSignW and the boxes do not reach the name', () => {
		const geo = wholeGeo(16);
		const t = cardText(geo);
		expect(nameRoom(geo, t, true, boxesOf(geo, t, geo.cardH, 'both'))).toEqual({ full: t.nameWithSignW, last: t.nameWithSignW, only: t.nameWithSignW });
	});
});

// E4 (contract 4.2): on every card kind the D14 sign, the badge disc, the ring of the marked card and the line ends keep clear of the boxes.
describe('E4: boxes against the D14 sign, the badge disc and the ring, every card kind, line count and font from 8 to 48 px', () => {
	type Kind = 'whole' | 'whole+relation';
	const KINDS: readonly Kind[] = ['whole', 'whole+relation'];
	const geoOf = (kind: Kind, f: number, size: 'normal' | 'compact' = 'normal') => (kind === 'whole' ? wholeGeo(f, size) : relationGeo(f, size));
	const PICTURES = [
		{ arms: true, portrait: false },
		{ arms: false, portrait: true },
		{ arms: true, portrait: true },
	] as const;

	for (const kind of KINDS)
		for (const size of ['normal', 'compact'] as const)
			for (const marked of [false, true])
				it(`${kind}, ${size} cards${marked ? ', marked (ring)' : ''}: a signed card keeps 1.5 px from each box and the box stays off the badge`, () => {
					const bad: string[] = [];
					for (const f of FONTS)
						for (const lines of LINES)
							for (const signed of [false, true]) {
								const geo = geoOf(kind, f, size);
								const slots = nameSlots(geo, lines, signed, marked);
								const t = cardText(geo, slots);
								const boxH = geo.cardH + (slots - 1) * tallExtra(geo);
								const ring = marked ? ME_RING_INNER : undefined;
								// The exception of contract 4.2 E4: a marked, signed card shows no boxes below 11 px on a Normal card; D129 removed the limit for a Compact card (it is one small text line higher).
								if (!boxesShown(geo, marked, signed)) continue;
								for (const pic of PICTURES) {
									const cb = cardBoxes(geo, t, boxH, { ...pic, ...(ring === undefined ? {} : { ring }) });
									const rects = [...(cb.arms ? [cb.arms.full] : []), ...(cb.portrait ? [cb.portrait] : [])];
									const sign = ring === undefined ? t.sign : signBelowRing(t.sign, ring);
									for (const r of rects) {
										if (signed) {
											const g = gapToSign(sign, r);
											if (g < MARK_CLEAR_PX - 1e-9) bad.push(`f${f} ${lines}L ${JSON.stringify(pic)} sign gap ${g.toFixed(2)}`);
										}
										const dx = Math.max(r.x - geo.cardW, 0, geo.cardW - (r.x + r.w));
										const dy = Math.max(r.y, 0, -(r.y + r.h));
										const disc = Math.hypot(dx, dy) - BADGE_RADIUS_EM * f;
										if (disc < MARK_CLEAR_PX - 1e-9) bad.push(`f${f} ${lines}L badge gap ${disc.toFixed(2)}`);
										if (ring !== undefined) {
											// The ring at the bottom: the box ends MARK_CLEAR_PX above its inner edge; at the right: 1.5 px from font 9, positive at font 8.
											const bottom = boxH - ring - (r.y + r.h);
											if (bottom < MARK_CLEAR_PX - 1e-9) bad.push(`f${f} ring bottom ${bottom.toFixed(2)}`);
											const right = geo.cardW - ring - (r.x + r.w);
											if (f >= 9 ? right < MARK_CLEAR_PX - 1e-9 : right <= 0) bad.push(`f${f} ring right ${right.toFixed(2)}`);
										}
									}
								}
							}
					expect(bad.slice(0, 10), `${bad.length} problems`).toEqual([]);
				});

	it('boxesClear agrees with the matrix: a lift that would bring a box to the sign is refused', () => {
		const geo = relationGeo(16);
		const t = cardText(geo);
		const lifted = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true, lift: 16.32 });
		const rects = [lifted.arms!.full, lifted.portrait!];
		expect(boxesClear(geo, t, rects, { signed: true })).toBe(true);
		// A lift of three lines would reach the sign.
		const high = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true, lift: 3 * 16.32 });
		expect(boxesClear(geo, t, [high.arms!.full, high.portrait!], { signed: true })).toBe(false);
	});

	it('the marked, signed Normal card shows no boxes below 11 px: the matrix fails there with the old 3 px ring edge (E4 exception), and holds from there on', () => {
		expect(MARKED_SIGNED_BOX_MIN_FONT).toBe(11);
		// D153: the mark is now one 3 px border whose inner edge is 1.5 px in, so the matrix holds at every font. The rule stays as it was (the classic
		// Normal card has no form in the plugin since 0.2.5), and it is still checked against the ring edge of 0.2.4 (3 px) that it was made for.
		const OLD_RING = 3;
		const failing: number[] = [];
		for (const f of FONTS) {
			const geo = wholeGeo(f);
			const t = cardText(geo);
			const gap = (ring: number) => {
				const sign = signBelowRing(t.sign, ring);
				const cb = cardBoxes(geo, t, geo.cardH, { arms: true, portrait: true, ring });
				return Math.min(gapToSign(sign, cb.arms!.full), gapToSign(sign, cb.portrait!));
			};
			if (gap(OLD_RING) < MARK_CLEAR_PX - 1e-9) failing.push(f);
			expect(gap(ME_RING_INNER), `font ${f} with the border of D153`).toBeGreaterThanOrEqual(MARK_CLEAR_PX - 1e-9);
			expect(boxesShown(geo, true, true), `font ${f}`).toBe(f >= MARKED_SIGNED_BOX_MIN_FONT);
			expect(boxesShown(geo, true, false), `font ${f} (not signed)`).toBe(true);
			expect(boxesShown(geo, false, true), `font ${f} (not marked)`).toBe(true);
		}
		// Every font that fails with the old ring is below the limit, and there is one.
		expect(failing.length).toBeGreaterThan(0);
		expect(Math.max(...failing)).toBeLessThan(MARKED_SIGNED_BOX_MIN_FONT);
	});

	it('D129: the marked, signed Compact card is one small text line (tallExtra) higher and shows its boxes at every font; no other Compact card gets the line', () => {
		for (const f of FONTS) {
			const geo = wholeGeo(f, 'compact');
			expect(boxesShown(geo, true, true), `font ${f}`).toBe(true);
			expect(nameSlots(geo, 1, true, true), `font ${f} marked, signed`).toBe(2);
			expect(nameSlots(geo, 1, true, false), `font ${f} signed only`).toBe(1);
			expect(nameSlots(geo, 1, false, true), `font ${f} marked only`).toBe(1);
			expect(nameSlots(geo, 2, true, true), `font ${f} two lines`).toBe(2);
			// The Normal card is as before.
			expect(nameSlots(wholeGeo(f), 1, true, true), `font ${f} normal`).toBe(1);
			// The text block stays centred, so the sign stays and the bottom of the text moves down by one line.
			expect(Math.abs(cardText(geo, 2).textBottom - cardText(geo, 1).textBottom - tallExtra(geo)), `font ${f}`).toBeLessThan(1);
		}
	});

	it('the Compact level (1.5 em name, Compact arms box, sign left of it): the sign keeps 1.5 px from the arms box from 9 px (about 1.46 px at 8 px, as in 0.2.3)', () => {
		const bad: string[] = [];
		const at8: number[] = [];
		for (const f of FONTS) {
			for (const size of ['normal', 'compact'] as const) {
				for (const marked of [false, true]) {
					const geo = wholeGeo(f, size);
					const t = cardText(geo);
					// D129: the marked Compact card that has the sign is one text line higher; the Compact level is centred on its height.
					const boxH = geo.cardH + (marked && size === 'compact' ? tallExtra(geo) : 0);
					const place = armsPlace(geo, t, boxH, marked ? ME_RING_INNER : undefined);
					const base = signAt(t, 1.5, boxH / 2 + 0.35 * 1.5 * f, t.sign.x1);
					const moved = { ...base, x1: base.x1 - place.compactShift, x2: base.x2 - place.compactShift };
					const sign = marked ? signBelowRing(moved, ME_RING_INNER) : moved;
					const g = gapToSign(sign, place.compact);
					if (f === 8) at8.push(g);
					else if (g < MARK_CLEAR_PX - 1e-9) bad.push(`${size} f${f} marked ${marked}: ${g.toFixed(2)}`);
				}
			}
		}
		expect(bad.slice(0, 8), `${bad.length} problems`).toEqual([]);
		expect(Math.min(...at8)).toBeGreaterThan(1.4);
	});

});

// E3 (contract 4.2): the end of the D14 sign against the disc of the badge on the top right corner. The sign does not move.
describe('E3: the sign end and the badge disc (Full and Compact)', () => {
	it('the centre line of the sign ends at least r - width/2 from the badge centre, on every kind, font and name-line count; Compact too', () => {
		const bad: string[] = [];
		for (const f of FONTS) {
			for (const geo of [wholeGeo(f), relationGeo(f), wholeGeo(f, 'compact')]) {
				for (const lines of LINES) {
					const slots = nameSlots(geo, lines, true);
					const t = cardText(geo, slots);
					const need = BADGE_RADIUS_EM * f - t.sign.width / 2;
					const end = Math.hypot(geo.cardW - t.sign.x1, t.sign.y1);
					if (end < need - 1e-9) bad.push(`Full f${f} ${geo.cardSize} ${lines}L: ${end.toFixed(2)} < ${need.toFixed(2)}`);
				}
			}
			// Compact: the sign is drawn through `signAt` (the Compact name is 1.5 em of the note font).
			const geo = wholeGeo(f, 'compact');
			const t = cardText(geo);
			const compactBaseline = geo.cardH / 2 + 0.35 * 1.5 * f;
			const s = signAt(t, 1.5, compactBaseline, t.sign.x1);
			const need = BADGE_RADIUS_EM * f - s.width / 2;
			const end = Math.hypot(geo.cardW - s.x1, s.y1);
			if (end < need - 1e-9) bad.push(`Compact f${f}: ${end.toFixed(2)} < ${need.toFixed(2)}`);
		}
		// E3 is a check, not a failure (D126 2): a result below the threshold is reported. Today the reports are all on 3.35 em cards at 8 and 9 px,
		// and none is more than 0.1 px short. At the owner's font of 12 px and at 16 px there are none.
		expect(bad.every((r) => /Full f(8|9) compact/.test(r)), bad.join('; ')).toBe(true);
		expect(bad.length, bad.join('; ')).toBeLessThanOrEqual(3);
	});

	it('numbers at 16 px: the upper end of the sign is 9.5 px from the badge centre (the disc is 9.6 px): the disc covers its end by 0.07 px plus the stroke, and the sign does not move (D126 2)', () => {
		const t = cardText(wholeGeo(16));
		const end = Math.hypot(wholeGeo(16).cardW - t.sign.x1, t.sign.y1);
		expect(end).toBeGreaterThan(9.4);
		expect(end).toBeLessThan(9.7);
		expect(BADGE_RADIUS_EM * 16).toBeCloseTo(9.6, 9);
	});

	it('the sideways geometry keeps the card size, so the sign and the boxes keep their places', () => {
		const geo = wholeGeo(16);
		const side = sidewaysGeometry(geo);
		expect(side.cardH).toBe(geo.cardH);
		expect(side.cardW).toBe(geo.cardW);
	});
});
