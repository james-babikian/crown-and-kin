import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { DEFAULT_FOCUS_GENERATIONS, type FocusGenerationsFor, type FocusSubgraph, type FocusSubgraphResult } from '../../src/core/focus-subgraph';
import { focusGenerationsFor, focusSubgraph } from '../../src/core/focus-subgraph';
import { parseDynasty } from '../../src/core/parse';
import type { ParentRef, Person, Tree } from '../../src/core/types';
import { layoutTree } from '../../src/layout/index';
import { allFixtures, fixtureSource } from './load';
import { FONT_FAMILY, geometry, SETTINGS } from './pipeline';
import { randomTree } from '../random-trees';

// Spec §5.6 (focus mode: who is shown, + badges), §0 D2 (sibling order), D3 (focus mode for large
// trees), D18 (the pin opens a focus tree), §8 (never throw), §9 (default 3 generations), and the
// M5 contract in src/core/focus.ts (the decision notes "M5 contract").
//
// Every expected family and every hidden count below is worked out by hand from the contract
// (4a896b9, d10284b):
// - core = the focus person, their siblings (other children of any of their parents, any type),
//   ancestors up to n parent steps and descendants down to n parent steps (any parent type);
// - add the partners of every core person in a listed union of any type (one step);
// - then, in one pass, for every core person with at least one parent (any type) in the family
//   before this step (core and listed partners), add both placement parents that
//   `deriveFamilies` gives that person on the whole tree. So implicit co-parents come in only
//   through a shown child;
// - parent links, one rule for everybody: let P be the person's placement parents in the whole
//   tree. If P is not empty and all of P are inside, keep every link the whole tree draws to a
//   parent inside; if P is empty, keep the drawn (rumoured) links to parents inside; otherwise no
//   parents (a root). A link the whole tree does not draw (a self-link, or one dropped to break a
//   cycle) is never kept;
// - hidden = for each family member, the number of distinct direct relatives whose relation is
//   not drawn: a parent or child over a link the whole tree draws, where the relative is outside
//   or the link was not kept; a listed partner or implicit co-parent outside. A link the whole
//   tree does not draw (dropped to break a cycle) never counts;
// - duplicate person ids: the first entry wins, as in `deriveFamilies`.
// Also in the contract: siblings do not depend on n, so n = 0 still shows them; an id that names
// no person is ignored (not added, not counted); kept unions are the original union objects with
// their `index`, so edits from a focus view address the right union.
// Not asserted: whether later entries with a duplicate id appear in the subgraph, and their links.

const subgraph: FocusSubgraph = focusSubgraph;

function parse(yaml: string): Tree {
	const r = parseDynasty(yaml);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return r.tree;
}

function run(tree: Tree, focus: string, n: number): FocusSubgraphResult {
	const before = structuredClone(tree);
	const r = subgraph(tree, focus, n);
	// Pure (contract): the input tree is not changed.
	expect(tree).toEqual(before);
	if (!r) throw new Error(`no result for ${focus}`);
	expect(shapeProblems(tree, focus, r)).toEqual([]);
	return r;
}

const ids = (r: FocusSubgraphResult) => r.tree.people.map((p) => p.id);
const hidden = (r: FocusSubgraphResult) => Object.fromEntries(r.hidden);
const personIn = (r: FocusSubgraphResult, id: string): Person => {
	const p = r.tree.people.find((x) => x.id === id);
	if (!p) throw new Error(`${id} is not in the focus family`);
	return p;
};
const parentsIn = (r: FocusSubgraphResult, id: string) => personIn(r, id).parents.map((ref) => ref.type === 'birth' ? ref.id : `${ref.id}:${ref.type}`);
const unionPartners = (r: FocusSubgraphResult) => r.tree.unions.map((u) => u.partners.join('+'));

/** JSON-equal: keys that hold `undefined` count as absent, as in `toEqual`. */
const same = (a: unknown, b: unknown) => isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

const graphs = new WeakMap<Tree, FamilyGraph>();
/** `deriveFamilies` of the whole tree, once per tree object. */
function wholeGraph(tree: Tree): FamilyGraph {
	let g = graphs.get(tree);
	if (!g) graphs.set(tree, (g = deriveFamilies(tree)));
	return g;
}

const KNOWN_PARENT_TYPES = ['birth', 'adoptive', 'ward', 'rumoured'];

/** The parent links the whole tree draws for a person (after cycle breaking), as JSON [parent, type]. */
function drawnLinks(g: FamilyGraph, id: string): Set<string> {
	const out = new Set<string>();
	const type = g.placementType.get(id);
	for (const q of g.placementParents.get(id) ?? []) out.add(JSON.stringify([q, type]));
	for (const e of g.secondary) if (e.child === id) for (const q of e.parents) out.add(JSON.stringify([q, e.type]));
	return out;
}

/** The contract's parent-link rule: the written entries a shown person keeps in the subgraph. */
function keptParents(g: FamilyGraph, person: Person, inside: Set<string>): ParentRef[] {
	const placed = g.placementParents.get(person.id) ?? [];
	if (placed.length && !placed.every((q) => inside.has(q))) return [];
	const drawn = drawnLinks(g, person.id);
	return person.parents.filter((ref) => inside.has(ref.id) && drawn.has(JSON.stringify([ref.id, KNOWN_PARENT_TYPES.includes(ref.type) ? ref.type : 'birth'])));
}

/**
 * Every rule of the result's shape that holds for any tree (contract `FocusSubgraphResult`).
 * Returns a list of problems, so a failure on fixture 7 names the person and the rule.
 */
function shapeProblems(tree: Tree, focus: string, r: FocusSubgraphResult): string[] {
	const out: string[] = [];
	const at = `focus ${focus}`;
	const inside = new Set(r.tree.people.map((p) => p.id));
	const treeIds = new Set(tree.people.map((p) => p.id));
	const whole = wholeGraph(tree);
	if (!inside.has(focus)) out.push(`${at}: the focus person is missing`);
	for (const id of inside) if (!treeIds.has(id)) out.push(`${at}: ${id} is not in the tree`);

	// People: original order, original index, original fields; parents only inside (D2, contract).
	let last = -Infinity;
	for (const p of r.tree.people) {
		if (!(p.index > last)) out.push(`${at}: people out of order at ${p.id} (index ${p.index})`);
		last = p.index;
		const orig = tree.people.find((o) => o.index === p.index && o.id === p.id);
		if (!orig) {
			out.push(`${at}: ${p.id} has no original with index ${p.index}`);
			continue;
		}
		// Duplicate ids: the first entry wins; later entries are not asserted.
		if (whole.byId.get(p.id) !== orig) continue;
		const want = { ...orig, parents: keptParents(whole, orig, inside) };
		if (!same(p, want)) out.push(`${at}: ${p.id} has parents ${JSON.stringify(p.parents)}, want ${JSON.stringify(want.parents)}`);
	}

	// Unions: original objects in original order; only unions whose partners are all inside.
	last = -Infinity;
	const kept = new Set<number>();
	for (const u of r.tree.unions) {
		if (!(u.index > last)) out.push(`${at}: unions out of order at index ${u.index}`);
		last = u.index;
		kept.add(u.index);
		const orig = tree.unions.find((o) => o.index === u.index);
		if (!orig || !same(u, orig)) out.push(`${at}: union ${u.index} differs from the original`);
		for (const id of u.partners) if (!inside.has(id)) out.push(`${at}: union ${u.index} has ${id}, who is outside`);
	}
	for (const u of tree.unions) {
		const [a, b] = u.partners;
		const wellFormed = u.partners.length === 2 && a !== b && treeIds.has(a) && treeIds.has(b);
		if (wellFormed && inside.has(a) && inside.has(b) && !kept.has(u.index)) out.push(`${at}: union ${a}+${b} (index ${u.index}) was dropped`);
	}

	if (!same(r.tree.houses, tree.houses)) out.push(`${at}: houses changed`);
	if (!same(r.tree.options, { ...tree.options, start: focus })) out.push(`${at}: options must be the original ones with start = ${focus}`);
	if (r.tree.issues.length) out.push(`${at}: the subgraph has issues of its own`);
	for (const [id, n] of r.hidden) {
		if (!inside.has(id)) out.push(`${at}: hidden lists ${id}, who is outside`);
		if (!Number.isInteger(n) || n < 1) out.push(`${at}: hidden count ${n} for ${id} is not a positive whole number`);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// A straight line of nine generations: p0 → p1 → … → p8, one parent each.
const LINE = parse(`people:
  - {id: p0, name: P0}
  - {id: p1, name: P1, parents: [p0]}
  - {id: p2, name: P2, parents: [p1]}
  - {id: p3, name: P3, parents: [p2]}
  - {id: p4, name: P4, parents: [p3]}
  - {id: p5, name: P5, parents: [p4]}
  - {id: p6, name: P6, parents: [p5]}
  - {id: p7, name: P7, parents: [p6]}
  - {id: p8, name: P8, parents: [p7]}
`);
const ALL_LINE = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

describe('generations: ancestors and descendants exactly n parent steps (§5.6)', () => {
	it('n = 0: only the focus person; parent and child are hidden', () => {
		const r = run(LINE, 'p4', 0);
		expect(ids(r)).toEqual(['p4']);
		expect(parentsIn(r, 'p4')).toEqual([]);
		expect(hidden(r)).toEqual({ p4: 2 });
	});

	it('n = 1: one row up and one row down', () => {
		const r = run(LINE, 'p4', 1);
		expect(ids(r)).toEqual(['p3', 'p4', 'p5']);
		expect(parentsIn(r, 'p3')).toEqual([]);
		expect(parentsIn(r, 'p4')).toEqual(['p3']);
		expect(parentsIn(r, 'p5')).toEqual(['p4']);
		expect(hidden(r)).toEqual({ p3: 1, p5: 1 });
	});

	it('n = 2', () => {
		const r = run(LINE, 'p4', 2);
		expect(ids(r)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);
		expect(hidden(r)).toEqual({ p2: 1, p6: 1 });
	});

	it('n = 3', () => {
		const r = run(LINE, 'p4', 3);
		expect(ids(r)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
		expect(hidden(r)).toEqual({ p1: 1, p7: 1 });
	});

	it('n = 4 reaches both ends: nothing is hidden', () => {
		const r = run(LINE, 'p4', 4);
		expect(ids(r)).toEqual(ALL_LINE);
		expect(hidden(r)).toEqual({});
	});

	it('n larger than the tree shows the whole line', () => {
		expect(ids(run(LINE, 'p4', 50))).toEqual(ALL_LINE);
	});

	it('a root focus shows only descendants; a leaf focus only ancestors', () => {
		const top = run(LINE, 'p0', 3);
		expect(ids(top)).toEqual(['p0', 'p1', 'p2', 'p3']);
		expect(hidden(top)).toEqual({ p3: 1 });
		const leaf = run(LINE, 'p8', 2);
		expect(ids(leaf)).toEqual(['p6', 'p7', 'p8']);
		expect(hidden(leaf)).toEqual({ p6: 1 });
	});

	it('DEFAULT_FOCUS_GENERATIONS is 3 (§9)', () => {
		expect(DEFAULT_FOCUS_GENERATIONS).toBe(3);
	});

	for (const bad of [-1, -3, 1.5, 2.9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
		it(`n = ${bad} counts as the default, 3 (contract)`, () => {
			const r = run(LINE, 'p4', bad);
			expect(ids(r)).toEqual(ids(run(LINE, 'p4', DEFAULT_FOCUS_GENERATIONS)));
			expect(hidden(r)).toEqual({ p1: 1, p7: 1 });
		});
	}

	it('n is the argument: options.generations in the tree does not change the result', () => {
		const tree = parse(`options:\n  generations: 1\n${'people:\n'}${ALL_LINE.map((id, i) => `  - {id: ${id}, name: ${id}${i ? `, parents: [p${i - 1}]` : ''}}`).join('\n')}\n`);
		expect(ids(run(tree, 'p4', 2))).toEqual(['p2', 'p3', 'p4', 'p5', 'p6']);
	});
});

// ---------------------------------------------------------------------------------------------
// Siblings through every parent type. f has birth parents a and b and a rumoured father rp.
const SIBLINGS = parse(`people:
  - {id: g, name: G, sex: m}
  - {id: a, name: A, sex: m, parents: [g]}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, sex: f}
  - {id: rp, name: RP, sex: m}
  - {id: aunt, name: Aunt, sex: f, parents: [g]}
  - {id: sib, name: Sib, parents: [a, b]}
  - {id: f, name: F, parents: [a, b, {id: rp, type: rumoured}]}
  - {id: half-a, name: Half A, parents: [a, c]}
  - {id: half-b, name: Half B, parents: [b]}
  - {id: rum-sib, name: Rumoured Sib, parents: [{id: a, type: rumoured}]}
  - {id: adopt-sib, name: Adopted Sib, parents: [{id: b, type: adoptive}]}
  - {id: ward-sib, name: Ward Sib, parents: [{id: a, type: ward}]}
  - {id: rp-child, name: RP Child, parents: [rp]}
  - {id: stranger, name: Stranger}
unions:
  - partners: [a, b]
  - partners: [a, c]
    type: concubinage
`);

describe('siblings: every other child of any parent, any parent type (§5.6)', () => {
	it('n = 1: full, half, rumoured, adoptive and ward siblings; the parents and their partners', () => {
		const r = run(SIBLINGS, 'f', 1);
		// c is in as a partner of the ancestor a; g (2 steps up), aunt and stranger are out.
		expect(ids(r)).toEqual(['a', 'b', 'c', 'rp', 'sib', 'f', 'half-a', 'half-b', 'rum-sib', 'adopt-sib', 'ward-sib', 'rp-child']);
		expect(parentsIn(r, 'a')).toEqual([]);
		expect(parentsIn(r, 'f')).toEqual(['a', 'b', 'rp:rumoured']);
		expect(parentsIn(r, 'half-a')).toEqual(['a', 'c']);
		expect(unionPartners(r)).toEqual(['a+b', 'a+c']);
		expect(hidden(r)).toEqual({ a: 1 });
	});

	it('n = 0: siblings stay, parents go; every sibling shows its hidden parents', () => {
		const r = run(SIBLINGS, 'f', 0);
		expect(ids(r)).toEqual(['sib', 'f', 'half-a', 'half-b', 'rum-sib', 'adopt-sib', 'ward-sib', 'rp-child']);
		for (const id of ids(r)) expect(parentsIn(r, id)).toEqual([]);
		expect(r.tree.unions).toEqual([]);
		expect(hidden(r)).toEqual({ sib: 2, f: 3, 'half-a': 2, 'half-b': 1, 'rum-sib': 1, 'adopt-sib': 1, 'ward-sib': 1, 'rp-child': 1 });
	});

	it('n = 2: the grandfather comes in; the aunt stays out (she is not a sibling or an ancestor)', () => {
		const r = run(SIBLINGS, 'f', 2);
		expect(ids(r)).toEqual(['g', 'a', 'b', 'c', 'rp', 'sib', 'f', 'half-a', 'half-b', 'rum-sib', 'adopt-sib', 'ward-sib', 'rp-child']);
		expect(parentsIn(r, 'a')).toEqual(['g']);
		expect(hidden(r)).toEqual({ g: 1 });
	});

	it('a half-sibling on the mother\'s side: the father is in only as her partner', () => {
		const r = run(SIBLINGS, 'half-b', 1);
		expect(ids(r)).toEqual(['a', 'b', 'sib', 'f', 'half-b', 'adopt-sib']);
		expect(parentsIn(r, 'f')).toEqual(['a', 'b']);
		expect(unionPartners(r)).toEqual(['a+b']);
		// a: parent g, children half-a, rum-sib and ward-sib, partner c. f: rumoured father rp.
		expect(hidden(r)).toEqual({ a: 5, f: 1 });
	});

	it('a parent entry with an unknown type still counts as a parent (it is read as birth)', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: f, name: F, parents: [a]}
  - {id: x, name: X, parents: [{id: a, type: foster}]}
  - {id: y, name: Y, parents: [{id: f, type: foster}]}
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['a', 'f', 'x', 'y']);
		expect(parentsIn(r, 'x')).toEqual(['a:foster']);
		expect(hidden(r)).toEqual({});
	});
});

// ---------------------------------------------------------------------------------------------
// Partners, one step only. f has four partners (two unions with w); the others have partners of
// their own who must stay out.
const PARTNERS = parse(`people:
  - {id: pa, name: PA, sex: m}
  - {id: pb, name: PB, sex: f}
  - {id: pc, name: PC, sex: m}
  - {id: f, name: F, sex: m, parents: [pa]}
  - {id: s, name: S, sex: f, parents: [pa]}
  - {id: h, name: H, sex: m}
  - {id: hw, name: HW, sex: f}
  - {id: w, name: W, sex: f}
  - {id: x, name: X, sex: m}
  - {id: y, name: Y, sex: f}
  - {id: z, name: Z, sex: f}
  - {id: q, name: Q, sex: f}
  - {id: r, name: R, sex: f}
  - {id: kpp, name: KPP}
  - {id: k, name: K, parents: [f, w]}
  - {id: kp, name: KP, parents: [kpp]}
  - {id: kpc, name: KPC, parents: [kp]}
unions:
  - partners: [pa, pb]
  - partners: [pb, pc]
  - partners: [f, w]
    type: betrothal
  - partners: [f, w]
  - partners: [f, z]
    type: betrothal
  - partners: [f, q]
    type: affair
  - partners: [f, r]
    type: concubinage
  - partners: [w, x]
  - partners: [w, x]
    type: affair
  - partners: [x, y]
  - partners: [s, h]
  - partners: [h, hw]
  - partners: [k, kp]
`);

describe('partners of everyone included, one step only (§5.6)', () => {
	it('partners of the focus person (every union type), the sibling, the parent and the child', () => {
		const r = run(PARTNERS, 'f', 1);
		expect(ids(r)).toEqual(['pa', 'pb', 'f', 's', 'h', 'w', 'z', 'q', 'r', 'k', 'kp']);
	});

	it('partners of partners stay out: x and y, pc, hw', () => {
		const r = run(PARTNERS, 'f', 1);
		for (const id of ['x', 'y', 'pc', 'hw', 'kpp', 'kpc']) expect(ids(r)).not.toContain(id);
	});

	it('unions: kept only when both partners are in, in list order; both unions of f and w stay', () => {
		const r = run(PARTNERS, 'f', 1);
		expect(r.tree.unions.map((u) => u.index)).toEqual([0, 2, 3, 4, 5, 6, 10, 12]);
		expect(unionPartners(r)).toEqual(['pa+pb', 'f+w', 'f+w', 'f+z', 'f+q', 'f+r', 's+h', 'k+kp']);
	});

	it('parent refs to people outside are dropped: the partner\'s own parent', () => {
		const r = run(PARTNERS, 'f', 1);
		expect(parentsIn(r, 'kp')).toEqual([]);
		expect(parentsIn(r, 'k')).toEqual(['f', 'w']);
	});

	it('hidden counts people, not unions: w has two unions with x and counts 1', () => {
		const r = run(PARTNERS, 'f', 1);
		// pb: partner pc. h: partner hw. w: partner x. kp: parent kpp and child kpc.
		expect(hidden(r)).toEqual({ pb: 1, h: 1, w: 1, kp: 2 });
	});
});

// ---------------------------------------------------------------------------------------------
// A marriage across generations and a person with two roles. f marries her uncle u; her
// half-sister hs is also the wife of their grandfather gf.
const CROSS = parse(`people:
  - {id: gf, name: GF, sex: m}
  - {id: fa, name: FA, sex: m, parents: [gf]}
  - {id: u, name: U, sex: m, parents: [gf]}
  - {id: hs, name: HS, sex: f, parents: [fa]}
  - {id: f, name: F, sex: f, parents: [fa]}
  - {id: hsk, name: HSK, parents: [gf, hs]}
  - {id: c, name: C, parents: [u, f]}
unions:
  - partners: [gf, hs]
  - partners: [u, f]
`);

describe('cross-generation marriages and people with two roles (§5.6)', () => {
	it('n = 2: the uncle-husband and the grandfather; the half-sister appears once', () => {
		const r = run(CROSS, 'f', 2);
		expect(ids(r)).toEqual(['gf', 'fa', 'u', 'hs', 'f', 'c']);
		expect(parentsIn(r, 'u')).toEqual(['gf']);
		expect(parentsIn(r, 'c')).toEqual(['u', 'f']);
		expect(unionPartners(r)).toEqual(['gf+hs', 'u+f']);
		expect(hidden(r)).toEqual({ gf: 1, hs: 1 });
	});

	it('n = 1: the grandfather is still in, as the partner of the sibling hs', () => {
		const r = run(CROSS, 'f', 1);
		expect(ids(r)).toEqual(['gf', 'fa', 'u', 'hs', 'f', 'c']);
		expect(parentsIn(r, 'fa')).toEqual(['gf']);
		expect(hidden(r)).toEqual({ gf: 1, hs: 1 });
	});

	it('n = 0: the focus person, the sibling and their partners only', () => {
		const r = run(CROSS, 'f', 0);
		expect(ids(r)).toEqual(['gf', 'u', 'hs', 'f']);
		expect(parentsIn(r, 'u')).toEqual(['gf']);
		expect(parentsIn(r, 'hs')).toEqual([]);
		expect(parentsIn(r, 'f')).toEqual([]);
		expect(unionPartners(r)).toEqual(['gf+hs', 'u+f']);
		// gf: children fa and hsk. u: child c. hs: parent fa, child hsk. f: parent fa, child c.
		expect(hidden(r)).toEqual({ gf: 2, u: 1, hs: 2, f: 2 });
	});
});

// ---------------------------------------------------------------------------------------------
// Pedigree collapse: f's parents a and b are cousins, so g is 2 steps up through a and 3 through
// b. d is f's adopted child and also a great-grandchild through gk.
const COLLAPSE = parse(`people:
  - {id: g, name: G}
  - {id: a, name: A, parents: [g]}
  - {id: h, name: H, parents: [g]}
  - {id: b, name: B, parents: [h]}
  - {id: f, name: F, parents: [a, b]}
  - {id: k, name: K, parents: [f]}
  - {id: gk, name: GK, parents: [k]}
  - {id: d, name: D, parents: [gk, {id: f, type: adoptive}]}
`);

describe('a person reached by two paths counts at the nearer one (§5.6)', () => {
	it('n = 2: g is 2 steps up through a, so g is in', () => {
		const r = run(COLLAPSE, 'f', 2);
		expect(ids(r)).toEqual(['g', 'a', 'h', 'b', 'f', 'k', 'gk', 'd']);
		expect(hidden(r)).toEqual({});
	});

	it('n = 1: an adopted child is a descendant; its placement (birth) parent comes in, so it is drawn as in the whole tree', () => {
		const r = run(COLLAPSE, 'f', 1);
		// d is placed under its birth parent gk (§4.3); gk is 2 steps down but comes in as d's
		// placement parent. gk's own relatives are not added (one pass).
		expect(ids(r)).toEqual(['a', 'b', 'f', 'k', 'gk', 'd']);
		expect(parentsIn(r, 'd')).toEqual(['gk', 'f:adoptive']);
		expect(hidden(r)).toEqual({ a: 1, b: 1 });
	});

	it('ward and rumoured children are descendants; a rumoured grandparent is an ancestor', () => {
		const tree = parse(`people:
  - {id: rg, name: RG}
  - {id: p, name: P}
  - {id: f, name: F, parents: [p, {id: rg, type: rumoured}]}
  - {id: w, name: W, parents: [{id: f, type: ward}]}
  - {id: rc, name: RC, parents: [{id: w, type: rumoured}]}
  - {id: far, name: Far, parents: [rc]}
`);
		// Focus w, n = 2: f (1), p and rg (2) up; rc (1), far (2) down.
		const r = run(tree, 'w', 2);
		expect(ids(r)).toEqual(['rg', 'p', 'f', 'w', 'rc', 'far']);
		expect(hidden(r)).toEqual({});
		expect(ids(run(tree, 'w', 1))).toEqual(['f', 'w', 'rc']);
	});
});

// ---------------------------------------------------------------------------------------------
// Implicit co-parents: two placement parents of one child with no union that lists them.
// gp has fa with gm and hu with gw2, and no union with either. f has k with cp, no union. cp also
// has cpk with cpo (no union) and a listed union with cpw. k has kk with ko (no union).
const IMPLICIT_YAML = `people:
  - {id: gmp, name: GMP}
  - {id: gp, name: GP, sex: m}
  - {id: gm, name: GM, sex: f, parents: [gmp]}
  - {id: gmx, name: GMX, sex: m}
  - {id: gw2, name: GW2, sex: f}
  - {id: fa, name: FA, sex: m, parents: [gp, gm]}
  - {id: hu, name: HU, parents: [gp, gw2]}
  - {id: f, name: F, sex: f, parents: [fa]}
  - {id: cpp, name: CPP}
  - {id: cp, name: CP, sex: m, parents: [cpp]}
  - {id: cpw, name: CPW, sex: f}
  - {id: cpo, name: CPO, sex: f}
  - {id: k, name: K, parents: [f, cp]}
  - {id: cpk, name: CPK, parents: [cp, cpo]}
  - {id: ko, name: KO}
  - {id: kk, name: KK, parents: [k, ko]}
unions:
  - partners: [gm, gmx]
  - partners: [cp, cpw]
`;
const IMPLICIT = parse(IMPLICIT_YAML);

/** The partner pairs of the implicit unions that `deriveFamilies` finds (the contract's reference). */
const implicitPairs = (tree: Tree) =>
	deriveFamilies(tree)
		.unions.filter((u) => u.implicit)
		.map((u) => [...u.partners].sort().join('+'))
		.sort();

describe('implicit co-parents come in only through a shown child (contract 618ddb7)', () => {
	it('the tree has the implicit unions the tests rely on', () => {
		expect(implicitPairs(IMPLICIT)).toEqual(['cp+cpo', 'cp+f', 'gm+gp', 'gp+gw2', 'k+ko']);
	});

	it('n = 1: the other parent of the focus person\'s shown child is in, and the child keeps both parents', () => {
		const r = run(IMPLICIT, 'f', 1);
		expect(ids(r)).toEqual(['fa', 'f', 'cp', 'k']);
		expect(parentsIn(r, 'k')).toEqual(['f', 'cp']);
		expect(parentsIn(r, 'cp')).toEqual([]);
		expect(r.tree.unions).toEqual([]);
	});

	it('n = 1: an implicit co-parent whose shared child is outside stays out (ko: their child kk is 2 steps down)', () => {
		expect(ids(run(IMPLICIT, 'f', 1))).not.toContain('ko');
	});

	it('n = 1: the co-parent\'s own parent, listed partner and implicit partner stay out (one pass)', () => {
		const r = run(IMPLICIT, 'f', 1);
		for (const id of ['cpp', 'cpw', 'cpo', 'cpk']) expect(ids(r)).not.toContain(id);
	});

	it('n = 1: hidden counts implicit co-parents outside like partners', () => {
		const r = run(IMPLICIT, 'f', 1);
		// fa: parents gp and gm. cp: parent cpp, child cpk, listed partner cpw, implicit partner cpo.
		// k: child kk and implicit partner ko.
		expect(hidden(r)).toEqual({ fa: 2, cp: 4, k: 2 });
	});

	it('n = 2: an ancestor\'s implicit co-parent stays out when their child is out (gw2, hu); a shown grandchild brings in its other parent (ko)', () => {
		const r = run(IMPLICIT, 'f', 2);
		expect(ids(r)).toEqual(['gp', 'gm', 'gmx', 'fa', 'f', 'cp', 'k', 'ko', 'kk']);
		expect(parentsIn(r, 'fa')).toEqual(['gp', 'gm']);
		expect(parentsIn(r, 'kk')).toEqual(['k', 'ko']);
		expect(r.tree.unions.map((u) => u.index)).toEqual([0]);
		// gp: child hu and implicit partner gw2. gm: parent gmp. cp: as for n = 1.
		expect(hidden(r)).toEqual({ gp: 2, gm: 1, cp: 4 });
	});

	it('n = 0: no child is shown, so the implicit co-parent stays out and is counted', () => {
		const r = run(IMPLICIT, 'f', 0);
		expect(ids(r)).toEqual(['f']);
		// f: parent fa, child k, implicit partner cp.
		expect(hidden(r)).toEqual({ f: 3 });
	});

	const TYPES = `people:
  - {id: b1, name: B1}
  - {id: b2, name: B2}
  - {id: a1, name: A1}
  - {id: w1, name: W1}
  - {id: rm, name: RM}
  - {id: x, name: X}
  - {id: f, name: F}
  - {id: c, name: C, parents: [{id: f, type: adoptive}, {id: a1, type: adoptive}]}
  - {id: e, name: E, parents: [b1, b2, {id: f, type: ward}, {id: w1, type: ward}]}
  - {id: d, name: D, parents: [f, {id: rm, type: rumoured}]}
  - {id: y, name: Y, parents: [{id: f, type: rumoured}, {id: x, type: rumoured}]}
`;

	it('placement parents decide: a ward is drawn under its birth parents, an adopted child under both adoptive parents; rumoured never places', () => {
		const tree = parse(TYPES);
		expect(implicitPairs(tree)).toEqual(['a1+f', 'b1+b2']);
		const r = run(tree, 'f', 1);
		// c: placed under adoptive parents f and a1, so a1 comes in. e: f's ward, placed under birth
		// parents b1 and b2, so both come in and the ward co-parent w1 does not. d and y: rumoured
		// parents are never placement parents (§4.3), so rm and x stay out.
		expect(ids(r)).toEqual(['b1', 'b2', 'a1', 'f', 'c', 'e', 'd', 'y']);
		expect(parentsIn(r, 'c')).toEqual(['f:adoptive', 'a1:adoptive']);
		expect(parentsIn(r, 'e')).toEqual(['b1', 'b2', 'f:ward']);
		expect(parentsIn(r, 'd')).toEqual(['f']);
		expect(parentsIn(r, 'y')).toEqual(['f:rumoured']);
		expect(hidden(r)).toEqual({ e: 1, d: 1, y: 1 });
	});

	it('placement: ward puts the ward pair in instead, and the birth parents stay out', () => {
		const tree = parse(TYPES.replace('{id: w1, type: ward}]}', '{id: w1, type: ward}], placement: ward}'));
		expect(implicitPairs(tree)).toEqual(['a1+f', 'f+w1']);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['a1', 'w1', 'f', 'c', 'e', 'd', 'y']);
		expect(parentsIn(r, 'e')).toEqual(['f:ward', 'w1:ward']);
		expect(hidden(r)).toEqual({ e: 2, d: 1, y: 1 });
	});

	it('as deriveFamilies: the first two placement parents after ids that name no person; a third is not added', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: c, name: C}
  - {id: f, name: F}
  - {id: k, name: K, parents: [ghost, f, a, c]}
`);
		expect(implicitPairs(tree)).toEqual(['a+f']);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['a', 'f', 'k']);
		expect(parentsIn(r, 'k')).toEqual(['f', 'a']);
		expect(hidden(r)).toEqual({ k: 1 });
	});

	it('a listed union for the same couple gives the same people; the union is kept', () => {
		const listed = parse(`${IMPLICIT_YAML}  - partners: [f, cp]
    type: affair
`);
		expect(implicitPairs(listed)).not.toContain('cp+f');
		const r = run(listed, 'f', 1);
		expect(ids(r)).toEqual(['fa', 'f', 'cp', 'k']);
		expect(unionPartners(r)).toEqual(['f+cp']);
		expect(hidden(r)).toEqual({ fa: 2, cp: 4, k: 2 });
	});

	it('n = 0: a listed partner of the focus person is in without a shown child', () => {
		const listed = parse(`${IMPLICIT_YAML}  - partners: [f, cp]
`);
		const r = run(listed, 'f', 0);
		expect(ids(r)).toEqual(['f', 'cp']);
		// f: parent fa, child k. cp: parent cpp, children k and cpk, partners cpw and cpo.
		expect(hidden(r)).toEqual({ f: 2, cp: 5 });
	});
});

// ---------------------------------------------------------------------------------------------
// Adopted from the WP5.1 code review (scratch/review-5.1, e89bacd), adjusted to contract 618ddb7.

/** Placement parents that `deriveFamilies` gives each shown person, on the subgraph and on the whole tree. */
function placements(tree: Tree, r: FocusSubgraphResult, who: string[]) {
	const whole = deriveFamilies(tree);
	const sub = deriveFamilies(r.tree);
	return {
		sub: Object.fromEntries(who.map((id) => [id, sub.placementParents.get(id)])),
		whole: Object.fromEntries(who.map((id) => [id, whole.placementParents.get(id)])),
	};
}

describe('one parent-link rule: placed exactly as in the whole tree, or a root (contract 4a896b9)', () => {
	it('a partner whose father is shown and whose mother is not is a root, not drawn under the father alone', () => {
		const tree = parse(`people:
  - {id: gf, name: GF, sex: m}
  - {id: gm2, name: GM2, sex: f}
  - {id: fa, name: FA, parents: [gf]}
  - {id: f, name: F, parents: [fa]}
  - {id: u, name: U, parents: [gf, gm2]}
unions:
  - partners: [f, u]
`);
		// Focus f, n = 2: gf is f's grandfather (core); u is f's partner (not core), whose placement
		// parents are gf and gm2. gm2 is outside, so u has no parents in the subgraph.
		const r = run(tree, 'f', 2);
		expect(ids(r)).toEqual(['gf', 'fa', 'f', 'u']);
		expect(parentsIn(r, 'u')).toEqual([]);
		// gf: implicit partner gm2 (through u), child u (line not drawn). u: father gf (line not
		// drawn), mother gm2.
		expect(hidden(r)).toEqual({ gf: 2, u: 2 });
	});

	const INGRID = `people:
  - {id: pa, name: PA}
  - {id: al, name: AL, parents: [pa]}
  - {id: ro, name: RO, parents: [pa]}
  - {id: dl, name: DL}
  - {id: in, name: IN, parents: [ro, dl]}
  - {id: ra, name: RA, parents: [al, in]}
`;

	it('a person added as a placement parent, with one of her own placement parents outside, is a root', () => {
		// al has ra with his niece in. Focus al, n = 1: ra is a child, so in comes in as ra's placement
		// parent. Her father ro is al's brother (core), her mother dl is outside.
		const r = run(parse(INGRID), 'al', 1);
		expect(ids(r)).toEqual(['pa', 'al', 'ro', 'in', 'ra']);
		expect(parentsIn(r, 'in')).toEqual([]);
		expect(parentsIn(r, 'ra')).toEqual(['al', 'in']);
		// ro: implicit partner dl (through in), child in (line not drawn). in: father ro (line not
		// drawn), mother dl.
		expect(hidden(r)).toEqual({ ro: 2, in: 2 });
	});

	it('with both of her placement parents shown, she keeps them', () => {
		// A union ro + dl makes dl a listed partner of the core person ro.
		const r = run(parse(`${INGRID}unions:\n  - partners: [ro, dl]\n`), 'al', 1);
		expect(ids(r)).toEqual(['pa', 'al', 'ro', 'dl', 'in', 'ra']);
		expect(parentsIn(r, 'in')).toEqual(['ro', 'dl']);
		expect(hidden(r)).toEqual({});
	});

	it('a partner with a single placement parent shown keeps it (CROSS, n = 0: u under gf)', () => {
		expect(parentsIn(run(CROSS, 'f', 0), 'u')).toEqual(['gf']);
	});
});

describe('review 5.1: a shown child is drawn where the whole tree draws it (contract 618ddb7)', () => {
	it('f and q have k, k and r have m; focus f, n = 1: r is not in (m is out), and hidden counts r for k', () => {
		const tree = parse(`people:
  - {id: f, name: F}
  - {id: q, name: Q}
  - {id: k, name: K, parents: [f, q]}
  - {id: r, name: R}
  - {id: m, name: M, parents: [k, r]}
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['f', 'q', 'k']);
		// k: child m and implicit partner r.
		expect(hidden(r)).toEqual({ k: 2 });
		expect(deriveFamilies(r.tree).placementParents.get('k')).toEqual(['f', 'q']);
	});

	it('a rumoured child of the focus person is drawn under its placement parents b1 and b2, both in', () => {
		const tree = parse(`people:
  - {id: f, name: F}
  - {id: b1, name: B1}
  - {id: b2, name: B2}
  - {id: c, name: C, parents: [b1, b2, {id: f, type: rumoured}]}
unions:
  - {partners: [b1, b2], type: marriage}
  - {partners: [f, b1], type: affair}
`);
		expect(deriveFamilies(tree).placementParents.get('c')).toEqual(['b1', 'b2']);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['f', 'b1', 'b2', 'c']);
		expect(placements(tree, r, ['c'])).toEqual({ sub: { c: ['b1', 'b2'] }, whole: { c: ['b1', 'b2'] } });
		expect(hidden(r)).toEqual({});
	});

	it('the same without the affair: b1 and b2 come in only as the placement parents of c', () => {
		const tree = parse(`people:
  - {id: f, name: F}
  - {id: b1, name: B1}
  - {id: b2, name: B2}
  - {id: c, name: C, parents: [b1, b2, {id: f, type: rumoured}]}
unions:
  - {partners: [b1, b2], type: marriage}
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['f', 'b1', 'b2', 'c']);
		expect(unionPartners(r)).toEqual(['b1+b2']);
		expect(placements(tree, r, ['c'])).toEqual({ sub: { c: ['b1', 'b2'] }, whole: { c: ['b1', 'b2'] } });
	});

	it('step-parent adoption: the step-father\'s adopted child is drawn under its mother and birth father', () => {
		// f marries w; s is w's son by bf, adopted by f. s is placed under his birth parents.
		const tree = parse(`people:
  - {id: w, name: W, sex: f}
  - {id: bf, name: BF, sex: m}
  - {id: f, name: F, sex: m}
  - {id: s, name: S, parents: [w, bf, {id: f, type: adoptive}]}
unions:
  - partners: [f, w]
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['w', 'bf', 'f', 's']);
		expect(placements(tree, r, ['s'])).toEqual({ sub: { s: ['w', 'bf'] }, whole: { s: ['w', 'bf'] } });
		expect(hidden(r)).toEqual({});
	});

	it('step-parent adoption with placement: adoptive; focus on the birth father brings in the adoptive father', () => {
		const tree = parse(`people:
  - {id: w, name: W, sex: f}
  - {id: bf, name: BF, sex: m}
  - {id: f, name: F, sex: m}
  - {id: s, name: S, parents: [w, bf, {id: f, type: adoptive}], placement: adoptive}
unions:
  - partners: [f, w]
`);
		const r = run(tree, 'bf', 1);
		// s is drawn under f alone in the whole tree, so only f comes in; w stays out.
		expect(ids(r)).toEqual(['bf', 'f', 's']);
		expect(placements(tree, r, ['s'])).toEqual({ sub: { s: ['f'] }, whole: { s: ['f'] } });
		// s: birth mother w. f: partner w.
		expect(hidden(r)).toEqual({ s: 1, f: 1 });
	});

	it('placement: adoptive with the focus person as birth parent: a1 and a2 are in, d is placed under them, no placement issue', () => {
		const tree = parse(`people:
  - {id: f, name: F}
  - {id: a1, name: A1}
  - {id: a2, name: A2}
  - {id: d, name: D, parents: [f, {id: a1, type: adoptive}, {id: a2, type: adoptive}], placement: adoptive}
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['f', 'a1', 'a2', 'd']);
		expect(placements(tree, r, ['d'])).toEqual({ sub: { d: ['a1', 'a2'] }, whole: { d: ['a1', 'a2'] } });
		expect(deriveFamilies(r.tree).issues.map((i) => i.code)).not.toContain('placement-without-parents');
		expect(hidden(r)).toEqual({});
	});
});

// ---------------------------------------------------------------------------------------------

describe('the rest of the tree (contract)', () => {
	const tree = parse(`options:
  start: a
  focus: b
  generations: 2
  height: 500
  archive: shelf 3
houses:
  - id: h1
    name: House One
    color: "#112233"
  - id: h2
    name: House Two
people:
  - {id: a, name: A, house: h1, sex: m, born: '1100', title: Lord}
  - {id: b, name: B, house: h2, sex: f, parents: [a], illegitimate: true, link: '[[B]]', notes: Some notes}
  - {id: c, name: C, parents: [a]}
unions:
  - id: u1
    partners: [a, c]
    type: betrothal
    start: '1120'
`);

	it('options: only start changes, to the focus id; focus, generations and height stay', () => {
		const r = run(tree, 'c', 1);
		expect(r.tree.options).toEqual({ ...tree.options, start: 'c' });
		expect(r.tree.options.focus).toBe('b');
		expect(r.tree.options.generations).toBe(2);
	});

	it('a tree without options gets options with only start', () => {
		const r = run(LINE, 'p4', 1);
		expect(r.tree.options).toEqual({ start: 'p4' });
	});

	it('houses unchanged; people keep every field; the kept union is the original', () => {
		const r = run(tree, 'b', 1);
		expect(r.tree.houses).toEqual(tree.houses);
		expect(r.tree.people).toEqual(tree.people);
		expect(r.tree.unions).toEqual(tree.unions);
	});

	it('issues are empty even when the whole tree has issues', () => {
		const withIssues = parse(`people:
  - {id: a, name: A, parents: [ghost]}
  - {id: f, name: F, parents: [a], placement: sideways}
unions:
  - partners: [a]
`);
		expect(deriveFamilies(withIssues).issues.length).toBeGreaterThan(0);
		expect(run(withIssues, 'f', 1).tree.issues).toEqual([]);
	});

	it('people keep their index values, with gaps where people are left out (D2)', () => {
		const r = run(SIBLINGS, 'f', 0);
		const index = new Map(SIBLINGS.people.map((p) => [p.id, p.index]));
		expect(r.tree.people.map((p) => p.index)).toEqual(ids(r).map((id) => index.get(id)));
	});

	it('an unknown id gives null', () => {
		expect(subgraph(LINE, 'nobody', 3)).toBeNull();
		expect(subgraph(LINE, '', 3)).toBeNull();
		expect(subgraph(parse('people: []\n'), 'a', 3)).toBeNull();
		expect(subgraph(parse(''), 'a', 3)).toBeNull();
	});

	it('the same input gives the same output', () => {
		expect(subgraph(PARTNERS, 'f', 1)).toEqual(subgraph(PARTNERS, 'f', 1));
		expect(subgraph(PARTNERS, 'f', 1)).toEqual(subgraph(structuredClone(PARTNERS), 'f', 1));
	});
});

// ---------------------------------------------------------------------------------------------

describe('never throws: cycles, dangling ids, malformed entries (§8)', () => {
	it('a parent cycle: a and b are each other\'s parent', () => {
		const tree = parse(`people:
  - {id: a, name: A, parents: [b]}
  - {id: b, name: B, parents: [a]}
  - {id: f, name: F, parents: [a]}
`);
		// f: ancestors a, b. b is also a child of a, so a sibling. The whole tree breaks the cycle by
		// dropping one of the two links; the subgraph draws only the one the whole tree draws.
		const r = run(tree, 'f', 3);
		expect(ids(r)).toEqual(['a', 'b', 'f']);
		expect(parentsIn(r, 'f')).toEqual(['a']);
		expect([...parentsIn(r, 'a'), ...parentsIn(r, 'b')]).toHaveLength(1);
		// The dropped link never counts in hidden, although a and b are both inside (d10284b).
		expect(hidden(r)).toEqual({});
		expect(ids(run(tree, 'a', 1))).toEqual(['a', 'b', 'f']);
		for (const n of [0, 1, 2, 3, 100]) for (const id of ['a', 'b', 'f']) expect(() => subgraph(tree, id, n)).not.toThrow();
	});

	it('a person who is their own parent: the self-link is never drawn', () => {
		const tree = parse(`people:
  - {id: s, name: S, parents: [s]}
  - {id: k, name: K, parents: [s]}
`);
		const r = run(tree, 's', 3);
		expect(ids(r)).toEqual(['s', 'k']);
		expect(parentsIn(r, 's')).toEqual([]);
		expect(parentsIn(r, 'k')).toEqual(['s']);
		expect(hidden(r)).toEqual({});
	});

	it('dangling ids: parents and partners that are not people are dropped, not counted', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: f, name: F, parents: [a, ghost, {id: phantom, type: rumoured}]}
  - {id: k, name: K, parents: [f, nobody]}
unions:
  - partners: [f, missing]
  - partners: [a, f]
`);
		const r = run(tree, 'f', 1);
		expect(ids(r)).toEqual(['a', 'f', 'k']);
		expect(parentsIn(r, 'f')).toEqual(['a']);
		expect(parentsIn(r, 'k')).toEqual(['f']);
		expect(unionPartners(r)).toEqual(['a+f']);
		expect(hidden(r)).toEqual({});
	});

	it('unions with one, three or the same partner twice', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: f, name: F, parents: [a]}
  - {id: o, name: O}
unions:
  - partners: [f]
  - partners: [f, f]
  - partners: [a, f, o]
  - partners: []
`);
		for (const n of [0, 1, 3]) {
			const r = run(tree, 'f', n);
			expect(ids(r)).toContain('f');
		}
	});

	it('duplicate person ids (a blocking issue) and a person without an id', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: a, name: A again}
  - {id: f, name: F, parents: [a]}
  - {name: No id, parents: [f]}
`);
		for (const p of tree.people) expect(() => subgraph(tree, p.id, 3)).not.toThrow();
		expect(subgraph(tree, 'f', 3)).not.toBeNull();
	});

	it('duplicate person ids: the first entry wins, as in deriveFamilies (d10284b)', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: m, name: M}
  - {id: f, name: F, parents: [a]}
  - {id: f, name: F again, parents: [m]}
  - {id: k, name: K, parents: [f]}
`);
		// f's parent is a (first entry); m is nobody's parent.
		const r = run(tree, 'f', 1);
		expect([...new Set(ids(r))]).toEqual(['a', 'f', 'k']);
		expect(parentsIn(r, 'f')).toEqual(['a']);
		expect(hidden(r)).toEqual({});
		const m = run(tree, 'm', 1);
		expect(ids(m)).toEqual(['m']);
		expect(hidden(m)).toEqual({});
	});

	it('a line of 20 000 generations with a huge n (no recursion limit)', () => {
		const people: Person[] = [];
		for (let i = 0; i < 20000; i++) {
			people.push({ id: `p${i}`, name: `P${i}`, parents: i ? [{ id: `p${i - 1}`, type: 'birth' }] : [], illegitimate: false, index: i });
		}
		const tree: Tree = { options: {}, houses: [], people, unions: [], issues: [] };
		const r = subgraph(tree, 'p10000', 1_000_000);
		expect(r?.tree.people.length).toBe(20000);
		expect(r?.hidden.size).toBe(0);
		const deep = subgraph(tree, 'p10000', 3);
		expect(deep?.tree.people.map((p) => p.id)).toEqual(['p9997', 'p9998', 'p9999', 'p10000', 'p10001', 'p10002', 'p10003']);
	}, 30_000);

	it('a long parent cycle with a huge n', () => {
		const people: Person[] = [];
		const size = 5000;
		for (let i = 0; i < size; i++) people.push({ id: `c${i}`, name: `C${i}`, parents: [{ id: `c${(i + 1) % size}`, type: 'birth' }], illegitimate: false, index: i });
		const tree: Tree = { options: {}, houses: [], people, unions: [], issues: [] };
		const r = subgraph(tree, 'c0', 1_000_000);
		expect(r?.tree.people.length).toBe(size);
	}, 30_000);
});

// ---------------------------------------------------------------------------------------------
// The model below is the contract's rule, written again here, not copied from the implementation.
// It takes placement parents, drawn links and implicit unions from `deriveFamilies` on the whole
// tree, because the contract defines them that way. Membership uses parent links as written
// (self-links and ids that name no person ignored; the first entry of a duplicate id), so cycles
// and duplicate ids are fine.

interface Model {
	core: Set<string>;
	ids: Set<string>;
	hidden: Map<string, number>;
}

function modelFamily(tree: Tree, focus: string, n: number): Model {
	const g = wholeGraph(tree);
	const parents = new Map<string, Set<string>>();
	const children = new Map<string, Set<string>>();
	const listed = new Map<string, Set<string>>();
	const implicit = new Map<string, Set<string>>();
	const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
	for (const p of g.people) {
		for (const ref of p.parents) {
			if (!g.byId.has(ref.id) || ref.id === p.id) continue;
			add(parents, p.id, ref.id);
			add(children, ref.id, p.id);
		}
	}
	for (const u of g.unions) {
		const [a, b] = u.partners;
		add(u.implicit ? implicit : listed, a, b);
		add(u.implicit ? implicit : listed, b, a);
	}
	const of = (m: Map<string, Set<string>>, id: string) => [...(m.get(id) ?? [])];
	const walk = (m: Map<string, Set<string>>): string[] => {
		const seen = new Set<string>([focus]);
		let frontier = [focus];
		for (let step = 0; step < n; step++) {
			const next: string[] = [];
			for (const id of frontier) {
				for (const q of of(m, id)) {
					if (seen.has(q)) continue;
					seen.add(q);
					next.push(q);
				}
			}
			frontier = next;
		}
		return [...seen];
	};
	const core = new Set<string>([focus, ...walk(parents), ...walk(children)]);
	for (const p of of(parents, focus)) for (const s of of(children, p)) core.add(s);
	const family = new Set(core);
	for (const id of core) for (const q of of(listed, id)) family.add(q);
	const before = new Set(family);
	for (const id of core) {
		if (!of(parents, id).some((q) => before.has(q))) continue;
		for (const q of g.placementParents.get(id) ?? []) family.add(q);
	}
	const kept = new Map<string, Set<string>>();
	for (const p of g.people) if (family.has(p.id)) kept.set(p.id, new Set(keptParents(g, p, family).map((r) => r.id)));
	const drawnWhole = new Map<string, Set<string>>();
	for (const p of g.people) drawnWhole.set(p.id, new Set([...drawnLinks(g, p.id)].map((k) => (JSON.parse(k) as string[])[0])));
	// A relation over a link the whole tree does not draw (cycle breaking) never counts.
	const notDrawnHere = (child: string, parent: string) =>
		drawnWhole.get(child)!.has(parent) && !(family.has(child) && family.has(parent) && kept.get(child)!.has(parent));
	const hiddenMap = new Map<string, number>();
	for (const id of family) {
		const notDrawn = new Set<string>();
		for (const q of of(parents, id)) if (notDrawnHere(id, q)) notDrawn.add(q);
		for (const q of of(children, id)) if (notDrawnHere(q, id)) notDrawn.add(q);
		for (const q of [...of(listed, id), ...of(implicit, id)]) if (!family.has(q)) notDrawn.add(q);
		if (notDrawn.size) hiddenMap.set(id, notDrawn.size);
	}
	return { core, ids: family, hidden: hiddenMap };
}

/** Every person of `tree` as the focus: shape, exact family and hidden counts, a second call. */
function modelProblems(tree: Tree, n: number): string[] {
	const problems: string[] = [];
	for (const p of tree.people) {
		const r = subgraph(tree, p.id, n);
		if (!r) {
			problems.push(`${p.id}: null`);
			continue;
		}
		const want = modelFamily(tree, p.id, n);
		problems.push(...shapeProblems(tree, p.id, r));
		const got = new Set(r.tree.people.map((x) => x.id));
		const missing = [...want.ids].filter((id) => !got.has(id));
		const extra = [...got].filter((id) => !want.ids.has(id));
		if (missing.length || extra.length) problems.push(`${p.id}: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
		if (!isDeepStrictEqual(r.hidden, want.hidden)) {
			problems.push(`${p.id}: hidden ${JSON.stringify([...r.hidden])}, want ${JSON.stringify([...want.hidden])}`);
		}
		const again = subgraph(tree, p.id, n);
		if (!again || !same(again.tree, r.tree) || !isDeepStrictEqual([...again.hidden], [...r.hidden])) problems.push(`${p.id}: a second call differs`);
	}
	return problems;
}

const hasDuplicateIds = (tree: Tree) => deriveFamilies(tree).issues.some((i) => i.code === 'duplicate-person-id');

const F7 = parse(fixtureSource('07'));
/**
 * Fixture 7 with every union removed: each couple with children becomes an implicit union, so
 * the implicit co-parent rules are checked at scale. (No sample tree has an implicit union.)
 */
const F7_IMPLICIT: Tree = { ...F7, unions: [] };

describe('the model on every other tree, every focus person, n = 0 to 3', () => {
	const trees: [string, Tree][] = [
		['LINE', LINE],
		['SIBLINGS', SIBLINGS],
		['PARTNERS', PARTNERS],
		['CROSS', CROSS],
		['COLLAPSE', COLLAPSE],
		['IMPLICIT', IMPLICIT],
		...allFixtures()
			.filter((f) => f.id !== '07')
			.map((f): [string, Tree] => [`sample tree ${f.id}`, parse(f.source)]),
	];

	it('sample tree 5 is in the list (cycles and duplicate ids)', () => {
		expect(trees.filter(([, t]) => hasDuplicateIds(t)).map(([name]) => name)).toEqual(['sample tree 05']);
	});

	for (const [name, tree] of trees) {
		it(`${name}: n = 0 to 3`, () => {
			for (const n of [0, 1, 2, 3]) expect(modelProblems(tree, n).slice(0, 20)).toEqual([]);
		});
	}
});

describe('fixture 7: every person as the focus (§5.6, §7.7, §8)', () => {
	// Adopted from the G5 audit of M5 (scratch/g5-m5, 6fbb13e).
	it('a focus family is laid out separately and cached (§5.6, §7.7): the same family again is the cached result, another family a new layout', () => {
		const lay = (id: string) => layoutTree(deriveFamilies(focusSubgraph(F7, id, 3)!.tree), geometry(), SETTINGS, FONT_FAMILY);
		const a = lay('thea-valmont');
		expect(lay('thea-valmont')).toBe(a);
		const inA = new Set(focusSubgraph(F7, 'thea-valmont', 3)!.tree.people.map((p) => p.id));
		const other = F7.people.find((p) => !inA.has(p.id))!.id;
		const b = lay(other);
		expect(b).not.toBe(a);
		expect(b.layout.persons.size).toBeLessThan(new Set(F7.people.map((p) => p.id)).size);
	});

	it('fixture 7 has no issues; without unions it has many implicit unions', () => {
		expect(deriveFamilies(F7).issues).toEqual([]);
		expect(F7.people.length).toBeGreaterThan(300);
		expect(deriveFamilies(F7_IMPLICIT).unions.filter((u) => u.implicit).length).toBeGreaterThan(50);
	});

	for (const n of [0, 1, 3]) {
		it(`n = ${n}: not null, the right shape, the exact family and hidden counts, deterministic`, () => {
			const before = structuredClone(F7);
			expect(modelProblems(F7, n).slice(0, 20)).toEqual([]);
			expect(F7).toEqual(before);
		}, 60_000);

		it(`n = ${n}, every union removed (implicit co-parents only): the exact family and hidden counts`, () => {
			expect(modelProblems(F7_IMPLICIT, n).slice(0, 20)).toEqual([]);
		}, 60_000);
	}

	it('every focus family of n = 3 derives and lays out: no throw, every card placed, no broken reference', () => {
		const problems: string[] = [];
		for (const p of F7.people) {
			const r = subgraph(F7, p.id, DEFAULT_FOCUS_GENERATIONS);
			if (!r) {
				problems.push(`${p.id}: null`);
				continue;
			}
			try {
				const g = deriveFamilies(r.tree);
				const broken = g.issues.filter((i) => i.code === 'missing-parent' || i.code === 'missing-partner' || i.code === 'missing-start');
				if (broken.length) problems.push(`${p.id}: ${broken.map((i) => i.code).join(', ')}`);
				const { layout } = layoutTree(g, geometry(), SETTINGS, FONT_FAMILY);
				const placed = r.tree.people.filter((x) => !layout.persons.has(x.id)).map((x) => x.id);
				if (placed.length) problems.push(`${p.id}: no card for ${placed.join(', ')}`);
			} catch (e) {
				problems.push(`${p.id}: threw ${String(e)}`);
			}
		}
		expect(problems.slice(0, 20)).toEqual([]);
	}, 60_000);
});

// ---------------------------------------------------------------------------------------------

/**
 * For every focus person and n = 0, 1, 3: the exact parent-link rule, and each person in the subgraph who has a parent there gets the same placement parents
 * from `deriveFamilies` on the subgraph as on the whole tree, with no `placement-without-parents`
 * issue that the whole tree does not have too (sample tree 5 has one on purpose).
 */
function placementProblems(tree: Tree): string[] {
	const whole = wholeGraph(tree);
	const hasPlacementIssue = (g: FamilyGraph, id: string) => g.issues.some((i) => i.code === 'placement-without-parents' && i.ids?.includes(id));
	const problems: string[] = [];
	for (const p of whole.people) {
		for (const n of [0, 1, 3]) {
			const r = subgraph(tree, p.id, n);
			if (!r) {
				problems.push(`focus ${p.id}: null`);
				continue;
			}
			problems.push(...shapeProblems(tree, p.id, r).map((m) => `n = ${n}: ${m}`));
			const sub = deriveFamilies(r.tree);
			for (const q of sub.people) {
				if (!q.parents.some((ref) => ref.id !== q.id && sub.byId.has(ref.id))) continue;
				const got = sub.placementParents.get(q.id);
				const want = whole.placementParents.get(q.id);
				if (!isDeepStrictEqual(got, want)) problems.push(`focus ${p.id}, n = ${n}: ${q.id} under ${JSON.stringify(got)}, whole tree ${JSON.stringify(want)}`);
				if (hasPlacementIssue(sub, q.id) && !hasPlacementIssue(whole, q.id)) problems.push(`focus ${p.id}, n = ${n}: ${q.id} has placement-without-parents`);
			}
		}
	}
	return problems;
}

describe('every shown person with a parent shown is placed as in the whole tree (contract 4a896b9)', () => {
	const trees: [string, Tree][] = [
		...allFixtures().map((f): [string, Tree] => [`sample tree ${f.id}`, parse(f.source)]),
		['sample tree 07 without unions', F7_IMPLICIT],
	];
	for (const [name, tree] of trees) {
		it(name, () => {
			expect(placementProblems(tree).slice(0, 10)).toEqual([]);
		}, 60_000);
	}

	it('sample tree 7 without unions, focus aldric-valmont, n = 1: Ingrid (his niece, mother of his son Raoul) is a root', () => {
		// Ingrid comes in as a placement parent of Raoul. Her father Roderick (Aldric's brother) is
		// shown, her mother Delphine is not, so she has no parents in the subgraph.
		const r = run(F7_IMPLICIT, 'aldric-valmont', 1);
		expect(ids(r)).toEqual(expect.arrayContaining(['aldric-valmont', 'roderick-valmont', 'ingrid-valmont', 'raoul-valmont-2']));
		expect(ids(r)).not.toContain('delphine-redfern');
		expect(parentsIn(r, 'ingrid-valmont')).toEqual([]);
		expect(deriveFamilies(r.tree).placementParents.get('raoul-valmont-2')).toEqual(['aldric-valmont', 'ingrid-valmont']);
		// Ingrid: her mother Delphine is outside; the line to her father Roderick is not drawn.
		expect(r.hidden.get('ingrid-valmont')).toBe(2);
	});

	it('sample tree 7, focus odette-valmont, n = 1: Roderick (2), placed with adoptive parents who are not shown, is a root', () => {
		// He is in as the listed partner of Sybil. His birth parents Percival and Adela are shown, his
		// adoptive parents (his placement parents) are not, so he is not drawn under the birth pair.
		const r = run(F7, 'odette-valmont', 1);
		expect(ids(r)).toEqual(expect.arrayContaining(['roderick-valmont-2', 'sybil-harrow-2', 'percival-valmont', 'adela-orsini']));
		expect(ids(r)).not.toContain('rowan-harrow');
		expect(ids(r)).not.toContain('cecily-bryce');
		expect(parentsIn(r, 'roderick-valmont-2')).toEqual([]);
		expect(r.hidden.get('roderick-valmont-2')).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------------------------
// Adopted from the WP5.1 review, round 2 (scratch/review-5.1-r2, de28dcc), as standing properties,
// with the exact results of contract 4a896b9 added to the named cases.

/** People drawn under a placement couple (or one parent) that differs from the whole tree's. */
function misplaced(tree: Tree, focus: string, n: number): string[] {
	const whole = wholeGraph(tree);
	const res = subgraph(tree, focus, n);
	if (!res) return [`focus ${focus} n=${n}: null`];
	const sub = deriveFamilies(res.tree);
	const out: string[] = [];
	for (const p of sub.people) {
		const got = sub.placementParents.get(p.id) ?? [];
		const want = whole.placementParents.get(p.id) ?? [];
		if (got.length && got.join('+') !== want.join('+')) out.push(`focus ${focus} n=${n}: ${p.id} under [${got.join(', ')}] but whole tree [${want.join(', ')}]`);
	}
	return out;
}

/** Cards in a focus family with no line to any other card (the focus person and siblings may stand alone). */
function alone(tree: Tree, focus: string, n: number): string[] {
	const res = subgraph(tree, focus, n);
	if (!res) return [`focus ${focus} n=${n}: null`];
	const g = deriveFamilies(res.tree);
	if (g.people.length < 2) return [];
	const linked = new Set<string>();
	for (const q of g.people) for (const r of q.parents) if (g.byId.has(r.id) && r.id !== q.id) linked.add(q.id).add(r.id);
	for (const u of g.unions) for (const id of u.partners) linked.add(id);
	const parents = new Set(tree.people.find((p) => p.id === focus)!.parents.map((r) => r.id));
	const allowed = new Set([focus, ...tree.people.filter((p) => p.parents.some((r) => parents.has(r.id))).map((p) => p.id)]);
	return g.people.filter((q) => !linked.has(q.id) && !allowed.has(q.id)).map((q) => `focus ${focus} n=${n}: ${q.id}`);
}

const RANDOM = Array.from({ length: 300 }, (_, i) => parse(randomTree(i + 1)));

/** The same random tree with one more link that closes a parent cycle: the first person gets the last as a parent. */
function withCycle(tree: Tree): Tree {
	const last = tree.people[tree.people.length - 1];
	const people = [...tree.people];
	people[0] = { ...people[0], parents: [...people[0].parents, { id: last.id, type: 'birth' }] };
	return { ...tree, people };
}

describe('review 5.1 round 2: nobody is placed differently from the whole tree (contract 4a896b9)', () => {
	it('a core person whose parent comes in only through the placement pass is a root, not under one parent of a couple', () => {
		// f and s are children of q and r. d is their half-brother (q and w) and s is his guardian
		// (ward). Focus f, n = 0: d has a parent (s) in the family, so the pass brings q and w.
		// f and s have q inside but r outside, so they are roots.
		const tree = parse(`people:
  - {id: q, name: Q}
  - {id: r, name: R}
  - {id: w, name: W}
  - {id: f, name: F, parents: [q, r]}
  - {id: s, name: S, parents: [q, r]}
  - {id: d, name: D, parents: [q, w, {id: s, type: ward}]}
`);
		expect(misplaced(tree, 'f', 0)).toEqual([]);
		const r = run(tree, 'f', 0);
		expect(ids(r)).toEqual(['q', 'w', 'f', 's', 'd']);
		expect(parentsIn(r, 'f')).toEqual([]);
		expect(parentsIn(r, 's')).toEqual([]);
		expect(parentsIn(r, 'd')).toEqual(['q', 'w', 's:ward']);
		// q: children f and s (links not drawn) and partner r. f and s: parent q (not drawn), parent r.
		expect(hidden(r)).toEqual({ q: 3, f: 2, s: 2 });
	});

	it('the same gap with a secondary parent: f is a root, not under her adoptive stepfather', () => {
		// f's mother is q; a is f's adoptive stepfather. d is a's son by m, and s (f's sister) is
		// d's guardian. Focus f, n = 0: the pass brings a and m for d.
		const tree = parse(`people:
  - {id: q, name: Q}
  - {id: a, name: A}
  - {id: m, name: M}
  - {id: f, name: F, parents: [q, {id: a, type: adoptive}]}
  - {id: s, name: S, parents: [q]}
  - {id: d, name: D, parents: [a, m, {id: s, type: ward}]}
`);
		expect(misplaced(tree, 'f', 0)).toEqual([]);
		const r = run(tree, 'f', 0);
		expect(ids(r)).toEqual(['a', 'm', 'f', 's', 'd']);
		expect(parentsIn(r, 'f')).toEqual([]);
		expect(parentsIn(r, 'd')).toEqual(['a', 'm', 's:ward']);
		// a: child f (link not drawn). f: parent q outside, parent a (not drawn). s: parent q.
		expect(hidden(r)).toEqual({ a: 1, f: 2, s: 1 });
	});

	it('uncle–niece at n = 0: the niece is a root, and hidden counts the undrawn line on both cards', () => {
		// s is f's brother and is married to x, f's daughter by y. Focus f, n = 0.
		const tree = parse(`people:
  - {id: q, name: Q}
  - {id: y, name: Y}
  - {id: f, name: F, parents: [q]}
  - {id: s, name: S, parents: [q]}
  - {id: x, name: X, parents: [f, y]}
unions:
  - {partners: [s, x]}
`);
		const r = run(tree, 'f', 0);
		expect(ids(r)).toEqual(['f', 's', 'x']);
		expect(parentsIn(r, 'x')).toEqual([]);
		// f: parent q, child x (not drawn), implicit partner y. s: parent q. x: parent f (not drawn), parent y.
		expect(hidden(r)).toEqual({ f: 3, s: 1, x: 2 });
	});

	it('three birth parents, placement to an absent type, a child of two siblings: drawn as in the whole tree', () => {
		const three = parse(`people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: c, name: C}
  - {id: k, name: K, parents: [a, b, c]}
`);
		for (const id of ['a', 'b', 'c', 'k']) for (const n of [0, 1, 2]) expect(misplaced(three, id, n)).toEqual([]);
		const absent = parse(`people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: w, name: W}
  - {id: k, name: K, parents: [a, b, {id: w, type: ward}], placement: adoptive}
`);
		for (const id of ['a', 'b', 'w', 'k']) for (const n of [0, 1]) expect(misplaced(absent, id, n)).toEqual([]);
		const sibs = parse(`people:
  - {id: q, name: Q}
  - {id: r, name: R}
  - {id: s1, name: S1, parents: [q, r]}
  - {id: s2, name: S2, parents: [q, r]}
  - {id: k, name: K, parents: [s1, s2]}
`);
		for (const id of ['q', 's1', 's2', 'k']) for (const n of [0, 1, 2]) expect(misplaced(sibs, id, n)).toEqual([]);
	});

	it('300 random trees, n = 0 to 3: nobody is drawn under a different couple than in the whole tree', () => {
		const out: string[] = [];
		RANDOM.forEach((tree, i) => {
			for (const p of tree.people) for (const n of [0, 1, 2, 3]) for (const m of misplaced(tree, p.id, n)) out.push(`seed ${i + 1}: ${m}`);
		});
		expect({ count: out.length, first: out.slice(0, 6) }).toEqual({ count: 0, first: [] });
	}, 120_000);

	it('300 random trees with a parent cycle, n = 0 to 3: nobody is drawn under a parent the whole tree does not draw them under', () => {
		const out: string[] = [];
		RANDOM.forEach((plain, i) => {
			const tree = withCycle(plain);
			const whole = wholeGraph(tree);
			for (const p of tree.people) {
				for (const n of [0, 1, 2, 3]) {
					const res = subgraph(tree, p.id, n);
					if (!res) {
						out.push(`seed ${i + 1}: focus ${p.id}: null`);
						continue;
					}
					const sub = deriveFamilies(res.tree);
					for (const q of sub.people) {
						const got = sub.placementParents.get(q.id) ?? [];
						const want = whole.placementParents.get(q.id) ?? [];
						if (got.some((x) => !want.includes(x))) out.push(`seed ${i + 1}: focus ${p.id} n=${n}: ${q.id} under [${got.join(', ')}] but whole tree [${want.join(', ')}]`);
					}
				}
			}
		});
		expect({ count: out.length, first: out.slice(0, 6) }).toEqual({ count: 0, first: [] });
	}, 120_000);

	it('sample trees 7 (with and without unions) and 300 random trees, n = 0, 1, 3: no card is cut off from every other card', () => {
		const out: string[] = [];
		for (const tree of [F7_IMPLICIT, F7, ...RANDOM]) for (const p of tree.people) for (const n of [0, 1, 3]) out.push(...alone(tree, p.id, n));
		expect({ count: out.length, first: out.slice(0, 6) }).toEqual({ count: 0, first: [] });
	}, 120_000);
});

describe('random trees: the exact rule and the placement property (contract 4a896b9)', () => {
	it('100 random trees with and without a parent cycle, n = 0 to 3: the exact family, parent links and hidden counts of the model', () => {
		const out: string[] = [];
		RANDOM.slice(0, 100).forEach((plain, i) => {
			for (const tree of [plain, withCycle(plain)]) for (const n of [0, 1, 2, 3]) for (const m of modelProblems(tree, n)) out.push(`seed ${i + 1}, n = ${n}: ${m}`);
		});
		expect({ count: out.length, first: out.slice(0, 6) }).toEqual({ count: 0, first: [] });
	}, 120_000);

	it('100 random trees with and without a parent cycle, n = 0, 1, 3: the placement property and the parent-link rule', () => {
		const out: string[] = [];
		RANDOM.slice(0, 100).forEach((plain, i) => {
			for (const tree of [plain, withCycle(plain)]) out.push(...placementProblems(tree).map((m) => `seed ${i + 1}: ${m}`));
		});
		expect({ count: out.length, first: out.slice(0, 6) }).toEqual({ count: 0, first: [] });
	}, 120_000);
});

// ---------------------------------------------------------------------------------------------

describe('focusGenerationsFor: n for a tree (§5.6, §9, contract FocusGenerationsFor)', () => {
	const generationsFor: FocusGenerationsFor = focusGenerationsFor;

	it('a whole number ≥ 0 in options.generations wins over the setting', () => {
		expect(generationsFor({ generations: 2 }, 5)).toBe(2);
		expect(generationsFor({ generations: 0 }, 5)).toBe(0);
		expect(generationsFor({ generations: 7 })).toBe(7);
	});

	for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
		it(`options.generations = ${String(bad)} → the setting`, () => {
			expect(generationsFor({ generations: bad }, 4)).toBe(4);
			expect(generationsFor({ generations: bad }, 0)).toBe(0);
		});
	}

	it('no options at all → the setting', () => {
		expect(generationsFor({}, 5)).toBe(5);
	});

	for (const bad of [-2, 2.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
		it(`an invalid option and setting = ${String(bad)} → 3`, () => {
			expect(generationsFor({}, bad)).toBe(DEFAULT_FOCUS_GENERATIONS);
			expect(generationsFor({ generations: -1 }, bad)).toBe(3);
		});
	}
});
