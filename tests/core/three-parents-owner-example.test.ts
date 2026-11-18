// The owner's example of D365 (2), word for word in the test titles (contract "Three own lines" §5.1, core part; the drawing part is in
// An internal test). The tree: N, adoptive parents B, T and C in all four list orders, no partnership.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../../src/core/derive';
import { parentVerdicts } from '../../src/core/parent-groups';
import { parseDynasty } from '../../src/core/parse';
import { ORDERS, THREE_PARENT_CASES } from '../support/three-parent-cases';

const graphOf = (source: string): FamilyGraph => {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(parsed.error.code);
	return deriveFamilies(parsed.tree);
};
const row = (id: string) => THREE_PARENT_CASES.find((c) => c.row === id)!;

describe('Each parent has its own line to the child. No line joins two parents. The child stands under the middle of its parents.', () => {
	for (const order of ORDERS) {
		it(`adoptive parents ${order.join(', ')}: a group, three adoptive links to N, no union, no one-parent family`, () => {
			const g = graphOf(row('1a').source(order));
			expect(parentVerdicts(g).get('N')).toEqual({ verdict: 'group', parentKind: 'adoptive' });
			expect(drawnParents(g, 'N').map((q) => `${q.id}:${q.type}`).sort()).toEqual(['B:adoptive', 'C:adoptive', 'T:adoptive']);
			// No line joins two parents: no union of the tree holds two of them, and none is named by a tag or a partner list.
			expect(g.unions).toEqual([]);
			expect(g.writtenUnions).toEqual([]);
			expect(g.wardPairs).toEqual([]);
			expect(g.soloChildren.size).toBe(0);
		});
	}
});

describe('No line and no tag shows a couple that your notes do not have. If two of the three parents are a couple in your notes, the tree shows the child under that couple.', () => {
	for (const order of ORDERS) {
		it(`with a listed marriage of B and C and N listing ${order.join(', ')}: N is a child of that marriage, T is a side link, no union joins T to B or C`, () => {
			const g = graphOf(`${row('1a').source(order)}unions:
  - {partners: [B, C]}
`);
			const union = g.unionByKey.get(g.primaryUnion.get('N')!)!;
			expect([...union.partners].sort()).toEqual(['B', 'C']);
			expect(union.implicit).toBe(false);
			expect(g.secondary.filter((e) => e.child === 'N').map((e) => `${e.type}:${e.parents.join()}`)).toEqual(['adoptive:T']);
			expect(g.unions.filter((u) => u.partners.includes('T'))).toEqual([]);
			expect(g.parentGroups).toEqual([]);
		});
	}
});
