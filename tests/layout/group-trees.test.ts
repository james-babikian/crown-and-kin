// The generators of `tests/support/group-trees.ts` (D365 (2)): they parse, give the same text for the same seed, and build groups with no couple among the
// parents (no listed union and no other two-parent child names the pair), also several groups, two that share a person, and four parents.
import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../../src/core/parse';
import { fourParentGroupTree, groupTree, groupTreeData, OWNER_ORDERS, ownerExampleTree, severalGroupsTree, sharedPersonGroupsTree } from '../support/group-trees';
import { layoutTree, DEFAULT_LAYOUT_SETTINGS, clearLayoutCache } from '../../src/layout/index';
import { deriveFamilies } from '../../src/core/derive';
import { geometryFor } from '../../src/layout/geometry';

const parse = (source: string) => {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};

describe('group tree generators', () => {
	it('the same seed and options give the same text, and every tree parses and lays out', () => {
		for (let seed = 1; seed <= 20; seed++) {
			const a = groupTree(seed, { groups: 2 });
			expect(groupTree(seed, { groups: 2 })).toBe(a);
			clearLayoutCache();
			expect(() => layoutTree(deriveFamilies(parse(a)), geometryFor(16), { ...DEFAULT_LAYOUT_SETTINGS }, 'font')).not.toThrow();
		}
	});

	it('no two parents of a group are a couple: no listed union names them, and no other child has exactly those two parents', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const data = groupTreeData(seed, { groups: 3, kind: seed % 2 ? 'adoptive' : 'birth' });
			const tree = parse(data.source) as unknown as { people: { id?: string; parents?: (string | { id: string })[] }[]; unions?: { partners: string[] }[] };
			const pair = (a: string, b: string) => [a, b].sort().join('|');
			const couples = new Set((tree.unions ?? []).map((u) => pair(u.partners[0], u.partners[1])));
			for (const p of tree.people) {
				const ids = (p.parents ?? []).map((x) => (typeof x === 'string' ? x : x.id));
				if (ids.length === 2) couples.add(pair(ids[0], ids[1]));
			}
			for (const gr of data.groups) {
				expect(gr.parents.length).toBe(3);
				expect(new Set(gr.parents).size).toBe(3);
				for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) expect(couples.has(pair(gr.parents[a], gr.parents[b])), `seed ${seed} ${gr.child}`).toBe(false);
			}
		}
	});

	it('several groups: three group children in a larger tree; two groups that share a person; four parents', () => {
		const several = groupTreeData(7, { groups: 3, people: 20 });
		expect(several.groups.length).toBe(3);
		expect(new Set(several.groups.map((x) => x.child)).size).toBe(3);
		expect(severalGroupsTree(3)).toContain('n2');
		let shared = 0;
		for (let seed = 1; seed <= 30; seed++) {
			const d = groupTreeData(seed, { groups: 2, shared: true, people: 14 });
			if (d.groups.length === 2 && d.groups[1].parents.includes(d.groups[0].parents.find((p) => d.groups[1].parents.includes(p))!)) shared++;
			expect(sharedPersonGroupsTree(seed)).toBeTypeOf('string');
		}
		expect(shared, 'seeds with two groups that share a person').toBeGreaterThan(15);
		const four = groupTreeData(5, { size: 4, people: 14 });
		expect(four.groups[0].parents.length).toBe(4);
		expect(fourParentGroupTree(5)).toContain('n0');
	});

	it('the example of D365: Nell with three adoptive parents and no partnership, in four orders', () => {
		for (const order of OWNER_ORDERS) {
			const tree = parse(ownerExampleTree(order)) as unknown as { people: { id?: string; parents?: { id: string; type?: string }[] }[]; unions?: unknown[] };
			expect(tree.unions ?? []).toEqual([]);
			const nell = tree.people.find((p) => p.id === 'N')!;
			expect(nell.parents!.map((x) => x.id)).toEqual([...order]);
			expect(nell.parents!.every((x) => x.type === 'adoptive')).toBe(true);
		}
	});
});
