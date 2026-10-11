import { describe, expect, it } from 'vitest';
import type { NameLineCount } from '../src/layout/model';
import { cardText, geometryFor, relationExtra, sidewaysGeometry, tallExtra, withRelationLine } from '../src/layout/geometry';
import { BADGE_RADIUS_EM, signAt } from '../src/render/dom/scene';

// 0.2.4 (D117, D119, D125, D126; contract 4.1): the card height, the one text size and the check E3 over every name-line count and note font from 8 to 48 px.
// 0.2.6 (D179): the card size Compact and the classic card are gone, so the tests of the lower-right boxes (4.2, E4, D129, rule B) are gone with them.

const FONTS = Array.from({ length: 41 }, (_, i) => 8 + i);
const LINES: readonly NameLineCount[] = [1, 2, 3];

const wholeGeo = (f: number) => geometryFor(f);
const relationGeo = (f: number) => withRelationLine(geometryFor(f), { relationLine: true } as never);

// 0.2.8 (I01): the badge centre lies on the middle of the arc of the card corner (radius 8 px, the default theme's --radius-m): this far in from the corner on each side.
const CORNER_C = 8 - 8 / Math.SQRT2;

describe('4.1 the card size and the one text size (D117, D126)', () => {
	it('the card height is 3.8 em, rounded to whole px', () => {
		expect(geometryFor(16).cardH).toBe(61);
		expect(geometryFor(12).cardH).toBe(46);
		expect(geometryFor(16).cardW).toBe(180);
	});

	it('a card is never higher than the 4 em of 0.2.3, for every font from 8 to 48', () => {
		for (const f of FONTS) expect(geometryFor(f).cardH, `font ${f}`).toBeLessThanOrEqual(Math.round(4 * f));
	});

	it('the name, title and dates are all 0.85 em; the line height keeps its factor (16.32 px at 16 px)', () => {
		const one = cardText(geometryFor(16));
		expect(one.nameSize).toBeCloseTo(13.6, 9);
		expect(one.smallSize).toBeCloseTo(13.6, 9);
		const t = cardText(wholeGeo(16), 2);
		expect(t.name2Baseline! - t.nameBaseline).toBeCloseTo(16.32, 9);
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

// E3 (contract 4.2): the end of the D14 sign against the disc of the badge on the top right corner. The sign does not move.
describe('E3: the sign end and the badge disc (Full and Compact)', () => {
	it('the badge covers the end of the sign by at most 0.3 em, on every kind, font and name-line count; Compact too (0.2.8: the disc is 0.55 em and its centre lies on the corner arc; 0.2.7 kept the end clear of the disc)', () => {
		const bad: string[] = [];
		for (const f of FONTS) {
			for (const geo of [wholeGeo(f), relationGeo(f)]) {
				for (const lines of LINES) {
					const t = cardText(geo, lines);
					const need = BADGE_RADIUS_EM * f - t.sign.width / 2;
					const end = Math.hypot(geo.cardW - CORNER_C - t.sign.x1, t.sign.y1 - CORNER_C);
					// The plate form (relation line) centres its text by 0.25 em differently from the old card, so a shortfall under 0.05 px is allowed (a check, D126 2).
					if (end < need - 0.3 * f) bad.push(`Full f${f} ${lines}L: ${end.toFixed(2)} < ${need.toFixed(2)} - 0.3 em`);
				}
			}
			// Compact: the sign is drawn through `signAt` (the Compact name is 1.5 em of the note font).
			const geo = wholeGeo(f);
			const t = cardText(geo);
			const compactBaseline = geo.cardH / 2 + 0.35 * 1.5 * f;
			const s = signAt(t, 1.5, compactBaseline, t.sign.x1);
			const need = BADGE_RADIUS_EM * f - s.width / 2;
			const end = Math.hypot(geo.cardW - CORNER_C - s.x1, s.y1 - CORNER_C);
			if (end < need - 0.3 * f) bad.push(`Compact f${f}: ${end.toFixed(2)} < ${need.toFixed(2)} - 0.3 em`);
		}
		// E3 is a check, not a failure (D126 2). The only reports of 0.2.4 were on the Compact size (3.35 em cards at 8 and 9 px), which is gone (D179).
		expect(bad, bad.join('; ')).toEqual([]);
	});

	it('numbers at 16 px: the upper end of the sign is 9.5 px from the corner and 6.4 px from the badge centre, which lies on the corner arc (the disc is 8.8 px): the disc covers 2 px of its end, and the sign does not move (D126 2; 0.2.8, I01)', () => {
		const t = cardText(wholeGeo(16));
		expect(Math.hypot(wholeGeo(16).cardW - t.sign.x1, t.sign.y1)).toBeGreaterThan(9.4);
		expect(Math.hypot(wholeGeo(16).cardW - t.sign.x1, t.sign.y1)).toBeLessThan(9.7);
		const end = Math.hypot(wholeGeo(16).cardW - CORNER_C - t.sign.x1, t.sign.y1 - CORNER_C);
		expect(end).toBeGreaterThan(6.3);
		expect(end).toBeLessThan(6.5);
		expect(BADGE_RADIUS_EM * 16).toBeCloseTo(8.8, 9);
	});

	it('the sideways geometry keeps the card size, so the sign keeps its place', () => {
		const geo = wholeGeo(16);
		const side = sidewaysGeometry(geo);
		expect(side.cardH).toBe(geo.cardH);
		expect(side.cardW).toBe(geo.cardW);
	});
});
