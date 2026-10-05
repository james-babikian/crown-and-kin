import { describe, expect, it } from 'vitest';
import { routeEdges } from '../src/layout/edges';
import { geometryFor, lineMetrics, MIN_HIT, sideTagDepth, sidewaysGeometry, tagTop, turnedGeometry } from '../src/layout/geometry';
import { clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import { sideTagHit } from '../src/layout/layout';
import { measureLayout } from '../scripts/metrics';
import type { FarCoupleRule, LayoutSettings } from '../src/layout/model';
import { turnPath } from '../src/layout/turn';
import { build, fixture } from './helpers';
import { lineProblems, randomTree } from './random-trees';

// WP5.5a internals: the turned frame, exits on a card's short edge, tags between stacked cards.

const GEO = geometryFor(16, 'normal');
const DEFAULT: FarCoupleRule = { maxCardWidths: 3, maxGenerations: 1 };
const TIGHT: FarCoupleRule = { maxCardWidths: 0, maxGenerations: 0 };
const LOOSE: FarCoupleRule = { maxCardWidths: Infinity, maxGenerations: Infinity };
const side = (far: FarCoupleRule = DEFAULT, extra: Partial<LayoutSettings> = {}): LayoutSettings => ({ sweeps: 4, far, orientation: 'sideways', ...extra });

function lay(src: string, settings: LayoutSettings, geo = GEO) {
	const { g } = build(src);
	return { g, ...layoutTree(g, geo, settings, 'test') };
}

/** Straight horizontal pieces of a path. */
function horizontals(d: string): { x1: number; x2: number; y: number }[] {
	const out: { x1: number; x2: number; y: number }[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push({ x1: Math.min(x, n[0]), x2: Math.max(x, n[0]), y });
			x = n[0];
		} else if (cmd === 'V') y = n[0];
		else [x, y] = [n[4], n[5]];
	}
	return out;
}

const MANY = `people:
  - {id: p, name: P, sex: m}
${[1, 2, 3, 4, 5, 6].map((i) => `  - {id: w${i}, name: W${i}, sex: f}\n  - {id: c${i}, name: C${i}, parents: [p, w${i}]}`).join('\n')}
  - {id: s, name: S, parents: [p]}
  - {id: r, name: R, parents: [w6, {id: p, type: rumoured}]}
  - {id: k, name: K, parents: [w5, {id: p, type: ward}]}
unions:
${[1, 2, 3, 4, 5, 6].map((i) => `  - {partners: [p, w${i}]}`).join('\n')}
`;

describe('turned frame', () => {
	it('turnPath swaps x and y in M, H, V and C commands', () => {
		expect(turnPath('M1 2V3H4M5 6C7 8 9 10 11 12')).toBe('M2 1H3V4M6 5C8 7 10 9 12 11');
		const d = 'M10.5 20V30.5H40C40 50 60 50 60 70';
		expect(turnPath(turnPath(d))).toBe(d);
	});

	it('sideways geometry: normal cards keep their size, narrow cards are 10.25 em, gaps take the sideways sizes', () => {
		const normal = sidewaysGeometry(GEO, 'normal');
		expect([normal.cardW, normal.cardH, normal.rowGap, normal.nodeGap, normal.coupleGap]).toEqual([180, 61, 56, 24, 24]);
		const narrow = sidewaysGeometry(GEO, 'narrow');
		expect([narrow.cardW, narrow.rowGap]).toEqual([164, 48]);
		// Compact cards are already narrower than 10.25 em.
		expect(sidewaysGeometry(geometryFor(16, 'compact'), 'narrow').cardW).toBe(geometryFor(16, 'compact').cardW);
		const turned = turnedGeometry(normal);
		expect([turned.cardW, turned.cardH, turned.tagH]).toEqual([61, 180, 6]);
		// The first couple lane sits just clear of the card edge: no tag hangs into the gap between columns.
		expect(lineMetrics(turned).coupleLane0).toBeLessThan(lineMetrics(GEO).coupleLane0);
	});

	it('routing a finished sideways layout again gives the same lines', () => {
		const { g, order } = build(fixture('07'));
		const { layout, edges } = layoutTree(g, GEO, side(), 'test');
		expect(routeEdges(g, layout, order.anchors)).toEqual(edges);
	});

	it('the cache key ignores card width for down, and an absent orientation is down', () => {
		const { g } = build(fixture('01'));
		const key = (s: LayoutSettings) => layoutKey(g, GEO, s, 'x');
		expect(key({ sweeps: 4, far: DEFAULT })).toBe(key({ sweeps: 4, far: DEFAULT, orientation: 'down', sidewaysCards: 'narrow' }));
		expect(key(side())).toBe(key(side(DEFAULT, { sidewaysCards: 'normal' })));
		expect(key(side())).not.toBe(key(side(DEFAULT, { sidewaysCards: 'narrow' })));
	});
});

describe('lines leave a sideways card from its right edge', () => {
	it('seven lines from one card: each on the edge, 0.5 em clear of the corners, apart from each other', () => {
		const { layout, edges } = lay(MANY, side(LOOSE));
		const p = layout.persons.get('p')!;
		const starts = edges.paths
			.map((e) => e.d.match(/^M([-\d.]+) ([-\d.]+)/)!)
			.map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
			.filter((s) => Math.abs(s.x - (p.x + p.w)) < 0.2 && s.y > p.y - 1 && s.y < p.y + p.h + 1);
		const ys = [...new Set(starts.map((s) => s.y))].sort((a, b) => a - b);
		// Four legs to wives not beside him, the single-parent trunk, the ward and the rumour.
		expect(ys).toHaveLength(7);
		expect(ys[0]).toBeGreaterThanOrEqual(p.y + 8 - 0.1);
		expect(ys[ys.length - 1]).toBeLessThanOrEqual(p.y + p.h - 8 + 0.1);
		for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(7);
		expect(lineProblems(build(MANY).g, layout, edges)).toEqual([]);
	});

	it('crowded edges keep lines off dots and other trunks (random trees 639 and 794)', () => {
		expect(lineProblems(...pick(lay(randomTree(639), side(LOOSE))))).toEqual([]);
		expect(lineProblems(...pick(lay(randomTree(794), side(TIGHT), geometryFor(12, 'compact'))))).toEqual([]);
	});

	it('no line leaves a card from its top or bottom edge except a bar between stacked partners', () => {
		for (const f of ['02', '06', '07', '08']) {
			const { g, layout, edges } = lay(fixture(f), side());
			for (const e of edges.paths) {
				const [, x, y] = e.d.match(/^M([-\d.]+) ([-\d.]+)/)!.map(Number);
				for (const b of layout.persons.values()) {
					const onTopOrBottom = (Math.abs(y - b.y) < 0.2 || Math.abs(y - b.y - b.h) < 0.2) && x > b.x + 0.5 && x < b.x + b.w - 0.5;
					if (!onTopOrBottom) continue;
					const bar = g.unions.some((u) => layout.unions.get(u.key)!.bar && u.partners.includes(b.id) && Math.abs(layout.unions.get(u.key)!.x - x) < 0.2);
					expect(bar, `fixture ${f}: ${e.kind} [${e.people}] leaves ${b.id} at ${x},${y}`).toBe(true);
				}
			}
		}
	});
});

function pick(l: ReturnType<typeof lay>) {
	return [l.g, l.layout, l.edges] as const;
}

describe('far tags between stacked cards', () => {
	it('sideTagHit hangs from the card edge and is 44 px deep at 14 px names', () => {
		const geo = sidewaysGeometry(GEO, 'normal');
		// 44 × 16 / 14 = 50.3, rounded up.
		expect(sideTagDepth(geo)).toBe(51);
		expect(sideTagHit({ x: 90, w: 164 }, 100, Infinity, geo)).toEqual({ x: 8, y: 100, w: 164, h: 51 });
		// Never less than 44 layout px, at the smallest font.
		const small = sidewaysGeometry(geometryFor(8, 'compact'), 'normal');
		expect(sideTagDepth(small)).toBe(MIN_HIT);
	});

	it('the gap below a tagged card holds the whole hit area and one routed leg (sample tree 7)', () => {
		const m = lineMetrics(GEO);
		const { layout } = lay(fixture('07'), side());
		expect(layout.farTags.size).toBeGreaterThan(20);
		for (const t of layout.farTags.values()) {
			const b = layout.persons.get(t.person)!;
			const col = layout.rows[b.gen];
			const next = col[col.indexOf(t.person) + 1];
			expect(t.hit.y + t.hit.h).toBeCloseTo(b.y + b.h + sideTagDepth(layout.geometry), 6);
			if (next) expect(layout.persons.get(next)!.y - (b.y + b.h)).toBeGreaterThanOrEqual(sideTagDepth(layout.geometry) + m.exitStep - 0.01);
		}
	});

	it('at 8 and 9 px fonts a tag beside a stacked partner keeps a 44 px zone: the bar moves right, inside the card', () => {
		const src = `people:
  - {id: r1, name: R1}
  - {id: r2, name: R2}
  - {id: s1, name: S1}
  - {id: s2, name: S2}
  - {id: x, name: X, sex: m, parents: [r1, r2]}
${[2, 3, 4, 5, 6, 7].map((i) => `  - {id: x${i}, name: X${i}, parents: [r1, r2]}`).join('\n')}
  - {id: z, name: Z, sex: f}
  - {id: y, name: Y, sex: f, parents: [s1, s2]}
${[2, 3, 4, 5, 6, 7].map((i) => `  - {id: y${i}, name: Y${i}, parents: [s1, s2]}`).join('\n')}
unions:
  - {partners: [r1, r2]}
  - {partners: [s1, s2]}
  - {partners: [x, z]}
  - {partners: [x, y]}
`;
		for (const [px, size, cards] of [[9, 'compact', 'normal'], [8, 'compact', 'normal'], [8, 'normal', 'narrow'], [16, 'normal', 'narrow']] as const) {
			const { g, layout, edges } = lay(src, side(DEFAULT, { sidewaysCards: cards }), geometryFor(px, size));
			const t = layout.farTags.get('x')!;
			const card = layout.persons.get('x')!;
			const u = layout.unions.get(g.unions.find((fu) => fu.partners.includes('z'))!.key)!;
			expect(u.bar).toBe(true);
			expect(t.hit.w).toBeGreaterThanOrEqual(MIN_HIT);
			expect(t.hit.x).toBeGreaterThanOrEqual(card.x);
			expect(t.hit.x + t.hit.w).toBeLessThanOrEqual(u.x - layout.geometry.unionSize / 2);
			expect(u.x).toBeLessThan(card.x + card.w);
			expect(t.x).toBeLessThan(card.x + card.w / 2);
			expect(lineProblems(g, layout, edges)).toEqual([]);
		}
	});

	it('a line that crosses a column below a tagged card passes below the tag, clear of it and of the next card', () => {
		const m = lineMetrics(GEO);
		let seen = 0;
		for (let seed = 1; seed <= 150; seed++) {
			const { layout, edges } = lay(randomTree(seed), side(TIGHT));
			const geo = layout.geometry;
			for (const t of layout.farTags.values()) {
				const b = layout.persons.get(t.person)!;
				const col = layout.rows[b.gen];
				const next = col[col.indexOf(t.person) + 1];
				const nextTop = next ? layout.persons.get(next)!.y : Infinity;
				for (const e of edges.paths) {
					for (const h of horizontals(e.d)) {
						// Lines across the whole column; a stacked couple's own trunk leaves its dot beside a left-half tag.
						if (!(h.x1 < b.x && h.x2 > b.x + b.w && h.y > b.y + b.h && h.y < nextTop)) continue;
						seen++;
						expect(h.y, `seed ${seed}: ${e.kind} [${e.people}] under ${t.person}'s tag`).toBeGreaterThanOrEqual(tagTop(geo, t.y) + geo.tagH + m.exitStep / 2 - 0.1);
						expect(nextTop - h.y).toBeGreaterThanOrEqual(m.exitStep / 2 - 0.1);
					}
				}
			}
		}
		expect(seen).toBeGreaterThan(20);
	});

	it('the far distance keeps its length in px: the rule is 3 down card widths along the column', () => {
		// Two partners in one column: a couple whose children sit far apart only through the rule.
		for (const f of ['03', '06', '07']) {
			const { g, layout } = lay(fixture(f), side());
			for (const u of g.unions) {
				const [a, b] = u.partners.map((p) => layout.persons.get(p)!);
				if (!layout.unions.get(u.key)!.far || Math.abs(a.gen - b.gen) > 1) continue;
				expect(Math.abs(a.y + a.h / 2 - (b.y + b.h / 2))).toBeGreaterThan(3 * GEO.cardW);
			}
		}
	});
});

describe('measurements and markers sideways', () => {
	it('measureLayout reads positions along the column: no sibling order errors, the same crossings as down', () => {
		for (const f of ['02', '06', '07', '08']) {
			const { g } = build(fixture(f));
			clearLayoutCache();
			const down = measureLayout(g, layoutTree(g, GEO, { sweeps: 4, far: DEFAULT }, 'x').layout);
			const sw = measureLayout(g, layoutTree(g, GEO, side(), 'x').layout);
			expect(sw.siblingOrderViolations).toBe(0);
			expect(sw.generations).toBe(down.generations);
			expect(sw.crossings).toBe(0);
		}
	});

	it('the "?" of a rumoured parent sits clear of every other line', () => {
		for (const f of ['04', '07', '08']) {
			const { layout, edges } = lay(fixture(f), side());
			const segs = (d: string) => {
				const pts: { x: number; y: number }[] = [];
				let x = 0;
				let y = 0;
				for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
					const n = args.trim().split(' ').map(Number);
					if (cmd === 'M') [x, y] = n;
					else if (cmd === 'H') for (let i = 0; i <= 20; i++) pts.push({ x: x + ((n[0] - x) * i) / 20, y });
					else if (cmd === 'V') for (let i = 0; i <= 20; i++) pts.push({ x, y: y + ((n[0] - y) * i) / 20 });
					if (cmd === 'H') x = n[0];
					else if (cmd === 'V') y = n[0];
					else if (cmd === 'C') [x, y] = [n[4], n[5]];
				}
				return pts;
			};
			expect(layout.orientation).toBe('sideways');
			for (const mk of edges.markers.filter((m) => m.kind === 'rumour')) {
				for (const e of edges.paths.filter((p) => p.kind !== 'rumoured')) {
					for (const pt of segs(e.d)) expect(Math.hypot(pt.x - mk.x, pt.y - mk.y), `fixture ${f}: ${e.kind} [${e.people}]`).toBeGreaterThan(4);
				}
			}
		}
	});
});
