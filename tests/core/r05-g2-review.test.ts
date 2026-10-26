/*
 * G2 review of parts 1d and 1f (scratch branch scratch/r05-g2-1d). Each test failed on r05/1d-order and showed one defect; the
 * fix round made findings 1, 1b and 2 pass. Finding 2 now expects the single form of the double name (the supervisor's ruling:
 * a "double" that needs a line through M shows as the single name of the couple whose line avoids M). Finding 3 is a known limit:
 * the test pins what the code gives.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation } from '../../src/core/relations';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}
const names = (g: FamilyGraph, me: string, p: string, on: boolean) => (computeRelations(g, me, { oneParentUnknown: on }).get(p) ?? []).map((r) => r.text);

describe('G2 finding 1: the step skip reads the distances of the whole tree, but the name can come from the sure view', () => {
	// M (g0b) is married to S (g0a). S's children g1a (alone) and g1c (with M). g1a and g1c are the parents of g2d.
	// P (g4d) has a rumoured link to g3a, a son of g1a, so the whole tree's shortest line from P to S is 3 links
	// (via g3a, g1a) and the sure line is 4 (via g3e, g2d, g1a). "Husband's great-great-granddaughter" is a sure
	// name through g1a, who is not M's child. The skip looks at the children of S at distance 3 in the whole
	// tree, finds only g1c (M's child), and drops the name.
	const people = [
		'{id: g0a, name: g0a, sex: m}',
		'{id: g0b, name: g0b, sex: f}',
		'{id: g1a, name: g1a, sex: f, parents: [g0a]}',
		'{id: g1c, name: g1c, sex: f, parents: [g0b, g0a]}',
		'{id: g2d, name: g2d, sex: f, parents: [g1a, g1c]}',
		'{id: g3a, name: g3a, sex: m, parents: [g1a]}',
		'{id: g3e, name: g3e, sex: m, parents: [g2d]}',
		'{id: g4d, name: g4d, sex: f, parents: [{id: g3a, type: rumoured}, g3e]}',
	];
	const y = `people:\n${people.map((l) => `  - ${l}`).join('\n')}\nunions:\n  - {partners: [g0b, g0a]}\n`;
	for (const on of [true, false]) {
		it(`setting ${on ? 'on' : 'off'}: the name that release-0.5.0 gave stays`, () => {
			expect(names(graph(y), 'g0b', 'g4d', on)).toContain('Husband’s great-great-granddaughter');
		});
	}
	it('the finder agrees', () => {
		const fr = findRelation(graph(y), 'g0b', 'g4d');
		expect(fr.kind).toBe('named');
		if (fr.kind !== 'named') return;
		expect(fr.relations.map((r) => r.relation.text)).toContain('Husband’s great-great-granddaughter');
	});
});

describe('G2 finding 1b: the same skip, the other way: a name by marriage for the own descendant of M is added', () => {
	// K2 is the child of M and S. P is K2's great-granddaughter by sure links (4 links up to S), and also a rumoured
	// daughter of C, a child of K2 (3 links). The sure name comes from the sure view with 4 links; the skip counts the
	// children of S at 3 links in the whole tree, finds none (K2 is at 2 there), and does not skip.
	// release-0.5.0 gave no "Wife's ..." name here: P is M's own descendant.
	const y = `people:
  - {id: s, name: S, sex: f}
  - {id: m, name: M, sex: m}
  - {id: k2, name: K2, sex: f, parents: [m, s]}
  - {id: a, name: A, sex: f, parents: [k2]}
  - {id: b, name: B, sex: f, parents: [a]}
  - {id: c, name: C, sex: f, parents: [k2]}
  - {id: p, name: P, sex: f, parents: [b, {id: c, type: rumoured}]}
unions:
  - {partners: [m, s]}
`;
	for (const on of [true, false]) {
		it(`setting ${on ? 'on' : 'off'}: no name by marriage for P`, () => {
			expect(names(graph(y), 'm', 'p', on).filter((n) => n.startsWith('Wife’s'))).toEqual([]);
		});
	}
});

describe('G2 finding 2: a double cousin by marriage that needs a line through M shows as the single name, in both parent orders', () => {
	// Every link is a birth link. M (g2b) is married to S (g2e). P (g3c) is M's daughter and also the daughter of M's half-brother g2a.
	// One couple of the double (g0a and g0b) reaches P only through M, so the double is not shown: the single name of the other couple is.
	const people = (parentsOfP: string) => [
		'{id: g0a, name: g0a, sex: f}',
		'{id: g0b, name: g0b, sex: f}',
		'{id: g1a, name: g1a, sex: f, parents: [g0a, g0b]}',
		'{id: g1b, name: g1b, sex: m, parents: [g0b]}',
		'{id: g1c, name: g1c, sex: f, parents: [g0b, g0a]}',
		'{id: g1d, name: g1d, sex: m, parents: [g0b]}',
		'{id: g2a, name: g2a, sex: m, parents: [g1b]}',
		'{id: g2b, name: g2b, sex: m, parents: [g1b, g1c]}',
		'{id: g2e, name: g2e, sex: f, parents: [g1a, g1d]}',
		`{id: g3c, name: g3c, sex: f, parents: [${parentsOfP}]}`,
	];
	const y = (parentsOfP: string) => `people:\n${people(parentsOfP).map((l) => `  - ${l}`).join('\n')}\nunions:\n  - {partners: [g2b, g2e]}\n`;
	for (const on of [true, false]) {
		it(`both parent orders give the same names, with the single form (setting ${on ? 'on' : 'off'})`, () => {
			const a = names(graph(y('g2a, g2b')), 'g2b', 'g3c', on);
			const b = names(graph(y('g2b, g2a')), 'g2b', 'g3c', on);
			expect([...a].sort()).toEqual([...b].sort());
			// With the setting on a parent who lists one parent is half, so there is no full cousin and no double at all.
			if (!on) expect(a).toContain('Wife’s first cousin once removed');
			expect(a.filter((n) => /double/.test(n))).toEqual([]);
		});
	}
});

describe('G2 finding 3 (known limit): three birth parents, M married to a child of the three, the order of the wife’s parents can change the names', () => {
	// M (g1c) has two daughters with g1b and g1a (a set of three birth parents) and is married to one of them, S (g2c).
	// P (g2a) is the other daughter. Only the order inside S's own parent list differs between the two notes. A child with three parents
	// has the pair of them that the placement uses (F-KIN-05), so "Sister-in-law" shows in one order only. The header of relations.ts lists it.
	const y = (orderOfS: string) =>
		`people:
  - {id: g1a, name: g1a, sex: m}
  - {id: g1b, name: g1b, sex: f}
  - {id: g1c, name: g1c, sex: m}
  - {id: g2a, name: g2a, sex: f, parents: [g1c, g1b, g1a]}
  - {id: g2c, name: g2c, sex: f, parents: [${orderOfS}]}
unions:
  - {partners: [g1c, g2c]}
`;
	it('pinned: S with parents [g1c, g1b, g1a] gives only "Daughter", with [g1b, g1a, g1c] "Daughter | Sister-in-law" (setting off)', () => {
		expect(names(graph(y('g1c, g1b, g1a')), 'g1c', 'g2a', false)).toEqual(['Daughter']);
		expect(names(graph(y('g1b, g1a, g1c')), 'g1c', 'g2a', false)).toEqual(['Daughter', 'Sister-in-law']);
	});
});
