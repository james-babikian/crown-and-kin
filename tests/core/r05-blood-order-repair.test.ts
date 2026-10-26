/*
 * Version 0.5 step 1(f), the repair of the blood-name order fault with an adoptive link (design gate: an internal study).
 * `tests/core/r05-blood-order.test.ts` proves the fault on the finding-6 tree. These tests pin the cases of the gate: the main case G1
 * and G7 with the marked person on both sides, the fuzz shape s300, the cases where "adoptive" must stay (L2/G3, L5, G5, L10, L11,
 * the ward L6 and the rumoured L7), and the two known limits M2 and s274, with their output today. The by-marriage cases M1 and M3
 * are in an internal test. Each case is read in many orders of the people and of the parent lists.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, type Relation } from '../../src/core/relations';

/** A person: id, sex, then the parents; a parent is `id` (birth) or `id~type`. */
type Spec = readonly [id: string, sex: 'm' | 'f', ...parents: string[]];

const text = (list: readonly Relation[] | undefined) => (list ?? []).map((r) => r.text + (r.maybe ? `, maybe ${r.maybe.effect}` : '')).join(' | ');
const link = (s: string) => {
	const [id, type] = s.split('~');
	return type ? `{id: ${id}, type: ${type}}` : id;
};

/** A fixed shuffle, so a failure can be repeated. */
function shuffled<T>(list: readonly T[], seed: number): T[] {
	const out = [...list];
	let s = seed * 7919 + 13;
	for (let i = out.length - 1; i > 0; i--) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		const j = s % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** The note of `specs`; with a `seed`, the people and every parent list are in another order. */
function note(specs: readonly Spec[], unions: readonly string[], seed?: number): string {
	const list = seed === undefined ? specs : shuffled(specs, seed);
	const rows = list.map(([id, sex, ...parents], k) => {
		const ps = seed === undefined ? parents : shuffled(parents, seed * 31 + k);
		return `  - {id: ${id}, name: ${id.toUpperCase()}, sex: ${sex}${ps.length ? `, parents: [${ps.map(link).join(', ')}]` : ''}}`;
	});
	return `people:\n${rows.join('\n')}\n${unions.length ? `unions:\n${unions.map((u) => `  - {partners: [${u}]}`).join('\n')}\n` : ''}`;
}

/** The different texts of `me` to `other`: the written order and 150 other orders of the people and of the parent lists. */
function seen(specs: readonly Spec[], unions: readonly string[], me: string, other: string, on: boolean, runs = 150): string[] {
	const out = new Set<string>();
	for (let k = -1; k < runs; k++) {
		const r = parseDynasty(note(specs, unions, k < 0 ? undefined : k));
		if (!r.ok) throw new Error(r.error.code);
		out.add(text(computeRelations(deriveFamilies(r.tree), me, { oneParentUnknown: on }).get(other)));
	}
	return [...out];
}

/** The tree of the gate: A is X2's child adopted by X1; B and D are children of X1 and X2; E is B's daughter and F is D's daughter. */
const base = (o: { a?: string[]; d?: string[]; e?: string[]; f?: string[]; p?: string[]; g?: boolean } = {}): Spec[] => [
	['x1', 'm'],
	['x2', 'f'],
	['y', 'm'],
	['a', 'm', ...(o.a ?? ['x2', 'x1~adoptive'])],
	['b', 'f', 'x1', 'x2'],
	['d', 'm', ...(o.d ?? ['x1', 'x2'])],
	['e', 'f', ...(o.e ?? ['b'])],
	['f', 'f', ...(o.f ?? ['d'])],
	// G is X2's son by Y, so X2 is nearer to P through G than through D.
	...(o.g === false ? [] : ([['g', 'm', 'x2', 'y']] as Spec[])),
	['p', 'm', ...(o.p ?? ['f', 'g', 'e~adoptive'])],
];
const MARRIED = ['x1, x2'];
const SETTINGS = [true, false];
const one = (want: string, got: string[]) => expect(got).toEqual([want]);

describe('r05 blood-name order: the main case G1 (X2 is nearer to P through G)', () => {
	for (const on of SETTINGS) {
		// With the setting on, A's unknown second birth parent makes the half name "maybe full".
		const maybe = on ? ', maybe full' : '';
		it(`setting ${on ? 'on' : 'off'}: A sees P as "Half-nephew${maybe} | Great-nephew" in every order`, () => one(`Half-nephew${maybe} | Great-nephew`, seen(base(), [], 'a', 'p', on)));
		it(`setting ${on ? 'on' : 'off'}: P sees A as "Half-uncle${maybe} | Great-uncle" in every order`, () => one(`Half-uncle${maybe} | Great-uncle`, seen(base(), [], 'p', 'a', on)));
		it(`setting ${on ? 'on' : 'off'}: G7, X1 and X2 married: the same names`, () => {
			one(`Half-nephew${maybe} | Great-nephew`, seen(base(), MARRIED, 'a', 'p', on));
			one(`Half-uncle${maybe} | Great-uncle`, seen(base(), MARRIED, 'p', 'a', on));
		});
		it(`setting ${on ? 'on' : 'off'}: the mirror, D adopted by X1 and A a birth child, gives "Half-nephew | Great-nephew"`, () => {
			one('Half-nephew | Great-nephew', seen(base({ a: ['x2', 'x1'], d: ['x2', 'x1~adoptive'] }), [], 'a', 'p', on));
		});
	}
});

describe('r05 blood-name order: the finding-6 tree F6 and its mirror', () => {
	// X1 and X2 have no union; E is the child of A and B, F is the child of D and X2 (the tree of `r05-blood-order.test.ts`).
	const f6 = (o: { a?: string[]; d?: string[] } = {}): Spec[] => [
		['x1', 'm'],
		['x2', 'f'],
		['a', 'm', ...(o.a ?? ['x2', 'x1~adoptive'])],
		['b', 'f', 'x1', 'x2'],
		['d', 'm', ...(o.d ?? ['x1', 'x2'])],
		['e', 'f', 'a', 'b'],
		['f', 'f', 'd', 'x2'],
		['p', 'm', 'f', 'e~adoptive'],
	];
	it('setting on: "Adopted grandson | Half-nephew, maybe full | Great-nephew" in every order', () => {
		one('Adopted grandson | Half-nephew, maybe full | Great-nephew', seen(f6(), [], 'a', 'p', true));
	});
	it('setting off: "Adopted grandson | Half-nephew | Great-nephew" in every order', () => {
		one('Adopted grandson | Half-nephew | Great-nephew', seen(f6(), [], 'a', 'p', false));
	});
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: the mirror gives "Adopted grandson | Half-nephew | Great-nephew" in every order`, () => {
			one('Adopted grandson | Half-nephew | Great-nephew', seen(f6({ a: ['x2', 'x1'], d: ['x2', 'x1~adoptive'] }), [], 'a', 'p', on));
		});
	}
});

describe('r05 blood-name order: the fuzz shape s300 (people order and parent-list order)', () => {
	// D (g1d) has the birth line to the great-nephew E (g3e) through C and the adoptive line through A (g1a, adoptive child of X).
	const s300: Spec[] = [
		['x', 'm'],
		['w', 'f'],
		['g1a', 'f', 'x~adoptive', 'w'],
		['g1c', 'm', 'x', 'w'],
		['g1d', 'f', 'w', 'x~adoptive'],
		['g2b', 'm', 'g1c', 'g1a'],
		['g2d', 'f', 'g1a~adoptive', 'w~adoptive'],
		['g3e', 'm', 'g2b', 'g2d'],
	];
	const unions = ['g1a, g1c', 'g2b, g2d'];
	for (const on of SETTINGS) {
		it(`setting ${on ? 'on' : 'off'}: D sees E as "Adoptive half-nephew | Great-nephew", and E sees D as "Adoptive half-aunt | Great-aunt"`, () => {
			one('Adoptive half-nephew | Great-nephew', seen(s300, unions, 'g1d', 'g3e', on));
			one('Adoptive half-aunt | Great-aunt', seen(s300, unions, 'g3e', 'g1d', on));
		});
	}
});

describe('r05 blood-name order: where "adoptive" must stay', () => {
	// The plain tree of the gate: no G, E and F have one parent each.
	const plain = (o: Parameters<typeof base>[0] = {}) => base({ g: false, p: ['f', 'e~adoptive'], ...o });
	for (const on of SETTINGS) {
		const tag = `setting ${on ? 'on' : 'off'}`;
		it(`${tag}: L1, both lines (birth through D, adoptive through B): "Great-nephew"`, () => {
			one('Great-nephew', seen(plain(), [], 'a', 'p', on));
			one('Great-uncle', seen(plain(), [], 'p', 'a', on));
		});
		it(`${tag}: L2, only the adoptive line: "Adoptive great-nephew"`, () => {
			const l2 = plain().filter(([id]) => id !== 'd').map((s): Spec => (s[0] === 'f' ? ['f', 'f'] : s));
			one('Adoptive great-nephew', seen(l2, [], 'a', 'p', on));
		});
		it(`${tag}: G3, a half-nephew and only the adoptive line: "Half-nephew | Adoptive great-nephew"`, () => {
			one(`Half-nephew${on ? ', maybe full' : ''} | Adoptive great-nephew`, seen(base({ f: [] }), [], 'a', 'p', on));
		});
		it(`${tag}: L5, A adopted by both X1 and X2: every line is adoptive`, () => {
			one('Adoptive great-nephew', seen(plain({ a: ['x1~adoptive', 'x2~adoptive'] }), [], 'a', 'p', on));
		});
		it(`${tag}: G5, F adopted by D: both lines adoptive`, () => {
			one(`Half-nephew${on ? ', maybe full' : ''} | Adoptive great-nephew`, seen(base({ f: ['d~adoptive'] }), [], 'a', 'p', on));
		});
		it(`${tag}: L10, the legal sister of the sample tree 8: "Adoptive nephew"`, () => {
			const pia: Spec[] = [['wren', 'f'], ['calla', 'f'], ['pia', 'f', 'wren', 'calla~adoptive'], ['fenn', 'm', 'calla', 'wren~adoptive'], ['n', 'm', 'fenn']];
			one('Adoptive nephew', seen(pia, ['wren, calla'], 'pia', 'n', on));
		});
		it(`${tag}: L11, A (X2, adopted by X1) and D (X1 and X2) married: "Nephew"`, () => {
			const l11: Spec[] = [['x1', 'm'], ['x2', 'f'], ['a', 'm', 'x2', 'x1~adoptive'], ['d', 'm', 'x1', 'x2'], ['n', 'm', 'd']];
			one('Nephew', seen(l11, MARRIED, 'a', 'n', on));
		});
		it(`${tag}: L6, A a ward of X1: a half name, with "maybe full" only when the setting is on`, () => {
			one(on ? 'Half-great-nephew, maybe full' : 'Half-great-nephew', seen(plain({ a: ['x2', 'x1~ward'] }), [], 'a', 'p', on));
		});
		it(`${tag}: L7, A a rumoured child of X1: the rumoured name stays, with "maybe full" in both settings`, () => {
			one('Half-great-nephew, maybe full | Rumoured great-nephew', seen(plain({ a: ['x2', 'x1~rumoured'] }), [], 'a', 'p', on));
		});
	}
});

describe('r05 blood-name order: known limits (the output today, pinned)', () => {
	it('M2: M is D, married to his legal sister S; the "Wife’s adoptive great-nephew" is true but shown in no order', () => {
		const m2: Spec[] = [
			['x1', 'm'],
			['x2', 'f'],
			['y', 'm'],
			['s', 'f', 'x2', 'x1~adoptive'],
			['b', 'f', 'x1', 'x2'],
			['m', 'm', 'x1', 'x2'],
			['g', 'm', 'x2', 'y'],
			['e', 'f', 'b'],
			['f', 'f', 'm'],
			['p', 'm', 'f', 'g', 'e~adoptive'],
		];
		for (const on of SETTINGS) one('Grandson | Half-nephew | Adoptive great-nephew | Wife’s half-nephew', seen(m2, ['m, s'], 'm', 'p', on));
	});
	it('s274 (the fuzz tree, reduced): the parent list of a child with three adoptive parents decides "Adoptive sister" or "Adoptive half-sister" (setting on)', () => {
		// D293: the first two parents of T share an implicit union only if they are next to each other in the list; that union makes C and E full.
		const people = (t: string[]): Spec[] => [
			['g0a', 'f'],
			['g1a', 'f'],
			['g1b', 'f'],
			['g2c', 'f', 'g1a~adoptive', 'g0a'],
			['g2d', 'f', ...t],
			['g2e', 'f', 'g0a~adoptive', 'g1a'],
		];
		const lists: [string[], boolean, string][] = [
			[['g0a~adoptive', 'g1a~adoptive', 'g1b~adoptive'], true, 'Adoptive sister'],
			[['g0a~adoptive', 'g1b~adoptive', 'g1a~adoptive'], true, 'Adoptive half-sister'],
			[['g0a~adoptive', 'g1a~adoptive', 'g1b~adoptive'], false, 'Adoptive sister'],
			[['g0a~adoptive', 'g1b~adoptive', 'g1a~adoptive'], false, 'Adoptive sister'],
		];
		for (const [list, on, name] of lists) one(name, seen(people(list), ['g1b, g1a'], 'g2c', 'g2e', on, 0));
	});
});
