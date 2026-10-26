/*
 * Version 0.5 step 1(d), fix round: the step-descendant rule of the names by marriage (design gate rule 3, second half). A
 * descendant of M's spouse S is a step-descendant of M only through a child of S who is not M's own child by a birth or adoptive
 * link: the name, its link word and its line come from such a child, and a child linked to S only by a rumoured link gives a
 * rumoured name. The cases are the genealogy vet's 1, 1b, 1c (sample tree 7), 1d (random tree s2) and 1e (the step-grandchild
 * tree with its finder line).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, relationLookup } from '../../src/core/relations';
import { build, fixture } from '../support/helpers';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const SETTINGS = [true, false];
const note = (people: string[], unions: string[]) => `people:\n${people.map((l) => `  - ${l}`).join('\n')}\nunions:\n${unions.map((l) => `  - ${l}`).join('\n')}\n`;
const names = (g: FamilyGraph, me: string, p: string, on: boolean) => (computeRelations(g, me, { oneParentUnknown: on }).get(p) ?? []).map((r) => r.text);

/** The finder's lines of `me` to `p`: each name with its steps as a sentence. */
function lines(g: FamilyGraph, me: string, p: string): Record<string, string> {
	const fr = findRelation(g, me, p);
	if (fr.kind !== 'named') return {};
	return Object.fromEntries(fr.relations.map((r) => [r.relation.text, r.steps.map((s) => `${s.person} is ${s.of}’s ${s.word}`).join('. ')]));
}

describe('r05 step-descendant: a child of S by a rumoured link only (vet case 1)', () => {
	// M and S have the son A. B is S's daughter only by a rumoured link. P is the son of A and B.
	const y = note(
		['{id: m, name: M, sex: m}', '{id: s, name: S, sex: f}', '{id: a, name: A, sex: m, parents: [m, s]}', '{id: b, name: B, sex: f, parents: [{id: s, type: rumoured}]}', '{id: p, name: P, sex: m, parents: [a, b]}'],
		['{partners: [m, s]}'],
	);
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: "Grandson | Rumoured step-grandson", not "Step-grandson"`, () => {
			expect(names(graph(y), 'm', 'p', on)).toEqual(['Grandson', 'Rumoured step-grandson']);
		});
	}
	it('the finder runs the rumoured name through B, not through M’s own son', () => {
		expect(lines(graph(y), 'm', 'p')['Rumoured step-grandson']).toBe('s is m’s wife. b is s’s rumoured daughter. p is b’s son');
	});
});

describe('r05 step-descendant: one generation deeper (vet case 1b)', () => {
	const y = note(
		[
			'{id: m, name: M, sex: m}',
			'{id: s, name: S, sex: f}',
			'{id: a, name: A, sex: m, parents: [m, s]}',
			'{id: a2, name: A2, sex: m, parents: [a]}',
			'{id: b, name: B, sex: f, parents: [{id: s, type: rumoured}]}',
			'{id: b2, name: B2, sex: f, parents: [b]}',
			'{id: p, name: P, sex: m, parents: [a2, b2]}',
		],
		['{partners: [m, s]}'],
	);
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: "Great-grandson | Wife’s rumoured great-grandson"`, () => {
			expect(names(graph(y), 'm', 'p', on)).toEqual(['Great-grandson', 'Wife’s rumoured great-grandson']);
		});
	}
});

describe('r05 step-descendant: sample tree 7 (vet case 1c)', () => {
	const { g } = build(fixture('07'));
	for (const on of SETTINGS) {
		for (const [p, blood, rumoured] of [
			['percival-orsini-4', 'Great-great-grandson', 'Husband’s rumoured great-great-grandson'],
			['lisette-orsini-3', 'Great-great-granddaughter', 'Husband’s rumoured great-great-granddaughter'],
		]) {
			it(`setting ${on ? 'on' : 'off'}: Odette Greymane sees ${p} with no sure "Husband’s great-great-…"`, () => {
				const list = names(g, 'odette-greymane', p, on);
				expect(list).toContain(blood);
				expect(list).toContain(rumoured);
				expect(list.filter((n) => /^Husband’s great-great-grand/.test(n))).toEqual([]);
			});
		}
	}
});

describe('r05 step-descendant: random tree s2 (vet case 1d)', () => {
	// g3b descends from g0b by g2a, and from g0c's wife-line by g2e: the line through g0a's adoptive stepchild is all that is left.
	const y = `people:
  - {id: g0a, name: g0a, sex: m}
  - {id: g0b, name: g0b, sex: m}
  - {id: g0c, name: g0c, sex: m}
  - {id: g1a, name: g1a, sex: f, parents: [{id: g0c, type: adoptive}, {id: g0a, type: adoptive}]}
  - {id: g1b, name: g1b, sex: m, parents: [{id: g0c, type: adoptive}, g0b]}
  - {id: g1c, name: g1c, sex: m, parents: [g0a, {id: g0b, type: adoptive}]}
  - {id: g1d, name: g1d, sex: f, parents: [g0a, g0c]}
  - {id: g1e, name: g1e, sex: m, parents: [g0c, g0a]}
  - {id: g2a, name: g2a, sex: m, parents: [g0b, {id: g1b, type: adoptive}]}
  - {id: g2b, name: g2b, sex: f, parents: [{id: g1b, type: adoptive}, g0b]}
  - {id: g2c, name: g2c, sex: m, parents: [{id: g1b, type: adoptive}, g0b]}
  - {id: g2d, name: g2d, sex: m, parents: [g1c, {id: g1a, type: rumoured}]}
  - {id: g2e, name: g2e, sex: f, parents: [g1a, g1c]}
  - {id: g3a, name: g3a, sex: f, parents: [g2e, {id: g2c, type: adoptive}]}
  - {id: g3b, name: g3b, sex: m, parents: [g2a, g2e]}
  - {id: g3c, name: g3c, sex: m, parents: [g2e, g2a]}
  - {id: g3d, name: g3d, sex: m, parents: [{id: g2a, type: ward}, {id: g2e, type: adoptive}]}
unions:
  - {partners: [g0a, g0b]}
  - {partners: [g0c, g0b]}
  - {partners: [g1a, g1c]}
  - {partners: [g1a, g1e]}
  - {partners: [g2e, g2c]}
  - {partners: [g2a, g2e]}
`;
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: g0b sees g3b as "Grandson | Husband’s adopted great-grandson", no birth word`, () => {
			expect(names(graph(y), 'g0b', 'g3b', on)).toEqual(['Grandson', 'Husband’s adopted great-grandson']);
		});
	}
});

describe('r05 step-descendant: the step-grandchild tree and its finder line (vet case 1e)', () => {
	// M and S have the son A; N and S have the daughter B; A and B have the son P. The step line runs through B, in both parent orders.
	const people = (parents: string) => [
		'{id: m, name: M, sex: m}',
		'{id: n, name: N, sex: m}',
		'{id: s, name: S, sex: f}',
		'{id: a, name: A, sex: m, parents: [m, s]}',
		'{id: b, name: B, sex: f, parents: [n, s]}',
		`{id: p, name: P, sex: m, parents: ${parents}}`,
	];
	const unions = ['{partners: [m, s]}', '{partners: [n, s]}'];
	for (const parents of ['[a, b]', '[b, a]']) {
		it(`parents ${parents}: "S is M’s wife. B is S’s daughter. P is B’s son."`, () => {
			expect(lines(graph(note(people(parents), unions)), 'm', 'p')['Step-grandson']).toBe('s is m’s wife. b is s’s daughter. p is b’s son');
		});
	}
});

describe('r05 step-descendant: the vet’s G2 findings 1 and 1b keep their names', () => {
	// G2 finding 1: the sure line to S is longer than the shortest line, which a rumoured link makes; both come from the child of S who is not M's.
	it('a sure "Husband’s great-great-granddaughter" stays beside the rumoured name, in both settings and in the lookup', () => {
		const y = note(
			[
				'{id: g0a, name: g0a, sex: m}',
				'{id: g0b, name: g0b, sex: f}',
				'{id: g1a, name: g1a, sex: f, parents: [g0a]}',
				'{id: g1c, name: g1c, sex: f, parents: [g0b, g0a]}',
				'{id: g2d, name: g2d, sex: f, parents: [g1a, g1c]}',
				'{id: g3a, name: g3a, sex: m, parents: [g1a]}',
				'{id: g3e, name: g3e, sex: m, parents: [g2d]}',
				'{id: g4d, name: g4d, sex: f, parents: [{id: g3a, type: rumoured}, g3e]}',
			],
			['{partners: [g0b, g0a]}'],
		);
		const g = graph(y);
		for (const on of SETTINGS) {
			expect(names(g, 'g0b', 'g4d', on)).toContain('Husband’s great-great-granddaughter');
			expect(relationLookup(g, 'g0b', { oneParentUnknown: on }).get('g4d')?.map((r) => r.text)).toContain('Husband’s great-great-granddaughter');
		}
	});
	it('M’s own great-granddaughter gets no "Wife’s …" name from a rumoured shortcut', () => {
		const y = note(
			[
				'{id: s, name: S, sex: f}',
				'{id: m, name: M, sex: m}',
				'{id: k2, name: K2, sex: f, parents: [m, s]}',
				'{id: a, name: A, sex: f, parents: [k2]}',
				'{id: b, name: B, sex: f, parents: [a]}',
				'{id: c, name: C, sex: f, parents: [k2]}',
				'{id: p, name: P, sex: f, parents: [b, {id: c, type: rumoured}]}',
			],
			['{partners: [m, s]}'],
		);
		for (const on of SETTINGS) expect(names(graph(y), 'm', 'p', on).filter((n) => n.startsWith('Wife’s'))).toEqual([]);
	});
});

describe('r05 step-descendant: a line from S down to P that passes M is not a step line', () => {
	// M is married to his mother S. C is their child, P is M's child by W. A line S, M, P passes M, so P is no step-grandchild.
	// The tree without S's links to C and without M's links finds no other line, so no name by marriage is made, in every order.
	const people = ['{id: s, name: S, sex: f}', '{id: m, name: M, sex: m, parents: [s]}', '{id: c, name: C, sex: f, parents: [m, s]}', '{id: w, name: W, sex: f}', '{id: p, name: P, sex: m, parents: [m, w]}'];
	const unions = ['{partners: [m, s]}', '{partners: [m, w]}'];
	const perms = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: M sees P as "Son" only in all 120 orders`, () => {
			const byId = new Map(people.map((l) => [/id: (\w+)/.exec(l)![1], l]));
			const seen = new Set<string>();
			for (const order of perms([...byId.keys()])) seen.add(names(graph(note(order.map((k) => byId.get(k)!), unions)), 'm', 'p', on).join(' | '));
			expect([...seen]).toEqual(['Son']);
		});
	}
});
