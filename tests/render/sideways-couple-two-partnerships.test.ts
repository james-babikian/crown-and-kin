import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { SIGN_CLEAR_PX, drawnGeometry, geometryFor, sidewaysGeometry, sidewaysPartnerGap } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../../src/layout/index';
import type { LaidOut, LayoutSettings } from '../../src/layout/model';
import { UNION_MARKS, unionShape, type UnionShape } from '../../src/render/styles';
import { allFixtures } from '../acceptance/load';

// WP 0.2.1-WP2, item 3: on a phone on its side (`sideways`), a couple with two or more partnerships has its
// signs spread along the gap between the two cards. The gap is widened for that case only, so that every
// sign keeps at least 3 px clear of both cards. Every other layout is as it was.

const EPS = 1e-9;
const SIDE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' };

function graph(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

function lay(g: FamilyGraph, settings: LayoutSettings, font = 16): LaidOut {
	clearLayoutCache();
	return layoutTree(g, geometryFor(font), settings, 'test');
}

/** A couple with the given partnership types, and a child for the first one. */
const couple = (types: string[]) =>
	`people:
  - {id: a, name: Aldric, sex: m}
  - {id: b, name: Beatrice, sex: f}
  - {id: c, name: Child, parents: [a, b]}
unions:
${types.map((t) => `  - {partners: [a, b], type: ${t}}`).join('\n')}
`;

/** How far a sign reaches up and down from its point, in px: the shape and its outline, as `unionMark` draws it. */
function reach(shape: UnionShape, unionSize: number): { up: number; down: number } {
	const spec = UNION_MARKS[shape];
	const s = spec.size * unionSize;
	const half = (spec.stroke ?? 0) / 2;
	if (shape === 'open-triangle') return { up: s + half, down: 0.7 * s + half };
	return { up: s + half, down: s + half };
}

/** The clear space of every sign of the couple a and b above and below, in px: upper card, then lower card. */
function clearances(laid: LaidOut): number[][] {
	const geo = laid.layout.geometry;
	const [a, b] = ['a', 'b'].map((id) => laid.layout.persons.get(id)!);
	const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
	return laid.edges.markers
		.filter((m) => m.kind === 'union')
		.map((m) => {
			const r = reach(unionShape('union', m.unionType)!, geo.unionSize);
			return [m.y - r.up - (upper.y + upper.h), lower.y - (m.y + r.down)];
		});
}

const TYPES: string[][] = [['betrothal', 'marriage'], ['marriage', 'affair'], ['concubinage', 'affair'], ['betrothal', 'affair', 'marriage'], ['affair', 'affair', 'betrothal', 'marriage']];
const FONTS = [12, 14, 16, 18, 20];

describe('sideways, a couple with two or more partnerships', () => {
	for (const types of TYPES) {
		it(`${types.join(' + ')}: every sign keeps 3 px clear of both cards at 12 to 20 px`, () => {
			const g = graph(couple(types));
			for (const font of FONTS) {
				const laid = lay(g, SIDE, font);
				const marks = clearances(laid);
				expect(marks, `${font} px`).toHaveLength(types.length);
				for (const [above, below] of marks) {
					expect(above, `${font} px, above`).toBeGreaterThanOrEqual(SIGN_CLEAR_PX - EPS);
					expect(below, `${font} px, below`).toBeGreaterThanOrEqual(SIGN_CLEAR_PX - EPS);
				}
			}
		});
	}

	it('the signs of one couple do not touch each other', () => {
		const g = graph(couple(['betrothal', 'marriage', 'affair']));
		const laid = lay(g, SIDE);
		const u = laid.layout.geometry.unionSize;
		const ys = laid.edges.markers.filter((m) => m.kind === 'union').map((m) => ({ m, r: reach(unionShape('union', m.unionType)!, u) }));
		ys.sort((p, q) => p.m.y - q.m.y);
		for (let i = 1; i < ys.length; i++) expect(ys[i].m.y - ys[i].r.up).toBeGreaterThanOrEqual(ys[i - 1].m.y + ys[i - 1].r.down - EPS);
	});

	it('the gap is the wider value for the couple, and the layout geometry carries it', () => {
		const g = graph(couple(['betrothal', 'marriage']));
		const laid = lay(g, SIDE);
		const side = sidewaysGeometry(geometryFor(16));
		expect(side.coupleGap).toBe(24);
		expect(sidewaysPartnerGap(side, 2)).toBe(41);
		expect(laid.layout.geometry.coupleGap).toBe(41);
		const [a, b] = ['a', 'b'].map((id) => laid.layout.persons.get(id)!);
		const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
		expect(lower.y - (upper.y + upper.h)).toBe(41);
	});

	it('sidewaysPartnerGap: one partnership or none keeps the gap; more partnerships give more room, never less', () => {
		for (const font of FONTS) {
			const side = sidewaysGeometry(geometryFor(font));
			expect(sidewaysPartnerGap(side, 0)).toBe(side.coupleGap);
			expect(sidewaysPartnerGap(side, 1)).toBe(side.coupleGap);
			expect(sidewaysPartnerGap(side, 2)).toBeGreaterThan(side.coupleGap);
			expect(sidewaysPartnerGap(side, 3)).toBeGreaterThan(sidewaysPartnerGap(side, 2));
		}
	});

	it('the reach used for the gap covers every sign shape (styles.ts UNION_MARKS)', () => {
		const side = sidewaysGeometry(geometryFor(16));
		const widest = Math.max(...(Object.keys(UNION_MARKS) as UnionShape[]).map((s) => Math.max(reach(s, side.unionSize).up, reach(s, side.unionSize).down)));
		// With two signs the gap is two sign sizes plus two reaches plus two clear spaces, rounded up.
		expect(sidewaysPartnerGap(side, 2)).toBeGreaterThanOrEqual(2 * side.unionSize + 2 * (widest + SIGN_CLEAR_PX));
	});
});

describe('every other layout is as it was', () => {
	it('the down layout of a couple with two partnerships keeps its geometry and gap', () => {
		const g = graph(couple(['betrothal', 'marriage']));
		const laid = lay(g, DEFAULT_LAYOUT_SETTINGS);
		expect(laid.layout.geometry).toEqual(geometryFor(16));
		const [a, b] = ['a', 'b'].map((id) => laid.layout.persons.get(id)!);
		expect(Math.abs(a.x - b.x) - a.w).toBe(36);
	});

	it('a sideways tree with no couple of two partnerships keeps the one-partnership gap, and drawnGeometry still equals the layout geometry', () => {
		for (const f of allFixtures().filter((x) => ['01', '02', '03'].includes(x.id))) {
			const g = graph(f.source);
			const laid = lay(g, SIDE);
			expect(laid.layout.geometry.coupleGap, f.id).toBe(24);
			expect(drawnGeometry(geometryFor(16), SIDE), f.id).toEqual(laid.layout.geometry);
		}
	});

	it('one person with several partners (different couples) does not widen the gap', () => {
		const g = graph(`people:
  - {id: a, name: Aldric, sex: m}
  - {id: b, name: Beatrice, sex: f}
  - {id: c, name: Clarice, sex: f}
unions:
  - {partners: [a, b], type: marriage}
  - {partners: [a, c], type: betrothal}
`);
		expect(lay(g, SIDE).layout.geometry.coupleGap).toBe(24);
	});

	it('the cache key already holds the partnerships, so one key never stands for two gaps', () => {
		const one = graph(couple(['marriage']));
		const two = graph(couple(['marriage', 'marriage']));
		const geo = geometryFor(16);
		expect(layoutKey(one, geo, SIDE, 'x')).not.toBe(layoutKey(two, geo, SIDE, 'x'));
	});
});
