import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../src/core/relations';
import { cardRelationText } from '../src/render/tree-info';

// D176 items (4) and (7): the case table of the vetted rule (rows 1 to 18). All names are made up.

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

/** Compact lines "id sex parent[:type]…"; a union line "u a b" is not needed, so couples are implicit. */
function tree(people: string[], unions: string[][] = []): FamilyGraph {
	const out = ['people:'];
	for (const line of people) {
		const [id, sex, ...parents] = line.split(' ');
		out.push(`  - id: ${id}`, `    name: ${id}`);
		if (sex !== '-') out.push(`    sex: ${sex}`);
		if (parents.length) {
			const refs = parents.map((p) => {
				const [pid, type] = p.split(':');
				return type ? `{id: ${pid}, type: ${type}}` : pid;
			});
			out.push(`    parents: [${refs.join(', ')}]`);
		}
	}
	if (unions.length) {
		out.push('unions:');
		for (const u of unions) out.push(`  - partners: [${u.join(', ')}]`);
	}
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** What the card, the "Also" names and the finder show for `to` as a relative of `from`. */
function facts(g: FamilyGraph, from: string, to: string, options: RelationOptions = ON) {
	const list = computeRelations(g, from, options).get(to) ?? [];
	const found = findRelation(g, from, to, options);
	if (found.kind !== 'named') throw new Error(found.kind);
	return {
		card: cardRelationText(list[0]),
		maybe: list[0].maybe ? `${list[0].maybe.effect}/${list[0].maybe.cause}${list[0].maybe.some ? '/some' : ''}` : undefined,
		also: list.slice(1).map((r) => r.text),
		finder: found.relations.map((x) => `${x.relation.lower}: ${x.steps.map((s) => s.word).join(', ')}`),
	};
}

const M = ['m m', 'x m', 'y m', 'z m', 'w m'];
const halfFull = { card: 'Half-sister, maybe full', maybe: 'full/rumoured/some', also: ['Rumoured sister'], finder: ['half-sister: half-sister', 'rumoured sister: rumoured sister'] };

describe('D176 item 4: sets of rumoured parents (rows 1 to 8, 16)', () => {
	const g = tree([
		...M,
		'ada f m x:rumoured y:rumoured',
		'bea f m x',
		'cal f m x:rumoured',
		'dee f m y:rumoured x:rumoured',
		'cla f m z:rumoured',
		'hel f m',
	]);
	it('row 1: Ada (Mark, ~Xavier, ~Yves) and Bea (Mark, Xavier) are half-sisters, maybe full, with the name Rumoured sister', () => {
		expect(facts(g, 'ada', 'bea')).toEqual(halfFull);
	});
	it('row 2: Ada and Cal (Mark, ~Xavier) are the same', () => {
		expect(facts(g, 'ada', 'cal')).toEqual(halfFull);
	});
	it('row 3: Ada and Dee (Mark, ~Yves, ~Xavier) are the same, whatever the order of the parents', () => {
		expect(facts(g, 'ada', 'dee')).toEqual(halfFull);
	});
	it('row 4: Ada and Clara (Mark, ~Zane) are half-sisters with no maybe and no other name', () => {
		expect(facts(g, 'ada', 'cla')).toEqual({ card: 'Half-sister', maybe: undefined, also: [], finder: ['half-sister: half-sister'] });
	});
	it('row 5: Ada and Helen (Mark only): the setting on gives a maybe with the cause "unlisted", the setting off gives none', () => {
		const on = { card: 'Half-sister, maybe full', maybe: 'full/unlisted', also: [], finder: ['half-sister: half-sister'] };
		expect(facts(g, 'ada', 'hel', ON)).toEqual(on);
		expect(facts(g, 'hel', 'ada', ON)).toEqual(on);
		const off = { card: 'Half-sister', maybe: undefined, also: [], finder: ['half-sister: half-sister'] };
		expect(facts(g, 'ada', 'hel', OFF)).toEqual(off);
		expect(facts(g, 'hel', 'ada', OFF)).toEqual(off);
	});
	it('row 18: the people of rows 1 and 2 swapped give the same names and maybe', () => {
		expect(facts(g, 'bea', 'ada')).toEqual(halfFull);
		expect(facts(g, 'cal', 'ada')).toEqual(halfFull);
	});
	it('row 1, setting off: the same (every person has a rumoured parent beyond the birth parents)', () => {
		expect(facts(g, 'ada', 'bea', OFF)).toEqual(halfFull);
	});
	it('row 6: Ada (Mark, ~X, ~Y, ~Z) and Bea (Mark, Yves) are half-sisters, maybe full', () => {
		const h = tree([...M, 'ada f m x:rumoured y:rumoured z:rumoured', 'bea f m y']);
		expect(facts(h, 'ada', 'bea')).toEqual(halfFull);
		expect(facts(h, 'bea', 'ada')).toEqual(halfFull);
	});
	it('row 16: Ada (Mark, ~X, ~Y, ~Z) and Ada-b (Mark, ~Y, ~Z, ~W) are half-sisters, maybe full', () => {
		const h = tree([...M, 'ada f m x:rumoured y:rumoured z:rumoured', 'adb f m y:rumoured z:rumoured w:rumoured']);
		expect(facts(h, 'ada', 'adb')).toEqual(halfFull);
	});
	it('row 7: Pia (~X, ~Y, ~Z) and Quin (X, Y): a rumoured sister, not a rumoured half-sister, no maybe', () => {
		const h = tree([...M, 'pia f x:rumoured y:rumoured z:rumoured', 'qu f x y']);
		const want = { card: 'Rumoured sister', maybe: undefined, also: [], finder: ['rumoured sister: rumoured sister'] };
		expect(facts(h, 'pia', 'qu')).toEqual(want);
		expect(facts(h, 'qu', 'pia')).toEqual(want);
	});
	it('row 8: Kay (Pa, ~Qu, ~Ro) and Lou (Qu, Pa, ~Ro): half-sisters, maybe full (the whole set of three alone would match, so it stays a choice)', () => {
		const h = tree(['pa m', 'qu m', 'ro m', 'kay f pa qu:rumoured ro:rumoured', 'lou f qu pa ro:rumoured']);
		// 0.2.8 R4: Lou has two birth parents and a rumoured third, so Lou may also have just Qu and Pa. That set equals Kay's choice
		// (Pa, Qu), which leaves out Ro: the rumour of Ro need not be true, so the flag "some" is set (before R4: every rumoured link, no flag).
		const some = { ...halfFull, maybe: 'full/rumoured/some' };
		expect(facts(h, 'kay', 'lou')).toEqual(some);
		expect(facts(h, 'lou', 'kay')).toEqual(some);
	});
	it('a pair whose rumoured sets are equal as a whole has no "some": every rumoured link must be true', () => {
		const h = tree([...M, 'a f m x:rumoured', 'b f m x:rumoured']);
		expect(facts(h, 'a', 'b').maybe).toBe('full/rumoured');
	});
});

describe('D176 item 4: a child with two birth parents keeps one set (rows 9 to 11, 17)', () => {
	it('row 9: G (Mark, Xavier, ~Yves, ~Zane) and Bea (Mark, Xavier): sister, maybe half, the line says rumoured half-sister', () => {
		const g = tree([...M, 'g f m x y:rumoured z:rumoured', 'bea f m x']);
		const want = { card: 'Sister, maybe half', maybe: 'half/rumoured', also: ['Rumoured half-sister'], finder: ['sister: father, co-parent, daughter', 'rumoured half-sister: rumoured half-sister'] };
		expect(facts(g, 'g', 'bea')).toEqual(want);
		expect(facts(g, 'bea', 'g')).toEqual(want);
	});
	it('row 10: Gwen (Mark, Xavier, ~Xavier) and Bea (Mark, Xavier): sister, nothing else', () => {
		const g = tree([...M, 'gwen f m x x:rumoured', 'bea f m x']);
		expect(facts(g, 'gwen', 'bea')).toEqual({ card: 'Sister', maybe: undefined, also: [], finder: ['sister: father, co-parent, daughter'] });
	});
	it('row 11 (and row 18): Eleanor (David, Mary, ~Yannick) and Fiona (David, Mary): sister, maybe half; the rumoured name is one step', () => {
		const g = tree(['mary f', 'david m', 'yan m', 'el f david mary yan:rumoured', 'fi f david mary'], [['david', 'mary']]);
		const want = { card: 'Sister, maybe half', maybe: 'half/rumoured', also: ['Rumoured half-sister'], finder: ['sister: father, wife, daughter', 'rumoured half-sister: rumoured half-sister'] };
		expect(facts(g, 'el', 'fi')).toEqual(want);
		expect(facts(g, 'fi', 'el')).toEqual(want);
	});
	it('row 17: Ad (adoptive Mark, ~X, ~Y) and Bd (adoptive Mark, X): adoptive sister, no maybe; the name Rumoured half-sister is as before', () => {
		const g = tree([...M, 'ad f m:adoptive x:rumoured y:rumoured', 'bd f m:adoptive x']);
		expect(facts(g, 'ad', 'bd')).toEqual({ card: 'Adoptive sister', maybe: undefined, also: ['Rumoured half-sister'], finder: ['adoptive sister: adoptive sister', 'rumoured half-sister: rumoured half-sister'] });
	});
});

describe('D176 item 7: the rumoured half name has a line of its own (rows 12 to 15)', () => {
	const g = tree(
		['mary f', 'david m', 'yan m', 'el f david mary yan:rumoured', 'fi f david mary', 'ek f el', 'fk f fi'],
		[['david', 'mary']],
	);
	it('row 12: the daughters of Eleanor and Fiona: first cousin, maybe half; the rumoured half name goes through one sibling step', () => {
		const f = facts(g, 'ek', 'fk');
		expect(f.card).toBe('First cousin, maybe half');
		expect(f.also).toEqual(['Rumoured half first cousin']);
		expect(f.finder[1]).toBe('rumoured half first cousin: mother, rumoured half-sister, daughter');
	});
	it('row 13: Eleanor and the daughter of Fiona: niece, maybe half', () => {
		const f = facts(g, 'el', 'fk');
		expect(f.card).toBe('Niece, maybe half');
		expect(f.also).toEqual(['Rumoured half-niece']);
		expect(f.finder[1]).toBe('rumoured half-niece: rumoured half-sister, daughter');
	});
	it('row 14: the daughter of Eleanor and Fiona: aunt, maybe half', () => {
		const f = facts(g, 'ek', 'fi');
		expect(f.card).toBe('Aunt, maybe half');
		expect(f.also).toEqual(['Rumoured half-aunt']);
		expect(f.finder[1]).toBe('rumoured half-aunt: mother, rumoured half-sister');
	});
	it('row 15: the daughters of Ada and Bea: half first cousin, maybe full; the steps of the rumoured name say "rumoured"', () => {
		const h = tree([...M, 'ada f m x:rumoured y:rumoured', 'bea f m x', 'ak f ada', 'bk f bea']);
		for (const [a, b] of [
			['ak', 'bk'],
			['bk', 'ak'],
		]) {
			const f = facts(h, a, b);
			expect(f.card).toBe('Half first cousin, maybe full');
			expect(f.maybe).toBe('full/rumoured/some');
			expect(f.also).toEqual(['Rumoured first cousin']);
			expect(f.finder[1].includes('rumoured', f.finder[1].indexOf(':'))).toBe(true);
		}
	});
});
