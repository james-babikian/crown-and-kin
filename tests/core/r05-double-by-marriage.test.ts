/*
 * Version 0.5 step 1(d), fix round: a "double" name by marriage (rule 2) needs a line of each of its couples that avoids M. A double that
 * needs a line through M shows as the single name of the other couple, in every order of the people and of P's parents (G2 finding 2).
 * A double whose lines all avoid M stays a double.
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

const note = (people: string[], unions: string[]) => `people:\n${people.map((l) => `  - ${l}`).join('\n')}\nunions:\n${unions.map((l) => `  - ${l}`).join('\n')}\n`;
const names = (g: FamilyGraph, me: string, p: string, on: boolean) => (computeRelations(g, me, { oneParentUnknown: on }).get(p) ?? []).map((r) => r.text);

/** A fixed shuffle, so a failure can be repeated. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
	const out = [...list];
	let s = seed;
	for (let i = out.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		const j = s % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

describe('r05 double by marriage: both couples avoid M', () => {
	// Two couples (g1 and g2, h1 and h2) each have a son and a daughter; the son of one marries the daughter of the other, and the two
	// couples' children S and P are double first cousins. M is S's husband and no relative.
	const people = [
		'{id: g1, name: G1, sex: m}',
		'{id: g2, name: G2, sex: f}',
		'{id: h1, name: H1, sex: m}',
		'{id: h2, name: H2, sex: f}',
		'{id: u, name: U, sex: m, parents: [g1, g2]}',
		'{id: v, name: V, sex: f, parents: [g1, g2]}',
		'{id: w, name: W, sex: m, parents: [h1, h2]}',
		'{id: z, name: Z, sex: f, parents: [h1, h2]}',
		'{id: s, name: S, sex: f, parents: [u, z]}',
		'{id: p, name: P, sex: m, parents: [w, v]}',
		'{id: m, name: M, sex: m}',
	];
	const unions = ['{partners: [g1, g2]}', '{partners: [h1, h2]}', '{partners: [u, z]}', '{partners: [v, w]}', '{partners: [m, s]}'];
	for (const on of [true, false]) {
		it(`setting ${on ? 'on' : 'off'}: M sees P as "Wife’s double first cousin" in 40 orders of the people`, () => {
			const seen = new Set<string>();
			for (let k = 0; k < 40; k++) seen.add(names(graph(note(k ? shuffled(people, k) : people, unions)), 'm', 'p', on).join(' | '));
			expect([...seen]).toEqual(['Wife’s double first cousin']);
		});
	}
});

describe('r05 double by marriage: one couple reaches P only through M', () => {
	// M (g2b) is married to S (g2e); P (g3c) is M's daughter and the daughter of M's half-brother g2a. With the setting off, the couple g0b alone
	// (g1d with g1b) reaches P by g2a, and the couple g0a with g0b reaches P through M. So P is S's single "first cousin once removed".
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
	const unions = ['{partners: [g2b, g2e]}'];
	it('setting off: the same names in 60 orders of the people and of P’s parents, and no "double"', () => {
		const seen = new Set<string>();
		for (let k = 0; k < 60; k++) {
			const parents = k % 2 ? 'g2b, g2a' : 'g2a, g2b';
			const list = people(parents);
			seen.add(
				names(graph(note(k > 1 ? shuffled(list, k) : list, unions)), 'g2b', 'g3c', false)
					.filter((n) => n.startsWith('Wife’s'))
					.join(' | '),
			);
		}
		expect([...seen]).toEqual(['Wife’s first cousin once removed | Wife’s half first cousin once removed']);
	});
	it('the finder runs the single name through the couple that avoids M', () => {
		const fr = findRelation(graph(note(people('g2b, g2a'), unions)), 'g2b', 'g3c', { oneParentUnknown: false });
		expect(fr.kind).toBe('named');
		if (fr.kind !== 'named') return;
		const single = fr.relations.find((r) => r.relation.text === 'Wife’s first cousin once removed');
		expect(single).toBeDefined();
		expect(single!.relation.line.people.slice(1)).not.toContain('g2b');
	});
});

describe('r05 double by marriage: known limit (gate rule 7), a rumoured cousin name by marriage can still change with the parent order', () => {
	// Random tree t438, reduced. M (g3b) is the adoptive son of g2c and the father of P (g4c); P's other parent g3e is a rumoured son of g2c. S (g3c) is
	// M's wife. The order inside P's parent list decides if "Wife’s rumoured second cousin once removed" shows. The test pins what the code gives.
	const y = (parentsOfP: string) =>
		note(
			[
				'{id: g0a, name: g0a, sex: f}',
				'{id: g0b, name: g0b, sex: f}',
				'{id: g1a, name: g1a, sex: f, parents: [g0b]}',
				'{id: g1c, name: g1c, sex: f, parents: [{id: g0b, type: adoptive}, g0a]}',
				'{id: g1d, name: g1d, sex: f, parents: [g0b]}',
				'{id: g2a, name: g2a, sex: f, parents: [g1a]}',
				'{id: g2c, name: g2c, sex: m, parents: [{id: g1d, type: rumoured}, g1c]}',
				'{id: g3b, name: g3b, sex: m, parents: [{id: g2c, type: adoptive}]}',
				'{id: g3c, name: g3c, sex: f, parents: [g2a]}',
				'{id: g3e, name: g3e, sex: m, parents: [{id: g2c, type: rumoured}]}',
				`{id: g4c, name: g4c, sex: f, parents: [${parentsOfP}]}`,
			],
			['{partners: [g0a, g0b]}', '{partners: [g3c, g3b]}'],
		);
	it('pinned (setting off): [g3e, g3b] shows the rumoured second cousin, [g3b, g3e] does not', () => {
		expect(names(graph(y('g3e, g3b')), 'g3b', 'g4c', false)).toEqual(['Daughter', 'Rumoured niece', 'Wife’s rumoured second cousin once removed']);
		expect(names(graph(y('g3b, g3e')), 'g3b', 'g4c', false)).toEqual(['Daughter', 'Rumoured niece']);
	});
});
