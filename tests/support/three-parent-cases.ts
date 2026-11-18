// The case table of the contract "Three own lines" (0.5.6, spec §0 D365 (2)) as data, shared by the core tests and, read-only, by the
// layout tests. Names: B, T, C are the three parents; N is the child. Every row builds one note for each list order of the parents of N
// (`ORDERS`), and says what the couple test must find: which children are a group, which stand under which couple, which pairs must
// have no union, how many ward pairs the graph holds and how many `union-not-of-parents` warnings stand.

/** The four list orders of the three parents of N (contract §5). */
export const ORDERS: readonly (readonly string[])[] = [
	['B', 'T', 'C'],
	['T', 'C', 'B'],
	['C', 'B', 'T'],
	['B', 'C', 'T'],
];

/** One row of the case table. */
export interface ThreeParentCase {
	row: string;
	title: string;
	/** The note (the text of a `kin` block) for one list order of the three parents of N. */
	source: (order: readonly string[]) => string;
	/** The children that are a group (three or more parents of one kind, no couple). */
	groups: readonly string[];
	/** The children that stand under a couple of their parents, with the two partners. */
	couples: Readonly<Record<string, readonly [string, string]>>;
	/** The pairs that must have no union in the graph (listed or implicit). */
	noUnion: readonly (readonly [string, string])[];
	/** The number of ward pairs the graph holds. */
	wardPairs: number;
	/** The number of `union-not-of-parents` warnings. */
	notOfParents: number;
}

const ALL_PAIRS: readonly (readonly [string, string])[] = [
	['B', 'T'],
	['B', 'C'],
	['C', 'T'],
];

const SEX_F = new Set(['T', 'E', 'D']);

/** One entry of a `parents` list: a bare id for birth, else the flow map with the type word. */
const e = (id: string, type?: string): string => (type === undefined || type === 'birth' ? id : `{id: ${id}, type: ${type}}`);

/** One person line. */
const per = (id: string, parents: readonly string[] = [], extra = ''): string => `  - {id: ${id}, name: ${id}, sex: ${SEX_F.has(id) ? 'f' : 'm'}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}${extra}}`;

/** One union line. */
const uni = (a: string, b: string, extra = ''): string => `  - {partners: [${a}, ${b}]${extra}}`;

/** The note text of a small tree. */
const note = (people: readonly string[], unions: readonly string[] = []): string => `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;

const roots = (...ids: string[]): string[] => ids.map((id) => per(id));
const BTC = (): string[] => roots('B', 'T', 'C');
/** The list of N in one order, with one type for every entry. */
const typed = (order: readonly string[], type?: string): string[] => order.map((id) => e(id, type));

/** A row that has no couple among the three parents of N and no other feature. */
const row = (id: string, title: string, source: ThreeParentCase['source'], rest: Partial<ThreeParentCase> = {}): ThreeParentCase => ({
	row: id,
	title,
	source,
	groups: ['N'],
	couples: {},
	noUnion: ALL_PAIRS,
	wardPairs: 0,
	notOfParents: 0,
	...rest,
});

const COUPLE_BT = { N: ['B', 'T'] } as const;

const unionTypes: [string, string, string][] = [
	['2-marriage', 'marriage', ', type: marriage'],
	['2-betrothal', 'betrothal', ', type: betrothal'],
	['2-affair', 'affair', ', type: affair'],
	['2-concubinage', 'concubinage', ', type: concubinage'],
	['2-unknown-word', 'an unknown type word', ', type: handfast'],
	['2-ended', 'an ended marriage', ', type: marriage, end: 1900, ended-by: divorce'],
];

/** Every row of the case table of contract §5, in the order of the table. */
export const THREE_PARENT_CASES: readonly ThreeParentCase[] = [
	row('1a', 'three adoptive parents, none a couple', (o) => note([...BTC(), per('N', typed(o, 'adoptive'))])),
	row('1b', 'three birth parents', (o) => note([...BTC(), per('N', typed(o))])),
	row('1c', 'N lists the first parent twice, then the other two', (o) => note([...BTC(), per('N', [e(o[0]), e(o[0]), e(o[1]), e(o[2])])])),
	row('1c-two', 'N lists the first parent twice and one more: two ids, not the case', (o) => note([...BTC(), per('N', [e(o[0]), e(o[0]), e(o[1])])]), { groups: [], noUnion: [] }),
	row('1d', 'N lists C with an unknown link type word', (o) => note([...BTC(), per('N', [e(o[0]), e(o[1]), `{id: ${o[2]}, type: mystery}`])])),
	...unionTypes.map(([id, what, extra]) => row(id, `B and T are a couple (${what}); N lists the three parents`, (o) => note([...BTC(), per('N', typed(o))], [uni('B', 'T', extra)]), { groups: [], couples: COUPLE_BT, noUnion: [['B', 'C'], ['C', 'T']] })),
	row('2f', 'B and T are a couple and `union` of N names it', (o) => note([...BTC(), per('N', typed(o), ', union: m1')], [uni('B', 'T', ', id: m1')]), { groups: [], couples: COUPLE_BT, noUnion: [['B', 'C'], ['C', 'T']] }),
	row('2g', 'Wynn has only B and C as parents: they are a couple for N', (o) => note([...BTC(), per('Wynn', ['B', 'C']), per('N', typed(o))]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['B', 'T'], ['C', 'T']] }),
	row('2h', 'another child with three parents, B, C and Dax, makes no couple', (o) => note([...BTC(), per('Dax'), per('Xan', ['B', 'C', 'Dax']), per('N', typed(o))]), {
		groups: ['N', 'Xan'],
		noUnion: [...ALL_PAIRS, ['B', 'Dax'], ['C', 'Dax']],
	}),
	row('2i-a', 'N has three birth parents; Wynn has B and C as adoptive parents', (o) => note([...BTC(), per('Wynn', [e('B', 'adoptive'), e('C', 'adoptive')]), per('N', typed(o))]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['B', 'T'], ['C', 'T']] }),
	row('2i-b', 'N has three adoptive parents; Wynn has B and C as birth parents', (o) => note([...BTC(), per('Wynn', ['B', 'C']), per('N', typed(o, 'adoptive'))]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['B', 'T'], ['C', 'T']] }),
	row('2j', 'two pairs of co-parents among the three parents: a group', (o) => note([...BTC(), per('Wynn', ['B', 'C']), per('Yan', ['C', 'T']), per('N', typed(o))]), { noUnion: [['B', 'T']] }),
	row('2k', 'Wynn holds B and C only as adoptive parents beside a birth parent: no couple', (o) => note([...BTC(), per('D'), per('Wynn', ['D', e('B', 'adoptive'), e('C', 'adoptive')]), per('N', typed(o))])),
	row('R2-ward', 'two birth parents of a child placed under guardians are no couple', (o) => note([...BTC(), per('G1'), per('G2'), per('Zed', ['B', 'C', e('G1', 'ward'), e('G2', 'ward')], ', placement: ward'), per('N', typed(o))]), { wardPairs: 1 }),
	row('R2-rumoured', 'B and T share only a rumoured child', (o) => note([...BTC(), per('Rum', [e('B', 'rumoured'), e('T', 'rumoured')]), per('N', typed(o))])),
	row('R2-begetter', 'B and T share only a begetter child', (o) => note([...BTC(), per('Beg', [e('B', 'begetter'), e('T', 'begetter')]), per('N', typed(o))])),
	row('R2-coguardians', 'B and T are only co-guardians of a ward', (o) => note([...BTC(), per('Wd', [e('B', 'ward'), e('T', 'ward')]), per('N', typed(o))]), { wardPairs: 1 }),
	row('3', 'B is married to C and to T; N lists the three parents', (o) => note([...BTC(), per('N', typed(o))], [uni('B', 'C'), uni('B', 'T')]), { noUnion: [['C', 'T']] }),
	row('3u', 'as 3, and `union` of N names the marriage of B and C', (o) => note([...BTC(), per('N', typed(o), ', union: mBC')], [uni('B', 'C', ', id: mBC'), uni('B', 'T')]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['C', 'T']] }),
	row('4', 'all three pairs are married, no `union`', (o) => note([...BTC(), per('N', typed(o))], [uni('B', 'T'), uni('B', 'C'), uni('C', 'T')]), { noUnion: [] }),
	row('4u', 'all three pairs are married, `union` of N names C and T', (o) => note([...BTC(), per('N', typed(o), ', union: mCT')], [uni('B', 'T'), uni('B', 'C'), uni('C', 'T', ', id: mCT')]), { groups: [], couples: { N: ['C', 'T'] }, noUnion: [] }),
	row('5', 'two birth parents and one adoptive parent', (o) => note([...BTC(), per('N', [e(o[0]), e(o[1]), e(o[2], 'adoptive')])]), { groups: [], noUnion: [] }),
	row('5b-1', 'one birth parent and three adoptive parents, no placement key', (o) => note([...BTC(), per('D'), per('N', [e('D'), ...typed(o, 'adoptive')])]), { groups: [], noUnion: [] }),
	row('5b-2', 'one birth parent and three adoptive parents, placement adoptive', (o) => note([...BTC(), per('D'), per('N', [e('D'), ...typed(o, 'adoptive')], ', placement: adoptive')]), { noUnion: ALL_PAIRS }),
	row('5b-3', 'three birth parents and one adoptive parent, placed by birth', (o) => note([...BTC(), per('D'), per('N', [...typed(o), e('D', 'adoptive')])])),
	row('6', 'three birth parents and a rumoured parent', (o) => note([...BTC(), per('D'), per('N', [...typed(o), e('D', 'rumoured')])])),
	row('6b', 'two birth parents, and two rumoured links to one of them and a third', (o) => note([...BTC(), per('N', [e(o[0]), e(o[1]), e(o[0], 'rumoured'), e(o[2], 'rumoured')])]), { groups: [], noUnion: [] }),
	row('6c', 'B died before N was born', (o) => note([per('B', [], ', died: 1800'), per('T'), per('C'), per('N', typed(o), ', born: 1850')])),
	row('7', 'Pip is the adoptive child of married B and T; N has three adoptive parents', (o) => note([...BTC(), per('Pip', [e('B', 'adoptive'), e('T', 'adoptive')]), per('N', typed(o, 'adoptive'))], [uni('B', 'T')]), { groups: [], couples: COUPLE_BT, noUnion: [['B', 'C'], ['C', 'T']] }),
	row('8a', 'three guardians', (o) => note([...BTC(), per('N', typed(o, 'ward'))]), { groups: [], noUnion: ALL_PAIRS, wardPairs: 1 }),
	row('8b', 'three adoptive parents and a guardian, placement ward', (o) => note([...BTC(), per('G'), per('N', [...typed(o, 'adoptive'), e('G', 'ward')], ', placement: ward')]), { groups: [], noUnion: [] }),
	row('8c', 'three adoptive parents with a placement key ward but no guardian: the key is ignored', (o) => note([...BTC(), per('N', typed(o, 'adoptive'), ', placement: ward')])),
	row('9', 'four parents, two couples that share no person, no `union`', (o) => note([...BTC(), per('D'), per('N', [...typed(o), e('D')])], [uni('B', 'C'), uni('T', 'D')]), { noUnion: [['B', 'T'], ['C', 'T'], ['B', 'D'], ['C', 'D']] }),
	row('9u', 'four parents, two couples, `union` names the marriage of B and C', (o) => note([...BTC(), per('D'), per('N', [...typed(o), e('D')], ', union: mBC')], [uni('B', 'C', ', id: mBC'), uni('T', 'D')]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['B', 'T'], ['C', 'T'], ['B', 'D'], ['C', 'D']] }),
	row('9b', 'four parents, couples B and C, and C and T share a person, no `union`', (o) => note([...BTC(), per('D'), per('N', [...typed(o), e('D')])], [uni('B', 'C'), uni('C', 'T')]), { noUnion: [['B', 'T'], ['B', 'D'], ['C', 'D'], ['T', 'D']] }),
	row('10', '`union` of N names a union of other people', (o) => note([...BTC(), per('X'), per('Y'), per('N', typed(o), ', union: mxy')], [uni('X', 'Y', ', id: mxy')]), { notOfParents: 1 }),
	row('11', 'three birth parents and a guardian, placement ward', (o) => note([...BTC(), per('G'), per('N', [...typed(o), e('G', 'ward')], ', placement: ward')]), { groups: [], noUnion: [] }),
	row('12', 'N is marked illegitimate, three birth parents', (o) => note([...BTC(), per('N', typed(o), ', illegitimate: true')])),
	row('13', 'three birth parents and a child of N (folds, focus, finder)', (o) => note([...BTC(), per('N', typed(o)), per('Kid', ['N'])])),
	row('14', 'B is married to T and to C; N lists the three parents', (o) => note([...BTC(), per('N', typed(o))], [uni('B', 'T'), uni('B', 'C')]), { noUnion: [['C', 'T']] }),
	row('15', 'N stands under the couple B and C through Wynn', (o) => note([...BTC(), per('Wynn', ['B', 'C']), per('N', typed(o)), per('Kid', ['N'])]), { groups: [], couples: { N: ['B', 'C'] }, noUnion: [['B', 'T'], ['C', 'T']] }),
	row('16', 'two groups share a person, and a ward pair stands in the tree', (o) => note([...BTC(), per('D'), per('E'), per('N1', typed(o)), per('N2', ['B', 'D', 'E']), per('W', [e('T', 'ward'), e('E', 'ward')])]), {
		groups: ['N1', 'N2'],
		noUnion: [...ALL_PAIRS, ['B', 'D'], ['B', 'E'], ['D', 'E']],
		wardPairs: 1,
	}),
];
