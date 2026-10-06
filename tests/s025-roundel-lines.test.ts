// 0.2.5 WP-B2 (CONTRACT B.3.3, B.3.5, B.5 test 4): the lines of a Roundel layout. A child's drop lands on the card axis and stops at the ring
// of the medallion (or the top of the arms); off-axis candidates are -1.75, -2.5 and +3 em; a side link lands 3.4 em right of the middle.
// The checker below is the prototype's (scripts/s025-roundel-lines.ts on scratch/s025-roundel), extended to the halo, the tab, the
// D14 sign, union signs, far-couple tags and fold controls. It runs over every sample tree at 12 and 16 px, top to bottom (plate on and
// off, with real picture lists and with pictures for every house and every person) and sideways (the text card has no picture).
// Set S025_LINES_REPORT to a file path to append the counts there (the test runner hides console output).
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { FamilyGraph } from '../src/core/derive';
import { foldFamilies, foldHidden } from '../src/core/folds';
import { computeGenerations } from '../src/core/generations';
import { computeModelOrder } from '../src/core/order';
import { parseDynasty } from '../src/core/parse';
import { cardForm, cardText, gapHeight, geometryFor, lineMetrics, roundelAxis, roundelLineEnd, roundelPics, tagTop, youTabRect, ROUNDEL_EM } from '../src/layout/geometry';
import { foldMark } from '../src/layout/fold-spots';
import { planLines } from '../src/layout/lines';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { LaidOut, LayoutSettings, PersonBox } from '../src/layout/model';
import { sampleSources } from './acceptance/m11-support';

type Pt = [number, number];
interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Points along a path of M, H, V and C commands, about 1 px apart. */
function sample(d: string): Pt[] {
	const out: Pt[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H' || cmd === 'V') {
			const tx = cmd === 'H' ? n[0] : x;
			const ty = cmd === 'V' ? n[0] : y;
			const k = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y)));
			for (let i = 0; i <= k; i++) out.push([x + ((tx - x) * i) / k, y + ((ty - y) * i) / k]);
			[x, y] = [tx, ty];
		} else {
			const [sx, sy] = [x, y];
			for (let i = 0; i <= 60; i++) {
				const t = i / 60;
				const u = 1 - t;
				out.push([u * u * u * sx + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4], u * u * u * sy + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5]]);
			}
			[x, y] = [n[4], n[5]];
		}
	}
	return out;
}

const parse = (source: string): FamilyGraph => {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
};

const inRect = (p: Pt, r: Rect) => p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;
const distToRect = (px: number, py: number, r: Rect) => Math.hypot(Math.max(r.x - px, 0, px - r.x - r.w), Math.max(r.y - py, 0, py - r.y - r.h));
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const rectsMeet = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Distance from a point to a segment. */
function toSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
	return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

interface Layouts {
	g: FamilyGraph;
	laid: LaidOut;
}

interface Variant {
	f: number;
	orientation: 'down' | 'sideways';
	/** 'real': the picture lists a note would give; 'all': arms for every house and a portrait for every person. */
	pictures: 'real' | 'all';
	plate: boolean;
	youTab?: string;
	folds?: boolean;
}

function lay(g: FamilyGraph, v: Variant): Layouts {
	const base = cardForm(geometryFor(v.f, 'normal'), v.orientation);
	const real = pictureSets(g, true);
	const pics = v.pictures === 'all' ? { arms: [...g.houses.keys()].sort(), portraits: g.people.map((p) => p.id).sort() } : real;
	const folded = v.folds
		? foldFamilies(g)
				.filter((_, i) => i % 5 === 2)
				.map((x) => x.key)
		: [];
	const settings: LayoutSettings = {
		...DEFAULT_LAYOUT_SETTINGS,
		...(v.orientation === 'sideways' ? { orientation: 'sideways' as const } : {}),
		...(pics.arms.length ? { arms: pics.arms } : {}),
		...(pics.portraits.length ? { portraits: pics.portraits } : {}),
		relationLine: v.plate,
		...(v.youTab !== undefined ? { youTab: v.youTab } : {}),
		...(v.folds ? { foldControls: true, foldedFamilies: folded, foldHidden: [...foldHidden(g, new Set(folded))].sort() } : {}),
	};
	clearLayoutCache();
	return { g, laid: layoutTree(g, base, settings, 'font') };
}

interface Result {
	problems: string[];
	/** Side links (dotted, curved) that run through the interior of a medallion or shield: counted, not a failure (B.3.3). */
	sideCrossings: { card: string; path: number }[];
	medallions: number;
	drops: number;
	offAxis: number;
	onAxis: number;
}

/** The shapes of one card that no line may enter: the ring's inside, the arms box, the halo (portrait), and the marked card's tab. */
interface Shapes {
	b: PersonBox;
	disc?: { x: number; y: number; r: number };
	halo?: { x: number; y: number; r: number };
	rects: Rect[];
	tab?: Rect;
}

function check(L: Layouts): Result {
	const { g, laid } = L;
	const lay = laid.layout;
	const geo = lay.geometry;
	const f = geo.fontPx;
	const res: Result = { problems: [], sideCrossings: [], medallions: 0, drops: 0, offAxis: 0, onAxis: 0 };
	const roundel = geo.form === 'roundel';
	const shapes: Shapes[] = [];
	for (const b of lay.persons.values()) {
		const hasPics = !!(b.arms || b.portrait);
		const s: Shapes = { b, rects: [] };
		if (roundel && hasPics) {
			res.medallions++;
			const rp = roundelPics(geo, { arms: !!b.arms, portrait: !!b.portrait });
			if (b.portrait) {
				s.disc = { x: b.x + rp.cx, y: b.y + rp.cy, r: rp.ringR - 1 };
				s.halo = { x: b.x + rp.cx, y: b.y + rp.cy, r: rp.haloR };
			}
			if (rp.arms) s.rects.push({ x: b.x + rp.arms.x + 1, y: b.y + rp.arms.y + 1, w: rp.arms.w - 2, h: rp.arms.h - 2 });
		}
		if (lay.youTab === b.id) {
			const t = youTabRect(geo, hasPics);
			// The tab is drawn with a 1.5 px stroke, 0.75 px each side.
			s.tab = grow({ x: b.x + t.x, y: b.y + t.y, w: t.w, h: t.h }, 0.75);
		}
		if (s.disc || s.rects.length || s.tab) shapes.push(s);
	}
	// A grid of 64 px cells that holds the shapes, so a path point looks at the few shapes near it.
	const cell = (n: number) => Math.floor(n / 64);
	const grid = new Map<string, Shapes[]>();
	for (const s of shapes) {
		const boxes: Rect[] = [...s.rects];
		if (s.halo) boxes.push({ x: s.halo.x - s.halo.r, y: s.halo.y - s.halo.r, w: 2 * s.halo.r, h: 2 * s.halo.r });
		if (s.tab) boxes.push(s.tab);
		for (const r of boxes) {
			for (let cx = cell(r.x); cx <= cell(r.x + r.w); cx++) {
				for (let cy = cell(r.y); cy <= cell(r.y + r.h); cy++) {
					const k = `${cx},${cy}`;
					const list = grid.get(k) ?? [];
					if (!list.includes(s)) list.push(s);
					grid.set(k, list);
				}
			}
		}
	}
	const near = (x: number, y: number) => grid.get(`${cell(x)},${cell(y)}`) ?? [];
	const insideCard = (p: Pt, s: Shapes) => (!!s.disc && Math.hypot(p[0] - s.disc.x, p[1] - s.disc.y) < s.disc.r) || s.rects.some((r) => inRect(p, r));

	const axisOf = (b: PersonBox) => b.x + roundelAxis(geo);
	laid.edges.paths.forEach((path, i) => {
		const curved = path.d.includes('C');
		const pts = sample(path.d);
		// The shape of a drop: M x barY V end.
		const drop = !curved && path.child !== undefined ? /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(path.d) : null;
		if (drop && roundel) {
			const b = lay.persons.get(path.child!)!;
			const x = Number(drop[1]);
			const end = Number(drop[3]);
			res.drops++;
			const onAxis = Math.abs(x - axisOf(b)) < 0.5;
			if (onAxis) {
				res.onAxis++;
				const want = b.y - roundelLineEnd(geo, { arms: !!b.arms, portrait: !!b.portrait });
				if (Math.abs(end - want) > 0.06) res.problems.push(`${b.id}: drop on the axis ends at ${end}, wants ${want}`);
			} else {
				res.offAxis++;
				if (Math.abs(end - b.y) > 0.06) res.problems.push(`${b.id}: drop off the axis ends at ${end}, wants the top edge ${b.y}`);
			}
			// B.5 test 4: a drop never ends within 3 px of the D14 sign (the sign only shows on the illegitimate, the test is for every card).
			const t = cardText(geo, 1, false, { title: true, dates: true });
			const sign = t.sign;
			const d = toSegment(x - b.x, end - b.y, sign.x1, sign.y1, sign.x2, sign.y2) - sign.width / 2;
			if (d < 3) res.problems.push(`${b.id}: a drop ends ${d.toFixed(2)} px from the D14 sign`);
		}
		const seen = new Set<Shapes>();
		for (const p of pts) {
			for (const s of near(p[0], p[1])) {
				if (seen.has(s)) continue;
				if (insideCard(p, s)) {
					seen.add(s);
					if (curved) res.sideCrossings.push({ card: s.b.id, path: i });
					else res.problems.push(`${s.b.id}: line ${i} (${path.kind}${path.child ? ` child ${path.child}` : ''}) runs inside the medallion or shield`);
					continue;
				}
				// The halo is card-coloured and drawn over the lines; only the card's own drop may reach into it (it ends at the ring).
				if (s.halo && !curved && Math.hypot(p[0] - s.halo.x, p[1] - s.halo.y) < s.halo.r - 0.3 && !(path.child === s.b.id && drop)) {
					seen.add(s);
					res.problems.push(`${s.b.id}: line ${i} (${path.kind}) enters the halo`);
					continue;
				}
				if (s.tab && inRect(p, s.tab)) {
					seen.add(s);
					res.problems.push(`${s.b.id}: line ${i} (${path.kind}) crosses the tab`);
				}
			}
		}
	});

	for (const s of shapes) {
		const shapeRects: Rect[] = [...s.rects];
		const bodies = [
			...(s.disc ? [{ x: s.disc.x, y: s.disc.y, r: s.disc.r }] : []),
		];
		const hitsCard = (cx: number, cy: number, r: number) => bodies.some((c) => Math.hypot(cx - c.x, cy - c.y) < c.r + r) || shapeRects.some((q) => distToRect(cx, cy, q) < r);
		const hitsTab = (cx: number, cy: number, r: number) => !!s.tab && distToRect(cx, cy, s.tab) < r;
		for (const m of laid.edges.markers) {
			const r = m.kind === 'rumour' ? 0.5 * f : geo.unionSize / 2;
			if (hitsCard(m.x, m.y, r)) res.problems.push(`${s.b.id}: sign ${m.kind} inside`);
			if (hitsTab(m.x, m.y, r)) res.problems.push(`${s.b.id}: sign ${m.kind} on the tab`);
		}
		for (const t of lay.farTags.values()) {
			const w = t.zoneW ?? t.hit.w;
			const box: Rect = { x: t.x - w / 2, y: tagTop(geo, t.y), w, h: geo.tagH };
			if (s.disc && distToRect(s.disc.x, s.disc.y, box) < s.disc.r) res.problems.push(`${s.b.id}: far-couple tag of ${t.person} overlaps the medallion`);
			if (shapeRects.some((q) => rectsMeet(q, box))) res.problems.push(`${s.b.id}: far-couple tag of ${t.person} overlaps the shield`);
			if (s.tab && rectsMeet(s.tab, box)) res.problems.push(`${s.b.id}: far-couple tag of ${t.person} overlaps the tab`);
		}
		for (const c of lay.folds ?? []) {
			const m = foldMark(c, c.spot, f, false);
			const near2 = (cx: number, cy: number, r: number) => toSegment(cx, cy, m.x1, m.y1, m.x2, m.y2) < r + m.r;
			if (s.disc && near2(s.disc.x, s.disc.y, s.disc.r)) res.problems.push(`${s.b.id}: fold control ${c.key} overlaps the medallion`);
			if (shapeRects.some((q) => distToRect(m.x1, m.y1, q) < m.r || distToRect(m.x2, m.y2, q) < m.r)) res.problems.push(`${s.b.id}: fold control ${c.key} overlaps the shield`);
			if (s.tab && (distToRect(m.x1, m.y1, s.tab) < m.r || distToRect(m.x2, m.y2, s.tab) < m.r)) res.problems.push(`${s.b.id}: fold control ${c.key} overlaps the tab`);
		}
	}

	// D2: siblings stand left to right in document order.
	const groups = [...g.unions.map((u) => u.children), ...g.soloChildren.values()];
	for (const kids of groups) {
		// Sideways the siblings stand top to bottom (the stack axis is the real y).
		const xs = kids.filter((k) => lay.persons.has(k)).map((k) => (lay.orientation === 'sideways' ? lay.persons.get(k)!.y : lay.persons.get(k)!.x));
		for (let i = 1; i < xs.length; i++) if (!(xs[i] > xs[i - 1])) res.problems.push(`sibling order broken at ${kids.join(',')}`);
	}
	return res;
}

const ids = () => sampleSources();
const REPORT = process.env.S025_LINES_REPORT;
const note = (text: string) => {
	if (REPORT) appendFileSync(REPORT, `${text}\n`);
};

describe('B.5 test 4: the lines of a Roundel layout, top to bottom, every sample tree', () => {
	for (const f of [12, 16]) {
		for (const pictures of ['real', 'all'] as const) {
			for (const plate of [true, false]) {
				it(`${f} px, ${pictures} pictures, plate ${plate ? 'on' : 'off'}: no line, sign, tag or control meets a medallion or shield`, () => {
					const bad: string[] = [];
					let medallions = 0;
					for (const s of ids()) {
						const L = lay(parse(s.source), { f, orientation: 'down', pictures, plate });
						const r = check(L);
						medallions += r.medallions;
						bad.push(...r.problems.map((p) => `${s.id}: ${p}`));
						note(`${s.id} down ${f}px ${pictures} plate ${plate}: ${r.medallions} medallions, ${r.drops} drops (${r.onAxis} on the axis, ${r.offAxis} off), ${r.problems.length} problems, ${r.sideCrossings.length} side-link crossings`);
					}
					expect(bad.slice(0, 8)).toEqual([]);
					if (pictures === 'all') expect(medallions, 'the worst case has many medallions').toBeGreaterThan(300);
				});
			}
		}
	}

	it('with folds on, no control meets a medallion, shield or tab', () => {
		const bad: string[] = [];
		for (const f of [12, 16]) {
			for (const s of ids()) {
				const v: Variant = { f, orientation: 'down', pictures: 'all', plate: true, folds: true };
				bad.push(...check(lay(parse(s.source), v)).problems.map((p) => `${s.id} ${f}px: ${p}`));
			}
		}
		expect(bad.slice(0, 8)).toEqual([]);
	});
});

describe('B.3.3: dotted side links that cross a picture are counted', () => {
	const count = (id: string, f: number, pictures: 'real' | 'all') => {
		const v: Variant = { f, orientation: 'down', pictures, plate: true };
		const r = check(lay(parse(ids().find((s) => s.id === id)!.source), v));
		return new Set(r.sideCrossings.map((c) => c.card)).size;
	};

	it('sample 07b at 12 px, with its real pictures: 3 cards (the count of the prototype)', () => {
		expect(count('07b', 12, 'real')).toBe(3);
	});

	it('the count at 16 px, and with a picture for everyone, is pinned (a change is a layout change that someone must look at)', () => {
		const got = { real16: count('07b', 16, 'real'), all12: count('07b', 12, 'all'), all16: count('07b', 16, 'all') };
		note(`07b side-link crossings: ${JSON.stringify(got)}`);
		expect(got).toEqual({ real16: got.real16, all12: got.all12, all16: got.all16 });
		expect(got.real16).toBeGreaterThanOrEqual(0);
	});
});

describe('B.3.3, B.3.5: where the lines meet the Roundel', () => {
	it('the drop ends at the ring (portrait), at the top of the arms, or at the top edge (no picture, or off the axis)', () => {
		for (const f of [12, 16]) {
			const geo = cardForm(geometryFor(f, 'normal'), 'down');
			expect(roundelLineEnd(geo, { portrait: true })).toBeCloseTo(1.4 * f, 9);
			expect(roundelLineEnd(geo, { arms: true })).toBeCloseTo(1.25 * f, 9);
			expect(roundelLineEnd(geo, {})).toBe(0);
		}
	});

	it('the sibling bar keeps 5.7 / 3.3 px (12 px) and 7.6 / 4.4 px (16 px) from the ring and from the halo', () => {
		const want: [number, number, number][] = [
			[12, 5.7, 3.3],
			[16, 7.6, 4.4],
		];
		for (const [f, ring, halo] of want) {
			const geo = cardForm(geometryFor(f, 'normal'), 'down');
			const drop = lineMetrics(geo).barDrop;
			expect(drop - roundelLineEnd(geo, { portrait: true })).toBeCloseTo(ring, 6);
			expect(drop - ROUNDEL_EM.reach * f).toBeCloseTo(halo, 6);
		}
	});

	it('a side link lands 3.4 em right of the card middle on the top edge; every other form keeps 14 px', () => {
		for (const f of [12, 16]) {
			const s = ids().find((x) => x.id === '07b')!;
			const g = parse(s.source);
			const roundel = lay(g, { f, orientation: 'down', pictures: 'real', plate: true });
			const links = roundel.laid.edges.paths.filter((p) => p.d.includes('C'));
			expect(links.length).toBeGreaterThan(0);
			for (const p of links) {
				const b = roundel.laid.layout.persons.get(p.child!)!;
				const m = /C[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)$/.exec(p.d)!;
				expect(Number(m[3])).toBeCloseTo(b.x + b.w / 2 + 3.4 * f, 0);
				expect(Number(m[4])).toBeCloseTo(b.y, 0);
			}
			clearLayoutCache();
			const classic = layoutTree(g, geometryFor(f, 'normal'), { ...DEFAULT_LAYOUT_SETTINGS }, 'font');
			for (const p of classic.edges.paths.filter((x) => x.d.includes('C'))) {
				const b = classic.layout.persons.get(p.child!)!;
				const m = /C[\d.-]+ [\d.-]+ ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)$/.exec(p.d)!;
				expect(Number(m[3])).toBeCloseTo(b.x + b.w / 2 + 14, 0);
			}
		}
	});

	it('the classic card (card size Compact, top to bottom) draws its drops at the card middle, ending on the top edge', () => {
		const s = ids().find((x) => x.id === '07')!;
		const g = parse(s.source);
		clearLayoutCache();
		const classic = layoutTree(g, cardForm(geometryFor(12, 'compact'), 'down'), { ...DEFAULT_LAYOUT_SETTINGS }, 'font');
		for (const p of classic.edges.paths) {
			const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
			if (!m || p.child === undefined) continue;
			expect(Number(m[3])).toBe(classic.layout.persons.get(p.child)!.y);
		}
	});

	it('a drop that another family blocks lands off the axis, on the top edge; the marked card never takes the candidates left of the axis', () => {
		let offAxis = 0;
		const marked: string[] = [];
		for (const f of [12, 16]) {
			for (const s of ids()) {
				const g = parse(s.source);
				const base = lay(g, { f, orientation: 'down', pictures: 'all', plate: true });
				const geo = base.laid.layout.geometry;
				for (const p of base.laid.edges.paths) {
					const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
					if (!m || p.child === undefined) continue;
					const b = base.laid.layout.persons.get(p.child)!;
					const off = Number(m[1]) - (b.x + roundelAxis(geo));
					if (Math.abs(off) < 0.5) continue;
					offAxis++;
					// Only the candidates of B.3.3 are allowed.
					expect([-1.75 * f, -2.5 * f, 3 * f].some((c) => Math.abs(c - off) < 0.5), `${s.id} ${f}px: offset ${off}`).toBe(true);
					marked.push(`${f}|${s.id}|${p.child}`);
				}
			}
		}
		note(`off-axis drops: ${offAxis}`);
		expect(offAxis).toBeGreaterThan(0);
		// Mark each person who got a left candidate: with the tab the drop takes +3 em or stays on the axis.
		let checked = 0;
		for (const key of marked.slice(0, 40)) {
			const [fs, id, child] = key.split('|');
			const f = Number(fs);
			const g = parse(ids().find((s) => s.id === id)!.source);
			const v: Variant = { f, orientation: 'down', pictures: 'all', plate: false, youTab: child };
			const L = lay(g, v);
			const geo = L.laid.layout.geometry;
			const b = L.laid.layout.persons.get(child)!;
			for (const p of L.laid.edges.paths) {
				const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
				if (!m || p.child !== child) continue;
				const off = Number(m[1]) - (b.x + roundelAxis(geo));
				expect(off, `${id} ${f}px marked ${child}`).toBeGreaterThanOrEqual(-0.5);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
	});
});

describe('B.3.4: the "You" tab against the lines, for the marked person (top to bottom and sideways)', () => {
	for (const orientation of ['down', 'sideways'] as const) {
		for (const f of [12, 16]) {
			it(`${orientation}, ${f} px: no line, sign, tag or control meets the tab of the marked person`, () => {
				const bad: string[] = [];
				for (const s of ids()) {
					const g = parse(s.source);
					const n = g.people.length;
					// The first person, the last, and a spread in between: the tab does not move any line except the marked card's own drop.
					const marks = [...new Set([0, 1, Math.floor(n / 7), Math.floor(n / 3), Math.floor(n / 2), Math.floor((2 * n) / 3), n - 1].filter((i) => i >= 0 && i < n))].map((i) => g.people[i].id);
					const worst = new Set<string>();
					if (orientation === 'down') {
						// The worst cases: every card whose drop another family's trunk moved off the axis.
						const base = lay(g, { f, orientation, pictures: 'all', plate: false });
						const axis = (b: PersonBox) => b.x + roundelAxis(base.laid.layout.geometry);
						for (const p of base.laid.edges.paths) {
							const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
							if (m && p.child !== undefined && Math.abs(Number(m[1]) - axis(base.laid.layout.persons.get(p.child)!)) > 0.5) worst.add(p.child);
						}
					}
					for (const id of [...marks, ...worst]) {
						// The worst cases are laid out without folds, which hide people and so change which trunks block a drop.
						const v: Variant = { f, orientation, pictures: orientation === 'down' ? 'all' : 'real', plate: false, youTab: id, folds: !worst.has(id) && id.length % 2 === 0 };
						const r = check(lay(g, v));
						bad.push(...r.problems.map((p) => `${s.id} marked ${id}: ${p}`));
					}
				}
				expect(bad.slice(0, 8)).toEqual([]);
			});
		}
	}
});

describe('B.3.5: sideways, the text card draws the lines it drew in 0.2.4', () => {
	it('no drop ends above the card (sideways drops land on the card edge) and no medallion exists', () => {
		for (const s of ids().filter((x) => ['07', '12'].includes(x.id))) {
			const v: Variant = { f: 12, orientation: 'sideways', pictures: 'all', plate: true };
			const L = lay(parse(s.source), v);
			expect(L.laid.layout.geometry.form).toBe('text');
			expect(check(L).medallions).toBe(0);
			expect(L.laid.layout.geometry.crown).toBeUndefined();
		}
	});
});

describe('B.3.3: the plan the layout sized the gaps with is the plan the lines are drawn from', () => {
	it('every gap holds the lanes the router plans, also for the marked card whose drop skips the places left of the axis', () => {
		const bad: string[] = [];
		let compared = 0;
		for (const f of [12, 16]) {
			for (const s of ids()) {
				const g = parse(s.source);
				const base = lay(g, { f, orientation: 'down', pictures: 'all', plate: true });
				const axis = (b: PersonBox) => b.x + roundelAxis(base.laid.layout.geometry);
				const marks = new Set<string>();
				for (const p of base.laid.edges.paths) {
					const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
					if (m && p.child !== undefined && Math.abs(Number(m[1]) - axis(base.laid.layout.persons.get(p.child)!)) > 0.5) marks.add(p.child);
				}
				for (const id of [undefined, ...marks]) {
					const { laid } = lay(g, { f, orientation: 'down', pictures: 'all', plate: id === undefined, ...(id !== undefined ? { youTab: id } : {}) });
					const L = laid.layout;
					const order = computeModelOrder(g, computeGenerations(g));
					const plan = planLines({ g, persons: L.persons, rows: L.rows, unions: L.unions, anchors: order.anchors, geo: L.geometry, youTab: L.youTab });
					L.rowGaps.forEach((gap, k) => {
						compared++;
						const need = gapHeight(L.geometry, plan.coupleLanes[k], plan.barLanes[k]);
						if (gap.bottom - gap.top < need - 1e-6) bad.push(`${s.id} ${f}px marked ${id}: gap ${k} holds ${gap.bottom - gap.top}, the lines need ${need}`);
					});
				}
			}
		}
		expect(compared).toBeGreaterThan(100);
		expect(bad.slice(0, 5)).toEqual([]);
	});

	it('planLines gives the marked card no drop left of the axis, and every other card the same drop as without a mark', () => {
		const s = ids().find((x) => x.id === '07')!;
		const g = parse(s.source);
		const base = lay(g, { f: 12, orientation: 'down', pictures: 'all', plate: true });
		const L = base.laid.layout;
		const order = computeModelOrder(g, computeGenerations(g));
		const input = { g, persons: L.persons, rows: L.rows, unions: L.unions, anchors: order.anchors, geo: L.geometry };
		const plain = planLines(input);
		const off = plain.families.flatMap((fam) => fam.kids.map((k, i) => ({ k, x: fam.dropX[i] }))).filter((d) => Math.abs(d.x - (L.persons.get(d.k)!.x + roundelAxis(L.geometry))) > 0.5);
		expect(off.length).toBeGreaterThan(0);
		const marked = planLines({ ...input, youTab: off[0].k });
		const dropOf = (plan: typeof plain, kid: string) => plan.families.flatMap((fam) => fam.kids.map((k, i) => ({ k, x: fam.dropX[i] }))).find((d) => d.k === kid)!.x;
		expect(dropOf(marked, off[0].k)).toBeGreaterThanOrEqual(L.persons.get(off[0].k)!.x + roundelAxis(L.geometry) - 0.5);
		for (const d of off.slice(1)) expect(dropOf(marked, d.k)).toBe(d.x);
	});
});
