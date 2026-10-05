import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { hardErrorText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { routeEdges } from '../src/layout/edges';
import { cardText, gapHeight, geometryFor, laneStep, lineMetrics, MIN_HIT, NORMAL_GEOMETRY, tagTop } from '../src/layout/geometry';
import { clearLayoutCache, LAYOUT_CACHE_SIZE, layoutTree } from '../src/layout/index';
import { DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS, isFarCouple, layoutFamilies } from '../src/layout/layout';
import type { EdgeDrawing, FarCoupleRule, Geometry, LayoutSettings, PersonBox, Rect, TreeLayout } from '../src/layout/model';
import { build, fixture } from './helpers';

const FIXTURES = ['01', '02', '03', '04', '06', '07', '08', '11'];
const LOOSE: FarCoupleRule = { maxCardWidths: Infinity, maxGenerations: Infinity };

function lay(source: string, far: FarCoupleRule = DEFAULT_FAR_RULE, geo: Geometry = NORMAL_GEOMETRY) {
	const { g, gen, order } = build(source);
	const layout = layoutFamilies(g, gen, order, geo, { sweeps: 4, far });
	return { g, layout, edges: routeEdges(g, layout, order.anchors) };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Straight segments of a path made of M, H and V commands. */
function segments(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHV])([^MHVC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else {
			out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		}
	}
	return out;
}

/** True when an axis-parallel segment passes through the open interior of a card. */
function crossesInterior(s: Seg, b: Rect): boolean {
	const e = 0.5;
	const [minX, maxX] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
	const [minY, maxY] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
	return maxX > b.x + e && minX < b.x + b.w - e && maxY > b.y + e && minY < b.y + b.h - e;
}

/** Couple and descent lines (not the curved side links) that pass behind a card. */
function cardCrossings(layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	for (const p of edges.paths) {
		if (p.d.includes('C')) continue;
		for (const s of segments(p.d)) {
			for (const b of layout.persons.values()) {
				if (crossesInterior(s, b)) bad.push(`${p.kind} [${p.people.join(',')}] crosses ${b.id}`);
			}
		}
	}
	return bad;
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Varian (generation 1) marries two of his great-nieces (generation 3), who are in different blocks.
const GREAT_UNCLE = `
people:
  - {id: f, name: F}
  - {id: m, name: M}
  - {id: varian, name: Varian, parents: [f, m]}
  - {id: bran, name: Bran, parents: [f, m]}
  - {id: bw, name: Bran's wife}
  - {id: c1, name: C1, parents: [bran, bw]}
  - {id: c2, name: C2, parents: [bran, bw]}
  - {id: c1w, name: C1's wife}
  - {id: c2w, name: C2's wife}
  - {id: n1, name: N1, parents: [c1, c1w]}
  - {id: n2, name: N2, parents: [c2, c2w]}
  - {id: k1, name: K1, parents: [varian, n1]}
  - {id: k2, name: K2, parents: [varian, n2]}
unions:
  - partners: [f, m]
  - partners: [bran, bw]
  - partners: [c1, c1w]
  - partners: [c2, c2w]
  - partners: [varian, n1]
  - partners: [varian, n2]
`;

describe('geometryFor', () => {
	it('matches the cards at the default 16 px font (card height 61 px since 0.2.4, D117)', () => {
		expect(geometryFor(16, 'normal')).toMatchObject({ fontPx: 16, cardSize: 'normal', cardW: 180, cardH: 61, unionSize: 10, coupleGap: 36, nodeGap: 20, rowGap: 100 });
		expect(NORMAL_GEOMETRY).toEqual(geometryFor(16, 'normal'));
	});

	it('scales with the font size', () => {
		const big = geometryFor(32, 'normal');
		expect(big.cardW).toBe(360);
		expect(big.cardH).toBe(122);
		expect(big.rowGap).toBe(200);
		expect(geometryFor(12, 'normal').cardW).toBe(135);
	});

	it('makes compact cards smaller than normal ones at the same font', () => {
		for (const f of [12, 16, 20]) {
			const n = geometryFor(f, 'normal');
			const c = geometryFor(f, 'compact');
			expect(c.cardSize).toBe('compact');
			expect(c.cardW).toBeLessThan(n.cardW);
			expect(c.cardH).toBeLessThan(n.cardH);
			expect(c.rowGap).toBe(n.rowGap);
		}
	});

	it('falls back to 16 px for a missing or silly font size', () => {
		expect(geometryFor(NaN, 'normal').fontPx).toBe(16);
		expect(geometryFor(0, 'normal').fontPx).toBe(16);
		expect(geometryFor(1000, 'normal').fontPx).toBe(48);
	});

	for (const size of ['normal', 'compact'] as const) {
		for (const f of [10, 14, 16, 18, 24, 32]) {
			it(`${size} ${f} px: name, title and dates fit inside the card`, () => {
				const geo = geometryFor(f, size);
				const t = cardText(geo);
				// D117: one size for all card text.
				expect(t.nameSize).toBeCloseTo(0.85 * f);
				expect(t.smallSize).toBeCloseTo(0.85 * f);
				// Top of the name's capitals and bottom of the dates' descenders stay inside.
				expect(t.nameBaseline - 0.75 * t.nameSize).toBeGreaterThan(0);
				expect(t.datesBaseline + 0.25 * t.smallSize).toBeLessThan(geo.cardH);
				expect(t.titleBaseline).toBeGreaterThan(t.nameBaseline);
				expect(t.datesBaseline).toBeGreaterThan(t.titleBaseline);
				expect(t.textW).toBeGreaterThan(0.5 * geo.cardW);
			});

			it(`${size} ${f} px: a gap between rows holds a tag, its couple lanes and its sibling-bar lanes`, () => {
				const geo = geometryFor(f, size);
				const m = lineMetrics(geo);
				expect(m.coupleLane0 - geo.unionSize / 2).toBeGreaterThan(tagTop(geo, 0) + geo.tagH);
				expect(gapHeight(geo, 1, 1)).toBe(geo.rowGap);
				for (const [couples, bars] of [[1, 4], [3, 2], [8, 4]]) {
					const h = gapHeight(geo, couples, bars);
					const lowestDot = m.coupleLane0 + (couples - 1) * m.coupleLaneStep + geo.unionSize / 2;
					const highestBar = h - m.barDrop - (bars - 1) * laneStep(geo);
					expect(lowestDot + m.clearance).toBeLessThanOrEqual(highestBar + 1e-9);
				}
			});
		}
	}
});

describe('far couples (D10)', () => {
	const box = (x: number, gen: number): PersonBox => ({ id: String(x), x, y: gen * 154, w: 180, h: 64, gen });

	it('measures card centre to card centre, in card widths', () => {
		const rule = { maxCardWidths: 3, maxGenerations: 1 };
		expect(isFarCouple(box(0, 1), box(540, 1), false, false, rule)).toBe(false);
		expect(isFarCouple(box(0, 1), box(541, 1), false, false, rule)).toBe(true);
	});

	it('counts generations apart', () => {
		const rule = { maxCardWidths: 3, maxGenerations: 1 };
		expect(isFarCouple(box(0, 1), box(0, 2), false, false, rule)).toBe(false);
		expect(isFarCouple(box(0, 1), box(0, 3), false, false, rule)).toBe(true);
	});

	it('never makes partners in the same block or side by side far', () => {
		const rule = { maxCardWidths: 0, maxGenerations: 0 };
		expect(isFarCouple(box(0, 1), box(2000, 3), true, false, rule)).toBe(false);
		expect(isFarCouple(box(0, 1), box(216, 1), false, true, rule)).toBe(false);
	});

	it('fixture 3: the cousins are near with the spec default and far with a 2-card rule', () => {
		const key = (g: ReturnType<typeof lay>['g']) => g.unionsOf.get('conrad')!.find((k) => g.unionByKey.get(k)!.partners.includes('lisette'))!;
		const near = lay(fixture('03'));
		expect(near.layout.unions.get(key(near.g))!.far).toBe(false);
		expect(near.layout.farTags.size).toBe(0);

		const far = lay(fixture('03'), { maxCardWidths: 2, maxGenerations: 1 });
		const u = far.layout.unions.get(key(far.g))!;
		expect(u.far).toBe(true);
		expect(u.bar).toBe(false);
		expect(far.layout.farTags.get('conrad')!.spouses).toEqual(['lisette']);
		expect(far.layout.farTags.get('lisette')!.spouses).toEqual(['conrad']);

		// Only the anchor's short drop to the union dot remains; nothing reaches Lisette.
		const couple = far.edges.paths.filter((p) => p.kind === 'marriage' && p.people.includes('conrad'));
		expect(couple.map((p) => p.people)).toEqual([['conrad']]);
		expect(couple).toHaveLength(1);
		const conrad = far.layout.persons.get('conrad')!;
		const [s] = segments(couple[0].d);
		expect(s.y1).toBe(conrad.y + conrad.h);
		expect(s.x1).toBe(u.x);
		expect(u.x).toBeGreaterThan(conrad.x);
		expect(u.x).toBeLessThan(conrad.x + conrad.w);
		// Tristan still hangs from the dot.
		const trunk = far.edges.paths.find((p) => p.kind === 'descent' && p.people.join() === 'conrad,lisette,tristan')!;
		expect(trunk.d.startsWith(`M${u.x} ${u.y}`)).toBe(true);
	});

	it('the far rule moves no card sideways (rows only get the height their lines need)', () => {
		for (const f of ['03', '06', '07']) {
			const a = lay(fixture(f), { maxCardWidths: 0, maxGenerations: 0 }).layout;
			const b = lay(fixture(f), LOOSE).layout;
			for (const [id, p] of a.persons) expect(p.x).toBe(b.persons.get(id)!.x);
		}
	});

	it('one tag per person, listing several far spouses in union order', () => {
		const { layout, edges } = lay(GREAT_UNCLE, { maxCardWidths: 100, maxGenerations: 1 });
		expect(layout.persons.get('varian')!.gen).toBe(1);
		expect(layout.persons.get('n1')!.gen).toBe(3);
		expect(layout.farTags.get('varian')!.spouses).toEqual(['n1', 'n2']);
		expect(layout.farTags.get('n1')!.spouses).toEqual(['varian']);
		expect(layout.farTags.get('n2')!.spouses).toEqual(['varian']);
		expect([...layout.farTags.keys()].sort()).toEqual(['n1', 'n2', 'varian']);
		expect(cardCrossings(layout, edges)).toEqual([]);
	});

	it('a far couple without children gets tags but no dot', () => {
		const src = `
people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: c, name: C}
  - {id: x, name: X, parents: [a, b]}
  - {id: y, name: Y, parents: [a, b]}
  - {id: z, name: Z, parents: [a, b]}
unions:
  - partners: [a, b]
  - partners: [x, z]
`;
		const { g, layout, edges } = lay(src, { maxCardWidths: 1.5, maxGenerations: 1 });
		const u = layout.unions.get(g.unionsOf.get('x')![0])!;
		expect(u.far).toBe(true);
		expect(edges.markers.some((m) => m.x === u.x && m.y === u.y)).toBe(false);
		expect(edges.paths.some((p) => p.people.join() === 'x,z')).toBe(false);
		expect(layout.farTags.get('x')!.spouses).toEqual(['z']);
	});

	it('tags hang from the card bottom with hit areas of at least 44×44 px that do not overlap', () => {
		for (const geo of [NORMAL_GEOMETRY, geometryFor(12, 'compact'), geometryFor(24, 'normal')]) {
			const { layout } = lay(fixture('07'), { maxCardWidths: 0, maxGenerations: 0 }, geo);
			const tags = [...layout.farTags.values()];
			expect(tags.length).toBeGreaterThan(30);
			for (const t of tags) {
				const card = layout.persons.get(t.person)!;
				expect(t.hit.x).toBeGreaterThanOrEqual(card.x);
				expect(t.hit.x + t.hit.w).toBeLessThanOrEqual(card.x + card.w);
				expect(t.y).toBe(card.y + card.h);
				expect(t.hit.w).toBeGreaterThanOrEqual(MIN_HIT);
				expect(t.hit.h).toBeGreaterThanOrEqual(MIN_HIT);
				// The visible pill is inside the hit area.
				expect(t.hit.y).toBeLessThanOrEqual(tagTop(geo, t.y));
				expect(t.hit.y + t.hit.h).toBeGreaterThanOrEqual(tagTop(geo, t.y) + geo.tagH);
				// Mostly below the card, so the card keeps most of its own tap area.
				expect(card.y + card.h - t.hit.y).toBeLessThan(card.h / 4);
				// Clear of the next row's cards.
				expect(t.hit.y + t.hit.h).toBeLessThan(card.y + card.h + geo.rowGap);
			}
			for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) expect(overlap(tags[i].hit, tags[j].hit)).toBe(false);
			// The drawing's height includes tags under the last row.
			for (const t of tags) expect(layout.height).toBeGreaterThanOrEqual(tagTop(geo, t.y) + geo.tagH);
		}
	});
});

describe('lines never pass behind cards', () => {
	for (const f of FIXTURES) {
		for (const [label, far] of [['default rule', DEFAULT_FAR_RULE], ['loose rule', LOOSE]] as const) {
			it(`fixture ${f}, ${label}`, () => {
				const { layout, edges } = lay(fixture(f), far);
				expect(cardCrossings(layout, edges)).toEqual([]);
			});
		}
		it(`fixture ${f}, compact cards at 12 px`, () => {
			const { layout, edges } = lay(fixture(f), LOOSE, geometryFor(12, 'compact'));
			expect(cardCrossings(layout, edges)).toEqual([]);
		});
	}

	it('fixture 7: the uncle–niece leg no longer runs behind the niece', () => {
		const { g, layout, edges } = lay(fixture('07'));
		const fu = g.unions.find((u) => u.partners.includes('aldric-valmont') && u.partners.includes('ingrid-valmont'))!;
		expect(layout.unions.get(fu.key)!.far).toBe(false);
		const legs = edges.paths.filter((p) => p.kind === 'marriage' && p.people.join() === fu.partners.join());
		expect(legs).toHaveLength(2);
		const ingrid = layout.persons.get('ingrid-valmont')!;
		for (const leg of legs) for (const s of segments(leg.d)) expect(crossesInterior(s, ingrid)).toBe(false);
	});

	it('a couple two generations apart is routed through the gaps between rows', () => {
		const { layout, edges } = lay(GREAT_UNCLE, LOOSE);
		expect(layout.persons.get('n1')!.gen - layout.persons.get('varian')!.gen).toBe(2);
		expect(cardCrossings(layout, edges)).toEqual([]);
		// Every sideways part of a couple line runs inside a gap between rows.
		for (const p of edges.paths.filter((p) => p.kind === 'marriage')) {
			for (const s of segments(p.d).filter((s) => s.y1 === s.y2 && s.x1 !== s.x2)) {
				const inGap = layout.rowGaps.some((gap) => s.y1 > gap.top && s.y1 < gap.bottom);
				const barBetweenCards = [...layout.unions.values()].some((u) => u.bar && u.y === s.y1);
				const belowLastRow = s.y1 > layout.rowGaps[layout.rowGaps.length - 1].bottom + layout.geometry.cardH;
				expect(inGap || barBetweenCards || belowLastRow).toBe(true);
			}
		}
	});
});

describe('row gaps', () => {
	it('lie between the bottom of one row and the top of the next', () => {
		const { layout } = lay(fixture('07'));
		expect(layout.rowGaps).toHaveLength(layout.rows.length - 1);
		layout.rowGaps.forEach((gap, i) => {
			const above = layout.persons.get(layout.rows[i][0])!;
			const below = layout.persons.get(layout.rows[i + 1][0])!;
			expect(gap.top).toBe(above.y + above.h);
			expect(gap.bottom).toBe(below.y);
		});
	});
});

describe('edge styles and people', () => {
	it('fixture 8: the adopted heir hangs by an adoptive line', () => {
		const { edges } = lay(fixture('08'));
		const drop = edges.paths.find((p) => p.people[0] === 'tomas' && p.people.includes('aldric') && !p.d.includes('C'))!;
		expect(drop.kind).toBe('adoptive');
		expect(drop.people.slice(1).sort()).toEqual(['aldric', 'isolde']);
	});

	it('lists the people each line connects', () => {
		const { g, edges } = lay(fixture('04'));
		for (const p of edges.paths) {
			expect(p.people.length).toBeGreaterThan(0);
			for (const id of p.people) expect(g.byId.has(id)).toBe(true);
		}
		const { g: g8, edges: e8 } = lay(fixture('08'));
		for (const s of g8.secondary) {
			const curves = e8.paths.filter((p) => p.d.includes('C') && p.people[p.people.length - 1] === s.child);
			expect(curves.length).toBeGreaterThan(0);
			for (const c of curves) {
				const parents = c.people.slice(0, -1);
				if (s.unionKey) expect(parents).toEqual(g8.unionByKey.get(s.unionKey)!.partners);
				else expect(parents).toHaveLength(1);
			}
		}
		// Trunks list the parents, then all their children; drops list the child first, then its placement parents.
		for (const fu of g8.unions.filter((u) => u.children.length)) {
			expect(e8.paths.some((p) => p.people.join() === [...fu.partners, ...fu.children].join() && (p.kind === 'descent' || p.kind === 'adoptive'))).toBe(true);
			for (const c of fu.children) expect(e8.paths.some((p) => p.people.join() === [c, ...fu.partners].join())).toBe(true);
		}
	});
});

describe('layoutTree cache', () => {
	const settings: LayoutSettings = DEFAULT_LAYOUT_SETTINGS;
	const graph = (src: string) => {
		const parsed = parseDynasty(src);
		if (!parsed.ok) throw new Error(hardErrorText(parsed.error));
		return deriveFamilies(parsed.tree);
	};
	const src = fixture('06');

	it('matches the uncached pipeline', () => {
		clearLayoutCache();
		const out = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter');
		const direct = lay(src);
		for (const [id, p] of direct.layout.persons) expect(out.layout.persons.get(id)).toEqual(p);
		expect(out.edges).toEqual(direct.edges);
	});

	it('returns the cached object for the same input', () => {
		clearLayoutCache();
		const a = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter');
		const b = layoutTree(graph(src), geometryFor(16, 'normal'), { sweeps: 4, far: { ...DEFAULT_FAR_RULE } }, 'Inter');
		expect(b).toBe(a);
	});

	it('ignores names, titles, dates, links and notes', () => {
		clearLayoutCache();
		const a = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter');
		const renamed = src
			.replace(/^(\s+name: ).*$/gm, '$1Someone Else')
			.replace(/^(\s+title: ).*$/gm, '$1Nobody')
			.replace(/^(\s+(born|died): ).*$/gm, '$1999')
			.replace(/^(\s+- id: [^\n]+)$/m, '$1\n    notes: a note\n    link: "[[Elsewhere]]"');
		expect(renamed).not.toBe(src);
		expect(layoutTree(graph(renamed), NORMAL_GEOMETRY, settings, 'Inter')).toBe(a);
	});

	it('misses on a change that moves cards or lines', () => {
		clearLayoutCache();
		const a = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter');
		const changes = [
			() => layoutTree(graph(src), geometryFor(18, 'normal'), settings, 'Inter'),
			() => layoutTree(graph(src), geometryFor(16, 'compact'), settings, 'Inter'),
			() => layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Georgia'),
			() => layoutTree(graph(src), NORMAL_GEOMETRY, { ...settings, far: { maxCardWidths: 5, maxGenerations: 1 } }, 'Inter'),
			() => layoutTree(graph(src), NORMAL_GEOMETRY, { ...settings, sweeps: 2 }, 'Inter'),
			// A new person.
			() => layoutTree(graph(src.replace(/^people:\n/m, 'people:\n  - {id: newcomer, name: Newcomer}\n')), NORMAL_GEOMETRY, settings, 'Inter'),
			// A house change can move which parent a family hangs under.
			() => layoutTree(graph(src.replace(/^(\s+house: )\S+$/m, '$1elsewhere')), NORMAL_GEOMETRY, settings, 'Inter'),
		];
		for (const change of changes) expect(change()).not.toBe(a);
	});

	it('keeps the most recent layouts only', () => {
		clearLayoutCache();
		const first = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Font 0');
		for (let i = 1; i <= LAYOUT_CACHE_SIZE; i++) layoutTree(graph(src), NORMAL_GEOMETRY, settings, `Font ${i}`);
		expect(layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Font 0')).not.toBe(first);
		const recent = layoutTree(graph(src), NORMAL_GEOMETRY, settings, `Font ${LAYOUT_CACHE_SIZE}`);
		expect(layoutTree(graph(src), NORMAL_GEOMETRY, settings, `Font ${LAYOUT_CACHE_SIZE}`)).toBe(recent);
	});

	it('clearLayoutCache empties the cache', () => {
		const a = layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter');
		clearLayoutCache();
		expect(layoutTree(graph(src), NORMAL_GEOMETRY, settings, 'Inter')).not.toBe(a);
	});
});
