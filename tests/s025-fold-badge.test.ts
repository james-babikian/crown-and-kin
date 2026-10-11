// 0.2.5 WP-B2 (CONTRACT B.3.9, D137 item 1; B.5 test 3): a visible fold mark keeps 0.25 em clear of the "+" badge circle of every card.
// The badge circle is centred on a card's real top right corner, radius 0.6 em. Before this rule a sideways tree had 210 control and
// badge pairs closer than 0.25 em at 12 px and at 16 px (proof tests/s025-gate-fold-badge.test.ts on branch scratch/s025-gate-ab); a
// top-to-bottom tree had none, so its layouts do not change.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { foldFamilies, foldHidden, type FoldControl } from '../src/core/folds';
import { parseDynasty } from '../src/core/parse';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { FOLD_BADGE_EM, FOLD_BADGE_GAP_EM, FOLD_EM, foldExtent, foldMark, placeFoldSpots } from '../src/layout/fold-spots';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings, PersonBox, TreeLayout } from '../src/layout/model';
import { BADGE_RADIUS_EM } from '../src/render/dom/scene';
import { sampleSources } from './acceptance/m11-support';

const IDS = ['07', '07b', '12', '15'];

/** A tree with folds on: every family has its open button, and every fifth family is folded to a "+ N" sign (the signs are the long marks). */
function lay(source: string, f: number, orientation: 'down' | 'sideways', form: boolean) {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	const g = deriveFamilies(parsed.tree);
	const folded = foldFamilies(g)
		.filter((_, i) => i % 5 === 2)
		.map((x) => x.key);
	const hidden = foldHidden(g, new Set(folded));
	const base = geometryFor(f);
	const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, ...(orientation === 'sideways' ? { orientation } : {}), foldHidden: [...hidden].sort(), foldedFamilies: folded, foldControls: true };
	clearLayoutCache();
	return layoutTree(g, form ? cardForm(base, orientation) : base, settings, 'font').layout;
}

/** Distance from point (px, py) to the segment (x1, y1) to (x2, y2). */
function toSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
	return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** The smallest clear gap between a visible mark and a badge circle, over every control and card of `layout` (real frame: centred on the spot in a down layout, growing right from it in a sideways layout). */
function worstGap(layout: TreeLayout): { gap: number; pairs: number } {
	const f = layout.geometry.fontPx;
	const need = FOLD_BADGE_GAP_EM * f;
	let gap = Infinity;
	let pairs = 0;
	for (const c of layout.folds ?? []) {
		const m = foldMark(c, c.spot, f, false, layout.orientation === 'sideways');
		for (const p of layout.persons.values()) {
			// The badge circle is centred on the card's real top right corner in every layout (D117 4).
			const d = toSegment(p.x + p.w, p.y, m.x1, m.y1, m.x2, m.y2) - m.r - FOLD_BADGE_EM * f;
			gap = Math.min(gap, d);
			if (d < need - 1e-6) pairs++;
		}
	}
	return { gap, pairs };
}

describe('B.3.9: the numbers of the rule', () => {
	it('the badge radius is the one the scene draws, and the clear gap is a quarter em', () => {
		expect(FOLD_BADGE_EM).toBe(BADGE_RADIUS_EM);
		expect(FOLD_BADGE_GAP_EM).toBe(0.25);
	});

	it('an open button is a circle 1.2 em across; a folded sign is a pill 1.25 em high, centred on the spot (D206)', () => {
		const open: FoldControl = { key: 'a', parents: ['a'], folded: false, count: 0 };
		const sign: FoldControl = { key: 'b', parents: ['a'], folded: true, count: 12 };
		const m1 = foldMark(open, { x: 10, y: 20 }, 12, false);
		expect(m1).toEqual({ x1: 10, y1: 20, x2: 10, y2: 20, r: (FOLD_EM.button / 2) * 12 });
		const m2 = foldMark(sign, { x: 10, y: 20 }, 12, false);
		expect(m2.r).toBeCloseTo((FOLD_EM.signHeight / 2) * 12, 9);
		expect(m2.y1).toBe(20);
		expect(m2.x2).toBeGreaterThan(m2.x1);
		expect(m2.y2).toBe(20);
		expect((m2.x1 + m2.x2) / 2).toBeCloseTo(10, 9);
		// A sideways layout (D207): the pill starts where the open chip starts, 0.475 em before the spot, and grows right.
		const m4 = foldMark(sign, { x: 10, y: 20 }, 12, false, true);
		expect(m4.x1 - m4.r).toBeCloseTo(10 - 0.475 * 12, 9);
		expect(m4.x2 - m4.x1).toBeCloseTo(m2.x2 - m2.x1, 9);
		// Turned frame: the same pill grows along y.
		const m3 = foldMark(sign, { x: 10, y: 20 }, 12, true);
		expect(m3.x2).toBe(10);
		expect(m3.y1 - m3.r).toBeCloseTo(20 - 0.475 * 12, 9);
		expect(m3.y2 - m3.y1).toBeCloseTo(m2.x2 - m2.x1, 9);
		// The sign's mark lies inside the rectangle the layout reserves for it.
		const ext = foldExtent(sign, { x: 10, y: 20 }, 12);
		expect(m2.x2 + m2.r).toBeLessThanOrEqual(ext.x + ext.w + 1e-6);
		expect(m2.x1 - m2.r).toBeGreaterThanOrEqual(ext.x - 1e-6);
		const anchored = foldExtent(sign, { x: 10, y: 20 }, 12, true);
		expect(m4.x2 + m4.r).toBeLessThanOrEqual(anchored.x + anchored.w + 1e-6);
	});
});

describe('B.3.9: every visible fold mark keeps 0.25 em from every badge circle', () => {
	for (const id of IDS) {
		for (const f of [12, 16]) {
			for (const orientation of ['down', 'sideways'] as const) {
				for (const form of [false, true]) {
					it(`sample ${id}, ${f} px, ${orientation}${form ? ', card form' : ', classic card'}`, () => {
						const s = sampleSources().find((x) => x.id === id)!;
						const layout = lay(s.source, f, orientation, form);
						expect(layout.folds?.length, 'the layout has fold controls').toBeGreaterThan(0);
						const { gap, pairs } = worstGap(layout);
						expect(pairs, `smallest gap ${gap.toFixed(2)} px`).toBe(0);
					});
				}
			}
		}
	}
});

describe('B.3.9: the control still moves only along its own stem and meets no tap area', () => {
	it('a control of a union stays on its union point across the stem: down the same x, sideways the same real y', () => {
		for (const id of IDS) {
			const s = sampleSources().find((x) => x.id === id)!;
			for (const orientation of ['down', 'sideways'] as const) {
				const layout = lay(s.source, 12, orientation, true);
				for (const c of layout.folds ?? []) {
					if (c.union === undefined) continue;
					const u = layout.unions.get(c.union)!;
					const across = orientation === 'down' ? c.spot.x - u.x : c.spot.y - u.y;
					expect(across, `${id} ${orientation}: ${c.key}`).toBeCloseTo(0, 6);
				}
			}
		}
	});

	it('no two tap areas meet and no tap area meets a far-couple tag (existing rules, after the move)', () => {
		const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
		for (const id of IDS) {
			const s = sampleSources().find((x) => x.id === id)!;
			for (const orientation of ['down', 'sideways'] as const) {
				const layout = lay(s.source, 12, orientation, true);
				const areas = (layout.folds ?? []).map((c) => foldExtent(c, c.spot, 12));
				for (let i = 0; i < areas.length; i++) {
					for (let j = i + 1; j < areas.length; j++) expect(meets(areas[i], areas[j]), `${id} ${orientation}: controls ${i} and ${j}`).toBe(false);
				}
				// Down: tags are in the placing frame of the layout. Sideways the layout places no tag rule (hints.tags is absent), as in 0.2.4.
				if (orientation === 'down') for (const t of layout.farTags.values()) for (const a of areas) expect(meets(a, t.hit), `${id}: a control meets the tap area of the tag of ${t.person}`).toBe(false);
			}
		}
	});
});

describe('B.3.9: placeFoldSpots on cards that I built', () => {
	const f = 12;
	const card = (id: string, x: number, y: number, w: number, h: number, gen = 0): PersonBox => ({ id, x, y, w, h, gen });
	const control: FoldControl = { key: 'k', parents: ['a'], folded: false, count: 0 };

	it('down frame: a control just below the badge of a card to its side moves down along its stem until 0.25 em clear', () => {
		// The badge circle of card `b` is centred on its top right corner (x 100, y 50); the control stands at x 100, 12 px below it.
		const persons = new Map<string, PersonBox>([
			['a', card('a', 40, 0, 40, 30)],
			['b', card('b', 60, 50, 40, 30, 1)],
		]);
		const r = placeFoldSpots([{ ...control, parents: ['a'] }], new Map([['a', persons.get('a')!]]), new Map(), [], f, { soloX: new Map([['a', 100]]) });
		const before = r[0].control.spot;
		const withBadge = placeFoldSpots([{ ...control, parents: ['a'] }], persons, new Map(), [], f, { soloX: new Map([['a', 100]]) });
		// The control of card `a` starts at x 100 and y 30 + 1 em; card b's badge is at (100, 50): too close, so it moves.
		const want = (0.55 + 0.6 + 0.25) * f; // the badge is 0.55 em since 0.2.8; the control mark is the 1.2 em circle the layout reserves
		const m = withBadge[0].control.spot;
		expect(m.x).toBe(100);
		expect(m.y).toBeGreaterThanOrEqual(before.y);
		expect(Math.hypot(m.x - 100, m.y - 50)).toBeGreaterThanOrEqual(want - 1e-6);
		expect(withBadge[0].pushed).toBe(m.y > before.y + 1e-6);
		expect(m.y - 50).toBeCloseTo(want, 6);
	});

	it('turned frame: the badge of a card is at its turned bottom left corner; the control moves along y, never along x', () => {
		const persons = new Map<string, PersonBox>([
			['a', card('a', 0, 0, 40, 60)],
			// Real top right corner of this card is the turned bottom left corner (b.x, b.y + b.h) = (30, 60).
			['b', card('b', 30, 0, 40, 60, 0)],
		]);
		const only = new Map([['a', persons.get('a')!]]);
		const solo = new Map([['a', 38]]);
		const alone = placeFoldSpots([control], only, new Map(), [], f, { soloX: solo, turned: true })[0].control.spot;
		const both = placeFoldSpots([control], persons, new Map(), [], f, { soloX: solo, turned: true })[0].control.spot;
		expect(alone).toEqual({ x: 38, y: 60 + f });
		expect(both.x).toBe(38);
		expect(both.y).toBeGreaterThan(alone.y);
		expect(Math.hypot(both.x - 30, both.y - 60)).toBeCloseTo((0.55 + 0.6 + 0.25) * f, 6);
	});

	it('a control that is clear already does not move, and the rule does not depend on whether a badge shows', () => {
		const persons = new Map<string, PersonBox>([
			['a', card('a', 0, 0, 40, 30)],
			['b', card('b', 200, 0, 40, 30)],
		]);
		const r = placeFoldSpots([control], persons, new Map(), [], f, {});
		expect(r[0].pushed).toBe(false);
		expect(r[0].control.spot).toEqual({ x: 20, y: 30 + f });
	});

	it('a folded sign is centred on its spot and keeps the gap from the badge of a card to its right', () => {
		const sign: FoldControl = { key: 's', parents: ['a'], folded: true, count: 7 };
		// The sign is centred on x 20 and is about 2.7 em long; a badge circle at (60, 40) lies near its right end.
		const persons = new Map<string, PersonBox>([
			['a', card('a', 0, 0, 40, 30)],
			['b', card('b', 20, 40, 40, 30, 1)],
		]);
		const spot = placeFoldSpots([sign], persons, new Map(), [], f, {})[0].control.spot;
		const m = foldMark(sign, spot, f, false);
		expect(toSegment(60, 40, m.x1, m.y1, m.x2, m.y2) - m.r - 0.6 * f).toBeGreaterThanOrEqual(0.25 * f - 1e-6);
	});
});

describe('D206: the "+ N" sign of a folded branch is centred on the line and meets nothing', () => {
	type R = { x: number; y: number; w: number; h: number };
	const meets = (a: R, b: R) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
	/** The Full-level pill of a control as a rectangle, from its capsule. */
	const pill = (c: FoldControl & { spot: { x: number; y: number } }, f: number): R => {
		const m = foldMark(c, c.spot, f, false);
		return { x: m.x1 - m.r, y: m.y1 - m.r, w: m.x2 - m.x1 + 2 * m.r, h: 2 * m.r };
	};
	for (const id of IDS) {
		for (const f of [12, 16]) {
			it(`sample ${id}, ${f} px, down: each sign is centred on its stem and touches no card, no other control and no far-couple tag`, () => {
				const s = sampleSources().find((x) => x.id === id)!;
				const layout = lay(s.source, f, 'down', true);
				const signs = (layout.folds ?? []).filter((c) => c.folded);
				expect(signs.length).toBeGreaterThan(0);
				const all = (layout.folds ?? []).map((c) => pill(c, f));
				for (const c of signs) {
					const r = pill(c, f);
					const self = (layout.folds ?? []).indexOf(c);
					expect(r.x + r.w / 2, `${c.key} centre`).toBeCloseTo(c.spot.x, 6);
					expect(r.x, `${c.key} inside the drawing`).toBeGreaterThanOrEqual(-1e-6);
					expect(r.x + r.w, `${c.key} inside the drawing`).toBeLessThanOrEqual(layout.width + 1e-6);
					for (const p of layout.persons.values()) expect(meets(r, p), `${c.key} on the card of ${p.id}`).toBe(false);
					for (const t of layout.farTags.values()) expect(meets(r, t.hit), `${c.key} on the tag of ${t.person}`).toBe(false);
					all.forEach((o, i) => i !== self && expect(meets(r, o), `${c.key} on another control`).toBe(false));
				}
			});
		}
	}

	it('a sideways layout starts the sign 0.475 em before its spot, on the line (D207)', () => {
		const s = sampleSources().find((x) => x.id === '15')!;
		const layout = lay(s.source, 12, 'sideways', true);
		for (const c of (layout.folds ?? []).filter((x) => x.folded)) {
			const m = foldMark(c, c.spot, 12, false, true);
			expect(m.x1 - m.r).toBeCloseTo(c.spot.x - 0.475 * 12, 9);
			expect(m.x2).toBeGreaterThan(m.x1);
		}
	});
});
