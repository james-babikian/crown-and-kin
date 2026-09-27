import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { deriveFamilies } from '../src/core/derive';
import { hardErrorText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { routeEdges } from '../src/layout/edges';
import { NORMAL_GEOMETRY, tagTop } from '../src/layout/geometry';
import { clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import { DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS, layoutFamilies } from '../src/layout/layout';
import type { EdgeDrawing, EdgePath, FarCoupleRule, Rect, TreeLayout } from '../src/layout/model';
import { build, fixture } from './helpers';

// Review round 1 of WP1.3 (R1–R9, visual items 3.1, 4.1, 4.4) and the line invariants it asked for.

const FIXTURES = ['01', '02', '03', '04', '05', '06', '07', '08', '10', '11'];
const OPTIONS: [string, FarCoupleRule][] = [
	['2 card widths', { maxCardWidths: 2, maxGenerations: 1 }],
	['3 card widths', DEFAULT_FAR_RULE],
	['6 card widths', { maxCardWidths: 6, maxGenerations: 1 }],
];
const COUPLE = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);

function lay(src: string, far: FarCoupleRule = DEFAULT_FAR_RULE) {
	const { g, gen, order } = build(src);
	const layout = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far });
	return { g, layout, edges: routeEdges(g, layout, order.anchors) };
}

const graph = (src: string) => {
	const parsed = parseDynasty(src);
	if (!parsed.ok) throw new Error(hardErrorText(parsed.error));
	return deriveFamilies(parsed.tree);
};

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Straight segments of a path; a curve is sampled into short segments. */
function segments(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else if (cmd === 'V') {
			out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		} else {
			const [c1x, c1y, c2x, c2y, ex, ey] = n;
			let px = x;
			let py = y;
			for (let i = 1; i <= 24; i++) {
				const t = i / 24;
				const s = 1 - t;
				const qx = s * s * s * x + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t * t * t * ex;
				const qy = s * s * s * y + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t * t * t * ey;
				out.push({ x1: px, y1: py, x2: qx, y2: qy });
				px = qx;
				py = qy;
			}
			[x, y] = [ex, ey];
		}
	}
	return out;
}

function distance(px: number, py: number, s: Seg): number {
	const dx = s.x2 - s.x1;
	const dy = s.y2 - s.y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len)) : 0;
	return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

function crossesInterior(s: Seg, b: Rect): boolean {
	const e = 0.5;
	return Math.max(s.x1, s.x2) > b.x + e && Math.min(s.x1, s.x2) < b.x + b.w - e && Math.max(s.y1, s.y2) > b.y + e && Math.min(s.y1, s.y2) < b.y + b.h - e;
}

/** A line of a union: it lists both partners, or it is a far couple's line from one partner that ends at the dot. */
function belongs(p: EdgePath, partners: string[], dot: { x: number; y: number }): boolean {
	if (partners.every((x) => p.people.includes(x))) return true;
	if (!COUPLE.has(p.kind) || p.people.length !== 1 || !partners.includes(p.people[0])) return false;
	const all = segments(p.d);
	const last = all[all.length - 1];
	return !!last && Math.abs(last.x2 - dot.x) < 0.5 && Math.abs(last.y2 - dot.y) < 0.5;
}

/** Union dots that lie on a line of another union or family. */
function dotsOnForeignLines(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const r = layout.geometry.unionSize / 2;
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		if (!edges.markers.some((m) => m.kind !== 'rumour' && m.x === u.x && m.y === u.y)) continue;
		for (const p of edges.paths) {
			if (belongs(p, fu.partners, u)) continue;
			if (segments(p.d).some((s) => distance(u.x, u.y, s) <= r)) bad.push(`dot of ${fu.partners.join('+')} at ${u.x},${u.y} lies on ${p.kind} [${p.people.join(',')}]`);
		}
	}
	return bad;
}

/** Straight lines (not curves) that run along each other for part of their length. */
function overlaps(edges: EdgeDrawing, only?: (p: EdgePath) => boolean): string[] {
	const bad: string[] = [];
	const list = edges.paths.filter((p) => !p.d.includes('C') && (!only || only(p)));
	const segs = list.map((p) => segments(p.d).filter((s) => s.x1 !== s.x2 || s.y1 !== s.y2));
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			for (const a of segs[i]) {
				for (const b of segs[j]) {
					const horizontal = a.y1 === a.y2 && b.y1 === b.y2 && Math.abs(a.y1 - b.y1) < 0.5;
					const vertical = a.x1 === a.x2 && b.x1 === b.x2 && Math.abs(a.x1 - b.x1) < 0.5;
					if (!horizontal && !vertical) continue;
					const [a1, a2] = horizontal ? [a.x1, a.x2] : [a.y1, a.y2];
					const [b1, b2] = horizontal ? [b.x1, b.x2] : [b.y1, b.y2];
					const shared = Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
					if (shared > 0.5) bad.push(`${list[i].kind} [${list[i].people.join(',')}] and ${list[j].kind} [${list[j].people.join(',')}] share ${Math.round(shared)} px`);
				}
			}
		}
	}
	return bad;
}

/** Lines that pass through a far-couple tag, other than the lines of that person's far couples. */
function linesThroughTags(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const geo = layout.geometry;
	for (const tag of layout.farTags.values()) {
		const pill = { x: tag.hit.x, y: tagTop(geo, tag.y), w: tag.hit.w, h: geo.tagH };
		for (const p of edges.paths) {
			const own = COUPLE.has(p.kind) && p.people.includes(tag.person) && tag.spouses.some((s) => p.people.includes(s));
			if (own) continue;
			if (segments(p.d).some((s) => crossesInterior(s, pill))) bad.push(`${p.kind} [${p.people.join(',')}] runs through ${tag.person}'s tag`);
		}
	}
	return bad;
}

describe('line invariants over every fixture and the three far-couple options', () => {
	for (const f of FIXTURES) {
		for (const [label, rule] of OPTIONS) {
			it(`fixture ${f}, ${label}`, () => {
				const { g, layout, edges } = lay(fixture(f), rule);
				expect(dotsOnForeignLines(g, layout, edges)).toEqual([]);
				expect(overlaps(edges, (p) => COUPLE.has(p.kind))).toEqual([]);
				expect(linesThroughTags(g, layout, edges)).toEqual([]);
				// Every couple drawn with a line, and every couple with children, has its dot.
				for (const fu of g.unions) {
					const u = layout.unions.get(fu.key)!;
					const drawn = !u.far || fu.children.length > 0 || g.secondary.some((s) => s.unionKey === fu.key);
					expect(edges.markers.some((m) => m.kind !== 'rumour' && m.x === u.x && m.y === u.y), `dot of ${fu.partners.join('+')}`).toBe(drawn);
				}
			});
		}
	}
});

describe('review 1.3', () => {
	it('R1: a near couple one generation apart in a one-column tree does not throw, and its leg misses every card', () => {
		const src = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B, parents: [a]}\nunions:\n  - partners: [a, b]\n';
		const { layout, edges } = lay(src);
		const a = layout.persons.get('a')!;
		const b = layout.persons.get('b')!;
		for (const p of edges.paths.filter((p) => COUPLE.has(p.kind))) {
			for (const s of segments(p.d)) {
				expect(crossesInterior(s, a)).toBe(false);
				expect(crossesInterior(s, b)).toBe(false);
			}
		}
		// The route around the end of the row stays inside the drawing.
		for (const p of edges.paths) for (const s of segments(p.d)) expect(Math.max(s.x1, s.x2)).toBeLessThanOrEqual(layout.width);
	});

	it('R2: double-cousin couples: no leg runs through the other couple\'s dot, and no two legs lie on each other', () => {
		const src = `
people:
  - {id: x1, name: X1}
  - {id: x2, name: X2}
  - {id: y1, name: Y1}
  - {id: y2, name: Y2}
  - {id: p, name: P, parents: [x1, x2]}
  - {id: q, name: Q, parents: [x1, x2]}
  - {id: r, name: R, parents: [y1, y2]}
  - {id: s, name: S, parents: [y1, y2]}
  - {id: k1, name: K1, parents: [p, r]}
  - {id: k2, name: K2, parents: [q, s]}
`;
		const { g, layout, edges } = lay(src);
		expect(g.unions.filter((u) => !layout.unions.get(u.key)!.bar && !layout.unions.get(u.key)!.far)).toHaveLength(2);
		expect(dotsOnForeignLines(g, layout, edges)).toEqual([]);
		expect(overlaps(edges, (p) => COUPLE.has(p.kind))).toEqual([]);
	});

	it('R2: with a loose rule, fixture 7 still has no dot on a foreign line and no overlapping couple lines', () => {
		const { g, layout, edges } = lay(fixture('07'), { maxCardWidths: 8, maxGenerations: 1 });
		expect(dotsOnForeignLines(g, layout, edges)).toEqual([]);
		expect(overlaps(edges, (p) => COUPLE.has(p.kind))).toEqual([]);
	});

	it('R3: the cache misses when a child changes from birth to adoptive parents', () => {
		clearLayoutCache();
		const birth = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a, b]}\n';
		const adopt = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [{id: a, type: adoptive}, {id: b, type: adoptive}]}\n';
		layoutTree(graph(birth), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'Inter');
		const cached = layoutTree(graph(adopt), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'Inter');
		clearLayoutCache();
		const fresh = layoutTree(graph(adopt), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'Inter');
		expect(cached.edges.paths.map((p) => p.kind)).toEqual(fresh.edges.paths.map((p) => p.kind));
	});

	it('R4: results are read-only, and a caller cannot change later results', () => {
		clearLayoutCache();
		const src = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a, b]}\n';
		const first = layoutTree(graph(src), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'Inter');
		const x = first.layout.persons.get('c')!.x;
		expect(() => {
			first.layout.persons.get('c')!.x = 9999;
		}).toThrow();
		expect(() => first.layout.persons.delete('c')).toThrow();
		expect(() => first.edges.paths.push({ d: '', kind: 'descent', people: [] })).toThrow();
		expect(first.layout.geometry).not.toBe(NORMAL_GEOMETRY);
		expect(layoutTree(graph(src), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'Inter').layout.persons.get('c')!.x).toBe(x);
	});

	it('R5: a leg never shares a segment with a line leaving the same card', () => {
		// A has a child C by A alone and a childless union with their other child B.
		const src = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B, parents: [a]}\n  - {id: c, name: C, parents: [a]}\nunions:\n  - partners: [a, b]\n';
		const { edges } = lay(src);
		expect(edges.paths.some((p) => p.kind === 'marriage')).toBe(true);
		expect(overlaps(edges)).toEqual([]);
	});

	it('R6: a far tag does not sit on a line that leaves the same card', () => {
		// P has a far wife W (three generations down) and a child C by P alone.
		const src = `
people:
  - {id: p, name: P}
  - {id: c, name: C, parents: [p]}
  - {id: g, name: G, parents: [c]}
  - {id: w, name: W, parents: [g]}
unions:
  - partners: [p, w]
`;
		const { g, layout, edges } = lay(src);
		expect(layout.farTags.has('p')).toBe(true);
		expect(linesThroughTags(g, layout, edges)).toEqual([]);
		expect(overlaps(edges)).toEqual([]);
	});

	it('N1: a couple trunk does not run on into a half-sibling drop', () => {
		// P0 and P1 have P2; each also has a child alone (P5 by P0, P3 by P1). Seed 247 of the review fuzz.
		const src = 'people:\n  - {id: p0, name: P0}\n  - {id: p1, name: P1}\n  - {id: p2, name: P2, parents: [p0, p1]}\n  - {id: p3, name: P3, parents: [p1]}\n  - {id: p4, name: P4}\n  - {id: p5, name: P5, parents: [p0]}\n';
		const { g, layout, edges } = lay(src);
		const fu = g.unions.find((u) => u.partners.includes('p0') && u.partners.includes('p1'))!;
		const trunk = edges.paths.find((e) => e.people.join() === [...fu.partners, 'p2'].join())!;
		const drop = edges.paths.find((e) => e.people[0] === 'p5')!;
		expect(overlaps({ paths: [trunk, drop], markers: [] })).toEqual([]);
		expect(overlaps(edges)).toEqual([]);
		expect(dotsOnForeignLines(g, layout, edges)).toEqual([]);
	});

	it('N2: a far couple line does not start inside the tag of its own card', () => {
		const src = `
people:
  - {id: f, name: F}
  - {id: m, name: M}
  - {id: varian, name: Varian, parents: [f, m]}
  - {id: bran, name: Bran, parents: [f, m]}
  - {id: bw, name: BW}
  - {id: c1, name: C1, parents: [bran, bw]}
  - {id: c1w, name: C1W}
  - {id: n1, name: N1, parents: [c1, c1w]}
  - {id: k1, name: K1, parents: [varian, n1]}
`;
		const { g, layout, edges } = lay(src);
		const tag = layout.farTags.get('varian')!;
		const leg = edges.paths.find((e) => COUPLE.has(e.kind) && e.people.includes('varian'))!;
		// Supervisor decision: the far couple's line lists only the anchor partner.
		expect(leg.people).toHaveLength(1);
		const x = Number(leg.d.match(/^M([\d.]+)/)![1]);
		expect(x > tag.hit.x && x < tag.hit.x + tag.hit.w, `leg ${leg.d}, tag ${tag.hit.x}..${tag.hit.x + tag.hit.w}`).toBe(false);
		expect(linesThroughTags(g, layout, edges)).toEqual([]);
	});

	it('N3: more than 8 overlapping couple runs in one gap each get a lane', () => {
		const ppl = ['people:', '  - {id: x1, name: X1}', '  - {id: x2, name: X2}', '  - {id: y1, name: Y1}', '  - {id: y2, name: Y2}'];
		for (let i = 0; i < 9; i++) ppl.push(`  - {id: p${i}, name: P${i}, parents: [x1, x2]}`);
		for (let i = 0; i < 9; i++) ppl.push(`  - {id: q${i}, name: Q${i}, parents: [y1, y2]}`);
		for (let i = 0; i < 9; i++) ppl.push(`  - {id: k${i}, name: K${i}, parents: [p${i}, q${i}]}`);
		const { g, layout, edges } = lay(ppl.join('\n') + '\n', { maxCardWidths: 20, maxGenerations: 1 });
		const ys = [...layout.unions.values()].filter((u) => !u.bar).map((u) => u.y);
		expect(ys.length).toBe(9);
		expect(new Set(ys).size, `dot heights ${ys.join(' ')}`).toBe(ys.length);
		expect(dotsOnForeignLines(g, layout, edges)).toEqual([]);
		expect(overlaps(edges)).toEqual([]);
	});

	it('R9: a loose far rule does not share a cache key with another', () => {
		const g = graph(fixture('01'));
		const key = (v: number) => layoutKey(g, NORMAL_GEOMETRY, { sweeps: 4, far: { maxCardWidths: v, maxGenerations: 1 } }, 'Inter');
		expect(new Set([key(Infinity), key(-Infinity), key(NaN), key(0)]).size).toBe(4);
	});

	it('visual 3.1: side links clear the cards of their own parents', () => {
		for (const f of FIXTURES) {
			const { layout, edges } = lay(fixture(f));
			for (const p of edges.paths.filter((p) => p.d.includes('C'))) {
				for (const id of p.people.slice(0, -1)) {
					const b = layout.persons.get(id)!;
					expect(segments(p.d).some((s) => crossesInterior(s, b)), `fixture ${f}: ${p.kind} [${p.people.join(',')}] crosses ${id}`).toBe(false);
				}
			}
		}
	});

	it('visual 6: the "?" of a rumoured parent sits clear of every other line and every dot', () => {
		for (const f of ['04', '07', '08']) {
			const { edges } = lay(fixture(f));
			const rumours = edges.markers.filter((m) => m.kind === 'rumour');
			expect(rumours.length).toBeGreaterThan(0);
			for (const m of rumours) {
				// Its own curve passes through it.
				const others = edges.paths.filter((p) => !(p.kind === 'rumoured' && segments(p.d).some((s) => distance(m.x, m.y, s) < 1)));
				for (const s of others.flatMap((p) => segments(p.d))) expect(distance(m.x, m.y, s), `fixture ${f}: marker at ${m.x},${m.y}`).toBeGreaterThan(8);
				for (const d of edges.markers) if (d !== m) expect(Math.hypot(m.x - d.x, m.y - d.y), `fixture ${f}: marker at ${m.x},${m.y}`).toBeGreaterThan(12);
			}
		}
	});

	it('visual 4.4: a tag may use most of the card width', () => {
		const { layout } = lay(fixture('03'), { maxCardWidths: 2, maxGenerations: 1 });
		// Lisette has no other line leaving her card: her tag may use all but a small margin.
		const lisette = layout.farTags.get('lisette')!;
		expect(lisette.hit.w).toBeGreaterThanOrEqual(NORMAL_GEOMETRY.cardW - NORMAL_GEOMETRY.fontPx);
	});
});
