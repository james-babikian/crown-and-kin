// The readers of a child with three or more parents of one kind (contract "Three own lines" §3, D365 (2)): folds, focus, the sibling group,
// the order notes of the line of succession, the phone list, the partner and child lists, the edit operations and the small tree of a line.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { siblingGroup } from '../../src/core/family-query';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { foldFamilies, foldHidden, foldKey, foldsHiding, pruneGraph } from '../../src/core/folds';
import { parentVerdicts } from '../../src/core/parent-groups';
import { parseDynasty } from '../../src/core/parse';
import { findRelation, lineSubgraph } from '../../src/core/relations';
import { specOf, successionLine } from '../../src/core/succession';
import { applyOp } from '../../src/core/yaml-edit';
import { partnersAndChildren } from '../../src/render/tree-info';
import { listData } from '../../src/view/phone-list';
import { ORDERS, THREE_PARENT_CASES } from '../support/three-parent-cases';

const row = (id: string) => THREE_PARENT_CASES.find((c) => c.row === id)!;
function graphOf(source: string, options: Parameters<typeof deriveFamilies>[1] = {}): FamilyGraph {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(parsed.error.code);
	return deriveFamilies(parsed.tree, options);
}
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('folds: the children of a group fold as one family of the three parents', () => {
	it('makes a family with the key of the three sorted ids, no union, in every list order', () => {
		for (const order of ORDERS) {
			const g = graphOf(row('1b').source(order));
			const f = foldFamilies(g).find((x) => x.children.includes('N'))!;
			expect(f.key).toBe(foldKey(['B', 'C', 'T']));
			expect(f.key).toBe('["B","C","T"]');
			expect(f.union).toBeUndefined();
			expect(sorted(f.parents)).toEqual(['B', 'C', 'T']);
		}
	});

	it('hides the group child when its family is folded, and names that fold for the child (the three-key reaches foldsHiding)', () => {
		const g = graphOf(row('13').source(ORDERS[0]));
		const key = foldKey(['B', 'T', 'C']);
		expect([...foldHidden(g, new Set([key]))].sort()).toEqual(['Kid', 'N']);
		expect(foldsHiding(g, new Set([key]), 'Kid')).toEqual([key]);
	});

	it('puts the children of two groups with the same parents in one family, and another group in another', () => {
		const source = 'people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: D, name: D}\n  - {id: N1, name: N1, parents: [B, T, C]}\n  - {id: N2, name: N2, parents: [C, B, T]}\n  - {id: N3, name: N3, parents: [B, T, D]}\n';
		const families = foldFamilies(graphOf(source));
		expect(families.map((f) => [f.key, f.children])).toEqual([
			['["B","C","T"]', ['N1', 'N2']],
			['["B","D","T"]', ['N3']],
		]);
	});

	it('a child under a couple stays in the family of the couple', () => {
		const g = graphOf(row('2g').source(ORDERS[1]));
		expect(foldFamilies(g).map((f) => f.key)).toEqual(['["B","C"]']);
		expect([...foldFamilies(g)[0].children].sort()).toEqual(['N', 'Wynn']);
	});

	it('pruneGraph keeps a group only while the child and every parent are shown', () => {
		const g = graphOf(row('1b').source(ORDERS[0]));
		expect(pruneGraph(g, new Set(['N'])).parentGroups).toEqual([]);
		expect(pruneGraph(g, new Set(['T'])).parentGroups).toEqual([]);
		expect(pruneGraph(g, new Set(['Nobody'])).parentGroups).toHaveLength(1);
	});
});

describe('focus: a group is shown with all its parents; a couple with the side parent counted as hidden', () => {
	it('focus on a parent of a group brings the child and the other two parents', () => {
		for (const order of ORDERS) {
			const parsed = parseDynasty(row('1b').source(order));
			if (!parsed.ok) throw new Error('parse');
			const sub = focusSubgraph(parsed.tree, 'T', 1)!;
			expect(sorted(sub.tree.people.map((p) => p.id))).toEqual(['B', 'C', 'N', 'T']);
			expect(sub.hidden.size).toBe(0);
			// The small tree has the same verdict as the whole tree.
			expect(deriveFamilies(sub.tree).parentGroups.map((x) => x.child)).toEqual(['N']);
		}
	});

	it('focus on the side parent T of N under the couple B and C, with Wynn outside the focus, keeps N under that couple (row 15)', () => {
		const parsed = parseDynasty(row('15').source(ORDERS[1]));
		if (!parsed.ok) throw new Error('parse');
		const sub = focusSubgraph(parsed.tree, 'T', 1)!;
		expect(sub.tree.people.map((p) => p.id)).not.toContain('Wynn');
		// Without the verdicts of the whole tree the part sees three parents with no couple; with them it keeps the couple.
		expect(deriveFamilies(sub.tree).parentGroups.map((x) => x.child)).toEqual(['N']);
		const g = deriveFamilies(sub.tree, { verdicts: parentVerdicts(graphOf(row('15').source(ORDERS[1]))) });
		expect(g.parentGroups).toEqual([]);
		expect(sorted(g.unionByKey.get(g.primaryUnion.get('N')!)!.partners)).toEqual(['B', 'C']);
	});
});

describe('the sibling group of a group child', () => {
	it('is the children with the same parents, in the order of the note, whatever the order of their lists', () => {
		const source = 'people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: D, name: D}\n  - {id: N1, name: N1, parents: [B, T, C]}\n  - {id: N3, name: N3, parents: [B, T, D]}\n  - {id: N2, name: N2, parents: [C, B, T]}\n';
		const g = graphOf(source);
		expect(siblingGroup(g, 'N1')).toEqual(['N1', 'N2']);
		expect(siblingGroup(g, 'N2')).toEqual(['N1', 'N2']);
		expect(siblingGroup(g, 'N3')).toEqual(['N3']);
	});

	it('is the children of the union for a child under a couple', () => {
		const g = graphOf(row('2g').source(ORDERS[0]));
		expect(siblingGroup(g, 'N')).toEqual(['Wynn', 'N']);
	});

	it('moves a group child past its sibling in the note', () => {
		const source = 'people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: N1, name: N1, parents: [B, T, C]}\n  - {id: N2, name: N2, parents: [C, B, T]}\n';
		const r = applyOp(source, { kind: 'move-sibling', id: 'N1', direction: 'later' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.body.indexOf('id: N2')).toBeLessThan(r.body.indexOf('id: N1'));
	});
});

describe('the line of succession: children of the same three parents need no order note', () => {
	const src = (second: string) =>
		`people:\n  - {id: r, name: R, sex: m, born: 1120}\n  - {id: w1, name: W1, sex: f, born: 1120}\n  - {id: w2, name: W2, sex: f, born: 1120}\n  - {id: w3, name: W3, sex: f, born: 1120}\n  - {id: A, name: A, parents: [r, w1, w2]}\n  - {id: C, name: C, parents: ${second}}\ntitles:\n  - id: duke\n    name: Duke\n    succession: eldest-child\n    holders:\n      - {person: r, from: 1140}\n`;
	const notes = (second: string) => {
		const g = graphOf(src(second));
		return successionLine(g, g.titles[0], specOf(g.titles[0]), 99, 0).notes.map((n) => n.kind);
	};

	it('ties by the written order only: the same three parents in another list order give no note', () => {
		expect(notes('[w2, r, w1]')).toEqual([]);
	});

	it('gives the note when the third parent differs', () => {
		expect(notes('[r, w1, w3]')).toEqual(['order-from-note']);
	});
});

describe('the lists of people (phone list, partners and children)', () => {
	it('shows a group child under "Other children" of each of its three parents, and no partner among them (row 1b)', () => {
		for (const order of ORDERS) {
			const g = graphOf(row('1b').source(order));
			for (const centre of ['B', 'T', 'C']) {
				const data = listData(g, centre);
				expect(data.person.map((r) => r.role)).toEqual(['centre']);
				expect(data.groups).toEqual([{ heading: { kind: 'other' }, rows: [{ id: 'N', role: 'child', link: 'birth' }] }]);
			}
			expect(listData(g, 'N').parents.map((r) => r.id).sort()).toEqual(['B', 'C', 'T']);
		}
	});

	it('shows a child under a couple with the partner of the couple, and the third parent has it with the other children (row 2g)', () => {
		const g = graphOf(row('2g').source(ORDERS[0]));
		const b = listData(g, 'B');
		expect(b.person.map((r) => r.id)).toEqual(['B', 'C']);
		expect(b.groups.map((x) => [x.heading, x.rows.map((r) => r.id)])).toEqual([[{ kind: 'partner', partner: 'C' }, ['Wynn', 'N']]]);
		const t = listData(g, 'T');
		expect(t.groups.map((x) => [x.heading, x.rows.map((r) => r.id)])).toEqual([[{ kind: 'other' }, ['N']]]);
	});

	it('lists the group child as a child of each parent and no partner for any of them', () => {
		const g = graphOf(row('1a').source(ORDERS[0]));
		for (const id of ['B', 'T', 'C']) expect(partnersAndChildren(g, id)).toEqual({ partners: [], children: ['N'] });
	});
});

describe('the small tree of a line reads the verdicts of the whole tree (contract §3.6)', () => {
	const line = (people: string[], parents: string[]) => ({ people, links: parents.map((parent) => ({ parent, child: 'N', type: 'birth' })), unions: [] }) as never;

	it('a line through N, B and T, where C is not on the line, draws no pair B and T (row 1b)', () => {
		const g = graphOf(row('1b').source(ORDERS[0]));
		const small = lineSubgraph(g, line(['N', 'B', 'T'], ['B', 'T']));
		expect(small.unions).toEqual([]);
		expect(small.primaryUnion.has('N')).toBe(false);
		expect(small.parentGroups).toEqual([{ child: 'N', kind: 'birth', parents: ['B', 'T'] }]);
	});

	it('a child under a couple whose second parent is on the line stays under it', () => {
		const g = graphOf(row('2g').source(ORDERS[0]));
		const small = lineSubgraph(g, line(['N', 'B', 'C'], ['B', 'C']));
		expect(small.parentGroups).toEqual([]);
		expect(small.primaryUnion.has('N')).toBe(true);
	});
});

describe('the small tree of a finder line keeps the whole-tree placement of a child with three parents that is no case', () => {
	// N has birth parents B, C and T (or three adoptive ones) and stands under a guardian or under the other kind: no union of B, C or T exists.
	for (const id of ['11', '8b', '5b-1']) {
		for (const order of ORDERS) {
			for (const to of ['C', 'T']) {
				it(`row ${id}, list ${order.join('')}: finder B to ${to} draws no union and N stays placed as in the whole tree`, () => {
					const g = graphOf(row(id).source(order));
					const f = findRelation(g, 'B', to);
					const line = f.kind === 'chain' ? f.line : f.kind === 'named' ? f.relations[0].relation.line : undefined;
					expect(line).toBeDefined();
					const small = lineSubgraph(g, line!);
					expect(small.unions.filter((u) => u.partners.includes('B') && u.partners.includes(to))).toEqual([]);
					expect(small.primaryUnion.has('N')).toBe(false);
					expect(small.placementParents.get('N')).toEqual(small.byId.has(g.placementParents.get('N')![0]) ? g.placementParents.get('N') : []);
				});
			}
		}
	}
});

describe('the edit operations with a group', () => {

	it('a second parent added with the default still makes the marriage', () => {
		const one = 'people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: N, name: N, parents: [B]}\n';
		const r = applyOp(one, { kind: 'add-parent', child: 'N', parent: 'T', type: 'birth' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.body).toContain('partners:');
	});

	it('the `union` key of a child under the couple of its second and third parent stays when another parent is added (rule 1.4)', () => {
		const source = 'people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: D, name: D}\n  - {id: N, name: N, parents: [T, B, C], union: m1}\nunions:\n  - {id: m1, partners: [B, C]}\n';
		const r = applyOp(source, { kind: 'add-parent', child: 'N', parent: 'D', type: 'rumoured' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.body).toContain('union: m1');
	});
});
