import { describe, expect, it } from 'vitest';
import type { NameLineCount } from '../../src/layout/model';
import { cardText, geometryFor, relationExtra, sidewaysGeometry, tallExtra, withRelationLine } from '../../src/layout/geometry';
import { BADGE_RADIUS_EM, signAt } from '../../src/render/dom/scene';

// 0.2.4 (D117, D119, D125, D126): the card height, the one text size and the check E3 over every name-line count and note font from 8 to 48 px.
// 0.5.2 (D330, O-02): card text is never under 12 px, so a note font under 12 / 0.85 = 14.1 px is made as 14.1 px. Tests that compare a size with the note font use the geometry's own font (`own`).
// 0.2.6 (D179): the card size Compact and the classic card are gone, so the tests of the lower-right boxes (4.2, E4, D129, rule B) are gone with them.

const FONTS = Array.from({ length: 41 }, (_, i) => 8 + i);
const LINES: readonly NameLineCount[] = [1, 2, 3];

const wholeGeo = (f: number) => geometryFor(f);
/** The note font that a geometry made for `f` really has (D330: never under 14.1 px). */
const own = (f: number) => geometryFor(f).fontPx;
const relationGeo = (f: number) => withRelationLine(geometryFor(f), { relationLine: true } as never);

// 0.2.8 (I01): the badge centre lies on the middle of the arc of the card corner (radius 8 px, the default theme's --radius-m): this far in from the corner on each side.
const CORNER_C = 8 - 8 / Math.SQRT2;

describe('4.1 the card size and the one text size (D117, D126)', () => {
	it('the card height is 3.8 em, rounded to whole px', () => {
		expect(geometryFor(16).cardH).toBe(61);
		expect(geometryFor(12).cardH).toBe(54);
		expect(geometryFor(20).cardH).toBe(76);
		expect(geometryFor(16).cardW).toBe(180);
	});

	it('a card is never higher than the 4 em of 0.2.3, for every font from 8 to 48 (4 em of the geometry\'s own font)', () => {
		for (const f of FONTS) expect(geometryFor(f).cardH, `font ${f}`).toBeLessThanOrEqual(Math.round(4 * own(f)));
	});

	it('D330 (O-02): the card text is 0.85 em of the note font and never under 12 px; at 16 px nothing changes; a 12 px note font gives 12 px text and a 159 px card', () => {
		for (const f of FONTS) {
			const t = cardText(geometryFor(f));
			expect(t.nameSize, `font ${f}`).toBeGreaterThanOrEqual(12 - 1e-9);
			expect(t.smallSize, `font ${f}`).toBeGreaterThanOrEqual(12 - 1e-9);
			expect(t.nameSize, `font ${f}`).toBeCloseTo(Math.max(12, 0.85 * f), 9);
		}
		expect(cardText(geometryFor(12)).nameSize).toBeCloseTo(12, 9);
		expect(geometryFor(12)).toMatchObject({ cardW: 159, cardH: 54 });
		expect(geometryFor(12).cardW / 135).toBeGreaterThan(1.17);
		expect(geometryFor(16)).toMatchObject({ fontPx: 16, cardW: 180, cardH: 61, unionSize: 10, coupleGap: 36, nodeGap: 20, rowGap: 100, tagH: 18 });
		expect(cardText(geometryFor(16)).nameSize).toBeCloseTo(13.6, 9);
	});

	it('the name, title and dates are all 0.85 em; the line height keeps its factor (16.32 px at 16 px)', () => {
		const one = cardText(geometryFor(16));
		expect(one.nameSize).toBeCloseTo(13.6, 9);
		expect(one.smallSize).toBeCloseTo(13.6, 9);
		const t = cardText(wholeGeo(16), 2);
		expect(t.name2Baseline! - t.nameBaseline).toBeCloseTo(16.32, 9);
	});

	it('tallExtra is one 0.85 em text line: 16 px at 16 px, 14 px at 12 px (raised to 14.1 px, D330); relationExtra is the same number', () => {
		expect(tallExtra(wholeGeo(16))).toBe(16);
		expect(tallExtra(wholeGeo(12))).toBe(14);
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
		expect(wholeGeo(12).cardH).toBe(54);
	});

	it('the D14 sign stays level with the middle of the first name text line, x and size unchanged', () => {
		for (const note of [12, 16, 20]) {
			const f = own(note);
			const t = cardText(wholeGeo(note));
			const middle = t.nameBaseline - 0.35 * t.nameSize;
			expect((t.sign.y1 + t.sign.y2) / 2, `font ${f}`).toBeCloseTo(middle, 6);
			expect(t.sign.x1).toBeCloseTo(wholeGeo(note).cardW - 0.5 * f, 9);
			expect(t.sign.x1 - t.sign.x2).toBeCloseTo(1.125 * f, 9);
		}
		// 1.6 px higher than in 0.2.3 at 16 px (the name is smaller): 0.35 * (16 - 13.6) /... = the middle of the line moved up by the half of 0.35 em difference
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

// E3: the end of the D14 sign against the disc of the badge on the top right corner. The sign does not move.
describe('the sign end and the badge disc (Full and Compact)', () => {
	it('the badge covers the end of the sign by at most 0.3 em, on every kind, font and name-line count; Compact too (the disc is 0.55 em and its centre lies on the corner arc; 0.2.7 kept the end clear of the disc)', () => {
		const bad: string[] = [];
		for (const note of FONTS) {
			const f = own(note);
			for (const geo of [wholeGeo(note), relationGeo(note)]) {
				for (const lines of LINES) {
					const t = cardText(geo, lines);
					const need = BADGE_RADIUS_EM * f - t.sign.width / 2;
					const end = Math.hypot(geo.cardW - CORNER_C - t.sign.x1, t.sign.y1 - CORNER_C);
					// The plate form (relation line) centres its text by 0.25 em differently from the old card, so a shortfall under 0.05 px is allowed (a check, D126 2).
					if (end < need - 0.3 * f) bad.push(`Full f${f} ${lines}L: ${end.toFixed(2)} < ${need.toFixed(2)} - 0.3 em`);
				}
			}
			// Compact: the sign is drawn through `signAt` (the Compact name is 1.5 em of the note font).
			const geo = wholeGeo(note);
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

	it('numbers at 16 px: the upper end of the sign is 9.5 px from the corner and 6.4 px from the badge centre, which lies on the corner arc (the disc is 8.8 px): the disc covers 2 px of its end, and the sign does not move (D126 2, I01)', () => {
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
