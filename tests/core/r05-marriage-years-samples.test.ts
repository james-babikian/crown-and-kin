/*
 * Version 0.5 step 1a-B: the words of the sample trees that the years change on purpose (RULES §7 rows 65 to 77, and the scan of every
 * pair of every sample tree against 0.4.0: only the names below changed, in both settings of "Assume an unknown second parent").
 * Sample trees 2, 7, 7b, 11 and 17 are the ones that have dates on their marriages; every other sample tree reads as before.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { fixtureSource } from '../acceptance/load';
import { stepsOf, wordsOf } from './r05-marriage-years-trees';

function sample(id: string): FamilyGraph {
	const r = parseDynasty(fixtureSource(id));
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** [from, to, words]; checked in both settings. */
type Pair = [string, string, string];

function pairs(name: string, id: string, rows: Pair[]): void {
	describe(name, () => {
		const g = sample(id);
		for (const [from, to, want] of rows) {
			it(`${from} to ${to}: ${want}`, () => {
				for (const on of [true, false]) expect(wordsOf(g, from, to, { oneParentUnknown: on })).toBe(want);
			});
		}
	});
}

pairs('sample tree 2: a wife who died before the child was born is not a stepmother (rows 65 to 69)', '02', [
	// Changed (D304): Agnes died in 1131 and Beatrix in 1142, before these children were born.
	['sybil', 'agnes', 'Father’s wife'],
	['sybil', 'beatrix', 'Father’s wife'],
	['piers', 'agnes', 'Father’s wife'],
	['osric', 'agnes', 'Father’s wife'],
	['osric', 'beatrix', 'Father’s wife'],
	['beatrix', 'sybil', 'Husband’s daughter'],
	['agnes', 'piers', 'Husband’s son'],
	['agnes', 'osric', 'Husband’s son'],
	['agnes', 'sybil', 'Husband’s daughter'],
	['beatrix', 'osric', 'Husband’s son'],
	// Not changed: the lives overlap, a marriage that ends with a death gives no "Former", and a name by marriage has no time test.
	['hugo', 'beatrix', 'Stepmother'],
	['maud', 'beatrix', 'Stepmother'],
	['piers', 'clarice', 'Stepmother'],
	['edmund', 'agnes', 'Wife'],
	['godric', 'beatrix', 'Daughter-in-law'],
	['cecily', 'agnes', 'Sister-in-law'],
	['agnes', 'cecily', 'Sister-in-law'],
]);

pairs('sample tree 11: the grandmother who died before the son of her husband was born (D304)', '11', [['maud', 'osric', 'Grandson | Husband’s son']]);

for (const id of ['07', '07b']) {
	pairs(`sample tree ${id}: a wife who died before the son was born (D304)`, id, [
		['felicia-kestrel', 'raoul-valmont-2', 'Husband’s son | Husband’s great-nephew'],
		['raoul-valmont-2', 'felicia-kestrel', 'Father’s wife | Great-aunt by marriage'],
	]);
}

describe('sample tree 17: a divorced couple (D305, D307; rows 70 to 77)', () => {
	const g = sample('17');
	const rows: Pair[] = [
		// Edda and Anselm were married 1058 to 1063 and both lived on to 1090 or later: an exact end year before both deaths.
		['edda', 'anselm', 'Former husband'],
		['anselm', 'edda', 'Former wife'],
		['wren', 'anselm', 'Mother’s former husband'],
		['anselm', 'wren', 'Former wife’s daughter'],
		['tobias', 'anselm', 'Adoptive mother’s former husband'],
		['anselm', 'tobias', 'Former wife’s adopted son'],
		['pia', 'anselm', 'Grandmother’s former husband'],
		['anselm', 'pia', 'Former wife’s granddaughter'],
		// Not changed: marriages that are open, or that ended with a death.
		['hale', 'lisbet', 'Stepmother'],
		['hale', 'merrin', 'Stepsister'],
		['garrick', 'brenna', 'Stepmother'],
		['hale', 'ysolt', 'Wife'],
		['hale', 'anselm', 'Father'],
	];
	for (const [from, to, want] of rows) {
		it(`${from} to ${to}: ${want}`, () => {
			for (const on of [true, false]) expect(wordsOf(g, from, to, { oneParentUnknown: on })).toBe(want);
		});
	}
	it('row 76: the chain of Merrin and Anselm says "former husband"', () => {
		expect(stepsOf(g, 'merrin', 'anselm').slice(-1)).toEqual(['anselm is edda’s former husband']);
	});
});
