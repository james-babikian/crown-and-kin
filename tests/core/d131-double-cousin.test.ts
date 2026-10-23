/*
 * D175 (spec §0 D175, §13.1 "Double", "Half" and "Sure and maybe"): one couple is not a "double"
 * cousin. A couple that includes a rumoured parent, and a sure couple plus a rumoured parent, are one
 * couple, so their grandchildren are "Rumoured first cousin", never "Rumoured double first cousin".
 * Written from the spec before the build; the cases V1, V5 and V6 fail until the D175 core work is
 * merged. Every case runs with the setting "Assume an unknown second parent" on and off (D174).
 * All names are made up.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type Relation, type RelationOptions } from '../../src/core/relations';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };
const SETTINGS: [string, RelationOptions][] = [
	['on', ON],
	['off', OFF],
];

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Compact lines "id sex parent[:type]…" ("-" for no sex); the name of each person is its id. */
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

/** `other`'s relations to `me`, best first (the first is the card, the rest is the list "Also"). */
function rels(g: FamilyGraph, me: string, other: string, o: RelationOptions): readonly Relation[] {
	return computeRelations(g, me, o).get(other) ?? [];
}

const texts = (list: readonly Relation[]) => list.map((r) => r.text);
const doubles = (list: readonly Relation[]) => texts(list).filter((t) => t.toLowerCase().includes('double'));

/**
 * Checks Fay (f) and Pia (p) in both directions (both have sex f, so the words are the same):
 * the whole list of names, no "double" word, and no maybe. Every line in these trees uses a rumoured
 * link, so §13.1 "Sure and maybe" rule 1 takes half or full from the second test, and rules 2 and 4
 * (a relation that uses no rumoured link) give no maybe.
 */
function checkRumoured(g: FamilyGraph, o: RelationOptions, want: string) {
	for (const [me, other] of [
		['f', 'p'],
		['p', 'f'],
	]) {
		const list = rels(g, me, other, o);
		const label = `${me} → ${other}`;
		expect(texts(list), label).toEqual([want]);
		expect(doubles(list), label).toEqual([]);
		for (const r of list) expect(r.maybe, `${label}: ${r.text}`).toBeUndefined();
	}
}

// V1 to V6: Fay (f) lists Cal (c1) as a rumoured parent; Pia (p) lists Dot (c2). Xan (x) is a man, all others are women.
const FAY_PIA = ['f f c1:rumoured', 'p f c2'];

describe('D175: a couple with a rumoured parent is one couple (spec §13.1 "Double")', () => {
	// V1: Cal and Dot both list Xan and a rumoured Zoe. The second test gives {Xan, Zoe} for both: full,
	// and Xan and Zoe are one couple, so the name is not "double" (the example of D175).
	const v1 = tree(['x m', 'z f', 'c1 f x z:rumoured', 'c2 f x z:rumoured', ...FAY_PIA]);
	// The same tree with Xan and Zoe also in a recorded marriage: every union counts (§13.1), still one couple.
	const v1Married = tree(['x m', 'z f', 'c1 f x z:rumoured', 'c2 f x z:rumoured', ...FAY_PIA], ['x, z']);

	for (const [label, o] of SETTINGS) {
		it(`V1, setting ${label}: Fay and Pia are "Rumoured first cousin", not double`, () => {
			checkRumoured(v1, o, 'Rumoured first cousin');
		});

		it(`V1 with a recorded marriage of Xan and Zoe, setting ${label}: "Rumoured first cousin"`, () => {
			checkRumoured(v1Married, o, 'Rumoured first cousin');
		});

		it(`V1, setting ${label}: the finder says "rumoured first cousin", keeps a rumoured step, has no co-parent and no half step (§13.2)`, () => {
			for (const [first, second] of [
				['f', 'p'],
				['p', 'f'],
			]) {
				const r = findRelation(v1, first, second, o);
				if (r.kind !== 'named') throw new Error(`expected named, got ${r.kind}`);
				const top = r.relations[0];
				const label2 = `${first} → ${second}`;
				expect(top.relation.lower, label2).toBe('rumoured first cousin');
				// Xan and Zoe have no recorded union, so the line may not call them a couple (D175 fix round):
				// it passes a common ancestor and keeps a rumoured link, and no step says "co-parent".
				expect(top.relation.line.people.some((id) => id === 'x' || id === 'z'), label2).toBe(true);
				expect(top.steps.some((s) => s.word.includes('rumoured')), label2).toBe(true);
				expect(top.steps.filter((s) => s.word.includes('co-parent')).map((s) => s.word), label2).toEqual([]);
				// The sentence and the steps agree: a full relation has no "half" sibling step.
				expect(
					top.steps.filter((s) => s.word.includes('half')).map((s) => s.word),
					label2,
				).toEqual([]);
				for (const { relation } of r.relations) expect(relation.lower, label2).not.toContain('double');
			}
		});
	}

	// V2: Zoe is rumoured for Cal only (Dot lists only Xan). Second test: {Xan, Zoe} and {Xan}: half.
	// Zoe is not an ancestor of Pia, so there is one line, through Xan.
	const v2 = tree(['x m', 'z f', 'c1 f x z:rumoured', 'c2 f x', ...FAY_PIA]);
	// V3: two different rumoured mothers (Zoe for Cal, Wen for Dot). Second test: {Xan, Zoe} and {Xan, Wen}: half.
	const v3 = tree(['x m', 'z f', 'w f', 'c1 f x z:rumoured', 'c2 f x w:rumoured', ...FAY_PIA]);
	// V4: both parents rumoured for both children. Second test: {Xan, Zoe} for both: full; one couple.
	const v4 = tree(['x m', 'z f', 'c1 f x:rumoured z:rumoured', 'c2 f x:rumoured z:rumoured', ...FAY_PIA]);
	// V5: Zoe is a birth parent of Cal and a rumoured parent of Dot. Second test: {Xan, Zoe} for both: full;
	// Xan and Zoe are one couple (a sure couple on Cal's side, a rumoured parent on Dot's side).
	const v5 = tree(['x m', 'z f', 'c1 f x z', 'c2 f x z:rumoured', ...FAY_PIA]);
	// V6: Cal and Dot list the birth parents Xan and Wen and a rumoured Zoe. Sure sets {Xan, Wen}: full;
	// second test {Xan, Wen, Zoe} for both: full. A sure couple plus a rumoured parent is one couple (D175).
	const v6 = tree(['x m', 'w f', 'z f', 'c1 f x w z:rumoured', 'c2 f x w z:rumoured', ...FAY_PIA]);

	for (const [label, o] of SETTINGS) {
		it(`V2, setting ${label}: Zoe rumoured for Cal only: "Rumoured half first cousin"`, () => {
			checkRumoured(v2, o, 'Rumoured half first cousin');
		});

		it(`V3, setting ${label}: two different rumoured mothers: "Rumoured half first cousin"`, () => {
			checkRumoured(v3, o, 'Rumoured half first cousin');
		});

		it(`V4, setting ${label}: both parents rumoured for both children: "Rumoured first cousin"`, () => {
			checkRumoured(v4, o, 'Rumoured first cousin');
		});

		it(`V5, setting ${label}: Zoe a birth parent of Cal and rumoured for Dot: "Rumoured first cousin", not double`, () => {
			checkRumoured(v5, o, 'Rumoured first cousin');
		});

		it(`V6, setting ${label}: a sure couple plus a rumoured parent: "Rumoured first cousin", not double`, () => {
			checkRumoured(v6, o, 'Rumoured first cousin');
		});
	}
});

describe('D175: two different couples still make a "double" cousin (spec §13.1 "Double")', () => {
	// V7: two brothers-and-sisters marriages. Couple 1 (x1 + z1) has a son a1 and a daughter b1; couple 2
	// (x2 + z2) has a son a2 and a daughter b2. Fay's parents are a1 and b2, Pia's parents are a2 and b1.
	// Fay and Pia are first cousins through couple 1 (a1, b1) and through couple 2 (b2, a2). All links are sure.
	const v7 = tree(['x1 m', 'z1 f', 'x2 m', 'z2 f', 'a1 m x1 z1', 'b1 f x1 z1', 'a2 m x2 z2', 'b2 f x2 z2', 'f f a1 b2', 'p f a2 b1'], ['x1, z1', 'x2, z2', 'a1, b2', 'a2, b1']);

	// V8: two real couples that share one person. Xan + Zoe have Cal1 and Dot1; Xan + Wen have Cal2 and Dot2.
	// Fay lists Cal1 and Cal2; Pia lists Dot1 and Dot2. The couples {Xan, Zoe} and {Xan, Wen} are different,
	// and the two full lines leave through different children (Cal1 and Dot1; Cal2 and Dot2).
	const v8People = ['x m', 'z f', 'w f', 'c1 m x z', 'd1 m x z', 'c2 f x w', 'd2 f x w'];
	const v8 = tree([...v8People, 'f f c1 c2', 'p f d1 d2'], ['x, z', 'x, w']);

	for (const [label, o] of SETTINGS) {
		it(`V7, setting ${label}: two couples, all sure: "Double first cousin"`, () => {
			for (const [me, other] of [
				['f', 'p'],
				['p', 'f'],
			]) {
				const list = rels(v7, me, other, o);
				// Spec §13.1 "Double": the same cousin name from two couples is one name; "other names are only listed once".
				expect(texts(list), `${me} → ${other}`).toEqual(['Double first cousin']);
				// Rule 5 of "Sure and maybe": a double name has no maybe.
				expect(list[0]?.maybe, `${me} → ${other}`).toBeUndefined();
			}
		});

		it(`V8, setting ${label}: two couples that share Xan: "Double first cousin"`, () => {
			for (const [me, other] of [
				['f', 'p'],
				['p', 'f'],
			]) {
				const list = rels(v8, me, other, o);
				expect(list[0]?.text, `${me} → ${other}`).toBe('Double first cousin');
				expect(list[0]?.maybe, `${me} → ${other}`).toBeUndefined();
				// The double name is listed once; the spec does not fix whether a half name through Xan alone is also listed.
				expect(doubles(list), `${me} → ${other}`).toEqual(['Double first cousin']);
			}
		});
	}

	// V9: as V8, but Fay's link to Cal2 is rumoured. The line through Xan + Zoe is a birth line ("First
	// cousin", full: both sure sets are {Xan, Zoe}); the line through Xan + Wen uses a rumoured link
	// ("Rumoured first cousin", full in the second test: {Xan, Wen} for both). §13.1 "Double": a birth line and
	// a rumoured line do not join into one "double" name. "Which name wins" rule 4: at equal distance (4),
	// birth before rumoured, so the card shows "First cousin" and the list "Also" has "Rumoured first cousin".
	// The birth line uses no rumoured link and both sets in the second test stay {Xan, Zoe}: no maybe.
	const v9 = tree([...v8People, 'f f c1 c2:rumoured', 'p f d1 d2'], ['x, z', 'x, w']);

	for (const [label, o] of SETTINGS) {
		it(`V9, setting ${label}: a birth couple and a rumoured couple: "First cousin", also "Rumoured first cousin", no double`, () => {
			for (const [me, other] of [
				['f', 'p'],
				['p', 'f'],
			]) {
				const list = rels(v9, me, other, o);
				const l = `${me} → ${other}`;
				expect(list[0]?.text, l).toBe('First cousin');
				expect(list[0]?.maybe, l).toBeUndefined();
				expect(texts(list).slice(1), l).toContain('Rumoured first cousin');
				expect(doubles(list), l).toEqual([]);
			}
		});
	}
});
