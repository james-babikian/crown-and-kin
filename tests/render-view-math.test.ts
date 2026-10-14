import { describe, expect, it } from 'vitest';
import {
	FIT_MIN_NAME_PX,
	LOD_BANDS,
	MAX_FIT_SCALE,
	READABLE_NAME_PX,
	FAMILY_SIDE_PAD,
	START_TOP_GAP,
	centreOn,
	chooseLod,
	clampCentre,
	clampPan,
	bandShift,
	clearBand,
	defaultView,
	embedHeight,
	fitView,
	enlargeHit,
	fitScale,
	isPan,
	panFrom,
	scaleLimits,
	transformFor,
	treeBounds,
	truncate,
	wheelFactor,
	zoomAt,
	type Lod,
} from '../src/render/view-math';

const size = { w: 800, h: 500 };

describe('level of detail (spec §5.4)', () => {
	it('starts in the middle of each hysteresis band', () => {
		expect(chooseLod(null, 16)).toBe('full');
		expect(chooseLod(null, 9)).toBe('full');
		expect(chooseLod(null, 8.9)).toBe('compact');
		expect(chooseLod(null, 4)).toBe('compact');
		expect(chooseLod(null, 3.9)).toBe('overview');
	});

	it('does not flip back and forth inside a band', () => {
		// Zoom out from Full: stays Full down to fullLeave.
		expect(chooseLod('full', LOD_BANDS.fullLeave)).toBe('full');
		expect(chooseLod('full', LOD_BANDS.fullLeave - 0.1)).toBe('compact');
		// Zoom back in a little: stays Compact until fullEnter.
		expect(chooseLod('compact', LOD_BANDS.fullEnter - 0.1)).toBe('compact');
		expect(chooseLod('compact', LOD_BANDS.fullEnter)).toBe('full');
		expect(chooseLod('compact', LOD_BANDS.compactLeave - 0.1)).toBe('overview');
		expect(chooseLod('overview', LOD_BANDS.compactEnter - 0.1)).toBe('overview');
		expect(chooseLod('overview', LOD_BANDS.compactEnter)).toBe('compact');
	});

	it('jumps across two levels in one large zoom', () => {
		expect(chooseLod('full', 1)).toBe('overview');
		expect(chooseLod('overview', 30)).toBe('full');
	});

	it('keeps the level for a value that is not a number', () => {
		const levels: Lod[] = ['full', 'compact', 'overview'];
		for (const l of levels) expect(chooseLod(l, NaN)).toBe(l);
		expect(chooseLod(null, NaN)).toBe('full');
	});
});

describe('default view (spec §5.5)', () => {
	const start = { x: 1000, y: 400, w: 180, h: 64 };

	it('fits a tree whose names stay at least 11 px', () => {
		const bounds = treeBounds(1000, 400);
		const v = defaultView(bounds, size, 16, start);
		expect(v.scale).toBeCloseTo(Math.min(800 / 1048, 500 / 448));
		expect(v.scale * 16).toBeGreaterThanOrEqual(FIT_MIN_NAME_PX);
		expect(v.cx).toBeCloseTo(500);
		expect(v.cy).toBeCloseTo(200);
	});

	it('does not blow up a small tree past its natural size', () => {
		const v = defaultView(treeBounds(200, 100), size, 16, start);
		expect(v.scale).toBe(MAX_FIT_SCALE);
	});

	it('opens a large tree at 14 px names, with the start person centred at the top (D13)', () => {
		const bounds = treeBounds(12000, 3000);
		const v = defaultView(bounds, size, 16, start);
		expect(v.scale * 16).toBeCloseTo(READABLE_NAME_PX);
		expect(v.cx).toBeCloseTo(1090);
		const s = onScreen(v, start);
		expect(s.top).toBeCloseTo(START_TOP_GAP * v.scale);
	});

	it('keeps the viewport inside the tree when the start person is at an edge', () => {
		const bounds = treeBounds(12000, 3000);
		const v = defaultView(bounds, size, 16, { x: 0, y: 0, w: 180, h: 64 });
		const half = size.w / 2 / v.scale;
		expect(v.cx).toBeCloseTo(bounds.x + half);
	});

	it('fits when there is no start person', () => {
		const bounds = treeBounds(12000, 3000);
		expect(defaultView(bounds, size, 16, null).scale).toBeCloseTo(fitScale(bounds, size));
	});

	it('survives a viewport of size zero', () => {
		const v = defaultView(treeBounds(1000, 400), { w: 0, h: 0 }, 16, start);
		expect(Number.isFinite(v.scale)).toBe(true);
	});
});

/** A card's rectangle on screen for `view` in the 800 × 500 viewport. */
function onScreen(view: { scale: number; cx: number; cy: number }, r: { x: number; y: number; w: number; h: number }, s = size) {
	const left = s.w / 2 + (r.x - view.cx) * view.scale;
	const top = s.h / 2 + (r.y - view.cy) * view.scale;
	return { left, top, right: left + r.w * view.scale, bottom: top + r.h * view.scale };
}

const whole = (v: { scale: number; cx: number; cy: number }, r: { x: number; y: number; w: number; h: number }, s = size) => {
	const o = onScreen(v, r, s);
	return o.left >= -1e-6 && o.right <= s.w + 1e-6 && o.top >= -1e-6 && o.bottom <= s.h + 1e-6;
};

describe('readable default view: start person at the top, children below (D13)', () => {
	const card = (x: number, row: number) => ({ x, y: row * 164, w: 180, h: 64 });
	// 12000 × 3000 does not fit at 11 px names in 800 × 500, so the readable view is used.
	const bounds = treeBounds(12000, 3000);

	it('puts the start card just below the toolbar band, in any row', () => {
		for (const row of [0, 3, 8]) {
			const start = card(5000, row);
			const v = defaultView(bounds, size, 16, start, 52);
			expect(onScreen(v, start).top).toBeCloseTo(52 + START_TOP_GAP * v.scale);
		}
	});

	it('stays over the tree when the start person is in the bottom row', () => {
		const start = { x: 5000, y: 3000 - 64, w: 180, h: 64 };
		const v = defaultView(bounds, size, 16, start, 52);
		const bottom = size.h / 2 + (bounds.y + bounds.h - v.cy) * v.scale;
		expect(bottom).toBeCloseTo(size.h);
		expect(whole(v, start)).toBe(true);
	});

	it('puts a wide but low tree at the top of the area, not in the middle', () => {
		const low = treeBounds(12000, 228);
		const start = card(5000, 0);
		const v = defaultView(low, size, 16, start, 52);
		expect(size.h / 2 + (low.y - v.cy) * v.scale).toBeCloseTo(52);
	});

	it('centres a couple and their children when all of them fit', () => {
		const start = card(5000, 0);
		const partner = card(5216, 0);
		const kids = [card(4900, 1), card(5316, 1)];
		const v = defaultView(bounds, size, 16, start, 52, { partners: [partner], children: kids });
		for (const c of [start, partner, ...kids]) expect(whole(v, c)).toBe(true);
		expect(v.cx).toBeCloseTo((4900 + 5496) / 2);
	});

	it('moves sideways to show a child that sits far from the start person', () => {
		const start = card(5000, 0);
		const child = card(4420, 1);
		const old = defaultView(bounds, size, 16, start, 52);
		expect(whole(old, child)).toBe(false);
		const v = defaultView(bounds, size, 16, start, 52, { partners: [], children: [child] });
		expect(whole(v, start)).toBe(true);
		expect(whole(v, child)).toBe(true);
		expect(onScreen(v, start).top).toBeCloseTo(52 + START_TOP_GAP * v.scale);
	});

	it('prefers a child to a partner when both do not fit', () => {
		const start = card(5000, 0);
		const partner = card(5216, 0);
		const child = card(4400, 1);
		const v = defaultView(bounds, size, 16, start, 52, { partners: [partner], children: [child] });
		expect(whole(v, start)).toBe(true);
		expect(whole(v, child)).toBe(true);
		expect(whole(v, partner)).toBe(false);
	});

	it('shows the child nearer to the start person when only one fits', () => {
		const start = card(5000, 0);
		const near = card(5500, 1);
		const far = card(4300, 1);
		const v = defaultView(bounds, size, 16, start, 52, { partners: [], children: [far, near] });
		expect(whole(v, near)).toBe(true);
		expect(whole(v, far)).toBe(false);
	});

	it('shows part of the nearest child at the edge when no child fits whole, and keeps the start card whole', () => {
		const start = card(5000, 0);
		const partner = card(5216, 0);
		const kids = [card(4000, 1), card(5750, 1)];
		const v = defaultView(bounds, size, 16, start, 52, { partners: [partner], children: kids });
		expect(whole(v, start)).toBe(true);
		expect(whole(v, partner)).toBe(true);
		const right = onScreen(v, kids[1]);
		expect(right.left).toBeLessThan(size.w);
		expect(right.right).toBeGreaterThan(size.w);
		expect(onScreen(v, start).left).toBeCloseTo(FAMILY_SIDE_PAD);
	});

	it('shows part of a child rather than a partner on the other side (sample tree 7 after WP3.4)', () => {
		const start = card(5000, 0);
		const partner = card(5216, 0);
		// Neither child fits whole next to the start card; the partner does, on the right.
		const kids = [card(4200, 1), card(5950, 1)];
		const v = defaultView(bounds, size, 16, start, 52, { partners: [partner], children: kids });
		expect(whole(v, start)).toBe(true);
		const seen = kids.map((k) => onScreen(v, k)).filter((k) => k.right > 0 && k.left < size.w);
		expect(seen).toHaveLength(1);
	});

	it('does not count a partner in another row that is out of view', () => {
		const start = card(5000, 0);
		const farPartner = card(5700, 6);
		const v = defaultView(bounds, size, 16, start, 52, { partners: [farPartner], children: [] });
		expect(v.cx).toBeCloseTo(5090);
	});

	it('keeps the view inside the tree at its left edge', () => {
		const start = card(0, 0);
		const v = defaultView(bounds, size, 16, start, 52, { partners: [card(216, 0)], children: [card(100, 1)] });
		expect(v.cx).toBeCloseTo(bounds.x + size.w / 2 / v.scale);
	});

	it('leaves the fitted view as it was', () => {
		const small = treeBounds(1000, 400);
		const fam = { partners: [card(216, 0)], children: [card(900, 1)] };
		expect(defaultView(small, size, 16, card(0, 0), 52, fam)).toEqual(defaultView(small, size, 16, card(0, 0), 52));
		expect(defaultView(small, size, 16, card(0, 0), 52)).toEqual(fitView(small, size, 52));
	});
});

describe('centre on a person (far-couple tag jump)', () => {
	const box = { x: 2000, y: 1000, w: 180, h: 64 };

	it('keeps a readable zoom', () => {
		const v = centreOn({ scale: 1.2, cx: 0, cy: 0 }, box, 16);
		expect(v).toEqual({ scale: 1.2, cx: 2090, cy: 1032 });
	});

	it('zooms in to 14 px names from an unreadable zoom', () => {
		const v = centreOn({ scale: 0.3, cx: 0, cy: 0 }, box, 16);
		expect(v.scale * 16).toBeCloseTo(READABLE_NAME_PX);
	});

	it('centres a person at the edge of the tree (spec §5.3), unlike the default view', () => {
		const edge = { x: 0, y: 0, w: 180, h: 64 };
		expect(centreOn({ scale: 1, cx: 500, cy: 500 }, edge, 16)).toEqual({ scale: 1, cx: 90, cy: 32 });
	});
});

describe('toolbar band after a font change', () => {
	const view = { scale: 1, cx: 400, cy: 250 };
	const card = (y: number) => ({ x: 300, y, w: 180, h: 64 });

	it('needs no shift when no card on screen is under the band', () => {
		expect(bandShift(view, size, 52, [card(60), card(-200), { x: 2000, y: 10, w: 180, h: 64 }])).toBe(0);
	});

	it('shifts just enough to clear the band', () => {
		expect(bandShift(view, size, 52, [card(30)])).toBe(22);
		const v = clearBand(view, size, 52, [card(30)]);
		expect(v.cy).toBe(228);
		expect(bandShift(v, size, 52, [card(30)])).toBe(0);
	});

	it('also clears a card that comes into the band from above', () => {
		const boxes = [card(30), card(-50)];
		const v = clearBand(view, size, 52, boxes);
		expect(bandShift(v, size, 52, boxes)).toBe(0);
	});
});

describe('toolbar band (insetTop)', () => {
	const bounds = treeBounds(1000, 400);

	it('fits the tree into the area below the band', () => {
		const v = fitView(bounds, size, 52);
		expect(v.scale).toBeCloseTo(Math.min(1, 800 / bounds.w, 448 / bounds.h));
		// The tree's top edge sits at or below the band.
		const topOnScreen = size.h / 2 + (bounds.y - v.cy) * v.scale;
		expect(topOnScreen).toBeGreaterThanOrEqual(52 - 1e-6);
	});

	it('keeps the row of the start person clear of the band in the readable view', () => {
		const big = treeBounds(12000, 3000);
		const v = defaultView(big, size, 16, { x: 0, y: 0, w: 180, h: 64 }, 52);
		const topOnScreen = size.h / 2 + (big.y - v.cy) * v.scale;
		expect(topOnScreen).toBeCloseTo(52);
	});

	it('is the plain view without a band', () => {
		expect(defaultView(bounds, size, 16, null, 0)).toEqual(defaultView(bounds, size, 16, null));
	});
});

describe('pan and zoom', () => {
	it('keeps the point under the pointer fixed while it zooms', () => {
		const v = { scale: 1, cx: 400, cy: 250 };
		const limits = { min: 0.1, max: 4 };
		const z = zoomAt(v, 2, 600, 100, size, limits);
		const before = { x: v.cx + (600 - 400) / v.scale, y: v.cy + (100 - 250) / v.scale };
		const after = { x: z.cx + (600 - 400) / z.scale, y: z.cy + (100 - 250) / z.scale };
		expect(z.scale).toBe(2);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('stops at the zoom limits', () => {
		const limits = { min: 0.5, max: 2 };
		expect(zoomAt({ scale: 1, cx: 0, cy: 0 }, 10, 0, 0, size, limits).scale).toBe(2);
		expect(zoomAt({ scale: 1, cx: 0, cy: 0 }, 0.01, 0, 0, size, limits).scale).toBe(0.5);
	});

	it('limits allow half the fit zoom and names up to 64 px', () => {
		const bounds = treeBounds(12000, 3000);
		const l = scaleLimits(bounds, size, 16);
		expect(l.min).toBeCloseTo(fitScale(bounds, size) / 2);
		expect(l.max).toBe(4);
	});

	it('pans by screen pixels at the current zoom', () => {
		expect(panFrom({ scale: 2, cx: 100, cy: 100 }, 40, -20)).toEqual({ scale: 2, cx: 80, cy: 110 });
	});

	it('keeps the centre over the tree', () => {
		const b = { x: 0, y: 0, w: 100, h: 100 };
		expect(clampPan({ scale: 1, cx: -50, cy: 500 }, b)).toEqual({ scale: 1, cx: 0, cy: 100 });
	});

	it('0.3 (D222): with a free area, a tree smaller than it stays wholly inside it; a larger axis keeps the rule above', () => {
		const b = { x: 0, y: 0, w: 100, h: 100 };
		const area = { size: { w: 400, h: 600 }, free: { top: 50, bottom: 100 } };
		// The centre far to the left: the bounds' lower right corner is at the free area's lower right corner (screen 400, 500).
		const v = clampPan({ scale: 1, cx: -500, cy: -500 }, b, area);
		expect(200 + (b.x + b.w - v.cx)).toBeCloseTo(400, 6);
		expect(300 + (b.y + b.h - v.cy)).toBeCloseTo(500, 6);
		// The centre far to the right: the bounds' upper left corner is at the free area's upper left corner (screen 0, 50).
		const w = clampPan({ scale: 1, cx: 900, cy: 900 }, b, area);
		expect(200 + (b.x - w.cx)).toBeCloseTo(0, 6);
		expect(300 + (b.y - w.cy)).toBeCloseTo(50, 6);
		// A tree taller than the free area (450 px) keeps the 0.2.8 limit in y, and the width still follows the free area.
		const tall = { x: 0, y: 0, w: 100, h: 1000 };
		expect(clampPan({ scale: 1, cx: 900, cy: 5000 }, tall, area)).toEqual({ scale: 1, cx: 50 + 150, cy: 1000 });
	});

	it('centres a tree that is smaller than the viewport', () => {
		const b = { x: 0, y: 0, w: 100, h: 100 };
		expect(clampCentre({ scale: 1, cx: 0, cy: 0 }, b, size)).toEqual({ scale: 1, cx: 50, cy: 50 });
	});

	it('writes the transform for a view', () => {
		expect(transformFor({ scale: 0.5, cx: 100, cy: 50 }, size)).toBe('translate(350 225) scale(0.5)');
	});

	it('keeps a small scale exact enough that no tree point moves by more than 0.01 px (WP5.3 review)', () => {
		// Sample tree 7 at Fit on a phone: scale about 0.031, tree about 12,000 px wide.
		const v = { scale: 0.0312345678901, cx: 6000, cy: 900 };
		const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(transformFor(v, size))!;
		for (const p of [{ x: 0, y: 0 }, { x: 12000, y: 1800 }]) {
			const want = { x: (p.x - v.cx) * v.scale + size.w / 2, y: (p.y - v.cy) * v.scale + size.h / 2 };
			expect(Math.abs(Number(m[1]) + p.x * Number(m[3]) - want.x)).toBeLessThan(0.01);
			expect(Math.abs(Number(m[2]) + p.y * Number(m[3]) - want.y)).toBeLessThan(0.01);
		}
	});

	it('treats a movement of 8 px or less as a tap (spec §7.2)', () => {
		expect(isPan(8, 0)).toBe(false);
		expect(isPan(6, 6)).toBe(true);
	});

	it('gives moderate wheel steps', () => {
		// One mouse notch zooms by about 1.2; four notches by less than 2.5 (was about 11).
		expect(1 / wheelFactor(100, 0)).toBeCloseTo(Math.exp(0.2));
		expect(1 / wheelFactor(100, 0) ** 4).toBeLessThan(2.5);
		expect(wheelFactor(1000, 0)).toBe(wheelFactor(100, 0));
		expect(wheelFactor(-3, 1)).toBeGreaterThan(1);
		expect(wheelFactor(5, 0)).toBeGreaterThan(0.9);
		expect(wheelFactor(NaN, 0)).toBe(1);
	});
});

describe('hit areas (spec §7.5)', () => {
	const hit = { x: 10, y: 20, w: 135, h: 44 };

	it('are unchanged at zoom 1 or more', () => {
		expect(enlargeHit(hit, 1)).toEqual(hit);
		expect(enlargeHit(hit, 2)).toEqual(hit);
	});

	it('grow around their centre to stay 44 screen px', () => {
		const r = enlargeHit(hit, 0.25);
		expect(r.h * 0.25).toBeCloseTo(44);
		expect(r.w * 0.25).toBeCloseTo(44);
		expect(r.x + r.w / 2).toBeCloseTo(hit.x + hit.w / 2);
		expect(r.y + r.h / 2).toBeCloseTo(hit.y + hit.h / 2);
	});
});

describe('truncation', () => {
	const measure = (s: string) => Array.from(s).length * 10;

	it('keeps text that fits', () => {
		expect(truncate('Aldric', 60, measure)).toBe('Aldric');
	});

	it('cuts with an ellipsis to the longest fitting start', () => {
		expect(truncate('Aldric Valmont', 60, measure)).toBe('Aldri…');
		expect(measure(truncate('Aldric Valmont', 60, measure))).toBeLessThanOrEqual(60);
	});

	it('does not leave a space before the ellipsis', () => {
		expect(truncate('Ser Gareth', 50, measure)).toBe('Ser…');
	});

	it('returns an empty string when not even the ellipsis fits', () => {
		expect(truncate('Aldric', 5, measure)).toBe('');
		expect(truncate('', 100, measure)).toBe('');
	});

	it('does not split a character outside the basic plane', () => {
		const t = truncate('𝔄𝔩𝔡𝔯𝔦𝔠', 40, measure);
		expect(t).toBe('𝔄𝔩𝔡…');
	});
});

describe('embedded height (spec §7.5)', () => {
	const d = { desktop: '500px', phone: '60vh' };

	it('uses options.height on desktop', () => {
		expect(embedHeight(700, false, d)).toBe('700px');
	});

	it('uses the default without a sensible options.height', () => {
		expect(embedHeight(undefined, false, d)).toBe('500px');
		expect(embedHeight(10, false, d)).toBe('500px');
		expect(embedHeight(NaN, false, d)).toBe('500px');
	});

	it('ignores options.height in the phone layout', () => {
		expect(embedHeight(700, true, d)).toBe('60vh');
	});
});
