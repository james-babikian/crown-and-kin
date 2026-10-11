/*
 * 0.2.8 test round, branch scratch/r028-test-kin. One FAILING test for each kept finding of the search round's
 * genealogy checker (an internal study, area A2 "kin", ids F-KIN-01 to F-KIN-12). The scratch scripts of the
 * checker were turned into tests; every case is small and written out by hand.
 *
 * Each test fails on release-0.2.8 for the reason in its name. Tests marked "owner choice" check today's fault; the
 * owner decides on the findings page what the right answer is. Tests marked "spec question" fail against the plain
 * words of the spec only if the spec is read as the finding reads it; the report lists the question.
 *
 * 0.2.8 P1: F-KIN-02, 03, 04a/b, 05 (limit), 08, 09 (limit), 12 (limit). The three limits were failing proofs; the owner decided
 * (D200 R5, contract B.1) that they stay as written limits, so their tests now pin what the plugin does and say so.
 *
 * Run: npx vitest run tests/review-r028-kin-relations.test.ts
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, type RelationOptions } from '../src/core/relations';
import { cardRelationText, relationInfo } from '../src/render/tree-info';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

function graphOf(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	return deriveFamilies(r.tree);
}

/** Lines are "id sex parent[:type] ...", sex "-" for none; unions are "a,b". */
function tree(people: string[], unions: string[] = []): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		const refs = parents.map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		out.push(`  - {id: ${id}, name: ${id}${sex === '-' ? '' : `, sex: ${sex}`}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`);
	}
	if (unions.length) out.push('unions:', ...unions.map((u) => `  - partners: [${u}]`));
	return graphOf(out.join('\n') + '\n');
}

/** All relation texts that `me` has for `other`, the card word first. */
function texts(g: FamilyGraph, me: string, other: string, o: RelationOptions = ON): string[] {
	const l = computeRelations(g, me, o).get(other) ?? [];
	return l.map((r, i) => (i === 0 ? cardRelationText(r) : r.text));
}
const card = (g: FamilyGraph, me: string, other: string, o: RelationOptions = ON): string => texts(g, me, other, o)[0] ?? '(none)';

describe('F-KIN-02 (owner choice) a rumoured short line hides the sure longer line to the same ancestor', () => {
	it('F-KIN-02: H is the sure great-grandson of F and lists F as a rumoured father: "Great-grandfather" is not shown', () => {
		const g = tree(['F m', 'S m F', 'G m S', 'H m G F:rumoured']);
		expect.soft(card(g, 'H', 'F')).toBe('Rumoured father');
		const all = texts(g, 'H', 'F').join(' | ');
		expect(all, 'the sure line of three steps up to F').toMatch(/great-grandfather/i);
	});
});

describe('F-KIN-03 (owner choice) a name by marriage shows as sure when the only link is rumoured', () => {
	const sure = (text: string) => text !== '(none)' && !/rumoured|maybe/i.test(text);
	it('F-KIN-03: stepmother, sister-in-law, son-in-law and stepchild through a rumoured link show no sign of the rumour', () => {
		// A wife whose sister is only rumoured; a stepmother married to a rumoured father; a son-in-law through a
		// rumoured daughter; a stepchild who is the rumoured child of the wife.
		const sisterInLaw = tree(['Q m', 'M m', 'W f Q', 'P f Q:rumoured'], ['M,W']);
		const stepmother = tree(['N m', 'Q f', 'M - N:rumoured'], ['N,Q']);
		const sonInLaw = tree(['M m', 'D f M:rumoured', 'H m'], ['D,H']);
		const stepchild = tree(['Q f', 'M m', 'P - Q:rumoured'], ['M,Q']);
		expect.soft(card(sisterInLaw, 'M', 'P'), 'wife’s rumoured sister').not.toSatisfy(sure);
		expect.soft(card(stepmother, 'M', 'Q'), 'wife of a rumoured father').not.toSatisfy(sure);
		expect.soft(card(sonInLaw, 'M', 'H'), 'husband of a rumoured daughter').not.toSatisfy(sure);
		expect.soft(card(stepchild, 'M', 'P'), 'rumoured child of the wife').not.toSatisfy(sure);
	});
});

describe('F-KIN-04 the card word changes with the order of the people when two names tie', () => {
	it('F-KIN-04a: "Stepmother" and "Mother-in-law" tie; the card word is the same in four orders of the people', () => {
		const L: Record<string, string> = { A: 'A m', B: 'B f', C: 'C f B', D: 'D m A' };
		const seen = new Map<string, string>();
		for (const order of ['ABCD', 'DABC', 'CDAB', 'BCDA']) {
			const g = tree([...order].map((n) => L[n]), ['A,B', 'D,C']);
			seen.set(order, `${card(g, 'D', 'B')} / ${card(g, 'B', 'D')}`);
		}
		expect([...new Set(seen.values())], JSON.stringify([...seen])).toHaveLength(1);
	});

	it('F-KIN-04b: a sure name wins over the rumoured name of the same distance (§13.1 rule 4), in five orders', () => {
		// M is married to H, the son of Q. Q is the father of U (sure) and of a rumoured half-brother line: both names
		// are "Husband’s half-uncle", one sure, one with the word rumoured. Rule 4 puts rumoured last.
		const base = ['X m', 'Z f', 'Y m', 'Q m X Z:rumoured Y', 'U m X Z', 'H m Q', 'M f'];
		const by = new Map(base.map((l) => [l.split(' ')[0], l]));
		const heads: string[] = [];
		for (const names of ['XZYQUHM', 'UXZYQHM', 'ZQUXYHM', 'YZXUQHM', 'QUZYXHM']) {
			const g = tree([...names].map((n) => by.get(n)!), ['M,H']);
			heads.push(`${names}: ${card(g, 'M', 'U')}`);
		}
		for (const h of heads) expect(h, heads.join('; ')).not.toMatch(/rumoured/i);
	});
});

describe('F-KIN-05 a child with three birth parents has an order-dependent "Co-parent"', () => {
	it('F-KIN-05: known limit (D200 R5 / contract B.1): only the first two listed parents are co-parents; the input already gets too-many-parents', () => {
		// The partner names use the two parents used for placement, so the pair depends on the order listed. §13.1 says so.
		const pairs = (order: string[]) => {
			const g = tree(['a m', 'b f', 'c m', `k - ${order.join(' ')}`]);
			return [
				['a', 'b'],
				['a', 'c'],
				['b', 'c'],
			]
				.map(([x, y]) => `${x}${y}:${card(g, x, y)}`)
				.join(' ');
		};
		expect(pairs(['a', 'b', 'c'])).toBe('ab:Co-parent ac:(none) bc:(none)');
		expect(pairs(['c', 'b', 'a'])).toBe('ab:(none) ac:(none) bc:Co-parent');
		expect(pairs(['b', 'c', 'a'])).toBe('ab:(none) ac:(none) bc:Co-parent');
	});
});

describe('F-KIN-08 the closed phone strip drops ", maybe full"', () => {
	it('F-KIN-08: the card says "Half-sister, maybe full"; the line the closed strip shows says "maybe full" too (spec question)', () => {
		const g = tree(['D m', 'Mary f', 'Fiona f D Mary', 'Helen f Mary'], ['D,Mary']);
		const rels = computeRelations(g, 'Fiona', ON).get('Helen')!;
		expect.soft(cardRelationText(rels[0])).toBe('Half-sister, maybe full');
		// §13.1 says the closed strip "shows the main relation"; the owner has the card words off, so the strip is the only place.
		expect(relationInfo(rels, false).sentence).toMatch(/maybe full/);
	});
});

describe('F-KIN-09 the list "Also" differs by direction for a pair with two lines of equal length', () => {
	it('F-KIN-09: known limit (D200 R5 / contract B.1): c0 and c3 share the card words in both directions; the "Also" list of c0 has one more name', () => {
		// f1 has a0 and a1. c0 is the child of b4 (a child of a1) and of a0 (rumoured). c3 is the child of b3 (a child
		// of a1) and of a0. The card word is the same from both sides; the rumoured line of equal length shows from c0 only.
		const g = tree(['f1 -', 'a0 - f1', 'a1 - f1', 'b3 - a1', 'b4 - a1', 'c0 - b4 a0:rumoured', 'c3 - b3 a0']);
		expect(texts(g, 'c0', 'c3', OFF)).toEqual(['Rumoured half-sibling', 'First cousin', 'First cousin once removed', 'Rumoured first cousin once removed']);
		expect(texts(g, 'c3', 'c0', OFF)).toEqual(['Rumoured half-sibling', 'First cousin', 'First cousin once removed']);
		expect(texts(g, 'c0', 'c3', ON)[0]).toBe(texts(g, 'c3', 'c0', ON)[0]);
	});
});

describe('F-KIN-12 levirate: "Stepchild" in one direction and no "Stepfather" in the other', () => {
	it('F-KIN-12: known limit (D200 R5 / contract B.1): rule 1 skips a blood relative of M; rule 2 does not; the card word is the same', () => {
		const g = tree(['G m', 'F m G', 'U m G', 'W f', 'k - F W'], ['F,W', 'U,W']);
		expect(texts(g, 'U', 'k')).toEqual(['Half-sibling’s child, maybe full', 'Stepchild']);
		expect(texts(g, 'k', 'U')).toEqual(['Half-uncle, maybe full']);
	});
});
