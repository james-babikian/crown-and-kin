// The case table of one parent written as a begetter and as a rumoured parent of one child (spec §0 D375 (4)): the trees of the genealogy
// vet at the design gate (G1 to G5, C9, L1, L2, X1; A1 and W1 are the controls adoptive + rumoured and ward + rumoured). In four orders of the
// note and with the setting "Assume an unknown second parent" on and off: every relation word and every finder answer equals that of the same
// note without the rumoured entry; the tree draws the begetter link only; the warning `rumoured-is-begetter` fires once for each such id. The
// finder step word of a controls note does not depend on the order of the note (the old fault: "rumoured father" in some orders).
import { describe, expect, it } from 'vitest';
import { drawnParents, type FamilyGraph } from '../../src/core/derive';
import { issueText } from '../../src/core/messages';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { stepSentences } from '../../src/render/tree-info';
import { build } from '../support/helpers';

const B = 'birth', R = 'rumoured', A = 'adoptive', G = 'begetter', W = 'ward';
type Link = [string, string];
interface Who { id: string; sex: string; parents?: Link[]; placement?: string }
interface Row { row: string; people: Who[]; unions?: [string, string, string?][]; birth?: boolean }

const SETTINGS: [string, RelationOptions][] = [['setting on', { oneParentUnknown: true }], ['setting off', { oneParentUnknown: false }]];
const ORDERS: [string, boolean, boolean][] = [['as written', false, false], ['people reversed', true, false], ['parents reversed', false, true], ['both reversed', true, true]];
const name = (id: string) => id[0].toUpperCase() + id.slice(1);

/** The note of a row; `strip` removes the rumoured entry of each id that the person also writes as a begetter or a birth parent. */
function note(r: Row, strip: boolean, people: boolean, parents: boolean): string {
	let lines = r.people.map((p) => {
		let list = p.parents ?? [];
		if (strip) {
			const own = new Set(list.filter(([, t]) => t === B || t === G).map(([i]) => i));
			list = list.filter(([i, t]) => !(t === R && own.has(i)));
		}
		if (parents) list = [...list].reverse();
		const items = list.map(([i, t]) => (t === B ? i : `{id: ${i}, type: ${t}}`)).join(', ');
		return `  - {id: ${p.id}, name: ${name(p.id)}, sex: ${p.sex}${list.length ? `, parents: [${items}]` : ''}${p.placement ? `, placement: ${p.placement}` : ''}}`;
	});
	if (people) lines = lines.reverse();
	const unions = (r.unions ?? []).map(([a, b, t]) => `  - {partners: [${a}, ${b}]${t ? `, type: ${t}` : ''}}`);
	return `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

function allWords(g: FamilyGraph, options: RelationOptions): string {
	const out: string[] = [];
	for (const p of g.people) {
		const map = computeRelations(g, p.id, options);
		for (const q of g.people) {
			if (q.id === p.id) continue;
			const list = map.get(q.id);
			out.push(`${p.id}>${q.id}: ${list ? list.map((x) => x.text + (x.maybe ? `, maybe ${x.maybe.effect}` : '')).join(' | ') : '(none)'}`);
		}
	}
	return out.sort().join('\n');
}

function finderDigest(g: FamilyGraph, from: string, to: string, options: RelationOptions): string {
	const f = findRelation(g, from, to, options);
	if (f.kind === 'named') return JSON.stringify(f.relations.map((x) => ({ relation: x.relation, steps: stepSentences(g, x.steps) })));
	if (f.kind === 'chain') return JSON.stringify({ line: f.line, steps: stepSentences(g, f.steps) });
	return f.kind;
}

/** The finder step sentences from `from` to `to`, joined, for every named relation or the chain. */
function stepText(g: FamilyGraph, from: string, to: string): string {
	const f = findRelation(g, from, to);
	if (f.kind === 'named') return f.relations.map((x) => stepSentences(g, x.steps).shown.join(' / ')).join(' || ');
	if (f.kind === 'chain') return stepSentences(g, f.steps).shown.join(' / ');
	return f.kind;
}

const drawn = (g: FamilyGraph) => g.people.map((p) => `${p.id}<${drawnParents(g, p.id).map((d) => `${d.id}:${d.type}`).join(',')}`).sort().join(' ');
const codes = (g: FamilyGraph) => g.issues.map((i) => i.code);
const lineKinds = (x: { g: FamilyGraph; gen: Map<string, number> }) => arrangeTree(x.g, x.gen, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE }).edges.paths.map((p) => `${p.kind} ${p.child ?? ''}<${(p.parents ?? []).join('+')}`).sort();
const L = (mira: Link[], extra: Who[] = [], tam: Link[] = [['oren', B], ['lys', B]]): Who[] => [
	{ id: 'gran', sex: 'f' }, { id: 'oren', sex: 'm', parents: [['gran', B]] }, { id: 'bert', sex: 'm', parents: [['gran', B]] },
	{ id: 'lys', sex: 'f' }, { id: 'ada', sex: 'f' }, { id: 'lov', sex: 'f' },
	{ id: 'mira', sex: 'f', parents: mira }, { id: 'tam', sex: 'm', parents: tam },
	{ id: 'pell', sex: 'm', parents: [['oren', B], ['ada', B]] }, { id: 'kid', sex: 'f', parents: [['mira', B]] },
	{ id: 'lovkid', sex: 'm', parents: [['oren', B], ['lov', B]] },
	...extra,
];
const U: [string, string, string?][] = [['oren', 'ada'], ['oren', 'lov', 'affair']];
const X8 = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'];

const ROWS: Row[] = [
	{ row: 'G1: begetter Oren and rumoured Oren, no other parent', people: L([['oren', G], ['oren', R]], [], [['oren', B]]), unions: U },
	{ row: 'G1b: the same, rumoured first', people: L([['oren', R], ['oren', G]], [], [['oren', B]]), unions: U },
	{ row: 'G2: birth Lys, begetter and rumoured Oren, no union', people: L([['lys', B], ['oren', G], ['oren', R]]), unions: U },
	{ row: 'G2b: rumoured first', people: L([['oren', R], ['lys', B], ['oren', G]]), unions: U },
	{ row: 'G3: the same, Oren and Lys married', people: L([['lys', B], ['oren', G], ['oren', R]]), unions: [...U, ['oren', 'lys']] },
	{ row: 'G4: and a rumoured Xan', people: L([['lys', B], ['oren', G], ['oren', R], ['xan', R]], [{ id: 'xan', sex: 'f' }, { id: 'zed', sex: 'm', parents: [['oren', B], ['xan', B]] }]), unions: U },
	{
		row: 'G5: placed under adoptive parents',
		people: [
			{ id: 'oren', sex: 'm' }, { id: 'a1', sex: 'm' }, { id: 'a2', sex: 'f' }, { id: 'lov', sex: 'f' },
			{ id: 'mira', sex: 'f', parents: [['a1', A], ['a2', A], ['oren', G], ['oren', R]], placement: 'adoptive' },
			{ id: 'tam', sex: 'm', parents: [['a1', B], ['a2', B]] }, { id: 'lk', sex: 'm', parents: [['oren', B], ['lov', B]] },
		],
		unions: [['a1', 'a2'], ['oren', 'lov', 'affair']],
	},
	{ row: 'L1: and 8 other rumoured parents', people: L([['oren', G], ['oren', R], ...X8.map((x): Link => [x, R])], X8.map((x) => ({ id: x, sex: 'f' })), [['oren', B]]), unions: U },
	{ row: 'L2: birth Lys, begetters Oren and Q, rumoured Oren (3 by blood)', people: L([['lys', B], ['oren', G], ['q', G], ['oren', R]], [{ id: 'q', sex: 'm' }]), unions: U },
	{
		row: 'X1: Oren and Lys are first cousins',
		people: [
			{ id: 'g1', sex: 'm' }, { id: 'g2', sex: 'f' }, { id: 's1', sex: 'm', parents: [['g1', B], ['g2', B]] }, { id: 's2', sex: 'f', parents: [['g1', B], ['g2', B]] },
			{ id: 'oren', sex: 'm', parents: [['s1', B]] }, { id: 'lys', sex: 'f', parents: [['s2', B]] },
			{ id: 'mira', sex: 'f', parents: [['lys', B], ['oren', G], ['oren', R]] }, { id: 'tam', sex: 'm', parents: [['oren', B], ['lys', B]] },
		],
		unions: [['oren', 'lys']],
	},
	{ row: 'C9: birth, begetter and rumoured Oren, birth Lys', people: L([['oren', B], ['lys', B], ['oren', G], ['oren', R]]), unions: [['oren', 'lys'], ...U], birth: true },
	{ row: 'C9b: rumoured, begetter and birth Oren, no other parent', people: L([['oren', R], ['oren', G], ['oren', B]], [], [['oren', B]]), unions: U, birth: true },
];

describe('one parent written as begetter and as rumoured: the words and the finder of the note without the rumoured entry (D375 (4))', () => {
	for (const r of ROWS) {
		for (const [setting, options] of SETTINGS) {
			it(`${r.row}, ${setting}`, () => {
				for (const [order, people, parents] of ORDERS) {
					const g = build(note(r, false, people, parents)).g;
					const plain = build(note(r, true, people, parents)).g;
					expect(allWords(g, options), order).toBe(allWords(plain, options));
					for (const a of g.people) for (const b of g.people) if (a.id !== b.id) expect(finderDigest(g, a.id, b.id, options), `${order}: ${a.id} to ${b.id}`).toBe(finderDigest(plain, a.id, b.id, options));
				}
			});
		}
	}
});

describe('one parent written as begetter and as rumoured: the drawn links, the lines and the warning (D375 (4))', () => {
	for (const r of ROWS) {
		it(r.row, () => {
			for (const [order, people, parents] of ORDERS) {
				const one = build(note(r, false, people, parents));
				const plain = build(note(r, true, people, parents));
				expect(drawn(one.g), order).toBe(drawn(plain.g));
				expect(one.g.secondary, order).toEqual(plain.g.secondary);
				expect(lineKinds(one), order).toEqual(lineKinds(plain));
				const own = one.g.issues.filter((i) => i.code === 'rumoured-is-begetter');
				// The birth case keeps its own two warnings and gets no third.
				expect(own.length, order).toBe(r.birth ? 0 : 1);
				if (!r.birth) expect(own[0].ids, order).toEqual(['mira', 'oren']);
				const skip = new Set(['rumoured-is-begetter', 'rumoured-is-birth-parent', 'begetter-is-birth-parent']);
				const rest = codes(one.g).filter((c) => !skip.has(c));
				const expectedRest = codes(plain.g).filter((c) => !skip.has(c));
				// The limits count written links: the 9 rumoured parents of L1 warn, the 8 of its stripped note do not.
				expect(rest.sort(), order).toEqual((r.row.startsWith('L1') ? [...expectedRest, 'too-many-parents'] : expectedRest).sort());
			}
		});
	}

	it('birth, begetter and rumoured Oren: both of the old warnings and no third', () => {
		const { g } = build(note(ROWS.find((x) => x.row.startsWith('C9:'))!, false, false, false));
		expect(codes(g)).toEqual(['begetter-is-birth-parent', 'rumoured-is-birth-parent']);
		expect(drawnParents(g, 'mira')).toEqual([{ id: 'oren', type: 'birth' }, { id: 'lys', type: 'birth' }]);
	});

	it('begetter beside 9 rumoured: the limit of 8 counts the written links', () => {
		const { g } = build(note(ROWS.find((x) => x.row.startsWith('L1'))!, false, false, false));
		expect(g.issues.filter((i) => i.code === 'too-many-parents').map((i) => i.params)).toEqual([{ person: 'Mira', type: 'rumoured', count: 9, limit: 8 }]);
	});

	it('begetters Oren and Q and birth Lys: three parents by blood warn as before', () => {
		const { g } = build(note(ROWS.find((x) => x.row.startsWith('L2'))!, false, false, false));
		expect(codes(g)).toContain('too-many-blood-parents');
	});
});

describe('the finder says "begetter" in all four orders', () => {
	for (const row of ['G1:', 'G2:', 'G5:']) {
		it(row, () => {
			const r = ROWS.find((x) => x.row.startsWith(row))!;
			for (const [order, people, parents] of ORDERS) {
				const g = build(note(r, false, people, parents)).g;
				const text = stepText(g, 'mira', 'oren');
				expect(text, order).toContain('begetter');
				expect(text, order).not.toContain('rumoured');
			}
		});
	}
});

describe('adoptive + rumoured and ward + rumoured keep both words; the finder step does not depend on the order (D375 (4) rule 2)', () => {
	const controls: [string, Row, string][] = [
		['A1 adoptive', { row: 'A1', people: L([['lys', B], ['oren', A], ['oren', R]]), unions: U }, 'adoptive father'],
		['A1b adoptive, rumoured first', { row: 'A1b', people: L([['oren', R], ['lys', B], ['oren', A]]), unions: U }, 'adoptive father'],
		['W1 ward', { row: 'W1', people: L([['lys', B], ['oren', W], ['oren', R]]), unions: U }, 'guardian'],
		['W1b ward, rumoured first', { row: 'W1b', people: L([['oren', W], ['lys', B], ['oren', R]]), unions: U }, 'guardian'],
	];
	for (const [label, r, word] of controls) {
		it(label, () => {
			const texts = ORDERS.map(([order, people, parents]) => {
				const g = build(note(r, false, people, parents)).g;
				expect(g.issues.filter((i) => i.code.startsWith('rumoured-is')), order).toEqual([]);
				expect(g.secondary.filter((e) => e.child === 'mira').map((e) => e.type), order).toContain('rumoured');
				return ['oren', 'lov', 'lovkid', 'pell'].map((t) => stepText(g, 'mira', t)).join(' ## ');
			});
			expect(new Set(texts).size, texts.join(' ## ')).toBe(1);
			// The first name keeps its own word; the second name is the rumoured relation with its own steps.
			expect(texts[0].split(' ## ')[0].split(' || ')[0]).toContain(word);
			expect(texts[0].split(' ## ')[0].split(' || ')[0]).not.toContain('rumoured');
			// A chain through Oren (Mira to Lov) also says the kept word.
			expect(texts[0].split(' ## ')[1]).not.toContain('rumoured');
		});
	}

	it('both relation words stay', () => {
		const g = build(note({ row: 'A1', people: L([['lys', B], ['oren', A], ['oren', R]]), unions: U }, false, false, false)).g;
		const list = computeRelations(g, 'mira').get('oren')!.map((x) => x.text);
		expect(list).toEqual(['Adoptive father', 'Rumoured father']);
	});
});

describe('D375 (4), answer A: Oren is a begetter and a rumoured parent of Mira', () => {
	const src = `people:
  - {id: oren, name: Oren Thorne, sex: m}
  - {id: lys, name: Lys Thorne, sex: f}
  - {id: mira, name: Mira Thorne, sex: f, parents: [lys, {id: oren, type: begetter}, {id: oren, type: rumoured}]}
`;
	it('one begetter line, the warning, and the note keeps both entries', () => {
		const one = build(src);
		const { g, tree } = one;
		expect(g.secondary.map((e) => `${e.parents.join('+')}:${e.type}`)).toEqual(['oren:begetter']);
		expect(lineKinds(one).filter((k) => k.startsWith('rumoured'))).toEqual([]);
		const w = g.issues.filter((i) => i.code === 'rumoured-is-begetter');
		expect(w).toHaveLength(1);
		expect(w[0]).toMatchObject({ level: 'warning', ids: ['mira', 'oren'], params: { person: 'Mira Thorne', parent: 'Oren Thorne' } });
		expect(issueText(w[0])).toBe(
			'The note lists Oren Thorne as a begetter and as a rumoured parent of Mira Thorne. The tree shows Oren Thorne only as a begetter. If Oren Thorne is the begetter, remove Oren Thorne from the rumoured parents. If Oren Thorne is only a rumoured parent, remove Oren Thorne from the begetters.',
		);
		expect(tree.people[2].parents).toHaveLength(3);
	});

	it('a misspelt type word is no begetter: no drop and no new warning', () => {
		const { g } = build(src.replace('type: begetter', 'type: begeter'));
		expect(codes(g)).not.toContain('rumoured-is-begetter');
		expect(g.secondary.map((e) => e.type)).toContain('rumoured');
	});

	it('a misspelt rumoured word reads as birth: the begetter goes (D332), and no warning says "only as a begetter"', () => {
		// The genealogy check of the build: `[begetter o, rumoured o, rumored o]` warned falsely before the links were cleaned first.
		const { g } = build(src.replace('{id: oren, type: rumoured}]', '{id: oren, type: rumoured}, {id: oren, type: rumored}]'));
		expect(codes(g)).not.toContain('rumoured-is-begetter');
		expect(codes(g)).toContain('begetter-is-birth-parent');
		expect(codes(g)).toContain('unknown-parent-type');
	});
});
