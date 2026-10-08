import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { farTagSigns } from '../src/layout/far-tag-sign';
import { geometryFor } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { nameLines } from '../src/render/name-lines';
import { DEFAULT_LIGHT } from '../src/render/styles';
import { renderSvg } from '../src/render/svg-string';
import * as S from './acceptance/sideways-checks';
import { build } from './helpers';

// Review 0.1.1, area C (layout and headless render). Each test shows one finding; see the report.

const FAR = { maxCardWidths: 3, maxGenerations: 1 };
const DOWN: LayoutSettings = { sweeps: 4, far: FAR };
const SIDE: LayoutSettings = { sweeps: 4, far: FAR, orientation: 'sideways' };
const GEO = geometryFor(16);

function lay(src: string, settings: LayoutSettings, geo = GEO) {
	const { g } = build(src);
	clearLayoutCache();
	return { g, ...layoutTree(g, geo, settings, 'test') };
}

describe('C1: a listed union with an unknown type is drawn like a marriage (spec §5.3)', () => {
	// `type: implicit` is not a union type (validation warns `unknown-union-type`). Its dot is the
	// marriage dot, but edges.ts `coupleKind` gives its line the thin "no recorded partnership" style.
	const src = `people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, parents: [a, b]}
unions:
  - {partners: [a, b], type: implicit}
`;
	for (const [label, settings] of [
		['down', DOWN],
		['sideways', SIDE],
	] as const) {
		it(label, () => {
			const { g, edges } = lay(src, settings);
			expect(g.issues.map((i) => i.code)).toContain('unknown-union-type');
			const couple = edges.paths.filter((p) => p.people.length === 2 && p.people.includes('a') && p.people.includes('b'));
			expect(couple.length).toBeGreaterThan(0);
			expect(couple.map((p) => p.kind)).toEqual(couple.map(() => 'marriage'));
		});
	}
});

describe('C2: two unions of one couple each keep a visible union sign (D26, D38)', () => {
	// The decision notes "Second union for a couple": add-union makes this shape (a betrothal, then a marriage).
	// Both unions are side by side, so both dots go to the middle of the same gap: the ring and the
	// dot are drawn on the same point, the two bars on the same stretch, and both trunks start there.
	const src = `people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c1, name: C1, parents: [a, b], union: first}
  - {id: c2, name: C2, parents: [a, b], union: second}
unions:
  - {id: first, partners: [a, b], type: betrothal}
  - {id: second, partners: [a, b], type: marriage}
`;
	for (const [label, settings] of [
		['down', DOWN],
		['sideways', SIDE],
	] as const) {
		it(label, () => {
			const { g, edges, layout } = lay(src, settings);
			expect(g.issues).toEqual([]);
			const ring = edges.markers.find((m) => m.unionType === 'betrothal')!;
			const dot = edges.markers.find((m) => m.unionType === 'marriage')!;
			expect(ring && dot).toBeTruthy();
			// The signs must not cover each other: centres at least one union size apart.
			expect(Math.hypot(ring.x - dot.x, ring.y - dot.y)).toBeGreaterThanOrEqual(layout.geometry.unionSize);
		});
	}
});

describe('C3: a far couple with no children shows its union sign (spec §5.3 "also for far couples")', () => {
	// a and z are two generations apart (D11: far) and have no children. Since 0.2.5 (D140) the rows put the two partners of a
	// partnership on one row where this can be solved; a and z share the tight ancestor r1, so no row can join them. No dot is drawn, so the
	// betrothal ring shows nowhere; the tags say only "⚭ Name".
	const src = `people:
  - {id: r1, name: R1, sex: m}
  - {id: r2, name: R2, sex: f}
  - {id: k, name: K, sex: m, parents: [r1, r2]}
  - {id: gk, name: GK, sex: m, parents: [k]}
  - {id: z, name: Z, sex: f, parents: [gk]}
  - {id: a, name: A, sex: m, parents: [r1, r2]}
unions:
  - {partners: [r1, r2]}
  - {partners: [a, z], type: betrothal}
`;
	// In the downward layout a far betrothal with no children has no union dot, so no marker. Since 0.2.1 its sign
	// is drawn in the tag pill of each partner (`farTagSigns`); 0.2.4 replaces the old skipped test with this one.
	it('down: no dot marks the far betrothal, so the tag pill of each partner carries its sign', () => {
		const { g, layout, edges } = lay(src, DOWN);
		const fu = g.unions.find((u) => u.type === 'betrothal')!;
		expect(layout.unions.get(fu.key)!.far).toBe(true);
		expect(edges.markers.filter((m) => m.unionType === 'betrothal')).toHaveLength(0);
		expect([...farTagSigns(g, layout, edges)].sort()).toEqual([['a', 'betrothal'], ['z', 'betrothal']]);
		// The headless picture draws the ring of the betrothal in both pills (the tag's muted colour marks it).
		const svg = renderSvg(g, layout, edges, { palette: DEFAULT_LIGHT });
		const rings = svg.match(new RegExp(`<circle [^>]*fill="${DEFAULT_LIGHT.cardFill}" stroke="${DEFAULT_LIGHT.textMuted}"`, 'g')) ?? [];
		expect(rings).toHaveLength(2);
	});
});

describe('C4: sideways at a small note font, two unions leave a card at the same spot (the decision notes "Line planning")', () => {
	// p1 has four couples with dots in the gap to its right. At 9 px the few slots on its short edge
	// are all near other trunks, and `clearestSpot` gives two legs the same place, so the lines of
	// p1+p0 and p1+p10 run on top of each other for 5 px.
	const src = `people:
  - {id: p0, name: P0, sex: f}
  - {id: p1, name: P1, sex: f}
  - {id: p2, name: P2, sex: f}
  - {id: p3, name: P3, sex: f, parents: [p2, p0]}
  - {id: p4, name: P4, sex: m, parents: [p2]}
  - {id: p6, name: P6, sex: m}
  - {id: p10, name: P10, sex: m, parents: [p0]}
  - {id: p11, name: P11, sex: m, parents: [p1]}
  - {id: p13, name: P13, sex: f, parents: [p1, p6]}
  - {id: p15, name: P15, sex: m}
unions:
  - {partners: [p1, p0]}
  - {partners: [p2, p1]}
  - {partners: [p3, p1]}
  - {partners: [p10, p1]}
  - {partners: [p15, p3], type: affair}
`;
	it('sideways cards at 9 px', () => {
		const { g, layout, edges } = lay(src, SIDE, geometryFor(9));
		expect(S.lineProblems(g, layout, edges)).toEqual([]);
	});
});

describe('C5: down at a small font, a far tag is drawn over lines that leave its card', () => {
	// At 8 px the free part of p4's bottom edge (the tag zone) is narrower than 44 px, so
	// `tagHit` makes hit.w 44 px. `down` tags have no `zoneW`, and renderers draw the pill up to
	// `zoneW ?? hit.w` wide (scene.ts, svg-string.ts): the pill then covers the start of p4's leg to
	// the dot of p4+p7 (x 266) and of the adoptive curve to p6 (x 306).
	const src = `people:
  - {id: p0, name: P0, sex: f}
  - {id: p1, name: P1, sex: f}
  - {id: p2, name: P2, sex: m, parents: [p0]}
  - {id: p3, name: P3, sex: m, parents: [p2], illegitimate: true}
  - {id: p4, name: P4, sex: f, parents: [p0, p1]}
  - {id: p5, name: P5, sex: m, parents: [p2, p4]}
  - {id: p6, name: P6, sex: f, parents: [p2, {id: p4, type: adoptive}]}
  - {id: p7, name: P7, sex: f, parents: [p1]}
  - {id: p8, name: P8, sex: f, parents: [p6, p1]}
  - {id: p10, name: P10, sex: m, parents: [p3, p2]}
  - {id: p14, name: P14, sex: m, parents: [p7, p4], illegitimate: true}
`;
	it('8 px', () => {
		const { layout, edges } = lay(src, DOWN, geometryFor(8));
		const bad: string[] = [];
		for (const t of layout.farTags.values()) {
			const card = layout.persons.get(t.person)!;
			const room = t.zoneW ?? t.hit.w;
			const [lo, hi] = [t.x - room / 2, t.x + room / 2];
			for (const p of edges.paths) {
				const m = /^M([-\d.]+) ([-\d.]+)/.exec(p.d);
				if (!m) continue;
				const [x, y] = [Number(m[1]), Number(m[2])];
				if (Math.abs(y - (card.y + card.h)) < 0.5 && x > card.x && x < card.x + card.w && x > lo && x < hi) bad.push(`${p.kind} [${p.people}] leaves ${t.person} at x ${x}, under the tag ${lo}–${hi}`);
			}
		}
		expect(bad).toEqual([]);
	});
});

describe('C6: nameLines trims the name before it decides on two text lines (the decision notes WP6.2)', () => {
	// The one-line test measures the untrimmed name, so a quoted name with outer spaces that fits
	// once trimmed is split, and `tallCardsFor` makes its card taller for nothing.
	const measure = (s: string) => s.length;
	it('outer spaces', () => {
		expect(nameLines('  Ann Bee', 7, measure)).toHaveLength(1);
		expect(nameLines('Ann Bee  ', 7, measure)).toHaveLength(1);
	});
});

describe('C7: a very long line of descent does not throw in layoutTree (spec §8)', () => {
	// core/order.ts `visit` recurses once per generation; 4000 generations once overflowed the stack.
	// Fixed by the area A fix of order.ts; the test runs in about 1 s.
	it('4000 generations', () => {
		const n = 4000;
		const src = `people:\n  - {id: c0, name: C0}\n${Array.from({ length: n }, (_, i) => `  - {id: c${i + 1}, name: C${i + 1}, parents: [c${i}]}`).join('\n')}\n`;
		const parsed = parseDynasty(src);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		clearLayoutCache();
		expect(() => layoutTree(g, GEO, DOWN, 'test')).not.toThrow();
	}, 60000);
});
