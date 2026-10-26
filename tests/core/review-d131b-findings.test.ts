/*
 * G2 re-review of the D175 fix round (scratch branch scratch/d131-review2, on sibling-labels f458add).
 * Proofs of the findings; each test fails on f458add.
 * 1. The on-demand search of skipped pairs runs where it cannot change the answer: every pair of the
 *    group is one couple by the "inside" rule (a sure couple and the same couple plus a rumoured
 *    parent), and `twoCouples` returns before it reads a line. It then searches every skipped pair of
 *    every common ancestor. On the tree below the second tests go from 16 833 (6860002, same names)
 *    to 53 275, the `path` calls from 222 428 to 416 937, and the time from about 377 ms to 508 ms.
 * 2. Pre-existing (94417fb and main): the extra "Rumoured half-X" name of a "maybe half" takes the line
 *    of the sure full name, through the couple, so no step says "rumoured" or "half" (spec §13.2).
 * 3. Pre-existing (main 0.2.4): a name by marriage depends on the order of the people (D2): rule 2
 *    drops the name when the line runs through M, and the line at X is the first pair in document order.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, relationRunStats } from '../../src/core/relations';
import { rng } from '../support/rng';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/**
 * 10 rows of 40; few couples per row (many siblings and cousin marriages); half of the people have a
 * third, rumoured parent; the marked person (last row, first) has two rumoured parent links.
 */
function inbred(): FamilyGraph {
	const [gens, width] = [10, 40];
	const rand = rng(91);
	const out = ['people:'];
	for (let g = 0; g < gens; g++) {
		for (let i = 0; i < width; i++) {
			const id = `n${g}x${i}`;
			out.push(`  - id: ${id}`, `    name: ${id}`, `    sex: ${i % 2 ? 'f' : 'm'}`);
			if (g === 0) continue;
			const couple = Math.floor(rand() * Math.max(2, width / 8));
			const a1 = `n${g - 1}x${couple * 2}`;
			const a2 = `n${g - 1}x${couple * 2 + 1}`;
			const refs = [a1, a2];
			if (rand() < 0.5) refs.push(`{id: n${g - 1}x${(couple * 2 + 2 + Math.floor(rand() * 4)) % width}, type: rumoured}`);
			if (g === gens - 1 && i === 0) refs.splice(0, 2, `{id: ${a1}, type: rumoured}`, `{id: ${a2}, type: rumoured}`);
			out.push(`    parents: [${refs.join(', ')}]`);
		}
	}
	return graph(out.join('\n') + '\n');
}

describe('review D131b finding 1: the on-demand search runs only where it can change a name', () => {
	it('second tests on the inbred tree stay near the count before the fix round (16 833 on 6860002, same names)', () => {
		const g = inbred();
		relationRunStats.second = 0;
		const rels = computeRelations(g, 'n9x0');
		const second = relationRunStats.second;
		let doubles = 0;
		for (const list of rels.values()) for (const r of list) if (r.text.includes('ouble')) doubles++;
		// The names are the same on 6860002 and f458add.
		expect(doubles).toBe(499);
		// f458add: 53 275. Every on-demand search here (158) has a group of one couple by the inside rule.
		expect(second).toBeLessThanOrEqual(20_000);
	});
});

describe('review D131b finding 2: the steps of the extra "Rumoured half-X" name (spec §13.2)', () => {
	const g = graph(`people:
  - {id: x, name: X, sex: m}
  - {id: y, name: Y, sex: f}
  - {id: w, name: W, sex: m}
  - {id: a, name: A, sex: f, parents: [x, y]}
  - {id: b, name: B, sex: f, parents: [x, y, {id: w, type: rumoured}]}
unions:
  - {partners: [x, y]}
`);
	for (const on of [true, false]) {
		// D176 item 7 fixed this older fault: the extra name takes the line of the pair of children, with its top alone.
		it(`setting ${on ? 'on' : 'off'}: "rumoured half-sister" has a step with "rumoured"`, () => {
			const r = findRelation(g, 'a', 'b', { oneParentUnknown: on });
			expect(r.kind).toBe('named');
			if (r.kind !== 'named') return;
			const names = r.relations.map((x) => x.relation.lower);
			expect(names).toEqual(['sister', 'rumoured half-sister']);
			const steps = r.relations[1].steps.map((s) => s.word);
			// f458add: ["father", "wife", "daughter"]: a full couple, no "rumoured", no "half".
			expect(steps.some((w) => w.includes('rumoured'))).toBe(true);
		});
	}
});

describe('review D131b finding 3: names by marriage do not depend on the order of the people (D2)', () => {
	// X has S (with Z), and M and Q (with Y). M marries S. P is the child of M and Q.
	const head = ['{id: x, name: X, sex: m}', '{id: z, name: Z, sex: f}', '{id: y, name: Y, sex: f}', '{id: s, name: S, sex: f, parents: [x, z]}'];
	const m = '{id: m, name: M, sex: m, parents: [x, y]}';
	const q = '{id: q, name: Q, sex: f, parents: [x, y]}';
	const p = '{id: p, name: P, sex: m, parents: [m, q]}';
	const tree = (people: string[]) => graph(`people:\n${people.map((l) => `  - ${l}`).join('\n')}\nunions:\n  - {partners: [m, s]}\n`);
	for (const on of [true, false]) {
		// Repaired in 0.5 step 1(d): the tree without M's blood links restores the name in every order.
		it(`setting ${on ? 'on' : 'off'}: M then Q, or Q then M, give the same names for P`, () => {
			const first = computeRelations(tree([...head, m, q, p]), 'm', { oneParentUnknown: on }).get('p')!.map((r) => r.text);
			const second = computeRelations(tree([...head, q, m, p]), 'm', { oneParentUnknown: on }).get('p')!.map((r) => r.text);
			// Before the repair: ["Son", "Nephew"] against ["Son", "Nephew", "Wife’s half-nephew"].
			expect(first).toEqual(second);
		});
	}
});
