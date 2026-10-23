/*
 * D175 second fix round: the extra "Rumoured X" name takes the line of the pair of children that gave
 * the maybe (item 1), and a name by marriage, rule 2, keeps a double name if any of its lines avoids M
 * (item 2). Both in two orders of the people (D2) and both settings.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation } from '../../src/core/relations';

function graph(people: string[], unions: string[] = []): FamilyGraph {
	const text = `people:\n${people.map((l) => `  - ${l}`).join('\n')}\n${unions.length ? `unions:\n${unions.map((u) => `  - {partners: [${u}]}`).join('\n')}\n` : ''}`;
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

describe('D175 fix 2, item 1: the extra "Rumoured X" name takes the line of the rumour', () => {
	// Xan has Abe (with Wil), Bo (with a rumoured Zoe) and Cal (with Zoe). Fay descends from Abe and Bo; Pia from Cal.
	const people = [
		'{id: x, name: Xan, sex: m}',
		'{id: w, name: Wil, sex: f}',
		'{id: z, name: Zoe, sex: f}',
		'{id: a, name: Abe, sex: m, parents: [x, w]}',
		'{id: b, name: Bo, sex: m, parents: [x, {id: z, type: rumoured}]}',
		'{id: c, name: Cal, sex: m, parents: [x, z]}',
		'{id: e, name: Eve, sex: f, parents: [a, z]}',
		'{id: b1, name: Ben, sex: m, parents: [b]}',
		'{id: f, name: Fay, sex: f, parents: [e, b1]}',
		'{id: c1, name: Cid, sex: m, parents: [c]}',
		'{id: p, name: Pia, sex: f, parents: [c1]}',
	];
	for (const order of ['document', 'reversed'])
		for (const on of [true, false])
			for (const [first, second] of [
				['f', 'p'],
				['p', 'f'],
			]) {
				it(`${order} order, setting ${on ? 'on' : 'off'}, ${first} to ${second}: the line goes through Bo, with a rumoured step`, () => {
					const g = graph(order === 'document' ? people : [...people].reverse());
					const r = findRelation(g, first, second, { oneParentUnknown: on });
					expect(r.kind).toBe('named');
					if (r.kind !== 'named') return;
					expect(r.relations.map((x) => x.relation.text)).toEqual(['Half first cousin once removed', 'Half second cousin', 'Rumoured second cousin']);
					const extra = r.relations[2];
					expect(extra.relation.line.people).toContain('b');
					expect(extra.relation.line.people).not.toContain('a');
					expect(extra.steps.some((s) => s.word.includes('rumoured'))).toBe(true);
				});
			}
});

describe('D175 fix 2, item 2: a double name by marriage does not depend on the order of the people', () => {
	const people = [
		'{id: g0a, name: g0a, sex: m}',
		'{id: g0b, name: g0b, sex: m}',
		'{id: g0c, name: g0c, sex: m}',
		'{id: g0d, name: g0d, sex: m}',
		'{id: g1a, name: g1a, sex: m, parents: [{id: g0a, type: rumoured}]}',
		'{id: g1b, name: g1b, sex: f, parents: [g0b, g0a]}',
		'{id: g1c, name: g1c, sex: m, parents: [{id: g0a, type: adoptive}, g0d]}',
		'{id: g1d, name: g1d, sex: m, parents: [{id: g0a, type: adoptive}]}',
		'{id: g2a, name: g2a, sex: m, parents: [g1d]}',
		'{id: g2b, name: g2b, sex: m, parents: [{id: g1b, type: adoptive}, g1d]}',
		'{id: g2c, name: g2c, sex: m, parents: [g1d, {id: g1a, type: rumoured}]}',
		'{id: g2d, name: g2d, sex: m, parents: [g1a, g1b]}',
		'{id: g2e, name: g2e, sex: f, parents: [g1b, g1c]}',
		'{id: g2f, name: g2f, sex: f, parents: [{id: g1c, type: rumoured}, g1a]}',
		'{id: g3a, name: g3a, sex: f, parents: [g2a, {id: g2b, type: adoptive}]}',
		'{id: g3b, name: g3b, sex: f, parents: [g2c]}',
		'{id: g3c, name: g3c, sex: f, parents: [g2e, {id: g2a, type: rumoured}]}',
		'{id: g3d, name: g3d, sex: m, parents: [{id: g2e, type: rumoured}, g2c]}',
		'{id: g3e, name: g3e, sex: f, parents: [g2e, g2c]}',
	];
	const unions = ['g0a, g0b', 'g0c, g0d', 'g2c, g2d', 'g2e, g2f'];
	it('setting off, g2e to g3c: "Wife’s rumoured double first cousin once removed" in both orders, with a line that lists g2e once', () => {
		for (const list of [people, [...people].reverse()]) {
			const g = graph(list, unions);
			const rels = computeRelations(g, 'g2e', { oneParentUnknown: false }).get('g3c')!;
			const rel = rels.find((r) => r.text === 'Wife’s rumoured double first cousin once removed');
			expect(rel).toBeDefined();
			const line = rel!.line.people;
			expect(line.filter((id) => id === 'g2e')).toHaveLength(1);
			expect(line.slice(0, 2)).toEqual(['g2e', 'g2f']);
		}
	});
	it('both settings: the names of g2e to g3c are the same in both orders', () => {
		for (const on of [true, false]) {
			const [one, two] = [people, [...people].reverse()].map((list) => (computeRelations(graph(list, unions), 'g2e', { oneParentUnknown: on }).get('g3c') ?? []).map((r) => r.text).sort());
			expect(one).toEqual(two);
		}
	});
});
