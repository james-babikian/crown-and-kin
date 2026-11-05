// The case table of the relation words (spec §13.1 "Names by marriage", "Double", "Half", "Rumoured", "Adoptive"; §13.2 steps).
// Small trees with the exact words that the relation code gives, in both settings of the sibling switch (D174; the same words
// in both unless a case says otherwise). Each answer is also checked three ways: the finder names the same words and gives the
// steps listed here, and `relationLookup` gives exactly what `computeRelations` gives (every field, also the lazy line). The
// table records the code before it was split into files; a move of code must pass it unchanged. Cases T5, T7 and T11 have
// no gate in the brief; they pin the words of today (T7 is a known limit of the rule book: "Wife ; Mother" is not a goal).
import { describe, expect, it } from 'vitest';
import { computeRelations, findRelation, relationLookup, type RelationOptions } from '../../src/core/relations';
import { build } from '../support/helpers';

const SETTINGS: [string, RelationOptions][] = [
	['setting on', { oneParentUnknown: true }],
	['setting off', { oneParentUnknown: false }],
];
const APOSTROPHE = '’';

/** One line of the note for a person. */
const P = (id: string, sex: string, parents = ''): string => `  - {id: ${id}, name: ${id}, sex: ${sex}${parents ? `, parents: [${parents}]` : ''}}`;
const rumoured = (id: string): string => `{id: ${id}, type: rumoured}`;
const adoptive = (id: string): string => `{id: ${id}, type: adoptive}`;
const married = (a: string, b: string): string => `  - {partners: [${a}, ${b}]}`;

interface Ask {
	/** The other person. */
	to: string;
	/** All the names of the other person, best first, joined by " ; ". */
	words: string;
	/** The steps of the first name in the finder, joined by " / ". */
	steps: string;
}

interface Case {
	title: string;
	people: string[];
	unions?: string[];
	me: string;
	asks: Ask[];
}

const gfGm = [P('gf', 'm'), P('gm', 'f')];
const doubleCousinsBase = [...gfGm, P('hf', 'm'), P('hm', 'f'), P('b1', 'm', 'gf, gm'), P('b2', 'm', 'gf, gm'), P('s1', 'f', 'hf, hm'), P('s2', 'f', 'hf, hm'), P('c1', 'm', 'b1, s1')];
const stepBase = [P('m', 'm'), P('s', 'f'), P('x', 'm'), P('p', 'm', 's, x'), P('o', 'f', 'm, s')];
const stepUnions = [married('m', 's'), married('s', 'x')];

const CASES: Case[] = [
	{
		title: 'T1 two brothers marry two sisters: their children are double first cousins',
		people: [...doubleCousinsBase, P('c2', 'f', 'b2, s2')],
		me: 'c1',
		asks: [{ to: 'c2', words: 'Double first cousin', steps: 'father / father / co-parent / son / daughter' }],
	},
	{
		title: 'T2 a rumoured link to the great-grandfather does not hide the sure line',
		people: [P('gg', 'm'), P('g', 'm', 'gg'), P('f', 'm', 'g'), P('me', 'm', `f, ${rumoured('gg')}`)],
		me: 'me',
		asks: [{ to: 'gg', words: 'Rumoured father ; Great-grandfather', steps: 'rumoured father' }],
	},
	{
		title: 'T3 half first cousins: the grandfather has two wives',
		people: [P('a', 'm'), P('w1', 'f'), P('w2', 'f'), P('b1', 'm', 'a, w1'), P('b2', 'm', 'a, w2'), P('x1', 'f'), P('x2', 'f'), P('c1', 'm', 'b1, x1'), P('c2', 'f', 'b2, x2')],
		me: 'c1',
		asks: [{ to: 'c2', words: 'Half first cousin', steps: 'father / half-brother / daughter' }],
	},
	{
		title: 'T4 the child of two first cousins: the great-uncle is also the grandfather',
		people: [...gfGm, P('b1', 'm', 'gf, gm'), P('b2', 'm', 'gf, gm'), P('w1', 'f'), P('w2', 'f'), P('c1', 'm', 'b1, w1'), P('c2', 'f', 'b2, w2'), P('k', 'm', 'c1, c2')],
		me: 'k',
		asks: [
			{ to: 'b1', words: 'Grandfather ; Great-uncle', steps: 'father / father' },
			{ to: 'b2', words: 'Grandfather ; Great-uncle', steps: 'mother / father' },
			{ to: 'gf', words: 'Great-grandfather', steps: 'father / father / father' },
		],
	},
	{
		title: 'T5 a rumoured second parent makes a half-sister',
		people: [P('f', 'm'), P('m1', 'f'), P('m2', 'f'), P('a', 'm', 'f, m1'), P('b', 'f', `f, ${rumoured('m2')}`)],
		me: 'a',
		asks: [{ to: 'b', words: 'Half-sister', steps: 'half-sister' }],
	},
	{
		title: 'T6 the wife has a son by another man: stepson, and the own daughter stays a daughter',
		people: stepBase,
		unions: stepUnions,
		me: 'm',
		asks: [
			{ to: 'p', words: 'Stepson', steps: 'wife / son' },
			{ to: 'o', words: 'Daughter', steps: 'daughter' },
			{ to: 's', words: 'Wife', steps: 'wife' },
		],
	},
	{
		title: 'T7 the wife is also the mother (pinned as it is today)',
		people: [P('s', 'f'), P('x', 'm'), P('m', 'm', 's, x'), P('c', 'f', 'm')],
		unions: [married('m', 's')],
		me: 'm',
		asks: [
			{ to: 's', words: 'Wife ; Mother', steps: 'wife' },
			{ to: 'x', words: 'Father', steps: 'father' },
			{ to: 'c', words: 'Daughter', steps: 'daughter' },
		],
	},
	{
		title: 'T8 an adoptive double first cousin',
		people: [...doubleCousinsBase, P('c2', 'f', `${adoptive('b2')}, ${adoptive('s2')}`)],
		me: 'c1',
		asks: [{ to: 'c2', words: 'Adoptive double first cousin', steps: 'father / father / co-parent / son / adopted daughter' }],
	},
	{
		title: 'T9 the wife has a sister and parents: sister-in-law and father-in-law',
		people: [P('g', 'm'), P('h', 'f'), P('s', 'f', 'g, h'), P('p', 'f', 'g, h'), P('m', 'm')],
		unions: [married('m', 's')],
		me: 'm',
		asks: [
			{ to: 'p', words: 'Sister-in-law', steps: 'wife / father / co-parent / daughter' },
			{ to: 's', words: 'Wife', steps: 'wife' },
			{ to: 'g', words: 'Father-in-law', steps: 'wife / father' },
		],
	},
	{
		title: 'T10 a man marries his first cousin: her sister and her father keep both names',
		people: [...gfGm, P('b1', 'm', 'gf, gm'), P('b2', 'm', 'gf, gm'), P('m', 'm', 'b1'), P('s', 'f', 'b2'), P('p', 'f', 'b2')],
		unions: [married('m', 's')],
		me: 'm',
		asks: [
			{ to: 's', words: 'Wife ; First cousin', steps: 'wife' },
			{ to: 'p', words: 'First cousin ; Sister-in-law', steps: 'father / father / co-parent / son / daughter' },
			{ to: 'b2', words: 'Uncle ; Father-in-law', steps: 'father / father / co-parent / son' },
		],
	},
	{
		title: 'T11 three parents with a rumoured third',
		people: [P('a', 'm'), P('b', 'f'), P('c', 'f'), P('k1', 'm', `a, b, ${rumoured('c')}`), P('k2', 'f', 'a, c')],
		me: 'k1',
		asks: [{ to: 'k2', words: 'Half-sister ; Rumoured half-sister', steps: 'half-sister' }],
	},
	{
		title: 'T12 own grandchild and step-grandchild at once',
		people: [...stepBase, P('w', 'f'), P('q', 'm', 'p, w'), P('r', 'f', 'o, p')],
		unions: stepUnions,
		me: 'm',
		asks: [
			{ to: 'q', words: 'Step-grandson', steps: 'wife / son / son' },
			{ to: 'r', words: 'Granddaughter ; Step-granddaughter', steps: 'daughter / daughter' },
			{ to: 'p', words: 'Stepson', steps: 'wife / son' },
		],
	},
	{
		title: 'T13 a step-grandchild',
		people: [...stepBase.slice(0, 4), P('q', 'f', 'p')],
		unions: stepUnions,
		me: 'm',
		asks: [{ to: 'q', words: 'Step-granddaughter', steps: 'wife / son / daughter' }],
	},
	{
		title: 'T14 the wife’s sister has a child by the man: son and wife’s nephew, co-parent and sister-in-law',
		people: [P('g', 'm'), P('h', 'f'), P('s', 'f', 'g, h'), P('p', 'f', 'g, h'), P('m', 'm'), P('pc', 'm', 'p, m')],
		unions: [married('m', 's')],
		me: 'm',
		asks: [
			{ to: 'pc', words: `Son ; Wife${APOSTROPHE}s nephew`, steps: 'son' },
			{ to: 'p', words: 'Co-parent ; Sister-in-law', steps: 'co-parent' },
		],
	},
	{
		title: 'T15 a rumoured stepson and his child',
		people: [P('m', 'm'), P('s', 'f'), P('p', 'm', rumoured('s')), P('q', 'f', 'p')],
		unions: [married('m', 's')],
		me: 'm',
		asks: [
			{ to: 'p', words: 'Rumoured stepson', steps: 'wife / rumoured son' },
			{ to: 'q', words: 'Rumoured step-granddaughter', steps: 'wife / rumoured son / daughter' },
		],
	},
];

const noteOf = (c: Case): string => `people:\n${c.people.join('\n')}\n${c.unions ? `unions:\n${c.unions.join('\n')}\n` : ''}`;

describe('the case table of the relation words', () => {
	for (const c of CASES) {
		describe(c.title, () => {
			for (const [setting, options] of SETTINGS) {
				for (const ask of c.asks) {
					it(`${setting}: ${c.me} -> ${ask.to} is "${ask.words}"`, () => {
						const { g } = build(noteOf(c));
						const all = computeRelations(g, c.me, options);
						const names = all.get(ask.to) ?? [];
						expect(names.map((r) => r.text).join(' ; ')).toBe(ask.words);

						// The finder gives the same names, and the steps of the first one.
						const found = findRelation(g, c.me, ask.to, options);
						expect(found.kind).toBe('named');
						if (found.kind !== 'named') return;
						expect(found.relations.map((r) => r.relation.text).join(' ; ')).toBe(ask.words);
						expect(found.relations[0].steps.map((s) => s.word).join(' / ')).toBe(ask.steps);
						expect(JSON.stringify(found.relations.map((r) => r.relation))).toBe(JSON.stringify(names));

						// The lookup gives exactly what `computeRelations` gives (every field, the lazy line too).
						expect(JSON.stringify(relationLookup(g, c.me, options).get(ask.to))).toBe(JSON.stringify(names));
					});
				}
			}
		});
	}
});

/**
 * T16 a man married to his own grandmother (a made-up case for the step view that also leaves out the man's own links).
 * S has the sons K (by X) and the daughter J (by X2). M is the child of K, married to S, with the own child O. P is the child of
 * M and of U, the child of J: so S reaches P by two lines of the same length, one through M and one through J and U. The name
 * "Wife's great-granddaughter" of P needs the line through J, found only in the tree without the links of M. The words are the
 * same for every order of the people and of the parents of P and J.
 */
const T16_PEOPLE: Record<string, (pp: string, jp: string) => string> = {
	s: () => P('s', 'f'),
	x: () => P('x', 'm'),
	x2: () => P('x2', 'm'),
	k: () => P('k', 'm', 's, x'),
	j: (_, jp) => P('j', 'f', jp),
	m: () => P('m', 'm', 'k'),
	u: () => P('u', 'f', 'j'),
	p: (pp) => P('p', 'f', pp),
	o: () => P('o', 'f', 'm, s'),
};
const T16_ORDERS = [
	['s', 'x', 'x2', 'k', 'j', 'm', 'u', 'p', 'o'],
	['p', 's', 'u', 'x', 'o', 'x2', 'k', 'm', 'j'],
	['o', 'p', 'u', 'm', 'k', 'j', 'x2', 'x', 's'],
];
const T16_ASKS: Ask[] = [
	{ to: 'p', words: `Daughter ; Half first cousin once removed ; Wife${APOSTROPHE}s great-granddaughter`, steps: 'daughter' },
	{ to: 'u', words: 'Co-parent ; Half first cousin ; Step-granddaughter', steps: 'co-parent' },
	{ to: 'o', words: 'Daughter ; Half-aunt', steps: 'daughter' },
	{ to: 'j', words: 'Half-aunt ; Stepdaughter', steps: 'father / half-sister' },
	{ to: 'k', words: 'Father ; Stepson', steps: 'father' },
	{ to: 's', words: 'Wife ; Grandmother', steps: 'wife' },
	{ to: 'x', words: 'Grandfather', steps: 'father / father' },
];

describe('T16 a man married to his own grandmother: the same words in every order', () => {
	for (const [setting, options] of SETTINGS) {
		for (const pp of ['m, u', 'u, m']) {
			for (const jp of ['s, x2', 'x2, s']) {
				for (const [oi, order] of T16_ORDERS.entries()) {
					it(`${setting}, P's parents [${pp}], J's parents [${jp}], order ${oi + 1}`, () => {
						const { g } = build(`people:\n${order.map((id) => T16_PEOPLE[id](pp, jp)).join('\n')}\nunions:\n${married('m', 's')}\n`);
						const all = computeRelations(g, 'm', options);
						for (const ask of T16_ASKS) {
							const names = all.get(ask.to) ?? [];
							expect(names.map((r) => r.text).join(' ; '), ask.to).toBe(ask.words);
							const found = findRelation(g, 'm', ask.to, options);
							expect(found.kind).toBe('named');
							if (found.kind !== 'named') continue;
							expect(found.relations.map((r) => r.relation.text).join(' ; '), ask.to).toBe(ask.words);
							expect(found.relations[0].steps.map((st) => st.word).join(' / '), ask.to).toBe(ask.steps);
							expect(JSON.stringify(relationLookup(g, 'm', options).get(ask.to)), ask.to).toBe(JSON.stringify(names));
						}
					});
				}
			}
		}
	}
});
