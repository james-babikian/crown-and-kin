// 0.2.5 WP-B1: the numbers of the Roundel card and the text card (D179: the classic Compact card is gone).
// Heights, text places, the name room beside the D14 sign, the raised relation word, `reach` by form, `cardForm` and the idempotent `withRelationLine`.
import { describe, expect, it } from 'vitest';
import {
	ROUNDEL_EM,
	SIGN_LINE_CLEAR_PX,
	TAB_REACH_PAD_PX,
	cardForm,
	cardText,
	drawnGeometry,
	geometryFor,
	isRoundel,
	nameRoom,
	ribbonWidth,
	relationExtra,
	relationY,
	roundelAxis,
	roundelLineEnd,
	roundelPics,
	signBelowRing,
	tagTop,
	tallExtra,
	withRelationLine,
	youTabRect,
} from '../../src/layout/geometry';
import type { Geometry, LayoutSettings } from '../../src/layout/model';

const far = { maxCardWidths: 3, maxGenerations: 1 };
const pics = { arms: ['house'], portraits: ['p'] };
function settings(o: Partial<LayoutSettings> = {}): LayoutSettings {
	return { sweeps: 4, far, ...o };
}
/** The drawn geometry of a top-to-bottom Normal tree: Roundel. */
function roundel(f: number, o: Partial<LayoutSettings> = {}): Geometry {
	return drawnGeometry(cardForm(geometryFor(f), 'down'), settings(o));
}
/** A card's height with `names` name lines and (maybe) two title lines. */
const heightOf = (g: Geometry, names = 1, tall = false) => g.cardH + (names - 1) * tallExtra(g) + (tall ? relationExtra(g) : 0);
const signBottom = (s: ReturnType<typeof cardText>['sign']) => Math.max(s.y1, s.y2) + s.width / (2 * Math.SQRT2);

describe('card heights (Roundel, Normal size)', () => {
	it('12 px (raised to 14.1 px, D330) and 16 px: plate ON / OFF, with crown / without', () => {
		for (const [f, want] of [
			[12, { onCrown: 79, offCrown: 65, onNone: 68, offNone: 54, extra: 14, ottilieOn: 107, ottilieOff: 93 }],
			[16, { onCrown: 89, offCrown: 73, onNone: 77, offNone: 61, extra: 16, ottilieOn: 121, ottilieOff: 105 }],
		] as const) {
			const onCrown = roundel(f, { ...pics, relationLine: true });
			const offCrown = roundel(f, { ...pics });
			expect(onCrown.cardH, `${f} ON crown`).toBe(want.onCrown);
			expect(offCrown.cardH, `${f} OFF crown`).toBe(want.offCrown);
			expect(roundel(f, { relationLine: true }).cardH, `${f} ON no picture`).toBe(want.onNone);
			expect(roundel(f).cardH, `${f} OFF no picture`).toBe(want.offNone);
			expect(tallExtra(onCrown)).toBe(want.extra);
			expect(heightOf(onCrown, 2)).toBe(want.onCrown + want.extra);
			expect(heightOf(onCrown, 3)).toBe(want.onCrown + 2 * want.extra);
			expect(heightOf(onCrown, 1, true)).toBe(want.onCrown + want.extra);
			expect(heightOf(onCrown, 2, true), `${f} Ottilie ON`).toBe(want.ottilieOn);
			expect(heightOf(offCrown, 2, true), `${f} Ottilie OFF`).toBe(want.ottilieOff);
		}
	});

	it('crown is round(0.75 f), reach is ceil(1.6 f); a tree with no picture has neither', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		expect([g.crown, g.reach]).toEqual([11, 23]); // D330: a 12 px note font is raised to 14.1 px
		const h = roundel(16, { ...pics });
		expect([h.crown, h.reach]).toEqual([12, 26]);
		const none = roundel(12, { relationLine: true });
		expect('crown' in none).toBe(false);
		expect('reach' in none).toBe(false);
	});

	it('text card (sideways): ON 68 / 77, OFF 54 / 61 (12 px is raised to 14.1 px, D330); no crown even when pictures are written', () => {
		for (const [f, on, off] of [[12, 68, 54], [16, 77, 61]] as const) {
			const side = (o: Partial<LayoutSettings>) => drawnGeometry(cardForm(geometryFor(f), 'sideways'), settings({ orientation: 'sideways', ...o }));
			expect(side({ ...pics, relationLine: true }).cardH).toBe(on);
			expect(side({ ...pics }).cardH).toBe(off);
			expect(side({ ...pics }).crown).toBeUndefined();
		}
	});

	it('the body holds the text block at every note font, plate ON and OFF', () => {
		for (let f = 8; f <= 48; f++) {
			const block = 3 * 1.2 * 0.85 * f;
			const base = geometryFor(f);
			for (const rel of [true, false]) {
				for (const withPics of [true, false]) {
					for (const form of [cardForm(base, 'down'), cardForm(base, 'sideways')]) {
						const g = drawnGeometry(form, settings({ ...(withPics ? pics : {}), ...(rel ? { relationLine: true } : {}) }));
						const plateH = rel ? relationExtra(g) + ROUNDEL_EM.plateMore * f : 0;
						const body = g.cardH - (g.crown ?? 0) - plateH;
						expect(body, `f${f} ${g.form} rel ${rel}`).toBeGreaterThanOrEqual(block - 1e-9);
						const t = cardText(g, 1, false, { title: true, dates: true });
						const top = t.nameBaseline - 0.35 * t.nameSize - (1.2 * t.nameSize) / 2;
						expect(top, `f${f} top`).toBeGreaterThanOrEqual((g.crown ?? 0) - 1e-9);
						expect(t.textBottom, `f${f} bottom`).toBeLessThanOrEqual(g.cardH - plateH + 1e-9);
					}
				}
			}
		}
	});
});

describe('text slots', () => {
	it('axis in the card middle (0.25 em right of it until 0.2.7); column 10 em centred on it', () => {
		for (const [f, axis, col] of [[12, 79.5, 10 * (12 / 0.85)], [16, 90, 160]] as const) {
			const g = roundel(f, { ...pics, relationLine: true });
			expect(roundelAxis(g)).toBeCloseTo(axis, 9);
			const t = cardText(g, 1, false, { title: false, dates: true });
			expect(t.textW).toBeCloseTo(col, 9);
			expect(t.padX).toBeCloseTo(axis - col / 2, 9);
			expect(t.anchorX).toBeCloseTo(axis, 9);
			expect(t.middle).toBe(true);
		}
	});

	it('the lines that exist are centred between the halo of the portrait (D212) and the plate', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		const f = g.fontPx;
		const nameLine = 1.2 * 0.85 * f;
		const smallLine = nameLine;
		const plateH = relationExtra(g) + 0.25 * f;
		// The halo ends at (1 + 0.15 + 0.2 - 0.25) em = 1.1 em below the card top; the crown is only 0.75 em.
		expect(g.textTop).toBe(Math.round(1.1 * f));
		for (const [shown, smalls] of [[{ title: true, dates: true }, 2], [{ title: false, dates: true }, 1], [{ title: false, dates: false }, 0]] as const) {
			const t = cardText(g, 1, false, shown);
			const top = t.nameBaseline - 0.35 * t.nameSize - nameLine / 2;
			expect(top).toBeCloseTo(g.textTop! + (g.cardH - plateH - g.textTop! - nameLine - smalls * smallLine) / 2, 9);
		}
	});

	it('D212: the room for the text starts under the halo of the portrait, else under the crown (arms only), else under the colour ribbon; the gaps above and below are equal', () => {
		for (const note of [8, 12, 16, 24, 48]) {
			// D330: below 14.1 px the geometry is made for 14.1 px.
			const f = geometryFor(note).fontPx;
			for (const [name, o, lead] of [
				['portraits', pics, Math.round(1.1 * f)],
				['arms only', { arms: ['house'] }, Math.round(0.75 * f)],
				['no picture', {}, ribbonWidth(geometryFor(f))],
			] as const) {
				for (const plate of [true, false]) {
					const g = roundel(f, { ...o, ...(plate ? { relationLine: true } : {}) });
					expect(g.textTop, `${name} f${f}`).toBe(name === 'portraits' ? lead : undefined);
					const t = cardText(g, 1, false, { title: true, dates: true });
					const nameLine = 1.2 * t.nameSize;
					const first = t.nameBaseline - 0.35 * t.nameSize - nameLine / 2;
					const last = t.datesBaseline - 0.35 * t.smallSize + (1.2 * t.smallSize) / 2;
					const bottom = g.cardH - (plate ? relationExtra(g) + 0.25 * f : 0);
					expect(first - lead, `${name} f${f} gap above`).toBeCloseTo(bottom - last, 6);
				}
			}
		}
	});

	it('the word sits on the plate, raised by 0.15 f; a descender stays above a far-couple tag; capitals keep 2 px under the plate top', () => {
		for (let note = 10; note <= 48; note++) {
			const g = roundel(note, { ...pics, relationLine: true });
			const f = g.fontPx;
			const t = cardText(g, 1, false, { title: true, dates: true });
			const plateH = relationExtra(g) + 0.25 * f;
			expect(t.relationBaseline).toBeCloseTo(g.cardH - plateH / 2 + 0.35 * t.smallSize + 0.5 - ROUNDEL_EM.wordRaise * f, 9);
			expect(relationY(t)).toBe(t.relationBaseline);
			expect(t.relationBaseline! + 0.25 * t.smallSize, `descender f${note}`).toBeLessThanOrEqual(g.cardH - Math.round(0.1875 * f));
			expect(t.relationBaseline! - 0.7 * t.smallSize - (g.cardH - plateH), `capitals f${note}`).toBeGreaterThanOrEqual(2);
		}
		const g = roundel(12, { ...pics, relationLine: true });
		expect(tagTop(g, g.cardH)).toBe(g.cardH - 3); // 0.1875 em of 14.1 px (D330), rounded
	});

	it('no plate: no relation baseline', () => {
		expect(cardText(roundel(12, { ...pics }), 1, false, { title: true, dates: true }).relationBaseline).toBeUndefined();
	});

	it('the D14 sign: f/3 from the top with a crown; the 0.2.4 place (level with the middle of name line 1) without one and on the text card', () => {
		const withCrown = cardText(roundel(12, { ...pics, relationLine: true }), 1, false, { title: true, dates: true });
		const f = geometryFor(12).fontPx; // D330: 14.1 px
		expect(Math.min(withCrown.sign.y1, withCrown.sign.y2)).toBeCloseTo(f / 3, 9);
		expect(withCrown.sign.x1).toBeCloseTo(geometryFor(12).cardW - f / 2, 9);
		const none = cardText(roundel(12, { relationLine: true }), 1, false, { title: true, dates: true });
		expect(none.sign.y1).toBeCloseTo(none.nameBaseline - 0.35 * none.nameSize - (1.125 * f) / 2, 9);
		const text = cardText(drawnGeometry(cardForm(geometryFor(12), 'sideways'), settings({ orientation: 'sideways', relationLine: true })), 1, false, { title: true, dates: true });
		expect(text.sign.y1).toBeCloseTo(text.nameBaseline - 0.35 * text.nameSize - (1.125 * f) / 2, 9);
		expect(text.middle).toBeUndefined();
		expect(text.padX).toBe(0.875 * f);
		expect(text.textW).toBeCloseTo(geometryFor(12).cardW - 0.875 * f - 0.5 * f, 9);
	});

	it('no crown: the first small line stays 1 px or more below the sign tip from 10 px', () => {
		for (let f = 10; f <= 48; f++) {
			for (const plate of [true, false]) {
				const g = roundel(f, plate ? { relationLine: true } : {});
				const t = cardText(g, 1, false, { title: true, dates: true });
				const glyph = t.titleBaseline - 0.7 * t.smallSize;
				expect(glyph - signBottom(t.sign), `f${f} plate ${plate}`).toBeGreaterThanOrEqual(1);
				expect(Math.min(t.sign.y1, t.sign.y2), `sign end f${f}`).toBeGreaterThanOrEqual(1.8 - 1e-9);
			}
		}
	});

	it('name room with the sign: 99 px at 12 px (raised to 14.1 px, D330), 112 px at 16 px; the last line takes the full column only where it clears the sign by 5 px', () => {
		for (const [f, w] of [[12, 99], [16, 112]] as const) {
			for (const plate of [true, false]) {
				const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
				const t = cardText(g, 2, false, { title: true, dates: true });
				expect(t.nameWithSignW).toBeCloseTo(w, 9);
				const room = nameRoom(g, t, true);
				expect(room.full).toBeCloseTo(w, 9);
				expect(room.only).toBeCloseTo(w, 9);
				expect(room.last, `${f} ${plate}`).toBe(t.textW);
				const line2Top = t.name2Baseline! - 0.35 * t.nameSize - (1.2 * t.nameSize) / 2;
				expect(line2Top - signBottom(t.sign), `${f} ${plate}`).toBeGreaterThanOrEqual(SIGN_LINE_CLEAR_PX);
			}
		}
	});

	it('an unsigned name has the whole column on every line', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		const t = cardText(g, 2);
		const column = 10 * geometryFor(12).fontPx; // D330: the 10 em column of a 12 px note font, raised to 14.1 px
		expect(nameRoom(g, t, false)).toEqual({ full: column, last: column, only: column });
	});

	it('no picture (no crown): the last line keeps the narrow room at every font 8 to 48', () => {
		for (let f = 8; f <= 48; f++) {
			for (const plate of [true, false]) {
				const g = roundel(f, plate ? { relationLine: true } : {});
				const t = cardText(g, 1, false, { title: true, dates: true });
				const room = nameRoom(g, t, true);
				expect(room.last, `f${f} plate ${plate}`).toBeCloseTo(t.nameWithSignW, 9);
				expect(room.full).toBeCloseTo(t.nameWithSignW, 9);
			}
		}
	});

	it('the decision follows the clearance for every font: yes at every font with a crown (D212: the text starts lower)', () => {
		const decide = (f: number, plate: boolean, ring?: number) => {
			const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
			const t = cardText(g, 1, false, { title: true, dates: true });
			return nameRoom(g, t, true, ring).last === t.textW;
		};
		for (let f = 8; f <= 48; f++) {
			expect(decide(f, true), `f${f} ON`).toBe(true);
			expect(decide(f, false), `f${f} OFF`).toBe(true);
		}
	});

	it('the closed form of line 2 from the one-slot text equals the two-slot text, every font', () => {
		for (let f = 8; f <= 48; f++) {
			for (const plate of [true, false]) {
				for (const withPics of [true, false]) {
					const g = roundel(f, { ...(withPics ? pics : {}), ...(plate ? { relationLine: true } : {}) });
					const one = cardText(g, 1);
					const two = cardText(g, 2);
					const nameLine = 1.2 * one.nameSize;
					const closed = one.nameBaseline - 0.35 * one.nameSize - nameLine / 2 + (tallExtra(g) - nameLine) / 2 + nameLine;
					const explicit = two.name2Baseline! - 0.35 * two.nameSize - nameLine / 2;
					expect(Math.abs(closed - explicit), `f${f}`).toBeLessThan(1e-9);
				}
			}
		}
	});

	it('the marked card (sign below the ring): the full column at every font from 8 px (D330: 8 to 14.1 px are the geometry of 14.1 px); the narrow room of 8 px ON is gone', () => {
		const ring = 1; // ME_RING_INNER, the ring's inner edge from the card edge (a 2 px border)
		const room = (f: number, plate: boolean) => {
			const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
			const t = cardText(g, 1, false, { title: true, dates: true });
			return [nameRoom(g, t, true, ring).last, t.textW, t.nameWithSignW] as const;
		};
		for (const f of [8, 9, 12, 14, 16]) {
			const [last, textW] = room(f, true);
			expect(last, `f${f}`).toBe(textW);
		}
		// the moved sign keeps its distance to the ring
		const g = roundel(12, { ...pics, relationLine: true });
		const t = cardText(g, 2);
		const moved = signBelowRing(t.sign, ring);
		expect(Math.min(moved.y1, moved.y2) - moved.width / (2 * Math.SQRT2)).toBeGreaterThanOrEqual(ring + 1.5 - 1e-9);
	});

	it('the text card always takes the narrow room for a signed name', () => {
		const g = drawnGeometry(cardForm(geometryFor(12), 'sideways'), settings({ orientation: 'sideways', relationLine: true }));
		const t = cardText(g, 2, false, { title: true, dates: true });
		const room = nameRoom(g, t, true);
		expect(room).toEqual({ full: t.nameWithSignW, last: t.nameWithSignW, only: t.nameWithSignW });
		expect(nameRoom(g, t, false)).toEqual({ full: t.textW, last: t.textW, only: t.textW });
	});
});

describe('medallion and arms', () => {
	it('12 px (raised to 14.1 px, D330): medallion 2.3 em at (cx - 1.15 em, -1.2 em) (D219: the portrait takes the space of the ring); arms beside it 1.25 x 1.5 em; arms alone 1.67 x 2 em; the line ends 1.4 / 1.25 em above the card', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		const f = g.fontPx;
		const both = roundelPics(g, { arms: true, portrait: true });
		expect(g.cardW).toBe(159);
		expect(both.cx).toBeCloseTo(79.5, 9);
		expect(both.cy).toBeCloseTo(-0.25 * f, 9);
		expect(both.portrait!.x).toBeCloseTo(79.5 - 1.15 * f, 9);
		expect(both.portrait!.y).toBeCloseTo(-0.25 * f - 1.15 * f, 9);
		expect(both.portrait!.w).toBeCloseTo(2.3 * f, 9);
		expect(both.portrait!.h).toBeCloseTo(2.3 * f, 9);
		expect(both.ringR).toBeCloseTo(1.15 * f, 9);
		expect(both.haloR).toBeCloseTo(1.35 * f, 9);
		expect(both.arms!.w).toBeCloseTo(1.25 * f, 9);
		expect(both.arms!.h).toBeCloseTo(1.5 * f, 9);
		expect(both.arms!.x).toBeCloseTo(79.5 + 1.15 * f + 0.55 * f, 9); // 0.2.8 (G.5): 0.55 em from the ring, 0.3 em more than in 0.2.7
		expect(both.arms!.y + both.arms!.h / 2).toBeCloseTo(-0.25 * f, 9);
		const alone = roundelPics(g, { arms: true, portrait: false });
		expect(alone.portrait).toBeUndefined();
		expect(alone.arms!.x).toBeCloseTo(79.5 - (5 / 6) * f, 9);
		expect(alone.arms!.y).toBeCloseTo(-1.25 * f, 9);
		expect(alone.arms!.w).toBeCloseTo((5 / 3) * f, 9);
		expect(alone.arms!.h).toBeCloseTo(2 * f, 9);
		expect(roundelLineEnd(g, { portrait: true })).toBeCloseTo(1.4 * f, 9);
		expect(roundelLineEnd(g, { arms: true, portrait: true })).toBeCloseTo(1.4 * f, 9);
		expect(roundelLineEnd(g, { arms: true })).toBeCloseTo(1.25 * f, 9);
		expect(roundelLineEnd(g, {})).toBe(0);
	});

	it('16 px', () => {
		const g = roundel(16, { ...pics });
		const both = roundelPics(g, { arms: true, portrait: true });
		expect(both.portrait!.w).toBeCloseTo(36.8, 9);
		expect(both.arms!.x).toBeCloseTo(90 + 18.4 + 8.8, 9);
		expect(roundelLineEnd(g, { portrait: true })).toBeCloseTo(22.4, 9);
		expect(roundelLineEnd(g, { arms: true })).toBe(20);
		// the halo reaches exactly `reach` above the card
		expect(both.haloR - both.cy).toBeLessThanOrEqual(g.reach!);
	});
});

describe('reach by form and the "You" tab', () => {
	const reachOf = (f: number, kind: 'roundel-pics' | 'roundel-none' | 'plain' | 'text', tab: boolean) => {
		const youTab = tab ? { youTab: 'me' } : {};
		if (kind === 'roundel-pics') return drawnGeometry(cardForm(geometryFor(f), 'down'), settings({ ...pics, ...youTab })).reach;
		if (kind === 'roundel-none') return drawnGeometry(cardForm(geometryFor(f), 'down'), settings(youTab)).reach;
		if (kind === 'plain') return drawnGeometry(geometryFor(f), settings({ ...pics, ...youTab })).reach;
		return drawnGeometry(cardForm(geometryFor(f), 'sideways'), settings({ orientation: 'sideways', ...pics, ...youTab })).reach;
	};

	it('23 / 9 / 14 / 14 at 12 px (raised to 14.1 px, D330) and 26 / 10 / 16 / 16 at 16 px (Roundel with pictures, Roundel without, plain geometry, text card)', () => {
		expect((['roundel-pics', 'roundel-none', 'plain', 'text'] as const).map((k) => reachOf(12, k, true))).toEqual([23, 9, 14, 14]);
		expect((['roundel-pics', 'roundel-none', 'plain', 'text'] as const).map((k) => reachOf(16, k, true))).toEqual([26, 10, 16, 16]);
	});

	it('0 (absent) without a tab and without pictures; the pictures give the Roundel its reach without a tab', () => {
		for (const k of ['roundel-none', 'plain', 'text'] as const) expect(reachOf(12, k, false), k).toBeUndefined();
		expect(reachOf(12, 'roundel-pics', false)).toBe(23);
	});

	it('the reach holds the top of the tab with its stroke, every font', () => {
		for (let note = 8; note <= 48; note++) {
			const f = geometryFor(note).fontPx;
			expect(reachOf(note, 'roundel-none', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAbove * f + 0.75);
			expect(reachOf(note, 'text', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAboveText * f + 0.75);
			expect(reachOf(note, 'roundel-pics', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAbove * f + 0.75);
			expect(Math.ceil(ROUNDEL_EM.tabAbove * f + TAB_REACH_PAD_PX)).toBe(reachOf(note, 'roundel-none', true));
		}
	});

	it('the tab rect: Roundel right end 1.9 em left of the axis with a portrait (1.75 em with arms alone, 0.4 em with no picture: the distances of the ordinal tab, D213), 0.55 em above the edge; text card and plain geometry at padX, 0.9 em above', () => {
		const g = roundel(12, { ...pics, youTab: 'me' });
		// D330: a 12 px note font is raised to 14.1 px.
		const f = g.fontPx;
		const mid = g.cardW / 2;
		const withPic = youTabRect(g, true);
		expect(withPic.w).toBeCloseTo(2.3 * f, 9);
		expect(withPic.h).toBeCloseTo(1.15 * f, 9);
		expect(withPic.x + withPic.w).toBeCloseTo(mid - 1.9 * f, 9);
		expect(withPic.y).toBeCloseTo(-0.55 * f, 9);
		// A portrait with arms is a portrait.
		expect(youTabRect(g, true, true)).toEqual(withPic);
		const armsOnly = youTabRect(g, false, true);
		expect(armsOnly.x + armsOnly.w).toBeCloseTo(mid - 1.75 * f, 9);
		const noPic = youTabRect(roundel(12, { youTab: 'me' }), false);
		expect(noPic.x + noPic.w).toBeCloseTo(mid - 0.4 * f, 9);
		const text = youTabRect(drawnGeometry(cardForm(geometryFor(12), 'sideways'), settings({ orientation: 'sideways', youTab: 'me' })), false);
		expect([text.x, text.y]).toEqual([0.875 * f, -0.9 * f]);
		const plain = youTabRect(geometryFor(12), true);
		expect([plain.x, plain.y]).toEqual([0.875 * f, -0.9 * f]);
	});
});

describe('cardForm and withRelationLine', () => {
	it('cardForm truth table; it changes no number and is idempotent', () => {
		const normal = geometryFor(12);
		expect(cardForm(normal, 'down').form).toBe('roundel');
		expect(cardForm(normal, 'sideways').form).toBe('text');
		for (const [geo, o] of [[normal, 'down'], [normal, 'sideways']] as const) {
			const g = cardForm(geo, o);
			expect({ ...g, form: undefined }).toEqual({ ...geo, form: undefined });
			expect(cardForm(g, o)).toBe(g);
		}
		expect(isRoundel(cardForm(normal, 'down'))).toBe(true);
		expect(normal.form).toBeUndefined();
	});

	it('withRelationLine is idempotent for every form', () => {
		for (const o of ['down', 'sideways'] as const) {
			for (const rel of [true, false]) {
				for (const tab of [true, false]) {
					const s = settings({ orientation: o, ...pics, ...(rel ? { relationLine: true } : {}), ...(tab ? { youTab: 'me' } : {}) });
					const once = withRelationLine(cardForm(geometryFor(12), o), s);
					expect(withRelationLine(once, s)).toBe(once);
					expect(drawnGeometry(once, s).cardH).toBe(once.cardH);
				}
			}
		}
	});

	it('a plain geometry with no tab is unchanged by this work package (old hashes stay)', () => {
		const geo = geometryFor(12);
		expect(withRelationLine(geo, settings({ ...pics }))).toBe(geo);
		expect(withRelationLine(geo, settings({ relationLine: true }))).toEqual({ ...geo, cardH: geo.cardH + relationExtra(geo), relationLine: true });
	});
});
