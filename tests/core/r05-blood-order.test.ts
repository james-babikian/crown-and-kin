/*
 * Version 0.5 step 1(f), proof of the BLOOD-name order fault (no fix; scratch branch scratch/r05-blood-order).
 *
 * The tree (design gate finding 6): X1 and X2 have no union; A is X2's child, adopted by X1; B and D are children of X1
 * and X2; E is the child of A and B; F is the child of D and X2; P is F's birth child, adopted by E. From A, P is
 * "Adopted grandson | Half-nephew, maybe full | Great-nephew". In half of all people orders (B before D in the note) the
 * plugin shows "Adoptive great-nephew" instead of "Great-nephew".
 *
 * Cause: `Kin.collateral` (src/core/relations.ts 1039-1111). The great-nephew name is the full couple X1+X2, searched at
 * X1 (X2 has a nearer pair, so it gives no a=1,b=3 pair). At X1 the pairs (A,B) and (A,D) have the same distance and the
 * same key. Their `lo` (line 1061) is the rank of the links of c1 and c2 to x = X1, and A's link to X1 is adoptive, so
 * lo = 1 for both pairs, but the drawn line of this full couple goes up through X2 (`orderCouple` puts X2 first, birth)
 * and the word (`wordOf`, 1408) reads only that link. So level 0 is skipped for both pairs (1076), level 1 takes the pair
 * first in `down[X1]` order, and (A,B) has the adoptive link P to E below c2: word "adoptive". The pair (A,D), all
 * birth, has the same key and is passed over by the "taken" test (1080-1088: `couldAdd` 1119 returns false when no
 * rumour is in play and the setting does not make the pair half), so its better word is never seen; `joinCandidates`
 * (1924) would have taken it. With D before B the pair (A,D) comes first and wins.
 * The same cause shows on the other side: D (c2) adopted by X1 and A a birth child (second describe block).
 */

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';

/** The tree of the finding; `a`, `d` and `p` are the parent lists of A, D and P (the finding: A adopted by X1, P adopted by E). */
const tree = (a = '[x2, {id: x1, type: adoptive}]', d = '[x1, x2]', p = '[f, {id: e, type: adoptive}]'): Record<string, string> => ({
	x1: '{id: x1, name: X1, sex: m}',
	x2: '{id: x2, name: X2, sex: f}',
	a: `{id: a, name: A, sex: m, parents: ${a}}`,
	b: '{id: b, name: B, sex: f, parents: [x1, x2]}',
	d: `{id: d, name: D, sex: m, parents: ${d}}`,
	e: '{id: e, name: E, sex: f, parents: [a, b]}',
	f: '{id: f, name: F, sex: f, parents: [d, x2]}',
	p: `{id: p, name: P, sex: m, parents: ${p}}`,
});
const PEOPLE = tree();
const SETTINGS = [true, false];
const perms = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));

/** The names of P seen from A, with the people in the given order. */
function names(order: string[], on: boolean, people = PEOPLE): string {
	const r = parseDynasty(`people:\n${order.map((k) => `  - ${people[k]}`).join('\n')}\n`);
	if (!r.ok) throw new Error(r.error.code);
	const rel = computeRelations(deriveFamilies(r.tree), 'a', { oneParentUnknown: on }).get('p');
	return (rel ?? []).map((x) => x.text + (x.maybe ? `, maybe ${x.maybe.effect}` : '')).join(' | ');
}

/** The different texts over every order of `moving`, after the people in `head`, with the count of each. */
function sweep(head: string[], moving: string[], on: boolean): Map<string, number> {
	const out = new Map<string, number>();
	for (const order of perms(moving)) {
		const t = names([...head, ...order], on);
		out.set(t, (out.get(t) ?? 0) + 1);
	}
	return out;
}

describe('r05 blood-name order fault: the finding-6 tree', () => {
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: B before D and D before B give the same names`, () => {
			const base = ['x1', 'x2', 'a', 'e', 'f', 'p'];
			// 029de640+: "Adopted grandson | Half-nephew[, maybe full] | Adoptive great-nephew" with B first, "... | Great-nephew" with D first.
			expect(names([...base, 'b', 'd'], on)).toBe(names([...base, 'd', 'b'], on));
		});
		it(`setting ${on ? 'on' : 'off'}: the right name is "Great-nephew"`, () => {
			expect(names(['x1', 'x2', 'a', 'b', 'd', 'e', 'f', 'p'], on).endsWith('| Great-nephew')).toBe(true);
			expect(names(['x1', 'x2', 'a', 'd', 'b', 'e', 'f', 'p'], on).endsWith('| Great-nephew')).toBe(true);
		});
		it(`setting ${on ? 'on' : 'off'}: one text in all 720 orders of six people (360 differ today)`, () => {
			const seen = sweep(['x1', 'x2'], ['a', 'b', 'd', 'e', 'f', 'p'], on);
			expect([...seen.entries()]).toHaveLength(1);
		});
	}
	// The whole sweep (8! = 40 320 orders, 20 160 differ today in each setting) takes about a minute: FULL=1 npx vitest run ...
	for (const on of SETTINGS) {
		it.skipIf(!process.env.FULL)(`setting ${on ? 'on' : 'off'}: one text in all 40 320 orders`, () => {
			const seen = sweep([], Object.keys(PEOPLE), on);
			if (process.env.FULL_OUT) writeFileSync(process.env.FULL_OUT + (on ? '-on' : '-off') + '.txt', JSON.stringify([...seen.entries()], null, 1));
			expect([...seen.entries()]).toHaveLength(1);
		});
	}
});

describe('r05 blood-name order fault: the same cause on the other side of the pair, and the types that are not affected', () => {
	const base = ['x1', 'x2', 'a', 'e', 'f', 'p'];
	const both = (people: Record<string, string>, on: boolean) => [names([...base, 'b', 'd'], on, people), names([...base, 'd', 'b'], on, people)];
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: D adopted by X1 and A a birth child (the link of c2 to X is the adoptive one): same names in both orders`, () => {
			// Same cause: the pair (A,D) at X1 has lo 1 because of D's adoptive link to X1, though its line runs up through X2.
			const [one, two] = both(tree('[x2, x1]', '[x2, {id: x1, type: adoptive}]'), on);
			expect(one).toBe(two);
		});
		// These pass today: the fault needs an adoptive link to X, and a rumoured or ward link makes the search look at every pair.
		it(`setting ${on ? 'on' : 'off'}: A rumoured by X1 gives the same names in both orders (passes today)`, () => {
			const [one, two] = both(tree('[x2, {id: x1, type: rumoured}]'), on);
			expect(one).toBe(two);
		});
		it(`setting ${on ? 'on' : 'off'}: P a rumoured or ward child of E gives the same names in both orders (passes today)`, () => {
			for (const type of ['rumoured', 'ward']) {
				const [one, two] = both(tree(undefined, undefined, `[f, {id: e, type: ${type}}]`), on);
				expect(one).toBe(two);
			}
		});
		it(`setting ${on ? 'on' : 'off'}: A a birth child of X1 gives "Great-nephew" in both orders (passes today)`, () => {
			const [one, two] = both(tree('[x2, x1]'), on);
			expect(one).toBe(two);
			expect(one.endsWith('| Great-nephew')).toBe(true);
		});
	}
});
