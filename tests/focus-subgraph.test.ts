import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { DEFAULT_FOCUS_GENERATIONS } from '../src/core/focus';
import { focusGenerations, focusGenerationsFor, focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import type { Person, Tree, TreeOptions } from '../src/core/types';
import { randomTree } from './random-trees';

// Internals of WP5.1 that tests/acceptance/focus-subgraph.test.ts does not reach: placement
// parents taken from deriveFamilies, duplicate ids, degenerate unions, copies, and wide trees.

function parse(yaml: string): Tree {
	const r = parseDynasty(yaml);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}

function run(tree: Tree, focus: string, n: number) {
	const r = focusSubgraph(tree, focus, n);
	if (!r) throw new Error(`no result for ${focus}`);
	return { ids: r.tree.people.map((p) => p.id), hidden: Object.fromEntries(r.hidden), r };
}

describe('focusGenerations and focusGenerationsFor', () => {
	it('keeps whole numbers from 0; anything else is the default', () => {
		expect([0, 1, 7, 1_000_000].map(focusGenerations)).toEqual([0, 1, 7, 1_000_000]);
		for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(focusGenerations(bad)).toBe(DEFAULT_FOCUS_GENERATIONS);
	});

	it('options.generations first, then the setting, then 3 (§5.6, §9)', () => {
		expect(focusGenerationsFor({ generations: 2 }, 5)).toBe(2);
		expect(focusGenerationsFor({ generations: 0 }, 5)).toBe(0);
		expect(focusGenerationsFor({}, 5)).toBe(5);
		expect(focusGenerationsFor({ generations: -1 }, 5)).toBe(5);
		expect(focusGenerationsFor({ generations: 1.5 }, 0)).toBe(0);
		expect(focusGenerationsFor({ generations: 1.5 }, -2)).toBe(DEFAULT_FOCUS_GENERATIONS);
		expect(focusGenerationsFor({})).toBe(DEFAULT_FOCUS_GENERATIONS);
		expect(focusGenerationsFor({ generations: '2' as unknown as number }, Number.NaN)).toBe(DEFAULT_FOCUS_GENERATIONS);
		expect(focusGenerationsFor(undefined as unknown as TreeOptions, 4)).toBe(4);
	});
});

describe('placement parents of shown children, exactly as deriveFamilies places them', () => {
	it('an implicit co-parent comes in only through a shown child; outside, it counts in hidden', () => {
		const tree = parse('people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a, b]}\n');
		expect(run(tree, 'a', 0)).toMatchObject({ ids: ['a'], hidden: { a: 2 } });
		expect(run(tree, 'a', 1)).toMatchObject({ ids: ['a', 'b', 'c'], hidden: {} });
		// c is shown, but none of its parents: nothing is added.
		expect(run(tree, 'c', 0)).toMatchObject({ ids: ['c'], hidden: { c: 2 } });
	});

	it('only the two placement parents: not a rumoured parent, not a third parent of the type', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: b, name: B}
  - {id: d, name: D}
  - {id: r, name: R}
  - {id: c, name: C, parents: [a, b, d, {id: r, type: rumoured}]}
`);
		expect(run(tree, 'a', 1)).toMatchObject({ ids: ['a', 'b', 'c'], hidden: { c: 2 } });
		expect(run(tree, 'd', 1)).toMatchObject({ ids: ['a', 'b', 'd', 'c'], hidden: { c: 1 } });
		expect(run(tree, 'r', 1)).toMatchObject({ ids: ['a', 'b', 'r', 'c'], hidden: { c: 1 } });
	});

	it('placement decides the couple: adoptive parents come in only when they place the child', () => {
		const base = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: x, name: X}\n';
		const kid = (extra: string) => parse(`${base}  - {id: c, name: C, parents: [x, {id: a, type: adoptive}, {id: b, type: adoptive}]${extra}}\n`);
		expect(run(kid(''), 'x', 1)).toMatchObject({ ids: ['x', 'c'], hidden: { c: 2 } });
		expect(run(kid(', placement: adoptive'), 'x', 1)).toMatchObject({ ids: ['a', 'b', 'x', 'c'], hidden: {} });
	});

	it('a rumoured child of the focus person brings the couple it is placed under', () => {
		const tree = parse('people:\n  - {id: p, name: P}\n  - {id: q, name: Q}\n  - {id: f, name: F}\n  - {id: k, name: K, parents: [p, q, {id: f, type: rumoured}]}\n');
		expect(run(tree, 'f', 1)).toMatchObject({ ids: ['p', 'q', 'f', 'k'], hidden: {} });
	});

	it('an unknown parent type is read as birth, as derive reads it', () => {
		const tree = parse('people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a, {id: b, type: foster}]}\n');
		const r = run(tree, 'a', 1);
		expect(r).toMatchObject({ ids: ['a', 'b', 'c'], hidden: {} });
		expect(r.r.tree.people[2].parents).toEqual([{ id: 'a', type: 'birth' }, { id: 'b', type: 'foster' }]);
	});

	it('a listed union and the same couple as parents count as one partner', () => {
		const tree = parse('people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n  - {id: c, name: C, parents: [a, b]}\nunions:\n  - partners: [b, a]\n');
		expect(run(tree, 'c', 0).hidden).toEqual({ c: 2 });
		expect(run(tree, 'a', 0).hidden).toEqual({ a: 1, b: 1 });
	});

	it('one pass against the family before the pass: a parent added by the pass adds nobody', () => {
		// y is the child of f and f's grandfather g. y brings g in; g is also a's parent, but a had
		// no parent in the family before the pass, so a's other parent h stays out.
		const tree = parse(`people:
  - {id: g, name: G}
  - {id: h, name: H}
  - {id: a, name: A, parents: [g, h]}
  - {id: f, name: F, parents: [a]}
  - {id: y, name: Y, parents: [f, g]}
`);
		const r = run(tree, 'f', 1);
		// a's couple g + h is split, so a is a root; the dropped link g → a counts on both cards.
		expect(r).toMatchObject({ ids: ['g', 'a', 'f', 'y'], hidden: { g: 2, a: 2 } });
		expect(r.r.tree.people[1].parents).toEqual([]);
	});

	it('a partner with only one placement parent inside is drawn as a root (contract 62e55a5)', () => {
		// f marries w and w's mother d. w's father x is outside, so w keeps no parent link.
		const yaml = 'people:\n  - {id: d, name: D}\n  - {id: x, name: X}\n  - {id: w, name: W, parents: [d, x]}\n  - {id: f, name: F}\nunions:\n  - partners: [f, w]\n  - partners: [f, d]\n';
		const r = run(parse(yaml), 'f', 1);
		// The link d → w is not drawn, so it counts on both cards, with x.
		expect(r).toMatchObject({ ids: ['d', 'w', 'f'], hidden: { d: 2, w: 2 } });
		expect(r.r.tree.people[1].parents).toEqual([]);
		// With x inside as well, w keeps both links.
		const both = run(parse(`${yaml.trimEnd()}\n  - partners: [f, x]\n`), 'f', 1);
		expect(both.r.tree.people.find((p) => p.id === 'w')?.parents.map((p) => p.id)).toEqual(['d', 'x']);
	});

	it('a person added as a placement parent, with one of their own placement parents inside, is drawn as a root', () => {
		const tree = parse(`people:
  - {id: w, name: W}
  - {id: z, name: Z}
  - {id: g, name: G, parents: [w, z]}
  - {id: f, name: F}
  - {id: y, name: Y, parents: [f, g]}
unions:
  - partners: [f, w]
`);
		const r = run(tree, 'f', 1);
		expect(r).toMatchObject({ ids: ['w', 'g', 'f', 'y'], hidden: { w: 2, g: 2 } });
		expect(r.r.tree.people[1].parents).toEqual([]);
	});

	it('a partner with no placement parent keeps a rumoured parent inside (no couple to split)', () => {
		const tree = parse('people:\n  - {id: m, name: M}\n  - {id: w, name: W, parents: [{id: m, type: rumoured}]}\n  - {id: f, name: F}\nunions:\n  - partners: [f, w]\n  - partners: [f, m]\n');
		expect(run(tree, 'f', 0).r.tree.people.find((p) => p.id === 'w')?.parents).toEqual([{ id: 'm', type: 'rumoured' }]);
	});

	it('a parent link dropped to break a cycle still counts as a parent, but places nobody', () => {
		// a and x are each other's parent. Validation drops x → a, so the whole tree places a under
		// y alone, and x and b are a couple through c.
		const tree = parse(`people:
  - {id: a, name: A, parents: [x, y]}
  - {id: x, name: X, parents: [a]}
  - {id: y, name: Y}
  - {id: b, name: B}
  - {id: c, name: C, parents: [x, b]}
`);
		const g = deriveFamilies(tree);
		expect(g.unions.filter((u) => u.implicit).map((u) => u.partners)).toEqual([['x', 'b']]);
		// x: parent a, children a and c (as written), implicit partner b.
		expect(run(tree, 'x', 0)).toMatchObject({ ids: ['x'], hidden: { x: 3 } });
		expect(run(tree, 'x', 1)).toMatchObject({ ids: ['a', 'x', 'y', 'b', 'c'], hidden: {} });
	});

	it('a link dropped to break a cycle is not drawn, and does not count while both people are inside', () => {
		// Validation drops b → a (the link that closes the cycle); a → b and a → f stay.
		const tree = parse('people:\n  - {id: a, name: A, parents: [b]}\n  - {id: b, name: B, parents: [a]}\n  - {id: f, name: F, parents: [a]}\n');
		const r = run(tree, 'f', 3);
		expect(r.r.tree.people.map((p) => p.parents.map((q) => q.id))).toEqual([[], ['a'], ['a']]);
		expect(r.hidden).toEqual({});
	});

	it('a link dropped to break a cycle never counts, also when the relative is outside (contract d10284b)', () => {
		// a → b → c → a. Validation drops c → a, so a's written parent c is not drawn.
		const tree = parse('people:\n  - {id: a, name: A, parents: [c]}\n  - {id: b, name: B, parents: [a]}\n  - {id: c, name: C, parents: [b]}\n');
		expect(run(tree, 'a', 0)).toMatchObject({ ids: ['a'], hidden: { a: 1 } });
		expect(run(tree, 'c', 0)).toMatchObject({ ids: ['c'], hidden: { c: 1 } });
		expect(run(tree, 'b', 0)).toMatchObject({ ids: ['b'], hidden: { b: 2 } });
	});

	it('a child who is in only as a partner and loses the parent line counts on the parent\'s card', () => {
		// s is f's brother and is married to x, f's daughter by y. Focus f, n = 0 (review 5.1 round 2).
		const tree = parse('people:\n  - {id: q, name: Q}\n  - {id: y, name: Y}\n  - {id: f, name: F, parents: [q]}\n  - {id: s, name: S, parents: [q]}\n  - {id: x, name: X, parents: [f, y]}\nunions:\n  - {partners: [s, x]}\n');
		const r = run(tree, 'f', 0);
		expect(r.ids).toEqual(['f', 's', 'x']);
		expect(r.r.tree.people[2].parents).toEqual([]);
		// f: parent q, child x (line dropped), implicit partner y. x: parents f (dropped) and y.
		expect(r.hidden).toEqual({ f: 3, s: 1, x: 2 });
	});

	it('random trees, also with a parent cycle, n = 0 to 3: nobody is placed under other parents than in the whole tree', () => {
		const out: string[] = [];
		for (let seed = 1; seed <= 100; seed++) {
			const plain = parse(randomTree(seed));
			const last = plain.people[plain.people.length - 1];
			const cyclic = { ...plain, people: [{ ...plain.people[0], parents: [...plain.people[0].parents, { id: last.id, type: 'birth' }] }, ...plain.people.slice(1)] };
			for (const tree of [plain, cyclic]) {
				const whole = deriveFamilies(tree);
				for (const p of tree.people) {
					for (const n of [0, 1, 2, 3]) {
						const sub = deriveFamilies(run(tree, p.id, n).r.tree);
						for (const q of sub.people) {
							const got = sub.placementParents.get(q.id) ?? [];
							const want = whole.placementParents.get(q.id) ?? [];
							if (got.length && got.join('+') !== want.join('+')) out.push(`seed ${seed}, focus ${p.id}, n ${n}: ${q.id} under [${got}], whole tree [${want}]`);
						}
					}
				}
			}
		}
		expect(out.slice(0, 5)).toEqual([]);
	}, 60_000);

	it('random trees: children of the focus person keep the whole tree\'s placement parents', () => {
		for (let seed = 1; seed <= 150; seed++) {
			const tree = parse(randomTree(seed));
			const g = deriveFamilies(tree);
			for (const p of g.people) {
				for (const n of [1, 2]) {
					const r = run(tree, p.id, n);
					const inside = new Set(r.ids);
					const sub = deriveFamilies(r.r.tree);
					for (const c of g.people) {
						if (c.id === p.id || !c.parents.some((ref) => ref.id === p.id)) continue;
						const where = `seed ${seed}, focus ${p.id}, n ${n}, child ${c.id}`;
						for (const q of g.placementParents.get(c.id)!) expect(inside.has(q), where).toBe(true);
						expect(sub.placementParents.get(c.id), where).toEqual(g.placementParents.get(c.id));
						expect(sub.primaryUnion.has(c.id), where).toBe(g.primaryUnion.has(c.id));
					}
				}
			}
		}
	});
});

describe('the rest of the shape', () => {
	it('duplicate ids: the first entry wins, as in the whole tree', () => {
		const tree = parse(`people:
  - {id: a, name: A}
  - {id: a, name: A again, parents: [z]}
  - {id: z, name: Z}
  - {id: f, name: F, parents: [a]}
`);
		const r = run(tree, 'f', 3);
		expect(r.ids).toEqual(['a', 'f']);
		expect(r.r.tree.people[0].name).toBe('A');
		expect(r.hidden).toEqual({});
	});

	it('a union is kept when every partner it lists is inside, also a malformed one', () => {
		const tree = parse('people:\n  - {id: f, name: F}\n  - {id: o, name: O}\nunions:\n  - partners: [f]\n  - partners: [f, f]\n  - partners: [f, o, o]\n  - partners: []\n');
		expect(run(tree, 'f', 1).r.tree.unions.map((u) => u.index)).toEqual([0, 1, 3]);
	});

	it('a person who is their own parent has no siblings through that link, and the link is not drawn', () => {
		const tree = parse('people:\n  - {id: s, name: S, parents: [s]}\n  - {id: k, name: K, parents: [s]}\n');
		const r = run(tree, 's', 0);
		expect(r.ids).toEqual(['s']);
		expect(r.hidden).toEqual({ s: 1 });
		expect(r.r.tree.people[0].parents).toEqual([]);
	});

	it('people are copies and unions are the original objects (contract)', () => {
		const tree = parse('people:\n  - {id: a, name: A}\n  - {id: f, name: F, parents: [a]}\nunions:\n  - partners: [a, f]\n');
		const { r } = run(tree, 'f', 1);
		expect(r.tree.unions[0]).toBe(tree.unions[0]);
		r.tree.people[1].parents.pop();
		r.tree.people[1].name = 'Changed';
		expect(tree.people[1]).toMatchObject({ name: 'F', parents: [{ id: 'a', type: 'birth' }] });
	});

	it('a wide tree: 20 000 children of one couple and 2 000 partners, with a huge n', () => {
		const people: Person[] = [
			{ id: 'a', name: 'A', parents: [], illegitimate: false, index: 0 },
			{ id: 'b', name: 'B', parents: [], illegitimate: false, index: 1 },
		];
		for (let i = 0; i < 20000; i++) people.push({ id: `c${i}`, name: `C${i}`, parents: [{ id: 'a', type: 'birth' }, { id: 'b', type: 'birth' }], illegitimate: false, index: people.length });
		const unions = [];
		for (let i = 0; i < 2000; i++) {
			people.push({ id: `w${i}`, name: `W${i}`, parents: [], illegitimate: false, index: people.length });
			unions.push({ partners: ['c0', `w${i}`], type: 'marriage', index: i });
		}
		const tree: Tree = { options: {}, houses: [], people, unions, issues: [] };
		const started = performance.now();
		const r = focusSubgraph(tree, 'c5', 1_000_000);
		expect(performance.now() - started).toBeLessThan(5000);
		expect(r?.tree.people.length).toBe(people.length);
		expect(r?.hidden.size).toBe(0);
		const zero = focusSubgraph(tree, 'c5', 0);
		// Siblings and their partners; the parents are out.
		expect(zero?.tree.people.length).toBe(20000 + 2000);
		expect(zero?.hidden.get('c0')).toBe(2);
	}, 30_000);
});
