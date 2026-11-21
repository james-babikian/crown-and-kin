// The case table of one parent written as a birth parent and as a rumoured parent of one child (spec §0 D371 (4)): the trees of the
// genealogy vet at the design gate. R1 to R20 are its first twenty trees in order (R7 the third rumoured parent with no second birth
// parent, R11 and R15 the controls adoptive + rumoured and begetter + rumoured, R16 the lone rumoured parent under adoptive placement);
// D1 to D3 and E1 to E3 are its further trees (E1 holds the finder change R22). In four orders of the note (as written, the people
// reversed, every list of parents reversed, both) and with the setting "Assume an unknown second parent" on and off: every relation
// word equals the word of the same note with the rumoured duplicate removed; the drawn links and the layout's lines are those of that
// note; and each child and parent pair gets exactly one warning.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../../src/core/derive';
import { issueText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import type { ValidateOptions } from '../../src/core/validate';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { stepSentences } from '../../src/render/tree-info';
import { build } from '../support/helpers';

const B = 'birth', R = 'rumoured', A = 'adoptive', G = 'begetter', W = 'ward';
type Link = [string, string];
interface Who {
	id: string;
	sex: string;
	parents?: Link[];
	placement?: string;
}
interface Row {
	row: string;
	people: Who[];
	unions?: [string, string, string?][];
	/** True for a control: the rule must not fire. */
	control?: boolean;
}

const SETTINGS: [string, RelationOptions][] = [
	['setting on', { oneParentUnknown: true }],
	['setting off', { oneParentUnknown: false }],
];
const ORDERS: [string, boolean, boolean][] = [
	['as written', false, false],
	['people reversed', true, false],
	['parents reversed', false, true],
	['both reversed', true, true],
];
const name = (id: string) => id[0].toUpperCase() + id.slice(1);

/** The ids that `parents` lists as a birth parent and as a rumoured parent. */
const doubledIn = (parents: readonly Link[]) => {
	const births = new Set(parents.filter(([, t]) => t === B).map(([i]) => i));
	return parents.filter(([i, t]) => t === R && births.has(i)).map(([i]) => i);
};

/** The note of a row; `strip` removes the rumoured entry of each doubled id. */
function note(r: Row, strip: boolean, people: boolean, parents: boolean): string {
	let lines = r.people.map((p) => {
		let list = p.parents ?? [];
		if (strip) {
			const doubled = new Set(doubledIn(list));
			list = list.filter(([i, t]) => !(t === R && doubled.has(i)));
		}
		if (parents) list = [...list].reverse();
		const items = list.map(([i, t]) => (t === B ? i : `{id: ${i}, type: ${t}}`)).join(', ');
		return `  - {id: ${p.id}, name: ${name(p.id)}, sex: ${p.sex}${list.length ? `, parents: [${items}]` : ''}${p.placement ? `, placement: ${p.placement}` : ''}}`;
	});
	if (people) lines = lines.reverse();
	const unions = (r.unions ?? []).map(([a, b, t]) => `  - {partners: [${a}, ${b}]${t ? `, type: ${t}` : ''}}`);
	return `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

/** Every relation word of every ordered pair, with its maybe, one text line per pair. */
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

/** The drawn links of every person, as the readers of the drawn links see them. */
const drawn = (g: FamilyGraph) => g.people.map((p) => `${p.id}<${drawnParents(g, p.id).map((d) => `${d.id}:${d.type}`).join(',')}`).sort().join(' ');

/** The rows of each graph that `graph` built, for the layout. */
const rowsOf = new Map<FamilyGraph, Map<string, number>>();
function graph(source: string, options?: ValidateOptions): FamilyGraph {
	if (options) {
		const r = parseDynasty(source);
		if (!r.ok) throw new Error('parse');
		return deriveFamilies(r.tree, options);
	}
	const b = build(source);
	rowsOf.set(b.g, b.gen);
	return b.g;
}

/** The cards and the lines of the layout. */
function layoutOf(g: FamilyGraph) {
	const { layout, edges } = arrangeTree(g, rowsOf.get(g)!, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
	return { cards: [...layout.persons].map(([id, b]) => `${id}@${b.x},${b.y}`).sort(), paths: edges.paths.map((p) => `${p.kind} ${p.child ?? ''}<${(p.parents ?? []).join('+')}`).sort() };
}

const L = (mira: Link[], extra: Who[] = [], tam: Link[] = [['oren', B], ['lys', B]]): Who[] => [
	{ id: 'gran', sex: 'f' },
	{ id: 'oren', sex: 'm', parents: [['gran', B]] },
	{ id: 'bert', sex: 'm', parents: [['gran', B]] },
	{ id: 'cous', sex: 'm', parents: [['bert', B]] },
	{ id: 'lys', sex: 'f' },
	{ id: 'ada', sex: 'f' },
	{ id: 'mira', sex: 'f', parents: mira },
	{ id: 'tam', sex: 'm', parents: tam },
	{ id: 'pell', sex: 'm', parents: [['oren', B], ['ada', B]] },
	{ id: 'kid', sex: 'f', parents: [['mira', B]] },
	...extra,
];
const U: [string, string][] = [['oren', 'lys'], ['oren', 'ada']];
const X8 = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'];
const XAN: Who[] = [{ id: 'xan', sex: 'f' }, { id: 'zed', sex: 'm', parents: [['oren', B], ['xan', B]] }];
const SAL = (mira: Link[]): Who[] => [...L(mira, [{ id: 'sal', sex: 'f', parents: [['lys', B], ['oren', R]] }])];
const ADOPTED = (mira: Link[]): Who[] => [{ id: 'oren', sex: 'm' }, { id: 'lov', sex: 'f' }, { id: 'a1', sex: 'm' }, { id: 'a2', sex: 'f' }, { id: 'mira', sex: 'f', parents: mira, placement: 'adoptive' }];

const ROWS: Row[] = [
	{ row: 'R1: birth Oren, birth Lys, rumoured Oren last', people: L([['oren', B], ['lys', B], ['oren', R]]), unions: U },
	{ row: 'R2: rumoured Oren first', people: L([['oren', R], ['oren', B], ['lys', B]]), unions: U },
	{ row: 'R3: rumoured Oren between, no union listed', people: L([['oren', B], ['oren', R], ['lys', B]]) },
	{ row: 'R4: no second parent; Tam lists Oren only', people: L([['oren', B], ['oren', R]], [], [['oren', B]]), unions: [['oren', 'ada']] },
	{ row: 'R5: no second parent; Tam lists Oren and Lys', people: L([['oren', B], ['oren', R]]), unions: U },
	{ row: 'R6: a third parent, rumoured Xan', people: L([['oren', B], ['lys', B], ['oren', R], ['xan', R]], XAN), unions: U },
	{ row: 'R7: rumoured Xan and no Lys; Zed is a child of Oren and Xan', people: L([['oren', B], ['oren', R], ['xan', R]], XAN, [['oren', B]]), unions: [['oren', 'ada']] },
	{ row: 'R8: Oren and Xan married, rumoured Xan', people: L([['oren', B], ['lys', B], ['oren', R], ['xan', R]], [{ id: 'xan', sex: 'f' }]), unions: [...U, ['oren', 'xan']] },
	{ row: 'R9: the duplicate on two children of the couple', people: L([['oren', B], ['lys', B], ['oren', R]], [], [['oren', R], ['oren', B], ['lys', B]]), unions: U },
	{ row: 'R10: Oren birth, adoptive and rumoured', people: L([['oren', B], ['lys', B], ['oren', A], ['oren', R]]), unions: U },
	{ row: 'R11 (control): adoptive Oren and rumoured Oren, birth Lys', people: L([['lys', B], ['oren', A], ['oren', R]]), unions: U, control: true },
	{ row: 'R12: birth Oren and rumoured Oren, adopted by Lys', people: L([['oren', B], ['lys', A], ['oren', R]]), unions: U },
	{ row: 'R13: nine rumoured parents written', people: L([['oren', B], ['oren', R], ...X8.map((x): Link => [x, R])], [...X8.map((x) => ({ id: x, sex: 'f' })), { id: 'zed', sex: 'm', parents: [['oren', B], ['x8', B]] }], [['oren', B]]), unions: [['oren', 'ada']] },
	{ row: 'R14: birth, begetter and rumoured Oren', people: L([['oren', B], ['lys', B], ['oren', G], ['oren', R]]), unions: U },
	{ row: 'R15 (control): begetter Oren and rumoured Oren, birth Lys', people: L([['lys', B], ['oren', G], ['oren', R]]), unions: U, control: true },
	{
		row: 'R16: placed under adoptive parents; birth Oren and rumoured Oren',
		people: [{ id: 'oren', sex: 'm' }, { id: 'a1', sex: 'm' }, { id: 'a2', sex: 'f' }, { id: 'mira', sex: 'f', parents: [['a1', A], ['a2', A], ['oren', B], ['oren', R]], placement: 'adoptive' }, { id: 'tam', sex: 'm', parents: [['a1', B], ['a2', B]] }],
		unions: [['a1', 'a2']],
	},
	{ row: 'R17: ward, birth and rumoured Oren', people: L([['oren', B], ['lys', B], ['oren', W], ['oren', R]]), unions: U },
	{
		row: 'R18: Oren and Lys are cousins',
		people: [
			{ id: 'g1', sex: 'm' }, { id: 'g2', sex: 'f' }, { id: 's1', sex: 'm', parents: [['g1', B], ['g2', B]] }, { id: 's2', sex: 'f', parents: [['g1', B], ['g2', B]] },
			{ id: 'oren', sex: 'm', parents: [['s1', B]] }, { id: 'lys', sex: 'f', parents: [['s2', B]] },
			{ id: 'mira', sex: 'f', parents: [['oren', B], ['lys', B], ['oren', R]] }, { id: 'tam', sex: 'm', parents: [['oren', B], ['lys', B]] },
		],
		unions: [['oren', 'lys']],
	},
	{
		row: 'R19: double cousins',
		people: [
			{ id: 'p1', sex: 'm' }, { id: 'p2', sex: 'f' }, { id: 'q1', sex: 'm' }, { id: 'q2', sex: 'f' },
			{ id: 'oren', sex: 'm', parents: [['p1', B], ['p2', B]] }, { id: 'bert', sex: 'm', parents: [['p1', B], ['p2', B]] },
			{ id: 'lys', sex: 'f', parents: [['q1', B], ['q2', B]] }, { id: 'lia', sex: 'f', parents: [['q1', B], ['q2', B]] },
			{ id: 'mira', sex: 'f', parents: [['oren', B], ['lys', B], ['oren', R]] }, { id: 'cous', sex: 'm', parents: [['bert', B], ['lia', B]] },
		],
		unions: [['oren', 'lys'], ['bert', 'lia']],
	},
	{
		row: 'R20: the duplicate one generation up',
		people: [
			{ id: 'gran', sex: 'f' }, { id: 'gpa', sex: 'm' }, { id: 'oren', sex: 'm', parents: [['gran', B], ['gpa', B], ['gran', R]] },
			{ id: 'bert', sex: 'm', parents: [['gran', B]] }, { id: 'mira', sex: 'f', parents: [['oren', B]] }, { id: 'cous', sex: 'm', parents: [['bert', B]] },
		],
	},
	{ row: 'D1: both birth parents also rumoured', people: SAL([['oren', B], ['lys', B], ['oren', R], ['lys', R]]), unions: [['oren', 'lys'], ['oren', 'ada']] },
	{ row: 'D2: Sal has rumoured Oren only, beside the duplicate', people: SAL([['oren', B], ['oren', R]]), unions: [['oren', 'ada']] },
	{ row: 'D3: the duplicate beside an adoptive parent', people: [...SAL([['oren', B], ['oren', R], ['a1', A]]), { id: 'a1', sex: 'f' }, { id: 'w', sex: 'm', parents: [['a1', A]] }], unions: [['oren', 'ada']] },
	{ row: 'E1 (R22): a chain through Oren, rumoured written first, placed under adoptive parents', people: ADOPTED([['oren', R], ['oren', B], ['a1', A], ['a2', A]]), unions: [['a1', 'a2'], ['oren', 'lov', 'affair']] },
	{ row: 'E2: the same, birth written first', people: ADOPTED([['oren', B], ['oren', R], ['a1', A], ['a2', A]]), unions: [['a1', 'a2'], ['oren', 'lov', 'affair']] },
	{ row: 'E3: a chain, placed by birth, rumoured first', people: [{ id: 'oren', sex: 'm' }, { id: 'lys', sex: 'f' }, { id: 'lov', sex: 'f' }, { id: 'mira', sex: 'f', parents: [['oren', R], ['oren', B], ['lys', B]] }], unions: [['oren', 'lov', 'affair']] },
];

/** The warnings the rule must give for a row: one per child and doubled parent. */
const expected = (r: Row) =>
	r.people.flatMap((p) => doubledIn(p.parents ?? []).map((id) => `${p.id}+${id}: The note lists ${name(id)} as a birth parent and as a rumoured parent of ${name(p.id)}. The tree shows ${name(id)} only as a birth parent. If ${name(id)} is the birth parent, remove ${name(id)} from the rumoured parents. If ${name(id)} is only a rumoured parent, remove ${name(id)} from the birth parents.`)).sort();
const warnings = (g: FamilyGraph) => g.issues.filter((i) => i.code === 'rumoured-is-birth-parent').map((i) => `${i.ids!.join('+')}: ${issueText(i)}`).sort();

describe('one parent written as birth and as rumoured: the words of the note without the rumoured entry (D371 (4))', () => {
	for (const r of ROWS) {
		for (const [setting, options] of SETTINGS) {
			it(`${r.row}, ${setting}`, () => {
				for (const [order, people, parents] of ORDERS) expect(allWords(graph(note(r, false, people, parents)), options), order).toBe(allWords(graph(note(r, true, people, parents)), options));
			});
		}
	}
});

/** The finder answer for one ordered pair as text: the relations or the chain with their line links, and the step sentences. */
function finderDigest(g: FamilyGraph, from: string, to: string, options: RelationOptions): string {
	const f = findRelation(g, from, to, options);
	if (f.kind === 'named') return JSON.stringify(f.relations.map((x) => ({ relation: x.relation, steps: stepSentences(g, x.steps) })));
	if (f.kind === 'chain') return JSON.stringify({ line: f.line, steps: stepSentences(g, f.steps) });
	return f.kind;
}

describe('one parent written as birth and as rumoured: the finder of every ordered pair equals that of the note without the rumoured entry (D371 (4))', () => {
	for (const r of ROWS) {
		for (const [setting, options] of SETTINGS) {
			it(`${r.row}, ${setting}`, () => {
				for (const [order, people, parents] of ORDERS) {
					const g = graph(note(r, false, people, parents));
					const plain = graph(note(r, true, people, parents));
					for (const a of g.people) for (const b of g.people) if (a.id !== b.id) expect(finderDigest(g, a.id, b.id, options), `${order}: ${a.id} to ${b.id}`).toBe(finderDigest(plain, a.id, b.id, options));
				}
			});
		}
	}
});

describe('one parent written as birth and as rumoured: the drawn links, the lines and the warning (D371 (4))', () => {
	for (const r of ROWS) {
		it(r.row, () => {
			for (const [order, people, parents] of ORDERS) {
				const g = graph(note(r, false, people, parents));
				const plain = graph(note(r, true, people, parents));
				expect(drawn(g), order).toBe(drawn(plain));
				expect(g.secondary, order).toEqual(plain.secondary);
				expect(layoutOf(g), order).toEqual(layoutOf(plain));
				expect(warnings(g), order).toEqual(expected(r));
				expect(warnings(plain), order).toEqual([]);
				expect(g.issues.filter((i) => i.code !== 'rumoured-is-birth-parent').map((i) => i.code), order).toEqual(r.row.startsWith('R13') ? ['too-many-parents'] : plain.issues.map((i) => i.code));
			}
		});
	}

	it('every row but the two controls has the duplicate; the controls give no warning of this rule (adoptive keeps both lines)', () => {
		for (const r of ROWS) expect(expected(r).length > 0, r.row).toBe(!r.control);
		for (const r of ROWS.filter((x) => x.control)) {
			const g = graph(note(r, false, false, false));
			// R15 (begetter + rumoured) draws the begetter link only since D375 (4): `relations-begetter-rumoured-cases.test.ts` holds its table.
			const side = g.secondary.filter((e) => e.child === 'mira').map((e) => `${e.parents.join('+')}:${e.type}`);
			expect(side).toContain(r.row.startsWith('R15') ? 'oren:begetter' : 'oren:rumoured');
			if (r.row.startsWith('R15')) expect(side).not.toContain('oren:rumoured');
			expect(warnings(g)).toEqual([]);
		}
	});

	it('nine rumoured parents written: the limit of 8 counts the written links, the duplicate too', () => {
		const g = graph(note(ROWS.find((r) => r.row.startsWith('R13'))!, false, false, false));
		const over = g.issues.filter((i) => i.code === 'too-many-parents');
		expect(over.map((i) => i.params)).toEqual([{ person: 'Mira', type: 'rumoured', count: 9, limit: 8 }]);
		expect(g.secondary.filter((e) => e.child === 'mira' && e.type === 'rumoured')).toHaveLength(8);
	});

	it('birth, begetter and rumoured Oren give both warnings and the birth link only', () => {
		const g = graph(note(ROWS.find((r) => r.row.startsWith('R14'))!, false, false, false));
		expect(g.issues.map((i) => i.code)).toEqual(['begetter-is-birth-parent', 'rumoured-is-birth-parent']);
		expect(drawnParents(g, 'mira')).toEqual([{ id: 'oren', type: 'birth' }, { id: 'lys', type: 'birth' }]);
	});
});

/** The step sentences of the finder relation whose word is `word`, joined by " / ". */
function steps(g: FamilyGraph, from: string, to: string, word: string): string {
	const f = findRelation(g, from, to);
	const list = f.kind === 'named' ? f.relations.find((x) => x.relation.lower === word)?.steps : f.kind === 'chain' ? f.steps : undefined;
	return list ? stepSentences(g, list).shown.join(' / ') : '(none)';
}

describe('the finder steps that the rule repairs (D371 (4))', () => {
	it('a rumoured mother Xan and no second birth parent: Zed is the rumoured brother of Mira in one step', () => {
		const r = ROWS.find((x) => x.row.startsWith('R7'))!;
		for (const [order, people, parents] of ORDERS) {
			const g = graph(note(r, false, people, parents));
			expect(steps(g, 'mira', 'zed', 'rumoured brother'), order).toBe('Zed is Mira’s rumoured brother.');
			expect(steps(g, 'zed', 'mira', 'rumoured sister'), order).toBe('Mira is Zed’s rumoured sister.');
			expect(steps(g, 'mira', 'zed', 'half-brother'), order).toBe('Zed is Mira’s half-brother.');
		}
	});

	it('rumoured written before birth under adoptive parents: the step from Mira up to Oren says "father" in every order', () => {
		const r = ROWS.find((x) => x.row.startsWith('E1'))!;
		for (const [order, people, parents] of ORDERS) {
			const g = graph(note(r, false, people, parents));
			expect(steps(g, 'mira', 'lov', ''), order).toBe('Oren is Mira’s father. / Lov is Oren’s lover.');
			expect(steps(g, 'a1', 'oren', ''), order).toBe('Mira is A1’s adopted daughter. / Oren is Mira’s father.');
		}
	});
});

describe('D371 (4), answer A: Oren is a birth parent and a rumoured parent of Mira', () => {
	const src = `people:
  - {id: oren, name: Oren Thorne, sex: m}
  - {id: lys, name: Lys Thorne, sex: f}
  - {id: mira, name: Mira Thorne, sex: f, parents: [oren, lys, {id: oren, type: rumoured}]}
unions:
  - {partners: [oren, lys]}
`;

	it('one line from Oren, and the warning', () => {
		const { g } = build(src);
		expect(drawnParents(g, 'mira')).toEqual([{ id: 'oren', type: 'birth' }, { id: 'lys', type: 'birth' }]);
		expect(g.secondary).toEqual([]);
		const { edges } = arrangeTree(g, build(src).gen, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
		expect(edges.paths.filter((p) => p.kind === 'rumoured')).toEqual([]);
		const w = g.issues.filter((i) => i.code === 'rumoured-is-birth-parent');
		expect(w).toHaveLength(1);
		expect(w[0]).toMatchObject({ level: 'warning', ids: ['mira', 'oren'], params: { person: 'Mira Thorne', parent: 'Oren Thorne' } });
		expect(issueText(w[0])).toBe(
			'The note lists Oren Thorne as a birth parent and as a rumoured parent of Mira Thorne. The tree shows Oren Thorne only as a birth parent. If Oren Thorne is the birth parent, remove Oren Thorne from the rumoured parents. If Oren Thorne is only a rumoured parent, remove Oren Thorne from the birth parents.',
		);
		expect(g.issues).toHaveLength(1);
	});

	it('the note keeps both entries', () => {
		const { tree, g } = build(src);
		expect(tree.people[2].parents).toEqual([{ id: 'oren', type: 'birth' }, { id: 'lys', type: 'birth' }, { id: 'oren', type: 'rumoured' }]);
		expect(g.byId.get('mira')!.parents).toHaveLength(3);
	});
});

describe('D371 (4) fires only on the written word birth', () => {
	const person = (list: string) => `people:
  - {id: oren, name: Oren Thorne, sex: m}
  - {id: lys, name: Lys Thorne, sex: f}
  - {id: mira, name: Mira Thorne, sex: f, parents: [${list}]}
`;
	const codes = (g: FamilyGraph) => g.issues.map((i) => i.code);
	const side = (g: FamilyGraph) => g.secondary.map((e) => `${e.parents.join('+')}:${e.type}`);

	it('an unknown type read as birth beside rumoured: no drop and no new warning; the unknown-type warning stays', () => {
		const { g } = build(person('{id: oren, type: rumored}, {id: oren, type: rumoured}, lys'));
		expect(codes(g)).toEqual(['unknown-parent-type']);
		expect(side(g)).toEqual(['oren:rumoured']);
		expect(drawnParents(g, 'mira')).toEqual([{ id: 'oren', type: 'birth' }, { id: 'lys', type: 'birth' }, { id: 'oren', type: 'rumoured' }]);
	});

	it('the same for a suggestion word such as biological', () => {
		const { g } = build(person('{id: oren, type: biological}, {id: oren, type: rumoured}, lys'));
		expect(codes(g)).toEqual(['unknown-parent-type']);
		expect(side(g)).toEqual(['oren:rumoured']);
	});

	it('the written word in another case or with spaces counts as birth', () => {
		for (const word of ['Birth', ' BIRTH ', '"birth"']) {
			const { g } = build(person(`{id: oren, type: ${word}}, {id: oren, type: Rumoured}, lys`));
			expect(codes(g), word).toEqual(['rumoured-is-birth-parent']);
			expect(side(g), word).toEqual([]);
		}
	});

	it('a known birth word beside an unknown one fires', () => {
		const { g } = build(person('{id: oren, type: rumored}, oren, {id: oren, type: rumoured}, lys'));
		expect(codes(g)).toEqual(['unknown-parent-type', 'rumoured-is-birth-parent']);
		expect(side(g)).toEqual([]);
	});

	it('a rumoured entry written twice beside birth gives one warning', () => {
		const { g } = build(person('oren, {id: oren, type: rumoured}, lys, {id: oren, type: rumoured}'));
		expect(codes(g)).toEqual(['rumoured-is-birth-parent']);
	});

	it('the setting "Warn about more than 2 parents" off does not stop it', () => {
		const g = graph(person('oren, lys, {id: oren, type: rumoured}'), { warnManyParents: false });
		expect(codes(g)).toEqual(['rumoured-is-birth-parent']);
		expect(side(g)).toEqual([]);
	});

	it('a birth entry with no type beside a rumoured entry fires', () => {
		const { g } = build(person('{id: oren}, {id: oren, type: rumoured}, lys'));
		expect(codes(g)).toEqual(['rumoured-is-birth-parent']);
		expect(side(g)).toEqual([]);
	});

	// Known limit, pinned as it is today: the parser reads a `type:` written as a YAML list as birth, with no warning
	// (`readParentType` in `src/core/parse.ts`), so the rule fires on a list that holds "rumoured".
	it('known limit: a type written as a list is read as birth, so the rule fires', () => {
		const { g } = build(person('{id: oren, type: [rumoured]}, {id: oren, type: rumoured}, lys'));
		expect(codes(g)).toEqual(['rumoured-is-birth-parent']);
		expect(side(g)).toEqual([]);
	});

	// Known limit, pinned as it is today: when the duplicate sits in a cycle, the cycle warning shows beside the rule's warning.
	describe('known limit: the duplicate in a cycle', () => {
		const cycle = (mira: string) => `people:
  - {id: oren, name: Oren Thorne, sex: m, parents: [mira]}
  - {id: mira, name: Mira Thorne, sex: f, parents: [${mira}]}
`;

		it('birth and rumoured Oren, and Oren lists Mira as a birth parent: both warnings show', () => {
			const { g } = build(cycle('oren, {id: oren, type: rumoured}'));
			expect(g.issues.map((i) => i.code).sort()).toEqual(['cycle', 'rumoured-is-birth-parent']);
		});

		it('the same with a begetter Oren: both warnings show', () => {
			const { g } = build(cycle('oren, {id: oren, type: begetter}'));
			expect(g.issues.map((i) => i.code).sort()).toEqual(['begetter-is-birth-parent', 'cycle']);
		});
	});
});
