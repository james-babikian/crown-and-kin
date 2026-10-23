/*
 * G2 review of D174 (sibling labels): failing tests that prove the findings of the review.
 * All names are made up.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Compact lines "id sex parent[:type]…" ("-" for no sex). */
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

/** The names of `other` to `me`, with the maybe of each ("effect/cause"). */
function names(g: FamilyGraph, me: string, other: string, o: RelationOptions): string[] {
	return (computeRelations(g, me, o).get(other) ?? []).map((r) => (r.maybe ? `${r.text} [maybe ${r.maybe.effect}/${r.maybe.cause}]` : r.text));
}

describe('review D174: a rumoured parent who is also a birth parent', () => {
	// Spec §13.1 "Half": a child is incomplete if ... the child has a rumoured parent
	// ("a rumoured parent who is also in the sure set does not count").
	// Ann lists Mary as birth parent and again as rumoured parent; Bea lists only Mary.
	const g = tree(['m f', 'a f m m:rumoured', 'b f m']);

	it('with the setting off, Ann and Bea are full sisters (the rumoured Mary is in the sure set)', () => {
		expect(names(g, 'a', 'b', OFF)).toEqual(['Sister']);
		expect(names(g, 'b', 'a', OFF)).toEqual(['Sister']);
	});
});

describe('review D174: names must not depend on the order of siblings (D2)', () => {
	// Mary (m) has three children: Carl (c, lists only Mary), Dora (d, Mary and Zeno) and Edda (e,
	// Mary and Yves). Carl's son Ulf and Dora's daughter Vera are first cousins and have a child Fay.
	// Edda's daughter is Pia. Fay reaches Mary through Carl and through Dora at the same distance.
	// The two trees differ only in the order of Carl and Dora in the note.
	const base = ['m f', 'z m', 'y m'];
	const rest = ['e f m y', 'u m c', 'v f d', 'f f u v', 'p f e'];
	const carlFirst = tree([...base, 'c m m', 'd f m z', ...rest], ['u, v']);
	const doraFirst = tree([...base, 'd f m z', 'c m m', ...rest], ['u, v']);

	for (const [label, o] of [
		['on', ON],
		['off', OFF],
	] as const) {
		it(`setting ${label}: Pia's name to Fay is the same in both orders`, () => {
			expect(names(doraFirst, 'f', 'p', o)).toEqual(names(carlFirst, 'f', 'p', o));
			expect(names(doraFirst, 'p', 'f', o)).toEqual(names(carlFirst, 'p', 'f', o));
		});
	}
});

describe('review D174: the finder sentence and its sibling step agree (spec §13.2)', () => {
	// Xan (x) and Zoe (z) are a couple. Cal lists Xan and a rumoured Zoe; Dot lists Xan and a rumoured
	// Zoe (the Alice and Beatrix pattern). Fay lists Cal as a rumoured father; Pia is Dot's daughter.
	const g = tree(['x m', 'z f', 'c1 m x z:rumoured', 'c2 f x z:rumoured', 'f f c1:rumoured', 'p f c2']);

	for (const [label, o] of [
		['on', ON],
		['off', OFF],
	] as const) {
		it(`setting ${label}: a full cousin sentence does not step through a "half-sister"`, () => {
			const r = findRelation(g, 'f', 'p', o);
			if (r.kind !== 'named') throw new Error(r.kind);
			const first = r.relations[0];
			const sentenceHalf = first.relation.lower.includes('half');
			const stepHalf = first.steps.some((s) => s.word.includes('half-'));
			expect({ sentence: first.relation.lower, steps: first.steps.map((s) => s.word), stepHalf }).toEqual({ sentence: first.relation.lower, steps: first.steps.map((s) => s.word), stepHalf: sentenceHalf });
		});
	}

	it('(pre-existing on main) one couple is not a "double" cousin', () => {
		expect(names(g, 'f', 'p', ON)).not.toContain('Rumoured double first cousin');
	});
});
