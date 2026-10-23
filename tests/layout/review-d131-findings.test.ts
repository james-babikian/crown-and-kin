/*
 * G2 review of D175 (spec §0 D175, §13.1 "Double", §13.2): proofs of the findings, written on the
 * scratch branch scratch/d131-review. Each test fails on sibling-labels 6860002 and passes on
 * f60ebcf (the state before D175) unless the comment says otherwise. All names are made up.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';

const SETTINGS: [string, RelationOptions][] = [
	['on', { oneParentUnknown: true }],
	['off', { oneParentUnknown: false }],
];

function graphOf(lines: string[], unions = ''): FamilyGraph {
	const r = parseDynasty('people:\n' + lines.map((l) => `  - ${l}`).join('\n') + '\n' + unions);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const names = (g: FamilyGraph, me: string, other: string, o: RelationOptions) => (computeRelations(g, me, o).get(other) ?? []).map((r) => r.text);

describe('finding 1: "double" depends on the order of siblings (D2)', () => {
	// A + C have three children U, W and V; B adopted U and V. M is the child of U and W; P lists V.
	// The full line through A + C is found through (U, V) and through (W, V): one key, and the pair that
	// is found first (sibling order) is kept. twoCouples then compares the children of that pair with
	// the line through B (U, V): same children with U first, different children with W first.
	const people = (pv: string) => ({
		a: '{id: a, name: A, sex: m}',
		c: '{id: c, name: C, sex: f}',
		b: '{id: b, name: B, sex: f}',
		u: '{id: u, name: U, sex: m, parents: [a, c, {id: b, type: adoptive}]}',
		w: '{id: w, name: W, sex: f, parents: [a, c]}',
		v: '{id: v, name: V, sex: m, parents: [a, c, {id: b, type: adoptive}]}',
		m: '{id: m, name: M, sex: f, parents: [u, w]}',
		p: `{id: p, name: P, sex: f, parents: [{id: v, type: ${pv}}]}`,
	});
	const tree = (order: string, pv: string) => {
		const all = people(pv) as Record<string, string>;
		return graphOf([...order].map((k) => all[k]));
	};
	for (const pv of ['rumoured', 'adoptive']) {
		for (const [label, o] of SETTINGS) {
			it(`P's link to V ${pv}, setting ${label}: U before W and W before U give the same names`, () => {
				const uFirst = tree('acbuwvmp', pv);
				const wFirst = tree('acbwuvmp', pv);
				// Fails: U first gives "Rumoured first cousin" ("Adoptive first cousin"), W first the "double" name.
				expect(names(uFirst, 'm', 'p', o)).toEqual(names(wFirst, 'm', 'p', o));
				expect(names(uFirst, 'p', 'm', o)).toEqual(names(wFirst, 'p', 'm', o));
			});
		}
	}
});

describe('finding 2: a "Rumoured first cousin" whose line and steps have no rumoured link (§13.2)', () => {
	// Cal lists Xan and a rumoured Zoe; Dot lists Xan and Zoe (married). Fay lists Cal, Pia lists Dot (birth).
	// The only rumoured link between Fay and Pia is Cal -> Zoe. The FR line now leaves Cal through Xan
	// (first in Cal's list), crosses the marriage and comes down from Zoe to Dot by a birth link.
	const g = graphOf([
		'{id: x, name: Xan, sex: m}',
		'{id: z, name: Zoe, sex: f}',
		'{id: c1, name: Cal, sex: f, parents: [x, {id: z, type: rumoured}]}',
		'{id: c2, name: Dot, sex: f, parents: [x, z]}',
		'{id: f, name: Fay, sex: f, parents: [c1]}',
		'{id: p, name: Pia, sex: f, parents: [c2]}',
	], 'unions:\n  - partners: [x, z]\n');
	for (const [label, o] of SETTINGS) {
		it(`setting ${label}: Fay -> Pia "rumoured first cousin" passes a rumoured link and a step says so`, () => {
			const r = findRelation(g, 'f', 'p', o);
			if (r.kind !== 'named') throw new Error(r.kind);
			const rum = r.relations.find((x) => x.relation.lower === 'rumoured first cousin');
			expect(rum).toBeDefined();
			// Fails: links c1>f birth, x>c1 birth, z>c2 birth, c2>p birth; steps "father, wife, daughter".
			expect(rum!.relation.line.links.some((l) => l.type === 'rumoured')).toBe(true);
			expect(rum!.steps.some((s) => s.word.includes('rumoured'))).toBe(true);
		});
	}
});

describe('finding 3: the V1 line names a union that is not in the tree, and the whole tree has a gap', () => {
	// Spec D175 example V1: Xan and Zoe have no union; Cal and Dot list Xan and a rumoured Zoe.
	const g = graphOf([
		'{id: x, name: Xan, sex: m}',
		'{id: z, name: Zoe, sex: f}',
		'{id: c1, name: Cal, sex: f, parents: [x, {id: z, type: rumoured}]}',
		'{id: c2, name: Dot, sex: f, parents: [x, {id: z, type: rumoured}]}',
		'{id: f, name: Fay, sex: f, parents: [{id: c1, type: rumoured}]}',
		'{id: p, name: Pia, sex: f, parents: [c2]}',
	]);
	for (const [label, o] of SETTINGS) {
		it(`setting ${label}: every union of the line exists (contract of tests/review-m7-core "unknown union")`, () => {
			const line = computeRelations(g, 'f', o).get('p')![0].line;
			// Fails: ['i:["x","z"]'] is not a union of the tree (no recorded union, no child placed under both).
			expect(line.unions.filter((k) => !g.unionByKey.has(k))).toEqual([]);
		});

		it(`setting ${label}: in the whole tree, each two neighbours on the line are joined by a drawn line`, () => {
			const line = computeRelations(g, 'f', o).get('p')![0].line;
			clearLayoutCache();
			const laid = layoutTree(g, geometryFor(16), DEFAULT_LAYOUT_SETTINGS, 'review');
			const gaps: string[] = [];
			for (let i = 0; i + 1 < line.people.length; i++) {
				const [a, b] = [line.people[i], line.people[i + 1]];
				const linked = drawnParents(g, a).some((d) => d.id === b) || drawnParents(g, b).some((d) => d.id === a);
				const drawn = laid.edges.paths.some((p) => p.people.includes(a) && p.people.includes(b));
				if (!linked && !drawn) gaps.push(`${a}-${b}`);
			}
			// Fails: ['x-z']. The highlight shows Fay, Cal, Xan and Zoe, Dot, Pia as two pieces.
			expect(gaps).toEqual([]);
		});
	}
});
