// Which parents are "Co-parent" without a written partnership (spec §13.1, §0 D356 3 A and 5 A): a child with exactly two birth parents, or
// exactly two adoptive parents, makes them a pair, wherever its card stands (`placement`); a child with three or more parents of one kind
// makes none, in every order of the note; a guardian never joins a pair. Every case runs with the setting "Assume an unknown second parent" on
// and off, and in four orders of the note. The drawing keeps its implicit unions (`g.unions`), so the layout does not change.
import { describe, expect, it } from 'vitest';
import { coParentPairs } from '../../src/core/co-parents';
import type { FamilyGraph } from '../../src/core/derive';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { build } from '../support/helpers';

const SETTINGS: [string, RelationOptions][] = [
	['setting on', { oneParentUnknown: true }],
	['setting off', { oneParentUnknown: false }],
];

/** One person line. */
const P = (id: string, parents = '', extra = ''): string => `{id: ${id}, name: ${id}, sex: ${id === 'f' || id === 'b' ? 'f' : 'm'}${parents ? `, parents: [${parents}]` : ''}${extra}}`;
const t = (id: string, type: string) => `{id: ${id}, type: ${type}}`;
const note = (people: string[], unions = ''): string => `people: [${people.join(', ')}]${unions ? `\nunions: [${unions}]` : ''}`;

/** The items of a flow list, split at the commas outside braces. */
function items(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === '{') depth++;
		else if (list[i] === '}') depth--;
		else if (list[i] === ',' && depth === 0) {
			out.push(list.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(list.slice(start).trim());
	return out;
}

/** The note as built from the same people in four orders: as written, the people reversed, every list of parents reversed, both. */
function orders(people: string[], unions = ''): string[] {
	const rev = (p: string) => p.replace(/parents: \[(.*?)\]/, (_, list: string) => `parents: [${items(list).reverse().join(', ')}]`);
	return [note(people, unions), note([...people].reverse(), unions), note(people.map(rev), unions), note(people.map(rev).reverse(), unions)];
}

const word = (g: FamilyGraph, from: string, to: string, options: RelationOptions): string => (computeRelations(g, from, options).get(to) ?? []).map((r) => r.text).join(' | ') || '(none)';

/** Checks `from > to` in every order and both settings. */
function expectWord(people: string[], from: string, to: string, want: string, unions = ''): void {
	for (const source of orders(people, unions)) {
		for (const [, options] of SETTINGS) expect(word(build(source).g, from, to, options)).toBe(want);
	}
}

const THREE_ADOPTIVE = [P('a'), P('b'), P('c'), P('w', `${t('a', 'adoptive')}, ${t('b', 'adoptive')}, ${t('c', 'adoptive')}`)];
const THREE_BIRTH = [P('a'), P('b'), P('c'), P('w', 'a, b, c')];

describe('three or more parents of one kind: no two of them are co-parents (D356 3 A)', () => {
	for (const [title, people] of [['adoptive', THREE_ADOPTIVE], ['birth', THREE_BIRTH]] as const) {
		for (const [from, to] of [['a', 'b'], ['b', 'a'], ['a', 'c'], ['c', 'a'], ['b', 'c'], ['c', 'b']]) {
			it(`${title}: ${from} > ${to} shows no word, in four orders`, () => expectWord([...people], from, to, '(none)'));
		}
	}

	it('keeps the finder chain through the child for a pair that has no co-parent word', () => {
		for (const source of orders(THREE_ADOPTIVE)) {
			const f = findRelation(build(source).g, 'a', 'b');
			expect(f.kind).toBe('chain');
			if (f.kind === 'chain') {
				expect(f.steps.map((s) => s.person)).toContain('w');
				expect(f.steps.map((s) => s.word)).not.toContain('co-parent');
			}
		}
	});

	it('keeps the drawing: the layout still holds the implicit union of the first two parents it lists', () => {
		const { g } = build(note(THREE_ADOPTIVE));
		expect(g.unions.map((u) => u.key)).toEqual(['i:["a","b"]']);
		expect(g.primaryUnion.get('w')).toBe('i:["a","b"]');
		expect(coParentPairs(g).size).toBe(0);
	});

	it('still has a co-parent pair if another child lists exactly those two parents', () => {
		expectWord([...THREE_ADOPTIVE, P('d', 'a, b')], 'a', 'b', 'Co-parent');
		expectWord([...THREE_ADOPTIVE, P('d', 'a, b')], 'a', 'c', '(none)');
	});

	it('shows the word of a written partnership, whatever the number of parents', () => {
		expectWord(THREE_ADOPTIVE, 'a', 'b', 'Wife', '{partners: [a, b]}');
	});
});

describe('two parents of one kind and a parent of the other kind (D356 3 A)', () => {
	const people = [P('a'), P('b'), P('x'), P('w', `${t('a', 'adoptive')}, ${t('b', 'adoptive')}, x`)];
	it('two adoptive parents are co-parents', () => {
		expectWord(people, 'a', 'b', 'Co-parent');
		expectWord(people, 'b', 'a', 'Co-parent');
	});
	it('the birth parent is no co-parent of either', () => {
		for (const other of ['a', 'b']) {
			expectWord(people, 'x', other, '(none)');
			expectWord(people, other, 'x', '(none)');
		}
	});
	it('keeps the drawing: the child hangs from its birth parent alone', () => {
		const { g } = build(note(people));
		expect(g.unions).toEqual([]);
		expect(g.placementParents.get('w')).toEqual(['x']);
	});
	it('two birth parents and two adoptive parents: both pairs are co-parents', () => {
		const four = [P('a'), P('b'), P('c'), P('d'), P('w', `a, b, ${t('c', 'adoptive')}, ${t('d', 'adoptive')}`)];
		expectWord(four, 'a', 'b', 'Co-parent');
		expectWord(four, 'c', 'd', 'Co-parent');
		expectWord(four, 'a', 'c', '(none)');
	});
});

describe('the card of the child stands under its guardians (D356 5 A)', () => {
	const guarded = (extra: string) => [P('f'), P('m'), P('g'), P('h'), P('w', `f, m, ${t('g', 'ward')}, ${t('h', 'ward')}`, extra)];
	for (const [title, extra] of [['placement: ward', ', placement: ward'], ['no placement', '']] as const) {
		it(`${title}: the birth parents are co-parents of each other, the guardians of none`, () => {
			expectWord(guarded(extra), 'f', 'm', 'Co-parent');
			expectWord(guarded(extra), 'm', 'f', 'Co-parent');
			expectWord(guarded(extra), 'g', 'h', '(none)');
			expectWord(guarded(extra), 'h', 'g', '(none)');
			expectWord(guarded(extra), 'f', 'g', '(none)');
		});
		it(`${title}: the finder names the co-parent step`, () => {
			for (const source of orders(guarded(extra))) {
				const f = findRelation(build(source).g, 'f', 'm');
				expect(f.kind).toBe('named');
				if (f.kind === 'named') expect(f.relations[0].steps.map((s) => `${s.person} is ${s.of}'s ${s.word}`)).toEqual(["m is f's co-parent"]);
			}
		});
	}

	it('keeps the drawing: the child stays under the guardians and the birth parents have no union', () => {
		const { g } = build(note(guarded(', placement: ward')));
		expect(g.unions).toEqual([]);
		expect(g.wardPairs).toEqual([{ child: 'w', guardians: ['g', 'h'] }]);
		expect(g.placementParents.get('w')).toEqual(['g', 'h']);
	});

	it('a written partnership of the birth parents reads as before', () => {
		expectWord(guarded(', placement: ward'), 'f', 'm', 'Husband', '{partners: [f, m]}');
	});

	it('shows a ward and one guardian only as guardian and ward', () => {
		expectWord([P('f'), P('g'), P('w', `f, ${t('g', 'ward')}`)], 'f', 'g', '(none)');
	});
});

describe('the same two parents of a birth child and an adoptive child', () => {
	it('are co-parents', () => {
		expectWord([P('a'), P('b'), P('c', 'a, b'), P('d', `${t('a', 'adoptive')}, ${t('b', 'adoptive')}`)], 'a', 'b', 'Co-parent');
	});
});

describe('`coParentPairs`', () => {
	it('holds one pair for each two parents of one kind, once, and is made once for a graph', () => {
		const { g } = build(note([P('a'), P('b'), P('c', 'a, b'), P('d', 'b, a')]));
		const pairs = coParentPairs(g);
		expect([...pairs.keys()]).toEqual(['["a","b"]']);
		expect(coParentPairs(g)).toBe(pairs);
	});
	it('reads a rumoured, a begetter and a ward link as no kind of its own', () => {
		const { g } = build(note([P('a'), P('b'), P('c', `${t('a', 'rumoured')}, ${t('b', 'rumoured')}`), P('d', `${t('a', 'begetter')}, ${t('b', 'ward')}`)]));
		expect(coParentPairs(g).size).toBe(0);
	});
});
