import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../../src/core/derive';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { measureLayout } from '../../scripts/metrics';
import type { EdgeDrawing, EdgePath, FarCoupleRule } from '../../src/layout/model';
import { build, fixture } from '../support/helpers';
import { randomTree } from '../support/random-trees';

// WP3.4: a person's single-parent children sit on that person's outer side of their couple
// children, so the two families' lines do not cross (owner check, 2026-09-25).

const HOUSES = `houses:
  - {id: valmont, name: House Valmont, color: "#8b1e3f"}
  - {id: orsini, name: House Orsini, color: "#1e4f8b"}
`;
const COUPLE = `  - {id: aldric, name: Aldric Valmont, house: valmont, sex: m, born: 1102}
  - {id: isolde, name: Isolde Orsini, house: orsini, sex: f, born: 1110}
  - {id: roderick, name: Roderick Valmont, house: valmont, sex: m, parents: [aldric, isolde]}
`;
const MARRIAGE = `unions:
  - {partners: [aldric, isolde], type: marriage}
`;

/** The owner-check trees of 2026-09-25 that have a single-parent child. */
const OWNER_CHECK: Record<string, string> = {
	'02-adoptive-one': `${HOUSES}people:\n${COUPLE}  - {id: tomas, name: Tomas Valmont, house: valmont, sex: m, parents: [{id: aldric, type: adoptive}]}\n${MARRIAGE}`,
	'04a-illegit-father-only': `${HOUSES}people:\n${COUPLE}  - {id: wren, name: Wren, sex: f, parents: [aldric], illegitimate: true}\n${MARRIAGE}`,
	'04b-illegit-mother-only': `${HOUSES}people:\n${COUPLE}  - {id: maud, name: Maud Valmont, house: valmont, sex: f, parents: [aldric, isolde]}\n  - {id: jon, name: Jon Rivers, sex: m, parents: [maud], illegitimate: true}\n${MARRIAGE}`,
	'07-ward-only': `${HOUSES}people:\n${COUPLE}  - {id: piers, name: Piers Hale, sex: m, parents: [{id: aldric, type: ward}]}\n${MARRIAGE}`,
};

/** Further cases: the person on the right, both partners, a husband who married in, a man between two wives. */
const MORE: Record<string, string> = {
	'right partner': `people:\n${COUPLE}  - {id: jon, name: Jon, sex: m, parents: [isolde], illegitimate: true}\n${MARRIAGE}`,
	'both partners, several children': `people:\n${COUPLE}  - {id: maud, name: Maud, sex: f, parents: [aldric, isolde]}\n  - {id: wren, name: Wren, sex: f, parents: [aldric], illegitimate: true}\n  - {id: ned, name: Ned, sex: m, parents: [aldric], illegitimate: true}\n  - {id: jon, name: Jon, sex: m, parents: [isolde], illegitimate: true}\n${MARRIAGE}`,
	'husband married in (left of his wife)': `people:
  - {id: king, name: King, sex: m}
  - {id: queen, name: Queen, sex: f}
  - {id: anna, name: Anna, sex: f, parents: [king, queen]}
  - {id: hugo, name: Hugo, sex: m}
  - {id: kid, name: Kid, sex: m, parents: [anna, hugo]}
  - {id: bastard, name: Bastard, sex: m, parents: [hugo], illegitimate: true}
  - {id: ward, name: Ward, sex: f, parents: [{id: anna, type: ward}]}
unions:
  - {partners: [king, queen]}
  - {partners: [anna, hugo]}
`,
	'a man between two wives': `people:
  - {id: edmund, name: Edmund, sex: m}
  - {id: agnes, name: Agnes, sex: f}
  - {id: beatrix, name: Beatrix, sex: f}
  - {id: a1, name: A1, sex: m, parents: [edmund, agnes]}
  - {id: b1, name: B1, sex: m, parents: [edmund, beatrix]}
  - {id: s1, name: S1, sex: m, parents: [edmund], illegitimate: true}
unions:
  - {partners: [edmund, agnes]}
  - {partners: [edmund, beatrix]}
`,
};

// RANDOM_TREES=5000 npm test runs a longer search.
const TREES = Number(process.env.RANDOM_TREES ?? 400);
const FIXTURES = ['01', '02', '03', '04', '05', '06', '07', '08', '10', '11'];
const RULES: [string, FarCoupleRule][] = [
	['spec default', DEFAULT_FAR_RULE],
	['loose', { maxCardWidths: Infinity, maxGenerations: Infinity }],
];

function lay(src: string, far: FarCoupleRule = DEFAULT_FAR_RULE) {
	const { g, gen, order } = build(src);
	const { layout, edges } = arrangeTree(g, gen, NORMAL_GEOMETRY, { sweeps: 4, far });
	return { g, gen, order, layout, edges };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function straight(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHV])([^MHVC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			if (n[0] !== x) out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else {
			if (n[0] !== y) out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		}
	}
	return out;
}

/** A horizontal and a vertical piece that cross inside both (touching at an end does not count). */
function cross(a: Seg, b: Seg): boolean {
	const [h, v] = a.y1 === a.y2 ? [a, b] : [b, a];
	if (h.y1 !== h.y2 || v.x1 !== v.x2) return false;
	const e = 0.5;
	return v.x1 > Math.min(h.x1, h.x2) + e && v.x1 < Math.max(h.x1, h.x2) - e && h.y1 > Math.min(v.y1, v.y2) + e && h.y1 < Math.max(v.y1, v.y2) - e;
}

const COUPLE_KINDS = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A family's trunk (parents first) and its drops (child first, then the parents). */
function familyLines(edges: EdgeDrawing, parents: string[], kids: string[]): EdgePath[] {
	return edges.paths.filter((p) => !COUPLE_KINDS.has(p.kind)).filter((p) => (same(p.people.slice(0, parents.length), parents) && same(p.people.slice(parents.length), kids)) || (kids.includes(p.people[0]) && same(p.people.slice(1), parents)));
}

/** Crossings between each person's single-parent family and the families of their couples. */
function soloCrossings(g: FamilyGraph, edges: EdgeDrawing, only: (key: string) => boolean = () => true): string[] {
	const bad: string[] = [];
	for (const [p, kids] of g.soloChildren) {
		const solo = familyLines(edges, [p], kids).flatMap((x) => straight(x.d));
		for (const key of g.unionsOf.get(p) ?? []) {
			const fu = g.unionByKey.get(key)!;
			if (!fu.children.length || !only(key)) continue;
			const couple = familyLines(edges, [...fu.partners], fu.children).flatMap((x) => straight(x.d));
			const n = solo.filter((a) => couple.some((b) => cross(a, b))).length;
			if (n) bad.push(`${p}'s single-parent line crosses the line of ${fu.partners.join('+')} (${n}×)`);
		}
	}
	return bad;
}

describe('single-parent children sit on the outer side of the couple children', () => {
	it('the owner-check trees: the single-parent child sits on the side of its parent', () => {
		const side = { '02-adoptive-one': 'tomas', '04a-illegit-father-only': 'wren', '07-ward-only': 'piers' } as const;
		for (const [name, child] of Object.entries(side)) {
			const { layout } = lay(OWNER_CHECK[name]);
			expect(layout.rows[1], name).toEqual([child, 'roderick']);
		}
		// Maud is the only child of the couple; her son hangs from her alone.
		expect(lay(OWNER_CHECK['04b-illegit-mother-only']).layout.rows[2]).toEqual(['jon']);
	});

	it('the right partner: the single-parent child sits on the right', () => {
		expect(lay(MORE['right partner']).layout.rows[1]).toEqual(['roderick', 'jon']);
	});

	it('both partners: left partner’s children left, right partner’s right, each family in document order', () => {
		expect(lay(MORE['both partners, several children']).layout.rows[1]).toEqual(['wren', 'ned', 'roderick', 'maud', 'jon']);
	});

	it('a husband who married in sits left of his wife: his child goes left, her ward goes right', () => {
		const { layout } = lay(MORE['husband married in (left of his wife)']);
		expect(layout.rows[1]).toEqual(['hugo', 'anna']);
		expect(layout.rows[2]).toEqual(['bastard', 'kid', 'ward']);
	});

	it('a man between two wives: his single-parent child sits between the two marriages’ children', () => {
		const { layout } = lay(MORE['a man between two wives']);
		expect(layout.rows[0]).toEqual(['agnes', 'edmund', 'beatrix']);
		expect(layout.rows[1]).toEqual(['a1', 's1', 'b1']);
	});

	for (const [name, src] of [...Object.entries(OWNER_CHECK), ...Object.entries(MORE)]) {
		it(`${name}: no crossing, siblings in order`, () => {
			const { g, layout, edges } = lay(src);
			expect(soloCrossings(g, edges)).toEqual([]);
			expect(measureLayout(g, layout).siblingOrderViolations).toBe(0);
		});
	}

	for (const f of FIXTURES) {
		for (const [label, far] of RULES) {
			it(`fixture ${f}, ${label}: no single-parent line crosses its parent's couple line`, () => {
				const { g, layout, edges } = lay(fixture(f), far);
				expect(soloCrossings(g, edges)).toEqual([]);
				expect(measureLayout(g, layout).siblingOrderViolations).toBe(0);
			});
		}
	}

	it('random trees: a couple side by side in one block, each with no other family, has no crossing', () => {
		const failures: string[] = [];
		for (let seed = 1; seed <= TREES; seed++) {
			const { g, order, layout, edges } = lay(randomTree(seed));
			const block = new Map(order.blocks.flatMap((b, i) => b.map((p) => [p, i] as const)));
			const oneFamily = (q: string) => (g.unionsOf.get(q) ?? []).filter((k) => g.unionByKey.get(k)!.children.length).length === 1;
			const simple = (key: string) => {
				const [a, b] = g.unionByKey.get(key)!.partners;
				return layout.unions.get(key)!.bar && block.get(a) === block.get(b) && oneFamily(a) && oneFamily(b);
			};
			const bad = soloCrossings(g, edges, simple);
			if (bad.length) failures.push(`seed ${seed}: ${bad[0]}`);
		}
		expect(failures.slice(0, 10), `${failures.length} of ${TREES} trees`).toEqual([]);
	});

	// WP-4b (class c, the architecture notes §4.2.3 and W3): the two tests of `soloFamiliesOutside` (keeps the model order when no person has single-parent children; moves whole
	// blocks only) are gone with the function. W3 puts the families of one parent alone in the walk (`familyOrder`) so nothing is moved after it: the claim
	// "the cards stand in the model order" is `review-3.4-order` (400 random trees) and the walk's own rules are `order-rules` (W3).
});
