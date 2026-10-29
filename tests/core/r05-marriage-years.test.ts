/*
 * Version 0.5 step 1a-B, the words that follow the years and the word "former" (owner decisions D304 to D309; the rule is
 * an internal study, the case table is §7). Every row of the table is built from the sample trees of
 * `r05-marriage-years-trees.ts` and read as a card text for the pair, in the order of the people in the note and in the reverse
 * order, with the setting "Assume an unknown second parent" on and off (it changes no row).
 */

import { describe, expect, it } from 'vitest';
import { findRelation, lineSubgraph, relationsKey } from '../../src/core/relations';
import {
	graphOf, p, readerWith, reversed, stepsOf, treeC, treeF, treeN, treeR, treeR2, treeV, treeX, w, wordsOf,
	type Tree,
} from './r05-marriage-years-trees';

type Row = [row: number, tree: Tree, from: string, to: string, want: string];

/** Every row, on the tree as written and on the tree with the people, the unions and the parents reversed; both settings. */
function table(name: string, rows: Row[]): void {
	describe(name, () => {
		for (const [row, tree, from, to, want] of rows) {
			it(`row ${row}: ${from} to ${to} reads "${want}"`, () => {
				for (const on of [true, false]) {
					const options = { oneParentUnknown: on };
					expect(wordsOf(graphOf(tree), from, to, options), `as written, setting ${on}`).toBe(want);
					const back = reversed(tree);
					expect(wordsOf(graphOf(tree, undefined, back.people, back.unions), from, to, options), `reversed, setting ${on}`).toBe(want);
				}
			});
		}
	});
}

const N = treeN();
const V = treeV();
const R = treeR();
const R2 = treeR2();
const Rsw = treeR({}, true);
const C = treeC();

table('partner words (D305, rows 1 to 10)', [
	[1, N, 'ned', 'ola', 'Former wife'],
	[1, N, 'ola', 'ned', 'Former husband'],
	[3, V, 'vic', 'wyn', 'Former wife'],
	[3, V, 'wyn', 'vic', 'Former wife'],
	[4, V, 'vs', 'nx', 'Former spouse'],
	[4, V, 'nx', 'vs', 'Former wife'],
	[5, C, 'cm', 'cw', 'Former wife | First cousin'],
	[6, R, 'ra', 'rb', 'Wife'],
	[6, Rsw, 'ra', 'rb', 'Wife'],
	[7, R2, 'ra', 'rb', 'Former wife'],
	[7, treeR2(true), 'ra', 'rb', 'Former wife'],
	[
		8,
		{ people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { type: 'affair' }), w('a', 'b', { start: '1120', end: '1130', endedBy: 'divorce' })] },
		'a',
		'b',
		'Former wife',
	],
	[8, { people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { start: '1120', end: '1130', endedBy: 'divorce' }), w('a', 'b', { type: 'affair' })] }, 'a', 'b', 'Lover'],
	[9, { people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { type: 'handfasting', endedBy: 'divorce' })] }, 'a', 'b', 'Former wife'],
	[10, { people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { type: 'affair', endedBy: 'divorce' })] }, 'a', 'b', 'Lover'],
	[10, { people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { type: 'betrothal', end: '1112' })] }, 'a', 'b', 'Betrothed'],
	[10, { people: [p('a', 'm'), p('b', 'f')], unions: [w('a', 'b', { type: 'concubinage', endedBy: 'annulment' })] }, 'a', 'b', 'Partner in concubinage'],
]);

table('step words and "Former" (rows 11 to 28)', [
	[11, N, 'pip', 'ola', 'Former stepmother'],
	[12, N, 'ola', 'pip', 'Former stepson'],
	[13, N, 'pip', 'quin', 'Former stepsister'],
	[13, N, 'quin', 'pip', 'Former stepbrother'],
	[14, N, 'qc', 'ned', 'Former step-grandfather'],
	[14, N, 'ned', 'qc', 'Former step-grandson'],
	[15, N, 'pc', 'ola', 'Former step-grandmother'],
	[15, N, 'ola', 'pc', 'Former step-granddaughter'],
	[16, V, 'vk', 'wyn', 'Former stepmother'],
	[16, V, 'wyn', 'vk', 'Former stepson'],
	[17, N, 'kit', 'ola', 'Father’s former wife'],
	[18, N, 'ola', 'kit', 'Former husband’s daughter'],
	[19, N, 'kit', 'quin', ''],
	[20, N, 'rk', 'ola', 'Rumoured former stepmother'],
	[21, N, 'rk2', 'ola', 'Rumoured father’s former wife'],
	[22, N, 'ad', 'ola', 'Former stepmother'],
	[22, N, 'ola', 'ad', 'Former stepson'],
	[23, N, 'ad2', 'ola', 'Adoptive father’s former wife'],
	[23, N, 'ola', 'ad2', 'Former husband’s adopted son'],
	[25, R, 'rc', 'rb', 'Stepmother'],
	[25, R, 'rb', 'rc', 'Stepson'],
	[25, Rsw, 'rc', 'rb', 'Stepmother'],
	[26, R, 're', 'rb', 'Father’s wife'],
	[26, Rsw, 're', 'rb', 'Father’s wife'],
	[27, R2, 'rc', 'rb', 'Former stepmother'],
	[27, R2, 're', 'rb', 'Father’s former wife'],
	[27, treeR2(true), 're', 'rb', 'Father’s former wife'],
	[
		28,
		{ people: [p('yul', 'm'), p('ann', 'f'), p('zed', 'm', '1120', '1125', ['yul'])], unions: [w('yul', 'ann', { start: '1118', end: '1130', endedBy: 'divorce' })] },
		'zed',
		'ann',
		'Stepmother',
	],
	[
		28,
		{ people: [p('yul', 'm'), p('ann', 'f'), p('zed', 'm', '1120', '1125', ['yul'])], unions: [w('yul', 'ann', { start: '1118', end: '1130', endedBy: 'divorce' })] },
		'ann',
		'zed',
		'Stepson',
	],
]);

table('names by marriage with "Former" (rows 29 to 50)', [
	[29, N, 'ned', 'tess', 'Former sister-in-law'],
	[30, N, 'tess', 'ned', 'Former brother-in-law'],
	[31, treeN({ tessDied: '1145' }), 'ned', 'tess', 'Sister-in-law'],
	[31, treeN({ tessDied: '1145' }), 'tess', 'ned', 'Brother-in-law'],
	[32, N, 'op', 'ned', 'Former son-in-law'],
	[32, N, 'ned', 'op', 'Former father-in-law'],
	[33, N, 'opp', 'ned', 'Former grandson-in-law'],
	[33, N, 'ned', 'opp', 'Former grandfather-in-law'],
	[34, N, 'nm', 'ola', 'Former daughter-in-law'],
	[34, N, 'ola', 'nm', 'Former mother-in-law'],
	[35, N, 'ns', 'ola', 'Former sister-in-law'],
	[35, N, 'ola', 'ns', 'Former sister-in-law'],
	[36, N, 'ned', 'ohs', 'Former sister-in-law'],
	[36, N, 'ned', 'osx', 'Former sibling-in-law'],
	[37, N, 'tn', 'ned', 'Former uncle by marriage'],
	[37, N, 'hn', 'ned', 'Former uncle by marriage'],
	[38, N, 'nsn', 'ola', 'Former aunt by marriage'],
	[39, N, 'oa', 'ned', 'Former nephew by marriage'],
	[40, N, 'oc', 'ned', 'Former first cousin by marriage'],
	[41, V, 'vk', 'nx', 'Former parent’s sibling by marriage'],
	[41, V, 'vic', 'nx', 'Former sibling-in-law'],
	[42, N, 'ned', 'hn', 'Former wife’s half-nephew'],
	[43, N, 'ned', 'tn', 'Former wife’s nephew'],
	[43, N, 'ned', 'oa', 'Former wife’s aunt'],
	[43, N, 'ned', 'oc', 'Former wife’s first cousin'],
	[44, N, 'ola', 'nsn', 'Former husband’s nephew'],
	[44, V, 'nx', 'vk', 'Former wife’s nephew'],
	[45, N, 'qcc', 'ned', 'Great-grandmother’s former husband'],
	[46, N, 'ned', 'qcc', 'Former wife’s great-grandson'],
	[48, R, 'rs', 'ra', 'Brother-in-law'],
	[48, R, 'ra', 'rs', 'Sister-in-law'],
	[49, R2, 'rs', 'ra', 'Former brother-in-law'],
	[49, R2, 'ra', 'rs', 'Former sister-in-law'],
	[50, treeX(), 'me', 'ola', 'Sister-in-law'],
	[50, treeX(), 'ola', 'me', 'Brother-in-law'],
]);

describe('row 47: the ordinal stays in the blood word', () => {
	// A (f) and B (m) are divorced; M is A's descendant in the fifth generation, so B is her 3rd great-grandmother's husband.
	const chain = (ended: boolean): Tree => ({
		people: [p('a', 'f'), p('b', 'm'), p('c1', 'm', undefined, undefined, ['a']), p('c2', 'f', undefined, undefined, ['c1']), p('c3', 'f', undefined, undefined, ['c2']), p('c4', 'f', undefined, undefined, ['c3']), p('c5', 'f', undefined, undefined, ['c4'])],
		unions: [w('a', 'b', { start: '1100', end: '1110', ...(ended ? { endedBy: 'divorce' } : {}) })],
	});
	table('', [
		[47, chain(true), 'c5', 'b', '3rd great-grandmother’s former husband'],
		[47, chain(false), 'c5', 'b', '3rd great-grandmother’s husband'],
	]);
});

describe('rows 2, 24 and 76: the finder uses the same words', () => {
	const g = graphOf(N);
	it('row 2: "Ned is Ola’s former husband."', () => {
		expect(stepsOf(g, 'ola', 'ned')).toEqual(['ned is ola’s former husband']);
	});
	it('row 24: the partner step of a pair of names reads "former"', () => {
		expect(stepsOf(g, 'rk', 'ola')).toEqual(['ned is rk’s rumoured father', 'ola is ned’s former wife']);
	});
	it('row 19: Kit and Quin have no name; the chain says "former wife"', () => {
		const r = findRelation(g, 'kit', 'quin');
		expect(r.kind).toBe('chain');
		expect(stepsOf(g, 'kit', 'quin')).toEqual(['ned is kit’s father', 'ola is ned’s former wife', 'quin is ola’s daughter']);
	});
	it('row 31: the name keeps "Sister-in-law" but the step reads "former wife"', () => {
		const dead = graphOf(treeN({ tessDied: '1145' }));
		expect(stepsOf(dead, 'ned', 'tess')[0]).toBe('ola is ned’s former wife');
	});
	it('row 13: the order of the parents decides nothing (each `parents` list reversed)', () => {
		const back = reversed(N);
		const h = graphOf(N, undefined, back.people, back.unions);
		expect(wordsOf(h, 'pip', 'quin')).toBe('Former stepsister');
		expect(wordsOf(h, 'quin', 'pip')).toBe('Former stepbrother');
	});
	it('row 50: the line of the name runs through B2, whose marriage is open', () => {
		const x = graphOf(treeX());
		const r = findRelation(x, 'me', 'ola');
		expect(r.kind).toBe('named');
		if (r.kind !== 'named') return;
		expect(r.relations.map((e) => e.relation.text)).toEqual(['Sister-in-law']);
		expect(r.relations[0].relation.line.people).toContain('b2');
		expect(r.relations[0].relation.line.people).not.toContain('b1');
	});
	it('a union of the line keeps `ended-by` in the small tree', () => {
		const r = findRelation(g, 'ola', 'ned');
		if (r.kind !== 'named') throw new Error('no name');
		const sub = lineSubgraph(g, r.relations[0].relation.line);
		expect(sub.unions.find((u) => !u.implicit)?.endedBy).toBe('divorce');
	});
});

describe('the fallback of D306 and the years of D304 (rows 52 to 61)', () => {
	const F1 = { start: '1120', end: '1130' };
	const run = (name: string, tree: Tree, want: [string, string, string, string]) => {
		it(name, () => {
			const g = graphOf(tree);
			expect([wordsOf(g, 'fa', 'fb'), wordsOf(g, 'fc', 'fb'), wordsOf(g, 'fd', 'fb'), wordsOf(g, 'fb', 'fd')]).toEqual(want);
			const back = reversed(tree);
			const h = graphOf(tree, undefined, back.people, back.unions);
			expect([wordsOf(h, 'fa', 'fb'), wordsOf(h, 'fc', 'fb'), wordsOf(h, 'fd', 'fb'), wordsOf(h, 'fb', 'fd')]).toEqual(want);
		});
	};
	run('row 52 and 53: F1 `start: 1120, end: 1130`, both deaths later', treeF(F1), ['Former wife', 'Former stepmother', 'Father’s former wife', 'Former husband’s daughter']);
	run('row 54: F2 = F1 with `ended-by: death`', treeF({ ...F1, endedBy: 'death' }), ['Wife', 'Stepmother', 'Father’s wife', 'Husband’s daughter']);
	run('row 55: F3 = F1 with no death for Fb: no fallback', treeF(F1, null), ['Wife', 'Stepmother', 'Father’s wife', 'Husband’s daughter']);
	run('row 56: F4 `end: c. 1130` is not exact', treeF({ start: '1120', end: 'c. 1130' }), ['Wife', 'Stepmother', 'Stepmother', 'Stepdaughter']);
	run('row 57: F5 `end: 1170` equals the death of Fa: equal years never decide', treeF({ start: '1120', end: '1170' }), ['Wife', 'Stepmother', 'Stepmother', 'Stepdaughter']);
	run('row 58: F6 = F1 with `ended-by: separation` (an unknown value gives no key)', treeF({ ...F1, endedBy: 'separation' }), ['Former wife', 'Former stepmother', 'Father’s former wife', 'Former husband’s daughter']);
	run('row 59: F7 `end: after 1135`, `ended-by: Divorce` (case ignored, end not exact)', treeF({ start: '1120', end: 'after 1135', endedBy: 'Divorce' }), ['Former wife', 'Former stepmother', 'Former stepmother', 'Former stepdaughter']);
	run('row 60: F8 `ended-by: divorce`, no end', treeF({ start: '1120', endedBy: 'divorce' }), ['Former wife', 'Former stepmother', 'Former stepmother', 'Former stepdaughter']);
	run('row 61: F9 `end: 1135`, divorce; Fd born 1135: equal years keep the step', treeF({ start: '1120', end: '1135', endedBy: 'divorce' }), ['Former wife', 'Former stepmother', 'Former stepmother', 'Former stepdaughter']);
	run('D306 aliases: `ended-by: divorced` is a divorce', treeF({ start: '1120', endedBy: 'divorced' }), ['Former wife', 'Former stepmother', 'Former stepmother', 'Former stepdaughter']);
	run('an `ended-by` that is not a word of the list changes nothing', treeF({ start: '1120', endedBy: 'constructor' }), ['Wife', 'Stepmother', 'Stepmother', 'Stepdaughter']);
	run('`end: divorced` with no year (a text, not a key) gives no "Former"', treeF({ start: '1120', end: 'divorced' }), ['Wife', 'Stepmother', 'Stepmother', 'Stepdaughter']);
	run('an explicit divorce wins over an end year after the deaths', treeF({ start: '1120', end: '1180', endedBy: 'divorce' }), ['Former wife', 'Former stepmother', 'Former stepmother', 'Former stepdaughter']);
});

describe('calendar trees (rows 62 to 64)', () => {
	const date = 'Year 3 of Cycle 2';
	it('row 62: a tree with no calendar reads no year from "Year 3 of Cycle 2"; the key still counts', () => {
		const g = graphOf(treeF({ start: '1120', end: date, endedBy: 'divorce' }));
		expect([wordsOf(g, 'fa', 'fb'), wordsOf(g, 'fd', 'fb')]).toEqual(['Former wife', 'Former stepmother']);
	});
	it('row 63: a tree that names a calendar changes once, when the reader is ready', () => {
		const tree = treeF({ start: '1120', end: date, endedBy: 'divorce' });
		expect(wordsOf(graphOf(tree, readerWith(false)), 'fd', 'fb')).toBe('Former stepmother');
		expect(wordsOf(graphOf(tree, readerWith(true)), 'fd', 'fb')).toBe('Father’s former wife');
	});
	it('row 64: the fallback reads a calendar year', () => {
		const tree = treeF({ start: '1120', end: date });
		expect(wordsOf(graphOf(tree, readerWith(false)), 'fa', 'fb')).toBe('Wife');
		expect(wordsOf(graphOf(tree, readerWith(true)), 'fa', 'fb')).toBe('Former wife');
	});
	it('the reader key and the readiness are in the key of the words', () => {
		const tree = treeF({ start: '1120', end: date });
		expect(relationsKey(graphOf(tree, readerWith(false)), 'fa')).not.toBe(relationsKey(graphOf(tree, readerWith(true)), 'fa'));
	});
});

describe('the posthumous child is a known limit (spec §13.1)', () => {
	it('a child born the year after the father died: his widow reads "Father’s wife" by the strict test (D304)', () => {
		const tree: Tree = { people: [p('fa', 'm', '1100', '1130'), p('wi', 'f', '1105'), p('cp', 'm', '1131', undefined, ['fa'])], unions: [w('fa', 'wi', { start: '1120' })] };
		expect(wordsOf(graphOf(tree), 'cp', 'wi')).toBe('Father’s wife');
	});
});

describe('the order fault of the old fix stays shut with years (row 51 and the order-fault gate rule 8)', () => {
	// X and Y have M and Q; X has S by Z; M married S and divorced; P is the son of M and Q. With "former" the name is the same in every order.
	const people = [p('x', 'm'), p('y', 'f'), p('z', 'f'), p('m', 'm', undefined, undefined, ['x', 'y']), p('q', 'f', undefined, undefined, ['x', 'y']), p('s', 'f', undefined, undefined, ['x', 'z']), p('pp', 'm', undefined, undefined, ['m', 'q'])];
	const unions = [w('m', 's', { start: '1120', end: '1130', endedBy: 'divorce' })];
	const perms = (a: string[]): string[][] => (a.length <= 1 ? [a] : a.flatMap((e, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [e, ...r])));
	it('the card text of P is the same in all 5 040 orders of the people', () => {
		const tree = { people, unions };
		const seen = new Set<string>();
		for (const order of perms(people.map((x) => x.id))) {
			seen.add(wordsOf(graphOf(tree, undefined, order.map((id) => people.find((x) => x.id === id)!)), 'm', 'pp'));
		}
		expect([...seen]).toEqual(['Son | Nephew | Former wife’s half-nephew']);
	});
});

describe('M1: the step-grandparent reads every parent of M who descends from R', () => {
	// R and P married 1100 to 1110 and divorced. K1 (1105) was born in the marriage, K2 (1115) after it; both are children of R, and they are
	// the parents of M (half-siblings). One parent that passes is enough, so the word is the same whichever parent is listed first.
	const people = (parents: string[]) => [p('r', 'm'), p('pw', 'f'), p('w1', 'f'), p('w2', 'f'), p('k1', 'm', '1105', undefined, ['r', 'w1']), p('k2', 'f', '1115', undefined, ['r', 'w2']), p('mm', 'f', '1140', undefined, parents)];
	const unions = [w('r', 'pw', { start: '1100', end: '1110', endedBy: 'divorce' })];
	for (const parents of [['k1', 'k2'], ['k2', 'k1']]) {
		it(`parents of M listed as ${parents.join(', ')}`, () => {
			const g = graphOf({ people: people(parents), unions });
			expect(wordsOf(g, 'mm', 'pw')).toBe('Former step-grandmother');
		});
	}
});

describe('every step word of a pair: the years of each marriage', () => {
	it('rule 3 reads every marriage of every pair: a pair of divorced and a pair open', () => {
		// Two couples both give a stepbrother; the open marriage gives "Stepbrother" in either order of the parents.
		const base = (parentsOfMe: string[]): Tree => ({
			people: [p('n1', 'm'), p('q1', 'f'), p('n2', 'm'), p('q2', 'f'), p('me', 'm', '1130', undefined, parentsOfMe), p('yo', 'm', '1132', undefined, ['q1', 'q2'])],
			unions: [w('n1', 'q1', { start: '1120', end: '1129', endedBy: 'divorce' }), w('n2', 'q2', { start: '1125' })],
		});
		expect(wordsOf(graphOf(base(['n1', 'n2'])), 'me', 'yo')).toBe('Stepbrother');
		expect(wordsOf(graphOf(base(['n2', 'n1'])), 'me', 'yo')).toBe('Stepbrother');
	});
});
