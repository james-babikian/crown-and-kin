// 0.2.5 WP-B1 (CONTRACT B.3.1 to B.3.4, B.5 test 1): the numbers of the Roundel card, the text card and the classic Compact card.
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
	isTextCard,
	nameRoom,
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
} from '../src/layout/geometry';
import type { Geometry, LayoutSettings } from '../src/layout/model';

const far = { maxCardWidths: 3, maxGenerations: 1 };
const pics = { arms: ['house'], portraits: ['p'] };
function settings(o: Partial<LayoutSettings> = {}): LayoutSettings {
	return { sweeps: 4, far, ...o };
}
/** The drawn geometry of a top-to-bottom Normal tree: Roundel. */
function roundel(f: number, o: Partial<LayoutSettings> = {}): Geometry {
	return drawnGeometry(cardForm(geometryFor(f, 'normal'), 'down'), settings(o));
}
/** A card's height with `names` name lines and (maybe) two title lines. */
const heightOf = (g: Geometry, names = 1, tall = false) => g.cardH + (names - 1) * tallExtra(g) + (tall ? relationExtra(g) : 0);
const signBottom = (s: ReturnType<typeof cardText>['sign']) => Math.max(s.y1, s.y2) + s.width / (2 * Math.SQRT2);

describe('B.3.1 card heights (Roundel, Normal size)', () => {
	it('12 px and 16 px: plate ON / OFF, with crown / without', () => {
		for (const [f, want] of [
			[12, { onCrown: 67, offCrown: 55, onNone: 58, offNone: 46, extra: 12, ottilieOn: 91, ottilieOff: 79 }],
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
		expect([g.crown, g.reach]).toEqual([9, 20]);
		const h = roundel(16, { ...pics });
		expect([h.crown, h.reach]).toEqual([12, 26]);
		const none = roundel(12, { relationLine: true });
		expect('crown' in none).toBe(false);
		expect('reach' in none).toBe(false);
	});

	it('text card (sideways): ON 58 / 77, OFF 46 / 61; no crown even when pictures are written', () => {
		for (const [f, on, off] of [[12, 58, 46], [16, 77, 61]] as const) {
			const side = (o: Partial<LayoutSettings>) => drawnGeometry(cardForm(geometryFor(f, 'normal'), 'sideways'), settings({ orientation: 'sideways', ...o }));
			expect(side({ ...pics, relationLine: true }).cardH).toBe(on);
			expect(side({ ...pics }).cardH).toBe(off);
			expect(side({ ...pics }).crown).toBeUndefined();
		}
	});

	it('Compact size (classic card): ON 51 / 69, OFF 40 / 54, extras 11 / 15', () => {
		for (const [f, on, off, extra] of [[12, 51, 40, 11], [16, 69, 54, 15]] as const) {
			const geo = geometryFor(f, 'compact');
			expect(cardForm(geo, 'down')).toBe(geo);
			expect(drawnGeometry(geo, settings({ ...pics, relationLine: true })).cardH).toBe(on);
			expect(drawnGeometry(geo, settings({ ...pics })).cardH).toBe(off);
			expect(tallExtra(geo)).toBe(extra);
			expect(relationExtra(geo)).toBe(extra);
		}
	});

	it('the body holds the text block at every note font, plate ON and OFF, Normal and Compact', () => {
		for (let f = 8; f <= 48; f++) {
			for (const size of ['normal', 'compact'] as const) {
				const lh = size === 'normal' ? 1.2 : 1.1;
				const block = 3 * lh * 0.85 * f;
				const base = geometryFor(f, size);
				for (const rel of [true, false]) {
					for (const withPics of [true, false]) {
						const forms = size === 'normal' ? [cardForm(base, 'down'), cardForm(base, 'sideways')] : [base, cardForm(base, 'sideways')];
						for (const form of forms) {
							const g = drawnGeometry(form, settings({ ...(withPics ? pics : {}), ...(rel ? { relationLine: true } : {}) }));
							const plateH = rel ? relationExtra(g) + (isRoundel(g) || isTextCard(g) ? ROUNDEL_EM.plateMore * f : 0) : 0;
							const body = g.cardH - (g.crown ?? 0) - (isRoundel(g) || isTextCard(g) ? plateH : rel ? relationExtra(g) : 0);
							expect(body, `f${f} ${size} ${g.form ?? 'classic'} rel ${rel}`).toBeGreaterThanOrEqual(block - 1e-9);
							if (isRoundel(g) || isTextCard(g)) {
								const t = cardText(g, 1, false, { title: true, dates: true });
								const top = t.nameBaseline - 0.35 * t.nameSize - (g.cardSize === 'normal' ? 1.2 : 1.1) * t.nameSize / 2;
								expect(top, `f${f} ${size} top`).toBeGreaterThanOrEqual((g.crown ?? 0) - 1e-9);
								expect(t.textBottom, `f${f} ${size} bottom`).toBeLessThanOrEqual(g.cardH - plateH + 1e-9);
							}
						}
					}
				}
			}
		}
	});
});

describe('B.3.2 text slots', () => {
	it('axis 0.25 em right of the card middle; column 10 em centred on it', () => {
		for (const [f, axis, col] of [[12, 70.5, 120], [16, 94, 160]] as const) {
			const g = roundel(f, { ...pics, relationLine: true });
			expect(roundelAxis(g)).toBeCloseTo(axis, 9);
			const t = cardText(g, 1, false, { title: false, dates: true });
			expect(t.textW).toBe(col);
			expect(t.padX).toBeCloseTo(axis - col / 2, 9);
			expect(t.anchorX).toBeCloseTo(axis, 9);
			expect(t.middle).toBe(true);
		}
	});

	it('the lines that exist are centred between the crown and the plate', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		const nameLine = 1.2 * 0.85 * 12;
		const smallLine = nameLine;
		const plateH = relationExtra(g) + 0.25 * 12;
		for (const [shown, smalls] of [[{ title: true, dates: true }, 2], [{ title: false, dates: true }, 1], [{ title: false, dates: false }, 0]] as const) {
			const t = cardText(g, 1, false, shown);
			const top = t.nameBaseline - 0.35 * t.nameSize - nameLine / 2;
			expect(top).toBeCloseTo(g.crown! + (g.cardH - plateH - g.crown! - nameLine - smalls * smallLine) / 2, 9);
		}
	});

	it('the word sits on the plate, raised by 0.15 f; a descender stays above a far-couple tag; capitals keep 2 px under the plate top', () => {
		for (let f = 10; f <= 48; f++) {
			const g = roundel(f, { ...pics, relationLine: true });
			const t = cardText(g, 1, false, { title: true, dates: true });
			const plateH = relationExtra(g) + 0.25 * f;
			expect(t.relationBaseline).toBeCloseTo(g.cardH - plateH / 2 + 0.35 * t.smallSize + 0.5 - ROUNDEL_EM.wordRaise * f, 9);
			expect(relationY(t, true, true)).toBe(t.relationBaseline);
			expect(relationY(t, false, false)).toBe(t.relationBaseline);
			expect(t.relationBaseline! + 0.25 * t.smallSize, `descender f${f}`).toBeLessThanOrEqual(g.cardH - Math.round(0.1875 * f));
			expect(t.relationBaseline! - 0.7 * t.smallSize - (g.cardH - plateH), `capitals f${f}`).toBeGreaterThanOrEqual(2);
		}
		const g = roundel(12, { ...pics, relationLine: true });
		expect(tagTop(g, g.cardH)).toBe(g.cardH - 2);
	});

	it('no plate: no relation baseline', () => {
		expect(cardText(roundel(12, { ...pics }), 1, false, { title: true, dates: true }).relationBaseline).toBeUndefined();
	});

	it('the D14 sign: f/3 from the top with a crown; the 0.2.4 place (level with the middle of name line 1) without one and on the text card', () => {
		const withCrown = cardText(roundel(12, { ...pics, relationLine: true }), 1, false, { title: true, dates: true });
		expect(Math.min(withCrown.sign.y1, withCrown.sign.y2)).toBeCloseTo(12 / 3, 9);
		expect(withCrown.sign.x1).toBe(135 - 6);
		const none = cardText(roundel(12, { relationLine: true }), 1, false, { title: true, dates: true });
		expect(none.sign.y1).toBeCloseTo(none.nameBaseline - 0.35 * none.nameSize - (1.125 * 12) / 2, 9);
		const text = cardText(drawnGeometry(cardForm(geometryFor(12, 'normal'), 'sideways'), settings({ orientation: 'sideways', relationLine: true })), 1, false, { title: true, dates: true });
		expect(text.sign.y1).toBeCloseTo(text.nameBaseline - 0.35 * text.nameSize - (1.125 * 12) / 2, 9);
		expect(text.middle).toBeUndefined();
		expect(text.padX).toBe(0.875 * 12);
		expect(text.textW).toBe(118.5);
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

	it('name room with the sign: 84 px at 12 px, 112 px at 16 px; the last line takes the full column only where it clears the sign by 5 px', () => {
		for (const [f, w] of [[12, 84], [16, 112]] as const) {
			for (const plate of [true, false]) {
				const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
				const t = cardText(g, 2, false, { title: true, dates: true });
				expect(t.nameWithSignW).toBeCloseTo(w, 9);
				const room = nameRoom(g, t, true, []);
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
		expect(nameRoom(g, t, false, [])).toEqual({ full: 120, last: 120, only: 120 });
	});

	it('no picture (no crown): the last line keeps the narrow room at every font 8 to 48', () => {
		for (let f = 8; f <= 48; f++) {
			for (const plate of [true, false]) {
				const g = roundel(f, plate ? { relationLine: true } : {});
				const t = cardText(g, 1, false, { title: true, dates: true });
				const room = nameRoom(g, t, true, []);
				expect(room.last, `f${f} plate ${plate}`).toBeCloseTo(t.nameWithSignW, 9);
				expect(room.full).toBeCloseTo(t.nameWithSignW, 9);
			}
		}
	});

	it('the decision follows the clearance for every font: yes from 10 px with a crown, no at 8 px', () => {
		const decide = (f: number, plate: boolean, ring?: number) => {
			const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
			const t = cardText(g, 1, false, { title: true, dates: true });
			return nameRoom(g, t, true, [], ring).last === t.textW;
		};
		expect(decide(8, true)).toBe(false);
		for (let f = 10; f <= 48; f++) {
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

	it('the marked card (sign below the ring): narrow room at 12 px ON, full column from 14 px', () => {
		const ring = 3; // ME_RING_INNER, the ring's inner edge from the card edge
		const room = (f: number, plate: boolean) => {
			const g = roundel(f, { ...pics, ...(plate ? { relationLine: true } : {}) });
			const t = cardText(g, 1, false, { title: true, dates: true });
			return [nameRoom(g, t, true, [], ring).last, t.textW, t.nameWithSignW] as const;
		};
		const [l12, , n12] = room(12, true);
		expect(l12).toBeCloseTo(n12, 9);
		for (const f of [14, 16]) {
			const [last, textW] = room(f, true);
			expect(last, `f${f}`).toBe(textW);
		}
		// the moved sign keeps its distance to the ring
		const g = roundel(12, { ...pics, relationLine: true });
		const t = cardText(g, 2);
		const moved = signBelowRing(t.sign, ring);
		expect(Math.min(moved.y1, moved.y2) - moved.width / (2 * Math.SQRT2)).toBeGreaterThanOrEqual(ring + 1.5 - 1e-9);
	});

	it('the text card always takes the narrow room for a signed name and ignores boxes', () => {
		const g = drawnGeometry(cardForm(geometryFor(12, 'normal'), 'sideways'), settings({ orientation: 'sideways', relationLine: true }));
		const t = cardText(g, 2, false, { title: true, dates: true });
		const room = nameRoom(g, t, true, [{ r: { x: 100, y: 0, w: 20, h: 60 }, gap: 3 }]);
		expect(room).toEqual({ full: t.nameWithSignW, last: t.nameWithSignW, only: t.nameWithSignW });
		expect(nameRoom(g, t, false, [])).toEqual({ full: t.textW, last: t.textW, only: t.textW });
	});
});

describe('B.3.3 medallion and arms', () => {
	it('12 px: medallion 24 px at (58.5, -15); arms beside it 15 x 18; arms alone 20 x 24; the line ends 16.8 / 15 px above the card', () => {
		const g = roundel(12, { ...pics, relationLine: true });
		const both = roundelPics(g, { arms: true, portrait: true });
		expect(both.cx).toBeCloseTo(70.5, 9);
		expect(both.cy).toBe(-3);
		expect(both.portrait).toEqual({ x: 58.5, y: -15, w: 24, h: 24 });
		expect(both.ringR).toBeCloseTo(13.8, 9);
		expect(both.haloR).toBeCloseTo(16.2, 9);
		expect(both.arms!.w).toBeCloseTo(15, 9);
		expect(both.arms!.h).toBeCloseTo(18, 9);
		expect(both.arms!.x).toBeCloseTo(87.3, 9);
		expect(both.arms!.y + both.arms!.h / 2).toBeCloseTo(-3, 9);
		const alone = roundelPics(g, { arms: true, portrait: false });
		expect(alone.portrait).toBeUndefined();
		expect(alone.arms).toEqual({ x: 70.5 - 10, y: -15, w: 20, h: 24 });
		expect(roundelLineEnd(g, { portrait: true })).toBeCloseTo(16.8, 9);
		expect(roundelLineEnd(g, { arms: true, portrait: true })).toBeCloseTo(16.8, 9);
		expect(roundelLineEnd(g, { arms: true })).toBe(15);
		expect(roundelLineEnd(g, {})).toBe(0);
	});

	it('16 px', () => {
		const g = roundel(16, { ...pics });
		const both = roundelPics(g, { arms: true, portrait: true });
		expect(both.portrait!.w).toBe(32);
		expect(both.arms!.x).toBeCloseTo(94 + 18.4 + 4, 9);
		expect(roundelLineEnd(g, { portrait: true })).toBeCloseTo(22.4, 9);
		expect(roundelLineEnd(g, { arms: true })).toBe(20);
		// the halo reaches exactly `reach` above the card
		expect(both.haloR - both.cy).toBeLessThanOrEqual(g.reach!);
	});
});

describe('B.3.4 reach by form and the "You" tab', () => {
	const reachOf = (f: number, kind: 'roundel-pics' | 'roundel-none' | 'classic' | 'text', tab: boolean) => {
		const youTab = tab ? { youTab: 'me' } : {};
		if (kind === 'roundel-pics') return drawnGeometry(cardForm(geometryFor(f, 'normal'), 'down'), settings({ ...pics, ...youTab })).reach;
		if (kind === 'roundel-none') return drawnGeometry(cardForm(geometryFor(f, 'normal'), 'down'), settings(youTab)).reach;
		if (kind === 'classic') return drawnGeometry(cardForm(geometryFor(f, 'compact'), 'down'), settings({ ...pics, ...youTab })).reach;
		return drawnGeometry(cardForm(geometryFor(f, 'normal'), 'sideways'), settings({ orientation: 'sideways', ...pics, ...youTab })).reach;
	};

	it('20 / 8 / 12 / 12 at 12 px and 26 / 10 / 16 / 16 at 16 px (Roundel with pictures, Roundel without, classic Compact, text card)', () => {
		expect((['roundel-pics', 'roundel-none', 'classic', 'text'] as const).map((k) => reachOf(12, k, true))).toEqual([20, 8, 12, 12]);
		expect((['roundel-pics', 'roundel-none', 'classic', 'text'] as const).map((k) => reachOf(16, k, true))).toEqual([26, 10, 16, 16]);
	});

	it('0 (absent) without a tab and without pictures; the pictures give the Roundel its reach without a tab', () => {
		for (const k of ['roundel-none', 'classic', 'text'] as const) expect(reachOf(12, k, false), k).toBeUndefined();
		expect(reachOf(12, 'roundel-pics', false)).toBe(20);
	});

	it('the reach holds the top of the tab with its stroke, every font', () => {
		for (let f = 8; f <= 48; f++) {
			expect(reachOf(f, 'roundel-none', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAbove * f + 0.75);
			expect(reachOf(f, 'text', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAboveText * f + 0.75);
			expect(reachOf(f, 'roundel-pics', true)!, `f${f}`).toBeGreaterThanOrEqual(ROUNDEL_EM.tabAbove * f + 0.75);
			expect(Math.ceil(ROUNDEL_EM.tabAbove * f + TAB_REACH_PAD_PX)).toBe(reachOf(f, 'roundel-none', true));
		}
	});

	it('the tab rect: Roundel right end 1.45 em left of the axis (0.4 em with no picture), 0.55 em above the edge; text and classic at padX, 0.9 em above', () => {
		const g = roundel(12, { ...pics, youTab: 'me' });
		const withPic = youTabRect(g, true);
		expect(withPic.w).toBeCloseTo(27.6, 9);
		expect(withPic.h).toBeCloseTo(13.8, 9);
		expect(withPic.x + withPic.w).toBeCloseTo(70.5 - 17.4, 9);
		expect(withPic.y).toBeCloseTo(-6.6, 9);
		const noPic = youTabRect(roundel(12, { youTab: 'me' }), false);
		expect(noPic.x + noPic.w).toBeCloseTo(70.5 - 4.8, 9);
		const text = youTabRect(drawnGeometry(cardForm(geometryFor(12, 'normal'), 'sideways'), settings({ orientation: 'sideways', youTab: 'me' })), false);
		expect([text.x, text.y]).toEqual([0.875 * 12, -0.9 * 12]);
		const classic = youTabRect(geometryFor(12, 'compact'), true);
		expect([classic.x, classic.y]).toEqual([0.875 * 12, -0.9 * 12]);
	});
});

describe('cardForm and withRelationLine', () => {
	it('cardForm truth table; it changes no number and is idempotent', () => {
		const normal = geometryFor(12, 'normal');
		const compact = geometryFor(12, 'compact');
		expect(cardForm(normal, 'down').form).toBe('roundel');
		expect(cardForm(normal, 'sideways').form).toBe('text');
		expect(cardForm(compact, 'sideways').form).toBe('text');
		expect(cardForm(compact, 'down').form).toBeUndefined();
		for (const [geo, o] of [[normal, 'down'], [normal, 'sideways'], [compact, 'sideways']] as const) {
			const g = cardForm(geo, o);
			expect({ ...g, form: undefined }).toEqual({ ...geo, form: undefined });
			expect(cardForm(g, o)).toBe(g);
		}
		expect(isRoundel(cardForm(normal, 'down'))).toBe(true);
		expect(isTextCard(cardForm(normal, 'sideways'))).toBe(true);
		expect(isRoundel(normal) || isTextCard(normal)).toBe(false);
	});

	it('withRelationLine is idempotent for every form', () => {
		for (const [size, o] of [['normal', 'down'], ['normal', 'sideways'], ['compact', 'down'], ['compact', 'sideways']] as const) {
			for (const rel of [true, false]) {
				for (const tab of [true, false]) {
					const s = settings({ orientation: o, ...pics, ...(rel ? { relationLine: true } : {}), ...(tab ? { youTab: 'me' } : {}) });
					const once = withRelationLine(cardForm(geometryFor(12, size), o), s);
					expect(withRelationLine(once, s)).toBe(once);
					expect(drawnGeometry(once, s).cardH).toBe(once.cardH);
				}
			}
		}
	});

	it('the classic card with no tab is unchanged by this work package (old hashes stay)', () => {
		const geo = geometryFor(12, 'normal');
		expect(withRelationLine(geo, settings({ ...pics }))).toBe(geo);
		expect(withRelationLine(geo, settings({ relationLine: true }))).toEqual({ ...geo, cardH: geo.cardH + relationExtra(geo), relationLine: true });
	});
});
