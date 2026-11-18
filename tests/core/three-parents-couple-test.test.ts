// The couple test of a child with three or more parents of one kind (0.5.6, spec §0 D365 (2); contract "Three own lines" §1.1 to §1.5, §3.6,
// §5). Every row of the case table runs in the four list orders of the parents of N and with the settings "Warn about more than 2 parents"
// on and off (the setting "Assume an unknown second parent" changes the relation words only; `three-own-lines-words.test.ts` runs both). The
// verdict and the unions never depend on the order of a list.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParentMap, drawnParents, pairKey, placedChildren, type FamilyGraph } from '../../src/core/derive';
import { pruneGraph } from '../../src/core/folds';
import { computeGenerations } from '../../src/core/generations';
import { GROUP_SEAT_MAX, GROUP_SEAT_TYPE, groupSeatKey, isGroupSeat, withGroupSeats, withDefaultGroupSeats } from '../../src/core/group-seats';
import { computeModelOrder } from '../../src/core/order';
import { coParentKeys, defaultHubs, GROUP_MIN, groupHubOrder, groupKey, parentGroupOf, parentVerdict, parentVerdicts } from '../../src/core/parent-groups';
import { parseDynasty } from '../../src/core/parse';
import { ORDERS, THREE_PARENT_CASES, type ThreeParentCase } from '../support/three-parent-cases';

function graphOf(source: string, warnManyParents = true, verdicts?: ReturnType<typeof parentVerdicts>): FamilyGraph {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error(parsed.error.code);
	return deriveFamilies(parsed.tree, { warnManyParents, ...(verdicts ? { verdicts } : {}) });
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** What the couple test found, as text that does not depend on the order of any list. */
function signature(g: FamilyGraph): string {
	const verdicts = [...parentVerdicts(g)].map(([child, v]) => `${child}:${v.verdict}:${v.parentKind}:${v.verdict === 'couple' ? sorted(v.pair).join('+') : sorted(g.parentGroups.find((x) => x.child === child)!.parents).join('+')}`).sort();
	const unions = g.unions.map((u) => `${u.key}:${u.children.length}`).sort();
	return JSON.stringify([verdicts, unions, g.wardPairs.length]);
}

describe('the couple test, every row of the case table in four list orders and both warning settings (contract §5)', () => {
	for (const c of THREE_PARENT_CASES) {
		describe(`row ${c.row}: ${c.title}`, () => {
			it('finds the verdict the table names and builds the graph that goes with it', () => {
				for (const order of ORDERS) {
					for (const warn of [true, false]) {
						const g = graphOf(c.source(order), warn);
						check(g, c, `${order.join('')} warn ${warn}`);
					}
				}
			});

			// A row with no case child keeps the 0.5.5 pairing of the first two parents, which the list order decides.
			it.runIf(c.groups.length + Object.keys(c.couples).length > 0)('gives the same verdict and the same unions in every list order', () => {
				const first = signature(graphOf(c.source(ORDERS[0])));
				for (const order of ORDERS) expect(signature(graphOf(c.source(order)))).toBe(first);
			});
		});
	}
});

/** The checks of one row on one graph. */
function check(g: FamilyGraph, c: ThreeParentCase, label: string): void {
	const at = `row ${c.row} ${label}`;
	expect({ at, groups: g.parentGroups.map((x) => x.child).sort() }).toEqual({ at, groups: [...c.groups].sort() });
	for (const grp of g.parentGroups) {
		expect(grp.parents.length, at).toBeGreaterThanOrEqual(GROUP_MIN);
		// A group is in no union, no one-parent family and no ward pair, and each of its parents is placed.
		expect(g.primaryUnion.has(grp.child), at).toBe(false);
		expect(g.unions.some((u) => u.children.includes(grp.child)), at).toBe(false);
		expect([...g.soloChildren.values()].some((l) => l.includes(grp.child)), at).toBe(false);
		expect(g.wardPairs.some((w) => w.child === grp.child), at).toBe(false);
		expect(g.secondary.some((e) => e.child === grp.child && e.type === grp.kind), at).toBe(false);
		expect(sorted(g.placementParents.get(grp.child)!), at).toEqual(sorted(grp.parents));
		expect(parentVerdicts(g).get(grp.child), at).toEqual({ verdict: 'group', parentKind: grp.kind });
	}
	for (const [child, pair] of Object.entries(c.couples)) {
		const union = g.unionByKey.get(g.primaryUnion.get(child) ?? '');
		expect({ at, partners: sorted(union?.partners ?? []) }).toEqual({ at, partners: sorted(pair) });
		expect(sorted(g.placementParents.get(child)!), at).toEqual(sorted(pair));
		const v = parentVerdicts(g).get(child);
		expect(v?.verdict, at).toBe('couple');
		// Every other parent of that kind has one side link of its own (a pair of them keeps its union dot, as before).
		const type = g.placementType.get(child)!;
		const others = g.secondary.filter((e) => e.child === child && e.type === type).flatMap((e) => e.parents);
		expect(others.length, at).toBeGreaterThanOrEqual(1);
		expect(others.some((q) => pair.includes(q)), at).toBe(false);
	}
	for (const [a, b] of c.noUnion) expect(g.unions.some((u) => pairKey(u.partners[0], u.partners[1]) === pairKey(a, b)), `${at}: union ${a} ${b}`).toBe(false);
	expect(g.wardPairs.length, at).toBe(c.wardPairs);
	expect(g.issues.filter((i) => i.code === 'union-not-of-parents').length, at).toBe(c.notOfParents);
	// Nobody else is called a case.
	expect(sorted([...parentVerdicts(g).keys()]), at).toEqual(sorted([...c.groups, ...Object.keys(c.couples)]));
}

describe('what a row says that the generic checks do not', () => {
	const row = (id: string): ThreeParentCase => THREE_PARENT_CASES.find((c) => c.row === id)!;

	it('a child that lists one parent twice has three ids, and with only two ids it is not the case (row 1c)', () => {
		expect(graphOf(row('1c').source(ORDERS[0])).parentGroups[0].parents).toEqual(['B', 'T', 'C']);
		expect(graphOf(row('1c-two').source(ORDERS[0])).parentGroups).toEqual([]);
	});

	it('a link type word that is unknown reads as birth, and the group is a birth group (row 1d)', () => {
		expect(graphOf(row('1d').source(ORDERS[0])).parentGroups[0].kind).toBe('birth');
	});

	it('the adoptive group of three has the kind adoptive, and the birth parent of a placement-adoptive child is a side link (rows 1a, 5b-2)', () => {
		expect(graphOf(row('1a').source(ORDERS[0])).parentGroups[0].kind).toBe('adoptive');
		const g = graphOf(row('5b-2').source(ORDERS[0]));
		expect(g.parentGroups[0].kind).toBe('adoptive');
		expect(g.secondary.filter((e) => e.child === 'N').map((e) => `${e.type}:${e.parents.join()}`)).toEqual(['birth:D']);
	});

	it('three birth parents and one adoptive parent: the group is the birth parents, the adoptive one a side link (row 5b-3)', () => {
		const g = graphOf(row('5b-3').source(ORDERS[0]));
		expect(g.parentGroups[0].kind).toBe('birth');
		expect(g.secondary.filter((e) => e.child === 'N').map((e) => `${e.type}:${e.parents.join()}`)).toEqual(['adoptive:D']);
	});

	it('a group of four parents holds all four, in note order (row 9)', () => {
		expect(graphOf(row('9').source(['B', 'T', 'C'])).parentGroups[0].parents).toEqual(['B', 'T', 'C', 'D']);
	});

	it('a union that names no pair of the parents keeps its warning, a union that names the couple needs none (rows 10, 2f)', () => {
		expect(graphOf(row('10').source(ORDERS[0])).issues.filter((i) => i.code === 'union-not-of-parents')).toHaveLength(1);
		expect(graphOf(row('2f').source(ORDERS[0])).issues.filter((i) => i.code === 'union-not-of-parents')).toHaveLength(0);
	});

	it('guardians and a placement key ward are no case, and the key with no guardian is ignored (rows 8a, 8b, 8c, 11)', () => {
		expect(graphOf(row('8a').source(ORDERS[0])).wardPairs).toHaveLength(1);
		expect(graphOf(row('8b').source(ORDERS[0])).parentGroups).toEqual([]);
		expect(graphOf(row('11').source(ORDERS[0])).parentGroups).toEqual([]);
		expect(graphOf(row('8c').source(ORDERS[0])).parentGroups).toHaveLength(1);
	});

	it('two co-guardians of a ward are no couple for a child with three birth parents', () => {
		const g = graphOf(row('R2-coguardians').source(ORDERS[0]));
		expect(g.parentGroups.map((x) => x.child)).toEqual(['N']);
		expect(g.wardPairs).toEqual([{ child: 'Wd', guardians: ['B', 'T'] }]);
	});

	it('a rumoured or a begetter link of a second child does not make a couple', () => {
		for (const id of ['R2-rumoured', 'R2-begetter']) expect(graphOf(row(id).source(ORDERS[0])).parentGroups.map((x) => x.child), id).toEqual(['N']);
	});
});

describe('the pure couple test (parentVerdict, coParentKeys, groupKey)', () => {
	const couples = (...pairs: [string, string][]) => (a: string, b: string) => pairs.some(([x, y]) => pairKey(x, y) === pairKey(a, b));

	it('no couple, or two couples with no `union`, is a group; exactly one couple is that couple', () => {
		expect(parentVerdict('birth', ['a', 'b', 'c'], couples())).toEqual({ verdict: 'group', parentKind: 'birth' });
		expect(parentVerdict('adoptive', ['a', 'b', 'c'], couples(['a', 'b'], ['b', 'c']))).toEqual({ verdict: 'group', parentKind: 'adoptive' });
		expect(parentVerdict('birth', ['a', 'b', 'c'], couples(['c', 'a']))).toEqual({ verdict: 'couple', parentKind: 'birth', pair: ['a', 'c'] });
	});

	it('a `union` chooses among two or more couples, and a `union` of another pair chooses nothing', () => {
		const two = couples(['a', 'b'], ['b', 'c']);
		expect(parentVerdict('birth', ['a', 'b', 'c'], two, { namesPair: (x, y) => pairKey(x, y) === pairKey('b', 'c') })).toEqual({ verdict: 'couple', parentKind: 'birth', pair: ['b', 'c'] });
		expect(parentVerdict('birth', ['a', 'b', 'c'], two, { namesPair: () => false })).toEqual({ verdict: 'group', parentKind: 'birth' });
	});

	it('an id that is listed twice counts once', () => {
		expect(parentVerdict('birth', ['a', 'a', 'b'], couples(['a', 'b']))).toEqual({ verdict: 'couple', parentKind: 'birth', pair: ['a', 'b'] });
	});

	it('the verdict, with its couple, is the same in every order of the ids', () => {
		const isCouple = couples(['a', 'b'], ['b', 'c'], ['d', 'e']);
		const ids = ['a', 'b', 'c', 'd'];
		const perms = (xs: string[]): string[][] => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
		for (const withUnion of [false, true]) {
			const results = perms(ids).map((p) => {
				const v = parentVerdict('birth', p, isCouple, withUnion ? { namesPair: (x, y) => pairKey(x, y) === pairKey('b', 'c') } : undefined);
				return v.verdict === 'couple' ? `couple ${sorted(v.pair).join('+')}` : 'group';
			});
			expect(new Set(results).size, `union ${withUnion}`).toBe(1);
		}
	});

	it('coParentKeys holds the pair of exactly two distinct parents of a kind that is not ward', () => {
		const keys = coParentKeys([
			{ kind: 'birth', ids: ['a', 'b'] },
			{ kind: 'adoptive', ids: ['c', 'd', 'c'] },
			{ kind: 'ward', ids: ['e', 'f'] },
			{ kind: 'birth', ids: ['g', 'h', 'i'] },
			{ kind: 'birth', ids: ['j'] },
			{ kind: 'birth', ids: ['k', 'k'] },
		]);
		expect([...keys].sort()).toEqual([pairKey('a', 'b'), pairKey('c', 'd')].sort());
	});

	it('groupKey is the sorted ids as JSON, the same for every order and for a repeated id', () => {
		expect(groupKey(['c', 'a', 'b'])).toBe('["a","b","c"]');
		expect(groupKey(['b', 'a', 'b', 'c'])).toBe(groupKey(['c', 'b', 'a']));
	});
});

describe('the drawn links of a child that is a case keep the order of 0.5.5 (contract §1.3)', () => {
	const src = (parents: string, unions = '') => `people:\n  - {id: B, name: B}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: R, name: R}\n  - {id: N, name: N, parents: [${parents}]}\n${unions}`;

	it('a group lists the first two of its kind, then the rest by link type as before', () => {
		const g = graphOf(src('{id: R, type: rumoured}, B, T, C'));
		expect(drawnParents(g, 'N').map((q) => `${q.id}:${q.type}`)).toEqual(['B:birth', 'T:birth', 'R:rumoured', 'C:birth']);
		expect(drawnParentMap(g).get('N')!.map((q) => q.id)).toEqual(['B', 'T', 'R', 'C']);
	});

	it('a child under a couple lists its parents as written, though the couple are the last two', () => {
		const g = graphOf(src('T, B, C', 'unions:\n  - {partners: [B, C]}\n'));
		expect(g.placementParents.get('N')).toEqual(['B', 'C']);
		expect(drawnParents(g, 'N').map((q) => q.id)).toEqual(['T', 'B', 'C']);
		expect(drawnParentMap(g).get('N')!.map((q) => q.id)).toEqual(['T', 'B', 'C']);
	});
});

describe('hub order and seats (contract §1.5, §4.1)', () => {
	const rowSource = (id: string) => THREE_PARENT_CASES.find((c) => c.row === id)!.source;

	it('puts the parent with the fewest attachments first and then the one written first in the note', () => {
		// B has two own parents; T has a listed union; C has nothing: C first, then T, then B.
		const source = `people:\n  - {id: A, name: A}\n  - {id: A2, name: A2}\n  - {id: B, name: B, parents: [A, A2]}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: X, name: X}\n  - {id: N, name: N, parents: [B, T, C]}\nunions:\n  - {partners: [T, X]}\n`;
		const g = graphOf(source);
		expect(groupHubOrder(g, g.parentGroups[0])).toEqual(['C', 'T', 'B']);
		expect(defaultHubs(g).get('N')).toBe('C');
	});

	it('breaks a tie by the place of the person in the note, whatever the order of the list of N', () => {
		for (const order of ORDERS) {
			const g = graphOf(rowSource('1b')(order));
			expect(groupHubOrder(g, g.parentGroups[0]), order.join('')).toEqual(['B', 'T', 'C']);
		}
	});

	it('gives the same hub order before and after the group is seated', () => {
		const g = graphOf(rowSource('1b')(ORDERS[1]));
		const seated = withGroupSeats(g, defaultHubs(g), new Set(['N']));
		expect(groupHubOrder(seated, parentGroupOf(seated, 'N')!)).toEqual(groupHubOrder(g, g.parentGroups[0]));
		expect(defaultHubs(seated)).toEqual(defaultHubs(g));
	});

	it('returns the same graph when there is no group', () => {
		const g = graphOf(rowSource('2-marriage')(ORDERS[0]));
		expect(withGroupSeats(g, new Map(), new Set())).toBe(g);
		expect(withDefaultGroupSeats(g)).toBe(g);
	});

	it('seats a group of three: hub first, the child in the hub family, a side link and a seat union for each other parent', () => {
		const g = graphOf(rowSource('1b')(ORDERS[2]));
		const s = withGroupSeats(g, new Map([['N', 'T']]), new Set(['N']));
		expect(s.placementParents.get('N')).toEqual(['T', 'B', 'C']);
		expect(s.soloChildren.get('T')).toEqual(['N']);
		expect(s.primaryUnion.has('N')).toBe(false);
		expect(s.secondary.filter((e) => e.child === 'N').map((e) => `${e.type}:${e.parents.join()}`)).toEqual(['birth:B', 'birth:C']);
		const seats = s.unions.filter(isGroupSeat);
		expect(seats.map((u) => u.key).sort()).toEqual([groupSeatKey('T', 'B'), groupSeatKey('T', 'C')].sort());
		expect(seats.every((u) => u.type === GROUP_SEAT_TYPE && u.implicit && u.children.length === 0)).toBe(true);
		expect(s.parentGroups).toBe(g.parentGroups);
		expect(placedChildren(s, 'T')).toEqual(['N']);
		expect(g.soloChildren.size).toBe(0);
	});

	it('leaves out the seat unions of a hung group, and of a group of more than three parents', () => {
		const g = graphOf(rowSource('1b')(ORDERS[0]));
		expect(withGroupSeats(g, defaultHubs(g), new Set()).unions.filter(isGroupSeat)).toEqual([]);
		const four = graphOf(rowSource('9')(ORDERS[0]));
		const s = withGroupSeats(four, defaultHubs(four), new Set(['N']));
		expect(s.unions.filter(isGroupSeat)).toEqual([]);
		expect(s.placementParents.get('N')).toHaveLength(4);
		expect(GROUP_SEAT_MAX).toBe(3);
	});

	it('uses a listed union of a seat pair as it is and makes no second union for it (rows 3, 4)', () => {
		const g = graphOf(rowSource('4')(ORDERS[0]));
		const s = withGroupSeats(g, defaultHubs(g), new Set(['N']));
		expect(s.unions).toHaveLength(g.unions.length);
		expect(s.unions.filter(isGroupSeat)).toEqual([]);
	});

	it('can be applied again, also with another hub, and leaves no trace of the first seating', () => {
		const g = graphOf(rowSource('1b')(ORDERS[0]));
		const once = withGroupSeats(g, new Map([['N', 'B']]), new Set(['N']));
		const twice = withGroupSeats(once, new Map([['N', 'B']]), new Set(['N']));
		expect(JSON.stringify([twice.placementParents, twice.soloChildren, twice.secondary, twice.unions.map((u) => u.key)])).toBe(JSON.stringify([once.placementParents, once.soloChildren, once.secondary, once.unions.map((u) => u.key)]));
		const other = withGroupSeats(once, new Map([['N', 'C']]), new Set());
		const fresh = withGroupSeats(g, new Map([['N', 'C']]), new Set());
		expect(JSON.stringify([other.placementParents, [...other.soloChildren], other.secondary, other.unions.map((u) => u.key)])).toBe(JSON.stringify([fresh.placementParents, [...fresh.soloChildren], fresh.secondary, fresh.unions.map((u) => u.key)]));
	});

	it('takes the first hub when the one asked for is not a parent', () => {
		const g = graphOf(rowSource('1b')(ORDERS[0]));
		expect(withGroupSeats(g, new Map([['N', 'nobody']]), new Set()).placementParents.get('N')![0]).toBe('B');
	});

	it('keeps a graph that a layout seated, so the walk never undoes a trial hub', () => {
		const g = graphOf(rowSource('1b')(ORDERS[0]));
		const trial = withGroupSeats(g, new Map([['N', 'C']]), new Set());
		expect(withDefaultGroupSeats(trial)).toBe(trial);
		expect(withDefaultGroupSeats(g).placementParents.get('N')![0]).toBe('B');
	});
});

describe('a part of a tree reads the verdicts of the whole tree (contract §3.6)', () => {
	const whole = (id: string, order = ORDERS[0]) => THREE_PARENT_CASES.find((c) => c.row === id)!.source(order);
	/** The note with one person line removed: the person is gone, the links to it are reported and dropped. */
	const without = (source: string, id: string) => source.split('\n').filter((l) => !l.startsWith(`  - {id: ${id},`)).join('\n');

	it('a group with two of its parents present is a group of two, in no union, though two listed marriages stand (row 14)', () => {
		const full = graphOf(whole('14'));
		const part = graphOf(without(whole('14'), 'C'), true, parentVerdicts(full));
		expect(part.parentGroups).toEqual([{ child: 'N', kind: 'birth', parents: ['B', 'T'] }]);
		expect(part.primaryUnion.has('N')).toBe(false);
		expect(part.unions.some((u) => u.children.includes('N'))).toBe(false);
		// Without the verdicts the part would see a child of two parents under their marriage.
		expect(graphOf(without(whole('14'), 'C')).primaryUnion.has('N')).toBe(true);
	});

	it('a child under a couple stays under it when the child that proves the couple is not shown (row 15)', () => {
		const full = graphOf(whole('15'));
		const part = graphOf(without(without(whole('15'), 'Wynn'), 'Kid'), true, parentVerdicts(full));
		const union = part.unionByKey.get(part.primaryUnion.get('N')!)!;
		expect(sorted(union.partners)).toEqual(['B', 'C']);
		expect(part.secondary.filter((e) => e.child === 'N').map((e) => e.parents.join())).toEqual(['T']);
		expect(part.parentGroups).toEqual([]);
	});

	it('a couple with one partner not shown is a group of the parents that are shown', () => {
		const full = graphOf(whole('15'));
		const part = graphOf(without(without(whole('15'), 'Wynn'), 'C'), true, parentVerdicts(full));
		expect(part.parentGroups.map((x) => sorted(x.parents))).toEqual([['B', 'T']]);
		expect(part.unions).toEqual([]);
	});

	it('a child that was no case in the whole tree is no case in the part', () => {
		const full = graphOf(whole('8a'));
		const part = graphOf(whole('8a'), true, parentVerdicts(full));
		expect(part.parentGroups).toEqual([]);
		expect(part.wardPairs).toHaveLength(1);
	});

	it('with every parent shown, the verdicts of the whole tree give the graph of the whole tree', () => {
		for (const c of THREE_PARENT_CASES) {
			const full = graphOf(c.source(ORDERS[1]));
			expect(signature(graphOf(c.source(ORDERS[1]), true, parentVerdicts(full))), c.row).toBe(signature(full));
		}
	});
});

describe('the rows of the walk (contract §4.1: core rows equal layout rows)', () => {
	const rowSource = (id: string) => THREE_PARENT_CASES.find((c) => c.row === id)!.source;

	it('puts the child one row below its lowest parent and the three parents of roots on one row', () => {
		const g = graphOf(rowSource('1b')(ORDERS[0]));
		const gen = computeGenerations(g);
		expect([gen.get('B'), gen.get('T'), gen.get('C'), gen.get('N')]).toEqual([0, 0, 0, 1]);
	});

	it('gives the same rows to the graph and to the same graph seated', () => {
		for (const row of ['1b', '3', '9', '16', '2g']) {
			const g = graphOf(rowSource(row)(ORDERS[0]));
			const seated = withGroupSeats(g, defaultHubs(g), new Set(g.parentGroups.map((x) => x.child)));
			expect([...computeGenerations(seated)], row).toEqual([...computeGenerations(g)]);
		}
	});

	it('walks every row of the table without a throw and shows every person once', () => {
		for (const c of THREE_PARENT_CASES) {
			for (const order of ORDERS) {
				const g = graphOf(c.source(order));
				const gen = computeGenerations(g);
				expect(gen.size, c.row).toBe(g.people.length);
				const model = computeModelOrder(g, gen);
				const seen = model.items.filter((i) => i.kind === 'person').map((i) => (i as { id: string }).id);
				expect(sorted(seen), `${c.row} ${order.join('')}`).toEqual(sorted(g.people.map((p) => p.id)));
			}
		}
	});

	it('a child of a group stands one row below its lowest parent when a parent has parents of its own', () => {
		const g = graphOf(`people:\n  - {id: A, name: A}\n  - {id: B, name: B, parents: [A]}\n  - {id: T, name: T}\n  - {id: C, name: C}\n  - {id: N, name: N, parents: [B, T, C]}\n`);
		const gen = computeGenerations(g);
		expect(gen.get('N')).toBe(Math.max(gen.get('B')!, gen.get('T')!, gen.get('C')!) + 1);
	});
});

describe('a graph with people left out (a fold) seats the group as far as it is shown', () => {
	const g = graphOf(THREE_PARENT_CASES.find((c) => c.row === '1b')!.source(ORDERS[0]));

	it('drops the group when a parent is hidden, and seats nothing for it', () => {
		const pruned = pruneGraph(g, new Set(['T']));
		expect(pruned.parentGroups).toEqual([]);
		expect(withGroupSeats(pruned, defaultHubs(pruned), new Set(['N']))).toBe(pruned);
	});

	it('leaves a hidden child out and keeps its group in the graph', () => {
		const pruned = pruneGraph(g, new Set(['N']));
		const seated = withGroupSeats(pruned, defaultHubs(pruned), new Set(['N']));
		expect(seated.placementParents.has('N')).toBe(false);
		expect(seated.soloChildren.size).toBe(0);
		expect(withDefaultGroupSeats(pruned)).toBe(pruned);
	});
});
